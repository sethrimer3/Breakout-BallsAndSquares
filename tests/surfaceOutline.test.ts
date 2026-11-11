import { describe, expect, it } from "vitest";
import { PixelWorld } from "../src/world/PixelWorld";
import { TerrainChunks } from "../src/world/TerrainChunks";
import {
  SURFACE_OUTLINE_WIDTH,
  traceSurfaceOutline,
} from "../src/rendering/surfaceOutline";

type Rect = [number, number, number, number];
function outline(w: PixelWorld, sx = 0, sy = 0, subs = 16): Rect[] {
  const result: Rect[] = [];
  traceSurfaceOutline(
    w,
    sx,
    sy,
    subs,
    new Uint8Array((subs + 2) ** 2),
    (...r) => result.push(r),
  );
  return result;
}
function covers(rects: Rect[], x: number, y: number): boolean {
  return rects.some(
    ([rx, ry, rw, rh]) => x >= rx && x < rx + rw && y >= ry && y < ry + rh,
  );
}
function scene(): PixelWorld {
  const w = new PixelWorld({ width: 8, height: 8, cellSize: 8, roomSize: 2 });
  w.health.fill(0);
  return w;
}

describe("air-exposed surface outlines", () => {
  it("outlines all four faces at one eighth of a full pixel without filling interiors", () => {
    const w = scene();
    w.setCell(3, 3, 10);
    const r = outline(w);
    expect(SURFACE_OUTLINE_WIDTH).toBe(0.125);
    for (const [x, y] of [
      [3.05, 3.5],
      [3.95, 3.5],
      [3.5, 3.05],
      [3.5, 3.95],
    ])
      expect(covers(r, x, y)).toBe(true);
    expect(covers(r, 3.5, 3.5)).toBe(false);
    expect(covers(r, 2.95, 3.5)).toBe(false);
  });
  it("does not outline internal boundaries, including across chunk seams", () => {
    const w = scene();
    w.setCell(3, 3, 10);
    w.setCell(4, 3, 10);
    const left = outline(w, 0, 0, 8),
      right = outline(w, 8, 0, 8);
    expect(covers(left, 3.95, 3.5)).toBe(false);
    expect(covers(right, 0.05, 3.5)).toBe(false);
    expect(covers(left, 3.05, 3.5)).toBe(true);
    expect(covers(right, 0.95, 3.5)).toBe(true);
  });
  it("joins inside corners where air touches a diagonal", () => {
    const w = scene();
    w.health.fill(10);
    w.setCell(2, 2, 0);
    const r = outline(w);
    expect(covers(r, 3.05, 3.05)).toBe(true);
    expect(covers(r, 3.2, 3.2)).toBe(false);
  });
  it("uses the same thin rim on half pixels and suppresses edges touching full blocks", () => {
    const w = scene();
    w.setSubCell(6, 6, 10);
    w.setCell(2, 3, 10);
    const r = outline(w);
    expect(covers(r, 3.45, 3.25)).toBe(true);
    expect(covers(r, 3.25, 3.05)).toBe(true);
    expect(covers(r, 3.05, 3.25)).toBe(false);
    expect(covers(r, 3.25, 3.25)).toBe(false);
  });
  it("rebuilds both sides of a chunk seam after mining and removes destroyed outlines", () => {
    const w = scene(),
      chunks = new TerrainChunks(w, 4),
      dirty: number[] = [];
    w.setCell(3, 3, 10);
    w.setCell(4, 3, 10);
    chunks.take(100, dirty);
    w.setCell(4, 3, 0);
    chunks.take(100, dirty);
    expect(dirty).toContain(0);
    expect(dirty).toContain(1);
    expect(covers(outline(w), 3.95, 3.5)).toBe(true);
    expect(covers(outline(w), 4.05, 3.5)).toBe(false);
  });
  it("draws no border against solid neighbors outside the world", () => {
    const w = scene();
    w.health.fill(10);
    expect(outline(w)).toHaveLength(0);
  });
});
