export interface RecipeDef {
  id: string;
  name: string;
  /** Bu tarifi çalıştırabilen makine tipleri */
  machines: string[];
  /** Elle (Çalışma Tezgahı / HUB) üretilebilir mi */
  hand: boolean;
  inputs: Record<string, number>;
  outputs: Record<string, number>;
  /** Saniye cinsinden süre */
  time: number;
  /** Açılması için tamamlanması gereken HUB kademesi (-1 = baştan açık) */
  unlock: number;
}

const list: RecipeDef[] = [
  { id: 'iron_ingot', name: 'Demir Külçe', machines: ['smelter'], hand: true, inputs: { ore_iron: 1 }, outputs: { iron_ingot: 1 }, time: 2, unlock: -1 },
  { id: 'copper_ingot', name: 'Bakır Külçe', machines: ['smelter'], hand: true, inputs: { ore_copper: 1 }, outputs: { copper_ingot: 1 }, time: 2, unlock: -1 },
  { id: 'iron_plate', name: 'Demir Plaka', machines: ['constructor'], hand: true, inputs: { iron_ingot: 3 }, outputs: { iron_plate: 2 }, time: 6, unlock: -1 },
  { id: 'iron_rod', name: 'Demir Çubuk', machines: ['constructor'], hand: true, inputs: { iron_ingot: 1 }, outputs: { iron_rod: 1 }, time: 4, unlock: -1 },
  { id: 'screw', name: 'Vida', machines: ['constructor'], hand: true, inputs: { iron_rod: 1 }, outputs: { screw: 4 }, time: 6, unlock: -1 },
  { id: 'wire', name: 'Tel', machines: ['constructor'], hand: true, inputs: { copper_ingot: 1 }, outputs: { wire: 2 }, time: 4, unlock: -1 },
  { id: 'cable', name: 'Kablo', machines: ['constructor'], hand: true, inputs: { wire: 2 }, outputs: { cable: 1 }, time: 2, unlock: -1 },
  { id: 'concrete', name: 'Beton', machines: ['constructor'], hand: true, inputs: { limestone: 3 }, outputs: { concrete: 1 }, time: 4, unlock: -1 },
  { id: 'biomass_leaves', name: 'Biyokütle (Yaprak)', machines: ['constructor'], hand: true, inputs: { leaves: 10 }, outputs: { biomass: 5 }, time: 5, unlock: -1 },
  { id: 'biomass_wood', name: 'Biyokütle (Odun)', machines: ['constructor'], hand: true, inputs: { wood: 4 }, outputs: { biomass: 20 }, time: 4, unlock: -1 },
  { id: 'reinforced_plate', name: 'Güçlendirilmiş Plaka', machines: ['assembler'], hand: true, inputs: { iron_plate: 6, screw: 12 }, outputs: { reinforced_plate: 1 }, time: 12, unlock: 1 },
  { id: 'rotor', name: 'Rotor', machines: ['assembler'], hand: true, inputs: { iron_rod: 5, screw: 25 }, outputs: { rotor: 1 }, time: 15, unlock: 1 },
  { id: 'modular_frame', name: 'Modüler Çerçeve', machines: ['assembler'], hand: true, inputs: { reinforced_plate: 3, iron_rod: 12 }, outputs: { modular_frame: 2 }, time: 60, unlock: 2 },
  { id: 'steel_ingot', name: 'Çelik Külçe', machines: ['foundry'], hand: false, inputs: { ore_iron: 3, coal: 3 }, outputs: { steel_ingot: 3 }, time: 4, unlock: 3 },
  { id: 'steel_beam', name: 'Çelik Kiriş', machines: ['constructor'], hand: true, inputs: { steel_ingot: 4 }, outputs: { steel_beam: 1 }, time: 4, unlock: 3 },
  { id: 'steel_pipe', name: 'Çelik Boru', machines: ['constructor'], hand: true, inputs: { steel_ingot: 3 }, outputs: { steel_pipe: 2 }, time: 6, unlock: 3 },
  { id: 'stator', name: 'Stator', machines: ['assembler'], hand: false, inputs: { steel_pipe: 3, wire: 8 }, outputs: { stator: 1 }, time: 12, unlock: 4 },
  { id: 'motor', name: 'Motor', machines: ['assembler'], hand: false, inputs: { rotor: 2, stator: 2 }, outputs: { motor: 1 }, time: 12, unlock: 4 },
];

export const RECIPES: Record<string, RecipeDef> = Object.fromEntries(list.map((r) => [r.id, r]));
export const RECIPE_LIST = list;

export function recipesFor(machine: string): RecipeDef[] {
  return list.filter((r) => r.machines.includes(machine));
}

/** Elle üretim süresi (makineden biraz daha hızlı, erken oyunu akıcı kılmak için) */
export function handCraftTime(r: RecipeDef): number {
  return Math.max(0.5, r.time / 2);
}
