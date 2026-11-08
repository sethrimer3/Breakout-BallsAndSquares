import { describe, expect, it } from "vitest";
import { GROWTH, overdriveWallRate } from "../src/config";
import { Rng } from "../src/core/Rng";
import { GrowthSystem } from "../src/world/GrowthSystem";
import { PixelWorld, type BlightCore } from "../src/world/PixelWorld";

/** A 40×40 empty world with one 2×2 generator at (10, 10). */
function setup(): { w: PixelWorld; g: GrowthSystem; core: BlightCore } {
  const w = new PixelWorld({ width: 40, height: 40, cellSize: 8, roomSize: 4 });
  const cells = [10 + 10 * 40, 11 + 10 * 40, 10 + 11 * 40, 11 + 11 * 40];
  for (const idx of cells) {
    w.health[idx] = 10;
    w.coreId[idx] = 1;
  }
  const core: BlightCore = { id: 1, roomId: 1, zone: 0, cx: 10, cy: 10, cells, alive: true, size: 2 };
  w.blightCores = [core];
  const g = new GrowthSystem(w, new Rng(7));
  g.reset();
  return { w, g, core };
}

/** A pink line of sub-pixels from (sx0, sy) to (sx1, sy). */
function line(w: PixelWorld, sx0: number, sx1: number, sy: number): void {
  for (let sx = sx0; sx <= sx1; sx++) w.setSubCell(sx, sy, 3, "grown");
}

describe("Blight colonies", () => {
  it("joins pixels grown off a generator into its colony", () => {
    const { w, g } = setup();
    line(w, 24, 34, 20); // the core's right edge is sx = 23
    const c = g.colonies.colonyAt(20 * w.subWidth + 30)!;
    expect(c).toBeDefined();
    expect(c.active).toBe(true);
    expect(c.cores).toEqual([1]);
    expect(g.colonies.count).toBe(1);
  });

  it("makes a cut-off piece dormant and wakes it again when reconnected", () => {
    const { w, g } = setup();
    line(w, 24, 40, 20);
    w.damageSub(28, 20, 999); // sever the line
    g.colonies.update(1, 0);
    const far = g.colonies.colonyAt(20 * w.subWidth + 35)!;
    const near = g.colonies.colonyAt(20 * w.subWidth + 25)!;
    expect(far.id).not.toBe(near.id);
    expect(far.active).toBe(false);
    expect(near.active).toBe(true);
    expect(g.colonies.isDormantSub(20 * w.subWidth + 35)).toBe(true);

    w.setSubCell(28, 20, 3, "grown"); // regrow the gap
    expect(g.colonies.isDormantSub(20 * w.subWidth + 35)).toBe(false);
    expect(g.colonies.count).toBe(1);
  });

  it("goes dormant everywhere when the generator dies", () => {
    const { w, g, core } = setup();
    line(w, 24, 30, 20);
    for (const idx of core.cells) w.damage(idx % 40, Math.floor(idx / 40), 999);
    w.checkCoreDestroyedAt(10, 10);
    expect(core.alive).toBe(false);
    g.colonies.update(1, 0);
    expect(g.colonies.isDormantSub(20 * w.subWidth + 26)).toBe(true);
  });

  it("never grows dormant Blight, and decays it with Necrosis Protocol", () => {
    const { w, g } = setup();
    line(w, 24, 40, 20);
    // Cut a wide gap so the live side can't regrow across it during the test.
    for (let sx = 24; sx <= 26; sx++) w.damageSub(sx, 20, 999);
    for (let sy = 14; sy <= 26; sy++) for (let sx = 24; sx <= 26; sx++) if (sy !== 20) w.setCell(sx >> 1, sy >> 1, 9);
    w.setCell(12, 10, 9);
    w.setCell(12, 11, 9);
    g.colonies.update(1, 0);
    const count = (): number => {
      let n = 0;
      for (let sx = 27; sx <= 40; sx++) if (w.subHealth[20 * w.subWidth + sx] > 0) n++;
      return n;
    };
    const before = count();
    for (let i = 0; i < 120; i++) g.update(1 / 60, 60, []);
    expect(count()).toBe(before);

    g.decayRate = 4;
    for (let i = 0; i < 600; i++) g.update(1 / 60, 60, []);
    expect(count()).toBeLessThan(before);
    expect(g.decayed).toBeGreaterThan(0);
  });

  it("keeps the walls still until overdrive, then replicates them", () => {
    const w = new PixelWorld({ width: 40, height: 40, cellSize: 8, roomSize: 4 });
    // A solid world with the room carved out: the room's walls are the frontier.
    for (let i = 0; i < w.health.length; i++) w.health[i] = 5;
    for (let y = w.roomY0; y <= w.roomY1; y++) for (let x = w.roomX0; x <= w.roomX1; x++) w.health[y * 40 + x] = 0;
    const g = new GrowthSystem(w, new Rng(3));
    g.reset();
    const open = (): number => {
      let n = 0;
      for (let y = w.roomY0; y <= w.roomY1; y++) for (let x = w.roomX0; x <= w.roomX1; x++) if (w.health[y * 40 + x] === 0) n++;
      return n;
    };
    const start = open();
    g.update(1 / 60, 30, []);
    for (let i = 0; i < 60; i++) g.update(1 / 60, 30, []);
    expect(g.overdrive).toBe(false);
    expect(open()).toBe(start);

    // Far enough into the run that the generator rate passes the overdrive line.
    let t = 120;
    for (let i = 0; i < 300; i++) g.update(1 / 60, (t += 1 / 60), []);
    expect(g.rate).toBeGreaterThanOrEqual(GROWTH.overdriveRate);
    expect(g.overdrive).toBe(true);
    expect(g.wallRate).toBeGreaterThan(0);
    expect(open()).toBeLessThan(start);
    expect(overdriveWallRate(0)).toBe(0);
  });
});
