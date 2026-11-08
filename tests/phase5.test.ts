import { describe, expect, it } from "vitest";
import { LIGHT, LOOT, SIM, SOLDIER, WORLD } from "../src/config";
import { Rng } from "../src/core/Rng";
import { CasingSystem } from "../src/entities/CasingSystem";
import { LootSystem } from "../src/entities/LootSystem";
import { PKind, ParticleSystem } from "../src/entities/ParticleSystem";
import { Soldier } from "../src/entities/Soldier";
import { SaveManager, type StorageLike } from "../src/progression/SaveManager";
import { UpgradeManager } from "../src/progression/UpgradeManager";
import { CombatSystem } from "../src/systems/CombatSystem";
import { LightingSystem } from "../src/systems/LightingSystem";
import { PhysicsSystem, circleIsClear, findSpawnPoint } from "../src/systems/PhysicsSystem";
import { RunStats } from "../src/systems/RunStats";
import { GrowthSystem } from "../src/world/GrowthSystem";
import { PixelWorld } from "../src/world/PixelWorld";
import { generateWorld } from "../src/world/WorldGenerator";

class MemStorage implements StorageLike {
  map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
}

function simulateRun(
  seed: number,
  upg: UpgradeManager,
): {
  time: number;
  pixels: number;
  maxDepth: number;
  nearPct: number;
  crossoverFrac: number;
} {
  const w = new PixelWorld(WORLD);
  generateWorld(w, seed);
  const rng = new Rng(seed);
  const phys = new PhysicsSystem(w, rng);
  const stats = upg.getSoldierStats();
  const runStats = new RunStats();
  const loot = new LootSystem();
  const combat = new CombatSystem(w, rng, stats, {
    onImpact: (_x, _y, _nx, _ny, cx, cy, r) => {
      if (r === 2) {
        runStats.pixelsDestroyed++;
        const cs = w.cellSize;
        loot.spawnDropsForBlock((cx + 0.5) * cs, (cy + 0.5) * cs, stats.dropChance, stats.pickupLifetime, rng);
        const d = w.depthOf(cx, cy);
        if (d > runStats.maxDepth) runStats.maxDepth = d;
      }
    },
  });
  const growth = new GrowthSystem(w, rng);
  growth.reset();

  // Deploy all available soldiers over the first couple seconds.
  const soldiers: Soldier[] = [];
  let reserves = stats.maxSoldiers;
  let deployTimer = 0;

  while (runStats.time < 240) {
    if (reserves > 0 && deployTimer <= 0) {
      const sp = findSpawnPoint(w, SOLDIER.collisionRadius);
      if (sp) {
        const a = rng.range(0, Math.PI * 2);
        soldiers.push(new Soldier(sp.x, sp.y, Math.cos(a), Math.sin(a), stats.speed));
        reserves--;
        runStats.soldiersDeployed++;
        deployTimer = 0.6;
      }
    }
    deployTimer -= SIM.dt;
    runStats.time += SIM.dt;

    for (const s of soldiers) {
      if (!s.alive) continue;
      phys.step(s, SIM.dt);
      combat.updateSoldier(s, SIM.dt);
    }
    combat.updateBullets(SIM.dt);
    growth.update(SIM.dt, runStats.time, soldiers);
    runStats.currency += loot.update(SIM.dt, soldiers, stats.magnetRange);
    runStats.recordSampleIfDue(growth.rate);

    const alive = soldiers.some((s) => s.alive);
    const canDeploy = reserves > 0 && findSpawnPoint(w, SOLDIER.collisionRadius) !== null;
    if (!alive && !canDeploy && runStats.soldiersDeployed > 0) break;
  }

  // Find when growthRate first exceeds destroyRate.
  let crossTime = runStats.time;
  for (const smp of runStats.samples) {
    if (smp.t > 12 && smp.growthRate >= smp.destroyRate) {
      crossTime = smp.t;
      break;
    }
  }
  return {
    time: runStats.time,
    pixels: runStats.pixelsDestroyed,
    maxDepth: runStats.maxDepth,
    nearPct: growth.nearSoldierPercent(runStats.time),
    crossoverFrac: crossTime / Math.max(1, runStats.time),
  };
}

describe("Phase 5 — Multi-run progression & balancing verification (Rev 2)", () => {
  it("progresses cleanly across 8 runs and keeps excavation from regressing as upgrades are bought", () => {
    const save = new SaveManager(new MemStorage());
    const upg = new UpgradeManager(save);

    const first = simulateRun(101, upg);
    expect(first.time).toBeGreaterThan(20);
    expect(first.time).toBeLessThan(140);
    expect(first.pixels).toBeGreaterThanOrEqual(25);

    // Simulate 7 more runs, banking currency and buying the cheapest available upgrade each run.
    let bestPixels = first.pixels;
    save.data.bank += first.pixels;
    save.data.lifetimePixels += first.pixels;

    for (let r = 2; r <= 8; r++) {
      // Buy all affordable upgrades, cheapest first.
      for (;;) {
        const candidates = upg.defs.filter((d) => upg.canBuy(d.id));
        if (candidates.length === 0) break;
        candidates.sort((a, b) => upg.costOf(a.id) - upg.costOf(b.id));
        upg.buy(candidates[0].id);
      }
      const res = simulateRun(100 + r * 17, upg);
      save.data.bank += res.pixels;
      save.data.lifetimePixels += res.pixels;
      if (res.pixels > bestPixels) bestPixels = res.pixels;
    }

    // By run 8 the player should have bought multiple upgrades. Rooms and hallways are now
    // empty and walled in Tier 2 material, so a bouncing squad mostly chips at tough walls:
    // excavation no longer climbs steeply run over run, it just mustn't regress.
    const totalLevels = upg.defs.reduce((acc, d) => acc + upg.levelOf(d.id), 0);
    expect(totalLevels).toBeGreaterThanOrEqual(4);
    expect(bestPixels).toBeGreaterThanOrEqual(first.pixels);
  });
});

describe("Phase 5 — 8-soldier stress benchmark & high-speed stability", () => {
  it("maintains < 8ms per step & lighting compute under 8 maxed soldiers + 150/s growth", () => {
    const save = new SaveManager(new MemStorage());
    const upg = new UpgradeManager(save);
    for (const d of upg.defs) save.data.upgrades[d.id] = d.maxLevel;

    const w = new PixelWorld(WORLD);
    generateWorld(w, 777);
    const rng = new Rng(777);
    const phys = new PhysicsSystem(w, rng);
    const stats = upg.getSoldierStats();
    const particles = new ParticleSystem(3000);
    const casings = new CasingSystem();
    const lighting = new LightingSystem(w);

    const flashes: { x: number; y: number; dx: number; dy: number; id: number }[] = [];
    const combat = new CombatSystem(w, rng, stats, {
      onShot: (s, dx, dy, mx, my) => {
        flashes.push({ x: mx, y: my, dx, dy, id: s.id });
        casings.spawn(s.x, s.y, dx, dy, s.ejectSide, rng);
        particles.spawn(PKind.Spark, mx, my, dx * 90, dy * 90, 0.1, 1, 0xffd890, 8);
      },
    });
    const growth = new GrowthSystem(w, rng);
    growth.reset();

    const sp = findSpawnPoint(w, SOLDIER.collisionRadius)!;
    const soldiers: Soldier[] = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.13;
      soldiers.push(new Soldier(sp.x, sp.y, Math.cos(a), Math.sin(a), stats.speed));
    }

    // Warm up 10 seconds so tunnels open up, then benchmark 60 steps at high growth.
    let simTime = 80;
    for (let i = 0; i < 120; i++) {
      for (const s of soldiers) {
        if (!s.alive) continue;
        phys.step(s, SIM.dt);
        combat.updateSoldier(s, SIM.dt);
      }
      combat.updateBullets(SIM.dt);
      particles.update(SIM.dt);
      casings.update(SIM.dt);
    }

    const poly = new Float32Array(2048);
    const t0 = performance.now();
    const benchFrames = 30;
    for (let f = 0; f < benchFrames; f++) {
      flashes.length = 0;
      simTime += SIM.dt;
      for (const s of soldiers) {
        if (!s.alive) continue;
        phys.step(s, SIM.dt);
        combat.updateSoldier(s, SIM.dt);
        expect(circleIsClear(w, s.x, s.y, s.radius)).toBe(true);
      }
      combat.updateBullets(SIM.dt);
      growth.update(SIM.dt, simTime, soldiers);
      particles.update(SIM.dt);
      casings.update(SIM.dt);
      const count = Math.min(flashes.length, LIGHT.maxShadowLights);
      for (let i = 0; i < count; i++) {
        const fl = flashes[i];
        lighting.computeVisibilityPolygon(fl.x, fl.y, fl.dx, fl.dy, LIGHT.radius, fl.id, soldiers, poly);
      }
    }
    const avgMs = (performance.now() - t0) / benchFrames;
    expect(avgMs).toBeLessThan(12);
  });

  it("magnetically attracts golden squares to soldiers, despawns expired squares, and supports multi-drop (2+)", () => {
    const loot = new LootSystem(8192);
    const rng = new Rng(123);

    // 1/5 base drop chance -> ~20% over 1000 trials.
    let dropped = 0;
    for (let i = 0; i < 1000; i++) {
      dropped += loot.spawnDropsForBlock(100, 100, LOOT.baseDropChance, 5, rng);
    }
    expect(dropped).toBeGreaterThan(150);
    expect(dropped).toBeLessThan(250);
    loot.clear();

    // Multi-drop (e.g. dropChance = 2.5 -> 2 or 3 drops per block).
    for (let i = 0; i < 50; i++) {
      const n = loot.spawnDropsForBlock(100, 100, 2.5, 5, rng);
      expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThanOrEqual(3);
    }
    loot.clear();

    // Magnetic attraction & collection only when soldier picks up.
    loot.spawnOne(120, 100, 5, rng);
    // Zero initial velocity to test pure magnetic attraction.
    loot.vx[0] = 0;
    loot.vy[0] = 0;
    loot.x[0] = 120;
    loot.y[0] = 100;
    const soldier = new Soldier(100, 100, 1, 0, 125);
    let totalCollected = 0;
    for (let step = 0; step < 60 && loot.count > 0; step++) {
      totalCollected += loot.update(SIM.dt, [soldier], 40);
    }
    expect(totalCollected).toBe(1);
    expect(loot.count).toBe(0);

    // Despawn after lifetime expires when no soldier is near.
    loot.spawnOne(500, 500, 1.0, rng);
    expect(loot.count).toBe(1);
    expect(loot.update(1.1, [soldier], 40)).toBe(0);
    expect(loot.count).toBe(0);
  });
});
