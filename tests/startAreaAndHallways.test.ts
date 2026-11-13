import { describe, expect, it } from "vitest";
import { WORLD, tierHealth } from "../src/config";
import { PixelWorld, MAT, roomLightPosition } from "../src/world/PixelWorld";
import { generateWorld } from "../src/world/WorldGenerator";
import { LAB_WORLDS, sectorBounds, sectorZone } from "../src/world/labMap";
import { DECOR } from "../src/world/LabDetails";
import { RoomFixtures } from "../src/systems/RoomFixtures";

function lab(spawn = 0) {
  const w = new PixelWorld(WORLD);
  generateWorld(w, 123, { labWorld: LAB_WORLDS[1], spawn });
  return w;
}

describe("starting lab material progression", () => {
  it("keeps room and hallway walls at the local tier and block HP throughout all three bands", () => {
    const w = lab(), tiers = new Set<number>();
    let correct = true, walls = 0;
    for (let y = 0; y < w.height; y++) for (let x = 0; x < w.width; x++) {
      const i = y * w.width + x;
      if (!w.health[i] || !w.wall[i] || w.boundary[i] || w.mat[i] !== MAT.none || w.blight[i] || w.coreId[i]) continue;
      const tier = w.fillTierAt(x, y);
      tiers.add(w.wallTierAt(x, y)); walls++;
      correct &&= w.wallTierAt(x, y) === tier && w.health[i] === tierHealth(tier, w.tierProgress(x, y));
    }
    expect(correct).toBe(true); expect(walls).toBeGreaterThan(1000);
    expect(tiers).toEqual(new Set([1, 2, 3]));
    const f = w.labLayout!.frame!;
    for (const [sector, tier] of [[0, 1], [2, 1], [20, 1], [3, 2], [50, 2], [6, 3], [80, 3]]) {
      const b = sectorBounds(f, sector);
      expect(w.fillTierAt(b.x0 + 24, b.y0 + 24)).toBe(tier);
    }
    expect(w.labLayout!.rooms.filter(r => r.zone === 0).length).toBeGreaterThan(5);
  });
  it("anchors the bands to the initial spawn, even when deploying into a later sector", () => {
    const w = lab(80), f = w.labLayout!.frame!;
    for (const s of [0, 20, 40, 80]) {
      const b = sectorBounds(f, s);
      expect(w.wallTierAt(b.x0 + 24, b.y0 + 24)).toBe(sectorZone(f.def, s) + 1);
    }
  });
});

describe("recessed hallway fixtures", () => {
  it("puts working fixtures in solid walls, facing an air cell inside the corridor", () => {
    const w = lab();
    const lamps = w.roomLights.filter(l => l.wallFace && !l.destroyed);
    expect(lamps.length).toBeGreaterThan(20);
    for (const l of lamps) {
      const i = l.y0 * w.width + l.x0;
      expect(w.wall[i]).toBeGreaterThan(0); expect(w.health[i]).toBeGreaterThan(0);
      expect(w.decor[i]).toBe(DECOR.lightPanel);
      const p = roomLightPosition(l, w.cellSize);
      const x = Math.floor(p.x / w.cellSize), y = Math.floor(p.y / w.cellSize);
      expect(x).toBeGreaterThanOrEqual(l.cx0); expect(x).toBeLessThanOrEqual(l.cx1);
      expect(y).toBeGreaterThanOrEqual(l.cy0); expect(y).toBeLessThanOrEqual(l.cy1);
      expect(w.wall[y * w.width + x]).toBe(0);
    }
  });
  it("turns off an embedded fixture when its wall breaks", () => {
    const w = lab(), fixtures = new RoomFixtures(w); fixtures.reset();
    const l = w.roomLights.find(l => l.wallFace && !l.destroyed)!;
    expect(fixtures.solidAt(l.x0, l.y0)).toBe(false);
    expect(w.damage(l.x0, l.y0, 1e6, true)).toBe(2);
    expect(l.destroyed).toBe(true);
    expect(w.decor[l.y0 * w.width + l.x0]).toBe(DECOR.deadPanel);
  });
});
