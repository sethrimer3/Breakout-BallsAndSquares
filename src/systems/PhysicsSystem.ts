import { advanceMomentum, triggerMomentum } from "./Momentum";
import type { SoldierStats } from "../entities/Soldier";
import { SOLDIER } from "../config";
import { gridRaycast, makeRayHit } from "../core/gridRaycast";
import { DEG } from "../core/math";
import type { Rng } from "../core/Rng";
import type { Soldier } from "../entities/Soldier";
import type { PixelWorld } from "../world/PixelWorld";

/**
 * True if a circle at (x, y) with radius r overlaps no solid cell or solid
 * 50% sub-pixel (pink core blight). Out-of-bounds counts as solid.
 */
export function circleIsClear(world: PixelWorld, x: number, y: number, r: number): boolean {
  const cs = world.cellSize;
  const ss = world.subCellSize;
  const x0 = Math.floor((x - r) / cs);
  const x1 = Math.floor((x + r) / cs);
  const y0 = Math.floor((y - r) / cs);
  const y1 = Math.floor((y + r) / cs);
  const r2 = r * r;
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      if (world.solidAt(cx, cy)) {
        if (boxOverlapsCircle(cx * cs, cy * cs, cs, x, y, r2)) return false;
      } else if (world.anySolidInCell(cx, cy)) {
        for (let sy = cy * 2; sy <= cy * 2 + 1; sy++) {
          for (let sx = cx * 2; sx <= cx * 2 + 1; sx++) {
            if (world.subHealth[sy * world.subWidth + sx] === 0) continue;
            if (boxOverlapsCircle(sx * ss, sy * ss, ss, x, y, r2)) return false;
          }
        }
      }
    }
  }
  return true;
}

function boxOverlapsCircle(left: number, top: number, size: number, x: number, y: number, r2: number): boolean {
  const px = x < left ? left : x > left + size ? left + size : x;
  const py = y < top ? top : y > top + size ? top + size : y;
  const dx = x - px;
  const dy = y - py;
  return dx * dx + dy * dy < r2 - 1e-6;
}

/**
 * Spawn position for a new soldier: the room center if clear, otherwise the
 * nearest room cell center whose full circle is clear. Null if the room is overrun.
 */
export function findSpawnPoint(world: PixelWorld, r: number): { x: number; y: number } | null {
  const cx = world.roomCenterX;
  const cy = world.roomCenterY;
  if (circleIsClear(world, cx, cy, r)) return { x: cx, y: cy };
  const cs = world.cellSize;
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  for (let y = world.roomY0; y <= world.roomY1; y++) {
    for (let x = world.roomX0; x <= world.roomX1; x++) {
      const px = (x + 0.5) * cs;
      const py = (y + 0.5) * cs;
      const d = (px - cx) ** 2 + (py - cy) ** 2;
      if (d < bestD && circleIsClear(world, px, py, r)) {
        bestD = d;
        best = { x: px, y: py };
      }
    }
  }
  return best;
}

/**
 * Nearest point to `(x, y)` where a soldier of radius `r` sits at least `gap`
 * pixels clear of every wall, block, sub-pixel and the world edge. Searches out
 * to `maxCells` cells on a half-cell grid; null if nothing nearby is open.
 */
export function findClearDeployPoint(
  world: PixelWorld,
  x: number,
  y: number,
  r: number,
  gap = 1,
  maxCells = 12,
): { x: number; y: number } | null {
  const rr = r + gap;
  if (circleIsClear(world, x, y, rr)) return { x, y };
  const step = world.subCellSize;
  const n = Math.ceil((maxCells * world.cellSize) / step);
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  for (let ring = 1; ring <= n; ring++) {
    // Every point on this ring is at least `ring * step` away; stop once
    // nothing closer than the best hit can remain.
    if (best && ring * step > Math.sqrt(bestD)) break;
    for (let j = -ring; j <= ring; j++) {
      for (let k = -ring; k <= ring; k++) {
        if (Math.abs(j) !== ring && Math.abs(k) !== ring) continue;
        const px = x + j * step;
        const py = y + k * step;
        const d = (px - x) ** 2 + (py - y) ** 2;
        if (d >= bestD || !circleIsClear(world, px, py, rr)) continue;
        bestD = d;
        best = { x: px, y: py };
      }
    }
  }
  return best;
}

/** True if an axis-aligned cell overlaps a circle. */
export function cellOverlapsCircle(
  cellSize: number,
  cx: number,
  cy: number,
  x: number,
  y: number,
  r: number,
): boolean {
  const x0 = cx * cellSize;
  const y0 = cy * cellSize;
  const px = x < x0 ? x0 : x > x0 + cellSize ? x0 + cellSize : x;
  const py = y < y0 ? y0 : y > y0 + cellSize ? y0 + cellSize : y;
  const dx = x - px;
  const dy = y - py;
  return dx * dx + dy * dy < r * r;
}

interface Contact {
  nx: number;
  ny: number;
  pen: number;
}

const contact: Contact = { nx: 0, ny: 0, pen: 0 };
const sightHit = makeRayHit();

/**
 * True if there is an unobstructed line of sight between (x1, y1) and (x2, y2).
 * If the ray strikes a solid cell/subcell that is the target itself (e.g. targeting
 * a wall block directly), it is considered in sight.
 */
export function hasLineOfSight(
  world: PixelWorld,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): boolean {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-4) return true;

  const ndx = dx / dist;
  const ndy = dy / dist;
  const ss = world.subCellSize;

  let startX = x1;
  let startY = y1;
  if (world.subSolidAt(Math.floor(startX / ss), Math.floor(startY / ss))) {
    startX += ndx * 0.5;
    startY += ndy * 0.5;
    if (world.subSolidAt(Math.floor(startX / ss), Math.floor(startY / ss))) {
      return false;
    }
  }

  const blocked = gridRaycast(
    world.subSolidQuery,
    ss,
    startX,
    startY,
    ndx,
    ndy,
    dist,
    sightHit,
  );

  if (!blocked) return true;

  // If blocked, check if the hit occurred at the target point / cell
  const targetSx = Math.floor(x2 / ss);
  const targetSy = Math.floor(y2 / ss);
  if (sightHit.cx === targetSx && sightHit.cy === targetSy) {
    return true;
  }
  const cs = world.cellSize;
  const targetCx = Math.floor(x2 / cs);
  const targetCy = Math.floor(y2 / cs);
  const hitCx = Math.floor(sightHit.cx / 2);
  const hitCy = Math.floor(sightHit.cy / 2);
  if (hitCx === targetCx && hitCy === targetCy) {
    return true;
  }

  return false;
}

/** A circle-width visibility corridor, including rounded endpoint clearance. */
export function hasCircleLineOfSight(world: PixelWorld, x: number, y: number, tx: number, ty: number, radius: number): boolean {
  if (!circleIsClear(world, tx, ty, radius)) return false;
  const length = Math.hypot(tx-x,ty-y);
  if (length < 1e-6) return true;
  const dx=(tx-x)/length;const dy=(ty-y)/length;
  for (const offset of [-radius,0,radius]) {
    if (gridRaycast(world.subSolidQuery,world.subCellSize,x-dy*offset,y+dx*offset,dx,dy,length,sightHit)) return false;
  }
  return true;
}

/** Find the deepest contact between the circle and solid cells / sub-pixels. Returns false if none. */
function deepestContact(world: PixelWorld, x: number, y: number, r: number, out: Contact): boolean {
  const cs = world.cellSize;
  const x0 = Math.floor((x - r) / cs);
  const x1 = Math.floor((x + r) / cs);
  const y0 = Math.floor((y - r) / cs);
  const y1 = Math.floor((y + r) / cs);
  let found = false;
  out.pen = 0;
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      if (world.solidAt(cx, cy)) {
        if (boxContact(world, x, y, r, cx, cy, false, out)) found = true;
      } else if (world.anySolidInCell(cx, cy)) {
        for (let sy = cy * 2; sy <= cy * 2 + 1; sy++) {
          for (let sx = cx * 2; sx <= cx * 2 + 1; sx++) {
            if (world.subHealth[sy * world.subWidth + sx] === 0) continue;
            if (boxContact(world, x, y, r, sx, sy, true, out)) found = true;
          }
        }
      }
    }
  }
  return found;
}

function solidNeighbor(world: PixelWorld, sub: boolean, gx: number, gy: number): boolean {
  return sub ? world.subSolidAt(gx, gy) : world.solidAt(gx, gy);
}

/**
 * Contact against one solid box: normal cell `(gx, gy)`, or sub-pixel `(gx, gy)` when `sub`.
 * Updates `out` and returns true if this is the deepest contact so far.
 */
function boxContact(
  world: PixelWorld,
  x: number,
  y: number,
  r: number,
  gx: number,
  gy: number,
  sub: boolean,
  out: Contact,
): boolean {
  const size = sub ? world.subCellSize : world.cellSize;
  const left = gx * size;
  const top = gy * size;
  const right = left + size;
  const bottom = top + size;
  const px = x < left ? left : x > right ? right : x;
  const py = y < top ? top : y > bottom ? bottom : y;
  const dx = x - px;
  const dy = y - py;
  const d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return false;
  let nx: number;
  let ny: number;
  let pen: number;
  if (d2 > 1e-10) {
    // When the closest point lies on a box corner that is shared with an
    // adjacent solid box, suppress the normal component along the shared
    // wall: two neighbor boxes form a flat wall, not an exposed corner.
    const atLeft = px === left && x < left;
    const atRight = px === right && x > right;
    const atTop = py === top && y < top;
    const atBottom = py === bottom && y > bottom;
    let cdx = dx;
    let cdy = dy;
    if (atTop && ((atLeft && solidNeighbor(world, sub, gx - 1, gy)) || (atRight && solidNeighbor(world, sub, gx + 1, gy)))) {
      cdx = 0;
    }
    if (atBottom && ((atLeft && solidNeighbor(world, sub, gx - 1, gy)) || (atRight && solidNeighbor(world, sub, gx + 1, gy)))) {
      cdx = 0;
    }
    if (atLeft && ((atTop && solidNeighbor(world, sub, gx, gy - 1)) || (atBottom && solidNeighbor(world, sub, gx, gy + 1)))) {
      cdy = 0;
    }
    if (atRight && ((atTop && solidNeighbor(world, sub, gx, gy - 1)) || (atBottom && solidNeighbor(world, sub, gx, gy + 1)))) {
      cdy = 0;
    }
    const cd2 = cdx * cdx + cdy * cdy;
    if (cd2 >= r * r || cd2 < 1e-10) return false;
    const d = Math.sqrt(cd2);
    nx = cdx / d;
    ny = cdy / d;
    pen = r - d;
  } else {
    // Center inside the box: exit through the nearest face, preferring
    // faces that open onto empty space.
    const cand = [
      { d: x - left, nx: -1, ny: 0, open: !solidNeighbor(world, sub, gx - 1, gy) },
      { d: right - x, nx: 1, ny: 0, open: !solidNeighbor(world, sub, gx + 1, gy) },
      { d: y - top, nx: 0, ny: -1, open: !solidNeighbor(world, sub, gx, gy - 1) },
      { d: bottom - y, nx: 0, ny: 1, open: !solidNeighbor(world, sub, gx, gy + 1) },
    ];
    let best = cand[0];
    let bestScore = Infinity;
    for (const c of cand) {
      const score = c.d + (c.open ? 0 : 1000);
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
    nx = best.nx;
    ny = best.ny;
    pen = best.d + r;
  }
  if (pen > out.pen) {
    out.pen = pen;
    out.nx = nx;
    out.ny = ny;
    return true;
  }
  return false;
}

export interface PhysicsStats {
  relocations: number;
  stuckEvents: number;
}

export class PhysicsSystem {
  private dashStats: SoldierStats | null = null;
  private onDash: ((s: Soldier, nx: number, ny: number) => void) | undefined;
  readonly stats: PhysicsStats = { relocations: 0, stuckEvents: 0 };

  constructor(
    private world: PixelWorld,
    private rng: Rng,
  ) {}

  /** Advance one soldier by dt using substeps. Returns number of bounces. */
  step(s: Soldier, dt: number, stats?: SoldierStats, onDash?: (s: Soldier, nx: number, ny: number) => void): number {
    advanceMomentum(s, dt);
    this.dashStats = stats ?? null;
    this.onDash = onDash;
    const r = s.radius;
    const dist = Math.max(Math.hypot(s.vx, s.vy), stats?.katanaDash && s.weapon === "katana" ? s.speed * Math.min(3, stats.katanaDashPeak) : 0) * dt;
    const n = Math.max(1, Math.ceil(dist / (r * 0.5)));
    const h = dt / n;
    let bounces = 0;
    for (let i = 0; i < n; i++) {
      s.x += s.vx * h;
      s.y += s.vy * h;
      if (this.resolve(s)) bounces++;
    }
    this.dashStats = null;
    this.onDash = undefined;
    return bounces;
  }

  /** Resolve overlap and reflect velocity. Returns true if a bounce occurred. */
  resolve(s: Soldier): boolean {
    const r = s.radius;
    const moveSpeed = s.dashLeft > 0 ? Math.hypot(s.vx, s.vy) || s.speed : s.speed;
    let firstNx = 0;
    let firstNy = 0;
    let touched = false;
    for (let it = 0; it < SOLDIER.resolveIterations; it++) {
      if (!deepestContact(this.world, s.x, s.y, r, contact)) break;
      if (!touched) {
        firstNx = contact.nx;
        firstNy = contact.ny;
        touched = true;
      }
      const push = contact.pen + 1e-4;
      s.x += contact.nx * push;
      s.y += contact.ny * push;
    }
    if (!touched) {
      s.stuckFrames = 0;
      return false;
    }

    const recovered = !circleIsClear(this.world, s.x, s.y, r);
    if (recovered) {
      this.recover(s, firstNx, firstNy);
    } else {
      s.stuckFrames = 0;
    }

    const len = Math.hypot(firstNx, firstNy);
    if (len < 1e-8) return false;
    const nx = firstNx / len;
    const ny = firstNy / len;
    const vn = s.vx * nx + s.vy * ny;
    if (vn >= 0) return false;

    // Manually controlled commander or soldiers in formation slide along walls smoothly.
    if (s.isManual || s.isInFormation) {
      s.vx -= vn * nx;
      s.vy -= vn * ny;
      return true;
    }

    if (s.behavior === "sentry_slow" || s.behavior === "sentry_fast") {
      s.vx = 0;
      s.vy = 0;
      return true;
    }

    if (s.behavior === "orthogonal") {
      if (Math.abs(nx) > Math.abs(ny)) {
        s.vx = -s.vx;
        s.vy = 0;
        if (Math.abs(s.vx) < 1e-4) s.vx = nx > 0 ? moveSpeed : -moveSpeed;
      } else {
        s.vy = -s.vy;
        s.vx = 0;
        if (Math.abs(s.vy) < 1e-4) s.vy = ny > 0 ? moveSpeed : -moveSpeed;
      }
      s.facingAngle = Math.atan2(s.vy, s.vx);
    } else if (s.behavior === "vertical") {
      s.vx = 0;
      s.vy = -s.vy;
      if (Math.abs(s.vy) < 1e-4) s.vy = ny >= 0 ? moveSpeed : -moveSpeed;
      s.facingAngle = Math.atan2(s.vy, 0);
    } else if (s.behavior === "horizontal") {
      s.vy = 0;
      s.vx = -s.vx;
      if (Math.abs(s.vx) < 1e-4) s.vx = nx >= 0 ? moveSpeed : -moveSpeed;
      s.facingAngle = Math.atan2(0, s.vx);
    } else if (s.behavior === "turn_left") {
      let nvx = s.vy;
      let nvy = -s.vx;
      if (nvx * nx + nvy * ny <= 0.05) {
        nvx = s.vx - 2 * vn * nx;
        nvy = s.vy - 2 * vn * ny;
      }
      const nlen = Math.hypot(nvx, nvy) || 1;
      s.vx = (nvx / nlen) * moveSpeed;
      s.vy = (nvy / nlen) * moveSpeed;
      s.facingAngle = Math.atan2(s.vy, s.vx);
    } else if (s.behavior === "turn_right") {
      let nvx = -s.vy;
      let nvy = s.vx;
      if (nvx * nx + nvy * ny <= 0.05) {
        nvx = s.vx - 2 * vn * nx;
        nvy = s.vy - 2 * vn * ny;
      }
      const nlen = Math.hypot(nvx, nvy) || 1;
      s.vx = (nvx / nlen) * moveSpeed;
      s.vy = (nvy / nlen) * moveSpeed;
      s.facingAngle = Math.atan2(s.vy, s.vx);
    } else {
      let vx = s.vx - 2 * vn * nx;
      let vy = s.vy - 2 * vn * ny;
      // Small random jitter to break axis-locked loops; keep it pointing away from the wall.
      const a = this.rng.range(-SOLDIER.bounceJitterDeg, SOLDIER.bounceJitterDeg) * DEG;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const jx = vx * ca - vy * sa;
      const jy = vx * sa + vy * ca;
      if (jx * nx + jy * ny > 0) {
        vx = jx;
        vy = jy;
      }
      const vlen = Math.hypot(vx, vy) || 1;
      s.vx = (vx / vlen) * moveSpeed;
      s.vy = (vy / vlen) * moveSpeed;
      s.facingAngle = Math.atan2(s.vy, s.vx);
    }
    if (!recovered && this.dashStats && triggerMomentum(s, this.dashStats)) this.onDash?.(s, nx, ny);
    return true;
  }

  /**
   * Safe recovery for a soldier still overlapping terrain after resolution.
   * Every candidate position is validated against the full collision circle.
   */
  private recover(s: Soldier, nx: number, ny: number): void {
    const r = s.radius;
    const world = this.world;
    const len = Math.hypot(nx, ny);
    // 1) Escalating push along the summed normal.
    if (len > 1e-8) {
      const ux = nx / len;
      const uy = ny / len;
      for (const d of [0.5, 1, 2, 4]) {
        const tx = s.x + ux * d;
        const ty = s.y + uy * d;
        if (circleIsClear(world, tx, ty, r)) {
          s.x = tx;
          s.y = ty;
          s.stuckFrames = 0;
          this.stats.relocations++;
          return;
        }
      }
    }
    // 2) Bounded ring search, nearest first.
    const maxD = SOLDIER.maxRelocateDist;
    for (let rad = 1; rad <= maxD; rad += 1) {
      for (let k = 0; k < 16; k++) {
        const ang = (k / 16) * Math.PI * 2;
        const tx = s.x + Math.cos(ang) * rad;
        const ty = s.y + Math.sin(ang) * rad;
        if (circleIsClear(world, tx, ty, r)) {
          s.x = tx;
          s.y = ty;
          s.stuckFrames = 0;
          this.stats.relocations++;
          return;
        }
      }
    }
    // 3) Give up: stay put; growth will likely finish it.
    s.stuckFrames++;
    this.stats.stuckEvents++;
  }
}
