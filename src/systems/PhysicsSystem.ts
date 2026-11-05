import { SOLDIER } from "../config";
import { DEG } from "../core/math";
import type { Rng } from "../core/Rng";
import type { Soldier } from "../entities/Soldier";
import type { PixelWorld } from "../world/PixelWorld";

/**
 * True if a circle at (x, y) with radius r overlaps no solid cell.
 * Out-of-bounds counts as solid.
 */
export function circleIsClear(world: PixelWorld, x: number, y: number, r: number): boolean {
  const cs = world.cellSize;
  const x0 = Math.floor((x - r) / cs);
  const x1 = Math.floor((x + r) / cs);
  const y0 = Math.floor((y - r) / cs);
  const y1 = Math.floor((y + r) / cs);
  const r2 = r * r;
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      if (!world.solidAt(cx, cy)) continue;
      const px = x < cx * cs ? cx * cs : x > (cx + 1) * cs ? (cx + 1) * cs : x;
      const py = y < cy * cs ? cy * cs : y > (cy + 1) * cs ? (cy + 1) * cs : y;
      const dx = x - px;
      const dy = y - py;
      if (dx * dx + dy * dy < r2 - 1e-6) return false;
    }
  }
  return true;
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

/** Find the deepest contact between the circle and solid cells. Returns false if none. */
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
      if (!world.solidAt(cx, cy)) continue;
      const left = cx * cs;
      const top = cy * cs;
      const right = left + cs;
      const bottom = top + cs;
      const px = x < left ? left : x > right ? right : x;
      const py = y < top ? top : y > bottom ? bottom : y;
      const dx = x - px;
      const dy = y - py;
      const d2 = dx * dx + dy * dy;
      if (d2 >= r * r) continue;
      let nx: number;
      let ny: number;
      let pen: number;
      if (d2 > 1e-10) {
        // When the closest point lies on a cell corner that is shared with an
        // adjacent solid cell, suppress the normal component along the shared
        // wall: two neighbor cells form a flat wall, not an exposed corner.
        const atLeft = px === left && x < left;
        const atRight = px === right && x > right;
        const atTop = py === top && y < top;
        const atBottom = py === bottom && y > bottom;
        let cdx = dx;
        let cdy = dy;
        if (atTop && ((atLeft && world.solidAt(cx - 1, cy)) || (atRight && world.solidAt(cx + 1, cy)))) {
          cdx = 0;
        }
        if (atBottom && ((atLeft && world.solidAt(cx - 1, cy)) || (atRight && world.solidAt(cx + 1, cy)))) {
          cdx = 0;
        }
        if (atLeft && ((atTop && world.solidAt(cx, cy - 1)) || (atBottom && world.solidAt(cx, cy + 1)))) {
          cdy = 0;
        }
        if (atRight && ((atTop && world.solidAt(cx, cy - 1)) || (atBottom && world.solidAt(cx, cy + 1)))) {
          cdy = 0;
        }
        const cd2 = cdx * cdx + cdy * cdy;
        if (cd2 >= r * r || cd2 < 1e-10) continue;
        const d = Math.sqrt(cd2);
        nx = cdx / d;
        ny = cdy / d;
        pen = r - d;
      } else {
        // Center inside the cell: exit through the nearest face, preferring
        // faces that open onto empty space.
        const cand = [
          { d: x - left, nx: -1, ny: 0, open: !world.solidAt(cx - 1, cy) },
          { d: right - x, nx: 1, ny: 0, open: !world.solidAt(cx + 1, cy) },
          { d: y - top, nx: 0, ny: -1, open: !world.solidAt(cx, cy - 1) },
          { d: bottom - y, nx: 0, ny: 1, open: !world.solidAt(cx, cy + 1) },
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
        found = true;
      }
    }
  }
  return found;
}

export interface PhysicsStats {
  relocations: number;
  stuckEvents: number;
}

export class PhysicsSystem {
  readonly stats: PhysicsStats = { relocations: 0, stuckEvents: 0 };

  constructor(
    private world: PixelWorld,
    private rng: Rng,
  ) {}

  /** Advance one soldier by dt using substeps. Returns number of bounces. */
  step(s: Soldier, dt: number): number {
    const r = s.radius;
    const dist = s.speed * dt;
    const n = Math.max(1, Math.ceil(dist / (r * 0.5)));
    const h = dt / n;
    let bounces = 0;
    for (let i = 0; i < n; i++) {
      s.x += s.vx * h;
      s.y += s.vy * h;
      if (this.resolve(s)) bounces++;
    }
    return bounces;
  }

  /** Resolve overlap and reflect velocity. Returns true if a bounce occurred. */
  resolve(s: Soldier): boolean {
    const r = s.radius;
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

    if (!circleIsClear(this.world, s.x, s.y, r)) {
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
    s.vx = (vx / vlen) * s.speed;
    s.vy = (vy / vlen) * s.speed;
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
