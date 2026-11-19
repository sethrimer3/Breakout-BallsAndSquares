import { describe, expect, it } from "vitest";
import { tierHealth, WORLD } from "../src/config";
import { Rng } from "../src/core/Rng";
import { GrowthSystem } from "../src/world/GrowthSystem";
import { GENERATOR, coreCellMaxHealth, coreLevel, generatorCellHealth, generatorColors } from "../src/world/GeneratorTiers";
import { LAB_WORLDS } from "../src/world/labMap";
import { PixelWorld, type BlightCore } from "../src/world/PixelWorld";
import { generateWorld } from "../src/world/WorldGenerator";

/** Two 2×2 generators in an empty world: a weak T1 at (10, 10) and a tough T3 at (20, 10). */
function setup(): { w: PixelWorld; g: GrowthSystem; weak: BlightCore; tough: BlightCore } {
  const w = new PixelWorld({ width: 40, height: 40, cellSize: 8, roomSize: 4 });
  const make = (id: number, cx: number, level: number): BlightCore => {
    const cells = [cx + 10 * 40, cx + 1 + 10 * 40, cx + 11 * 40, cx + 1 + 11 * 40];
    for (const i of cells) {
      w.coreId[i] = id;
      w.health[i] = generatorCellHealth(level);
    }
    return { id, roomId: id, zone: 0, cx, cy: 10, cells, alive: true, size: 2, level };
  };
  const weak = make(1, 10, 1);
  const tough = make(2, 20, 3);
  w.blightCores = [weak, tough];
  const g = new GrowthSystem(w, new Rng(3));
  g.reset();
  return { w, g, weak, tough };
}

describe("Blight generator tiers", () => {
  it("hold a fifth of their zone's block health", () => {
    expect(generatorCellHealth(3)).toBe(Math.round(tierHealth(3) / 5));
    expect(generatorCellHealth(6)).toBe(Math.round(tierHealth(6) / 5));
    expect(generatorCellHealth(1)).toBeGreaterThanOrEqual(1);
  });

  it("take their level and health from the zone in the hand-made labs", () => {
    for (const id of [1, 2]) {
      const w = new PixelWorld(WORLD);
      generateWorld(w, 5, { labWorld: LAB_WORLDS[id] });
      expect(w.blightCores.length).toBeGreaterThan(0);
      const levels = new Set<number>();
      for (const core of w.blightCores) {
        const lvl = coreLevel(w, core);
        expect(lvl).toBe(w.fillTierAt(core.cx, core.cy));
        levels.add(lvl);
        const cx = core.cells[0] % w.width, cy = Math.floor(core.cells[0] / w.width);
        expect(w.maxHealthAt(cx, cy)).toBe(generatorCellHealth(lvl));
        expect(w.health[core.cells[0]]).toBe(generatorCellHealth(lvl));
      }
      // Each world's generators come in more than one tier, each with its own rim colors.
      expect(levels.size).toBeGreaterThan(1);
      const rims = new Set([...levels].map((l) => generatorColors(l)[1]));
      expect(rims.size).toBe(levels.size);
    }
  });

  it("lets a tougher colony smoothly take over a weaker generator when their creep joins", () => {
    const { w, g, weak, tough } = setup();
    // Creep from each, not yet touching.
    for (let sx = 24; sx <= 30; sx++) w.setSubCell(sx, 20, 3, "grown");
    for (let sx = 32; sx <= 39; sx++) w.setSubCell(sx, 20, 3, "grown");
    g.updateCoreGenerators(0.1, 0, []);
    expect(weak.convertTo).toBeUndefined();

    // Damage the weak one to half first: it keeps that share through the takeover.
    for (const i of weak.cells) w.health[i] = Math.max(1, Math.round(generatorCellHealth(1) / 2));
    const share = w.health[weak.cells[0]] / generatorCellHealth(1);
    w.setSubCell(31, 20, 3, "grown"); // the creeps meet
    g.updateCoreGenerators(0.1, 0, []);
    expect(weak.convertTo).toBe(3);
    expect(tough.convertTo).toBeUndefined();

    // Health climbs gradually, never jumping straight to the top.
    const hp0 = w.health[weak.cells[0]];
    g.updateCoreGenerators(GENERATOR.convertSeconds * 0.3, 0, []);
    const hp1 = w.health[weak.cells[0]];
    expect(hp1).toBeGreaterThan(hp0);
    expect(hp1).toBeLessThan(generatorCellHealth(3) * share);

    for (let t = 0; t < GENERATOR.convertSeconds * 2; t += 0.1) g.updateCoreGenerators(0.1, 0, []);
    expect(weak.level).toBe(3);
    expect(weak.convertTo).toBeUndefined();
    expect(coreCellMaxHealth(w, weak)).toBe(coreCellMaxHealth(w, tough));
    expect(w.health[weak.cells[0]] / generatorCellHealth(3)).toBeCloseTo(share, 1);
  });
});
