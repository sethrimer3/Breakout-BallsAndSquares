import { DRONE } from "../config";
import { Drone, type DroneShot } from "../entities/Drone";
import { FixedPool } from "../core/FixedPool";
import type { Soldier, SoldierStats } from "../entities/Soldier";
import type { PixelWorld } from "../world/PixelWorld";
import { gridRaycast, makeRayHit } from "../core/gridRaycast";
import { circleIsClear } from "./PhysicsSystem";

export class DroneSystem {
  readonly pool = new FixedPool(DRONE.poolSize, () => new Drone());
  private readonly hit = makeRayHit();
  dropped = 0; launched = 0; shots = 0; usefulHits = 0;
  constructor(private world: PixelWorld, private fire: (shot: DroneShot) => void,
    private onLaunch: (x: number, y: number) => void = () => {}) {}

  release(owner: Soldier, stats: SoldierStats): Drone | null {
    if (!owner.alive || owner.weapon !== "pistol" || owner.mutation !== "drone_shepherd") return null;
    let count = 0;
    for (const drone of this.pool.items) if (drone.active && drone.ownerId === owner.id) count++;
    if (count >= Math.min(7, stats.droneCapacity)) return null;
    const drone = this.pool.acquire();
    if (!drone) { this.dropped++; return null; }
    // Spawn inside the owner's already validated circle, never across a wall.
    drone.owner = owner; drone.ownerId = owner.id;
    drone.x = owner.x; drone.y = owner.y;
    drone.phase = count * Math.PI * 0.8 + owner.id;
    drone.dx = Math.cos(owner.facingAngle); drone.dy = Math.sin(owner.facingAngle);
    drone.aimX = drone.dx; drone.aimY = drone.dy;
    drone.life = DRONE.life; drone.hp = stats.droneHealth;
    drone.fireCooldown = 0.3; drone.retarget = 0;
    drone.damage = stats.droneDamage + owner.mods.damageBonus;
    drone.terrainDamageBonus = owner.mods.terrainDamageBonus;
    drone.blightMultiplier = owner.mods.blightMult; drone.pierce = owner.mods.pierce;
    drone.speed = stats.droneSpeed; drone.fireRate = stats.droneFireRate * owner.mods.fireRateMult;
    drone.aimDegrees = stats.droneAim; drone.recall = stats.droneRecall;
    this.launched++; this.onLaunch(drone.x, drone.y);
    return drone;
  }

  update(dt: number): void {
    for (const drone of this.pool.items) {
      if (!drone.active) continue;
      const owner = drone.owner;
      if (!owner?.alive) drone.life = Math.min(drone.life, DRONE.emergencyLife);
      drone.life -= dt;
      if (drone.life <= 0) {
        if (drone.recall) this.shoot(drone);
        this.pool.release(drone); drone.owner = null; continue;
      }
      // Newly grown terrain can crush a drone. Drones never receive rescue teleports.
      if (!circleIsClear(this.world, drone.x, drone.y, DRONE.radius)) {
        drone.hp--;
        if (drone.hp <= 0) { this.pool.release(drone); drone.owner = null; continue; }
        // A durable drone may retreat only along a validated swept route below.
      }
      drone.phase += dt * 2;
      const cx = owner?.alive ? owner.x : drone.x;
      const cy = owner?.alive ? owner.y : drone.y;
      const tx = cx + Math.cos(drone.phase) * DRONE.orbitRadius;
      const ty = cy + Math.sin(drone.phase) * DRONE.orbitRadius;
      const desired = Math.atan2(ty - drone.y, tx - drone.x);
      const distance = drone.speed * dt;
      let moved = false;
      // Four deterministic local alternatives, with swept center and radius checks.
      for (const turn of [0, Math.PI / 2, -Math.PI / 2, Math.PI]) {
        const dx = Math.cos(desired + turn); const dy = Math.sin(desired + turn);
        if (!this.clearMove(drone.x, drone.y, dx, dy, distance)) continue;
        drone.x += dx * distance; drone.y += dy * distance;
        drone.dx = dx; drone.dy = dy; moved = true; break;
      }
      drone.retarget -= dt;
      if (drone.retarget <= 0) {
        drone.retarget = DRONE.retarget;
        drone.aimX = drone.dx; drone.aimY = drone.dy;
        if (drone.aimDegrees > 0) this.aim(drone);
      }
      drone.fireCooldown -= dt;
      if (moved && drone.fireCooldown <= 0) {
        this.shoot(drone);
        drone.fireCooldown += 1 / Math.max(0.1, drone.fireRate);
        // Never burst unbounded catch-up shots after a slow frame.
        drone.fireCooldown = Math.max(0, drone.fireCooldown);
      }
    }
  }

  private shoot(drone: Drone): void {
    const dot = drone.dx * drone.aimX + drone.dy * drone.aimY;
    const corrected = drone.aimDegrees > 0 && dot >= Math.cos(drone.aimDegrees * Math.PI / 180);
    this.fire({ x: drone.x, y: drone.y, dx: corrected ? drone.aimX : drone.dx, dy: corrected ? drone.aimY : drone.dy,
      ownerId: drone.ownerId, damage: drone.damage, terrainDamageBonus: drone.terrainDamageBonus,
      blightMultiplier: drone.blightMultiplier, pierce: drone.pierce });
    this.shots++;
  }

  private clearMove(x: number, y: number, dx: number, dy: number, distance: number): boolean {
    if (gridRaycast(this.world.subSolidQuery, this.world.subCellSize, x, y, dx, dy, distance, this.hit)) return false;
    const steps = Math.max(1, Math.ceil(distance / DRONE.radius));
    for (let i = 1; i <= steps; i++) {
      const t = distance * i / steps;
      if (!circleIsClear(this.world, x + dx * t, y + dy * t, DRONE.radius)) return false;
    }
    return true;
  }

  private aim(drone: Drone): void {
    const w = this.world; const cs = w.cellSize;
    const cx = Math.floor(drone.x / cs); const cy = Math.floor(drone.y / cs);
    let best = Infinity;
    for (let y = cy - 6; y <= cy + 6; y++) for (let x = cx - 6; x <= cx + 6; x++) {
      if (!w.inBounds(x, y) || !w.isBlightAt(x, y)) continue;
      const dx = (x + 0.5) * cs - drone.x; const dy = (y + 0.5) * cs - drone.y;
      const length = Math.hypot(dx, dy); if (length >= best || length < 1e-6) continue;
      const dot = (dx * drone.dx + dy * drone.dy) / length;
      if (dot < Math.cos(drone.aimDegrees * Math.PI / 180)) continue;
      gridRaycast(w.subSolidQuery, w.subCellSize, drone.x, drone.y, dx / length, dy / length, length, this.hit);
      if (this.hit.hit && ((this.hit.cx >> 1) !== x || (this.hit.cy >> 1) !== y)) continue;
      best = length; drone.aimX = dx / length; drone.aimY = dy / length;
    }
  }

  clear(): void {
    this.pool.clear();
    for (const drone of this.pool.items) drone.owner = null;
    this.dropped = this.launched = this.shots = this.usefulHits = 0;
  }
}
