/** Mask pixels per world subcell: a Blight edge is one mask pixel thick, half a subcell. */
export const EDGE_PIXELS_PER_SUB = 2;

export interface BlightGrid {
  readonly subWidth: number;
  readonly subHeight: number;
  isBlightSubAt(sx: number, sy: number): boolean;
}

/**
 * Marks the edge of Blight inside one square of subcells: for every Blight
 * subcell, the row or column of mask pixels on each side that faces something
 * that is not Blight. The world's border counts as Blight, so it draws no edge.
 * `out` has `subs * EDGE_PIXELS_PER_SUB` pixels a side, 1 for edge, and `solid`
 * is a reusable `(subs + 2)²` scratch. Returns how many mask pixels were set.
 */
export function markBlightEdges(
  grid: BlightGrid,
  sx0: number,
  sy0: number,
  subs: number,
  out: Uint8Array,
  solid: Uint8Array,
  /** Only Blight subcells passing this draw edges (e.g. only dormant ones). Omitted: all do. */
  include?: (sx: number, sy: number) => boolean,
): number {
  const pad = subs + 2;
  let any = false;
  for (let y = 0; y < pad; y++) {
    const sy = sy0 + y - 1;
    for (let x = 0; x < pad; x++) {
      const sx = sx0 + x - 1;
      const outside = sx < 0 || sy < 0 || sx >= grid.subWidth || sy >= grid.subHeight;
      const here = outside || grid.isBlightSubAt(sx, sy);
      solid[y * pad + x] = here ? 1 : 0;
      if (here && !outside && x > 0 && y > 0 && x <= subs && y <= subs && (!include || include(sx, sy))) any = true;
    }
  }
  out.fill(0);
  if (!any) return 0;
  const size = subs * EDGE_PIXELS_PER_SUB;
  let count = 0;
  const mark = (x: number, y: number): void => {
    const i = y * size + x;
    if (out[i] === 0) {
      out[i] = 1;
      count++;
    }
  };
  for (let y = 0; y < subs; y++) {
    for (let x = 0; x < subs; x++) {
      const i = (y + 1) * pad + x + 1;
      if (solid[i] === 0) continue;
      if (include && !include(sx0 + x, sy0 + y)) continue;
      const left = x * EDGE_PIXELS_PER_SUB;
      const top = y * EDGE_PIXELS_PER_SUB;
      const right = left + EDGE_PIXELS_PER_SUB - 1;
      const bottom = top + EDGE_PIXELS_PER_SUB - 1;
      if (solid[i - pad] === 0) for (let p = left; p <= right; p++) mark(p, top);
      if (solid[i + pad] === 0) for (let p = left; p <= right; p++) mark(p, bottom);
      if (solid[i - 1] === 0) for (let p = top; p <= bottom; p++) mark(left, p);
      if (solid[i + 1] === 0) for (let p = top; p <= bottom; p++) mark(right, p);
    }
  }
  return count;
}
