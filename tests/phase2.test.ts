import { describe, expect, it } from "vitest";
import { GROWTH, SIM, SOLDIER, WORLD, growthRateAt } from "../src/config";
import { Rng } from "../src/core/Rng";
import { Soldier, baseSoldierStats } from "../src/entities/Soldier";
import { CombatSystem } from "../src/systems/CombatSystem";
import { PhysicsSystem, findSpawnPoint } from "../src/systems/PhysicsSystem";
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
  it("honors the 12s grace period, exponential rise and 150/s cap", () => {
    expect(growthRateAt(0)).toBe(0);
    expect(growthRateAt(11.99)).toBe(0);
    expect(growthRateAt(12)).toBeCloseTo(GROWTH.baseRate, 5);
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
    expect(core.cells.length).toBe(9);
    // Core cells have bonus health above standard zone fill.
    expect(w.health[core.cells[0]]).toBeGreaterThan(1);

    // Advance blight timer to 40s so growth rate is well above baseRate.
    g.update(SIM.dt, 40, []);
    const rateBefore = g.rate;
    expect(rateBefore).toBeGreaterThan(GROWTH.baseRate);

    // Destroy 8 of the 9 cells -> core is still alive.
    for (let k = 0; k < 8; k++) {
      const idx = core.cells[k];
      const cx = idx % w.width;
      const cy = Math.floor(idx / w.width);
      w.damage(cx, cy, 255);
      expect(w.checkCoreDestroyedAt(cx, cy)).toBeNull();
    }
    expect(core.alive).toBe(true);

    // Destroy the 9th cell -> core is killed and blight timer drops!
    const lastIdx = core.cells[8];
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
});
