import { Application, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import {
  BUILDINGS,
  CHUNK_SIZE,
  DX,
  DY,
  ITEMS,
  PLAYER_MAX_HP,
  POLE_SUPPLY_RADIUS,
  POLE_WIRE_RANGE,
  footprintSize,
  isBelt,
  opposite,
} from '@fabrika/shared';
import type { BuildingDef, BuildingState, PortDef, ServerMsg } from '@fabrika/shared';
import type { GameState } from '../state';
import { TEX_PX, drawChunk } from './terrain';

export const TILE = 32;

interface BuildingView {
  root: Container;
  body: Container;
  spinner?: Graphics;
  glow?: Graphics;
  status: Graphics;
  label?: Text;
  key: string;
  lastStatus?: string;
  w: number;
  h: number;
}

interface Fx {
  kind: string;
  x: number;
  y: number;
  angle?: number;
  t: number;
  life: number;
  color?: number;
}

const STATUS_COLORS: Record<string, number> = {
  working: 0x5ad65a,
  idle: 0x9aa0a6,
  nopower: 0xe04848,
  tripped: 0xff3030,
  full: 0xe8c040,
  nofuel: 0xe07a30,
  norecipe: 0x6a9ae8,
  noinput: 0xe8c040,
};

function darken(c: number, f: number): number {
  const r = Math.min(255, ((c >> 16) & 255) * f) | 0;
  const g = Math.min(255, ((c >> 8) & 255) * f) | 0;
  const b = Math.min(255, (c & 255) * f) | 0;
  return (r << 16) | (g << 8) | b;
}

export interface GhostSpec {
  type: string;
  tiles: Array<{ x: number; y: number; rot: number; ok: boolean }>;
  showPower: boolean;
}

export class Renderer {
  app = new Application();
  world = new Container();
  private ground = new Container();
  private beltLayer = new Container();
  private beltItems = new Graphics();
  private buildingLayer = new Container();
  private powerLines = new Graphics();
  private overlay = new Graphics();
  private entityLayer = new Container();
  private labelLayer = new Container();
  private fxG = new Graphics();
  private chunks = new Map<string, { sprite: Sprite; canvas: HTMLCanvasElement; tex: Texture }>();
  private views = new Map<number, BuildingView>();
  private playerViews = new Map<number, { root: Container; body: Graphics; name: Text; hp: Graphics; color: number }>();
  private enemyViews = new Map<number, { root: Container; body: Graphics; hp: Graphics; lx: number; ly: number }>();
  private nestViews = new Map<number, { root: Container; body: Graphics; hp: Graphics; alive: boolean }>();
  private fx: Fx[] = [];
  zoom = 1;
  camX = 0;
  camY = 0;
  time = 0;

  constructor(private state: GameState) {}

  async init(el: HTMLElement) {
    await this.app.init({ resizeTo: window, background: 0x15181c, antialias: true, autoDensity: true, resolution: Math.min(2, window.devicePixelRatio || 1) });
    el.appendChild(this.app.canvas);
    this.world.addChild(this.ground, this.beltLayer, this.beltItems, this.buildingLayer, this.powerLines, this.entityLayer, this.overlay, this.fxG, this.labelLayer);
    this.app.stage.addChild(this.world);
    this.app.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // ------------------------------------------------------------ arazi

  buildTerrain() {
    for (const c of this.chunks.values()) { c.sprite.destroy(); c.tex.destroy(true); }
    this.chunks.clear();
    const n = Math.ceil(this.state.map.size / CHUNK_SIZE);
    for (let cy = 0; cy < n; cy++) {
      for (let cx = 0; cx < n; cx++) {
        const canvas = document.createElement('canvas');
        drawChunk(canvas, this.state.map, cx, cy);
        const tex = Texture.from(canvas);
        const sprite = new Sprite(tex);
        sprite.position.set(cx * CHUNK_SIZE, cy * CHUNK_SIZE);
        sprite.scale.set(1 / TEX_PX);
        this.ground.addChild(sprite);
        this.chunks.set(`${cx},${cy}`, { sprite, canvas, tex });
      }
    }
  }

  redrawTreeChunks(keys: number[]) {
    const dirty = new Set<string>();
    for (const k of keys) {
      const x = k % 4096, y = Math.floor(k / 4096);
      for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
        dirty.add(`${Math.floor((x + dx) / CHUNK_SIZE)},${Math.floor((y + dy) / CHUNK_SIZE)}`);
      }
    }
    for (const key of dirty) {
      const c = this.chunks.get(key);
      if (!c) continue;
      const [cx, cy] = key.split(',').map(Number);
      drawChunk(c.canvas, this.state.map, cx, cy);
      c.tex.source.update();
    }
  }

  // ------------------------------------------------------------ binalar

  syncAll() {
    for (const v of this.views.values()) v.root.destroy({ children: true });
    this.views.clear();
    for (const b of this.state.buildings.values()) this.updateBuilding(b);
    this.drawPowerLines();
  }

  syncBuildings(upsert: BuildingState[], remove: number[]) {
    for (const id of remove) {
      const v = this.views.get(id);
      if (v) { v.root.destroy({ children: true }); this.views.delete(id); }
    }
    for (const b of upsert) {
      const cur = this.state.buildings.get(b.id);
      if (cur) this.updateBuilding(cur);
    }
    if (upsert.some((b) => b.type === 'power_pole' || BUILDINGS[b.type].power || BUILDINGS[b.type].powerGen) || remove.length) this.drawPowerLines();
  }

  private updateBuilding(b: BuildingState) {
    const key = `${b.type}:${b.x}:${b.y}:${b.rot}`;
    let v = this.views.get(b.id);
    if (v && v.key !== key) { v.root.destroy({ children: true }); this.views.delete(b.id); v = undefined; }
    if (!v) {
      v = this.createView(b);
      this.views.set(b.id, v);
    }
    if (v.lastStatus !== b.status + (b.tripped ? 'T' : '')) {
      v.lastStatus = b.status + (b.tripped ? 'T' : '');
      v.status.clear();
      const def = BUILDINGS[b.type];
      if (def.power || def.powerGen || def.mineRate || def.crafter) {
        v.status.circle(0, 0, 0.13).fill(STATUS_COLORS[b.status] ?? 0x999999).stroke({ width: 0.04, color: 0x111111 });
      } else if (b.type === 'power_pole' && b.tripped) {
        v.status.circle(0, 0, 0.13).fill(0xff3030).stroke({ width: 0.04, color: 0x111111 });
      }
    }
  }

  private createView(b: BuildingState): BuildingView {
    const def = BUILDINGS[b.type];
    const [W, H] = footprintSize(def.w, def.h, b.rot);
    const root = new Container();
    root.position.set(b.x + W / 2, b.y + H / 2);
    const body = new Container();
    body.rotation = (b.rot * Math.PI) / 2;
    root.addChild(body);
    const g = new Graphics();
    body.addChild(g);
    const view: BuildingView = { root, body, status: new Graphics(), key: `${b.type}:${b.x}:${b.y}:${b.rot}`, w: W, h: H };
    if (isBelt(b.type)) {
      drawBelt(g, def);
      this.beltLayer.addChild(root);
      return view;
    }
    drawBuildingBody(g, def, view);
    root.addChild(view.status);
    view.status.position.set(W / 2 - 0.22, -H / 2 + 0.22);
    if (def.w * def.h >= 2 || b.type === 'hub') {
      const label = new Text({ text: b.type === 'hub' ? 'HUB' : def.short, style: { fontFamily: 'Rajdhani, Arial', fontSize: b.type === 'hub' ? 48 : 20, fontWeight: '700', fill: 0xffffff, stroke: { color: 0x000000, width: 4 } } });
      label.anchor.set(0.5);
      label.scale.set(1 / 64);
      label.position.set(0, H / 2 - 0.28);
      if (b.type === 'hub') label.position.set(0, 0.9);
      label.alpha = 0.9;
      root.addChild(label);
      view.label = label;
    }
    this.buildingLayer.addChild(root);
    return view;
  }

  drawPowerLines() {
    const g = this.powerLines;
    g.clear();
    const poles = [...this.state.buildings.values()].filter((b) => b.type === 'power_pole');
    for (let i = 0; i < poles.length; i++) {
      const a = poles[i];
      const near = poles
        .filter((p) => p !== a && p.id > a.id && Math.hypot(p.x - a.x, p.y - a.y) <= POLE_WIRE_RANGE)
        .sort((p, q) => Math.hypot(p.x - a.x, p.y - a.y) - Math.hypot(q.x - a.x, q.y - a.y))
        .slice(0, 3);
      for (const p of near) {
        g.moveTo(a.x + 0.5, a.y + 0.3).quadraticCurveTo((a.x + p.x) / 2 + 0.5, (a.y + p.y) / 2 + 0.7, p.x + 0.5, p.y + 0.3);
      }
    }
    g.stroke({ width: 0.05, color: 0x1a1a1a, alpha: 0.8 });
  }

  // ------------------------------------------------------------ varlıklar

  private syncPlayers() {
    for (const p of this.state.players.values()) {
      let v = this.playerViews.get(p.id);
      if (!p.online) {
        if (v) { v.root.destroy({ children: true }); this.playerViews.delete(p.id); }
        continue;
      }
      if (!v || v.color !== p.color) {
        v?.root.destroy({ children: true });
        const root = new Container();
        const body = new Graphics();
        const name = new Text({ text: p.name, style: { fontFamily: 'Rajdhani, Arial', fontSize: 22, fontWeight: '700', fill: p.color, stroke: { color: 0x000000, width: 4 } } });
        name.anchor.set(0.5, 1);
        name.scale.set(1 / 64);
        name.position.set(0, -0.5);
        const hp = new Graphics();
        root.addChild(body, hp, name);
        this.entityLayer.addChild(root);
        v = { root, body, name, hp, color: p.color };
        this.playerViews.set(p.id, v);
      }
      if (v.name.text !== p.name) v.name.text = p.name;
      v.root.position.set(p.x, p.y);
      const g = v.body;
      g.clear();
      g.ellipse(0.04, 0.08, 0.32, 0.26).fill({ color: 0x000000, alpha: 0.3 });
      g.circle(0, 0, 0.3).fill(darken(p.color, 0.75)).stroke({ width: 0.05, color: 0x111111 });
      g.circle(0, 0, 0.2).fill(p.color);
      const a = p.angle;
      g.moveTo(Math.cos(a) * 0.12, Math.sin(a) * 0.12)
        .lineTo(Math.cos(a - 0.5) * 0.3, Math.sin(a - 0.5) * 0.3)
        .lineTo(Math.cos(a) * 0.42, Math.sin(a) * 0.42)
        .lineTo(Math.cos(a + 0.5) * 0.3, Math.sin(a + 0.5) * 0.3)
        .closePath()
        .fill(0x9fe8ff)
        .stroke({ width: 0.03, color: 0x111111 });
      v.hp.clear();
      if (p.hp < PLAYER_MAX_HP) {
        v.hp.rect(-0.35, -0.48, 0.7, 0.07).fill(0x330000);
        v.hp.rect(-0.35, -0.48, (0.7 * Math.max(0, p.hp)) / PLAYER_MAX_HP, 0.07).fill(0x60e060);
      }
    }
    for (const [id, v] of this.playerViews) if (!this.state.players.has(id)) { v.root.destroy({ children: true }); this.playerViews.delete(id); }
  }

  private syncEnemies(dt: number) {
    for (const e of this.state.enemies.values()) {
      let v = this.enemyViews.get(e.id);
      if (!v) {
        const root = new Container();
        const body = new Graphics();
        const hp = new Graphics();
        root.addChild(body, hp);
        this.entityLayer.addChild(root);
        v = { root, body, hp, lx: e.x, ly: e.y };
        this.enemyViews.set(e.id, v);
      }
      const dx = e.x - v.lx, dy = e.y - v.ly;
      if (Math.hypot(dx, dy) > 0.001) v.body.rotation = Math.atan2(dy, dx);
      v.lx = e.x; v.ly = e.y;
      v.root.position.set(e.x, e.y);
      const g = v.body;
      g.clear();
      const leg = Math.sin(this.time * 18 + e.id) * 0.08;
      for (const s of [-1, 1]) {
        for (const k of [-0.15, 0, 0.15]) {
          g.moveTo(k, 0).lineTo(k + leg * s, s * 0.34);
        }
      }
      g.stroke({ width: 0.05, color: 0x2a1010 });
      g.ellipse(0, 0, 0.34, 0.24).fill(0x8a2a1a).stroke({ width: 0.04, color: 0x2a0a0a });
      g.ellipse(-0.06, 0, 0.2, 0.14).fill(0xb04428);
      g.circle(0.26, -0.08, 0.05).fill(0xffe060);
      g.circle(0.26, 0.08, 0.05).fill(0xffe060);
      v.hp.clear();
      if (e.hp < 30) {
        v.hp.rect(-0.3, -0.45, 0.6, 0.06).fill(0x330000);
        v.hp.rect(-0.3, -0.45, (0.6 * e.hp) / 30, 0.06).fill(0xe04040);
      }
    }
    for (const [id, v] of this.enemyViews) if (!this.state.enemies.has(id)) { v.root.destroy({ children: true }); this.enemyViews.delete(id); }
    void dt;
  }

  private syncNests() {
    for (const n of this.state.nests) {
      let v = this.nestViews.get(n.id);
      if (!v || v.alive !== n.alive) {
        v?.root.destroy({ children: true });
        const root = new Container();
        const body = new Graphics();
        const hp = new Graphics();
        root.addChild(body, hp);
        root.position.set(n.x + 0.5, n.y + 0.5);
        this.buildingLayer.addChild(root);
        if (n.alive) {
          body.ellipse(0.1, 0.15, 1.0, 0.8).fill({ color: 0x000000, alpha: 0.3 });
          body.ellipse(0, 0, 0.95, 0.75).fill(0x5a2a4a).stroke({ width: 0.06, color: 0x2a0a20 });
          for (let k = 0; k < 7; k++) {
            const a = (k / 7) * Math.PI * 2;
            body.moveTo(Math.cos(a) * 0.5, Math.sin(a) * 0.4).lineTo(Math.cos(a) * 1.1, Math.sin(a) * 0.9).lineTo(Math.cos(a + 0.25) * 0.55, Math.sin(a + 0.25) * 0.45).closePath().fill(0x7a3a62);
          }
          body.ellipse(0, 0, 0.35, 0.25).fill(0x1a0010);
          body.circle(-0.1, -0.05, 0.05).fill(0xff5050);
          body.circle(0.12, 0.03, 0.05).fill(0xff5050);
        } else {
          body.ellipse(0, 0, 0.9, 0.7).fill(0x3a3a36).stroke({ width: 0.05, color: 0x222220 });
          body.ellipse(0, 0, 0.4, 0.3).fill(0x22221f);
        }
        v = { root, body, hp, alive: n.alive };
        this.nestViews.set(n.id, v);
      }
      v.hp.clear();
      if (n.alive && n.hp < 200) {
        v.hp.rect(-0.7, -1.05, 1.4, 0.1).fill(0x330000);
        v.hp.rect(-0.7, -1.05, (1.4 * n.hp) / 200, 0.1).fill(0xc040a0);
      }
    }
  }

  // ------------------------------------------------------------ efektler

  addFx(msg: Extract<ServerMsg, { t: 'fx' }>) {
    const life = msg.kind === 'death' ? 1.2 : msg.kind === 'swing' ? 0.2 : 0.5;
    this.fx.push({ kind: msg.kind, x: msg.x, y: msg.y, angle: msg.angle, t: 0, life });
  }

  private drawFx(dt: number) {
    const g = this.fxG;
    g.clear();
    this.fx = this.fx.filter((f) => (f.t += dt) < f.life);
    for (const f of this.fx) {
      const k = f.t / f.life;
      if (f.kind === 'swing') {
        const a = f.angle ?? 0;
        g.arc(f.x, f.y, 1.4, a - 0.9 + k * 0.4, a + 0.9 - (1 - k) * 0.4).stroke({ width: 0.12, color: 0xffffff, alpha: 0.7 * (1 - k) });
      } else if (f.kind === 'hit') {
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          g.circle(f.x + Math.cos(a) * k * 0.6, f.y + Math.sin(a) * k * 0.6, 0.07 * (1 - k)).fill(0xffd060);
        }
      } else if (f.kind === 'harvest') {
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2 + 0.3;
          g.circle(f.x + Math.cos(a) * k * 0.5, f.y + Math.sin(a) * k * 0.5 - k * 0.3, 0.06 * (1 - k)).fill(0xd0c0a0);
        }
      } else if (f.kind === 'build') {
        g.circle(f.x + 0.5, f.y + 0.5, 0.3 + k * 1.2).stroke({ width: 0.08, color: 0xffd060, alpha: 1 - k });
      } else if (f.kind === 'death' || f.kind === 'enemyDeath') {
        const c = f.kind === 'death' ? 0xff4040 : 0x8a2a1a;
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2;
          g.circle(f.x + Math.cos(a) * k * 1.2, f.y + Math.sin(a) * k * 1.2, 0.1 * (1 - k)).fill(c);
        }
      }
    }
  }

  // ------------------------------------------------------------ kare

  frame(dt: number, ghost: GhostSpec | null, hover: { x: number; y: number; building?: BuildingState; dismantle: boolean } | null) {
    this.time += dt;
    const me = this.state.me();
    if (me) {
      this.camX += (me.x - this.camX) * Math.min(1, dt * 10);
      this.camY += (me.y - this.camY) * Math.min(1, dt * 10);
    }
    const scale = TILE * this.zoom;
    this.world.scale.set(scale);
    const sw = this.app.screen.width, sh = this.app.screen.height;
    this.world.position.set(sw / 2 - this.camX * scale, sh / 2 - this.camY * scale);

    // Görünür alan
    const vx0 = this.camX - sw / 2 / scale - 2, vx1 = this.camX + sw / 2 / scale + 2;
    const vy0 = this.camY - sh / 2 / scale - 2, vy1 = this.camY + sh / 2 / scale + 2;
    for (const c of this.chunks.values()) {
      const x = c.sprite.x, y = c.sprite.y;
      c.sprite.visible = x + CHUNK_SIZE > vx0 && x < vx1 && y + CHUNK_SIZE > vy0 && y < vy1;
    }
    for (const [id, v] of this.views) {
      const x = v.root.x, y = v.root.y;
      v.root.visible = x + v.w > vx0 && x - v.w < vx1 && y + v.h > vy0 && y - v.h < vy1;
      if (!v.root.visible) continue;
      const b = this.state.buildings.get(id);
      if (b && b.status === 'working') {
        if (v.spinner) v.spinner.rotation += dt * 3;
        if (v.glow) v.glow.alpha = 0.6 + Math.sin(this.time * 8 + id) * 0.3;
      } else if (v.glow) v.glow.alpha = 0.1;
    }

    // Bant eşyaları
    const ig = this.beltItems;
    ig.clear();
    const now = performance.now();
    for (const [id] of this.state.belts) {
      const b = this.state.buildings.get(id);
      if (!b || b.x < vx0 || b.x > vx1 || b.y < vy0 || b.y > vy1) continue;
      const items = this.state.beltItemsAt(id, now);
      for (const it of items) {
        const px = b.x + 0.5 + DX[b.rot] * (it.pos - 0.5);
        const py = b.y + 0.5 + DY[b.rot] * (it.pos - 0.5);
        const col = ITEMS[it.item]?.color ?? 0xffffff;
        ig.roundRect(px - 0.17, py - 0.17, 0.34, 0.34, 0.08).fill(col).stroke({ width: 0.03, color: darken(col, 0.45) });
      }
    }

    this.syncPlayers();
    this.syncEnemies(dt);
    this.syncNests();
    this.drawFx(dt);

    // Önizleme / vurgulama
    const o = this.overlay;
    o.clear();
    if (hover) {
      if (hover.building) {
        const b = hover.building;
        const def = BUILDINGS[b.type];
        const [W, H] = footprintSize(def.w, def.h, b.rot);
        o.rect(b.x, b.y, W, H).stroke({ width: 0.06, color: hover.dismantle ? 0xff4040 : 0xffffff, alpha: 0.9 });
        if (hover.dismantle) o.rect(b.x, b.y, W, H).fill({ color: 0xff2020, alpha: 0.25 });
      } else {
        o.rect(hover.x, hover.y, 1, 1).stroke({ width: 0.04, color: 0xffffff, alpha: 0.5 });
      }
    }
    if (ghost) {
      const def = BUILDINGS[ghost.type];
      if (ghost.showPower) {
        for (const b of this.state.buildings.values()) {
          if (b.type !== 'power_pole') continue;
          o.rect(b.x - POLE_SUPPLY_RADIUS, b.y - POLE_SUPPLY_RADIUS, POLE_SUPPLY_RADIUS * 2 + 1, POLE_SUPPLY_RADIUS * 2 + 1).fill({ color: 0x4fb3ff, alpha: 0.07 }).stroke({ width: 0.04, color: 0x4fb3ff, alpha: 0.4 });
        }
      }
      for (const t of ghost.tiles) {
        const [W, H] = footprintSize(def.w, def.h, t.rot);
        const col = t.ok ? 0x60e060 : 0xff5050;
        o.rect(t.x, t.y, W, H).fill({ color: col, alpha: 0.3 }).stroke({ width: 0.05, color: col, alpha: 0.9 });
        if (ghost.type === 'power_pole') {
          o.rect(t.x - POLE_SUPPLY_RADIUS, t.y - POLE_SUPPLY_RADIUS, POLE_SUPPLY_RADIUS * 2 + 1, POLE_SUPPLY_RADIUS * 2 + 1).stroke({ width: 0.05, color: 0x4fb3ff, alpha: 0.8 });
        }
        drawGhostArrows(o, def, t.x, t.y, t.rot, isBelt(ghost.type));
      }
    }
  }

  screenToWorld(sx: number, sy: number): [number, number] {
    const scale = TILE * this.zoom;
    return [(sx - this.world.position.x) / scale, (sy - this.world.position.y) / scale];
  }

  setZoom(z: number) {
    this.zoom = Math.max(0.35, Math.min(2.5, z));
  }
}

// ---------------------------------------------------------------- çizim yardımcıları

function drawBelt(g: Graphics, def: BuildingDef) {
  const mk2 = def.id === 'belt_mk2';
  g.rect(-0.5, -0.42, 1, 0.84).fill(mk2 ? 0x2a3a4a : 0x2c2f33);
  g.rect(-0.5, -0.46, 1, 0.08).fill(mk2 ? 0x6a9ac0 : 0xc89a3a);
  g.rect(-0.5, 0.38, 1, 0.08).fill(mk2 ? 0x6a9ac0 : 0xc89a3a);
  for (const off of [-0.25, 0.2]) {
    g.moveTo(off - 0.08, -0.2).lineTo(off + 0.1, 0).lineTo(off - 0.08, 0.2);
  }
  g.stroke({ width: 0.06, color: mk2 ? 0x5a7a9a : 0x4a4f55 });
}

function portPos(def: BuildingDef, p: PortDef): [number, number] {
  return [p.x + 0.5 - def.w / 2 + DX[p.dir] * 0.5, p.y + 0.5 - def.h / 2 + DY[p.dir] * 0.5];
}

function drawPorts(g: Graphics, def: BuildingDef) {
  for (const p of def.inputs) {
    const [x, y] = portPos(def, p);
    const d = opposite(p.dir);
    const ax = DX[d], ay = DY[d];
    g.rect(x - 0.18 + ax * 0.0 - Math.abs(ay) * 0, y - 0.18, 0.36, 0.36).fill(0x1a3a1a);
    g.moveTo(x - ax * 0.1 - ay * 0.14, y - ay * 0.1 + ax * 0.14).lineTo(x + ax * 0.12, y + ay * 0.12).lineTo(x - ax * 0.1 + ay * 0.14, y - ay * 0.1 - ax * 0.14).closePath().fill(0x60e060);
  }
  for (const p of def.outputs) {
    const [x, y] = portPos(def, p);
    const ax = DX[p.dir], ay = DY[p.dir];
    g.rect(x - 0.18, y - 0.18, 0.36, 0.36).fill(0x3a2a10);
    g.moveTo(x - ax * 0.1 - ay * 0.14, y - ay * 0.1 + ax * 0.14).lineTo(x + ax * 0.12, y + ay * 0.12).lineTo(x - ax * 0.1 + ay * 0.14, y - ay * 0.1 - ax * 0.14).closePath().fill(0xf0a030);
  }
}

function drawBuildingBody(g: Graphics, def: BuildingDef, view: BuildingView) {
  const w = def.w, h = def.h;
  const c = def.color;
  const x0 = -w / 2, y0 = -h / 2;
  if (def.id === 'power_pole') {
    g.ellipse(0.06, 0.1, 0.25, 0.18).fill({ color: 0x000000, alpha: 0.3 });
    g.circle(0, 0, 0.2).fill(0x5a5a5a).stroke({ width: 0.04, color: 0x222222 });
    g.rect(-0.3, -0.06, 0.6, 0.12).fill(0x8a6a3a);
    g.circle(-0.25, 0, 0.06).fill(c);
    g.circle(0.25, 0, 0.06).fill(c);
    return;
  }
  if (def.id === 'crate') {
    g.rect(-0.35, -0.3, 0.7, 0.6).fill(0x7a5a32).stroke({ width: 0.05, color: 0x3a2a12 });
    g.moveTo(-0.35, -0.3).lineTo(0.35, 0.3).moveTo(0.35, -0.3).lineTo(-0.35, 0.3).stroke({ width: 0.04, color: 0x3a2a12 });
    return;
  }
  // Gölge + gövde
  g.roundRect(x0 + 0.1, y0 + 0.14, w - 0.1, h - 0.1, 0.12).fill({ color: 0x000000, alpha: 0.35 });
  g.roundRect(x0 + 0.04, y0 + 0.04, w - 0.08, h - 0.08, 0.12).fill(darken(c, 0.55)).stroke({ width: 0.05, color: 0x111111 });
  g.roundRect(x0 + 0.14, y0 + 0.14, w - 0.28, h - 0.28, 0.08).fill(darken(c, 0.85));
  // Tipe özel detay
  switch (def.id) {
    case 'hub': {
      g.roundRect(-1.5, -1.5, 3, 3, 0.3).fill(0x3a3f45).stroke({ width: 0.06, color: 0x1a1a1a });
      g.circle(0, -0.3, 0.9).fill(darken(c, 0.9)).stroke({ width: 0.08, color: 0x222222 });
      const s = new Graphics();
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        s.moveTo(0, 0).lineTo(Math.cos(a) * 0.75, Math.sin(a) * 0.75);
      }
      s.stroke({ width: 0.12, color: 0x2a2a2a });
      s.circle(0, 0, 0.2).fill(0xffd060);
      s.position.set(0, -0.3);
      g.parent!.addChild(s);
      view.spinner = s;
      break;
    }
    case 'miner_mk1':
    case 'miner_mk2': {
      g.rect(-0.8, -0.8, 1.6, 1.6).fill(darken(c, 0.7));
      const s = new Graphics();
      s.circle(0, 0, 0.55).fill(0x555a60).stroke({ width: 0.05, color: 0x222222 });
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2;
        s.moveTo(0, 0).lineTo(Math.cos(a) * 0.5, Math.sin(a) * 0.5);
      }
      s.stroke({ width: 0.12, color: c });
      s.circle(0, 0, 0.12).fill(0x222222);
      g.parent!.addChild(s);
      view.spinner = s;
      break;
    }
    case 'smelter':
    case 'foundry': {
      g.roundRect(x0 + 0.35, y0 + 0.3, w - 0.7, h - 0.6, 0.1).fill(0x2a1a14);
      const glow = new Graphics();
      glow.roundRect(x0 + 0.45, y0 + 0.4, w - 0.9, h - 0.8, 0.08).fill(0xff8a20);
      glow.alpha = 0.1;
      g.parent!.addChild(glow);
      view.glow = glow;
      g.circle(x0 + w - 0.4, y0 + 0.4, 0.18).fill(0x3a3a3a).stroke({ width: 0.04, color: 0x111111 });
      break;
    }
    case 'constructor':
    case 'assembler': {
      const s = new Graphics();
      const r = def.id === 'assembler' ? 0.5 : 0.45;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        s.rect(Math.cos(a) * r - 0.08, Math.sin(a) * r - 0.08, 0.16, 0.16);
      }
      s.fill(0xc0c8d0);
      s.circle(0, 0, r - 0.05).fill(0x9aa4ae).stroke({ width: 0.04, color: 0x333333 });
      s.circle(0, 0, 0.12).fill(0x333333);
      g.parent!.addChild(s);
      view.spinner = s;
      if (def.id === 'assembler') {
        g.rect(x0 + 0.3, y0 + 0.3, 0.6, h - 0.6).fill(0x3a3a5a);
      }
      break;
    }
    case 'biomass_burner':
    case 'coal_generator': {
      g.circle(x0 + w - 0.55, y0 + 0.55, 0.32).fill(0x333333).stroke({ width: 0.05, color: 0x111111 });
      g.circle(x0 + w - 0.55, y0 + 0.55, 0.18).fill(0x111111);
      const glow = new Graphics();
      glow.roundRect(x0 + 0.35, y0 + h - 0.75, w - 1.1, 0.4, 0.08).fill(0xffa030);
      glow.alpha = 0.1;
      g.parent!.addChild(glow);
      view.glow = glow;
      break;
    }
    case 'storage': {
      for (let k = 1; k < 4; k++) g.moveTo(x0 + 0.2, y0 + (h * k) / 4).lineTo(x0 + w - 0.2, y0 + (h * k) / 4);
      g.stroke({ width: 0.05, color: darken(c, 0.5) });
      break;
    }
    case 'workbench': {
      g.rect(-0.7, -0.2, 0.5, 0.3).fill(0x8a8f95);
      g.rect(0.1, -0.25, 0.15, 0.4).fill(0x6a5030);
      g.circle(0.5, 0, 0.12).fill(0xc0c0c0);
      break;
    }
    case 'splitter':
    case 'merger': {
      const col = 0x222222;
      if (def.id === 'splitter') {
        g.moveTo(-0.3, 0).lineTo(0.3, 0).moveTo(0, 0).lineTo(0, -0.3).moveTo(0, 0).lineTo(0, 0.3);
      } else {
        g.moveTo(-0.3, 0).lineTo(0.3, 0).moveTo(0, -0.3).lineTo(0, 0).moveTo(0, 0.3).lineTo(0, 0);
      }
      g.stroke({ width: 0.08, color: col });
      break;
    }
  }
  drawPorts(g, def);
}

function drawGhostArrows(o: Graphics, def: BuildingDef, x: number, y: number, rot: number, belt: boolean) {
  const [W, H] = footprintSize(def.w, def.h, rot);
  if (belt) {
    const cx = x + 0.5, cy = y + 0.5;
    const ax = DX[rot], ay = DY[rot];
    o.moveTo(cx - ax * 0.3 - ay * 0.2, cy - ay * 0.3 + ax * 0.2).lineTo(cx + ax * 0.3, cy + ay * 0.3).lineTo(cx - ax * 0.3 + ay * 0.2, cy - ay * 0.3 - ax * 0.2).stroke({ width: 0.08, color: 0xffffff, alpha: 0.9 });
    return;
  }
  // Çıkış yönü oku
  const out = def.outputs[0];
  if (out) {
    const cx = x + W / 2, cy = y + H / 2;
    const d = (out.dir + rot) % 4;
    const ax = DX[d], ay = DY[d];
    const ex = cx + ax * (W / 2 + 0.4), ey = cy + ay * (H / 2 + 0.4);
    o.moveTo(cx, cy).lineTo(ex, ey).stroke({ width: 0.08, color: 0xf0a030, alpha: 0.9 });
    o.moveTo(ex + ax * 0.25, ey + ay * 0.25).lineTo(ex - ay * 0.2, ey + ax * 0.2).lineTo(ex + ay * 0.2, ey - ax * 0.2).closePath().fill({ color: 0xf0a030, alpha: 0.9 });
  }
}
