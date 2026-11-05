/**
 * Layout, fit, pan and zoom for the upgrade tree stage. Pure math: no DOM.
 *
 * HOW TO KEEP A TREE ON SCREEN (read this before adding upgrades):
 * 1. Aim for a tree that shows whole at 100%: the stage holds grid columns
 *    -2..2 and rows -1..1. Prefer filling those cells over adding new ones.
 *    tests/treeView.test.ts holds the shipped trees to this.
 * 2. A tree may grow past that when it has to. Nothing else needs changing:
 *    `fitView` shrinks it, a zoom step at a time, until all of it shows.
 * 3. Never shrink below `MIN_READABLE_ZOOM` on purpose: labels get hard to
 *    read there. Split the tree into another tab instead. Pan and zoom are
 *    for looking closer, not a reason to let a tree sprawl.
 * 4. The tree opens fitted on every tab switch, and the FIT button returns
 *    to it, so a player can never lose a tree off screen. `clampView` keeps
 *    every pan and zoom inside what can be seen.
 */

export const CELL_STEP = 116;
export const STAGE_W = 760;
export const STAGE_H = 320;
export const CENTER_X = 380;
export const CENTER_Y = 160;
/** Reach of a node past its center: its frame plus the light-cycle lap. */
export const NODE_REACH = 36;
/** Empty stage kept round a fitted tree, and the most it can pan out of view. */
export const VIEW_MARGIN = 8;

/** Whole-tree steps, so sprites keep a consistent size and stay hard-edged. */
export const ZOOM_STEPS = [0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1, 1.5, 2] as const;
export const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1];
/** Fit never enlarges a small tree past pixel-perfect 100%. */
export const FIT_MAX_ZOOM = 1;
export const MIN_READABLE_ZOOM = 0.5;
/** How far past the fit a player can zoom out, as a share of the fit. */
const ZOOM_OUT_SHARE = 0.5;

export interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A tree point (x, y) shows at stage pixel (view.x + x * view.s, ...). */
export interface View {
  x: number;
  y: number;
  s: number;
}

export function nodePos(col: number, row: number): { x: number; y: number } {
  return { x: CENTER_X + col * CELL_STEP, y: CENTER_Y + row * CELL_STEP };
}

/** Everything a tree draws: each node's rest position plus its reach. */
export function treeBounds(homes: readonly { x: number; y: number }[]): Bounds {
  const xs = homes.map((h) => h.x);
  const ys = homes.map((h) => h.y);
  return {
    x0: Math.min(...xs) - NODE_REACH,
    y0: Math.min(...ys) - NODE_REACH,
    x1: Math.max(...xs) + NODE_REACH,
    y1: Math.max(...ys) + NODE_REACH,
  };
}

/** The largest zoom that shows the whole tree, centered on the stage. */
export function fitView(b: Bounds, w = STAGE_W, h = STAGE_H): View {
  const needed = Math.min(
    FIT_MAX_ZOOM,
    (w - VIEW_MARGIN * 2) / Math.max(1, b.x1 - b.x0),
    (h - VIEW_MARGIN * 2) / Math.max(1, b.y1 - b.y0),
  );
  // Largest step that fits; a tree too big for every step uses the exact scale.
  const s = [...ZOOM_STEPS].reverse().find((z) => z <= needed) ?? needed;
  return {
    s,
    x: Math.round(w / 2 - ((b.x0 + b.x1) / 2) * s),
    y: Math.round(h / 2 - ((b.y0 + b.y1) / 2) * s),
  };
}

function clampAxis(pos: number, lo: number, hi: number, stage: number, s: number): number {
  const size = (hi - lo) * s;
  // Works both ways: a small tree roams the stage, a big one reveals its edges.
  const a = VIEW_MARGIN - lo * s;
  const b = stage - size - VIEW_MARGIN - lo * s;
  return Math.round(Math.max(Math.min(a, b), Math.min(Math.max(a, b), pos)));
}

/** Keeps the tree where it can be seen, on whole stage pixels. */
export function clampView(v: View, b: Bounds, w = STAGE_W, h = STAGE_H): View {
  return { s: v.s, x: clampAxis(v.x, b.x0, b.x1, w, v.s), y: clampAxis(v.y, b.y0, b.y1, h, v.s) };
}

/** One zoom step in (`dir` > 0) or out, holding the tree point under (px, py). */
export function zoomAt(v: View, b: Bounds, dir: number, px: number, py: number, w = STAGE_W, h = STAGE_H): View {
  const floor = fitView(b, w, h).s * ZOOM_OUT_SHARE;
  const next =
    dir > 0
      ? ZOOM_STEPS.find((z) => z > v.s)
      : [...ZOOM_STEPS].reverse().find((z) => z < v.s && z >= floor);
  if (next === undefined) return v;
  const tx = (px - v.x) / v.s;
  const ty = (py - v.y) / v.s;
  return clampView({ s: next, x: px - tx * next, y: py - ty * next }, b, w, h);
}

/** The part of the tree on the stage right now. */
export function visibleArea(v: View, w = STAGE_W, h = STAGE_H): Bounds {
  return { x0: -v.x / v.s, y0: -v.y / v.s, x1: (w - v.x) / v.s, y1: (h - v.y) / v.s };
}
