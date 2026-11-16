import { describe, expect, it } from "vitest";
import { GlassSystem } from "../src/world/GlassSystem";
import { MAT, PixelWorld, SUB } from "../src/world/PixelWorld";

function fixture() {
  const w = new PixelWorld({width: 40, height: 40, cellSize: 8, roomSize: 6});
  const glass = new GlassSystem(w);
  const i = 20 * w.width + 20;
  w.mat[i] = MAT.glass;
  w.setCell(20, 20, 50);
  return {w, glass, i};
}

describe("overdrive glass contact", () => {
  it("cracks after one second, shatters after two, and keeps HP intact until then", () => {
    const {w, glass, i} = fixture();
    w.setCell(19, 20, 10, "grown");
    glass.update(10, false);
    expect(w.glassCracked[i]).toBe(0);
    glass.update(.99, true); expect(w.glassCracked[i]).toBe(0);
    glass.update(.01, true); expect(w.glassCracked[i]).toBe(1);
    expect(w.health[i]).toBe(50);
    glass.update(.99, true); expect(w.health[i]).toBe(50);
    glass.update(.01, true); expect(w.health[i]).toBe(0);
  });

  it("resets uninterrupted contact when Blight retreats or overdrive ends", () => {
    const {w, glass, i} = fixture();
    w.setCell(19, 20, 10, "grown");
    glass.update(1.5, true); expect(w.glassCracked[i]).toBe(1);
    w.setCell(19, 20, 0);
    glass.update(.1, true); expect(w.glassCracked[i]).toBe(0);
    w.setCell(19, 20, 10, "grown");
    glass.update(.75, true); expect(w.glassCracked[i]).toBe(0);
    glass.update(.25, true); expect(w.glassCracked[i]).toBe(1);
    glass.update(.1, false); expect(w.glassCracked[i]).toBe(0);
    glass.update(1, true); expect(w.health[i]).toBe(50);
    glass.reset(); expect(w.glassCracked[i]).toBe(0);
    glass.update(1, true); expect(w.health[i]).toBe(50);
  });

  it("requires face contact with a living full cell or half-size Blight pixel", () => {
    const {w, glass, i} = fixture();
    w.setCell(19, 19, 10, "grown"); // diagonal
    w.subKind[40 * w.subWidth + 39] = SUB.rubble;
    w.subHealth[40 * w.subWidth + 39] = 10; // touching rubble
    w.setSubCell(38, 40, 10); // Blight on the far half of the neighboring cell
    glass.update(3, true); expect(w.health[i]).toBe(50);
    w.setSubCell(39, 40, 10);
    glass.update(1, true); expect(w.glassCracked[i]).toBe(1);
    glass.update(1, true); expect(w.health[i]).toBe(0);
  });

  it("ripples within one shell without jumping an air gap", () => {
    const {w, glass} = fixture();
    w.mat[21 * w.width + 20] = MAT.glass; w.setCell(20, 21, 50);
    w.mat[20 * w.width + 22] = MAT.glass; w.setCell(22, 20, 50);
    w.setCell(19, 20, 10, "grown");
    glass.update(2, true);
    glass.update(.1, true);
    expect(w.health[21 * w.width + 20]).toBe(0);
    expect(w.health[20 * w.width + 22]).toBe(50);
  });
});
