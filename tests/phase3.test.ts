import { describe, expect, it } from "vitest";
import { SOLDIER } from "../src/config";
import { SAVE_KEY, SaveManager, type StorageLike } from "../src/progression/SaveManager";
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

    // Reload from storage: upgrades persist.
    const reloaded = new UpgradeManager(new SaveManager(store)).getSoldierStats();
    expect(reloaded.speed).toBeCloseTo(st.speed, 5);
    expect(reloaded.damage).toBe(st.damage);
  });
});
