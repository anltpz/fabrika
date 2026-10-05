import { PLAYER_RADIUS } from './constants';

export type BlockFn = (tx: number, ty: number) => boolean;

function collides(x: number, y: number, r: number, blocked: BlockFn): boolean {
  const x0 = Math.floor(x - r), x1 = Math.floor(x + r - 1e-6);
  const y0 = Math.floor(y - r), y1 = Math.floor(y + r - 1e-6);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (blocked(tx, ty)) return true;
  return false;
}

/** Eksen bazlı çarpışmalı hareket. Konum tile merkez değil sürekli koordinattır. */
export function moveCircle(
  pos: { x: number; y: number },
  vx: number,
  vy: number,
  dt: number,
  blocked: BlockFn,
  r = PLAYER_RADIUS,
): void {
  const nx = pos.x + vx * dt;
  if (!collides(nx, pos.y, r, blocked)) pos.x = nx;
  const ny = pos.y + vy * dt;
  if (!collides(pos.x, ny, r, blocked)) pos.y = ny;
}

export function inputVelocity(input: { up: boolean; down: boolean; left: boolean; right: boolean }, speed: number): [number, number] {
  let vx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  let vy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
  const len = Math.hypot(vx, vy);
  if (len > 0) { vx = (vx / len) * speed; vy = (vy / len) * speed; }
  return [vx, vy];
}
