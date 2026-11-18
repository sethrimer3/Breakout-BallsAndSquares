import { describe, expect, it } from "vitest";
import { DAMAGE_ROLL, tierHealth } from "../src/config";
import { LootKind } from "../src/entities/LootSystem";
import { SaveManager, type StorageLike } from "../src/progression/SaveManager";
import { CALIBRATION_DEFS, UPGRADE_BY_ID, type Currency } from "../src/progression/UpgradeDefinitions";
import { UpgradeManager } from "../src/progression/UpgradeManager";
import { lateBlockReward } from "../src/world/campaignBalance";
import { PixelWorld } from "../src/world/PixelWorld";
import {
  CALIBRATION,
  calibrationAt,
  tierLootValue,
  worldLootKind,
  worldOfTier,
} from "../src/world/tierEconomy";

/** A Lab-upgraded pistol shot: 1 base + 8 Bullet Damage + 5 Marksman. */
const REFERENCE_SHOT = 14;
/** A roll averages the middle of DAMAGE_ROLL. */
const AVERAGE_ROLL = (DAMAGE_ROLL.min + DAMAGE_ROLL.max) / 2;
const hits = (tier: number, mult: number): number => tierHealth(tier) / (REFERENCE_SHOT * AVERAGE_ROLL * mult);
const CURRENCY_OF: Record<number, Currency> = {
  [LootKind.Gold]: "gold",
  [LootKind.Crystal]: "crystals",
  [LootKind.GreenCrystal]: "greenCrystals",
  [LootKind.Essence]: "essence",
};
const WORLD_TIERS: Record<number, [number, number]> = { 1: [1, 3], 2: [4, 6], 3: [7, 9], 4: [10, 10], 5: [11, 11] };

describe("Tier balance", () => {
  it("drops each world's own currency, in bigger stacks at each deeper tier of that world", () => {
    expect([1, 2, 3, 4, 5].map(worldLootKind)).toEqual([
      LootKind.Gold, LootKind.Crystal, LootKind.GreenCrystal, LootKind.Essence, LootKind.Essence,
    ]);
    for (let tier = 7; tier <= 11; tier++) expect(lateBlockReward(tier).kind, `tier ${tier}`).toBe(worldLootKind(worldOfTier(tier)));
    for (const [first, last] of Object.values(WORLD_TIERS)) {
      for (let t = first + 1; t <= last; t++) expect(tierLootValue(t)).toBeGreaterThan(tierLootValue(t - 1));
    }
  });

  it("prices each Calibration stage in its own world's currency", () => {
    CALIBRATION_DEFS.forEach((def, i) => {
      expect(def.currency ?? "gold", def.id).toBe(CURRENCY_OF[worldLootKind(CALIBRATION[i].world)]);
    });
  });

  it("keeps a calibrated squad at a handful of hits per block in every world", () => {
    for (const stage of CALIBRATION) {
      const [, last] = WORLD_TIERS[stage.world];
      // Fully calibrated for this world: its hardest tier takes about five shots.
      const done = hits(last, calibrationAt(stage.world, stage.levels));
      expect(done, `world ${stage.world} calibrated`).toBeGreaterThanOrEqual(3);
      expect(done, `world ${stage.world} calibrated`).toBeLessThanOrEqual(7);
    }
    // Arriving with only the last world's calibration is a wall, but a climbable one.
    for (const stage of CALIBRATION.slice(1)) {
      const [first] = WORLD_TIERS[stage.world];
      const arrival = hits(first, calibrationAt(stage.world, 0));
      expect(arrival, `world ${stage.world} arrival`).toBeGreaterThan(4);
      expect(arrival, `world ${stage.world} arrival`).toBeLessThan(40);
    }
    // Uncalibrated, the Lab's last tier still reads as the old game did (~20 shots).
    expect(hits(3, 1)).toBeGreaterThan(15);
  });

  it("multiplies squad damage against terrain and Blight, never bulkheads or the Blight's own spread", () => {
    const w = new PixelWorld({ width: 16, height: 16, cellSize: 8, roomSize: 4 });
    w.playerDamageMult = 10;
    const at = (x: number) => 4 * w.width + x;
    for (const x of [2, 3, 4]) w.health[at(x)] = 1000;
    w.armored[at(3)] = 1;
    w.damage(2, 4, 7, true);
    w.damage(3, 4, 7, true);
    w.damage(4, 4, 7, false);
    expect(w.health[at(2)]).toBe(1000 - 70);
    expect(w.health[at(3)]).toBe(1000 - 7);
    expect(w.health[at(4)]).toBe(1000 - 7);
    // The Siege Drill's bonus only lands on armored cells.
    expect(w.breachBonus(3, 4, 2000)).toBe(2000);
    expect(w.breachBonus(2, 4, 2000)).toBe(0);
  });

  it("gives every block of a tier the same health and rolls each squad hit between min and max", () => {
    const w = new PixelWorld({ width: 16, height: 16, cellSize: 8, roomSize: 4 });
    w.damageRollMin = DAMAGE_ROLL.min;
    w.damageRollMax = DAMAGE_ROLL.max;
    const seen = new Set<number>();
    for (let k = 0; k < 400; k++) {
      w.health[0] = 1000;
      w.damage(0, 0, 1, true);
      seen.add(1000 - w.health[0]);
    }
    expect(Math.min(...seen)).toBe(1);
    expect(Math.max(...seen)).toBe(5);
    expect(seen.size).toBe(5);
    expect(tierHealth(4, 0)).toBe(tierHealth(4, 1));
  });

  it("stacks every bought Calibration stage into the squad's terrain multiplier", () => {
    const data = new Map<string, string>();
    const storage: StorageLike = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } };
    const save = new SaveManager(storage);
    const upgrades = new UpgradeManager(save);
    save.data.upgrades.unlock_primary = 1;
    save.data.bank = 1e6;
    expect(upgrades.canBuy("calibration_2")).toBe(false);
    expect(upgrades.buy("calibration_1")).toBe(true);
    // Stage II needs stage I and orange crystals, which only the Blighted Wards drop.
    expect(upgrades.canBuy("calibration_2")).toBe(false);
    save.data.crystals = 1e6;
    expect(upgrades.buy("calibration_2")).toBe(true);
    const mult = upgrades.getSoldierStats().terrainDamageMult;
    expect(mult).toBeCloseTo(CALIBRATION[0].perLevel * CALIBRATION[1].perLevel);
    expect(UPGRADE_BY_ID.calibration_5.maxLevel).toBe(CALIBRATION[4].levels);
  });
});
