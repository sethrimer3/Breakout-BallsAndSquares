import { describe, expect, it } from "vitest";
import { UPGRADE_DEFS } from "../src/progression/UpgradeDefinitions";
import { paletteColor, SPRITES, type SpriteName } from "../src/ui/pixelArt";

describe("pixel UI sprites", () => {
  it("every grid is rectangular and uses only palette characters", () => {
    for (const [name, grid] of Object.entries(SPRITES)) {
      expect(grid.length, name).toBeGreaterThan(0);
      for (const row of grid) {
        expect(row.length, name).toBe(grid[0].length);
        expect(row, name).toMatch(/^[.#+\-wk]+$/);
      }
    }
  });

  it("every upgrade has an existing, square 13x13 icon", () => {
    for (const def of UPGRADE_DEFS) {
      const grid = SPRITES[def.icon as SpriteName];
      expect(grid, def.id).toBeDefined();
      expect(grid.length, def.id).toBe(13);
      expect(grid[0].length, def.id).toBe(13);
    }
  });

  it("derives a light and a dark shade from the tint", () => {
    expect(paletteColor(".", "#102030")).toBeNull();
    expect(paletteColor("#", "#102030")).toBe("rgb(16,32,48)");
    expect(paletteColor("+", "#000000")).toBe("rgb(115,115,115)");
    expect(paletteColor("-", "#ffffff")).toBe("rgb(128,128,128)");
  });
});
