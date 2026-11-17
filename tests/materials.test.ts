import { describe, expect, it } from "vitest";
import { CRACK_PATTERNS, MATERIAL_BASE, TIER_PAINT, crackTexelAt, lateMaterial, materialShade } from "../src/rendering/materials";

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

describe("pixel-art cracked block overlay", () => {
  it("provides multiple distinct crack pattern variants", () => {
    expect(CRACK_PATTERNS.length).toBeGreaterThanOrEqual(4);
    // Ensure all variants have 3 progressive damage stages
    for (const variant of CRACK_PATTERNS) {
      expect(variant.length).toBe(3);
      const [stage1, stage2, stage3] = variant;
      expect(stage1.length).toBeLessThan(stage2.length);
      expect(stage2.length).toBeLessThan(stage3.length);
    }
  });

  it("shows no cracks on pristine or lightly grazed blocks (< 25% damage)", () => {
    for (let ox = 0; ox < 4; ox++) {
      for (let oy = 0; oy < 4; oy++) {
        expect(crackTexelAt(5, 5, ox, oy, 0)).toBe(0);
        expect(crackTexelAt(5, 5, ox, oy, 0.24)).toBe(0);
      }
    }
  });

  it("progressively increases cracks as damage increases", () => {
    let cracksStage1 = 0;
    let cracksStage2 = 0;
    let cracksStage3 = 0;

    for (let ox = 0; ox < 4; ox++) {
      for (let oy = 0; oy < 4; oy++) {
        if (crackTexelAt(10, 10, ox, oy, 0.35) > 0) cracksStage1++;
        if (crackTexelAt(10, 10, ox, oy, 0.6) > 0) cracksStage2++;
        if (crackTexelAt(10, 10, ox, oy, 0.85) > 0) cracksStage3++;
      }
    }

    expect(cracksStage1).toBeGreaterThan(0);
    expect(cracksStage2).toBeGreaterThan(cracksStage1);
    expect(cracksStage3).toBeGreaterThan(cracksStage2);
  });

  it("returns distinct colors per late environment and tier, and blends forest tiers smoothly", () => {
    const avg = (env: "forest" | "city" | "mothership", tier: number, feature: "solid" | "floor" | "cover" | "bulkhead" = "solid") => {
      let r = 0, g = 0, b = 0;
      const out: [number, number, number] = [0, 0, 0];
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          lateMaterial(env, tier, x + 20, y + 20, feature, out);
          r += out[0]; g += out[1]; b += out[2];
        }
      }
      return [Math.round(r / 64), Math.round(g / 64), Math.round(b / 64)].join(",");
    };

    const samples = new Set([
      avg("forest", 7),
      avg("forest", 8),
      avg("forest", 9),
      avg("city", 10),
      avg("mothership", 11),
      avg("forest", 7, "floor"),
      avg("city", 10, "floor"),
      avg("mothership", 11, "floor"),
    ]);
    expect(samples.size).toBe(8);

    const a: [number, number, number] = [0, 0, 0];
    const b: [number, number, number] = [0, 0, 0];
    const mid: [number, number, number] = [0, 0, 0];
    lateMaterial("forest", 7, 10, 10, "solid", a);
    lateMaterial("forest", 8, 10, 10, "solid", b);
    lateMaterial("forest", 7.5, 10, 10, "solid", mid);
    expect(mid[0]).toBeCloseTo((a[0] + b[0]) / 2, 1);
    expect(mid[1]).toBeCloseTo((a[1] + b[1]) / 2, 1);
  });
});
