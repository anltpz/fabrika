import {
  BUILDINGS,
  BUILDING_LIST,
  CATEGORY_NAMES,
  ITEMS,
  MILESTONES,
  PURITY_MULT,
  PURITY_NAMES,
  RECIPES,
  FOG_CELL,
  MARKER_ICONS,
  RECIPE_LIST,
  blueprintCost,
  SPLITTER_FILTERS,
  STATUS_NAMES,
  countItem,
  footprint,
  handCraftTime,
  hasItems,
  isUnlocked,
  itemName,
  milestoneUnlocks,
  recipesFor,
  tileKey,
} from '@fabrika/shared';
import type { BuildingCategory, BuildingState, ClientMsg } from '@fabrika/shared';
import type { GameState } from '../state';
import { drawMinimapBase } from '../render/terrain';
import { chip, costChips, flowChips, fmt, h, hex, icon } from './dom';

type PanelKind = 'build' | 'inventory' | 'hub' | 'machine' | 'stats' | 'blueprints' | 'map';

const STATUS_DOT: Record<string, string> = {
  working: '#5ad65a', idle: '#9aa0a6', nopower: '#e04848', tripped: '#ff3030', full: '#e8c040', nofuel: '#e07a30', norecipe: '#6a9ae8', noinput: '#e8c040', unpaired: '#e04848',
};

export class Panels {
  private wrap: HTMLElement | null = null;
  kind: PanelKind | null = null;
  machineId: number | null = null;
  private buildTab: BuildingCategory = 'uretim';
  private renderTimer = 0;
  onSelectBuild: (type: string) => void = () => {};
  onBlueprintPlace: (id: number) => void = () => {};
  onBlueprintNew: () => void = () => {};

  constructor(private state: GameState, private parent: HTMLElement, private send: (m: ClientMsg) => void) {
    const rerender = () => this.scheduleRender();
    state.on('inv', rerender);
    state.on('craft', rerender);
    state.on('tech', rerender);
    state.on('power', () => { if (this.kind === 'machine' || this.kind === 'stats') rerender(); });
    state.on('stats', () => { if (this.kind === 'stats') rerender(); });
    state.on('blueprints', () => { if (this.kind === 'blueprints') rerender(); });
    state.on('markers', () => { if (this.kind === 'map') rerender(); });
    state.on('trees', () => { this.mapBase = null; });
    state.on('fog', () => { if (this.kind === 'map') this.drawBigMap(); });
    state.on('buildings', (up: BuildingState[], rem: number[]) => {
      if (this.kind === 'stats') { rerender(); return; }
      if (this.kind !== 'machine' || this.machineId === null) return;
      if (rem.includes(this.machineId)) { this.close(); return; }
      if (up.some((b) => b.id === this.machineId)) rerender();
    });
  }

  /** Metin girişi isteyen küçük pencere açık mı */
  isPrompt() {
    return this.kindOverride && !!this.wrap;
  }

  isOpen() {
    return this.kind !== null || (this.kindOverride && !!this.wrap);
  }

  private scheduleRender() {
    if (!this.kind || this.renderTimer) return;
    this.renderTimer = window.setTimeout(() => { this.renderTimer = 0; this.render(); }, 80);
  }

  open(kind: PanelKind, machineId?: number) {
    this.kind = kind;
    this.machineId = machineId ?? null;
    this.render();
  }

  toggle(kind: PanelKind) {
    if (this.kind === kind) this.close(); else this.open(kind);
  }

  close() {
    if (this.mapTimer) { clearInterval(this.mapTimer); this.mapTimer = 0; }
    this.kindOverride = false;
    this.kind = null;
    this.machineId = null;
    this.wrap?.remove();
    this.wrap = null;
  }

  private shell(title: string, body: HTMLElement, narrow = false, headExtra?: HTMLElement): HTMLElement {
    const close = h('button', { class: 'ghost small close', onclick: () => this.close() }, 'Kapat (Esc)');
    const modal = h('div', { class: 'modal' + (narrow ? ' narrow' : '') }, h('div', { class: 'modal-head' }, h('h2', {}, title), headExtra ?? null, close), h('div', { class: 'modal-body' }, body));
    const wrap = h('div', { class: 'modal-wrap' }, modal);
    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) this.close(); });
    return wrap;
  }

  private render() {
    if (!this.kind) return;
    const prevScroll = this.wrap?.querySelector('.modal-body')?.scrollTop ?? 0;
    let el: HTMLElement | null = null;
    if (this.kind === 'build') el = this.renderBuild();
    else if (this.kind === 'inventory') el = this.renderInventory();
    else if (this.kind === 'hub') el = this.renderHub();
    else if (this.kind === 'machine') el = this.renderMachine();
    else if (this.kind === 'stats') el = this.renderStats();
    else if (this.kind === 'blueprints') el = this.renderBlueprints();
    else if (this.kind === 'map') el = this.renderMap();
    if (!el) { this.close(); return; }
    this.wrap?.remove();
    this.wrap = el;
    this.parent.append(el);
    const body = el.querySelector('.modal-body');
    if (body) body.scrollTop = prevScroll;
  }

  // ------------------------------------------------------------ inşa menüsü

  private renderBuild(): HTMLElement {
    const cats: BuildingCategory[] = ['uretim', 'lojistik', 'enerji', 'ozel'];
    const tabs = h('div', { class: 'tabs' }, ...cats.map((c) => h('button', { class: this.buildTab === c ? 'on' : '', onclick: () => { this.buildTab = c; this.render(); } }, CATEGORY_NAMES[c])));
    const grid = h('div', { class: 'build-grid' });
    for (const def of BUILDING_LIST) {
      if (!def.buildable || def.category !== this.buildTab) continue;
      const unlocked = isUnlocked(def.unlock, this.state.tech.completed);
      const can = hasItems(this.state.inventory, def.cost);
      const meta: string[] = [];
      if (def.power) meta.push(`⚡ ${def.power} MW tüketir`);
      if (def.powerGen) meta.push(`⚡ ${def.powerGen} MW üretir`);
      meta.push(`${def.w}×${def.h}`);
      const card = h('div', { class: 'build-card' + (unlocked ? '' : ' locked') },
        h('div', { class: 'title' }, h('div', { class: 'sw', style: { background: hex(def.color) } }, def.short), def.name),
        h('div', { class: 'desc' }, def.desc),
        h('div', { class: 'meta' }, meta.join(' · ')),
        unlocked ? costChips(def.cost, this.state.inventory) : h('div', { class: 'badge' }, `🔒 Kademe ${def.unlock + 1} ile açılır: ${MILESTONES[def.unlock]?.name ?? ''}`),
        unlocked && !can ? h('div', { class: 'bad', style: { fontSize: '12px' } }, 'Malzeme eksik') : null,
      );
      if (unlocked) card.addEventListener('click', () => { this.close(); this.onSelectBuild(def.id); });
      grid.append(card);
    }
    return this.shell('İnşa Menüsü', h('div', {}, tabs, grid));
  }

  // ------------------------------------------------------------ envanter + elle üretim

  private invGrid(onClick?: (i: number) => void): HTMLElement {
    const grid = h('div', { class: 'inv-grid' });
    this.state.inventory.forEach((s, i) => {
      const slot = h('div', { class: 'inv-slot' + (s ? '' : ' empty'), title: s ? `${itemName(s.item)} ×${s.count}` : '' });
      if (s) {
        slot.append(icon(s.item), h('span', { class: 'cnt' }, String(s.count)));
        if (onClick) slot.addEventListener('click', () => onClick(i));
      }
      grid.append(slot);
    });
    return grid;
  }

  private nearStation(): boolean {
    const me = this.state.me();
    if (!me) return false;
    for (const b of this.state.buildings.values()) {
      if (b.type !== 'hub' && b.type !== 'workbench') continue;
      for (const [x, y] of footprint(b.type, b.x, b.y, b.rot)) {
        if (Math.hypot(me.x - (x + 0.5), me.y - (y + 0.5)) <= 6.5) return true;
      }
    }
    return false;
  }

  private renderInventory(): HTMLElement {
    const body = h('div');
    body.append(h('div', { class: 'section-title' }, 'Envanter'), this.invGrid());
    // Kuyruk
    const q = this.state.craftQueue;
    if (q.length) {
      const queue = h('div', { class: 'queue' });
      q.forEach((job, i) => {
        const r = RECIPES[job.recipe];
        const out = Object.keys(r.outputs)[0];
        queue.append(h('div', { class: 'qitem', title: r.name }, icon(out), h('span', { class: 'cnt' }, `×${job.remaining}`), i === 0 ? h('div', { class: 'prog', style: { width: `${job.progress * 100}%` } }) : null));
      });
      queue.append(h('button', { class: 'ghost small', onclick: () => this.send({ t: 'cancelCraft' }) }, 'Kuyruğu iptal et'));
      body.append(h('div', { class: 'section-title' }, 'Üretim Kuyruğu'), queue);
    }
    const near = this.nearStation();
    body.append(h('div', { class: 'section-title' }, 'Elle Üretim', near ? h('span', { class: 'badge ok' }, 'Tezgah yakında') : h('span', { class: 'badge' }, 'HUB veya Çalışma Tezgahı yanına git')));
    const list = h('div', { class: 'recipe-list' });
    for (const r of RECIPE_LIST) {
      if (!r.hand) continue;
      const unlocked = isUnlocked(r.unlock, this.state.tech.completed);
      if (!unlocked) continue;
      const maxN = Math.min(...Object.entries(r.inputs).map(([k, v]) => Math.floor(countItem(this.state.inventory, k) / v)));
      const btn = (n: number) => h('button', { class: 'small', disabled: !near || maxN < 1 ? 'true' : undefined, onclick: () => this.send({ t: 'craft', recipe: r.id, count: n }) }, n === -1 ? `Hepsi` : `×${n}`);
      const all = h('button', { class: 'small ghost', disabled: !near || maxN < 1 ? 'true' : undefined, onclick: () => this.send({ t: 'craft', recipe: r.id, count: maxN }) }, `Hepsi (${Math.max(0, maxN)})`);
      list.append(
        h('div', { class: 'recipe' },
          h('div', { class: 'rname' }, r.name, h('div', { class: 'muted', style: { fontSize: '11px', fontFamily: 'Inter', fontWeight: '400' } }, `${fmt(handCraftTime(r))} sn`)),
          h('div', { class: 'flow' }, costChips(r.inputs, this.state.inventory), h('span', { class: 'arrow' }, '➜'), flowChips(r.outputs)),
          h('div', { class: 'btns' }, btn(1), btn(5), all),
        ),
      );
    }
    body.append(list);
    return this.shell('Envanter', body);
  }

  // ------------------------------------------------------------ HUB

  private renderHub(): HTMLElement {
    const t = this.state.tech;
    const body = h('div');
    MILESTONES.forEach((m, i) => {
      const done = i < t.completed;
      const cur = i === t.completed;
      const un = milestoneUnlocks(i);
      const el = h('div', { class: 'milestone' + (done ? ' done' : '') + (cur ? ' current' : '') },
        h('h3', {}, `${i + 1}. ${m.name}`, done ? h('span', { class: 'badge ok' }, 'Tamamlandı') : cur ? h('span', { class: 'badge cur' }, 'Aktif') : h('span', { class: 'badge' }, 'Kilitli')),
        h('div', { class: 'muted', style: { fontSize: '13px', marginTop: '2px' } }, m.desc),
      );
      if (cur) {
        for (const [item, need] of Object.entries(m.cost)) {
          const got = t.delivered[item] ?? 0;
          const have = countItem(this.state.inventory, item);
          el.append(
            h('div', { class: 'need-row' },
              icon(item),
              h('div', { class: 'nm' }, itemName(item), h('div', { class: 'muted', style: { fontSize: '11px' } }, `Envanterde: ${have}`)),
              h('div', { class: 'progress' }, h('div', { style: { width: `${Math.min(100, (100 * got) / need)}%` } })),
              h('div', { class: 'num' }, `${got} / ${need}`),
            ),
          );
        }
        el.append(h('div', { style: { marginTop: '12px', display: 'flex', gap: '10px', alignItems: 'center' } },
          h('button', { onclick: () => this.send({ t: 'hubSubmit' }) }, 'Envanterden Teslim Et'),
          h('span', { class: 'muted', style: { fontSize: '12px' } }, 'HUB yakınında olmalısın. Takımın tüm üyeleri katkı sağlayabilir.'),
        ));
      } else if (!done) {
        el.append(h('div', { style: { marginTop: '6px' } }, costChips(m.cost)));
      }
      const unl = [...un.buildings, ...un.recipes];
      if (unl.length) el.append(h('div', { class: 'unlocks' }, 'Açar: ' + unl.join(', ')));
      body.append(el);
    });
    return this.shell('HUB · Kademeler', body);
  }

  // ------------------------------------------------------------ büyük harita

  private mapBase: HTMLCanvasElement | null = null;
  private mapTimer = 0;
  private mapCanvas: HTMLCanvasElement | null = null;

  private renderMap(): HTMLElement {
    if (this.mapTimer) { clearInterval(this.mapTimer); this.mapTimer = 0; }
    const S = this.state.map.size;
    const size = Math.min(620, window.innerHeight - 180, window.innerWidth - 380);
    const canvas = h('canvas', { width: String(S * 2), height: String(S * 2), class: 'bigmap', style: { width: size + 'px', height: size + 'px' } }) as HTMLCanvasElement;
    this.mapCanvas = canvas;
    canvas.addEventListener('click', (e) => {
      const r = canvas.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * S, y = ((e.clientY - r.top) / r.height) * S;
      this.markerPrompt(x, y);
    });
    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      this.send({ t: 'mapPing', x: ((e.clientX - r.left) / r.width) * S, y: ((e.clientY - r.top) / r.height) * S });
    });
    const list = h('div', { class: 'marker-list' }, h('div', { class: 'section-title' }, 'İşaretler'));
    if (!this.state.markers.length) list.append(h('p', { class: 'muted', style: { fontSize: '12px' } }, 'Haritaya tıklayarak işaret koy. Sağ tık: o noktaya ping at.'));
    for (const m of this.state.markers) {
      list.append(h('div', { class: 'marker-row' },
        h('span', { class: 'micon' }, m.icon),
        h('div', {}, h('div', {}, m.label || '(isimsiz)'), h('div', { class: 'muted', style: { fontSize: '11px' } }, `${Math.floor(m.x)}, ${Math.floor(m.y)} · ${m.by}`)),
        h('button', { class: 'ghost small', title: 'Ping at', onclick: () => this.send({ t: 'mapPing', x: m.x, y: m.y }) }, '📡'),
        h('button', { class: 'ghost small', title: 'Sil', onclick: () => this.send({ t: 'markerRemove', id: m.id }) }, '✕'),
      ));
    }
    const body = h('div', { class: 'map-wrap' }, canvas, list);
    this.drawBigMap();
    this.mapTimer = window.setInterval(() => this.drawBigMap(), 400);
    return this.shell('Harita', body);
  }

  private drawBigMap() {
    const c = this.mapCanvas;
    if (!c) return;
    const S = this.state.map.size;
    if (!this.mapBase) {
      this.mapBase = document.createElement('canvas');
      drawMinimapBase(this.mapBase, this.state.map);
    }
    const g = c.getContext('2d')!;
    const k = c.width / S;
    g.imageSmoothingEnabled = false;
    g.drawImage(this.mapBase, 0, 0, c.width, c.height);
    for (const b of this.state.buildings.values()) {
      const def = BUILDINGS[b.type];
      g.fillStyle = hex(def.color);
      const [fw, fh] = def.w === def.h ? [def.w, def.h] : b.rot % 2 ? [def.h, def.w] : [def.w, def.h];
      g.fillRect(b.x * k, b.y * k, fw * k, fh * k);
    }
    const cols = Math.ceil(S / FOG_CELL);
    g.fillStyle = 'rgba(10,12,15,0.93)';
    for (let cy = 0; cy < cols; cy++) for (let cx = 0; cx < cols; cx++) {
      if (!this.state.explored[cy * cols + cx]) g.fillRect(cx * FOG_CELL * k, cy * FOG_CELL * k, FOG_CELL * k + 0.5, FOG_CELL * k + 0.5);
    }
    for (const n of this.state.nests) {
      if (!n.alive || !this.state.isExplored(n.x, n.y)) continue;
      g.fillStyle = '#c040a0';
      g.beginPath(); g.arc((n.x + 0.5) * k, (n.y + 0.5) * k, 5, 0, 7); g.fill();
    }
    for (const l of this.state.map.loot) {
      if (this.state.lootOpened.has(l.id) || !this.state.isExplored(l.x, l.y)) continue;
      g.font = '14px sans-serif';
      g.fillStyle = '#ffc040';
      g.fillText('📦', (l.x + 0.5) * k, (l.y + 0.5) * k + 5);
    }
    g.textAlign = 'center';
    for (const m of this.state.markers) {
      g.font = '16px sans-serif';
      g.fillText(m.icon, m.x * k, m.y * k + 5);
      if (m.label) {
        g.font = '600 11px Inter, sans-serif';
        g.lineWidth = 3; g.strokeStyle = '#000'; g.strokeText(m.label, m.x * k, m.y * k - 10);
        g.fillStyle = '#fff'; g.fillText(m.label, m.x * k, m.y * k - 10);
      }
    }
    const now = performance.now();
    for (const p of this.state.pings) {
      const age = (now - p.t0) / 1000;
      if (age > 8) continue;
      g.strokeStyle = hex(p.color); g.lineWidth = 3;
      g.beginPath(); g.arc(p.x * k, p.y * k, 6 + ((age * 14) % 16), 0, 7); g.stroke();
    }
    for (const p of this.state.players.values()) {
      if (!p.online) continue;
      g.fillStyle = hex(p.color); g.strokeStyle = '#000'; g.lineWidth = 2;
      g.beginPath(); g.arc(p.x * k, p.y * k, 6, 0, 7); g.fill(); g.stroke();
      g.font = '600 11px Inter, sans-serif';
      g.lineWidth = 3; g.strokeText(p.name, p.x * k, p.y * k - 10);
      g.fillStyle = '#fff'; g.fillText(p.name, p.x * k, p.y * k - 10);
    }
  }

  private markerPrompt(x: number, y: number) {
    let icon = MARKER_ICONS[0];
    const input = h('input', { placeholder: 'Örn. Saf demir düğümü', maxlength: '24', style: { width: '100%' } }) as HTMLInputElement;
    const icons = h('div', { class: 'icon-pick' });
    const renderIcons = () => icons.replaceChildren(...MARKER_ICONS.map((ic) => h('button', { class: 'ghost' + (ic === icon ? ' on' : ''), onclick: () => { icon = ic; renderIcons(); input.focus(); } }, ic)));
    renderIcons();
    const ok = () => { this.send({ t: 'markerAdd', x, y, label: input.value.trim(), icon }); this.open('map'); };
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') ok(); if (e.key === 'Escape') this.open('map'); });
    if (this.mapTimer) { clearInterval(this.mapTimer); this.mapTimer = 0; }
    this.wrap?.remove();
    this.kind = null;
    this.wrap = this.shell(`İşaret koy (${Math.floor(x)}, ${Math.floor(y)})`, h('div', {}, icons, input, h('div', { style: { display: 'flex', gap: '8px', marginTop: '12px' } }, h('button', { onclick: ok }, 'Ekle'), h('button', { class: 'ghost', onclick: () => this.open('map') }, 'Vazgeç'))), true);
    this.kindOverride = true;
    this.parent.append(this.wrap);
    input.focus();
  }

  // ------------------------------------------------------------ planlar

  private renderBlueprints(): HTMLElement {
    const body = h('div');
    body.append(h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '12px' } },
      h('button', { onclick: () => { this.close(); this.onBlueprintNew(); } }, '+ Yeni Plan'),
      h('span', { class: 'muted', style: { fontSize: '12px' } }, 'Fareyle bir alan seç; içindeki yapılar tarifleri ve filtreleriyle kaydedilir. Planlar takımın ortak kütüphanesindedir.'),
    ));
    const list = this.state.blueprints;
    if (!list.length) body.append(h('p', { class: 'muted' }, 'Henüz plan yok.'));
    for (const bp of list) {
      const counts: Record<string, number> = {};
      for (const e of bp.entries) counts[e.type] = (counts[e.type] ?? 0) + 1;
      const summary = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${n}× ${BUILDINGS[t].name}`).join(', ');
      const cost = blueprintCost(bp.entries);
      body.append(h('div', { class: 'milestone' },
        h('h3', {}, bp.name, h('span', { class: 'badge' }, `${bp.w}×${bp.h}`), h('span', { class: 'muted', style: { fontSize: '12px', fontFamily: 'Inter', fontWeight: '400' } }, `· ${bp.author}`)),
        h('div', { class: 'muted', style: { fontSize: '12px', margin: '4px 0 8px' } }, summary),
        costChips(cost, this.state.inventory),
        h('div', { style: { display: 'flex', gap: '8px', marginTop: '10px' } },
          h('button', { onclick: () => { this.close(); this.onBlueprintPlace(bp.id); } }, 'Kur'),
          h('button', { class: 'ghost', onclick: () => { if (confirm(`"${bp.name}" planı silinsin mi?`)) this.send({ t: 'bpDelete', id: bp.id }); } }, 'Sil'),
        ),
      ));
    }
    return this.shell('Plan Kütüphanesi', body);
  }

  /** Basit metin giriş penceresi */
  prompt(title: string, placeholder: string, onOk: (value: string) => void) {
    this.close();
    const input = h('input', { placeholder, maxlength: '30', style: { width: '100%' } }) as HTMLInputElement;
    const ok = () => { const v = input.value.trim(); this.close(); if (v) onOk(v); };
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') ok(); if (e.key === 'Escape') this.close(); });
    const body = h('div', {}, input, h('div', { style: { display: 'flex', gap: '8px', marginTop: '12px' } }, h('button', { onclick: ok }, 'Kaydet'), h('button', { class: 'ghost', onclick: () => this.close() }, 'Vazgeç')));
    this.wrap = this.shell(title, body, true);
    this.parent.append(this.wrap);
    this.kindOverride = true;
    input.focus();
  }
  private kindOverride = false;

  // ------------------------------------------------------------ istatistik

  private renderStats(): HTMLElement {
    const { produced, consumed } = this.state.stats;
    const body = h('div');
    const items = [...new Set([...Object.keys(produced), ...Object.keys(consumed)])]
      .filter((k) => (produced[k] ?? 0) > 0 || (consumed[k] ?? 0) > 0)
      .sort((a, b) => (produced[b] ?? 0) + (consumed[b] ?? 0) - (produced[a] ?? 0) - (consumed[a] ?? 0));
    body.append(h('div', { class: 'section-title' }, 'Eşya Akışı', h('span', { class: 'muted', style: { fontFamily: 'Inter', fontWeight: '400', fontSize: '12px' } }, 'son 60 saniye, dakika başına')));
    if (!items.length) {
      body.append(h('p', { class: 'muted' }, 'Henüz üretim yok. Makineler çalışmaya başlayınca burada görünecek.'));
    } else {
      const table = h('table', { class: 'stats-table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Eşya'), h('th', {}, 'Üretim/dk'), h('th', {}, 'Tüketim/dk'), h('th', {}, 'Net'))));
      const tb = h('tbody');
      for (const k of items) {
        const p = produced[k] ?? 0, c = consumed[k] ?? 0, net = Math.round((p - c) * 10) / 10;
        tb.append(h('tr', {},
          h('td', {}, h('span', { class: 'it' }, icon(k), itemName(k))),
          h('td', {}, fmt(p)),
          h('td', {}, fmt(c)),
          h('td', { class: net < 0 ? 'bad' : net > 0 ? 'good' : 'muted' }, (net > 0 ? '+' : '') + fmt(net)),
        ));
      }
      table.append(tb);
      body.append(table);
    }

    // Makine grupları ve darboğazlar
    type Group = { name: string; count: number; eff: number; statuses: Record<string, number>; recipe?: string };
    const groups = new Map<string, Group>();
    for (const b of this.state.buildings.values()) {
      const def = BUILDINGS[b.type];
      if (!def.crafter && !def.mineRate && !def.powerGen) continue;
      const key = `${b.type}:${b.recipe ?? ''}`;
      let g = groups.get(key);
      if (!g) {
        g = { name: def.name + (b.recipe ? ` · ${RECIPES[b.recipe].name}` : ''), count: 0, eff: 0, statuses: {}, recipe: b.recipe };
        groups.set(key, g);
      }
      g.count++;
      g.eff += b.eff ?? 0;
      g.statuses[b.status] = (g.statuses[b.status] ?? 0) + 1;
    }
    body.append(h('div', { class: 'section-title' }, 'Makineler'));
    if (!groups.size) body.append(h('p', { class: 'muted' }, 'Henüz makine yok.'));
    const hint = (st: string, g: Group): string => {
      const r = g.recipe ? RECIPES[g.recipe] : undefined;
      switch (st) {
        case 'noinput': return r ? `Girdi yetersiz: ${Object.keys(r.inputs).map(itemName).join(', ')} üretimini artır veya bant bağlantısını kontrol et` : 'Kaynak düğümü yok';
        case 'full': return 'Çıkış dolu: çıktıyı alan bant/depo yok ya da hat tıkalı';
        case 'nopower': return 'Elektrik yok: bir direğin menziline al veya jeneratör ekle';
        case 'tripped': return 'Sigorta attı: üretimi artır ve bir direkten sıfırla';
        case 'norecipe': return 'Tarif seçilmemiş';
        case 'nofuel': return 'Yakıt yok: jeneratöre yakıt taşı';
        default: return '';
      }
    };
    const list = h('div', { class: 'recipe-list' });
    for (const g of [...groups.values()].sort((a, b) => a.eff / a.count - b.eff / b.count)) {
      const avg = Math.round((100 * g.eff) / g.count);
      const problems = Object.entries(g.statuses).filter(([st]) => st !== 'working' && st !== 'idle' && hint(st, g));
      const row = h('div', { class: 'recipe' + (problems.length ? ' warn' : '') },
        h('div', { class: 'rname' }, `${g.count}× ${g.name}`),
        h('div', { class: 'flow', style: { flexDirection: 'column', alignItems: 'flex-start', gap: '2px' } },
          ...problems.map(([st, n]) => h('div', { class: 'bad', style: { fontSize: '12px' } }, `⚠ ${n} adet: ${hint(st, g)}`)),
          problems.length ? null : h('div', { class: 'muted', style: { fontSize: '12px' } }, 'Sorun yok'),
        ),
        h('div', { class: 'eff' }, h('div', { class: 'progress', style: { width: '90px' } }, h('div', { style: { width: `${avg}%` } })), h('span', {}, `%${avg}`)),
      );
      list.append(row);
    }
    body.append(list);
    return this.shell('Üretim İstatistikleri', body);
  }

  // ------------------------------------------------------------ makine paneli

  private renderMachine(): HTMLElement | null {
    const b = this.machineId !== null ? this.state.buildings.get(this.machineId) : undefined;
    if (!b) return null;
    const def = BUILDINGS[b.type];
    if (b.type === 'hub') return this.renderHub();
    const body = h('div');
    const statusPill = (def.crafter || def.mineRate || def.powerGen || b.type.startsWith('underground'))
      ? h('span', { class: 'status-pill' }, h('span', { class: 'dot', style: { background: STATUS_DOT[b.status] ?? '#999' } }), STATUS_NAMES[b.status])
      : null;
    const dismantle = h('button', { class: 'ghost small', onclick: () => { this.send({ t: 'dismantle', id: b.id }); this.close(); } }, 'Sök');

    const net = this.state.power.find((n) => n.id === b.net);
    const powerLine = def.power || def.powerGen || b.type === 'power_pole'
      ? h('div', { class: 'kv', style: { margin: '10px 0' } },
          h('span', { class: 'k' }, 'Elektrik'),
          h('span', {}, b.net === undefined && b.type !== 'power_pole' ? h('span', { class: 'bad' }, 'Bir elektrik direğinin 5 tile yakınına kur') : net ? `${net.consumption} / ${net.capacity} MW ${net.tripped ? '· SİGORTA ATTI' : ''}` : 'Ağ bilgisi bekleniyor'),
          def.power ? h('span', { class: 'k' }, 'Tüketim') : null,
          def.power ? h('span', {}, `${def.power} MW`) : null,
          def.powerGen ? h('span', { class: 'k' }, 'Üretim kapasitesi') : null,
          def.powerGen ? h('span', {}, `${def.powerGen} MW (yük %${Math.round((b.status === 'working' ? b.progress : 0) * 100)})`) : null,
        )
      : null;
    const fuseBtn = net?.tripped || b.tripped ? h('button', { onclick: () => this.send({ t: 'resetFuse', id: b.id }) }, 'Sigortayı Sıfırla') : null;
    const effLine = def.crafter || def.mineRate || def.powerGen
      ? h('span', { class: 'status-pill', title: 'Son ~15 saniyede çalıştığı zaman oranı' }, `Verim %${Math.round((b.eff ?? 0) * 100)}`)
      : null;
    body.append(h('div', { class: 'machine-head' }, statusPill, effLine, fuseBtn), powerLine ?? h('div'));

    if (def.crafter) body.append(this.crafterSection(b));
    else if (def.mineRate) body.append(this.minerSection(b, def.mineRate));
    else if (def.powerGen) body.append(this.generatorSection(b));
    else if (b.type === 'storage' || b.type === 'crate') body.append(this.storageSection(b));
    else if (b.type === 'smart_splitter') body.append(this.filterSection(b));
    else if (b.type.startsWith('underground')) body.append(h('p', { class: 'muted' }, def.desc + ' Giriş ile çıkış arasında en fazla 5 tile olabilir; aradaki binalar ve bantlar engel olmaz.'));
    else if (b.type === 'power_pole') body.append(h('p', { class: 'muted' }, 'Direkler 5 tile yarıçapındaki binalara güç verir ve 12 tile içindeki diğer direklere otomatik bağlanır.'));
    else if (b.type === 'workbench') body.append(h('p', { class: 'muted' }, 'Yakınındayken envanterinden (Tab) elle üretim yapabilirsin.'), h('button', { onclick: () => this.open('inventory') }, 'Envanteri Aç'));
    else body.append(h('p', { class: 'muted' }, def.desc));

    return this.shell(def.name, body, false, b.type !== 'crate' ? dismantle : undefined);
  }

  private bufBox(title: string, buf: Record<string, number>, from: 'in' | 'out', id: number, extra?: HTMLElement): HTMLElement {
    const items = h('div', { class: 'items' });
    const entries = Object.entries(buf).filter(([, n]) => n > 0);
    if (!entries.length) items.append(h('span', { class: 'muted' }, 'Boş'));
    for (const [item, n] of entries) items.append(h('div', { class: 'it' }, icon(item), itemName(item), h('span', { class: 'n' }, String(n))));
    return h('div', { class: 'buf' },
      h('h3', {}, title),
      items,
      entries.length ? h('button', { class: 'small', style: { marginTop: '8px' }, onclick: () => this.send({ t: 'take', id, from }) }, 'Hepsini Al') : null,
      extra ?? null,
    );
  }

  private putList(id: number, accept: (item: string) => boolean): HTMLElement | undefined {
    const list = h('div', { class: 'put-list' });
    this.state.inventory.forEach((s, i) => {
      if (!s || !accept(s.item)) return;
      const c = chip(s.item, s.count);
      c.title = 'Makineye koy';
      c.addEventListener('click', () => this.send({ t: 'put', id, slot: i }));
      list.append(c);
    });
    if (!list.children.length) return undefined;
    return h('div', {}, h('div', { class: 'muted', style: { fontSize: '12px', marginTop: '10px' } }, 'Envanterinden koy:'), list);
  }

  private crafterSection(b: BuildingState): HTMLElement {
    const wrap = h('div');
    const recipe = b.recipe ? RECIPES[b.recipe] : undefined;
    const perMin = recipe ? 60 / recipe.time : 0;
    if (recipe) {
      wrap.append(
        h('div', { class: 'section-title' }, 'Üretim', h('span', { class: 'muted', style: { fontFamily: 'Inter', fontWeight: '400', fontSize: '12px' } }, `${recipe.time} sn / döngü`)),
        h('div', { class: 'progress', style: { marginBottom: '12px' } }, h('div', { style: { width: `${b.progress * 100}%` } })),
        h('div', { class: 'bufs' },
          this.bufBox('Girdi', b.inBuf, 'in', b.id, this.putList(b.id, (it) => !!recipe.inputs[it])),
          this.bufBox('Çıktı', b.outBuf, 'out', b.id),
        ),
      );
    }
    wrap.append(h('div', { class: 'section-title' }, 'Tarif Seç'));
    const list = h('div', { class: 'recipe-list' });
    for (const r of recipesFor(b.type)) {
      const unlocked = isUnlocked(r.unlock, this.state.tech.completed);
      const pm = 60 / r.time;
      const row = h('div', { class: 'recipe' + (b.recipe === r.id ? ' sel' : '') + (unlocked ? '' : ' locked') },
        h('div', { class: 'rname' }, r.name),
        h('div', { class: 'flow' }, flowChips(r.inputs, pm), h('span', { class: 'arrow' }, '➜'), flowChips(r.outputs, pm)),
        unlocked
          ? b.recipe === r.id ? h('span', { class: 'badge ok' }, 'Seçili') : h('button', { class: 'small', onclick: () => this.send({ t: 'setRecipe', id: b.id, recipe: r.id }) }, 'Seç')
          : h('span', { class: 'badge' }, `🔒 Kademe ${r.unlock + 1}`),
      );
      list.append(row);
    }
    wrap.append(list);
    void perMin;
    return wrap;
  }

  private filterSection(b: BuildingState): HTMLElement {
    const names = ['Ön çıkış', 'Sol çıkış', 'Sağ çıkış'];
    const wrap = h('div', {}, h('div', { class: 'section-title' }, 'Çıkış Filtreleri'));
    const items = Object.values(ITEMS);
    (b.filters ?? []).forEach((f, i) => {
      const sel = h('select', { class: 'filter-select' }) as HTMLSelectElement;
      for (const [k, v] of Object.entries(SPLITTER_FILTERS)) sel.append(h('option', { value: k }, v));
      const grp = h('optgroup', { label: 'Eşya' });
      for (const it of items) grp.append(h('option', { value: it.id }, it.name));
      sel.append(grp);
      sel.value = f;
      sel.addEventListener('change', () => this.send({ t: 'setFilter', id: b.id, index: i, filter: sel.value }));
      wrap.append(h('div', { class: 'filter-row' }, h('span', { class: 'fname' }, names[i]), ITEMS[f] ? icon(f) : h('span', { class: 'ficon' }), sel));
    });
    wrap.append(h('p', { class: 'muted', style: { fontSize: '12px', marginTop: '10px' } },
      'Belirli eşya: sadece o eşya. Herhangi: her şey. Tanımsız diğerleri: hiçbir çıkışta filtrelenmemiş eşyalar. Taşma: diğer çıkışlar doluyken kullanılır. Kapalı: hiçbir şey çıkmaz.'));
    return wrap;
  }

  private minerSection(b: BuildingState, rate: number): HTMLElement {
    let node;
    for (const [x, y] of footprint(b.type, b.x, b.y, b.rot)) {
      node = this.state.map.nodeAt.get(tileKey(x, y));
      if (node) break;
    }
    const wrap = h('div');
    if (node) {
      wrap.append(h('div', { class: 'kv', style: { marginBottom: '10px' } },
        h('span', { class: 'k' }, 'Kaynak'), h('span', {}, `${itemName(node.item)} (${PURITY_NAMES[node.purity]})`),
        h('span', { class: 'k' }, 'Hız'), h('span', {}, `${fmt(rate * PURITY_MULT[node.purity])} / dk`),
      ));
    }
    wrap.append(h('div', { class: 'progress', style: { marginBottom: '12px' } }, h('div', { style: { width: `${(b.progress % 1) * 100}%` } })));
    wrap.append(h('div', { class: 'bufs' }, this.bufBox('Çıktı', b.outBuf, 'out', b.id)));
    return wrap;
  }

  private generatorSection(b: BuildingState): HTMLElement {
    const def = BUILDINGS[b.type];
    const fuels = def.fuels ?? [];
    const wrap = h('div');
    wrap.append(h('div', { class: 'kv', style: { marginBottom: '10px' } },
      h('span', { class: 'k' }, 'Yakıtlar'), h('span', {}, fuels.map((f) => `${itemName(f)} (${ITEMS[f].energy} MJ)`).join(', ')),
      h('span', { class: 'k' }, 'Kalan enerji'), h('span', {}, `${Math.round(b.fuel ?? 0)} MJ`),
    ));
    wrap.append(h('div', { class: 'bufs' }, this.bufBox('Yakıt', b.inBuf, 'in', b.id, this.putList(b.id, (it) => fuels.includes(it)))));
    return wrap;
  }

  private storageSection(b: BuildingState): HTMLElement {
    const wrap = h('div');
    const grid = h('div', { class: 'inv-grid' });
    (b.storage ?? []).forEach((s, i) => {
      const slot = h('div', { class: 'inv-slot' + (s ? '' : ' empty'), title: s ? `${itemName(s.item)} ×${s.count} · tıkla: al` : '' });
      if (s) {
        slot.append(icon(s.item), h('span', { class: 'cnt' }, String(s.count)));
        slot.addEventListener('click', () => this.send({ t: 'take', id: b.id, from: 'storage', slot: i }));
      }
      grid.append(slot);
    });
    wrap.append(h('div', { class: 'section-title' }, b.type === 'crate' ? 'Sandık' : 'Depo', h('button', { class: 'small', onclick: () => this.send({ t: 'take', id: b.id, from: 'storage' }) }, 'Hepsini Al')), grid);
    if (b.type === 'storage') {
      wrap.append(h('div', { class: 'section-title' }, 'Envanterin', h('span', { class: 'muted', style: { fontFamily: 'Inter', fontWeight: '400', fontSize: '12px' } }, 'tıkla: depoya koy')));
      wrap.append(this.invGrid((i) => this.send({ t: 'put', id: b.id, slot: i })));
    }
    return wrap;
  }
}
