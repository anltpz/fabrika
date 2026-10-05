import { TICK_RATE } from '@fabrika/shared';
import type { ClientMsg, ServerMsg, Snapshot } from '@fabrika/shared';
import type { WebSocket } from 'ws';
import type { Persistence } from './persistence';
import { World } from './sim/world';

const SAVE_INTERVAL_MS = 60_000;

export class Room {
  code: string;
  world: World;
  private sockets = new Map<number, WebSocket>();
  private timer?: NodeJS.Timeout;
  private lastSave = Date.now();

  constructor(code: string, world: World, private persistence: Persistence | undefined, cheats: boolean) {
    this.code = code;
    this.world = world;
    this.world.cheats = cheats;
  }

  get playerCount() {
    return this.sockets.size;
  }

  addPlayer(ws: WebSocket, name: string, token?: string): number | string {
    const res = this.world.join(name, token);
    if (typeof res === 'string') return res;
    const p = res;
    this.sockets.set(p.id, ws);
    const snap: Snapshot = {
      room: this.code,
      seed: this.world.seed,
      you: p.id,
      token: p.token,
      buildings: this.world.allBuildings(),
      players: this.world.playersPublic(),
      enemies: this.world.enemiesState(),
      nests: this.world.nestsState(),
      removedTrees: [...this.world.removedTrees],
      tech: this.world.tech,
      inventory: p.inventory,
      power: this.world.netInfo,
    };
    this.sendTo(p.id, { t: 'welcome', snap });
    this.broadcast({ t: 'players', players: this.world.playersPublic() });
    this.broadcast({ t: 'chat', from: 'Sistem', color: 0xffd060, sys: true, text: `${p.name} oyuna katıldı.` });
    this.start();
    return p.id;
  }

  removePlayer(id: number) {
    if (!this.sockets.has(id)) return;
    this.sockets.delete(id);
    const p = this.world.players.get(id);
    this.world.leave(id);
    this.broadcast({ t: 'players', players: this.world.playersPublic() });
    if (p) this.broadcast({ t: 'chat', from: 'Sistem', color: 0xffd060, sys: true, text: `${p.name} oyundan ayrıldı.` });
    if (this.sockets.size === 0) {
      this.stop();
      this.save();
    }
  }

  handle(id: number, msg: ClientMsg) {
    const w = this.world;
    switch (msg.t) {
      case 'input': w.setInput(id, msg.input, msg.angle, msg.seq); break;
      case 'chat': w.chat(id, msg.text); break;
      case 'build': w.build(id, msg.type, msg.x | 0, msg.y | 0, msg.rot | 0); break;
      case 'buildBelts': w.buildBelts(id, msg.type, msg.path); break;
      case 'dismantle': w.dismantle(id, msg.id); break;
      case 'setRecipe': w.setRecipe(id, msg.id, msg.recipe); break;
      case 'take': w.take(id, msg.id, msg.from, msg.item, msg.slot); break;
      case 'put': w.put(id, msg.id, msg.slot, msg.count); break;
      case 'craft': w.craft(id, msg.recipe, msg.count); break;
      case 'cancelCraft': w.cancelCraft(id); break;
      case 'harvest': w.harvest(id, msg.x, msg.y); break;
      case 'attack': w.attack(id, msg.angle); break;
      case 'hubSubmit': w.hubSubmit(id); break;
      case 'resetFuse': w.resetFuse(id, msg.id); break;
      case 'setFilter': w.setFilter(id, msg.id, msg.index, msg.filter); break;
      case 'ping': this.sendTo(id, { t: 'pong', time: msg.time }); break;
    }
  }

  private start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), 1000 / TICK_RATE);
  }

  private stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private tick() {
    const w = this.world;
    try {
      w.step();
      w.collectUpdates();
    } catch (err) {
      console.error(`[${this.code}] tick hatası`, err);
    }
    for (const msg of w.out) {
      if (msg.t === 'tick') {
        // Her oyuncuya kendi son girdi sırasını ekle
        for (const [pid, ws] of this.sockets) {
          const p = w.players.get(pid);
          safeSend(ws, JSON.stringify({ ...msg, ack: p?.inputSeq }));
        }
      } else {
        this.broadcast(msg);
      }
    }
    for (const { to, msg } of w.direct) this.sendTo(to, msg);
    w.out = [];
    w.direct = [];
    if (Date.now() - this.lastSave > SAVE_INTERVAL_MS) this.save();
  }

  save() {
    this.lastSave = Date.now();
    if (!this.persistence) return;
    try {
      this.persistence.save(this.code, this.world.serialize());
    } catch (err) {
      console.error(`[${this.code}] kayıt hatası`, err);
    }
  }

  broadcast(msg: ServerMsg) {
    const data = JSON.stringify(msg);
    for (const ws of this.sockets.values()) safeSend(ws, data);
  }

  sendTo(id: number, msg: ServerMsg) {
    const ws = this.sockets.get(id);
    if (ws) safeSend(ws, JSON.stringify(msg));
  }

  shutdown() {
    this.stop();
    this.save();
  }
}

function safeSend(ws: WebSocket, data: string) {
  if (ws.readyState === ws.OPEN) ws.send(data);
}
