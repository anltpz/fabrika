import { CHUNK_SIZE, ITEMS, Terrain } from '@fabrika/shared';
import type { GameMap, ResourceNode } from '@fabrika/shared';

export const TEX_PX = 16; // chunk dokusunda tile başına piksel

function hash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function rgb(c: number, f = 1): string {
  const r = Math.min(255, Math.max(0, ((c >> 16) & 255) * f)) | 0;
  const g = Math.min(255, Math.max(0, ((c >> 8) & 255) * f)) | 0;
  const b = Math.min(255, Math.max(0, (c & 255) * f)) | 0;
  return `rgb(${r},${g},${b})`;
}

const BASE: Record<number, number> = {
  [Terrain.Grass]: 0x4f7d3c,
  [Terrain.Sand]: 0xc8b47a,
  [Terrain.Water]: 0x2d5f8c,
  [Terrain.Rock]: 0x6b6a66,
};

/** Bir chunk'ı canvas'a çizer */
export function drawChunk(canvas: HTMLCanvasElement, map: GameMap, cx: number, cy: number) {
  const P = TEX_PX;
  canvas.width = canvas.height = CHUNK_SIZE * P;
  const g = canvas.getContext('2d')!;
  const x0 = cx * CHUNK_SIZE, y0 = cy * CHUNK_SIZE;
  const S = map.size;
  // Zemin
  for (let j = 0; j < CHUNK_SIZE; j++) {
    for (let i = 0; i < CHUNK_SIZE; i++) {
      const x = x0 + i, y = y0 + j;
      if (x >= S || y >= S) continue;
      const t = map.terrain[y * S + x];
      const h = hash(x, y);
      g.fillStyle = rgb(BASE[t], 0.92 + h * 0.16);
      g.fillRect(i * P, j * P, P, P);
      if (t === Terrain.Grass) {
        g.fillStyle = rgb(0x6a9a48, 0.9 + h * 0.2);
        for (let k = 0; k < 3; k++) {
          const hx = hash(x * 7 + k, y * 13 - k);
          const hy = hash(x * 11 - k, y * 5 + k);
          g.fillRect(i * P + hx * (P - 2), j * P + hy * (P - 3), 1, 3);
        }
      } else if (t === Terrain.Water) {
        g.strokeStyle = 'rgba(160,200,240,0.25)';
        g.lineWidth = 1;
        g.beginPath();
        const wy = j * P + 4 + h * 8;
        g.moveTo(i * P + 2, wy);
        g.quadraticCurveTo(i * P + P / 2, wy - 2, i * P + P - 2, wy);
        g.stroke();
        // Kıyı köpüğü
        const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (const [dx, dy] of nb) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= S || yy >= S) continue;
          if (map.terrain[yy * S + xx] !== Terrain.Water) {
            g.fillStyle = 'rgba(220,235,245,0.35)';
            if (dx === 1) g.fillRect(i * P + P - 2, j * P, 2, P);
            if (dx === -1) g.fillRect(i * P, j * P, 2, P);
            if (dy === 1) g.fillRect(i * P, j * P + P - 2, P, 2);
            if (dy === -1) g.fillRect(i * P, j * P, P, 2);
          }
        }
      } else if (t === Terrain.Rock) {
        g.fillStyle = rgb(0x4a4946, 1);
        if (h > 0.5) g.fillRect(i * P + h * 8, j * P + 3, 3, 2);
        g.fillStyle = rgb(0x8a8984, 1);
        g.fillRect(i * P + 2 + h * 6, j * P + 8 + h * 4, 4, 2);
      } else if (t === Terrain.Sand && h > 0.7) {
        g.fillStyle = rgb(0xa8945a, 1);
        g.fillRect(i * P + h * 10, j * P + h * 12, 2, 1);
      }
    }
  }
  // Kaynak düğümleri
  for (const n of map.nodes) {
    if (n.x < x0 - 1 || n.y < y0 - 1 || n.x > x0 + CHUNK_SIZE || n.y > y0 + CHUNK_SIZE) continue;
    drawNode(g, n, (n.x - x0) * P, (n.y - y0) * P, P);
  }
  // Ağaçlar
  for (let j = -1; j <= CHUNK_SIZE; j++) {
    for (let i = -1; i <= CHUNK_SIZE; i++) {
      const x = x0 + i, y = y0 + j;
      if (x < 0 || y < 0 || x >= S || y >= S) continue;
      if (!map.trees[y * S + x]) continue;
      drawTree(g, i * P + P / 2, j * P + P / 2, P, hash(x, y));
    }
  }
}

function drawTree(g: CanvasRenderingContext2D, cx: number, cy: number, P: number, h: number) {
  const r = P * (0.55 + h * 0.2);
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.beginPath();
  g.ellipse(cx + 2, cy + 3, r, r * 0.8, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = h > 0.5 ? '#2f5a24' : '#355f2a';
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = h > 0.5 ? '#3f7330' : '#467a34';
  g.beginPath();
  g.arc(cx - r * 0.25, cy - r * 0.25, r * 0.6, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(160,210,120,0.25)';
  g.beginPath();
  g.arc(cx - r * 0.35, cy - r * 0.4, r * 0.25, 0, Math.PI * 2);
  g.fill();
}

function drawNode(g: CanvasRenderingContext2D, n: ResourceNode, px: number, py: number, P: number) {
  const col = ITEMS[n.item].color;
  const cx = px + P / 2, cy = py + P / 2;
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.beginPath();
  g.ellipse(cx, cy + 2, P * 0.9, P * 0.7, 0, 0, Math.PI * 2);
  g.fill();
  // Kristaller
  const count = n.purity === 'pure' ? 7 : n.purity === 'normal' ? 5 : 3;
  for (let k = 0; k < count; k++) {
    const a = (k / count) * Math.PI * 2 + 0.3;
    const rr = k === 0 ? 0 : P * 0.45;
    const x = cx + Math.cos(a) * rr * 0.9, y = cy + Math.sin(a) * rr * 0.7;
    const s = P * (k === 0 ? 0.45 : 0.3);
    g.fillStyle = rgb(col, 0.7);
    g.beginPath();
    g.moveTo(x, y - s);
    g.lineTo(x + s * 0.8, y);
    g.lineTo(x, y + s * 0.7);
    g.lineTo(x - s * 0.8, y);
    g.closePath();
    g.fill();
    g.fillStyle = rgb(col, 1.25);
    g.beginPath();
    g.moveTo(x, y - s);
    g.lineTo(x + s * 0.8, y);
    g.lineTo(x, y - s * 0.1);
    g.closePath();
    g.fill();
  }
  // Saflık halkası
  g.strokeStyle = n.purity === 'pure' ? 'rgba(255,230,120,0.9)' : n.purity === 'normal' ? 'rgba(255,255,255,0.55)' : 'rgba(255,120,90,0.6)';
  g.lineWidth = 1.5;
  g.setLineDash([3, 3]);
  g.beginPath();
  g.ellipse(cx, cy, P * 1.0, P * 0.8, 0, 0, Math.PI * 2);
  g.stroke();
  g.setLineDash([]);
}

/** Minimap için tüm haritayı küçük bir canvas'a çizer */
export function drawMinimapBase(canvas: HTMLCanvasElement, map: GameMap) {
  canvas.width = canvas.height = map.size;
  const g = canvas.getContext('2d')!;
  const img = g.createImageData(map.size, map.size);
  for (let i = 0; i < map.size * map.size; i++) {
    let c = BASE[map.terrain[i]];
    if (map.trees[i]) c = 0x2f5a24;
    img.data[i * 4] = (c >> 16) & 255;
    img.data[i * 4 + 1] = (c >> 8) & 255;
    img.data[i * 4 + 2] = c & 255;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  for (const n of map.nodes) {
    g.fillStyle = rgb(ITEMS[n.item].color, 1.2);
    g.fillRect(n.x - 1, n.y - 1, 3, 3);
  }
}
