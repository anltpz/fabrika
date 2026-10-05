import {
  BUILDINGS,
  BUILDING_LIST,
  CATEGORY_NAMES,
  ITEMS,
  MILESTONES,
  PURITY_MULT,
  PURITY_NAMES,
  RECIPES,
  RECIPE_LIST,
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
import { chip, costChips, flowChips, fmt, h, hex, icon } from './dom';

type PanelKind = 'build' | 'inventory' | 'hub' | 'machine';

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

  constructor(private state: GameState, private parent: HTMLElement, private send: (m: ClientMsg) => void) {
    const rerender = () => this.scheduleRender();
    state.on('inv', rerender);
    state.on('craft', rerender);
    state.on('tech', rerender);
    state.on('power', () => { if (this.kind === 'machine') rerender(); });
    state.on('buildings', (up: BuildingState[], rem: number[]) => {
      if (this.kind !== 'machine' || this.machineId === null) return;
      if (rem.includes(this.machineId)) { this.close(); return; }
      if (up.some((b) => b.id === this.machineId)) rerender();
    });
  }

  isOpen() {
    return this.kind !== null;
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
    body.append(h('div', { class: 'machine-head' }, statusPill, fuseBtn), powerLine ?? h('div'));

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
