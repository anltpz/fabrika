import { DX, DY, Dir, footprintSize, rotateLocal, rotDir } from './grid';

export interface PortDef {
  x: number;
  y: number;
  /** Portun baktığı yön (dönüş 0 için) */
  dir: Dir;
}

export type BuildingCategory = 'uretim' | 'lojistik' | 'sivi' | 'enerji' | 'ozel';

export interface BuildingDef {
  id: string;
  name: string;
  desc: string;
  w: number;
  h: number;
  cost: Record<string, number>;
  category: BuildingCategory;
  color: number;
  /** Tüketilen güç (MW) */
  power?: number;
  /** Üretilen güç (MW) */
  powerGen?: number;
  /** Kabul edilen yakıtlar */
  fuels?: string[];
  inputs: PortDef[];
  outputs: PortDef[];
  unlock: number;
  buildable: boolean;
  /** Üzerinden yürünebilir mi */
  walkable?: boolean;
  /** Bant hızı (tile/sn) */
  beltSpeed?: number;
  /** Maden çıkarma hızı (adet/dk, normal saflıkta) */
  mineRate?: number;
  /** Sıvı çıkarma hızı (birim/dk, normal saflıkta); petrol düğümüne kurulur */
  pumpRate?: number;
  /** Su çıkarıcı: tamamen suyun üzerine kurulur, bu hızda (birim/dk) su verir */
  waterRate?: number;
  /** Sıvı giriş/çıkış portları (borulara bağlanır) */
  fluidIn?: PortDef[];
  fluidOut?: PortDef[];
  /** Her yandan boruya bağlanır (sıvı deposu, boru) */
  fluidAll?: boolean;
  /** Sıvı kapasitesi (boru/depo) */
  fluidCap?: number;
  /** Tarif seçebilen üretim makinesi mi */
  crafter?: boolean;
  short: string;
}

const list: BuildingDef[] = [
  {
    id: 'hub', name: 'HUB', desc: 'Takımın merkezi. Kademe teslimatları ve elle üretim burada yapılır.',
    w: 4, h: 4, cost: {}, category: 'ozel', color: 0xe8a33a, inputs: [], outputs: [], unlock: -1, buildable: false, short: 'HUB',
  },
  {
    id: 'workbench', name: 'Çalışma Tezgahı', desc: 'Yakınındayken elle üretim yapabilirsin.',
    w: 2, h: 1, cost: { iron_plate: 3, iron_rod: 3 }, category: 'ozel', color: 0xb07a40, inputs: [], outputs: [], unlock: -1, buildable: true, short: 'TZG',
  },
  {
    id: 'miner_mk1', name: 'Maden Çıkarıcı Mk1', desc: 'Bir kaynak düğümünün üzerine kurulur. 60/dk (normal).',
    w: 2, h: 2, cost: { iron_plate: 10, concrete: 10 }, category: 'uretim', color: 0xd08a2a, power: 5, mineRate: 60,
    inputs: [], outputs: [{ x: 1, y: 0, dir: 0 }], unlock: 0, buildable: true, short: 'MDN',
  },
  {
    id: 'miner_mk2', name: 'Maden Çıkarıcı Mk2', desc: 'Daha hızlı maden çıkarıcı. 120/dk (normal).',
    w: 2, h: 2, cost: { modular_frame: 5, steel_pipe: 15, concrete: 20 }, category: 'uretim', color: 0xe0a040, power: 12, mineRate: 120,
    inputs: [], outputs: [{ x: 1, y: 0, dir: 0 }], unlock: 3, buildable: true, short: 'MD2',
  },
  {
    id: 'smelter', name: 'Eritme Fırını', desc: 'Cevheri külçeye çevirir.',
    w: 2, h: 2, cost: { iron_rod: 5, wire: 8 }, category: 'uretim', color: 0xc0503a, power: 4, crafter: true,
    inputs: [{ x: 0, y: 0, dir: 2 }], outputs: [{ x: 1, y: 0, dir: 0 }], unlock: 0, buildable: true, short: 'ERT',
  },
  {
    id: 'foundry', name: 'Dökümhane', desc: 'İki girdiyi eritip alaşım yapar (çelik).',
    w: 3, h: 2, cost: { modular_frame: 10, iron_rod: 20, concrete: 20 }, category: 'uretim', color: 0x9a3a2a, power: 16, crafter: true,
    inputs: [{ x: 0, y: 0, dir: 2 }, { x: 0, y: 1, dir: 2 }], outputs: [{ x: 2, y: 0, dir: 0 }], unlock: 3, buildable: true, short: 'DKM',
  },
  {
    id: 'constructor', name: 'Kurucu', desc: 'Tek girdili parçaları üretir (plaka, çubuk, vida...).',
    w: 2, h: 2, cost: { iron_plate: 8, cable: 8 }, category: 'uretim', color: 0x3a8ac0, power: 4, crafter: true,
    inputs: [{ x: 0, y: 0, dir: 2 }], outputs: [{ x: 1, y: 0, dir: 0 }], unlock: 1, buildable: true, short: 'KRC',
  },
  {
    id: 'assembler', name: 'Montajcı', desc: 'İki girdili parçaları birleştirir.',
    w: 3, h: 2, cost: { reinforced_plate: 8, rotor: 4, cable: 10 }, category: 'uretim', color: 0x6a5ac0, power: 15, crafter: true,
    inputs: [{ x: 0, y: 0, dir: 2 }, { x: 0, y: 1, dir: 2 }], outputs: [{ x: 2, y: 0, dir: 0 }], unlock: 2, buildable: true, short: 'MNT',
  },
  {
    id: 'biomass_burner', name: 'Biyokütle Jeneratörü', desc: 'Yaprak, odun veya biyokütle yakarak 30 MW üretir.',
    w: 2, h: 2, cost: { iron_plate: 15, iron_rod: 15, wire: 25 }, category: 'enerji', color: 0x6aa03a, powerGen: 30,
    fuels: ['leaves', 'wood', 'biomass'], inputs: [{ x: 0, y: 0, dir: 2 }], outputs: [], unlock: 0, buildable: true, short: 'BYO',
  },
  {
    id: 'coal_generator', name: 'Kömür Jeneratörü', desc: 'Kömür yakarak 75 MW üretir.',
    w: 3, h: 2, cost: { reinforced_plate: 10, rotor: 5, cable: 20 }, category: 'enerji', color: 0x4a4a4a, powerGen: 75,
    fuels: ['coal'], inputs: [{ x: 0, y: 0, dir: 2 }], outputs: [], unlock: 2, buildable: true, short: 'KMR',
  },
  {
    id: 'power_pole', name: 'Elektrik Direği', desc: '5 tile yarıçapta binalara güç verir, 12 tile içindeki direklere otomatik bağlanır.',
    w: 1, h: 1, cost: { wire: 3, iron_rod: 1, concrete: 1 }, category: 'enerji', color: 0xe0d040, walkable: true,
    inputs: [], outputs: [], unlock: 0, buildable: true, short: 'DRK',
  },
  {
    id: 'belt_mk1', name: 'Konveyör Bant Mk1', desc: '120 adet/dk taşır. Sürükleyerek çiz.',
    w: 1, h: 1, cost: { iron_plate: 1 }, category: 'lojistik', color: 0x505860, walkable: true, beltSpeed: 1,
    inputs: [], outputs: [], unlock: 0, buildable: true, short: 'BNT',
  },
  {
    id: 'belt_mk2', name: 'Konveyör Bant Mk2', desc: '240 adet/dk taşır.',
    w: 1, h: 1, cost: { reinforced_plate: 1 }, category: 'lojistik', color: 0x4a6a8a, walkable: true, beltSpeed: 2,
    inputs: [], outputs: [], unlock: 3, buildable: true, short: 'BN2',
  },
  {
    id: 'splitter', name: 'Ayırıcı', desc: 'Arkadan gelen akışı ön/sol/sağ çıkışlara dağıtır.',
    w: 1, h: 1, cost: { iron_plate: 5, cable: 2 }, category: 'lojistik', color: 0xd0c040,
    inputs: [{ x: 0, y: 0, dir: 2 }], outputs: [{ x: 0, y: 0, dir: 0 }, { x: 0, y: 0, dir: 3 }, { x: 0, y: 0, dir: 1 }], unlock: 1, buildable: true, short: 'AYR',
  },
  {
    id: 'merger', name: 'Birleştirici', desc: 'Arka/sol/sağ girişleri öne birleştirir.',
    w: 1, h: 1, cost: { iron_plate: 5, cable: 2 }, category: 'lojistik', color: 0x40c0d0,
    inputs: [{ x: 0, y: 0, dir: 2 }, { x: 0, y: 0, dir: 3 }, { x: 0, y: 0, dir: 1 }], outputs: [{ x: 0, y: 0, dir: 0 }], unlock: 1, buildable: true, short: 'BRL',
  },
  {
    id: 'underground_in', name: 'Alt Geçit Girişi', desc: 'Eşyaları yer altından 5 tile\'a kadar taşır. Önüne aynı yöne bakan bir Alt Geçit Çıkışı kur.',
    w: 1, h: 1, cost: { iron_plate: 6, concrete: 4 }, category: 'lojistik', color: 0x8a7040, walkable: true,
    inputs: [{ x: 0, y: 0, dir: 2 }], outputs: [], unlock: 1, buildable: true, short: 'AGG',
  },
  {
    id: 'underground_out', name: 'Alt Geçit Çıkışı', desc: 'Arkasındaki Alt Geçit Girişinden gelen eşyaları önüne verir.',
    w: 1, h: 1, cost: { iron_plate: 6, concrete: 4 }, category: 'lojistik', color: 0x8a7040, walkable: true,
    inputs: [], outputs: [{ x: 0, y: 0, dir: 0 }], unlock: 1, buildable: true, short: 'AGÇ',
  },
  {
    id: 'smart_splitter', name: 'Akıllı Ayırıcı', desc: 'Her çıkışa filtre ver: belirli bir eşya, herhangi, tanımsız diğerleri, taşma veya kapalı.',
    w: 1, h: 1, cost: { reinforced_plate: 2, rotor: 2, cable: 10 }, category: 'lojistik', color: 0xe08a30,
    inputs: [{ x: 0, y: 0, dir: 2 }], outputs: [{ x: 0, y: 0, dir: 0 }, { x: 0, y: 0, dir: 3 }, { x: 0, y: 0, dir: 1 }], unlock: 2, buildable: true, short: 'AKL',
  },
  {
    id: 'storage', name: 'Depo Kutusu', desc: '24 yuvalı depo. Arkadan alır, önden verir.',
    w: 2, h: 2, cost: { iron_plate: 10, iron_rod: 10 }, category: 'lojistik', color: 0x8a6a4a,
    inputs: [{ x: 0, y: 0, dir: 2 }], outputs: [{ x: 1, y: 0, dir: 0 }], unlock: 0, buildable: true, short: 'DPO',
  },
  {
    id: 'water_extractor', name: 'Su Çıkarıcı', desc: 'Suyun üzerine kurulur. 120 su/dk pompalar.',
    w: 2, h: 2, cost: { steel_pipe: 10, rotor: 5, reinforced_plate: 10 }, category: 'sivi', color: 0x3a7ac0, power: 20, waterRate: 120,
    inputs: [], outputs: [], fluidOut: [{ x: 1, y: 0, dir: 0 }], unlock: 5, buildable: true, short: 'SU',
  },
  {
    id: 'oil_extractor', name: 'Petrol Kuyusu', desc: 'Petrol düğümünün üzerine kurulur. 60 ham petrol/dk (normal).',
    w: 2, h: 2, cost: { motor: 5, steel_pipe: 20, concrete: 40 }, category: 'sivi', color: 0x4a3a5a, power: 40, pumpRate: 60,
    inputs: [], outputs: [], fluidOut: [{ x: 1, y: 0, dir: 0 }], unlock: 5, buildable: true, short: 'PTR',
  },
  {
    id: 'pipe', name: 'Boru', desc: 'Komşu borulara ve sıvı portlarına kendiliğinden bağlanır. Bağlı borular tek bir sıvı hattıdır.',
    w: 1, h: 1, cost: { steel_pipe: 1 }, category: 'sivi', color: 0x7a8a9a, walkable: true, fluidAll: true, fluidCap: 20,
    inputs: [], outputs: [], unlock: 5, buildable: true, short: 'BRU',
  },
  {
    id: 'fluid_tank', name: 'Sıvı Deposu', desc: '400 birim sıvı tutar, her yandan boruya bağlanır.',
    w: 2, h: 2, cost: { aluminum_sheet: 10, steel_pipe: 10 }, category: 'sivi', color: 0x5a7a9a, fluidAll: true, fluidCap: 400,
    inputs: [], outputs: [], unlock: 5, buildable: true, short: 'TNK',
  },
  {
    id: 'refinery', name: 'Rafineri', desc: 'Ham petrolü plastik, kauçuk veya yakıta işler.',
    w: 3, h: 2, cost: { motor: 10, modular_frame: 10, steel_pipe: 30, aluminum_sheet: 10 }, category: 'sivi', color: 0xb06a2a, power: 30, crafter: true,
    inputs: [], outputs: [{ x: 2, y: 0, dir: 0 }], fluidIn: [{ x: 0, y: 0, dir: 2 }], fluidOut: [{ x: 2, y: 1, dir: 0 }], unlock: 5, buildable: true, short: 'RFN',
  },
  {
    id: 'fuel_generator', name: 'Yakıt Jeneratörü', desc: 'Yakıt yakarak 150 MW üretir (12 yakıt/dk).',
    w: 3, h: 2, cost: { motor: 15, aluminum_sheet: 20, steel_beam: 20, rubber: 20 }, category: 'enerji', color: 0xc08a2a, powerGen: 150,
    fuels: ['fuel'], inputs: [], outputs: [], fluidIn: [{ x: 0, y: 0, dir: 2 }], unlock: 5, buildable: true, short: 'YKT',
  },
  {
    id: 'crate', name: 'Eşya Sandığı', desc: 'Düşen eşyalar.',
    w: 1, h: 1, cost: {}, category: 'ozel', color: 0x6a4a2a, walkable: true, inputs: [], outputs: [], unlock: -1, buildable: false, short: 'SND',
  },
];

export const BUILDINGS: Record<string, BuildingDef> = Object.fromEntries(list.map((b) => [b.id, b]));
export const BUILDING_LIST = list;

export const CATEGORY_NAMES: Record<BuildingCategory, string> = {
  uretim: 'Üretim',
  lojistik: 'Lojistik',
  sivi: 'Sıvılar',
  enerji: 'Enerji',
  ozel: 'Özel',
};

export function isBelt(type: string): boolean {
  return BUILDINGS[type]?.beltSpeed !== undefined;
}

export interface WorldPort {
  /** Portun bulunduğu bina tile'ı */
  x: number;
  y: number;
  dir: Dir;
}

export function footprint(type: string, x: number, y: number, rot: number): Array<[number, number]> {
  const def = BUILDINGS[type];
  const [w, h] = footprintSize(def.w, def.h, rot);
  const out: Array<[number, number]> = [];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) out.push([x + i, y + j]);
  return out;
}

export function worldPorts(type: string, x: number, y: number, rot: number, kind: 'inputs' | 'outputs' | 'fluidIn' | 'fluidOut'): WorldPort[] {
  const def = BUILDINGS[type];
  return (def[kind] ?? []).map((p) => {
    const [lx, ly] = rotateLocal(p.x, p.y, def.w, def.h, rot);
    return { x: x + lx, y: y + ly, dir: rotDir(p.dir, rot) };
  });
}

/** Alt geçit girişi ile çıkışı arasındaki en fazla mesafe (tile) */
export const UNDERGROUND_RANGE = 6;

/** Girişin önünde aynı yöne bakan en yakın çıkışı bulur; arada aynı yönde başka giriş varsa eşleşme yoktur. */
export function findUndergroundExit(
  x: number,
  y: number,
  rot: number,
  at: (x: number, y: number) => { type: string; rot: number } | undefined,
): [number, number] | null {
  for (let k = 1; k <= UNDERGROUND_RANGE; k++) {
    const tx = x + DX[rot] * k, ty = y + DY[rot] * k;
    const b = at(tx, ty);
    if (!b || b.rot !== rot) continue;
    if (b.type === 'underground_out') return [tx, ty];
    if (b.type === 'underground_in') return null;
  }
  return null;
}

/** Akıllı ayırıcı filtre seçenekleri (eşya kimlikleri dışındakiler) */
export const SPLITTER_FILTERS: Record<string, string> = {
  any: 'Herhangi',
  none: 'Kapalı',
  rest: 'Tanımsız diğerleri',
  overflow: 'Taşma',
};

/** Filtrelere göre bir eşyanın gidebileceği çıkışlar: önce birincil adaylar, olmazsa taşma çıkışları */
export function splitterTargets(filters: string[], item: string): { primary: number[]; overflow: number[] } {
  const specific = filters.some((f) => f === item);
  const primary: number[] = [];
  const overflow: number[] = [];
  filters.forEach((f, i) => {
    if (f === item || f === 'any' || (f === 'rest' && !specific)) primary.push(i);
    else if (f === 'overflow') overflow.push(i);
  });
  return { primary, overflow };
}
