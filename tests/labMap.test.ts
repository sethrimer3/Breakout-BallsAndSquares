import { describe, expect, it } from "vitest";
import { tierHealth, WORLD } from "../src/config";
import { sanitizeSaveData } from "../src/progression/SaveManager";
import { DoorSystem } from "../src/world/DoorSystem";
import { LabProgress } from "../src/world/LabProgress";
import {
  LAB_BLUEPRINT,
  LAB_WORLDS,
  SECTOR_CHARS,
  ZONE2_BLUEPRINT,
  gateGeometry,
  labFrame,
  parseBlueprint,
  sectorAtCell,
  sectorName,
  sectorSpawnCell,
  sectorTier,
  sectorZone,
  upgradeSpotSector,
  worldBlueprint,
} from "../src/world/labMap";
import { MAT, PixelWorld, SUB, type Door } from "../src/world/PixelWorld";
import { generateWorld } from "../src/world/WorldGenerator";

const Z1 = LAB_WORLDS[1];
const Z2 = LAB_WORLDS[2];
const Z3 = LAB_WORLDS[3];

/** Every room center reachable from the start room through cells that are not walls. */
function expectAllRoomsReachable(w: PixelWorld): void {
  const W = w.width;
  const open = new Uint8Array(w.width * w.height);
  for (let i = 0; i < open.length; i++) open[i] = w.wall[i] === 0 ? 1 : 0;
  const seen = new Uint8Array(open.length);
  const start = ((w.roomY0 + w.roomY1) >> 1) * W + ((w.roomX0 + w.roomX1) >> 1);
  const q = [start];
  seen[start] = 1;
  while (q.length) {
    const i = q.pop()!;
    for (const j of [i + 1, i - 1, i + W, i - W]) if (open[j] && !seen[j]) (seen[j] = 1), q.push(j);
  }
  for (const r of w.labLayout!.rooms) {
    // Freeform rooms may bulge over their middle; any open cell of the square counts.
    let reached = false;
    for (let y = r.y; y < r.y + r.size && !reached; y++) for (let x = r.x; x < r.x + r.size; x++) if (seen[y * W + x]) reached = true;
    expect(reached, `room ${r.id} at ${r.x},${r.y}`).toBe(true);
  }
}

describe("hand-made lab", () => {
  it("has square, valid blueprints whose rooms stay inside one sector", () => {
    for (const def of [Z1, Z2, Z3]) {
      expect(def.blueprint.length).toBe(def.sectors * SECTOR_CHARS);
      const bp = worldBlueprint(def);
      for (const r of bp.rooms) {
        expect(Math.floor(r.col / SECTOR_CHARS)).toBe(Math.floor((r.col + r.span - 1) / SECTOR_CHARS));
        expect(Math.floor(r.row / SECTOR_CHARS)).toBe(Math.floor((r.row + r.span - 1) / SECTOR_CHARS));
      }
    }
    expect(parseBlueprint().rooms.length).toBeGreaterThan(80);
    expect(Z2.sectors).toBe(11);
    expect(Z3.sectors).toBe(13);
  });

  it("rejects a non-square room in zone 1 but takes odd shapes in zone 2", () => {
    const lines = Array.from({ length: 7 }, () => ".......");
    lines[1] = ".RRR...";
    lines[2] = ".RRR...";
    expect(() => parseBlueprint(lines)).toThrow();
    const odd = Array.from({ length: 7 }, () => ".......");
    odd[1] = ".GG....";
    odd[2] = ".GGGG..";
    odd[3] = "..GGG..";
    const bp = parseBlueprint(odd, true);
    expect(bp.rooms.length).toBeGreaterThan(1);
    expect(new Set(bp.rooms.map((r) => r.group)).size).toBe(1);
    expect(bp.rooms.filter((r) => r.kind === "overrun").length).toBe(1);
    // A one-character-thin arm is a typo.
    odd[4] = "...G...";
    expect(() => parseBlueprint(odd, true)).toThrow();
    // Zone 2 really has odd rooms.
    expect(worldBlueprint(Z2).rooms.some((r) => r.kind === "blighted")).toBe(true);
    expect(ZONE2_BLUEPRINT.length).toBe(77);
  });

  it("starts zone 1 in the top-left corner and raises tiers with distance from it", () => {
    expect(Z1.start).toBe(0);
    expect(sectorName(0)).toBe("A1");
    expect(sectorName(40)).toBe("E5");
    expect(sectorTier(Z1, 0)).toBe(1);
    expect(sectorTier(Z1, 2 * 9 + 2)).toBe(1);
    expect(sectorTier(Z1, 40)).toBe(2);
    expect(sectorTier(Z1, 80)).toBe(3);
    expect(sectorTier(Z1, 4 * 9 + 8)).toBe(3);
    // Zone 2 starts at the middle of its west side, tiers 4-6.
    expect(sectorName(Z2.start, 11)).toBe("A6");
    expect(sectorTier(Z2, Z2.start)).toBe(4);
    expect(sectorTier(Z2, 5 * 11 + 5)).toBe(5);
    expect(sectorTier(Z2, 5 * 11 + 10)).toBe(6);
    expect(sectorName(Z3.start, 13)).toBe("A7");
  });

  it("builds the same lab every run, reachable from the start, with crystal veins that vary", () => {
    const a = new PixelWorld(WORLD);
    generateWorld(a, 1);
    const b = new PixelWorld(WORLD);
    generateWorld(b, 2);
    expect(a.labLayout!.frame).toBeTruthy();
    expect(a.labLayout!.rooms.map((r) => `${r.x},${r.y},${r.size}`)).toEqual(b.labLayout!.rooms.map((r) => `${r.x},${r.y},${r.size}`));
    const veins = (w: PixelWorld): number[] => [...w.mat.keys()].filter((i) => w.mat[i] === MAT.crystal);
    expect(veins(a).length).toBeGreaterThan(50);
    expect(veins(a)).not.toEqual(veins(b));
    const frame = a.labLayout!.frame!;
    for (const i of veins(a)) {
      const s = sectorAtCell(frame, i % a.width, Math.floor(i / a.width));
      expect(sectorZone(Z1, s)).toBeGreaterThan(0);
    }
    // The squad lands in A1, where blocks are tier 1.
    expect(sectorAtCell(frame, a.roomX0 + 5, a.roomY0 + 5)).toBe(0);
    expect(a.blockHealthAt(a.roomX0 - 3, a.roomY0)).toBeLessThanOrEqual(5);
    expectAllRoomsReachable(a);
  });

  it("builds zone 2 deterministically with tiers 4-6, Blight-crusted walls and every room reachable", () => {
    const a = new PixelWorld(WORLD);
    generateWorld(a, 5, { labWorld: Z2 });
    const b = new PixelWorld(WORLD);
    generateWorld(b, 6, { labWorld: Z2 });
    expect(a.labLayout!.rooms.map((r) => `${r.x},${r.y},${r.size}`)).toEqual(b.labLayout!.rooms.map((r) => `${r.x},${r.y},${r.size}`));
    expect([...a.wall]).toEqual([...b.wall]);
    const frame = a.labLayout!.frame!;
    expect(frame.def).toBe(Z2);
    expect(sectorAtCell(frame, a.roomX0 + 5, a.roomY0 + 5)).toBe(Z2.start);
    expect(a.tierBase).toBe(3);
    // Ordinary blocks are tier 4 near the gateway and tier 6 at the far side.
    const near = sectorSpawnCell(frame, Z2.start);
    expect(a.fillTierAt(near.cx, near.cy)).toBe(4);
    expect(a.blockHealthAt(near.cx, near.cy)).toBeGreaterThanOrEqual(tierHealth(4, 0));
    const far = sectorSpawnCell(frame, 5 * 11 + 10);
    expect(a.fillTierAt(far.cx, far.cy)).toBe(6);
    expect(a.maxHealthAt(far.cx, far.cy)).toBeLessThanOrEqual(65535);
    // Lots of Blight crust and no lab machines.
    let crust = 0;
    let machines = 0;
    for (let i = 0; i < a.subHealth.length; i++) {
      if (a.subHealth[i] === 0) continue;
      if (a.subKind[i] === SUB.blight) crust++;
      else if (a.subKind[i] >= SUB.metal) machines++;
    }
    expect(crust).toBeGreaterThan(20000);
    expect(machines).toBe(0);
    expect(a.blightCores.length).toBeGreaterThan(20);
    expectAllRoomsReachable(a);
  });

  it("builds an empty zone 3 with just its arrival room", () => {
    const w = new PixelWorld(WORLD);
    generateWorld(w, 7, { labWorld: Z3 });
    expect(w.labLayout!.frame!.def).toBe(Z3);
    expect(w.labLayout!.rooms.length).toBe(1);
    expect(w.blightCores.length).toBe(0);
    expect(sectorAtCell(w.labLayout!.frame!, w.roomX0 + 5, w.roomY0 + 5)).toBe(Z3.start);
  });

  it("puts a locked tier 3 gate in the middle of zone 1's east side that only the keycard opens", () => {
    const w = new PixelWorld(WORLD);
    generateWorld(w, 9);
    const frame = w.labLayout!.frame!;
    const gate = w.doors.find((d) => d.gate)!;
    expect(gate).toBeDefined();
    expect(gate.tier).toBe(3);
    expect(gate.gate!.to).toBe(2);
    const g = gateGeometry(frame, Z1.gates[0]);
    expect(g.door.x0).toBe(frame.x0 + 9 * 49);
    // Middle of sector row 5.
    expect(sectorAtCell(frame, g.door.x0 - 1, (g.door.y0 + g.door.y1) >> 1)).toBe(4 * 9 + 8);
    // Huge: taller than a hallway and several cells thick.
    expect(g.door.y1 - g.door.y0 + 1).toBeGreaterThanOrEqual(11);
    expect(g.door.x1 - g.door.x0 + 1).toBeGreaterThanOrEqual(3);

    const locked: Door[] = [];
    const doors = new DoorSystem(w, { onGateLocked: (d) => locked.push(d) });
    const i = gate.cells[0];
    const cx = i % w.width;
    const cy = (i - cx) / w.width;
    const hp = w.health[i];
    w.keycardTier = 2;
    for (let k = 0; k < 20; k++) w.damage(cx, cy, 1e6, true);
    expect(w.health[i]).toBe(hp);
    expect(gate.open).toBe(false);
    expect(locked.length).toBe(20);
    w.keycardTier = 3;
    w.damage(cx, cy, 1, true);
    expect(gate.open).toBe(true);
    doors.update(5);
    expect(gate.cells.every((c) => w.health[c] === 0)).toBe(true);
    // The way from the lab to the passage beyond is open.
    for (let x = g.door.x0 - 3; x <= g.pocket.x1; x++) expect(w.solidAt(x, (g.door.y0 + g.door.y1) >> 1), `x ${x}`).toBe(false);
  });

  it("marks special-upgrade spots inside rooms", () => {
    for (const def of [Z1, Z2]) {
      const w = new PixelWorld(WORLD);
      generateWorld(w, 3, { labWorld: def });
      expect(w.upgradeSpots.length).toBe(def.upgrades.length);
      for (const spot of def.upgrades) expect("RGT").toContain(def.blueprint[spot.row][spot.col]);
      for (const s of w.upgradeSpots) expect(s.sector).toBe(upgradeSpotSector(def, def.upgrades.find((u) => u.id === s.id)!));
      // Spread out: not all in the first tier band.
      expect(new Set(w.upgradeSpots.map((s) => sectorZone(def, s.sector))).size).toBeGreaterThan(1);
    }
  });

  it("clears conquered sectors and spawns in the chosen one", () => {
    const w = new PixelWorld(WORLD);
    const frame = labFrame(w)!;
    generateWorld(w, 3);
    const target = w.blightCores.map((c) => sectorAtCell(frame, c.cx, c.cy)).find((s) => s > 0)!;
    generateWorld(w, 3, { conquered: new Set([0, target]), spawn: target });
    for (const c of w.blightCores) if (sectorAtCell(frame, c.cx, c.cy) === target) expect(c.alive).toBe(false);
    expect(sectorAtCell(frame, w.roomX0 + 5, w.roomY0 + 5)).toBe(target);
    expect(w.solidAt(w.roomX0 + 5, w.roomY0 + 5)).toBe(false);
  });

  it("discovers sectors soldiers enter and conquers them once their generators die", () => {
    const w = new PixelWorld(WORLD);
    generateWorld(w, 4);
    const p = new LabProgress();
    p.attach(w);
    expect(p.conquered.has(0)).toBe(true);
    const frame = w.labLayout!.frame!;
    const core = w.blightCores.find((c) => sectorAtCell(frame, c.cx, c.cy) > 0)!;
    const s = sectorAtCell(frame, core.cx, core.cy);
    expect(p.update([{ cx: core.cx, cy: core.cy }])).toBe(true);
    expect(p.discovered.has(s)).toBe(true);
    expect(p.conquered.has(s)).toBe(false);
    for (const c of w.blightCores) if (sectorAtCell(frame, c.cx, c.cy) === s) c.alive = false;
    p.update([]);
    expect(p.conquered.has(s)).toBe(true);
  });

  it("keeps lab progress valid in saves, and carries old zone 1 progress over", () => {
    const d = sanitizeSaveData({ lab: { discovered: [3, 3, 99, -1, "x"], conquered: [3, 5], spawn: 5 } });
    expect(d.lab.worlds[1].discovered).toEqual([0, 3]);
    expect(d.lab.worlds[1].conquered).toEqual([0, 3]);
    expect(d.lab.worlds[1].spawn).toBe(0);
    expect(d.lab.world).toBe(1);
    expect(d.lab.unlocked).toBe(1);
    const fresh = sanitizeSaveData({});
    expect(fresh.lab.worlds[1].conquered).toEqual([0]);
    expect(fresh.lab.worlds[2].conquered).toEqual([Z2.start]);
    const z2 = sanitizeSaveData({ lab: { world: 2, unlocked: 2, worlds: { 2: { discovered: [55, 56, 500], conquered: [56], spawn: 56 } } } });
    expect(z2.lab.world).toBe(2);
    expect(z2.lab.worlds[2].discovered).toEqual([55, 56]);
    expect(z2.lab.worlds[2].spawn).toBe(56);
    // Can't deploy into a world not yet reached.
    expect(sanitizeSaveData({ lab: { world: 3, unlocked: 2 } }).lab.world).toBe(2);
    expect(LAB_BLUEPRINT[31][62]).toBe("-");
  });
});
