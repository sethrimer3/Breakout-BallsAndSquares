import { describe, expect, it } from "vitest";
import { FREEZE, NAPALM, RAIL } from "../src/config";
import { Rng } from "../src/core/Rng";
import { Soldier, baseSoldierStats } from "../src/entities/Soldier";
import { SaveManager, type StorageLike } from "../src/progression/SaveManager";
import { UpgradeManager } from "../src/progression/UpgradeManager";
import { CombatSystem } from "../src/systems/CombatSystem";
import { LateEncounters, type Encounter } from "../src/systems/LateEncounters";
import { CAMPAIGN, campaignTier } from "../src/world/campaignBalance";
import { MAT, PixelWorld } from "../src/world/PixelWorld";
import { unlockTabs } from "./helpers/progression";

class MemoryStorage implements StorageLike {
  private map = new Map<string, string>();
  getItem(k: string): string | null { return this.map.get(k) ?? null; }
  setItem(k: string, v: string): void { this.map.set(k, v); }
}

function makeWorld(w = 64, h = 24) {
  const world = new PixelWorld({ width: w, height: h, cellSize: 8, roomSize: 4 });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x < 2 || x >= w - 2 || y < 2 || y >= h - 2) world.health[y * w + x] = 100;
    }
  }
  return world;
}

describe("Bug 1: Pooled projectile state contamination", () => {
  it("resets Napalm, Cryospray, and Burrower state when Katana acquires a recycled Bullet", () => {
    const world = makeWorld(32, 24);
    world.health[12 * 32 + 16] = 100;
    const combat = new CombatSystem(world, new Rng(1), baseSoldierStats());

    // 1. Fire Napalm Garden projectile and let it hit wall -> returns Bullet to pool.
    const napalmSoldier = new Soldier(64, 12 * 8 + 4, 1, 0, 0, "flamethrower", "free", 1, null, "napalm_garden");
    combat.fire(napalmSoldier);
    const firstBullet = combat.bullets.items.find((b) => b.active)!;
    expect(firstBullet.napalmSpray).toBe(true);
    combat.bullets.release(firstBullet);
    expect(combat.napalm.totalPlaced).toBe(0);

    // 2. Fire Katana so it acquires that exact same pooled Bullet object.
    const katanaSoldier = new Soldier(120, 12 * 8 + 4, 1, 0, 0, "katana", "free", 2, null, null);
    combat.fire(katanaSoldier);
    expect(firstBullet.active).toBe(true);
    expect(firstBullet.napalmSpray).toBe(false);
    expect(firstBullet.cryoSpray).toBe(false);
    expect(firstBullet.freezeRocket).toBe(false);
    expect(firstBullet.burrowerGroupId).toBe(0);

    // 3. Step slash into the 100-HP wall: wall takes damage and NO fuel patch is placed.
    for (let i = 0; i < 10; i++) combat.updateBullets(1 / 60);
    expect(world.health[12 * 32 + 16]).toBeLessThan(100);
    expect(combat.napalm.totalPlaced).toBe(0);

    // 4. Also verify Cryospray & Burrower state do not leak after clearAll + reuse.
    combat.bullets.clear();
    const cryoSoldier = new Soldier(64, 12 * 8 + 4, 1, 0, 0, "flamethrower", "free", 3, null, "cryospray");
    combat.fire(cryoSoldier);
    expect(firstBullet.cryoSpray).toBe(true);
    combat.clearAll();

    const pistolSoldier = new Soldier(64, 12 * 8 + 4, 1, 0, 0, "pistol", "free", 4, null, null);
    combat.fire(pistolSoldier);
    expect(firstBullet.cryoSpray).toBe(false);
    expect(firstBullet.napalmSpray).toBe(false);
  });
});

describe("Bug 2: Reload does not restore spent Black Market Essence", () => {
  it("accounts for upgradeSpent Essence across save/reload/refund cycles and legacy saves", () => {
    const storage = new MemoryStorage();
    const save = new SaveManager(storage);
    const u = new UpgradeManager(save);
    unlockTabs(save);
    save.data.lifetimePixels = 10000;

    // Simulate a legitimately cleared late-world encounter in world 3 (tier 8).
    const tier8Essence = CAMPAIGN[campaignTier(8)].essence;
    save.data.lab.worlds[3] = { discovered: [0], conquered: [0], cleared: ["0:soldier:0"], gathered: [], spawn: 0 };
    save.data.essence = tier8Essence;
    save.save();

    // Purchase Reverse-Playback Revolver (20 Essence).
    expect(u.buy("reverse_unlock")).toBe(true);
    expect(save.data.essence).toBe(tier8Essence - 20);
    save.save();

    // Reload: wallet MUST stay at (tier8Essence - 20), not restore to tier8Essence.
    const reloaded = new SaveManager(storage);
    expect(reloaded.data.upgrades.reverse_unlock).toBe(1);
    expect(reloaded.data.essence).toBe(tier8Essence - 20);

    // Refund in lab: returns exact 20 Essence once and clears purchase.
    const ru = new UpgradeManager(reloaded);
    const res = ru.refundBlackMarket(false);
    expect(res.ok).toBe(true);
    expect(reloaded.data.essence).toBe(tier8Essence);
    expect(reloaded.data.upgrades.reverse_unlock).toBe(0);
    expect(reloaded.data.upgradeSpent?.reverse_unlock).toBeUndefined();
    reloaded.save();

    // Reload after refund: stays refunded, second refund yields 0.
    const afterRefund = new SaveManager(storage);
    expect(afterRefund.data.essence).toBe(tier8Essence);
    expect(afterRefund.data.upgrades.reverse_unlock).toBe(0);
    const secondRefund = new UpgradeManager(afterRefund).refundBlackMarket(false);
    expect(secondRefund.ok).toBe(true);
    if (secondRefund.ok) expect(secondRefund.refunded.essence ?? 0).toBe(0);

    // Legacy save without upgradeSpent ledger still accounts for Essence spent on reverse_unlock.
    afterRefund.data.upgrades.reverse_unlock = 1;
    afterRefund.data.essence = tier8Essence - 20;
    delete afterRefund.data.upgradeSpent?.reverse_unlock;
    afterRefund.save();
    const legacyReloaded = new SaveManager(storage);
    expect(legacyReloaded.data.essence).toBe(tier8Essence - 20);
  });
});

describe("Bug 3: Cold and Napalm effects apply to LateEncounters enemies", () => {
  it("applies Cryospray/Freeze Rocket 50% speed + 2x damage, Napalm 5 ticks, and death cleanup to late-world soldiers", () => {
    const world = makeWorld(48, 32);
    const combat = new CombatSystem(world, new Rng(3), baseSoldierStats());
    const late = new LateEncounters(world, () => {}, () => {});
    combat.late = late;
    combat.targets = late;

    const enemy: Encounter = {
      id: "1:soldier:0",
      sector: 1,
      x: 160,
      y: 120,
      homeX: 160,
      homeY: 120,
      hp: 100,
      maxHp: 100,
      alive: true,
      kind: "soldier" as const,
      tier: 8,
      cooldown: 99,
      charge: 0,
      phase: 0,
      aimAngle: 0,
      windup: 0,
    };
    late.actors.push(enemy);

    // Hit LateEncounters soldier with Cryospray projectile.
    const cryoSoldier = new Soldier(140, 120, 1, 0, 0, "flamethrower", "free", 1, null, "cryospray");
    combat.fire(cryoSoldier);
    for (let i = 0; i < 15; i++) combat.updateBullets(1 / 60);
    expect(enemy.freezeTimer).toBeGreaterThan(0);

    // Frozen late-world soldier moves at 50% speed.
    const dummySoldier = new Soldier(300, 120, 1, 0, 0, "pistol", "free", 2, null, null);
    const xBefore = enemy.x;
    late.update(0.1, [dummySoldier]);
    const frozenMove = Math.abs(enemy.x - xBefore);

    enemy.freezeTimer = 0;
    enemy.x = 160;
    late.update(0.1, [dummySoldier]);
    const normalMove = Math.abs(enemy.x - 160);
    expect(frozenMove).toBeCloseTo(normalMove * FREEZE.enemySpeedMult, 2);

    // Frozen late-world soldier takes 2x incoming damage and refreshes without stacking.
    combat.freeze.freezeCreature(enemy, FREEZE.duration);
    combat.freeze.freezeCreature(enemy, FREEZE.duration);
    late.damageEncounter(enemy, 10);
    expect(enemy.hp).toBe(100 - 10 * FREEZE.enemyDamageMult); // 80 HP
    enemy.freezeTimer = 0;
    enemy.hp = 100;

    // Coat with Napalm spray and ignite with an external pistol shot -> 5 burn ticks deal 5 * FLAMETHROWER.damage (1) = 5 dmg.
    const napalmSoldier = new Soldier(140, 120, 1, 0, 0, "flamethrower", "free", 3, null, "napalm_garden");
    combat.fire(napalmSoldier);
    for (let i = 0; i < 15; i++) combat.updateBullets(1 / 60);
    expect(combat.napalm.activeCount).toBeGreaterThan(0);

    expect(combat.napalm.igniteAt(enemy.x, enemy.y, 12, 99)).toBeGreaterThan(0);
    for (let i = 0; i < 5; i++) combat.napalm.update(NAPALM.tickInterval, null, late);
    expect(enemy.hp).toBe(95);

    // Target-bound Napalm patch dissipates immediately when late-world enemy dies.
    late.damageEncounter(enemy, 999);
    combat.napalm.update(0.05, null, late);
    expect(enemy.alive).toBe(false);
    expect(combat.napalm.activeCount).toBe(0);
  });
});

describe("Bug 4: Rail Lance traverses through surviving terrain", () => {
  it("hits all 23 consecutive 1000-HP blocks instead of stalling inside block 4", () => {
    const world = makeWorld(48, 24);
    for (let x = 10; x < 33; x++) {
      world.health[12 * 48 + x] = 1000;
    }
    const stats = baseSoldierStats();
    stats.sniperDamage = 1;
    stats.sniperPierce = 30;
    const combat = new CombatSystem(world, new Rng(4), stats);
    const s = new Soldier(48, 12 * 8 + 4, 1, 0, 0, "sniper_rifle", "free", 1, null, "rail_lance");

    const res = combat.rail.fireStrike(
      s,
      s.x,
      s.y,
      1,
      0,
      1,
      30,
      false,
      null,
      () => {},
      () => {},
    );

    for (let x = 10; x < 33; x++) {
      expect(world.health[12 * 48 + x], `cell ${x}`).toBe(999);
    }
    expect(res.hits).toBeGreaterThanOrEqual(23);
    expect(res.endX).toBeGreaterThan(33 * 8);
  });

  it("respects authoritative closed gates behind surviving terrain", () => {
    const world = makeWorld(48, 24);
    for (let x = 10; x <= 14; x++) world.health[12 * 48 + x] = 1000;
    const door = { id: 1, tier: 1 as const, open: false, cells: [12 * 48 + 16], x0: 16, y0: 12, x1: 16, y1: 12 };
    world.doors.push(door);
    world.mat[12 * 48 + 16] = MAT.door;
    world.doorId[12 * 48 + 16] = 1;
    world.health[12 * 48 + 16] = 999;
    world.health[12 * 48 + 18] = 1000;

    const combat = new CombatSystem(world, new Rng(4), baseSoldierStats());
    const s = new Soldier(48, 12 * 8 + 4, 1, 0, 0, "sniper_rifle", "free", 1, null, "rail_lance");
    combat.rail.fireStrike(s, s.x, s.y, 1, 0, 1, 30, false, null, () => {}, () => {});

    expect(world.health[12 * 48 + 10]).toBe(999);
    expect(world.health[12 * 48 + 14]).toBe(999);
    expect(world.health[12 * 48 + 18]).toBe(1000);
  });
});

describe("Bug 5: Manual Rail Lance obeys charging cycle", () => {
  it("does not fire immediately on combat.fire or click-spam, charges over dt, and cancels on release", () => {
    const world = makeWorld(48, 24);
    const stats = baseSoldierStats();
    stats.sniperFireRate = 1; // 1.0s charge
    const combat = new CombatSystem(world, new Rng(5), stats);
    const s = new Soldier(64, 96, 1, 0, 0, "sniper_rifle", "free", 1, null, "rail_lance");
    s.isManual = true;
    s.fireCooldown = 0;

    // Direct fire() / click-spam starts charging without firing immediately.
    combat.fire(s, 1, 0);
    combat.fire(s, 1, 0);
    expect(s.railCharging).toBe(true);
    expect(s.railCharge).toBe(0);
    expect(combat.rail.totalStrikes).toBe(0);

    // Hold trigger across 0.5s: still charging, 0 strikes, aim updates before lock phase.
    for (let i = 0; i < 30; i++) {
      expect(combat.advanceRailCharge(s, 1 / 60, 1, 0)).toBe(false);
    }
    expect(combat.rail.totalStrikes).toBe(0);
    expect(s.railCharge).toBeCloseTo(0.5, 2);

    // Releasing trigger mid-charge cancels charge without firing.
    combat.cancelRailCharge(s);
    expect(s.railCharging).toBe(false);
    expect(s.railCharge).toBe(0);
    expect(combat.rail.totalStrikes).toBe(0);

    // Full charge cycle fires exactly once at completion and obeys aim-lock in the final fraction.
    let fired = 0;
    for (let i = 0; i < 65; i++) {
      const aimDy = i > 55 ? 1 : 0; // try to jerk aim during lock phase
      if (combat.advanceRailCharge(s, 1 / 60, 1, aimDy)) {
        fired++;
        break;
      }
    }
    expect(fired).toBe(1);
    expect(combat.rail.totalStrikes).toBe(1);
    expect(s.railLockDy).toBeCloseTo(0, 5);
    expect(RAIL.aimLockFraction).toBeGreaterThan(0);
  });
});

describe("Bug 6: SQUELCH explosions and other damaging paths ignite Napalm", () => {
  it("ignites unlit Napalm via SQUELCH mine bursts and forbids Cryospray/self-ignition", () => {
    const world = makeWorld(32, 24);
    world.health[12 * 32 + 16] = 50;
    const combat = new CombatSystem(world, new Rng(6), baseSoldierStats());

    // Place unlit Napalm patch at (16, 12).
    const patch = combat.napalm.placeCellPatch(1, 16, 12, 16 * 8 + 4, 12 * 8 + 4, 2, 0, 1)!;
    expect(patch.lit).toBe(false);

    // Cryospray must NOT ignite Napalm.
    const cryoSoldier = new Soldier(12 * 8, 12 * 8 + 4, 1, 0, 0, "flamethrower", "free", 2, null, "cryospray");
    combat.fire(cryoSoldier);
    for (let i = 0; i < 20; i++) combat.updateBullets(1 / 60);
    expect(patch.lit).toBe(false);

    // SQUELCH mine detonation at (16, 12) damages terrain AND ignites Napalm.
    const squelch = new Soldier(12 * 8, 12 * 8 + 4, 1, 0, 0, "shotgun", "free", 3, null, "squelch");
    combat.fire(squelch);
    for (let i = 0; i < 90; i++) {
      combat.updateBullets(1 / 60);
      combat.goo.update(1 / 60);
    }
    expect(world.health[12 * 32 + 16]).toBeLessThan(50);
    expect(patch.lit).toBe(true);
  });
});
