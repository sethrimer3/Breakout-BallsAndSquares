/** Width in full terrain cells, including outlines on half-size equipment and Blight. */
export const SURFACE_OUTLINE_WIDTH = 1 / 8;

interface SurfaceGrid {
  subSolidAt(sx: number, sy: number): boolean;
}

/**
 * Trace exposed solid faces as inward strips, in chunk-local terrain-cell units.
 * The padded occupancy snapshot includes neighbors outside the chunk so seams
 * never become outlines. Corner squares join the strips around concave air.
 */
export function traceSurfaceOutline(
  grid: SurfaceGrid,
  sx0: number,
  sy0: number,
  subs: number,
  solid: Uint8Array,
  rect: (x: number, y: number, width: number, height: number) => void,
): number {
  const pad = subs + 2;
  for (let y = 0; y < pad; y++)
    for (let x = 0; x < pad; x++) {
      solid[y * pad + x] = grid.subSolidAt(sx0 + x - 1, sy0 + y - 1) ? 1 : 0;
    }
  const half = 0.5,
    width = SURFACE_OUTLINE_WIDTH;
  let count = 0;
  const add = (x: number, y: number, w: number, h: number): void => {
    rect(x, y, w, h);
    count++;
  };
  for (let y = 0; y < subs; y++)
    for (let x = 0; x < subs; x++) {
      const i = (y + 1) * pad + x + 1;
      if (!solid[i]) continue;
      const px = x * half,
        py = y * half;
      const top = !solid[i - pad],
        bottom = !solid[i + pad];
      const left = !solid[i - 1],
        right = !solid[i + 1];
      if (top) add(px, py, half, width);
      if (bottom) add(px, py + half - width, half, width);
      if (left) add(px, py, width, half);
      if (right) add(px + half - width, py, width, half);
      if (!top && !left && !solid[i - pad - 1]) add(px, py, width, width);
      if (!top && !right && !solid[i - pad + 1])
        add(px + half - width, py, width, width);
      if (!bottom && !left && !solid[i + pad - 1])
        add(px, py + half - width, width, width);
      if (!bottom && !right && !solid[i + pad + 1])
        add(px + half - width, py + half - width, width, width);
    }
  return count;
}
