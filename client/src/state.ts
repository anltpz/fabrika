import {
  BELT_ITEM_SPACING,
  BUILDINGS,
  FOG_CELL,
  ITEMS,
  Terrain,
  fogIndex,
  DX,
  DY,
  ITEM_IDS,
  INVENTORY_SLOTS,
  footprint,
  footprintSize,
  generateMap,
  hasTree,
  isBelt,
  isUnlocked,
  makeInventory,
  terrainBuildable,
  tileKey,
  worldPorts,
} from '@fabrika/shared';
import type {
  BeltItem,
  Blueprint,
  FluidNetInfo,
  MapMarker,
  BuildingState,
  CraftJob,
  GameMap,
  Inventory,
  NestState,
  PlayerPublic,
  PowerNetInfo,
  ServerMsg,
  Snapshot,
  TechState,
} from '@fabrika/shared';

type Listener = (...args: any[]) => void;

export class Emitter {
  private listeners = new Map<string, Set<Listener>>();
  on(ev: string, fn: Listener): () => void {
    let s = this.listeners.get(ev);
    if (!s) { s = new Set(); this.listeners.set(ev, s); }
    s.add(fn);
    return () => s!.delete(fn);
  }
  emit(ev: string, ...args: any[]) {
    this.listeners.get(ev)?.forEach((fn) => fn(...args));
  }
}

export interface ClientPlayer extends PlayerPublic {
  tx: number;
  ty: number;
}

export interface ClientEnemy {
  id: number;
  x: number;
  y: number;
  tx: number;
  ty: number;
  hp: number;
  nest: number;
}

export interface ClientBelt {
  items: BeltItem[];
  at: number;
}

export class GameState extends Emitter {
  room = '';
  you = 0;
  token = '';
  map!: GameMap;
  buildings = new Map<number, BuildingState>();
  occ = new Map<number, number>();
  players = new Map<number, ClientPlayer>();
  enemies = new Map<number, ClientEnemy>();
  nests: NestState[] = [];
  belts = new Map<number, ClientBelt>();
  tech: TechState = { completed: 0, delivered: {} };
  inventory: Inventory = makeInventory(INVENTORY_SLOTS);
  craftQueue: CraftJob[] = [];
  power: PowerNetInfo[] = [];
  blueprints: Blueprint[] = [];
  markers: MapMarker[] = [];
  explored = new Uint8Array(0);
  fluids = new Map<number, FluidNetInfo>();
  lootOpened = new Set<number>();
  pings: Array<{ x: number; y: number; color: number; name: string; t0: number }> = [];
  stats: { produced: Record<string, number>; consumed: Record<string, number> } = { produced: {}, consumed: {} };
  lastAck = 0;

  load(snap: Snapshot) {
    this.room = snap.room;
    this.you = snap.you;
    this.token = snap.token;
    this.map = generateMap(snap.seed);
    for (const k of snap.removedTrees) this.removeTree(k);
    this.buildings.clear();
    this.occ.clear();
    for (const b of snap.buildings) this.upsert(b);
    this.players.clear();
    for (const p of snap.players) this.players.set(p.id, { ...p, tx: p.x, ty: p.y });
    this.enemies.clear();
    for (const e of snap.enemies) this.enemies.set(e.id, { ...e, tx: e.x, ty: e.y });
    this.nests = snap.nests;
    this.tech = snap.tech;
    this.inventory = snap.inventory;
    this.power = snap.power;
    this.blueprints = snap.blueprints ?? [];
    this.markers = snap.markers ?? [];
    const cols = Math.ceil(this.map.size / FOG_CELL);
    this.explored = new Uint8Array(cols * cols);
    for (const i of snap.explored ?? []) this.explored[i] = 1;
    this.lootOpened = new Set(snap.lootOpened ?? []);
    for (const k of snap.blasted ?? []) this.setGrass(k);
    this.emit('loaded');
  }

  private setGrass(k: number) {
    const x = k % 4096, y = Math.floor(k / 4096);
    if (x < this.map.size && y < this.map.size) this.map.terrain[y * this.map.size + x] = Terrain.Grass;
  }

  isExplored(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.map.size || y >= this.map.size) return false;
    return !!this.explored[fogIndex(x, y, this.map.size, FOG_CELL)];
  }

  lootAt(x: number, y: number) {
    return this.map.loot.find((l) => l.x === x && l.y === y && !this.lootOpened.has(l.id));
  }

  private removeTree(k: number) {
    const x = k % 4096, y = Math.floor(k / 4096);
    if (x < this.map.size && y < this.map.size) this.map.trees[y * this.map.size + x] = 0;
  }

  private upsert(b: BuildingState) {
    const old = this.buildings.get(b.id);
    if (old) {
      const moved = old.x !== b.x || old.y !== b.y || old.rot !== b.rot || old.type !== b.type;
      if (moved) this.clearOcc(old);
    }
    const items = old?.items;
    const nb = { ...b };
    if (isBelt(nb.type)) nb.items = items ?? [];
    this.buildings.set(b.id, nb);
    for (const [x, y] of footprint(b.type, b.x, b.y, b.rot)) this.occ.set(tileKey(x, y), b.id);
    if (isBelt(b.type) && !this.belts.has(b.id)) this.belts.set(b.id, { items: [], at: performance.now() });
  }

  private clearOcc(b: BuildingState) {
    for (const [x, y] of footprint(b.type, b.x, b.y, b.rot)) {
      if (this.occ.get(tileKey(x, y)) === b.id) this.occ.delete(tileKey(x, y));
    }
  }

  handle(msg: ServerMsg) {
    switch (msg.t) {
      case 'tick': {
        if (msg.ack !== undefined) this.lastAck = msg.ack;
        if (msg.players) {
          for (const [id, x, y, a, hp] of msg.players) {
            const p = this.players.get(id);
            if (!p) continue;
            p.tx = x; p.ty = y; p.hp = hp;
            if (id !== this.you) p.angle = a;
          }
          this.emit('players:tick');
        }
        if (msg.enemies) {
          const seen = new Set<number>();
          for (const [id, x, y, hp] of msg.enemies) {
            seen.add(id);
            const e = this.enemies.get(id);
            if (e) { e.tx = x; e.ty = y; e.hp = hp; } else this.enemies.set(id, { id, x, y, tx: x, ty: y, hp, nest: -1 });
          }
          for (const id of [...this.enemies.keys()]) if (!seen.has(id)) this.enemies.delete(id);
        }
        if (msg.belts) {
          const now = performance.now();
          for (const [ids, arr] of Object.entries(msg.belts)) {
            const id = Number(ids);
            const items: BeltItem[] = [];
            for (let i = 0; i < arr.length; i += 2) items.push({ item: ITEM_IDS[arr[i]], pos: arr[i + 1] / 1000 });
            this.belts.set(id, { items, at: now });
          }
        }
        break;
      }
      case 'buildings': {
        for (const id of msg.remove) {
          const b = this.buildings.get(id);
          if (b) { this.clearOcc(b); this.buildings.delete(id); this.belts.delete(id); }
        }
        for (const b of msg.upsert) this.upsert(b);
        this.emit('buildings', msg.upsert, msg.remove);
        break;
      }
      case 'players': {
        for (const p of msg.players) {
          const ex = this.players.get(p.id);
          if (ex) Object.assign(ex, { name: p.name, color: p.color, online: p.online, hp: p.hp });
          else this.players.set(p.id, { ...p, tx: p.x, ty: p.y });
        }
        this.emit('players');
        break;
      }
      case 'inv':
        this.inventory = msg.inventory;
        this.emit('inv');
        break;
      case 'craft':
        this.craftQueue = msg.queue;
        this.emit('craft');
        break;
      case 'tech':
        this.tech = msg.tech;
        this.emit('tech');
        break;
      case 'trees': {
        for (const k of msg.removed) this.removeTree(k);
        this.emit('trees', msg.removed);
        break;
      }
      case 'nests':
        this.nests = msg.nests;
        break;
      case 'power':
        this.power = msg.nets;
        this.emit('power');
        break;
      case 'fluids':
        this.fluids = new Map(msg.nets.map((n) => [n.id, n]));
        this.emit('fluids');
        break;
      case 'fog':
        for (const i of msg.cells) this.explored[i] = 1;
        this.emit('fog', msg.cells);
        break;
      case 'terrain':
        for (const k of msg.grass) this.setGrass(k);
        this.emit('trees', msg.grass);
        break;
      case 'loot':
        this.lootOpened = new Set(msg.opened);
        this.emit('loot');
        break;
      case 'markers':
        this.markers = msg.list;
        this.emit('markers');
        break;
      case 'mapPing':
        this.pings.push({ x: msg.x, y: msg.y, color: msg.color, name: msg.name, t0: performance.now() });
        this.pings = this.pings.filter((p) => performance.now() - p.t0 < 8000);
        this.emit('mapPing', msg);
        break;
      case 'blueprints':
        this.blueprints = msg.list;
        this.emit('blueprints');
        break;
      case 'stats':
        this.stats = { produced: msg.produced, consumed: msg.consumed };
        this.emit('stats');
        break;
      case 'chat':
        this.emit('chat', msg);
        break;
      case 'toast':
        this.emit('toast', msg.msg, msg.kind);
        break;
      case 'fx':
        this.emit('fx', msg);
        break;
      case 'pong':
        this.emit('pong', performance.now() - msg.time);
        break;
      case 'error':
        this.emit('error', msg.msg);
        break;
      default:
        break;
    }
  }

  me(): ClientPlayer | undefined {
    return this.players.get(this.you);
  }

  buildingAt(x: number, y: number): BuildingState | undefined {
    const id = this.occ.get(tileKey(x, y));
    return id === undefined ? undefined : this.buildings.get(id);
  }

  isBlockedForWalk = (tx: number, ty: number): boolean => {
    if (tx < 0 || ty < 0 || tx >= this.map.size || ty >= this.map.size) return true;
    if (!terrainBuildable(this.map, tx, ty)) return true;
    if (hasTree(this.map, tx, ty)) return true;
    const b = this.buildingAt(tx, ty);
    return !!b && !BUILDINGS[b.type].walkable;
  };

  /** Sunucudaki kontrolün istemci kopyası (önizleme rengi için) */
  canPlace(type: string, x: number, y: number, rot: number, allowBelt = false, skipRange = false): string | null {
    const def = BUILDINGS[type];
    if (!isUnlocked(def.unlock, this.tech.completed)) return 'Kilitli';
    let nodes = 0;
    for (const [tx, ty] of footprint(type, x, y, rot)) {
      if (def.waterRate) {
        if (tx < 0 || ty < 0 || tx >= this.map.size || ty >= this.map.size || this.map.terrain[ty * this.map.size + tx] !== Terrain.Water) return 'Suyun üzerine kurulmalı';
      } else if (!terrainBuildable(this.map, tx, ty)) return 'Bu zemine inşa edilemez';
      if (hasTree(this.map, tx, ty)) return 'Önce ağacı kes';
      const o = this.buildingAt(tx, ty);
      if (o && !(allowBelt && isBelt(o.type) && isBelt(type))) return 'Alan dolu';
      const node = this.map.nodeAt.get(tileKey(tx, ty));
      if (node) {
        if (ITEMS[node.item].fluid ? !def.pumpRate : !def.mineRate) return 'Kaynak düğümü';
        nodes++;
      }
      if (this.lootAt(tx, ty)) return 'Kargo';
    }
    if ((def.mineRate || def.pumpRate) && !nodes) return 'Bir kaynak düğümüne kurulmalı';
    const me = this.me();
    if (me && !skipRange) {
      const [w, h] = footprintSize(def.w, def.h, rot);
      if (Math.hypot(me.x - (x + w / 2), me.y - (y + h / 2)) > 16) return 'Çok uzak';
    }
    return null;
  }

  /**
   * Bandın köşe şekli: 0 = düz, 1 = yerel kuzey kenarından giriş, 3 = yerel güney kenarından giriş.
   * Arkadan besleyen bant yoksa ve tam olarak bir yandan besleyen bant varsa köşe kavisli çizilir.
   */
  beltCurve(b: BuildingState): 0 | 1 | 3 {
    const feeds = (s: number) => {
      const nx = b.x - DX[s], ny = b.y - DY[s];
      const n = this.buildingAt(nx, ny);
      if (!n) return false;
      if (isBelt(n.type)) return n.rot === s;
      return worldPorts(n.type, n.x, n.y, n.rot, 'outputs').some((p) => p.x === nx && p.y === ny && p.dir === s);
    };
    if (feeds(b.rot)) return 0;
    const left = feeds((b.rot + 1) % 4);
    const right = feeds((b.rot + 3) % 4);
    if (left && !right) return 1;
    if (right && !left) return 3;
    return 0;
  }

  /** Bant üzerindeki eşyaların görsel konumu (sunucu güncellemeleri arasında ilerletilir) */
  beltItemsAt(id: number, now: number): BeltItem[] {
    const b = this.belts.get(id);
    const bs = this.buildings.get(id);
    if (!b || !bs || !b.items.length) return [];
    const speed = BUILDINGS[bs.type].beltSpeed ?? 1;
    const adv = Math.min(0.15, (now - b.at) / 1000) * speed;
    const out: BeltItem[] = [];
    let limit = 1;
    for (const it of b.items) {
      const p = Math.min(it.pos + adv, limit);
      out.push({ item: it.item, pos: Math.max(it.pos, p) });
      limit = p - BELT_ITEM_SPACING;
    }
    return out;
  }
}

/** Boru bağlantı maskesi: bit d (0=D,1=G,2=B,3=K) o yöne bağlantı var */
export function pipeMask(state: GameState, b: BuildingState): number {
  let mask = 0;
  for (let d = 0; d < 4; d++) {
    const nx = b.x + DX[d], ny = b.y + DY[d];
    const n = state.buildingAt(nx, ny);
    if (!n) continue;
    const def = BUILDINGS[n.type];
    if (def.fluidAll) { mask |= 1 << d; continue; }
    for (const kind of ['fluidIn', 'fluidOut'] as const) {
      if (worldPorts(n.type, n.x, n.y, n.rot, kind).some((p) => p.x + DX[p.dir] === b.x && p.y + DY[p.dir] === b.y)) mask |= 1 << d;
    }
  }
  return mask;
}
