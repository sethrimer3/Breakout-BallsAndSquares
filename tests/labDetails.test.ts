import { describe, expect, it } from "vitest";
import { WORLD } from "../src/config";
import { Rng } from "../src/core/Rng";
import { GrowthSystem } from "../src/world/GrowthSystem";
import { DECOR, ROOM_STAMPS } from "../src/world/LabDetails";
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
  it("is cosmetic: solid cells stay solid with the health their material sets", () => {
    for (const seed of SEEDS) {
      const w = world(seed);
      for (let cy = 0; cy < w.height; cy += 3) {
        for (let cx = 0; cx < w.width; cx += 3) {
          const i = cy * w.width + cx;
          if (cx >= w.roomX0 && cx <= w.roomX1 && cy >= w.roomY0 && cy <= w.roomY1) {
            expect(w.health[i]).toBe(0);
            expect(w.decor[i]).toBe(DECOR.none);
          } else {
            expect(w.health[i]).toBe(w.maxHealthAt(cx, cy));
          }
        }
      }
    }
  });

  it("is seeded: same seed same details, new seed new details", () => {
    const a = world(101);
    expect(a.decor).toEqual(world(101).decor);
    expect(a.decor).not.toEqual(world(202).decor);
  });

  it("gives every seed doors, hazard stripes, tiled floors and furnishings", () => {
    for (const seed of SEEDS) {
      const w = world(seed);
      for (const d of [DECOR.door, DECOR.doorSeam, DECOR.doorLight, DECOR.hazardYellow, DECOR.hazardBlack]) {
        expect(countDecor(w, d), `decor ${d}`).toBeGreaterThan(0);
      }
      expect(countDecor(w, DECOR.floorLine)).toBeGreaterThan(0);
      expect(countDecor(w, DECOR.guideLine)).toBeGreaterThan(0);
      expect(countDecor(w, DECOR.frame) + countDecor(w, DECOR.panel) + countDecor(w, DECOR.bench)).toBeGreaterThan(0);
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

  it("uses furnishing stamps that fit the smallest room", () => {
    for (const stamp of Object.values(ROOM_STAMPS)) {
      for (const row of stamp) expect(row.length).toBe(stamp[0].length);
      expect(stamp[0].length).toBeLessThanOrEqual(10 - 4);
      expect(stamp.length).toBeLessThanOrEqual(10 - 4);
    }
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

  it("wipes a detail when blight regrows over it", () => {
    const w = world(101);
    let target = -1;
    for (let i = 0; i < w.decor.length && target < 0; i++) {
      if (w.decor[i] === DECOR.frame) target = i;
    }
    const cx = target % w.width;
    const cy = Math.floor(target / w.width);
    w.health[target] = 0;
    const g = new GrowthSystem(w, new Rng(5));
    g.frontier.rebuildFull();
    let guard = 0;
    while (w.health[target] === 0 && guard++ < 100) g.replicateOne(0, []);
    expect(w.solidAt(cx, cy)).toBe(true);
    expect(w.decor[target]).toBe(DECOR.none);
  });
});
