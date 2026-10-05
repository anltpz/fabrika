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

const NODE_COUNTS: Array<[string, number]> = [
  ['ore_iron', 45],
  ['ore_copper', 35],
  ['limestone', 35],
  ['coal', 25],
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

  for (const [item, count] of NODE_COUNTS) {
    let placed = 0, tries = 0;
    while (placed < count && tries < count * 60) {
      tries++;
      const x = 6 + Math.floor(rand() * (size - 12));
      const y = 6 + Math.floor(rand() * (size - 12));
      const t = terrain[y * size + x];
      if (t === Terrain.Water || t === Terrain.Rock) continue;
      if (Math.hypot(x - cx, y - cy) < 16) continue;
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

  return { seed, size, terrain, trees, nodes, nodeAt, nests, spawn: { x: cx, y: cy } };
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
