import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ClientMsg } from '@fabrika/shared';
import { WebSocketServer } from 'ws';
import { Persistence } from './persistence';
import type { Room } from './room';
import { RoomManager } from './roomManager';

const PORT = Number(process.env.PORT ?? 3000);
const here = dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = resolve(process.env.STATIC_DIR ?? join(here, '../../client/dist'));
const SAVE_FILE = process.env.SAVE_FILE ?? resolve(here, '../../saves/fabrika.db');
const CHEATS = process.env.CHEATS === '1';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

const persistence = new Persistence(SAVE_FILE);
const manager = new RoomManager(persistence, CHEATS);

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: manager.rooms.size }));
    return;
  }
  let file = normalize(join(STATIC_DIR, decodeURIComponent(url.pathname)));
  if (!file.startsWith(STATIC_DIR)) { res.writeHead(403); res.end(); return; }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(STATIC_DIR, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Fabrika sunucusu çalışıyor. İstemci derlenmemiş: `npm run build` çalıştırın veya geliştirme için `npm run dev:client` kullanın.');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });

wss.on('connection', (ws) => {
  let room: Room | undefined;
  let playerId: number | undefined;
  let msgCount = 0;
  const rateTimer = setInterval(() => { msgCount = 0; }, 1000);

  ws.on('message', (raw) => {
    if (++msgCount > 120) return;
    let msg: ClientMsg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'join') {
      if (room) return;
      const name = String(msg.name ?? '').trim().slice(0, 16) || 'İşçi';
      const r = msg.create ? manager.create() : msg.room ? manager.get(String(msg.room)) : undefined;
      if (!r) { ws.send(JSON.stringify({ t: 'error', msg: 'Oda bulunamadı' })); return; }
      const res = r.addPlayer(ws, name, typeof msg.token === 'string' ? msg.token : undefined);
      if (typeof res === 'string') { ws.send(JSON.stringify({ t: 'error', msg: res })); return; }
      room = r;
      playerId = res;
      console.log(`[${r.code}] ${name} katıldı (${r.playerCount} oyuncu)`);
      return;
    }
    if (room && playerId !== undefined) {
      try {
        room.handle(playerId, msg);
      } catch (err) {
        console.error('mesaj hatası', err);
      }
    }
  });

  ws.on('close', () => {
    clearInterval(rateTimer);
    if (room && playerId !== undefined) room.removePlayer(playerId);
  });
});

server.listen(PORT, () => {
  console.log(`Fabrika sunucusu http://localhost:${PORT} adresinde çalışıyor${CHEATS ? ' (hileler açık)' : ''}`);
});

const shutdown = () => {
  console.log('Kapatılıyor, dünyalar kaydediliyor...');
  manager.shutdown();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
