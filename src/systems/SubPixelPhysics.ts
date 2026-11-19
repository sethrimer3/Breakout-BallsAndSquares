import { SUBPIXEL_PHYSICS } from "../config";
import type { Soldier } from "../entities/Soldier";
import { SUB, type PixelWorld } from "../world/PixelWorld";

const HASH_SIZE = 1024;
const HASH_MASK = HASH_SIZE - 1;
const ORTHO_DX = [0, 1, -1, 0, 0] as const;
const ORTHO_DY = [0, 0, 0, 1, -1] as const;

function hashSub(sx: number, sy: number): number {
  return ((sx * 73856093) ^ (sy * 19349663)) & HASH_MASK;
}

/**
 * Ultra-efficient, lazy struct-of-arrays physics pool for 0.5-pixel blocks.
 * Static 0.5 pixels live in `PixelWorld` at zero per-frame cost; only pixels
 * knocked loose by a neighboring break or soldier contact enter this pool,
 * collide with terrain and each other, slightly stick to walls, and settle
 * back into `PixelWorld` once they come to rest.
 */
export class SubPixelPhysics {
  readonly cap: number;
  count = 0;

  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly flightTime: Float32Array;
  readonly hp: Uint32Array;
  readonly maxHp: Uint32Array;
  readonly kind: Uint8Array;
  readonly tint: Uint8Array;

  private readonly head = new Int32Array(HASH_SIZE);
  private readonly next: Int32Array;

  constructor(
    private readonly world: PixelWorld,
    cap = SUBPIXEL_PHYSICS.poolSize,
  ) {
    this.cap = cap;
    this.x = new Float32Array(cap);
    this.y = new Float32Array(cap);
    this.vx = new Float32Array(cap);
    this.vy = new Float32Array(cap);
    this.flightTime = new Float32Array(cap);
    this.hp = new Uint32Array(cap);
    this.maxHp = new Uint32Array(cap);
    this.kind = new Uint8Array(cap);
    this.tint = new Uint8Array(cap);
    this.next = new Int32Array(cap);
  }

  clear(): void {
    this.count = 0;
  }

  /**
   * Called when a non-Blight 0.5 pixel at `(sx, sy)` breaks.
   * Pushes nearby active and static non-Blight 0.5 pixels away with a force
   * that diminishes quadratically over distance.
   */
  pushFromBreak(sx: number, sy: number): void {
    const w = this.world;
    const ss = w.subCellSize;
    const bx = (sx + 0.5) * ss;
    const by = (sy + 0.5) * ss;
    const rSub = SUBPIXEL_PHYSICS.pushRadiusSub;
    const R = rSub * ss + ss * 0.25;
    const R2 = R * R;
    const strength = SUBPIXEL_PHYSICS.pushStrength;
    const maxSp = SUBPIXEL_PHYSICS.maxSpeed;
    const maxSp2 = maxSp * maxSp;

    // 1. Push already-active 0.5 pixels within radius R.
    for (let i = 0; i < this.count; i++) {
      const dx = this.x[i] - bx;
      const dy = this.y[i] - by;
      const d2 = dx * dx + dy * dy;
      if (d2 <= 1e-6 || d2 >= R2) continue;
      const d = Math.sqrt(d2);
      const t = 1 - d / R;
      const invD = (strength * t * t) / d;
      let nvx = this.vx[i] + dx * invD;
      let nvy = this.vy[i] + dy * invD;
      const sp2 = nvx * nvx + nvy * nvy;
      if (sp2 > maxSp2) {
        const s = maxSp / Math.sqrt(sp2);
        nvx *= s;
        nvy *= s;
      }
      this.vx[i] = nvx;
      this.vy[i] = nvy;
    }

    // 2. Detach and push static non-Blight 0.5 pixels within radius R.
    const sx0 = Math.max(0, sx - rSub);
    const sx1 = Math.min(w.subWidth - 1, sx + rSub);
    const sy0 = Math.max(0, sy - rSub);
    const sy1 = Math.min(w.subHeight - 1, sy + rSub);
    const breakaway = SUBPIXEL_PHYSICS.wallBreakawaySpeed;

    for (let ny = sy0; ny <= sy1; ny++) {
      for (let nx = sx0; nx <= sx1; nx++) {
        if (nx === sx && ny === sy) continue;
        if (this.count >= this.cap) return;
        const dx = (nx - sx) * ss;
        const dy = (ny - sy) * ss;
        const d2 = dx * dx + dy * dy;
        if (d2 >= R2) continue;
        const parent = (ny >> 1) * w.width + (nx >> 1);
        if (w.health[parent] > 0 || w.boundary[parent]) continue;
        const ni = ny * w.subWidth + nx;
        const hp = w.subHealth[ni];
        if (hp === 0) continue;
        const kind = w.subKind[ni];
        if (kind === SUB.blight) continue;

        const d = Math.sqrt(d2);
        const t = 1 - d / R;
        const imp = Math.min(maxSp, strength * t * t);
        if (imp < breakaway && this.isAdjacentToWall(nx, ny)) continue;

        const tint = w.subTint[ni];
        const maxHp = w.maxSubHealthAt(nx, ny);
        w.detachSub(nx, ny);

        const invD = imp / d;
        const idx = this.count++;
        this.x[idx] = (nx + 0.5) * ss;
        this.y[idx] = (ny + 0.5) * ss;
        this.vx[idx] = dx * invD;
        this.vy[idx] = dy * invD;
        this.flightTime[idx] = 0;
        this.hp[idx] = hp;
        this.maxHp[idx] = maxHp;
        this.kind[idx] = kind;
        this.tint[idx] = tint;
      }
    }
  }

  /** Advance all active 0.5 pixels by `dt`, colliding with walls, soldiers, and each other. */
  update(dt: number, soldiers?: readonly Soldier[]): void {
    if (this.count === 0) return;
    const w = this.world;
    const ss = w.subCellSize;
    const hs = ss * 0.45;
    const invSs = 1 / ss;

    // Spatial hash for O(N) particle-particle repulsion & soldier push.
    if (this.count > 1 || (soldiers && soldiers.length > 0)) {
      this.head.fill(-1);
      for (let i = 0; i < this.count; i++) {
        const b = hashSub(Math.floor(this.x[i] * invSs), Math.floor(this.y[i] * invSs));
        this.next[i] = this.head[b];
        this.head[b] = i;
      }

      if (this.count > 1) {
        const ss2 = ss * ss;
        const repulse = 18;
        for (let i = 0; i < this.count; i++) {
          const xi = this.x[i];
          const yi = this.y[i];
          const bx = Math.floor(xi * invSs);
          const by = Math.floor(yi * invSs);
          for (let oy = -1; oy <= 1; oy++) {
            for (let ox = -1; ox <= 1; ox++) {
              let j = this.head[hashSub(bx + ox, by + oy)];
              while (j !== -1) {
                if (j > i) {
                  const dx = this.x[j] - xi;
                  const dy = this.y[j] - yi;
                  const d2 = dx * dx + dy * dy;
                  if (d2 < ss2) {
                    if (d2 < 1e-6) {
                      this.vx[i] -= 8;
                      this.vx[j] += 8;
                    } else {
                      const d = Math.sqrt(d2);
                      const push = ((ss - d) * repulse) / d;
                      const px = dx * push;
                      const py = dy * push;
                      this.vx[i] -= px;
                      this.vy[i] -= py;
                      this.vx[j] += px;
                      this.vy[j] += py;
                    }
                  }
                }
                j = this.next[j];
              }
            }
          }
        }
      }

      if (soldiers && soldiers.length > 0) {
        for (let sIdx = 0; sIdx < soldiers.length; sIdx++) {
          const s = soldiers[sIdx];
          if (!s.alive) continue;
          const rad = s.radius + hs;
          const rad2 = rad * rad;
          const sx0 = Math.floor((s.x - rad) * invSs);
          const sx1 = Math.floor((s.x + rad) * invSs);
          const sy0 = Math.floor((s.y - rad) * invSs);
          const sy1 = Math.floor((s.y + rad) * invSs);
          const pushSp = Math.max(40, Math.hypot(s.vx, s.vy) * 0.9);
          for (let by = sy0; by <= sy1; by++) {
            for (let bx = sx0; bx <= sx1; bx++) {
              let i = this.head[hashSub(bx, by)];
              while (i !== -1) {
                const dx = this.x[i] - s.x;
                const dy = this.y[i] - s.y;
                const d2 = dx * dx + dy * dy;
                if (d2 < rad2 && d2 > 1e-6) {
                  const invD = pushSp / Math.sqrt(d2);
                  this.vx[i] = dx * invD;
                  this.vy[i] = dy * invD;
                }
                i = this.next[i];
              }
            }
          }
        }
      }
    }

    const airDamp = Math.exp(-SUBPIXEL_PHYSICS.airDrag * dt);
    const wallDamp = Math.exp(-SUBPIXEL_PHYSICS.wallDrag * dt);
    const bounce = SUBPIXEL_PHYSICS.wallBounce;
    const tangFriction = SUBPIXEL_PHYSICS.wallTangentialFriction;
    const settle2 = SUBPIXEL_PHYSICS.settleSpeed * SUBPIXEL_PHYSICS.settleSpeed;
    const wallSettle2 = SUBPIXEL_PHYSICS.wallSettleSpeed * SUBPIXEL_PHYSICS.wallSettleSpeed;
    const maxTime = SUBPIXEL_PHYSICS.maxFlightTime;

    let i = 0;
    while (i < this.count) {
      this.flightTime[i] += dt;
      let cx = this.x[i];
      let cy = this.y[i];
      let vx = this.vx[i];
      let vy = this.vy[i];
      let touchingWall = false;

      // X-axis move & terrain collision
      const nextX = cx + vx * dt;
      if (vx !== 0) {
        const edgeX = nextX + (vx > 0 ? hs : -hs);
        const esx = Math.floor(edgeX * invSs);
        const syTop = Math.floor((cy - hs * 0.7) * invSs);
        const syBot = Math.floor((cy + hs * 0.7) * invSs);
        if (w.subSolidAt(esx, syTop) || w.subSolidAt(esx, syBot)) {
          if (this.isWallAtSub(esx, syTop) || this.isWallAtSub(esx, syBot)) touchingWall = true;
          cx = vx > 0 ? esx * ss - hs - 1e-3 : (esx + 1) * ss + hs + 1e-3;
          vx = -vx * bounce;
          vy *= tangFriction;
        } else {
          cx = nextX;
        }
      }

      // Y-axis move & terrain collision
      const nextY = cy + vy * dt;
      if (vy !== 0) {
        const edgeY = nextY + (vy > 0 ? hs : -hs);
        const esy = Math.floor(edgeY * invSs);
        const sxLeft = Math.floor((cx - hs * 0.7) * invSs);
        const sxRight = Math.floor((cx + hs * 0.7) * invSs);
        if (w.subSolidAt(sxLeft, esy) || w.subSolidAt(sxRight, esy)) {
          if (this.isWallAtSub(sxLeft, esy) || this.isWallAtSub(sxRight, esy)) touchingWall = true;
          cy = vy > 0 ? esy * ss - hs - 1e-3 : (esy + 1) * ss + hs + 1e-3;
          vy = -vy * bounce;
          vx *= tangFriction;
        } else {
          cy = nextY;
        }
      }

      const csx = Math.floor(cx * invSs);
      const csy = Math.floor(cy * invSs);
      if (!touchingWall && this.isAdjacentToWall(csx, csy)) {
        touchingWall = true;
      }

      const damp = touchingWall ? wallDamp : airDamp;
      vx *= damp;
      vy *= damp;

      this.x[i] = cx;
      this.y[i] = cy;
      this.vx[i] = vx;
      this.vy[i] = vy;

      const sp2 = vx * vx + vy * vy;
      const thresh2 = touchingWall ? wallSettle2 : settle2;
      if (sp2 < thresh2 || this.flightTime[i] >= maxTime) {
        this.settleAt(i, csx, csy);
        this.removeAt(i);
        continue;
      }
      i++;
    }
  }

  private isWallAtSub(sx: number, sy: number): boolean {
    const w = this.world;
    if (sx < 0 || sy < 0 || sx >= w.subWidth || sy >= w.subHeight) return true;
    const parent = (sy >> 1) * w.width + (sx >> 1);
    return w.health[parent] > 0 || w.boundary[parent] !== 0;
  }

  private isAdjacentToWall(sx: number, sy: number): boolean {
    return (
      this.isWallAtSub(sx - 1, sy) ||
      this.isWallAtSub(sx + 1, sy) ||
      this.isWallAtSub(sx, sy - 1) ||
      this.isWallAtSub(sx, sy + 1)
    );
  }

  private settleAt(i: number, sx: number, sy: number): void {
    const w = this.world;
    const kind = this.kind[i];
    const tint = this.tint[i];
    const hp = this.hp[i];
    for (let k = 0; k < 5; k++) {
      if (w.placeSub(sx + ORTHO_DX[k], sy + ORTHO_DY[k], kind, tint, hp)) return;
    }
  }

  private removeAt(i: number): void {
    const j = --this.count;
    if (i === j) return;
    this.x[i] = this.x[j];
    this.y[i] = this.y[j];
    this.vx[i] = this.vx[j];
    this.vy[i] = this.vy[j];
    this.flightTime[i] = this.flightTime[j];
    this.hp[i] = this.hp[j];
    this.maxHp[i] = this.maxHp[j];
    this.kind[i] = this.kind[j];
    this.tint[i] = this.tint[j];
  }
}
