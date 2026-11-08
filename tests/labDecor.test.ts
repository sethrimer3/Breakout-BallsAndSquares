import { describe, expect, it } from "vitest";
import { maxHealthForDistance, WORLD } from "../src/config";
import { PixelWorld, SUB } from "../src/world/PixelWorld";
import { generateWorld } from "../src/world/WorldGenerator";

function counts(w: PixelWorld): Map<number, number> {
  const m = new Map<number, number>();
  for (let si = 0; si < w.subKind.length; si++) {
    if (w.subHealth[si] === 0) continue;
    m.set(w.subKind[si], (m.get(w.subKind[si]) ?? 0) + 1);
  }
  return m;
}

describe("overrun lab decor", () => {
  it("places blinking lights, machine cores and overrun-room wreckage", () => {
    const totals = new Map<number, number>();
    for (const seed of [101, 202, 303]) {
      const w = new PixelWorld(WORLD);
      generateWorld(w, seed);
      for (const [k, n] of counts(w)) totals.set(k, (totals.get(k) ?? 0) + n);
    }
    expect(totals.get(SUB.led) ?? 0).toBeGreaterThan(50);
    expect(totals.get(SUB.core) ?? 0).toBeGreaterThan(10);
    expect(totals.get(SUB.wreck) ?? 0).toBeGreaterThan(10);
  });

  it("gives half-size pixels a quarter of a block's health, and decor less still", () => {
    const w = new PixelWorld(WORLD);
    // Deep enough that a full block has plenty of health to divide.
    const sx = 4;
    const sy = 4;
    const full = maxHealthForDistance(w.distanceOf(sx >> 1, sy >> 1));
    const si = sy * w.subWidth + sx;
    w.subKind[si] = SUB.rubble;
    const rubble = w.maxSubHealthAt(sx, sy);
    w.subKind[si] = SUB.metal;
    const decor = w.maxSubHealthAt(sx, sy);
    expect(full).toBeGreaterThanOrEqual(100);
    expect(rubble).toBe(Math.round(full * 0.25));
    expect(decor).toBeLessThan(rubble);
    expect(decor).toBeGreaterThanOrEqual(1);
  });
});
