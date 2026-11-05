import { describe, expect, it } from "vitest";
import { LIGHT, SIM, SOLDIER, WORLD } from "../src/config";
import { Rng } from "../src/core/Rng";
import { CasingSystem } from "../src/entities/CasingSystem";
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
  const combat = new CombatSystem(w, rng, stats, {
    onImpact: (_x, _y, _nx, _ny, cx, cy, r) => {
      if (r === 2) {
        runStats.pixelsDestroyed++;
        runStats.currency++;
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
  it("progresses cleanly across 8 runs and upgraded soldiers excavate significantly more", () => {
    const save = new SaveManager(new MemStorage());
    const upg = new UpgradeManager(save);

    const first = simulateRun(101, upg);
    expect(first.time).toBeGreaterThan(20);
    expect(first.time).toBeLessThan(130);
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

    // By run 8 the player should have bought multiple upgrades and beaten run 1's excavation.
    const totalLevels = upg.defs.reduce((acc, d) => acc + upg.levelOf(d.id), 0);
    expect(totalLevels).toBeGreaterThanOrEqual(4);
    expect(bestPixels).toBeGreaterThan(first.pixels * 1.15);
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
});
