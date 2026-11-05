import { describe, expect, it } from "vitest";
import { SOLDIER, zoneForDepth } from "../src/config";
import { LootKind, LootSystem } from "../src/entities/LootSystem";
import { Rng } from "../src/core/Rng";
import { MUZZLE_FLASH_MULTIPLIER, SAVE_KEY, SaveManager, type StorageLike } from "../src/progression/SaveManager";
import { UPGRADE_BY_ID } from "../src/progression/UpgradeDefinitions";
import { UpgradeManager } from "../src/progression/UpgradeManager";

class MemStorage implements StorageLike {
  map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
}

describe("Phase 3 — SaveManager & UpgradeManager", () => {
  it("round-trips save data and recovers gracefully from corrupted or partial JSON", () => {
    const store = new MemStorage();
    const s1 = new SaveManager(store);
    s1.data.bank = 250;
    s1.data.lifetimePixels = 120;
    s1.data.upgrades.ball_speed = 3;
    s1.save();

    const s2 = new SaveManager(store);
    expect(s2.data.bank).toBe(250);
    expect(s2.data.lifetimePixels).toBe(120);
    expect(s2.data.upgrades.ball_speed).toBe(3);

    // Corrupted JSON -> defaults without throwing.
    store.setItem(SAVE_KEY, "{not-valid-json");
    const s3 = new SaveManager(store);
    expect(s3.data.bank).toBe(0);
    expect(s3.data.upgrades.ball_speed).toBe(0);

    // Out-of-range / NaN fields -> clamped.
    store.setItem(
      SAVE_KEY,
      JSON.stringify({ bank: -50, lifetimePixels: "bad", upgrades: { ball_speed: 999 } }),
    );
    const s4 = new SaveManager(store);
    expect(s4.data.bank).toBe(0);
    expect(s4.data.lifetimePixels).toBe(0);
    expect(s4.data.upgrades.ball_speed).toBe(UPGRADE_BY_ID.ball_speed.maxLevel);
  });

  it("gates Multishot at 40 lifetime pixels and Additional Soldier at 100", () => {
    const save = new SaveManager(new MemStorage());
    const upg = new UpgradeManager(save);
    save.data.bank = 10_000;

    expect(upg.isUnlocked("ball_speed")).toBe(true);
    expect(upg.isUnlocked("fire_rate")).toBe(true);
    expect(upg.isUnlocked("bullet_speed")).toBe(true);
    expect(upg.isUnlocked("bullet_damage")).toBe(true);
    expect(upg.isUnlocked("multishot")).toBe(false);
    expect(upg.isUnlocked("extra_soldier")).toBe(false);
    expect(upg.buy("multishot")).toBe(false);

    save.data.lifetimePixels = 40;
    expect(upg.isUnlocked("multishot")).toBe(true);
    expect(upg.isUnlocked("extra_soldier")).toBe(false);
    expect(upg.buy("multishot")).toBe(true);

    save.data.lifetimePixels = 100;
    expect(upg.isUnlocked("extra_soldier")).toBe(true);
    expect(upg.buy("extra_soldier")).toBe(true);
    expect(upg.getSoldierStats().maxSoldiers).toBe(2);
  });

  it("scales costs exponentially, enforces level caps, and modifies soldier stats (completion test)", () => {
    const store = new MemStorage();
    const save = new SaveManager(store);
    const upg = new UpgradeManager(save);
    save.data.bank = 1_000_000;
    save.data.lifetimePixels = 500;

    const c0 = upg.costOf("ball_speed");
    expect(c0).toBe(15);
    expect(upg.buy("ball_speed")).toBe(true);
    const c1 = upg.costOf("ball_speed");
    expect(c1).toBeGreaterThan(c0);

    // Buy up to the cap.
    while (!upg.isMaxed("ball_speed")) {
      expect(upg.buy("ball_speed")).toBe(true);
    }
    expect(upg.levelOf("ball_speed")).toBe(10);
    expect(upg.buy("ball_speed")).toBe(false);

    upg.buy("bullet_damage");
    upg.buy("fire_rate");
    const st = upg.getSoldierStats();
    expect(st.speed).toBeCloseTo(SOLDIER.speed * 2, 5);
    expect(st.damage).toBe(SOLDIER.damage + 1);
    expect(st.fireRate).toBeCloseTo(SOLDIER.fireRate * 1.12, 5);
    expect(st.dropChance).toBeCloseTo(0.2, 5);

    // Upgrade gold drop chance, multi-drop, magnet range, and pickup lifetime.
    expect(upg.buy("drop_chance")).toBe(true);
    expect(upg.buy("multi_drop")).toBe(true);
    expect(upg.buy("magnet_range")).toBe(true);
    expect(upg.buy("pickup_lifetime")).toBe(true);
    const st2 = upg.getSoldierStats();
    expect(st2.dropChance).toBeCloseTo(0.2 + 0.1 + 0.25, 5);
    expect(st2.magnetRange).toBeGreaterThan(st.magnetRange);
    expect(st2.pickupLifetime).toBeGreaterThan(st.pickupLifetime);

    // Reload from storage: upgrades persist.
    const reloaded = new UpgradeManager(new SaveManager(store)).getSoldierStats();
    expect(reloaded.speed).toBeCloseTo(st2.speed, 5);
    expect(reloaded.damage).toBe(st2.damage);
    expect(reloaded.dropChance).toBeCloseTo(st2.dropChance, 5);
  });

  it("persists muzzleFlash setting, crystals, and separates Zone 1 gold from Zone 2 orange crystals", () => {
    const store = new MemStorage();
    const s1 = new SaveManager(store);
    expect(s1.data.settings.muzzleFlash).toBe("brightest");
    expect(s1.data.settings.autoFollowCamera).toBe(false);
    expect(MUZZLE_FLASH_MULTIPLIER.brightest).toBe(1);
    expect(MUZZLE_FLASH_MULTIPLIER.off).toBe(0);

    s1.data.crystals = 42;
    s1.data.settings.muzzleFlash = "dim";
    s1.save();

    const s2 = new SaveManager(store);
    expect(s2.data.crystals).toBe(42);
    expect(s2.data.settings.muzzleFlash).toBe("dim");
    expect(zoneForDepth(5)).toBe(0);
    expect(zoneForDepth(20)).toBe(1);
    expect(zoneForDepth(40)).toBe(2);

    const loot = new LootSystem();
    const rng = new Rng(7);
    loot.spawnOne(100, 100, 5, rng, LootKind.Crystal);
    expect(loot.kind[0]).toBe(LootKind.Crystal);

    // Shotgun tree starts locked until shotgun_unlock is purchased; blight upgrades modify blight stats.
    const upg = new UpgradeManager(s2);
    s2.data.bank = 10000;
    s2.data.lifetimePixels = 100;
    expect(upg.isUnlocked("shotgun_unlock")).toBe(true);
    expect(upg.isUnlocked("shotgun_pellets")).toBe(false);
    expect(upg.buy("shotgun_unlock")).toBe(true);
    expect(upg.isUnlocked("shotgun_pellets")).toBe(true);
    expect(upg.buy("shotgun_pellets")).toBe(true);
    expect(upg.buy("blight_delay")).toBe(true);
    expect(upg.buy("blight_slow")).toBe(true);
    const st = upg.getSoldierStats();
    expect(st.shotgunUnlocked).toBe(true);
    expect(st.shotgunPellets).toBeGreaterThan(5);
    expect(st.blightGraceSeconds).toBeGreaterThan(12);
    expect(st.blightRateMultiplier).toBeLessThan(1);

    // Loadouts persist per soldier slot.
    s2.data.loadouts[0].weapon = "shotgun";
    s2.save();
    const s3 = new SaveManager(store);
    expect(s3.data.loadouts[0].weapon).toBe("shotgun");
  });
});
