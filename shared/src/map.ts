import { MAP_SIZE } from './constants';
import { tileKey } from './grid';

export enum Terrain {
  Grass = 0,
  Sand = 1,
  Water = 2,
  Rock = 3,
}

export type Purity = 'impure' | 'normal' | 'pure';
export const PURITY_MULT: Record<Purity, number> = { impure: 0.5, normal: 1, pure: 2 };
export const PURITY_NAMES: Record<Purity, string> = { impure: 'Saf Olmayan', normal: 'Normal', pure: 'Saf' };

export interface ResourceNode {
  x: number;
  y: number;
  item: string;
  purity: Purity;
}

export interface LootSpot {
  id: number;
  x: number;
  y: number;
  tier: number;
}

export interface NestSpawn {
  id: number;
  x: number;
  y: number;
}

export interface GameMap {
  seed: number;
  size: number;
  terrain: Uint8Array;
  trees: Uint8Array;
  nodes: ResourceNode[];
  nodeAt: Map<number, ResourceNode>;
  nests: NestSpawn[];
  loot: LootSpot[];
  spawn: { x: number; y: number };
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  const u = smooth(xf), v = smooth(yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x: number, y: number, seed: number, octaves = 4): number {
  let sum = 0, amp = 0.5, freq = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise(x * freq, y * freq, seed + o * 1013) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

/** [eşya, adet, başlangıca en az uzaklık] */
const NODE_COUNTS: Array<[string, number, number]> = [
  ['ore_iron', 45, 16],
  ['ore_copper', 35, 16],
  ['limestone', 35, 16],
  ['coal', 25, 16],
  ['sulfur', 12, 45],
  ['quartz', 15, 45],
  ['bauxite', 15, 50],
  ['crude_oil', 12, 40],
];

export function generateMap(seed: number, size = MAP_SIZE): GameMap {
  const terrain = new Uint8Array(size * size);
  const trees = new Uint8Array(size * size);
  const cx = Math.floor(size / 2), cy = Math.floor(size / 2);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const e = fbm(x / 48, y / 48, seed);
      const m = fbm(x / 32 + 100, y / 32 + 100, seed + 77);
      const dc = Math.hypot(x - cx, y - cy);
      const edge = Math.min(x, y, size - 1 - x, size - 1 - y);
      let t: Terrain = Terrain.Grass;
      if (edge < 3 || e < 0.33) t = Terrain.Water;
      else if (e < 0.37) t = Terrain.Sand;
      else if (e > 0.7) t = Terrain.Rock;
      if (dc < 22) t = Terrain.Grass;
      terrain[y * size + x] = t;
      if (t === Terrain.Grass && dc > 10) {
        const density = m > 0.58 ? 0.55 : m > 0.5 ? 0.12 : 0.02;
        if (hash2(x, y, seed + 991) < density) trees[y * size + x] = 1;
      }
    }
  }

  const rand = mulberry32(seed ^ 0x9e3779b9);
  const nodes: ResourceNode[] = [];
  const nodeAt = new Map<number, ResourceNode>();

  const clearAround = (x: number, y: number, r: number) => {
    for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
      const xx = x + i, yy = y + j;
      if (xx < 3 || yy < 3 || xx >= size - 3 || yy >= size - 3) continue;
      const idx = yy * size + xx;
      if (terrain[idx] === Terrain.Water || terrain[idx] === Terrain.Rock) terrain[idx] = Terrain.Grass;
      trees[idx] = 0;
    }
  };
  const farFromNodes = (x: number, y: number, d: number) => nodes.every((n) => Math.abs(n.x - x) > d || Math.abs(n.y - y) > d);
  const addNode = (x: number, y: number, item: string, purity: Purity) => {
    clearAround(x, y, 2);
    const n: ResourceNode = { x, y, item, purity };
    nodes.push(n);
    nodeAt.set(tileKey(x, y), n);
  };

  // Başlangıç bölgesi garantisi: düğümlerin etrafında fabrika kuracak yer olsun
  const addStarter = (x: number, y: number, item: string, purity: Purity) => {
    addNode(x, y, item, purity);
    clearAround(x, y, 5);
  };
  addStarter(cx + 9, cy - 4, 'ore_iron', 'normal');
  addStarter(cx + 10, cy + 4, 'ore_iron', 'impure');
  addStarter(cx - 9, cy + 3, 'ore_copper', 'normal');
  addStarter(cx + 2, cy + 10, 'limestone', 'normal');
  addStarter(cx - 3, cy - 10, 'limestone', 'impure');

  // Yakında bir kömür düğümü
  {
    const a = rand() * Math.PI * 2;
    addNode(Math.round(cx + Math.cos(a) * 28), Math.round(cy + Math.sin(a) * 28), 'coal', 'normal');
  }

  for (const [item, count, minDist] of NODE_COUNTS) {
    let placed = 0, tries = 0;
    while (placed < count && tries < count * 60) {
      tries++;
      const x = 6 + Math.floor(rand() * (size - 12));
      const y = 6 + Math.floor(rand() * (size - 12));
      const t = terrain[y * size + x];
      if (t === Terrain.Water || t === Terrain.Rock) continue;
      if (Math.hypot(x - cx, y - cy) < minDist) continue;
      if (!farFromNodes(x, y, 4)) continue;
      const r = rand();
      const purity: Purity = r < 0.4 ? 'impure' : r < 0.85 ? 'normal' : 'pure';
      addNode(x, y, item, purity);
      placed++;
    }
  }

  const nests: NestSpawn[] = [];
  let tries = 0;
  while (nests.length < 14 && tries < 3000) {
    tries++;
    const x = 8 + Math.floor(rand() * (size - 16));
    const y = 8 + Math.floor(rand() * (size - 16));
    if (terrain[y * size + x] !== Terrain.Grass) continue;
    if (Math.hypot(x - cx, y - cy) < 38) continue;
    if (nests.some((n) => Math.hypot(n.x - x, n.y - y) < 25)) continue;
    if (!farFromNodes(x, y, 3)) continue;
    clearAround(x, y, 1);
    nests.push({ id: nests.length, x, y });
  }

  // Düşmüş kargolar (keşif ödülleri)
  const loot: LootSpot[] = [];
  tries = 0;
  while (loot.length < 22 && tries < 4000) {
    tries++;
    const x = 8 + Math.floor(rand() * (size - 16));
    const y = 8 + Math.floor(rand() * (size - 16));
    const t = terrain[y * size + x];
    if (t !== Terrain.Grass && t !== Terrain.Sand) continue;
    const d = Math.hypot(x - cx, y - cy);
    if (d < 30) continue;
    if (loot.some((l) => Math.hypot(l.x - x, l.y - y) < 18)) continue;
    if (!farFromNodes(x, y, 3) || nests.some((n) => Math.hypot(n.x - x, n.y - y) < 6)) continue;
    clearAround(x, y, 1);
    loot.push({ id: loot.length, x, y, tier: d < 60 ? 0 : d < 95 ? 1 : 2 });
  }

  return { seed, size, terrain, trees, nodes, nodeAt, nests, loot, spawn: { x: cx, y: cy } };
}

export function terrainBuildable(map: GameMap, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= map.size || y >= map.size) return false;
  const t = map.terrain[y * map.size + x];
  return t === Terrain.Grass || t === Terrain.Sand;
}

export function hasTree(map: GameMap, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= map.size || y >= map.size) return false;
  return map.trees[y * map.size + x] === 1;
}

export const LOOT_TABLES: Array<Record<string, number>> = [
  { iron_plate: 40, iron_rod: 40, wire: 60, concrete: 40 },
  { reinforced_plate: 15, rotor: 8, cable: 60, steel_beam: 20 },
  { modular_frame: 10, motor: 4, steel_pipe: 40, explosive: 8 },
];

export function fogIndex(x: number, y: number, size: number, cell: number): number {
  const cols = Math.ceil(size / cell);
  return Math.floor(y / cell) * cols + Math.floor(x / cell);
}
