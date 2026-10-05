import { BUILDINGS, MILESTONES, PLAYER_MAX_HP, itemName } from '@fabrika/shared';
import type { ServerMsg } from '@fabrika/shared';
import { drawMinimapBase } from '../render/terrain';
import type { GameState } from '../state';
import { h, hex } from './dom';

export class Hud {
  root: HTMLElement;
  private players = h('div');
  private power = h('div', { class: 'hud-box power-box' });
  private techMini = h('div', { class: 'hud-box tech-mini' });
  private roomBox = h('div', { class: 'hud-box' });
  private ping = h('span', { class: 'muted' }, '');
  private minimapBase = document.createElement('canvas');
  private minimap = document.createElement('canvas');
  private coords = h('div', { class: 'coords' });
  private hp = h('div', { class: 'hp-main' }, h('div'));
  private banner = h('div', { class: 'mode-banner', style: { display: 'none' } });
  hotbar = h('div', { class: 'hotbar' });
  private toasts = h('div', { class: 'toasts' });
  tooltip = h('div', { class: 'tooltip', style: { display: 'none' } });
  private tooltipHtml = '';
  btns!: HTMLElement;
  private chatWrap = h('div', { class: 'chat' });
  private chatLog = h('div', { class: 'chat-log' });
  chatInput = h('input', { maxlength: '200', placeholder: 'Mesaj yaz... (/yardim)' }) as HTMLInputElement;
  onChat: (text: string) => void = () => {};
  onOpenHub: () => void = () => {};
  onOpenPanel: (kind: string) => void = () => {};
  onHotbar: (i: number) => void = () => {};

  constructor(private state: GameState, parent: HTMLElement) {
    this.root = h('div');
    const roomCode = h('span', { class: 'room-code', title: 'Kopyalamak için tıkla' });
    roomCode.addEventListener('click', () => {
      navigator.clipboard?.writeText(this.state.room).catch(() => {});
      this.toast('Oda kodu kopyalandı', 'good');
    });
    this.roomBox.append(h('div', { class: 'room-line' }, h('span', { class: 'muted' }, 'Oda'), roomCode, this.ping), this.players);
    this.techMini.addEventListener('click', () => this.onOpenHub());
    const btns = h('div', { class: 'hud-btns' },
      h('button', { class: 'ghost', onclick: () => this.onOpenPanel('stats'), title: 'P' }, '📊 İstatistik'),
      h('button', { class: 'ghost', onclick: () => this.onOpenPanel('blueprints'), title: 'B' }, '📐 Planlar'),
    );
    this.btns = btns;
    const top = h('div', { class: 'hud-top' }, this.roomBox, this.techMini, this.power, btns);
    const mm = h('div', { class: 'hud-box minimap' }, this.minimap, this.coords);
    const keys = h('div', { class: 'keys', html: '<span class="kbd">WASD</span> hareket · <span class="kbd">Q</span> inşa · <span class="kbd">R</span> döndür · <span class="kbd">F</span> söküm<br><span class="kbd">E</span> topla/etkileşim · <span class="kbd">Tab</span> envanter · <span class="kbd">H</span> HUB · <span class="kbd">P</span> istatistik · <span class="kbd">B</span> planlar<br><span class="kbd">Sol tık</span> saldır/kullan · <span class="kbd">Sağ tık</span> iptal · <span class="kbd">Enter</span> sohbet' });
    this.chatWrap.append(this.chatLog, this.chatInput);
    this.chatInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const t = this.chatInput.value.trim();
        if (t) this.onChat(t);
        this.chatInput.value = '';
        this.closeChat();
      } else if (e.key === 'Escape') {
        this.closeChat();
      }
    });
    this.root.append(top, mm, keys, this.hp, this.banner, this.hotbar, this.toasts, this.chatWrap, this.tooltip);
    parent.append(this.root);
    (roomCode as HTMLElement).textContent = state.room;

    state.on('players', () => this.renderPlayers());
    state.on('players:tick', () => this.renderPlayersHp());
    state.on('power', () => this.renderPower());
    state.on('tech', () => this.renderTech());
    state.on('inv', () => this.renderTech());
    state.on('chat', (m: Extract<ServerMsg, { t: 'chat' }>) => this.addChat(m));
    state.on('toast', (msg: string, kind?: string) => this.toast(msg, kind));
    state.on('pong', (ms: number) => { this.ping.textContent = `${Math.round(ms)} ms`; });
    state.on('trees', () => { drawMinimapBase(this.minimapBase, this.state.map); });
    drawMinimapBase(this.minimapBase, state.map);
    this.minimap.width = this.minimap.height = 180;
    this.renderPlayers();
    this.renderPower();
    this.renderTech();
  }

  isChatOpen() {
    return this.chatWrap.classList.contains('open');
  }

  openChat() {
    this.chatWrap.classList.add('open');
    this.chatInput.focus();
    this.chatLog.scrollTop = this.chatLog.scrollHeight;
  }

  closeChat() {
    this.chatWrap.classList.remove('open');
    this.chatInput.blur();
  }

  private addChat(m: Extract<ServerMsg, { t: 'chat' }>) {
    const line = h('div', { class: 'chat-line' + (m.sys ? ' sys' : '') });
    if (m.sys) line.append(m.text);
    else line.append(h('span', { class: 'from', style: { color: hex(m.color) } }, m.from + ': '), m.text);
    this.chatLog.append(line);
    while (this.chatLog.children.length > 100) this.chatLog.firstChild?.remove();
    this.chatLog.scrollTop = this.chatLog.scrollHeight;
    setTimeout(() => line.classList.add('old'), 12000);
  }

  toast(msg: string, kind = 'info') {
    const t = h('div', { class: 'toast ' + kind }, msg);
    this.toasts.append(t);
    while (this.toasts.children.length > 4) this.toasts.firstChild?.remove();
    setTimeout(() => t.remove(), 3000);
  }

  private renderPlayers() {
    this.players.replaceChildren(
      ...[...this.state.players.values()]
        .filter((p) => p.online)
        .map((p) =>
          h('div', { class: 'player-row', 'data-id': p.id },
            h('span', { class: 'player-dot', style: { background: hex(p.color) } }),
            h('span', {}, p.name + (p.id === this.state.you ? ' (sen)' : '')),
            h('div', { class: 'hpbar' }, h('div', { style: { width: `${(100 * p.hp) / PLAYER_MAX_HP}%` } })),
          ),
        ),
    );
  }

  private renderPlayersHp() {
    for (const row of this.players.children) {
      const p = this.state.players.get(Number((row as HTMLElement).dataset.id));
      const bar = row.querySelector('.hpbar > div') as HTMLElement | null;
      if (p && bar) bar.style.width = `${(100 * Math.max(0, p.hp)) / PLAYER_MAX_HP}%`;
    }
    const me = this.state.me();
    if (me) (this.hp.firstChild as HTMLElement).style.width = `${(100 * Math.max(0, me.hp)) / PLAYER_MAX_HP}%`;
  }

  private renderPower() {
    const nets = this.state.power;
    if (!nets.length) {
      this.power.replaceChildren(h('div', { class: 'row' }, h('span', { class: 'muted' }, '⚡ Elektrik ağı yok')));
      return;
    }
    const cap = nets.reduce((s, n) => s + n.capacity, 0);
    const use = nets.reduce((s, n) => s + n.consumption, 0);
    const tripped = nets.some((n) => n.tripped);
    this.power.replaceChildren(
      h('div', { class: 'row' }, h('span', {}, '⚡ Güç'), h('span', { class: tripped ? 'bad' : use > cap ? 'bad' : '' }, tripped ? 'SİGORTA ATTI' : `${use} / ${cap} MW`)),
      h('div', { class: 'bar' }, h('div', { style: { width: `${cap ? Math.min(100, (100 * use) / cap) : 0}%`, background: tripped ? 'var(--bad)' : '' } })),
    );
    if (nets.length > 1) this.power.append(h('div', { class: 'muted', style: { fontSize: '11px', marginTop: '3px' } }, `${nets.length} ayrı ağ`));
  }

  renderTech() {
    const t = this.state.tech;
    const m = MILESTONES[t.completed];
    if (!m) {
      this.techMini.replaceChildren(h('div', { class: 'name good' }, '🏆 Tüm kademeler tamamlandı'));
      return;
    }
    const total = Object.values(m.cost).reduce((a, b) => a + b, 0);
    const done = Object.entries(m.cost).reduce((a, [k, v]) => a + Math.min(v, t.delivered[k] ?? 0), 0);
    this.techMini.replaceChildren(
      h('div', { class: 'muted', style: { fontSize: '11px' } }, `KADEME ${t.completed + 1}/${MILESTONES.length} · tıkla veya H`),
      h('div', { class: 'name' }, m.name),
      h('div', { class: 'bar' }, h('div', { style: { width: `${(100 * done) / total}%` } })),
    );
  }

  setBanner(text: string | null, cls = '', extra?: HTMLElement) {
    if (!text) { this.banner.style.display = 'none'; return; }
    this.banner.style.display = '';
    this.banner.className = 'mode-banner ' + cls;
    this.banner.replaceChildren(text);
    if (extra) this.banner.append(extra);
  }

  renderHotbar(slots: string[], active: string | null) {
    this.hotbar.replaceChildren(
      ...slots.map((type, i) => {
        const def = BUILDINGS[type];
        const el = h('div', { class: 'slot' + (active === type ? ' active' : ''), title: def.name },
          h('span', { class: 'num' }, String(i + 1)),
          h('div', {}, h('div', { class: 'sw', style: { background: hex(def.color), margin: '0 auto 2px' } }), h('div', { class: 'lbl' }, def.short)),
        );
        el.addEventListener('click', () => this.onHotbar(i));
        return el;
      }),
    );
  }

  showTooltip(x: number, y: number, html: string | null) {
    if (!html) { this.tooltip.style.display = 'none'; return; }
    this.tooltip.style.display = '';
    if (this.tooltipHtml !== html) { this.tooltipHtml = html; this.tooltip.innerHTML = html; }
    const r = this.tooltip.getBoundingClientRect();
    this.tooltip.style.left = Math.min(window.innerWidth - r.width - 8, x + 16) + 'px';
    this.tooltip.style.top = Math.min(window.innerHeight - r.height - 8, y + 16) + 'px';
  }

  drawMinimap() {
    const g = this.minimap.getContext('2d')!;
    const me = this.state.me();
    const S = this.state.map.size;
    // Oyuncu merkezli, 128 tile görünüm
    const view = 128;
    const cx = me ? Math.max(view / 2, Math.min(S - view / 2, me.x)) : S / 2;
    const cy = me ? Math.max(view / 2, Math.min(S - view / 2, me.y)) : S / 2;
    const sx = cx - view / 2, sy = cy - view / 2;
    const k = 180 / view;
    g.imageSmoothingEnabled = false;
    g.drawImage(this.minimapBase, sx, sy, view, view, 0, 0, 180, 180);
    for (const b of this.state.buildings.values()) {
      if (b.x < sx || b.y < sy || b.x > sx + view || b.y > sy + view) continue;
      const def = BUILDINGS[b.type];
      g.fillStyle = hex(def.color);
      const s = b.type.startsWith('belt') ? 1 : 2;
      g.fillRect((b.x - sx) * k, (b.y - sy) * k, s * k * 0.7, s * k * 0.7);
    }
    for (const n of this.state.nests) {
      if (!n.alive) continue;
      g.fillStyle = '#c040a0';
      g.beginPath();
      g.arc((n.x - sx) * k, (n.y - sy) * k, 3, 0, 7);
      g.fill();
    }
    for (const p of this.state.players.values()) {
      if (!p.online) continue;
      g.fillStyle = hex(p.color);
      g.strokeStyle = '#000';
      g.beginPath();
      g.arc((p.x - sx) * k, (p.y - sy) * k, p.id === this.state.you ? 4 : 3, 0, 7);
      g.fill();
      g.stroke();
    }
    if (me) this.coords.textContent = `${Math.floor(me.x)}, ${Math.floor(me.y)}`;
  }

  nodeTooltip(item: string, purity: string): string {
    return `<b>${itemName(item)}</b>\nKaynak düğümü · ${purity}\nE: elle topla · üzerine Maden Çıkarıcı kur`;
  }
}
