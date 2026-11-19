import { describe, expect, it } from "vitest";
import { FOG, SUBPIXEL_PHYSICS } from "../src/config";
import { LightingSystem } from "../src/systems/LightingSystem";
import { SubPixelPhysics } from "../src/systems/SubPixelPhysics";
import { FogOfWar } from "../src/world/FogOfWar";
import { PixelWorld, SUB } from "../src/world/PixelWorld";

/** An empty 64×64 world with a one-subcell-thick rubble wall at subcell column `sx`. */
function walled(sx: number): PixelWorld {
  const w = new PixelWorld({ width: 64, height: 64, cellSize: 8, roomSize: 4 });
  for (let sy = 0; sy < w.subHeight; sy++) {
    const si = sy * w.subWidth + sx;
    w.subKind[si] = SUB.rubble;
    w.subHealth[si] = 3;
  }
  return w;
}

describe("half-size blocks", () => {
  it("cast shadows: light stops at a half-size wall", () => {
    const w = walled(21); // spans world x 84..88
    const light = new LightingSystem(w);
    const poly = new Float32Array(4096 * 2);
    const n = light.computeVisibilityPolygon(40, 200, 1, 0, 122, -1, [], poly);
    expect(n).toBeGreaterThan(0);
    let maxX = 0;
    for (let i = 0; i < n; i++) maxX = Math.max(maxX, poly[i * 2]);
    expect(maxX).toBeLessThan(84 + 2);
  });

  it("block the fog of war's line of sight", () => {
    const w = walled(40); // world x 160..164
    const fog = new FogOfWar(w);
    const eye = { x: 100, y: 256, radiusCells: FOG.soldierSightCells };
    for (let t = 0; t < 120; t++) fog.update(1 / 60, [eye]);
    expect(fog.lightAt(120, 256)).toBeGreaterThan(0.5);
    expect(fog.lightAt(200, 256)).toBeLessThan(0.05);
  });
});

describe("half-size physics push", () => {
  const makeWorld = () => {
    const w = new PixelWorld({ width: 64, height: 64, cellSize: 8, roomSize: 4 });
    const phys = new SubPixelPhysics(w);
    w.onSubBreakPush = (sx, sy) => phys.pushFromBreak(sx, sy);
    return { w, phys };
  };
  const put = (w: PixelWorld, x: number, y: number, kind: number, hp: number) => {
    const i = y * w.subWidth + x;
    w.subKind[i] = kind;
    w.subHealth[i] = hp;
    return i;
  };

  it.each([SUB.rubble, SUB.metal, SUB.pipe, SUB.screen, SUB.led, SUB.core, SUB.wreck])(
    "kind %i does not break neighbors; it pushes nearby non-blight 0.5 pixels away",
    (kind) => {
      const { w, phys } = makeWorld();
      const center = put(w, 16, 16, kind, 1);
      const ortho = put(w, 17, 16, SUB.rubble, 7);
      const diag = put(w, 17, 17, SUB.metal, 5);
      const blight = put(w, 15, 16, SUB.blight, 4);
      const solid = 8 * w.width + 7; // full cell (7,8) covers subcells (14..15, 16..17) -> keep blight at (15,15) instead
      w.subHealth[blight] = 0;
      const blight2 = put(w, 16, 15, SUB.blight, 4);
      w.health[solid] = 123;

      w.damageSub(16, 16, 1, true);
      expect(w.subHealth[center]).toBe(0);
      // Blight and full-size blocks are never detached or damaged.
      expect(w.subHealth[blight2]).toBe(4);
      expect(w.health[solid]).toBe(123);
      // Orthogonal and diagonal non-blight neighbors were detached into physics, not broken.
      expect(w.subHealth[ortho]).toBe(0);
      expect(w.subHealth[diag]).toBe(0);
      expect(phys.count).toBe(2);
      // Both were pushed outward (+x for ortho, +x/+y for diag) with their HP preserved.
      expect(phys.vx[0]).toBeGreaterThan(0);
      expect(phys.hp[0]).toBe(7);
      expect(phys.vx[1]).toBeGreaterThan(0);
      expect(phys.vy[1]).toBeGreaterThan(0);
      expect(phys.hp[1]).toBe(5);
    },
  );

  it("diminishes push force over distance", () => {
    const { w, phys } = makeWorld();
    put(w, 20, 20, SUB.rubble, 1);
    put(w, 21, 20, SUB.rubble, 5); // distance 1 subcell
    put(w, 22, 20, SUB.rubble, 5); // distance 2 subcells
    put(w, 23, 20, SUB.rubble, 5); // distance 3 subcells
    put(w, 25, 20, SUB.rubble, 5); // outside push radius

    w.damageSub(20, 20, 1, true);
    expect(phys.count).toBe(3);
    // Speeds strictly decrease with distance: d=1 > d=2 > d=3.
    expect(phys.vx[0]).toBeGreaterThan(phys.vx[1]);
    expect(phys.vx[1]).toBeGreaterThan(phys.vx[2]);
    expect(phys.vx[2]).toBeGreaterThan(0);
    // Pixel outside push radius stays static.
    expect(w.subHealth[20 * w.subWidth + 25]).toBe(5);
  });

  it("does not push neighbors from destroyed Blight or from merely damaged debris", () => {
    const { w, phys } = makeWorld();
    const source = put(w, 8, 8, SUB.blight, 1);
    const neighbor = put(w, 9, 8, SUB.rubble, 10);
    w.damageSub(8, 8, 1, true);
    expect(w.subHealth[source]).toBe(0);
    expect(w.subHealth[neighbor]).toBe(10);
    expect(phys.count).toBe(0);

    w.damageSub(9, 8, 1, true);
    expect(w.subHealth[neighbor]).toBe(9);
    expect(phys.count).toBe(0);
  });

  it("sticks slightly to walls and settles back into PixelWorld", () => {
    const { w, phys } = makeWorld();
    // Place a full-size wall at cell (12, 10) -> subcells x=24..25, y=20..21.
    w.setCell(12, 10, 50);
    // Distant wall-hugging pixel at (23, 20) (3 subcells from break at 20,20) resists tiny nudge.
    const wallHugger = put(w, 23, 20, SUB.metal, 5);
    // Closer pixel at (21, 20) breaks free, travels right, hits wall at x=24, sticks & settles.
    put(w, 20, 20, SUB.rubble, 1);
    put(w, 21, 20, SUB.rubble, 6);

    w.damageSub(20, 20, 1, true);
    expect(w.subHealth[wallHugger]).toBe(5);
    expect(phys.count).toBe(1);

    for (let step = 0; step < 120; step++) phys.update(1 / 60);
    expect(phys.count).toBe(0);
    // Settled before the wall (sx <= 23), never penetrating into cell (12, 10).
    expect(w.health[10 * w.width + 12]).toBe(50);
    const settledIdx = 20 * w.subWidth + 22;
    const settledBeforeWall = w.subHealth[settledIdx] === 6 || w.subHealth[20 * w.subWidth + 23] === 6 || w.subHealth[20 * w.subWidth + 21] === 6;
    expect(settledBeforeWall).toBe(true);
  });

  it("caps active physics bodies cleanly on a dense heap without errors", () => {
    const { w, phys } = makeWorld();
    for (let y = 10; y < 40; y++) for (let x = 10; x < 40; x++) put(w, x, y, SUB.rubble, 2);
    for (let x = 10; x < 40; x += 2) w.damageSub(x, 20, 2);
    expect(phys.count).toBeLessThanOrEqual(SUBPIXEL_PHYSICS.poolSize);
    for (let step = 0; step < 180; step++) phys.update(1 / 60);
    expect(phys.count).toBe(0);
  });
});
