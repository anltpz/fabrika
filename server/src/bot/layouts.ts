/**
 * Botların kurduğu tesislerin yerleşim şablonları (saf fonksiyonlar, test edilebilir).
 *
 * Şablonlar doğuya akan yerel koordinatlarda tanımlanır, sonra 4 yönden birine döndürülüp dünyaya taşınır.
 * Dönüş kuralı oyunla aynıdır: rot 1 = saat yönünde 90° (doğu → güney).
 */
import { BUILDINGS, footprintSize } from '@fabrika/shared';

export interface Part {
  type: string;
  x: number;
  y: number;
  rot: number;
  recipe?: string;
}

export interface Layout {
  kind: 'mine' | 'cell' | 'coal' | 'oil' | 'burner' | 'depot';
  parts: Part[];
  /** Kapsayan dikdörtgen (dahil) */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const T = [
  (x: number, y: number): [number, number] => [x, y],
  (x: number, y: number): [number, number] => [-y, x],
  (x: number, y: number): [number, number] => [-x, -y],
  (x: number, y: number): [number, number] => [y, -x],
];

/** Yerel parçaları k*90° döndürüp (ox,oy)'ye taşır */
export function transform(parts: Part[], k: number, ox: number, oy: number): Part[] {
  const t = T[k & 3];
  return parts.map((p) => {
    const def = BUILDINGS[p.type];
    const [w, h] = footprintSize(def.w, def.h, p.rot);
    const [ax, ay] = t(p.x, p.y);
    const [bx, by] = t(p.x + w - 1, p.y + h - 1);
    return { ...p, x: Math.min(ax, bx) + ox, y: Math.min(ay, by) + oy, rot: (p.rot + k) & 3 };
  });
}

export function partTiles(p: Part): Array<[number, number]> {
  const def = BUILDINGS[p.type];
  const [w, h] = footprintSize(def.w, def.h, p.rot);
  const out: Array<[number, number]> = [];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) out.push([p.x + i, p.y + j]);
  return out;
}

function finish(kind: Layout['kind'], parts: Part[]): Layout {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of parts) for (const [x, y] of partTiles(p)) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return { kind, parts, x0, y0, x1, y1 };
}

const P = (type: string, x: number, y: number, rot = 0, recipe?: string): Part => ({ type, x, y, rot, recipe });

/** Kaynak düğümünde kullanılacak makine (işlem tarifi varsa) */
export function processMachine(recipe: string): string {
  return recipe === 'concrete' ? 'constructor' : 'smelter';
}

/**
 * Maden: çıkarıcı → bant → [işlem makinesi → bant] → depo, ortada direk.
 * Yerel (0,0) düğümdür; (mx,my) ∈ {0,-1}² çıkarıcının düğüme göre konumu.
 */
export function mineLocal(mx: number, my: number, recipe?: string): Part[] {
  const parts: Part[] = [P('miner_mk1', mx, my), P('belt_mk1', mx + 2, my, 0), P('power_pole', mx + 2, my + 1)];
  if (recipe) {
    parts.push(P(processMachine(recipe), mx + 3, my, 0, recipe), P('belt_mk1', mx + 5, my, 0), P('storage', mx + 6, my));
  } else {
    parts.push(P('storage', mx + 3, my));
  }
  return parts;
}

/** Hücre: elle beslenen makine → bant → depo; direk bandın altında */
export function cellLocal(machine: string, recipe: string): Part[] {
  const w = BUILDINGS[machine].w;
  return [P(machine, 0, 0, 0, recipe), P('belt_mk1', w, 0, 0), P('power_pole', w, 1), P('storage', w + 1, 0)];
}

/** Kömür santrali: kömür madeni → bant → ayırıcı → 3 kömür jeneratörü */
export function coalLocal(mx: number, my: number): Part[] {
  const x = mx, y = my;
  return [
    P('miner_mk1', x, y),
    P('belt_mk1', x + 2, y, 0),
    P('power_pole', x + 2, y + 1),
    P('splitter', x + 3, y, 0),
    P('coal_generator', x + 4, y),
    P('belt_mk1', x + 3, y - 1, 3),
    P('belt_mk1', x + 3, y - 2, 0),
    P('coal_generator', x + 4, y - 2),
    P('belt_mk1', x + 3, y + 1, 1),
    P('belt_mk1', x + 3, y + 2, 0),
    P('coal_generator', x + 4, y + 2),
  ];
}

/** Petrol: kuyu → boru sütunu → iki rafineri (plastik, kauçuk) → bant → depo */
export function oilLocal(mx: number, my: number): Part[] {
  const x = mx, y = my;
  return [
    P('oil_extractor', x, y),
    P('pipe', x + 2, y), P('pipe', x + 2, y + 1), P('pipe', x + 2, y + 2),
    P('refinery', x + 3, y, 0, 'plastic'), P('belt_mk1', x + 6, y, 0), P('storage', x + 7, y),
    P('refinery', x + 3, y + 2, 0, 'rubber'), P('belt_mk1', x + 6, y + 2, 0), P('storage', x + 7, y + 2),
    P('power_pole', x + 6, y + 1),
  ];
}

/** Biyokütle jeneratörü + direk */
export function burnerLocal(): Part[] {
  return [P('biomass_burner', 0, 0), P('power_pole', 2, 0)];
}

export function depotLocal(): Part[] {
  return [P('storage', 0, 0)];
}

/** Düğüm üzerine kurulan tesisler için tüm aday yerleşimler (4 yön × 4 çıkarıcı konumu) */
export function nodeLayouts(kind: 'mine' | 'coal' | 'oil', nx: number, ny: number, recipe?: string): Layout[] {
  const out: Layout[] = [];
  for (const k of [0, 1, 2, 3]) {
    for (const [mx, my] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) {
      const local = kind === 'mine' ? mineLocal(mx, my, recipe) : kind === 'coal' ? coalLocal(mx, my) : oilLocal(mx, my);
      out.push(finish(kind, transform(local, k, nx, ny)));
    }
  }
  return out;
}

/** Düğümsüz tesis: (ox,oy) konumunda, doğuya bakan */
export function placeLayout(kind: 'cell' | 'burner' | 'depot', ox: number, oy: number, machine?: string, recipe?: string): Layout {
  const local = kind === 'cell' ? cellLocal(machine!, recipe!) : kind === 'burner' ? burnerLocal() : depotLocal();
  return finish(kind, transform(local, 0, ox, oy));
}

export type TileState = 'free' | 'tree' | 'blocked';

/**
 * Yerleşim uygun mu? Parçaların altı boş (veya kesilecek ağaç) olmalı, düğümler yalnızca çıkarıcının altında olabilir,
 * çevresinde 1 tile'lık şeritte yürünemez yapı olmamalı.
 */
export function layoutFits(
  l: Layout,
  tile: (x: number, y: number) => TileState,
  isNode: (x: number, y: number) => boolean,
  ringBlocked: (x: number, y: number) => boolean,
): { ok: boolean; trees: Array<[number, number]> } {
  const trees: Array<[number, number]> = [];
  const covered = new Set<number>();
  for (const p of l.parts) {
    const onNode = !!(BUILDINGS[p.type].mineRate || BUILDINGS[p.type].pumpRate);
    for (const [x, y] of partTiles(p)) {
      covered.add(y * 4096 + x);
      const s = tile(x, y);
      if (s === 'blocked') return { ok: false, trees };
      if (s === 'tree') trees.push([x, y]);
      if (isNode(x, y) && !onNode) return { ok: false, trees };
    }
  }
  for (let y = l.y0 - 1; y <= l.y1 + 1; y++) for (let x = l.x0 - 1; x <= l.x1 + 1; x++) {
    if (covered.has(y * 4096 + x)) continue;
    if (ringBlocked(x, y)) return { ok: false, trees };
  }
  return { ok: true, trees };
}
