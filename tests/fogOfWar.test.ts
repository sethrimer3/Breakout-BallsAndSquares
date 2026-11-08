import { describe, expect, it } from "vitest";
import { FOG } from "../src/config";
import { UPGRADE_BY_ID } from "../src/progression/UpgradeDefinitions";
import { baseSoldierStats } from "../src/entities/Soldier";
import { fogAlpha } from "../src/rendering/FogRenderer";
import { FogOfWar, type SightSource } from "../src/world/FogOfWar";

const N = 128;
const CS = 8;

function openWorld(solid: (cx: number, cy: number) => boolean = () => false) {
  return {
    width: N,
    height: N,
    cellSize: CS,
    solidAt: (cx: number, cy: number) => cx < 0 || cy < 0 || cx >= N || cy >= N || solid(cx, cy),
  };
}

function run(fog: FogOfWar, seconds: number, src: SightSource[]) {
  for (let t = 0; t < seconds * 60; t++) fog.update(1 / 60, src);
}

const eye = { x: 64 * CS + 4, y: 64 * CS + 4, radiusCells: FOG.soldierSightCells };

describe("fog of war", () => {
  it("reveals farther ahead while keeping peripheral and rear vision", () => {
    const fog = new FogOfWar(openWorld());
    run(fog, 10, [{ ...eye, facingAngle: 0 }]);
    expect(fog.lightAt(eye.x + 19 * CS, eye.y)).toBeGreaterThan(0.9);
    expect(fog.lightAt(eye.x - 19 * CS, eye.y)).toBe(0);
    expect(fog.lightAt(eye.x, eye.y + 19 * CS)).toBe(0);
    expect(fog.lightAt(eye.x - 8 * CS, eye.y)).toBeGreaterThan(0.9);
    expect(fog.lightAt(eye.x, eye.y + 8 * CS)).toBeGreaterThan(0.9);
  });

  it("clears fog faster ahead, and follows a turn toward unexplored space", () => {
    const fog = new FogOfWar(openWorld());
    const normal = new FogOfWar(openWorld());
    const source = { ...eye, facingAngle: 0 };
    run(fog, 1, [source]);
    run(normal, 1, [eye]);
    expect(fog.lightAt(eye.x + 8 * CS, eye.y)).toBeGreaterThan(
      normal.lightAt(eye.x + 8 * CS, eye.y) + 0.1,
    );
    source.facingAngle = Math.PI;
    run(fog, 10, [source]);
    expect(fog.lightAt(eye.x - 19 * CS, eye.y)).toBeGreaterThan(0.9);
  });

  it("stops forward vision at full blocks and half-size blocks", () => {
    for (const halfSize of [false, true]) {
      const world = openWorld((cx) => !halfSize && cx === 68);
      const fog = new FogOfWar({ ...world,
        ...(halfSize ? { subSolidAt: (sx: number) => sx === 136 } : {}),
      });
      run(fog, 10, [{ ...eye, facingAngle: 0 }]);
      expect(fog.lightAt(eye.x + 2 * CS, eye.y)).toBeGreaterThan(0.9);
      expect(fog.lightAt(eye.x + 19 * CS, eye.y)).toBe(0);
    }
  });

  it("combines opposing soldiers' sight without depending on source order", () => {
    const sources = [{ ...eye, facingAngle: 0 }, { ...eye, facingAngle: Math.PI }];
    const a = new FogOfWar(openWorld());
    const b = new FogOfWar(openWorld());
    run(a, 3, sources);
    run(b, 3, [...sources].reverse());
    expect(a.light).toEqual(b.light);
  });

  it("starts black everywhere", () => {
    const fog = new FogOfWar(openWorld());
    expect(fog.lightAt(eye.x, eye.y)).toBe(0);
    expect(fogAlpha(0)).toBe(255);
    expect(fogAlpha(1)).toBe(0);
  });

  it("light creeps outward instead of snapping to the sight radius", () => {
    const fog = new FogOfWar(openWorld());
    run(fog, 0.3, [eye]);
    const near = fog.lightAt(eye.x, eye.y);
    const far = fog.lightAt(eye.x + 10 * CS, eye.y);
    expect(near).toBeGreaterThan(0.9);
    expect(far).toBeLessThan(0.05);
    run(fog, 4, [eye]);
    expect(fog.lightAt(eye.x + 10 * CS, eye.y)).toBeGreaterThan(0.9);
    // Beyond sight stays dark.
    expect(fog.lightAt(eye.x + 20 * CS, eye.y)).toBe(0);
  });

  it("walls block sight", () => {
    // Solid wall column at cx = 68.
    const fog = new FogOfWar(openWorld((cx) => cx === 68));
    run(fog, 5, [eye]);
    expect(fog.lightAt(eye.x + 2 * CS, eye.y)).toBeGreaterThan(0.9);
    expect(fog.lightAt(eye.x + 9 * CS, eye.y)).toBe(0);
  });

  it("unseen areas stay fresh briefly, then darkness creeps back", () => {
    const fog = new FogOfWar(openWorld());
    run(fog, 5, [eye]);
    run(fog, FOG.staleDelay * 0.5, []);
    expect(fog.lightAt(eye.x, eye.y)).toBeGreaterThan(0.99);
    run(fog, 40, []);
    expect(fog.lightAt(eye.x, eye.y)).toBe(0);
    expect(fog.isExplored(eye.x, eye.y)).toBe(true);
  });

  it("darkness closes in from the edges first", () => {
    const fog = new FogOfWar(openWorld());
    run(fog, 5, [eye]);
    run(fog, FOG.staleDelay + 3, []);
    const centre = fog.lightAt(eye.x, eye.y);
    const edge = fog.lightAt(eye.x + 11 * CS, eye.y);
    expect(centre).toBeGreaterThan(edge);
  });

  it("permanent mapping keeps explored areas dimly visible", () => {
    const fog = new FogOfWar(openWorld());
    fog.permanent = true;
    run(fog, 5, [eye]);
    run(fog, 40, []);
    expect(fog.lightAt(eye.x, eye.y)).toBeCloseTo(FOG.mappedLevel, 5);
    // Never-seen areas are still black.
    expect(fog.lightAt(10 * CS, 10 * CS)).toBe(0);
  });

  it("reset returns to total darkness", () => {
    const fog = new FogOfWar(openWorld());
    run(fog, 3, [eye]);
    fog.reset(7);
    expect(fog.lightAt(eye.x, eye.y)).toBe(0);
    expect(fog.isExplored(eye.x, eye.y)).toBe(false);
  });

  it("Cartography Uplink turns permanent mapping on", () => {
    const def = UPGRADE_BY_ID.cartography_uplink;
    const s = baseSoldierStats();
    expect(s.permanentMapping).toBe(false);
    def.apply(s, 1);
    expect(s.permanentMapping).toBe(true);
  });

  it("Recon Optics widens soldier sight in the fog", () => {
    const def = UPGRADE_BY_ID.recon_optics;
    expect(def.parent).toBe("cartography_uplink");
    const s = baseSoldierStats();
    expect(s.sightCells).toBe(FOG.soldierSightCells);
    def.apply(s, 3);
    expect(s.sightCells).toBe(FOG.soldierSightCells + 3 * FOG.sightPerLevel);

    // A wider eye lights tiles a narrow one never reaches.
    const near = { x: 400, y: 400, radiusCells: FOG.soldierSightCells };
    const far = { ...near, radiusCells: s.sightCells };
    const probeX = near.x + (FOG.soldierSightCells + 4) * 8;
    const a = new FogOfWar(openWorld());
    const b = new FogOfWar(openWorld());
    run(a, 6, [near]);
    run(b, 6, [far]);
    expect(a.lightAt(probeX, near.y)).toBe(0);
    expect(b.lightAt(probeX, near.y)).toBeGreaterThan(0.5);
  });
});
