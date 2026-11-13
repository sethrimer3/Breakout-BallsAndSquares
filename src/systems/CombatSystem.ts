import {
  DRONE, GOO, GALE, REVERSE, ORBIT, VACUUM, BURROWER, FREEZE, RAIL, NAPALM, CRYO,
  ASSAULT_RIFLE, BULLET, FLAMETHROWER, GRENADE, KATANA, ROCKET_LAUNCHER, SNIPER_RIFLE, TURRET,
} from "../config";
import { ReverseRevolver, type ReverseShot } from "./ReverseRevolver";
import { OrbitCylinderSystem } from "./OrbitCylinder";
import { DebrisSystem } from "./DebrisSystem";
import { FreezeSystem } from "./FreezeSystem";
import { BurrowerSystem } from "./BurrowerSystem";
import { RailLanceSystem } from "./RailLanceSystem";
import { NapalmSystem } from "./NapalmSystem";
import { slashMomentum } from "./Momentum";
import { DEG } from "../core/math";
import { gridRaycast, makeRayHit } from "../core/gridRaycast";
import type { Rng } from "../core/Rng";
import { BulletPool, type Bullet } from "../entities/Bullet";
import type { CreatureSystem } from "../entities/Creatures";
import type { Soldier, SoldierStats } from "../entities/Soldier";
import { StickyGrenadePool, type StickyGrenade } from "../entities/StickyGrenade";
import { AutoTurretPool, type AutoTurret } from "../entities/AutoTurret";
import { DroneSystem } from "./DroneSystem";
import { LaserSystem } from "./LaserSystem";
import type { DroneShot } from "../entities/Drone";
import { GooOrbSystem } from "./GooOrbSystem";
import { MAT, type PixelWorld } from "../world/PixelWorld";

export interface CombatEvents {
  /** A soldier fired (once per trigger pull). */
  onShot?(s: Soldier, dirX: number, dirY: number, muzzleX: number, muzzleY: number): void;
  /** A bullet or explosion damaged/destroyed terrain. result: 1 damaged, 2 destroyed, 0 border. `sub`: hit a 50% pink sub-pixel in cell (cx, cy). */
  onImpact?(
    x: number,
    y: number,
    nx: number,
    ny: number,
    cx: number,
    cy: number,
    result: 0 | 1 | 2,
    sub?: boolean,
    ownerId?: number,
  ): void;
  /** A rocket or cluster bomb detonated at (x, y) with radius (world units). */
  onExplosion?(x: number, y: number, radiusWorld: number, damage?: number): void;
  /** A bullet struck a creature. */
  onCreatureHit?(x: number, y: number, nx: number, ny: number): void;
  /** An ordinary round reflected from terrain, after its impact damage. */
  onBulletRicochet?(x: number, y: number, nx: number, ny: number): void;
  onRevolverReturn?(x: number, y: number): void;
  onDroneLaunch?(x: number, y: number): void;
  onDroneShot?(x: number, y: number): void;
  onLaserBounce?(x: number, y: number): void;
  onLaserOverload?(x: number, y: number): void;
  onGooStick?(x: number, y: number, nx: number, ny: number): void;
  onGooRelease?(x: number, y: number): void;
  onGooResidueLost?(x: number, y: number): void;
  onGooLaunchBlocked?(x: number, y: number): void;
  onGooMineBurst?(x: number, y: number, radius: number, damage: number): void;
  /** A sticky grenade was thrown. */
  onGrenadeThrow?(s: Soldier, x: number, y: number, dx: number, dy: number): void;
  /** A sticky grenade stuck to a surface. */
  onGrenadeStick?(x: number, y: number, nx: number, ny: number): void;
  /** A sticky grenade beeped during fuse countdown. */
  onGrenadeBeep?(x: number, y: number, pct: number): void;
  /**
   * A flame jet licked terrain at subcell (sx, sy). Returns true if rubble there
   * is burning, in which case the jet does no damage (see FireSystem).
   */
  onFlameHit?(sx: number, sy: number, x: number, y: number, nx: number, ny: number): boolean;
}

const hit = makeRayHit();

/** Something bullets can hit besides terrain. */
export interface BulletTargets {
  /** Distance along the ray to the nearest target within `maxDist`, or -1. */
  raycast(ox: number, oy: number, dx: number, dy: number, maxDist: number, ignored?: ReadonlySet<object>): number;
  readonly targetKey?: object | null;
  /** Damage the target the last `raycast` found. */
  applyHit(damage: number, x: number, y: number): boolean;
}

export class CombatSystem {
  readonly bullets = new BulletPool(BULLET.poolSize);
  readonly grenades = new StickyGrenadePool(GRENADE.poolSize);
  readonly turrets = new AutoTurretPool(TURRET.poolSize);
  readonly telemetry = { bulletRicochets: 0, bulletBounceHistogram: new Array<number>(9).fill(0), katanaDashes: 0, katanaBoostedSeconds: 0, katanaBoostedDamage: 0 };
  readonly goo: GooOrbSystem;
  readonly drones: DroneSystem;
  readonly laser: LaserSystem;
  readonly revolver: ReverseRevolver;
  readonly orbit: OrbitCylinderSystem;
  readonly debris: DebrisSystem;
  readonly freeze: FreezeSystem;
  readonly burrower: BurrowerSystem;
  readonly rail: RailLanceSystem;
  readonly napalm: NapalmSystem;
  stats: SoldierStats;
  /** Creatures bullets can hit before the terrain (the Blight's flowers, worms, specimens). */
  targets: BulletTargets | null = null;
  creatures: CreatureSystem | null = null;
  /** Current damaging owner ID for authoritative destruction attribution. */
  private currentOwnerId = 0;
  /** The soldier firing right now, whose own tree shapes the shots they spawn. */
  private shooter: Soldier | null = null;

  constructor(
    private world: PixelWorld,
    private rng: Rng,
    stats: SoldierStats,
    private events: CombatEvents = {},
  ) {
    this.stats = stats;
    this.debris = new DebrisSystem(world);
    this.freeze = new FreezeSystem(world);
    this.orbit = new OrbitCylinderSystem();
    this.burrower = new BurrowerSystem();
    this.rail = new RailLanceSystem(world);
    this.napalm = new NapalmSystem(world);

    world.addDestroyListener((cx, cy, isSub, sx, sy) => {
      if (isSub) {
        this.debris.recordSubDestroyed(sx, sy);
        this.freeze.onSubDestroyed(sx, sy, this.currentOwnerId);
      } else {
        this.debris.recordCellDestroyed(cx, cy);
        this.freeze.onCellDestroyed(cx, cy, this.currentOwnerId);
      }
    });

    this.freeze.onShatterHit = (cx, cy, res, isSub, sx, sy, triggerOwnerId) => {
      const cs = this.world.cellSize;
      const ss = this.world.subCellSize;
      const wx = isSub ? (sx + 0.5) * ss : (cx + 0.5) * cs;
      const wy = isSub ? (sy + 0.5) * ss : (cy + 0.5) * cs;
      this.events.onImpact?.(wx, wy, 0, 0, cx, cy, res, isSub, triggerOwnerId);
    };

    this.napalm.onTerrainTick = (cx, cy, res, isSub, sx, sy, ownerId) => {
      const cs = this.world.cellSize;
      const ss = this.world.subCellSize;
      const wx = isSub ? (sx + 0.5) * ss : (cx + 0.5) * cs;
      const wy = isSub ? (sy + 0.5) * ss : (cy + 0.5) * cs;
      this.events.onImpact?.(wx, wy, 0, 0, cx, cy, res, isSub, ownerId);
    };

    this.revolver = new ReverseRevolver((shot,x,y,tx,ty)=>this.replaySegment(shot,x,y,tx,ty), (shot)=>this.events.onRevolverReturn?.(shot.x,shot.y));
    this.drones = new DroneSystem(world, (shot) => this.fireDroneShot(shot), (x,y) => this.events.onDroneLaunch?.(x,y));
    this.laser = new LaserSystem(world, {
      onImpact: (x, y, nx, ny, cx, cy, res, sub, ownerId) => {
        this.napalm.igniteAt(x, y, 4, ownerId ?? 0);
        this.events.onImpact?.(x, y, nx, ny, cx, cy, res, sub, ownerId);
      },
      onBounce: (x,y) => this.events.onLaserBounce?.(x,y),
      onOverload: (x,y) => this.events.onLaserOverload?.(x,y),
      hitCreature: (x,y,dx,dy,distance,damage) => {
        const target = this.targets?.raycast(x,y,dx,dy,distance) ?? -1;
        if (target >= 0) {
          const hx = x + dx * target;
          const hy = y + dy * target;
          this.targets?.applyHit(damage, hx, hy);
          this.napalm.igniteAt(hx, hy, 4, 0);
          this.events.onCreatureHit?.(hx, hy, -dx, -dy);
        }
        return target;
      },
    });
    this.goo = new GooOrbSystem(world, {
      onStick: (orb) => this.events.onGooStick?.(orb.x, orb.y, orb.normalX, orb.normalY),
      onRelease: (orb) => this.events.onGooRelease?.(orb.x, orb.y),
      onResidueLost: (orb) => this.events.onGooResidueLost?.(orb.x, orb.y),
      onMineBurst: (mine) => {
        this.damageBlast(mine, mine.x, mine.y, mine.normalX, mine.normalY, mine.radiusCells);
        this.events.onGooMineBurst?.(mine.x, mine.y, mine.radiusCells * this.world.cellSize, mine.damage);
      },
    });
  }

  resetTelemetry(): void {
    this.telemetry.bulletRicochets = this.telemetry.katanaDashes = this.telemetry.katanaBoostedSeconds = this.telemetry.katanaBoostedDamage = 0;
    this.telemetry.bulletBounceHistogram.fill(0);
  }

  clearAll(): void {
    this.bullets.clear();
    this.grenades.clear();
    this.turrets.clear();
    this.goo.clear();
    this.drones.clear();
    this.laser.clear();
    this.revolver.clear();
    this.orbit.clear();
    this.debris.clear();
    this.freeze.clear();
    this.burrower.clear();
    this.rail.clear();
    this.napalm.clear();
  }

  /** Effective fire rate for a soldier, accounting for active Black Market mutation. */
  effectiveFireRate(s: Soldier): number {
    let rate = this.stats.fireRate;
    switch (s.weapon) {
      case "pistol":
        if (s.mutation === "drone_shepherd" && this.stats.droneUnlocked) {
          rate = 1 / this.stats.droneReleaseInterval;
        }
        break;
      case "shotgun":
        if (s.mutation === "squelch" && this.stats.gooUnlocked) {
          rate = this.stats.gooFireRate;
        } else if (s.mutation === "vacuum_pulse" && this.stats.vacuumUnlocked) {
          rate = this.stats.shotgunFireRate * 0.5;
        } else {
          rate = this.stats.shotgunFireRate;
        }
        break;
      case "assault_rifle":
        rate = this.stats.arFireRate;
        break;
      case "rocket_launcher":
        rate = this.stats.rocketFireRate;
        break;
      case "sniper_rifle":
        if (s.mutation === "chromatic_prism" && this.stats.prismUnlocked) {
          rate = this.stats.prismFireRate;
        } else {
          rate = this.stats.sniperFireRate;
        }
        break;
      case "katana":
        rate = this.stats.katanaFireRate;
        break;
      case "flamethrower":
        rate = this.stats.flameFireRate;
        break;
    }
    return rate * this.stats.globalFireRateMult * s.mods.fireRateMult;
  }

  /** Tick a soldier's weapon according to its equipped weapon type. */
  updateSoldier(s: Soldier, dt: number): void {
    if (s.isManual) return; // Driven by player control in Game.step

    if (s.behavior === "sentry_slow") {
      s.facingAngle += (Math.PI / 3) * dt;
    } else if (s.behavior === "sentry_fast") {
      s.facingAngle += (4 * Math.PI / 3) * dt;
    }

    const rate = this.effectiveFireRate(s);
    const interval = 1 / Math.max(0.05, rate);

    // Rail Lance uses an explicit charge cycle with an aim-lock phase before firing once.
    if (s.weapon === "sniper_rifle" && s.mutation === "rail_lance" && this.stats.railLanceUnlocked) {
      if (!s.railCharging) {
        s.railCharging = true;
        s.railCharge = 0;
        s.railChargeTotal = interval;
      }
      s.railChargeTotal = interval;
      s.railCharge += dt;
      const lockStart = s.railChargeTotal * (1 - RAIL.aimLockFraction);
      if (s.railCharge < lockStart) {
        const vlen = Math.hypot(s.vx, s.vy);
        if (vlen > 1e-6) {
          s.railLockDx = s.vx / vlen;
          s.railLockDy = s.vy / vlen;
          s.facingAngle = Math.atan2(s.railLockDy, s.railLockDx);
        } else {
          s.railLockDx = Math.cos(s.facingAngle);
          s.railLockDy = Math.sin(s.facingAngle);
        }
      }
      if (s.railCharge >= s.railChargeTotal) {
        s.railCharge -= s.railChargeTotal;
        this.fireRailLance(s, s.railLockDx, s.railLockDy);
        if (s.mods.twinChance > 0 && this.rng.next() < s.mods.twinChance) {
          this.fireRailLance(s, s.railLockDx, s.railLockDy);
        }
      }
      return;
    }

    // Vacuum Pulse reserves in-range debris during the intake window before firing.
    if (s.weapon === "shotgun" && s.mutation === "vacuum_pulse" && this.stats.vacuumUnlocked) {
      if (s.fireCooldown <= VACUUM.intakeDuration) {
        this.debris.reserveInRange(s.id, s.x, s.y, VACUUM.range);
      }
    }

    s.fireCooldown -= dt;
    let guard = 0;
    while (s.fireCooldown <= 0 && guard++ < 8) {
      this.fire(s);
      if (s.mods.twinChance > 0 && this.rng.next() < s.mods.twinChance) this.fire(s);
      s.fireCooldown += interval;
    }
  }

  /** Fire along the soldier's current velocity, aim direction, or explicit vector. */
  fire(s: Soldier, overrideDx?: number, overrideDy?: number): void {
    let dx = 0;
    let dy = 0;
    if (overrideDx !== undefined && overrideDy !== undefined) {
      const len = Math.hypot(overrideDx, overrideDy);
      if (len > 1e-6) {
        dx = overrideDx / len;
        dy = overrideDy / len;
      }
    }
    if (dx === 0 && dy === 0) {
      const vlen = Math.hypot(s.vx, s.vy);
      if (vlen > 1e-6) {
        dx = s.vx / vlen;
        dy = s.vy / vlen;
      } else if (Number.isFinite(s.facingAngle)) {
        dx = Math.cos(s.facingAngle);
        dy = Math.sin(s.facingAngle);
      }
    }
    if (dx === 0 && dy === 0) return;
    s.facingAngle = Math.atan2(dy, dx);
    this.shooter = s;

    if (s.weapon === "pistol" && s.mutation === "drone_shepherd" && this.stats.droneUnlocked) {
      this.drones.release(s, this.stats);
      this.shooter = null;
      return;
    } else if (s.weapon === "sniper_rifle" && s.mutation === "chromatic_prism" && this.stats.prismUnlocked) {
      this.laser.traceShot(s, dx, dy, this.stats);
    } else if (s.weapon === "sniper_rifle" && s.mutation === "rail_lance" && this.stats.railLanceUnlocked) {
      this.fireRailLance(s, dx, dy);
    } else if (s.weapon === "shotgun" && s.mutation === "squelch" && this.stats.gooUnlocked) {
      const orb = this.goo.launch({
        // Cast from the center so a muzzle beside a thin wall cannot skip it.
        x: s.x, y: s.y, dx, dy, ownerId: s.id,
        mass: this.stats.gooMass, distance: this.stats.gooDistance,
        speed: GOO.speed * this.stats.globalBulletSpeedMult * s.mods.bulletSpeedMult,
        damage: this.stats.gooDamage + this.stats.globalDamageBonus + s.mods.damageBonus,
        dwell: this.stats.gooDwell, radius: this.stats.gooRadius, residue: this.stats.gooResidue,
        terrainDamageBonus: s.mods.terrainDamageBonus,
        blightMultiplier: s.mods.blightMult,
      });
      if (!orb) {
        this.shooter = null;
        this.events.onGooLaunchBlocked?.(s.x, s.y);
        return;
      }
    } else if (s.weapon === "shotgun" && s.mutation === "vacuum_pulse" && this.stats.vacuumUnlocked) {
      this.debris.reserveInRange(s.id, s.x, s.y, VACUUM.range);
      const consumed = this.debris.consumeFor(s.id);
      const minBasePellets = Math.max(2, Math.floor(this.stats.shotgunPellets * 0.5));
      const rawPellets = (consumed.mass > 0 ? this.stats.shotgunPellets : minBasePellets) + Math.floor(consumed.mass * VACUUM.pelletsPerMass);
      const n = Math.min(VACUUM.maxPellets, Math.max(2, rawPellets));
      const overflowPellets = Math.max(0, rawPellets - VACUUM.maxPellets);
      const dmg = this.stats.shotgunDamage + consumed.mass * VACUUM.damagePerMass + overflowPellets * VACUUM.overflowDamagePerPellet;
      const halfSpreadRad = this.stats.shotgunSpreadDeg * DEG;
      for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;
        const jitter = this.rng.range(-0.18, 0.18) * halfSpreadRad;
        const a = t * halfSpreadRad + jitter;
        const c = Math.cos(a);
        const sn = Math.sin(a);
        const spd = this.stats.shotgunBulletSpeed * this.rng.range(0.92, 1.08);
        const b = this.spawnBullet(
          s.x, s.y, dx * c - dy * sn, dx * sn + dy * c,
          spd, dmg, this.stats.shotgunLifetime, s.radius + BULLET.muzzleGap,
          s.id, 0, 0, 0, 0,
        );
        if (b) {
          b.vacuumPellet = true;
          b.bounceLeft = 0; // Vacuum Pulse does not inherit Shotgun Rebound.
        }
      }
    } else if (s.weapon === "shotgun") {
      const n = Math.max(1, this.stats.shotgunPellets);
      const halfSpreadRad = this.stats.shotgunSpreadDeg * DEG;
      for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;
        const jitter = this.rng.range(-0.18, 0.18) * halfSpreadRad;
        const a = t * halfSpreadRad + jitter;
        const c = Math.cos(a);
        const sn = Math.sin(a);
        const spd = this.stats.shotgunBulletSpeed * this.rng.range(0.92, 1.08);
        this.spawnBullet(
          s.x,
          s.y,
          dx * c - dy * sn,
          dx * sn + dy * c,
          spd,
          this.stats.shotgunDamage,
          this.stats.shotgunLifetime,
          s.radius + BULLET.muzzleGap,
          s.id,
          0,
          0,
          0,
          0,
        );
      }
    } else if (s.weapon === "assault_rifle") {
      const halfSpreadRad = this.stats.arSpreadDeg * DEG;
      const a = this.rng.range(-halfSpreadRad, halfSpreadRad);
      const c = Math.cos(a);
      const sn = Math.sin(a);
      this.spawnBullet(
        s.x,
        s.y,
        dx * c - dy * sn,
        dx * sn + dy * c,
        this.stats.arBulletSpeed,
        this.stats.arDamage,
        ASSAULT_RIFLE.lifetime,
        s.radius + BULLET.muzzleGap,
        s.id,
        this.stats.arPierce,
        0,
        0,
        0,
      );
    } else if (s.weapon === "rocket_launcher") {
      const isBurrower = s.mutation === "burrower" && this.stats.burrowerUnlocked;
      const isFreeze = s.mutation === "freeze_rockets" && this.stats.freezeRocketsUnlocked;
      const b = this.spawnBullet(
        s.x,
        s.y,
        dx,
        dy,
        this.stats.rocketBulletSpeed,
        isFreeze ? 0 : this.stats.rocketDamage,
        ROCKET_LAUNCHER.lifetime,
        s.radius + BULLET.muzzleGap,
        s.id,
        0,
        this.stats.rocketBlastRadius,
        isBurrower || isFreeze ? 0 : this.stats.rocketClusterCount,
        1,
      );
      if (b) {
        if (isBurrower) {
          b.burrowerGroupId = this.burrower.allocateGroupId();
          b.clusterCount = Math.min(BURROWER.maxMineCount, BURROWER.mineCount + this.stats.rocketClusterCount);
        } else if (isFreeze) {
          b.freezeRocket = true;
          b.damage = 0;
        }
      }
    } else if (s.weapon === "sniper_rifle") {
      const isCrit = this.stats.sniperCritChance > 0 && this.rng.next() < this.stats.sniperCritChance;
      const dmg = isCrit ? this.stats.sniperDamage * 2 : this.stats.sniperDamage;
      this.spawnBullet(
        s.x,
        s.y,
        dx,
        dy,
        this.stats.sniperBulletSpeed,
        dmg,
        SNIPER_RIFLE.lifetime,
        s.radius + BULLET.muzzleGap,
        s.id,
        this.stats.sniperPierce,
        0,
        0,
        2,
      );
    } else if (s.weapon === "katana") {
      const gale=s.mutation === "gale_edge" && this.stats.galeUnlocked;
      if(gale && this.bullets.items.filter(b=>b.active&&b.gale).length>=GALE.poolCap){this.shooter=null;return;}
      s.slashIndex = ((s.slashIndex ?? 0) + 1) % 2;
      const tilt = (s.slashIndex === 0 ? -1 : 1) * 0.38;

      this.spawnSlash(
        s.x,
        s.y,
        dx,
        dy,
        this.stats.katanaBulletSpeed,
        this.stats.katanaDamage,
        gale ? this.stats.galeDistance / (this.stats.katanaBulletSpeed * this.stats.globalBulletSpeedMult * s.mods.bulletSpeedMult) + 0.1 : KATANA.lifetime,
        s.radius + BULLET.muzzleGap,
        s.id,
        gale ? GALE.pierce + this.stats.katanaPierce - KATANA.pierce : this.stats.katanaPierce,
        this.stats.katanaBlightMultiplier,
        gale ? Math.max(GALE.width,this.stats.katanaSlashWidth) : this.stats.katanaSlashWidth,
        tilt,
      );

      // Multishot: fire a cross-slash in the opposite direction!
      if (this.stats.multishotChance > 0 && this.rng.next() < this.stats.multishotChance) {
        this.spawnSlash(
          s.x,
          s.y,
          dx,
          dy,
          this.stats.katanaBulletSpeed,
          this.stats.katanaDamage,
          gale ? this.stats.galeDistance / (this.stats.katanaBulletSpeed * this.stats.globalBulletSpeedMult * s.mods.bulletSpeedMult) + 0.1 : KATANA.lifetime,
          s.radius + BULLET.muzzleGap,
          s.id,
          gale ? GALE.pierce + this.stats.katanaPierce - KATANA.pierce : this.stats.katanaPierce,
          this.stats.katanaBlightMultiplier,
          gale ? Math.max(GALE.width,this.stats.katanaSlashWidth) : this.stats.katanaSlashWidth,
          -tilt,
        );
      }
    } else if (s.weapon === "flamethrower") {
      const isNapalm = s.mutation === "napalm_garden" && this.stats.napalmUnlocked;
      const isCryo = s.mutation === "cryospray" && this.stats.cryosprayUnlocked;
      const spread = isCryo ? CRYO.spreadDeg : isNapalm ? NAPALM.spreadDeg : FLAMETHROWER.spreadDeg;
      const halfSpreadRad = spread * DEG;
      const a = this.rng.range(-halfSpreadRad, halfSpreadRad);
      const c = Math.cos(a);
      const sn = Math.sin(a);
      const spd = (isCryo ? CRYO.speed : isNapalm ? NAPALM.spraySpeed : FLAMETHROWER.bulletSpeed) * this.rng.range(0.85, 1.15);
      const life = (isCryo ? CRYO.lifetime : isNapalm ? NAPALM.sprayLifetime : this.stats.flameLifetime) * this.rng.range(0.85, 1.1);
      const b = this.spawnBullet(
        s.x,
        s.y,
        dx * c - dy * sn,
        dx * sn + dy * c,
        spd,
        isCryo ? 0 : this.stats.flameDamage,
        life,
        s.radius + BULLET.muzzleGap,
        s.id,
        0,
        0,
        0,
        4,
      );
      if (b) {
        if (isNapalm) {
          b.napalmSpray = true;
        } else if (isCryo) {
          b.cryoSpray = true;
          b.damage = 0;
        }
      }
    } else if (s.weapon === "pistol" && s.mutation === "orbit_cylinder" && this.stats.orbitUnlocked) {
      const dmg = this.stats.damage + this.stats.globalDamageBonus + s.mods.damageBonus;
      const spd = this.stats.bulletSpeed * this.stats.globalBulletSpeedMult * s.mods.bulletSpeedMult;
      const bounces = s.mods.pierce > 0 ? 0 : this.stats.pistolBounces;
      this.orbit.loadRound(s, dmg, spd, bounces, s.mods.terrainDamageBonus, s.mods.blightMult, s.mods.pierce);
      if (this.stats.multishotChance > 0 && this.rng.next() < this.stats.multishotChance) {
        this.orbit.loadRound(s, dmg, spd, bounces, s.mods.terrainDamageBonus, s.mods.blightMult, s.mods.pierce);
      }
    } else {
      // Pistol
      this.spawnBullet(
        s.x,
        s.y,
        dx,
        dy,
        this.stats.bulletSpeed,
        this.stats.damage,
        BULLET.lifetime,
        s.radius + BULLET.muzzleGap,
        s.id,
        0,
        0,
        0,
        0,
      );
      if (this.stats.multishotChance > 0 && this.rng.next() < this.stats.multishotChance) {
        const pairs = Math.max(1, Math.floor(BULLET.multishotExtra / 2));
        for (let p = 1; p <= pairs; p++) {
          const a = BULLET.multishotSpreadDeg * DEG * p;
          for (const sign of [-1, 1]) {
            const c = Math.cos(a * sign);
            const sn = Math.sin(a * sign);
            this.spawnBullet(
              s.x,
              s.y,
              dx * c - dy * sn,
              dx * sn + dy * c,
              this.stats.bulletSpeed,
              this.stats.damage,
              BULLET.lifetime,
              s.radius + BULLET.muzzleGap,
              s.id,
              0,
              0,
              0,
              0,
            );
          }
        }
      }
    }
    this.shooter = null;
    const off = s.radius + BULLET.muzzleGap;
    this.events.onShot?.(s, dx, dy, s.x + dx * off, s.y + dy * off);
  }

  private spawnBullet(
    x: number,
    y: number,
    dx: number,
    dy: number,
    speed: number,
    damage: number,
    life: number,
    pendingAdvance: number,
    ownerId: number,
    pierceLeft: number,
    explosionRadius: number,
    clusterCount: number,
    style: 0 | 1 | 2 | 3 | 4,
  ): Bullet | null {
    const b = this.bullets.acquire();
    if (!b) return null;
    b.x = x;
    b.y = y;
    b.dx = dx;
    b.dy = dy;
    const mods = this.shooter?.mods;
    b.speed = speed * this.stats.globalBulletSpeedMult * (mods?.bulletSpeedMult ?? 1);
    b.terrainDamageBonus = mods?.terrainDamageBonus ?? 0;
    b.damage = damage + this.stats.globalDamageBonus + (mods?.damageBonus ?? 0);
    b.life = life;
    b.maxLife = life;
    b.traveled = 0;
    b.totalTraveled = 0;
    b.pendingAdvance = pendingAdvance;
    b.ownerId = ownerId;
    b.pierceLeft = pierceLeft + (explosionRadius > 0 ? 0 : (mods?.pierce ?? 0));
    // Snapshot eligibility at launch: spending a piercing budget must never
    // turn the same round into ricochet ammunition later in its flight.
    const weapon = this.shooter?.weapon;
    b.bounceLeft = style === 0 && explosionRadius === 0 && b.pierceLeft === 0
      ? weapon === "pistol" ? this.stats.pistolBounces : weapon === "shotgun" ? this.stats.shotgunBounces : 0
      : 0;
    b.bounceRetention = weapon === "shotgun" ? 0.7 : 1;
    b.explosionRadius = explosionRadius;
    b.clusterCount = clusterCount;
    b.style = style;
    b.blightMultiplier = mods?.blightMult ?? 1;
    b.slashWidth = 0;
    b.slashAngle = 0;
    b.afterimage = false;
    b.fromDrone = false;
    b.bounces = 0;
    b.momentumBoosted = false;
    b.gale = false; b.galeCells.clear(); b.distanceLeft = Infinity; b.replay = null;
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
    if (weapon === "pistol" && this.shooter?.mutation === "reverse_revolver" && this.stats.reverseUnlocked) {
      b.replay=this.revolver.begin(x,y,b.speed,b.damage,b.terrainDamageBonus,b.blightMultiplier,ownerId);
      if(!b.replay){this.bullets.release(b);return null;}
      b.replay.coreDamageBonus=this.stats.coreDamageBonus;
    }
    if (style === 0) this.telemetry.bulletBounceHistogram[0]++;
    return b;
  }

  private spawnSlash(
    x: number,
    y: number,
    dx: number,
    dy: number,
    speed: number,
    damage: number,
    life: number,
    pendingAdvance: number,
    ownerId: number,
    pierceLeft: number,
    blightMultiplier: number,
    slashWidth: number,
    slashAngle: number,
  ): void {
    if(this.shooter?.mutation === "gale_edge" && this.bullets.items.filter(b=>b.active&&b.gale).length>=GALE.poolCap)return;
    const b = this.bullets.acquire();
    if (!b) return;
    b.x = x;
    b.y = y;
    b.dx = dx;
    b.dy = dy;
    const mods = this.shooter?.mods;
    b.speed = speed * this.stats.globalBulletSpeedMult * (mods?.bulletSpeedMult ?? 1);
    b.terrainDamageBonus = mods?.terrainDamageBonus ?? 0;
    b.damage = damage + this.stats.globalDamageBonus + (mods?.damageBonus ?? 0);
    b.life = life;
    b.maxLife = life;
    b.traveled = 0;
    b.totalTraveled = 0;
    b.bounceLeft = 0;
    b.bounceRetention = 1;
    b.pendingAdvance = pendingAdvance;
    b.ownerId = ownerId;
    b.pierceLeft = pierceLeft + (mods?.pierce ?? 0);
    b.explosionRadius = 0;
    b.clusterCount = 0;
    b.style = 3;
    b.blightMultiplier = blightMultiplier * (mods?.blightMult ?? 1);
    const boost = this.shooter ? slashMomentum(this.shooter, this.stats) : { damage: 1, width: 1 };
    b.damage = Math.max(1, Math.round(b.damage * boost.damage));
    b.slashWidth = slashWidth * boost.width;
    b.fromDrone = false;
    b.bounces = 0;
    b.momentumBoosted = boost.damage > 1;
    b.afterimage = this.shooter?.dashAfterimage ?? false;
    if (this.shooter) this.shooter.dashAfterimage = false;
    b.slashAngle = slashAngle;
    b.replay=null; b.gale=this.shooter?.mutation === "gale_edge" && this.stats.galeUnlocked;
    b.galeCells.clear();
    b.distanceLeft=b.gale?this.stats.galeDistance:Infinity;
  }

  private fireRailLance(s: Soldier, dx: number, dy: number): void {
    const isCrit = this.stats.sniperCritChance > 0 && this.rng.next() < this.stats.sniperCritChance;
    const baseDmg = this.stats.sniperDamage + this.stats.globalDamageBonus + s.mods.damageBonus;
    const dmg = isCrit ? baseDmg * 2 : baseDmg;
    const pierce = this.stats.sniperPierce + RAIL.bonusPierce + s.mods.pierce;
    const prevOwner = this.currentOwnerId;
    this.currentOwnerId = s.id;
    try {
      this.rail.fireStrike(
        s,
        s.x,
        s.y,
        dx,
        dy,
        dmg,
        pierce,
        isCrit,
        this.targets,
        (cx, cy, res, sub, hx, hy, nx, ny, ownerId) => {
          if (res > 0) this.napalm.igniteAt(hx, hy, 4, ownerId);
          this.events.onImpact?.(hx, hy, nx, ny, cx, cy, res, sub, ownerId);
        },
        (hx, hy, nx, ny) => {
          this.napalm.igniteAt(hx, hy, 4, s.id);
          this.events.onCreatureHit?.(hx, hy, nx, ny);
        },
      );
    } finally {
      this.currentOwnerId = prevOwner;
    }
  }

  /** Called by PhysicsSystem on a real reflected-wall collision (not sliding/rescue/sentry). */
  onSoldierBounce(s: Soldier, nx: number, ny: number): void {
    if (s.weapon === "pistol" && s.mutation === "orbit_cylinder" && this.stats.orbitUnlocked) {
      this.orbit.releaseOnBounce(s, nx, ny, (x, y, dx, dy, speed, damage, life, ownerId, bounces, terrainDamageBonus, blightMultiplier, pierce) => {
        const b = this.bullets.acquire();
        if (!b) return false;
        b.x = x; b.y = y; b.dx = dx; b.dy = dy;
        b.speed = speed; b.damage = damage; b.life = life; b.maxLife = life;
        b.traveled = 0; b.totalTraveled = 0; b.pendingAdvance = 0;
        b.ownerId = ownerId; b.pierceLeft = pierce;
        b.bounceLeft = pierce === 0 ? bounces : 0;
        b.bounceRetention = 1; b.explosionRadius = 0; b.clusterCount = 0; b.style = 0;
        b.terrainDamageBonus = terrainDamageBonus; b.blightMultiplier = blightMultiplier;
        b.slashWidth = 0; b.slashAngle = 0; b.afterimage = false; b.fromDrone = false;
        b.bounces = 0; b.momentumBoosted = false;
        b.gale = false; b.galeCells.clear(); b.distanceLeft = Infinity; b.replay = null;
        b.burrowerGroupId = 0; b.burrowerDrilling = false; b.burrowerDrillDist = 0;
        b.burrowerDrilledCells = 0; b.burrowerMinesPlaced = 0; b.burrowerLastMineDist = -999;
        b.freezeRocket = false; b.vacuumPellet = false; b.napalmSpray = false; b.cryoSpray = false;
        this.telemetry.bulletBounceHistogram[0]++;
        return true;
      });
    }
  }

  /** Release Orbit Cylinder rounds manually (e.g. when manual commander stops firing). */
  releaseOrbitManual(s: Soldier): number {
    if (s.weapon !== "pistol" || s.mutation !== "orbit_cylinder" || !this.stats.orbitUnlocked) return 0;
    return this.orbit.releaseManual(s, (x, y, dx, dy, speed, damage, life, ownerId, bounces, terrainDamageBonus, blightMultiplier, pierce) => {
      const b = this.bullets.acquire();
      if (!b) return false;
      b.x = x; b.y = y; b.dx = dx; b.dy = dy;
      b.speed = speed; b.damage = damage; b.life = life; b.maxLife = life;
      b.traveled = 0; b.totalTraveled = 0; b.pendingAdvance = 0;
      b.ownerId = ownerId; b.pierceLeft = pierce;
      b.bounceLeft = pierce === 0 ? bounces : 0;
      b.bounceRetention = 1; b.explosionRadius = 0; b.clusterCount = 0; b.style = 0;
      b.terrainDamageBonus = terrainDamageBonus; b.blightMultiplier = blightMultiplier;
      b.slashWidth = 0; b.slashAngle = 0; b.afterimage = false; b.fromDrone = false;
      b.bounces = 0; b.momentumBoosted = false;
      b.gale = false; b.galeCells.clear(); b.distanceLeft = Infinity; b.replay = null;
      b.burrowerGroupId = 0; b.burrowerDrilling = false; b.burrowerDrillDist = 0;
      b.burrowerDrilledCells = 0; b.burrowerMinesPlaced = 0; b.burrowerLastMineDist = -999;
      b.freezeRocket = false; b.vacuumPellet = false; b.napalmSpray = false; b.cryoSpray = false;
      this.telemetry.bulletBounceHistogram[0]++;
      return true;
    });
  }

  updateBullets(dt: number): void {
    this.revolver.update(dt);
    this.freeze.update(dt);
    this.rail.update(dt);
    this.napalm.update(dt, this.creatures);
    const items = this.bullets.items;
    for (let i = 0; i < items.length; i++) {
      const b = items[i];
      if (b.active) this.updateBullet(b, dt);
    }
  }

  private findCreatureNear(x: number, y: number, maxR = 14) {
    if (!this.creatures) return null;
    const r2 = maxR * maxR;
    for (const f of this.creatures.flowers) {
      if (f.hp > 0 && (f.hx - x) ** 2 + (f.hy - y) ** 2 <= r2) return f;
    }
    for (const w of this.creatures.worms) {
      if (w.hp > 0 && (w.seg[0] - x) ** 2 + (w.seg[1] - y) ** 2 <= r2) return w;
    }
    for (const s of this.creatures.specimens) {
      if (s.free && s.hp > 0 && (s.x - x) ** 2 + (s.y - y) ** 2 <= r2) return s;
    }
    return null;
  }

  /** Swept bullet update: supports pierce, ordinary ricochets and detonation. */
  updateBullet(b: Bullet, dt: number): void {
    b.life -= dt;
    if (b.life <= 0) {
      if (b.napalmSpray) {
        this.napalm.placeGroundPatch(b.ownerId, b.x, b.y, b.damage, b.terrainDamageBonus, b.blightMultiplier);
      } else if (b.explosionRadius > 0) {
        this.detonateRocket(b, b.x, b.y, -b.dx, -b.dy, Math.floor(b.x / this.world.cellSize), Math.floor(b.y / this.world.cellSize));
      }
      this.finishBullet(b);
      return;
    }

    let remDist = Math.min(b.distanceLeft, b.speed * dt + b.pendingAdvance);
    if(remDist<=1e-6){this.finishBullet(b);return;}
    b.pendingAdvance = 0;
    const w = this.world;
    const cs = w.cellSize;
    const ss = w.subCellSize;
    let curX = b.x;
    let curY = b.y;
    let guard = 0;

    while (remDist > 1e-4 && guard++ < 8) {
      // Fine-grid traversal: sees normal cells and 50% pink sub-pixels alike.
      const terrainHit = gridRaycast(w.subSolidQuery, ss, curX, curY, b.dx, b.dy, remDist, hit);
      // Creatures in front of the terrain hit take the shot instead.
      if (this.targets) {
        const ct = this.targets.raycast(curX, curY, b.dx, b.dy, terrainHit ? hit.t : remDist);
        if (ct >= 0) {
          const ix = curX + b.dx * ct;
          const iy = curY + b.dy * ct;
          if(!this.recordSegment(b,curX,curY,ix,iy))return;
          if (b.napalmSpray) {
            const c = this.findCreatureNear(ix, iy, 16);
            if (c) this.napalm.placeCreaturePatch(b.ownerId, c, ix, iy, b.damage, b.terrainDamageBonus, b.blightMultiplier);
            else this.napalm.placeGroundPatch(b.ownerId, ix, iy, b.damage, b.terrainDamageBonus, b.blightMultiplier);
          } else if (b.cryoSpray) {
            const c = this.findCreatureNear(ix, iy, 16);
            if (c) this.freeze.freezeCreature(c);
          } else if (b.explosionRadius > 0) {
            this.detonateRocket(b, ix, iy, -b.dx, -b.dy, Math.floor(ix / cs), Math.floor(iy / cs));
          } else {
            this.targets.applyHit(b.damage, ix, iy);
            this.napalm.igniteAt(ix, iy, 4, b.ownerId);
            if (b.fromDrone) this.drones.usefulHits++;
            this.events.onCreatureHit?.(ix, iy, -b.dx, -b.dy);
          }
          this.finishBullet(b);
          return;
        }
      }
      if (b.gale) {
        const length = terrainHit ? hit.t : remDist;
        // Sweep the full crescent width, even when the center passes through air.
        // Sampling is at half-cell spacing and every cell can take damage once.
        for (let d = 0; d <= length; d += ss / 2) {
          this.cleaveSlashSides(b, Math.floor((curX+b.dx*d)/ss), Math.floor((curY+b.dy*d)/ss), -b.dx, -b.dy);
        }
      }
      if (terrainHit) {
        if(!this.recordSegment(b,curX,curY,hit.x,hit.y))return;
        const hcx = hit.cx >> 1;
        const hcy = hit.cy >> 1;

        // Napalm Garden spray: place unlit fuel on terrain without damaging or igniting.
        if (b.napalmSpray) {
          if (w.inBounds(hcx, hcy)) {
            const isSub = w.health[hcy * w.width + hcx] === 0;
            if (isSub) this.napalm.placeSubPatch(b.ownerId, hit.cx, hit.cy, hit.x, hit.y, b.damage, b.terrainDamageBonus, b.blightMultiplier);
            else this.napalm.placeCellPatch(b.ownerId, hcx, hcy, hit.x, hit.y, b.damage, b.terrainDamageBonus, b.blightMultiplier);
          }
          this.finishBullet(b);
          return;
        }

        // Cryospray mist: freeze terrain without dealing damage or igniting fuel/fire.
        if (b.cryoSpray) {
          if (w.inBounds(hcx, hcy)) {
            if (w.health[hcy * w.width + hcx] === 0) this.freeze.freezeSubCell(hit.cx, hit.cy, b.ownerId);
            else this.freeze.freezeCell(hcx, hcy, b.ownerId);
          }
          this.finishBullet(b);
          return;
        }

        // Burrower rocket: drill through terrain, drop mines along drilled path, detonate all together.
        if (b.burrowerGroupId > 0) {
          const insideB = w.inBounds(hcx, hcy);
          const cellIdxB = hcy * w.width + hcx;
          if (!insideB) {
            this.detonateRocket(b, hit.x, hit.y, hit.nx, hit.ny, hcx, hcy);
            this.finishBullet(b);
            return;
          }
          if (w.mat[cellIdxB] === MAT.door) {
            const door = w.doors[w.doorId[cellIdxB] - 1];
            if (door && !door.open) {
              this.currentOwnerId = b.ownerId;
              w.damage(hcx, hcy, b.damage, true);
              this.currentOwnerId = 0;
              if (!door.open) {
                this.detonateRocket(b, hit.x, hit.y, hit.nx, hit.ny, hcx, hcy);
                this.finishBullet(b);
                return;
              }
            }
          }
          b.burrowerDrilling = true;
          const isSubB = w.health[cellIdxB] === 0;
          const drillDmg = Math.max(1, Math.round(b.damage * BURROWER.drillDamageRatio + b.terrainDamageBonus));
          this.currentOwnerId = b.ownerId;
          const drillRes = w.damageSub(hit.cx, hit.cy, drillDmg, true);
          this.currentOwnerId = 0;
          this.events.onImpact?.(hit.x, hit.y, hit.nx, hit.ny, hcx, hcy, drillRes, isSubB, b.ownerId);
          b.burrowerDrilledCells++;

          if (b.burrowerMinesPlaced < b.clusterCount && (b.burrowerMinesPlaced === 0 || b.burrowerDrillDist - b.burrowerLastMineDist >= BURROWER.mineSpacing)) {
            this.burrower.placeMine(
              b.burrowerGroupId, b.ownerId, hit.x, hit.y,
              b.damage, b.explosionRadius, b.terrainDamageBonus, b.blightMultiplier, b.burrowerMinesPlaced,
            );
            b.burrowerMinesPlaced++;
            b.burrowerLastMineDist = b.burrowerDrillDist;
          }

          const stepPast = isSubB ? ss * 1.05 : cs * 1.05;
          b.burrowerDrillDist += hit.t + stepPast;
          remDist -= Math.min(remDist, hit.t + stepPast);
          curX = hit.x + b.dx * stepPast;
          curY = hit.y + b.dy * stepPast;

          if (b.burrowerDrilledCells >= BURROWER.maxDrillCells || b.burrowerDrillDist >= BURROWER.maxDrillDist || !w.inBounds(Math.floor(curX / cs), Math.floor(curY / cs))) {
            this.detonateRocket(b, curX, curY, hit.nx, hit.ny, Math.floor(curX / cs), Math.floor(curY / cs));
            this.finishBullet(b);
            return;
          }
          continue;
        }

        // Rocket / explosive projectile detonates on impact!
        if (b.explosionRadius > 0) {
          this.detonateRocket(b, hit.x, hit.y, hit.nx, hit.ny, hcx, hcy);
          this.finishBullet(b);
          return;
        }

        const inside = w.inBounds(hcx, hcy);
        const cellIdx = hcy * w.width + hcx;
        const isSub = inside && w.health[cellIdx] === 0;
        // Flames don't chip fresh or burning rubble: they set it alight and splash
        // out. Burnt-out (charred) rubble takes the hit like any other block.
        const flameOnRubble = b.style === 4 && isSub && w.isRubbleSub(hit.cy * w.subWidth + hit.cx);
        if (flameOnRubble && this.events.onFlameHit?.(hit.cx, hit.cy, hit.x, hit.y, hit.nx, hit.ny)) {
          this.finishBullet(b);
          return;
        }
        const isCore = inside && !isSub && w.coreId[cellIdx] > 0;
        const isBlight = isSub ? w.isBlightSubAt(hit.cx, hit.cy) : w.isBlightAt(hcx, hcy);
        let hitDmg = b.damage + b.terrainDamageBonus + (isCore ? this.stats.coreDamageBonus : 0);
        if (isBlight && b.blightMultiplier > 1) {
          hitDmg = Math.round(hitDmg * b.blightMultiplier);
        }
        // Terrain stores integer health. Round retained pellet damage explicitly
        // instead of allowing typed-array truncation to round damage upward.
        if (b.bounceRetention < 1) hitDmg = Math.max(1, Math.round(hitDmg));
        const beforeHp = isSub ? w.subHealth[hit.cy * w.subWidth + hit.cx] : inside ? w.health[cellIdx] : 0;
        const galeKey = isSub ? w.width*w.height+hit.cy*w.subWidth+hit.cx : cellIdx;
        const alreadyHit = b.gale && b.galeCells.has(galeKey);
        if(b.gale)b.galeCells.add(galeKey);
        this.currentOwnerId = b.ownerId;
        const result = alreadyHit ? 1 : w.damageSub(hit.cx, hit.cy, hitDmg, true);
        this.currentOwnerId = 0;
        if (result > 0) this.napalm.igniteAt(hit.x, hit.y, 4, b.ownerId);
        const afterHp = isSub ? w.subHealth[hit.cy * w.subWidth + hit.cx] : inside ? w.health[cellIdx] : 0;
        if (b.momentumBoosted) this.telemetry.katanaBoostedDamage += Math.max(0, beforeHp - afterHp);
        if (b.fromDrone && result > 0) this.drones.usefulHits++;
        this.events.onImpact?.(hit.x, hit.y, hit.nx, hit.ny, hcx, hcy, result, isSub, b.ownerId);
        if (b.style === 4 && !flameOnRubble) this.events.onFlameHit?.(hit.cx, hit.cy, hit.x, hit.y, hit.nx, hit.ny);

        // Katana slashes cleave adjacent subcells across the slash arc width!
        if (b.style === 3 && b.slashWidth > 0) {
          this.cleaveSlashSides(b, hit.cx, hit.cy, hit.nx, hit.ny);
        }

        // Reflect ordinary rounds only. Normal offsets clear the face even at
        // t=0; the per-update guard bounds corner/embedded-shot processing.
        // Reflect even when this impact destroys the surface: its normal was
        // captured before damage changed the world.
        if (b.style === 0 && b.pierceLeft <= 0 && b.bounceLeft > 0) {
          const dot = b.dx * hit.nx + b.dy * hit.ny;
          b.dx -= 2 * dot * hit.nx;
          b.dy -= 2 * dot * hit.ny;
          b.bounceLeft--;
          this.telemetry.bulletRicochets++;
          this.telemetry.bulletBounceHistogram[Math.min(8,b.bounces)]--;
          b.bounces++;
          this.telemetry.bulletBounceHistogram[Math.min(8,b.bounces)]++;
          b.damage *= b.bounceRetention;
          b.terrainDamageBonus *= b.bounceRetention;
          b.totalTraveled += hit.t;
          b.traveled = 0;
          remDist -= hit.t;
          curX = hit.x + hit.nx * 1e-3;
          curY = hit.y + hit.ny * 1e-3;
          this.events.onBulletRicochet?.(hit.x, hit.y, hit.nx, hit.ny);
          continue;
        }

        // An unopened world gate remains authoritative for a flying crescent.
        const door = inside ? w.doors[w.doorId[cellIdx]-1] : undefined;
        if(b.gale && door?.gate && !door.open){this.finishBullet(b);return;}

        // Piercing and other ammunition still stop at the world border.
        if (result === 0 || b.pierceLeft <= 0) {
          this.finishBullet(b);
          return;
        }

        // Pierce! Step past the impacted cell and continue along the ray.
        b.pierceLeft--;
        const S = isSub ? ss : cs;
        const targetX = isSub ? hit.cx : hcx;
        const targetY = isSub ? hit.cy : hcy;

        let distToExit = hit.t + S * 1.05;
        if (Math.abs(b.dx) > 1e-6) {
          const exitX = (b.dx > 0 ? targetX + 1 : targetX) * S;
          const tx = (exitX - curX) / b.dx;
          if (tx > hit.t) distToExit = Math.min(distToExit, tx + 0.5);
        }
        if (Math.abs(b.dy) > 1e-6) {
          const exitY = (b.dy > 0 ? targetY + 1 : targetY) * S;
          const ty = (exitY - curY) / b.dy;
          if (ty > hit.t) distToExit = Math.min(distToExit, ty + 0.5);
        }

        const stepPast = b.gale ? Math.min(remDist, Math.max(0.5,distToExit)) : Math.max(0.5,distToExit);
        if(!this.recordSegment(b,hit.x,hit.y,curX+b.dx*stepPast,curY+b.dy*stepPast))return;
        b.distanceLeft=Math.max(0,b.distanceLeft-stepPast);
        b.traveled += stepPast;
        b.totalTraveled += stepPast;
        remDist -= stepPast;
        curX += b.dx * stepPast;
        curY += b.dy * stepPast;
        if (!this.world.inBounds(Math.floor(curX / cs), Math.floor(curY / cs))) {
          this.finishBullet(b);
          return;
        }
        continue;
      }

      // No hit along the remaining segment.
      if(!this.recordSegment(b,curX,curY,hit.x,hit.y))return;
      b.distanceLeft=Math.max(0,b.distanceLeft-remDist);
      curX = hit.x;
      curY = hit.y;
      b.traveled += remDist;
      b.totalTraveled += remDist;
      break;
    }

    b.x = curX;
    b.y = curY;
    if(b.distanceLeft<=1e-6)this.finishBullet(b);
  }

  private finishBullet(b: Bullet): void {
    if(b.replay){this.revolver.finish(b.replay);b.replay=null;}
    this.bullets.release(b);
  }

  private recordSegment(b: Bullet, x: number, y: number, tx: number, ty: number): boolean {
    if(!b.replay)return true;
    if(this.revolver.record(b.replay,x,y)&&this.revolver.record(b.replay,tx,ty))return true;
    // Stop at the last recorded vertex rather than replaying an invented shortcut.
    b.x=b.replay.points[(b.replay.count-1)*2];b.y=b.replay.points[(b.replay.count-1)*2+1];
    this.finishBullet(b);return false;
  }

  private replaySegment(shot: ReverseShot, x: number, y: number, tx: number, ty: number): void {
    const length=Math.hypot(tx-x,ty-y);if(length<1e-8)return;
    const dx=(tx-x)/length;const dy=(ty-y)/length;const w=this.world;
    // Target identities prevent repeated damage when a replay remains inside a creature.
    for(let guard=0;this.targets&&guard<16&&shot.hits<REVERSE.maxHits;guard++){
      const t=this.targets.raycast(x,y,dx,dy,length,shot.targets);if(t<0)break;
      const key=this.targets.targetKey??this.targets;
      if(shot.targets.has(key))break;
      shot.targets.add(key);shot.hits++;
      this.targets.applyHit(shot.damage,x+dx*t,y+dy*t);
      this.events.onCreatureHit?.(x+dx*t,y+dy*t,-dx,-dy);
    }
    let remaining=length;let ox=x;let oy=y;
    for(let guard=0;guard<32&&remaining>1e-6&&shot.hits<REVERSE.maxHits;guard++){
      if(!gridRaycast(w.subSolidQuery,w.subCellSize,ox,oy,dx,dy,remaining,hit))break;
      if(!w.subInBounds(hit.cx,hit.cy))break;
      const cx=hit.cx>>1;const cy=hit.cy>>1;const index=cy*w.width+cx;const sub=w.health[index]===0;
      const key=sub?w.width*w.height+hit.cy*w.subWidth+hit.cx:index;
      if(!shot.cells.has(index)&&!shot.cells.has(key)){
        shot.cells.add(key);shot.hits++;
        let damage=shot.damage+shot.terrainDamageBonus+(w.coreId[index]>0?shot.coreDamageBonus:0);
        if(sub?w.isBlightSubAt(hit.cx,hit.cy):w.isBlightAt(cx,cy))damage=Math.round(damage*shot.blightMultiplier);
        const result=w.damageSub(hit.cx,hit.cy,damage,true);
        this.events.onImpact?.(hit.x,hit.y,hit.nx,hit.ny,cx,cy,result,sub,shot.ownerId);
      }
      const size=sub?w.subCellSize:w.cellSize;const gx=sub?hit.cx:cx;const gy=sub?hit.cy:cy;
      const ex=Math.abs(dx)>1e-9?(((dx>0?gx+1:gx)*size)-ox)/dx:Infinity;
      const ey=Math.abs(dy)>1e-9?(((dy>0?gy+1:gy)*size)-oy)/dy:Infinity;
      const advance=Math.min(remaining,Math.max(hit.t+1e-3,Math.min(ex,ey)+1e-3));
      ox+=dx*advance;oy+=dy*advance;remaining-=advance;
    }
  }

  /** Cleave adjacent cells across the katana slash arc width. */
  private cleaveSlashSides(
    b: Bullet,
    hitSubX: number,
    hitSubY: number,
    nx: number,
    ny: number,
  ): void {
    const w = this.world;
    const ss = w.subCellSize;
    // Perpendicular vector to projectile direction: (-dy, dx)
    const px = -b.dy;
    const py = b.dx;
    const maxSteps = Math.min(b.gale ? 12 : 4, Math.max(1, Math.floor(b.slashWidth / (ss * 2))));
    const centerNormIdx = (hitSubY >> 1) * w.width + (hitSubX >> 1);
    let cleavedNormIdx = -1;

    for (let step = 1; step <= maxSteps; step++) {
      for (const sign of [-1, 1]) {
        const sx = hitSubX + Math.round(px * step * sign);
        const sy = hitSubY + Math.round(py * step * sign);
        if (!w.subInBounds(sx, sy)) continue;
        if (!w.subSolidAt(sx, sy)) continue;

        const hcx = sx >> 1;
        const hcy = sy >> 1;
        const inside = w.inBounds(hcx, hcy);
        if (!inside) continue;
        const cellIdx = hcy * w.width + hcx;

        // If this is a normal solid cell, don't re-damage the center cell or a cell already cleaved this strike
        const isSub = w.health[cellIdx] === 0;
        if (!isSub) {
          if (cellIdx === centerNormIdx || cellIdx === cleavedNormIdx) continue;
          cleavedNormIdx = cellIdx;
        }

        if(b.gale){
          const key=isSub?w.width*w.height+sy*w.subWidth+sx:cellIdx;
          if(b.galeCells.has(key)||b.galeCells.size>=64)continue;
          b.galeCells.add(key);
        }
        const isCore = !isSub && w.coreId[cellIdx] > 0;
        const isBlight = isSub ? w.isBlightSubAt(sx, sy) : w.isBlightAt(hcx, hcy);

        let dmg = b.damage + b.terrainDamageBonus + (isCore ? this.stats.coreDamageBonus : 0);
        if (isBlight && b.blightMultiplier > 1) {
          dmg = Math.round(dmg * b.blightMultiplier);
        }
        const res = w.damageSub(sx, sy, dmg, true);
        if (res > 0) {
          const wx = (sx + 0.5) * ss;
          const wy = (sy + 0.5) * ss;
          this.events.onImpact?.(wx, wy, nx, ny, hcx, hcy, res, isSub, b.ownerId);
        }
      }
    }
  }

  /** Shared terrain damage/owner pipeline for rockets and independent goo mines. */
  private damageBlast(
    source: Pick<Bullet, "damage" | "terrainDamageBonus" | "blightMultiplier" | "ownerId">,
    ix: number, iy: number, nx: number, ny: number, radCells: number,
  ): void {
    const w = this.world;
    const cs = w.cellSize;
    const centerCx = Math.floor(ix / cs);
    const centerCy = Math.floor(iy / cs);
    const rCeil = Math.ceil(radCells);
    const r2 = radCells * radCells;

    for (let dy = -rCeil; dy <= rCeil; dy++) {
      const cy = centerCy + dy;
      if (cy < 0 || cy >= w.height) continue;
      for (let dx = -rCeil; dx <= rCeil; dx++) {
        const cx = centerCx + dx;
        if (cx < 0 || cx >= w.width) continue;
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        // Full damage near epicenter, tapering slightly at outer blast edge.
        const falloff = 1 - 0.35 * (Math.sqrt(d2) / Math.max(1, radCells));
        const idx = cy * w.width + cx;
        const wasSub = w.health[idx] === 0;
        const isCore = !wasSub && w.coreId[idx] > 0;
        let dmg = Math.max(1, Math.round((source.damage + source.terrainDamageBonus) * falloff)) + (isCore ? this.stats.coreDamageBonus : 0);
        if (source.blightMultiplier > 1 && w.isBlightAt(cx, cy)) dmg = Math.round(dmg * source.blightMultiplier);
        const res = w.damage(cx, cy, dmg, true);
        if (res > 0) {
          const wx = (cx + 0.5) * cs;
          const wy = (cy + 0.5) * cs;
          this.events.onImpact?.(wx, wy, nx, ny, cx, cy, res, wasSub, source.ownerId);
        }
      }
    }

  }

  private detonateRocket(
    b: Bullet,
    ix: number,
    iy: number,
    nx: number,
    ny: number,
    centerCx: number,
    centerCy: number,
  ): void {
    const cs = this.world.cellSize;
    const radCells = b.explosionRadius;

    if (b.freezeRocket) {
      const allCreatures = this.creatures
        ? [...this.creatures.flowers, ...this.creatures.worms, ...this.creatures.specimens]
        : undefined;
      this.freeze.freezeArea(ix, iy, radCells * cs, b.ownerId, allCreatures);
      this.events.onExplosion?.(ix, iy, radCells * cs, 0);
      return;
    }

    if (b.burrowerGroupId > 0) {
      const charges = this.burrower.detonateGroup(
        b.burrowerGroupId,
        ix,
        iy,
        b.damage,
        radCells,
        b.ownerId,
        b.terrainDamageBonus,
        b.blightMultiplier,
      );
      this.currentOwnerId = b.ownerId;
      for (const ch of charges) {
        const chCx = Math.floor(ch.x / cs);
        const chCy = Math.floor(ch.y / cs);
        this.damageBlast(ch, (chCx + 0.5) * cs, (chCy + 0.5) * cs, nx, ny, ch.radiusCells);
        this.napalm.igniteAt(ch.x, ch.y, ch.radiusCells * cs, ch.ownerId);
        this.events.onExplosion?.(ch.x, ch.y, ch.radiusCells * cs, ch.damage);
      }
      this.currentOwnerId = 0;
      return;
    }

    this.currentOwnerId = b.ownerId;
    this.damageBlast(b, (centerCx + 0.5) * cs, (centerCy + 0.5) * cs, nx, ny, radCells);
    this.currentOwnerId = 0;
    this.napalm.igniteAt(ix, iy, radCells * cs, b.ownerId);

    this.events.onExplosion?.(ix, iy, radCells * cs, b.damage);

    // Spawn secondary cluster mini-bombs if upgraded.
    if (b.clusterCount > 0) {
      const baseAng = Math.atan2(ny || -b.dy, nx || -b.dx);
      for (let i = 0; i < b.clusterCount; i++) {
        const a = baseAng + this.rng.range(-1.2, 1.2);
        const spd = this.rng.range(110, 195);
        this.spawnBullet(
          ix + (nx || 0) * 2,
          iy + (ny || 0) * 2,
          Math.cos(a),
          Math.sin(a),
          spd,
          Math.max(1, Math.ceil(b.damage * 0.5)),
          this.rng.range(0.18, 0.32),
          0,
          b.ownerId,
          0,
          Math.max(1.4, radCells * 0.55),
          0,
          1,
        );
      }
    }
  }

  /** Throw an equippable secondary sticky grenade from a soldier. */
  throwGrenade(
    s: Soldier,
    blastRadius: number,
    damage: number,
    shrapnelCount: number,
    blightMult: number,
    overrideDx?: number,
    overrideDy?: number,
  ): StickyGrenade | null {
    let dx = 0;
    let dy = 0;
    if (overrideDx !== undefined && overrideDy !== undefined) {
      const len = Math.hypot(overrideDx, overrideDy);
      if (len > 1e-6) {
        dx = overrideDx / len;
        dy = overrideDy / len;
      }
    }
    if (dx === 0 && dy === 0) {
      const vlen = Math.hypot(s.vx, s.vy);
      if (vlen > 1e-6) {
        dx = s.vx / vlen;
        dy = s.vy / vlen;
      } else if (Number.isFinite(s.facingAngle)) {
        dx = Math.cos(s.facingAngle);
        dy = Math.sin(s.facingAngle);
      } else {
        dx = 0;
        dy = 1;
      }
    }

    const g = this.grenades.acquire();
    if (!g) return null;
    g.x = s.x + dx * 6;
    g.y = s.y + dy * 6;
    g.dx = dx;
    g.dy = dy;
    g.speed = GRENADE.throwSpeed;
    g.stuck = false;
    g.stuckCx = 0;
    g.stuckCy = 0;
    g.stuckNx = 0;
    g.stuckNy = 0;
    g.fuse = GRENADE.fuseSeconds;
    g.maxFuse = GRENADE.fuseSeconds;
    g.radiusCells = blastRadius;
    g.terrainDamageBonus = s.mods.terrainDamageBonus;
    g.damage = damage + this.stats.globalDamageBonus + s.mods.damageBonus;
    g.shrapnelCount = shrapnelCount;
    g.blightMultiplier = blightMult;
    g.ownerId = s.id;
    g.age = 0;
    g.beepTimer = 0.25;
    g.rotation = Math.atan2(dy, dx);
    this.events.onGrenadeThrow?.(s, g.x, g.y, dx, dy);
    return g;
  }

  /** Update all active flying and stuck grenades. */
  updateGrenades(dt: number): void {
    const items = this.grenades.items;
    const w = this.world;
    const cs = w.cellSize;
    const ss = w.subCellSize;

    for (let i = 0; i < items.length; i++) {
      const g = items[i];
      if (!g.active) continue;

      g.age += dt;

      if (!g.stuck) {
        g.rotation += 10 * dt;
        const dist = g.speed * dt;
        if (gridRaycast(w.subSolidQuery, ss, g.x, g.y, g.dx, g.dy, dist, hit)) {
          g.stuck = true;
          g.x = hit.x;
          g.y = hit.y;
          g.stuckNx = hit.nx;
          g.stuckNy = hit.ny;
          g.stuckCx = hit.cx >> 1;
          g.stuckCy = hit.cy >> 1;
          g.fuse = g.maxFuse;
          g.beepTimer = 0.2;
          this.events.onGrenadeStick?.(g.x, g.y, g.stuckNx, g.stuckNy);
        } else {
          g.x += g.dx * dist;
          g.y += g.dy * dist;
          if (g.age > 2.5 || !w.inBounds(Math.floor(g.x / cs), Math.floor(g.y / cs))) {
            this.detonateGrenade(g);
          }
        }
      } else {
        g.fuse -= dt;
        g.beepTimer -= dt;
        if (g.beepTimer <= 0) {
          g.beepTimer = Math.max(0.08, g.fuse * 0.35);
          this.events.onGrenadeBeep?.(g.x, g.y, Math.max(0, g.fuse / g.maxFuse));
        }

        const inside = w.inBounds(g.stuckCx, g.stuckCy);
        const cellIdx = g.stuckCy * w.width + g.stuckCx;
        if (inside && w.health[cellIdx] === 0 && w.subHealth[cellIdx] === 0) {
          this.detonateGrenade(g);
        } else if (g.fuse <= 0) {
          this.detonateGrenade(g);
        }
      }
    }
  }

  /** Detonate a sticky grenade, creating explosive damage and secondary shrapnel. */
  detonateGrenade(g: StickyGrenade): void {
    const w = this.world;
    const cs = w.cellSize;
    const centerCx = Math.floor(g.x / cs);
    const centerCy = Math.floor(g.y / cs);
    const radCells = g.radiusCells;
    const rCeil = Math.ceil(radCells);
    const r2 = radCells * radCells;

    for (let dy = -rCeil; dy <= rCeil; dy++) {
      const cy = centerCy + dy;
      if (cy < 0 || cy >= w.height) continue;
      for (let dx = -rCeil; dx <= rCeil; dx++) {
        const cx = centerCx + dx;
        if (cx < 0 || cx >= w.width) continue;
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;

        const falloff = 1 - 0.3 * (Math.sqrt(d2) / Math.max(1, radCells));
        const idx = cy * w.width + cx;
        const wasSub = w.health[idx] === 0;
        const isCore = !wasSub && w.coreId[idx] > 0;
        const isBlight = wasSub ? w.isBlightSubAt(cx * 2, cy * 2) : w.isBlightAt(cx, cy);

        let dmg = Math.max(1, Math.round((g.damage + g.terrainDamageBonus) * falloff)) + (isCore ? this.stats.coreDamageBonus : 0);
        if (isBlight && g.blightMultiplier > 1) {
          dmg = Math.round(dmg * g.blightMultiplier);
        }

        const res = w.damage(cx, cy, dmg, true);
        if (res > 0) {
          const wx = (cx + 0.5) * cs;
          const wy = (cy + 0.5) * cs;
          this.events.onImpact?.(wx, wy, g.stuckNx || 0, g.stuckNy || -1, cx, cy, res, wasSub, g.ownerId);
        }
      }
    }

    this.napalm.igniteAt(g.x, g.y, radCells * cs, g.ownerId);
    this.events.onExplosion?.(g.x, g.y, radCells * cs, g.damage);

    // Expel shrapnel fragments if upgraded
    if (g.shrapnelCount > 0) {
      const baseAng = Math.atan2(g.stuckNy || -g.dy, g.stuckNx || -g.dx);
      for (let i = 0; i < g.shrapnelCount; i++) {
        const a = baseAng + this.rng.range(-1.4, 1.4);
        const spd = this.rng.range(130, 220);
        this.spawnBullet(
          g.x + (g.stuckNx || 0) * 2,
          g.y + (g.stuckNy || 0) * 2,
          Math.cos(a),
          Math.sin(a),
          spd,
          Math.max(1, Math.ceil(g.damage * 0.4)),
          this.rng.range(0.25, 0.45),
          0,
          g.ownerId,
          0,
          0,
          0,
          0,
        );
      }
    }

    this.grenades.release(g);
  }

  /** Update active autoturrets: track target block, swivel toward target, fire. */
  updateTurrets(dt: number): void {
    this.turrets.update(dt, this.world, this);
  }

  /** Deploy temporary autoturrets around a soldier. */
  deployTurrets(
    s: Soldier,
    count: number,
    damage: number,
    fireRate: number,
    turnSpeed: number,
  ): AutoTurret[] {
    const deployed: AutoTurret[] = [];
    const cs = this.world.cellSize;
    const facing = s.facingAngle ?? (Math.atan2(s.vy, s.vx) || 0);

    for (let i = 0; i < count; i++) {
      let offsetAngle = 0;
      const dist = 14;
      if (count === 1) {
        offsetAngle = facing + Math.PI;
      } else if (count === 2) {
        // Left and right flanks
        offsetAngle = facing + (i === 0 ? Math.PI * 0.5 : -Math.PI * 0.5);
      } else {
        // Uniform circular distribution
        offsetAngle = facing + (i / count) * Math.PI * 2;
      }

      let tx = s.x + Math.cos(offsetAngle) * dist;
      let ty = s.y + Math.sin(offsetAngle) * dist;

      // Avoid spawning inside solid wall
      const cx = Math.floor(tx / cs);
      const cy = Math.floor(ty / cs);
      if (
        cx >= 0 &&
        cx < this.world.width &&
        cy >= 0 &&
        cy < this.world.height &&
        this.world.health[cy * this.world.width + cx] > 0
      ) {
        tx = s.x + Math.cos(offsetAngle) * 4;
        ty = s.y + Math.sin(offsetAngle) * 4;
      }

      const turret = this.turrets.spawn(
        tx,
        ty,
        offsetAngle,
        TURRET.lifetime,
        damage,
        fireRate,
        turnSpeed,
        s.id,
      );
      if (turret) deployed.push(turret);
    }
    return deployed;
  }

  /** Narrow actor-shot interface: no fake Soldier and no inherited ricochet policy. */
  fireDroneShot(shot: DroneShot): void {
    const bullet = this.spawnBullet(shot.x, shot.y, shot.dx, shot.dy, DRONE.bulletSpeed,
      shot.damage, 1.1, 0, shot.ownerId, shot.pierce, 0, 0, 0);
    if (!bullet) return;
    bullet.terrainDamageBonus = shot.terrainDamageBonus;
    bullet.blightMultiplier = shot.blightMultiplier;
    bullet.fromDrone = true;
    this.events.onDroneShot?.(shot.x, shot.y);
  }

  /** Fires a bullet from an autoturret barrel at the tracked block. */
  fireTurretShot(
    ownerId: number,
    x: number,
    y: number,
    dx: number,
    dy: number,
    damage: number,
  ): void {
    this.spawnBullet(
      x,
      y,
      dx,
      dy,
      TURRET.bulletSpeed,
      damage,
      1.2,
      0,
      ownerId,
      0,
      0,
      0,
      0,
    );
    this.events.onShot?.({ id: ownerId, x, y, ejectSide: 1 } as unknown as Soldier, dx, dy, x, y);
  }
}
