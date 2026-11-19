import { ART_PIXEL } from "../config";
import type { CameraSystem } from "../systems/CameraSystem";
import { PORTAL, type SpawnPortal } from "../systems/SpawnPortal";
import { bayer, fillArtPixel } from "./pixelFx";

/**
 * Pixel art for the squad's deployment portal: a swirling disc of three
 * spiral arms inside a bright segmented rim with a dark outline, sparks
 * circling it, and a white flare as it opens and as it collapses. Everything
 * is drawn on the world's ART_PIXEL grid so it matches the soldiers.
 */

/** Dark void to hot white, for the swirl inside the portal. */
const SWIRL = ["#050c1c", "#0d2a55", "#1f5f9e", "#3fa6e0", "#8eeaff", "#effdff"];
const RIM = "#a9f1ff";
const RIM_HOT = "#ffffff";
const RIM_DIM = "#3fb4e6";
const OUTLINE = "#02060d";
const DENY = "#ff4a6e";
const DENY_DARK = "#4a0718";

type Ctx = CanvasRenderingContext2D;

/** Draw the open (or opening/closing) portal. `time` is in seconds and only drives the swirl. */
export function drawSpawnPortal(ctx: Ctx, cam: CameraSystem, p: SpawnPortal, time: number): void {
  const open = Math.max(0, p.openness);
  const R = (PORTAL.radius / ART_PIXEL) * open;
  const cx = p.x / ART_PIXEL;
  const cy = p.y / ART_PIXEL;
  const span = Math.ceil(R + 4);
  const gx0 = Math.floor(cx) - span;
  const gy0 = Math.floor(cy) - span;
  // Fast spin while it opens, a steady churn while operators come through.
  const spin = time * 1.1 + p.t * (p.phase === "opening" ? 2.2 : 0.6);
  ctx.save();
  if (R >= 0.75) {
    for (let gy = gy0; gy <= gy0 + span * 2; gy++) {
      for (let gx = gx0; gx <= gx0 + span * 2; gx++) {
        const dx = gx + 0.5 - cx;
        const dy = gy + 0.5 - cy;
        const dist = Math.hypot(dx, dy);
        if (dist > R + 1) continue;
        if (dist > R) {
          ctx.fillStyle = OUTLINE;
        } else if (dist > R - 1.3) {
          // Segmented rim that rotates the other way to the swirl.
          const seg = Math.floor(((Math.atan2(dy, dx) / (Math.PI * 2)) * 18 - spin * 2.5) % 3 + 3) % 3;
          ctx.fillStyle = seg === 0 ? RIM_HOT : seg === 1 ? RIM : RIM_DIM;
        } else {
          const d = dist / R;
          const a = Math.atan2(dy, dx) / (Math.PI * 2);
          // Three spiral arms drawn into the middle.
          const arm = 0.5 + 0.5 * Math.cos(Math.PI * 2 * (a * 3 + d * 1.6 + spin));
          const core = Math.max(0, 1 - d / 0.35);
          const b = Math.min(1, arm * (0.25 + 0.65 * d) + core * 0.9 + 0.08);
          const level = Math.max(0, Math.min(SWIRL.length - 1, Math.floor(b * (SWIRL.length - 1) + bayer(gx, gy) - 0.25)));
          ctx.fillStyle = SWIRL[level];
        }
        fillArtPixel(ctx, cam, gx, gy);
      }
    }
  }
  // Sparks orbiting just outside the rim.
  if (open > 0.15) {
    ctx.fillStyle = RIM;
    for (let k = 0; k < 6; k++) {
      const a = spin * 1.7 + (k * Math.PI * 2) / 6;
      const r = R + 2.5 + Math.sin(time * 5 + k * 1.9) * 0.8;
      fillArtPixel(ctx, cam, Math.floor(cx + Math.cos(a) * r), Math.floor(cy + Math.sin(a) * r));
    }
  }
  // A white flare: bursting open at first, collapsing to a point at the end.
  const flare = p.phase === "opening" ? 1 - p.t / PORTAL.openTime : p.phase === "closing" ? 1 - open : 0;
  if (flare > 0.05) {
    const fr = Math.max(1, Math.round((p.phase === "opening" ? R + 3 : 2 + flare * 3)));
    ctx.fillStyle = RIM_HOT;
    ctx.globalAlpha = Math.min(1, flare * 1.2);
    for (let i = -fr; i <= fr; i++) {
      fillArtPixel(ctx, cam, Math.floor(cx) + i, Math.floor(cy));
      fillArtPixel(ctx, cam, Math.floor(cx), Math.floor(cy) + i);
    }
    const dg = Math.round(fr * 0.5);
    for (let i = -dg; i <= dg; i++) {
      fillArtPixel(ctx, cam, Math.floor(cx) + i, Math.floor(cy) + i);
      fillArtPixel(ctx, cam, Math.floor(cx) + i, Math.floor(cy) - i);
    }
  }
  ctx.restore();
}

/**
 * Ghost ring where a tap would open the portal: dotted cyan, slowly turning,
 * or red with a cross where the Blight Wardens forbid it.
 */
export function drawPortalPreview(ctx: Ctx, cam: CameraSystem, wx: number, wy: number, time: number, guarded: boolean, alpha = 0.7): void {
  const cx = wx / ART_PIXEL;
  const cy = wy / ART_PIXEL;
  const R = PORTAL.radius / ART_PIXEL;
  ctx.save();
  ctx.globalAlpha = alpha;
  const dots = 28;
  for (let k = 0; k < dots; k++) {
    if ((k & 1) === 1) continue;
    const a = (k / dots) * Math.PI * 2 + time * (guarded ? 0 : 0.8);
    const gx = Math.floor(cx + Math.cos(a) * R);
    const gy = Math.floor(cy + Math.sin(a) * R);
    ctx.fillStyle = OUTLINE;
    fillArtPixel(ctx, cam, gx + 1, gy + 1);
    ctx.fillStyle = guarded ? DENY : RIM;
    fillArtPixel(ctx, cam, gx, gy);
  }
  if (guarded) drawCross(ctx, cam, cx, cy, 4);
  else {
    ctx.fillStyle = RIM;
    fillArtPixel(ctx, cam, Math.floor(cx), Math.floor(cy));
  }
  ctx.restore();
}

/** A refused tap: a red cross and ring that fade out, with a short reason. */
export function drawSpawnDenied(ctx: Ctx, cam: CameraSystem, wx: number, wy: number, age: number, guarded: boolean): void {
  const life = 1.4;
  if (age < 0 || age > life) return;
  const fade = age < life - 0.4 ? 1 : (life - age) / 0.4;
  const blink = age < 0.45 ? (Math.floor(age * 12) % 2 === 0 ? 1 : 0.55) : 1;
  const cx = wx / ART_PIXEL;
  const cy = wy / ART_PIXEL;
  const R = PORTAL.radius / ART_PIXEL;
  ctx.save();
  ctx.globalAlpha = fade * blink;
  for (let k = 0; k < 40; k++) {
    const a = (k / 40) * Math.PI * 2;
    const gx = Math.floor(cx + Math.cos(a) * R);
    const gy = Math.floor(cy + Math.sin(a) * R);
    ctx.fillStyle = DENY_DARK;
    fillArtPixel(ctx, cam, gx + 1, gy + 1);
    ctx.fillStyle = DENY;
    fillArtPixel(ctx, cam, gx, gy);
  }
  drawCross(ctx, cam, cx, cy, 5);
  const text = guarded ? "BLIGHT WARDENS GUARD THIS ZONE" : "NO ROOM FOR A PORTAL";
  const fontPx = 8 * Math.max(1, Math.round(Math.min(2, cam.zoom / 2)));
  ctx.font = `${fontPx}px Silkscreen, "Press Start 2P", monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  const x = Math.round(cam.worldToScreenX(wx));
  const y = Math.round(cam.worldToScreenY(wy - (R + 3) * ART_PIXEL));
  ctx.fillStyle = "#05070d";
  ctx.fillText(text, x + 1, y + 1);
  ctx.fillStyle = "#ffd6de";
  ctx.fillText(text, x, y);
  ctx.restore();
}

function drawCross(ctx: Ctx, cam: CameraSystem, cx: number, cy: number, n: number): void {
  const x = Math.floor(cx);
  const y = Math.floor(cy);
  for (let i = -n; i <= n; i++) {
    ctx.fillStyle = DENY_DARK;
    fillArtPixel(ctx, cam, x + i + 1, y + i + 1);
    fillArtPixel(ctx, cam, x + i + 1, y - i + 1);
    ctx.fillStyle = DENY;
    fillArtPixel(ctx, cam, x + i, y + i);
    fillArtPixel(ctx, cam, x + i, y - i);
  }
}
