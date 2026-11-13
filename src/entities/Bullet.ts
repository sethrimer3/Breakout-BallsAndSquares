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
  /** Burrower rocket state. */
  burrowerGroupId = 0;
  burrowerDrilling = false;
  burrowerDrillDist = 0;
  burrowerDrilledCells = 0;
  burrowerMinesPlaced = 0;
  burrowerLastMineDist = -999;
  /** Freeze Rocket flag (cold-only burst, no terrain damage). */
  freezeRocket = false;
  /** Vacuum Pulse pellet flag (for rendering). */
  vacuumPellet = false;
  /** Napalm Garden spray flag (places unlit fuel, no fire ignition). */
  napalmSpray = false;
  /** Cryospray mist flag (cold-only, no fire ignition). */
  cryoSpray = false;
  /** Overcharge Conductor charging round (zero direct damage, stacks per target). */
  overcharge = false;
  /** Snapshot AR discharge power (arDamage + globalDamageBonus) for Overcharge rounds. */
  overchargePower = 1;
}

/** Reset all per-projectile fields on pooled Bullet reuse so no mutation state leaks. */
export function resetBulletFields(b: Bullet): void {
  b.replay = null;
  b.gale = false;
  b.galeCells.clear();
  b.distanceLeft = Infinity;
  b.afterimage = false;
  b.fromDrone = false;
  b.bounces = 0;
  b.momentumBoosted = false;
  b.x = 0;
  b.y = 0;
  b.dx = 0;
  b.dy = 0;
  b.speed = 0;
  b.terrainDamageBonus = 0;
  b.damage = 1;
  b.life = 0;
  b.pierceLeft = 0;
  b.bounceLeft = 0;
  b.bounceRetention = 1;
  b.explosionRadius = 0;
  b.clusterCount = 0;
  b.style = 0;
  b.blightMultiplier = 1;
  b.slashWidth = 0;
  b.slashAngle = 0;
  b.maxLife = 0;
  b.traveled = 0;
  b.totalTraveled = 0;
  b.pendingAdvance = 0;
  b.ownerId = 0;
  b.burrowerGroupId = 0;
  b.burrowerDrilling = false;
  b.burrowerDrillDist = 0;
  b.burrowerDrilledCells = 0;
  b.burrowerMinesPlaced = 0;
  b.burrowerLastMineDist = -999;
  b.freezeRocket = false;
  b.vacuumPellet = false;
  b.napalmSpray = false;
  b.cryoSpray = false;
  b.overcharge = false;
  b.overchargePower = 1;
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
