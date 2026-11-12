import { GOO } from "../config";
import { gridRaycast, makeRayHit } from "../core/gridRaycast";
import { GooOrb, GooPool } from "../entities/GooOrb";
import { GooMine } from "../entities/GooMine";
import type { PixelWorld } from "../world/PixelWorld";

export interface GooLaunch {
  x: number;
  y: number;
  dx: number;
  dy: number;
  ownerId: number;
  mass: number;
  distance: number;
  speed: number;
  damage: number;
  terrainDamageBonus: number;
  blightMultiplier: number;
  dwell?: number;
  radius?: number;
  residue?: boolean;
}

export interface GooEvents {
  onStick?(orb: GooOrb): void;
  onRelease?(orb: GooOrb): void;
  onResidueLost?(orb: GooOrb): void;
  /** Apply damage through the combat system, preserving normal impact attribution. */
  onMineBurst(mine: GooMine): void;
}

export class GooOrbSystem {
  readonly orbs = new GooPool(GOO.orbPoolSize, () => new GooOrb());
  readonly mines = new GooPool(GOO.minePoolSize, () => new GooMine());
  private readonly hit = makeRayHit();
  contacts = 0;
  deposits = 0;
  bursts = 0;
  readonly bounceHistogram = new Array<number>(33).fill(0);
  droppedOrbs = 0;
  droppedMines = 0;

  constructor(private world: PixelWorld, private events: GooEvents) {}

  launch(shot: GooLaunch): GooOrb | null {
    const length = Math.hypot(shot.dx, shot.dy);
    if (!Number.isFinite(length) || length < 1e-6 ||
      !Number.isFinite(shot.x) || !Number.isFinite(shot.y) ||
      !Number.isFinite(shot.mass) || shot.mass <= GOO.minMass ||
      !Number.isFinite(shot.distance) || shot.distance <= 0 ||
      !Number.isFinite(shot.speed) || shot.speed <= 0) return null;
    const orb = this.orbs.acquire();
    if (!orb) {
      this.droppedOrbs++;
      return null;
    }
    // Reset every runtime field on acquisition, including fields from stuck orbs.
    orb.body.reset();
    orb.x = shot.x;
    orb.y = shot.y;
    orb.dx = shot.dx / length;
    orb.dy = shot.dy / length;
    orb.speed = shot.speed;
    orb.state = "flying";
    orb.stateTimer = 0;
    orb.normalX = 0;
    orb.normalY = 0;
    orb.distanceRemaining = shot.distance;
    orb.startingMass = shot.mass;
    orb.mass = shot.mass;
    orb.age = 0;
    orb.contacts = 0;
    this.bounceHistogram[0]++;
    orb.ownerId = shot.ownerId;
    orb.damage = shot.damage;
    orb.dwell = Math.max(0.08, shot.dwell ?? GOO.dwell);
    orb.mineRadius = shot.radius ?? GOO.mineRadiusCells;
    orb.residue = shot.residue ?? false;
    orb.terrainDamageBonus = shot.terrainDamageBonus;
    orb.blightMultiplier = shot.blightMultiplier;
    return orb;
  }

  clear(): void {
    this.orbs.clear();
    this.mines.clear();
    this.droppedOrbs = this.droppedMines = this.contacts = this.deposits = this.bursts = 0;
    this.bounceHistogram.fill(0);
  }

  update(dt: number): void {
    for (const orb of this.orbs.items) {
      if (!orb.active) continue;
      orb.age += dt;
      if (orb.age >= GOO.safetySeconds || !this.inWorld(orb.x, orb.y)) {
        this.orbs.release(orb);
        continue;
      }
      let remaining = dt;
      let contacts = 0;
      while (orb.active && remaining > 1e-9 && contacts < GOO.maxContactsPerStep) {
        if (orb.state === "stuck") {
          // Split at the visual peel boundary without adding simulation dwell.
          const peeling = orb.stateTimer <= GOO.peelSeconds + 1e-9;
          const wait = Math.min(remaining, peeling ? orb.stateTimer : orb.stateTimer - GOO.peelSeconds);
          orb.body.advance(wait, peeling ? "peeling" : "clinging");
          orb.stateTimer -= wait;
          remaining -= wait;
          if (orb.stateTimer > 1e-9) continue;
          orb.state = "flying";
          orb.body.release();
          this.events.onRelease?.(orb);
          continue;
        }
        const distance = Math.min(orb.speed * remaining, orb.distanceRemaining);
        if (distance <= 1e-9) {
          this.orbs.release(orb);
          break;
        }
        const hit = this.hit;
        const collided = gridRaycast(this.world.subSolidQuery, this.world.subCellSize,
          orb.x, orb.y, orb.dx, orb.dy, distance, hit);
        const traveled = collided ? hit.t : distance;
        orb.distanceRemaining = Math.max(0, orb.distanceRemaining - traveled);
        remaining -= traveled / orb.speed;
        orb.body.advance(traveled / orb.speed, "flight");
        orb.x = hit.x;
        orb.y = hit.y;
        if (!collided) {
          if (orb.distanceRemaining <= 1e-9 || !this.inWorld(orb.x, orb.y)) this.orbs.release(orb);
          break;
        }
        contacts++;
        this.contacts++;
        this.bounceHistogram[Math.min(32,orb.contacts)]--;
        orb.contacts++;
        this.bounceHistogram[Math.min(32,orb.contacts)]++;
        // Reflect from the captured surface; the supporting terrain may vanish
        // during the dwell, but the saved trajectory and mine remain valid.
        const dot = orb.dx * hit.nx + orb.dy * hit.ny;
        orb.dx -= 2 * dot * hit.nx;
        orb.dy -= 2 * dot * hit.ny;
        orb.normalX = hit.nx;
        orb.normalY = hit.ny;
        orb.x += hit.nx * 1e-3;
        orb.y += hit.ny * 1e-3;
        const shed = Math.min(GOO.massPerMine, orb.mass - GOO.minMass);
        const mine = this.mines.acquire();
        if (mine) {
          this.deposits++;
          mine.x = orb.x;
          mine.y = orb.y;
          mine.normalX = hit.nx;
          mine.normalY = hit.ny;
          mine.maxFuse = GOO.mineFuse;
          // Mines update after orbs. Add time before birth so this frame only
          // charges the fuse for time since the actual collision.
          mine.fuse = GOO.mineFuse + dt - remaining;
          mine.mass = shed;
          mine.radiusCells = orb.mineRadius;
          mine.residue = orb.residue;
          mine.damage = orb.damage * (shed / GOO.massPerMine);
          mine.terrainDamageBonus = orb.terrainDamageBonus * (shed / GOO.massPerMine);
          mine.blightMultiplier = orb.blightMultiplier;
          mine.ownerId = orb.ownerId;
        }
        if (!mine) {
          this.droppedMines++;
          this.events.onResidueLost?.(orb);
        }
        orb.body.impact(hit.nx, hit.ny);
        // At capacity the fragment dissipates; never retain mass for free bounces.
        orb.mass -= shed;
        orb.state = "stuck";
        orb.stateTimer = orb.dwell;
        this.events.onStick?.(orb);
        if (orb.mass <= GOO.minMass + 1e-9 || orb.distanceRemaining <= 1e-9) this.orbs.release(orb);
      }
    }
    let detonations = 0;
    for (const mine of this.mines.items) {
      if (!mine.active) continue;
      mine.fuse -= dt;
      if (mine.fuse > 1e-9 || detonations >= GOO.maxDetonationsPerStep) continue;
      // Release after the synchronous damage callback so owner/state stay intact.
      if (mine.residue) {
        const range = mine.radiusCells * this.world.cellSize * 2;
        for (const other of this.mines.items) {
          if (other !== mine && other.active && other.fuse > 0.04 && Math.hypot(other.x - mine.x, other.y - mine.y) <= range) {
            other.fuse = Math.max(0.04, other.fuse - 0.12);
          }
        }
      }
      this.bursts++;
      this.events.onMineBurst(mine);
      this.mines.release(mine);
      detonations++;
    }
  }

  private inWorld(x: number, y: number): boolean {
    return Number.isFinite(x) && Number.isFinite(y) &&
      this.world.inBounds(Math.floor(x / this.world.cellSize), Math.floor(y / this.world.cellSize));
  }
}
