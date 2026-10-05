/**
 * Fabrika stres test botu (hem sunucu içinden /bot komutuyla hem de scripts/stres-bot.ts ile terminalden çalışır).
 *
 * Botlar kişisel hileleriyle her şeyi açar ve döngü halinde maden hatları, üretim hücreleri, plan kopyaları,
 * sıvı hatları ve tren hatları kurar; sökme/yeniden kurma, işaret, ping, kargo ve savaşla sunucuyu zorlar.
 */
import WebSocket from 'ws';
import {
  BUILDINGS,
  MILESTONES,
  TICK_RATE,
  Terrain,
  footprint,
  footprintSize,
  generateMap,
  tileKey,
} from '@fabrika/shared';
import type { BuildingState, ClientMsg, GameMap, ServerMsg, Slot } from '@fabrika/shared';

export type LogKind = 'info' | 'ok' | 'warn' | 'err';

export interface BotContext {
  url: string;
  log: (who: string, msg: string, kind: LogKind) => void;
  totals: { modulesOk: number; modulesFail: number; toasts: Map<string, number> };
  reserved: Array<{ x0: number; y0: number; x1: number; y1: number }>;
  isReserved: (x: number, y: number) => boolean;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface BotRunOptions {
  url: string;
  count: number;
  /** Dakika; 0 = durdurulana kadar */
  minutes: number;
  room?: string;
  botKey?: string;
  log: (who: string, msg: string, kind: LogKind) => void;
  onSummary?: (line: string, warn: boolean) => void;
}

/** Bir grup botu yönetir: bağlanır, kademeleri açar, modülleri döndürür, özet üretir */
export class BotRun {
  bots: Bot[] = [];
  room = '';
  stopped = false;
  readonly ctx: BotContext;
  private timer?: NodeJS.Timeout;
  private last = { ticks: 0, bytes: 0, at: Date.now() };
  readonly startedAt = Date.now();

  constructor(readonly opts: BotRunOptions) {
    const reserved: BotContext['reserved'] = [];
    this.ctx = {
      url: opts.url,
      log: opts.log,
      totals: { modulesOk: 0, modulesFail: 0, toasts: new Map() },
      reserved,
      isReserved: (x, y) => reserved.some((r) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1),
    };
  }

  /** Botları bağlar; oda kodunu döndürür */
  async connect(names: string[]): Promise<string> {
    let room = this.opts.room;
    for (const name of names) {
      const bot = new Bot(name, this.ctx);
      room = await bot.connect(room, this.opts.botKey);
      this.bots.push(bot);
      bot.log(`odaya katıldı: ${room} (oyun hızı ${bot.speed}x)`);
    }
    this.room = room ?? '';
    return this.room;
  }

  async run(): Promise<void> {
    const b0 = this.bots[0];
    if (!b0) return;
    for (let i = 0; i < MILESTONES.length; i++) b0.chat('/kademe');
    await b0.flush();
    if (!(await b0.until(() => b0.techDone >= MILESTONES.length, 4000))) {
      b0.log('kademeler açılamadı (bot hileleri devre dışı mı?)', 'err');
      return;
    }
    b0.log('tüm kademeler açıldı', 'ok');
    this.last = { ticks: b0.ticks, bytes: b0.bytes, at: Date.now() };
    this.timer = setInterval(() => this.report(), 5000);
    const deadline = this.opts.minutes > 0 ? Date.now() + this.opts.minutes * 60_000 : Infinity;
    await Promise.all(this.bots.map((b) => this.loop(b, deadline)));
    this.stop();
  }

  private async loop(bot: Bot, deadline: number) {
    const modules: Array<[string, () => Promise<string>]> = [
      ['maden hattı', () => bot.miningLine()],
      ['üretim hücresi', () => bot.productionCell()],
      ['plan stresi', () => bot.blueprintStress()],
      ['sıvı hattı', () => bot.fluidLine()],
      ['tren hattı', () => bot.trainLine()],
      ['etkileşim', () => bot.noise()],
      ['çalkalama', () => bot.churn()],
    ];
    let i = 0;
    while (!this.stopped && !bot.closed && Date.now() < deadline) {
      const [name, fn] = modules[i % modules.length];
      i++;
      const start = Date.now();
      try {
        const res = await Promise.race([fn(), wait(90000).then(() => { throw new Error('zaman aşımı'); })]);
        if (this.stopped) break;
        this.ctx.totals.modulesOk++;
        bot.log(`✔ ${name}: ${res} (${((Date.now() - start) / 1000).toFixed(1)} sn)`, 'ok');
      } catch (e) {
        if (this.stopped) break;
        this.ctx.totals.modulesFail++;
        bot.log(`✘ ${name}: ${(e as Error).message}`, 'err');
      }
    }
  }

  summary(): { line: string; warn: boolean } {
    const b = this.bots[0];
    const now = Date.now();
    const dt = Math.max(0.001, (now - this.last.at) / 1000);
    const tps = (b.ticks - this.last.ticks) / dt;
    const kbs = (b.bytes - this.last.bytes) / 1024 / dt;
    const expected = TICK_RATE * b.speed;
    const rtt = b.rtt.length ? Math.round(b.rtt.reduce((s, x) => s + x, 0) / b.rtt.length) : 0;
    const all = [...b.buildings.values()];
    const belts = all.filter((x) => x.type.startsWith('belt')).length;
    const warn = tps < expected * 0.85 || b.maxTickGap > (1000 / expected) * 6;
    const t = this.ctx.totals;
    const line = `📊 ${all.length} yapı (${belts} bant) · ${b.trains} tren · tick ${tps.toFixed(1)}/${expected}/sn · en uzun boşluk ${b.maxTickGap} ms · ${kbs.toFixed(1)} KB/sn · ping ${rtt} ms · modül ✔${t.modulesOk} ✘${t.modulesFail}`;
    b.maxTickGap = 0;
    this.last = { ticks: b.ticks, bytes: b.bytes, at: now };
    return { line, warn };
  }

  private report() {
    if (!this.bots.length) return;
    const { line, warn } = this.summary();
    this.opts.onSummary?.(line, warn);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.stopped = true;
    for (const b of this.bots) b.close();
  }
}

// ---------------------------------------------------------------- bot

interface Rect { x: number; y: number; w: number; h: number }

export class Bot {
  ws!: WebSocket;
  id = 0;
  map!: GameMap;
  room = '';
  speed = 1;
  buildings = new Map<number, BuildingState>();
  occ = new Map<number, number>();
  inv: Array<Slot | null> = [];
  x = 0;
  y = 0;
  techDone = 0;
  trains = 0;
  blueprints: Array<{ id: number; name: string; w: number; h: number }> = [];
  mine = new Set<number>();
  private queue: string[] = [];
  private pump?: NodeJS.Timeout;
  private pinger?: NodeJS.Timeout;
  closed = false;
  private waiters: Array<() => void> = [];
  // ölçümler
  bytes = 0;
  ticks = 0;
  lastTickAt = 0;
  maxTickGap = 0;
  rtt: number[] = [];
  sent = 0;
  lastToast = '';

  constructor(readonly name: string, readonly ctx: BotContext) {}

  log(msg: string, kind: LogKind = 'info') {
    this.ctx.log(this.name, msg, kind);
  }

  connect(room: string | undefined, botKey?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.ctx.url);
      this.ws.on('error', (e) => reject(e));
      this.ws.on('open', () => {
        this.ws.send(JSON.stringify(room ? { t: 'join', name: this.name, room, botKey } : { t: 'join', name: this.name, create: true, botKey }));
      });
      this.ws.on('message', (raw) => {
        const s = String(raw);
        this.bytes += s.length;
        const msg = JSON.parse(s) as ServerMsg;
        if (msg.t === 'error') { reject(new Error(msg.msg)); return; }
        if (msg.t === 'welcome') {
          this.id = msg.snap.you;
          this.room = msg.snap.room;
          this.speed = msg.snap.speed ?? 1;
          this.map = generateMap(msg.snap.seed);
          for (const b of msg.snap.buildings) this.upsert(b);
          for (const k of msg.snap.removedTrees) this.map.trees[Math.floor(k / 4096) * this.map.size + (k % 4096)] = 0;
          for (const k of msg.snap.blasted ?? []) this.map.terrain[Math.floor(k / 4096) * this.map.size + (k % 4096)] = Terrain.Grass;
          this.inv = msg.snap.inventory;
          this.techDone = msg.snap.tech.completed;
          this.startPump();
          resolve(this.room);
        }
        this.handle(msg);
        const ws = this.waiters;
        this.waiters = [];
        for (const w of ws) w();
      });
      this.ws.on('close', () => { if (!this.closed) this.log('bağlantı kapandı', 'err'); });
    });
  }

  private startPump() {
    // Sunucu bağlantı başına saniyede 120 mesajı kabul eder; 50/sn ile güvenli tarafta kal
    this.pump = setInterval(() => {
      const m = this.queue.shift();
      if (m && this.ws.readyState === WebSocket.OPEN) { this.ws.send(m); this.sent++; }
    }, 20);
    this.pinger = setInterval(() => this.send({ t: 'ping', time: Date.now() }), 2000);
  }

  send(m: ClientMsg) {
    this.queue.push(JSON.stringify(m));
  }

  async flush() {
    while (this.queue.length) await wait(20);
  }

  close() {
    this.closed = true;
    if (this.pump) clearInterval(this.pump);
    if (this.pinger) clearInterval(this.pinger);
    this.ws?.close();
  }

  private upsert(b: BuildingState) {
    const old = this.buildings.get(b.id);
    if (old) for (const [x, y] of footprint(old.type, old.x, old.y, old.rot)) this.occ.delete(tileKey(x, y));
    this.buildings.set(b.id, b);
    for (const [x, y] of footprint(b.type, b.x, b.y, b.rot)) this.occ.set(tileKey(x, y), b.id);
  }

  private handle(msg: ServerMsg) {
    switch (msg.t) {
      case 'tick': {
        const now = Date.now();
        if (this.lastTickAt) this.maxTickGap = Math.max(this.maxTickGap, now - this.lastTickAt);
        this.lastTickAt = now;
        this.ticks++;
        const me = msg.players?.find((p) => p[0] === this.id);
        if (me) { this.x = me[1]; this.y = me[2]; }
        break;
      }
      case 'buildings':
        for (const id of msg.remove) {
          const b = this.buildings.get(id);
          if (b) for (const [x, y] of footprint(b.type, b.x, b.y, b.rot)) if (this.occ.get(tileKey(x, y)) === id) this.occ.delete(tileKey(x, y));
          this.buildings.delete(id);
          this.mine.delete(id);
        }
        for (const b of msg.upsert) this.upsert(b);
        break;
      case 'inv': this.inv = msg.inventory; break;
      case 'tech': this.techDone = msg.tech.completed; break;
      case 'trains': this.trains = msg.list.length; break;
      case 'blueprints': this.blueprints = msg.list.map((b) => ({ id: b.id, name: b.name, w: b.w, h: b.h })); break;
      case 'trees': for (const k of msg.removed) this.map.trees[Math.floor(k / 4096) * this.map.size + (k % 4096)] = 0; break;
      case 'terrain': for (const k of msg.grass) this.map.terrain[Math.floor(k / 4096) * this.map.size + (k % 4096)] = Terrain.Grass; break;
      case 'pong': this.rtt.push(Date.now() - msg.time); if (this.rtt.length > 20) this.rtt.shift(); break;
      case 'toast':
        if (msg.kind !== 'good') {
          this.ctx.totals.toasts.set(msg.msg, (this.ctx.totals.toasts.get(msg.msg) ?? 0) + 1);
          this.lastToast = msg.msg;
          this.log(`⚠ ${msg.msg}`, 'warn');
        }
        break;
      default:
        break;
    }
  }

  /** Bir koşul sağlanana veya süre dolana kadar bekler */
  async until(pred: () => boolean, ms = 3000): Promise<boolean> {
    const end = Date.now() + ms;
    while (!pred()) {
      if (Date.now() > end) return false;
      await new Promise<void>((r) => { this.waiters.push(r); setTimeout(r, 100); });
    }
    return true;
  }

  at(x: number, y: number): BuildingState | undefined {
    const id = this.occ.get(tileKey(x, y));
    return id === undefined ? undefined : this.buildings.get(id);
  }

  count(item: string): number {
    return this.inv.reduce((s, it) => s + (it?.item === item ? it.count : 0), 0);
  }

  slotOf(item: string): number {
    return this.inv.findIndex((s) => s?.item === item);
  }

  chat(text: string) { this.send({ t: 'chat', text }); }

  async tp(x: number, y: number) {
    this.chat(`/tp ${x} ${y}`);
    await this.flush();
    await this.until(() => Math.hypot(this.x - x, this.y - y) < 1, 1500);
  }

  async give(item: string, n: number) {
    if (this.count(item) >= n) return;
    this.chat(`/ver ${item} ${n}`);
    await this.flush();
    await this.until(() => this.count(item) >= n, 2000);
  }

  /** Yapı kur ve sunucunun onaylamasını bekle */
  async build(type: string, x: number, y: number, rot = 0): Promise<BuildingState | undefined> {
    this.send({ t: 'build', type, x, y, rot });
    await this.flush();
    const ok = await this.until(() => this.at(x, y)?.type === type, 2500);
    const b = ok ? this.at(x, y) : undefined;
    if (b) this.mine.add(b.id);
    return b;
  }

  async path(type: string, pts: Array<{ x: number; y: number; dir: number }>) {
    this.send({ t: 'buildBelts', type, path: pts });
    await this.flush();
    const last = pts[pts.length - 1];
    await this.until(() => this.at(last.x, last.y)?.type === type, 2500);
    for (const p of pts) { const b = this.at(p.x, p.y); if (b) this.mine.add(b.id); }
  }

  async put(b: BuildingState | undefined, item: string, n: number) {
    if (!b) return;
    await this.give(item, n);
    const slot = this.slotOf(item);
    if (slot >= 0) this.send({ t: 'put', id: b.id, slot, count: n });
    await this.flush();
  }

  // ------------------------------------------------------------ alan bulma

  tileFree(x: number, y: number, allowNode = false): boolean {
    const m = this.map;
    if (x < 3 || y < 3 || x >= m.size - 3 || y >= m.size - 3) return false;
    const t = m.terrain[y * m.size + x];
    if (t === Terrain.Water) return false;
    if (!allowNode && m.nodeAt.has(tileKey(x, y))) return false;
    if (m.loot.some((l) => l.x === x && l.y === y)) return false;
    if (this.occ.has(tileKey(x, y)) || this.ctx.isReserved(x, y)) return false;
    return true;
  }

  rectFree(r: Rect, allowNodeAt?: [number, number]): boolean {
    for (let y = r.y - 1; y <= r.y + r.h; y++) for (let x = r.x - 1; x <= r.x + r.w; x++) {
      const node = allowNodeAt && x === allowNodeAt[0] && y === allowNodeAt[1];
      if (!this.tileFree(x, y, node)) return false;
    }
    return true;
  }

  /** Başlangıç çevresinde spiral arama ile boş alan */
  findSite(w: number, h: number): Rect | null {
    const { x: cx, y: cy } = this.map.spawn;
    for (let r = 6; r < 110; r += 3) {
      const steps = Math.max(8, Math.floor(r * 1.5));
      const off = Math.random() * Math.PI * 2;
      for (let i = 0; i < steps; i++) {
        const a = off + (i / steps) * Math.PI * 2;
        const rect = { x: Math.round(cx + Math.cos(a) * r - w / 2), y: Math.round(cy + Math.sin(a) * r - h / 2), w, h };
        if (this.rectFree(rect)) return rect;
      }
    }
    return null;
  }

  reserve(r: Rect) {
    this.ctx.reserved.push({ x0: r.x - 1, y0: r.y - 1, x1: r.x + r.w, y1: r.y + r.h });
  }

  /** Alandaki ağaçları ve kayaları temizler */
  async clear(r: Rect) {
    const m = this.map;
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
      const tree = m.trees[y * m.size + x] === 1;
      const rock = m.terrain[y * m.size + x] === Terrain.Rock;
      if (!tree && !rock) continue;
      if (rock) await this.give('explosive', 5);
      await this.tp(x + 0.5, y + 1.6);
      this.send({ t: 'harvest', x, y });
      await this.flush();
      await this.until(() => m.trees[y * m.size + x] === 0 && m.terrain[y * m.size + x] !== Terrain.Rock, 1500);
      await wait(Math.ceil(700 / this.speed));
    }
  }

  // ------------------------------------------------------------ modüller

  async miningLine(): Promise<string> {
    const recipes: Record<string, string | undefined> = { ore_iron: 'iron_ingot', ore_copper: 'copper_ingot', limestone: 'concrete', coal: undefined };
    const nodes = this.map.nodes
      .filter((n) => n.item in recipes && !this.occ.has(tileKey(n.x, n.y)))
      .sort((a, b) => Math.hypot(a.x - this.map.spawn.x, a.y - this.map.spawn.y) - Math.hypot(b.x - this.map.spawn.x, b.y - this.map.spawn.y));
    const node = nodes.find((n) => this.rectFree({ x: n.x, y: n.y, w: 9, h: 4 }, [n.x, n.y]));
    if (!node) throw new Error('uygun düğüm yok');
    const r = { x: node.x, y: node.y, w: 9, h: 4 };
    this.reserve(r);
    this.log(`⛏  maden hattı: ${node.item} @ ${node.x},${node.y}`);
    await this.clear(r);
    await this.tp(r.x + 4.5, r.y + 5.5);
    const x = node.x, y = node.y;
    if (!(await this.build('miner_mk2', x, y))) throw new Error(`maden kurulamadı (${this.lastToast})`);
    await this.path('belt_mk1', [{ x: x + 2, y, dir: 0 }, { x: x + 3, y, dir: 0 }]);
    const recipe = recipes[node.item];
    if (recipe) {
      const machine = recipe === 'concrete' ? 'constructor' : 'smelter';
      const m = await this.build(machine, x + 4, y);
      if (m) this.send({ t: 'setRecipe', id: m.id, recipe });
      await this.path('belt_mk1', [{ x: x + 6, y, dir: 0 }]);
    } else {
      await this.path('belt_mk1', [{ x: x + 4, y, dir: 0 }, { x: x + 5, y, dir: 0 }, { x: x + 6, y, dir: 0 }]);
    }
    await this.build('storage', x + 7, y);
    await this.build('power_pole', x + 3, y + 2);
    const gen = await this.build('biomass_burner', x, y + 2);
    await this.put(gen, 'biomass', 50);
    return `${node.item} hattı kuruldu`;
  }

  async productionCell(): Promise<string> {
    const r = this.findSite(12, 6);
    if (!r) throw new Error('alan yok');
    this.reserve(r);
    this.log(`🏭 üretim hücresi @ ${r.x},${r.y}`);
    await this.clear(r);
    await this.tp(r.x + 6, r.y + 7.5);
    const X = r.x, Y = r.y;
    const src = await this.build('storage', X, Y + 1);
    const sp = await this.build('smart_splitter', X + 2, Y + 1);
    if (sp) {
      this.send({ t: 'setFilter', id: sp.id, index: 0, filter: 'iron_ingot' });
      this.send({ t: 'setFilter', id: sp.id, index: 1, filter: 'rest' });
      this.send({ t: 'setFilter', id: sp.id, index: 2, filter: 'overflow' });
    }
    await this.path('belt_mk1', [{ x: X + 3, y: Y + 1, dir: 0 }]);
    const c = await this.build('constructor', X + 4, Y + 1);
    if (c) this.send({ t: 'setRecipe', id: c.id, recipe: 'iron_rod' });
    await this.path('belt_mk1', [{ x: X + 6, y: Y + 1, dir: 0 }]);
    await this.build('merger', X + 7, Y + 1);
    await this.path('belt_mk1', [{ x: X + 8, y: Y + 1, dir: 0 }]);
    await this.build('storage', X + 9, Y + 1);
    // Üst kol (kavisli)
    await this.path('belt_mk1', [2, 3, 4, 5, 6].map((i) => ({ x: X + i, y: Y, dir: 0 })).concat([{ x: X + 7, y: Y, dir: 1 }]));
    // Alt kol: alt geçit
    await this.path('belt_mk1', [{ x: X + 2, y: Y + 2, dir: 0 }]);
    await this.build('underground_in', X + 3, Y + 2);
    await this.build('underground_out', X + 6, Y + 2);
    await this.path('belt_mk1', [{ x: X + 7, y: Y + 2, dir: 3 }]);
    // Enerji
    await this.build('power_pole', X + 3, Y + 4);
    const gen = await this.build('biomass_burner', X, Y + 4);
    await this.put(gen, 'biomass', 50);
    await this.tp(X + 1, Y + 3.6);
    await this.put(src, 'iron_ingot', 100);
    await this.put(src, 'iron_plate', 100);
    // Plan olarak kaydet
    const name = `Hücre-${this.name}-${Date.now() % 10000}`;
    this.send({ t: 'bpSave', name, x0: X, y0: Y, x1: X + r.w - 1, y1: Y + r.h - 1 });
    await this.flush();
    await this.until(() => this.blueprints.some((b) => b.name === name), 2000);
    return 'akıllı ayırıcı, alt geçit, birleştirici ve kurucu ile hücre kuruldu, plan kaydedildi';
  }

  async blueprintStress(): Promise<string> {
    const bp = this.blueprints.filter((b) => b.name.startsWith(`Hücre-${this.name}`)).pop() ?? this.blueprints[this.blueprints.length - 1];
    if (!bp) throw new Error('plan yok');
    let placed = 0;
    for (let k = 0; k < 3; k++) {
      const rot = Math.floor(Math.random() * 4);
      const [w, h] = rot % 2 ? [bp.h, bp.w] : [bp.w, bp.h];
      const r = this.findSite(w, h);
      if (!r) break;
      this.reserve(r);
      await this.clear(r);
      await this.tp(r.x + w / 2, r.y + h + 1.5);
      const before = this.buildings.size;
      this.send({ t: 'bpPlace', id: bp.id, x: r.x, y: r.y, rot });
      await this.flush();
      if (await this.until(() => this.buildings.size > before + 3, 2500)) placed++;
      else this.log(`plan kurulamadı: ${this.lastToast}`, 'warn');
    }
    this.log(`📐 "${bp.name}" ${placed} kez yapıştırıldı`);
    if (!placed) throw new Error('hiç kopya kurulamadı');
    return `${placed} plan kopyası`;
  }

  async fluidLine(): Promise<string> {
    const S = this.map.size;
    const oil = this.map.nodes
      .filter((n) => n.item === 'crude_oil' && !this.occ.has(tileKey(n.x, n.y)))
      .sort((a, b) => Math.hypot(a.x - S / 2, a.y - S / 2) - Math.hypot(b.x - S / 2, b.y - S / 2))
      .find((n) => this.rectFree({ x: n.x - 2, y: n.y, w: 15, h: 6 }, [n.x, n.y]));
    if (!oil) {
      const why: Record<string, number> = {};
      for (const n of this.map.nodes.filter((q) => q.item === 'crude_oil')) {
        let reason = 'kullanımda';
        outer: for (let y = n.y - 1; y <= n.y + 6; y++) for (let x = n.x - 3; x <= n.x + 13; x++) {
          if (this.tileFree(x, y, x === n.x && y === n.y)) continue;
          const t = this.map.terrain[y * this.map.size + x];
          reason = t === Terrain.Water ? 'su' : this.map.nodeAt.has(tileKey(x, y)) ? 'başka düğüm' : this.occ.has(tileKey(x, y)) || this.ctx.isReserved(x, y) ? 'yapı/ayrılmış' : 'harita kenarı';
          break outer;
        }
        why[reason] = (why[reason] ?? 0) + 1;
      }
      throw new Error(`uygun petrol düğümü yok (${Object.entries(why).map(([k, v]) => `${v} ${k}`).join(', ')})`);
    }
    const r = { x: oil.x - 2, y: oil.y, w: 15, h: 6 };
    this.reserve(r);
    this.log(`🛢  petrol hattı @ ${oil.x},${oil.y}`);
    await this.clear(r);
    const x = oil.x, y = oil.y;
    await this.tp(x + 6, y + 7);
    if (!(await this.build('oil_extractor', x, y))) throw new Error(`petrol kuyusu kurulamadı (${this.lastToast})`);
    await this.path('pipe', [{ x: x + 2, y, dir: 0 }, { x: x + 3, y, dir: 0 }]);
    const ref = await this.build('refinery', x + 4, y);
    if (ref) this.send({ t: 'setRecipe', id: ref.id, recipe: 'fuel' });
    await this.path('pipe', [{ x: x + 7, y: y + 1, dir: 0 }, { x: x + 8, y: y + 1, dir: 0 }]);
    await this.build('fluid_tank', x + 7, y + 2);
    await this.build('fuel_generator', x + 9, y + 1);
    const gens: BuildingState[] = [];
    for (const i of [0, 2, 4]) { const g = await this.build('biomass_burner', x + i * 2 - 2, y + 4); if (g) gens.push(g); }
    const p1 = await this.build('power_pole', x + 4, y + 3);
    await this.build('power_pole', x + 12, y + 3);
    for (const g of gens) { await this.tp(g.x + 1, g.y + 2.5); await this.put(g, 'biomass', 30); }
    if (p1) this.send({ t: 'resetFuse', id: p1.id });
    // Su çıkarıcı: kıyıda 2x2 su
    const water = await this.waterSpot();
    let extra = '';
    if (water) {
      await this.tp(water[0] + 3, water[1] + 0.5);
      if (await this.build('water_extractor', water[0], water[1])) {
        await this.path('pipe', [2, 3, 4].map((i) => ({ x: water[0] + i, y: water[1], dir: 0 })));
        await this.build('fluid_tank', water[0] + 5, water[1]);
        extra = ', su çıkarıcı';
      }
    }
    return `petrol → rafineri → yakıt jeneratörü${extra}`;
  }

  private async waterSpot(): Promise<[number, number] | null> {
    const m = this.map;
    const { x: cx, y: cy } = m.spawn;
    for (let r = 10; r < 90; r += 2) {
      for (let a = 0; a < Math.PI * 2; a += 0.15) {
        const x = Math.round(cx + Math.cos(a) * r), y = Math.round(cy + Math.sin(a) * r);
        if (x < 4 || y < 4 || x > m.size - 12 || y > m.size - 4) continue;
        const water = [[0, 0], [1, 0], [0, 1], [1, 1]].every(([i, j]) => m.terrain[(y + j) * m.size + x + i] === Terrain.Water && !this.occ.has(tileKey(x + i, y + j)));
        if (!water) continue;
        let land = true;
        for (let i = 2; i <= 6; i++) for (let j = 0; j <= 1; j++) {
          const tx = x + i, ty = y + j;
          const t = m.terrain[ty * m.size + tx];
          if (t === Terrain.Water || t === Terrain.Rock || m.trees[ty * m.size + tx] || this.occ.has(tileKey(tx, ty)) || this.ctx.isReserved(tx, ty) || m.nodeAt.has(tileKey(tx, ty))) land = false;
        }
        if (land) { this.reserve({ x, y, w: 7, h: 2 }); return [x, y]; }
      }
    }
    return null;
  }

  async trainLine(): Promise<string> {
    const r = this.findSite(16, 8);
    if (!r) throw new Error('alan yok');
    this.reserve(r);
    this.log(`🚂 tren hattı @ ${r.x},${r.y}`);
    await this.clear(r);
    const X = r.x, Y = r.y;
    await this.tp(X + 8, Y + 4.5);
    const a = await this.build('train_station', X, Y);
    const pts: Array<{ x: number; y: number; dir: number }> = [];
    for (let x = X + 3; x <= X + 8; x++) pts.push({ x, y: Y, dir: 0 });
    for (let y = Y + 1; y <= Y + 6; y++) pts.push({ x: X + 8, y, dir: 1 });
    for (let x = X + 9; x <= X + 11; x++) pts.push({ x, y: Y + 6, dir: 0 });
    await this.path('rail', pts);
    const b = await this.build('train_station', X + 12, Y + 6);
    if (!a || !b) throw new Error(`istasyon kurulamadı (${this.lastToast})`);
    this.send({ t: 'stationMode', id: b.id, mode: 'unload' });
    await this.tp(X + 1.5, Y + 3);
    for (const it of ['iron_plate', 'screw', 'cable']) await this.put(a, it, 100);
    await this.tp(X + 6, Y + 3);
    const before = this.trains;
    this.send({ t: 'build', type: 'locomotive', x: X + 5, y: Y, rot: 0 });
    await this.flush();
    await this.until(() => this.trains > before, 2500);
    return 'iki istasyon, kavisli ray ve lokomotif';
  }

  async noise(): Promise<string> {
    const done: string[] = [];
    // İşaret ve ping
    this.send({ t: 'markerAdd', x: this.x + 3, y: this.y - 2, label: `${this.name} burada`, icon: '⭐' });
    this.send({ t: 'mapPing', x: this.x, y: this.y });
    this.chat(`${this.name}: bina sayısı ${this.buildings.size}`);
    done.push('işaret/ping/sohbet');
    // Elle üretim
    const hub = [...this.buildings.values()].find((b) => b.type === 'hub')!;
    await this.tp(hub.x + 2, hub.y + 5.5);
    await this.give('iron_ingot', 30);
    this.send({ t: 'craft', recipe: 'iron_plate', count: 5 });
    done.push('elle üretim');
    // En yakın kargo
    const loot = this.map.loot.map((l) => ({ l, d: Math.hypot(l.x - this.x, l.y - this.y) })).sort((a, b) => a.d - b.d)[Math.floor(Math.random() * 3)];
    if (loot) {
      await this.tp(loot.l.x + 0.5, loot.l.y + 1.6);
      this.send({ t: 'harvest', x: loot.l.x, y: loot.l.y });
      done.push('kargo');
    }
    // Yuvaya saldırı
    const nest = this.map.nests[Math.floor(Math.random() * this.map.nests.length)];
    if (nest) {
      await this.tp(nest.x + 1.8, nest.y + 0.5);
      for (let i = 0; i < 12; i++) {
        this.send({ t: 'attack', angle: Math.PI });
        await wait(Math.ceil(450 / this.speed));
      }
      done.push('yuva saldırısı');
    }
    await this.flush();
    return done.join(', ');
  }

  async churn(): Promise<string> {
    const own = [...this.mine].map((id) => this.buildings.get(id)).filter((b): b is BuildingState => !!b && b.type !== 'hub' && b.type !== 'rail' && b.type !== 'train_station');
    if (!own.length) throw new Error('sökülecek yapı yok');
    let n = 0;
    for (let k = 0; k < 5 && own.length; k++) {
      const b = own.splice(Math.floor(Math.random() * own.length), 1)[0];
      const { type, x, y, rot, recipe } = b;
      const [w, h] = footprintSize(BUILDINGS[type].w, BUILDINGS[type].h, rot);
      await this.tp(x + w / 2, y + h + 1.5);
      this.send({ t: 'dismantle', id: b.id });
      await this.flush();
      if (!(await this.until(() => !this.buildings.has(b.id), 2000))) continue;
      const nb = await this.build(type, x, y, rot);
      if (nb && recipe) this.send({ t: 'setRecipe', id: nb.id, recipe });
      if (nb) n++;
    }
    return `${n} yapı söküldü ve yeniden kuruldu`;
  }
}

