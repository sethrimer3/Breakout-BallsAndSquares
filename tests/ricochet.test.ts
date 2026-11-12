import { describe, expect, it, vi } from "vitest";
import { Rng } from "../src/core/Rng";
import { Soldier, baseSoldierStats, type WeaponType } from "../src/entities/Soldier";
import { SaveManager, type StorageLike } from "../src/progression/SaveManager";
import { UpgradeManager } from "../src/progression/UpgradeManager";
import { CombatSystem } from "../src/systems/CombatSystem";
import { PixelWorld, SUB } from "../src/world/PixelWorld";
import { unlockTabs } from "./helpers/progression";

function fixture() {
  const world = new PixelWorld({ width: 16, height: 16, cellSize: 8, roomSize: 4 });
  const stats = baseSoldierStats();
  stats.pistolBounces = 5;
  stats.shotgunBounces = 3;
  const ricochet = vi.fn();
  const combat = new CombatSystem(world, new Rng(123), stats, { onBulletRicochet: ricochet });
  function fire(weapon: WeaponType = "pistol", x = 60, y = 60, dx = 1, dy = 0, pierce = 0) {
    const soldier = new Soldier(x, y, dx, dy, stats.speed, weapon);
    soldier.mods.pierce = pierce;
    combat.fire(soldier, dx, dy);
    const bullet = combat.bullets.items.find((b) => b.active)!;
    bullet.pendingAdvance = 0;
    bullet.speed = 100;
    bullet.damage = 10;
    return bullet;
  }
  return { world, stats, combat, ricochet, fire };
}

function wall(w: PixelWorld, cx: number, cy: number, hp = 100) {
  w.health[cy * w.width + cx] = hp;
}

describe("ordinary ammunition ricochets", () => {
  it.each([[1, 0, 8, 7], [0, 1, 7, 8], [-1, 0, 6, 7], [0, -1, 7, 6]])(
    "reflects direction (%s,%s), damages the wall once and spends remaining frame travel",
    (dx, dy, cx, cy) => {
      const { world, combat, ricochet, fire } = fixture();
      wall(world, cx, cy);
      const b = fire("pistol", 60, 60, dx, dy);
      combat.updateBullet(b, 0.1);
      expect(b.active).toBe(true);
      expect(b.dx).toBeCloseTo(-dx);
      expect(b.dy).toBeCloseTo(-dy);
      expect(b.x).toBeCloseTo(60 - dx * 2.001, 3);
      expect(b.y).toBeCloseTo(60 - dy * 2.001, 3);
      expect(b.bounceLeft).toBe(4);
      expect(b.totalTraveled).toBeCloseTo(10);
      expect(b.traveled).toBeCloseTo(6);
      expect(world.health[cy * world.width + cx]).toBe(90);
      expect(ricochet).toHaveBeenCalledTimes(1);
    },
  );

  it("reflects from the captured face even when the impact destroys it", () => {
    const { world, combat, fire } = fixture();
    wall(world, 8, 7, 1);
    const b = fire();
    combat.updateBullet(b, 0.1);
    expect(world.health[7 * world.width + 8]).toBe(0);
    expect(b.dx).toBe(-1);
    expect(b.active).toBe(true);
  });

  it("handles an exact face launch at zero distance without hitting it again", () => {
    const { world, combat, ricochet, fire } = fixture();
    wall(world, 8, 7);
    const b = fire("pistol", 64, 60);
    combat.updateBullet(b, 0.1);
    expect(b.x).toBeCloseTo(53.999);
    expect(ricochet).toHaveBeenCalledTimes(1);
  });

  it("handles a corner with bounded contacts and escapes into free space", () => {
    const { world, combat, ricochet, fire } = fixture();
    wall(world, 8, 7);
    wall(world, 7, 8);
    wall(world, 8, 8);
    const b = fire("pistol", 60, 60, 1, 1);
    combat.updateBullet(b, 0.1);
    expect(b.active).toBe(true);
    expect(b.dx).toBeLessThan(0);
    expect(b.dy).toBeLessThan(0);
    expect(b.x).toBeLessThan(64);
    expect(b.y).toBeLessThan(64);
    expect(ricochet).toHaveBeenCalledTimes(2);
  });

  it("reflects off thin half-size Blight", () => {
    const { world, combat, fire } = fixture();
    const si = 15 * world.subWidth + 16;
    world.subKind[si] = SUB.blight;
    world.subHealth[si] = 100;
    const b = fire();
    combat.updateBullet(b, 0.1);
    expect(world.subHealth[si]).toBe(90);
    expect(b.dx).toBe(-1);
    expect(b.active).toBe(true);
  });

  it("spends its budget between corridor walls and expires on the next contact", () => {
    const { world, combat, ricochet, fire } = fixture();
    wall(world, 6, 7);
    wall(world, 8, 7);
    const b = fire();
    combat.updateBullet(b, 0.6);
    expect(ricochet).toHaveBeenCalledTimes(5);
    expect(b.bounceLeft).toBe(0);
    expect(b.active).toBe(false);
  });

  it("bounds a pathological embedded shot to eight contacts per update", () => {
    const { world, combat, ricochet, fire } = fixture();
    world.health.fill(1000);
    const b = fire();
    b.bounceLeft = 100;
    combat.updateBullet(b, 0.1);
    expect(ricochet).toHaveBeenCalledTimes(8);
    expect(b.active).toBe(true);
    expect(Number.isFinite(b.x)).toBe(true);
  });

  it("reflects from the world boundary into the arena", () => {
    const { combat, fire } = fixture();
    const b = fire("pistol", 124, 60);
    combat.updateBullet(b, 0.1);
    expect(b.dx).toBe(-1);
    expect(b.x).toBeLessThan(128);
  });

  it("retains 70% pellet damage per bounce, with explicit integer terrain damage", () => {
    const { world, combat, fire } = fixture();
    wall(world, 6, 7);
    wall(world, 8, 7);
    const b = fire("shotgun");
    b.dx = 1; b.dy = 0;
    combat.updateBullet(b, 0.19);
    expect(b.bounceLeft).toBe(1);
    expect(b.damage).toBeCloseTo(4.9);
    expect(world.health[7 * world.width + 8]).toBe(90);
    expect(world.health[7 * world.width + 6]).toBe(93);
    combat.updateBullet(b, 0.04);
    expect(world.health[7 * world.width + 8]).toBe(85);
  });

  it("does not grant ricochets to piercing rounds even after their pierce is spent", () => {
    const { world, combat, ricochet, fire } = fixture();
    wall(world, 8, 7);
    wall(world, 9, 7);
    const b = fire("pistol", 60, 60, 1, 0, 1);
    expect(b.bounceLeft).toBe(0);
    combat.updateBullet(b, 0.25);
    expect(b.active).toBe(false);
    expect(b.pierceLeft).toBe(0);
    expect(ricochet).not.toHaveBeenCalled();
  });

  it.each<WeaponType>(["assault_rifle", "sniper_rifle", "rocket_launcher", "flamethrower", "katana"])(
    "never grants ordinary bounces to %s", (weapon) => {
      const { fire } = fixture();
      expect(fire(weapon).bounceLeft).toBe(0);
    },
  );

  it("consumes ricochet ammunition on creatures", () => {
    const { combat, ricochet, fire } = fixture();
    const applyHit = vi.fn(() => true);
    combat.targets = { raycast: () => 2, applyHit };
    const b = fire();
    combat.updateBullet(b, 0.1);
    expect(applyHit).toHaveBeenCalledWith(10, 62, 60);
    expect(b.active).toBe(false);
    expect(ricochet).not.toHaveBeenCalled();
  });

  it("resets bounce and distance state when pooled bullets become slashes or turret shots", () => {
    const { combat, fire } = fixture();
    const b = fire("shotgun");
    combat.bullets.clear();
    b.totalTraveled = 999;
    b.traveled = 999;
    expect(fire("katana")).toBe(b);
    expect(b.bounceLeft).toBe(0);
    expect(b.bounceRetention).toBe(1);
    expect(b.totalTraveled).toBe(0);
    expect(b.traveled).toBe(0);
    combat.bullets.clear();
    combat.fireTurretShot(1, 60, 60, 1, 0, 1);
    expect(b.bounceLeft).toBe(0);
    expect(b.bounceRetention).toBe(1);
  });
});

class MemoryStorage implements StorageLike {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe("ricochet progression", () => {
  it("gates purchases, caps levels, and reloads the new upgrades", () => {
    const storage = new MemoryStorage();
    const save = new SaveManager(storage);
    const upgrades = new UpgradeManager(save);
    expect(upgrades.isUnlocked("pistol_bankshot")).toBe(false);
    unlockTabs(save);
    save.data.bank = 100000;
    expect(upgrades.isUnlocked("pistol_bankshot")).toBe(true);
    expect(upgrades.isUnlocked("shotgun_rebound")).toBe(false);
    for (let i = 0; i < 5; i++) expect(upgrades.buy("pistol_bankshot")).toBe(true);
    expect(upgrades.buy("pistol_bankshot")).toBe(false);
    save.data.lifetimePixels = 30;
    expect(upgrades.buy("shotgun_unlock")).toBe(true);
    for (let i = 0; i < 3; i++) expect(upgrades.buy("shotgun_rebound")).toBe(true);
    expect(upgrades.buy("shotgun_rebound")).toBe(false);
    const reloaded = new UpgradeManager(new SaveManager(storage)).getSoldierStats();
    expect(reloaded.pistolBounces).toBe(5);
    expect(reloaded.shotgunBounces).toBe(3);
  });

  it("defaults missing upgrade keys to zero in existing saves", () => {
    const storage = new MemoryStorage();
    const save = new SaveManager(storage);
    // Model a pre-expansion save without either definition.
    const legacy = save.data.upgrades as Partial<typeof save.data.upgrades>;
    delete legacy.pistol_bankshot;
    delete legacy.shotgun_rebound;
    save.save();
    const stats = new UpgradeManager(new SaveManager(storage)).getSoldierStats();
    expect(stats.pistolBounces).toBe(0);
    expect(stats.shotgunBounces).toBe(0);
  });
});
