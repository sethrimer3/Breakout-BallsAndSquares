import {
  ASSAULT_RIFLE,
  FACILITY,
  GRENADE,
  GROWTH,
  KATANA,
  LOOT,
  ROCKET_LAUNCHER,
  SHOTGUN,
  SNIPER_RIFLE,
  SOLDIER,
  TURRET,
} from "../config";
import type { SoldierStats } from "../entities/Soldier";
import type { SpriteName } from "../ui/pixelArt";

export type UpgradeBranch =
  | "core"
  | "resources"
  | "blight"
  | "pistol"
  | "shotgun"
  | "assault_rifle"
  | "rocket_launcher"
  | "sniper_rifle"
  | "katana"
  | "grenade"
  | "turret"
  | "facility"
  | "soldier";

export type UpgradeId =
  // Core Matrix: Upgrades All Soldiers (#38d6ff)
  | "ball_speed"
  | "soldier_health"
  | "extra_soldier"
  | "core_fire_rate"
  | "core_damage"
  | "core_velocity"
  // Formations & Tactical Behaviors (#38d6ff)
  | "formation_line"
  | "formation_triangle"
  | "behavior_orthogonal"
  | "behavior_patrol"
  | "behavior_turns"
  | "behavior_sentry"
  | "auto_ability"
  // Resources Matrix: Gold, Tier 2 Orange Crystals & Tier 3 Green Crystals
  | "drop_chance"
  | "multi_drop"
  | "magnet_range"
  | "pickup_lifetime"
  | "tier2_crystal_yield"
  | "tier2_crystal_refinery"
  | "tier3_dark_matter"
  | "tier3_quantum_extractor"
  // Blight Matrix: Blight Suppression & Blight Core Upgrades (#ff4b8b)
  | "blight_delay"
  | "blight_start_rate"
  | "blight_slow"
  | "blight_weaken"
  | "explosive_blight_chance"
  | "explosive_blight_damage"
  | "explosive_blight_radius"
  | "core_time_drain"
  | "core_breaker"
  | "core_bounty"
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
  | "sniper_crit"
  // Katana Tree
  | "katana_unlock"
  | "katana_damage"
  | "katana_blight_mult"
  | "katana_pierce"
  | "katana_fire_rate"
  | "katana_arc"
  // Grenade Tree (Secondary Weapon)
  | "grenade_unlock"
  | "grenade_charge"
  | "grenade_damage"
  | "grenade_radius"
  | "grenade_shrapnel"
  | "grenade_blight_mult"
  // Turret Tree (Secondary Weapon)
  | "turret_unlock"
  | "turret_damage"
  | "turret_fire_rate"
  | "turret_turn_speed"
  | "turret_quantity"
  // Research Base Tree: keycards, facility systems & mapping
  | "keycard_t1"
  | "keycard_t2"
  | "keycard_t3"
  | "sentry_uplink"
  | "sentry_calibration"
  | "cartography_uplink"
  // Blight research: dormant colonies decay
  | "necrosis_protocol";

/** The four things upgrades are bought with. */
export type Currency = "gold" | "crystals" | "greenCrystals" | "essence";

export interface Price {
  currency: Currency;
  amount: number;
}

/** One node on an upgrade tree, whichever tree it belongs to. */
export interface TreeNodeDef<Id extends string = string> {
  id: Id;
  name: string;
  shortDesc: string;
  /** Category color accent (hex). */
  color: string;
  /**
   * Grid coordinates on the branch tree (0,0 is center core). Keep each tree
   * inside columns -2..2 and rows -1..1 so it fits at 100%; bigger trees
   * shrink to fit automatically. Rules: see the top of ui/treeView.ts.
   */
  grid: { col: number; row: number };
  /** Visual connector parent (null = connects to the central core node). */
  parent: Id | null;
  maxLevel: number;
  /** What the node's main price is paid in (gold when unset). */
  currency?: Currency;
  baseCost: number;
  costMultiplier: number;
  /** Blight Essence on top of the main price at level 0; rises by half of this each level. */
  essenceCost?: number;
  /** Lifetime pixels destroyed required to unlock (0 = unlocked from start). */
  unlockLifetimePixels: number;
  /** Compute the display value at `level` (for tooltips like `100% > 110%`). */
  valueAt(level: number): number;
  /** Format a value from `valueAt`. */
  formatValue(v: number): string;
  /** Format the per-level delta. */
  formatDelta(): string;
  /** Pixel sprite for the node icon (add new art to `SPRITES` in ui/pixelArt.ts). */
  icon: SpriteName;
}

export interface UpgradeDef extends TreeNodeDef<UpgradeId> {
  branch: UpgradeBranch;
  /** Apply `level` to the mutable `SoldierStats`. */
  apply(stats: SoldierStats, level: number): void;
}

/** Exponential upgrade cost (spec §9), in the node's main currency. */
export function upgradeCost(def: TreeNodeDef, currentLevel: number): number {
  return Math.ceil(def.baseCost * Math.pow(def.costMultiplier, currentLevel));
}

/** Everything the next level of `def` costs. */
export function upgradePrices(def: TreeNodeDef, currentLevel: number): Price[] {
  const prices: Price[] = [{ currency: def.currency ?? "gold", amount: upgradeCost(def, currentLevel) }];
  if (def.essenceCost) {
    prices.push({ currency: "essence", amount: Math.ceil(def.essenceCost * (1 + 0.5 * currentLevel)) });
  }
  return prices;
}

export const UPGRADE_DEFS: readonly UpgradeDef[] = [
  // =========================================================================
  // 1) CORE MATRIX: UPGRADES ALL SOLDIERS (Cyan #38d6ff)
  // =========================================================================
  {
    id: "ball_speed",
    branch: "core",
    name: "Soldier Speed",
    shortDesc: "+8% movement velocity for all soldiers per level",
    color: "#38d6ff",
    grid: { col: 0, row: -1 },
    parent: null,
    maxLevel: 10,
    baseCost: 15,
    costMultiplier: 1.55,
    unlockLifetimePixels: 0,
    valueAt: (lvl) => Math.round((1 + 0.08 * lvl) * 100),
    formatValue: (v) => `${v}%`,
    formatDelta: () => "+8%",
    apply: (s, lvl) => {
      s.speed = SOLDIER.speed * (1 + 0.08 * lvl);
    },
    icon: "soldierDash",
  },
  {
    id: "soldier_health",
    branch: "core",
    name: "Soldier Health",
    shortDesc: "+10 Soldier HP — survives being enclosed in Blight (costs 1 HP per block traveled to safety)",
    color: "#38d6ff",
    grid: { col: -1, row: -1 },
    parent: "ball_speed",
    maxLevel: 10,
    baseCost: 30,
    costMultiplier: 1.6,
    unlockLifetimePixels: 30,
    valueAt: (lvl) => lvl * 10,
    formatValue: (v) => `${v} HP`,
    formatDelta: () => "+10 HP",
    apply: (s, lvl) => {
      s.soldierHealth = lvl * 10;
    },
    icon: "soldierPlus",
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
    icon: "soldierPlus",
  },
  {
    id: "core_fire_rate",
    branch: "core",
    name: "Squad Overclock",
    shortDesc: "+8% global fire rate across all soldiers & weapons",
    color: "#38d6ff",
    grid: { col: -1, row: 0 },
    parent: null,
    maxLevel: 10,
    baseCost: 25,
    costMultiplier: 1.6,
    unlockLifetimePixels: 0,
    valueAt: (lvl) => Math.round((1 + 0.08 * lvl) * 100),
    formatValue: (v) => `${v}% RATE`,
    formatDelta: () => "+8% ALL",
    apply: (s, lvl) => {
      s.globalFireRateMult = 1 + 0.08 * lvl;
    },
    icon: "fireRate",
  },
  {
    id: "core_damage",
    branch: "core",
    name: "Squad Firepower",
    shortDesc: "+1 global terrain damage bonus for all soldiers & weapons",
    color: "#38d6ff",
    grid: { col: 1, row: 0 },
    parent: null,
    maxLevel: 8,
    baseCost: 45,
    costMultiplier: 1.75,
    unlockLifetimePixels: 25,
    valueAt: (lvl) => lvl,
    formatValue: (v) => `+${v} DMG`,
    formatDelta: () => "+1 DMG ALL",
    apply: (s, lvl) => {
      s.globalDamageBonus = lvl;
    },
    icon: "impact",
  },
  {
    id: "core_velocity",
    branch: "core",
    name: "Squad Ballistics",
    shortDesc: "+8% global projectile velocity for all soldiers & weapons",
    color: "#38d6ff",
    grid: { col: 0, row: 1 },
    parent: null,
    maxLevel: 8,
    baseCost: 20,
    costMultiplier: 1.55,
    unlockLifetimePixels: 0,
    valueAt: (lvl) => Math.round((1 + 0.08 * lvl) * 100),
    formatValue: (v) => `${v}% VEL`,
    formatDelta: () => "+8% ALL",
    apply: (s, lvl) => {
      s.globalBulletSpeedMult = 1 + 0.08 * lvl;
    },
    icon: "bulletFast",
  },
  {
    id: "formation_line",
    branch: "core",
    name: "Line Formation",
    shortDesc: "Tactical squad formation: all soldiers follow behind the commander in single file",
    color: "#38d6ff",
    grid: { col: -2, row: 0 },
    parent: "core_fire_rate",
    maxLevel: 1,
    baseCost: 65,
    costMultiplier: 1,
    unlockLifetimePixels: 60,
    valueAt: (lvl) => lvl,
    formatValue: (v) => (v > 0 ? "UNLOCKED" : "LOCKED"),
    formatDelta: () => "UNLOCK",
    apply: () => {},
    icon: "formationLine",
  },
  {
    id: "formation_triangle",
    branch: "core",
    name: "Triangle Formation",
    shortDesc: "Tactical squad formation: alive soldiers form a protective wedge behind the commander",
    color: "#38d6ff",
    grid: { col: -2, row: 1 },
    parent: "formation_line",
    maxLevel: 1,
    baseCost: 110,
    costMultiplier: 1,
    unlockLifetimePixels: 120,
    valueAt: (lvl) => lvl,
    formatValue: (v) => (v > 0 ? "UNLOCKED" : "LOCKED"),
    formatDelta: () => "UNLOCK",
    apply: () => {},
    icon: "formationTriangle",
  },
  {
    id: "behavior_orthogonal",
    branch: "core",
    name: "Orthogonal Protocol",
    shortDesc: "Unlocks Orthogonal behavior in Loadout: soldiers move strictly along cardinal axes",
    color: "#38d6ff",
    grid: { col: -2, row: -1 },
    parent: "soldier_health",
    maxLevel: 1,
    baseCost: 40,
    costMultiplier: 1,
    unlockLifetimePixels: 20,
    valueAt: (lvl) => lvl,
    formatValue: (v) => (v > 0 ? "UNLOCKED" : "LOCKED"),
    formatDelta: () => "UNLOCK",
    apply: () => {},
    icon: "behaviorGrid",
  },
  {
    id: "behavior_patrol",
    branch: "core",
    name: "Patrol Protocols",
    shortDesc: "Unlocks Vertical and Horizontal patrol behaviors in Loadout: sweep corridors",
    color: "#38d6ff",
    grid: { col: 2, row: -1 },
    parent: "extra_soldier",
    maxLevel: 1,
    baseCost: 60,
    costMultiplier: 1,
    unlockLifetimePixels: 45,
    valueAt: (lvl) => lvl,
    formatValue: (v) => (v > 0 ? "UNLOCKED" : "LOCKED"),
    formatDelta: () => "UNLOCK",
    apply: () => {},
    icon: "behaviorPatrol",
  },
  {
    id: "behavior_turns",
    branch: "core",
    name: "Perimeter Routing",
    shortDesc: "Unlocks Left-Turn and Right-Turn behaviors in Loadout: soldiers hug and orbit walls",
    color: "#38d6ff",
    grid: { col: 2, row: 0 },
    parent: "core_damage",
    maxLevel: 1,
    baseCost: 75,
    costMultiplier: 1,
    unlockLifetimePixels: 70,
    valueAt: (lvl) => lvl,
    formatValue: (v) => (v > 0 ? "UNLOCKED" : "LOCKED"),
    formatDelta: () => "UNLOCK",
    apply: () => {},
    icon: "behaviorTurns",
  },
  {
    id: "behavior_sentry",
    branch: "core",
    name: "Sentry Protocols",
    shortDesc: "Unlocks Slow Turret and Rapid Turret sentry behaviors in Loadout: stationary 360° fire",
    color: "#38d6ff",
    grid: { col: 1, row: 1 },
    parent: "core_velocity",
    maxLevel: 1,
    baseCost: 90,
    costMultiplier: 1,
    unlockLifetimePixels: 100,
    valueAt: (lvl) => lvl,
    formatValue: (v) => (v > 0 ? "UNLOCKED" : "LOCKED"),
    formatDelta: () => "UNLOCK",
    apply: () => {},
    icon: "behaviorSentry",
  },
  {
    id: "auto_ability",
    branch: "core",
    name: "Autonomous Primer",
    shortDesc: "Automatically triggers secondary weapons as soon as full energy is charged",
    color: "#52f296",
    grid: { col: -1, row: 1 },
    parent: "core_velocity",
    maxLevel: 1,
    currency: "greenCrystals",
    baseCost: 5,
    costMultiplier: 1,
    unlockLifetimePixels: 80,
    valueAt: (lvl) => lvl,
    formatValue: (v) => (v > 0 ? "UNLOCKED" : "LOCKED"),
    formatDelta: () => "UNLOCK",
    apply: (s, lvl) => {
      s.autoAbility = lvl > 0;
    },
    icon: "gear",
  },

  // =========================================================================
  // 2) RESOURCES TAB: GOLD, TIER 2 ORANGE CRYSTALS & TIER 3 GREEN CRYSTALS
  // =========================================================================
  {
    id: "drop_chance",
    branch: "resources",
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
    icon: "goldDrop",
  },
  {
    id: "multi_drop",
    branch: "resources",
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
    icon: "goldStack",
  },
  {
    id: "magnet_range",
    branch: "resources",
    name: "Magnet Range",
    shortDesc: "+25% currency magnetic attraction radius per level",
    color: "#ffd84d",
    grid: { col: 0, row: -1 },
    parent: null,
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
    icon: "magnet",
  },
  {
    id: "pickup_lifetime",
    branch: "resources",
    name: "Loot Duration",
    shortDesc: "+2.0s before dropped currency despawns",
    color: "#ffd84d",
    grid: { col: 0, row: 1 },
    parent: null,
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
    icon: "hourglass",
  },
  {
    id: "tier2_crystal_yield",
    branch: "resources",
    name: "Crystal Harvester [T2]",
    shortDesc: "+15% Zone 2 Orange Crystal drop chance",
    color: "#ff8c2e",
    grid: { col: 1, row: 0 },
    parent: null,
    maxLevel: 8,
    baseCost: 40,
    costMultiplier: 1.6,
    unlockLifetimePixels: 50,
    valueAt: (lvl) => Math.round((1 + 0.15 * lvl) * 100),
    formatValue: (v) => `${v}% T2`,
    formatDelta: () => "+15% T2",
    apply: (s, lvl) => {
      s.crystalDropBonus = 0.15 * lvl;
    },
    icon: "goldDrop",
  },
  {
    id: "tier2_crystal_refinery",
    branch: "resources",
    name: "Crystal Refinery [T2]",
    shortDesc: "+20% Zone 2 Orange Crystal drop chance",
    color: "#ff8c2e",
    grid: { col: 1, row: -1 },
    parent: "tier2_crystal_yield",
    maxLevel: 5,
    baseCost: 75,
    costMultiplier: 1.75,
    unlockLifetimePixels: 100,
    valueAt: (lvl) => lvl * 20,
    formatValue: (v) => `+${v}% T2`,
    formatDelta: () => "+20% T2",
    apply: (s, lvl) => {
      s.crystalDropBonus += 0.2 * lvl;
    },
    icon: "goldStack",
  },
  {
    id: "tier3_dark_matter",
    branch: "resources",
    name: "Green Crystal Siphon [T3]",
    shortDesc: "+20% Zone 3 Green Crystal drop chance",
    color: "#52f296",
    grid: { col: 2, row: 0 },
    parent: "tier2_crystal_yield",
    maxLevel: 5,
    baseCost: 150,
    costMultiplier: 1.85,
    unlockLifetimePixels: 200,
    valueAt: (lvl) => Math.round((1 + 0.2 * lvl) * 100),
    formatValue: (v) => `${v}% T3`,
    formatDelta: () => "+20% T3",
    apply: (s, lvl) => {
      s.tier3ResourceBonus = 0.2 * lvl;
    },
    icon: "cluster",
  },
  {
    id: "tier3_quantum_extractor",
    branch: "resources",
    name: "Quantum Extractor [T3]",
    shortDesc: "+25% Zone 3 Green Crystal drop chance",
    color: "#52f296",
    grid: { col: 2, row: 1 },
    parent: "tier3_dark_matter",
    maxLevel: 5,
    baseCost: 220,
    costMultiplier: 1.95,
    unlockLifetimePixels: 300,
    valueAt: (lvl) => lvl * 25,
    formatValue: (v) => `+${v}% T3`,
    formatDelta: () => "+25% T3",
    apply: (s, lvl) => {
      s.tier3ResourceBonus += 0.25 * lvl;
    },
    icon: "blast",
  },

  // =========================================================================
  // 3) BLIGHT TAB: BLIGHT SUPPRESSION & BLIGHT CORE UPGRADES
  // =========================================================================
  {
    id: "blight_delay",
    branch: "blight",
    name: "Blight Ward",
    shortDesc: "+1.0s initial grace period before Blight begins replicating (5s up to 15s)",
    color: "#ff4b8b",
    grid: { col: 0, row: -1 },
    parent: null,
    maxLevel: 10,
    baseCost: 16,
    costMultiplier: 1.5,
    unlockLifetimePixels: 0,
    valueAt: (lvl) => GROWTH.graceSeconds + 1 * lvl,
    formatValue: (v) => `${v}s GRACE`,
    formatDelta: () => "+1.0s",
    apply: (s, lvl) => {
      s.blightGraceSeconds = GROWTH.graceSeconds + 1 * lvl;
    },
    icon: "blightShield",
  },
  {
    id: "blight_start_rate",
    branch: "blight",
    name: "Initial Suppression",
    shortDesc: "-0.1/s initial Blight replication rate when grace period ends (1.0/s down to 0.0/s)",
    color: "#ff4b8b",
    grid: { col: -1, row: -1 },
    parent: "blight_delay",
    maxLevel: 10,
    baseCost: 20,
    costMultiplier: 1.55,
    unlockLifetimePixels: 15,
    valueAt: (lvl) => Math.max(0, +(1.0 - 0.1 * lvl).toFixed(1)),
    formatValue: (v) => `${v.toFixed(1)}/s`,
    formatDelta: () => "-0.1/s",
    apply: (s, lvl) => {
      s.blightStartRate = Math.max(0, +(1.0 - 0.1 * lvl).toFixed(1));
    },
    icon: "blightSlow",
  },
  {
    id: "blight_slow",
    branch: "blight",
    name: "Blight Dampener",
    shortDesc: "-5% Blight replication speed per level (-50% when maxed)",
    color: "#ff4b8b",
    grid: { col: -1, row: 0 },
    parent: null,
    maxLevel: 10,
    baseCost: 26,
    costMultiplier: 1.6,
    unlockLifetimePixels: 20,
    valueAt: (lvl) => Math.round((1 - 0.05 * lvl) * 100),
    formatValue: (v) => `${v}% SPD`,
    formatDelta: () => "-5% RATE",
    apply: (s, lvl) => {
      s.blightRateMultiplier = Math.max(0.5, 1 - 0.05 * lvl);
    },
    icon: "blightSlow",
  },
  {
    id: "blight_weaken",
    branch: "blight",
    name: "Blight Decay",
    shortDesc: "+10% chance newly grown Blight pixels spawn with only 1 HP",
    color: "#ff4b8b",
    grid: { col: -2, row: 0 },
    parent: "blight_slow",
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
    icon: "blightCrack",
  },
  {
    id: "necrosis_protocol",
    branch: "blight",
    name: "Necrosis Protocol",
    shortDesc: "Blight cut off from every living generator slowly darkens, crumbles and vanishes (faster per level)",
    color: "#b07cff",
    grid: { col: -3, row: 0 },
    parent: "blight_weaken",
    maxLevel: 5,
    baseCost: 60,
    costMultiplier: 1.8,
    unlockLifetimePixels: 80,
    valueAt: (lvl) => necrosisRate(lvl),
    formatValue: (v) => (v > 0 ? `${v.toFixed(1)}/s DECAY` : "OFF"),
    formatDelta: () => "+DECAY",
    apply: (s, lvl) => {
      s.blightNecrosisRate = necrosisRate(lvl);
    },
    icon: "blightCrack",
  },
  {
    id: "explosive_blight_chance",
    branch: "blight",
    name: "Explosive Blight",
    shortDesc: "+5% chance for newly formed pink Blight to combust and explode",
    color: "#ff4b8b",
    grid: { col: 0, row: 1 },
    parent: null,
    maxLevel: 10,
    baseCost: 28,
    costMultiplier: 1.6,
    unlockLifetimePixels: 35,
    valueAt: (lvl) => lvl * 5,
    formatValue: (v) => `${v}%`,
    formatDelta: () => "+5%",
    apply: (s, lvl) => {
      s.explosiveBlightChance = lvl * 0.05;
    },
    icon: "blast",
  },
  {
    id: "explosive_blight_damage",
    branch: "blight",
    name: "Combustion Power",
    shortDesc: "+1 damage dealt by Blight combustion explosions",
    color: "#ff4b8b",
    grid: { col: -1, row: 1 },
    parent: "explosive_blight_chance",
    maxLevel: 8,
    baseCost: 35,
    costMultiplier: 1.65,
    unlockLifetimePixels: 50,
    valueAt: (lvl) => 1 + lvl,
    formatValue: (v) => `${v} DMG`,
    formatDelta: () => "+1 DMG",
    apply: (s, lvl) => {
      s.explosiveBlightDamage = 1 + lvl;
    },
    icon: "impact",
  },
  {
    id: "explosive_blight_radius",
    branch: "blight",
    name: "Blast Wave",
    shortDesc: "+0.4 cell radius for Blight combustion explosions",
    color: "#ff4b8b",
    grid: { col: 1, row: 1 },
    parent: "explosive_blight_chance",
    maxLevel: 6,
    baseCost: 32,
    costMultiplier: 1.6,
    unlockLifetimePixels: 45,
    valueAt: (lvl) => +(1.2 + 0.4 * lvl).toFixed(1),
    formatValue: (v) => `${v.toFixed(1)} RAD`,
    formatDelta: () => "+0.4 RAD",
    apply: (s, lvl) => {
      s.explosiveBlightRadius = +(1.2 + 0.4 * lvl).toFixed(1);
    },
    icon: "warhead",
  },
  {
    id: "core_time_drain",
    branch: "blight",
    name: "Core Purge",
    shortDesc: "+4.0s extra Blight timer reduction when destroying a Blight Core",
    color: "#ff4b8b",
    grid: { col: 1, row: 0 },
    parent: null,
    maxLevel: 8,
    baseCost: 28,
    costMultiplier: 1.6,
    unlockLifetimePixels: 0,
    valueAt: (lvl) => GROWTH.coreKillTimeReduction + 4 * lvl,
    formatValue: (v) => `-${v}s CORE`,
    formatDelta: () => "-4.0s TIMER",
    apply: (s, lvl) => {
      s.coreTimeReduction = GROWTH.coreKillTimeReduction + 4 * lvl;
    },
    icon: "hourglass",
  },
  {
    id: "core_breaker",
    branch: "blight",
    name: "Core Shatterer",
    shortDesc: "+2 bonus damage against Blight Core cells per level",
    color: "#ff5c7c",
    grid: { col: 2, row: 0 },
    parent: "core_time_drain",
    maxLevel: 6,
    baseCost: 35,
    costMultiplier: 1.65,
    unlockLifetimePixels: 25,
    valueAt: (lvl) => lvl * 2,
    formatValue: (v) => `+${v} DMG`,
    formatDelta: () => "+2 CORE DMG",
    apply: (s, lvl) => {
      s.coreDamageBonus = 2 * lvl;
    },
    icon: "impact",
  },
  {
    id: "core_bounty",
    branch: "blight",
    name: "Core Harvest",
    shortDesc: "+4 bonus currency drops erupted when destroying a Blight Core",
    color: "#ffd84d",
    grid: { col: 1, row: -1 },
    parent: "core_time_drain",
    maxLevel: 8,
    baseCost: 30,
    costMultiplier: 1.6,
    unlockLifetimePixels: 25,
    valueAt: (lvl) => 8 + 4 * lvl,
    formatValue: (v) => `${v} DROPS`,
    formatDelta: () => "+4 DROPS",
    apply: (s, lvl) => {
      s.coreLootBurst = 8 + 4 * lvl;
    },
    icon: "goldDrop",
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
    icon: "fireRate",
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
    icon: "bulletFast",
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
    icon: "impact",
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
    currency: "crystals",
    baseCost: 20,
    costMultiplier: 1.7,
    unlockLifetimePixels: 40,
    valueAt: (lvl) => lvl * 5,
    formatValue: (v) => `${v}%`,
    formatDelta: () => "+5%",
    apply: (s, lvl) => {
      s.multishotChance = Math.min(1, lvl * 0.05);
    },
    icon: "fan",
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
    icon: "shotgun",
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
    currency: "crystals",
    baseCost: 10,
    costMultiplier: 1.6,
    unlockLifetimePixels: 30,
    valueAt: (lvl) => SHOTGUN.pellets + lvl,
    formatValue: (v) => `${v} PELLETS`,
    formatDelta: () => "+1 PELLET",
    apply: (s, lvl) => {
      s.shotgunPellets = SHOTGUN.pellets + lvl;
    },
    icon: "pellets",
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
    icon: "fireRate",
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
    icon: "impact",
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
    icon: "choke",
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
    currency: "crystals",
    baseCost: 10,
    costMultiplier: 1.55,
    unlockLifetimePixels: 30,
    valueAt: (lvl) => Math.round((1 + 0.18 * lvl) * 100),
    formatValue: (v) => `${v}% RNG`,
    formatDelta: () => "+18%",
    apply: (s, lvl) => {
      s.shotgunLifetime = SHOTGUN.lifetime * (1 + 0.18 * lvl);
    },
    icon: "range",
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
    icon: "rifle",
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
    currency: "crystals",
    baseCost: 15,
    costMultiplier: 1.75,
    unlockLifetimePixels: 60,
    valueAt: (lvl) => ASSAULT_RIFLE.pierce + lvl,
    formatValue: (v) => `${v} PIERCE`,
    formatDelta: () => "+1 PIERCE",
    apply: (s, lvl) => {
      s.arPierce = ASSAULT_RIFLE.pierce + lvl;
    },
    icon: "pierce",
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
    icon: "fireRate",
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
    icon: "impact",
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
    icon: "stabilizer",
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
    icon: "launcher",
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
    currency: "crystals",
    baseCost: 16,
    costMultiplier: 1.68,
    unlockLifetimePixels: 100,
    valueAt: (lvl) => +(ROCKET_LAUNCHER.blastRadiusCells + 0.4 * lvl).toFixed(1),
    formatValue: (v) => `${v.toFixed(1)} RAD`,
    formatDelta: () => "+0.4 RAD",
    apply: (s, lvl) => {
      s.rocketBlastRadius = ROCKET_LAUNCHER.blastRadiusCells + 0.4 * lvl;
    },
    icon: "blast",
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
    icon: "warhead",
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
    icon: "fireRate",
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
    currency: "crystals",
    baseCost: 30,
    costMultiplier: 1.9,
    unlockLifetimePixels: 120,
    valueAt: (lvl) => lvl,
    formatValue: (v) => `${v} BOMBS`,
    formatDelta: () => "+1 CLUSTER",
    apply: (s, lvl) => {
      s.rocketClusterCount = lvl;
    },
    icon: "cluster",
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
    icon: "sniper",
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
    icon: "impact",
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
    currency: "crystals",
    baseCost: 15,
    costMultiplier: 1.68,
    unlockLifetimePixels: 80,
    valueAt: (lvl) => SNIPER_RIFLE.pierce + lvl,
    formatValue: (v) => `${v} PIERCE`,
    formatDelta: () => "+1 PIERCE",
    apply: (s, lvl) => {
      s.sniperPierce = SNIPER_RIFLE.pierce + lvl;
    },
    icon: "pierce",
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
    icon: "fireRate",
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
    currency: "crystals",
    baseCost: 14,
    costMultiplier: 1.62,
    unlockLifetimePixels: 80,
    valueAt: (lvl) => Math.min(100, lvl * 10),
    formatValue: (v) => `${v}% CRIT`,
    formatDelta: () => "+10% CRIT",
    apply: (s, lvl) => {
      s.sniperCritChance = Math.min(1, lvl * 0.1);
    },
    icon: "crit",
  },

  // =========================================================================
  // 9) KATANA TREE (Starts locked — razor-sharp anti-blight energy slashes)
  // =========================================================================
  {
    id: "katana_unlock",
    branch: "katana",
    name: "Unlock Katana",
    shortDesc: "Unlocks the Katana — rapid energy slashes with high pierce and devastating anti-blight damage",
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
      s.katanaUnlocked = lvl > 0;
    },
    icon: "katana",
  },
  {
    id: "katana_damage",
    branch: "katana",
    name: "Razor Edge",
    shortDesc: "+2 base slash damage per level",
    color: "#ff5c7c",
    grid: { col: 1, row: 0 },
    parent: "katana_unlock",
    maxLevel: 8,
    baseCost: 45,
    costMultiplier: 1.68,
    unlockLifetimePixels: 80,
    valueAt: (lvl) => KATANA.damage + 2 * lvl,
    formatValue: (v) => `${v} DMG`,
    formatDelta: () => "+2 DMG",
    apply: (s, lvl) => {
      s.katanaDamage = KATANA.damage + 2 * lvl;
    },
    icon: "impact",
  },
  {
    id: "katana_blight_mult",
    branch: "katana",
    name: "Blight Cleaver",
    shortDesc: "+0.5× damage multiplier against Blight blocks per level (starts at 3.0×)",
    color: "#ff4b8b",
    grid: { col: 0, row: -1 },
    parent: "katana_unlock",
    maxLevel: 6,
    currency: "crystals",
    baseCost: 14,
    costMultiplier: 1.65,
    unlockLifetimePixels: 80,
    valueAt: (lvl) => +(KATANA.blightMultiplier + 0.5 * lvl).toFixed(1),
    formatValue: (v) => `${v}× BLIGHT`,
    formatDelta: () => "+0.5× MULT",
    apply: (s, lvl) => {
      s.katanaBlightMultiplier = +(KATANA.blightMultiplier + 0.5 * lvl).toFixed(1);
    },
    icon: "blightCrack",
  },
  {
    id: "katana_pierce",
    branch: "katana",
    name: "Flowing Cut",
    shortDesc: "+1 block pierce per level (slices through multiple blocks in a line)",
    color: "#38d6ff",
    grid: { col: 0, row: 1 },
    parent: "katana_unlock",
    maxLevel: 6,
    currency: "crystals",
    baseCost: 14,
    costMultiplier: 1.66,
    unlockLifetimePixels: 80,
    valueAt: (lvl) => KATANA.pierce + lvl,
    formatValue: (v) => `${v} PIERCE`,
    formatDelta: () => "+1 PIERCE",
    apply: (s, lvl) => {
      s.katanaPierce = KATANA.pierce + lvl;
    },
    icon: "pierce",
  },
  {
    id: "katana_fire_rate",
    branch: "katana",
    name: "Iaido Strike",
    shortDesc: "+14% swing rate & +8% slash velocity per level",
    color: "#ff9d3b",
    grid: { col: -1, row: 0 },
    parent: "katana_unlock",
    maxLevel: 8,
    baseCost: 35,
    costMultiplier: 1.58,
    unlockLifetimePixels: 80,
    valueAt: (lvl) => +(KATANA.fireRate * (1 + 0.14 * lvl)).toFixed(2),
    formatValue: (v) => `${v.toFixed(2)}/s`,
    formatDelta: () => "+14% RATE",
    apply: (s, lvl) => {
      s.katanaFireRate = KATANA.fireRate * (1 + 0.14 * lvl);
      s.katanaBulletSpeed = KATANA.bulletSpeed * (1 + 0.08 * lvl);
    },
    icon: "fireRate",
  },
  {
    id: "katana_arc",
    branch: "katana",
    name: "Wide Sweep",
    shortDesc: "+3 world units slash arc width per level",
    color: "#52f296",
    grid: { col: 1, row: 1 },
    parent: "katana_damage",
    maxLevel: 6,
    currency: "crystals",
    baseCost: 13,
    costMultiplier: 1.62,
    unlockLifetimePixels: 80,
    valueAt: (lvl) => KATANA.slashWidth + 3 * lvl,
    formatValue: (v) => `${v} WIDTH`,
    formatDelta: () => "+3 WIDTH",
    apply: (s, lvl) => {
      s.katanaSlashWidth = KATANA.slashWidth + 3 * lvl;
    },
    icon: "blast",
  },

  // =========================================================================
  // 10) GRENADE TREE (Secondary Weapon / Equippable Ability)
  // =========================================================================
  {
    id: "grenade_unlock",
    branch: "grenade",
    name: "Unlock Grenade",
    shortDesc: "Unlocks the Sticky Grenade secondary ability — throws a sticky explosive after breaking blocks",
    color: "#ff9d3b",
    grid: { col: 0, row: 0 },
    parent: null,
    maxLevel: 1,
    baseCost: 120,
    costMultiplier: 1,
    unlockLifetimePixels: 80,
    valueAt: (lvl) => lvl,
    formatValue: (v) => (v > 0 ? "UNLOCKED" : "LOCKED"),
    formatDelta: () => "UNLOCK ABILITY",
    apply: (s, lvl) => {
      s.grenadeUnlocked = lvl > 0;
    },
    icon: "grenade",
  },
  {
    id: "grenade_charge",
    branch: "grenade",
    name: "Fast Primer",
    shortDesc: "-8 energy required to activate sticky grenade per level",
    color: "#38d6ff",
    grid: { col: 0, row: -1 },
    parent: "grenade_unlock",
    maxLevel: 6,
    currency: "crystals",
    baseCost: 15,
    costMultiplier: 1.6,
    unlockLifetimePixels: 80,
    valueAt: (lvl) => Math.max(30, GRENADE.energyRequired - 8 * lvl),
    formatValue: (v) => `${v} ENERGY`,
    formatDelta: () => "-8 ENERGY",
    apply: (s, lvl) => {
      const req = Math.max(30, GRENADE.energyRequired - 8 * lvl);
      s.grenadeEnergyRequired = req;
      s.grenadeBlocksRequired = req;
    },
    icon: "fireRate",
  },
  {
    id: "grenade_damage",
    branch: "grenade",
    name: "High Explosive",
    shortDesc: "+3 center blast damage per level",
    color: "#ff5c7c",
    grid: { col: 1, row: 0 },
    parent: "grenade_unlock",
    maxLevel: 6,
    currency: "crystals",
    baseCost: 16,
    costMultiplier: 1.65,
    unlockLifetimePixels: 80,
    valueAt: (lvl) => GRENADE.damage + 3 * lvl,
    formatValue: (v) => `${v} DMG`,
    formatDelta: () => "+3 DMG",
    apply: (s, lvl) => {
      s.grenadeDamage = GRENADE.damage + 3 * lvl;
    },
    icon: "warhead",
  },
  {
    id: "grenade_radius",
    branch: "grenade",
    name: "Expanded Charge",
    shortDesc: "+0.4 cells explosion blast radius per level",
    color: "#ff9d3b",
    grid: { col: -1, row: 0 },
    parent: "grenade_unlock",
    maxLevel: 6,
    currency: "crystals",
    baseCost: 16,
    costMultiplier: 1.62,
    unlockLifetimePixels: 80,
    valueAt: (lvl) => +(GRENADE.blastRadiusCells + 0.4 * lvl).toFixed(1),
    formatValue: (v) => `${v.toFixed(1)} RAD`,
    formatDelta: () => "+0.4 RAD",
    apply: (s, lvl) => {
      s.grenadeBlastRadius = +(GRENADE.blastRadiusCells + 0.4 * lvl).toFixed(1);
    },
    icon: "blast",
  },
  {
    id: "grenade_shrapnel",
    branch: "grenade",
    name: "Shrapnel Blast",
    shortDesc: "+2 high-velocity shrapnel fragments expelled on detonation per level",
    color: "#c56bff",
    grid: { col: 0, row: 1 },
    parent: "grenade_unlock",
    maxLevel: 4,
    currency: "crystals",
    baseCost: 25,
    costMultiplier: 1.7,
    unlockLifetimePixels: 80,
    valueAt: (lvl) => 2 * lvl,
    formatValue: (v) => `${v} FRAGS`,
    formatDelta: () => "+2 FRAGS",
    apply: (s, lvl) => {
      s.grenadeShrapnel = 2 * lvl;
    },
    icon: "cluster",
  },
  {
    id: "grenade_blight_mult",
    branch: "grenade",
    name: "Thermite Core",
    shortDesc: "+0.75× damage multiplier against Blight blocks per level",
    color: "#ff4b8b",
    grid: { col: 1, row: 1 },
    parent: "grenade_damage",
    maxLevel: 4,
    currency: "crystals",
    baseCost: 18,
    costMultiplier: 1.65,
    unlockLifetimePixels: 80,
    valueAt: (lvl) => +(GRENADE.blightMultiplier + 0.75 * lvl).toFixed(2),
    formatValue: (v) => `${v}× BLIGHT`,
    formatDelta: () => "+0.75× MULT",
    apply: (s, lvl) => {
      s.grenadeBlightMult = +(GRENADE.blightMultiplier + 0.75 * lvl).toFixed(2);
    },
    icon: "blightCrack",
  },

  // =========================================================================
  // 10) TURRET TREE: SECONDARY WEAPON (#38d6ff / #ffd84d)
  // =========================================================================
  {
    id: "turret_unlock",
    branch: "turret",
    name: "Autoturret Deployer",
    shortDesc: "Unlocks the Autoturret secondary ability: deploys 2 automated defensive turrets (150 energy)",
    color: "#38d6ff",
    grid: { col: 0, row: 0 },
    parent: null,
    maxLevel: 1,
    baseCost: 150,
    costMultiplier: 1,
    unlockLifetimePixels: 80,
    valueAt: (lvl) => lvl,
    formatValue: (v) => (v > 0 ? "UNLOCKED" : "LOCKED"),
    formatDelta: () => "UNLOCK",
    apply: (s, lvl) => {
      s.turretUnlocked = lvl > 0;
    },
    icon: "turret",
  },
  {
    id: "turret_damage",
    branch: "turret",
    name: "Heavy Caliber",
    shortDesc: "+1 turret bullet damage per level",
    color: "#ff5c7c",
    grid: { col: 1, row: 0 },
    parent: "turret_unlock",
    maxLevel: 5,
    currency: "crystals",
    baseCost: 20,
    costMultiplier: 1.6,
    unlockLifetimePixels: 80,
    valueAt: (lvl) => TURRET.baseDamage + lvl,
    formatValue: (v) => `+${v} DMG`,
    formatDelta: () => "+1 DMG",
    apply: (s, lvl) => {
      s.turretDamage = TURRET.baseDamage + lvl;
    },
    icon: "impact",
  },
  {
    id: "turret_fire_rate",
    branch: "turret",
    name: "Rapid Feeder",
    shortDesc: "+20% turret fire rate per level",
    color: "#38d6ff",
    grid: { col: 0, row: -1 },
    parent: "turret_unlock",
    maxLevel: 5,
    currency: "crystals",
    baseCost: 18,
    costMultiplier: 1.55,
    unlockLifetimePixels: 80,
    valueAt: (lvl) => Math.round(TURRET.baseFireRate * (1 + 0.2 * lvl) * 10) / 10,
    formatValue: (v) => `${v}/s`,
    formatDelta: () => "+20%",
    apply: (s, lvl) => {
      s.turretFireRate = TURRET.baseFireRate * (1 + 0.2 * lvl);
    },
    icon: "fireRate",
  },
  {
    id: "turret_turn_speed",
    branch: "turret",
    name: "High-Torque Servos",
    shortDesc: "+45°/s turret tracking & lock-on speed per level",
    color: "#ffd84d",
    grid: { col: -1, row: 0 },
    parent: "turret_unlock",
    maxLevel: 5,
    currency: "crystals",
    baseCost: 15,
    costMultiplier: 1.5,
    unlockLifetimePixels: 80,
    valueAt: (lvl) => Math.round((TURRET.baseTurnSpeed + Math.PI * 0.25 * lvl) * (180 / Math.PI)),
    formatValue: (v) => `${v}°/s`,
    formatDelta: () => "+45°/s",
    apply: (s, lvl) => {
      s.turretTurnSpeed = TURRET.baseTurnSpeed + Math.PI * 0.25 * lvl;
    },
    icon: "behaviorTurns",
  },
  {
    id: "turret_quantity",
    branch: "turret",
    name: "Turret Swarm",
    shortDesc: "Deploys +1 additional autoturret per level (3, 4, 5, up to 6)",
    color: "#ff9d3b",
    grid: { col: 0, row: 1 },
    parent: "turret_unlock",
    maxLevel: 4,
    currency: "crystals",
    essenceCost: 5,
    baseCost: 60,
    costMultiplier: 2.2,
    unlockLifetimePixels: 80,
    valueAt: (lvl) => 2 + lvl,
    formatValue: (v) => `${v} TURRETS`,
    formatDelta: () => "+1 TURRET",
    apply: (s, lvl) => {
      s.turretCount = 2 + lvl;
    },
    icon: "cluster",
  },

  // =========================================================================
  // 11) RESEARCH BASE TREE: KEYCARDS & FACILITY SYSTEMS (#7fb2ff)
  // Grid: keycards along the top row, sentries on the left, mapping on the
  // right. Free cells for new facility upgrades: (2,0), (-1,1), (0,1), (1,1), (-2,1), (-1,-1).
  // =========================================================================
  {
    id: "keycard_t1",
    branch: "facility",
    name: "Tier 1 Keycard",
    shortDesc: "Tier 1 (blue) doors slide open with a single shot instead of having to be broken down",
    color: "#3078ff",
    grid: { col: 0, row: -1 },
    parent: null,
    maxLevel: 1,
    baseCost: 60,
    costMultiplier: 1,
    unlockLifetimePixels: 0,
    valueAt: (lvl) => lvl,
    formatValue: (v) => (v > 0 ? "GRANTED" : "DENIED"),
    formatDelta: () => "ACCESS",
    apply: (s, lvl) => {
      if (lvl > 0) s.keycardTier = Math.max(s.keycardTier, 1);
    },
    icon: "keycard",
  },
  {
    id: "keycard_t2",
    branch: "facility",
    name: "Tier 2 Keycard",
    shortDesc: "Tier 2 (red) doors in the second zone slide open when shot",
    color: "#ff2a2a",
    grid: { col: 1, row: -1 },
    parent: "keycard_t1",
    maxLevel: 1,
    currency: "crystals",
    baseCost: 45,
    costMultiplier: 1,
    unlockLifetimePixels: 150,
    valueAt: (lvl) => lvl,
    formatValue: (v) => (v > 0 ? "GRANTED" : "DENIED"),
    formatDelta: () => "ACCESS",
    apply: (s, lvl) => {
      if (lvl > 0) s.keycardTier = Math.max(s.keycardTier, 2);
    },
    icon: "keycard",
  },
  {
    id: "keycard_t3",
    branch: "facility",
    name: "Tier 3 Keycard",
    shortDesc: "Tier 3 (burnt orange) doors in the deepest zone slide open when shot",
    color: "#d65c12",
    grid: { col: 2, row: -1 },
    parent: "keycard_t2",
    maxLevel: 1,
    currency: "greenCrystals",
    essenceCost: 6,
    baseCost: 40,
    costMultiplier: 1,
    unlockLifetimePixels: 400,
    valueAt: (lvl) => lvl,
    formatValue: (v) => (v > 0 ? "GRANTED" : "DENIED"),
    formatDelta: () => "ACCESS",
    apply: (s, lvl) => {
      if (lvl > 0) s.keycardTier = Math.max(s.keycardTier, 3);
    },
    icon: "keycard",
  },
  {
    id: "sentry_uplink",
    branch: "facility",
    name: "Sentry Uplink",
    shortDesc: "Wakes the dormant sentry turrets: each one boots when a soldier enters its room and shoots nearby Blight",
    color: "#38d6ff",
    grid: { col: -1, row: 0 },
    parent: null,
    maxLevel: 1,
    baseCost: 140,
    costMultiplier: 1,
    unlockLifetimePixels: 60,
    valueAt: (lvl) => lvl,
    formatValue: (v) => (v > 0 ? "ONLINE" : "DORMANT"),
    formatDelta: () => "WAKE",
    apply: (s, lvl) => {
      s.sentryUplink = lvl > 0;
    },
    icon: "turret",
  },
  {
    id: "sentry_calibration",
    branch: "facility",
    name: "Sentry Calibration",
    shortDesc: "+1 sentry damage and +15% sentry fire rate per level",
    color: "#ff9d3b",
    grid: { col: -2, row: 0 },
    parent: "sentry_uplink",
    maxLevel: 5,
    currency: "crystals",
    baseCost: 20,
    costMultiplier: 1.6,
    unlockLifetimePixels: 60,
    valueAt: (lvl) => FACILITY.sentryDamage + lvl,
    formatValue: (v) => `${v} DMG`,
    formatDelta: () => "+1 DMG, +15% RATE",
    apply: (s, lvl) => {
      s.sentryDamage = FACILITY.sentryDamage + lvl;
      s.sentryFireRate = FACILITY.sentryFireRate * (1 + 0.15 * lvl);
    },
    icon: "fireRate",
  },
  {
    id: "cartography_uplink",
    branch: "facility",
    name: "Cartography Uplink",
    shortDesc: "Explored areas stay mapped: darkness no longer creeps back into places your squad has seen",
    color: "#38d6ff",
    grid: { col: 1, row: 0 },
    parent: null,
    maxLevel: 1,
    baseCost: 120,
    costMultiplier: 1,
    unlockLifetimePixels: 50,
    valueAt: (lvl) => lvl,
    formatValue: (v) => (v > 0 ? "MAPPED" : "FADES"),
    formatDelta: () => "UNLOCK",
    apply: (s, lvl) => {
      s.permanentMapping = lvl > 0;
    },
    icon: "mapGrid",
  },
];

export const UPGRADE_BY_ID: Record<UpgradeId, UpgradeDef> = Object.fromEntries(
  UPGRADE_DEFS.map((d) => [d.id, d]),
) as Record<UpgradeId, UpgradeDef>;

/** Decay events per second per dormant colony front at Necrosis Protocol level `lvl`. */
export function necrosisRate(lvl: number): number {
  return lvl <= 0 ? 0 : +(0.6 + 0.6 * (lvl - 1)).toFixed(1);
}
