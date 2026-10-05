import { BUILDING_LIST } from './buildings';
import { RECIPE_LIST } from './recipes';

export interface MilestoneDef {
  name: string;
  desc: string;
  cost: Record<string, number>;
}

export const MILESTONES: MilestoneDef[] = [
  { name: 'HUB Kurulumu', desc: 'Elle ürettiğin ilk parçalarla otomasyonun kapısını aç.', cost: { iron_plate: 10, iron_rod: 10 } },
  { name: 'Temel Otomasyon', desc: 'Kurucu ve lojistik parçaları aç.', cost: { iron_plate: 50, iron_rod: 30, wire: 60, concrete: 20 } },
  { name: 'Montaj Hattı', desc: 'Montajcı ve kömür enerjisi.', cost: { cable: 100, screw: 300, reinforced_plate: 20 } },
  { name: 'Çelik Çağı', desc: 'Dökümhane, çelik, patlayıcılar ve kuvars işleme.', cost: { rotor: 30, modular_frame: 20, concrete: 300 } },
  { name: 'Endüstri', desc: 'Motor ve alüminyum üretimine giden yol.', cost: { modular_frame: 50, steel_beam: 100, steel_pipe: 100 } },
  { name: 'Petrol Çağı', desc: 'Borular, sıvılar, rafineri ve yakıt enerjisi.', cost: { motor: 20, stator: 50, aluminum_sheet: 50 } },
  { name: 'Lojistik Ağı', desc: 'Tren rayları ve istasyonlar.', cost: { plastic: 100, rubber: 100, steel_beam: 200 } },
  { name: 'Yüksek Teknoloji', desc: 'Devre kartları ve bilgisayarlar.', cost: { plastic: 200, rubber: 200, motor: 50 } },
  { name: 'Fabrika Ustası', desc: 'Son teslimat. Fabrikanı tamamla!', cost: { computer: 20, motor: 100, aluminum_sheet: 200 } },
];

export function isUnlocked(unlock: number, completed: number): boolean {
  return unlock < completed;
}

export function milestoneUnlocks(index: number): { buildings: string[]; recipes: string[] } {
  return {
    buildings: BUILDING_LIST.filter((b) => b.unlock === index && b.buildable).map((b) => b.name),
    recipes: RECIPE_LIST.filter((r) => r.unlock === index).map((r) => r.name),
  };
}
