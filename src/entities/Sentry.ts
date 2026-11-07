import { FACILITY } from "../config";
import { hasLineOfSight } from "../systems/PhysicsSystem";
import type { PixelWorld, SentrySpot } from "../world/PixelWorld";
import type { Soldier } from "./Soldier";

/** Fires one sentry round. */
export type SentryFire = (x: number, y: number, dx: number, dy: number, damage: number) => void;

/** How often an awake sentry looks for a new target (seconds). */
const RETARGET_SECONDS = 0.25;

/**
 * A research-base defense turret. Dormant until the squad buys the Sentry
 * Uplink, then it wakes the first time a soldier steps into its room and
 * shoots the nearest Blight it can see. It never targets the facility itself.
 */
export class Sentry {
  awake = false;
  angle: number;
  hasTarget = false;
  private targetX = 0;
  private targetY = 0;
  private cooldown = 0;
  private retarget = 0;
  /** Seconds since waking, for the boot flicker. */
  wakeAge = 0;

  constructor(readonly spot: SentrySpot) {
    this.angle = Math.PI / 2;
  }

  get x(): number {
    return this.spot.x;
  }

  get y(): number {
    return this.spot.y;
  }

  /** True once a living soldier is inside this sentry's room. */
  soldierInRoom(world: PixelWorld, soldiers: readonly Soldier[]): boolean {
    const cs = world.cellSize;
    const s = this.spot;
    for (const so of soldiers) {
      if (!so.alive) continue;
      const cx = Math.floor(so.x / cs);
      const cy = Math.floor(so.y / cs);
      if (cx >= s.rx0 - 1 && cx <= s.rx1 + 1 && cy >= s.ry0 - 1 && cy <= s.ry1 + 1) return true;
    }
    return false;
  }

  update(dt: number, world: PixelWorld, damage: number, fireRate: number, fire: SentryFire): void {
    if (!this.awake) return;
    this.wakeAge += dt;
    this.cooldown -= dt;
    this.retarget -= dt;
    if (this.retarget <= 0) {
      this.retarget = RETARGET_SECONDS;
      this.acquire(world);
    }
    if (!this.hasTarget) {
      // Idle sweep so an awake sentry reads as alive.
      this.angle += dt * 0.6;
      return;
    }
    const want = Math.atan2(this.targetY - this.y, this.targetX - this.x);
    const diff = Math.atan2(Math.sin(want - this.angle), Math.cos(want - this.angle));
    const step = FACILITY.sentryTurnSpeed * dt;
    this.angle = Math.abs(diff) <= step ? want : this.angle + Math.sign(diff) * step;
    if (Math.abs(diff) < 0.2 && this.cooldown <= 0) {
      this.cooldown = 1 / fireRate;
      const dx = Math.cos(this.angle);
      const dy = Math.sin(this.angle);
      fire(this.x + dx * 5, this.y + dy * 5, dx, dy, damage);
    }
  }

  /** Nearest Blight in range with a clear line of fire (sub-pixel resolution). */
  private acquire(world: PixelWorld): void {
    const ss = world.subCellSize;
    const R = FACILITY.sentryRangeCells * 2;
    const sx0 = Math.floor(this.x / ss);
    const sy0 = Math.floor(this.y / ss);
    let best = Infinity;
    let bx = 0;
    let by = 0;
    // Expanding rings: the first ring with a visible target wins.
    for (let r = 1; r <= R && best === Infinity; r++) {
      for (let dy = -r; dy <= r; dy++) {
        const edge = dy === -r || dy === r;
        for (let dx = -r; dx <= r; dx += edge ? 1 : 2 * r) {
          const sx = sx0 + dx;
          const sy = sy0 + dy;
          if (!world.isBlightSubAt(sx, sy)) continue;
          const d2 = dx * dx + dy * dy;
          if (d2 >= best) continue;
          const wx = (sx + 0.5) * ss;
          const wy = (sy + 0.5) * ss;
          if (!hasLineOfSight(world, this.x, this.y, wx, wy)) continue;
          best = d2;
          bx = wx;
          by = wy;
        }
      }
    }
    this.hasTarget = best !== Infinity;
    if (this.hasTarget) {
      this.targetX = bx;
      this.targetY = by;
    }
  }
}

/** Every sentry in the facility. */
export class SentrySystem {
  sentries: Sentry[] = [];
  /** Sentry Uplink bought: dormant sentries wake when a soldier walks in. */
  enabled = false;
  damage: number = FACILITY.sentryDamage;
  fireRate: number = FACILITY.sentryFireRate;

  constructor(
    private world: PixelWorld,
    private onWake: (s: Sentry) => void = () => {},
  ) {}

  /** Rebuild from the world's generated sentry spots (all dormant). */
  reset(): void {
    this.sentries = this.world.sentrySpots.map((spot) => new Sentry(spot));
  }

  update(dt: number, soldiers: readonly Soldier[], fire: SentryFire): void {
    for (const s of this.sentries) {
      if (!s.awake) {
        if (this.enabled && s.soldierInRoom(this.world, soldiers)) {
          s.awake = true;
          this.onWake(s);
        }
        continue;
      }
      s.update(dt, this.world, this.damage, this.fireRate, fire);
    }
  }
}
