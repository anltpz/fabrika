import { BUILDINGS, DX, DY, footprint, worldPorts } from '@fabrika/shared';
import type { BuildingState } from '@fabrika/shared';

export interface FluidNetwork {
  id: number;
  /** Borular ve depolar */
  members: number[];
  fluid: string | null;
  amount: number;
  capacity: number;
}

export interface FluidGraph {
  nets: Map<number, FluidNetwork>;
  /** Bina sıvı portu -> hat: `${binaId}:in:${i}` / `${binaId}:out:${i}` */
  portNet: Map<string, number>;
  memberNet: Map<number, number>;
}

/** Boruları ve depoları birbirine bağlar, binaların sıvı portlarını hatlara atar. */
export function computeFluidNetworks(buildings: Iterable<BuildingState>, at: (x: number, y: number) => BuildingState | undefined): FluidGraph {
  const all = [...buildings];
  const containers = all.filter((b) => BUILDINGS[b.type].fluidAll);
  const parent = new Map<number, number>();
  for (const c of containers) parent.set(c.id, c.id);
  const find = (a: number): number => {
    let r = a;
    while (parent.get(r)! !== r) r = parent.get(r)!;
    let c = a;
    while (parent.get(c)! !== r) { const n = parent.get(c)!; parent.set(c, r); c = n; }
    return r;
  };
  for (const c of containers) {
    for (const [x, y] of footprint(c.type, c.x, c.y, c.rot)) {
      for (let d = 0; d < 4; d++) {
        const n = at(x + DX[d], y + DY[d]);
        if (!n || n.id === c.id || !BUILDINGS[n.type].fluidAll) continue;
        const ra = find(c.id), rb = find(n.id);
        if (ra !== rb) parent.set(Math.max(ra, rb), Math.min(ra, rb));
      }
    }
  }
  const nets = new Map<number, FluidNetwork>();
  const memberNet = new Map<number, number>();
  for (const c of containers) {
    const root = find(c.id);
    let net = nets.get(root);
    if (!net) { net = { id: root, members: [], fluid: null, amount: 0, capacity: 0 }; nets.set(root, net); }
    net.members.push(c.id);
    net.capacity += BUILDINGS[c.type].fluidCap ?? 0;
    memberNet.set(c.id, root);
  }
  // Kayıtlı içerikleri topla (karışık sıvı varsa en çok olan kalır)
  for (const net of nets.values()) {
    const byFluid = new Map<string, number>();
    for (const id of net.members) {
      const c = containers.find((x) => x.id === id)!;
      if (c.fluidType && (c.fluidAmt ?? 0) > 0) byFluid.set(c.fluidType, (byFluid.get(c.fluidType) ?? 0) + c.fluidAmt!);
    }
    let best: string | null = null;
    for (const [f, a] of byFluid) if (!best || a > byFluid.get(best)!) best = f;
    net.fluid = best;
    net.amount = best ? Math.min(net.capacity, byFluid.get(best)!) : 0;
  }
  const portNet = new Map<string, number>();
  for (const b of all) {
    const def = BUILDINGS[b.type];
    if (def.fluidAll) continue;
    for (const kind of ['fluidIn', 'fluidOut'] as const) {
      worldPorts(b.type, b.x, b.y, b.rot, kind).forEach((p, i) => {
        const n = at(p.x + DX[p.dir], p.y + DY[p.dir]);
        if (n && BUILDINGS[n.type].fluidAll) portNet.set(`${b.id}:${kind === 'fluidIn' ? 'in' : 'out'}:${i}`, memberNet.get(n.id)!);
      });
    }
  }
  return { nets, portNet, memberNet };
}
