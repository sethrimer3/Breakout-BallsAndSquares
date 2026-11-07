import { describe, expect, it } from "vitest";
import { COLORS, WORLD } from "../src/config";
import { Rng } from "../src/core/Rng";
import { GrowthSystem } from "../src/world/GrowthSystem";
import { DECOR } from "../src/world/LabDetails";
import { MAT, SUB } from "../src/world/PixelWorld";
import { PixelWorld } from "../src/world/PixelWorld";
import { generateWorld } from "../src/world/WorldGenerator";

const SEEDS = [101, 202, 303, 404];

function world(seed: number): PixelWorld {
  const w = new PixelWorld(WORLD);
  generateWorld(w, seed);
  return w;
}

function countDecor(w: PixelWorld, value: number): number {
  let n = 0;
  for (let i = 0; i < w.decor.length; i++) if (w.decor[i] === value) n++;
  return n;
}

function floodFromStart(w: PixelWorld): Uint8Array {
  const seen = new Uint8Array(w.width * w.height);
  const start = w.centerY * w.width + w.centerX;
  seen[start] = 1;
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    const cx = cur % w.width;
    const cy = Math.floor(cur / w.width);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!w.inBounds(nx, ny)) continue;
      const ni = ny * w.width + nx;
      if (seen[ni] || w.wall[ni] !== 0) continue;
      seen[ni] = 1;
      queue.push(ni);
    }
  }
  return seen;
}

describe("lab details", () => {
  it("keeps solid cells at max health and carves every room and hallway empty", () => {
    for (const seed of SEEDS) {
      const w = world(seed);
      // Spawn room is empty
      for (let cy = w.roomY0; cy <= w.roomY1; cy++) {
        for (let cx = w.roomX0; cx <= w.roomX1; cx++) {
          const i = cy * w.width + cx;
          expect(w.health[i]).toBe(0);
          expect(w.decor[i]).toBe(DECOR.none);
        }
      }
      // Any cell with health > 0 has its material's max health
      for (let i = 0; i < w.health.length; i += 7) {
        if (w.health[i] > 0) {
          const cx = i % w.width;
          const cy = Math.floor(i / w.width);
          expect(w.health[i]).toBe(w.maxHealthAt(cx, cy));
        }
      }
      // Overrun rooms (blight generator rooms) are empty (except 2x2 core cells)
      const overrunRooms = w.labLayout!.rooms.filter((r) => r.overrun);
      expect(overrunRooms.length).toBeGreaterThan(0);
      for (const r of overrunRooms) {
        for (let ry = r.y; ry < r.y + r.size; ry++) {
          for (let rx = r.x; rx < r.x + r.size; rx++) {
            const idx = ry * w.width + rx;
            if (w.coreId[idx] > 0) {
              expect(w.health[idx]).toBeGreaterThan(0);
            } else if (w.wall[idx] === 0) {
              expect(w.health[idx]).toBe(0);
            }
          }
        }
      }
      // Every room is empty apart from glass tanks and their small generators.
      for (const r of w.labLayout!.rooms) {
        for (let ry = r.y; ry < r.y + r.size; ry++) {
          for (let rx = r.x; rx < r.x + r.size; rx++) {
            const idx = ry * w.width + rx;
            if (w.coreId[idx] > 0 || w.mat[idx] !== MAT.none) continue;
            expect(w.health[idx]).toBe(0);
          }
        }
      }
      // Some hallways have collapsed into rubble, the rest are open.
      const corridors = w.labLayout!.corridors;
      const rubbleRatio = corridors.filter((c) => c.rubble).length / corridors.length;
      expect(rubbleRatio).toBeGreaterThan(0.05);
      expect(rubbleRatio).toBeLessThan(0.6);
    }
  });

  it("is seeded: same seed same details, new seed new details", () => {
    const a = world(101);
    expect(a.decor).toEqual(world(101).decor);
    expect(a.decor).not.toEqual(world(202).decor);
  });

  it("gives every seed doors, hazard stripes, tiled floors and glass tanks", () => {
    for (const seed of SEEDS) {
      const w = world(seed);
      for (const d of [DECOR.door, DECOR.doorSeam, DECOR.doorLight, DECOR.hazardYellow, DECOR.hazardBlack]) {
        expect(countDecor(w, d), `decor ${d}`).toBeGreaterThan(0);
      }
      expect(countDecor(w, DECOR.floorLine)).toBeGreaterThan(0);
      expect(countDecor(w, DECOR.guideLine)).toBeGreaterThan(0);
      expect(countDecor(w, DECOR.glass)).toBeGreaterThan(0);
    }
  });

  it("keeps doors soft, so the maze stays walkable through them", () => {
    for (const seed of SEEDS) {
      const w = world(seed);
      const reachable = floodFromStart(w);
      for (const room of w.labLayout!.rooms) {
        const cx = room.x + Math.floor(room.size / 2);
        const cy = room.y + Math.floor(room.size / 2);
        expect(reachable[cy * w.width + cx]).toBe(1);
      }
      for (let i = 0; i < w.decor.length; i++) {
        if (w.decor[i] === DECOR.door || w.decor[i] === DECOR.doorSeam) expect(w.wall[i]).toBe(0);
        if (w.decor[i] === DECOR.doorLight) expect(w.wall[i]).toBeGreaterThan(0);
      }
    }
  });

  it("breaches some rooms across seeds without emptying any cell", () => {
    let stained = 0;
    let scorched = 0;
    for (const seed of SEEDS) {
      const w = world(seed);
      stained += countDecor(w, DECOR.blightStain);
      scorched += countDecor(w, DECOR.scorch);
      for (let i = 0; i < w.decor.length; i++) {
        if (w.decor[i] === DECOR.scorch) {
          expect(w.wall[i]).toBe(0);
          expect(w.health[i]).toBeGreaterThan(0);
        }
      }
    }
    expect(stained).toBeGreaterThan(0);
    expect(scorched).toBeGreaterThan(0);
  });

  it("seals rooms behind two-cell-thick tiered doors that are solid blocks", () => {
    for (const seed of SEEDS) {
      const w = world(seed);
      expect(w.doors.length).toBeGreaterThan(10);
      for (const d of w.doors) {
        const thick = Math.min(d.x1 - d.x0, d.y1 - d.y0) + 1;
        expect(thick).toBeLessThanOrEqual(2);
        for (const i of d.cells) {
          expect(w.mat[i]).toBe(MAT.door);
          expect(w.doorId[i]).toBe(d.id);
          expect(w.health[i]).toBeGreaterThan(0);
        }
      }
      // Zone 1 rooms need the Tier 1 keycard.
      expect(w.doors.some((d) => d.tier === 1)).toBe(true);
    }
  });

  it("puts a small dormant generator inside every glass tank and lays rubble in collapsed hallways", () => {
    let small = 0;
    let rubble = 0;
    for (const seed of SEEDS) {
      const w = world(seed);
      for (const c of w.blightCores) {
        if (c.size !== 1) continue;
        small++;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          expect(w.mat[(c.cy + dy) * w.width + c.cx + dx]).toBe(MAT.glass);
        }
      }
      for (let si = 0; si < w.subHealth.length; si++) {
        if (w.subHealth[si] > 0 && w.subKind[si] === SUB.rubble) rubble++;
      }
    }
    expect(small).toBeGreaterThan(0);
    expect(rubble).toBeGreaterThan(0);
  });

  it("lines rooms up on the facility lattice", () => {
    const w = world(101);
    for (const r of w.labLayout!.rooms) {
      // Even rooms sit up to one cell off their lattice line.
      for (const [start, center] of [[r.x, w.centerX], [r.y, w.centerY]]) {
        const offset = Math.abs(start + Math.floor(r.size / 2) - center) % 16;
        expect(Math.min(offset, 16 - offset)).toBeLessThanOrEqual(1);
      }
    }
  });

  it("keeps the inner zones full of rooms on every seed", () => {
    for (const seed of SEEDS) {
      const rooms = world(seed).labLayout!.rooms;
      expect(rooms.filter((r) => r.zone === 0).length, `seed ${seed}`).toBeGreaterThanOrEqual(5);
      expect(rooms.filter((r) => r.zone === 1).length, `seed ${seed}`).toBeGreaterThanOrEqual(8);
    }
  });

  it("varies the first zone's layout from run to run", () => {
    const layouts = SEEDS.map((seed) =>
      world(seed)
        .labLayout!.rooms.filter((r) => r.zone === 0)
        .map((r) => `${r.x},${r.y},${r.size}`)
        .sort()
        .join(" "),
    );
    expect(new Set(layouts).size).toBe(SEEDS.length);
    const sizes = world(101).labLayout!.rooms.filter((r) => r.zone === 0).map((r) => r.size);
    expect(new Set(sizes).size).toBeGreaterThan(1);
  });

  it("keeps rooms clear of the starting room, walls included", () => {
    for (const seed of SEEDS) {
      const w = world(seed);
      for (const r of w.labLayout!.rooms) {
        const gapX = Math.max(w.roomX0 - (r.x + r.size - 1), r.x - w.roomX1);
        const gapY = Math.max(w.roomY0 - (r.y + r.size - 1), r.y - w.roomY1);
        expect(Math.max(gapX, gapY), `seed ${seed}`).toBeGreaterThan(r.wallThickness);
      }
    }
  });

  it("has a color, mix and glow for every detail", () => {
    const count = Object.keys(DECOR).length;
    expect(COLORS.labDecor.length).toBe(count);
    expect(COLORS.labDecorMix.length).toBe(count);
    expect(COLORS.labGlow.length).toBe(count);
  });

  it("wipes a detail when blight regrows over it", () => {
    const w = world(101);
    let target = -1;
    for (let i = 0; i < w.decor.length && target < 0; i++) {
      if (w.decor[i] === DECOR.doorLight) target = i;
    }
    const cx = target % w.width;
    const cy = Math.floor(target / w.width);
    w.health[target] = 0;
    const g = new GrowthSystem(w, new Rng(5));
    g.frontier.clear();
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (w.inBounds(nx, ny)) {
        w.health[ny * w.width + nx] = w.maxHealthAt(nx, ny);
        g.frontier.refresh(nx, ny);
      }
    }
    let guard = 0;
    while (w.health[target] === 0 && guard++ < 100) g.replicateOne(0, []);
    expect(w.solidAt(cx, cy)).toBe(true);
    expect(w.decor[target]).toBe(DECOR.none);
  });
});
