import { SOLDIER } from "../config";
import type { SoldierStats } from "../entities/Soldier";

export type UpgradeId =
  | "ball_speed"
  | "fire_rate"
  | "bullet_speed"
  | "bullet_damage"
  | "multishot"
  | "extra_soldier";

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  shortDesc: string;
  /** Category color accent (hex). */
  color: string;
  /** Grid coordinates on the upgrade tree (0,0 is center core). */
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
  {
    id: "ball_speed",
    name: "Ball Speed",
    shortDesc: "+10% movement velocity per level",
    color: "#38d6ff",
    grid: { col: -1, row: 0 },
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
    id: "fire_rate",
    name: "Fire Rate",
    shortDesc: "+12% shots/second per level",
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
    name: "Bullet Speed",
    shortDesc: "+8% projectile velocity per level",
    color: "#52f296",
    grid: { col: 1, row: 0 },
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
    name: "Bullet Damage",
    shortDesc: "+1 terrain damage per bullet",
    color: "#ff5c7c",
    grid: { col: 0, row: 1 },
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
    name: "Multishot",
    shortDesc: "+5% chance to fire twin side rounds (±8°)",
    color: "#c56bff",
    grid: { col: 1, row: -1 },
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
  {
    id: "extra_soldier",
    name: "Additional Soldier",
    shortDesc: "+1 deployable soldier ball per run",
    color: "#f472d0",
    grid: { col: 1, row: 1 },
    parent: "bullet_damage",
    maxLevel: 7,
    baseCost: 100,
    costMultiplier: 2.0,
    unlockLifetimePixels: 100,
    valueAt: (lvl) => SOLDIER.maxSoldiers + lvl,
    formatValue: (v) => `${v} BALLS`,
    formatDelta: () => "+1 BALL",
    apply: (s, lvl) => {
      s.maxSoldiers = SOLDIER.maxSoldiers + lvl;
    },
    iconSvg: `<circle cx="10" cy="13" r="5" fill="currentColor"/><path d="M18 5v6M15 8h6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`,
  },
];

export const UPGRADE_BY_ID: Record<UpgradeId, UpgradeDef> = Object.fromEntries(
  UPGRADE_DEFS.map((d) => [d.id, d]),
) as Record<UpgradeId, UpgradeDef>;
