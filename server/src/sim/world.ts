import {
  BELT_ITEM_SPACING,
  BUILDINGS,
  BUILD_RANGE,
  CRAFT_RANGE,
  DT,
  DX,
  DY,
  ENEMY_AGGRO_RANGE,
  ENEMY_ATTACK_COOLDOWN,
  ENEMY_ATTACK_RANGE,
  ENEMY_DAMAGE,
  ENEMY_HP,
  ENEMY_LEASH_RANGE,
  ENEMY_SPEED,
  HARVEST_COOLDOWN,
  INTERACT_RANGE,
  INVENTORY_SLOTS,
  ITEMS,
  ITEM_INDEX,
  MAX_PLAYERS,
  MILESTONES,
  NEST_HP,
  NEST_MAX_ENEMIES,
  NEST_SPAWN_INTERVAL,
  PLAYER_ATTACK_COOLDOWN,
  PLAYER_ATTACK_DAMAGE,
  PLAYER_ATTACK_RANGE,
  PLAYER_COLORS,
  PLAYER_MAX_HP,
  PLAYER_RADIUS,
  PLAYER_REGEN,
  PLAYER_REGEN_DELAY,
  PLAYER_SPEED,
  PURITY_MULT,
  PURITY_NAMES,
  RECIPES,
  STORAGE_SLOTS,
  addItem,
  countItem,
  footprint,
  footprintSize,
  generateMap,
  handCraftTime,
  hasItems,
  hasTree,
  inputVelocity,
  isBelt,
  isUnlocked,
  itemName,
  makeInventory,
  milestoneUnlocks,
  moveCircle,
  opposite,
  removeItem,
  removeItems,
  terrainBuildable,
  tileKey,
  worldPorts,
} from '@fabrika/shared';
import type {
  BuildingState,
  CraftJob,
  Dir,
  EnemyState,
  GameMap,
  InputState,
  Inventory,
  NestState,
  PlayerPublic,
  PowerNetInfo,
  ServerMsg,
  Slot,
  TechState,
} from '@fabrika/shared';
import { computeNetworks, PowerNetwork } from './power';

export interface PlayerData {
  id: number;
  token: string;
  name: string;
  color: number;
  x: number;
  y: number;
  angle: number;
  hp: number;
  inventory: Inventory;
  input: InputState;
  inputSeq: number;
  online: boolean;
  lastDamage: number;
  attackCd: number;
  harvestCd: number;
  craftQueue: CraftJob[];
  dirtyInv: boolean;
  dirtyCraft: boolean;
}

interface Enemy {
  id: number;
  x: number;
  y: number;
  hp: number;
  nest: number;
  attackCd: number;
  wx: number;
  wy: number;
  wanderT: number;
}

interface Nest extends NestState {
  spawnT: number;
}

export interface SaveData {
  version: 1;
  seed: number;
  nextId: number;
  time: number;
  buildings: BuildingState[];
  players: Array<{ token: string; id: number; name: string; color: number; x: number; y: number; hp: number; inventory: Inventory }>;
  nests: Array<{ id: number; hp: number; alive: boolean }>;
  removedTrees: number[];
  tech: TechState;
}

const MACHINE_OUT_CAP = 50;
const GEN_FUEL_CAP = 50;
const QUEUE_CAP = 2;
const MANUAL_IN_CAP = 500;

function inCap(need: number): number {
  return Math.max(need * 3, 10);
}

function sumBuf(buf: Record<string, number>): number {
  let s = 0;
  for (const v of Object.values(buf)) s += v;
  return s;
}

export class World {
  map: GameMap;
  seed: number;
  time = 0;
  tickCount = 0;
  nextId = 1;
  buildings = new Map<number, BuildingState>();
  occ = new Map<number, number>();
  players = new Map<number, PlayerData>();
  enemies = new Map<number, Enemy>();
  nests: Nest[] = [];
  removedTrees = new Set<number>();
  tech: TechState = { completed: 0, delivered: {} };
  cheats = false;

  /** Güç ağları önbelleği */
  private powerDirty = true;
  private nets: PowerNetwork[] = [];
  private netOf = new Map<number, number>();
  netInfo: PowerNetInfo[] = [];
  private powered = new Set<number>();

  /** Gönderilecek değişiklikler */
  private changed = new Set<number>();
  private removedIds: number[] = [];
  private lastSent = new Map<number, string>();
  private beltsWithItems = new Set<number>();
  private treesRemovedPending: number[] = [];
  private nestsDirty = false;

  /** Odaya yayınlanacak ve tek oyuncuya gidecek mesajlar */
  out: ServerMsg[] = [];
  direct: Array<{ to: number; msg: ServerMsg }> = [];

  constructor(seed: number) {
    this.seed = seed;
    this.map = generateMap(seed);
    this.nests = this.map.nests.map((n) => ({ id: n.id, x: n.x, y: n.y, hp: NEST_HP, alive: true, spawnT: 0 }));
    const s = this.map.spawn;
    this.addBuilding('hub', s.x - 2, s.y - 2, 0);
  }

  static fromSave(data: SaveData): World {
    const w = new World(data.seed);
    w.buildings.clear();
    w.occ.clear();
    w.nextId = data.nextId;
    w.time = data.time ?? 0;
    for (const b of data.buildings) w.insertBuilding(b);
    for (const p of data.players) {
      w.players.set(p.id, {
        ...p,
        inventory: p.inventory.length === INVENTORY_SLOTS ? p.inventory : [...p.inventory, ...makeInventory(INVENTORY_SLOTS)].slice(0, INVENTORY_SLOTS),
        angle: 0,
        input: { up: false, down: false, left: false, right: false },
        inputSeq: 0,
        online: false,
        lastDamage: -100,
        attackCd: 0,
        harvestCd: 0,
        craftQueue: [],
        dirtyInv: false,
        dirtyCraft: false,
      });
    }
    for (const n of data.nests) {
      const nest = w.nests.find((x) => x.id === n.id);
      if (nest) { nest.hp = n.hp; nest.alive = n.alive; }
    }
    for (const k of data.removedTrees) {
      w.removedTrees.add(k);
      const x = k % 4096, y = Math.floor(k / 4096);
      if (x < w.map.size && y < w.map.size) w.map.trees[y * w.map.size + x] = 0;
    }
    w.tech = data.tech;
    w.changed.clear();
    return w;
  }

  serialize(): SaveData {
    return {
      version: 1,
      seed: this.seed,
      nextId: this.nextId,
      time: this.time,
      buildings: [...this.buildings.values()],
      players: [...this.players.values()].map((p) => ({ token: p.token, id: p.id, name: p.name, color: p.color, x: p.x, y: p.y, hp: p.hp, inventory: p.inventory })),
      nests: this.nests.map((n) => ({ id: n.id, hp: n.hp, alive: n.alive })),
      removedTrees: [...this.removedTrees],
      tech: this.tech,
    };
  }

  // ---------------------------------------------------------------- yardımcılar

  private broadcast(msg: ServerMsg) {
    this.out.push(msg);
  }

  private send(to: number, msg: ServerMsg) {
    this.direct.push({ to, msg });
  }

  private toast(to: number, msg: string, kind: 'info' | 'warn' | 'good' = 'warn') {
    this.send(to, { t: 'toast', msg, kind });
  }

  private sysChat(text: string) {
    this.broadcast({ t: 'chat', from: 'Sistem', color: 0xffd060, text, sys: true });
  }

  buildingAt(x: number, y: number): BuildingState | undefined {
    const id = this.occ.get(tileKey(x, y));
    return id === undefined ? undefined : this.buildings.get(id);
  }

  hub(): BuildingState {
    for (const b of this.buildings.values()) if (b.type === 'hub') return b;
    throw new Error('HUB yok');
  }

  spawnPoint(): { x: number; y: number } {
    const h = this.hub();
    return { x: h.x + 2, y: h.y + 5.5 };
  }

  /** Oyuncunun binanın en yakın noktasına uzaklığı */
  private distToBuilding(p: { x: number; y: number }, b: BuildingState): number {
    const def = BUILDINGS[b.type];
    const [w, h] = footprintSize(def.w, def.h, b.rot);
    const cx = Math.max(b.x, Math.min(p.x, b.x + w));
    const cy = Math.max(b.y, Math.min(p.y, b.y + h));
    return Math.hypot(p.x - cx, p.y - cy);
  }

  isBlockedForWalk = (tx: number, ty: number): boolean => {
    if (tx < 0 || ty < 0 || tx >= this.map.size || ty >= this.map.size) return true;
    if (!terrainBuildable(this.map, tx, ty)) return true;
    if (hasTree(this.map, tx, ty)) return true;
    const b = this.buildingAt(tx, ty);
    if (b && !BUILDINGS[b.type].walkable) return true;
    return false;
  };

  private markChanged(id: number) {
    this.changed.add(id);
  }

  private newBuildingState(type: string, x: number, y: number, rot: number): BuildingState {
    const def = BUILDINGS[type];
    const b: BuildingState = { id: this.nextId++, type, x, y, rot: rot & 3, inBuf: {}, outBuf: {}, progress: 0, status: 'idle' };
    if (type === 'storage') b.storage = makeInventory(STORAGE_SLOTS);
    if (isBelt(type) || type === 'splitter' || type === 'merger') b.items = [];
    if (def.powerGen) b.fuel = 0;
    if (type === 'splitter') b.rr = 0;
    return b;
  }

  private insertBuilding(b: BuildingState) {
    this.buildings.set(b.id, b);
    for (const [x, y] of footprint(b.type, b.x, b.y, b.rot)) this.occ.set(tileKey(x, y), b.id);
    const def = BUILDINGS[b.type];
    if (def.power || def.powerGen || b.type === 'power_pole') this.powerDirty = true;
    this.markChanged(b.id);
  }

  addBuilding(type: string, x: number, y: number, rot: number): BuildingState {
    const b = this.newBuildingState(type, x, y, rot);
    this.insertBuilding(b);
    return b;
  }

  private deleteBuilding(b: BuildingState) {
    this.buildings.delete(b.id);
    for (const [x, y] of footprint(b.type, b.x, b.y, b.rot)) {
      if (this.occ.get(tileKey(x, y)) === b.id) this.occ.delete(tileKey(x, y));
    }
    const def = BUILDINGS[b.type];
    if (def.power || def.powerGen || b.type === 'power_pole') this.powerDirty = true;
    this.changed.delete(b.id);
    this.lastSent.delete(b.id);
    this.beltsWithItems.delete(b.id);
    this.removedIds.push(b.id);
  }

  /** Yerleştirme kontrolü. Hata metni ya da null döner. */
  canPlace(type: string, x: number, y: number, rot: number, player?: PlayerData, allowReplaceBelt = false): string | null {
    const def = BUILDINGS[type];
    if (!def || !def.buildable) return 'Bu yapı inşa edilemez';
    if (!isUnlocked(def.unlock, this.tech.completed)) return 'Bu yapı henüz açılmadı';
    const tiles = footprint(type, x, y, rot);
    let nodeCount = 0;
    for (const [tx, ty] of tiles) {
      if (!terrainBuildable(this.map, tx, ty)) return 'Bu zemine inşa edilemez';
      if (hasTree(this.map, tx, ty)) return 'Önce ağacı kes';
      const other = this.buildingAt(tx, ty);
      if (other && !(allowReplaceBelt && isBelt(other.type) && isBelt(type))) return 'Alan dolu';
      if (this.map.nodeAt.has(tileKey(tx, ty))) {
        if (!def.mineRate) return 'Kaynak düğümüne sadece maden çıkarıcı kurulabilir';
        nodeCount++;
      }
    }
    if (def.mineRate && nodeCount === 0) return 'Maden çıkarıcı bir kaynak düğümünün üzerine kurulmalı';
    if (player) {
      const [w, h] = footprintSize(def.w, def.h, rot);
      if (Math.hypot(player.x - (x + w / 2), player.y - (y + h / 2)) > BUILD_RANGE) return 'Çok uzak';
    }
    if (!def.walkable) {
      const [w, h] = footprintSize(def.w, def.h, rot);
      for (const p of this.players.values()) {
        if (!p.online) continue;
        if (p.x + PLAYER_RADIUS > x && p.x - PLAYER_RADIUS < x + w && p.y + PLAYER_RADIUS > y && p.y - PLAYER_RADIUS < y + h) return 'Bir oyuncu yolda';
      }
    }
    return null;
  }

  private findMinerNode(b: BuildingState) {
    for (const [x, y] of footprint(b.type, b.x, b.y, b.rot)) {
      const n = this.map.nodeAt.get(tileKey(x, y));
      if (n) return n;
    }
    return undefined;
  }

  private giveOrDrop(p: PlayerData, items: Array<[string, number]>) {
    const drop: Slot[] = [];
    for (const [item, n] of items) {
      if (n <= 0) continue;
      const left = addItem(p.inventory, item, n);
      if (left > 0) drop.push({ item, count: left });
    }
    p.dirtyInv = true;
    if (drop.length) {
      this.dropCrate(p.x, p.y, drop);
      this.toast(p.id, 'Envanter dolu, fazlası sandığa bırakıldı');
    }
  }

  private dropCrate(fx: number, fy: number, items: Slot[]) {
    const cx = Math.floor(fx), cy = Math.floor(fy);
    for (let r = 0; r < 12; r++) {
      for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
        const x = cx + i, y = cy + j;
        if (!terrainBuildable(this.map, x, y) || hasTree(this.map, x, y) || this.buildingAt(x, y) || this.map.nodeAt.has(tileKey(x, y))) continue;
        const b = this.newBuildingState('crate', x, y, 0);
        b.storage = items.map((s) => ({ ...s }));
        this.insertBuilding(b);
        return;
      }
    }
  }

  // ---------------------------------------------------------------- oyuncular

  join(name: string, token: string | undefined): PlayerData | string {
    if (token) {
      for (const p of this.players.values()) {
        if (p.token === token) {
          if (p.online) return 'Bu karakter zaten oyunda';
          if (this.onlineCount() >= MAX_PLAYERS) return 'Oda dolu (en fazla 4 oyuncu)';
          p.online = true;
          p.name = name || p.name;
          p.input = { up: false, down: false, left: false, right: false };
          return p;
        }
      }
    }
    if (this.onlineCount() >= MAX_PLAYERS) return 'Oda dolu (en fazla 4 oyuncu)';
    const id = this.nextId++;
    const used = new Set([...this.players.values()].filter((p) => p.online).map((p) => p.color));
    const color = PLAYER_COLORS.find((c) => !used.has(c)) ?? PLAYER_COLORS[this.players.size % PLAYER_COLORS.length];
    const sp = this.spawnPoint();
    const p: PlayerData = {
      id,
      token: token || cryptoToken(),
      name,
      color,
      x: sp.x + (this.players.size % 4) - 1.5,
      y: sp.y,
      angle: 0,
      hp: PLAYER_MAX_HP,
      inventory: makeInventory(INVENTORY_SLOTS),
      input: { up: false, down: false, left: false, right: false },
      inputSeq: 0,
      online: true,
      lastDamage: -100,
      attackCd: 0,
      harvestCd: 0,
      craftQueue: [],
      dirtyInv: false,
      dirtyCraft: false,
    };
    this.players.set(id, p);
    return p;
  }

  leave(id: number) {
    const p = this.players.get(id);
    if (!p) return;
    p.online = false;
    p.craftQueue = [];
  }

  onlineCount(): number {
    let c = 0;
    for (const p of this.players.values()) if (p.online) c++;
    return c;
  }

  playersPublic(): PlayerPublic[] {
    return [...this.players.values()].map((p) => ({ id: p.id, name: p.name, color: p.color, x: p.x, y: p.y, angle: p.angle, hp: p.hp, online: p.online }));
  }

  enemiesState(): EnemyState[] {
    return [...this.enemies.values()].map((e) => ({ id: e.id, x: e.x, y: e.y, hp: e.hp, nest: e.nest }));
  }

  nestsState(): NestState[] {
    return this.nests.map(({ id, x, y, hp, alive }) => ({ id, x, y, hp, alive }));
  }

  // ---------------------------------------------------------------- komutlar

  setInput(id: number, input: InputState, angle: number, seq: number) {
    const p = this.players.get(id);
    if (!p) return;
    p.input = { up: !!input.up, down: !!input.down, left: !!input.left, right: !!input.right };
    if (Number.isFinite(angle)) p.angle = angle;
    p.inputSeq = seq;
  }

  build(id: number, type: string, x: number, y: number, rot: number): boolean {
    const p = this.players.get(id);
    if (!p) return false;
    const def = BUILDINGS[type];
    if (!def) return false;
    const err = this.canPlace(type, x, y, rot, p);
    if (err) { this.toast(id, err); return false; }
    if (!hasItems(p.inventory, def.cost) && !this.cheats) { this.toast(id, 'Yeterli malzeme yok'); return false; }
    if (!this.cheats) removeItems(p.inventory, def.cost);
    p.dirtyInv = true;
    const b = this.addBuilding(type, x, y, rot);
    this.broadcast({ t: 'fx', kind: 'build', x: b.x, y: b.y, by: id });
    return true;
  }

  buildBelts(id: number, type: string, path: Array<{ x: number; y: number; dir: number }>) {
    const p = this.players.get(id);
    if (!p || !isBelt(type) || !Array.isArray(path)) return;
    const def = BUILDINGS[type];
    let placed = 0;
    for (const step of path.slice(0, 200)) {
      const x = step.x | 0, y = step.y | 0, dir = (step.dir | 0) & 3;
      const existing = this.buildingAt(x, y);
      if (existing && isBelt(existing.type)) {
        if (existing.type === type) {
          if (existing.rot !== dir) { existing.rot = dir; this.markChanged(existing.id); }
          continue;
        }
        // Yükseltme
        if (!this.cheats && !hasItems(p.inventory, def.cost)) { this.toast(id, 'Yeterli malzeme yok'); break; }
        if (!isUnlocked(def.unlock, this.tech.completed)) { this.toast(id, 'Bu yapı henüz açılmadı'); break; }
        if (!this.cheats) removeItems(p.inventory, def.cost);
        this.giveOrDrop(p, Object.entries(BUILDINGS[existing.type].cost));
        existing.type = type;
        existing.rot = dir;
        this.markChanged(existing.id);
        p.dirtyInv = true;
        continue;
      }
      const err = this.canPlace(type, x, y, dir, p);
      if (err) { this.toast(id, err); continue; }
      if (!this.cheats && !hasItems(p.inventory, def.cost)) { this.toast(id, 'Yeterli malzeme yok'); break; }
      if (!this.cheats) removeItems(p.inventory, def.cost);
      p.dirtyInv = true;
      this.addBuilding(type, x, y, dir);
      placed++;
    }
    if (placed) this.broadcast({ t: 'fx', kind: 'build', x: path[0].x, y: path[0].y, by: id });
  }

  dismantle(id: number, bid: number) {
    const p = this.players.get(id);
    const b = this.buildings.get(bid);
    if (!p || !b) return;
    if (b.type === 'hub') { this.toast(id, 'HUB sökülemez'); return; }
    if (this.distToBuilding(p, b) > BUILD_RANGE) { this.toast(id, 'Çok uzak'); return; }
    const items: Array<[string, number]> = [];
    for (const [k, v] of Object.entries(BUILDINGS[b.type].cost)) items.push([k, v]);
    for (const [k, v] of Object.entries(b.inBuf)) items.push([k, v]);
    for (const [k, v] of Object.entries(b.outBuf)) items.push([k, v]);
    for (const s of b.storage ?? []) if (s) items.push([s.item, s.count]);
    for (const it of b.items ?? []) items.push([it.item, 1]);
    this.deleteBuilding(b);
    this.giveOrDrop(p, items);
  }

  setRecipe(id: number, bid: number, recipeId: string) {
    const p = this.players.get(id);
    const b = this.buildings.get(bid);
    const r = RECIPES[recipeId];
    if (!p || !b || !r) return;
    if (!r.machines.includes(b.type)) return;
    if (!isUnlocked(r.unlock, this.tech.completed)) { this.toast(id, 'Bu tarif henüz açılmadı'); return; }
    if (b.recipe === recipeId) return;
    const items: Array<[string, number]> = [...Object.entries(b.inBuf), ...Object.entries(b.outBuf)];
    b.inBuf = {};
    b.outBuf = {};
    b.progress = 0;
    b.recipe = recipeId;
    this.giveOrDrop(p, items);
    this.markChanged(b.id);
  }

  take(id: number, bid: number, from: 'in' | 'out' | 'storage', item?: string, slot?: number) {
    const p = this.players.get(id);
    const b = this.buildings.get(bid);
    if (!p || !b) return;
    if (this.distToBuilding(p, b) > INTERACT_RANGE) { this.toast(id, 'Çok uzak'); return; }
    const moveBuf = (buf: Record<string, number>) => {
      for (const [k, v] of Object.entries(buf)) {
        if (item && k !== item) continue;
        const left = addItem(p.inventory, k, v);
        if (left > 0) buf[k] = left; else delete buf[k];
      }
    };
    if (from === 'in') moveBuf(b.inBuf);
    else if (from === 'out') moveBuf(b.outBuf);
    else if (b.storage) {
      for (let i = 0; i < b.storage.length; i++) {
        if (slot !== undefined && slot !== i) continue;
        const s = b.storage[i];
        if (!s) continue;
        const left = addItem(p.inventory, s.item, s.count);
        if (left > 0) s.count = left; else b.storage[i] = null;
      }
      if (b.type === 'crate' && b.storage.every((s) => !s)) this.deleteBuilding(b);
    }
    p.dirtyInv = true;
    this.markChanged(b.id);
  }

  put(id: number, bid: number, slotIdx: number, count?: number) {
    const p = this.players.get(id);
    const b = this.buildings.get(bid);
    if (!p || !b) return;
    const s = p.inventory[slotIdx];
    if (!s) return;
    if (this.distToBuilding(p, b) > INTERACT_RANGE) { this.toast(id, 'Çok uzak'); return; }
    const def = BUILDINGS[b.type];
    let amount = Math.min(s.count, count ?? s.count);
    let accepted = 0;
    if (b.storage && b.type === 'storage') {
      accepted = amount - addItem(b.storage, s.item, amount);
    } else if (def.fuels) {
      if (!def.fuels.includes(s.item)) { this.toast(id, 'Bu yakıt kabul edilmiyor'); return; }
      const cur = b.inBuf[s.item] ?? 0;
      accepted = Math.max(0, Math.min(amount, ITEMS[s.item].stack - cur));
      if (accepted) b.inBuf[s.item] = cur + accepted;
    } else if (def.crafter) {
      const r = b.recipe ? RECIPES[b.recipe] : undefined;
      if (!r || !r.inputs[s.item]) { this.toast(id, 'Bu makine bu eşyayı kullanmıyor'); return; }
      const cur = b.inBuf[s.item] ?? 0;
      accepted = Math.max(0, Math.min(amount, MANUAL_IN_CAP - cur));
      if (accepted) b.inBuf[s.item] = cur + accepted;
    } else {
      return;
    }
    amount = accepted;
    s.count -= amount;
    if (s.count <= 0) p.inventory[slotIdx] = null;
    p.dirtyInv = true;
    this.markChanged(b.id);
  }

  private nearCraftStation(p: PlayerData): boolean {
    for (const b of this.buildings.values()) {
      if ((b.type === 'hub' || b.type === 'workbench') && this.distToBuilding(p, b) <= CRAFT_RANGE) return true;
    }
    return false;
  }

  craft(id: number, recipeId: string, count: number) {
    const p = this.players.get(id);
    const r = RECIPES[recipeId];
    if (!p || !r || !r.hand) return;
    if (!isUnlocked(r.unlock, this.tech.completed)) { this.toast(id, 'Bu tarif henüz açılmadı'); return; }
    if (!this.nearCraftStation(p)) { this.toast(id, 'Elle üretim için HUB veya Çalışma Tezgahı yakınında olmalısın'); return; }
    const n = Math.max(1, Math.min(100, count | 0));
    if (!hasItems(p.inventory, r.inputs)) { this.toast(id, 'Yeterli malzeme yok'); return; }
    if (p.craftQueue.length >= 10) { this.toast(id, 'Üretim kuyruğu dolu'); return; }
    p.craftQueue.push({ recipe: recipeId, remaining: n, progress: 0 });
    p.dirtyCraft = true;
  }

  cancelCraft(id: number) {
    const p = this.players.get(id);
    if (!p) return;
    const job = p.craftQueue[0];
    if (job && job.progress > 0) this.giveOrDrop(p, Object.entries(RECIPES[job.recipe].inputs));
    p.craftQueue = [];
    p.dirtyCraft = true;
  }

  harvest(id: number, x: number, y: number) {
    const p = this.players.get(id);
    if (!p) return;
    x |= 0; y |= 0;
    if (p.harvestCd > 0) return;
    if (Math.hypot(p.x - (x + 0.5), p.y - (y + 0.5)) > INTERACT_RANGE) { this.toast(id, 'Çok uzak'); return; }
    const node = this.map.nodeAt.get(tileKey(x, y));
    if (node) {
      if (this.buildingAt(x, y)) { this.toast(id, 'Bu düğümde maden çıkarıcı var'); return; }
      p.harvestCd = HARVEST_COOLDOWN;
      const n = node.purity === 'pure' ? 2 : 1;
      if (addItem(p.inventory, node.item, n) > 0) this.toast(id, 'Envanter dolu');
      p.dirtyInv = true;
      this.broadcast({ t: 'fx', kind: 'harvest', x: x + 0.5, y: y + 0.5, by: id });
      return;
    }
    if (hasTree(this.map, x, y)) {
      p.harvestCd = HARVEST_COOLDOWN;
      this.map.trees[y * this.map.size + x] = 0;
      const k = tileKey(x, y);
      this.removedTrees.add(k);
      this.treesRemovedPending.push(k);
      this.giveOrDrop(p, [['leaves', 6], ['wood', 3]]);
      this.broadcast({ t: 'fx', kind: 'harvest', x: x + 0.5, y: y + 0.5, by: id });
    }
  }

  attack(id: number, angle: number) {
    const p = this.players.get(id);
    if (!p || p.attackCd > 0 || !Number.isFinite(angle)) return;
    p.attackCd = PLAYER_ATTACK_COOLDOWN;
    p.angle = angle;
    this.broadcast({ t: 'fx', kind: 'swing', x: p.x, y: p.y, angle, by: id });
    for (const e of this.enemies.values()) {
      const dx = e.x - p.x, dy = e.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d > PLAYER_ATTACK_RANGE) continue;
      let da = Math.atan2(dy, dx) - angle;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      if (d > 0.6 && Math.abs(da) > Math.PI / 2.5) continue;
      e.hp -= PLAYER_ATTACK_DAMAGE;
      e.x += (dx / (d || 1)) * 0.4;
      e.y += (dy / (d || 1)) * 0.4;
      this.broadcast({ t: 'fx', kind: 'hit', x: e.x, y: e.y });
      if (e.hp <= 0) {
        this.enemies.delete(e.id);
        this.broadcast({ t: 'fx', kind: 'enemyDeath', x: e.x, y: e.y });
      }
    }
    for (const n of this.nests) {
      if (!n.alive) continue;
      if (Math.hypot(n.x + 0.5 - p.x, n.y + 0.5 - p.y) > PLAYER_ATTACK_RANGE + 0.8) continue;
      n.hp -= PLAYER_ATTACK_DAMAGE;
      this.nestsDirty = true;
      this.broadcast({ t: 'fx', kind: 'hit', x: n.x + 0.5, y: n.y + 0.5 });
      if (n.hp <= 0) {
        n.alive = false;
        n.hp = 0;
        this.sysChat(`${p.name} bir böcek yuvasını yok etti!`);
        this.giveOrDrop(p, [['biomass', 40]]);
      }
    }
  }

  hubSubmit(id: number) {
    const p = this.players.get(id);
    if (!p) return;
    if (this.distToBuilding(p, this.hub()) > CRAFT_RANGE) { this.toast(id, 'HUB yakınında olmalısın'); return; }
    const m = MILESTONES[this.tech.completed];
    if (!m) { this.toast(id, 'Tüm kademeler tamamlandı!', 'good'); return; }
    let moved = 0;
    for (const [item, need] of Object.entries(m.cost)) {
      const have = this.tech.delivered[item] ?? 0;
      const want = need - have;
      if (want <= 0) continue;
      const got = removeItem(p.inventory, item, want);
      if (got > 0) { this.tech.delivered[item] = have + got; moved += got; }
    }
    if (moved === 0) { this.toast(id, 'Teslim edilecek uygun eşya yok'); return; }
    p.dirtyInv = true;
    const done = Object.entries(m.cost).every(([item, need]) => (this.tech.delivered[item] ?? 0) >= need);
    if (done) {
      const idx = this.tech.completed;
      this.tech.completed++;
      this.tech.delivered = {};
      const un = milestoneUnlocks(idx);
      const list = [...un.buildings, ...un.recipes];
      this.sysChat(`Kademe tamamlandı: ${m.name}!${list.length ? ' Açılanlar: ' + list.join(', ') : ''}`);
      if (this.tech.completed >= MILESTONES.length) this.sysChat('Tebrikler! Fabrika Ustası oldunuz. Oyunu kazandınız!');
    } else {
      this.toast(id, `${moved} parça teslim edildi`, 'good');
    }
    this.broadcast({ t: 'tech', tech: this.tech });
  }

  resetFuse(id: number, bid: number) {
    const net = this.netOf.get(bid);
    if (net === undefined) return;
    const n = this.nets.find((x) => x.id === net);
    if (!n) return;
    for (const pid of n.poles) {
      const pole = this.buildings.get(pid);
      if (pole && pole.tripped) { pole.tripped = false; this.markChanged(pid); }
    }
    const p = this.players.get(id);
    if (p) this.sysChat(`${p.name} sigortayı sıfırladı.`);
  }

  chat(id: number, text: string) {
    const p = this.players.get(id);
    if (!p) return;
    const t = String(text).slice(0, 200).trim();
    if (!t) return;
    if (t.startsWith('/')) { this.command(p, t); return; }
    this.broadcast({ t: 'chat', from: p.name, color: p.color, text: t });
  }

  private command(p: PlayerData, t: string) {
    const [cmd, ...args] = t.slice(1).split(/\s+/);
    if (cmd === 'yardim' || cmd === 'help') {
      this.send(p.id, { t: 'chat', from: 'Sistem', color: 0xffd060, sys: true, text: 'Komutlar: /yardim, /kim, /konum' + (this.cheats ? ', /ver <eşya> <adet>, /kademe, /tp <x> <y>' : '') });
    } else if (cmd === 'kim') {
      this.send(p.id, { t: 'chat', from: 'Sistem', color: 0xffd060, sys: true, text: 'Oyuncular: ' + [...this.players.values()].filter((x) => x.online).map((x) => x.name).join(', ') });
    } else if (cmd === 'konum') {
      this.send(p.id, { t: 'chat', from: 'Sistem', color: 0xffd060, sys: true, text: `Konum: ${p.x.toFixed(1)}, ${p.y.toFixed(1)}` });
    } else if (this.cheats && cmd === 'ver') {
      const item = args[0];
      const n = parseInt(args[1] ?? '100', 10) || 100;
      if (item === 'hepsi') {
        for (const k of Object.keys(ITEMS)) addItem(p.inventory, k, 50);
      } else if (ITEMS[item]) {
        addItem(p.inventory, item, n);
      }
      p.dirtyInv = true;
    } else if (this.cheats && cmd === 'tp') {
      const x = parseFloat(args[0]), y = parseFloat(args[1]);
      if (Number.isFinite(x) && Number.isFinite(y)) { p.x = x; p.y = y; }
    } else if (this.cheats && cmd === 'kademe') {
      if (this.tech.completed < MILESTONES.length) this.tech.completed++;
      this.tech.delivered = {};
      this.broadcast({ t: 'tech', tech: this.tech });
    }
  }

  // ---------------------------------------------------------------- simülasyon

  step() {
    this.tickCount++;
    this.time += DT;
    this.updatePlayers();
    this.updatePower();
    this.updateMachines();
    this.updateLogistics();
    this.updateEnemies();
  }

  private updatePlayers() {
    for (const p of this.players.values()) {
      if (!p.online) continue;
      const [vx, vy] = inputVelocity(p.input, PLAYER_SPEED);
      if (vx || vy) moveCircle(p, vx, vy, DT, this.isBlockedForWalk);
      p.attackCd = Math.max(0, p.attackCd - DT);
      p.harvestCd = Math.max(0, p.harvestCd - DT);
      if (p.hp < PLAYER_MAX_HP && this.time - p.lastDamage > PLAYER_REGEN_DELAY) p.hp = Math.min(PLAYER_MAX_HP, p.hp + PLAYER_REGEN * DT);
      this.updateCraft(p);
      if (p.dirtyInv) { p.dirtyInv = false; this.send(p.id, { t: 'inv', inventory: p.inventory }); }
      if (p.dirtyCraft) { p.dirtyCraft = false; this.send(p.id, { t: 'craft', queue: p.craftQueue }); }
    }
  }

  private updateCraft(p: PlayerData) {
    const job = p.craftQueue[0];
    if (!job) return;
    const r = RECIPES[job.recipe];
    if (job.progress === 0) {
      if (!hasItems(p.inventory, r.inputs)) {
        p.craftQueue.shift();
        p.dirtyCraft = true;
        this.toast(p.id, `${r.name} için malzeme bitti`);
        return;
      }
      removeItems(p.inventory, r.inputs);
      p.dirtyInv = true;
      job.progress = 1e-6;
    }
    job.progress += DT / handCraftTime(r);
    if (job.progress >= 1) {
      job.progress = 0;
      job.remaining--;
      this.giveOrDrop(p, Object.entries(r.outputs));
      if (job.remaining <= 0) p.craftQueue.shift();
      p.dirtyCraft = true;
    } else if (this.tickCount % 4 === 0) {
      p.dirtyCraft = true;
    }
  }

  private updatePower() {
    if (this.powerDirty) {
      this.powerDirty = false;
      const { nets, netOf } = computeNetworks(this.buildings.values());
      this.nets = nets;
      this.netOf = netOf;
      for (const b of this.buildings.values()) {
        const net = netOf.get(b.id);
        if (b.net !== net) { b.net = net; this.markChanged(b.id); }
      }
    }
    this.powered.clear();
    const info: PowerNetInfo[] = [];
    for (const net of this.nets) {
      let capacity = 0, demand = 0;
      const gens: BuildingState[] = [];
      for (const id of net.members) {
        const b = this.buildings.get(id);
        if (!b) continue;
        const def = BUILDINGS[b.type];
        if (def.powerGen) {
          if ((b.fuel ?? 0) > 0 || this.hasFuel(b)) { capacity += def.powerGen; gens.push(b); }
        } else if (def.power && this.wantsPower(b)) {
          demand += def.power;
        }
      }
      let tripped = net.poles.some((pid) => this.buildings.get(pid)?.tripped);
      if (!tripped && demand > capacity && capacity > 0) {
        tripped = true;
        for (const pid of net.poles) { const pole = this.buildings.get(pid); if (pole) { pole.tripped = true; this.markChanged(pid); } }
        this.sysChat(`Sigorta attı! Tüketim (${demand} MW) üretimi (${capacity} MW) aşıyor. Bir direk veya jeneratörden sıfırla.`);
      }
      const ok = !tripped && capacity >= demand && capacity > 0;
      const load = ok && capacity > 0 ? demand / capacity : 0;
      if (ok) for (const id of net.members) this.powered.add(id);
      for (const g of gens) this.burnFuel(g, load, tripped);
      info.push({ id: net.id, production: ok ? demand : 0, capacity, consumption: demand, tripped });
    }
    // Ağa bağlı olmayan jeneratörler durumu
    for (const b of this.buildings.values()) {
      const def = BUILDINGS[b.type];
      if (def.powerGen && this.netOf.get(b.id) === undefined) this.setStatus(b, this.hasFuel(b) || (b.fuel ?? 0) > 0 ? 'idle' : 'nofuel');
    }
    this.netInfo = info;
  }

  private hasFuel(b: BuildingState): boolean {
    const def = BUILDINGS[b.type];
    return (def.fuels ?? []).some((f) => (b.inBuf[f] ?? 0) > 0);
  }

  private burnFuel(g: BuildingState, load: number, tripped: boolean) {
    const def = BUILDINGS[g.type];
    if (tripped) { this.setStatus(g, 'tripped'); return; }
    if (load <= 0) { this.setStatus(g, 'idle'); return; }
    let need = def.powerGen! * load * DT;
    while (need > 0) {
      if ((g.fuel ?? 0) <= 0) {
        const f = (def.fuels ?? []).find((x) => (g.inBuf[x] ?? 0) > 0);
        if (!f) break;
        g.inBuf[f]--;
        if (g.inBuf[f] <= 0) delete g.inBuf[f];
        g.fuel = (g.fuel ?? 0) + (ITEMS[f].energy ?? 0);
      }
      const use = Math.min(need, g.fuel!);
      g.fuel! -= use;
      need -= use;
    }
    g.progress = def.powerGen ? load : 0;
    this.setStatus(g, 'working');
  }

  private setStatus(b: BuildingState, s: BuildingState['status']) {
    b.status = s;
  }

  private wantsPower(b: BuildingState): boolean {
    const def = BUILDINGS[b.type];
    if (def.mineRate) return sumBuf(b.outBuf) < MACHINE_OUT_CAP && !!this.findMinerNode(b);
    if (def.crafter) {
      if (!b.recipe) return false;
      const r = RECIPES[b.recipe];
      if (this.outputFull(b)) return false;
      if (b.progress > 0) return true;
      return Object.entries(r.inputs).every(([k, v]) => (b.inBuf[k] ?? 0) >= v);
    }
    return false;
  }

  private outputFull(b: BuildingState): boolean {
    const r = b.recipe ? RECIPES[b.recipe] : undefined;
    if (!r) return false;
    return Object.entries(r.outputs).some(([k, v]) => (b.outBuf[k] ?? 0) + v > MACHINE_OUT_CAP);
  }

  private netTripped(b: BuildingState): boolean {
    const net = this.netOf.get(b.id);
    if (net === undefined) return false;
    return this.netInfo.find((n) => n.id === net)?.tripped ?? false;
  }

  private updateMachines() {
    for (const b of this.buildings.values()) {
      const def = BUILDINGS[b.type];
      if (def.mineRate) this.updateMiner(b, def.mineRate);
      else if (def.crafter) this.updateCrafter(b);
    }
  }

  private updateMiner(b: BuildingState, rate: number) {
    const node = this.findMinerNode(b);
    if (!node) { this.setStatus(b, 'noinput'); return; }
    if (sumBuf(b.outBuf) >= MACHINE_OUT_CAP) { this.setStatus(b, 'full'); return; }
    if (!this.powered.has(b.id)) { this.setStatus(b, this.netTripped(b) ? 'tripped' : 'nopower'); return; }
    this.setStatus(b, 'working');
    b.progress += ((rate * PURITY_MULT[node.purity]) / 60) * DT;
    while (b.progress >= 1) {
      b.progress -= 1;
      b.outBuf[node.item] = (b.outBuf[node.item] ?? 0) + 1;
    }
  }

  private updateCrafter(b: BuildingState) {
    if (!b.recipe) { this.setStatus(b, 'norecipe'); return; }
    const r = RECIPES[b.recipe];
    if (this.outputFull(b)) { this.setStatus(b, 'full'); return; }
    const hasInputs = Object.entries(r.inputs).every(([k, v]) => (b.inBuf[k] ?? 0) >= v);
    if (b.progress === 0 && !hasInputs) { this.setStatus(b, 'noinput'); return; }
    if (!this.powered.has(b.id)) { this.setStatus(b, this.netTripped(b) ? 'tripped' : 'nopower'); return; }
    if (b.progress === 0) {
      for (const [k, v] of Object.entries(r.inputs)) {
        b.inBuf[k] -= v;
        if (b.inBuf[k] <= 0) delete b.inBuf[k];
      }
      b.progress = 1e-6;
    }
    this.setStatus(b, 'working');
    b.progress += DT / r.time;
    if (b.progress >= 1) {
      b.progress = 0;
      for (const [k, v] of Object.entries(r.outputs)) b.outBuf[k] = (b.outBuf[k] ?? 0) + v;
    }
  }

  // ---------------------------------------------------------------- lojistik

  /** Bir eşyayı (fromX,fromY) tile'ından dir yönünde komşu tile'a aktarmayı dener */
  tryInsert(fromX: number, fromY: number, dir: Dir, item: string): boolean {
    const tx = fromX + DX[dir], ty = fromY + DY[dir];
    const t = this.buildingAt(tx, ty);
    if (!t) return false;
    if (isBelt(t.type)) {
      if (t.rot === opposite(dir)) return false;
      const items = t.items!;
      const last = items[items.length - 1];
      if (last && last.pos < BELT_ITEM_SPACING) return false;
      items.push({ item, pos: 0 });
      this.beltsWithItems.add(t.id);
      return true;
    }
    const back = opposite(dir);
    const ports = worldPorts(t.type, t.x, t.y, t.rot, 'inputs');
    if (!ports.some((p) => p.x === tx && p.y === ty && p.dir === back)) return false;
    return this.accept(t, item);
  }

  private accept(t: BuildingState, item: string): boolean {
    const def = BUILDINGS[t.type];
    if (def.crafter) {
      const r = t.recipe ? RECIPES[t.recipe] : undefined;
      const need = r?.inputs[item];
      if (!need) return false;
      const cur = t.inBuf[item] ?? 0;
      if (cur >= inCap(need)) return false;
      t.inBuf[item] = cur + 1;
      return true;
    }
    if (def.fuels) {
      if (!def.fuels.includes(item)) return false;
      if (sumBuf(t.inBuf) >= GEN_FUEL_CAP) return false;
      t.inBuf[item] = (t.inBuf[item] ?? 0) + 1;
      return true;
    }
    if (t.type === 'storage') return addItem(t.storage!, item, 1) === 0;
    if (t.type === 'splitter' || t.type === 'merger') {
      if (t.items!.length >= QUEUE_CAP) return false;
      t.items!.push({ item, pos: 0 });
      return true;
    }
    return false;
  }

  private updateLogistics() {
    // Bantlar
    for (const id of [...this.beltsWithItems]) {
      const b = this.buildings.get(id);
      if (!b || !b.items) { this.beltsWithItems.delete(id); continue; }
      const speed = BUILDINGS[b.type].beltSpeed! * DT;
      const items = b.items;
      for (let i = 0; i < items.length; i++) {
        const limit = i === 0 ? 1 : items[i - 1].pos - BELT_ITEM_SPACING;
        const np = Math.min(items[i].pos + speed, limit);
        items[i].pos = Math.max(items[i].pos, np);
      }
      if (items.length && items[0].pos >= 1) {
        if (this.tryInsert(b.x, b.y, b.rot as Dir, items[0].item)) items.shift();
      }
      if (!items.length) this.beltsWithItems.delete(id);
    }
    // Bina çıkışları
    for (const b of this.buildings.values()) {
      const def = BUILDINGS[b.type];
      if (!def.outputs.length) continue;
      const ports = worldPorts(b.type, b.x, b.y, b.rot, 'outputs');
      if (b.type === 'splitter') {
        const it = b.items![0];
        if (!it) continue;
        for (let k = 0; k < ports.length; k++) {
          const idx = ((b.rr ?? 0) + k) % ports.length;
          const p = ports[idx];
          if (this.tryInsert(p.x, p.y, p.dir, it.item)) { b.items!.shift(); b.rr = (idx + 1) % ports.length; break; }
        }
      } else if (b.type === 'merger') {
        const it = b.items![0];
        if (it && this.tryInsert(ports[0].x, ports[0].y, ports[0].dir, it.item)) b.items!.shift();
      } else if (b.type === 'storage') {
        const p = ports[0];
        const idx = b.storage!.findIndex((s) => s && s.count > 0);
        if (idx < 0) continue;
        const s = b.storage![idx]!;
        if (this.tryInsert(p.x, p.y, p.dir, s.item)) {
          s.count--;
          if (s.count <= 0) b.storage![idx] = null;
        }
      } else {
        for (const p of ports) {
          const item = Object.keys(b.outBuf).find((k) => b.outBuf[k] > 0);
          if (!item) break;
          if (this.tryInsert(p.x, p.y, p.dir, item)) {
            b.outBuf[item]--;
            if (b.outBuf[item] <= 0) delete b.outBuf[item];
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------- düşmanlar

  private enemyBlocked = (tx: number, ty: number): boolean => {
    if (tx < 0 || ty < 0 || tx >= this.map.size || ty >= this.map.size) return true;
    if (!terrainBuildable(this.map, tx, ty)) return true;
    const b = this.buildingAt(tx, ty);
    return !!b && !BUILDINGS[b.type].walkable;
  };

  private updateEnemies() {
    const online = [...this.players.values()].filter((p) => p.online);
    for (const n of this.nests) {
      if (!n.alive) continue;
      const near = online.some((p) => Math.hypot(p.x - n.x, p.y - n.y) < 60);
      if (!near) continue;
      n.spawnT -= DT;
      let count = 0;
      for (const e of this.enemies.values()) if (e.nest === n.id) count++;
      if (n.spawnT <= 0 && count < NEST_MAX_ENEMIES) {
        n.spawnT = NEST_SPAWN_INTERVAL;
        const id = this.nextId++;
        this.enemies.set(id, { id, x: n.x + 0.5 + (Math.random() - 0.5), y: n.y + 0.5 + (Math.random() - 0.5), hp: ENEMY_HP, nest: n.id, attackCd: 0, wx: n.x, wy: n.y, wanderT: 0 });
      }
    }
    for (const e of this.enemies.values()) {
      const nest = this.nests.find((n) => n.id === e.nest)!;
      e.attackCd = Math.max(0, e.attackCd - DT);
      let target: PlayerData | undefined;
      let best = ENEMY_AGGRO_RANGE;
      for (const p of online) {
        const d = Math.hypot(p.x - e.x, p.y - e.y);
        if (d < best && Math.hypot(p.x - nest.x, p.y - nest.y) < ENEMY_LEASH_RANGE) { best = d; target = p; }
      }
      let tx: number, ty: number, speed = ENEMY_SPEED;
      if (target) {
        tx = target.x; ty = target.y;
        if (best < ENEMY_ATTACK_RANGE && e.attackCd <= 0) {
          e.attackCd = ENEMY_ATTACK_COOLDOWN;
          this.damagePlayer(target, ENEMY_DAMAGE);
        }
      } else {
        e.wanderT -= DT;
        if (e.wanderT <= 0) {
          e.wanderT = 2 + Math.random() * 3;
          e.wx = nest.x + 0.5 + (Math.random() - 0.5) * 8;
          e.wy = nest.y + 0.5 + (Math.random() - 0.5) * 8;
        }
        tx = e.wx; ty = e.wy; speed = ENEMY_SPEED * 0.4;
      }
      const dx = tx - e.x, dy = ty - e.y;
      const d = Math.hypot(dx, dy);
      if (d > 0.5) moveCircle(e, (dx / d) * speed, (dy / d) * speed, DT, this.enemyBlocked, 0.35);
    }
  }

  private damagePlayer(p: PlayerData, dmg: number) {
    p.hp -= dmg;
    p.lastDamage = this.time;
    this.broadcast({ t: 'fx', kind: 'hit', x: p.x, y: p.y, by: p.id });
    if (p.hp <= 0) {
      const items = p.inventory.filter((s): s is Slot => !!s);
      if (items.length) this.dropCrate(p.x, p.y, items);
      p.inventory = makeInventory(INVENTORY_SLOTS);
      p.dirtyInv = true;
      p.craftQueue = [];
      p.dirtyCraft = true;
      this.broadcast({ t: 'fx', kind: 'death', x: p.x, y: p.y, by: p.id });
      const sp = this.spawnPoint();
      p.x = sp.x; p.y = sp.y;
      p.hp = PLAYER_MAX_HP;
      this.sysChat(`${p.name} böceklere yenildi! Eşyaları öldüğü yerde bir sandıkta.`);
    }
  }

  // ---------------------------------------------------------------- yayın

  /** Bu tick için gönderilecek periyodik mesajları üretir */
  collectUpdates(): void {
    const t = this.tickCount;
    const tick: Extract<ServerMsg, { t: 'tick' }> = { t: 'tick', tick: t };
    if (t % 2 === 0) {
      tick.players = [...this.players.values()].filter((p) => p.online).map((p) => [p.id, round2(p.x), round2(p.y), round2(p.angle), Math.round(p.hp)]);
      tick.enemies = [...this.enemies.values()].map((e) => [e.id, round2(e.x), round2(e.y), Math.max(0, Math.round(e.hp))]);
      const belts: Record<number, number[]> = {};
      for (const id of this.beltsWithItems) {
        const b = this.buildings.get(id);
        if (!b?.items) continue;
        const arr: number[] = [];
        for (const it of b.items) arr.push(ITEM_INDEX[it.item], Math.round(it.pos * 1000));
        belts[id] = arr;
      }
      for (const id of this.prevBelts) if (!(id in belts) && this.buildings.has(id)) belts[id] = [];
      this.prevBelts = new Set(Object.keys(belts).map(Number).filter((id) => belts[id].length > 0));
      tick.belts = belts;
    }
    this.out.push(tick);

    if (t % 4 === 0) {
      for (const b of this.buildings.values()) {
        if (isBelt(b.type)) continue;
        const key = JSON.stringify([b.status, b.inBuf, b.outBuf, Math.round(b.progress * 50), b.recipe, b.storage, b.tripped, b.items?.length, Math.round(b.fuel ?? 0)]);
        if (this.lastSent.get(b.id) !== key) { this.lastSent.set(b.id, key); this.changed.add(b.id); }
      }
    }
    if (this.changed.size || this.removedIds.length) {
      const upsert = [...this.changed].map((id) => this.buildings.get(id)).filter((b): b is BuildingState => !!b).map((b) => (isBelt(b.type) ? { ...b, items: undefined } : b));
      this.out.push({ t: 'buildings', upsert, remove: this.removedIds });
      this.changed.clear();
      this.removedIds = [];
    }
    if (this.treesRemovedPending.length) {
      this.out.push({ t: 'trees', removed: this.treesRemovedPending });
      this.treesRemovedPending = [];
    }
    if (this.nestsDirty) {
      this.nestsDirty = false;
      this.out.push({ t: 'nests', nests: this.nestsState() });
    }
    if (t % 20 === 0) this.out.push({ t: 'power', nets: this.netInfo });
  }

  private prevBelts = new Set<number>();

  /** Gönderilmemiş bir sonraki tıkta tam durum isteyen istemci için tüm binalar */
  allBuildings(): BuildingState[] {
    return [...this.buildings.values()];
  }

  inventoryOf(id: number): Inventory {
    return this.players.get(id)?.inventory ?? [];
  }

  /** Test yardımcı: bir oyuncunun envanterindeki eşya sayısı */
  count(id: number, item: string): number {
    return countItem(this.inventoryOf(id), item);
  }

  nodeInfo(x: number, y: number): string | undefined {
    const n = this.map.nodeAt.get(tileKey(x, y));
    return n ? `${itemName(n.item)} (${PURITY_NAMES[n.purity]})` : undefined;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function cryptoToken(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 24; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
