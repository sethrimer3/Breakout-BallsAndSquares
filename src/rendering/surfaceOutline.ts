/** Width in full terrain cells, including outlines on half-size equipment and Blight. */
export const SURFACE_OUTLINE_WIDTH = 1 / 16;

export interface SurfaceGrid {
  subSolidAt(sx: number, sy: number): boolean;
  solidAt?(cx: number, cy: number): boolean;
}

/** 0 = air, 1 = full-cell solid, 2 = half-size (0.5) pixel. */
export function subCellKind(grid: SurfaceGrid, sx: number, sy: number): number {
  if (!grid.subSolidAt(sx, sy)) return 0;
  return grid.solidAt?.(sx >> 1, sy >> 1) === false ? 2 : 1;
}

/**
 * Bitmask of exposed faces/corners for subcell `i` in a `pad`-wide snapshot:
 * 1=top, 2=bottom, 4=left, 8=right, 16=TL, 32=TR, 64=BL, 128=BR.
 * Full cells outline against air (0); 0.5 pixels outline against air or full cells (!== 2).
 */
export function surfaceOutlineMask(solid: Uint8Array, i: number, pad: number): number {
  const s = solid[i];
  if (!s) return 0;
  const isFull = s === 1;
  const top = isFull ? solid[i - pad] === 0 : solid[i - pad] !== 2;
  const bottom = isFull ? solid[i + pad] === 0 : solid[i + pad] !== 2;
  const left = isFull ? solid[i - 1] === 0 : solid[i - 1] !== 2;
  const right = isFull ? solid[i + 1] === 0 : solid[i + 1] !== 2;
  let mask = 0;
  if (top) mask |= 1;
  if (bottom) mask |= 2;
  if (left) mask |= 4;
  if (right) mask |= 8;
  if (!top && !left && (isFull ? solid[i - pad - 1] === 0 : solid[i - pad - 1] !== 2)) mask |= 16;
  if (!top && !right && (isFull ? solid[i - pad + 1] === 0 : solid[i - pad + 1] !== 2)) mask |= 32;
  if (!bottom && !left && (isFull ? solid[i + pad - 1] === 0 : solid[i + pad - 1] !== 2)) mask |= 64;
  if (!bottom && !right && (isFull ? solid[i + pad + 1] === 0 : solid[i + pad + 1] !== 2)) mask |= 128;
  return mask;
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
      solid[y * pad + x] = subCellKind(grid, sx0 + x - 1, sy0 + y - 1);
    }
  const half = 0.5,
    width = SURFACE_OUTLINE_WIDTH,
    far = half - width;
  let count = 0;
  const add = (x: number, y: number, w: number, h: number): void => {
    rect(x, y, w, h);
    count++;
  };
  for (let y = 0; y < subs; y++)
    for (let x = 0; x < subs; x++) {
      const f = surfaceOutlineMask(solid, (y + 1) * pad + x + 1, pad);
      if (!f) continue;
      const px = x * half,
        py = y * half;
      if (f & 1) add(px, py, half, width);
      if (f & 2) add(px, py + far, half, width);
      if (f & 4) add(px, py, width, half);
      if (f & 8) add(px + far, py, width, half);
      if (f & 16) add(px, py, width, width);
      if (f & 32) add(px + far, py, width, width);
      if (f & 64) add(px, py + far, width, width);
      if (f & 128) add(px + far, py + far, width, width);
    }
  return count;
}
