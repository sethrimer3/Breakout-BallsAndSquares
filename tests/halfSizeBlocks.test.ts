import { describe, expect, it } from "vitest";
import { FOG } from "../src/config";
import { LightingSystem } from "../src/systems/LightingSystem";
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

describe("half-size debris damage", () => {
  const makeWorld = () => new PixelWorld({ width: 64, height: 64, cellSize: 8, roomSize: 4 });
  const put = (w: PixelWorld, x: number, y: number, kind: number, hp: number) => {
    const i = y * w.subWidth + x;
    w.subKind[i] = kind; w.subHealth[i] = hp;
    return i;
  };

  it.each([SUB.rubble, SUB.metal, SUB.pipe, SUB.screen, SUB.led, SUB.core, SUB.wreck])(
    "kind %i deals its maximum HP to all eight neighbors even after an earlier hit", kind => {
      const w = makeWorld(), center = put(w, 16, 16, kind, 1);
      const damage = w.maxSubHealthAt(16, 16);
      const neighbors: number[] = [];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (dx || dy) neighbors.push(put(w, 16 + dx, 16 + dy, SUB.blight, damage + 7));
      }
      w.damageSub(16, 16, 1, true);
      expect(w.subHealth[center]).toBe(0);
      for (const i of neighbors) expect(w.subHealth[i]).toBe(7);
    },
  );

  it("chains through diagonal debris regardless of who dealt the first damage", () => {
    const w = makeWorld();
    const line = [put(w, 8, 8, SUB.metal, 1), put(w, 9, 9, SUB.rubble, 1), put(w, 10, 10, SUB.pipe, 1)];
    w.damageSub(8, 8, 1);
    expect(line.map(i => w.subHealth[i])).toEqual([0, 0, 0]);
  });

  it("does not spread from destroyed Blight or from merely damaged debris", () => {
    const w = makeWorld(), source = put(w, 8, 8, SUB.blight, 1), neighbor = put(w, 9, 9, SUB.rubble, 10);
    w.damageSub(8, 8, 1, true);
    expect(w.subHealth[source]).toBe(0); expect(w.subHealth[neighbor]).toBe(10);
    w.damageSub(9, 9, 1, true);
    expect(w.subHealth[neighbor]).toBe(9);
  });

  it("does not damage full-size blocks, and emits destruction once per destroyed subcell", () => {
    const w = makeWorld(), destroyed: string[] = [];
    w.addDestroyListener((_x, _y, sub, sx, sy) => { if (sub) destroyed.push(`${sx},${sy}`); });
    put(w, 7, 8, SUB.rubble, 1); put(w, 7, 9, SUB.screen, 1);
    const solid = 4 * w.width + 4; w.health[solid] = 123;
    w.damageSub(7, 8, 1);
    expect(w.health[solid]).toBe(123);
    expect(destroyed.sort()).toEqual(["7,8", "7,9"]);
  });

  it("clears a large connected heap without recursion overflow or duplicate destructions", () => {
    const w = makeWorld(); let count = 0;
    w.addDestroyListener(() => count++);
    for (let y = 0; y < w.subHeight; y++) for (let x = 0; x < w.subWidth; x++) put(w, x, y, SUB.rubble, 1);
    w.damageSub(0, 0, 1);
    expect(count).toBe(w.subHealth.length);
    expect(w.subHealth.every(hp => hp === 0)).toBe(true);
  });
});
