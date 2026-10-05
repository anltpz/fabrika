import { BUILDINGS, POLE_SUPPLY_RADIUS, POLE_WIRE_RANGE, footprintSize } from '@fabrika/shared';
import type { BuildingState } from '@fabrika/shared';

export interface PowerNetwork {
  id: number;
  poles: number[];
  members: number[];
}

/** Direkleri birbirine bağlar ve güç kullanan/üreten binaları ağlara atar. */
export function computeNetworks(buildings: Iterable<BuildingState>): { nets: PowerNetwork[]; netOf: Map<number, number> } {
  const all = [...buildings];
  const poles = all.filter((b) => b.type === 'power_pole');
  const parent = new Map<number, number>();
  for (const p of poles) parent.set(p.id, p.id);
  const find = (a: number): number => {
    let r = a;
    while (parent.get(r)! !== r) r = parent.get(r)!;
    let c = a;
    while (parent.get(c)! !== r) { const n = parent.get(c)!; parent.set(c, r); c = n; }
    return r;
  };
  for (let i = 0; i < poles.length; i++) {
    for (let j = i + 1; j < poles.length; j++) {
      const a = poles[i], b = poles[j];
      if (Math.hypot(a.x - b.x, a.y - b.y) <= POLE_WIRE_RANGE) {
        const ra = find(a.id), rb = find(b.id);
        if (ra !== rb) parent.set(Math.max(ra, rb), Math.min(ra, rb));
      }
    }
  }
  const netMap = new Map<number, PowerNetwork>();
  const netOf = new Map<number, number>();
  for (const p of poles) {
    const root = find(p.id);
    let net = netMap.get(root);
    if (!net) { net = { id: root, poles: [], members: [] }; netMap.set(root, net); }
    net.poles.push(p.id);
    netOf.set(p.id, root);
  }
  const R = POLE_SUPPLY_RADIUS;
  for (const b of all) {
    const def = BUILDINGS[b.type];
    if (!def.power && !def.powerGen) continue;
    const [w, h] = footprintSize(def.w, def.h, b.rot);
    const x0 = b.x - R, x1 = b.x + w - 1 + R, y0 = b.y - R, y1 = b.y + h - 1 + R;
    for (const p of poles) {
      if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1) {
        const root = find(p.id);
        netOf.set(b.id, root);
        netMap.get(root)!.members.push(b.id);
        break;
      }
    }
  }
  return { nets: [...netMap.values()], netOf };
}
