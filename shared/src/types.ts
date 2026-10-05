export interface Slot {
  item: string;
  count: number;
}

export type MachineStatus = 'working' | 'idle' | 'nopower' | 'full' | 'nofuel' | 'norecipe' | 'noinput' | 'tripped' | 'unpaired';

export const STATUS_NAMES: Record<MachineStatus, string> = {
  working: 'Çalışıyor',
  idle: 'Boşta',
  nopower: 'Enerji yok',
  full: 'Çıkış dolu',
  nofuel: 'Yakıt yok',
  norecipe: 'Tarif seçilmedi',
  noinput: 'Girdi bekleniyor',
  tripped: 'Sigorta attı',
  unpaired: 'Bağlantı yok',
};

export interface BeltItem {
  item: string;
  pos: number;
}

export interface BuildingState {
  id: number;
  type: string;
  x: number;
  y: number;
  rot: number;
  recipe?: string;
  inBuf: Record<string, number>;
  outBuf: Record<string, number>;
  progress: number;
  status: MachineStatus;
  /** Jeneratörde mevcut yakıttan kalan enerji (MJ) */
  fuel?: number;
  storage?: Array<Slot | null>;
  items?: BeltItem[];
  /** Ayırıcı / depo için sıradaki çıkış */
  rr?: number;
  /** Son ~15 sn'deki çalışma oranı (0..1) */
  eff?: number;
  /** Akıllı ayırıcı filtreleri: [ön, sol, sağ] */
  filters?: string[];
  /** Direk sigortası */
  tripped?: boolean;
  /** Güç ağı kimliği (istemci için) */
  net?: number;
}

export interface PlayerPublic {
  id: number;
  name: string;
  color: number;
  x: number;
  y: number;
  angle: number;
  hp: number;
  online: boolean;
}

export interface EnemyState {
  id: number;
  x: number;
  y: number;
  hp: number;
  nest: number;
}

export interface NestState {
  id: number;
  x: number;
  y: number;
  hp: number;
  alive: boolean;
}

export interface PowerNetInfo {
  id: number;
  production: number;
  capacity: number;
  consumption: number;
  tripped: boolean;
}

export interface TechState {
  completed: number;
  delivered: Record<string, number>;
}

export interface CraftJob {
  recipe: string;
  remaining: number;
  progress: number;
}
