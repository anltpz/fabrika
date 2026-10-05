/**
 * Tile ızgarasında A* yol bulma (4 yönlü). Botlar ışınlanmadan yürüyerek gezer.
 */

export interface NavGrid {
  size: number;
  /** Tile yürünemezse true */
  blocked: (x: number, y: number) => boolean;
  /** Ek maliyet (ör. böcek yuvası yakınları); 0 = normal */
  extraCost?: (x: number, y: number) => number;
}

class MinHeap {
  private a: Array<[number, number]> = [];
  get size() { return this.a.length; }
  push(k: number, f: number) {
    const a = this.a;
    a.push([k, f]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][1] <= a[i][1]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): number {
    const a = this.a;
    const top = a[0][0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l][1] < a[m][1]) m = l;
        if (r < a.length && a[r][1] < a[m][1]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * (sx,sy)'den hedefe en kısa yol. `goal` hedefe "yeterince yakın" tile'ları kabul eder (ör. etkileşim menzili).
 * Dönüş: tile merkezleri listesi (başlangıç hariç) ya da yol yoksa null.
 */
export function findPath(
  grid: NavGrid,
  sx: number,
  sy: number,
  goal: (x: number, y: number) => boolean,
  hx: number,
  hy: number,
  maxNodes = 40000,
): Array<[number, number]> | null {
  const S = grid.size;
  const start = sy * S + sx;
  if (goal(sx, sy)) return [];
  const g = new Map<number, number>([[start, 0]]);
  const prev = new Map<number, number>();
  const open = new MinHeap();
  const h = (x: number, y: number) => Math.abs(x - hx) + Math.abs(y - hy);
  open.push(start, h(sx, sy));
  const closed = new Set<number>();
  while (open.size && closed.size < maxNodes) {
    const cur = open.pop();
    if (closed.has(cur)) continue;
    closed.add(cur);
    const cx = cur % S, cy = (cur - cx) / S;
    if (goal(cx, cy)) {
      const path: Array<[number, number]> = [];
      let c = cur;
      while (c !== start) { path.push([c % S, Math.floor(c / S)]); c = prev.get(c)!; }
      return path.reverse();
    }
    const gc = g.get(cur)!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= S || ny >= S) continue;
      const nk = ny * S + nx;
      if (closed.has(nk) || grid.blocked(nx, ny)) continue;
      const ng = gc + 1 + (grid.extraCost?.(nx, ny) ?? 0);
      if (ng < (g.get(nk) ?? Infinity)) {
        g.set(nk, ng);
        prev.set(nk, cur);
        open.push(nk, ng + h(nx, ny));
      }
    }
  }
  return null;
}

/** Ardışık aynı yöndeki adımları birleştirip ara noktaları azaltır */
export function simplifyPath(path: Array<[number, number]>): Array<[number, number]> {
  if (path.length < 3) return path;
  const out: Array<[number, number]> = [];
  for (let i = 0; i < path.length; i++) {
    const p = path[i - 1], c = path[i], n = path[i + 1];
    if (!p || !n) { out.push(c); continue; }
    const d1 = [c[0] - p[0], c[1] - p[1]], d2 = [n[0] - c[0], n[1] - c[1]];
    if (d1[0] !== d2[0] || d1[1] !== d2[1]) out.push(c);
  }
  return out;
}
