/**
 * Hilesiz oynayan bot: yürür, toplar, üretir, fabrika kurar ve HUB kademelerini sırayla açar.
 * Kaynak vermez, ışınlanmaz; sadece oyunun normal kurallarıyla, bir takım arkadaşı gibi oynar.
 *
 * Her adımda dünyanın durumundan (yapılar, depolar, elektrik) bir plan çıkarır ve en faydalı tek işi yapar:
 * elektrik bakımı → teslimat → eksik tesisi kurma → hücreleri besleme → elle üretim.
 */
import {
  BUILDINGS,
  CRAFT_RANGE,
  ITEMS,
  MILESTONES,
  RECIPES,
  Terrain,
  footprint,
  footprintSize,
  hasTree,
  isBelt,
  terrainBuildable,
  tileKey,
} from '@fabrika/shared';
import type { BuildingState, InputState, PowerNetInfo, ServerMsg } from '@fabrika/shared';
import { Bot } from './stressBot';
import { findPath, simplifyPath } from './nav';
import { ORES, handRecipe, isRaw } from './planner';
import { layoutFits, nodeLayouts, placeLayout } from './layouts';
import type { Layout, TileState } from './layouts';
import { feedAmounts, inferFacilities, mineProcessOpen, mrp, plan, unlocked } from './economy';
import type { Facility, Mrp, Want } from './economy';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Madende işlenerek elde edilen kaynaklar (elle toplamaya gerek yok) */
const MINE_RESOURCES = new Set(['ore_iron', 'ore_copper', 'limestone']);

/** Bir adımda yapılabilecek işler (Jev bunlardan birini seçebilir) */
export interface Candidate {
  id: string;
  /** Jev'e gösterilen açıklama */
  desc: string;
  run: () => Promise<string>;
}

type Site = { layout: Layout; trees: Array<[number, number]> };

export class PlayerBot extends Bot {
  override botMode = 'oyun' as const;
  private input: InputState = { up: false, down: false, left: false, right: false };
  private seq = 0;
  deaths = 0;
  /** Son ölüm yeri (sandığı geri almak için) */
  private deathAt: { x: number; y: number } | null = null;
  status = 'başlıyor';
  /** Son planın özeti (Jev ve günlük için) */
  lastPlan: { wants: Want[]; mrp: Mrp } | null = null;
  /** Yürütülen işin kullandığı eşyalar: depoya bırakılmaz */
  private protect = new Set<string>();

  protected override onMessage(msg: ServerMsg) {
    if (msg.t === 'fx' && msg.kind === 'death' && msg.by === this.id) {
      this.deaths++;
      this.deathAt = { x: msg.x, y: msg.y };
    }
  }

  // ------------------------------------------------------------ yardımcılar

  hub(): BuildingState {
    return [...this.buildings.values()].find((b) => b.type === 'hub')!;
  }

  hubCenter(): [number, number] {
    return this.center(this.hub());
  }

  free(): number {
    return this.inv.filter((s) => !s).length;
  }

  center(b: BuildingState): [number, number] {
    const def = BUILDINGS[b.type];
    const [w, h] = footprintSize(def.w, def.h, b.rot);
    return [b.x + w / 2, b.y + h / 2];
  }

  dist(b: BuildingState): number {
    const [cx, cy] = this.center(b);
    return Math.hypot(cx - this.x, cy - this.y);
  }

  private blocked = (x: number, y: number): boolean => {
    const m = this.map;
    if (x < 0 || y < 0 || x >= m.size || y >= m.size) return true;
    const t = m.terrain[y * m.size + x];
    if (t === Terrain.Water || t === Terrain.Rock) return true;
    if (m.trees[y * m.size + x]) return true;
    const b = this.at(x, y);
    return !!b && !BUILDINGS[b.type].walkable;
  };

  /** Canlı böcek yuvalarına yakınlık cezası */
  private danger = (x: number, y: number): number => {
    for (const n of this.nests) if (n.alive && Math.abs(n.x - x) < 18 && Math.abs(n.y - y) < 18) return 40;
    return 0;
  };

  nearNest(x: number, y: number, r = 20): boolean {
    return this.nests.some((n) => n.alive && Math.hypot(n.x - x, n.y - y) < r);
  }

  private setInput(next: InputState, angle = 0) {
    const i = this.input;
    if (i.up === next.up && i.down === next.down && i.left === next.left && i.right === next.right) return;
    this.input = next;
    this.sendNow({ t: 'input', input: next, angle, seq: ++this.seq });
  }

  stop() {
    this.setInput({ up: false, down: false, left: false, right: false });
  }

  claim(key: string): boolean {
    const owner = this.ctx.busy.get(key);
    if (owner && owner !== this.name) return false;
    this.ctx.busy.set(key, this.name);
    return true;
  }

  release(key: string) {
    if (this.ctx.busy.get(key) === this.name) this.ctx.busy.delete(key);
  }

  // ------------------------------------------------------------ hareket

  /** (tx,ty) noktasına `range` mesafeye kadar yürür */
  async walkTo(tx: number, ty: number, range = 1): Promise<boolean> {
    return this.walkGoal(
      (x, y) => Math.hypot(x + 0.5 - tx, y + 0.5 - ty) <= Math.max(0.6, range - 0.3),
      tx, ty,
      () => Math.hypot(this.x - tx, this.y - ty) <= range,
    );
  }

  /** `goal` tile'larından birine yürür; `done` sağlanınca durur */
  async walkGoal(goal: (x: number, y: number) => boolean, hx: number, hy: number, done: () => boolean): Promise<boolean> {
    for (let attempt = 0; attempt < 4; attempt++) {
      if (this.closed) return false;
      if (done()) { this.stop(); return true; }
      const raw = findPath({ size: this.map.size, blocked: this.blocked, extraCost: this.danger }, Math.floor(this.x), Math.floor(this.y), goal, Math.floor(hx), Math.floor(hy));
      if (!raw) {
        this.stop();
        this.log(`yol yok: (${this.x.toFixed(1)},${this.y.toFixed(1)}) → (${hx.toFixed(1)},${hy.toFixed(1)})`, 'warn');
        return false;
      }
      const path = raw.length ? simplifyPath(raw) : [[Math.floor(this.x), Math.floor(this.y)] as [number, number]];
      if (await this.follow(path, done)) return true;
    }
    this.stop();
    if (!done()) this.log(`takıldı: (${this.x.toFixed(1)},${this.y.toFixed(1)}) → (${hx.toFixed(1)},${hy.toFixed(1)})`, 'warn');
    return done();
  }

  private async follow(path: Array<[number, number]>, done: () => boolean): Promise<boolean> {
    let i = 0;
    let lastProgress = Date.now();
    let lx = this.x, ly = this.y;
    while (!this.closed) {
      if (done()) { this.stop(); return true; }
      if (i >= path.length) { this.stop(); return done(); }
      const [wx, wy] = path[i];
      const dx = wx + 0.5 - this.x, dy = wy + 0.5 - this.y;
      // Eksen hizalı takip: ana eksende ilerle, dik eksendeki sapmayı hemen düzelt (köşelere sürtünmemek için)
      const last = i === path.length - 1;
      const along = last ? Math.max(0.15, 0.08 * this.speed) : 0.3;
      const horiz = Math.abs(dx) >= Math.abs(dy);
      const a = horiz ? dx : dy, p = horiz ? dy : dx;
      if (Math.abs(a) < along && Math.abs(p) < 0.3) { i++; continue; }
      // Dik sapma büyükse önce onu düzelt
      const pa = Math.abs(a) >= along * 0.5 && Math.abs(p) <= 0.25 ? Math.sign(a) : 0;
      const pp = Math.abs(p) > 0.12 ? Math.sign(p) : 0;
      const mx = horiz ? pa : pp, my = horiz ? pp : pa;
      this.setInput({ right: mx > 0, left: mx < 0, down: my > 0, up: my < 0 }, Math.atan2(dy, dx));
      await wait(15);
      if (Math.hypot(this.x - lx, this.y - ly) > 0.05) { lx = this.x; ly = this.y; lastProgress = Date.now(); }
      else if (Date.now() - lastProgress > 700) { this.stop(); return false; }
      if (this.hp < 40 && this.enemies.some((e) => Math.hypot(e.x - this.x, e.y - this.y) < 4)) { await this.fight(); lastProgress = Date.now(); }
    }
    return false;
  }

  /** Yapının `range` menziline (kenarına olan uzaklık) yürür */
  async goTo(b: BuildingState, range = 3.5): Promise<boolean> {
    const def = BUILDINGS[b.type];
    const [w, h] = footprintSize(def.w, def.h, b.rot);
    const edge = (px: number, py: number) => {
      const qx = Math.max(b.x, Math.min(px, b.x + w)), qy = Math.max(b.y, Math.min(py, b.y + h));
      return Math.hypot(px - qx, py - qy);
    };
    const [cx, cy] = this.center(b);
    return this.walkGoal((x, y) => edge(x + 0.5, y + 0.5) <= range - 0.6, cx, cy, () => edge(this.x, this.y) <= range);
  }

  /** Yakındaki böceklere saldırır */
  async fight() {
    for (let k = 0; k < 20; k++) {
      const e = this.enemies.filter((q) => Math.hypot(q.x - this.x, q.y - this.y) < 2.2).sort((a, b) => Math.hypot(a.x - this.x, a.y - this.y) - Math.hypot(b.x - this.x, b.y - this.y))[0];
      if (!e) return;
      this.sendNow({ t: 'attack', angle: Math.atan2(e.y - this.y, e.x - this.x) });
      await wait(Math.ceil(420 / this.speed));
    }
  }

  // ------------------------------------------------------------ toplama

  /** Elle hammadde topla (cevher) */
  async gather(item: string, n: number): Promise<boolean> {
    const deadline = Date.now() + 120_000;
    while (this.count(item) < n && Date.now() < deadline && !this.closed) {
      if (this.free() === 0 && !this.inv.some((s) => s?.item === item && s.count < (ITEMS[item]?.stack ?? 100))) {
        await this.stash(new Set([item]));
        if (this.free() === 0) return false;
      }
      const node = this.map.nodes
        .filter((q) => q.item === item && !this.occ.has(tileKey(q.x, q.y)) && !this.nearNest(q.x, q.y))
        .sort((a, b) => Math.hypot(a.x - this.x, a.y - this.y) - Math.hypot(b.x - this.x, b.y - this.y))[0];
      if (!node) { this.log(`${ITEMS[item].name} düğümü bulunamadı`, 'warn'); return false; }
      this.status = `${ITEMS[item].name} topluyor`;
      if (!(await this.walkTo(node.x + 0.5, node.y + 0.5, 3.5))) { this.log(`${ITEMS[item].name} düğümüne gidilemedi`, 'warn'); return false; }
      while (this.count(item) < n && !this.closed && Date.now() < deadline) {
        const before = this.count(item);
        this.sendNow({ t: 'harvest', x: node.x, y: node.y });
        await this.until(() => this.count(item) > before, Math.ceil(900 / this.speed) + 150);
        await wait(Math.ceil(620 / this.speed));
        if (this.count(item) === before && (this.free() === 0 || this.occ.has(tileKey(node.x, node.y)))) break;
      }
    }
    return this.count(item) >= n;
  }

  /** Ağaç kes: yaprak ve odun */
  async chop(item: 'leaves' | 'wood', n: number): Promise<boolean> {
    const deadline = Date.now() + 120_000;
    while (this.count(item) < n && Date.now() < deadline && !this.closed) {
      const t = this.nearestTree();
      if (!t) { this.log('kesilecek ağaç yok', 'warn'); return false; }
      this.status = 'ağaç kesiyor';
      if (!(await this.cutTree(t[0], t[1]))) this.map.trees[t[1] * this.map.size + t[0]] = 0;
    }
    return this.count(item) >= n;
  }

  async cutTree(x: number, y: number): Promise<boolean> {
    if (!hasTree(this.map, x, y)) return true;
    if (!(await this.walkTo(x + 0.5, y + 0.5, 3.5))) return false;
    for (let k = 0; k < 3 && hasTree(this.map, x, y); k++) {
      this.sendNow({ t: 'harvest', x, y });
      await this.until(() => !hasTree(this.map, x, y), Math.ceil(900 / this.speed) + 200);
      await wait(Math.ceil(620 / this.speed));
    }
    return !hasTree(this.map, x, y);
  }

  private nearestTree(): [number, number] | null {
    const m = this.map;
    const cx = Math.floor(this.x), cy = Math.floor(this.y);
    for (let r = 1; r < 60; r++) {
      let best: [number, number] | null = null, bd = Infinity;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = cx + dx, y = cy + dy;
        if (x < 1 || y < 1 || x >= m.size - 1 || y >= m.size - 1 || !m.trees[y * m.size + x]) continue;
        if (this.nearNest(x, y) || this.ctx.isReserved(x, y)) continue;
        const d = Math.hypot(dx, dy);
        if (d < bd) { bd = d; best = [x, y]; }
      }
      if (best) return best;
    }
    return null;
  }

  // ------------------------------------------------------------ envanter ve depolar

  /** Dünyadaki tesisler (yapılardan çıkarılır) */
  facilities(): Facility[] {
    return inferFacilities(this.buildings.values(), (x, y) => this.at(x, y), (b) => {
      for (const [x, y] of footprint(b.type, b.x, b.y, b.rot)) {
        const n = this.map.nodeAt.get(tileKey(x, y));
        if (n) return n.item;
      }
      return undefined;
    });
  }

  /** Tüm depolardaki eşyalar */
  storageStock(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const b of this.buildings.values()) {
      if (b.type !== 'storage') continue;
      for (const s of b.storage ?? []) if (s) out[s.item] = (out[s.item] ?? 0) + s.count;
    }
    return out;
  }

  /** MRP için stok: depolar + envanter + hücrelerde işlenmekte olanlar */
  planStock(fac: Facility[]): Record<string, number> {
    const out = this.storageStock();
    for (const s of this.inv) if (s) out[s.item] = (out[s.item] ?? 0) + s.count;
    for (const f of fac) {
      const m = f.machine;
      if (!m || !m.recipe || (f.kind !== 'cell' && f.kind !== 'oil')) continue;
      const r = RECIPES[m.recipe];
      for (const [k, v] of Object.entries(m.outBuf)) out[k] = (out[k] ?? 0) + Math.floor(v);
      if (f.kind === 'oil') continue;
      const crafts = Math.min(...Object.entries(r.inputs).map(([k, v]) => Math.floor((m.inBuf[k] ?? 0) / v)));
      for (const [k, v] of Object.entries(r.outputs)) out[k] = (out[k] ?? 0) + crafts * v;
    }
    return out;
  }

  /** Depolardan ve hücre çıkışlarından `item` toplar (üretmeden); envanterdeki toplamı döndürür */
  async fetch(item: string, n: number, exclude?: number): Promise<number> {
    for (let guard = 0; guard < 8 && this.count(item) < n && !this.closed; guard++) {
      const src = [...this.buildings.values()].filter((b) => b.id !== exclude && (
        (b.type === 'storage' && b.storage?.some((s) => s?.item === item)) ||
        (BUILDINGS[b.type].crafter && (b.outBuf[item] ?? 0) >= 1)
      )).sort((a, b) => this.dist(a) - this.dist(b))[0];
      if (!src) break;
      if (this.free() < 2) await this.stash(new Set([item]));
      this.status = `${ITEMS[item].name} alıyor`;
      if (!(await this.goTo(src))) { this.log(`${ITEMS[item].name} kaynağına gidilemedi`, 'warn'); break; }
      const before = this.count(item);
      if (src.type === 'storage') {
        let have = before;
        src.storage!.forEach((s, i) => {
          if (s?.item !== item || have >= n) return;
          this.send({ t: 'take', id: src.id, from: 'storage', slot: i });
          have += s.count;
        });
      } else {
        this.send({ t: 'take', id: src.id, from: 'out', item });
      }
      await this.flush();
      await this.until(() => this.count(item) > before, 1500);
      if (this.count(item) === before) break;
    }
    return this.count(item);
  }

  /** Genel depoya gereksiz eşyaları bırakır */
  async stash(keep: Set<string> = new Set()) {
    const depots = this.facilities().filter((f) => f.kind === 'depot' && f.storage?.storage?.some((s) => !s)).map((f) => f.storage!);
    const d = depots.sort((a, b) => this.dist(a) - this.dist(b))[0];
    if (!d) return;
    const slots = this.inv.map((s, i) => [s, i] as const).filter(([s]) => s && !keep.has(s.item) && !this.protect.has(s.item));
    if (!slots.length) return;
    this.status = 'depoya bırakıyor';
    if (!(await this.goTo(d))) return;
    for (const [, i] of slots) this.send({ t: 'put', id: d.id, slot: i });
    await this.flush();
    await this.until(() => slots.every(([, i]) => !this.inv[i] || keep.has(this.inv[i]!.item)), 1500);
  }

  /** Envanterden yapıya `n` adet koyar (gerekirse birden çok yuvadan) */
  async putItem(b: BuildingState, item: string, n: number) {
    let left = Math.min(n, this.count(item));
    const before = this.count(item);
    this.inv.forEach((s, i) => {
      if (!s || s.item !== item || left <= 0) return;
      const c = Math.min(left, s.count);
      this.send({ t: 'put', id: b.id, slot: i, count: c });
      left -= c;
    });
    await this.flush();
    await this.until(() => this.count(item) < before, 1500);
  }

  // ------------------------------------------------------------ üretim

  /** HUB'ın elle üretim menziline git */
  async goHub(): Promise<boolean> {
    return this.goTo(this.hub(), CRAFT_RANGE - 1.5);
  }

  /** Elle `crafts` kez üret (girdiler envanterde olmalı) */
  async handCraft(recipeId: string, crafts: number): Promise<boolean> {
    const r = RECIPES[recipeId];
    if (!(await this.goHub())) return false;
    this.status = `elle üretim: ${r.name}`;
    const outItem = Object.keys(r.outputs)[0];
    const target = this.count(outItem) + crafts * r.outputs[outItem];
    let left = crafts;
    while (left > 0) {
      const n = Math.min(100, left);
      this.send({ t: 'craft', recipe: recipeId, count: n });
      left -= n;
    }
    await this.flush();
    const secs = (crafts * Math.max(0.5, r.time / 2)) / this.speed;
    // Önce sunucunun kuyruğu almasını bekle, sonra kuyruğun bitmesini
    await this.until(() => this.craftQueue.some((j) => j.recipe === recipeId) || this.count(outItem) >= target, 2000);
    await this.until(() => this.count(outItem) >= target || !this.craftQueue.length, secs * 1000 + 3000);
    return this.count(outItem) >= target - 1;
  }

  /** Envanterde `item`'dan en az `n` adet olmasını sağlar: önce depolardan alır, sonra elle toplar, keser ve üretir */
  async obtain(item: string, n: number, depth = 0): Promise<boolean> {
    this.protect.add(item);
    if (this.count(item) >= n) return true;
    if (depth > 8 || this.closed) return false;
    await this.fetch(item, n);
    if (this.count(item) >= n) return true;
    if (ORES.has(item)) return this.gather(item, n);
    if (item === 'leaves' || item === 'wood') return this.chop(item, n);
    if (isRaw(item)) return false;
    const r = handRecipe(item, this.techDone);
    if (!r) return false;
    const crafts = Math.ceil((n - this.count(item)) / r.outputs[item]);
    for (const [k, v] of Object.entries(r.inputs)) {
      if (!(await this.obtain(k, crafts * v, depth + 1))) return false;
    }
    return this.handCraft(r.id, crafts);
  }

  /** Birden çok eşyayı birlikte sağlar; eksik kalan eşyayı (yoksa null) döndürür */
  async obtainAll(cost: Record<string, number>): Promise<string | null> {
    for (let round = 0; round < 2; round++) {
      for (const [k, v] of Object.entries(cost)) {
        if (!(await this.obtain(k, v))) return k;
      }
      // Sonraki eşyaları üretirken öncekiler harcanmış olabilir
      if (Object.entries(cost).every(([k, v]) => this.count(k) >= v)) return null;
    }
    return Object.entries(cost).find(([k, v]) => this.count(k) < v)?.[0] ?? null;
  }

  /** HUB'a teslim et */
  async deliver(): Promise<void> {
    if (!(await this.goHub())) return;
    this.send({ t: 'hubSubmit' });
    await this.flush();
    await wait(300);
  }

  /** Ölünce sandığı geri al */
  async recoverCrate() {
    if (!this.deathAt) return;
    const at = this.deathAt;
    this.deathAt = null;
    const crate = [...this.buildings.values()].filter((b) => b.type === 'crate').sort((a, b) => Math.hypot(a.x - at.x, a.y - at.y) - Math.hypot(b.x - at.x, b.y - at.y))[0];
    if (!crate || Math.hypot(crate.x - at.x, crate.y - at.y) > 12 || this.nearNest(crate.x, crate.y, 16)) return;
    this.status = 'sandığı geri alıyor';
    if (await this.goTo(crate, 3)) {
      this.send({ t: 'take', id: crate.id, from: 'storage' });
      await this.flush();
      await wait(300);
    }
  }

  // ------------------------------------------------------------ inşa

  private tileState = (x: number, y: number): TileState => {
    const m = this.map;
    if (!terrainBuildable(m, x, y)) return 'blocked';
    if (this.occ.has(tileKey(x, y)) || this.ctx.isReserved(x, y)) return 'blocked';
    if (m.loot.some((l) => l.x === x && l.y === y)) return 'blocked';
    const h = this.hub();
    // HUB çevresi elle üretim ve teslimat için boş kalsın
    if (x >= h.x - 3 && x <= h.x + 6 && y >= h.y - 3 && y <= h.y + 6) return 'blocked';
    if (this.nearNest(x, y, 22)) return 'blocked';
    return hasTree(m, x, y) ? 'tree' : 'free';
  };

  private ringBlocked = (x: number, y: number): boolean => {
    const b = this.at(x, y);
    if (b && b.type !== 'power_pole') return true;
    return this.ctx.isReserved(x, y);
  };

  private isNode = (x: number, y: number): boolean => this.map.nodeAt.has(tileKey(x, y));

  /** Düğüm tesisi için yer: en yakın uygun düğüm (saf düğümler tercih edilir) */
  findNodeSite(kind: 'mine' | 'coal' | 'oil', resource: string, recipe?: string): Site | null {
    const [hx, hy] = this.hubCenter();
    const penalty = (p: string) => (p === 'impure' ? 25 : p === 'pure' ? -15 : 0);
    const nodes = this.map.nodes
      .filter((n) => n.item === resource && !this.occ.has(tileKey(n.x, n.y)) && !this.ctx.isReserved(n.x, n.y) && !this.nearNest(n.x, n.y, 22))
      .sort((a, b) => Math.hypot(a.x - hx, a.y - hy) + penalty(a.purity) - Math.hypot(b.x - hx, b.y - hy) - penalty(b.purity));
    for (const n of nodes.slice(0, 25)) {
      let best: Site | null = null;
      for (const l of nodeLayouts(kind, n.x, n.y, recipe)) {
        const r = layoutFits(l, this.tileState, this.isNode, this.ringBlocked);
        if (r.ok && (!best || r.trees.length < best.trees.length)) best = { layout: l, trees: r.trees };
      }
      if (best) return best;
    }
    return null;
  }

  /** HUB çevresinde, halka halka genişleyen aramayla düğümsüz tesis yeri */
  findPlaceSite(make: (x: number, y: number) => Layout): Site | null {
    const [hx, hy] = this.hubCenter();
    let best = null as (Site & { score: number }) | null;
    for (let r = 5; r < 70; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const l = make(Math.round(hx + dx), Math.round(hy + dy));
        const f = layoutFits(l, this.tileState, this.isNode, this.ringBlocked);
        if (!f.ok) continue;
        const score = r + f.trees.length * 2;
        if (!best || score < best.score) best = { layout: l, trees: f.trees, score };
      }
      if (best && r > best.score) break;
    }
    return best;
  }

  /** Yerleşimi kurar: malzemeleri sağlar, ağaçları keser, parçaları yerleştirir, tarifleri seçer */
  async buildLayout(site: Site, label: string): Promise<BuildingState[]> {
    const l = site.layout;
    const rect = { x0: l.x0 - 1, y0: l.y0 - 1, x1: l.x1 + 1, y1: l.y1 + 1 };
    this.ctx.reserved.push(rect);
    try {
      const cost: Record<string, number> = {};
      for (const p of l.parts) for (const [k, v] of Object.entries(BUILDINGS[p.type].cost)) cost[k] = (cost[k] ?? 0) + v;
      this.status = `${label}: malzeme`;
      const missing = await this.obtainAll(cost);
      if (missing) throw new Error(`${label}: ${ITEMS[missing]?.name ?? missing} sağlanamadı`);
      for (const [x, y] of site.trees) {
        this.status = `${label}: ağaç kesiyor`;
        if (!(await this.cutTree(x, y))) throw new Error(`${label}: ağaç kesilemedi`);
      }
      this.status = `${label}: inşa`;
      const built: BuildingState[] = [];
      const outside = (x: number, y: number) => x < rect.x0 || x > rect.x1 || y < rect.y0 || y > rect.y1;
      for (const p of l.parts) {
        const def = BUILDINGS[p.type];
        const [w, h] = footprintSize(def.w, def.h, p.rot);
        const cx = p.x + w / 2, cy = p.y + h / 2;
        const ok = await this.walkGoal(
          (x, y) => outside(x, y) && Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= 11,
          cx, cy,
          () => outside(Math.floor(this.x), Math.floor(this.y)) && Math.hypot(this.x - cx, this.y - cy) <= 12,
        );
        if (!ok) throw new Error(`${label}: inşa yerine gidilemedi`);
        const existing = this.at(p.x, p.y);
        if (existing?.type === p.type) { built.push(existing); continue; }
        if (isBelt(p.type)) this.send({ t: 'buildBelts', type: p.type, path: [{ x: p.x, y: p.y, dir: p.rot }] });
        else this.send({ t: 'build', type: p.type, x: p.x, y: p.y, rot: p.rot });
        await this.flush();
        if (!(await this.until(() => this.at(p.x, p.y)?.type === p.type, 2500))) throw new Error(`${label}: ${def.name} kurulamadı (${this.lastToast})`);
        const b = this.at(p.x, p.y)!;
        this.mine.add(b.id);
        if (p.recipe) this.send({ t: 'setRecipe', id: b.id, recipe: p.recipe });
        built.push(b);
      }
      await this.flush();
      return built;
    } finally {
      const i = this.ctx.reserved.indexOf(rect);
      if (i >= 0) this.ctx.reserved.splice(i, 1);
    }
  }

  // ------------------------------------------------------------ elektrik

  /** Ana şebeke: en çok kapasiteli ağ */
  mainNet(): PowerNetInfo | undefined {
    return [...this.power].sort((a, b) => b.capacity - a.capacity || b.consumption - a.consumption)[0];
  }

  powerState() {
    const main = this.mainNet();
    let demand = 0, capacity = 0, burners = 0, coalGens = 0;
    const fuelLow: BuildingState[] = [];
    for (const b of this.buildings.values()) {
      const def = BUILDINGS[b.type];
      if (main === undefined || b.net !== main.id) continue;
      if (def.power) demand += def.power;
      if (b.type === 'biomass_burner') {
        burners++;
        const fuel = (b.inBuf.biomass ?? 0) + (b.inBuf.wood ?? 0) + (b.inBuf.leaves ?? 0);
        if (fuel > 0 || (b.fuel ?? 0) > 0) capacity += def.powerGen!;
        if ((b.inBuf.biomass ?? 0) < 60) fuelLow.push(b);
      } else if (b.type === 'coal_generator') {
        coalGens++;
        capacity += def.powerGen!;
      }
    }
    return { main, demand, capacity, burners, coalGens, fuelLow };
  }

  /** Bir direği ana şebekeye direk zinciriyle bağlar */
  async connectPole(pole: BuildingState): Promise<void> {
    await this.until(() => this.buildings.get(pole.id)?.net !== undefined, 2000);
    const main = this.mainNet();
    if (!main) return;
    const cur = this.buildings.get(pole.id);
    if (!cur || cur.net === main.id) return;
    const target = [...this.buildings.values()].filter((b) => b.type === 'power_pole' && b.net === main.id)
      .sort((a, b) => Math.hypot(a.x - pole.x, a.y - pole.y) - Math.hypot(b.x - pole.x, b.y - pole.y))[0];
    if (!target) return;
    const d = Math.hypot(target.x - pole.x, target.y - pole.y);
    const n = Math.ceil(d / 10) - 1;
    const spots: Array<[number, number]> = [];
    for (let i = 1; i <= n; i++) {
      const ix = Math.round(pole.x + ((target.x - pole.x) * i) / (n + 1));
      const iy = Math.round(pole.y + ((target.y - pole.y) * i) / (n + 1));
      let best: [number, number] | null = null;
      for (let r = 0; r <= 3 && !best; r++) {
        for (let dy = -r; dy <= r && !best; dy++) for (let dx = -r; dx <= r; dx++) {
          const x = ix + dx, y = iy + dy;
          if (this.tileState(x, y) !== 'free' || this.isNode(x, y)) continue;
          // Bant/makine çıkışlarının önünü kapatma
          if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([ax, ay]) => { const b = this.at(x + ax, y + ay); return !!b && b.type !== 'power_pole'; })) continue;
          best = [x, y];
          break;
        }
      }
      if (best) spots.push(best);
    }
    if (!spots.length) return;
    if (await this.obtainAll({ wire: 3 * spots.length, iron_rod: spots.length, concrete: spots.length })) return;
    this.status = 'elektrik hattı çekiyor';
    for (const [x, y] of spots) {
      if (!(await this.walkTo(x + 0.5, y + 0.5, 6))) continue;
      this.send({ t: 'build', type: 'power_pole', x, y, rot: 0 });
      await this.flush();
      await this.until(() => this.at(x, y)?.type === 'power_pole', 2000);
    }
  }

  /** Jeneratörü yakıtla doldurur */
  async refuel(gen: BuildingState, fuel: string, amount: number): Promise<boolean> {
    const cur = this.buildings.get(gen.id) ?? gen;
    const need = amount - (cur.inBuf[fuel] ?? 0);
    if (need <= 0) return true;
    if (!(await this.obtain(fuel, need))) return false;
    if (!(await this.goTo(cur))) return false;
    await this.putItem(cur, fuel, need);
    return true;
  }

  /** Elektrik işi varsa yapar: sigorta, yakıt, yeni jeneratör. `extra`: kurulacak tesisin tüketimi */
  async powerUpkeep(extra = 0): Promise<string | null> {
    const ps = this.powerState();
    if (ps.main?.tripped && ps.capacity >= ps.main.consumption) {
      const pole = [...this.buildings.values()].find((b) => b.type === 'power_pole' && b.net === ps.main!.id);
      if (pole) { this.send({ t: 'resetFuse', id: pole.id }); await this.flush(); await wait(300); return 'sigortayı sıfırladı'; }
    }
    // Kömür santrali çalışıyorsa biyokütle jeneratörlerini beslemeye gerek yok
    const coalRunning = [...this.buildings.values()].some((b) => b.type === 'coal_generator' && b.net === ps.main?.id && ((b.inBuf.coal ?? 0) > 0 || (b.fuel ?? 0) > 0));
    if (!coalRunning && ps.fuelLow.length && this.claim('yakit')) {
      try {
        const g = ps.fuelLow.sort((a, b) => (a.inBuf.biomass ?? 0) - (b.inBuf.biomass ?? 0))[0];
        if (await this.refuel(g, 'biomass', 200)) return 'biyokütle jeneratörüne yakıt koydu';
      } finally { this.release('yakit'); }
    }
    // Kömür jeneratörleri beslenmiyorsa (madenin elektriği yoksa) ilk kömürü elle koy
    if (ps.coalGens && !coalRunning) {
      const g = [...this.buildings.values()].find((b) => b.type === 'coal_generator' && (b.inBuf.coal ?? 0) < 1 && (b.fuel ?? 0) <= 0);
      if (g && this.claim('komur')) {
        try { if (await this.refuel(g, 'coal', 50)) return 'kömür jeneratörünü çalıştırdı'; } finally { this.release('komur'); }
      }
    }
    if (ps.main && ps.capacity > 0 && ps.demand + extra <= ps.capacity * 0.95) return null;
    if (!ps.main && extra === 0) return null;
    return this.addGenerator();
  }

  async addGenerator(): Promise<string | null> {
    const coalOpen = unlocked('coal_generator', this.techDone) && unlocked('splitter', this.techDone);
    const coalPlants = this.facilities().filter((f) => f.kind === 'coal').length;
    if (coalOpen && coalPlants < 4 && !this.wantBlocked('coal') && this.claim('build:coal')) {
      try {
        const site = this.findNodeSite('coal', 'coal');
        if (site) {
          const built = await this.buildLayout(site, 'kömür santrali');
          const pole = built.find((b) => b.type === 'power_pole');
          const gen = built.find((b) => b.type === 'coal_generator');
          if (pole) await this.connectPole(pole);
          if (gen) await this.refuel(gen, 'coal', 20);
          return 'kömür santrali kurdu';
        }
        this.blockWant('coal');
      } catch (e) {
        this.blockWant('coal');
        throw e;
      } finally { this.release('build:coal'); }
    }
    if (this.powerState().burners >= 8 || !this.claim('build:burner')) return null;
    try {
      const site = this.findPlaceSite((x, y) => placeLayout('burner', x, y));
      if (!site) return null;
      const built = await this.buildLayout(site, 'biyokütle jeneratörü');
      const pole = built.find((b) => b.type === 'power_pole');
      const gen = built.find((b) => b.type === 'biomass_burner');
      if (pole) await this.connectPole(pole);
      if (gen) await this.refuel(gen, 'biomass', 200);
      return 'biyokütle jeneratörü kurdu';
    } finally { this.release('build:burner'); }
  }

  private wantBlocked(key: string): boolean {
    return (this.ctx.failed.get(key) ?? 0) > Date.now();
  }

  private blockWant(key: string) {
    this.ctx.failed.set(key, Date.now() + 90_000);
  }

  // ------------------------------------------------------------ tesis kurma

  facilityPower(w: Want): number {
    if (w.kind === 'mine') return BUILDINGS.miner_mk1.power! + (w.recipe ? BUILDINGS[w.recipe === 'concrete' ? 'constructor' : 'smelter'].power! : 0);
    if (w.kind === 'cell') return BUILDINGS[w.machine!].power ?? 0;
    if (w.kind === 'oil') return BUILDINGS.oil_extractor.power! + 2 * BUILDINGS.refinery.power!;
    return 0;
  }

  wantLabel(w: Want): string {
    if (w.kind === 'mine') return `${ITEMS[w.resource!].name} madeni${w.recipe ? ` (${RECIPES[w.recipe].name})` : ''}`;
    if (w.kind === 'cell') return `${RECIPES[w.recipe!].name} hücresi`;
    if (w.kind === 'oil') return 'petrol rafinerisi';
    return 'genel depo';
  }

  async buildWant(w: Want): Promise<string> {
    const label = this.wantLabel(w);
    // Elektrik: önce kapasite
    const pw = this.facilityPower(w);
    if (pw) {
      const r = await this.powerUpkeep(pw);
      if (r) return r;
    }
    const site = w.kind === 'mine' ? this.findNodeSite('mine', w.resource!, w.recipe)
      : w.kind === 'oil' ? this.findNodeSite('oil', 'crude_oil')
      : w.kind === 'cell' ? this.findPlaceSite((x, y) => placeLayout('cell', x, y, w.machine, w.recipe))
      : this.findPlaceSite((x, y) => placeLayout('depot', x, y));
    if (!site) throw new Error(`${label}: uygun yer yok`);
    const built = await this.buildLayout(site, label);
    const pole = built.find((b) => b.type === 'power_pole');
    if (pole) await this.connectPole(pole);
    return `${label} kuruldu (${w.why})`;
  }

  // ------------------------------------------------------------ besleme ve teslimat

  /** Hücrelere girdi koyma işleri, en faydalıdan başlayarak */
  feedJobs(fac: Facility[], m: Mrp): Array<{ f: Facility; amounts: Record<string, number>; score: number }> {
    const stock = this.storageStock();
    for (const s of this.inv) if (s) stock[s.item] = (stock[s.item] ?? 0) + s.count;
    const jobs: Array<{ f: Facility; amounts: Record<string, number>; score: number }> = [];
    const cellsOf = (rid: string) => fac.filter((f) => f.kind === 'cell' && f.recipe === rid).length;
    for (const f of fac) {
      if (f.kind !== 'cell' || !f.machine?.recipe) continue;
      const rid = f.machine.recipe;
      const crafts = m.crafts[rid] ?? 0;
      if (crafts <= 0) continue;
      const r = RECIPES[rid];
      const amounts = feedAmounts(r, Math.ceil(crafts / Math.max(1, cellsOf(rid))), f.machine.inBuf);
      const avail: Record<string, number> = {};
      let score = 0;
      for (const [k, v] of Object.entries(amounts)) {
        // Hücrenin kendi çıkış deposundaki eşya geri beslenmez
        const own = f.storage?.storage?.reduce((s, it) => s + (it?.item === k ? it.count : 0), 0) ?? 0;
        const a = Math.min(v, (stock[k] ?? 0) - own);
        if (a >= Math.min(v, r.inputs[k] * 3)) { avail[k] = a; score += a / r.inputs[k]; }
      }
      const starving = Object.entries(r.inputs).some(([k, v]) => (f.machine!.inBuf[k] ?? 0) < v);
      if (Object.keys(avail).length) jobs.push({ f, amounts: avail, score: score * (starving ? 3 : 1) });
    }
    return jobs.sort((a, b) => b.score - a.score);
  }

  async feed(job: { f: Facility; amounts: Record<string, number> }): Promise<string> {
    const mach = job.f.machine!;
    const key = `feed:${mach.id}`;
    if (!this.claim(key)) return 'başka bot besliyor';
    try {
      const got: string[] = [];
      for (const [k, v] of Object.entries(job.amounts)) {
        if ((await this.fetch(k, v, job.f.storage?.id)) > 0) got.push(k);
      }
      if (!got.length) throw new Error(`${RECIPES[mach.recipe!].name} hücresi için girdi bulunamadı`);
      if (!(await this.goTo(mach))) throw new Error('hücreye gidilemedi');
      const parts: string[] = [];
      for (const k of got) {
        const n = Math.min(job.amounts[k], this.count(k));
        await this.putItem(mach, k, n);
        parts.push(`${n} ${ITEMS[k].name}`);
      }
      return `${RECIPES[mach.recipe!].name} hücresine ${parts.join(' + ')} koydu`;
    } finally { this.release(key); }
  }

  /** Teslim edilebilecek kademe eşyaları (envanter + depolar) */
  deliverable(): Array<[string, number]> {
    const rem = this.remaining();
    const stock = this.storageStock();
    const out: Array<[string, number]> = [];
    for (const [k, v] of Object.entries(rem)) {
      const n = Math.min(v, this.count(k) + (stock[k] ?? 0));
      if (n >= Math.min(v, 25)) out.push([k, n]);
    }
    return out;
  }

  async deliverRun(items: Array<[string, number]>): Promise<string> {
    if (!this.claim('teslim')) return 'başka bot teslim ediyor';
    try {
      for (const [k, n] of items) await this.fetch(k, n);
      const before = items.map(([k]) => this.count(k));
      await this.deliver();
      const parts = items.map(([k], i) => [before[i] - this.count(k), k] as const).filter(([n]) => n > 0).map(([n, k]) => `${n} ${ITEMS[k].name}`);
      if (!parts.length) throw new Error('teslim edilemedi');
      return `HUB'a teslim: ${parts.join(', ')}`;
    } finally { this.release('teslim'); }
  }

  // ------------------------------------------------------------ ilerleme

  /** Mevcut kademede kalan ihtiyaç */
  remaining(): Record<string, number> {
    const m = MILESTONES[this.techDone];
    if (!m) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(m.cost)) {
      const left = v - (this.techDelivered[k] ?? 0);
      if (left > 0) out[k] = left;
    }
    return out;
  }

  /** Bu adımda yapılabilecek işler, öncelik sırasıyla */
  candidates(): Candidate[] {
    const out: Candidate[] = [];
    const fac = this.facilities();
    const m = mrp(this.remaining(), this.planStock(fac), this.techDone);
    const wants = plan(this.techDone, m, fac).filter((w) => !this.wantBlocked(w.key));
    this.lastPlan = { wants, mrp: m };

    const deliver = this.deliverable();
    if (deliver.length && !this.ctx.busy.has('teslim')) {
      out.push({ id: 'teslimat', desc: `HUB'a teslimat: ${deliver.map(([k, n]) => `${n} ${ITEMS[k].name}`).join(', ')}`, run: () => this.deliverRun(deliver) });
    }

    for (const w of wants) {
      const key = `build:${w.key}`;
      if (this.ctx.busy.has(key)) continue;
      out.push({
        id: `kur:${w.key}`,
        desc: `Tesis kur: ${this.wantLabel(w)} (${w.have}/${w.count}, ihtiyaç: ${w.why})`,
        run: async () => {
          if (!this.claim(key)) return 'başka bot kuruyor';
          try { return await this.buildWant(w); }
          catch (e) { this.blockWant(w.key); throw e; }
          finally { this.release(key); }
        },
      });
      if (out.length >= 4) break;
    }

    for (const job of this.feedJobs(fac, m).slice(0, 3)) {
      if (this.ctx.busy.has(`feed:${job.f.machine!.id}`)) continue;
      out.push({ id: `besle:${job.f.machine!.recipe}`, desc: `Hücre besle: ${RECIPES[job.f.machine!.recipe!].name} ← ${Object.entries(job.amounts).map(([k, n]) => `${n} ${ITEMS[k].name}`).join(', ')}`, run: () => this.feed(job) });
    }

    const hw = this.handworkTarget(m, fac);
    if (hw) out.push({ id: `elle:${hw.item}`, desc: `Elle üret: ${hw.n} ${ITEMS[hw.item].name}`, run: () => this.handwork(hw.item, hw.n, hw.deliver) });
    return out;
  }

  /** Elle yapılacak en faydalı üretim: önce hücresi olmayan kademe eşyası, sonra hücresiz ara ürünler */
  handworkTarget(m: Mrp, fac: Facility[]): { item: string; n: number; deliver: boolean } | null {
    const rem = this.remaining();
    const hasProducer = (rid: string) => fac.some((f) => (f.kind === 'cell' || f.kind === 'mine') && f.recipe === rid);
    for (const k of Object.keys(rem).sort((a, b) => rem[a] - rem[b])) {
      const r = handRecipe(k, this.techDone);
      if (!r && !ORES.has(k)) continue;
      if (r && hasProducer(r.id) && this.techDone >= 2) continue;
      if (this.ctx.busy.has(`elle:${k}`)) continue;
      return { item: k, n: Math.min(rem[k], this.batchSize(k)), deliver: true };
    }
    for (const [rid, c] of Object.entries(m.crafts)) {
      const r = RECIPES[rid];
      if (!r.hand || hasProducer(rid)) continue;
      const item = Object.keys(r.outputs)[0];
      if (mineProcessOpen(item, this.techDone) || this.ctx.busy.has(`elle:${item}`)) continue;
      return { item, n: Math.min(c * r.outputs[item], this.batchSize(item)), deliver: false };
    }
    for (const [k, n] of Object.entries(m.leaves)) {
      if (!ORES.has(k) || MINE_RESOURCES.has(k) || fac.some((f) => f.kind === 'mine' && f.resource === k && !f.recipe)) continue;
      return { item: k, n: Math.min(n, 100), deliver: false };
    }
    return null;
  }

  async handwork(item: string, n: number, deliver: boolean): Promise<string> {
    const key = `elle:${item}`;
    if (!this.claim(key)) return 'başka bot üretiyor';
    try {
      const ok = await this.obtain(item, n);
      if (deliver && this.count(item) > 0) await this.deliver();
      else if (!deliver) await this.stash();
      if (!ok) throw new Error(`${ITEMS[item].name} üretilemedi (${this.status})`);
      return deliver ? `${n} ${ITEMS[item].name} elle üretip teslim etti` : `${n} ${ITEMS[item].name} elle üretip depoya koydu`;
    } finally { this.release(key); }
  }

  /** Bir adım: bakım, sonra en öncelikli iş (veya `choose` ile seçilen) */
  async think(choose?: (c: Candidate[]) => Promise<Candidate>): Promise<string> {
    this.protect.clear();
    await this.recoverCrate();
    if (this.techDone >= MILESTONES.length) return 'tüm kademeler tamamlandı';
    const pu = await this.powerUpkeep();
    if (pu) return pu;
    if (this.free() < 8) await this.stash();
    const c = this.candidates();
    if (!c.length) {
      this.status = 'bekliyor';
      await wait(3000);
      return '';
    }
    const pick = choose && c.length > 1 ? await choose(c) : c[0];
    this.status = pick.desc;
    return pick.run();
  }

  /** Hammaddesi envantere sığacak parti büyüklüğü */
  batchSize(item: string): number {
    if (isRaw(item)) return 100;
    const r = handRecipe(item, this.techDone);
    if (!r) return 20;
    const ratio = Object.values(r.inputs).reduce((s, v) => s + v, 0) / r.outputs[item];
    if (ratio >= 10) return 10;
    if (ratio >= 3) return 30;
    return 60;
  }

  /** Durum satırı */
  progressSummary(): string {
    const m = MILESTONES[this.techDone];
    if (!m) return 'tüm kademeler tamam';
    const total = Object.values(m.cost).reduce((s, v) => s + v, 0);
    const done = Object.entries(m.cost).reduce((s, [k, v]) => s + Math.min(v, this.techDelivered[k] ?? 0), 0);
    return `kademe ${this.techDone + 1}/${MILESTONES.length} ${m.name} %${Math.round((100 * done) / total)}`;
  }

  /** Jev'e verilecek oyun durumu */
  planState(): Record<string, unknown> {
    const fac = this.facilities();
    const count = (k: string) => fac.filter((f) => f.kind === k).length;
    const ps = this.powerState();
    return {
      kademe: { sira: this.techDone + 1, ad: MILESTONES[this.techDone]?.name, kalan: this.remaining() },
      tesisler: { maden: count('mine'), hucre: count('cell'), rafineri: count('oil'), santral: count('coal'), jenerator: count('gen'), depo: count('depot') },
      elektrik: { kapasite_mw: ps.capacity, tuketim_mw: ps.demand, sigorta_atti: !!ps.main?.tripped },
      eksik_tesisler: this.lastPlan?.wants.slice(0, 5).map((w) => `${this.wantLabel(w)} ${w.have}/${w.count}`) ?? [],
      depo_stogu: Object.fromEntries(Object.entries(this.storageStock()).sort((a, b) => b[1] - a[1]).slice(0, 12)),
    };
  }
}
