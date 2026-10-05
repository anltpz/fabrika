import type { Blueprint } from './blueprints';
import type { BuildingState, CraftJob, EnemyState, FluidNetInfo, MapMarker, TrainInfo, NestState, PlayerPublic, PowerNetInfo, Slot, TechState } from './types';

export interface InputState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

export type ClientMsg =
  | { t: 'join'; name: string; token?: string; room?: string; create?: boolean; botKey?: string; botMode?: BotMode }
  | { t: 'input'; input: InputState; angle: number; seq: number }
  | { t: 'chat'; text: string }
  | { t: 'build'; type: string; x: number; y: number; rot: number }
  | { t: 'buildBelts'; type: string; path: Array<{ x: number; y: number; dir: number }> }
  | { t: 'dismantle'; id: number }
  | { t: 'setRecipe'; id: number; recipe: string }
  | { t: 'setFilter'; id: number; index: number; filter: string }
  | { t: 'bpSave'; name: string; x0: number; y0: number; x1: number; y1: number }
  | { t: 'bpPlace'; id: number; x: number; y: number; rot: number }
  | { t: 'bpDelete'; id: number }
  | { t: 'mapPing'; x: number; y: number }
  | { t: 'botStart'; count: number; minutes: number; mode?: BotMode }
  | { t: 'botStop' }
  | { t: 'setSpeed'; speed: number }
  | { t: 'trainSchedule'; id: number; stops: number[] }
  | { t: 'trainRemove'; id: number }
  | { t: 'stationMode'; id: number; mode: 'load' | 'unload' }
  | { t: 'stationName'; id: number; name: string }
  | { t: 'markerAdd'; x: number; y: number; label: string; icon: string }
  | { t: 'markerRemove'; id: number }
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
  blueprints: Blueprint[];
  markers: MapMarker[];
  explored: number[];
  lootOpened: number[];
  blasted: number[];
  trains: TrainInfo[];
  /** Oyun hızı çarpanı */
  speed?: number;
}

/** Tick içindeki oyuncu: [id, x, y, açı, hp] */
export type PlayerTick = [number, number, number, number, number];
/** Tick içindeki düşman: [id, x, y, hp] */
export type EnemyTick = [number, number, number, number];
/** Tren: [id, x, y, açı, vagon1x, vagon1y, vagon1açı, ...] */
export type TrainTick = number[];
/** Bant içerikleri: id -> düz dizi [itemIndex, pos*1000, ...] */
export type BeltTick = Record<number, number[]>;

export type ServerMsg =
  | { t: 'welcome'; snap: Snapshot }
  | { t: 'error'; msg: string }
  | { t: 'tick'; tick: number; players?: PlayerTick[]; enemies?: EnemyTick[]; belts?: BeltTick; trains?: TrainTick[]; ack?: number }
  | { t: 'buildings'; upsert: BuildingState[]; remove: number[] }
  | { t: 'players'; players: PlayerPublic[] }
  | { t: 'inv'; inventory: Array<Slot | null> }
  | { t: 'craft'; queue: CraftJob[] }
  | { t: 'chat'; from: string; color: number; text: string; sys?: boolean }
  | { t: 'tech'; tech: TechState }
  | { t: 'trees'; removed: number[] }
  | { t: 'nests'; nests: NestState[] }
  | { t: 'power'; nets: PowerNetInfo[] }
  | { t: 'blueprints'; list: Blueprint[] }
  | { t: 'markers'; list: MapMarker[] }
  | { t: 'fog'; cells: number[] }
  | { t: 'fluids'; nets: FluidNetInfo[] }
  | { t: 'trains'; list: TrainInfo[] }
  | { t: 'speed'; speed: number }
  | { t: 'botLog'; lines: BotLogLine[] }
  | { t: 'botStatus'; status: BotStatus }
  | { t: 'terrain'; grass: number[] }
  | { t: 'loot'; opened: number[] }
  | { t: 'mapPing'; x: number; y: number; by: number; name: string; color: number }
  | { t: 'stats'; produced: Record<string, number>; consumed: Record<string, number> }
  | { t: 'fx'; kind: 'hit' | 'swing' | 'death' | 'enemyDeath' | 'harvest' | 'build' | 'blast'; x: number; y: number; angle?: number; by?: number }
  | { t: 'toast'; msg: string; kind?: 'info' | 'warn' | 'good' }
  | { t: 'pong'; time: number };

export interface BotLogLine {
  /** Bot çalışmaya başladığından beri geçen saniye */
  t: number;
  who: string;
  msg: string;
  kind: 'info' | 'ok' | 'warn' | 'err';
}

/** oyun: hilesiz, sıfırdan oynar · stres: hileli stres testi */
export type BotMode = 'oyun' | 'stres';

export interface BotStatus {
  running: boolean;
  mode?: BotMode;
  count: number;
  minutes: number;
  startedAt: number;
  summary: string;
  warn: boolean;
  ok: number;
  fail: number;
}
