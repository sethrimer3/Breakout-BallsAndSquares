import { LootKind, type LootKind as Kind } from "../entities/LootSystem";

/** Initial pacing pass. Encounter rewards are fixed, never multiplied by income upgrades. */
export const CAMPAIGN = {
  7: {
    block: [800, 2400],
    kind: LootKind.Gold,
    stack: 10,
    enemyHp: 0,
    damage: 0,
    essence: 0,
    nodes: 6,
    biomass: 25,
  },
  8: {
    block: [3000, 9000],
    kind: LootKind.Crystal,
    stack: 10,
    enemyHp: 220,
    damage: 24,
    essence: 200,
    nodes: 3,
    biomass: 40,
  },
  9: {
    block: [12000, 30000],
    kind: LootKind.GreenCrystal,
    stack: 10,
    enemyHp: 900,
    damage: 40,
    essence: 400,
    nodes: 2,
    biomass: 60,
  },
  10: {
    block: [24000, 45000],
    kind: LootKind.Crystal,
    stack: 25,
    enemyHp: 1800,
    damage: 65,
    essence: 600,
    nodes: 1,
    biomass: 0,
  },
  11: {
    block: [50000, 65000],
    kind: LootKind.GreenCrystal,
    stack: 50,
    enemyHp: 3600,
    damage: 100,
    essence: 1200,
    nodes: 1,
    biomass: 0,
  },
} as const;
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
