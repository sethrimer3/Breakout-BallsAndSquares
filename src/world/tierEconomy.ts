import { LootKind } from "../entities/LootSystem";

/**
 * The campaign economy, world by world. See docs/BALANCE.md for the reasoning.
 *
 * Each world's terrain drops its own currency, and only that world drops it:
 * the Lab (tiers 1-3) gold, the Blighted Wards (4-6) orange crystals, the
 * Canopy Forest (7-9) green crystals (plus grove biomass), the Fallen City
 * (10) and the Mothership (11) Blight Essence. Within a world each deeper tier
 * pays a bigger stack per pickup, so the tier that is hardest to dig also
 * funds the upgrades that make it easy.
 */
export const WORLD_LOOT: Readonly<Record<number, LootKind>> = {
  1: LootKind.Gold,
  2: LootKind.Crystal,
  3: LootKind.GreenCrystal,
  4: LootKind.Essence,
  5: LootKind.Essence,
};

/** The currency a world's terrain drops. */
export function worldLootKind(worldId: number): LootKind {
  return WORLD_LOOT[worldId] ?? LootKind.Gold;
}

/** Which world a terrain tier belongs to. */
export function worldOfTier(tier: number): number {
  if (tier <= 3) return 1;
  if (tier <= 6) return 2;
  if (tier <= 9) return 3;
  return tier === 10 ? 4 : 5;
}

/**
 * Currency per pickup from an ordinary block of each tier (index = tier).
 * Lab worlds (1-6) roll their usual drop chance, then each pickup is worth
 * this much. Late worlds (7-11) roll a fixed 12% chance for one stack.
 */
export const TIER_LOOT_VALUE: readonly number[] = [1, 1, 3, 8, 1, 3, 8, 10, 25, 60, 30, 75];

export function tierLootValue(tier: number): number {
  return TIER_LOOT_VALUE[Math.max(1, Math.min(TIER_LOOT_VALUE.length - 1, tier))];
}

/** A crystal vein cell pays this many pickups (before drop upgrades), each worth its tier's value. */
export const VEIN_DROPS = 2.5;

/**
 * Arsenal Calibration: the squad's damage multiplier against terrain and the
 * Blight, bought one world at a time in that world's currency. Bulkheads are
 * armored against it (only the Siege Drill helps there) and enemies are not
 * affected (Blight Executioner covers them).
 */
export interface CalibrationStage {
  world: number;
  levels: number;
  /** Damage multiplier gained per level (multiplicative). */
  perLevel: number;
}

export const CALIBRATION: readonly CalibrationStage[] = [
  { world: 1, levels: 5, perLevel: 1.3 },
  { world: 2, levels: 10, perLevel: 1.55 },
  { world: 3, levels: 4, perLevel: 1.18 },
  { world: 4, levels: 3, perLevel: 1.08 },
  { world: 5, levels: 3, perLevel: 1.05 },
];

/** Total terrain damage multiplier for calibration levels per stage (index 0 = world 1). */
export function calibrationMult(levels: readonly number[]): number {
  let m = 1;
  CALIBRATION.forEach((stage, i) => {
    const l = Math.max(0, Math.min(stage.levels, levels[i] ?? 0));
    m *= Math.pow(stage.perLevel, l);
  });
  return m;
}

/** The multiplier with every stage before `world` maxed and `level` levels into that world's stage. */
export function calibrationAt(world: number, level: number): number {
  return calibrationMult(CALIBRATION.map((s, i) => (i + 1 < world ? s.levels : i + 1 === world ? level : 0)));
}
