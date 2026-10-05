import type { BuildingState, CraftJob, EnemyState, NestState, PlayerPublic, PowerNetInfo, Slot, TechState } from './types';

export interface InputState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

export type ClientMsg =
  | { t: 'join'; name: string; token?: string; room?: string; create?: boolean }
  | { t: 'input'; input: InputState; angle: number; seq: number }
  | { t: 'chat'; text: string }
  | { t: 'build'; type: string; x: number; y: number; rot: number }
  | { t: 'buildBelts'; type: string; path: Array<{ x: number; y: number; dir: number }> }
  | { t: 'dismantle'; id: number }
  | { t: 'setRecipe'; id: number; recipe: string }
  | { t: 'setFilter'; id: number; index: number; filter: string }
  | { t: 'take'; id: number; from: 'in' | 'out' | 'storage'; item?: string; slot?: number }
  | { t: 'put'; id: number; slot: number; count?: number }
  | { t: 'craft'; recipe: string; count: number }
  | { t: 'cancelCraft' }
  | { t: 'harvest'; x: number; y: number }
  | { t: 'attack'; angle: number }
  | { t: 'hubSubmit' }
  | { t: 'resetFuse'; id: number }
  | { t: 'ping'; time: number };

export interface Snapshot {
  room: string;
  seed: number;
  you: number;
  token: string;
  buildings: BuildingState[];
  players: PlayerPublic[];
  enemies: EnemyState[];
  nests: NestState[];
  removedTrees: number[];
  tech: TechState;
  inventory: Array<Slot | null>;
  power: PowerNetInfo[];
}

/** Tick içindeki oyuncu: [id, x, y, açı, hp] */
export type PlayerTick = [number, number, number, number, number];
/** Tick içindeki düşman: [id, x, y, hp] */
export type EnemyTick = [number, number, number, number];
/** Bant içerikleri: id -> düz dizi [itemIndex, pos*1000, ...] */
export type BeltTick = Record<number, number[]>;

export type ServerMsg =
  | { t: 'welcome'; snap: Snapshot }
  | { t: 'error'; msg: string }
  | { t: 'tick'; tick: number; players?: PlayerTick[]; enemies?: EnemyTick[]; belts?: BeltTick; ack?: number }
  | { t: 'buildings'; upsert: BuildingState[]; remove: number[] }
  | { t: 'players'; players: PlayerPublic[] }
  | { t: 'inv'; inventory: Array<Slot | null> }
  | { t: 'craft'; queue: CraftJob[] }
  | { t: 'chat'; from: string; color: number; text: string; sys?: boolean }
  | { t: 'tech'; tech: TechState }
  | { t: 'trees'; removed: number[] }
  | { t: 'nests'; nests: NestState[] }
  | { t: 'power'; nets: PowerNetInfo[] }
  | { t: 'stats'; produced: Record<string, number>; consumed: Record<string, number> }
  | { t: 'fx'; kind: 'hit' | 'swing' | 'death' | 'enemyDeath' | 'harvest' | 'build'; x: number; y: number; angle?: number; by?: number }
  | { t: 'toast'; msg: string; kind?: 'info' | 'warn' | 'good' }
  | { t: 'pong'; time: number };
