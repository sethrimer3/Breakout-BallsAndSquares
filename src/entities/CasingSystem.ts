import { CASING } from "../config";
import type { Rng } from "../core/Rng";
import type { PixelWorld } from "../world/PixelWorld";

/**
 * Struct-of-arrays pool of spinning brass shell casings ejected on every shot.
 * Bounces off terrain walls with restitution damping.
 */
export class CasingSystem {
  readonly cap: number;
  count = 0;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly angle: Float32Array;
  readonly angVel: Float32Array;
  readonly life: Float32Array;
  readonly maxLife: Float32Array;
  /** Time into the flight when the casing does a little visual bounce/skid. */
  readonly bounceAt: Float32Array;

  constructor(cap = CASING.poolSize) {
    this.cap = cap;
    this.x = new Float32Array(cap);
    this.y = new Float32Array(cap);
    this.vx = new Float32Array(cap);
    this.vy = new Float32Array(cap);
    this.angle = new Float32Array(cap);
    this.angVel = new Float32Array(cap);
    this.life = new Float32Array(cap);
    this.maxLife = new Float32Array(cap);
    this.bounceAt = new Float32Array(cap);
  }

  /**
   * Spawn a casing at `(x, y)` perpendicular to firing direction `(dirX, dirY)`.
   * `side` is +1 or -1 (consistent per soldier).
   */
  spawn(x: number, y: number, dirX: number, dirY: number, side: number, rng: Rng): void {
    let i: number;
    if (this.count < this.cap) i = this.count++;
    else i = rng.int(this.cap);

    // Perpendicular direction with +/-22° jitter and a slight backward kick.
    const baseAngle = Math.atan2(dirY, dirX) + side * (Math.PI * 0.58) + rng.range(-0.38, 0.38);
    const sp = rng.range(CASING.minSpeed, CASING.maxSpeed);
    const life = rng.range(CASING.minLife, CASING.maxLife);

    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = Math.cos(baseAngle) * sp;
    this.vy[i] = Math.sin(baseAngle) * sp;
    this.angle[i] = rng.range(0, Math.PI * 2);
    this.angVel[i] = side * rng.range(12, 24);
    this.life[i] = life;
    this.maxLife[i] = life;
    this.bounceAt[i] = life - rng.range(0.18, 0.35);
  }

  update(dt: number, world?: PixelWorld): void {
    const cs = world?.cellSize ?? 8;
    let i = 0;
    while (i < this.count) {
      const prevLife = this.life[i];
      const nextLife = prevLife - dt;
      this.life[i] = nextLife;
      if (nextLife <= 0) {
        this.removeAt(i);
        continue;
      }
      // One-time visual bounce/skid when crossing bounceAt.
      const bAt = this.bounceAt[i];
      if (prevLife > bAt && nextLife <= bAt) {
        this.vx[i] *= 0.45;
        this.vy[i] = -this.vy[i] * 0.35;
        this.angVel[i] *= -0.5;
      }
      const d = Math.exp(-CASING.drag * dt);
      this.vx[i] *= d;
      this.vy[i] = (this.vy[i] + CASING.gravity * dt * 0.35) * d;

      let curX = this.x[i];
      let curY = this.y[i];

      if (world) {
        // Advance X with terrain collision & bounce
        const nextX = curX + this.vx[i] * dt;
        const cellX = Math.floor(nextX / cs);
        const curCellY = Math.floor(curY / cs);
        if (cellX < 0 || cellX >= world.width || world.solidAt(cellX, curCellY) || world.anySolidInCell(cellX, curCellY)) {
          this.vx[i] = -this.vx[i] * 0.55;
          this.angVel[i] *= -0.6;
        } else {
          curX = nextX;
        }

        // Advance Y with terrain collision & bounce
        const nextY = curY + this.vy[i] * dt;
        const curCellX = Math.floor(curX / cs);
        const cellY = Math.floor(nextY / cs);
        if (cellY < 0 || cellY >= world.height || world.solidAt(curCellX, cellY) || world.anySolidInCell(curCellX, cellY)) {
          this.vy[i] = -this.vy[i] * 0.55;
          this.angVel[i] *= -0.6;
        } else {
          curY = nextY;
        }
      } else {
        curX += this.vx[i] * dt;
        curY += this.vy[i] * dt;
      }

      this.x[i] = curX;
      this.y[i] = curY;
      this.angle[i] += this.angVel[i] * dt * d;
      i++;
    }
  }

  private removeAt(i: number): void {
    const j = --this.count;
    if (i === j) return;
    this.x[i] = this.x[j];
    this.y[i] = this.y[j];
    this.vx[i] = this.vx[j];
    this.vy[i] = this.vy[j];
    this.angle[i] = this.angle[j];
    this.angVel[i] = this.angVel[j];
    this.life[i] = this.life[j];
    this.maxLife[i] = this.maxLife[j];
    this.bounceAt[i] = this.bounceAt[j];
  }

  clear(): void {
    this.count = 0;
  }
}
