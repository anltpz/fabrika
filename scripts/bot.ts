/**
 * Test botu: bir odaya bağlanır ve hile komutlarıyla küçük bir üretim hattı kurar.
 * Kullanım: CHEATS=1 ile çalışan sunucuda `npx tsx scripts/bot.ts <ODA_KODU>`
 */
import WebSocket from 'ws';
import { generateMap } from '@fabrika/shared';
import type { ClientMsg, ServerMsg, Slot } from '@fabrika/shared';

const room = process.argv[2];
const url = process.env.URL ?? 'ws://localhost:3000/ws';
const ws = new WebSocket(url);
const send = (m: ClientMsg) => ws.send(JSON.stringify(m));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let inv: Array<Slot | null> = [];

const handled = new Set<number>();
ws.on('message', async (raw) => {
  const msg = JSON.parse(String(raw)) as ServerMsg;
  if (msg.t === 'inv') inv = msg.inventory;
  if (msg.t === 'toast') console.log('toast:', msg.msg);
  if (msg.t === 'buildings') {
    for (const b of msg.upsert) {
      if (handled.has(b.id)) continue;
      if (b.type === 'smelter' && !b.recipe) { handled.add(b.id); send({ t: 'setRecipe', id: b.id, recipe: 'iron_ingot' }); }
      if (b.type === 'biomass_burner') {
        const slot = inv.findIndex((s) => s?.item === 'biomass');
        if (slot >= 0) { handled.add(b.id); send({ t: 'put', id: b.id, slot }); }
      }
    }
  }
  if (msg.t !== 'welcome') return;
  const map = generateMap(msg.snap.seed);
  const cx = map.spawn.x, cy = map.spawn.y;
  const node = map.nodes.find((n) => n.item === 'ore_iron' && n.x === cx + 9 && n.y === cy - 4)!;
  const nx = node.x, ny = node.y;
  send({ t: 'chat', text: '/ver hepsi' });
  for (let i = 0; i < 4; i++) send({ t: 'chat', text: '/kademe' });
  send({ t: 'chat', text: `/tp ${nx + 4} ${ny + 6}` });
  await wait(300);
  // Ağaçları temizle
  for (let y = ny - 1; y <= ny + 5; y++) for (let x = nx - 1; x <= nx + 10; x++) {
    if (map.trees[y * map.size + x]) { send({ t: 'chat', text: `/tp ${x + 0.5} ${y + 1.5}` }); await wait(80); send({ t: 'harvest', x, y }); await wait(700); }
  }
  send({ t: 'chat', text: `/tp ${nx + 4} ${ny + 6}` });
  await wait(200);
  send({ t: 'build', type: 'miner_mk1', x: nx, y: ny, rot: 0 });
  send({ t: 'buildBelts', type: 'belt_mk1', path: [{ x: nx + 2, y: ny, dir: 0 }, { x: nx + 3, y: ny, dir: 0 }] });
  send({ t: 'build', type: 'smelter', x: nx + 4, y: ny, rot: 0 });
  send({ t: 'buildBelts', type: 'belt_mk1', path: [{ x: nx + 6, y: ny, dir: 0 }, { x: nx + 7, y: ny, dir: 0 }, { x: nx + 8, y: ny, dir: 1 }, { x: nx + 8, y: ny + 1, dir: 1 }] });
  send({ t: 'build', type: 'storage', x: nx + 8, y: ny + 2, rot: 1 });
  send({ t: 'build', type: 'power_pole', x: nx + 3, y: ny + 2, rot: 0 });
  send({ t: 'build', type: 'biomass_burner', x: nx, y: ny + 3, rot: 0 });
  await wait(500);
  console.log('bina sayısı (bot görüşü) gönderildi');
  send({ t: 'chat', text: 'Bot: üretim hattı kuruldu!' });
  await wait(60000);
  ws.close();
});

ws.on('open', () => send({ t: 'join', name: 'Bot', room }));
