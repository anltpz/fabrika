/** Yön: 0=Doğu, 1=Güney, 2=Batı, 3=Kuzey */
export type Dir = 0 | 1 | 2 | 3;
export const DX = [1, 0, -1, 0] as const;
export const DY = [0, 1, 0, -1] as const;

export function rotDir(d: number, r: number): Dir {
  return (((d + r) % 4) + 4) % 4 as Dir;
}

export function opposite(d: number): Dir {
  return rotDir(d, 2);
}

/** w×h boyutlu tanımın r dönüşündeki yerel (lx,ly) koordinatını döndürür */
export function rotateLocal(lx: number, ly: number, w: number, h: number, r: number): [number, number] {
  switch (r & 3) {
    case 0: return [lx, ly];
    case 1: return [h - 1 - ly, lx];
    case 2: return [w - 1 - lx, h - 1 - ly];
    default: return [ly, w - 1 - lx];
  }
}

export function footprintSize(w: number, h: number, r: number): [number, number] {
  return r & 1 ? [h, w] : [w, h];
}

export function tileKey(x: number, y: number): number {
  return y * 4096 + x;
}

export function keyToTile(k: number): [number, number] {
  return [k % 4096, Math.floor(k / 4096)];
}
