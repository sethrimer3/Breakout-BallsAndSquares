import { describe, expect, it, vi } from "vitest";
import { GOO } from "../src/config";
import { Rng } from "../src/core/Rng";
import type { GooMine } from "../src/entities/GooMine";
import { Soldier, baseSoldierStats } from "../src/entities/Soldier";
import { SaveManager, type StorageLike } from "../src/progression/SaveManager";
import { UpgradeManager } from "../src/progression/UpgradeManager";
import { CombatSystem } from "../src/systems/CombatSystem";
import { GooOrbSystem, type GooLaunch } from "../src/systems/GooOrbSystem";
import { PixelWorld, SUB } from "../src/world/PixelWorld";
import { unlockTabs } from "./helpers/progression";

function fixture() {
  const world = new PixelWorld({ width: 16, height: 16, cellSize: 8, roomSize: 4 });
  const bursts: GooMine[] = [];
  const onStick = vi.fn();
  const onRelease = vi.fn();
  const goo = new GooOrbSystem(world, { onStick, onRelease, onMineBurst: (mine) => bursts.push({ ...mine }) });
  const shot: GooLaunch = {
    x: 60, y: 60, dx: 1, dy: 0, speed: 100, ownerId: 7,
    mass: GOO.startingMass, distance: GOO.distance, damage: GOO.mineDamage,
    terrainDamageBonus: 2, blightMultiplier: 3,
  };
  function wall(cx: number, cy: number) { world.health[cy * world.width + cx] = 1000; }
  return { world, goo, shot, wall, bursts, onStick, onRelease };
}

function ticks(goo: GooOrbSystem, count: number, dt = 1 / 60) {
  for (let i = 0; i < count; i++) goo.update(dt);
}

describe("SQUELCH flight, contact and mass", () => {
  it("rejects invalid launch geometry and budgets without consuming a pool slot", () => {
    const { goo, shot } = fixture();
    for (const change of [{ dx: 0, dy: 0 }, { x: NaN }, { speed: 0 }, { mass: NaN }, { distance: Infinity }]) {
      expect(goo.launch({ ...shot, ...change })).toBeNull();
    }
    expect(goo.orbs.activeCount).toBe(0);
  });

  it("bounds embedded contact processing per update without imposing a lifetime bounce cap", () => {
    const { goo, shot, world, onStick } = fixture();
    world.health.fill(1000);
    const orb = goo.launch({ ...shot, mass: 2, distance: 10000 })!;
    goo.update(2);
    expect(onStick).toHaveBeenCalledTimes(GOO.maxContactsPerStep);
    expect(orb.active).toBe(true);
    expect(orb.distanceRemaining).toBe(10000);
    expect(Number.isFinite(orb.x)).toBe(true);
  });

  it.each([[1, 0, 8, 7], [0, 1, 7, 8], [-1, 0, 6, 7], [0, -1, 7, 6]])(
    "sticks to (%s,%s) surfaces, sheds mass, then releases along the reflection", (dx, dy, cx, cy) => {
      const { goo, shot, wall, onStick, onRelease } = fixture();
      wall(cx, cy);
      const orb = goo.launch({ ...shot, dx, dy })!;
      goo.update(0.1);
      expect(orb.state).toBe("stuck");
      expect(orb.mass).toBeCloseTo(0.925);
      expect(orb.distanceRemaining).toBeCloseTo(296);
      expect(orb.dx).toBeCloseTo(-dx);
      expect(orb.dy).toBeCloseTo(-dy);
      expect(goo.mines.activeCount).toBe(1);
      expect(goo.mines.items[0].fuse).toBeCloseTo(0.69);
      goo.update(0.1);
      expect(orb.distanceRemaining).toBeCloseTo(296);
      expect(orb.state).toBe("stuck");
      goo.update(0.1);
      expect(orb.state).toBe("flying");
      expect(orb.distanceRemaining).toBeCloseTo(288);
      expect(onStick).toHaveBeenCalledTimes(1);
      expect(onRelease).toHaveBeenCalledTimes(1);
    },
  );

  it("limits open-space flight to the exact distance budget", () => {
    const { goo, shot } = fixture();
    const orb = goo.launch({ ...shot, distance: 5 })!;
    goo.update(0.1);
    expect(orb.x).toBeCloseTo(65);
    expect(orb.distanceRemaining).toBe(0);
    expect(orb.active).toBe(false);
    expect(goo.mines.activeCount).toBe(0);
  });

  it("processes two contacts in one update and accounts for both dwell times", () => {
    const { goo, shot, wall, onStick } = fixture();
    wall(6, 7); wall(8, 7);
    const orb = goo.launch(shot)!;
    goo.update(0.4);
    expect(onStick).toHaveBeenCalledTimes(2);
    expect(orb.mass).toBeCloseTo(0.85);
    expect(orb.distanceRemaining).toBeCloseTo(288.001);
    expect(goo.mines.items[0].fuse).toBeCloseTo(0.39);
    expect(goo.mines.items[1].fuse).toBeCloseTo(0.64999);
  });

  it("has no lifetime bounce cap: more mass allows more than sixteen deposits", () => {
    const { goo, shot, wall, onStick } = fixture();
    wall(6, 7); wall(8, 7);
    const orb = goo.launch({ ...shot, mass: 2, distance: 10000 })!;
    ticks(goo, 600);
    expect(onStick.mock.calls.length).toBeGreaterThan(16);
    expect(orb.active).toBe(false);
    expect(orb.mass).toBeCloseTo(GOO.minMass);
    expect(orb.distanceRemaining).toBeGreaterThan(9000);
  });

  it("makes the final fragment proportional and preserves mass accounting", () => {
    const { goo, shot, wall } = fixture();
    wall(8, 7);
    const orb = goo.launch({ ...shot, mass: GOO.minMass + 0.025 })!;
    goo.update(0.1);
    const mine = goo.mines.items[0];
    expect(orb.active).toBe(false);
    expect(mine.mass).toBeCloseTo(0.025);
    expect(mine.damage).toBeCloseTo(GOO.mineDamage / 3);
    expect(orb.mass + mine.mass).toBeCloseTo(orb.startingMass);
  });

  it("reflects at exact faces, corners and the world border without stuck loops", () => {
    const { goo, shot, wall } = fixture();
    wall(8, 7); wall(7, 8); wall(8, 8);
    const orb = goo.launch({ ...shot, x: 64, y: 60 })!;
    goo.update(0.3);
    expect(orb.dx).toBe(-1);
    expect(orb.x).toBeLessThan(64);
    goo.clear();
    const corner = goo.launch({ ...shot, dx: 1, dy: 1 })!;
    goo.update(0.5);
    expect(corner.dx).toBeLessThan(0);
    expect(corner.dy).toBeLessThan(0);
    expect(corner.x).toBeLessThan(64);
    expect(corner.y).toBeLessThan(64);
    goo.clear();
    const border = goo.launch({ ...shot, x: 124 })!;
    goo.update(0.3);
    expect(border.dx).toBe(-1);
    expect(border.x).toBeLessThan(128);
  });

  it("sees half-size Blight cells", () => {
    const { goo, shot, world } = fixture();
    const si = 15 * world.subWidth + 16;
    world.subKind[si] = SUB.blight;
    world.subHealth[si] = 100;
    const orb = goo.launch(shot)!;
    goo.update(0.1);
    expect(orb.state).toBe("stuck");
    expect(orb.dx).toBe(-1);
    expect(goo.mines.activeCount).toBe(1);
  });

  it("preserves the reflected trajectory if the support wall disappears during dwell", () => {
    const { goo, shot, wall, world } = fixture();
    wall(8, 7);
    const orb = goo.launch(shot)!;
    goo.update(0.1);
    world.health.fill(0);
    goo.update(0.2);
    expect(orb.dx).toBe(-1);
    expect(orb.state).toBe("flying");
    expect(orb.x).toBeLessThan(64);
    expect(goo.mines.activeCount).toBe(1);
  });

  it("is consistent across different frame groupings of the same simulated time", () => {
    const a = fixture(); const b = fixture();
    for (const f of [a, b]) { f.wall(6, 7); f.wall(8, 7); f.goo.launch(f.shot); }
    ticks(a.goo, 60, 1 / 60);
    ticks(b.goo, 20, 0.05);
    expect(a.goo.orbs.items[0].x).toBeCloseTo(b.goo.orbs.items[0].x);
    expect(a.goo.orbs.items[0].mass).toBeCloseTo(b.goo.orbs.items[0].mass);
    expect(a.goo.orbs.items[0].distanceRemaining).toBeCloseTo(b.goo.orbs.items[0].distanceRemaining);
    expect(a.bursts.length).toBe(b.bursts.length);
  });

  it("expires out-of-world launches and applies a failsafe to trapped orbs", () => {
    const { goo, shot } = fixture();
    const orb = goo.launch({ ...shot, x: -1 })!;
    goo.update(1 / 60);
    expect(orb.active).toBe(false);
    const trapped = goo.launch(shot)!;
    trapped.age = GOO.safetySeconds;
    goo.update(1 / 60);
    expect(trapped.active).toBe(false);
    expect(goo.mines.activeCount).toBe(0);
  });
});

describe("independent mines and pool budgets", () => {
  it("keeps the fuse after support removal and detonates exactly once with owner data", () => {
    const { goo, shot, wall, world, bursts } = fixture();
    wall(8, 7); goo.launch(shot); goo.update(0.1);
    const mine = goo.mines.items[0];
    const x = mine.x; const y = mine.y;
    world.health.fill(0);
    goo.orbs.clear();
    goo.update(0.68);
    expect(bursts).toHaveLength(0);
    goo.update(0.01);
    expect(bursts).toHaveLength(1);
    expect(bursts[0]).toMatchObject({ x, y, ownerId: 7, damage: 5, terrainDamageBonus: 2, blightMultiplier: 3 });
    goo.update(1);
    expect(bursts).toHaveLength(1);
    expect(goo.mines.activeCount).toBe(0);
  });

  it("caps orb/mine pools, dissipates excess fragments, and drains overdue blasts within budget", () => {
    const { goo, shot, wall, bursts } = fixture();
    wall(8, 7);
    const orb = goo.launch(shot)!;
    for (let i = 1; i < GOO.orbPoolSize; i++) expect(goo.launch(shot)).not.toBeNull();
    expect(goo.launch(shot)).toBeNull();
    for (let i = 0; i < GOO.minePoolSize; i++) {
      const mine = goo.mines.acquire()!;
      mine.fuse = 1;
    }
    goo.update(0.1);
    expect(goo.mines.activeCount).toBe(GOO.minePoolSize);
    expect(orb.mass).toBeCloseTo(0.925);
    goo.orbs.clear();
    goo.update(1);
    expect(bursts).toHaveLength(GOO.maxDetonationsPerStep);
    expect(goo.mines.activeCount).toBe(GOO.minePoolSize - GOO.maxDetonationsPerStep);
    ticks(goo, 12);
    expect(goo.mines.activeCount).toBe(0);
    expect(bursts).toHaveLength(GOO.minePoolSize);
  });

  it("resets all pooled orb/mine state and clears both pools on run reset", () => {
    const { goo, shot, wall } = fixture();
    wall(8, 7);
    const orb = goo.launch(shot)!;
    goo.update(0.1);
    const mine = goo.mines.items[0];
    mine.ownerId = 999; mine.damage = 999; mine.fuse = -100;
    goo.clear();
    expect(goo.orbs.activeCount).toBe(0);
    expect(goo.mines.activeCount).toBe(0);
    expect(goo.launch({ ...shot, ownerId: 9 })).toBe(orb);
    expect(orb).toMatchObject({ state: "flying", stateTimer: 0, age: 0, normalX: 0, normalY: 0, mass: 1, distanceRemaining: 300, ownerId: 9 });
    goo.update(0.1);
    expect(goo.mines.items[0]).toBe(mine);
    expect(mine).toMatchObject({ ownerId: 9, damage: 5, mass: 0.075, maxFuse: 0.75 });
    expect(mine.fuse).toBeCloseTo(0.69);
  });
});

class MemoryStorage implements StorageLike {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe("SQUELCH combat and progression", () => {
  it("fires orbs instead of bullets and applies blast damage/owner events to terrain", () => {
    const world = new PixelWorld({ width: 16, height: 16, cellSize: 8, roomSize: 4 });
    world.health[7 * world.width + 8] = 20;
    const impact = vi.fn(); const burst = vi.fn();
    const combat = new CombatSystem(world, new Rng(1), baseSoldierStats(), { onImpact: impact, onGooMineBurst: burst });
    const soldier = new Soldier(60, 60, 1, 0, 60, "goo_mortar");
    soldier.mods.damageBonus = 3;
    combat.fire(soldier);
    expect(combat.bullets.activeCount).toBe(0);
    expect(combat.goo.orbs.activeCount).toBe(1);
    combat.goo.update(0.1);
    combat.goo.orbs.clear();
    expect(world.health[7 * world.width + 8]).toBe(20);
    combat.goo.update(0.75);
    expect(world.health[7 * world.width + 8]).toBeLessThan(20);
    expect(impact.mock.calls.some((args) => args[8] === soldier.id)).toBe(true);
    expect(burst).toHaveBeenCalledTimes(1);
    expect(burst.mock.calls[0][3]).toBe(8);
  });

  it("uses its own fire rate for autonomous soldiers", () => {
    const world = new PixelWorld({ width: 16, height: 16, cellSize: 8, roomSize: 4 });
    const combat = new CombatSystem(world, new Rng(1), baseSoldierStats());
    const soldier = new Soldier(60, 60, 1, 0, 60, "goo_mortar");
    soldier.fireCooldown = 0;
    combat.updateSoldier(soldier, 0.01);
    expect(combat.goo.orbs.activeCount).toBe(1);
    expect(soldier.fireCooldown).toBeCloseTo(1 / GOO.fireRate - 0.01);
  });

  it("gates upgrades, caps purchases, and restores an unlocked loadout", () => {
    const storage = new MemoryStorage();
    const save = new SaveManager(storage); const u = new UpgradeManager(save);
    expect(u.isUnlocked("goo_unlock")).toBe(false);
    unlockTabs(save); save.data.bank = 1000000; save.data.lifetimePixels = 80;
    expect(u.isUnlocked("goo_mass")).toBe(false);
    expect(u.buy("shotgun_unlock")).toBe(true);
    expect(u.buy("goo_unlock")).toBe(true);
    for (let i = 0; i < 6; i++) expect(u.buy("goo_mass")).toBe(true);
    for (let i = 0; i < 8; i++) expect(u.buy("goo_distance")).toBe(true);
    expect(u.buy("goo_mass")).toBe(false);
    expect(u.buy("goo_distance")).toBe(false);
    (save.data.loadouts[0] as { weapon: string }).weapon = "goo_mortar"; save.save();
    const loaded = new SaveManager(storage);
    expect(loaded.data.loadouts[0].weapon).toBe("shotgun");
    expect(loaded.data.loadouts[0].mutation).toBe("squelch");
    expect(new UpgradeManager(loaded).getSoldierStats()).toMatchObject({ gooUnlocked: true, gooMass: 1.9, gooDistance: 940 });
  });

  it("defaults new keys in legacy saves and rejects locked SQUELCH loadouts", () => {
    const storage = new MemoryStorage(); const save = new SaveManager(storage);
    const legacy = save.data.upgrades as Partial<typeof save.data.upgrades>;
    delete legacy.goo_unlock; delete legacy.goo_mass; delete legacy.goo_distance;
    (save.data.loadouts[0] as { weapon: string }).weapon = "goo_mortar"; save.save();
    const loaded = new SaveManager(storage);
    expect(loaded.data.loadouts[0].weapon).toBe("pistol");
    expect(loaded.data.loadouts[0].mutation).toBeNull();
    expect(new UpgradeManager(loaded).getSoldierStats()).toMatchObject({ gooUnlocked: false, gooMass: 1, gooDistance: 300 });
  });
});
