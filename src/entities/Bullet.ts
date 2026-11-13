import type { ReverseShot } from "../systems/ReverseRevolver";

export class Bullet {
  active = false;
  replay: ReverseShot | null = null;
  gale = false;
  readonly galeCells = new Set<number>();
  distanceLeft = Infinity;
  afterimage = false;
  fromDrone = false;
  bounces = 0;
  momentumBoosted = false;
  x = 0;
  y = 0;
  /** Normalized direction. */
  dx = 0;
  dy = 0;
  speed = 0;
  terrainDamageBonus = 0;
  damage = 1;
  life = 0;
  /** Number of additional solid blocks this projectile can penetrate before expiring. */
  pierceLeft = 0;
  /** Ordinary ammunition only; piercing shots never receive a bounce budget. */
  bounceLeft = 0;
  bounceRetention = 1;
  /** Explosion radius in cells (> 0 for rockets / cluster bombs). */
  explosionRadius = 0;
  /** Number of secondary cluster mini-bombs spawned upon detonation. */
  clusterCount = 0;
  /** Visual style: 0 = standard round, 1 = rocket, 2 = sniper hyper-velocity tracer, 3 = katana slash, 4 = flame jet. */
  style: 0 | 1 | 2 | 3 | 4 = 0;
  /** Damage multiplier against blight blocks (blight cores, pink sub-blight, grown blight). */
  blightMultiplier = 1;
  /** Slash arc width in world units (for katana slashes). */
  slashWidth = 0;
  /** Arc tilt/curvature angle (for katana slashes). */
  slashAngle = 0;
  /** Initial max lifetime for alpha/animation scaling. */
  maxLife = 0;
  /** Distance since launch or last reflection, used to clamp the straight tracer. */
  traveled = 0;
  /** Actual flight distance across all reflected segments. */
  totalTraveled = 0;
  /**
   * Distance still to "advance" from the soldier's center to the muzzle on the
   * first cast. The first cast starts at the soldier center (always clear) so a
   * wall between the center and muzzle is always detected.
   */
  pendingAdvance = 0;
  ownerId = 0;
}

/** Fixed-size object pool for bullets. */
export class BulletPool {
  readonly items: Bullet[];
  activeCount = 0;

  constructor(size: number) {
    this.items = new Array(size);
    for (let i = 0; i < size; i++) this.items[i] = new Bullet();
  }

  acquire(): Bullet | null {
    const items = this.items;
    for (let i = 0; i < items.length; i++) {
      if (!items[i].active) {
        items[i].active = true;
        this.activeCount++;
        return items[i];
      }
    }
    return null;
  }

  release(b: Bullet): void {
    if (b.active) {
      b.active = false;
      this.activeCount--;
    }
  }

  clear(): void {
    for (const b of this.items) b.active = false;
    this.activeCount = 0;
  }
}
