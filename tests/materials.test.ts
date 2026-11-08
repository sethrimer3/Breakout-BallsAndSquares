import { describe, expect, it } from "vitest";
import { MATERIAL_BASE, TIER_PAINT, materialShade } from "../src/rendering/materials";

describe("matte tier materials", () => {
  it("gives every tier its own base color and paint", () => {
    const keys = new Set(MATERIAL_BASE.slice(1).map((c) => c.join(",")));
    expect(keys.size).toBe(4);
    expect(new Set(TIER_PAINT.slice(1).map((c) => c.join(","))).size).toBe(4);
  });

  it("textures each tier with a different pattern", () => {
    const sig = (tier: number) => {
      const out: number[] = [];
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) out.push(Math.round(materialShade(tier, x, y) * 4));
      return out.join("");
    };
    const sigs = [1, 2, 3, 4].map(sig);
    expect(new Set(sigs).size).toBe(4);
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
