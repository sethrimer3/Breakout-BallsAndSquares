import { describe, expect, it } from "vitest";
import { SOLDIER } from "../src/config";
import { SOLDIER_PALETTE, soldierGrid } from "../src/rendering/sprites";

describe("pixel-art soldier sprite", () => {
  const grid = soldierGrid(SOLDIER.renderRadius, SOLDIER.ringRadius);

  it("is a square grid with an odd side and only palette characters", () => {
    expect(grid.length % 2).toBe(1);
    const allowed = new Set([".", ...Object.keys(SOLDIER_PALETTE)]);
    for (const row of grid) {
      expect(row.length).toBe(grid.length);
      for (const ch of row) expect(allowed.has(ch)).toBe(true);
    }
  });

  it("has a highlight in the upper left and shadow in the lower right", () => {
    const n = grid.length;
    const c = (n - 1) / 2;
    let wx = 0;
    let wy = 0;
    let sx = 0;
    let sy = 0;
    let w = 0;
    let s = 0;
    grid.forEach((row, y) =>
      [...row].forEach((ch, x) => {
        if (ch === "w") (wx += x), (wy += y), w++;
        if (ch === "-") (sx += x), (sy += y), s++;
      }),
    );
    expect(w).toBeGreaterThan(0);
    expect(s).toBeGreaterThan(0);
    expect(wx / w).toBeLessThan(c);
    expect(wy / w).toBeLessThan(c);
    expect(sx / s).toBeGreaterThan(c);
    expect(sy / s).toBeGreaterThan(c);
  });

  it("draws a ring that does not touch the sphere", () => {
    const mid = grid[(grid.length - 1) / 2];
    expect(mid[0]).toBe("o");
    expect(mid).toMatch(/o\.+[-#+w]/);
  });
});

describe("unselected soldier sprite", () => {
  it("has the same size as the selected one but no ring", () => {
    const ringed = soldierGrid(SOLDIER.renderRadius, SOLDIER.ringRadius, true);
    const plain = soldierGrid(SOLDIER.renderRadius, SOLDIER.ringRadius, false);
    expect(plain.length).toBe(ringed.length);
    expect(plain.join("")).not.toContain("o");
    expect(plain.join("").replace(/o/g, ".")).toBe(ringed.join("").replace(/o/g, "."));
  });
});
