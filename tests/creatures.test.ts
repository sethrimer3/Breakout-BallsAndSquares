import { describe, expect, it } from "vitest";
import { Rng } from "../src/core/Rng";
import { CreatureSystem } from "../src/entities/Creatures";
import { Soldier } from "../src/entities/Soldier";
import { GrowthSystem } from "../src/world/GrowthSystem";
import { MAT, PixelWorld, type BlightCore } from "../src/world/PixelWorld";

function setup() {
  const w = new PixelWorld({ width: 60, height: 60, cellSize: 8, roomSize: 4 });
  const cells = [10 + 10 * 60, 11 + 10 * 60, 10 + 11 * 60, 11 + 11 * 60];
  for (const idx of cells) {
    w.health[idx] = 10;
    w.coreId[idx] = 1;
  }
  const core: BlightCore = { id: 1, roomId: 1, zone: 0, cx: 10, cy: 10, cells, alive: true, size: 2 };
  w.blightCores = [core];
  const g = new GrowthSystem(w, new Rng(2));
  g.reset();
  const sys = new CreatureSystem(w, new Rng(2));
  sys.reset();
  return { w, g, sys, core };
}

describe("creatures", () => {
  it("roots flowers in living Blight and kills them with their pixel", () => {
    const { w, g, sys } = setup();
    for (let sx = 24; sx <= 40; sx++) w.setSubCell(sx, 20, 3, "grown");
    const c = g.colonies.colonyAt(20 * w.subWidth + 30)!;
    const f = sys.spawnFlower(c)!;
    expect(f).not.toBeNull();
    expect(w.isPinkSub(f.anchor)).toBe(true);
    const sx = f.anchor % w.subWidth;
    const sy = Math.floor(f.anchor / w.subWidth);
    w.damageSub(sx, sy, 999);
    sys.update(1 / 60, 30, [], g);
    expect(sys.flowers.length).toBe(0);
  });

  it("wilts flowers whose colony goes dormant", () => {
    const { w, g, sys, core } = setup();
    for (let sx = 24; sx <= 40; sx++) w.setSubCell(sx, 20, 3, "grown");
    const c = g.colonies.colonyAt(20 * w.subWidth + 30)!;
    const f = sys.spawnFlower(c)!;
    core.alive = false;
    g.colonies.update(1, 0);
    sys.update(1 / 60, 30, [], g);
    expect(f.wilted).toBe(true);
  });

  it("lets bullets hit creatures before terrain", () => {
    const { w, g, sys } = setup();
    for (let sx = 24; sx <= 40; sx++) w.setSubCell(sx, 20, 3, "grown");
    const f = sys.spawnFlower(g.colonies.colonyAt(20 * w.subWidth + 30)!)!;
    f.grow = 1;
    sys.update(1 / 60, 1, [], g);
    const t = sys.raycast(f.hx - 30, f.hy, 1, 0, 60);
    expect(t).toBeGreaterThan(20);
    expect(t).toBeLessThan(30);
    for (let i = 0; i < 3; i++) {
      sys.raycast(f.hx - 30, f.hy, 1, 0, 60);
      sys.applyHit(1, f.hx, f.hy);
    }
    expect(sys.flowers.length).toBe(0);
  });

  it("frees a specimen when its glass breaks, and it hunts soldiers", () => {
    const w = new PixelWorld({ width: 60, height: 60, cellSize: 8, roomSize: 4 });
    // A 3×3 tank at (20..22, 20..22) with its hollow center at (21, 21).
    for (let y = 20; y <= 22; y++) {
      for (let x = 20; x <= 22; x++) {
        if (x === 21 && y === 21) continue;
        w.mat[y * 60 + x] = MAT.glass;
        w.health[y * 60 + x] = 3;
      }
    }
    w.specimenSpots = [{ cx: 21, cy: 21, zone: 0 }];
    const g = new GrowthSystem(w, new Rng(1));
    g.reset();
    let hits = 0;
    const sys = new CreatureSystem(w, new Rng(1), { onSoldierHit: () => hits++ });
    sys.reset();
    const s = new Soldier(21.5 * 8 + 30, 21.5 * 8, 1, 0, 0);
    sys.update(1 / 60, 1, [s], g);
    expect(sys.specimens[0].free).toBe(false);
    for (let y = 20; y <= 22; y++) for (let x = 20; x <= 22; x++) w.setCell(x, y, 0, "destroyed");
    for (let i = 0; i < 180; i++) sys.update(1 / 60, 1 + i / 60, [s], g);
    expect(sys.specimens[0].free).toBe(true);
    expect(hits).toBeGreaterThan(0);
  });

  it("worm trails reconnect dormant Blight to its generator", () => {
    const { w, g, sys } = setup();
    // A live stub off the core, then a gap, then a cut-off dormant line.
    for (let sx = 24; sx <= 30; sx++) w.setSubCell(sx, 20, 3, "grown");
    for (let sx = 40; sx <= 50; sx++) w.setSubCell(sx, 20, 3, "grown");
    g.colonies.update(1, 0);
    expect(g.colonies.isDormantSub(20 * w.subWidth + 45)).toBe(true);
    const live = g.colonies.colonyAt(20 * w.subWidth + 26)!;
    let woke = false;
    for (let attempt = 0; attempt < 40 && !woke; attempt++) {
      sys.worms = [];
      const worm = sys.spawnWorm(live);
      if (!worm) continue;
      for (let i = 0; i < 60 * 20 && !woke; i++) {
        sys.update(1 / 60, 30, [], g);
        g.colonies.update(1 / 60, 0);
        woke = !g.colonies.isDormantSub(20 * w.subWidth + 45);
      }
    }
    expect(woke).toBe(true);
  });
});
