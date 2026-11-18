import type { ScreenRect } from "./LightRegion";

/** Disjoint device-pixel strips exposed by a scroll, plus changed interior tiles.
 * null keeps the full rebuild for large/dense updates. */
export function maskScrollRegions(width: number, height: number, dx: number, dy: number, dpr: number, dirty: ScreenRect | null): ScreenRect[] | null {
  if (!Number.isInteger(dx) || !Number.isInteger(dy) || Math.abs(dx) >= width || Math.abs(dy) >= height) return null;
  // Repaint the viewport fringe too: rounded CSS chunk selection can change
  // there even when an overlapping chunk's device-pixel mapping stays stable.
  const pad = Math.ceil(dpr) + 2;
  const left = Math.max(pad, dx + pad), right = Math.max(pad, -dx + pad);
  const top = Math.max(pad, dy + pad), bottom = Math.max(pad, -dy + pad);
  const middleW = width - left - right, middleH = height - top - bottom;
  if (middleW <= 0 || middleH <= 0) return null;
  const rects: ScreenRect[] = [
    { x: 0, y: 0, width: left, height },
    { x: width - right, y: 0, width: right, height },
    { x: left, y: 0, width: middleW, height: top },
    { x: left, y: height - bottom, width: middleW, height: bottom },
  ];
  if (dirty) {
    const x = Math.max(left, dirty.x), y = Math.max(top, dirty.y);
    const x1 = Math.min(width - right, dirty.x + dirty.width), y1 = Math.min(height - bottom, dirty.y + dirty.height);
    if (x1 > x && y1 > y) rects.push({ x, y, width: x1 - x, height: y1 - y });
  }
  const pixels = rects.reduce((sum, r) => sum + r.width * r.height, 0);
  return pixels < width * height * 0.65 ? rects : null;
}
