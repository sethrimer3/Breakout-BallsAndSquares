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
