import {
  FACILITY,
  GOO,
  GALE,
  DRONE,
  PRISM,
  ASSAULT_RIFLE,
  GRENADE,
  GROWTH,
  KATANA,
  FLAMETHROWER,
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
  | "katana"
  | "flamethrower"
  | "goo_mortar"
  | "drone_shepherd"
  | "prism_laser";

export type PrimaryMutation = "reverse_revolver" | "gale_edge";

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
  pistolBounces: number;
  reverseUnlocked: boolean;
  galeUnlocked: boolean;
  galeDistance: number;
  // Shotgun stats
  shotgunUnlocked: boolean;
  shotgunFireRate: number;
  shotgunDamage: number;
  shotgunPellets: number;
  shotgunSpreadDeg: number;
  shotgunBulletSpeed: number;
  shotgunLifetime: number;
  shotgunBounces: number;
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
  katanaDash: boolean;
  katanaDashPeak: number;
  katanaDashDuration: number;
  katanaDashCooldown: number;
  katanaKinetic: number;
  katanaWide: number;
  katanaPerfect: boolean;
  // Flamethrower stats
  flameUnlocked: boolean;
  flameFireRate: number;
  flameDamage: number;
  flameLifetime: number;
  /** Multiplier on how long rubble burns. */
  flameBurnMult: number;
  // SQUELCH primary weapon prototype
  gooUnlocked: boolean;
  gooFireRate: number;
  gooMass: number;
  gooDistance: number;
  gooDwell: number;
  gooDamage: number;
  gooRadius: number;
  gooResidue: boolean;
  droneUnlocked: boolean;
  droneCapacity: number;
  droneReleaseInterval: number;
  droneDamage: number;
  droneSpeed: number;
  droneFireRate: number;
  droneHealth: number;
  droneAim: number;
  droneRecall: boolean;
  prismUnlocked: boolean;
  prismDamage: number;
  prismSpectrum: number;
  prismBounces: number;
  prismGain: number;
  prismShear: number;
  prismDistance: number;
  prismOverload: boolean;
  prismFireRate: number;
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
  connectedAirMapping: boolean;
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
  blightExpBase: number;
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
    pistolBounces: 0,
    reverseUnlocked: false, galeUnlocked: false, galeDistance: GALE.distance,
    shotgunUnlocked: false,
    shotgunFireRate: SHOTGUN.fireRate,
    shotgunDamage: SHOTGUN.damage,
    shotgunPellets: SHOTGUN.pellets,
    shotgunSpreadDeg: SHOTGUN.spreadDeg,
    shotgunBulletSpeed: SHOTGUN.bulletSpeed,
    shotgunLifetime: SHOTGUN.lifetime,
    shotgunBounces: 0,
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
    katanaDash: false,
    katanaDashPeak: 2.25,
    katanaDashDuration: 0.7,
    katanaDashCooldown: 1.8,
    katanaKinetic: 1,
    katanaWide: 1,
    katanaPerfect: false,
    flameUnlocked: false,
    flameFireRate: FLAMETHROWER.fireRate,
    flameDamage: FLAMETHROWER.damage,
    flameLifetime: FLAMETHROWER.lifetime,
    flameBurnMult: 1,
    gooUnlocked: false,
    gooFireRate: GOO.fireRate,
    gooMass: GOO.startingMass,
    gooDistance: GOO.distance,
    gooDwell: GOO.dwell, gooDamage: GOO.mineDamage, gooRadius: GOO.mineRadiusCells, gooResidue: false,
    droneUnlocked: false, droneCapacity: DRONE.capacity, droneReleaseInterval: DRONE.releaseInterval,
    droneDamage: DRONE.damage, droneSpeed: DRONE.speed, droneFireRate: DRONE.fireRate,
    droneHealth: DRONE.health, droneAim: 0, droneRecall: false,
    prismUnlocked: false, prismDamage: PRISM.damage, prismSpectrum: 0, prismBounces: PRISM.bounces,
    prismGain: 0.25, prismShear: 1, prismDistance: PRISM.distance, prismOverload: false, prismFireRate: PRISM.fireRate,
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
    connectedAirMapping: false,
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
    blightExpBase: GROWTH.expBase,
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
  mutation: PrimaryMutation | null = null;
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
  dashLeft = 0;
  dashDuration = 0;
  dashPeak = 1;
  dashCooldown = 0;
  dashAfterimage = false;
  facingAngle: number;
  isManual = false;
  isInFormation = false;
  /** Hold a chosen side while rounding cover; avoid left/right steering oscillation. */
  formationAvoidSign = 0;
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

export function resolvePrimaryMutation(weapon: WeaponType, mutation: unknown, stats: SoldierStats): PrimaryMutation | null {
  if(weapon==="pistol" && mutation==="reverse_revolver" && stats.reverseUnlocked)return mutation;
  if(weapon==="katana" && mutation==="gale_edge" && stats.galeUnlocked)return mutation;
  return null;
}
