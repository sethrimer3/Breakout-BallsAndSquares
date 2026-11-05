import {
  ASSAULT_RIFLE,
  GROWTH,
  LOOT,
  ROCKET_LAUNCHER,
  SHOTGUN,
  SNIPER_RIFLE,
  SOLDIER,
} from "../config";
import type { SoldierStats } from "../entities/Soldier";

export type UpgradeBranch =
  | "core"
  | "pistol"
  | "shotgun"
  | "assault_rifle"
  | "rocket_launcher"
  | "sniper_rifle";

export type UpgradeId =
  // Core Matrix: General Soldier (#38d6ff)
  | "ball_speed"
  | "extra_soldier"
  // Core Matrix: Money / Economy (#ffd84d)
  | "drop_chance"
  | "multi_drop"
  | "magnet_range"
  | "pickup_lifetime"
  // Core Matrix: Blight Suppression (#ff4b8b)
  | "blight_delay"
  | "blight_slow"
  | "blight_weaken"
  // Pistol Tree
  | "fire_rate"
  | "bullet_speed"
  | "bullet_damage"
  | "multishot"
  // Shotgun Tree
  | "shotgun_unlock"
  | "shotgun_pellets"
  | "shotgun_fire_rate"
  | "shotgun_damage"
  | "shotgun_choke"
  | "shotgun_range"
  // Assault Rifle Tree
  | "ar_unlock"
  | "ar_pierce"
  | "ar_fire_rate"
  | "ar_damage"
  | "ar_stabilizer"
  // Rocket Launcher Tree
  | "rocket_unlock"
  | "rocket_radius"
  | "rocket_damage"
  | "rocket_fire_rate"
  | "rocket_cluster"
  // Sniper Rifle Tree
  | "sniper_unlock"
  | "sniper_damage"
  | "sniper_pierce"
  | "sniper_fire_rate"
  | "sniper_crit";

export interface UpgradeDef {
  id: UpgradeId;
  branch: UpgradeBranch;
  name: string;
  shortDesc: string;
  /** Category color accent (hex). */
  color: string;
  /** Grid coordinates on the branch tree (0,0 is center core). */
  grid: { col: number; row: number };
  /** Visual connector parent (null = connects to the central core node). */
  parent: UpgradeId | null;
  maxLevel: number;
  baseCost: number;
  costMultiplier: number;
  /** Lifetime pixels destroyed required to unlock (0 = unlocked from start). */
  unlockLifetimePixels: number;
  /** Compute the display value at `level` (for tooltips like `100% > 110%`). */
  valueAt(level: number): number;
  /** Format a value from `valueAt`. */
  formatValue(v: number): string;
  /** Format the per-level delta. */
  formatDelta(): string;
  /** Apply `level` to the mutable `SoldierStats`. */
  apply(stats: SoldierStats, level: number): void;
  /** Inline SVG path/markup for the node icon (viewBox 0 0 24 24). */
  iconSvg: string;
}

/** Exponential upgrade cost (spec §9). */
export function upgradeCost(def: UpgradeDef, currentLevel: number): number {
  return Math.ceil(def.baseCost * Math.pow(def.costMultiplier, currentLevel));
}

export const UPGRADE_DEFS: readonly UpgradeDef[] = [
  // =========================================================================
  // 1) CORE MATRIX: GENERAL SOLDIER UPGRADES (Cyan #38d6ff, connected together)
  // =========================================================================
  {
    id: "ball_speed",
    branch: "core",
    name: "Soldier Speed",
    shortDesc: "+10% soldier movement velocity per level",
    color: "#38d6ff",
    grid: { col: 0, row: -1 },
    parent: null,
    maxLevel: 10,
    baseCost: 15,
    costMultiplier: 1.55,
    unlockLifetimePixels: 0,
    valueAt: (lvl) => Math.round((1 + 0.1 * lvl) * 100),
    formatValue: (v) => `${v}%`,
    formatDelta: () => "+10%",
    apply: (s, lvl) => {
      s.speed = SOLDIER.speed * (1 + 0.1 * lvl);
    },
    iconSvg: `<path d="M4 12h9M7 7l-3 5 3 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/><circle cx="17" cy="12" r="4" fill="currentColor"/>`,
  },
  {
    id: "extra_soldier",
    branch: "core",
    name: "Additional Soldier",
    shortDesc: "+1 deployable soldier per run & +1 Loadout slot",
    color: "#38d6ff",
    grid: { col: 1, row: -1 },
    parent: "ball_speed",
    maxLevel: 7,
    baseCost: 85,
    costMultiplier: 1.95,
    unlockLifetimePixels: 80,
    valueAt: (lvl) => SOLDIER.maxSoldiers + lvl,
    formatValue: (v) => `${v} SOLDIERS`,
    formatDelta: () => "+1 SOLDIER",
    apply: (s, lvl) => {
      s.maxSoldiers = SOLDIER.maxSoldiers + lvl;
    },
    iconSvg: `<circle cx="10" cy="13" r="5" fill="currentColor"/><path d="M18 5v6M15 8h6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`,
  },

  // =========================================================================
  // 2) CORE MATRIX: MONEY UPGRADES (Gold #ffd84d, connected together)
  // =========================================================================
  {
    id: "drop_chance",
    branch: "core",
    name: "Gold Drop Chance",
    shortDesc: "+10% chance for broken pixels to drop currency",
    color: "#ffd84d",
    grid: { col: -1, row: 0 },
    parent: null,
    maxLevel: 8,
    baseCost: 8,
    costMultiplier: 1.48,
    unlockLifetimePixels: 0,
    valueAt: (lvl) => Math.round((LOOT.baseDropChance + 0.1 * lvl) * 100),
    formatValue: (v) => `${v}%`,
    formatDelta: () => "+10%",
    apply: (s, lvl) => {
      s.dropChance = LOOT.baseDropChance + 0.1 * lvl;
    },
    iconSvg: `<rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor"/><rect x="9" y="9" width="6" height="6" fill="#fff8d6"/>`,
  },
  {
    id: "multi_drop",
    branch: "core",
    name: "Multi-Drop",
    shortDesc: "+25% drop yield per level — drops 2 or more currency items!",
    color: "#ffd84d",
    grid: { col: -2, row: 0 },
    parent: "drop_chance",
    maxLevel: 12,
    baseCost: 28,
    costMultiplier: 1.55,
    unlockLifetimePixels: 30,
    valueAt: (lvl) => +(1 + 0.25 * lvl).toFixed(2),
    formatValue: (v) => `${v.toFixed(2)}× DROPS`,
    formatDelta: () => "+0.25 DROPS",
    apply: (s, lvl) => {
      s.dropChance += 0.25 * lvl;
    },
    iconSvg: `<rect x="3" y="8" width="8" height="8" rx="1" fill="currentColor"/><rect x="13" y="4" width="8" height="8" rx="1" fill="currentColor"/><rect x="11" y="13" width="8" height="8" rx="1" fill="currentColor"/>`,
  },
  {
    id: "magnet_range",
    branch: "core",
    name: "Magnet Range",
    shortDesc: "+25% currency magnetic attraction radius per level",
    color: "#ffd84d",
    grid: { col: -1, row: 1 },
    parent: "drop_chance",
    maxLevel: 10,
    baseCost: 10,
    costMultiplier: 1.48,
    unlockLifetimePixels: 0,
    valueAt: (lvl) => Math.round(LOOT.baseMagnetRange * (1 + 0.25 * lvl)),
    formatValue: (v) => `${v} R`,
    formatDelta: () => "+25%",
    apply: (s, lvl) => {
      s.magnetRange = LOOT.baseMagnetRange * (1 + 0.25 * lvl);
    },
    iconSvg: `<path d="M6 5v6a6 6 0 0 0 12 0V5M6 8h3M15 8h3" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none"/>`,
  },
  {
    id: "pickup_lifetime",
    branch: "core",
    name: "Loot Duration",
    shortDesc: "+2.0s before dropped currency despawns",
    color: "#ffd84d",
    grid: { col: -2, row: 1 },
    parent: "magnet_range",
    maxLevel: 8,
    baseCost: 12,
    costMultiplier: 1.5,
    unlockLifetimePixels: 0,
    valueAt: (lvl) => +(LOOT.baseLifetime + 2 * lvl).toFixed(1),
    formatValue: (v) => `${v.toFixed(1)}s`,
    formatDelta: () => "+2.0s",
    apply: (s, lvl) => {
      s.pickupLifetime = LOOT.baseLifetime + 2 * lvl;
    },
    iconSvg: `<circle cx="12" cy="13" r="7" stroke="currentColor" stroke-width="2" fill="none"/><path d="M12" y="9" d="M12 9v4l2.5 2M9 3h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,
  },

  // =========================================================================
  // 3) CORE MATRIX: BLIGHT UPGRADES (Crimson/Magenta #ff4b8b, connected together)
  // =========================================================================
  {
    id: "blight_delay",
    branch: "core",
    name: "Blight Ward",
    shortDesc: "+3.0s initial grace period before Blight begins replicating",
    color: "#ff4b8b",
    grid: { col: 1, row: 0 },
    parent: null,
    maxLevel: 8,
    baseCost: 18,
    costMultiplier: 1.55,
    unlockLifetimePixels: 0,
    valueAt: (lvl) => GROWTH.graceSeconds + 3 * lvl,
    formatValue: (v) => `${v}s GRACE`,
    formatDelta: () => "+3.0s",
    apply: (s, lvl) => {
      s.blightGraceSeconds = GROWTH.graceSeconds + 3 * lvl;
    },
    iconSvg: `<path d="M12 3l7 3v5c0 5-3.2 8.8-7 10-3.8-1.2-7-5-7-10V6l7-3z" stroke="currentColor" stroke-width="2" fill="none"/><path d="M12 8v5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,
  },
  {
    id: "blight_slow",
    branch: "core",
    name: "Blight Dampener",
    shortDesc: "-8% Blight replication speed per level",
    color: "#ff4b8b",
    grid: { col: 2, row: 0 },
    parent: "blight_delay",
    maxLevel: 10,
    baseCost: 26,
    costMultiplier: 1.6,
    unlockLifetimePixels: 20,
    valueAt: (lvl) => Math.round(Math.pow(0.92, lvl) * 100),
    formatValue: (v) => `${v}% SPD`,
    formatDelta: () => "-8% RATE",
    apply: (s, lvl) => {
      s.blightRateMultiplier = Math.pow(0.92, lvl);
    },
    iconSvg: `<path d="M7 4h10l-4 7 4 7H7l4-7-4-7z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/>`,
  },
  {
    id: "blight_weaken",
    branch: "core",
    name: "Blight Decay",
    shortDesc: "+10% chance newly grown Blight pixels spawn with only 1 HP",
    color: "#ff4b8b",
    grid: { col: 1, row: 1 },
    parent: "blight_delay",
    maxLevel: 8,
    baseCost: 35,
    costMultiplier: 1.65,
    unlockLifetimePixels: 45,
    valueAt: (lvl) => lvl * 10,
    formatValue: (v) => `${v}%`,
    formatDelta: () => "+10%",
    apply: (s, lvl) => {
      s.blightWeakenChance = Math.min(0.8, lvl * 0.1);
    },
    iconSvg: `<rect x="5" y="5" width="14" height="14" rx="1.5" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M5 11l5 2 3-4 6 3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/>`,
  },

  // =========================================================================
  // 4) PISTOL TREE (Starts unlocked)
  // =========================================================================
  {
    id: "fire_rate",
    branch: "pistol",
    name: "Pistol Fire Rate",
    shortDesc: "+12% pistol shots/second per level",
    color: "#ff9d3b",
    grid: { col: 0, row: -1 },
    parent: null,
    maxLevel: 12,
    baseCost: 20,
    costMultiplier: 1.58,
    unlockLifetimePixels: 0,
    valueAt: (lvl) => +(SOLDIER.fireRate * (1 + 0.12 * lvl)).toFixed(2),
    formatValue: (v) => `${v.toFixed(2)}/s`,
    formatDelta: () => "+12%",
    apply: (s, lvl) => {
      s.fireRate = SOLDIER.fireRate * (1 + 0.12 * lvl);
    },
    iconSvg: `<path d="M5 12h14M13 6l6 6-6 6M3 7h5M3 17h5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
  },
  {
    id: "bullet_speed",
    branch: "pistol",
    name: "Pistol Velocity",
    shortDesc: "+8% pistol bullet velocity per level",
    color: "#52f296",
    grid: { col: -1, row: 0 },
    parent: null,
    maxLevel: 8,
    baseCost: 15,
    costMultiplier: 1.55,
    unlockLifetimePixels: 0,
    valueAt: (lvl) => Math.round((1 + 0.08 * lvl) * 100),
    formatValue: (v) => `${v}%`,
    formatDelta: () => "+8%",
    apply: (s, lvl) => {
      s.bulletSpeed = SOLDIER.bulletSpeed * (1 + 0.08 * lvl);
    },
    iconSvg: `<path d="M3 16l8-8M7 18l8-8M14 5l5 5-3 1-3-3 1-3z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="currentColor"/>`,
  },
  {
    id: "bullet_damage",
    branch: "pistol",
    name: "Pistol Damage",
    shortDesc: "+1 terrain damage per pistol round",
    color: "#ff5c7c",
    grid: { col: 1, row: 0 },
    parent: null,
    maxLevel: 8,
    baseCost: 40,
    costMultiplier: 1.75,
    unlockLifetimePixels: 0,
    valueAt: (lvl) => SOLDIER.damage + lvl,
    formatValue: (v) => `${v} DMG`,
    formatDelta: () => "+1 DMG",
    apply: (s, lvl) => {
      s.damage = SOLDIER.damage + lvl;
    },
    iconSvg: `<path d="M14.5 4.5l5 5-9.5 9.5H5v-5l9.5-9.5zM12 7l5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
  },
  {
    id: "multishot",
    branch: "pistol",
    name: "Pistol Multishot",
    shortDesc: "+5% chance to fire twin side rounds (±8°)",
    color: "#c56bff",
    grid: { col: 0, row: 1 },
    parent: "fire_rate",
    maxLevel: 10,
    baseCost: 60,
    costMultiplier: 1.7,
    unlockLifetimePixels: 40,
    valueAt: (lvl) => lvl * 5,
    formatValue: (v) => `${v}%`,
    formatDelta: () => "+5%",
    apply: (s, lvl) => {
      s.multishotChance = Math.min(1, lvl * 0.05);
    },
    iconSvg: `<path d="M4 12h14M14 8l4 4-4 4M4 12l12-6M4 12l12 6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
  },

  // =========================================================================
  // 5) SHOTGUN TREE (Starts locked — unlock `shotgun_unlock` first)
  // =========================================================================
  {
    id: "shotgun_unlock",
    branch: "shotgun",
    name: "Unlock Shotgun",
    shortDesc: "Unlocks the Scatter Shotgun for Soldier Loadouts (5-pellet cone blast)",
    color: "#ff7832",
    grid: { col: 0, row: 0 },
    parent: null,
    maxLevel: 1,
    baseCost: 50,
    costMultiplier: 1,
    unlockLifetimePixels: 30,
    valueAt: (lvl) => lvl,
    formatValue: (v) => (v > 0 ? "UNLOCKED" : "LOCKED"),
    formatDelta: () => "UNLOCK WEAPON",
    apply: (s, lvl) => {
      s.shotgunUnlocked = lvl > 0;
    },
    iconSvg: `<path d="M3 13h11l3-3h4v3l-3 3H9l-2 4H4l2-4H3v-3z" fill="currentColor"/>`,
  },
  {
    id: "shotgun_pellets",
    branch: "shotgun",
    name: "Buckshot Count",
    shortDesc: "+1 pellet per shotgun blast",
    color: "#ff9d3b",
    grid: { col: -1, row: 0 },
    parent: "shotgun_unlock",
    maxLevel: 8,
    baseCost: 30,
    costMultiplier: 1.6,
    unlockLifetimePixels: 30,
    valueAt: (lvl) => SHOTGUN.pellets + lvl,
    formatValue: (v) => `${v} PELLETS`,
    formatDelta: () => "+1 PELLET",
    apply: (s, lvl) => {
      s.shotgunPellets = SHOTGUN.pellets + lvl;
    },
    iconSvg: `<circle cx="7" cy="8" r="2.2" fill="currentColor"/><circle cx="15" cy="7" r="2.2" fill="currentColor"/><circle cx="12" cy="13" r="2.2" fill="currentColor"/><circle cx="7" cy="17" r="2.2" fill="currentColor"/><circle cx="17" cy="16" r="2.2" fill="currentColor"/>`,
  },
  {
    id: "shotgun_fire_rate",
    branch: "shotgun",
    name: "Rapid Pump",
    shortDesc: "+15% shotgun blasts/second per level",
    color: "#ff9d3b",
    grid: { col: 0, row: -1 },
    parent: "shotgun_unlock",
    maxLevel: 10,
    baseCost: 25,
    costMultiplier: 1.58,
    unlockLifetimePixels: 30,
    valueAt: (lvl) => +(SHOTGUN.fireRate * (1 + 0.15 * lvl)).toFixed(2),
    formatValue: (v) => `${v.toFixed(2)}/s`,
    formatDelta: () => "+15%",
    apply: (s, lvl) => {
      s.shotgunFireRate = SHOTGUN.fireRate * (1 + 0.15 * lvl);
    },
    iconSvg: `<path d="M5 12h14M13 6l6 6-6 6M3 7h5M3 17h5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
  },
  {
    id: "shotgun_damage",
    branch: "shotgun",
    name: "Heavy Gauge",
    shortDesc: "+1 terrain damage per shotgun pellet",
    color: "#ff5c7c",
    grid: { col: 1, row: 0 },
    parent: "shotgun_unlock",
    maxLevel: 6,
    baseCost: 55,
    costMultiplier: 1.8,
    unlockLifetimePixels: 30,
    valueAt: (lvl) => SHOTGUN.damage + lvl,
    formatValue: (v) => `${v} DMG`,
    formatDelta: () => "+1 DMG",
    apply: (s, lvl) => {
      s.shotgunDamage = SHOTGUN.damage + lvl;
    },
    iconSvg: `<path d="M14.5 4.5l5 5-9.5 9.5H5v-5l9.5-9.5zM12 7l5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
  },
  {
    id: "shotgun_choke",
    branch: "shotgun",
    name: "Tighter Choke",
    shortDesc: "-8% spread cone & +10% pellet velocity per level",
    color: "#52f296",
    grid: { col: 0, row: 1 },
    parent: "shotgun_unlock",
    maxLevel: 6,
    baseCost: 22,
    costMultiplier: 1.55,
    unlockLifetimePixels: 30,
    valueAt: (lvl) => +(SHOTGUN.spreadDeg * Math.pow(0.92, lvl)).toFixed(1),
    formatValue: (v) => `±${v}°`,
    formatDelta: () => "-8% SPREAD",
    apply: (s, lvl) => {
      s.shotgunSpreadDeg = SHOTGUN.spreadDeg * Math.pow(0.92, lvl);
      s.shotgunBulletSpeed = SHOTGUN.bulletSpeed * (1 + 0.1 * lvl);
    },
    iconSvg: `<path d="M4 6l8 6-8 6M20 6l-8 6 8 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
  },
  {
    id: "shotgun_range",
    branch: "shotgun",
    name: "Magnum Shells",
    shortDesc: "+18% pellet range/duration per level",
    color: "#c56bff",
    grid: { col: 1, row: 1 },
    parent: "shotgun_choke",
    maxLevel: 6,
    baseCost: 28,
    costMultiplier: 1.55,
    unlockLifetimePixels: 30,
    valueAt: (lvl) => Math.round((1 + 0.18 * lvl) * 100),
    formatValue: (v) => `${v}% RNG`,
    formatDelta: () => "+18%",
    apply: (s, lvl) => {
      s.shotgunLifetime = SHOTGUN.lifetime * (1 + 0.18 * lvl);
    },
    iconSvg: `<path d="M4 12h16M15 7l5 5-5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
  },

  // =========================================================================
  // 6) ASSAULT RIFLE TREE (Starts locked — rapid fire + up to 5 pierce)
  // =========================================================================
  {
    id: "ar_unlock",
    branch: "assault_rifle",
    name: "Unlock Assault Rifle",
    shortDesc: "Unlocks the Rapid-Fire Assault Rifle for Soldier Loadouts",
    color: "#52f296",
    grid: { col: 0, row: 0 },
    parent: null,
    maxLevel: 1,
    baseCost: 75,
    costMultiplier: 1,
    unlockLifetimePixels: 60,
    valueAt: (lvl) => lvl,
    formatValue: (v) => (v > 0 ? "UNLOCKED" : "LOCKED"),
    formatDelta: () => "UNLOCK WEAPON",
    apply: (s, lvl) => {
      s.arUnlocked = lvl > 0;
    },
    iconSvg: `<path d="M2 13h13l2-3h5v3l-2 2h-4l-1 4h-3l1-4H7l-2 3H2v-5z" fill="currentColor"/>`,
  },
  {
    id: "ar_pierce",
    branch: "assault_rifle",
    name: "AP Rounds (Pierce)",
    shortDesc: "+1 block pierce per level (up to 5 blocks pierced per bullet)",
    color: "#38d6ff",
    grid: { col: 0, row: -1 },
    parent: "ar_unlock",
    maxLevel: 5,
    baseCost: 45,
    costMultiplier: 1.75,
    unlockLifetimePixels: 60,
    valueAt: (lvl) => ASSAULT_RIFLE.pierce + lvl,
    formatValue: (v) => `${v} PIERCE`,
    formatDelta: () => "+1 PIERCE",
    apply: (s, lvl) => {
      s.arPierce = ASSAULT_RIFLE.pierce + lvl;
    },
    iconSvg: `<path d="M3 12h18M16 7l5 5-5 5M9 8v8M13 8v8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
  },
  {
    id: "ar_fire_rate",
    branch: "assault_rifle",
    name: "Overclocked Receiver",
    shortDesc: "+12% assault rifle rounds/second per level",
    color: "#ff9d3b",
    grid: { col: -1, row: 0 },
    parent: "ar_unlock",
    maxLevel: 10,
    baseCost: 30,
    costMultiplier: 1.58,
    unlockLifetimePixels: 60,
    valueAt: (lvl) => +(ASSAULT_RIFLE.fireRate * (1 + 0.12 * lvl)).toFixed(2),
    formatValue: (v) => `${v.toFixed(2)}/s`,
    formatDelta: () => "+12%",
    apply: (s, lvl) => {
      s.arFireRate = ASSAULT_RIFLE.fireRate * (1 + 0.12 * lvl);
    },
    iconSvg: `<path d="M5 12h14M13 6l6 6-6 6M3 7h5M3 17h5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
  },
  {
    id: "ar_damage",
    branch: "assault_rifle",
    name: "FMJ Caliber",
    shortDesc: "+1 terrain damage per assault rifle round",
    color: "#ff5c7c",
    grid: { col: 1, row: 0 },
    parent: "ar_unlock",
    maxLevel: 6,
    baseCost: 65,
    costMultiplier: 1.85,
    unlockLifetimePixels: 60,
    valueAt: (lvl) => ASSAULT_RIFLE.damage + lvl,
    formatValue: (v) => `${v} DMG`,
    formatDelta: () => "+1 DMG",
    apply: (s, lvl) => {
      s.arDamage = ASSAULT_RIFLE.damage + lvl;
    },
    iconSvg: `<path d="M14.5 4.5l5 5-9.5 9.5H5v-5l9.5-9.5zM12 7l5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
  },
  {
    id: "ar_stabilizer",
    branch: "assault_rifle",
    name: "Recoil Stabilizer",
    shortDesc: "-12% firing jitter & +10% muzzle velocity per level",
    color: "#52f296",
    grid: { col: 0, row: 1 },
    parent: "ar_unlock",
    maxLevel: 6,
    baseCost: 25,
    costMultiplier: 1.52,
    unlockLifetimePixels: 60,
    valueAt: (lvl) => +(ASSAULT_RIFLE.spreadDeg * Math.pow(0.88, lvl)).toFixed(1),
    formatValue: (v) => `±${v}°`,
    formatDelta: () => "-12% JITTER",
    apply: (s, lvl) => {
      s.arSpreadDeg = ASSAULT_RIFLE.spreadDeg * Math.pow(0.88, lvl);
      s.arBulletSpeed = ASSAULT_RIFLE.bulletSpeed * (1 + 0.1 * lvl);
    },
    iconSvg: `<circle cx="12" cy="12" r="7" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M12 3v4M12 17v4M3 12h4M17 12h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`,
  },

  // =========================================================================
  // 7) ROCKET LAUNCHER TREE (Starts locked — explosive AoE warheads)
  // =========================================================================
  {
    id: "rocket_unlock",
    branch: "rocket_launcher",
    name: "Unlock Rocket Launcher",
    shortDesc: "Unlocks the Heavy Rocket Launcher — fires explosive AoE warheads",
    color: "#ff5c40",
    grid: { col: 0, row: 0 },
    parent: null,
    maxLevel: 1,
    baseCost: 120,
    costMultiplier: 1,
    unlockLifetimePixels: 100,
    valueAt: (lvl) => lvl,
    formatValue: (v) => (v > 0 ? "UNLOCKED" : "LOCKED"),
    formatDelta: () => "UNLOCK WEAPON",
    apply: (s, lvl) => {
      s.rocketUnlocked = lvl > 0;
    },
    iconSvg: `<path d="M4 14l9-9c3-1 6 0 7 1s2 4 1 7l-9 9-4-1-3-3-1-4z" stroke="currentColor" stroke-width="1.8" fill="currentColor"/>`,
  },
  {
    id: "rocket_radius",
    branch: "rocket_launcher",
    name: "High-Yield Warhead",
    shortDesc: "+0.4 cells explosion blast radius per level",
    color: "#ff9d3b",
    grid: { col: -1, row: 0 },
    parent: "rocket_unlock",
    maxLevel: 6,
    baseCost: 50,
    costMultiplier: 1.68,
    unlockLifetimePixels: 100,
    valueAt: (lvl) => +(ROCKET_LAUNCHER.blastRadiusCells + 0.4 * lvl).toFixed(1),
    formatValue: (v) => `${v.toFixed(1)} RAD`,
    formatDelta: () => "+0.4 RAD",
    apply: (s, lvl) => {
      s.rocketBlastRadius = ROCKET_LAUNCHER.blastRadiusCells + 0.4 * lvl;
    },
    iconSvg: `<circle cx="12" cy="12" r="4" fill="currentColor"/><circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.8" stroke-dasharray="3 2" fill="none"/>`,
  },
  {
    id: "rocket_damage",
    branch: "rocket_launcher",
    name: "Thermobaric Charge",
    shortDesc: "+2 center blast damage per level",
    color: "#ff5c7c",
    grid: { col: 1, row: 0 },
    parent: "rocket_unlock",
    maxLevel: 8,
    baseCost: 55,
    costMultiplier: 1.72,
    unlockLifetimePixels: 100,
    valueAt: (lvl) => ROCKET_LAUNCHER.damage + 2 * lvl,
    formatValue: (v) => `${v} DMG`,
    formatDelta: () => "+2 DMG",
    apply: (s, lvl) => {
      s.rocketDamage = ROCKET_LAUNCHER.damage + 2 * lvl;
    },
    iconSvg: `<path d="M12 2l2.6 6.4L21 9.5l-5 4.5 1.5 6.5L12 17l-5.5 3.5L8 14 3 9.5l6.4-1.1L12 2z" fill="currentColor"/>`,
  },
  {
    id: "rocket_fire_rate",
    branch: "rocket_launcher",
    name: "Autoloader Tube",
    shortDesc: "+15% reload speed & +10% rocket velocity per level",
    color: "#52f296",
    grid: { col: 0, row: -1 },
    parent: "rocket_unlock",
    maxLevel: 8,
    baseCost: 40,
    costMultiplier: 1.6,
    unlockLifetimePixels: 100,
    valueAt: (lvl) => +(ROCKET_LAUNCHER.fireRate * (1 + 0.15 * lvl)).toFixed(2),
    formatValue: (v) => `${v.toFixed(2)}/s`,
    formatDelta: () => "+15% RATE",
    apply: (s, lvl) => {
      s.rocketFireRate = ROCKET_LAUNCHER.fireRate * (1 + 0.15 * lvl);
      s.rocketBulletSpeed = ROCKET_LAUNCHER.bulletSpeed * (1 + 0.1 * lvl);
    },
    iconSvg: `<path d="M5 12h14M13 6l6 6-6 6M3 7h5M3 17h5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
  },
  {
    id: "rocket_cluster",
    branch: "rocket_launcher",
    name: "Cluster Munitions",
    shortDesc: "+1 secondary mini-blast spawned around the impact site per level",
    color: "#c56bff",
    grid: { col: 0, row: 1 },
    parent: "rocket_unlock",
    maxLevel: 4,
    baseCost: 90,
    costMultiplier: 1.9,
    unlockLifetimePixels: 120,
    valueAt: (lvl) => lvl,
    formatValue: (v) => `${v} BOMBS`,
    formatDelta: () => "+1 CLUSTER",
    apply: (s, lvl) => {
      s.rocketClusterCount = lvl;
    },
    iconSvg: `<circle cx="12" cy="12" r="3" fill="currentColor"/><circle cx="6" cy="7" r="2.2" fill="currentColor"/><circle cx="18" cy="7" r="2.2" fill="currentColor"/><circle cx="6" cy="17" r="2.2" fill="currentColor"/><circle cx="18" cy="17" r="2.2" fill="currentColor"/>`,
  },

  // =========================================================================
  // 8) SNIPER RIFLE TREE (Starts locked — hyper-velocity rail/sniper rounds)
  // =========================================================================
  {
    id: "sniper_unlock",
    branch: "sniper_rifle",
    name: "Unlock Sniper Rifle",
    shortDesc: "Unlocks the Anti-Materiel Sniper Rifle — high damage & deep penetration",
    color: "#38d6ff",
    grid: { col: 0, row: 0 },
    parent: null,
    maxLevel: 1,
    baseCost: 100,
    costMultiplier: 1,
    unlockLifetimePixels: 80,
    valueAt: (lvl) => lvl,
    formatValue: (v) => (v > 0 ? "UNLOCKED" : "LOCKED"),
    formatDelta: () => "UNLOCK WEAPON",
    apply: (s, lvl) => {
      s.sniperUnlocked = lvl > 0;
    },
    iconSvg: `<circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.8" fill="none"/><circle cx="12" cy="12" r="2" fill="currentColor"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`,
  },
  {
    id: "sniper_damage",
    branch: "sniper_rifle",
    name: "Depleted Uranium Core",
    shortDesc: "+3 terrain damage per sniper shot",
    color: "#ff5c7c",
    grid: { col: 1, row: 0 },
    parent: "sniper_unlock",
    maxLevel: 8,
    baseCost: 50,
    costMultiplier: 1.72,
    unlockLifetimePixels: 80,
    valueAt: (lvl) => SNIPER_RIFLE.damage + 3 * lvl,
    formatValue: (v) => `${v} DMG`,
    formatDelta: () => "+3 DMG",
    apply: (s, lvl) => {
      s.sniperDamage = SNIPER_RIFLE.damage + 3 * lvl;
    },
    iconSvg: `<path d="M14.5 4.5l5 5-9.5 9.5H5v-5l9.5-9.5zM12 7l5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
  },
  {
    id: "sniper_pierce",
    branch: "sniper_rifle",
    name: "Tungsten Penetrator",
    shortDesc: "+1 block pierce per level (punches straight through lines of blocks)",
    color: "#38d6ff",
    grid: { col: 0, row: -1 },
    parent: "sniper_unlock",
    maxLevel: 6,
    baseCost: 45,
    costMultiplier: 1.68,
    unlockLifetimePixels: 80,
    valueAt: (lvl) => SNIPER_RIFLE.pierce + lvl,
    formatValue: (v) => `${v} PIERCE`,
    formatDelta: () => "+1 PIERCE",
    apply: (s, lvl) => {
      s.sniperPierce = SNIPER_RIFLE.pierce + lvl;
    },
    iconSvg: `<path d="M3 12h18M16 7l5 5-5 5M9 8v8M13 8v8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
  },
  {
    id: "sniper_fire_rate",
    branch: "sniper_rifle",
    name: "Straight-Pull Bolt",
    shortDesc: "+14% sniper fire rate & +8% bullet velocity per level",
    color: "#ff9d3b",
    grid: { col: -1, row: 0 },
    parent: "sniper_unlock",
    maxLevel: 8,
    baseCost: 35,
    costMultiplier: 1.58,
    unlockLifetimePixels: 80,
    valueAt: (lvl) => +(SNIPER_RIFLE.fireRate * (1 + 0.14 * lvl)).toFixed(2),
    formatValue: (v) => `${v.toFixed(2)}/s`,
    formatDelta: () => "+14% RATE",
    apply: (s, lvl) => {
      s.sniperFireRate = SNIPER_RIFLE.fireRate * (1 + 0.14 * lvl);
      s.sniperBulletSpeed = SNIPER_RIFLE.bulletSpeed * (1 + 0.08 * lvl);
    },
    iconSvg: `<path d="M5 12h14M13 6l6 6-6 6M3 7h5M3 17h5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
  },
  {
    id: "sniper_crit",
    branch: "sniper_rifle",
    name: "Precision Optics (Crit)",
    shortDesc: "+10% critical strike chance per level for 2× sniper damage",
    color: "#c56bff",
    grid: { col: 0, row: 1 },
    parent: "sniper_unlock",
    maxLevel: 8,
    baseCost: 40,
    costMultiplier: 1.62,
    unlockLifetimePixels: 80,
    valueAt: (lvl) => Math.min(100, lvl * 10),
    formatValue: (v) => `${v}% CRIT`,
    formatDelta: () => "+10% CRIT",
    apply: (s, lvl) => {
      s.sniperCritChance = Math.min(1, lvl * 0.1);
    },
    iconSvg: `<path d="M12 3l2.4 5.6L20 11l-5.6 2.4L12 19l-2.4-5.6L4 11l5.6-2.4L12 3z" stroke="currentColor" stroke-width="1.8" fill="currentColor"/>`,
  },
];

export const UPGRADE_BY_ID: Record<UpgradeId, UpgradeDef> = Object.fromEntries(
  UPGRADE_DEFS.map((d) => [d.id, d]),
) as Record<UpgradeId, UpgradeDef>;
