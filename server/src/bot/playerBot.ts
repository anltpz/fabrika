/**
 * Hilesiz oynayan bot: yürür, toplar, üretir, inşa eder ve HUB kademelerini sırayla açar.
 * Kaynak vermez, ışınlanmaz; sadece oyunun normal kurallarıyla oynar.
 */
import {
  BUILDINGS,
  CRAFT_RANGE,
  ITEMS,
  MILESTONES,
  RECIPES,
  Terrain,
  footprintSize,
  hasTree,
  tileKey,
} from '@fabrika/shared';
import type { BuildingState, InputState, ServerMsg } from '@fabrika/shared';
import { Bot } from './stressBot';
import { findPath, simplifyPath } from './nav';
import { ORES, handRecipe, isRaw } from './planner';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class PlayerBot extends Bot {
  override botMode = 'oyun' as const;
  private input: InputState = { up: false, down: false, left: false, right: false };
  private seq = 0;
  deaths = 0;
  /** Son ölüm yeri (sandığı geri almak için) */
  private deathAt: { x: number; y: number } | null = null;
  status = 'başlıyor';

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

  free(): number {
    return this.inv.filter((s) => !s).length;
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

  // ------------------------------------------------------------ hareket

  /** (tx,ty) noktasına `range` mesafeye kadar yürür */
  async walkTo(tx: number, ty: number, range = 1): Promise<boolean> {
    for (let attempt = 0; attempt < 4; attempt++) {
      if (this.closed) return false;
      if (Math.hypot(this.x - tx, this.y - ty) <= range) { this.stop(); return true; }
      const sx = Math.floor(this.x), sy = Math.floor(this.y);
      const raw = findPath(
        { size: this.map.size, blocked: this.blocked, extraCost: this.danger },
        sx, sy,
        (x, y) => Math.hypot(x + 0.5 - tx, y + 0.5 - ty) <= Math.max(0.6, range - 0.3),
        Math.floor(tx), Math.floor(ty),
      );
      if (!raw) { this.stop(); return false; }
      const path = simplifyPath(raw);
      const ok = await this.follow(path, tx, ty, range);
      if (ok) return true;
    }
    this.stop();
    return Math.hypot(this.x - tx, this.y - ty) <= range;
  }

  private async follow(path: Array<[number, number]>, tx: number, ty: number, range: number): Promise<boolean> {
    let i = 0;
    let lastProgress = Date.now();
    let lx = this.x, ly = this.y;
    const tol = 0.35 + 0.1 * this.speed;
    while (!this.closed) {
      if (Math.hypot(this.x - tx, this.y - ty) <= range) { this.stop(); return true; }
      if (i >= path.length) { this.stop(); return Math.hypot(this.x - tx, this.y - ty) <= range + 0.5; }
      const [wx, wy] = path[i];
      const dx = wx + 0.5 - this.x, dy = wy + 0.5 - this.y;
      if (Math.abs(dx) < tol && Math.abs(dy) < tol) { i++; continue; }
      const next: InputState = {
        right: dx > tol * 0.5,
        left: dx < -tol * 0.5,
        down: dy > tol * 0.5,
        up: dy < -tol * 0.5,
      };
      this.setInput(next, Math.atan2(dy, dx));
      await wait(15);
      if (Math.hypot(this.x - lx, this.y - ly) > 0.05) { lx = this.x; ly = this.y; lastProgress = Date.now(); }
      else if (Date.now() - lastProgress > 700) { this.stop(); return false; }
      if (this.hp < 40 && this.enemies.some((e) => Math.hypot(e.x - this.x, e.y - this.y) < 4)) { await this.fight(); lastProgress = Date.now(); }
    }
    return false;
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
      if (this.free() === 0 && !this.inv.some((s) => s?.item === item && s.count < (ITEMS[item]?.stack ?? 100))) { this.log('envanter dolu', 'warn'); return false; }
      const nodes = this.map.nodes
        .filter((q) => q.item === item && !this.occ.has(tileKey(q.x, q.y)) && !this.nearNest(q.x, q.y))
        .sort((a, b) => Math.hypot(a.x - this.x, a.y - this.y) - Math.hypot(b.x - this.x, b.y - this.y));
      const node = nodes[0];
      if (!node) { this.log(`${ITEMS[item].name} düğümü bulunamadı`, 'warn'); return false; }
      this.status = `${ITEMS[item].name} topluyor`;
      if (!(await this.walkTo(node.x + 0.5, node.y + 0.5, 3.5))) { this.log(`${ITEMS[item].name} düğümüne gidilemedi`, 'warn'); return false; }
      while (this.count(item) < n && !this.closed && Date.now() < deadline) {
        const before = this.count(item);
        this.sendNow({ t: 'harvest', x: node.x, y: node.y });
        await this.until(() => this.count(item) > before, Math.ceil(900 / this.speed) + 150);
        await wait(Math.ceil(620 / this.speed));
        if (this.count(item) === before && this.free() === 0) return false;
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
      if (!(await this.walkTo(t[0] + 0.5, t[1] + 0.5, 3.5))) { this.map.trees[t[1] * this.map.size + t[0]] = 0; continue; }
      this.sendNow({ t: 'harvest', x: t[0], y: t[1] });
      await this.until(() => !hasTree(this.map, t[0], t[1]), Math.ceil(900 / this.speed) + 200);
      await wait(Math.ceil(620 / this.speed));
    }
    return this.count(item) >= n;
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
        if (this.nearNest(x, y)) continue;
        const d = Math.hypot(dx, dy);
        if (d < bd) { bd = d; best = [x, y]; }
      }
      if (best) return best;
    }
    return null;
  }

  // ------------------------------------------------------------ üretim

  /** HUB'ın elle üretim menziline git */
  async goHub(): Promise<boolean> {
    const h = this.hub();
    const [w, hh] = footprintSize(BUILDINGS.hub.w, BUILDINGS.hub.h, h.rot);
    const cx = h.x + w / 2, cy = h.y + hh / 2;
    // HUB'ın yanına (ortaya değil) yürü: alt kenarın biraz altı
    if (Math.hypot(this.x - cx, this.y - cy) < CRAFT_RANGE + 1) return true;
    return this.walkTo(cx, h.y + hh + 1, 2.5);
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
    await this.until(() => this.count(outItem) >= target || (!this.craftQueue.length && this.count(outItem) > 0), secs * 1000 + 3000);
    await this.until(() => !this.craftQueue.length, 2000);
    return this.count(outItem) >= target - 1;
  }

  /**
   * Envanterde `item`'dan en az `n` adet olmasını sağlar: elle toplar, keser ve üretir.
   * Not: Aşama 2'de üretim hatlarının depolarından toplama eklenecek.
   */
  async obtain(item: string, n: number, depth = 0): Promise<boolean> {
    if (this.count(item) >= n) return true;
    if (depth > 8 || this.closed) return false;
    const need = n - this.count(item);
    if (ORES.has(item)) return this.gather(item, n);
    if (item === 'leaves' || item === 'wood') return this.chop(item, n);
    if (isRaw(item)) return false;
    const r = handRecipe(item, this.techDone);
    if (!r) { this.log(`${ITEMS[item]?.name ?? item} elle üretilemiyor`, 'warn'); return false; }
    const crafts = Math.ceil(need / r.outputs[item]);
    for (const [k, v] of Object.entries(r.inputs)) {
      if (!(await this.obtain(k, crafts * v, depth + 1))) return false;
    }
    return this.handCraft(r.id, crafts);
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
    if (await this.walkTo(crate.x + 0.5, crate.y + 0.5, 3)) {
      this.send({ t: 'take', id: crate.id, from: 'storage' });
      await this.flush();
      await wait(300);
    }
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

  /** Bir parti: kalan ihtiyaçtan bir eşya seç, envantere sığacak kadar üret, teslim et */
  async progressStep(): Promise<string> {
    await this.recoverCrate();
    const rem = this.remaining();
    const items = Object.keys(rem);
    if (!items.length) return 'tüm kademeler tamamlandı';
    // En az kalan iş: önce sayıca az olanlar
    items.sort((a, b) => rem[a] - rem[b]);
    const item = items[0];
    const batch = Math.min(rem[item], this.batchSize(item));
    const ok = await this.obtain(item, batch);
    if (this.count(item) > 0) await this.deliver();
    if (!ok) throw new Error(`${ITEMS[item].name} üretilemedi (${this.status})`);
    return `${batch} ${ITEMS[item].name} teslim edildi (kademe ${this.techDone + 1}: ${MILESTONES[this.techDone]?.name ?? 'bitti'})`;
  }

  /** Hammaddesi envantere sığacak parti büyüklüğü */
  batchSize(item: string): number {
    if (isRaw(item)) return 100;
    const r = handRecipe(item, this.techDone);
    if (!r) return 20;
    // Kabaca: çıktı başına girdi oranı yüksekse küçük parti
    const ratio = Object.values(r.inputs).reduce((s, v) => s + v, 0) / r.outputs[item];
    if (ratio >= 10) return 10;
    if (ratio >= 3) return 30;
    return 60;
  }

  /** Oyuncu bot döngüsü için oyun durumu özeti (Aşama 4'te Jev'e verilecek) */
  progressSummary(): string {
    const m = MILESTONES[this.techDone];
    if (!m) return 'tüm kademeler tamam';
    const total = Object.values(m.cost).reduce((s, v) => s + v, 0);
    const done = Object.entries(m.cost).reduce((s, [k, v]) => s + Math.min(v, this.techDelivered[k] ?? 0), 0);
    return `kademe ${this.techDone + 1}/${MILESTONES.length} ${m.name} %${Math.round((100 * done) / total)}`;
  }
}

