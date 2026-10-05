import {
  BUILDINGS,
  DT,
  TRAIN_CAR_GAP,
  TRAIN_SPEED,
  TRAIN_WAGONS,
  WAGON_SLOTS,
  addItem,
  makeInventory,
  railPath,
  stationStopTile,
  trackDirs,
} from '@fabrika/shared';
import type { BuildingState, Inventory, TrainInfo } from '@fabrika/shared';

export interface Train {
  id: number;
  tx: number;
  ty: number;
  path: Array<[number, number]> | null;
  progress: number;
  schedule: number[];
  stop: number;
  state: TrainInfo['state'];
  waitT: number;
  idleT: number;
  retryT: number;
  cargo: Inventory;
  trail: Array<[number, number]>;
  x: number;
  y: number;
  angle: number;
}

export interface TrainHost {
  buildings: Map<number, BuildingState>;
  buildingAt(x: number, y: number): BuildingState | undefined;
}

export function newTrain(id: number, x: number, y: number): Train {
  return {
    id, tx: x, ty: y, path: null, progress: 0, schedule: [], stop: 0, state: 'idle', waitT: 0, idleT: 0, retryT: 0,
    cargo: makeInventory(WAGON_SLOTS * TRAIN_WAGONS), trail: [[x + 0.5, y + 0.5]], x: x + 0.5, y: y + 0.5, angle: 0,
  };
}

/** Ön kabin, vagonlar ve arka kabinin konumları: [x, y, açı] (baştan sona) */
export function carPositions(t: Train): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [[t.x, t.y, t.angle]];
  const pts: Array<[number, number]> = [[t.x, t.y], ...[...t.trail].reverse()];
  let seg = 0;
  let acc = 0;
  for (let car = 1; car <= TRAIN_WAGONS + 1; car++) {
    const want = TRAIN_CAR_GAP * car;
    let placed = false;
    while (seg < pts.length - 1) {
      const [ax, ay] = pts[seg], [bx, by] = pts[seg + 1];
      const len = Math.hypot(bx - ax, by - ay);
      if (acc + len >= want) {
        const k = len > 0 ? (want - acc) / len : 0;
        out.push([ax + (bx - ax) * k, ay + (by - ay) * k, Math.atan2(ay - by, ax - bx)]);
        placed = true;
        break;
      }
      acc += len;
      seg++;
    }
    if (!placed) {
      const last = out[out.length - 1];
      out.push([last[0], last[1], last[2]]);
    }
  }
  return out;
}

export function occupiedTiles(t: Train): Set<number> {
  const s = new Set<number>();
  for (const [x, y] of carPositions(t)) s.add(Math.floor(y) * 4096 + Math.floor(x));
  s.add(t.ty * 4096 + t.tx);
  return s;
}

/** Bir tick: hareket, istasyonda yükleme/boşaltma. Değişiklik olduysa true döner. */
export function stepTrain(t: Train, host: TrainHost, others: Train[]): boolean {
  const at = (x: number, y: number) => host.buildingAt(x, y);
  const before = `${t.state}:${t.stop}`;
  let cargoChanged = false;
  t.schedule = t.schedule.filter((id) => host.buildings.get(id)?.type === 'train_station');
  if (!trackDirs(t.tx, t.ty, at)) { t.state = 'nopath'; return before !== `${t.state}:${t.stop}`; }
  if (!t.schedule.length) { t.state = 'idle'; t.path = null; return before !== `${t.state}:${t.stop}`; }
  t.stop %= t.schedule.length;
  const station = host.buildings.get(t.schedule[t.stop])!;
  const [sx, sy] = stationStopTile(station);

  if (t.state === 'loading') {
    t.waitT += DT;
    let moved = 0;
    if (station.mode === 'unload') {
      for (let i = 0; i < t.cargo.length && moved < 4; i++) {
        const s = t.cargo[i];
        if (!s) continue;
        const n = Math.min(s.count, 4 - moved);
        const left = addItem(station.storage!, s.item, n);
        const put = n - left;
        if (put > 0) { s.count -= put; moved += put; if (s.count <= 0) t.cargo[i] = null; }
      }
    } else {
      for (let i = 0; i < station.storage!.length && moved < 4; i++) {
        const s = station.storage![i];
        if (!s) continue;
        const n = Math.min(s.count, 4 - moved);
        const left = addItem(t.cargo, s.item, n);
        const took = n - left;
        if (took > 0) { s.count -= took; moved += took; if (s.count <= 0) station.storage![i] = null; }
      }
    }
    if (moved > 0) { t.idleT = 0; cargoChanged = true; } else t.idleT += DT;
    if ((t.waitT > 2 && t.idleT > 1.5) || t.waitT > 30) {
      t.stop = (t.stop + 1) % t.schedule.length;
      t.state = 'moving';
      t.path = null;
    }
    return cargoChanged || before !== `${t.state}:${t.stop}`;
  }

  // Hareket
  if (!t.path) {
    t.retryT -= DT;
    if (t.retryT > 0) return false;
    t.path = railPath(t.tx, t.ty, sx, sy, at);
    if (!t.path) { t.state = 'nopath'; t.retryT = 1; return before !== `${t.state}:${t.stop}`; }
    t.progress = 0;
    // Gidilecek yön arkadaysa tren yön değiştirir: arka kabin ön olur
    if (t.path.length) {
      const cars = carPositions(t);
      const [nx0, ny0] = t.path[0];
      const c1 = cars[1];
      const behind = Math.hypot(c1[0] - (nx0 + 0.5), c1[1] - (ny0 + 0.5)) < Math.hypot(t.x - (nx0 + 0.5), t.y - (ny0 + 0.5)) - 0.05;
      if (behind && Math.hypot(c1[0] - t.x, c1[1] - t.y) > 0.5) {
        const rear = cars[cars.length - 1];
        t.trail = cars.slice(0, -1).map(([x, y]) => [x, y] as [number, number]);
        t.x = rear[0];
        t.y = rear[1];
        t.angle = rear[2] + Math.PI;
        t.tx = Math.floor(rear[0]);
        t.ty = Math.floor(rear[1]);
        t.path = railPath(t.tx, t.ty, sx, sy, at);
        if (!t.path) { t.state = 'nopath'; t.retryT = 1; return true; }
      }
    }
  }
  if (!t.path.length) {
    t.state = 'loading';
    t.waitT = 0;
    t.idleT = 0;
    t.path = null;
    return true;
  }
  const [nx, ny] = t.path[0];
  if (!trackDirs(nx, ny, at)) { t.path = null; t.retryT = 0.5; t.state = 'nopath'; return before !== `${t.state}:${t.stop}`; }
  const nk = ny * 4096 + nx;
  if (others.some((o) => o !== t && occupiedTiles(o).has(nk))) { t.state = 'blocked'; return before !== `${t.state}:${t.stop}`; }
  t.state = 'moving';
  t.progress += TRAIN_SPEED * DT;
  while (t.progress >= 1 && t.path.length) {
    const [px, py] = t.path.shift()!;
    t.tx = px;
    t.ty = py;
    t.progress -= 1;
  }
  const next = t.path[0];
  const hx = next ? t.tx + 0.5 + (next[0] - t.tx) * t.progress : t.tx + 0.5;
  const hy = next ? t.ty + 0.5 + (next[1] - t.ty) * t.progress : t.ty + 0.5;
  if (Math.hypot(hx - t.x, hy - t.y) > 1e-4) t.angle = Math.atan2(hy - t.y, hx - t.x);
  t.x = hx;
  t.y = hy;
  const last = t.trail[t.trail.length - 1];
  if (!last || Math.hypot(last[0] - hx, last[1] - hy) > 0.15) {
    t.trail.push([hx, hy]);
    if (t.trail.length > 80) t.trail.shift();
  }
  if (!t.path.length) t.progress = 0;
  return before !== `${t.state}:${t.stop}`;
}

export function trainInfo(t: Train): TrainInfo {
  return { id: t.id, schedule: t.schedule, stop: t.stop, state: t.state, cargo: t.cargo };
}

export function stationsReachable(x: number, y: number, host: TrainHost): number[] {
  const at = (ax: number, ay: number) => host.buildingAt(ax, ay);
  return [...host.buildings.values()]
    .filter((b) => b.type === 'train_station')
    .filter((b) => { const [sx, sy] = stationStopTile(b); return railPath(x, y, sx, sy, at) !== null; })
    .map((b) => b.id)
    .sort((a, b) => a - b);
}

export const TRAIN_COST = BUILDINGS.locomotive.cost;
