import { describe, expect, it } from "vitest";
import { BURROWER, FACILITY, FREEZE, NAPALM, ORBIT, RAIL, VACUUM } from "../src/config";
import { Rng } from "../src/core/Rng";
import { CreatureSystem } from "../src/entities/Creatures";
import { Soldier, baseSoldierStats, mutationCompatibility } from "../src/entities/Soldier";
import { SaveManager, type StorageLike } from "../src/progression/SaveManager";
import { UpgradeManager } from "../src/progression/UpgradeManager";
import { CombatSystem } from "../src/systems/CombatSystem";
import { PhysicsSystem } from "../src/systems/PhysicsSystem";
import { GrowthSystem } from "../src/world/GrowthSystem";
import { MAT, PixelWorld } from "../src/world/PixelWorld";
import { unlockTabs } from "./helpers/progression";

class MemoryStorage implements StorageLike {
  private map = new Map<string, string>();
  getItem(k: string): string | null { return this.map.get(k) ?? null; }
  setItem(k: string, v: string): void { this.map.set(k, v); }
}

function makeRoom(w = 32, h = 32) {
  const world = new PixelWorld({ width: w, height: h, cellSize: 8, roomSize: 4 });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x < 2 || x >= w - 2 || y < 2 || y >= h - 2) world.health[y * w + x] = 20;
    }
  }
  return world;
}

describe("Orbit Cylinder (Pistol branch 2)", () => {
  it("loads rounds up to cap around the owner and releases them outward on real wall bounce", () => {
    const world = makeRoom();
    const stats = baseSoldierStats();
    const combat = new CombatSystem(world, new Rng(1), stats);
    const physics = new PhysicsSystem(world, new Rng(1));
    const bounces: number[] = [];
    const s = new Soldier(24, 128, -1, 0, 120, "pistol", "free", 1, null, "orbit_cylinder");

    for (let i = 0; i < ORBIT.maxRounds + 3; i++) combat.fire(s);
    expect(combat.orbit.countFor(s.id)).toBe(ORBIT.maxRounds);
    expect(combat.bullets.activeCount).toBe(0);

    // Step until the soldier collides with and reflects off the left wall (x = 16).
    for (let i = 0; i < 30; i++) {
      physics.step(s, 1 / 60, stats, undefined, (bounced, nx, ny) => {
        bounces.push(bounced.id);
        combat.onSoldierBounce(bounced, nx, ny);
      });
      combat.orbit.update(1 / 60, [s]);
    }
    expect(bounces.length).toBeGreaterThan(0);
    expect(combat.orbit.countFor(s.id)).toBe(0);
    expect(combat.bullets.activeCount).toBe(ORBIT.maxRounds);

    // Every slung bullet must move away from the wall (dx > 0 on left wall bounce).
    for (const b of combat.bullets.items) {
      if (b.active) expect(b.dx).toBeGreaterThan(0);
    }
  });

  it("clears owner-bound orbit rounds when cleared on death or reset", () => {
    const world = makeRoom();
    const combat = new CombatSystem(world, new Rng(2), baseSoldierStats());
    const s1 = new Soldier(64, 64, 1, 0, 60, "pistol", "free", 1, null, "orbit_cylinder");
    const s2 = new Soldier(96, 96, 1, 0, 60, "pistol", "free", 2, null, "orbit_cylinder");
    combat.fire(s1);
    combat.fire(s1);
    combat.fire(s2);
    expect(combat.orbit.countFor(s1.id)).toBe(2);
    expect(combat.orbit.countFor(s2.id)).toBe(1);
    combat.orbit.clearFor(s1.id);
    expect(combat.orbit.countFor(s1.id)).toBe(0);
    expect(combat.orbit.countFor(s2.id)).toBe(1);
  });
});

describe("Vacuum Pulse (Shotgun branch 2)", () => {
  it("runs at half ordinary upgraded shotgun cadence and scales damage & pellets from authoritative debris", () => {
    const world = makeRoom();
    const stats = baseSoldierStats();
    stats.shotgunFireRate = 2.0;
    stats.shotgunPellets = 5;
    stats.shotgunDamage = 2;
    const combat = new CombatSystem(world, new Rng(3), stats);

    const baseShotgun = new Soldier(128, 128, 1, 0, 60, "shotgun", "free", 1, null, null);
    const vacuum = new Soldier(128, 128, 1, 0, 60, "shotgun", "free", 2, null, "vacuum_pulse");
    expect(combat.effectiveFireRate(vacuum)).toBeCloseTo(combat.effectiveFireRate(baseShotgun) * 0.5);

    // Empty intake fires reduced minimum pellets.
    combat.fire(vacuum);
    let emptyCount = 0;
    let emptyDmg = 0;
    for (const b of combat.bullets.items) {
      if (b.active) {
        emptyCount++;
        emptyDmg = b.damage;
      }
    }
    expect(emptyCount).toBe(Math.max(2, Math.floor(stats.shotgunPellets * 0.5)));
    expect(emptyDmg).toBe(stats.shotgunDamage);
    combat.bullets.clear();

    // Destroy 6 normal blocks within range (any weapon/source) and 2 subcells.
    for (let i = 0; i < 6; i++) {
      const cx = 14 + i;
      const cy = 16;
      world.health[cy * world.width + cx] = 1;
      world.damage(cx, cy, 10, true);
    }
    world.subHealth[32 * world.subWidth + 28] = 1;
    world.damageSub(28, 32, 10, true);
    world.subHealth[32 * world.subWidth + 29] = 1;
    world.damageSub(29, 32, 10, true);
    expect(combat.debris.items.filter((d) => d.active).length).toBe(8);

    // Two competing Vacuum Pulse soldiers: first consumes the debris once, second sees empty intake.
    const rival = new Soldier(132, 128, 1, 0, 60, "shotgun", "free", 3, null, "vacuum_pulse");
    combat.fire(vacuum);
    expect(combat.debris.items.filter((d) => d.active).length).toBe(0);

    let boostedCount = 0;
    let boostedDmg = 0;
    for (const b of combat.bullets.items) {
      if (b.active && b.ownerId === vacuum.id) {
        boostedCount++;
        boostedDmg = b.damage;
      }
    }
    expect(boostedCount).toBeGreaterThan(stats.shotgunPellets);
    expect(boostedCount).toBeLessThanOrEqual(VACUUM.maxPellets);
    expect(boostedDmg).toBeGreaterThan(stats.shotgunDamage);

    combat.fire(rival);
    let rivalCount = 0;
    for (const b of combat.bullets.items) {
      if (b.active && b.ownerId === rival.id) rivalCount++;
    }
    expect(rivalCount).toBe(emptyCount);
  });
});

describe("Burrower (Rocket Launcher branch 1)", () => {
  it("drills through terrain, lays mines along the drilled path, and detonates the whole group together", () => {
    const world = makeRoom(40, 24);
    for (let x = 10; x <= 22; x++) {
      for (let y = 10; y <= 14; y++) {
        world.health[y * world.width + x] = 5;
      }
    }
    const bursts: { x: number; y: number; r: number }[] = [];
    const stats = baseSoldierStats();
    stats.rocketBulletSpeed = 240;
    const combat = new CombatSystem(world, new Rng(4), stats, {
      onExplosion: (x, y, r) => bursts.push({ x, y, r }),
    });
    const s = new Soldier(60, 12 * 8 + 4, 1, 0, 0, "rocket_launcher", "free", 1, null, "burrower");
    combat.fire(s);

    // Step until rocket drills across terrain and detonates on terminal exit/cap.
    for (let i = 0; i < 60; i++) {
      combat.updateBullets(1 / 60);
      if (bursts.length > 0) break;
    }

    expect(combat.burrower.totalGroupsDetonated).toBe(1);
    expect(bursts.length).toBeGreaterThanOrEqual(2);
    expect(combat.burrower.totalChargesDetonated).toBe(bursts.length);
    expect(combat.burrower.mines.activeCount).toBe(0);
    expect(bursts.length).toBeLessThanOrEqual(BURROWER.mineCount + 1);
  });

  it("stops cleanly at closed gates without bypassing them", () => {
    const world = makeRoom(32, 24);
    const door = { id: 1, tier: 1 as const, open: false, cells: [12 * 32 + 16], x0: 16, y0: 12, x1: 16, y1: 12 };
    world.doors.push(door);
    world.mat[12 * 32 + 16] = MAT.door;
    world.doorId[12 * 32 + 16] = 1;
    world.health[12 * 32 + 16] = 999;

    const bursts: number[] = [];
    const combat = new CombatSystem(world, new Rng(5), baseSoldierStats(), {
      onExplosion: (x) => bursts.push(x),
    });
    const s = new Soldier(64, 12 * 8 + 4, 1, 0, 0, "rocket_launcher", "free", 1, null, "burrower");
    combat.fire(s);
    for (let i = 0; i < 60; i++) combat.updateBullets(1 / 60);

    expect(bursts.length).toBeGreaterThanOrEqual(1);
    expect(bursts.every((bx) => bx <= 17 * 8)).toBe(true);
    expect(door.open).toBe(false);
  });
});

describe("Shared Freeze & Orthogonal Shatter (Freeze Rockets & Cryospray)", () => {
  it("deals 0 terrain damage directly, halves enemy speed, doubles enemy damage, halves frozen Blight growth, and shatters orthogonal neighbors at 0.05s cadence", () => {
    const world = makeRoom(24, 24);
    for (let x = 10; x <= 14; x++) world.health[12 * 24 + x] = 10;
    const combat = new CombatSystem(world, new Rng(6), baseSoldierStats());
    const creatures = new CreatureSystem(world, new Rng(6));
    const growth = new GrowthSystem(world, new Rng(6));
    growth.freeze = combat.freeze;
    combat.creatures = creatures;

    // Freeze Rockets hit does 0 direct damage to rock.
    const rocketSoldier = new Soldier(48, 12 * 8 + 4, 1, 0, 0, "rocket_launcher", "free", 1, null, "freeze_rockets");
    combat.fire(rocketSoldier);
    for (let i = 0; i < 40; i++) combat.updateBullets(1 / 60);
    expect(world.health[12 * 24 + 10]).toBe(10);
    expect(world.health[12 * 24 + 11]).toBe(10);
    expect(combat.freeze.isCellFrozen(10, 12)).toBe(true);
    expect(combat.freeze.isCellFrozen(11, 12)).toBe(true);

    // Destroy (10, 12) with an external weapon: 50% of its frozen max HP hits orthogonal neighbor (11, 12) after FACILITY.glassChainDelay (0.05s).
    const expectedShatter = Math.max(1, Math.floor(world.maxHealthAt(10, 12) * 0.5));
    world.damage(10, 12, 10, true);
    expect(world.health[12 * 24 + 11]).toBe(10); // not immediate!
    combat.freeze.update(FACILITY.glassChainDelay - 0.005);
    expect(world.health[12 * 24 + 11]).toBe(10);
    combat.freeze.update(0.01);
    expect(world.health[12 * 24 + 11]).toBe(10 - expectedShatter); // 50% of frozen max HP dealt orthogonally!

    // Cryospray refreshes creature freeze without stacking and causes 50% speed + 2x incoming damage.
    for (let sx = 14; sx <= 24; sx++) world.setSubCell(sx, 12, 3, "grown");
    const col = growth.colonies.colonyAt(12 * world.subWidth + 18)!;
    const w = creatures.spawnWorm(col)!;
    w.hp = 10;
    combat.freeze.freezeCreature(w, FREEZE.duration);
    const baseDps = 2;
    expect(creatures.damageCreature(w, baseDps, w.seg[0], w.seg[1])).toBe(false); // 2 * 2 = 4 dmg -> 6 HP left
    expect(w.hp).toBe(10 - baseDps * FREEZE.enemyDamageMult);

    // Overlapping freeze refreshes timer without compounding multiplier.
    combat.freeze.freezeCreature(w, FREEZE.duration);
    expect(creatures.damageCreature(w, 1, w.seg[0], w.seg[1])).toBe(false);
    expect(w.hp).toBe(10 - (baseDps + 1) * FREEZE.enemyDamageMult);
  });
});

describe("Rail Lance (Sniper branch 2)", () => {
  it("charges without firing early, then executes a single straight piercing strike that stops at closed gates", () => {
    const world = makeRoom(60, 24);
    for (let x = 14; x <= 20; x++) world.health[12 * 60 + x] = 2;
    const door = { id: 1, tier: 1 as const, open: false, cells: [12 * 60 + 25], x0: 25, y0: 12, x1: 25, y1: 12 };
    world.doors.push(door);
    world.mat[12 * 60 + 25] = MAT.door;
    world.doorId[12 * 60 + 25] = 1;
    world.health[12 * 60 + 25] = 999;
    world.health[12 * 60 + 28] = 2; // behind closed gate

    const stats = baseSoldierStats();
    stats.sniperFireRate = 1; // 1.0s charge
    stats.sniperPierce = 10;
    const combat = new CombatSystem(world, new Rng(7), stats);
    const s = new Soldier(64, 12 * 8 + 4, 1, 0, 0, "sniper_rifle", "free", 1, null, "rail_lance");

    // 0.5s into charge: 0 strikes, 0 damage.
    for (let i = 0; i < 30; i++) combat.updateSoldier(s, 1 / 60);
    expect(combat.rail.totalStrikes).toBe(0);
    expect(world.health[12 * 60 + 14]).toBe(2);

    // Complete 1.0s charge: single piercing strike breaks cells before gate, stops at gate, leaves cell behind gate intact.
    for (let i = 0; i < 32; i++) combat.updateSoldier(s, 1 / 60);
    expect(combat.rail.totalStrikes).toBe(1);
    expect(world.health[12 * 60 + 14]).toBe(0);
    expect(world.health[12 * 60 + 28]).toBe(2);
    expect(RAIL.maxRange).toBeGreaterThan(1000);
  });
});

describe("Napalm Garden (Flamethrower branch 1)", () => {
  it("stays unlit for 10s without self-igniting, burns for exact 15 ticks over 3s when lit by another weapon, and cleans up on host death", () => {
    const world = makeRoom(32, 24);
    world.health[12 * 32 + 16] = 100;
    const combat = new CombatSystem(world, new Rng(8), baseSoldierStats());
    const creatures = new CreatureSystem(world, new Rng(8));
    combat.creatures = creatures;

    // Place unlit patch on block (16, 12); Napalm ticks/placement do not ignite.
    const p1 = combat.napalm.placeCellPatch(1, 16, 12, 16 * 8 + 4, 12 * 8 + 4, 2, 0, 1);
    expect(p1).not.toBeNull();
    expect(p1!.lit).toBe(false);
    combat.napalm.update(1.0, creatures);
    expect(world.health[12 * 32 + 16]).toBe(100);

    // Unlit patch expires after 10 seconds.
    combat.napalm.update(NAPALM.unlitDuration, creatures);
    expect(p1!.active).toBe(false);

    // Place another unlit patch on block (16, 12) and ignite via external weapon.
    const p2 = combat.napalm.placeCellPatch(1, 16, 12, 16 * 8 + 4, 12 * 8 + 4, 2, 0, 1)!;
    expect(combat.napalm.igniteAt(16 * 8 + 4, 12 * 8 + 4, 8, 2)).toBe(1);
    expect(p2.lit).toBe(true);

    // Immediately after ignition: 0 burn ticks (no accidental extra initial tick).
    expect(p2.ticksDone).toBe(0);

    // Step full 3.0s in 0.05s increments: exact 15 ticks (2 dmg * 15 = 30 damage -> 70 HP left).
    for (let i = 0; i < 65; i++) combat.napalm.update(0.05, creatures);
    expect(combat.napalm.totalTicks).toBe(Math.round(NAPALM.burnDuration / NAPALM.tickInterval));
    expect(world.health[12 * 32 + 16]).toBe(70);
    expect(p2.active).toBe(false);

    // Creature-bound flame dissipates immediately when creature dies.
    const growth = new GrowthSystem(world, new Rng(8));
    growth.reset();
    for (let sx = 16; sx <= 28; sx++) world.setSubCell(sx, 16, 3, "grown");
    const col = growth.colonies.colonyAt(16 * world.subWidth + 20)!;
    const w = creatures.spawnWorm(col)!;
    w.hp = 5;
    const wx = w.seg[0];
    const wy = w.seg[1];
    const p3 = combat.napalm.placeCreaturePatch(1, w, wx, wy, 2, 0, 1)!;
    combat.napalm.igniteAt(wx, wy, 8, 2);
    expect(p3.active).toBe(true);
    creatures.damageCreature(w, 999, wx, wy);
    combat.napalm.update(0.05, creatures);
    expect(p3.active).toBe(false);
  });
});

describe("Canonical Black Market integration & lab-only refund", () => {
  it("enforces unique non-Pistol primaries across squad, independent Pistol mutations, and exact lab-only Black Market refunds", () => {
    const storage = new MemoryStorage();
    const save = new SaveManager(storage);
    const u = new UpgradeManager(save);
    unlockTabs(save);
    save.data.lifetimePixels = 10000;
    save.data.bank = 100000;
    save.data.crystals = 10000;
    save.data.essence = 500;

    expect(u.buy("shotgun_unlock")).toBe(true);
    expect(u.buy("vacuum_unlock")).toBe(true);
    expect(u.buy("reverse_unlock")).toBe(true);
    expect(u.buy("orbit_unlock")).toBe(true);
    expect(u.buy("katana_unlock")).toBe(true);
    expect(u.buy("gale_unlock")).toBe(true);

    // Multiple soldiers can pick independent Pistol mutations.
    expect(u.setLoadoutWeapon(0, "pistol", "reverse_revolver", false).ok).toBe(true);
    expect(u.setLoadoutWeapon(1, "pistol", "orbit_cylinder", false).ok).toBe(true);

    // Non-Pistol primary cannot be duplicated across slots even with different mutations.
    expect(u.setLoadoutWeapon(2, "shotgun", "vacuum_pulse", false).ok).toBe(true);
    expect(u.setLoadoutWeapon(3, "shotgun", null, false).ok).toBe(false);

    // Compatibility matrix accurately flags inactive conventional upgrades.
    expect(mutationCompatibility("freeze_rockets").inactive.length).toBeGreaterThan(0);
    expect(mutationCompatibility("rail_lance").inactive.length).toBeGreaterThan(0);

    // Refund is lab-only: blocked during an active run, succeeds in lab and restores exact currencies.
    const essenceBeforeRefund = save.data.essence;
    expect(u.refundBlackMarket(true).ok).toBe(false);
    const res = u.refundBlackMarket(false);
    expect(res.ok).toBe(true);
    expect(save.data.essence).toBeGreaterThan(essenceBeforeRefund);
    expect(save.data.upgrades.vacuum_unlock).toBe(0);
    expect(save.data.upgrades.reverse_unlock).toBe(0);
    expect(save.data.loadouts[2].mutation).toBeNull();
  });
});
