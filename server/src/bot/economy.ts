/**
 * Hilesiz botların ekonomi beyni (saf fonksiyonlar):
 * - Dünyadaki yapılardan tesisleri çıkarır (maden, hücre, petrol, santral, depo)
 * - Kalan kademe ihtiyacından malzeme ihtiyaç planı (MRP) çıkarır
 * - Hangi tesislerin eksik olduğunu öncelik sırasıyla döndürür
 */
import { BUILDINGS, DX, DY, RECIPES, isBelt, worldPorts } from '@fabrika/shared';
import type { BuildingState, RecipeDef } from '@fabrika/shared';
import { isRaw, recipesFor } from './planner';
import { processMachine } from './layouts';

// ---------------------------------------------------------------- tesis çıkarımı

export type FacilityKind = 'mine' | 'cell' | 'oil' | 'coal' | 'gen' | 'depot';

export interface Facility {
  kind: FacilityKind;
  /** Madenlerde düğüm kaynağı */
  resource?: string;
  /** İşlem/üretim tarifi */
  recipe?: string;
  /** Ürettiği eşya (maden: ham kaynak veya işlenmiş ürün) */
  product?: string;
  machine?: BuildingState;
  miner?: BuildingState;
  storage?: BuildingState;
}

type At = (x: number, y: number) => BuildingState | undefined;

/** Bir portun önünden bantları izleyip ulaşılan ilk yapıyı döndürür */
export function traceFrom(at: At, x: number, y: number, dir: number, max = 120): BuildingState | undefined {
  let tx = x + DX[dir], ty = y + DY[dir];
  for (let i = 0; i < max; i++) {
    const b = at(tx, ty);
    if (!b) return undefined;
    if (!isBelt(b.type)) return b;
    tx += DX[b.rot];
    ty += DY[b.rot];
  }
  return undefined;
}

export function traceOutput(at: At, b: BuildingState): BuildingState | undefined {
  for (const p of worldPorts(b.type, b.x, b.y, b.rot, 'outputs')) {
    const t = traceFrom(at, p.x, p.y, p.dir);
    if (t) return t;
  }
  return undefined;
}

export function inferFacilities(buildings: Iterable<BuildingState>, at: At, nodeItem: (b: BuildingState) => string | undefined): Facility[] {
  const all = [...buildings];
  const out: Facility[] = [];
  const fed = new Set<number>();
  const usedStorage = new Set<number>();
  for (const m of all) {
    if (!BUILDINGS[m.type].mineRate) continue;
    const resource = nodeItem(m);
    const dest = traceOutput(at, m);
    if (dest?.type === 'splitter' || dest?.type === 'coal_generator') { out.push({ kind: 'coal', resource, miner: m }); continue; }
    if (dest && BUILDINGS[dest.type].crafter && dest.recipe) {
      fed.add(dest.id);
      const st = traceOutput(at, dest);
      const storage = st?.type === 'storage' ? st : undefined;
      if (storage) usedStorage.add(storage.id);
      const r = RECIPES[dest.recipe];
      out.push({ kind: 'mine', resource, recipe: dest.recipe, product: Object.keys(r.outputs)[0], miner: m, machine: dest, storage });
      continue;
    }
    const storage = dest?.type === 'storage' ? dest : undefined;
    if (storage) usedStorage.add(storage.id);
    out.push({ kind: 'mine', resource, product: resource, miner: m, storage });
  }
  for (const b of all) {
    const def = BUILDINGS[b.type];
    if (def.crafter && !fed.has(b.id)) {
      const st = traceOutput(at, b);
      const storage = st?.type === 'storage' ? st : undefined;
      if (storage) usedStorage.add(storage.id);
      const r = b.recipe ? RECIPES[b.recipe] : undefined;
      out.push({ kind: b.type === 'refinery' ? 'oil' : 'cell', recipe: b.recipe, product: r ? Object.keys(r.outputs)[0] : undefined, machine: b, storage });
    } else if (def.powerGen) {
      out.push({ kind: 'gen', machine: b });
    }
  }
  for (const b of all) if (b.type === 'storage' && !usedStorage.has(b.id)) out.push({ kind: 'depot', storage: b });
  return out;
}

// ---------------------------------------------------------------- ihtiyaç planı

/** Madenlerde (düğüm başında) üretilen ürünler ve kaynakları */
export const MINE_PRODUCTS: Record<string, { resource: string; recipe: string; rate: number }> = {
  iron_ingot: { resource: 'ore_iron', recipe: 'iron_ingot', rate: 30 },
  copper_ingot: { resource: 'ore_copper', recipe: 'copper_ingot', rate: 30 },
  concrete: { resource: 'limestone', recipe: 'concrete', rate: 15 },
};

export function unlocked(type: string, completed: number): boolean {
  return BUILDINGS[type].unlock < completed;
}

/** Bu ürün madende üretilebiliyor mu (gerekli makine açık mı)? */
export function mineProcessOpen(item: string, completed: number): boolean {
  const mp = MINE_PRODUCTS[item];
  return !!mp && unlocked('miner_mk1', completed) && unlocked(processMachine(mp.recipe), completed);
}

export function chooseRecipe(item: string, completed: number): RecipeDef | undefined {
  return recipesFor(item, completed)[0];
}

export interface Mrp {
  /** Tarif başına kalan üretim sayısı */
  crafts: Record<string, number>;
  /** Madenden gelen yapraklar: ham kaynaklar ve madende işlenen ürünler */
  leaves: Record<string, number>;
}

/** Hedeflerden stok düşülerek kalan ihtiyaç (malzeme ihtiyaç planlaması) */
export function mrp(goals: Record<string, number>, stockIn: Record<string, number>, completed: number): Mrp {
  const stock = { ...stockIn };
  const crafts: Record<string, number> = {};
  const leaves: Record<string, number> = {};
  const need = (item: string, n: number, depth: number) => {
    const use = Math.min(stock[item] ?? 0, n);
    if (use > 0) { stock[item] -= use; n -= use; }
    if (n <= 0) return;
    if (isRaw(item) || mineProcessOpen(item, completed) || depth > 10) { leaves[item] = (leaves[item] ?? 0) + n; return; }
    const r = chooseRecipe(item, completed);
    if (!r) { leaves[item] = (leaves[item] ?? 0) + n; return; }
    const c = Math.ceil(n / r.outputs[item]);
    crafts[r.id] = (crafts[r.id] ?? 0) + c;
    const extra = c * r.outputs[item] - n;
    if (extra > 0) stock[item] = (stock[item] ?? 0) + extra;
    for (const [k, v] of Object.entries(r.inputs)) need(k, c * v, depth + 1);
  };
  for (const [k, v] of Object.entries(goals)) need(k, v, 0);
  return { crafts, leaves };
}

export interface Want {
  key: string;
  kind: 'mine' | 'cell' | 'oil' | 'depot';
  resource?: string;
  recipe?: string;
  machine?: string;
  /** İstenen toplam adet ve mevcut adet */
  count: number;
  have: number;
  why: string;
}

/** Hedeflenen süre (oyun dakikası): kalan iş bu sürede bitecek kadar tesis */
const TARGET_MIN = 20;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Eksik tesisler, öncelik sırasıyla (önce madenler, sonra zincirin derinindeki hücreler) */
export function plan(completed: number, m: Mrp, existing: Facility[]): Want[] {
  const wants: Want[] = [];
  if (completed < 1) return wants;
  const depots = existing.filter((f) => f.kind === 'depot').length;
  if (depots < 1) wants.push({ key: 'depot', kind: 'depot', count: 1, have: depots, why: 'genel depo' });
  const mines = (resource: string, recipe?: string) => existing.filter((f) => f.kind === 'mine' && f.resource === resource && f.recipe === recipe).length;
  // Madenler
  for (const [item, n] of Object.entries(m.leaves).sort((a, b) => b[1] - a[1])) {
    if (n <= 0) continue;
    const mp = MINE_PRODUCTS[item];
    if (mp && mineProcessOpen(item, completed)) {
      const want = clamp(Math.ceil(n / (mp.rate * TARGET_MIN)), 1, 4);
      const have = mines(mp.resource, mp.recipe);
      if (have < want) wants.push({ key: `mine:${mp.resource}:${mp.recipe}`, kind: 'mine', resource: mp.resource, recipe: mp.recipe, count: want, have, why: `${n} ${item}` });
    } else if (isRaw(item) && item !== 'crude_oil' && item !== 'leaves' && item !== 'wood' && unlocked('miner_mk1', completed)) {
      // Ham kaynak: küçük ihtiyaçlar elle toplanır
      if (n < 60 && (item === 'ore_iron' || item === 'ore_copper' || item === 'limestone')) continue;
      const want = clamp(Math.ceil(n / (60 * TARGET_MIN)), 1, 3);
      const have = mines(item);
      if (have < want) wants.push({ key: `mine:${item}`, kind: 'mine', resource: item, count: want, have, why: `${n} ${item}` });
    }
  }
  // Hücreler ve petrol
  const oilRecipes = new Set<string>();
  for (const [rid, c] of Object.entries(m.crafts)) {
    const r = RECIPES[rid];
    const machine = r.machines[0];
    if (!unlocked(machine, completed)) continue;
    if (machine === 'refinery') { oilRecipes.add(rid); continue; }
    const seconds = c * r.time;
    if (r.hand && seconds < 120) continue;
    const want = clamp(Math.ceil(seconds / 60 / TARGET_MIN), 1, 3);
    const have = existing.filter((f) => f.kind === 'cell' && f.recipe === rid).length;
    if (have < want) wants.push({ key: `cell:${rid}`, kind: 'cell', recipe: rid, machine, count: want, have, why: `${c}× ${r.name}` });
  }
  if (oilRecipes.size) {
    const have = existing.filter((f) => f.kind === 'oil').length / 2;
    if (have < 1) wants.push({ key: 'oil', kind: 'oil', count: 1, have: Math.floor(have), why: [...oilRecipes].join(', ') });
  }
  return wants;
}

/** Bir hücre için verilecek girdi miktarları (makinedeki stok ve kalan ihtiyaç dikkate alınır) */
export function feedAmounts(r: RecipeDef, crafts: number, inBuf: Record<string, number>, cap = 500): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(r.inputs)) {
    const want = Math.min(cap, crafts * v) - (inBuf[k] ?? 0);
    if (want > 0) out[k] = want;
  }
  return out;
}
