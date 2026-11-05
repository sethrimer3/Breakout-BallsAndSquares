import { describe, expect, it } from "vitest";
import { LIGHT } from "../src/config";
import { Rng } from "../src/core/Rng";
import { CasingSystem } from "../src/entities/CasingSystem";
import { Soldier } from "../src/entities/Soldier";
import { LightingSystem, makeLitCells, rayCircleDistance } from "../src/systems/LightingSystem";
import { PixelWorld } from "../src/world/PixelWorld";

/** Point-in-polygon (ray casting) for world-space flat vertex array `[x0, y0, ...]`. */
function pointInPolygon(px: number, py: number, poly: Float32Array, count: number): boolean {
  let inside = false;
  for (let i = 0, j = count - 1; i < count; j = i++) {
    const xi = poly[i * 2];
    const yi = poly[i * 2 + 1];
    const xj = poly[j * 2];
    const yj = poly[j * 2 + 1];
    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

describe("Phase 4 — Visibility-polygon lighting & shadows (Rev 2)", () => {
  it("casts an crisp shadow behind a single isolated terrain cell with no light leaks", () => {
    const w = new PixelWorld({ width: 40, height: 40, cellSize: 8, roomSize: 28 });
    // Carve a wide empty chamber (cells 4..35) with one solid pillar at (20, 20).
    w.health.fill(10);
    for (let y = 4; y <= 35; y++) {
      for (let x = 4; x <= 35; x++) w.setCell(x, y, 0);
    }
    w.setCell(20, 20, 10);

    const ls = new LightingSystem(w);
    const poly = new Float32Array(2048);
    // Light at center of (16, 20) = (132, 164), pillar at x=[160..168], y=[160..168].
    const ox = 16.5 * 8;
    const oy = 20.5 * 8;
    const n = ls.computeVisibilityPolygon(ox, oy, 1, 0, LIGHT.radius, 1, [], poly);
    expect(n).toBeGreaterThan(96);

    // A point between the light and the pillar is lit.
    expect(pointInPolygon(18.5 * 8, 20.5 * 8, poly, n)).toBe(true);
    // Points directly behind the pillar (inside its umbra) must NOT be in the visibility polygon.
    expect(pointInPolygon(23.5 * 8, 20.5 * 8, poly, n)).toBe(false);
    expect(pointInPolygon(26.0 * 8, 20.5 * 8, poly, n)).toBe(false);
    // A point well above the pillar's shadow cone is still lit.
    expect(pointInPolygon(23.5 * 8, 17.5 * 8, poly, n)).toBe(true);
  });

  it("blocks light behind an L-shaped wall and casts a shadow silhouette behind another soldier", () => {
    const w = new PixelWorld({ width: 40, height: 40, cellSize: 8, roomSize: 28 });
    w.health.fill(10);
    for (let y = 4; y <= 35; y++) {
      for (let x = 4; x <= 35; x++) w.setCell(x, y, 0);
    }
    // L-shaped wall blocking the upper-right quadrant behind (22, 18).
    for (let x = 22; x <= 26; x++) w.setCell(x, 18, 10);
    for (let y = 14; y <= 18; y++) w.setCell(22, y, 10);

    const ls = new LightingSystem(w);
    const poly = new Float32Array(2048);
    const ox = 18.5 * 8;
    const oy = 20.5 * 8;

    // Place a second soldier at (18.5*8, 24.5*8) -> directly south of the light.
    const blocker = new Soldier(18.5 * 8, 24.5 * 8, 1, 0, 125);
    const n = ls.computeVisibilityPolygon(ox, oy, 1, 0, LIGHT.radius, 999, [blocker], poly);

    // Cavity tucked behind the L-corner at (24.5*8, 16.5*8) is occluded.
    expect(pointInPolygon(24.5 * 8, 16.5 * 8, poly, n)).toBe(false);
    // Point south of `blocker` (18.5*8, 28*8) is in the soldier's shadow wedge.
    expect(pointInPolygon(18.5 * 8, 28.0 * 8, poly, n)).toBe(false);
    // Point between the light and the soldier is lit.
    expect(pointInPolygon(18.5 * 8, 22.0 * 8, poly, n)).toBe(true);
  });

  it("stops air light at wall faces, with no radial bleed into the wall", () => {
    const w = new PixelWorld({ width: 40, height: 40, cellSize: 8, roomSize: 28 });
    w.health.fill(10);
    for (let y = 10; y <= 30; y++) {
      for (let x = 10; x <= 30; x++) w.setCell(x, y, 0);
    }
    const ls = new LightingSystem(w);
    const poly = new Float32Array(LIGHT.maxRays * 2);
    const n = ls.computeVisibilityPolygon(20.5 * 8, 20.5 * 8, 1, 0, LIGHT.radius, 1, [], poly);
    const maxX = 31 * 8 + LIGHT.faceOverdraw;
    for (let i = 0; i < n; i++) {
      // Every vertex stays within the overdraw of the chamber, even at grazing angles.
      expect(poly[i * 2]).toBeLessThanOrEqual(maxX + 1e-3);
    }
  });

  it("lights whole exposed wall cells only where the light can see them", () => {
    const w = new PixelWorld({ width: 40, height: 40, cellSize: 8, roomSize: 28 });
    w.health.fill(10);
    for (let y = 10; y <= 30; y++) {
      for (let x = 10; x <= 30; x++) w.setCell(x, y, 0);
    }
    // Pillar shadowing part of the east wall (x = 31) from a light west of it.
    for (let y = 18; y <= 22; y++) w.setCell(24, y, 10);

    const ls = new LightingSystem(w);
    const poly = new Float32Array(LIGHT.maxRays * 2);
    const lit = makeLitCells();
    ls.computeVisibilityPolygon(20.5 * 8, 20.5 * 8, 1, 0, LIGHT.radius, 1, [], poly, lit);
    const isLit = (x: number, y: number) => lit.cells.subarray(0, lit.count).includes(y * 40 + x);

    expect(isLit(24, 20)).toBe(true); // Pillar face toward the light.
    expect(isLit(31, 20)).toBe(false); // East wall inside the pillar's umbra.
    expect(isLit(31, 12)).toBe(true); // East wall beyond the shadow.
    expect(isLit(10 - 1, 20)).toBe(true); // West wall.
    expect(isLit(32, 12)).toBe(false); // Buried cell behind the exposed face.
    expect(isLit(25, 20)).toBe(false); // Interior / far side of the pillar.
  });

  it("backs a muzzle embedded in a wall out to open air instead of losing the light", () => {
    const w = new PixelWorld({ width: 40, height: 40, cellSize: 8, roomSize: 28 });
    w.health.fill(10);
    for (let y = 10; y <= 30; y++) {
      for (let x = 10; x <= 30; x++) w.setCell(x, y, 0);
    }
    const ls = new LightingSystem(w);
    const poly = new Float32Array(LIGHT.maxRays * 2);
    // Muzzle 2 units inside the east wall, firing east.
    const n = ls.computeVisibilityPolygon(31 * 8 + 2, 20.5 * 8, 1, 0, LIGHT.radius, 1, [], poly);
    expect(n).toBeGreaterThan(96);
    expect(pointInPolygon(25.5 * 8, 20.5 * 8, poly, n)).toBe(true);
  });

  it("keeps the full ray fan when a light has too many corners for its polygon buffer", () => {
    const w = new PixelWorld({ width: 80, height: 80, cellSize: 8, roomSize: 28 });
    for (let y = 0; y < 80; y++) {
      for (let x = 0; x < 80; x++) w.setCell(x, y, (x + y) % 2 === 0 && (x + y) % 6 === 0 ? 10 : 0);
    }
    w.setCell(40, 40, 0);
    const ls = new LightingSystem(w);
    const poly = new Float32Array(512);
    const n = ls.computeVisibilityPolygon(40.5 * 8, 40.5 * 8, 1, 0, LIGHT.radius, 1, [], poly);
    expect(n).toBeLessThanOrEqual(256);
    // Vertices past +PI would be cut off by truncation; the fan must close the circle.
    const last = Math.atan2(poly[(n - 1) * 2 + 1] - 40.5 * 8, poly[(n - 1) * 2] - 40.5 * 8);
    expect(last).toBeGreaterThan(3);
  });

  it("computes accurate ray-circle intersection distances", () => {
    const d = rayCircleDistance(0, 0, 1, 0, 20, 0, 4);
    expect(d).toBeCloseTo(16, 5);
    expect(rayCircleDistance(0, 0, -1, 0, 20, 0, 4)).toBe(Infinity);
  });
});

describe("Phase 4 — Shell casings", () => {
  it("ejects perpendicular to firing direction, spins, slows with drag, and expires", () => {
    const casings = new CasingSystem(32);
    const rng = new Rng(42);
    casings.spawn(100, 100, 1, 0, 1, rng);
    expect(casings.count).toBe(1);
    const a0 = casings.angle[0];
    // Firing along +X -> casing moves predominantly along +Y.
    expect(Math.abs(casings.vy[0])).toBeGreaterThan(20);
    casings.update(0.2);
    expect(casings.angle[0]).not.toBe(a0);
    casings.update(3.0);
    expect(casings.count).toBe(0);
  });
});
