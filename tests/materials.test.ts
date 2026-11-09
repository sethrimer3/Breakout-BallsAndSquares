import { describe, expect, it } from "vitest";
import { MATERIAL_BASE, TIER_PAINT, materialShade } from "../src/rendering/materials";

describe("matte tier materials", () => {
  it("gives every tier its own base color and paint", () => {
    const keys = new Set(MATERIAL_BASE.slice(1).map((c) => c.join(",")));
    expect(keys.size).toBe(7);
    expect(new Set(TIER_PAINT.slice(1).map((c) => c.join(","))).size).toBe(7);
  });

  it("textures each tier with a different pattern", () => {
    const sig = (tier: number) => {
      const out: number[] = [];
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) out.push(Math.round(materialShade(tier, x, y) * 4));
      return out.join("");
    };
    const sigs = [1, 2, 3, 4, 5, 6, 7].map(sig);
    expect(new Set(sigs).size).toBe(7);
  });

  it("stays in a matte range (no emissive brightness)", () => {
    for (let tier = 1; tier <= 4; tier++) {
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) {
          const s = materialShade(tier, x, y);
          expect(s).toBeGreaterThan(0.3);
          expect(s).toBeLessThan(1.6);
        }
      }
    }
  });
});

describe("inside-corner paint", () => {
  it("joins the two wall stripes at an inside corner", async () => {
    // TerrainRenderer imports DOM-only helpers lazily; the band helper is pure.
    const { innerCornerBand } = await import("../src/rendering/TerrainRenderer");
    const painted = (ul: boolean, ur: boolean, dl: boolean, dr: boolean) => {
      const out: string[] = [];
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if (innerCornerBand(x, y, ul, ur, dl, dr, 1)) out.push(`${x},${y}`);
      return out.sort().join(" ");
    };
    expect(painted(true, false, false, false)).toBe("0,1 1,0 1,1");
    expect(painted(false, false, false, true)).toBe("2,2 2,3 3,2");
    expect(innerCornerBand(0, 0, true, false, false, false, 0)).toBe(true);
    expect(innerCornerBand(1, 1, true, false, false, false, 0)).toBe(false);
  });
});
