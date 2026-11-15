import { describe, expect, it } from "vitest";
import { SPECIAL_UPGRADE, SpecialUpgradeSystem, rayBox } from "../src/systems/SpecialUpgrades";
import type { PixelWorld } from "../src/world/PixelWorld";
import type { Soldier } from "../src/entities/Soldier";

const world = { cellSize: 8, upgradeSpots: [{ id: "z1:a", cx: 10, cy: 10, sector: 0 }, { id: "z1:b", cx: 40, cy: 10, sector: 0 }] } as unknown as PixelWorld;
const soldier = (x: number, y: number) => ({ x, y, vx: 0, vy: 0, radius: 3, alive: true }) as unknown as Soldier;

describe("special upgrade blocks", () => {
  it("are 3x3 cells and skip collected spots", () => {
    const sys = new SpecialUpgradeSystem(world, () => []);
    sys.reset(["z1:b"]);
    expect(sys.blocks).toHaveLength(1);
    const b = sys.blocks[0];
    expect(b.x1 - b.x0).toBe(24);
    expect(b.x0).toBe(9 * 8);
  });

  it("take bullet hits via raycast, then shatter into motes absorbed by the nearest soldier", () => {
    const near = soldier(84, 140);
    const far = soldier(84, 400);
    const absorbed: string[] = [];
    const sys = new SpecialUpgradeSystem(world, () => [far, near], { onAbsorbed: (id, s) => absorbed.push(`${id}:${s === near}`) });
    sys.reset([]);
    for (let i = 0; i < SPECIAL_UPGRADE.hits; i++) {
      const t = sys.raycast(84, 140, 0, -1, 200);
      expect(t).toBeCloseTo(140 - 96);
      expect(sys.applyHit(1, 84, 96)).toBe(true);
    }
    expect(sys.blocks[0].broken).toBe(true);
    expect(sys.raycast(84, 140, 0, -1, 200)).toBe(-1);
    expect(sys.motes.length).toBe(SPECIAL_UPGRADE.motes);
    for (let i = 0; i < 600 && sys.motes.length; i++) sys.update(1 / 60);
    expect(sys.motes.length).toBe(0);
    expect(absorbed).toEqual(["z1:a:true"]);
  });

  it("blasts count as hits and intact blocks push soldiers out", () => {
    const s = soldier(84, 84);
    const sys = new SpecialUpgradeSystem(world, () => [s]);
    sys.reset([]);
    sys.update(0.016);
    const b = sys.blocks[0];
    const inside = s.x > b.x0 - 3 && s.x < b.x1 + 3 && s.y > b.y0 - 3 && s.y < b.y1 + 3 && Math.min(Math.abs(s.x - b.x0), Math.abs(s.x - b.x1), Math.abs(s.y - b.y0), Math.abs(s.y - b.y1)) < 2.999;
    expect(inside).toBe(false);
    sys.explode(84, 120, 30);
    expect(b.hitsLeft).toBe(SPECIAL_UPGRADE.hits - 1);
  });

  it("rayBox misses parallel rays outside the box", () => {
    expect(rayBox(0, 0, 1, 0, 5, 5, 10, 10)).toBe(-1);
    expect(rayBox(0, 7, 1, 0, 5, 5, 10, 10)).toBe(5);
  });
});
