import { generatorKey } from "../src/world/ExoticMatter";
import { describe, expect, it } from "vitest";
import { WORLD } from "../src/config";
import { GlassSystem } from "../src/world/GlassSystem";
import { GrowthSystem } from "../src/world/GrowthSystem";
import { Rng } from "../src/core/Rng";
import { MAT, PixelWorld } from "../src/world/PixelWorld";
import { generateWorld } from "../src/world/WorldGenerator";

describe("starting containment tube", () => {
  it("provides an empty horizontal landing and three disconnected glass shells on the left", () => {
    const w = new PixelWorld(WORLD); generateWorld(w, 303, {conquered: new Set([0])});
    const tube = w.startingTube!;
    expect(tube).not.toBeNull();
    expect(tube.x1 - tube.x0).toBeGreaterThan((tube.y1 - tube.y0) * 2);
    const core = w.blightCores[tube.coreId - 1];
    expect(core.cx).toBeLessThan(w.roomX0);
    expect(core.alive).toBe(true);
    const g = new GrowthSystem(w, new Rng(1)); g.reset();
    expect(g.isCoreExposed(core.id)).toBe(false);
    for (const r of [1, 3, 5]) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const i = (core.cy + dy) * w.width + core.cx + dx;
        expect(w.mat[i]).toBe(MAT.glass); expect(w.health[i]).toBeGreaterThan(0);
      }
    }
    for (let y = w.roomY0; y <= w.roomY1; y++) for (let x = w.roomX0; x <= w.roomX1; x++) {
      expect(w.anySolidInCell(x, y)).toBe(false);
    }
    for (let x = tube.x0 - 1; x < tube.x1; x++) {
      expect(w.health[(tube.y0 - 1) * w.width + x]).toBeGreaterThan(0);
      expect(w.health[(tube.y1 + 1) * w.width + x]).toBeGreaterThan(0);
    }
    // The eastern mouth joins the existing level; the tube is not a dead end.
    const queue = [Math.floor(w.roomCenterY / w.cellSize) * w.width + Math.floor(w.roomCenterX / w.cellSize)];
    const seen = new Set(queue);
    for (let head = 0; head < queue.length; head++) {
      const i = queue[head], x = i % w.width, y = Math.floor(i / w.width);
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx = x + dx, ny = y + dy, ni = ny * w.width + nx;
        if (!w.inBounds(nx, ny) || seen.has(ni) || w.anySolidInCell(nx, ny)) continue;
        seen.add(ni); queue.push(ni);
      }
    }
    expect(queue.some(i => i % w.width > tube.x1)).toBe(true);
    for (const door of w.doors) for (const i of door.cells) expect(w.doorId[i]).toBe(door.id);
    const glass = new GlassSystem(w);
    w.damage(core.cx + 5, core.cy, 99999);
    glass.update(10);
    expect(w.health[core.cy * w.width + core.cx + 5]).toBe(0);
    expect(w.health[core.cy * w.width + core.cx + 3]).toBeGreaterThan(0);
    expect(w.health[core.cy * w.width + core.cx + 1]).toBeGreaterThan(0);
    expect(g.isCoreExposed(core.id)).toBe(false);
  });

  it("keeps generator identities across landings and never restores a destroyed generator", () => {
    const w = new PixelWorld(WORLD);
    generateWorld(w, 303);
    const key = generatorKey(w.blightCores[w.startingTube!.coreId - 1]);
    const another = w.blightCores.find(core => core.alive && core.size === 2)!;
    const otherKey = generatorKey(another);
    generateWorld(w, 303, { spawn: 1, destroyedGenerators: { [key]: false, [otherKey]: true } });
    expect(generatorKey(w.blightCores[w.startingTube!.coreId - 1])).toBe(key);
    for (const id of [key, otherKey]) {
      const core = w.blightCores.find(candidate => generatorKey(candidate) === id)!;
      expect(core.alive).toBe(false);
      expect(core.cells.every(i => w.health[i] === 0 && w.coreId[i] === 0)).toBe(true);
    }
    expect(w.roomX0).toBeGreaterThan(w.startingTube!.x0);
  });
});
