import { LOOT, SOLDIER } from "../config";

/** Derived soldier stats for a run (base config combined with upgrades). */
export interface SoldierStats {
  speed: number;
  fireRate: number;
  damage: number;
  bulletSpeed: number;
  multishotChance: number;
  maxSoldiers: number;
  /** Expected golden squares dropped per broken pixel (0.2 = 20% for 1; 1.5 = 1 guaranteed + 50% for a 2nd, etc.). */
  dropChance: number;
  /** Magnetic attraction radius (world units) for golden square pickups. */
  magnetRange: number;
  /** Seconds before an uncollected golden square despawns. */
  pickupLifetime: number;
}

export function baseSoldierStats(): SoldierStats {
  return {
    speed: SOLDIER.speed,
    fireRate: SOLDIER.fireRate,
    damage: SOLDIER.damage,
    bulletSpeed: SOLDIER.bulletSpeed,
    multishotChance: SOLDIER.multishotChance,
    maxSoldiers: SOLDIER.maxSoldiers,
    dropChance: LOOT.baseDropChance,
    magnetRange: LOOT.baseMagnetRange,
    pickupLifetime: LOOT.baseLifetime,
  };
}

let nextId = 1;

export class Soldier {
  readonly id = nextId++;
  x: number;
  y: number;
  vx: number;
  vy: number;
  speed: number;
  radius = SOLDIER.collisionRadius;
  alive = true;
  fireCooldown: number;
  /** Which side shell casings eject to (+1 / -1). */
  ejectSide: number;
  /** Consecutive substeps the soldier could not be freed from terrain (debug). */
  stuckFrames = 0;
  /** Time alive (seconds). */
  age = 0;

  constructor(x: number, y: number, dirX: number, dirY: number, speed: number) {
    this.x = x;
    this.y = y;
    const len = Math.hypot(dirX, dirY) || 1;
    this.vx = (dirX / len) * speed;
    this.vy = (dirY / len) * speed;
    this.speed = speed;
    this.fireCooldown = 0.15;
    this.ejectSide = Math.random() < 0.5 ? 1 : -1;
  }
}
