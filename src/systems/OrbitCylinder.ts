import { BULLET, ORBIT } from "../config";
import type { Soldier, Wingman } from "../entities/Soldier";

export interface OrbitRound {
  active: boolean;
  ownerId: number;
  owner: Soldier | null;
  wing?: Wingman;
  angle: number;
  x: number;
  y: number;
  damage: number;
  speed: number;
  bounces: number;
  terrainDamageBonus: number;
  blightMultiplier: number;
  pierce: number;
}

export type SpawnOrbitBulletFn = (
  x: number,
  y: number,
  dx: number,
  dy: number,
  speed: number,
  damage: number,
  life: number,
  ownerId: number,
  bounces: number,
  terrainDamageBonus: number,
  blightMultiplier: number,
  pierce: number,
) => boolean;

/**
 * Orbit Cylinder (Pistol branch 2):
 * Fired rounds accumulate around the soldier and sling outward together
 * on a real reflected-wall collision (or manual fire release).
 */
export class OrbitCylinderSystem {
  readonly items: OrbitRound[] = [];
  /** Rounds one carrier can hold (Black Market research raises it). */
  maxRounds: number = ORBIT.maxRounds;
  totalLoaded = 0;
  totalReleased = 0;

  constructor(poolSize = ORBIT.maxRounds * 32) {
    for (let i = 0; i < poolSize; i++) {
      this.items.push({
        active: false,
        ownerId: 0,
        owner: null,
        angle: 0,
        x: 0,
        y: 0,
        damage: 1,
        speed: 520,
        bounces: 0,
        terrainDamageBonus: 0,
        blightMultiplier: 1,
        pierce: 0,
      });
    }
  }

  clear(): void {
    for (const r of this.items) {
      r.active = false;
      r.ownerId = 0;
      r.owner = null;
      r.wing = undefined;
    }
  }

  countFor(ownerId: number): number {
    let n = 0;
    for (const r of this.items) if (r.active && r.ownerId === ownerId) n++;
    return n;
  }

  isFull(ownerId: number): boolean {
    return this.countFor(ownerId) >= this.maxRounds;
  }

  clearFor(ownerId: number): void {
    for (const r of this.items) {
      if (r.active && r.ownerId === ownerId) {
        r.active = false;
        r.owner = null;
        r.wing = undefined;
      }
    }
  }

  loadRound(
    owner: Soldier,
    damage: number,
    speed: number,
    bounces: number,
    terrainDamageBonus: number,
    blightMultiplier: number,
    pierce: number,
    wing?: Wingman,
  ): boolean {
    const count = this.countFor(owner.id);
    if (count >= this.maxRounds) return false;
    let slot: OrbitRound | null = null;
    for (const r of this.items) {
      if (!r.active) {
        slot = r;
        break;
      }
    }
    if (!slot) return false;

    const angle = owner.facingAngle + (count * Math.PI * 2) / this.maxRounds;
    slot.active = true;
    slot.ownerId = owner.id;
    slot.owner = owner;
    slot.wing = wing;
    slot.angle = angle;
    slot.x = (wing?.x ?? owner.x) + Math.cos(angle) * ORBIT.radius;
    slot.y = (wing?.y ?? owner.y) + Math.sin(angle) * ORBIT.radius;
    slot.damage = damage;
    slot.speed = speed;
    slot.bounces = bounces;
    slot.terrainDamageBonus = terrainDamageBonus;
    slot.blightMultiplier = blightMultiplier;
    slot.pierce = pierce;
    this.totalLoaded++;
    return true;
  }

  update(dt: number, soldiers: readonly Soldier[]): void {
    const aliveIds = new Set<number>();
    for (const s of soldiers) {
      if (s.alive) {
        aliveIds.add(s.id);
        if (s.orbitReleaseCd > 0) s.orbitReleaseCd = Math.max(0, s.orbitReleaseCd - dt);
      }
    }
    for (const r of this.items) {
      if (!r.active) continue;
      if (!r.owner || !r.owner.alive || !aliveIds.has(r.ownerId)) {
        r.active = false;
        r.owner = null;
        r.wing = undefined;
        continue;
      }
      r.angle += ORBIT.angularSpeed * dt;
      r.x = (r.wing?.x ?? r.owner.x) + Math.cos(r.angle) * ORBIT.radius;
      r.y = (r.wing?.y ?? r.owner.y) + Math.sin(r.angle) * ORBIT.radius;
    }
  }

  /**
   * Release all loaded rounds outward on a real reflected-wall collision.
   * Rounds pointing into the wall are reflected across the wall normal (nx, ny)
   * so they sling into open space rather than immediately dying on the wall behind them.
   */
  releaseOnBounce(owner: Soldier, nx: number, ny: number, spawn: SpawnOrbitBulletFn): number {
    if (!owner.alive || owner.orbitReleaseCd > 0) return 0;
    let released = 0;
    for (const r of this.items) {
      if (!r.active || r.ownerId !== owner.id) continue;
      let dx = Math.cos(r.angle);
      let dy = Math.sin(r.angle);
      let vn = dx * nx + dy * ny;
      if (vn < 0) {
        // Reflect into the outward hemisphere of the wall normal.
        dx = dx - 2 * vn * nx;
        dy = dy - 2 * vn * ny;
        vn = dx * nx + dy * ny;
      }
      if (vn < 0.15) {
        dx += nx * (0.15 - vn);
        dy += ny * (0.15 - vn);
      }
      const len = Math.hypot(dx, dy) || 1;
      dx /= len;
      dy /= len;
      const sx = r.wing?.x ?? owner.x + dx * (owner.radius + BULLET.muzzleGap);
      const sy = r.wing?.y ?? owner.y + dy * (owner.radius + BULLET.muzzleGap);
      if (spawn(sx, sy, dx, dy, r.speed, r.damage, BULLET.lifetime, owner.id, r.bounces, r.terrainDamageBonus, r.blightMultiplier, r.pierce)) {
        released++;
      }
      r.active = false;
      r.owner = null;
        r.wing = undefined;
    }
    if (released > 0) {
      owner.orbitReleaseCd = ORBIT.releaseCooldown;
      this.totalReleased += released;
    }
    return released;
  }

  /** Release all loaded rounds outward along their current orbit directions (manual control). */
  releaseManual(owner: Soldier, spawn: SpawnOrbitBulletFn): number {
    if (!owner.alive) return 0;
    let released = 0;
    for (const r of this.items) {
      if (!r.active || r.ownerId !== owner.id) continue;
      const dx = Math.cos(r.angle);
      const dy = Math.sin(r.angle);
      const sx = r.wing?.x ?? owner.x + dx * (owner.radius + BULLET.muzzleGap);
      const sy = r.wing?.y ?? owner.y + dy * (owner.radius + BULLET.muzzleGap);
      if (spawn(sx, sy, dx, dy, r.speed, r.damage, BULLET.lifetime, owner.id, r.bounces, r.terrainDamageBonus, r.blightMultiplier, r.pierce)) {
        released++;
      }
      r.active = false;
      r.owner = null;
        r.wing = undefined;
    }
    if (released > 0) {
      this.totalReleased += released;
    }
    return released;
  }

  get activeCount(): number {
    let n = 0;
    for (const r of this.items) if (r.active) n++;
    return n;
  }
}
