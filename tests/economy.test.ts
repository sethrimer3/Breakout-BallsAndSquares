import { describe, expect, it } from "vitest";
import { Rng } from "../src/core/Rng";
import { LootSystem } from "../src/entities/LootSystem";
import { SaveManager, type StorageLike } from "../src/progression/SaveManager";
import { UPGRADE_BY_ID, type UpgradeId } from "../src/progression/UpgradeDefinitions";
import { UpgradeManager } from "../src/progression/UpgradeManager";

function economy() {
  const data = new Map<string, string>();
  const storage: StorageLike = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
  };
  const save = new SaveManager(storage);
  return { save, upgrades: new UpgradeManager(save) };
}

function zoneYield(upgrades: UpgradeManager, zone: number): number {
  const stats = upgrades.getSoldierStats();
  const bonus = zone === 1 ? stats.crystalDropBonus : zone === 2 ? stats.tier3ResourceBonus : 0;
  return stats.dropChance * (1 + bonus);
}

describe("Resource progression balance", () => {
  it("gives a fresh player enough drops for a starter combat upgrade without buying income first", () => {
    const { upgrades } = economy();
    const rng = new Rng(121);
    const loot = new LootSystem();
    let drops = 0;
    // An equal-work budget, independent of weapon damage and run duration.
    for (let i = 0; i < 100; i++) {
      drops += loot.spawnDropsForBlock(0, 0, upgrades.getSoldierStats().dropChance, 6, rng);
    }
    expect(drops).toBeGreaterThanOrEqual(upgrades.costOf("fire_rate"));
    expect(drops).toBeLessThan(60);
  });

  it("keeps each resource purchase below a 13% income jump at every level", () => {
    const { save, upgrades } = economy();
    const ids: UpgradeId[] = ["drop_chance", "multi_drop", "tier2_crystal_yield",
      "tier2_crystal_refinery", "tier3_dark_matter", "tier3_quantum_extractor"];
    for (const id of ids) {
      for (let level = 0; level < UPGRADE_BY_ID[id].maxLevel; level++) {
        save.data.upgrades[id] = level;
        const before = [0, 1, 2].map((zone) => zoneYield(upgrades, zone));
        save.data.upgrades[id] = level + 1;
        for (const zone of [0, 1, 2]) {
          const ratio = zoneYield(upgrades, zone) / before[zone];
          expect(ratio).toBeGreaterThanOrEqual(1);
          expect(ratio).toBeLessThanOrEqual(1.13);
        }
      }
    }
  });

  it("bounds fully upgraded income for the same blocks instead of multiplying it twentyfold", () => {
    const { save, upgrades } = economy();
    const baseline = zoneYield(upgrades, 0);
    for (const def of upgrades.defs.filter((def) => def.branch === "resources")) {
      save.data.upgrades[def.id] = def.maxLevel;
    }
    // Gold still grows meaningfully; deeper-zone investments have extra headroom.
    expect(zoneYield(upgrades, 0) / baseline).toBeGreaterThan(3);
    expect(zoneYield(upgrades, 0) / baseline).toBeLessThanOrEqual(4);
    expect(zoneYield(upgrades, 1) / baseline).toBeLessThan(9);
    expect(zoneYield(upgrades, 2) / baseline).toBeLessThan(9);
    // Multi-Drop's displayed multiplier must match its actual yield.
    const withMulti = zoneYield(upgrades, 0);
    save.data.upgrades.multi_drop = 0;
    expect(withMulti / zoneYield(upgrades, 0)).toBeCloseTo(
      UPGRADE_BY_ID.multi_drop.valueAt(UPGRADE_BY_ID.multi_drop.maxLevel),
    );
  });

  it("makes later income levels take more blocks to repay, even with the other income node maxed", () => {
    const { save, upgrades } = economy();
    for (const id of ["drop_chance", "multi_drop"] as const) {
      const other = id === "drop_chance" ? "multi_drop" : "drop_chance";
      save.data.upgrades[other] = UPGRADE_BY_ID[other].maxLevel;
      let previousPayback = 0;
      for (let level = 0; level < UPGRADE_BY_ID[id].maxLevel; level++) {
        save.data.upgrades[id] = level;
        const before = zoneYield(upgrades, 0);
        const cost = upgrades.costOf(id);
        save.data.upgrades[id]++;
        const payback = cost / (zoneYield(upgrades, 0) - before);
        expect(payback).toBeGreaterThan(previousPayback);
        previousPayback = payback;
      }
    }
  });
});
