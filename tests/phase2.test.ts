import { describe, expect, it } from "vitest";
import { GROWTH, SIM, SOLDIER, WORLD, growthRateAt } from "../src/config";
import { Rng } from "../src/core/Rng";
import { Soldier, baseSoldierStats } from "../src/entities/Soldier";
import { CombatSystem } from "../src/systems/CombatSystem";
import { PhysicsSystem, circleIsClear, findSpawnPoint } from "../src/systems/PhysicsSystem";
import { Frontier } from "../src/world/Frontier";
import { GrowthSystem } from "../src/world/GrowthSystem";
import { PixelWorld } from "../src/world/PixelWorld";
import { generateWorld } from "../src/world/WorldGenerator";

describe("Phase 2 — Frontier O(1) indexed set", () => {
  it("matches a full-world recompute after random destroys and growths", () => {
    const w = new PixelWorld({ width: 64, height: 64, cellSize: 8, roomSize: 10 });
    generateWorld(w, 5);
    const inc = new Frontier(w);
    inc.seedFromRoom();
    const rng = new Rng(5);
    for (let step = 0; step < 400; step++) {
      const cx = rng.int(64);
      const cy = rng.int(64);
      if (rng.next() < 0.6) w.setCell(cx, cy, 0, "destroyed");
      else w.setCell(cx, cy, w.maxHealthAt(cx, cy), "grown");
    }
    const ref = new Frontier(w);
    ref.rebuildFull();
    expect(inc.size).toBe(ref.size);
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        expect(inc.has(x, y)).toBe(ref.has(x, y));
      }
    }
  });
});

describe("Phase 2 — GrowthSystem rules & escalation", () => {
  it("honors the grace period, exponential rise and 150/s cap", () => {
    expect(growthRateAt(0)).toBe(0);
    expect(growthRateAt(GROWTH.graceSeconds - 0.01)).toBe(0);
    expect(growthRateAt(GROWTH.graceSeconds)).toBeCloseTo(GROWTH.baseRate, 5);
    expect(growthRateAt(30)).toBeGreaterThan(growthRateAt(15));
    expect(growthRateAt(1000)).toBe(GROWTH.maxRate);
  });

  it("reproduces only into cardinal neighbors and gives full location health", () => {
    const w = new PixelWorld({ width: 32, height: 32, cellSize: 8, roomSize: 6 });
    generateWorld(w, 9);
    const g = new GrowthSystem(w, new Rng(9));
    g.reset();
    for (let k = 0; k < 30; k++) {
      const snap = w.health.slice();
      expect(g.replicateOne(20, [])).toBe(true);
      // Find the single cell that changed from 0 to >0.
      let changed = -1;
      for (let i = 0; i < snap.length; i++) {
        if (snap[i] === 0 && w.health[i] > 0) {
          expect(changed).toBe(-1);
          changed = i;
        }
      }
      expect(changed).toBeGreaterThanOrEqual(0);
      const cx = changed % w.width;
      const cy = Math.floor(changed / w.width);
      expect(w.health[changed]).toBe(w.maxHealthAt(cx, cy));
      const hadCardinalParent =
        (cx > 0 && snap[changed - 1] > 0) ||
        (cx < w.width - 1 && snap[changed + 1] > 0) ||
        (cy > 0 && snap[changed - w.width] > 0) ||
        (cy < w.height - 1 && snap[changed + w.width] > 0);
      expect(hadCardinalParent).toBe(true);
    }
  });

  it("kills overlapping soldiers on replication, while normal contact only bounces", () => {
    const w = new PixelWorld({ width: 32, height: 32, cellSize: 8, roomSize: 6 });
    generateWorld(w, 12);
    const rng = new Rng(12);
    const phys = new PhysicsSystem(w, rng);
    // Normal contact: bounce 300 steps, still alive.
    const bouncer = new Soldier(w.roomCenterX, w.roomCenterY, 1, 0.3, 180);
    for (let i = 0; i < 300; i++) phys.step(bouncer, SIM.dt);
    expect(bouncer.alive).toBe(true);

    // Replication onto two overlapping soldiers kills both.
    let killed = 0;
    const g = new GrowthSystem(w, rng, { onSoldierKilled: () => killed++ });
    g.reset();
    const targetX = (w.roomX0 + 0.5) * 8;
    const targetY = (w.roomY0 + 0.5) * 8;
    const s1 = new Soldier(targetX, targetY, 1, 0, 125);
    const s2 = new Soldier(targetX + 1, targetY, -1, 0, 125);
    for (let i = 0; i < 400 && (s1.alive || s2.alive); i++) {
      g.replicateOne(30, [s1, s2]);
    }
    expect(s1.alive).toBe(false);
    expect(s2.alive).toBe(false);
    expect(killed).toBe(2);
  });

  it("completes a full run from soldier launch until overwhelmed by terrain (completion test)", () => {
    const w = new PixelWorld(WORLD);
    generateWorld(w, 21);
    const rng = new Rng(21);
    const phys = new PhysicsSystem(w, rng);
    const stats = baseSoldierStats();
    let destroyed = 0;
    const combat = new CombatSystem(w, rng, stats, {
      onImpact: (_x, _y, _nx, _ny, _cx, _cy, r) => {
        if (r === 2) destroyed++;
      },
    });
    const g = new GrowthSystem(w, rng);
    g.reset();
    const sp = findSpawnPoint(w, SOLDIER.collisionRadius)!;
    const s = new Soldier(sp.x, sp.y, 1, 0.41, stats.speed);
    let t = 0;
    const maxSimTime = 180;
    while (s.alive && t < maxSimTime) {
      t += SIM.dt;
      phys.step(s, SIM.dt);
      combat.updateSoldier(s, SIM.dt);
      combat.updateBullets(SIM.dt);
      g.update(SIM.dt, t, [s]);
    }
    expect(s.alive).toBe(false);
    expect(t).toBeGreaterThan(GROWTH.graceSeconds);
    expect(t).toBeLessThan(maxSimTime);
    expect(destroyed).toBeGreaterThan(30);
    expect(g.nearSoldierPercent(t)).toBeGreaterThanOrEqual(0);
  });

  it("spawns Blight Cores in dark-pink overrun rooms and reduces the blight timer when a core is killed", () => {
    const w = new PixelWorld(WORLD);
    generateWorld(w, 42);
    const g = new GrowthSystem(w, new Rng(42));
    g.reset();

    // Verify rooms overrun with dark pink blight and Blight Cores exist across the generated lab.
    expect(w.blightCores.length).toBeGreaterThanOrEqual(3);
    const overrunRooms = w.labLayout!.rooms.filter((r) => r.overrun);
    expect(overrunRooms.length).toBe(w.blightCores.length);

    const core = w.blightCores[0];
    expect(core.alive).toBe(true);
    expect(core.cells.length).toBe(4);
    // Core cells have bonus health above standard zone fill.
    expect(w.health[core.cells[0]]).toBeGreaterThan(1);

    // Advance blight timer to 40s so growth rate is well above baseRate.
    g.update(SIM.dt, 40, []);
    const rateBefore = g.rate;
    expect(rateBefore).toBeGreaterThan(GROWTH.baseRate);

    // Destroy 3 of the 4 cells -> core is still alive.
    for (let k = 0; k < 3; k++) {
      const idx = core.cells[k];
      const cx = idx % w.width;
      const cy = Math.floor(idx / w.width);
      w.damage(cx, cy, 255);
      expect(w.checkCoreDestroyedAt(cx, cy)).toBeNull();
    }
    expect(core.alive).toBe(true);

    // Destroy the 4th cell -> core is killed and blight timer drops!
    const lastIdx = core.cells[3];
    const lastCx = lastIdx % w.width;
    const lastCy = Math.floor(lastIdx / w.width);
    w.damage(lastCx, lastCy, 255);
    const killedCore = w.checkCoreDestroyedAt(lastCx, lastCy);
    expect(killedCore).toBe(core);
    expect(core.alive).toBe(false);

    g.reduceBlightTimer(40);
    expect(g.coresDestroyed).toBe(1);
    expect(g.timeOffset).toBe(GROWTH.coreKillTimeReduction);
    expect(g.rate).toBeLessThan(rateBefore);
  });

  it("supports 50% sub-pixel grid where 4 smaller pixels fit into 1 normal pixel", () => {
    const w = new PixelWorld({
      width: 20,
      height: 20,
      cellSize: 8,
      roomSize: 4,
    });
    expect(w.subWidth).toBe(40);
    expect(w.subHeight).toBe(40);
    expect(w.subCellSize).toBe(4);

    // Set 4 sub-pixels inside normal cell (5, 5)
    expect(w.anySolidInCell(5, 5)).toBe(false);
    w.setSubCell(10, 10, 3, "grown");
    expect(w.anySolidInCell(5, 5)).toBe(true);
    expect(w.subSolidAt(10, 10)).toBe(true);
    expect(w.subSolidAt(11, 10)).toBe(false);

    w.setSubCell(11, 10, 3, "grown");
    w.setSubCell(10, 11, 3, "grown");
    w.setSubCell(11, 11, 3, "grown");

    expect(w.subHealth[10 + 10 * w.subWidth]).toBe(3);
    expect(w.subHealth[11 + 10 * w.subWidth]).toBe(3);

    // Damage a sub-pixel
    const res = w.damageSub(10, 10, 2);
    expect(res).toBe(1); // damaged
    expect(w.subHealth[10 + 10 * w.subWidth]).toBe(1);
    const res2 = w.damageSub(10, 10, 2);
    expect(res2).toBe(2); // destroyed
    expect(w.subSolidAt(10, 10)).toBe(false);
    // Other 3 sub-cells are still solid
    expect(w.anySolidInCell(5, 5)).toBe(true);
  });

  it("compounds pink blight generation across connected cores into open air", () => {
    const w = new PixelWorld({
      width: 30,
      height: 30,
      cellSize: 8,
      roomSize: 4,
    });

    // Create 2 blight cores placed near each other in empty space:
    // Core 1 at (10, 10), 2x2 cells -> (10,10), (11,10), (10,11), (11,11)
    const core1Cells = [10 + 10 * 30, 11 + 10 * 30, 10 + 11 * 30, 11 + 11 * 30];
    for (const idx of core1Cells) {
      w.health[idx] = 10;
      w.coreId[idx] = 1;
    }
    const core1 = { id: 1, roomId: 1, zone: 0 as const, cx: 10, cy: 10, cells: core1Cells, alive: true };

    // Core 2 at (13, 10), 2x2 cells -> 1 cell gap from core 1 (cell 12 is between 11 and 13)
    const core2Cells = [13 + 10 * 30, 14 + 10 * 30, 13 + 11 * 30, 14 + 11 * 30];
    for (const idx of core2Cells) {
      w.health[idx] = 10;
      w.coreId[idx] = 2;
    }
    const core2 = { id: 2, roomId: 1, zone: 0 as const, cx: 13, cy: 10, cells: core2Cells, alive: true };

    w.blightCores = [core1, core2];

    const g = new GrowthSystem(w, new Rng(1234));
    g.reset();

    // At runTime = 38s, growth rate is ~6 sub-pixels per second.
    // In 1 second, Core 1 alone produces ~6 sub-pixels.
    core2.alive = false;
    // Step 1 second (60 dt steps)
    for (let step = 0; step < 60; step++) {
      g.update(1 / 60, 38, []);
    }

    let pinkCountCore1Only = 0;
    for (let i = 0; i < w.subHealth.length; i++) {
      if (w.subHealth[i] > 0) pinkCountCore1Only++;
    }
    // Single core: produced ~6 sub-pixels
    expect(pinkCountCore1Only).toBeGreaterThanOrEqual(4);
    expect(pinkCountCore1Only).toBeLessThanOrEqual(8);

    // Now clear subcells and resurrect Core 2
    w.subHealth.fill(0);
    w.subTint.fill(0);
    core2.alive = true;

    // Bridge the gap between Core 1 and Core 2 with pink sub-pixels so they are connected!
    // Normal cell 12 sits between Core 1 (x=10,11) and Core 2 (x=13,14).
    // In subcells: Core 1 right edge is sx=23. Core 2 left edge is sx=26.
    // Bridging sx=24 and sx=25 connects both cores!
    w.setSubCell(24, 20, 2, "grown");
    w.setSubCell(25, 20, 2, "grown");

    // Step 1 second with compounding connected cores
    for (let step = 0; step < 60; step++) {
      g.update(1 / 60, 38, []);
    }

    let pinkCountCompounded = 0;
    for (let i = 0; i < w.subHealth.length; i++) {
      if (w.subHealth[i] > 0) pinkCountCompounded++;
    }

    // Two connected cores compound: each contributes rate, so total rate is 2 * 6 = 12/s!
    // Accounting for the 2 bridge pixels already set, newly added pixels should be around 12.
    const addedPixels = pinkCountCompounded - 2;
    expect(addedPixels).toBeGreaterThanOrEqual(9);
    expect(addedPixels).toBeLessThanOrEqual(16);
  });

  it("pink blight sub-pixels provide physical collision against circles", () => {
    const w = new PixelWorld({
      width: 10,
      height: 10,
      cellSize: 8,
      roomSize: 10,
    });
    // Center at (40, 40) in world coordinates. Room is fully empty.
    const radius = 3;
    expect(circleIsClear(w, 20, 20, radius)).toBe(true);

    // Place a 50% pink blight sub-pixel near (20, 20).
    // Cell size is 8, subCellSize is 4.
    // Subcell (5, 5) spans world coords [20, 24] x [20, 24].
    w.setSubCell(5, 5, 2, "grown");

    // Circle at (20, 20) with radius 3 overlaps [20, 24] x [20, 24]!
    expect(circleIsClear(w, 20, 20, radius)).toBe(false);

    // Destroy the sub-pixel -> space is clear again.
    w.damageSub(5, 5, 10);
    expect(circleIsClear(w, 20, 20, radius)).toBe(true);
  });
});
