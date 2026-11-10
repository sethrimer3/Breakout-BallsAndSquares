import { describe, expect, it } from "vitest";
import { ConnectedAir } from "../src/world/ConnectedAir";
import { FogOfWar, type SightSource } from "../src/world/FogOfWar";
import { baseSoldierStats } from "../src/entities/Soldier";
import { UPGRADE_BY_ID } from "../src/progression/UpgradeDefinitions";

const cs = 8;
const source: SightSource = { x: 4.5 * cs, y: 4.5 * cs, radiusCells: 2, airSeed: true };
function advance(fog: FogOfWar, seconds: number, sources: SightSource[] = [source]) {
  for (let t = 0; t < seconds; t += 1 / 60) fog.update(1 / 60, sources);
}

describe("connected-air fog mapping", () => {
  it("smoothly reveals connected air around corners beyond normal sight", () => {
    const world = { width: 24, height: 20, cellSize: cs,
      solidAt: (x: number, y: number) => !(y === 4 && x >= 4 && x <= 12 || x === 12 && y >= 4 && y <= 10) };
    const fog = new FogOfWar(world, 1); fog.connectedAir = true;
    advance(fog, 0.1);
    expect(fog.lightAt(12.5 * cs, 10.5 * cs)).toBe(0);
    advance(fog, 20);
    expect(fog.lightAt(12.5 * cs, 10.5 * cs)).toBeGreaterThan(0.9);
    const normal = new FogOfWar(world, 1); advance(normal, 20);
    expect(normal.lightAt(12.5 * cs, 10.5 * cs)).toBe(0);
  });

  it("waits for a door or wall to open and recomputes when it closes", () => {
    let closed = true;
    const world = { width: 24, height: 12, cellSize: cs,
      solidAt: (x: number, y: number) => y !== 4 || x < 4 || x > 18 || closed && x === 10 };
    const air = new ConnectedAir(world, 1);
    const fog = new FogOfWar(world, 1); fog.connectedAir = true;
    advance(fog, 20);
    expect(fog.lightAt(16.5 * cs, 4.5 * cs)).toBe(0);
    expect(air.update(1, [source])).not.toContain(4 * 24 + 16);
    closed = false;
    expect(air.update(0.2, [source])).toContain(4 * 24 + 16);
    advance(fog, 20);
    expect(fog.lightAt(16.5 * cs, 4.5 * cs)).toBeGreaterThan(0.9);
    closed = true;
    expect(air.update(0.2, [source])).not.toContain(4 * 24 + 16);
    advance(fog, 40);
    expect(fog.lightAt(16.5 * cs, 4.5 * cs)).toBe(0);
    expect(air.update(1, [{ ...source, airSeed: false }])).toHaveLength(0);
  });

  it("respects half-size barriers, diagonal pinches, and newly broken openings", () => {
    const open = new Set(["8,8", "9,8", "10,8", "12,8", "13,8", "14,8", "15,8", "16,8", "17,8", "18,9"]);
    const world = { width: 12, height: 8, cellSize: cs, solidAt: () => false,
      subSolidAt: (x: number, y: number) => !open.has(`${x},${y}`) };
    const air = new ConnectedAir(world, 1);
    const eye = { ...source, x: 4.25 * cs, y: 4.25 * cs };
    expect(air.update(1, [eye])).not.toContain(4 * 12 + 7);
    open.add("11,8");
    const connected = air.update(0.2, [eye]);
    expect(connected).toContain(4 * 12 + 7);
    // (18,9) touches (17,8) only diagonally, so its normal cell stays hidden.
    expect(connected).not.toContain(4 * 12 + 8 + 1);
  });

  it("is a Core milestone after the map and persists in computed stats", () => {
    const def = UPGRADE_BY_ID.connected_air_mapping;
    expect(def.branch).toBe("core"); expect(def.parent).toBe("unlock_map");
    const stats = baseSoldierStats(); expect(stats.connectedAirMapping).toBe(false);
    def.apply(stats, 1); expect(stats.connectedAirMapping).toBe(true);
  });
});
