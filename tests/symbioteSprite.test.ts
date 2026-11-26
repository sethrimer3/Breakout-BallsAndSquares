import { expect, it } from "vitest";
import { SOLDIER_SHAPES } from "../src/entities/soldierShapes";
import { symbioteStage } from "../src/progression/LatentAbilities";
import { soldierShapeGrid } from "../src/rendering/sprites";
import { SYMBIOTE_FRAMES, symbioteGrid } from "../src/rendering/symbioteSprite";

it("advances the coating from awakening through research", () => {
  expect(symbioteStage(0, undefined)).toBe(0);
  expect(symbioteStage(0, { latent_unlock: 1 })).toBe(1);
  expect(symbioteStage(0, { latent_unlock: 1, latent_magnet: 6 })).toBe(2);
  expect(symbioteStage(0, { latent_unlock: 1, latent_magnet: 9, latent_resources: 9 })).toBe(3);
  expect(symbioteStage(7, { latent_unlock: 1 })).toBe(0);
});

it("adds a moving pink perimeter while keeping each body and its selection ring", () => {
  for (const shape of SOLDIER_SHAPES) {
    const base = soldierShapeGrid(shape, Math.PI / 8, 4.5, 8.5);
    const frames = Array.from({ length: SYMBIOTE_FRAMES }, (_, frame) => symbioteGrid(base, 3, frame).join(""));
    expect(new Set(frames).size).toBeGreaterThan(1);
    expect(frames[0]).toMatch(/[sep]/);
    const mask = base.join("");
    for (let i = 0; i < mask.length; i++) {
      if (mask[i] === "o") expect(frames[0][i]).toBe("o");
      else if (mask[i] !== ".") expect(frames[0][i]).not.toBe(".");
    }
  }
});
