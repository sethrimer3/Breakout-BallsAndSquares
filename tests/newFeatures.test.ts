import { describe, expect, it } from "vitest";
import { GROWTH, growthRateAt, maxHealthForDistance, SOLDIER, TERRAIN, WORLD } from "../src/config";
import { Rng } from "../src/core/Rng";
import { CasingSystem } from "../src/entities/CasingSystem";
import { baseSoldierStats, Soldier } from "../src/entities/Soldier";
import { UPGRADE_BY_ID } from "../src/progression/UpgradeDefinitions";
import { GrowthSystem } from "../src/world/GrowthSystem";
import { PixelWorld } from "../src/world/PixelWorld";
import { generateWorld } from "../src/world/WorldGenerator";

describe("New Features & Upgrades", () => {
  it("Grace period starts at 5s and upgrades by +1s up to 15s", () => {
    expect(GROWTH.graceSeconds).toBe(5);
    const def = UPGRADE_BY_ID.blight_delay;
    expect(def.maxLevel).toBe(10);
    expect(def.valueAt(0)).toBe(5);
    expect(def.valueAt(10)).toBe(15);

    const stats = baseSoldierStats();
    expect(stats.blightGraceSeconds).toBe(5);
    def.apply(stats, 10);
    expect(stats.blightGraceSeconds).toBe(15);
  });

  it("Starting Blight rate starts at 1/s and has an upgrade to reduce it by 0.1/s down to 0/s", () => {
    expect(GROWTH.baseRate).toBe(1.0);
    expect(growthRateAt(5.0)).toBeCloseTo(1.0, 3);

    const def = UPGRADE_BY_ID.blight_start_rate;
    expect(def).toBeDefined();
    expect(def.maxLevel).toBe(10);
    expect(def.valueAt(0)).toBeCloseTo(1.0, 2);
    expect(def.valueAt(5)).toBeCloseTo(0.5, 2);
    expect(def.valueAt(10)).toBeCloseTo(0.0, 2);

    const stats = baseSoldierStats();
    expect(stats.blightStartRate).toBeCloseTo(1.0, 2);
    def.apply(stats, 10);
    expect(stats.blightStartRate).toBeCloseTo(0.0, 2);

    // At level 10 (startRate = 0), growth rate at grace end is 0 and rises over time
    expect(growthRateAt(5.0, 0.0)).toBeCloseTo(0.0, 3);
    expect(growthRateAt(15.0, 0.0)).toBeGreaterThan(0.5);
  });

  it("Blight growth rate dampener reduces replication speed by 5% per level up to 50% when maxed", () => {
    const def = UPGRADE_BY_ID.blight_slow;
    expect(def.maxLevel).toBe(10);
    expect(def.valueAt(0)).toBe(100);
    expect(def.valueAt(10)).toBe(50);

    const stats = baseSoldierStats();
    def.apply(stats, 1);
    expect(stats.blightRateMultiplier).toBeCloseTo(0.95, 3);
    def.apply(stats, 10);
    expect(stats.blightRateMultiplier).toBeCloseTo(0.50, 3);
  });

  it("Soldier base speed is cut in half, and has a core upgrade for +8% up to 10 times", () => {
    expect(SOLDIER.speed).toBe(62.5);
    const def = UPGRADE_BY_ID.ball_speed;
    expect(def.branch).toBe("core");
    expect(def.maxLevel).toBe(10);
    expect(def.valueAt(0)).toBe(100);
    expect(def.valueAt(1)).toBe(108);
    expect(def.valueAt(10)).toBe(180);

    const stats = baseSoldierStats();
    expect(stats.speed).toBe(62.5);
    def.apply(stats, 10);
    expect(stats.speed).toBeCloseTo(62.5 * 1.8, 3);
  });

  it("Explosive Blight: pink blight blocks have a chance to explode shortly after forming, damaging nearby blocks", () => {
    const chanceDef = UPGRADE_BY_ID.explosive_blight_chance;
    const dmgDef = UPGRADE_BY_ID.explosive_blight_damage;
    const radDef = UPGRADE_BY_ID.explosive_blight_radius;
    expect(chanceDef).toBeDefined();
    expect(dmgDef).toBeDefined();
    expect(radDef).toBeDefined();

    const stats = baseSoldierStats();
    chanceDef.apply(stats, 10); // 50% chance
    dmgDef.apply(stats, 2);     // 3 dmg
    radDef.apply(stats, 2);     // 2.0 rad

    expect(stats.explosiveBlightChance).toBeCloseTo(0.5, 2);
    expect(stats.explosiveBlightDamage).toBe(3);
    expect(stats.explosiveBlightRadius).toBeCloseTo(2.0, 1);

    const world = new PixelWorld({ width: 32, height: 32, cellSize: 8, roomSize: 4 });
    generateWorld(world, 42);
    let exploded = false;
    let explodeCx = -1;
    let explodeCy = -1;
    const growth = new GrowthSystem(world, new Rng(42), {
      onBlightExplode: (cx, cy) => {
        exploded = true;
        explodeCx = cx;
        explodeCy = cy;
      },
    });
    growth.reset();
    growth.explosiveChance = 1.0; // Guaranteed explosion
    growth.explosiveDamage = 3;
    growth.explosiveRadius = 2.0;
    growth.graceSeconds = 0;

    // Trigger one replication event
    const replicated = growth.replicateOne(1.0, []);
    expect(replicated).toBe(true);
    // Advance simulation time beyond the short explosion fuse (0.45s)
    growth.update(0.5, 1.5, []);

    expect(exploded).toBe(true);
    expect(explodeCx).toBeGreaterThanOrEqual(0);
    expect(explodeCy).toBeGreaterThanOrEqual(0);
  });

  it("Soldier Health allows soldiers to survive being enclosed in blight, costing 1 HP per block traveled to safety", () => {
    const hpDef = UPGRADE_BY_ID.soldier_health;
    expect(hpDef).toBeDefined();
    expect(hpDef.branch).toBe("core");
    expect(hpDef.maxLevel).toBe(10);
    expect(hpDef.valueAt(1)).toBe(10);

    const stats = baseSoldierStats();
    expect(stats.soldierHealth).toBe(0);
    hpDef.apply(stats, 2);
    expect(stats.soldierHealth).toBe(20);

    const world = new PixelWorld({ width: 32, height: 32, cellSize: 8, roomSize: 10 });
    const growth = new GrowthSystem(world, new Rng(1));

    // Soldier with 0 health dies immediately when enclosed
    const s1 = new Soldier(world.centerX * 8 + 4, world.centerY * 8 + 4, 1, 0, 62.5);
    s1.health = 0;
    s1.maxHealth = 0;
    world.setCell(world.centerX, world.centerY, 10, "grown");
    // Growth over the soldier with 0 health kills them
    const killed1 = !growth["tryRescueSoldier"](s1, world.centerX, world.centerY);
    expect(killed1).toBe(true);

    // Soldier with 15 health survives being enclosed, costing distance in blocks
    const s2 = new Soldier(world.centerX * 8 + 4, world.centerY * 8 + 4, 1, 0, 62.5);
    s2.health = 15;
    s2.maxHealth = 15;
    const rescued = growth["tryRescueSoldier"](s2, world.centerX, world.centerY);
    expect(rescued).toBe(true);
    expect(s2.health).toBeLessThan(15);
    expect(s2.health).toBeGreaterThan(0);
    expect(s2.alive).toBe(true);
  });

  it("Pixels in Tier 2 and Tier 3 are an order of magnitude tougher than Tier 1", () => {
    // Tier 1 (Zone 1): 1 - 5 HP
    const t1Start = maxHealthForDistance(TERRAIN.roomRadius);
    const t1End = maxHealthForDistance(TERRAIN.roomRadius + TERRAIN.zone2Depth - 1);
    expect(t1Start).toBe(1);
    expect(t1End).toBe(5);

    // Tier 2 (Zone 2): 10 - 50 HP (order of magnitude)
    const t2Start = maxHealthForDistance(TERRAIN.roomRadius + TERRAIN.zone2Depth);
    const t2End = maxHealthForDistance(TERRAIN.roomRadius + TERRAIN.zone3Depth - 1);
    expect(t2Start).toBe(10);
    expect(t2End).toBe(50);

    // Tier 3 (Zone 3): 100 - 500 HP
    const t3Start = maxHealthForDistance(TERRAIN.roomRadius + TERRAIN.zone3Depth);
    const t3Deep = maxHealthForDistance(TERRAIN.roomRadius + TERRAIN.zone3Depth + TERRAIN.zone3Span);
    expect(t3Start).toBe(100);
    expect(t3Deep).toBe(500);

    // Check PixelWorld uses Uint16Array capable of holding 500+ HP
    const world = new PixelWorld(WORLD);
    expect(world.health instanceof Uint16Array).toBe(true);
    expect(world.subHealth instanceof Uint16Array).toBe(true);
    world.setCell(10, 10, 500);
    expect(world.health[10 * world.width + 10]).toBe(500);
  });

  it("Bullet casings bounce off walls instead of passing into them", () => {
    const world = new PixelWorld({ width: 32, height: 32, cellSize: 8, roomSize: 10 });
    // Fill cell (5, 5) as solid wall
    world.setCell(5, 5, 10);
    const casings = new CasingSystem(16);

    // Place casing right next to wall moving toward it (+X)
    casings.count = 1;
    casings.x[0] = 4 * 8 + 6;
    casings.y[0] = 5 * 8 + 4;
    casings.vx[0] = 60;
    casings.vy[0] = 0;
    casings.life[0] = 1.0;
    casings.maxLife[0] = 1.0;
    casings.bounceAt[0] = 0;

    // Update casing physics with world collision
    for (let step = 0; step < 10; step++) {
      casings.update(0.016, world);
    }

    // Casing bounced off wall: vx was reversed
    expect(casings.vx[0]).toBeLessThan(0);
    // Casing did not enter cell (5, 5)
    expect(Math.floor(casings.x[0] / 8)).not.toBe(5);
  });
});
