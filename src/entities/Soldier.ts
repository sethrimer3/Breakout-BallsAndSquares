import { GROWTH, LOOT, SHOTGUN, SOLDIER } from "../config";

export type WeaponType = "pistol" | "shotgun";

/** Derived soldier & run stats (base config combined with upgrades). */
export interface SoldierStats {
  speed: number;
  maxSoldiers: number;
  // Pistol stats
  fireRate: number;
  damage: number;
  bulletSpeed: number;
  multishotChance: number;
  // Shotgun stats
  shotgunUnlocked: boolean;
  shotgunFireRate: number;
  shotgunDamage: number;
  shotgunPellets: number;
  shotgunSpreadDeg: number;
  shotgunBulletSpeed: number;
  shotgunLifetime: number;
  // Money / Loot stats
  dropChance: number;
  magnetRange: number;
  pickupLifetime: number;
  // Blight (Growth) stats
  blightGraceSeconds: number;
  blightRateMultiplier: number;
  blightWeakenChance: number;
}

export function baseSoldierStats(): SoldierStats {
  return {
    speed: SOLDIER.speed,
    maxSoldiers: SOLDIER.maxSoldiers,
    fireRate: SOLDIER.fireRate,
    damage: SOLDIER.damage,
    bulletSpeed: SOLDIER.bulletSpeed,
    multishotChance: SOLDIER.multishotChance,
    shotgunUnlocked: false,
    shotgunFireRate: SHOTGUN.fireRate,
    shotgunDamage: SHOTGUN.damage,
    shotgunPellets: SHOTGUN.pellets,
    shotgunSpreadDeg: SHOTGUN.spreadDeg,
    shotgunBulletSpeed: SHOTGUN.bulletSpeed,
    shotgunLifetime: SHOTGUN.lifetime,
    dropChance: LOOT.baseDropChance,
    magnetRange: LOOT.baseMagnetRange,
    pickupLifetime: LOOT.baseLifetime,
    blightGraceSeconds: GROWTH.graceSeconds,
    blightRateMultiplier: 1,
    blightWeakenChance: 0,
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
  weapon: WeaponType;
  radius = SOLDIER.collisionRadius;
  alive = true;
  fireCooldown: number;
  /** Which side shell casings eject to (+1 / -1). */
  ejectSide: number;
  /** Consecutive substeps the soldier could not be freed from terrain (debug). */
  stuckFrames = 0;
  /** Time alive (seconds). */
  age = 0;

  constructor(
    x: number,
    y: number,
    dirX: number,
    dirY: number,
    speed: number,
    weapon: WeaponType = "pistol",
  ) {
    this.x = x;
    this.y = y;
    const len = Math.hypot(dirX, dirY) || 1;
    this.vx = (dirX / len) * speed;
    this.vy = (dirY / len) * speed;
    this.speed = speed;
    this.weapon = weapon;
    this.fireCooldown = 0.15;
    this.ejectSide = Math.random() < 0.5 ? 1 : -1;
  }
}
