import { LootKind, type LootKind as Kind } from "../entities/LootSystem";

/**
 * Late-world pacing. Encounter rewards are fixed, never multiplied by income
 * upgrades. Terrain keeps climbing past tier 6 (see docs/BALANCE.md) and drops
 * only its world's currency: green crystals in the forest, Blight Essence in
 * the city and the ship. Keep `block` in step with TIER_HEALTH in config.ts.
 */
export const CAMPAIGN = {
  7: {
    block: [16000, 32000],
    kind: LootKind.GreenCrystal,
    stack: 10,
    enemyHp: 0,
    damage: 0,
    essence: 0,
    nodes: 6,
    biomass: 25,
  },
  8: {
    block: [22000, 40000],
    kind: LootKind.GreenCrystal,
    stack: 25,
    enemyHp: 220,
    damage: 24,
    essence: 200,
    nodes: 3,
    biomass: 40,
  },
  9: {
    block: [30000, 50000],
    kind: LootKind.GreenCrystal,
    stack: 60,
    enemyHp: 900,
    damage: 40,
    essence: 400,
    nodes: 2,
    biomass: 60,
  },
  10: {
    block: [40000, 58000],
    kind: LootKind.Essence,
    stack: 30,
    enemyHp: 1800,
    damage: 65,
    essence: 600,
    nodes: 1,
    biomass: 0,
  },
  11: {
    block: [48000, 65000],
    kind: LootKind.Essence,
    stack: 75,
    enemyHp: 3600,
    damage: 100,
    essence: 1200,
    nodes: 1,
    biomass: 0,
  },
} as const;
/** Chance an ordinary late-world block drops its stack (before the currency's yield bonus). */
export const LATE_DROP_CHANCE = 0.12;
/** A gathered grove also pays a one-time cache of this many of its tier's stacks. */
export const GROVE_CACHE_STACKS = 2;
export type LateTier = keyof typeof CAMPAIGN;
export function campaignTier(tier: number): LateTier {
  return Math.max(7, Math.min(11, tier)) as LateTier;
}
export function lateBlockHealth(tier: number, progress: number): number {
  const [lo, hi] = CAMPAIGN[campaignTier(tier)].block;
  return Math.round(lo + (hi - lo) * Math.max(0, Math.min(1, progress)));
}
export function lateBlockReward(tier: number): { kind: Kind; value: number } {
  const p = CAMPAIGN[campaignTier(tier)];
  return { kind: p.kind, value: p.stack };
}
