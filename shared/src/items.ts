export interface ItemDef {
  id: string;
  name: string;
  color: number;
  stack: number;
  /** Yakıt enerjisi (MJ), yakıt değilse yok */
  energy?: number;
  /** Sıvı mı (envantere ve bantlara girmez, borularla taşınır) */
  fluid?: boolean;
}

const list: ItemDef[] = [
  { id: 'ore_iron', name: 'Demir Cevheri', color: 0x9a6b5a, stack: 100 },
  { id: 'ore_copper', name: 'Bakır Cevheri', color: 0xc8703a, stack: 100 },
  { id: 'limestone', name: 'Kireçtaşı', color: 0xd8d0b0, stack: 100 },
  { id: 'coal', name: 'Kömür', color: 0x2b2b2b, stack: 100, energy: 300 },
  { id: 'leaves', name: 'Yaprak', color: 0x5aa04a, stack: 500, energy: 15 },
  { id: 'wood', name: 'Odun', color: 0x8a5a2b, stack: 200, energy: 100 },
  { id: 'biomass', name: 'Biyokütle', color: 0x9ccf3a, stack: 200, energy: 180 },
  { id: 'iron_ingot', name: 'Demir Külçe', color: 0xb0b8c0, stack: 100 },
  { id: 'copper_ingot', name: 'Bakır Külçe', color: 0xe08a45, stack: 100 },
  { id: 'steel_ingot', name: 'Çelik Külçe', color: 0x6c7682, stack: 100 },
  { id: 'iron_plate', name: 'Demir Plaka', color: 0xd0d6de, stack: 200 },
  { id: 'iron_rod', name: 'Demir Çubuk', color: 0x8d97a3, stack: 200 },
  { id: 'screw', name: 'Vida', color: 0xa7b0b9, stack: 500 },
  { id: 'wire', name: 'Tel', color: 0xf0a860, stack: 500 },
  { id: 'cable', name: 'Kablo', color: 0x3d4a5c, stack: 200 },
  { id: 'concrete', name: 'Beton', color: 0xbdbdbd, stack: 200 },
  { id: 'reinforced_plate', name: 'Güçlendirilmiş Plaka', color: 0x8fb0d0, stack: 100 },
  { id: 'rotor', name: 'Rotor', color: 0x9aa6b8, stack: 100 },
  { id: 'modular_frame', name: 'Modüler Çerçeve', color: 0x7d9a5a, stack: 50 },
  { id: 'steel_beam', name: 'Çelik Kiriş', color: 0x56626e, stack: 100 },
  { id: 'steel_pipe', name: 'Çelik Boru', color: 0x6f8296, stack: 100 },
  { id: 'stator', name: 'Stator', color: 0xc0a050, stack: 100 },
  { id: 'motor', name: 'Motor', color: 0xc0583a, stack: 50 },
  { id: 'sulfur', name: 'Kükürt', color: 0xe8d040, stack: 100 },
  { id: 'quartz', name: 'Ham Kuvars', color: 0xe0b0d8, stack: 100 },
  { id: 'bauxite', name: 'Boksit', color: 0xc06a50, stack: 100 },
  { id: 'black_powder', name: 'Siyah Barut', color: 0x3a3a44, stack: 200 },
  { id: 'explosive', name: 'Patlayıcı', color: 0xd04030, stack: 50 },
  { id: 'quartz_crystal', name: 'Kuvars Kristali', color: 0xf0c8f0, stack: 200 },
  { id: 'silica', name: 'Silika', color: 0xf4f0e8, stack: 200 },
  { id: 'aluminum_ingot', name: 'Alüminyum Külçe', color: 0xd8e0e8, stack: 100 },
  { id: 'aluminum_sheet', name: 'Alüminyum Levha', color: 0xe8f0f8, stack: 200 },
  { id: 'plastic', name: 'Plastik', color: 0x4aa8e0, stack: 200 },
  { id: 'rubber', name: 'Kauçuk', color: 0x2a2a2a, stack: 200 },
  { id: 'circuit_board', name: 'Devre Kartı', color: 0x3a9a5a, stack: 100 },
  { id: 'computer', name: 'Bilgisayar', color: 0x5a6a8a, stack: 50 },
  { id: 'water', name: 'Su', color: 0x3a8ae0, stack: 0, fluid: true },
  { id: 'crude_oil', name: 'Ham Petrol', color: 0x2a1e2e, stack: 0, fluid: true },
  { id: 'fuel', name: 'Yakıt', color: 0xe0a020, stack: 0, fluid: true, energy: 750 },
];

export const ITEMS: Record<string, ItemDef> = Object.fromEntries(list.map((i) => [i.id, i]));
export const ITEM_IDS = list.map((i) => i.id);
export const ITEM_INDEX: Record<string, number> = Object.fromEntries(list.map((i, n) => [i.id, n]));

export function isFluid(id: string): boolean {
  return !!ITEMS[id]?.fluid;
}

export function itemName(id: string): string {
  return ITEMS[id]?.name ?? id;
}
