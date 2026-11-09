import { unlockTabs } from "./helpers/progression";
import { describe, expect, it } from "vitest";
import { SOLDIER, TERRAIN, zoneForDepth } from "../src/config";
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
    s1.data.upgrades.extra_soldier = 3;
    s1.save();

    const s2 = new SaveManager(store);
    expect(s2.data.bank).toBe(250);
    expect(s2.data.lifetimePixels).toBe(120);
    expect(s2.data.upgrades.extra_soldier).toBe(3);

    // Corrupted JSON -> defaults without throwing.
    store.setItem(SAVE_KEY, "{not-valid-json");
    const s3 = new SaveManager(store);
    expect(s3.data.bank).toBe(0);
    expect(s3.data.upgrades.extra_soldier).toBe(0);

    // Out-of-range / NaN fields -> clamped.
    store.setItem(
      SAVE_KEY,
      JSON.stringify({ bank: -50, lifetimePixels: "bad", upgrades: { extra_soldier: 999 } }),
    );
    const s4 = new SaveManager(store);
    expect(s4.data.bank).toBe(0);
    expect(s4.data.lifetimePixels).toBe(0);
    expect(s4.data.upgrades.extra_soldier).toBe(UPGRADE_BY_ID.extra_soldier.maxLevel);
  });

  it("gates Multishot at 40 lifetime pixels and Additional Soldier at 100", () => {
    const save = new SaveManager(new MemStorage());
    unlockTabs(save);
    const upg = new UpgradeManager(save);
    save.data.bank = 10_000; save.data.crystals = 10_000;

    expect(upg.isUnlocked("keycard_t1")).toBe(true);
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
    unlockTabs(save);
    const upg = new UpgradeManager(save);
    save.data.bank = 1_000_000; save.data.crystals = 1_000_000;
    save.data.lifetimePixels = 500;

    const c0 = upg.soldierPricesOf(0, "s_stride")[0].amount;
    expect(c0).toBe(10);
    expect(upg.soldierBuy(0, "s_stride")).toBe(true);
    expect(upg.soldierPricesOf(0, "s_stride")[0].amount).toBeGreaterThan(c0);
    while (!upg.soldierIsMaxed(0, "s_stride")) expect(upg.soldierBuy(0, "s_stride")).toBe(true);
    expect(upg.soldierLevelOf(0, "s_stride")).toBe(5);
    expect(upg.soldierBuy(0, "s_stride")).toBe(false);
    expect(upg.soldierMods(0).speedMult).toBeCloseTo(1.3);
    expect(upg.soldierMods(1).speedMult).toBe(1);

    upg.buy("bullet_damage");
    upg.buy("fire_rate");
    const st = upg.getSoldierStats();
    expect(st.speed).toBeCloseTo(SOLDIER.speed, 5);
    expect(st.damage).toBe(SOLDIER.damage + 1);
    expect(st.fireRate).toBeCloseTo(SOLDIER.fireRate * 1.12, 5);
    expect(st.dropChance).toBeCloseTo(0.4, 5);

    // Upgrade gold drop chance, multi-drop, magnet range, and pickup lifetime.
    expect(upg.buy("drop_chance")).toBe(true);
    expect(upg.buy("multi_drop")).toBe(true);
    expect(upg.buy("magnet_range")).toBe(true);
    expect(upg.buy("pickup_lifetime")).toBe(true);
    const st2 = upg.getSoldierStats();
    expect(st2.dropChance).toBeCloseTo(0.45 * 1.08, 5);
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
    expect(zoneForDepth(TERRAIN.zone2Depth - 1)).toBe(0);
    expect(zoneForDepth(TERRAIN.zone2Depth)).toBe(1);
    expect(zoneForDepth(TERRAIN.zone3Depth - 1)).toBe(1);
    expect(zoneForDepth(TERRAIN.zone3Depth)).toBe(2);

    const loot = new LootSystem();
    const rng = new Rng(7);
    loot.spawnOne(100, 100, 5, rng, LootKind.Crystal);
    expect(loot.kind[0]).toBe(LootKind.Crystal);

    // Shotgun tree starts locked until shotgun_unlock is purchased; blight upgrades modify blight stats.
    unlockTabs(s2);
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
    expect(st.blightGraceSeconds).toBeGreaterThan(5);
    expect(st.blightRateMultiplier).toBeLessThan(1);

    // Loadouts persist per soldier slot.
    s2.data.loadouts[0].weapon = "shotgun";
    s2.save();
    const s3 = new SaveManager(store);
    expect(s3.data.loadouts[0].weapon).toBe("shotgun");
  });

  it("supports Assault Rifle (pierce up to 5), Rocket Launcher (AoE), and Sniper Rifle (pierce/crit) trees & combat", async () => {
    const { PixelWorld } = await import("../src/world/PixelWorld");
    const { CombatSystem } = await import("../src/systems/CombatSystem");
    const { Soldier } = await import("../src/entities/Soldier");

    const store = new MemStorage();
    const save = new SaveManager(store);
    unlockTabs(save);
    const upg = new UpgradeManager(save);
    save.data.bank = 100_000; save.data.crystals = 100_000;
    save.data.lifetimePixels = 500;

    // Unlock Assault Rifle and max out AP Pierce (5 levels => pierce = 5).
    expect(upg.isUnlocked("ar_pierce")).toBe(false);
    expect(upg.buy("ar_unlock")).toBe(true);
    expect(upg.isUnlocked("ar_pierce")).toBe(true);
    for (let i = 0; i < 5; i++) {
      expect(upg.buy("ar_pierce")).toBe(true);
    }
    expect(upg.buy("ar_pierce")).toBe(false); // capped at 5
    const arStats = upg.getSoldierStats();
    expect(arStats.arUnlocked).toBe(true);
    expect(arStats.arPierce).toBe(5);

    // Unlock Rocket Launcher & Sniper Rifle.
    expect(upg.buy("rocket_unlock")).toBe(true);
    expect(upg.buy("rocket_radius")).toBe(true);
    expect(upg.buy("rocket_cluster")).toBe(true);
    expect(upg.buy("sniper_unlock")).toBe(true);
    expect(upg.buy("sniper_pierce")).toBe(true);
    const fullStats = upg.getSoldierStats();
    expect(fullStats.rocketUnlocked).toBe(true);
    expect(fullStats.sniperUnlocked).toBe(true);
    expect(fullStats.sniperPierce).toBe(3);

    // Verify Assault Rifle bullet with pierce=5 pierces through 6 blocks in a single line (5 pierces + final hit).
    const w1 = new PixelWorld({ width: 30, height: 20, cellSize: 10, roomSize: 6 });
    for (let c = 5; c <= 14; c++) {
      w1.setCell(c, 5, 1, "set", true);
    }
    let destroyedCount = 0;
    const combat1 = new CombatSystem(w1, new Rng(123), fullStats, {
      onImpact: (_x, _y, _nx, _ny, _cx, _cy, result) => {
        if (result === 2) destroyedCount++;
      },
    });
    const arSoldier = new Soldier(15, 55, 100, 0, 3, "assault_rifle");
    arSoldier.fireCooldown = 0;
    // Set arSpreadDeg = 0 so shot flies strictly horizontally along row 5.
    combat1.stats.arSpreadDeg = 0;
    combat1.fire(arSoldier);
    combat1.updateBullets(0.3);
    expect(destroyedCount).toBe(6); // pierced 5 blocks and stopped on the 6th!

    // Verify Rocket Launcher AoE detonation destroys multiple blocks around impact and spawns cluster bomb.
    const w2 = new PixelWorld({ width: 30, height: 20, cellSize: 10, roomSize: 6 });
    for (let r = 8; r <= 12; r++) {
      for (let c = 8; c <= 12; c++) {
        w2.setCell(c, r, 1, "set", true);
      }
    }
    let rocketDestroyed = 0;
    let explosions = 0;
    const combat2 = new CombatSystem(w2, new Rng(456), fullStats, {
      onImpact: (_x, _y, _nx, _ny, _cx, _cy, result) => {
        if (result === 2) rocketDestroyed++;
      },
      onExplosion: () => {
        explosions++;
      },
    });
    const rocketSoldier = new Soldier(20, 105, 100, 0, 3, "rocket_launcher");
    combat2.fire(rocketSoldier);
    combat2.updateBullets(0.3);
    combat2.updateBullets(0.4); // let cluster mini-bomb detonate
    expect(explosions).toBeGreaterThanOrEqual(2);
    expect(rocketDestroyed).toBeGreaterThan(5);
  });

  it("organizes Core milestones, Resources (gold + Tier 2/3 placeholders), and Blight (Blight Core upgrades) into separate branches", async () => {
    const { UPGRADE_DEFS } = await import("../src/progression/UpgradeDefinitions");
    const { PixelWorld } = await import("../src/world/PixelWorld");
    const { CombatSystem } = await import("../src/systems/CombatSystem");
    const { Soldier } = await import("../src/entities/Soldier");

    // 1. Verify branch separation.
    const coreIds = UPGRADE_DEFS.filter((d) => d.branch === "core").map((d) => d.id);
    const resourceIds = UPGRADE_DEFS.filter((d) => d.branch === "resources").map((d) => d.id);
    const blightIds = UPGRADE_DEFS.filter((d) => d.branch === "blight").map((d) => d.id);

    expect(coreIds).toEqual(
      expect.arrayContaining(["keycard_t1", "unlock_map", "extra_soldier", "unlock_primary"]),
    );
    expect(resourceIds).toEqual(
      expect.arrayContaining([
        "drop_chance",
        "multi_drop",
        "magnet_range",
        "pickup_lifetime",
        "tier2_crystal_yield",
        "tier2_crystal_refinery",
        "tier3_dark_matter",
        "tier3_quantum_extractor",
      ]),
    );
    expect(blightIds).toEqual(
      expect.arrayContaining([
        "blight_delay",
        "blight_slow",
        "blight_weaken",
        "core_time_drain",
        "core_breaker",
        "core_bounty",
      ]),
    );

    // Individual damage combines with Blight Core research without global soldier buffs.
    const store = new MemStorage();
    const save = new SaveManager(store);
    unlockTabs(save);
    const upg = new UpgradeManager(save);
    save.data.bank = 500_000; save.data.crystals = 500_000;
    save.data.lifetimePixels = 1000;

    expect(upg.soldierBuy(0, "s_marksman")).toBe(true);
    expect(upg.buy("core_time_drain")).toBe(true);
    expect(upg.buy("core_breaker")).toBe(true);
    expect(upg.buy("core_bounty")).toBe(true);
    expect(upg.buy("tier2_crystal_yield")).toBe(true);
    expect(upg.buy("tier3_dark_matter")).toBe(true);

    const st = upg.getSoldierStats();
    expect(st.globalFireRateMult).toBe(1);
    expect(st.globalDamageBonus).toBe(0);
    expect(st.globalBulletSpeedMult).toBe(1);
    expect(st.coreTimeReduction).toBe(16);
    expect(st.coreDamageBonus).toBe(2);
    expect(st.coreLootBurst).toBe(12);
    expect(st.crystalDropBonus).toBeCloseTo(0.08, 5);
    expect(st.tier3ResourceBonus).toBeCloseTo(0.1, 5);

    // Verify CombatSystem applies globalDamageBonus + coreDamageBonus against a Blight Core cell.
    const w = new PixelWorld({ width: 20, height: 20, cellSize: 10, roomSize: 6 });
    const cellIdx = 5 * w.width + 8;
    w.setCell(8, 5, 10, "set", true);
    w.coreId[cellIdx] = 1;
    w.blightCores.push({
      id: 1,
      roomId: 0,
      zone: 0,
      cx: 8,
      cy: 5,
      cells: [cellIdx],
      alive: true,
      size: 1,
    });

    const combat = new CombatSystem(w, new Rng(99), st);
    const pistolSoldier = new Soldier(20, 55, 100, 0, 3, "pistol");
    pistolSoldier.mods = upg.soldierMods(0);
    combat.fire(pistolSoldier);
    combat.updateBullets(0.2);

    // Base pistol damage (1) + globalDamageBonus (1) + coreDamageBonus (2) = 4 damage -> 10 - 4 = 6 HP remaining.
    expect(w.health[cellIdx]).toBe(6);
  });
});
