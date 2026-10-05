import { describe, expect, it } from 'vitest';
import { BUILDINGS, TICK_RATE, footprint, generateMap, hasTree, rotateBlueprint, terrainBuildable, tileKey } from '@fabrika/shared';
import { World } from '../src/sim/world';
import { computeNetworks } from '../src/sim/power';
import { Persistence } from '../src/persistence';

const SEED = 12345;

function setup() {
  const w = new World(SEED);
  w.cheats = true;
  w.tech.completed = 6;
  const p = w.join('Test', undefined);
  if (typeof p === 'string') throw new Error(p);
  return { w, p };
}

/** Haritada verilen alanı inşa edilebilir hale getirir (test için) */
function clearArea(w: World, x0: number, y0: number, x1: number, y1: number) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    w.map.terrain[y * w.map.size + x] = 0;
    w.map.trees[y * w.map.size + x] = 0;
    w.map.nodeAt.delete(tileKey(x, y));
  }
}

function run(w: World, seconds: number) {
  for (let i = 0; i < seconds * TICK_RATE; i++) { w.step(); w.collectUpdates(); w.out = []; w.direct = []; }
}

describe('harita', () => {
  it('aynı seed ile deterministik', () => {
    const a = generateMap(42), b = generateMap(42);
    expect(a.nodes).toEqual(b.nodes);
    expect(Buffer.from(a.terrain).equals(Buffer.from(b.terrain))).toBe(true);
  });
  it('başlangıç bölgesi temiz ve kaynaklar yakın', () => {
    const m = generateMap(7);
    const { x, y } = m.spawn;
    for (let j = -5; j <= 5; j++) for (let i = -5; i <= 5; i++) {
      expect(terrainBuildable(m, x + i, y + j)).toBe(true);
      expect(hasTree(m, x + i, y + j)).toBe(false);
    }
    for (const item of ['ore_iron', 'ore_copper', 'limestone']) {
      expect(m.nodes.some((n) => n.item === item && Math.hypot(n.x - x, n.y - y) < 14)).toBe(true);
    }
  });
});

describe('üretim zinciri', () => {
  it('maden → bant → eritme fırını → depo, elektrikle', () => {
    const { w, p } = setup();
    const node = w.map.nodes.find((n) => n.item === 'ore_iron' && n.purity === 'normal')!;
    // Oyuncuyu yakına ışınla
    p.x = node.x + 6; p.y = node.y + 6;
    clearArea(w, node.x - 2, node.y - 8, node.x + 14, node.y + 8);
    w.map.nodeAt.set(tileKey(node.x, node.y), node);
    expect(w.build(p.id, 'miner_mk1', node.x, node.y, 0)).toBe(true);
    // Maden çıkışı (x+2, y) — 3 bant, sonra fırın (2x2) girişi (x+5,y)
    w.buildBelts(p.id, 'belt_mk1', [0, 1, 2].map((i) => ({ x: node.x + 2 + i, y: node.y, dir: 0 })));
    expect(w.build(p.id, 'smelter', node.x + 5, node.y, 0)).toBe(true);
    const smelter = w.buildingAt(node.x + 5, node.y)!;
    w.setRecipe(p.id, smelter.id, 'iron_ingot');
    w.buildBelts(p.id, 'belt_mk1', [0, 1].map((i) => ({ x: node.x + 7 + i, y: node.y, dir: 0 })));
    expect(w.build(p.id, 'storage', node.x + 9, node.y, 0)).toBe(true);
    // Enerji
    expect(w.build(p.id, 'biomass_burner', node.x + 2, node.y + 3, 0)).toBe(true);
    expect(w.build(p.id, 'power_pole', node.x + 5, node.y + 3, 0)).toBe(true);
    const gen = w.buildingAt(node.x + 2, node.y + 3)!;
    gen.inBuf.biomass = 50;

    run(w, 30);
    const storage = w.buildingAt(node.x + 9, node.y)!;
    const ingots = storage.storage!.reduce((s, x) => s + (x?.item === 'iron_ingot' ? x.count : 0), 0);
    // 60/dk maden, 30/dk fırın -> ~30 sn'de 10+ külçe
    expect(ingots).toBeGreaterThanOrEqual(8);
    expect(smelter.status).toBe('working');
    expect(gen.status).toBe('working');
    // İstatistikler ve verim
    const st = w.stats.snapshot();
    expect(st.produced.ore_iron).toBeGreaterThan(40);
    expect(st.consumed.ore_iron).toBeGreaterThan(15);
    expect(st.produced.iron_ingot).toBeGreaterThan(15);
    expect(st.consumed.biomass).toBeGreaterThan(0);
    expect(smelter.eff!).toBeGreaterThan(0.5);
  });

  it('enerjisiz makine çalışmaz', () => {
    const { w, p } = setup();
    clearArea(w, p.x + 2, p.y - 2, p.x + 8, p.y + 2);
    const x = Math.floor(p.x) + 3, y = Math.floor(p.y);
    expect(w.build(p.id, 'constructor', x, y, 0)).toBe(true);
    const c = w.buildingAt(x, y)!;
    w.setRecipe(p.id, c.id, 'iron_rod');
    c.inBuf.iron_ingot = 10;
    run(w, 5);
    expect(c.status).toBe('nopower');
    expect(c.outBuf.iron_rod ?? 0).toBe(0);
  });

  it('aşırı yükte sigorta atar ve sıfırlanır', () => {
    const { w, p } = setup();
    const x = Math.floor(p.x) + 3, y = Math.floor(p.y) - 1;
    clearArea(w, x - 1, y - 1, x + 12, y + 6);
    p.x = x + 4; p.y = y + 5.5;
    w.build(p.id, 'biomass_burner', x, y, 0); // 30 MW
    w.build(p.id, 'power_pole', x + 3, y, 0);
    // 2 montajcı = 30 MW + 1 kurucu 4 MW = 34 MW > 30 MW
    w.build(p.id, 'assembler', x + 4, y, 0);
    w.build(p.id, 'assembler', x + 7, y, 0);
    w.build(p.id, 'constructor', x + 4, y + 2, 0);
    const gen = w.buildingAt(x, y)!;
    gen.inBuf.biomass = 50;
    const a1 = w.buildingAt(x + 4, y)!, a2 = w.buildingAt(x + 7, y)!, c = w.buildingAt(x + 4, y + 2)!;
    w.setRecipe(p.id, a1.id, 'rotor'); a1.inBuf = { iron_rod: 50, screw: 200 };
    w.setRecipe(p.id, a2.id, 'rotor'); a2.inBuf = { iron_rod: 50, screw: 200 };
    w.setRecipe(p.id, c.id, 'iron_rod'); c.inBuf = { iron_ingot: 30 };
    run(w, 1);
    const pole = w.buildingAt(x + 3, y)!;
    expect(pole.tripped).toBe(true);
    expect(a1.status).toBe('tripped');
    // Bir montajcıyı kaldır, sıfırla
    w.dismantle(p.id, a2.id);
    w.resetFuse(p.id, pole.id);
    run(w, 1);
    expect(pole.tripped).toBeFalsy();
    expect(a1.status).toBe('working');
  });

  it('ayırıcı akışı çıkışlara dağıtır', () => {
    const { w, p } = setup();
    const x = Math.floor(p.x) + 3, y = Math.floor(p.y) - 3;
    clearArea(w, x - 1, y - 1, x + 8, y + 7);
    p.x = x - 0.5; p.y = y + 6;
    w.build(p.id, 'storage', x, y + 2, 0); // çıkış (x+2, y+2)
    const src = w.buildingAt(x, y + 2)!;
    src.storage![0] = { item: 'iron_plate', count: 30 };
    w.build(p.id, 'splitter', x + 2, y + 2, 0);
    w.buildBelts(p.id, 'belt_mk1', [{ x: x + 3, y: y + 2, dir: 0 }]);
    w.buildBelts(p.id, 'belt_mk1', [{ x: x + 2, y: y + 1, dir: 3 }]);
    w.buildBelts(p.id, 'belt_mk1', [{ x: x + 2, y: y + 3, dir: 1 }]);
    run(w, 3);
    const counts = [w.buildingAt(x + 3, y + 2)!, w.buildingAt(x + 2, y + 1)!, w.buildingAt(x + 2, y + 3)!].map((b) => b.items!.length);
    expect(counts.every((c) => c >= 1)).toBe(true);
  });
});

describe('lojistik', () => {
  it('alt geçit eşyaları engelin altından taşır', () => {
    const { w, p } = setup();
    const x = Math.floor(p.x) + 6, y = Math.floor(p.y) - 4;
    clearArea(w, x - 1, y - 1, x + 12, y + 3);
    p.x = x + 4; p.y = y + 3.5;
    w.build(p.id, 'storage', x, y, 0); // çıkış (x+2, y)
    w.buildingAt(x, y)!.storage![0] = { item: 'iron_plate', count: 20 };
    w.build(p.id, 'underground_in', x + 2, y, 0);
    // Arada başka bir hat (dikey bant) geçsin
    w.buildBelts(p.id, 'belt_mk1', [{ x: x + 4, y: y - 1, dir: 1 }, { x: x + 4, y, dir: 1 }, { x: x + 4, y: y + 1, dir: 1 }]);
    w.build(p.id, 'underground_out', x + 6, y, 0);
    w.buildBelts(p.id, 'belt_mk1', [{ x: x + 7, y, dir: 0 }, { x: x + 8, y, dir: 0 }]);
    w.build(p.id, 'storage', x + 9, y, 0);
    run(w, 10);
    const dst = w.buildingAt(x + 9, y)!;
    const got = dst.storage!.reduce((s, it) => s + (it?.item === 'iron_plate' ? it.count : 0), 0);
    expect(got).toBeGreaterThanOrEqual(10);
    expect(w.buildingAt(x + 2, y)!.status).toBe('working');
    // Aradaki dikey banda hiçbir eşya girmemeli
    expect(w.buildingAt(x + 4, y)!.items!.length).toBe(0);
  });

  it('eşleşmeyen alt geçit girişi "bağlantı yok" durumunda', () => {
    const { w, p } = setup();
    const x = Math.floor(p.x) + 2, y = Math.floor(p.y);
    clearArea(w, x, y, x + 10, y);
    w.build(p.id, 'underground_in', x, y, 0);
    w.build(p.id, 'underground_out', x + 8, y, 0); // menzil dışı
    run(w, 0.2);
    expect(w.buildingAt(x, y)!.status).toBe('unpaired');
  });

  it('akıllı ayırıcı filtre ve taşmaya göre dağıtır', () => {
    const { w, p } = setup();
    const x = Math.floor(p.x) + 6, y = Math.floor(p.y) - 4;
    clearArea(w, x - 1, y - 2, x + 8, y + 4);
    p.x = x + 1; p.y = y + 4.5;
    w.build(p.id, 'storage', x, y, 0); // çıkış (x+2, y)
    const src = w.buildingAt(x, y)!;
    src.storage![0] = { item: 'iron_plate', count: 10 };
    src.storage![1] = { item: 'iron_rod', count: 10 };
    w.build(p.id, 'smart_splitter', x + 2, y, 0);
    const sp = w.buildingAt(x + 2, y)!;
    w.setFilter(p.id, sp.id, 0, 'iron_rod'); // ön: çubuk
    w.setFilter(p.id, sp.id, 1, 'rest'); // sol: diğerleri
    w.setFilter(p.id, sp.id, 2, 'none'); // sağ: kapalı
    w.buildBelts(p.id, 'belt_mk1', [{ x: x + 3, y, dir: 0 }]);
    w.buildBelts(p.id, 'belt_mk1', [{ x: x + 2, y: y - 1, dir: 3 }]);
    w.buildBelts(p.id, 'belt_mk1', [{ x: x + 2, y: y + 1, dir: 1 }]);
    run(w, 3);
    const items = (bx: number, by: number) => w.buildingAt(bx, by)!.items!.map((i) => i.item);
    expect(items(x + 3, y).every((i) => i === 'iron_rod')).toBe(true);
    expect(items(x + 2, y - 1).every((i) => i === 'iron_plate')).toBe(true);
    expect(items(x + 2, y + 1).length).toBe(0);
    expect(items(x + 2, y - 1).length).toBeGreaterThan(0);
  });
});

describe('oyuncu', () => {
  it('elle üretim ve HUB teslimi kademe açar', () => {
    const w = new World(SEED);
    const p = w.join('A', undefined);
    if (typeof p === 'string') throw new Error(p);
    p.inventory[0] = { item: 'iron_ingot', count: 40 };
    w.craft(p.id, 'iron_plate', 5);
    w.craft(p.id, 'iron_rod', 10);
    run(w, 60);
    expect(w.count(p.id, 'iron_plate')).toBe(10);
    expect(w.count(p.id, 'iron_rod')).toBe(10);
    w.hubSubmit(p.id);
    expect(w.tech.completed).toBe(1);
    expect(w.canPlace('smelter', 0, 0, 0)).not.toBe('Bu yapı henüz açılmadı');
    expect(w.canPlace('assembler', 0, 0, 0)).toBe('Bu yapı henüz açılmadı');
  });

  it('inşa maliyeti düşülür, söküm iade eder', () => {
    const w = new World(SEED);
    const p = w.join('A', undefined);
    if (typeof p === 'string') throw new Error(p);
    p.inventory[0] = { item: 'iron_plate', count: 3 };
    p.inventory[1] = { item: 'iron_rod', count: 3 };
    const x = Math.floor(p.x) + 2, y = Math.floor(p.y);
    clearArea(w, x, y, x + 2, y + 1);
    expect(w.build(p.id, 'workbench', x, y, 0)).toBe(true);
    expect(w.count(p.id, 'iron_plate')).toBe(0);
    w.dismantle(p.id, w.buildingAt(x, y)!.id);
    expect(w.count(p.id, 'iron_plate')).toBe(3);
    expect(w.buildingAt(x, y)).toBeUndefined();
  });

  it('ağaç kesmek yaprak ve odun verir', () => {
    const w = new World(SEED);
    const p = w.join('A', undefined);
    if (typeof p === 'string') throw new Error(p);
    let tx = -1, ty = -1;
    outer: for (let y = 0; y < w.map.size; y++) for (let x = 0; x < w.map.size; x++) if (hasTree(w.map, x, y)) { tx = x; ty = y; break outer; }
    p.x = tx + 0.5; p.y = ty + 1.8;
    w.harvest(p.id, tx, ty);
    expect(w.count(p.id, 'leaves')).toBe(6);
    expect(hasTree(w.map, tx, ty)).toBe(false);
    expect(w.removedTrees.has(tileKey(tx, ty))).toBe(true);
  });

  it('en fazla 4 oyuncu, token ile yeniden bağlanma', () => {
    const w = new World(SEED);
    const ps = [0, 1, 2, 3].map((i) => w.join('P' + i, undefined));
    expect(ps.every((p) => typeof p !== 'string')).toBe(true);
    expect(typeof w.join('P5', undefined)).toBe('string');
    const first = ps[0] as Exclude<typeof ps[0], string>;
    w.leave(first.id);
    const again = w.join('P0', first.token);
    expect(typeof again !== 'string' && again.id).toBe(first.id);
  });

  it('ölen oyuncu eşyalarını sandığa bırakır ve doğar', () => {
    const { w, p } = setup();
    p.inventory[0] = { item: 'iron_plate', count: 20 };
    const nest = w.nests[0];
    p.x = nest.x + 1.5; p.y = nest.y + 0.5;
    p.hp = 5;
    for (const n of w.nests) n.spawnT = 0;
    run(w, 5);
    expect(p.hp).toBeGreaterThan(50);
    expect(w.count(p.id, 'iron_plate')).toBe(0);
    expect([...w.buildings.values()].some((b) => b.type === 'crate')).toBe(true);
  });
});

describe('planlar', () => {
  it('döndürme 4 kez uygulanınca aynı plan', () => {
    const bp = { w: 3, h: 2, entries: [{ type: 'constructor', dx: 0, dy: 0, rot: 0 }, { type: 'belt_mk1', dx: 2, dy: 1, rot: 1 }] };
    expect(rotateBlueprint(bp, 4)).toEqual(bp);
    const r1 = rotateBlueprint(bp, 1);
    expect([r1.w, r1.h]).toEqual([2, 3]);
    // Kurucu (2x2) sol üstten sağ üste geçer, bant (2,1) -> (0,2)
    expect(r1.entries[0]).toMatchObject({ dx: 0, dy: 0, rot: 1 });
    expect(r1.entries[1]).toMatchObject({ dx: 0, dy: 2, rot: 2 });
  });

  it('kaydedilen plan döndürülerek başka yere kurulur, tarifler kopyalanır', () => {
    const { w, p } = setup();
    const x = Math.floor(p.x) + 6, y = Math.floor(p.y) - 6;
    clearArea(w, x - 1, y - 1, x + 14, y + 8);
    p.x = x + 6; p.y = y + 7.5;
    w.build(p.id, 'constructor', x, y, 0);
    w.setRecipe(p.id, w.buildingAt(x, y)!.id, 'screw');
    w.buildBelts(p.id, 'belt_mk1', [{ x: x + 2, y, dir: 0 }, { x: x + 3, y, dir: 0 }]);
    w.bpSave(p.id, 'Vida hattı', x - 1, y - 1, x + 4, y + 2);
    expect(w.blueprints.length).toBe(1);
    expect(w.blueprints[0].entries.length).toBe(3);
    const bp = w.blueprints[0];
    expect(w.bpPlace(p.id, bp.id, x + 8, y, 1)).toBe(true);
    // Döndürülmüş: kurucu 2x2 üstte, bantlar sağ sütunda aşağı doğru (rot 1) — kurucunun çıkışı (9,1)'den aşağı
    const c = w.buildingAt(x + 8, y)!;
    expect(c.type).toBe('constructor');
    expect(c.rot).toBe(1);
    expect(c.recipe).toBe('screw');
    expect(w.buildingAt(x + 9, y + 2)?.type).toBe('belt_mk1');
    expect(w.buildingAt(x + 9, y + 3)?.rot).toBe(1);
    // Aynı yere ikinci kez kurulamaz
    expect(w.bpPlace(p.id, bp.id, x + 8, y, 1)).toBe(false);
    w.bpDelete(p.id, bp.id);
    expect(w.blueprints.length).toBe(0);
  });
});

describe('kayıt', () => {
  it('kaydet/yükle aynı dünyayı verir', () => {
    const { w, p } = setup();
    const x = Math.floor(p.x) + 3, y = Math.floor(p.y);
    clearArea(w, x, y, x + 2, y + 2);
    w.build(p.id, 'constructor', x, y, 1);
    p.inventory[3] = { item: 'screw', count: 77 };
    const db = new Persistence(':memory:');
    db.save('ABCDE', w.serialize());
    const w2 = World.fromSave(db.load('ABCDE')!);
    expect(w2.buildings.size).toBe(w.buildings.size);
    expect(w2.buildingAt(x, y)?.type).toBe('constructor');
    expect(w2.buildingAt(x, y)?.rot).toBe(1);
    const again = w2.join('Test', p.token);
    expect(typeof again !== 'string' && again.inventory[3]).toEqual({ item: 'screw', count: 77 });
  });
});

describe('güç ağı', () => {
  it('menzildeki direkler birleşir', () => {
    const mk = (id: number, x: number, y: number, type = 'power_pole') => ({ id, type, x, y, rot: 0, inBuf: {}, outBuf: {}, progress: 0, status: 'idle' as const });
    const { nets, netOf } = computeNetworks([mk(1, 0, 0), mk(2, 10, 0), mk(3, 40, 0), mk(4, 2, 2, 'smelter')]);
    expect(nets.length).toBe(2);
    expect(netOf.get(1)).toBe(netOf.get(2));
    expect(netOf.get(4)).toBe(netOf.get(1));
    expect(netOf.get(3)).not.toBe(netOf.get(1));
    expect(footprint('smelter', 2, 2, 0).length).toBe(BUILDINGS.smelter.w * BUILDINGS.smelter.h);
  });
});
