import { BUILDINGS } from './buildings';
import { footprintSize } from './grid';

export interface BlueprintEntry {
  type: string;
  dx: number;
  dy: number;
  rot: number;
  recipe?: string;
  filters?: string[];
}

export interface Blueprint {
  id: number;
  name: string;
  author: string;
  w: number;
  h: number;
  entries: BlueprintEntry[];
}

export const BLUEPRINT_MAX_SIZE = 40;
export const BLUEPRINT_MAX_COUNT = 50;

/** Planı r kez saat yönünde 90° döndürür */
export function rotateBlueprint(bp: { w: number; h: number; entries: BlueprintEntry[] }, r: number): { w: number; h: number; entries: BlueprintEntry[] } {
  let { w, h } = bp;
  let entries = bp.entries.map((e) => ({ ...e }));
  for (let i = 0; i < (((r % 4) + 4) % 4); i++) {
    entries = entries.map((e) => {
      const def = BUILDINGS[e.type];
      const [, fh] = footprintSize(def.w, def.h, e.rot);
      return { ...e, dx: h - (e.dy + fh), dy: e.dx, rot: (e.rot + 1) % 4 };
    });
    [w, h] = [h, w];
  }
  return { w, h, entries };
}

export function blueprintCost(entries: BlueprintEntry[]): Record<string, number> {
  const cost: Record<string, number> = {};
  for (const e of entries) for (const [k, v] of Object.entries(BUILDINGS[e.type]?.cost ?? {})) cost[k] = (cost[k] ?? 0) + v;
  return cost;
}
