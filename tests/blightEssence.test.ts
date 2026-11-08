import { describe, expect, it } from "vitest";
import { EDGE_PIXELS_PER_SUB, markBlightEdges, type BlightGrid } from "../src/rendering/blightEdges";
import { ESSENCE_FPS, ESSENCE_SIZE, essenceFrame, essencePixels, perlin } from "../src/rendering/blightEssence";
import { PixelWorld } from "../src/world/PixelWorld";
import { TerrainChunks } from "../src/world/TerrainChunks";

describe("Blight Essence glob", () => {
  it("is the same size every frame, with a black body and a burning ring", () => {
    for (const t of [0, 0.7, 3.3, 41.9]) {
      const p = essencePixels(t);
      expect(p.w).toBe(ESSENCE_SIZE);
      expect(p.h).toBe(ESSENCE_SIZE);
      expect(p.px.length).toBe(ESSENCE_SIZE * ESSENCE_SIZE);
      expect(p.px).toContain(0x050407);
      const fire = [0x7a1c06, 0xc23a0a, 0xf07a18, 0xffc040];
      expect(p.px.some((c) => fire.includes(c))).toBe(true);
      expect(p.px).toContain(-1); // the corners stay clear
    }
  });

  it("moves its edge over time and repeats exactly for one moment", () => {
    const shape = (t: number): string => essencePixels(t).px.map((c) => (c < 0 ? "." : "#")).join("");
    expect(shape(0)).not.toBe(shape(2));
    expect(essencePixels(1.5).px).toEqual(essencePixels(1.5).px);
  });

  it("holds still under Reduce Motion", () => {
    expect(essenceFrame(12_345, true)).toBe(0);
    expect(essenceFrame(1000, false)).toBe(ESSENCE_FPS);
  });

  it("keeps Perlin noise in range", () => {
    for (let i = 0; i < 500; i++) {
      const v = perlin(i * 0.137, i * 0.211, i * 0.053);
      expect(Math.abs(v)).toBeLessThanOrEqual(1.01);
    }
  });
});

function grid(rows: string[]): BlightGrid {
  return {
    subWidth: rows[0].length,
    subHeight: rows.length,
    isBlightSubAt: (sx, sy) => rows[sy]?.[sx] === "#",
  };
}

function edges(rows: string[], sx0: number, sy0: number, subs: number): { out: Uint8Array; count: number; size: number } {
  const size = subs * EDGE_PIXELS_PER_SUB;
  const out = new Uint8Array(size * size);
  const solid = new Uint8Array((subs + 2) * (subs + 2));
  return { out, size, count: markBlightEdges(grid(rows), sx0, sy0, subs, out, solid) };
}

describe("Blight edge mask", () => {
  it.each([
    { dx: -1, dy: -1, px: 2, py: 2 },
    { dx: 1, dy: -1, px: 3, py: 2 },
    { dx: -1, dy: 1, px: 2, py: 3 },
    { dx: 1, dy: 1, px: 3, py: 3 },
  ])("joins the inside corner facing diagonal ($dx, $dy)", ({ dx, dy, px, py }) => {
    const rows = Array.from({ length: 3 }, (_, y) =>
      Array.from({ length: 3 }, (_, x) => x === 1 + dx && y === 1 + dy ? "." : "#").join(""));
    const { out, size } = edges(rows, 0, 0, 3);
    for (let y = 2; y <= 3; y++) {
      for (let x = 2; x <= 3; x++) {
        expect(out[y * size + x]).toBe(x === px && y === py ? 1 : 0);
      }
    }
    // The same corner still joins when the diagonal is in another chunk.
    const chunk = edges(rows, 1, 1, 1);
    expect(Array.from(chunk.out)).toEqual([
      px === 2 && py === 2 ? 1 : 0, px === 3 && py === 2 ? 1 : 0,
      px === 2 && py === 3 ? 1 : 0, px === 3 && py === 3 ? 1 : 0,
    ]);
  });

  it("rebuilds diagonal chunks when a corner cell changes", () => {
    const world = new PixelWorld({ width: 8, height: 8, cellSize: 8, roomSize: 2 });
    const chunks = new TerrainChunks(world, 4);
    const changed: number[] = [];
    chunks.markCell(3, 3);
    chunks.take(Infinity, changed);
    expect(changed.sort()).toEqual([0, 1, 2, 3]);
    chunks.markCell(4, 4);
    chunks.take(Infinity, changed);
    expect(changed.sort()).toEqual([0, 1, 2, 3]);
    chunks.markCell(1, 1);
    chunks.take(Infinity, changed);
    expect(changed).toEqual([0]);
  });

  it("rings one lone subcell on all sides and finds nothing in clean air", () => {
    const { out, count } = edges(["....", ".#..", "....", "...."], 0, 0, 4);
    expect(count).toBe(4); // the 2x2 mask pixels of that subcell
    const hit = (x: number, y: number): number => out[y * 8 + x];
    expect(hit(2, 2) + hit(3, 2) + hit(2, 3) + hit(3, 3)).toBe(4);
    expect(edges(["....", "....", "....", "...."], 0, 0, 4).count).toBe(0);
  });

  it("marks only the outside of a block, not its middle", () => {
    const rows = ["......", ".####.", ".####.", ".####.", ".####.", "......"];
    const { out, size } = edges(rows, 0, 0, 6);
    const at = (x: number, y: number): number => out[y * size + x];
    expect(at(2, 2)).toBe(1); // the block's corner
    expect(at(6, 2)).toBe(1); // top edge
    expect(at(6, 6)).toBe(0); // the middle
    expect(at(0, 0)).toBe(0); // air
  });

  it("joins across chunks, because it reads a subcell beyond each side", () => {
    const rows = ["####", "####", "####", "####"];
    // A block running out of the left chunk has no edge where it crosses over.
    const left = edges(rows.map((r) => r.slice(0, 4)), 0, 0, 2);
    expect(left.count).toBe(0);
  });

  it("draws no edge along the world's border", () => {
    const { count } = edges(["##", "##"], 0, 0, 2);
    expect(count).toBe(0);
  });
});
