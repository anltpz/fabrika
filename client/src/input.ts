import {
  BUILDINGS,
  INTERACT_RANGE,
  NEST_HP,
  PLAYER_SPEED,
  PURITY_NAMES,
  RECIPES,
  STATUS_NAMES,
  footprintSize,
  hasTree,
  inputVelocity,
  isBelt,
  isUnlocked,
  itemName,
  moveCircle,
  tileKey,
} from '@fabrika/shared';
import type { BuildingState, ClientMsg, InputState } from '@fabrika/shared';
import type { GhostSpec, Renderer } from './render/renderer';
import type { GameState } from './state';
import { costChips } from './ui/dom';
import type { Hud } from './ui/hud';
import type { Panels } from './ui/panels';

type Mode = 'none' | 'build' | 'dismantle';

const DEFAULT_HOTBAR = ['belt_mk1', 'miner_mk1', 'smelter', 'constructor', 'assembler', 'splitter', 'power_pole', 'biomass_burner', 'storage'];

export class Controller {
  mode: Mode = 'none';
  buildType = '';
  rot = 0;
  private keys = new Set<string>();
  private input: InputState = { up: false, down: false, left: false, right: false };
  private seq = 0;
  private mouseX = 0;
  private mouseY = 0;
  private lastAngleSent = 0;
  private lastAngle = 0;
  private sentAngle = 0;
  private dragStart: { x: number; y: number } | null = null;
  private lastHarvest = 0;
  private tooltipKey = '';
  hotbar: string[];

  constructor(
    private state: GameState,
    private renderer: Renderer,
    private hud: Hud,
    private panels: Panels,
    private send: (m: ClientMsg) => void,
  ) {
    let saved: string[] | null = null;
    try { saved = JSON.parse(localStorage.getItem('fabrika:hotbar') ?? 'null'); } catch { /* yok */ }
    this.hotbar = Array.isArray(saved) && saved.length === 9 && saved.every((s) => BUILDINGS[s]) ? saved : [...DEFAULT_HOTBAR];
    const canvas = renderer.app.canvas;
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => { this.keys.clear(); this.updateMoveInput(); });
    canvas.addEventListener('mousemove', (e) => { this.mouseX = e.clientX; this.mouseY = e.clientY; });
    canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
    window.addEventListener('mouseup', (e) => this.onMouseUp(e));
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); renderer.setZoom(renderer.zoom * (e.deltaY > 0 ? 0.9 : 1.1)); }, { passive: false });
    hud.onHotbar = (i) => this.selectHotbar(i);
    panels.onSelectBuild = (type) => this.startBuild(type);
    this.refreshHotbar();
  }

  private refreshHotbar() {
    this.hud.renderHotbar(this.hotbar, this.mode === 'build' ? this.buildType : null);
  }

  private typingInField(e: KeyboardEvent): boolean {
    const t = e.target as HTMLElement;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
  }

  private onKey(e: KeyboardEvent, down: boolean) {
    if (this.typingInField(e)) return;
    const k = e.key.toLowerCase();
    const code = e.code;
    if (down) this.keys.add(code); else this.keys.delete(code);
    this.updateMoveInput();
    if (!down) return;
    if (e.repeat && k !== 'e') return;
    if (code === 'Tab') { e.preventDefault(); this.panels.toggle('inventory'); return; }
    if (k === 'enter') { e.preventDefault(); this.hud.openChat(); return; }
    if (k === 'escape') {
      if (this.panels.isOpen()) this.panels.close();
      else this.cancelMode();
      return;
    }
    if (k === 'q') { this.panels.toggle('build'); return; }
    if (k === 'i') { this.panels.toggle('inventory'); return; }
    if (k === 'h') { this.panels.toggle('hub'); return; }
    if (k === 'f') {
      if (this.mode === 'dismantle') this.cancelMode(); else { this.mode = 'dismantle'; this.panels.close(); this.updateBanner(); this.refreshHotbar(); }
      return;
    }
    if (k === 'r') { this.rot = (this.rot + (e.shiftKey ? 3 : 1)) % 4; this.updateBanner(); return; }
    if (k === 'e') { this.interact(); return; }
    if (code === 'Space') { e.preventDefault(); this.attack(); return; }
    if (/^digit[1-9]$/.test(code.toLowerCase())) { this.selectHotbar(Number(code.slice(5)) - 1); return; }
  }

  private updateMoveInput() {
    const k = this.keys;
    const next: InputState = {
      up: k.has('KeyW') || k.has('ArrowUp'),
      down: k.has('KeyS') || k.has('ArrowDown'),
      left: k.has('KeyA') || k.has('ArrowLeft'),
      right: k.has('KeyD') || k.has('ArrowRight'),
    };
    if (next.up !== this.input.up || next.down !== this.input.down || next.left !== this.input.left || next.right !== this.input.right) {
      this.input = next;
      this.send({ t: 'input', input: next, angle: this.lastAngle, seq: ++this.seq });
    }
  }

  private selectHotbar(i: number) {
    const type = this.hotbar[i];
    if (!type) return;
    if (this.mode === 'build' && this.buildType === type) { this.cancelMode(); return; }
    this.startBuild(type);
  }

  startBuild(type: string) {
    const def = BUILDINGS[type];
    if (!isUnlocked(def.unlock, this.state.tech.completed)) { this.hud.toast(`${def.name} henüz açılmadı (Kademe ${def.unlock + 1})`, 'warn'); return; }
    this.mode = 'build';
    this.buildType = type;
    if (!this.hotbar.includes(type)) {
      this.hotbar = [type, ...this.hotbar.slice(0, 8)];
      try { localStorage.setItem('fabrika:hotbar', JSON.stringify(this.hotbar)); } catch { /* yok */ }
    }
    this.updateBanner();
    this.refreshHotbar();
  }

  cancelMode() {
    this.mode = 'none';
    this.dragStart = null;
    this.updateBanner();
    this.refreshHotbar();
  }

  private updateBanner() {
    if (this.mode === 'build') {
      const def = BUILDINGS[this.buildType];
      const dirs = ['→', '↓', '←', '↑'];
      this.hud.setBanner(`İnşa: ${def.name} ${dirs[this.rot]}  ·  R döndür · Sağ tık iptal${isBelt(this.buildType) ? ' · Sürükleyerek çiz' : ''}`, '', costChips(def.cost, this.state.inventory));
    } else if (this.mode === 'dismantle') {
      this.hud.setBanner('Söküm modu · tıklanan yapı sökülür (malzeme iade) · F/Sağ tık çık', 'dismantle');
    } else {
      this.hud.setBanner(null);
    }
  }

  private mouseWorld(): [number, number] {
    return this.renderer.screenToWorld(this.mouseX, this.mouseY);
  }

  private mouseTile(): [number, number] {
    const [x, y] = this.mouseWorld();
    return [Math.floor(x), Math.floor(y)];
  }

  private placementOrigin(): [number, number] {
    const def = BUILDINGS[this.buildType];
    const [W, H] = footprintSize(def.w, def.h, this.rot);
    const [mx, my] = this.mouseWorld();
    return [Math.floor(mx - W / 2 + 0.5), Math.floor(my - H / 2 + 0.5)];
  }

  private beltPath(sx: number, sy: number, ex: number, ey: number): Array<{ x: number; y: number; dir: number }> {
    if (sx === ex && sy === ey) return [{ x: sx, y: sy, dir: this.rot }];
    const pts: Array<[number, number]> = [];
    const horizFirst = Math.abs(ex - sx) >= Math.abs(ey - sy);
    let x = sx, y = sy;
    pts.push([x, y]);
    const stepX = () => { while (x !== ex) { x += Math.sign(ex - x); pts.push([x, y]); } };
    const stepY = () => { while (y !== ey) { y += Math.sign(ey - y); pts.push([x, y]); } };
    if (horizFirst) { stepX(); stepY(); } else { stepY(); stepX(); }
    const toDir = (dx: number, dy: number) => (dx > 0 ? 0 : dx < 0 ? 2 : dy > 0 ? 1 : 3);
    return pts.slice(0, 200).map(([px, py], i, arr) => {
      const n = arr[i + 1], p = arr[i - 1];
      const dir = n ? toDir(n[0] - px, n[1] - py) : toDir(px - p[0], py - p[1]);
      return { x: px, y: py, dir };
    });
  }

  private hoveredBuilding(): BuildingState | undefined {
    const [tx, ty] = this.mouseTile();
    return this.state.buildingAt(tx, ty);
  }

  private distToBuilding(b: BuildingState): number {
    const me = this.state.me();
    if (!me) return Infinity;
    const def = BUILDINGS[b.type];
    const [W, H] = footprintSize(def.w, def.h, b.rot);
    const cx = Math.max(b.x, Math.min(me.x, b.x + W));
    const cy = Math.max(b.y, Math.min(me.y, b.y + H));
    return Math.hypot(me.x - cx, me.y - cy);
  }

  private onMouseDown(e: MouseEvent) {
    if (this.hud.isChatOpen()) this.hud.closeChat();
    if (e.button === 2) {
      if (this.mode !== 'none') this.cancelMode();
      return;
    }
    if (e.button !== 0) return;
    if (this.mode === 'build') {
      if (isBelt(this.buildType)) {
        const [tx, ty] = this.mouseTile();
        this.dragStart = { x: tx, y: ty };
      } else {
        const [x, y] = this.placementOrigin();
        this.send({ t: 'build', type: this.buildType, x, y, rot: this.rot });
      }
      return;
    }
    const b = this.hoveredBuilding();
    if (this.mode === 'dismantle') {
      if (b && b.type !== 'hub') this.send({ t: 'dismantle', id: b.id });
      return;
    }
    if (b && !isBelt(b.type)) {
      if (this.distToBuilding(b) > INTERACT_RANGE) { this.hud.toast('Çok uzak — yaklaş', 'warn'); return; }
      this.openBuilding(b);
      return;
    }
    const [tx, ty] = this.mouseTile();
    const me = this.state.me();
    if (me && (this.state.map.nodeAt.has(tileKey(tx, ty)) || hasTree(this.state.map, tx, ty)) && Math.hypot(me.x - tx - 0.5, me.y - ty - 0.5) <= INTERACT_RANGE) {
      this.send({ t: 'harvest', x: tx, y: ty });
      this.lastHarvest = performance.now();
      return;
    }
    this.attack();
  }

  private onMouseUp(e: MouseEvent) {
    if (e.button !== 0 || !this.dragStart) return;
    const [ex, ey] = this.mouseTile();
    const path = this.beltPath(this.dragStart.x, this.dragStart.y, ex, ey);
    this.dragStart = null;
    if (path.length) {
      this.rot = path[path.length - 1].dir;
      this.send({ t: 'buildBelts', type: this.buildType, path });
      this.updateBanner();
    }
  }

  private openBuilding(b: BuildingState) {
    if (b.type === 'hub') this.panels.open('hub');
    else this.panels.open('machine', b.id);
  }

  private attack() {
    const me = this.state.me();
    if (!me) return;
    const [mx, my] = this.mouseWorld();
    const angle = Math.atan2(my - me.y, mx - me.x);
    this.send({ t: 'attack', angle });
  }

  /** E: gösterilen hedefle etkileşim veya en yakın kaynağı topla */
  private interact() {
    const me = this.state.me();
    if (!me) return;
    const b = this.hoveredBuilding();
    if (b && !isBelt(b.type) && this.distToBuilding(b) <= INTERACT_RANGE) { this.openBuilding(b); return; }
    const target = this.harvestTarget();
    if (target) {
      this.send({ t: 'harvest', x: target[0], y: target[1] });
      this.lastHarvest = performance.now();
    }
  }

  private harvestTarget(): [number, number] | null {
    const me = this.state.me();
    if (!me) return null;
    const [tx, ty] = this.mouseTile();
    const isTarget = (x: number, y: number) => (this.state.map.nodeAt.has(tileKey(x, y)) && !this.state.buildingAt(x, y)) || hasTree(this.state.map, x, y);
    if (isTarget(tx, ty) && Math.hypot(me.x - tx - 0.5, me.y - ty - 0.5) <= INTERACT_RANGE) return [tx, ty];
    let best: [number, number] | null = null;
    let bd = INTERACT_RANGE;
    const px = Math.floor(me.x), py = Math.floor(me.y);
    for (let j = -4; j <= 4; j++) for (let i = -4; i <= 4; i++) {
      const x = px + i, y = py + j;
      if (!isTarget(x, y)) continue;
      const d = Math.hypot(me.x - x - 0.5, me.y - y - 0.5);
      if (d < bd) { bd = d; best = [x, y]; }
    }
    return best;
  }

  // ------------------------------------------------------------ kare

  update(dt: number): { ghost: GhostSpec | null; hover: { x: number; y: number; building?: BuildingState; dismantle: boolean } | null } {
    const me = this.state.me();
    if (me) {
      // İstemci tarafı tahmin
      const [vx, vy] = inputVelocity(this.input, PLAYER_SPEED);
      const moving = vx !== 0 || vy !== 0;
      if (moving) moveCircle(me, vx, vy, dt, this.state.isBlockedForWalk);
      const err = Math.hypot(me.tx - me.x, me.ty - me.y);
      if (err > 2.5) { me.x = me.tx; me.y = me.ty; }
      else if (!moving || err > 1.2) {
        const k = Math.min(1, dt * (moving ? 3 : 10));
        me.x += (me.tx - me.x) * k;
        me.y += (me.ty - me.y) * k;
      }
      // Bakış açısı
      const [mx, my] = this.mouseWorld();
      const angle = Math.atan2(my - me.y, mx - me.x);
      me.angle = angle;
      this.lastAngle = angle;
      const now = performance.now();
      if (now - this.lastAngleSent > 100 && Math.abs(angle - this.sentAngle) > 0.05) {
        this.lastAngleSent = now;
        this.sentAngle = angle;
        this.send({ t: 'input', input: this.input, angle, seq: ++this.seq });
      }
      // E basılı tutulursa toplamaya devam
      if (this.keys.has('KeyE') && now - this.lastHarvest > 650 && !this.panels.isOpen()) {
        const target = this.harvestTarget();
        if (target) { this.send({ t: 'harvest', x: target[0], y: target[1] }); this.lastHarvest = now; }
      }
    }
    for (const p of this.state.players.values()) {
      if (p.id === this.state.you) continue;
      const k = Math.min(1, dt * 12);
      p.x += (p.tx - p.x) * k;
      p.y += (p.ty - p.y) * k;
    }
    for (const e of this.state.enemies.values()) {
      const k = Math.min(1, dt * 12);
      e.x += (e.tx - e.x) * k;
      e.y += (e.ty - e.y) * k;
    }

    // Önizleme
    let ghost: GhostSpec | null = null;
    const [tx, ty] = this.mouseTile();
    if (this.mode === 'build') {
      const def = BUILDINGS[this.buildType];
      const showPower = !!(def.power || def.powerGen || this.buildType === 'power_pole');
      if (isBelt(this.buildType)) {
        const path = this.dragStart ? this.beltPath(this.dragStart.x, this.dragStart.y, tx, ty) : [{ x: tx, y: ty, dir: this.rot }];
        ghost = {
          type: this.buildType,
          showPower,
          tiles: path.map((p) => {
            const ex = this.state.buildingAt(p.x, p.y);
            const ok = ex && isBelt(ex.type) ? true : this.state.canPlace(this.buildType, p.x, p.y, p.dir, true) === null;
            return { x: p.x, y: p.y, rot: p.dir, ok };
          }),
        };
      } else {
        const [x, y] = this.placementOrigin();
        ghost = { type: this.buildType, showPower, tiles: [{ x, y, rot: this.rot, ok: this.state.canPlace(this.buildType, x, y, this.rot) === null }] };
      }
    }
    const hb = this.hoveredBuilding();
    const hover = { x: tx, y: ty, building: this.mode === 'build' ? undefined : hb, dismantle: this.mode === 'dismantle' };
    this.updateTooltip(tx, ty, hb);
    return { ghost, hover: this.mode === 'build' ? null : hover };
  }

  private updateTooltip(tx: number, ty: number, b: BuildingState | undefined) {
    if (this.panels.isOpen() || this.mode === 'build') { this.hud.showTooltip(0, 0, null); this.tooltipKey = ''; return; }
    let key = '';
    let html: string | null = null;
    if (b) {
      const def = BUILDINGS[b.type];
      key = `b${b.id}:${b.status}:${b.recipe}`;
      const lines = [`<b>${def.name}</b>`];
      if (def.crafter || def.mineRate || def.powerGen || b.type.startsWith('underground')) lines.push(STATUS_NAMES[b.status]);
      if (b.recipe) lines.push(`Tarif: ${RECIPES[b.recipe].name}`);
      if (isBelt(b.type)) lines.push(`${(def.beltSpeed ?? 1) * 120} adet/dk`);
      if (b.type === 'hub') lines.push('Tıkla: kademeler · Yakınında elle üretim yapılabilir');
      else if (!isBelt(b.type)) lines.push('<span class="muted">Tıkla/E: aç</span>');
      html = lines.join('\n');
    } else {
      const node = this.state.map.nodeAt.get(tileKey(tx, ty));
      const nest = this.state.nests.find((n) => n.alive && Math.abs(n.x - tx) <= 1 && Math.abs(n.y - ty) <= 1);
      if (node) {
        key = `n${tx},${ty}`;
        html = `<b>${itemName(node.item)}</b>\nKaynak düğümü · ${PURITY_NAMES[node.purity]}\nE/tıkla: elle topla · üzerine Maden Çıkarıcı kur`;
      } else if (hasTree(this.state.map, tx, ty)) {
        key = `t${tx},${ty}`;
        html = '<b>Ağaç</b>\nE/tıkla: kes (yaprak + odun)';
      } else if (nest) {
        key = `nest${nest.id}:${nest.hp}`;
        html = `<b>Böcek Yuvası</b>\nCan: ${Math.max(0, Math.round(nest.hp))}/${NEST_HP}\nYok etmek için saldır (sol tık / boşluk)`;
      }
    }
    if (key !== this.tooltipKey) {
      this.tooltipKey = key;
      this.hud.showTooltip(this.mouseX, this.mouseY, html);
    } else if (html) {
      this.hud.showTooltip(this.mouseX, this.mouseY, html);
    }
  }
}
