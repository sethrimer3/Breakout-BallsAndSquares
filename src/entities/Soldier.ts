import {
  FACILITY,
  ASSAULT_RIFLE,
  GRENADE,
  GROWTH,
  KATANA,
  LOOT,
  ROCKET_LAUNCHER,
  SHOTGUN,
  SNIPER_RIFLE,
  SOLDIER,
  TURRET,
  FOG,
} from "../config";
import type { SoldierBehavior } from "../progression/SaveManager";
import { baseSoldierMods, type SoldierMods } from "../progression/SoldierUpgrades";

export type WeaponType =
  | "pistol"
  | "shotgun"
  | "assault_rifle"
  | "rocket_launcher"
  | "sniper_rifle"
  | "katana";

export type SecondaryWeaponType = "grenade" | "turret";

/** Derived soldier & run stats (base config combined with upgrades). */
export interface SoldierStats {
  speed: number;
  maxSoldiers: number;
  // Core global soldier combat buffs (apply to ALL soldiers regardless of weapon)
  globalFireRateMult: number;
  globalDamageBonus: number;
  globalBulletSpeedMult: number;
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
  // Assault Rifle stats
  arUnlocked: boolean;
  arFireRate: number;
  arDamage: number;
  arBulletSpeed: number;
  arSpreadDeg: number;
  arPierce: number;
  // Rocket Launcher stats
  rocketUnlocked: boolean;
  rocketFireRate: number;
  rocketDamage: number;
  rocketBulletSpeed: number;
  rocketBlastRadius: number;
  rocketClusterCount: number;
  // Sniper Rifle stats
  sniperUnlocked: boolean;
  sniperFireRate: number;
  sniperDamage: number;
  sniperBulletSpeed: number;
  sniperPierce: number;
  sniperCritChance: number;
  // Katana stats
  katanaUnlocked: boolean;
  katanaFireRate: number;
  katanaDamage: number;
  katanaBlightMultiplier: number;
  katanaBulletSpeed: number;
  katanaPierce: number;
  katanaSlashWidth: number;
  // Secondary Ability: Grenade stats
  grenadeUnlocked: boolean;
  grenadeBlocksRequired: number;
  grenadeEnergyRequired: number;
  grenadeBlastRadius: number;
  grenadeDamage: number;
  grenadeShrapnel: number;
  grenadeBlightMult: number;
  // Secondary Ability: Turret stats
  turretUnlocked: boolean;
  turretEnergyRequired: number;
  turretCount: number;
  turretDamage: number;
  turretFireRate: number;
  turretTurnSpeed: number;
  /** Autonomous secondary ability activation unlocked via Core upgrade */
  autoAbility: boolean;
  /** Explored areas stay mapped instead of fading back into darkness (Cartography Uplink). */
  permanentMapping: boolean;
  /** Soldier sight radius in the fog of war, in cells (Recon Optics). */
  sightCells: number;
  /** Highest research-base keycard held (0 = none): doors of this tier or lower open when shot. */
  keycardTier: number;
  /** Dormant room sentries wake when a soldier enters their room. */
  sentryUplink: boolean;
  sentryDamage: number;
  sentryFireRate: number;
  // Money / Loot / Resources stats
  dropChance: number;
  magnetRange: number;
  pickupLifetime: number;
  crystalDropBonus: number;
  tier3ResourceBonus: number;
  // Soldier health / survival upgrade
  soldierHealth: number;
  // Blight (Growth) & Blight Core stats
  blightGraceSeconds: number;
  blightRateMultiplier: number;
  blightStartRate: number;
  blightWeakenChance: number;
  /** Decay rate for dormant (disconnected) Blight; 0 without Necrosis Protocol. */
  blightNecrosisRate: number;
  explosiveBlightChance: number;
  explosiveBlightDamage: number;
  explosiveBlightRadius: number;
  coreTimeReduction: number;
  coreDamageBonus: number;
  coreLootBurst: number;
}

export function baseSoldierStats(): SoldierStats {
  return {
    speed: SOLDIER.speed,
    maxSoldiers: SOLDIER.maxSoldiers,
    soldierHealth: 0,
    globalFireRateMult: 1,
    globalDamageBonus: 0,
    globalBulletSpeedMult: 1,
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
    arUnlocked: false,
    arFireRate: ASSAULT_RIFLE.fireRate,
    arDamage: ASSAULT_RIFLE.damage,
    arBulletSpeed: ASSAULT_RIFLE.bulletSpeed,
    arSpreadDeg: ASSAULT_RIFLE.spreadDeg,
    arPierce: ASSAULT_RIFLE.pierce,
    rocketUnlocked: false,
    rocketFireRate: ROCKET_LAUNCHER.fireRate,
    rocketDamage: ROCKET_LAUNCHER.damage,
    rocketBulletSpeed: ROCKET_LAUNCHER.bulletSpeed,
    rocketBlastRadius: ROCKET_LAUNCHER.blastRadiusCells,
    rocketClusterCount: ROCKET_LAUNCHER.clusterCount,
    sniperUnlocked: false,
    sniperFireRate: SNIPER_RIFLE.fireRate,
    sniperDamage: SNIPER_RIFLE.damage,
    sniperBulletSpeed: SNIPER_RIFLE.bulletSpeed,
    sniperPierce: SNIPER_RIFLE.pierce,
    sniperCritChance: SNIPER_RIFLE.critChance,
    katanaUnlocked: false,
    katanaFireRate: KATANA.fireRate,
    katanaDamage: KATANA.damage,
    katanaBlightMultiplier: KATANA.blightMultiplier,
    katanaBulletSpeed: KATANA.bulletSpeed,
    katanaPierce: KATANA.pierce,
    katanaSlashWidth: KATANA.slashWidth,
    grenadeUnlocked: false,
    grenadeBlocksRequired: GRENADE.blocksRequired,
    grenadeEnergyRequired: GRENADE.energyRequired,
    grenadeBlastRadius: GRENADE.blastRadiusCells,
    grenadeDamage: GRENADE.damage,
    grenadeShrapnel: GRENADE.shrapnelCount,
    grenadeBlightMult: GRENADE.blightMultiplier,
    turretUnlocked: false,
    turretEnergyRequired: TURRET.energyRequired,
    turretCount: TURRET.baseCount,
    turretDamage: TURRET.baseDamage,
    turretFireRate: TURRET.baseFireRate,
    turretTurnSpeed: TURRET.baseTurnSpeed,
    autoAbility: false,
    permanentMapping: false,
    sightCells: FOG.soldierSightCells,
    keycardTier: 0,
    sentryUplink: false,
    sentryDamage: FACILITY.sentryDamage,
    sentryFireRate: FACILITY.sentryFireRate,
    dropChance: LOOT.baseDropChance,
    magnetRange: LOOT.baseMagnetRange,
    pickupLifetime: LOOT.baseLifetime,
    crystalDropBonus: 0,
    tier3ResourceBonus: 0,
    blightGraceSeconds: GROWTH.graceSeconds,
    blightRateMultiplier: 1,
    blightStartRate: GROWTH.baseRate,
    blightWeakenChance: 0,
    blightNecrosisRate: 0,
    explosiveBlightChance: 0,
    explosiveBlightDamage: 1,
    explosiveBlightRadius: 1.2,
    coreTimeReduction: GROWTH.coreKillTimeReduction,
    coreDamageBonus: 0,
    coreLootBurst: 8,
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
  secondary: SecondaryWeaponType | null;
  secondaryEnergy = 0;
  get secondaryBlocksBroken(): number {
    return Math.floor(this.secondaryEnergy);
  }
  set secondaryBlocksBroken(val: number) {
    this.secondaryEnergy = val;
  }
  behavior: SoldierBehavior;
  slotIndex: number;
  /** This soldier's own upgrade tree, on top of the squad's shared stats. */
  mods: SoldierMods = baseSoldierMods();
  radius = SOLDIER.collisionRadius;
  alive = true;
  health = 0;
  maxHealth = 0;
  fireCooldown: number;
  /** Alternating swing index for katana slashes. */
  slashIndex = 0;
  facingAngle: number;
  isManual = false;
  isInFormation = false;
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
    behavior: SoldierBehavior = "free",
    slotIndex = 0,
    secondary: SecondaryWeaponType | null = null,
  ) {
    this.x = x;
    this.y = y;
    this.speed = speed;
    this.weapon = weapon;
    this.secondary = secondary;
    this.behavior = behavior;
    this.slotIndex = slotIndex;
    this.fireCooldown = 0.15;
    this.ejectSide = Math.random() < 0.5 ? 1 : -1;

    let len = Math.hypot(dirX, dirY) || 1;
    let dx = dirX / len;
    let dy = dirY / len;

    if (behavior === "vertical") {
      this.vx = 0;
      this.vy = (dy >= 0 ? 1 : -1) * speed;
      this.facingAngle = this.vy >= 0 ? Math.PI / 2 : -Math.PI / 2;
    } else if (behavior === "horizontal") {
      this.vy = 0;
      this.vx = (dx >= 0 ? 1 : -1) * speed;
      this.facingAngle = this.vx >= 0 ? 0 : Math.PI;
    } else if (behavior === "orthogonal") {
      if (Math.abs(dx) >= Math.abs(dy)) {
        this.vy = 0;
        this.vx = (dx >= 0 ? 1 : -1) * speed;
      } else {
        this.vx = 0;
        this.vy = (dy >= 0 ? 1 : -1) * speed;
      }
      this.facingAngle = Math.atan2(this.vy, this.vx);
    } else if (behavior === "sentry_slow" || behavior === "sentry_fast") {
      this.vx = 0;
      this.vy = 0;
      this.facingAngle = Math.atan2(dy, dx);
    } else {
      this.vx = dx * speed;
      this.vy = dy * speed;
      this.facingAngle = Math.atan2(this.vy, this.vx);
    }
  }
}
