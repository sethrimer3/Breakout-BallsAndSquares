import { SOLDIER_SHAPES, soldierShapeIndex } from "../entities/soldierShapes";
import type { TreeNodeDef } from "./UpgradeDefinitions";

export type LatentUpgradeId = "latent_unlock" | "latent_resources" | "latent_magnet" | "latent_cadence"
  | "latent_armor" | "latent_aura_damage" | "latent_aura_range" | "latent_size"
  | "latent_rebound" | "latent_blast_damage" | "latent_blast_range" | "latent_wingmen" | "latent_tracking";
export type LatentLevels = Partial<Record<LatentUpgradeId, number>>;
type LatentDef = TreeNodeDef<LatentUpgradeId>;

const color = "#ff77ad";
const percent = (value: number) => `+${Math.round(value)}%`;
const unlock: LatentDef = {
  id: "latent_unlock", name: "AWAKEN", shortDesc: "Use one Exotic Matter DNA to activate this soldier's latent ability.",
  grid: { col: 0, row: 0 }, parent: null, maxLevel: 1, icon: "soldier",
  color, currency: "exoticMatter", baseCost: 1, costMultiplier: 1,
  valueAt: (rank) => rank, formatValue: (value) => value ? "Awakened" : "Dormant", formatDelta: () => "Activate ability",
};

function rank(
  id: LatentUpgradeId, name: string, shortDesc: string, icon: LatentDef["icon"],
  col: number, row: number, maxLevel: number, initial: number, step: number, unit: (value: number) => string = percent,
): LatentDef {
  return {
    id, name, shortDesc, icon, color, grid: { col, row }, parent: "latent_unlock", maxLevel,
    currency: "essence", baseCost: 10, costMultiplier: 1.3,
    valueAt: (level) => initial + step * level,
    formatValue: unit, formatDelta: () => id === "latent_blast_range" ? `+${step} cells` : percent(step),
  };
}

const byShape: Readonly<Record<string, readonly LatentDef[]>> = {
  sphere: [
    rank("latent_resources", "SCAVENGER", "Earn more from resources this soldier personally collects.", "gold", -1, 0, 9, 5, 5),
    rank("latent_magnet", "ATTRACTION", "Pull resources in from farther away.", "crystal", 1, 0, 9, 5, 5),
  ],
  triangle: [
    rank("latent_cadence", "RAPID FIRE", "Increase the soldier's firing rate.", "pistol", 0, -1, 9, 5, 5),
  ],
  square: [
    rank("latent_armor", "BULWARK", "Increase effective toughness. At +100% toughness incoming damage is halved.", "soldier", 0, -1, 9, 10, 10),
  ],
  pentagon: [
    rank("latent_aura_damage", "VULNERABILITY", "Terrain and enemies inside the aura take more damage from the squad.", "warn", -1, 0, 9, 5, 5),
    rank("latent_aura_range", "FIELD EXPANSION", "Increase the range of the vulnerability aura.", "ring", 1, 0, 10, 0, 10),
  ],
  hexagon: [
    rank("latent_size", "OVERSIZED ORDNANCE", "Increase projectile size and blast radius.", "grenade", 0, -1, 9, 10, 10),
  ],
  chevron: [
    rank("latent_rebound", "RICOCHET DRIVE", "Gain speed on a rebound. The boost fades over one second.", "soldierDash", 0, -1, 9, 5, 5),
    rank("latent_blast_damage", "IMPACT CHARGE", "Bounce blast damage as a percentage of the equipped weapon's damage.", "grenade", -1, 0, 4, 10, 10, (value) => `${value}% weapon damage`),
    rank("latent_blast_range", "SHOCKWAVE", "Increase the bounce blast radius.", "ring", 1, 0, 4, 1.5, 0.25, (value) => `${value} cells`),
  ],
  rhombus: [
    rank("latent_wingmen", "TIGHT FORMATION", "Bring both wingmen closer to the diamond to keep their shots together in narrow passages.", "soldier", -1, 0, 5, 0, 5, (value) => `${value}% closer`),
    rank("latent_tracking", "FORMATION CONTROL", "Both wingmen recover their firing positions more quickly after turns. Each fires at half damage.", "soldierDash", 1, 0, 4, 0, 25),
  ],
};

const trees = Object.fromEntries(Object.entries(byShape).map(([shape, defs]) => [shape, [unlock, ...defs]]));
export const LATENT_DEFS = [unlock, ...Object.values(byShape).flat()];
export const LATENT_BY_ID = new Map(LATENT_DEFS.map((def) => [def.id, def]));

export function latentTree(slot: number): readonly LatentDef[] {
  return trees[SOLDIER_SHAPES[soldierShapeIndex(slot)].name] ?? [];
}

export function latentValue(slot: number, levels: LatentLevels | undefined, id: LatentUpgradeId): number {
  if (!levels?.latent_unlock) return 0;
  const def = latentTree(slot).find((node) => node.id === id);
  return def?.valueAt(levels[id] ?? 0) ?? 0;
}
