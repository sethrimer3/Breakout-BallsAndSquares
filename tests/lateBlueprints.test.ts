import { describe, expect, it } from "vitest";
import { WORLD } from "../src/config";
import { PixelWorld } from "../src/world/PixelWorld";
import { generateWorld } from "../src/world/WorldGenerator";
import {
  CHAR_CELLS,
  LAB_WORLDS,
  SECTOR_CHARS,
  parseLateMarkers,
  sectorCount,
  sectorTier,
  worldBlueprint,
  worldRows,
} from "../src/world/labMap";
import { LateEncounters } from "../src/systems/LateEncounters";
import { CAMPAIGN, campaignTier } from "../src/world/campaignBalance";
import { LootKind } from "../src/entities/LootSystem";

function floodReachable(world: PixelWorld, removeBulkheads = false): Uint8Array {
  const visited = new Uint8Array(world.width * world.height);
  const queue = new Int32Array(visited.length);
  let head = 0;
  let tail = 0;
  const f = world.labLayout!.frame!;
  const lines = f.def.blueprint;
  const bulkheadCells = new Uint8Array(visited.length);

  if (removeBulkheads) {
    const mid = (CHAR_CELLS - 1) >> 1;
    const depth = f.def.id === 5 ? 5 : 3;
    const half = (depth - 1) >> 1;
    for (let r = 0; r < lines.length; r++) {
      for (let c = 0; c < lines[r].length; c++) {
        if (lines[r][c] !== "=") continue;
        const cx = f.x0 + c * CHAR_CELLS + mid;
        const cy = f.y0 + r * CHAR_CELLS + mid;
        for (let y = cy - mid; y <= cy + mid; y++) {
          for (let x = cx - mid; x <= cx + mid; x++) {
            if (world.inBounds(x, y)) bulkheadCells[y * world.width + x] = 1;
          }
        }
        void half;
      }
    }
  }

  const gateSet = new Uint8Array(visited.length);
  for (const d of world.doors) for (const idx of d.cells) gateSet[idx] = 1;

  const enter = (x: number, y: number): void => {
    if (!world.inBounds(x, y)) return;
    const idx = y * world.width + x;
    if (visited[idx]) return;
    if (world.solidAt(x, y) && !gateSet[idx] && !bulkheadCells[idx]) return;
    visited[idx] = 1;
    queue[tail++] = idx;
  };

  enter(Math.floor(world.roomCenterX / world.cellSize), Math.floor(world.roomCenterY / world.cellSize));
  while (head < tail) {
    const i = queue[head++];
    const x = i % world.width;
    const y = Math.floor(i / world.width);
    enter(x - 1, y);
    enter(x + 1, y);
    enter(x, y - 1);
    enter(x, y + 1);
  }
  return visited;
}

describe("late world blueprints", () => {
  it.each([
    [3, 91, 91],
    [4, 49, 49],
    [5, 21, 49],
  ])("has exact dimensions and parses world %i with late rules", (id, cols, rows) => {
    const def = LAB_WORLDS[id];
    expect(def.blueprint).toHaveLength(rows);
    for (const line of def.blueprint) expect(line).toHaveLength(cols);
    const bp = worldBlueprint(def);
    expect(bp.rooms.length).toBeGreaterThanOrEqual(sectorCount(def));
    expect(worldRows(def) * SECTOR_CHARS).toBe(rows);
  });

  it.each([3, 4, 5])("makes every room in world %i reachable once bulkheads are removed", (id) => {
    const def = LAB_WORLDS[id];
    const world = new PixelWorld(WORLD);
    generateWorld(world, 8, { labWorld: def });
    const f = world.labLayout!.frame!;
    const visitedAll = floodReachable(world, true);

    for (const room of world.labLayout!.rooms) {
      const cx = room.x + (room.size >> 1);
      const cy = room.y + (room.size >> 1);
      // If the room center happens to be a '#' cover cell, check any open cell in the room
      let reached = !world.solidAt(cx, cy) && visitedAll[cy * world.width + cx] === 1;
      if (!reached) {
        outer: for (let y = room.y; y < room.y + room.size; y++) {
          for (let x = room.x; x < room.x + room.size; x++) {
            if (!world.solidAt(x, y) && visitedAll[y * world.width + x] === 1) {
              reached = true;
              break outer;
            }
          }
        }
      }
      expect(reached, `world ${id} room ${room.id} at sector ${room.sector}`).toBe(true);
    }

    // Verify markers also lie in reachable open cells once bulkheads are removed
    const markers = parseLateMarkers(def.blueprint);
    const mid = (CHAR_CELLS - 1) >> 1;
    for (const m of markers) {
      const cx = f.x0 + m.col * CHAR_CELLS + mid;
      const cy = f.y0 + m.row * CHAR_CELLS + mid;
      expect(visitedAll[cy * world.width + cx], `marker ${m.sector}:${m.kind}:${m.ordinal}`).toBe(1);
    }
  });

  it.each([
    [3, 4],
    [4, 3],
    [5, 2],
  ])("places %i special-upgrade gold blocks in open cells for world %i", (id, expectedCount) => {
    const def = LAB_WORLDS[id];
    const world = new PixelWorld(WORLD);
    generateWorld(world, 8, { labWorld: def });
    expect(world.upgradeSpots).toHaveLength(expectedCount);
    for (let i = 0; i < expectedCount; i++) {
      const spot = world.upgradeSpots[i];
      expect(spot.id).toBe(`z${id}-special-${i + 1}`);
      expect(world.solidAt(spot.cx, spot.cy)).toBe(false);
    }
  });

  it.each([3, 4, 5])("validates marker placement rules in world %i", (id) => {
    const def = LAB_WORLDS[id];
    const world = new PixelWorld(WORLD);
    generateWorld(world, 8, { labWorld: def });
    const f = world.labLayout!.frame!;
    const markers = parseLateMarkers(def.blueprint);
    const mid = (CHAR_CELLS - 1) >> 1;

    for (const m of markers) {
      const cx = f.x0 + m.col * CHAR_CELLS + mid;
      const cy = f.y0 + m.row * CHAR_CELLS + mid;
      expect(world.solidAt(cx, cy), `marker ${m.kind} at (${m.col},${m.row})`).toBe(false);
      if (m.sector === def.start) expect(m.kind).toBe("special");
      if (sectorTier(def, m.sector) === 7) {
        expect(["soldier", "brute", "turret", "trap", "boss"]).not.toContain(m.kind);
      }
      if (m.kind === "grove") expect(id).toBe(3);
    }

    if (id === 4) {
      const portals = markers.filter((m) => m.kind === "teleporter");
      expect(portals).toHaveLength(1);
      expect(portals[0].sector).toBe(24);
    }
    if (id === 5) {
      const bosses = markers.filter((m) => m.kind === "boss");
      expect(bosses).toHaveLength(1);
      expect(bosses[0].sector).toBe(4);
    }
  });

  it.each([3, 4, 5])("generates world %i deterministically", (id) => {
    const def = LAB_WORLDS[id];
    const w1 = new PixelWorld(WORLD);
    const w2 = new PixelWorld(WORLD);
    generateWorld(w1, 123, { labWorld: def });
    generateWorld(w2, 123, { labWorld: def });
    expect(w1.health).toEqual(w2.health);
    expect(w1.wall).toEqual(w2.wall);

    const e1 = new LateEncounters(w1, () => {}, () => {});
    const e2 = new LateEncounters(w2, () => {}, () => {});
    e1.reset();
    e2.reset();
    expect(e1.actors).toEqual(e2.actors);
  });

  it("keeps per-tier encounter totals within 20% of CAMPAIGN_PACING budgets", () => {
    const countsByTier = new Map<number, Record<string, number>>();
    const sectorCountsByTier = new Map<number, number>();

    for (const id of [3, 4, 5]) {
      const def = LAB_WORLDS[id];
      for (let s = 0; s < sectorCount(def); s++) {
        if (s === def.start) continue;
        const t = sectorTier(def, s);
        sectorCountsByTier.set(t, (sectorCountsByTier.get(t) ?? 0) + 1);
      }
      for (const m of parseLateMarkers(def.blueprint)) {
        if (m.kind === "teleporter" || m.kind === "special") continue;
        const t = sectorTier(def, m.sector);
        let rec = countsByTier.get(t);
        if (!rec) {
          rec = {};
          countsByTier.set(t, rec);
        }
        rec[m.kind] = (rec[m.kind] ?? 0) + 1;
      }
    }

    const checkWithin20Pct = (actual: number, expected: number, label: string) => {
      expect(actual, `${label} min`).toBeGreaterThanOrEqual(expected * 0.8);
      expect(actual, `${label} max`).toBeLessThanOrEqual(expected * 1.2);
    };

    // Tier 7: 6 groves per non-start sector
    checkWithin20Pct(countsByTier.get(7)?.grove ?? 0, (sectorCountsByTier.get(7) ?? 0) * CAMPAIGN[campaignTier(7)].nodes, "tier 7 groves");
    // Tier 8: 2 soldiers, 1 brute, 3 groves per sector
    const t8Sectors = sectorCountsByTier.get(8) ?? 0;
    checkWithin20Pct(countsByTier.get(8)?.soldier ?? 0, t8Sectors * 2, "tier 8 soldiers");
    checkWithin20Pct(countsByTier.get(8)?.brute ?? 0, t8Sectors * 1, "tier 8 brutes");
    checkWithin20Pct(countsByTier.get(8)?.grove ?? 0, t8Sectors * CAMPAIGN[campaignTier(8)].nodes, "tier 8 groves");
    // Tier 9: 2 soldiers, 1 brute, 2 groves per sector
    const t9Sectors = sectorCountsByTier.get(9) ?? 0;
    checkWithin20Pct(countsByTier.get(9)?.soldier ?? 0, t9Sectors * 2, "tier 9 soldiers");
    checkWithin20Pct(countsByTier.get(9)?.brute ?? 0, t9Sectors * 1, "tier 9 brutes");
    checkWithin20Pct(countsByTier.get(9)?.grove ?? 0, t9Sectors * CAMPAIGN[campaignTier(9)].nodes, "tier 9 groves");
    // Tier 10: 2 turrets, 1 trap, 1 soldier, 1 brute per non-start sector
    const t10Sectors = sectorCountsByTier.get(10) ?? 0;
    checkWithin20Pct(countsByTier.get(10)?.turret ?? 0, t10Sectors * 2, "tier 10 turrets");
    checkWithin20Pct(countsByTier.get(10)?.trap ?? 0, t10Sectors * 1, "tier 10 traps");
    checkWithin20Pct(countsByTier.get(10)?.soldier ?? 0, t10Sectors * 1, "tier 10 soldiers");
    checkWithin20Pct(countsByTier.get(10)?.brute ?? 0, t10Sectors * 1, "tier 10 brutes");
    // Tier 11: 2 turrets, 1 trap, 1 soldier, 1 brute per non-start, non-boss sector (plus 2 turrets in boss sector)
    const t11Sectors = (sectorCountsByTier.get(11) ?? 0) - 1;
    checkWithin20Pct(countsByTier.get(11)?.turret ?? 0, t11Sectors * 2 + 2, "tier 11 turrets");
    checkWithin20Pct(countsByTier.get(11)?.trap ?? 0, t11Sectors * 1, "tier 11 traps");
    checkWithin20Pct(countsByTier.get(11)?.soldier ?? 0, t11Sectors * 1, "tier 11 soldiers");
    checkWithin20Pct(countsByTier.get(11)?.brute ?? 0, t11Sectors * 1, "tier 11 brutes");
    void LootKind;
  });
});
