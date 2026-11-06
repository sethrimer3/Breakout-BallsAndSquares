import type { SpriteName } from "../ui/pixelArt";
import type { TreeNodeDef } from "./UpgradeDefinitions";

/**
 * Each soldier's own upgrade tree. Four arms grow out of the soldier: a Tier 1
 * node paid in gold, a Tier 2 node paid in orange crystals, and a Tier 3 node
 * paid in green crystals, the strongest of the three. Every node also costs
 * Blight Essence, more at each tier and each level. Levels live on the
 * soldier's loadout slot, so two soldiers can be built differently.
 */

export type SoldierUpgradeId =
  | "s_marksman"
  | "s_rate"
  | "s_stride"
  | "s_vitality"
  | "s_penetrator"
  | "s_blight_hunter"
  | "s_scavenger"
  | "s_bulwark"
  | "s_twin_fire"
  | "s_overdrive"
  | "s_deep_harvest"
  | "s_aegis";

export type SoldierTier = 1 | 2 | 3;

/** What one soldier's tree adds on top of the squad's shared stats. */
export interface SoldierMods {
  speedMult: number;
  fireRateMult: number;
  damageBonus: number;
  healthBonus: number;
  /** Extra blocks pierced by bullets and slashes (not explosives). */
  pierce: number;
  /** Damage multiplier against Blight blocks for bullets, slashes and rockets. */
  blightMult: number;
  magnetMult: number;
  /** Multiplier on the drop chance of blocks this soldier destroys. */
  dropMult: number;
  /** Chance each shot immediately fires again. */
  twinChance: number;
}

export function baseSoldierMods(): SoldierMods {
  return {
    speedMult: 1,
    fireRateMult: 1,
    damageBonus: 0,
    healthBonus: 0,
    pierce: 0,
    blightMult: 1,
    magnetMult: 1,
    dropMult: 1,
    twinChance: 0,
  };
}

export interface SoldierUpgradeDef extends TreeNodeDef<SoldierUpgradeId> {
  tier: SoldierTier;
  apply(mods: SoldierMods, level: number): void;
}

const TIERS = {
  1: { currency: "gold", color: "#ffd84d", baseCost: 150, costMultiplier: 1.6, essenceCost: 2 },
  2: { currency: "crystals", color: "#ff8c2e", baseCost: 40, costMultiplier: 1.6, essenceCost: 6 },
  3: { currency: "greenCrystals", color: "#52f296", baseCost: 30, costMultiplier: 1.7, essenceCost: 15 },
} as const;

interface NodeSpec {
  id: SoldierUpgradeId;
  tier: SoldierTier;
  col: number;
  row: number;
  parent: SoldierUpgradeId | null;
  maxLevel: number;
  name: string;
  shortDesc: string;
  icon: SpriteName;
  valueAt(level: number): number;
  formatValue(v: number): string;
  delta: string;
  apply(mods: SoldierMods, level: number): void;
}

function node(spec: NodeSpec): SoldierUpgradeDef {
  return {
    id: spec.id,
    tier: spec.tier,
    name: spec.name,
    shortDesc: spec.shortDesc,
    grid: { col: spec.col, row: spec.row },
    parent: spec.parent,
    maxLevel: spec.maxLevel,
    unlockLifetimePixels: 0,
    icon: spec.icon,
    valueAt: spec.valueAt,
    formatValue: spec.formatValue,
    formatDelta: () => spec.delta,
    apply: spec.apply,
    ...TIERS[spec.tier],
  };
}

const percent = (v: number): string => `${v}%`;
const health = (v: number): string => `+${v} HP`;

export const SOLDIER_UPGRADE_DEFS: readonly SoldierUpgradeDef[] = [
  // Tier 1: gold.
  node({
    id: "s_marksman", tier: 1, col: 0, row: -1, parent: null, maxLevel: 5,
    name: "Marksman", shortDesc: "+1 damage on this soldier's shots", icon: "impact",
    valueAt: (l) => l, formatValue: (v) => `+${v} DMG`, delta: "+1 DMG",
    apply: (m, l) => { m.damageBonus += l; },
  }),
  node({
    id: "s_rate", tier: 1, col: 1, row: 0, parent: null, maxLevel: 5,
    name: "Trigger Discipline", shortDesc: "+6% fire rate for this soldier", icon: "fireRate",
    valueAt: (l) => 100 + 6 * l, formatValue: percent, delta: "+6%",
    apply: (m, l) => { m.fireRateMult *= 1 + 0.06 * l; },
  }),
  node({
    id: "s_stride", tier: 1, col: -1, row: 0, parent: null, maxLevel: 5,
    name: "Long Stride", shortDesc: "+6% movement speed for this soldier", icon: "soldierDash",
    valueAt: (l) => 100 + 6 * l, formatValue: percent, delta: "+6%",
    apply: (m, l) => { m.speedMult *= 1 + 0.06 * l; },
  }),
  node({
    id: "s_vitality", tier: 1, col: 0, row: 1, parent: null, maxLevel: 5,
    name: "Hardened Shell", shortDesc: "+10 HP for this soldier, spent escaping Blight", icon: "soldierPlus",
    valueAt: (l) => 10 * l, formatValue: health, delta: "+10 HP",
    apply: (m, l) => { m.healthBonus += 10 * l; },
  }),

  // Tier 2: orange crystals.
  node({
    id: "s_penetrator", tier: 2, col: 1, row: -1, parent: "s_marksman", maxLevel: 3,
    name: "Penetrator Drill", shortDesc: "+1 block pierce on this soldier's bullets and slashes", icon: "pierce",
    valueAt: (l) => l, formatValue: (v) => `+${v} PIERCE`, delta: "+1 PIERCE",
    apply: (m, l) => { m.pierce += l; },
  }),
  node({
    id: "s_blight_hunter", tier: 2, col: 2, row: 0, parent: "s_rate", maxLevel: 4,
    name: "Blight Hunter", shortDesc: "+25% damage against Blight blocks", icon: "blightCrack",
    valueAt: (l) => 100 + 25 * l, formatValue: percent, delta: "+25%",
    apply: (m, l) => { m.blightMult *= 1 + 0.25 * l; },
  }),
  node({
    id: "s_scavenger", tier: 2, col: -2, row: 0, parent: "s_stride", maxLevel: 4,
    name: "Scavenger", shortDesc: "+30% magnet range around this soldier", icon: "magnet",
    valueAt: (l) => 100 + 30 * l, formatValue: percent, delta: "+30%",
    apply: (m, l) => { m.magnetMult *= 1 + 0.3 * l; },
  }),
  node({
    id: "s_bulwark", tier: 2, col: -1, row: 1, parent: "s_vitality", maxLevel: 4,
    name: "Bulwark Plating", shortDesc: "+25 HP for this soldier", icon: "blightShield",
    valueAt: (l) => 25 * l, formatValue: health, delta: "+25 HP",
    apply: (m, l) => { m.healthBonus += 25 * l; },
  }),

  // Tier 3: green crystals.
  node({
    id: "s_twin_fire", tier: 3, col: 2, row: -1, parent: "s_penetrator", maxLevel: 3,
    name: "Twin Fire", shortDesc: "+12% chance each shot fires a second time", icon: "fan",
    valueAt: (l) => 12 * l, formatValue: percent, delta: "+12%",
    apply: (m, l) => { m.twinChance += 0.12 * l; },
  }),
  node({
    id: "s_overdrive", tier: 3, col: 2, row: 1, parent: "s_blight_hunter", maxLevel: 3,
    name: "Overdrive", shortDesc: "+20% fire rate on top of everything else", icon: "cluster",
    valueAt: (l) => 100 + 20 * l, formatValue: percent, delta: "+20%",
    apply: (m, l) => { m.fireRateMult *= 1 + 0.2 * l; },
  }),
  node({
    id: "s_deep_harvest", tier: 3, col: -2, row: -1, parent: "s_scavenger", maxLevel: 3,
    name: "Deep Harvest", shortDesc: "+25% drop chance on blocks this soldier destroys", icon: "goldStack",
    valueAt: (l) => 100 + 25 * l, formatValue: percent, delta: "+25%",
    apply: (m, l) => { m.dropMult *= 1 + 0.25 * l; },
  }),
  node({
    id: "s_aegis", tier: 3, col: -2, row: 1, parent: "s_bulwark", maxLevel: 3,
    name: "Aegis Protocol", shortDesc: "+60 HP for this soldier", icon: "stabilizer",
    valueAt: (l) => 60 * l, formatValue: health, delta: "+60 HP",
    apply: (m, l) => { m.healthBonus += 60 * l; },
  }),
];

export const SOLDIER_UPGRADE_BY_ID: Record<SoldierUpgradeId, SoldierUpgradeDef> = Object.fromEntries(
  SOLDIER_UPGRADE_DEFS.map((d) => [d.id, d]),
) as Record<SoldierUpgradeId, SoldierUpgradeDef>;

/** A soldier's levels: only the nodes they have bought. */
export type SoldierUpgradeLevels = Partial<Record<SoldierUpgradeId, number>>;

export function soldierModsFor(levels: SoldierUpgradeLevels | undefined): SoldierMods {
  const mods = baseSoldierMods();
  if (!levels) return mods;
  for (const def of SOLDIER_UPGRADE_DEFS) {
    const level = levels[def.id] ?? 0;
    if (level > 0) def.apply(mods, level);
  }
  return mods;
}
