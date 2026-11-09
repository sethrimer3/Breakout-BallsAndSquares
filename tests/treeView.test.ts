import { describe, expect, it } from "vitest";
import { UPGRADE_DEFS, type UpgradeBranch } from "../src/progression/UpgradeDefinitions";
import {
  clampView,
  fitView,
  MAX_ZOOM,
  MIN_READABLE_ZOOM,
  nodePos,
  STAGE_H,
  STAGE_W,
  treeBounds,
  visibleArea,
  zoomAt,
  type Bounds,
} from "../src/ui/treeView";

const BRANCHES: UpgradeBranch[] = [
  "core",
  "formations",
  "resources",
  "blight",
  "facility",
  "pistol",
  "shotgun",
  "assault_rifle",
  "rocket_launcher",
  "sniper_rifle",
  "katana",
  "flamethrower",
];

/** A rectangular tree of `cols` by `rows` cells around the center. */
function gridBounds(cols: number, rows: number): Bounds {
  const homes = [];
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) homes.push(nodePos(c - (cols - 1) / 2, r - (rows - 1) / 2));
  }
  return treeBounds(homes);
}

function shows(v: { x: number; y: number; s: number }, b: Bounds): boolean {
  const seen = visibleArea(v);
  return seen.x0 <= b.x0 && seen.y0 <= b.y0 && seen.x1 >= b.x1 && seen.y1 >= b.y1;
}

describe("tree fit", () => {
  it("shows every shipped tree whole at 100%", () => {
    for (const branch of BRANCHES) {
      const homes = UPGRADE_DEFS.filter((d) => d.branch === branch).map((d) => nodePos(d.grid.col, d.grid.row));
      homes.push(nodePos(0, 0)); // the center hub or unlock node
      const b = treeBounds(homes);
      const v = fitView(b);
      expect(v.s, branch).toBe(branch === "core" ? 0.875 : 1);
      expect(shows(v, b), branch).toBe(true);
    }
  });

  it("shrinks trees too big for the stage until they show whole", () => {
    for (const [cols, rows] of [[9, 3], [5, 6], [15, 9], [40, 30]]) {
      const b = gridBounds(cols, rows);
      const v = fitView(b);
      expect(v.s).toBeLessThan(1);
      expect(shows(v, b)).toBe(true);
    }
  });

  it("flags how big a tree can get before it should split into a tab", () => {
    expect(fitView(gridBounds(11, 5)).s).toBeGreaterThanOrEqual(MIN_READABLE_ZOOM);
    expect(fitView(gridBounds(11, 7)).s).toBeLessThan(MIN_READABLE_ZOOM);
  });
});

describe("tree pan and zoom", () => {
  const big = gridBounds(15, 7);

  it("holds the point under the pointer while zooming", () => {
    const fitted = fitView(big);
    const px = STAGE_W / 2;
    const py = STAGE_H / 2;
    const before = (px - fitted.x) / fitted.s;
    const zoomed = zoomAt(fitted, big, 1, px, py);
    expect(zoomed.s).toBeGreaterThan(fitted.s);
    expect(Math.abs((px - zoomed.x) / zoomed.s - before)).toBeLessThan(1);
  });

  it("stops at the zoom limits", () => {
    let v = fitView(big);
    for (let i = 0; i < 20; i++) v = zoomAt(v, big, 1, 100, 100);
    expect(v.s).toBe(MAX_ZOOM);
    for (let i = 0; i < 20; i++) v = zoomAt(v, big, -1, 100, 100);
    expect(v.s).toBeGreaterThanOrEqual(fitView(big).s * 0.5);
  });

  it("never pans a tree off the stage", () => {
    for (const s of [0.5, 1, 2]) {
      for (const p of [-99999, 99999]) {
        const v = clampView({ x: p, y: p, s }, big);
        const seen = visibleArea(v);
        expect(seen.x1).toBeGreaterThan(big.x0);
        expect(seen.x0).toBeLessThan(big.x1);
        expect(seen.y1).toBeGreaterThan(big.y0);
        expect(seen.y0).toBeLessThan(big.y1);
      }
    }
  });

  it("can pan to every edge of a tree larger than the stage", () => {
    const left = visibleArea(clampView({ x: 99999, y: 0, s: 2 }, big));
    const right = visibleArea(clampView({ x: -99999, y: 0, s: 2 }, big));
    expect(left.x0).toBeLessThanOrEqual(big.x0);
    expect(right.x1).toBeGreaterThanOrEqual(big.x1);
  });
});
