import { ITEMS } from '@fabrika/shared';

/**
 * Eşya ikonları. Önce /sprites/items/<id>.png aranır (ileride üretilecek görseller için),
 * yoksa kodla çizilen ikon kullanılır.
 */
const cache = new Map<string, string>();

function hex(c: number): string {
  return '#' + c.toString(16).padStart(6, '0');
}

function shade(c: number, f: number): string {
  const r = Math.min(255, Math.max(0, Math.round(((c >> 16) & 255) * f)));
  const g = Math.min(255, Math.max(0, Math.round(((c >> 8) & 255) * f)));
  const b = Math.min(255, Math.max(0, Math.round((c & 255) * f)));
  return `rgb(${r},${g},${b})`;
}

type Shape = 'ore' | 'ingot' | 'plate' | 'rod' | 'screw' | 'coil' | 'cable' | 'block' | 'leaf' | 'log' | 'pellet' | 'gear' | 'frame' | 'beam' | 'pipe' | 'motor' | 'crystal' | 'board' | 'drop' | 'dynamite' | 'computer';

const SHAPES: Record<string, Shape> = {
  ore_iron: 'ore', ore_copper: 'ore', limestone: 'ore', coal: 'ore',
  leaves: 'leaf', wood: 'log', biomass: 'pellet',
  iron_ingot: 'ingot', copper_ingot: 'ingot', steel_ingot: 'ingot',
  iron_plate: 'plate', reinforced_plate: 'plate', iron_rod: 'rod', screw: 'screw', wire: 'coil', cable: 'cable',
  concrete: 'block', rotor: 'gear', stator: 'coil', modular_frame: 'frame', steel_beam: 'beam', steel_pipe: 'pipe', motor: 'motor',
  sulfur: 'ore', quartz: 'ore', bauxite: 'ore', black_powder: 'pellet', explosive: 'dynamite', quartz_crystal: 'crystal', silica: 'pellet',
  aluminum_ingot: 'ingot', aluminum_sheet: 'plate', plastic: 'block', rubber: 'block', circuit_board: 'board', computer: 'computer',
  water: 'drop', crude_oil: 'drop', fuel: 'drop',
};

function draw(id: string): string {
  const def = ITEMS[id];
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const col = def?.color ?? 0x888888;
  const base = hex(col), dark = shade(col, 0.55), light = shade(col, 1.35);
  g.lineJoin = 'round';
  g.lineWidth = 3;
  g.strokeStyle = dark;
  g.fillStyle = base;
  const shape = SHAPES[id] ?? 'block';
  const poly = (pts: number[][]) => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill(); g.stroke(); };
  switch (shape) {
    case 'ore':
      poly([[14, 40], [20, 22], [34, 14], [48, 20], [52, 38], [42, 50], [24, 50]]);
      g.fillStyle = light; poly([[22, 26], [32, 20], [38, 28], [28, 34]]);
      g.fillStyle = dark; g.beginPath(); g.arc(40, 40, 3, 0, 7); g.fill();
      break;
    case 'ingot':
      poly([[10, 42], [18, 24], [50, 24], [56, 42]]);
      g.fillStyle = light; poly([[18, 24], [50, 24], [46, 30], [22, 30]]);
      break;
    case 'plate':
      poly([[10, 36], [30, 24], [54, 30], [34, 44]]);
      g.fillStyle = light; g.beginPath(); g.arc(24, 33, 2.5, 0, 7); g.arc(40, 36, 2.5, 0, 7); g.fill();
      if (id === 'reinforced_plate') { g.strokeStyle = light; g.beginPath(); g.moveTo(18, 34); g.lineTo(44, 30); g.stroke(); }
      break;
    case 'rod':
      g.lineWidth = 7; g.strokeStyle = dark; g.beginPath(); g.moveTo(14, 50); g.lineTo(50, 14); g.stroke();
      g.lineWidth = 4; g.strokeStyle = base; g.beginPath(); g.moveTo(14, 50); g.lineTo(50, 14); g.stroke();
      break;
    case 'screw':
      g.fillRect(28, 20, 8, 30); g.strokeRect(28, 20, 8, 30);
      poly([[20, 14], [44, 14], [42, 22], [22, 22]]);
      g.strokeStyle = dark; for (let y = 26; y < 50; y += 6) { g.beginPath(); g.moveTo(27, y); g.lineTo(37, y + 3); g.stroke(); }
      break;
    case 'coil':
      g.beginPath(); g.ellipse(32, 32, 18, 18, 0, 0, 7); g.fill(); g.stroke();
      g.fillStyle = '#222'; g.beginPath(); g.arc(32, 32, 7, 0, 7); g.fill();
      g.strokeStyle = light; g.lineWidth = 2; for (let r = 10; r < 18; r += 3) { g.beginPath(); g.arc(32, 32, r, 0, 7); g.stroke(); }
      break;
    case 'cable':
      g.lineWidth = 8; g.strokeStyle = dark; g.beginPath(); g.moveTo(12, 44); g.bezierCurveTo(24, 10, 40, 54, 52, 20); g.stroke();
      g.lineWidth = 5; g.strokeStyle = base; g.stroke();
      g.fillStyle = '#e8a050'; g.fillRect(48, 14, 8, 8);
      break;
    case 'block':
      poly([[14, 26], [32, 16], [50, 26], [50, 44], [32, 54], [14, 44]]);
      g.fillStyle = light; poly([[14, 26], [32, 16], [50, 26], [32, 36]]);
      break;
    case 'leaf':
      g.beginPath(); g.ellipse(32, 32, 10, 20, 0.7, 0, 7); g.fill(); g.stroke();
      g.strokeStyle = light; g.beginPath(); g.moveTo(20, 46); g.lineTo(44, 18); g.stroke();
      break;
    case 'log':
      g.fillRect(12, 24, 40, 18); g.strokeRect(12, 24, 40, 18);
      g.fillStyle = '#d8b070'; g.beginPath(); g.ellipse(52, 33, 5, 9, 0, 0, 7); g.fill(); g.stroke();
      break;
    case 'pellet':
      for (const [x, y] of [[24, 28], [38, 24], [30, 40], [44, 38], [20, 42]]) { g.beginPath(); g.ellipse(x, y, 7, 5, 0.5, 0, 7); g.fill(); g.stroke(); }
      break;
    case 'gear':
      g.beginPath();
      for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; const r = i % 2 ? 14 : 20; g.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r); }
      g.closePath(); g.fill(); g.stroke();
      g.fillStyle = dark; g.beginPath(); g.arc(32, 32, 5, 0, 7); g.fill();
      break;
    case 'frame':
      g.lineWidth = 6; g.strokeStyle = dark; g.strokeRect(14, 14, 36, 36);
      g.lineWidth = 4; g.strokeStyle = base; g.strokeRect(14, 14, 36, 36); g.beginPath(); g.moveTo(14, 14); g.lineTo(50, 50); g.moveTo(50, 14); g.lineTo(14, 50); g.stroke();
      break;
    case 'beam':
      poly([[10, 26], [54, 26], [54, 32], [10, 32]]);
      poly([[10, 36], [54, 36], [54, 42], [10, 42]]);
      g.fillRect(28, 30, 8, 8);
      break;
    case 'pipe':
      g.fillRect(12, 24, 40, 16); g.strokeRect(12, 24, 40, 16);
      g.fillStyle = '#222'; g.beginPath(); g.ellipse(52, 32, 4, 8, 0, 0, 7); g.fill();
      break;
    case 'motor':
      g.fillRect(14, 20, 32, 26); g.strokeRect(14, 20, 32, 26);
      g.fillStyle = shade(col, 0.8); g.fillRect(46, 28, 8, 10);
      g.strokeStyle = light; for (let x = 19; x < 44; x += 6) { g.beginPath(); g.moveTo(x, 22); g.lineTo(x, 44); g.stroke(); }
      break;
    case 'crystal':
      poly([[32, 8], [44, 26], [38, 54], [26, 54], [20, 26]]);
      g.fillStyle = light; poly([[32, 8], [44, 26], [32, 30]]);
      break;
    case 'board':
      g.fillRect(10, 16, 44, 32); g.strokeRect(10, 16, 44, 32);
      g.strokeStyle = '#e8c060'; g.lineWidth = 2;
      for (const y of [24, 32, 40]) { g.beginPath(); g.moveTo(14, y); g.lineTo(30, y); g.lineTo(36, y - 4); g.lineTo(50, y - 4); g.stroke(); }
      g.fillStyle = '#222'; g.fillRect(36, 30, 10, 10);
      break;
    case 'drop':
      g.beginPath(); g.moveTo(32, 8); g.bezierCurveTo(48, 30, 50, 40, 46, 46); g.arc(32, 42, 14, 0.3, Math.PI - 0.3); g.bezierCurveTo(14, 40, 16, 30, 32, 8); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = light; g.beginPath(); g.ellipse(26, 38, 3, 6, 0.4, 0, 7); g.fill();
      break;
    case 'dynamite':
      for (const x of [18, 28, 38]) { g.fillRect(x, 20, 9, 32); g.strokeRect(x, 20, 9, 32); }
      g.strokeStyle = '#ddd'; g.lineWidth = 2; g.beginPath(); g.moveTo(32, 20); g.quadraticCurveTo(36, 10, 46, 10); g.stroke();
      g.fillStyle = '#ffd040'; g.beginPath(); g.arc(47, 10, 3, 0, 7); g.fill();
      break;
    case 'computer':
      g.fillRect(12, 14, 40, 28); g.strokeRect(12, 14, 40, 28);
      g.fillStyle = '#7ad0ff'; g.fillRect(16, 18, 32, 20);
      g.fillStyle = dark; g.fillRect(26, 42, 12, 6); g.fillRect(18, 48, 28, 4);
      break;
  }
  return c.toDataURL();
}

export function itemIcon(id: string): string {
  let url = cache.get(id);
  if (!url) {
    url = draw(id);
    cache.set(id, url);
  }
  return url;
}

/**
 * Varsa harici sprite'ları yükle. /sprites/manifest.json içinde {"items": ["iron_plate", ...]}
 * listelenen eşyalar için /sprites/items/<id>.png kullanılır.
 */
export async function preloadSprites(): Promise<void> {
  let ids: string[] = [];
  try {
    const res = await fetch('/sprites/manifest.json');
    if (!res.ok) return;
    const data = await res.json();
    ids = Array.isArray(data?.items) ? data.items.filter((id: string) => ITEMS[id]) : [];
  } catch {
    return;
  }
  await Promise.all(
    ids.map(
      (id) =>
        new Promise<void>((res) => {
          const img = new Image();
          img.onload = () => { cache.set(id, img.src); res(); };
          img.onerror = () => res();
          img.src = `/sprites/items/${id}.png`;
        }),
    ),
  );
}
