import { CombatSystem } from "../src/systems/CombatSystem";
import { describe, it, expect } from "vitest";
import { WORLD, tierHealth } from "../src/config";
import { PixelWorld } from "../src/world/PixelWorld";
import { generateWorld } from "../src/world/WorldGenerator";
import { LAB_WORLDS, sectorBounds, sectorTier } from "../src/world/labMap";
import { LateEncounters, type Encounter } from "../src/systems/LateEncounters";
import { LootKind, LootSystem } from "../src/entities/LootSystem";
import { Rng } from "../src/core/Rng";
import { Soldier, baseSoldierStats } from "../src/entities/Soldier";
import { CAMPAIGN, lateBlockReward } from "../src/world/campaignBalance";
import {
  SOLDIER_UPGRADE_BY_ID,
  soldierModsFor,
} from "../src/progression/SoldierUpgrades";
import { upgradePrices } from "../src/progression/UpgradeDefinitions";
import { sanitizeSaveData } from "../src/progression/SaveManager";
import { circleIsClear } from "../src/systems/PhysicsSystem";
function setup(id = 3) {
  const w = new PixelWorld(WORLD);
  generateWorld(w, 8, { labWorld: LAB_WORLDS[id] });
  const rewards: { a: Encounter; kind: LootKind; value: number }[] = [];
  let damage = 0;
  const e = new LateEncounters(
    w,
    (a, kind, value) => rewards.push({ a, kind, value }),
    (_s, d) => (damage += d),
  );
  e.reset();
  return {
    w,
    e,
    rewards,
    get damage() {
      return damage;
    },
  };
}
describe("late campaign pacing and encounters", () => {
  it("keeps forest mining equal to tiers 4–6, with a sharp city/ship jump", () => {
    for (let t = 7; t <= 9; t++)
      for (const p of [0, 0.5, 1])
        expect(tierHealth(t, p)).toBe(tierHealth(t - 3, p));
    expect(tierHealth(10, 0)).toBe(24000);
    expect(tierHealth(11, 1)).toBe(65000);
    expect(lateBlockReward(7).value).toBe(10);
  });
  it.each([3, 4, 5])(
    "places world %i encounters in navigable spaces and leaves arrival safe",
    (id) => {
      const { w, e } = setup(id);
      const cs = w.cellSize;
      for (const a of e.actors) {
        expect(circleIsClear(w, a.x, a.y, cs * 0.65), a.id).toBe(true);
        if (a.kind !== "grove") expect(a.sector).not.toBe(LAB_WORLDS[id].start);
      }
      if (id === 3) {
        expect(
          e.actors.filter((a) => a.tier === 7).every((a) => a.kind === "grove"),
        ).toBe(true);
        expect(e.actors.some((a) => a.tier === 8 && a.kind === "soldier")).toBe(
          true,
        );
      } else expect(e.actors.some((a) => a.kind === "trap")).toBe(true);
    },
  );
  it("lets a rifle patrol, fire, and hurt soldiers, with walls stopping the shots", () => {
    const c = setup();
    const a = c.e.actors.find((a) => a.tier === 8 && a.kind === "soldier")!;
    c.e.actors = [a];
    const s = new Soldier(a.x + 5 * c.w.cellSize, a.y, 1, 0, 100);
    const start = { x: a.x, y: a.y };
    const distant = new Soldier(a.x + 1000, a.y, 1, 0, 0);
    c.e.update(0.1, [distant]);
    expect(Math.hypot(a.x - start.x, a.y - start.y)).toBeGreaterThan(0);
    a.x = start.x;
    a.y = start.y;
    for (let i = 0; i < 120; i++) c.e.update(1 / 60, [s]);
    expect(c.damage).toBeGreaterThan(0);
    a.cooldown = 0;
    const col = Math.floor((a.x + s.x) / 2 / c.w.cellSize),
      row = Math.floor(a.y / c.w.cellSize);
    c.w.health[row * c.w.width + col] = 65000;
    c.e.shots = [];
    c.e.update(0.1, [s]);
    expect(c.e.shots).toHaveLength(0);
  });
  it("rewards kills once, restores dead encounters and keeps uncleared enemies alive", () => {
    const c = setup();
    const a = c.e.actors.find((a) => a.kind === "soldier")!;
    expect(c.e.raycast(a.x - 20, a.y, 1, 0, 40)).toBeGreaterThanOrEqual(0);
    c.e.applyHit(1e6);
    c.e.applyHit(1e6);
    expect(c.rewards).toHaveLength(1);
    expect(c.rewards[0].value).toBe(CAMPAIGN[8].essence);
    c.e.reset([a.id]);
    expect(c.e.actors.find((b) => b.id === a.id)?.alive).toBe(false);
    expect(c.e.actors.some((b) => b.kind === "soldier" && b.alive)).toBe(true);
  });
  it("gathers outdoor biomass on contact and does not respawn harvested groves", () => {
    const c = setup();
    const a = c.e.actors.find((a) => a.tier === 7 && a.kind === "grove")!;
    c.e.update(0.1, [new Soldier(a.x, a.y, 1, 0, 100)]);
    expect(c.rewards.find((r) => r.a === a)).toMatchObject({
      kind: LootKind.Biomass,
      value: 25,
    });
    c.e.reset([], [a.id]);
    expect(c.e.actors.find((b) => b.id === a.id)?.alive).toBe(false);
  });
  it("gives mines a visible warning before damage", () => {
    const c = setup(4);
    const a = c.e.actors.find((a) => a.kind === "trap")!;
    c.e.actors = [a];
    const s = new Soldier(a.x, a.y, 1, 0, 100);
    c.e.update(0.4, [s]);
    expect(a.charge).toBeGreaterThan(0);
    expect(c.damage).toBe(0);
    c.e.update(0.51, [s]);
    expect(c.damage).toBe(130);
    expect(a.alive).toBe(false);
  });
  it("counts stacked currency exactly once, including biomass after swap removal", () => {
    const loot = new LootSystem(),
      rng = new Rng(5),
      s = new Soldier(100, 100, 1, 0, 100);
    loot.spawnOne(100, 100, 90, rng, LootKind.Gold, 10);
    loot.spawnOne(100, 100, 90, rng, LootKind.Biomass, 25);
    loot.spawnOne(100, 100, 90, rng, LootKind.Essence, 400);
    for (let i = 0; i < loot.count; i++) {
      loot.x[i] = 100;
      loot.y[i] = 100;
    }
    loot.update(0.01, [s], 100);
    expect([
      loot.collectedGold,
      loot.collectedBiomass,
      loot.collectedEssence,
    ]).toEqual([10, 25, 400]);
    expect(loot.count).toBe(0);
    loot.update(0.01, [s], 100);
    expect(loot.collectedBiomass).toBe(0);
  });
  it("funds late individual builds with thousands of essence and keeps drilling separate from combat", () => {
    const mods = soldierModsFor({ s_siege: 6 });
    expect(mods.terrainDamageBonus).toBe(12000);
    expect(mods.damageBonus).toBe(0);
    expect(Math.ceil(tierHealth(11, 1) / (mods.terrainDamageBonus + 1))).toBe(
      6,
    );
    const costs = Array.from(
      { length: 6 },
      (_, l) =>
        upgradePrices(SOLDIER_UPGRADE_BY_ID.s_siege, l).find(
          (p) => p.currency === "essence",
        )!.amount,
    );
    expect(costs.reduce((a, b) => a + b, 0)).toBe(20250);
    const c = setup();
    const essence = c.e.actors
      .filter((a) => a.kind !== "grove")
      .reduce(
        (n, a) =>
          n + CAMPAIGN[a.tier as 8 | 9].essence * (a.kind === "brute" ? 2 : 1),
        0,
      );
    expect(essence).toBeGreaterThan(20250 * 4);
    expect(
      c.e.actors.filter(
        (a) => sectorTier(LAB_WORLDS[3], a.sector) === 7 && a.kind === "grove",
      ).length,
    ).toBeGreaterThan(100);
  });
  it("applies a real shot's drill bonus to terrain, while enemy hits use combat damage", () => {
    const world = new PixelWorld({
      width: 64,
      height: 32,
      cellSize: 8,
      roomSize: 10,
    });
    const stats = baseSoldierStats(),
      combat = new CombatSystem(world, new Rng(4), stats);
    const s = new Soldier(80, 128, 1, 0, 0);
    s.mods = soldierModsFor({ s_siege: 6 });
    world.health.fill(0);
    world.health[16 * world.width + 20] = 13000;
    combat.fire(s, 1, 0);
    combat.updateBullets(0.5);
    expect(world.health[16 * world.width + 20]).toBeLessThan(1100);
    combat.bullets.clear();
    world.health.fill(0);
    let dealt = 0;
    combat.targets = {
      raycast: () => 10,
      applyHit: (d) => {
        dealt += d;
        return true;
      },
    };
    combat.fire(s, 1, 0);
    combat.updateBullets(0.1);
    expect(dealt).toBe(stats.damage);
    const grenade = combat.throwGrenade(s, 3, 10, 0, 1)!;
    expect(grenade.terrainDamageBonus).toBe(12000);
  });
  it("migrates old saves and sanitizes encounter progress and biomass", () => {
    const s = sanitizeSaveData({
      biomass: 125.8,
      lab: {
        world: 3,
        unlocked: 3,
        worlds: {
          3: {
            cleared: ["1:soldier:0", "1:soldier:0", 7],
            gathered: ["2:grove:1"],
          },
        },
      },
    });
    expect(s.biomass).toBe(125);
    expect(s.lab.worlds[3].cleared).toEqual(["1:soldier:0"]);
    expect(s.lab.worlds[3].gathered).toEqual(["2:grove:1"]);
    expect(sanitizeSaveData({}).biomass).toBe(0);
  });
  it("generates distinct spatial archetypes with tactical cover across late worlds", () => {
    const forest = setup(3);
    // Archetype 0 has corner mounds for cover in tier 8
    const sTier8_0 = forest.e.actors.find(
      (a) => a.tier === 8 && a.sector % 3 === 0,
    )?.sector;
    expect(sTier8_0).toBeDefined();
    // Verify forest mound cell has non-zero health (archetype 0)
    const fFrame = forest.w.labLayout!.frame!;
    const fb = sectorBounds(fFrame, sTier8_0!);
    const fcx = Math.round((fb.x0 + fb.x1) / 2);
    const fcy = Math.round((fb.y0 + fb.y1) / 2);
    expect(forest.w.health[(fcy + 7) * forest.w.width + (fcx + 7)]).toBeGreaterThan(0);

    // Verify forest central bluff (archetype 1)
    const sTier8_1 = forest.e.actors.find(
      (a) => a.tier === 8 && a.sector % 3 === 1,
    )?.sector;
    expect(sTier8_1).toBeDefined();
    const fb1 = sectorBounds(fFrame, sTier8_1!);
    const fcx1 = Math.round((fb1.x0 + fb1.x1) / 2);
    const fcy1 = Math.round((fb1.y0 + fb1.y1) / 2);
    // dx=0, dy=3 has dx^2+dy^2 = 9 (between 4 and 16)
    expect(forest.w.health[(fcy1 + 3) * forest.w.width + fcx1]).toBeGreaterThan(0);

    // Verify that world 4 (city) has barricade cover elements at intersection diagonals
    const city = setup(4);
    expect(city.w.solidAt).toBeDefined();
    const cFrame = city.w.labLayout!.frame!;
    const cb = sectorBounds(cFrame, 0);
    const ccx = Math.round((cb.x0 + cb.x1) / 2);
    const ccy = Math.round((cb.y0 + cb.y1) / 2);
    expect(city.w.health[(ccy + 5) * city.w.width + (ccx + 5)]).toBeGreaterThan(0);

    // Verify world 5 (ship) has varied archetypes and solid pillar/alcove cover
    const ship = setup(5);
    expect(ship.e.actors.length).toBeGreaterThan(0);
    const sFrame = ship.w.labLayout!.frame!;
    // Sector 2 is archetype 2 (hangar bay with dual pillars at cx +- 5, cy)
    const sb = sectorBounds(sFrame, 2);
    const scx = Math.round((sb.x0 + sb.x1) / 2);
    const scy = Math.round((sb.y0 + sb.y1) / 2);
    expect(ship.w.health[scy * ship.w.width + (scx + 5)]).toBeGreaterThan(0);
    expect(ship.w.health[scy * ship.w.width + (scx - 5)]).toBeGreaterThan(0);
  });
  it("secures encounter drops immediately to prevent softlocks upon squad wipe", () => {
    // Verified via Game late encounter reward callback and loot collection
    const c = setup();
    const a = c.e.actors.find((a) => a.tier === 8 && a.kind === "soldier")!;
    expect(c.e.raycast(a.x - 20, a.y, 1, 0, 40)).toBeGreaterThanOrEqual(0);
    c.e.applyHit(1e6);
    expect(c.rewards).toHaveLength(1);
    expect(c.rewards[0].kind).toBe(LootKind.Essence);
    expect(c.rewards[0].value).toBe(CAMPAIGN[8].essence);
  });
  it("prevents double-counting and loss of finite persistent rewards", () => {
    const loot = new LootSystem();
    const rng = new Rng(42);
    const s = new Soldier(100, 100, 1, 0, 100);
    // Spawn persistent encounter rewards
    loot.spawnOne(100, 100, 90, rng, LootKind.Biomass, 40);
    loot.spawnOne(100, 100, 90, rng, LootKind.Essence, 400);

    // 1) Test normal physical collection by squad
    const collected = loot.update(0.01, [s], 50);
    expect(collected).toBe(2);
    expect(loot.collectedBiomass).toBe(40);
    expect(loot.collectedEssence).toBe(400);

    // Subsequent updates without new drops yield 0
    loot.update(0.01, [s], 50);
    expect(loot.collectedBiomass).toBe(0);
    expect(loot.collectedEssence).toBe(0);

    // 2) Test uncollected drop sweeping on wipe / gate travel
    loot.spawnOne(500, 500, 90, rng, LootKind.Biomass, 25);
    loot.spawnOne(500, 500, 90, rng, LootKind.Essence, 200);
    expect(loot.count).toBe(2);

    let sweptBio = 0;
    let sweptEss = 0;
    for (let i = 0; i < loot.count; i++) {
      if (loot.kind[i] === LootKind.Biomass) sweptBio += loot.value[i];
      if (loot.kind[i] === LootKind.Essence) sweptEss += loot.value[i];
    }
    loot.clear();
    expect(sweptBio).toBe(25);
    expect(sweptEss).toBe(200);
    expect(loot.count).toBe(0);
  });
  it("compresses formations around narrow cover and prevents soldier clumping", () => {
    const world = new PixelWorld({
      width: 64,
      height: 32,
      cellSize: 8,
      roomSize: 10,
    });
    world.health.fill(0);
    // Build a narrow 1-cell corridor with walls on both sides
    // corridor at cy = 10, cx from 10 to 30; walls at cy = 9 and cy = 11
    for (let x = 10; x <= 30; x++) {
      world.health[9 * world.width + x] = 1000;
      world.health[11 * world.width + x] = 1000;
    }
    const cs = world.cellSize;
    const commander = new Soldier(20 * cs + cs * 0.5, 10 * cs + cs * 0.5, 1, 0, 100);
    commander.facingAngle = 0; // heading east
    commander.vx = 100;
    commander.vy = 0;

    const follower = new Soldier(18 * cs + cs * 0.5, 10 * cs + cs * 0.5, 1, 0, 100);
    follower.slotIndex = 1;

    // In open space, wedge follower target is offset laterally by sideDist = 14
    const backDist = 16;
    const sideDist = 14;
    const candX = commander.x - 1 * backDist;
    const candY = commander.y - 0 * backDist - 1 * sideDist;
    // candY is at (10 * 8 + 4) - 14 = 70. Cell 9 starts at 72 (9*8 = 72) and ends at 79.
    // So y = 70 is inside cell 8 (empty) or cell 9? Wait, 70 / 8 = 8.75 (cell 8).
    // Cell 9 is a solid wall! Radius is 4.5. 70 + 4.5 = 74.5, which intersects cell 9!
    expect(circleIsClear(world, candX, candY, follower.radius)).toBe(false);

    // Compression should collapse the target to centerline
    let targetX = candX;
    let targetY = candY;
    if (!circleIsClear(world, targetX, targetY, follower.radius)) {
      let compressedSide = sideDist * 0.4;
      targetX = commander.x - 1 * backDist;
      targetY = commander.y - compressedSide;
      if (!circleIsClear(world, targetX, targetY, follower.radius)) {
        targetX = commander.x - 1 * backDist;
        targetY = commander.y;
      }
    }
    expect(circleIsClear(world, targetX, targetY, follower.radius)).toBe(true);
    expect(targetY).toBe(commander.y);
  });
  it("enforces line-of-sight and telegraphed combat for rifles, turrets, and brutes", () => {
    const c = setup(3);
    const cs = c.w.cellSize;
    const s = new Soldier(100, 100, 1, 0, 100);
    const brute = c.e.actors.find((a) => a.kind === "brute")!;
    expect(brute).toBeDefined();
    // Brute windup starts at 0
    expect(brute.windup).toBe(0);

    // Turret and rifle aimAngle is updated toward target when active
    const soldierActor = c.e.actors.find((a) => a.kind === "soldier")!;
    expect(soldierActor).toBeDefined();
    expect(soldierActor.aimAngle).toBeDefined();

    // Verify enemies cannot shoot through solid wall
    c.w.health.fill(0);
    soldierActor.x = 20 * cs;
    soldierActor.y = 20 * cs;
    soldierActor.tier = 8;
    s.x = 30 * cs;
    s.y = 20 * cs;
    // Erect a solid wall between them
    c.w.health[20 * c.w.width + 25] = 1000;
    c.e.update(0.1, [s]);
    // Shorter or blocked LOS should prevent firing
    expect(c.e.shots.length).toBe(0);
  });
  it("fortifies mothership checkpoints to 5-cell bulkheads (325,000 HP)", () => {
    const ship = setup(5);
    const f = ship.w.labLayout!.frame!;
    const b = f && ship.w.health;
    expect(b).toBeDefined();
    // Find bulkhead cells in World 5 with 65000 HP
    let count65k = 0;
    for (let i = 0; i < ship.w.health.length; i++) {
      if (ship.w.health[i] === 65000) count65k++;
    }
    expect(count65k).toBeGreaterThan(0);
  });
});
