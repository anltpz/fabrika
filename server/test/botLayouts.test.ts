import { describe, expect, it } from 'vitest';
import { BUILDINGS, TICK_RATE, footprint, tileKey } from '@fabrika/shared';
import type { BuildingState } from '@fabrika/shared';
import { World } from '../src/sim/world';
import { nodeLayouts, placeLayout } from '../src/bot/layouts';
import type { Layout } from '../src/bot/layouts';
import { feedAmounts, inferFacilities, mrp, plan } from '../src/bot/economy';

function setup() {
  const w = new World(777);
  w.cheats = true;
  w.tech.completed = 9;
  const p = w.join('Test', undefined);
  if (typeof p === 'string') throw new Error(p);
  return { w, p };
}

function run(w: World, seconds: number) {
  for (let i = 0; i < seconds * TICK_RATE; i++) { w.step(); w.collectUpdates(); w.out = []; w.direct = []; }
}

/** Alanı boşaltır, düğüm koyar ve yerleşimi kurar */
function buildLayout(w: World, pid: number, l: Layout, node?: { x: number; y: number; item: string }) {
  for (let y = l.y0 - 2; y <= l.y1 + 2; y++) for (let x = l.x0 - 2; x <= l.x1 + 2; x++) {
    w.map.terrain[y * w.map.size + x] = 0;
    w.map.trees[y * w.map.size + x] = 0;
    w.map.nodeAt.delete(tileKey(x, y));
  }
  if (node) w.map.nodeAt.set(tileKey(node.x, node.y), { ...node, purity: 'normal' });
  const p = w.players.get(pid)!;
  p.x = l.x0 - 1.5; p.y = l.y0 - 1.5;
  for (const part of l.parts) {
    const ok = BUILDINGS[part.type].walkable && part.type.startsWith('belt')
      ? (w.buildBelts(pid, part.type, [{ x: part.x, y: part.y, dir: part.rot }]), true)
      : w.build(pid, part.type, part.x, part.y, part.rot);
    expect(ok, `${part.type} @${part.x},${part.y}`).toBe(true);
    const b = w.buildingAt(part.x, part.y)!;
    if (part.recipe) w.setRecipe(pid, b.id, part.recipe);
  }
}

const storageItems = (w: World, l: Layout) =>
  l.parts.filter((p) => p.type === 'storage').map((p) => w.buildingAt(p.x, p.y)!.storage!.reduce((s, it) => s + (it?.count ?? 0), 0));

function addBurner(w: World, pid: number, x: number, y: number) {
  const l = placeLayout('burner', x, y);
  buildLayout(w, pid, l);
  const gen = w.buildingAt(x, y)!;
  gen.inBuf.biomass = 200;
}

describe('bot yerleşimleri', () => {
  for (const k of [0, 1, 2, 3]) {
    it(`demir madeni + fırın (yön ${k})`, () => {
      const { w, p } = setup();
      const nx = 60, ny = 60;
      const l = nodeLayouts('mine', nx, ny, 'iron_ingot')[k * 4 + 1];
      buildLayout(w, p.id, l, { x: nx, y: ny, item: 'ore_iron' });
      // Direğin yanına biyokütle jeneratörü
      const pole = l.parts.find((q) => q.type === 'power_pole')!;
      addBurner(w, p.id, pole.x + 6, pole.y + 6);
      run(w, 30);
      const [n] = storageItems(w, l);
      expect(n).toBeGreaterThan(5);
      // Çıkarım: maden + ürün + depo
      const fac = inferFacilities(w.buildings.values(), (x, y) => w.buildingAt(x, y), (b) => footprint(b.type, b.x, b.y, b.rot).map(([x, y]) => w.map.nodeAt.get(tileKey(x, y))?.item).find(Boolean));
      const mine = fac.find((f) => f.kind === 'mine')!;
      expect(mine.resource).toBe('ore_iron');
      expect(mine.product).toBe('iron_ingot');
      expect(mine.storage).toBeTruthy();
    });
  }

  it('hücre: elle beslenen kurucu → depo', () => {
    const { w, p } = setup();
    const l = placeLayout('cell', 50, 50, 'constructor', 'screw');
    buildLayout(w, p.id, l);
    addBurner(w, p.id, 50, 54);
    const m = w.buildingAt(50, 50)!;
    m.inBuf.iron_rod = 20;
    run(w, 40);
    const [n] = storageItems(w, l);
    expect(n).toBeGreaterThan(10);
    const fac = inferFacilities(w.buildings.values(), (x, y) => w.buildingAt(x, y), () => undefined);
    const cell = fac.find((f) => f.kind === 'cell')!;
    expect(cell.recipe).toBe('screw');
    expect(cell.storage).toBeTruthy();
  });

  it('hücre: montajcı', () => {
    const { w, p } = setup();
    const l = placeLayout('cell', 50, 50, 'assembler', 'rotor');
    buildLayout(w, p.id, l);
    addBurner(w, p.id, 50, 54);
    const m = w.buildingAt(50, 50)!;
    m.inBuf.iron_rod = 20; m.inBuf.screw = 100;
    run(w, 40);
    expect(storageItems(w, l)[0]).toBeGreaterThan(1);
  });

  for (const k of [0, 2]) {
    it(`kömür santrali kendini besler (yön ${k})`, () => {
      const { w, p } = setup();
      const nx = 70, ny = 70;
      const l = nodeLayouts('coal', nx, ny)[k * 4];
      buildLayout(w, p.id, l, { x: nx, y: ny, item: 'coal' });
      const gens = l.parts.filter((q) => q.type === 'coal_generator').map((q) => w.buildingAt(q.x, q.y)!);
      gens[0].inBuf.coal = 5;
      // 3 jeneratörü de yükleyecek bir tüketici
      const cell = placeLayout('cell', nx + 12, ny + 12, 'constructor', 'screw');
      buildLayout(w, p.id, cell);
      w.buildingAt(nx + 12, ny + 12)!.inBuf.iron_rod = 100;
      run(w, 60);
      const fed = gens.filter((g: BuildingState) => (g.inBuf.coal ?? 0) > 0 || (g.fuel ?? 0) > 0).length;
      expect(fed).toBe(3);
    });
  }

  it('petrol: kuyu → iki rafineri → depolar', () => {
    const { w, p } = setup();
    const nx = 80, ny = 80;
    const l = nodeLayouts('oil', nx, ny)[0];
    buildLayout(w, p.id, l, { x: nx, y: ny, item: 'crude_oil' });
    for (let i = 0; i < 4; i++) addBurner(w, p.id, nx + 2 + i * 3, ny + 7);
    run(w, 60);
    const [a, b] = storageItems(w, l);
    expect(a).toBeGreaterThan(2);
    expect(b).toBeGreaterThan(2);
  });
});

describe('bot ekonomisi', () => {
  it('MRP stok düşer ve madende işlenen ürünlerde durur', () => {
    const m = mrp({ iron_plate: 10 }, { iron_plate: 4 }, 2);
    expect(m.crafts.iron_plate).toBe(3);
    expect(m.leaves.iron_ingot).toBe(9);
    // Fırın açılmadan önce cevhere kadar iner
    const m0 = mrp({ iron_rod: 5 }, {}, 0);
    expect(m0.leaves.ore_iron).toBe(5);
  });

  it('plan: çelik çağında çelik dökümhanesi ve ham madenler ister', () => {
    const m = mrp({ steel_beam: 100, steel_pipe: 100, modular_frame: 50 }, {}, 4);
    const wants = plan(4, m, []);
    const keys = wants.map((w) => w.key);
    expect(keys).toContain('cell:steel_ingot');
    expect(keys).toContain('mine:coal');
    expect(keys).toContain('mine:ore_iron');
    expect(keys).toContain('mine:ore_iron:iron_ingot');
    expect(keys).toContain('cell:modular_frame');
  });

  it('besleme miktarı kapasiteyle sınırlı', () => {
    const f = feedAmounts({ id: 'x', name: 'x', machines: [], hand: false, inputs: { a: 2, b: 5 }, outputs: { c: 1 }, time: 1, unlock: -1 }, 1000, { a: 100 });
    expect(f).toEqual({ a: 400, b: 500 });
  });
});
