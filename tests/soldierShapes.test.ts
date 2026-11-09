import { describe, expect, it } from "vitest";
import { LIGHT, SOLDIER } from "../src/config";
import { Soldier } from "../src/entities/Soldier";
import {
  SOLDIER_SHAPES,
  rayPolygonDistance,
  shapeOccluder,
  soldierShapeIndex,
} from "../src/entities/soldierShapes";
import { soldierGrid, soldierShapeGrid } from "../src/rendering/sprites";
import { LightingSystem } from "../src/systems/LightingSystem";
import { PixelWorld } from "../src/world/PixelWorld";

const R = SOLDIER.renderRadius;
const RING = SOLDIER.ringRadius;
const filled = (g: string[]) => g.join("").replace(/[.o]/g, "");

describe("soldier body shapes", () => {
  it("keeps the first slot round and gives every slot its own shape", () => {
    expect(SOLDIER_SHAPES[soldierShapeIndex(0)].verts).toBeNull();
    const grids = new Set<string>();
    for (let slot = 0; slot < SOLDIER_SHAPES.length; slot++) {
      grids.add(soldierShapeGrid(SOLDIER_SHAPES[soldierShapeIndex(slot)], 0, R, RING, false).join("\n"));
    }
    expect(grids.size).toBe(SOLDIER_SHAPES.length);
  });

  it("draws the sphere exactly as before", () => {
    expect(soldierShapeGrid(SOLDIER_SHAPES[0], 1.3, R, RING, true)).toEqual(soldierGrid(R, RING, true));
  });

  it("rotates a shaped sprite toward its facing direction", () => {
    const tri = SOLDIER_SHAPES.find((s) => s.name === "triangle")!;
    // Columns of the leftmost and rightmost body pixels.
    const extent = (g: string[]) => {
      let lo = Infinity;
      let hi = -Infinity;
      g.forEach((row) => [...row].forEach((ch, x) => ch !== "." && ch !== "o" && ((lo = Math.min(lo, x)), (hi = Math.max(hi, x)))));
      return [lo, hi];
    };
    const c = (soldierShapeGrid(tri, 0, R, RING, false).length - 1) / 2;
    // The tip reaches further from the centre than the flat back edge.
    const east = soldierShapeGrid(tri, 0, R, RING, false);
    const west = soldierShapeGrid(tri, Math.PI, R, RING, false);
    const [el, eh] = extent(east);
    const [wl, wh] = extent(west);
    expect(eh - c).toBeGreaterThan(c - el);
    expect(c - wl).toBeGreaterThan(wh - c);
    expect(filled(east).length).toBeGreaterThan(20);
  });

  it("keeps the top-left light on rotated sprites", () => {
    for (const shape of SOLDIER_SHAPES.slice(1)) {
      for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        const g = soldierShapeGrid(shape, a, R, RING, false);
        const c = (g.length - 1) / 2;
        let hl = 0;
        let hn = 0;
        let sh = 0;
        let sn = 0;
        g.forEach((row, y) =>
          [...row].forEach((ch, x) => {
            if (ch === "+" || ch === "w") (hl += x + y), hn++;
            if (ch === "-") (sh += x + y), sn++;
          }),
        );
        expect(hn).toBeGreaterThan(0);
        expect(sn).toBeGreaterThan(0);
        expect(hl / hn).toBeLessThan(2 * c);
        expect(sh / sn).toBeGreaterThan(2 * c);
      }
    }
  });
});

describe("shaped soldier occluders", () => {
  it("intersects rays with a rotated outline and ignores rays from inside", () => {
    const sq = SOLDIER_SHAPES.find((s) => s.name === "square")!;
    const poly = new Float32Array(16);
    const n = shapeOccluder(sq, 20, 0, 0, 1, poly);
    expect(n).toBe(4);
    const d = rayPolygonDistance(0, 0, 1, 0, poly, n);
    expect(d).toBeGreaterThan(18);
    expect(d).toBeLessThan(20);
    expect(rayPolygonDistance(0, 0, -1, 0, poly, n)).toBe(Infinity);
    expect(rayPolygonDistance(20, 0, 1, 0, poly, n)).toBe(Infinity);
  });

  it("casts a shadow that turns with the soldier", () => {
    const w = new PixelWorld({ width: 60, height: 60, cellSize: 8, roomSize: 28 });
    for (let y = 0; y < 60; y++) for (let x = 0; x < 60; x++) w.setCell(x, y, 0);
    const ls = new LightingSystem(w);
    const ox = 30 * 8;
    const oy = 30 * 8;
    // A rhombus soldier 20 units east of the light: long axis across the ray
    // blocks a wider wedge than long axis along it.
    const rhombusSlot = SOLDIER_SHAPES.findIndex((s) => s.name === "rhombus");
    const s = new Soldier(ox + 20, oy, 1, 0, 0, "pistol", "free", rhombusSlot);
    const shadowWidth = (angle: number) => {
      s.facingAngle = angle;
      const poly = new Float32Array(LIGHT.maxRays * 2);
      const n = ls.computeVisibilityPolygon(ox, oy, 1, 0, 60, -1, [s], poly);
      let blocked = 0;
      for (let k = 0; k < n; k++) {
        const px = poly[k * 2] - ox;
        const py = poly[k * 2 + 1] - oy;
        if (Math.hypot(px, py) < 30) blocked = Math.max(blocked, Math.abs(Math.atan2(py, px)));
      }
      return blocked;
    };
    const along = shadowWidth(0);
    const across = shadowWidth(Math.PI / 2);
    expect(along).toBeGreaterThan(0);
    expect(across).toBeGreaterThan(along * 1.3);
  });
});
