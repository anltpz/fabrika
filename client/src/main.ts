import './style.css';
import type { ClientMsg, ServerMsg } from '@fabrika/shared';
import { preloadSprites } from './icons';
import { Controller } from './input';
import { Net } from './net';
import { Renderer } from './render/renderer';
import { GameState } from './state';
import { h } from './ui/dom';
import { Hud } from './ui/hud';
import { Panels } from './ui/panels';

const ui = document.getElementById('ui')!;
const gameEl = document.getElementById('game')!;

function ls(key: string, val?: string): string | null {
  try {
    if (val !== undefined) localStorage.setItem(key, val);
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function showLobby(error = '') {
  const params = new URLSearchParams(location.search);
  const name = h('input', { maxlength: '16', placeholder: 'Takma adın', value: ls('fabrika:name') ?? '' }) as HTMLInputElement;
  const code = h('input', { maxlength: '5', placeholder: 'KOD', value: params.get('oda') ?? ls('fabrika:lastRoom') ?? '' }) as HTMLInputElement;
  const err = h('div', { class: 'lobby-err' }, error);
  const go = (create: boolean) => {
    const n = name.value.trim();
    if (!n) { err.textContent = 'Bir takma ad gir'; name.focus(); return; }
    const c = code.value.trim().toUpperCase();
    if (!create && c.length !== 5) { err.textContent = 'Geçerli bir 5 haneli oda kodu gir'; code.focus(); return; }
    ls('fabrika:name', n);
    lobby.remove();
    join(n, create ? undefined : c, create).catch((e) => showLobby(String(e.message ?? e)));
  };
  code.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(false); });
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') (code.value.trim().length === 5 ? go(false) : go(true)); });
  const lobby = h('div', { class: 'lobby' },
    h('div', { class: 'lobby-card' },
      h('h1', {}, 'FABRİKA'),
      h('div', { class: 'tag' }, '4 kişilik ortak üretim hattı oyunu'),
      h('label', {}, 'Takma ad'),
      name,
      h('button', { class: 'create', onclick: () => go(true) }, 'Yeni Dünya Oluştur'),
      h('div', { class: 'or' }, '— ya da arkadaşının odasına katıl —'),
      h('div', { class: 'lobby-row' }, code, h('button', { onclick: () => go(false) }, 'Katıl')),
      err,
      h('div', { class: 'lobby-help', html:
        'Cevherleri elle topla (<span class="kbd">E</span>), HUB yanında elle üretim yap (<span class="kbd">Tab</span>) ve ilk kademeyi teslim et (<span class="kbd">H</span>). ' +
        'Sonra maden çıkarıcılar, fırınlar ve bantlarla otomatik üretim hattını kurun. Böcek yuvalarına dikkat!' }),
    ),
  );
  ui.append(lobby);
  (name.value ? code : name).focus();
}

async function join(name: string, room: string | undefined, create: boolean) {
  const net = new Net();
  await net.connect();
  const token = room ? ls(`fabrika:token:${room}`) ?? undefined : undefined;
  const state = new GameState();
  const welcome = await new Promise<Extract<ServerMsg, { t: 'welcome' }>>((resolve, reject) => {
    net.onMessage = (msg) => {
      if (msg.t === 'welcome') resolve(msg);
      else if (msg.t === 'error') reject(new Error(msg.msg));
    };
    net.onClose = () => reject(new Error('Bağlantı kapandı'));
    net.send({ t: 'join', name, token, room, create });
  });
  state.load(welcome.snap);
  ls(`fabrika:token:${state.room}`, state.token);
  ls('fabrika:lastRoom', state.room);
  history.replaceState(null, '', `?oda=${state.room}`);
  const queue: ServerMsg[] = [];
  net.onMessage = (msg) => queue.push(msg);
  await startGame(net, state, queue);
}

async function startGame(net: Net, state: GameState, early: ServerMsg[]) {
  const send = (m: ClientMsg) => net.send(m);
  await preloadSprites();
  const renderer = new Renderer(state);
  await renderer.init(gameEl);
  renderer.buildTerrain();
  renderer.syncAll();
  const me = state.me();
  if (me) { renderer.camX = me.x; renderer.camY = me.y; }

  const hud = new Hud(state, ui);
  const panels = new Panels(state, ui, send);
  hud.onChat = (text) => send({ t: 'chat', text });
  hud.onOpenHub = () => panels.toggle('hub');
  hud.onOpenPanel = (kind) => panels.toggle(kind as 'stats' | 'blueprints' | 'map');
  const controller = new Controller(state, renderer, hud, panels, send);

  state.on('buildings', (up, rem) => renderer.syncBuildings(up, rem));
  state.on('trees', (keys: number[]) => renderer.redrawTreeChunks(keys));
  state.on('fx', (fx) => renderer.addFx(fx));
  state.on('error', (msg: string) => hud.toast(msg, 'warn'));
  state.on('markers', () => renderer.syncMarkers());
  state.on('fog', () => renderer.drawFog());
  state.on('loot', () => renderer.drawLoot());
  renderer.drawFog();
  renderer.drawLoot();
  renderer.syncMarkers();
  state.on('mapPing', (m: { name: string; color: number; x: number; y: number }) => {
    state.emit('chat', { t: 'chat', from: m.name, color: m.color, text: `📡 bir yeri işaretledi (${Math.floor(m.x)}, ${Math.floor(m.y)})` });
  });

  net.onMessage = (msg) => state.handle(msg);
  for (const m of early) state.handle(m);
  net.onClose = () => {
    const ov = h('div', { class: 'overlay-msg' }, h('div', { style: { textAlign: 'center' } }, 'Sunucu bağlantısı koptu', h('div', { style: { fontSize: '16px', marginTop: '12px' } }, h('button', { onclick: () => location.reload() }, 'Yeniden Bağlan'))));
    ui.append(ov);
  };

  setInterval(() => send({ t: 'ping', time: performance.now() }), 2000);
  let mmTimer = 0;
  renderer.app.ticker.add((ticker) => {
    const dt = Math.min(0.1, ticker.deltaMS / 1000);
    const { ghost, hover } = controller.update(dt);
    renderer.frame(dt, ghost, hover);
    mmTimer += dt;
    if (mmTimer > 0.25) { mmTimer = 0; hud.drawMinimap(); }
  });
  hud.toast(`Odaya katıldın: ${state.room} — kodu arkadaşlarınla paylaş`, 'good');
}

showLobby();
