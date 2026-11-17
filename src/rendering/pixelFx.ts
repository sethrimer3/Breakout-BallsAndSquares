import { ART_PIXEL } from "../config";
import type { CameraSystem } from "../systems/CameraSystem";

/**
 * Shared helpers for pixel-art weapon effects. Every helper works on the
 * world-aligned `ART_PIXEL` grid (the same grid bullets, rockets and fire use),
 * so effects stay crisp and line up with each other at any zoom.
 */

/** Fill `n` x `n` art pixels starting at grid cell (gx, gy), snapped to screen pixels. */
export function fillArtPixel(ctx: CanvasRenderingContext2D, cam: CameraSystem, gx: number, gy: number, n = 1): void {
  const x0 = Math.round(cam.worldToScreenX(gx * ART_PIXEL));
  const y0 = Math.round(cam.worldToScreenY(gy * ART_PIXEL));
  const x1 = Math.round(cam.worldToScreenX((gx + n) * ART_PIXEL));
  const y1 = Math.round(cam.worldToScreenY((gy + n) * ART_PIXEL));
  ctx.fillRect(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
}

/**
 * Walk a pixel-art line between two world points, calling `plot` with each
 * grid cell and its position along the line (0 = start, 1 = end). Both
 * endpoints are included and each cell is visited once.
 */
export function forEachLinePixel(
  wx1: number, wy1: number, wx2: number, wy2: number,
  plot: (gx: number, gy: number, t: number) => void,
): void {
  const ax = Math.floor(wx1 / ART_PIXEL);
  const ay = Math.floor(wy1 / ART_PIXEL);
  const bx = Math.floor(wx2 / ART_PIXEL);
  const by = Math.floor(wy2 / ART_PIXEL);
  const steps = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
  if (steps === 0) { plot(ax, ay, 1); return; }
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    plot(Math.round(ax + (bx - ax) * t), Math.round(ay + (by - ay) * t), t);
  }
}

/** 4x4 Bayer matrix, normalized to (0, 1), for ordered-dither falloffs. */
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
export function bayer(gx: number, gy: number): number {
  return BAYER4[(gy & 3) * 4 + (gx & 3)];
}

function rgb(c: number): [number, number, number] {
  return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
}
function mix(a: [number, number, number], b: [number, number, number], t: number): string {
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;
}

const discCache = new Map<string, HTMLCanvasElement>();

/**
 * A pixel-art glow disc baked at one canvas pixel per art pixel: a hot core,
 * a body in `color` and a dithered rim that thins out toward the edge. `core`
 * picks how white the center gets (0 = none). Cached per radius/color/core.
 */
export function pixelDiscSprite(radius: number, color: number, core = 1): HTMLCanvasElement {
  const r = Math.max(1, Math.round(radius));
  const key = `${r}|${color}|${core}`;
  const hit = discCache.get(key);
  if (hit) return hit;
  const size = r * 2 + 1;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const g = c.getContext("2d")!;
  const base = rgb(color);
  const white: [number, number, number] = [255, 250, 230];
  const dark: [number, number, number] = [base[0] * 0.55, base[1] * 0.55, base[2] * 0.55];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - r, y - r) / (r + 0.5);
      if (d > 1) continue;
      if (d < 0.3) g.fillStyle = core > 0 ? mix(base, white, core) : mix(base, white, 0.25);
      else if (d < 0.6) g.fillStyle = mix(base, white, core * 0.35);
      else {
        // Dithered rim: denser near the body, sparse at the very edge.
        if (bayer(x, y) < (d - 0.6) / 0.4) continue;
        g.fillStyle = mix(dark, base, d < 0.8 ? 0.6 : 0);
      }
      g.fillRect(x, y, 1, 1);
    }
  }
  if (discCache.size > 256) discCache.clear();
  discCache.set(key, c);
  return c;
}

/**
 * Draw a baked pixel sprite (one canvas pixel per art pixel) centered on the
 * art-pixel cell containing (wx, wy), without smoothing.
 */
export function drawPixelSprite(ctx: CanvasRenderingContext2D, cam: CameraSystem, sprite: HTMLCanvasElement, wx: number, wy: number): void {
  const half = (sprite.width - 1) / 2;
  const gx = Math.floor(wx / ART_PIXEL) - half;
  const gy = Math.floor(wy / ART_PIXEL) - half;
  const x0 = Math.round(cam.worldToScreenX(gx * ART_PIXEL));
  const y0 = Math.round(cam.worldToScreenY(gy * ART_PIXEL));
  const x1 = Math.round(cam.worldToScreenX((gx + sprite.width) * ART_PIXEL));
  const y1 = Math.round(cam.worldToScreenY((gy + sprite.height) * ART_PIXEL));
  const smoothing = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sprite, x0, y0, x1 - x0, y1 - y0);
  ctx.imageSmoothingEnabled = smoothing;
}
