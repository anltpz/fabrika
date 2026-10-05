import { MAX_PLAYERS, TICK_RATE } from '@fabrika/shared';
import type { BotLogLine, BotStatus, ClientMsg, ServerMsg, Snapshot } from '@fabrika/shared';
import { BotRun } from './bot/stressBot';
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

  private bots = new Set<number>();
  private botRun?: BotRun;
  private botLines: BotLogLine[] = [];
  private botStatus: BotStatus = { running: false, count: 0, minutes: 0, startedAt: 0, summary: '', warn: false, ok: 0, fail: 0 };

  constructor(code: string, world: World, private persistence: Persistence | undefined, cheats: boolean, public speed = 1, private botCfg?: { url: string; key: string }) {
    this.code = code;
    this.world = world;
    this.world.cheats = cheats;
  }

  get playerCount() {
    return this.sockets.size;
  }

  isBot(id: number): boolean {
    return this.bots.has(id);
  }

  addPlayer(ws: WebSocket, name: string, token?: string, isBot = false): number | string {
    const res = this.world.join(name, token, isBot);
    if (typeof res === 'string') return res;
    const p = res;
    this.sockets.set(p.id, ws);
    if (isBot) this.bots.add(p.id);
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
      blueprints: this.world.blueprints,
      markers: this.world.markers,
      explored: this.world.exploredList(),
      lootOpened: [...this.world.lootOpened],
      blasted: [...this.world.blasted],
      trains: this.world.trainsInfo(),
      speed: this.speed,
    };
    this.sendTo(p.id, { t: 'welcome', snap });
    if (!isBot) this.sendTo(p.id, { t: 'botStatus', status: this.botStatus });
    this.broadcast({ t: 'players', players: this.world.playersPublic() });
    this.broadcast({ t: 'chat', from: 'Sistem', color: 0xffd060, sys: true, text: `${p.name} oyuna katıldı.` });
    this.start();
    return p.id;
  }

  removePlayer(id: number) {
    if (!this.sockets.has(id)) return;
    this.sockets.delete(id);
    const wasBot = this.bots.delete(id);
    const p = this.world.players.get(id);
    this.world.leave(id);
    // Test botları kayıtta birikmesin
    if (wasBot) this.world.players.delete(id);
    this.broadcast({ t: 'players', players: this.world.playersPublic() });
    if (p) this.broadcast({ t: 'chat', from: 'Sistem', color: 0xffd060, sys: true, text: `${p.name} oyundan ayrıldı.` });
    // Odada sadece botlar kaldıysa botları durdur
    if (this.botRun && [...this.sockets.keys()].every((pid) => this.bots.has(pid))) this.stopBots('Odada oyuncu kalmadı');
    if (this.sockets.size === 0) {
      this.stop();
      this.save();
    }
  }

  handle(id: number, msg: ClientMsg) {
    const w = this.world;
    switch (msg.t) {
      case 'input': w.setInput(id, msg.input, msg.angle, msg.seq); break;
      case 'chat':
        if (!this.roomCommand(id, String(msg.text ?? ''))) w.chat(id, msg.text);
        break;
      case 'botStart': if (!this.bots.has(id)) this.startBots(id, msg.count, msg.minutes); break;
      case 'botStop': if (!this.bots.has(id)) this.stopBots(`${this.world.players.get(id)?.name ?? 'Bir oyuncu'} botları durdurdu`); break;
      case 'setSpeed': if (!this.bots.has(id)) this.setSpeed(id, msg.speed); break;
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
      case 'bpSave': w.bpSave(id, msg.name, msg.x0, msg.y0, msg.x1, msg.y1); break;
      case 'bpPlace': w.bpPlace(id, msg.id, msg.x, msg.y, msg.rot); break;
      case 'bpDelete': w.bpDelete(id, msg.id); break;
      case 'mapPing': w.mapPing(id, msg.x, msg.y); break;
      case 'markerAdd': w.markerAdd(id, msg.x, msg.y, msg.label, msg.icon); break;
      case 'markerRemove': w.markerRemove(id, msg.id); break;
      case 'trainSchedule': w.trainSchedule(id, msg.id, msg.stops); break;
      case 'trainRemove': w.trainRemove(id, msg.id); break;
      case 'stationMode': w.stationMode(id, msg.id, msg.mode); break;
      case 'stationName': w.stationName(id, msg.id, msg.name); break;
      case 'setFilter': w.setFilter(id, msg.id, msg.index, msg.filter); break;
      case 'ping': this.sendTo(id, { t: 'pong', time: msg.time }); break;
    }
  }

  /** /bot ve /hiz komutları oda düzeyindedir */
  private roomCommand(id: number, text: string): boolean {
    const t = text.trim();
    if (!t.startsWith('/bot') && !t.startsWith('/hiz')) return false;
    if (this.bots.has(id)) return false;
    const [cmd, a, b] = t.slice(1).split(/\s+/);
    if (cmd === 'hiz') { this.setSpeed(id, Number(a)); return true; }
    if (cmd === 'bot') {
      if (a === 'dur' || a === 'durdur' || a === 'stop') this.stopBots(`${this.world.players.get(id)?.name} botları durdurdu`);
      else this.startBots(id, Number(a ?? 1) || 1, Number(b ?? 10));
      return true;
    }
    return false;
  }

  private sys(text: string) {
    this.broadcast({ t: 'chat', from: 'Sistem', color: 0xffd060, sys: true, text });
  }

  setSpeed(id: number, speed: number) {
    const s = Math.round(speed);
    if (!Number.isFinite(s) || s < 1 || s > 4) { this.sendTo(id, { t: 'toast', msg: 'Hız 1 ile 4 arasında olmalı' }); return; }
    if (s === this.speed) return;
    this.speed = s;
    if (this.timer) { this.stop(); this.start(); }
    this.broadcast({ t: 'speed', speed: s });
    this.sys(`${this.world.players.get(id)?.name ?? 'Biri'} oyun hızını ${s}x yaptı.`);
  }

  startBots(id: number, count: number, minutes: number) {
    if (!this.botCfg) { this.sendTo(id, { t: 'toast', msg: 'Bu sunucuda oyun içi botlar kapalı' }); return; }
    if (this.botRun) { this.sendTo(id, { t: 'toast', msg: 'Botlar zaten çalışıyor' }); return; }
    const free = MAX_PLAYERS - this.world.onlineCount();
    const n = Math.max(1, Math.min(free, Math.round(count) || 1));
    if (free <= 0) { this.sendTo(id, { t: 'toast', msg: 'Oda dolu, bot için yer yok (en fazla 4 oyuncu)' }); return; }
    const mins = Math.max(0, Math.min(120, Number.isFinite(minutes) ? minutes : 10));
    const started = Date.now();
    const run = new BotRun({
      url: this.botCfg.url,
      count: n,
      minutes: mins,
      room: this.code,
      botKey: this.botCfg.key,
      log: (who, msg, kind) => {
        this.botLines.push({ t: Math.floor((Date.now() - started) / 1000), who, msg, kind });
        if (this.botLines.length > 200) this.botLines.splice(0, this.botLines.length - 200);
      },
      onSummary: (line, warn) => {
        this.botStatus = { ...this.botStatus, summary: line, warn, ok: run.ctx.totals.modulesOk, fail: run.ctx.totals.modulesFail };
        this.broadcastHumans({ t: 'botStatus', status: this.botStatus });
      },
    });
    this.botRun = run;
    this.botStatus = { running: true, count: n, minutes: mins, startedAt: started, summary: 'Botlar bağlanıyor...', warn: false, ok: 0, fail: 0 };
    this.broadcastHumans({ t: 'botStatus', status: this.botStatus });
    this.sys(`${this.world.players.get(id)?.name} ${n} test botu çağırdı${mins ? ` (${mins} dk)` : ''}. Botlar tüm kademeleri açar ve hızla inşa eder.`);
    const names = Array.from({ length: n }, (_, i) => `Bot${i + 1}`);
    run.connect(names)
      .then(() => run.run())
      .catch((e) => this.sys(`Botlar başlatılamadı: ${(e as Error).message}`))
      .finally(() => { if (this.botRun === run) this.stopBots('Bot süresi doldu'); });
  }

  stopBots(reason: string) {
    const run = this.botRun;
    if (!run) return;
    this.botRun = undefined;
    run.stop();
    const t = run.ctx.totals;
    const warnings = [...t.toasts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([m, n]) => `${n}× ${m}`).join(', ');
    this.botStatus = { ...this.botStatus, running: false, ok: t.modulesOk, fail: t.modulesFail };
    this.broadcastHumans({ t: 'botStatus', status: this.botStatus });
    this.sys(`${reason}. Bot raporu: ✔${t.modulesOk} ✘${t.modulesFail} modül${warnings ? ` · uyarılar: ${warnings}` : ''}`);
  }

  private broadcastHumans(msg: ServerMsg) {
    const data = JSON.stringify(msg);
    for (const [pid, ws] of this.sockets) if (!this.bots.has(pid)) safeSend(ws, data);
  }

  private start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), 1000 / (TICK_RATE * this.speed));
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
    if (this.botLines.length && w.tickCount % 10 === 0) {
      this.broadcastHumans({ t: 'botLog', lines: this.botLines });
      this.botLines = [];
    }
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
    this.botRun?.stop();
    this.stop();
    this.save();
  }
}

function safeSend(ws: WebSocket, data: string) {
  if (ws.readyState === ws.OPEN) ws.send(data);
}
