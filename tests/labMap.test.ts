import { describe, expect, it } from "vitest";
import { WORLD } from "../src/config";
import { LAB_START_SECTOR, sanitizeSaveData } from "../src/progression/SaveManager";
import { LabProgress } from "../src/world/LabProgress";
import {
  CENTER_SECTOR,
  LAB_BLUEPRINT,
  SECTORS_PER_SIDE,
  SECTOR_CHARS,
  labFrame,
  parseBlueprint,
  sectorAtCell,
  sectorName,
  sectorRing,
  sectorSpawnCell,
  zoneForSectorRing,
} from "../src/world/labMap";
import { MAT, PixelWorld } from "../src/world/PixelWorld";
import { generateWorld } from "../src/world/WorldGenerator";

describe("hand-made lab", () => {
  it("has a square, valid blueprint whose rooms stay inside one sector", () => {
    expect(LAB_BLUEPRINT.length).toBe(SECTORS_PER_SIDE * SECTOR_CHARS);
    const bp = parseBlueprint();
    expect(bp.rooms.length).toBeGreaterThan(80);
    for (const r of bp.rooms) {
      expect(Math.floor(r.col / SECTOR_CHARS)).toBe(Math.floor((r.col + r.span - 1) / SECTOR_CHARS));
      expect(Math.floor(r.row / SECTOR_CHARS)).toBe(Math.floor((r.row + r.span - 1) / SECTOR_CHARS));
    }
  });

  it("rejects a non-square room", () => {
    const lines = Array.from({ length: 7 }, () => ".......");
    lines[1] = ".RRR...";
    lines[2] = ".RRR...";
    expect(() => parseBlueprint(lines)).toThrow();
  });

  it("names sectors and raises tiers outward", () => {
    expect(CENTER_SECTOR).toBe(LAB_START_SECTOR);
    expect(sectorName(CENTER_SECTOR)).toBe("E5");
    expect(sectorName(0)).toBe("A1");
    expect(zoneForSectorRing(sectorRing(CENTER_SECTOR))).toBe(0);
    expect(zoneForSectorRing(sectorRing(CENTER_SECTOR + 1))).toBe(0);
    expect(zoneForSectorRing(sectorRing(CENTER_SECTOR + 2))).toBe(1);
    expect(zoneForSectorRing(sectorRing(0))).toBe(2);
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
    // Veins only in tier 2 / tier 3 sectors.
    const frame = a.labLayout!.frame!;
    for (const i of veins(a)) {
      const s = sectorAtCell(frame, i % a.width, Math.floor(i / a.width));
      expect(zoneForSectorRing(sectorRing(s))).toBeGreaterThan(0);
    }
    // Every room is reachable from the start room through open cells, walls aside.
    const W = a.width;
    const open = new Uint8Array(a.width * a.height);
    for (let i = 0; i < open.length; i++) open[i] = a.wall[i] === 0 ? 1 : 0;
    const seen = new Uint8Array(open.length);
    const start = a.centerY * W + a.centerX;
    const q = [start];
    seen[start] = 1;
    while (q.length) {
      const i = q.pop()!;
      for (const j of [i + 1, i - 1, i + W, i - W]) if (open[j] && !seen[j]) (seen[j] = 1), q.push(j);
    }
    for (const r of a.labLayout!.rooms) {
      const c = (r.y + (r.size >> 1)) * W + r.x + (r.size >> 1);
      expect(seen[c], `room ${r.id}`).toBe(1);
    }
  });

  it("clears conquered sectors and spawns in the chosen one", () => {
    const w = new PixelWorld(WORLD);
    const frame = labFrame(w)!;
    generateWorld(w, 3);
    const target = w.blightCores.map((c) => sectorAtCell(frame, c.cx, c.cy)).find((s) => s >= 0)!;
    const at = sectorSpawnCell(frame, target);
    w.setStartRoom(at.cx, at.cy);
    generateWorld(w, 3, { conquered: new Set([CENTER_SECTOR, target]) });
    for (const c of w.blightCores) if (sectorAtCell(frame, c.cx, c.cy) === target) expect(c.alive).toBe(false);
    expect(sectorAtCell(frame, w.roomX0 + 5, w.roomY0 + 5)).toBe(target);
    expect(w.solidAt(w.roomX0 + 5, w.roomY0 + 5)).toBe(false);
  });

  it("discovers sectors soldiers enter and conquers them once their generators die", () => {
    const w = new PixelWorld(WORLD);
    generateWorld(w, 4);
    const p = new LabProgress();
    p.attach(w);
    const frame = w.labLayout!.frame!;
    const core = w.blightCores[0];
    const s = sectorAtCell(frame, core.cx, core.cy);
    expect(p.update([{ cx: core.cx, cy: core.cy }])).toBe(true);
    expect(p.discovered.has(s)).toBe(true);
    expect(p.conquered.has(s)).toBe(false);
    for (const c of w.blightCores) if (sectorAtCell(frame, c.cx, c.cy) === s) c.alive = false;
    p.update([]);
    expect(p.conquered.has(s)).toBe(true);
  });

  it("keeps lab progress valid in saves", () => {
    const d = sanitizeSaveData({ lab: { discovered: [3, 3, 99, -1, "x"], conquered: [3, 5], spawn: 5 } });
    expect(d.lab.discovered).toEqual([3, LAB_START_SECTOR]);
    expect(d.lab.conquered).toEqual([3, LAB_START_SECTOR]);
    expect(d.lab.spawn).toBe(LAB_START_SECTOR);
    expect(sanitizeSaveData({}).lab.conquered).toEqual([LAB_START_SECTOR]);
  });
});
