import { describe, expect, it } from "vitest";
import { WORLD } from "../src/config";
import { DECOR } from "../src/world/LabDetails";
import { LIGHT_KIND, PixelWorld } from "../src/world/PixelWorld";
import { ROOM_STATE, generateWorld } from "../src/world/WorldGenerator";

const SEEDS = [101, 202, 303, 404];

function world(seed: number): PixelWorld {
  const w = new PixelWorld(WORLD);
  generateWorld(w, seed);
  return w;
}

describe("room condition", () => {
  it("mixes pristine, worn, decayed and overrun rooms in every lab", () => {
    for (const seed of SEEDS) {
      const w = world(seed);
      const counts = [0, 0, 0, 0];
      for (const r of w.labLayout!.rooms) counts[r.state!]++;
      expect(counts[ROOM_STATE.pristine], `seed ${seed} pristine`).toBeGreaterThan(0);
      expect(counts[ROOM_STATE.decayed] + counts[ROOM_STATE.worn], `seed ${seed} worn/decayed`).toBeGreaterThan(0);
      expect(counts[ROOM_STATE.overrun], `seed ${seed} overrun`).toBeGreaterThan(0);
      for (const r of w.labLayout!.rooms) expect(r.overrun === true).toBe(r.state === ROOM_STATE.overrun);
    }
  });

  it("puts rooms nearer the Blight in worse shape on average", () => {
    for (const seed of SEEDS) {
      const rooms = world(seed).labLayout!.rooms;
      const cores = rooms.filter((r) => r.overrun).map((r) => ({ x: r.x + r.size / 2, y: r.y + r.size / 2 }));
      const dist = (r: (typeof rooms)[number]): number =>
        Math.min(...cores.map((c) => Math.hypot(c.x - r.x - r.size / 2, c.y - r.y - r.size / 2)));
      const avg = (s: number): number => {
        const rs = rooms.filter((r) => r.state === s);
        return rs.reduce((a, r) => a + dist(r), 0) / Math.max(1, rs.length);
      };
      expect(avg(ROOM_STATE.pristine)).toBeGreaterThan(avg(ROOM_STATE.decayed));
    }
  });

  it("lights pristine rooms brightly and leaves decayed ones with dead or failing tubes", () => {
    const w = world(101);
    const kinds = new Set(w.roomLights.map((l) => l.kind));
    expect(kinds.has(LIGHT_KIND.bright)).toBe(true);
    expect(kinds.has(LIGHT_KIND.wash)).toBe(true);
    expect(kinds.has(LIGHT_KIND.blight)).toBe(true);
    for (const l of w.roomLights) {
      // Lights never spill outside the room or hallway that holds them.
      expect(l.x0).toBeGreaterThanOrEqual(l.cx0);
      expect(l.y0).toBeGreaterThanOrEqual(l.cy0);
      expect(l.x1).toBeLessThanOrEqual(l.cx1);
      expect(l.y1).toBeLessThanOrEqual(l.cy1);
    }
    let pristineFloor = 0;
    let decayedPanels = 0;
    let decayedDead = 0;
    for (const r of SEEDS.flatMap((s) => { const sw = s === 101 ? w : world(s); return sw.labLayout!.rooms.map((room) => ({ ...room, w: sw })); })) {
      const w = r.w;
      for (let y = r.y; y < r.y + r.size; y++) {
        for (let x = r.x; x < r.x + r.size; x++) {
          const d = w.decor[y * w.width + x];
          if (r.state === ROOM_STATE.pristine && d === DECOR.cleanFloor) pristineFloor++;
          if (r.state === ROOM_STATE.decayed && (d === DECOR.lightPanel || d === DECOR.deadPanel)) {
            decayedPanels++;
            if (d === DECOR.deadPanel) decayedDead++;
          }
        }
      }
    }
    expect(pristineFloor).toBeGreaterThan(0);
    expect(decayedPanels).toBeGreaterThan(0);
    expect(decayedDead / decayedPanels).toBeGreaterThan(0.5);
  });
});
