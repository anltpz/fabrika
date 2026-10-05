import { BUILDINGS } from './buildings';
import { DX, DY, opposite, rotateLocal } from './grid';

export interface TrackRef {
  type: string;
  x: number;
  y: number;
  rot: number;
}

export const STATION_TRACK_LEN = 3;
export const TRAIN_SPEED = 6; // tile/sn
export const TRAIN_CAR_GAP = 1.4;
export const TRAIN_WAGONS = 2;
export const WAGON_SLOTS = 24;

/** İstasyonun ray (ön) satırındaki tile'lar; ortadaki tren durağıdır */
export function stationTrackTiles(b: TrackRef): Array<[number, number]> {
  const def = BUILDINGS[b.type];
  const out: Array<[number, number]> = [];
  for (let i = 0; i < STATION_TRACK_LEN; i++) {
    const [lx, ly] = rotateLocal(i, 0, def.w, def.h, b.rot);
    out.push([b.x + lx, b.y + ly]);
  }
  return out;
}

export function stationStopTile(b: TrackRef): [number, number] {
  return stationTrackTiles(b)[1];
}

/** Bir tile'dan hangi yönlere ray bağlantısı çıkabilir (bit maskesi). Ray değilse 0. */
export function trackDirs(x: number, y: number, at: (x: number, y: number) => TrackRef | undefined): number {
  const b = at(x, y);
  if (!b) return 0;
  if (b.type === 'rail') return 0b1111;
  if (b.type === 'train_station') {
    if (!stationTrackTiles(b).some(([tx, ty]) => tx === x && ty === y)) return 0;
    const axis = b.rot % 2; // 0: doğu-batı, 1: kuzey-güney
    return axis === 0 ? 0b0101 : 0b1010;
  }
  return 0;
}

/** Komşu ray tile'ları (iki taraf da birbirine izin veriyorsa) */
export function railNeighbors(x: number, y: number, at: (x: number, y: number) => TrackRef | undefined): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  const mine = trackDirs(x, y, at);
  for (let d = 0; d < 4; d++) {
    if (!(mine & (1 << d))) continue;
    const nx = x + DX[d], ny = y + DY[d];
    const theirs = trackDirs(nx, ny, at);
    if (theirs & (1 << opposite(d))) out.push([nx, ny, d]);
  }
  return out;
}

/** Ray ağında BFS ile en kısa yol (başlangıç hariç, hedef dahil) */
export function railPath(sx: number, sy: number, tx: number, ty: number, at: (x: number, y: number) => TrackRef | undefined, limit = 20000): Array<[number, number]> | null {
  if (sx === tx && sy === ty) return [];
  const key = (x: number, y: number) => y * 4096 + x;
  const prev = new Map<number, number>();
  prev.set(key(sx, sy), -1);
  const q: Array<[number, number]> = [[sx, sy]];
  let head = 0;
  while (head < q.length && prev.size < limit) {
    const [x, y] = q[head++];
    for (const [nx, ny] of railNeighbors(x, y, at)) {
      const k = key(nx, ny);
      if (prev.has(k)) continue;
      prev.set(k, key(x, y));
      if (nx === tx && ny === ty) {
        const path: Array<[number, number]> = [];
        let c = k;
        while (c !== key(sx, sy)) { path.push([c % 4096, Math.floor(c / 4096)]); c = prev.get(c)!; }
        return path.reverse();
      }
      q.push([nx, ny]);
    }
  }
  return null;
}
