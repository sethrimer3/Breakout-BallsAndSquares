/**
 * Amanatides–Woo grid traversal used by bullets and (later) lighting.
 * Works in world units; the grid is defined by `cellSize` and a solidity query.
 */

export interface SolidQuery {
  /** True if the cell is solid. Out-of-bounds cells must report solid. */
  solidAt(cx: number, cy: number): boolean;
}

export interface RayHit {
  hit: boolean;
  /** Distance along the ray to the hit (0 if the ray starts inside a solid cell). */
  t: number;
  cx: number;
  cy: number;
  /** Face normal of the hit (axis-aligned). */
  nx: number;
  ny: number;
  /** Hit point in world units. */
  x: number;
  y: number;
}

export function makeRayHit(): RayHit {
  return { hit: false, t: 0, cx: 0, cy: 0, nx: 0, ny: 0, x: 0, y: 0 };
}

/**
 * Cast a ray from (ox, oy) along normalized (dx, dy) up to maxDist.
 * The starting cell is checked first: if solid, reports a hit at t = 0 with a
 * normal opposing the dominant ray axis.
 */
export function gridRaycast(
  grid: SolidQuery,
  cellSize: number,
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  maxDist: number,
  out: RayHit,
): boolean {
  let cx = Math.floor(ox / cellSize);
  let cy = Math.floor(oy / cellSize);

  if (grid.solidAt(cx, cy)) {
    out.hit = true;
    out.t = 0;
    out.cx = cx;
    out.cy = cy;
    if (Math.abs(dx) >= Math.abs(dy)) {
      out.nx = dx > 0 ? -1 : 1;
      out.ny = 0;
    } else {
      out.nx = 0;
      out.ny = dy > 0 ? -1 : 1;
    }
    out.x = ox;
    out.y = oy;
    return true;
  }

  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  const tDeltaX = adx > 1e-12 ? cellSize / adx : Infinity;
  const tDeltaY = ady > 1e-12 ? cellSize / ady : Infinity;
  let tMaxX =
    adx > 1e-12 ? (dx > 0 ? (cx + 1) * cellSize - ox : ox - cx * cellSize) / adx : Infinity;
  let tMaxY =
    ady > 1e-12 ? (dy > 0 ? (cy + 1) * cellSize - oy : oy - cy * cellSize) / ady : Infinity;

  let t = 0;
  let nx = 0;
  let ny = 0;
  for (;;) {
    if (tMaxX < tMaxY) {
      t = tMaxX;
      if (t > maxDist) break;
      cx += stepX;
      tMaxX += tDeltaX;
      nx = -stepX;
      ny = 0;
    } else {
      t = tMaxY;
      if (t > maxDist) break;
      cy += stepY;
      tMaxY += tDeltaY;
      nx = 0;
      ny = -stepY;
    }
    if (grid.solidAt(cx, cy)) {
      out.hit = true;
      out.t = t;
      out.cx = cx;
      out.cy = cy;
      out.nx = nx;
      out.ny = ny;
      out.x = ox + dx * t;
      out.y = oy + dy * t;
      return true;
    }
  }

  out.hit = false;
  out.t = maxDist;
  out.x = ox + dx * maxDist;
  out.y = oy + dy * maxDist;
  return false;
}
