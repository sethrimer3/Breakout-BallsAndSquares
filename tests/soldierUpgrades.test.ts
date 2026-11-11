import { unlockTabs } from "./helpers/progression";
import { describe, expect, it } from "vitest";
import { growthRateAt, LOOT } from "../src/config";
import { Rng } from "../src/core/Rng";
import { LootKind, lootKindForZone, LootSystem } from "../src/entities/LootSystem";
import { Soldier } from "../src/entities/Soldier";
import { SaveManager, sanitizeSaveData, type StorageLike } from "../src/progression/SaveManager";
import { SOLDIER_UPGRADE_DEFS, soldierModsFor } from "../src/progression/SoldierUpgrades";
import { UPGRADE_BY_ID, upgradePrices } from "../src/progression/UpgradeDefinitions";
import { UpgradeManager } from "../src/progression/UpgradeManager";
import { CombatSystem } from "../src/systems/CombatSystem";
import { PixelWorld } from "../src/world/PixelWorld";

class MemStorage implements StorageLike {
  map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
}

function fresh(): { save: SaveManager; upg: UpgradeManager } {
  const save = new SaveManager(new MemStorage());
  save.data.lifetimePixels = 100_000;
  unlockTabs(save);
  return { save, upg: new UpgradeManager(save) };
}

describe("Currencies on the Upgrade Matrix", () => {
  it("prices secondary weapons and special weapon upgrades in orange crystals", () => {
    for (const id of [
      "ar_pierce",
      "rocket_radius",
      "rocket_cluster",
      "sniper_pierce",
      "sniper_crit",
      "katana_pierce",
      "grenade_charge",
      "grenade_damage",
      "grenade_radius",
      "grenade_shrapnel",
      "grenade_blight_mult",
    ] as const) {
      expect(UPGRADE_BY_ID[id].currency, id).toBe("crystals");
    }
    // Plain upgrades and weapon unlocks stay on gold.
    for (const id of ["ar_unlock", "ar_fire_rate", "grenade_unlock", "rocket_damage"] as const) {
      expect(UPGRADE_BY_ID[id].currency ?? "gold", id).toBe("gold");
    }
  });

  it("spends crystals, not gold, on a crystal node", () => {
    const { save, upg } = fresh();
    save.data.bank = 100_000;
    expect(upg.buy("ar_unlock")).toBe(true);
    const bankAfterUnlock = save.data.bank;
    expect(upg.canBuy("ar_pierce")).toBe(false);
    save.data.crystals = upg.costOf("ar_pierce");
    expect(upg.buy("ar_pierce")).toBe(true);
    expect(save.data.crystals).toBe(0);
    expect(save.data.bank).toBe(bankAfterUnlock);
  });
});

describe("Soldier upgrade trees", () => {
  it("keeps every arm in tier order, with the essence price rising each tier", () => {
    for (const def of SOLDIER_UPGRADE_DEFS) {
      const expected = { 1: "gold", 2: "crystals", 3: "greenCrystals", 4: "biomass" }[def.tier];
      expect(def.currency, def.id).toBe(expected);
      if (def.tier === 1) expect(def.parent, def.id).toBeNull();
      else expect(SOLDIER_UPGRADE_DEFS.find((d) => d.id === def.parent)?.tier, def.id).toBe(def.tier - 1);
    }
    const essenceAt = (tier: number): number => {
      const def = SOLDIER_UPGRADE_DEFS.find((d) => d.tier === tier)!;
      return upgradePrices(def, 0).find((p) => p.currency === "essence")?.amount ?? 0;
    };
    expect(essenceAt(2)).toBeGreaterThan(essenceAt(1));
    expect(essenceAt(3)).toBeGreaterThan(essenceAt(2));
    const def = SOLDIER_UPGRADE_DEFS.find((d) => d.id === "s_dynamo")!;
    expect(upgradePrices(def, 1)[1].amount).toBeGreaterThan(upgradePrices(def, 0)[1].amount);
  });

  it("lets starter upgrades cost gold only and keeps soldiers separate", () => {
    const { save, upg } = fresh();
    save.data.bank = 100_000;
    expect(upg.soldierBuy(0, "s_marksman")).toBe(true);
    expect(save.data.essence).toBe(0);
    expect(save.data.bank).toBe(100_000 - 25);
    expect(upg.soldierLevelOf(0, "s_marksman")).toBe(1);
    expect(upg.soldierLevelOf(1, "s_marksman")).toBe(0);
    expect(upg.soldierMods(0).damageBonus).toBe(1);
    expect(upg.soldierMods(1).damageBonus).toBe(0);
    save.data.crystals = 1000;
    expect(upg.soldierCanBuy(0, "s_penetrator")).toBe(false); // higher tiers still require essence
    save.data.essence = 6;
    expect(upg.soldierCanBuy(0, "s_penetrator")).toBe(true);
  });

  it("opens the next tier only once the arm's previous node is owned", () => {
    const { save, upg } = fresh();
    save.data.bank = 100_000;
    save.data.crystals = 100_000;
    save.data.greenCrystals = 100_000;
    save.data.essence = 100_000;
    expect(upg.soldierCanBuy(0, "s_penetrator")).toBe(false);
    expect(upg.soldierBuy(0, "s_marksman")).toBe(true);
    expect(upg.soldierCanBuy(0, "s_twin_fire")).toBe(false);
    expect(upg.soldierBuy(0, "s_penetrator")).toBe(true);
    expect(upg.soldierBuy(0, "s_twin_fire")).toBe(true);
    expect(upg.soldierTreeLevel(0)).toBe(3);
    expect(save.data.greenCrystals).toBe(100_000 - 30);
  });

  it("saves levels per soldier and clamps bad ones", () => {
    const clean = sanitizeSaveData({
      greenCrystals: 7,
      essence: 11,
      loadouts: [{ weapon: "pistol", behavior: "free", upgrades: { s_marksman: 3, s_rate: 999, s_dynamo: 10, nonsense: 2 } }],
    });
    expect(clean.greenCrystals).toBe(7);
    expect(clean.essence).toBe(11);
    expect(clean.loadouts[0].upgrades).toEqual({ s_marksman: 3, s_rate: 5, s_dynamo: 10 });
    expect(clean.loadouts[1].upgrades).toEqual({});
    // A save from before these existed still loads.
    const old = sanitizeSaveData({ bank: 5, crystals: 6, loadouts: [{ weapon: "pistol", behavior: "free" }] });
    expect(old.greenCrystals).toBe(0);
    expect(old.essence).toBe(0);
    expect(old.loadouts[0].upgrades).toEqual({});
  });

  it("shapes only that soldier's shots", () => {
    const world = new PixelWorld({ width: 32, height: 32, cellSize: 8, roomSize: 10 });
    const { upg } = fresh();
    const combat = new CombatSystem(world, new Rng(1), upg.getSoldierStats());
    const hero = new Soldier(100, 100, 1, 0, 60);
    hero.mods = soldierModsFor({ s_marksman: 3, s_penetrator: 2, s_blight_hunter: 2 });
    combat.fire(hero);
    const shot = combat.bullets.items.find((b) => b.active)!;
    expect(shot.damage).toBe(1 + 3);
    expect(shot.pierceLeft).toBe(2);
    expect(shot.blightMultiplier).toBeCloseTo(1.5, 5);

    shot.active = false;
    combat.fire(new Soldier(100, 100, 1, 0, 60));
    const plain = combat.bullets.items.find((b) => b.active)!;
    expect(plain.damage).toBe(1);
    expect(plain.pierceLeft).toBe(0);
    expect(plain.blightMultiplier).toBe(1);
  });

  it("adds the tree's fire rate and twin shots", () => {
    const world = new PixelWorld({ width: 32, height: 32, cellSize: 8, roomSize: 10 });
    const { upg } = fresh();
    const count = (mods: Parameters<typeof soldierModsFor>[0]): number => {
      let shots = 0;
      const combat = new CombatSystem(world, new Rng(1), upg.getSoldierStats(), { onShot: () => shots++ });
      const s = new Soldier(100, 100, 1, 0, 60);
      s.mods = soldierModsFor(mods);
      for (let i = 0; i < 600; i++) combat.updateSoldier(s, 1 / 60);
      return shots;
    };
    const base = count({});
    expect(count({ s_rate: 5 })).toBeGreaterThan(base);
    expect(count({ s_overdrive: 3, s_twin_fire: 3 })).toBeGreaterThan(count({ s_overdrive: 3 }));
  });
});

describe("Zone drops and Blight Essence pickups", () => {
  it("drops gold, then orange, then green by zone", () => {
    expect(lootKindForZone(0)).toBe(LootKind.Gold);
    expect(lootKindForZone(1)).toBe(LootKind.Crystal);
    expect(lootKindForZone(2)).toBe(LootKind.GreenCrystal);
  });

  it("counts green crystals and essence separately", () => {
    const loot = new LootSystem(16);
    const rng = new Rng(2);
    const s = new Soldier(50, 50, 1, 0, 60);
    loot.spawnOne(50, 50, 5, rng, LootKind.GreenCrystal);
    loot.spawnOne(50, 50, 5, rng, LootKind.Essence);
    loot.spawnOne(50, 50, 5, rng, LootKind.Essence);
    loot.spawnOne(50, 50, 5, rng, LootKind.Crystal);
    expect(loot.update(1 / 60, [s], 32)).toBe(4);
    expect(loot.collectedGreenCrystals).toBe(1);
    expect(loot.collectedEssence).toBe(2);
    expect(loot.collectedCrystals).toBe(1);
    expect(loot.collectedGold).toBe(0);
  });

  it("reaches farther for a soldier with Scavenger", () => {
    const distance = LOOT.baseMagnetRange * 1.5;
    const pulled = (magnetMult: number): number => {
      const loot = new LootSystem(4);
      const s = new Soldier(0, 0, 1, 0, 60);
      s.mods = { ...s.mods, magnetMult };
      loot.spawnOne(distance, 0, 5, new Rng(3));
      loot.vx[0] = 0;
      loot.vy[0] = 0;
      loot.x[0] = distance;
      loot.y[0] = 0;
      loot.update(1 / 60, [s], LOOT.baseMagnetRange);
      return loot.vx[0];
    };
    expect(pulled(1)).toBe(0); // out of range
    expect(pulled(2)).toBeLessThan(0); // pulled toward the soldier
  });

  it("decreases blight growth exponent by 0.01 per level down to 1.05 at max", () => {
    const { upg } = fresh();
    const stats0 = upg.getSoldierStats();
    expect(stats0.blightExpBase).toBeCloseTo(1.20, 2);

    // Buy levels of blight_exponent
    const def = UPGRADE_BY_ID["blight_exponent"];
    expect(def.maxLevel).toBe(15);
    expect(def.valueAt(0)).toBeCloseTo(1.20, 2);
    expect(def.valueAt(1)).toBeCloseTo(1.19, 2);
    expect(def.valueAt(5)).toBeCloseTo(1.15, 2);
    expect(def.valueAt(10)).toBeCloseTo(1.10, 2);
    expect(def.valueAt(15)).toBeCloseTo(1.05, 2);

    // Apply to stats
    const stats15 = { ...stats0 };
    def.apply(stats15, 15);
    expect(stats15.blightExpBase).toBeCloseTo(1.05, 2);

    // Compare growth rates at 20s
    const rateBase = growthRateAt(20, stats0.blightStartRate, stats0.blightExpBase);
    const rateUpgraded = growthRateAt(20, stats15.blightStartRate, stats15.blightExpBase);
    expect(rateBase).toBeCloseTo(15.41, 1);
    expect(rateUpgraded).toBeCloseTo(2.08, 1);
  });
});
