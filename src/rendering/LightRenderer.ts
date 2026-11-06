import { GROWTH, LIGHT } from "../config";
import type { Game } from "../Game";
import type { LitCells } from "../systems/LightingSystem";
import { CanvasSoftener } from "./SoftLight";
import type { Sprites } from "./sprites";

/**
 * Soft-shadow tuning: the open-air light layer is blurred at this fraction of
 * device resolution before terrain is cut out, so shadow edges fade over a few
 * pixels while walls (cut out afterwards at full res) stay crisp.
 */
export const SOFT_SHADOWS = {
  /** Low-res copy size per device pixel. Lower = softer + cheaper. */
  scale: 0.25,
  /** Blur radius in low-res pixels (x 1/scale device pixels). */
  blur: 1.5,
} as const;

/** Gradient stop: `[offset, r, g, b, alpha]`. */
type Stop = readonly [number, number, number, number, number];

const FLASH_STOPS: readonly Stop[] = [
  [0, 255, 252, 238, 1],
  [0.18, 255, 224, 150, 0.92],
  [0.5, 255, 148, 52, 0.55],
  [0.82, 210, 82, 20, 0.2],
  [1, 140, 40, 0, 0],
];

const SCATTER_STOPS: readonly Stop[] = [
  [0, 255, 246, 215, 0.34],
  [0.28, 255, 196, 105, 0.2],
  [0.65, 255, 125, 35, 0.08],
  [1, 255, 90, 0, 0],
];

/** Fiery-mode variants: deeper orange with less white, for flame-lit air. */
const FIERY_FLASH_STOPS: readonly Stop[] = [
  [0, 255, 228, 170, 1],
  [0.16, 255, 178, 85, 0.9],
  [0.48, 255, 110, 28, 0.55],
  [0.8, 200, 55, 10, 0.2],
  [1, 120, 25, 0, 0],
];

const FIERY_SCATTER_STOPS: readonly Stop[] = [
  [0, 255, 200, 130, 0.3],
  [0.25, 255, 140, 50, 0.18],
  [0.6, 230, 80, 15, 0.07],
  [1, 180, 40, 0, 0],
];

/** Matches the `soldierGlow` sprite. */
const SOFT_STOPS: readonly Stop[] = [
  [0, 120, 225, 255, 0.45],
  [0.4, 80, 180, 255, 0.15],
  [1, 40, 120, 255, 0],
];

const LUT_STEPS = 64;

/** Sample stops into `[r, g, b]` triples of added light (color * alpha). */
function buildLut(stops: readonly Stop[]): Float32Array {
  const lut = new Float32Array((LUT_STEPS + 1) * 3);
  let s = 0;
  for (let i = 0; i <= LUT_STEPS; i++) {
    const t = i / LUT_STEPS;
    while (s < stops.length - 2 && t > stops[s + 1][0]) s++;
    const a = stops[s];
    const b = stops[s + 1];
    const f = (t - a[0]) / (b[0] - a[0]);
    const alpha = a[4] + (b[4] - a[4]) * f;
    for (let c = 0; c < 3; c++) lut[i * 3 + c] = (a[c + 1] + (b[c + 1] - a[c + 1]) * f) * alpha;
  }
  return lut;
}

const FLASH_LUT = buildLut(FLASH_STOPS);
const FIERY_FLASH_LUT = buildLut(FIERY_FLASH_STOPS);
const SOFT_LUT = buildLut(SOFT_STOPS);

function makeLayer(alpha: boolean): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  return [c, c.getContext("2d", { alpha })!];
}

/**
 * Renders the 2D lightmap (offscreen canvas multiplied over the albedo scene)
 * and the low-alpha air-scatter pass that makes muzzle-flash cones and shadow
 * wedges visible across open cavities.
 *
 * Light is resolved separately for the two kinds of surface, so nothing depends
 * on polygon edges lining up with the terrain's pixel-snapped chunks:
 * - Open air: smooth polygons with a mask of the rendered terrain cut out of them.
 * - Walls: flat per-cell values, drawn with the same chunk mapping as the terrain.
 *
 * All layers are device-resolution and composited 1:1.
 */
export class LightRenderer {
  private lmCanvas: HTMLCanvasElement;
  private lmCtx: CanvasRenderingContext2D;
  private layerCanvas: HTMLCanvasElement;
  private layerCtx: CanvasRenderingContext2D;
  private maskCanvas: HTMLCanvasElement;
  private maskCtx: CanvasRenderingContext2D;
  private vignetteCanvas: HTMLCanvasElement;
  private softener = new CanvasSoftener(SOFT_SHADOWS);
  /** Set per frame from the visual setting. */
  private softShadows = false;
  private vigW = 0;
  private vigH = 0;

  /** One pixel per world cell: light added to wall cells this frame. */
  private wallCanvas: HTMLCanvasElement;
  private wallCtx: CanvasRenderingContext2D;
  private wallImage: ImageData | null = null;
  private dirtyX0 = 0;
  private dirtyY0 = 0;
  private dirtyX1 = -1;
  private dirtyY1 = -1;

  constructor(private sprites: Sprites) {
    [this.lmCanvas, this.lmCtx] = makeLayer(false);
    [this.layerCanvas, this.layerCtx] = makeLayer(true);
    [this.maskCanvas, this.maskCtx] = makeLayer(true);
    [this.wallCanvas, this.wallCtx] = makeLayer(true);
    this.vignetteCanvas = document.createElement("canvas");
  }

  /** Build the lightmap and composite it onto the scene in `ctx`. */
  renderLighting(ctx: CanvasRenderingContext2D, game: Game, dpr: number): void {
    const cam = game.camera;
    this.softShadows = game.softShadows;
    const viewW = Math.max(1, Math.round(cam.viewW));
    const viewH = Math.max(1, Math.round(cam.viewH));
    const devW = ctx.canvas.width;
    const devH = ctx.canvas.height;
    for (const c of [this.lmCanvas, this.layerCanvas, this.maskCanvas]) {
      if (c.width !== devW || c.height !== devH) {
        c.width = devW;
        c.height = devH;
      }
    }

    // Terrain silhouette, using the same draw as the albedo pass.
    const mask = this.maskCtx;
    mask.setTransform(1, 0, 0, 1, 0, 0);
    mask.clearRect(0, 0, devW, devH);
    mask.setTransform(dpr, 0, 0, dpr, 0, 0);
    game.terrain.draw(mask, cam);

    const g = this.lmCtx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 1) Fill with dark ambient illumination.
    const [ar, ag, ab] = LIGHT.ambientRgb;
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
    g.fillStyle = `rgb(${ar}, ${ag}, ${ab})`;
    g.fillRect(0, 0, viewW, viewH);

    // 2) Light in open air: glows and muzzle flashes, each clipped by its polygon.
    const air = this.beginLayer(devW, devH, dpr);
    const soft = game.lighting.softLights;
    for (let i = 0; i < game.lighting.softCount; i++) {
      const l = soft[i];
      const sx = cam.worldToScreenX(l.x);
      const sy = cam.worldToScreenY(l.y);
      const rad = l.radius * cam.zoom;
      if (l.polyCount >= 3) {
        this.tracePolygonPath(air, game, l.poly, l.polyCount);
        air.fillStyle = gradientFor(air, sx, sy, rad, SOFT_STOPS, l.strength);
        air.fill();
      } else {
        // Past the shadow budget, or inside new terrain: air only (masked below).
        air.globalAlpha = l.strength;
        air.drawImage(this.sprites.soldierGlow, sx - rad, sy - rad, rad * 2, rad * 2);
        air.globalAlpha = 1;
      }
    }
    const flashMult = game.muzzleFlashMultiplier;
    const fiery = game.fieryMuzzleFlash;
    const flashStops = fiery ? FIERY_FLASH_STOPS : FLASH_STOPS;
    const scatterStops = fiery ? FIERY_SCATTER_STOPS : SCATTER_STOPS;
    if (flashMult > 0) {
      for (const fl of game.flashes) {
        const intensity = Math.pow(Math.max(0, fl.life / fl.maxLife), 0.65) * flashMult;
        const sx = cam.worldToScreenX(fl.x);
        const sy = cam.worldToScreenY(fl.y);
        const rad = fl.radius * cam.zoom;
        if (sx + rad < 0 || sy + rad < 0 || sx - rad > viewW || sy - rad > viewH) continue;
        if (fl.hasPolygon) {
          this.tracePolygonPath(air, game, fl.poly, fl.polyCount);
          air.fillStyle = gradientFor(air, sx, sy, rad, flashStops, intensity);
          air.fill();
        } else {
          // Fallback cheap glow when over the shadow-light budget.
          air.globalAlpha = intensity * 0.65;
          air.drawImage(this.sprites.warmGlow, sx - rad * 0.7, sy - rad * 0.7, rad * 1.4, rad * 1.4);
          air.globalAlpha = 1;
        }
      }
    }
    this.finishAirLayer(g, "lighter", devW, devH, dpr);

    g.globalCompositeOperation = "lighter";

    // 3) Dim crimson light from recently replicated hostile terrain cells.
    const gr = game.growth;
    if (gr.glowCount > 0) {
      const w = game.world;
      const cs = w.cellSize;
      const now = game.runStats.time;
      const dur = GROWTH.glowDuration;
      for (let k = 0; k < gr.glowCount; k++) {
        const idx = (gr.glowHead - 1 - k + GROWTH.glowCap) % GROWTH.glowCap;
        const age = now - gr.glowTime[idx];
        if (age < 0 || age >= dur) continue;
        const cell = gr.glowIndex[idx];
        if (w.health[cell] === 0) continue;
        const cx = cell % w.width;
        const cy = Math.floor(cell / w.width);
        const sx = cam.worldToScreenX((cx + 0.5) * cs);
        const sy = cam.worldToScreenY((cy + 0.5) * cs);
        if (sx < -60 || sy < -60 || sx > viewW + 60 || sy > viewH + 60) continue;
        const a = 1 - age / dur;
        const cr = cs * 2.6 * cam.zoom;
        g.globalAlpha = a * 0.42;
        g.drawImage(this.sprites.crimsonGlow, sx - cr, sy - cr, cr * 2, cr * 2);
      }
      g.globalAlpha = 1;
    }

    // 4) Light on walls, whole cells at a time.
    const wallsLit = this.updateWallLight(game);
    if (wallsLit) game.terrain.drawCellOverlay(g, cam, this.wallCanvas);

    // 5) Multiply lightmap over the albedo scene -> unlit areas become dark,
    //    lit walls pop with warm color, occluded regions stay in shadow.
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "multiply";
    ctx.drawImage(this.lmCanvas, 0, 0);
    ctx.restore();

    // 6) Air-scatter pass: the light polygons at low alpha with additive blending,
    //    so the light cone and soldier/wall shadow silhouettes are clearly visible
    //    across empty space.
    let scatter: CanvasRenderingContext2D | null = null;
    if (flashMult > 0) {
      for (const fl of game.flashes) {
        if (!fl.hasPolygon) continue;
        const intensity = Math.pow(Math.max(0, fl.life / fl.maxLife), 0.7) * flashMult;
        const sx = cam.worldToScreenX(fl.x);
        const sy = cam.worldToScreenY(fl.y);
        const rad = fl.radius * cam.zoom;
        if (sx + rad < 0 || sy + rad < 0 || sx - rad > viewW || sy - rad > viewH) continue;
        scatter ??= this.beginLayer(devW, devH, dpr);
        this.tracePolygonPath(scatter, game, fl.poly, fl.polyCount);
        scatter.fillStyle = gradientFor(scatter, sx, sy, rad, scatterStops, intensity);
        scatter.fill();
      }
    }
    if (scatter) {
      ctx.save();
      this.finishAirLayer(ctx, "lighter", devW, devH, dpr);
      ctx.restore();
    }

    // 7) Lift lit walls past their dark albedo, giving them their pale lit look.
    if (wallsLit) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = LIGHT.wallScatter;
      game.terrain.drawCellOverlay(ctx, cam, this.wallCanvas);
      ctx.restore();
    }
  }

  /** Clear the shared light layer for additive drawing in CSS-pixel coordinates. */
  private beginLayer(devW: number, devH: number, dpr: number): CanvasRenderingContext2D {
    const l = this.layerCtx;
    l.setTransform(1, 0, 0, 1, 0, 0);
    l.globalCompositeOperation = "source-over";
    l.clearRect(0, 0, devW, devH);
    l.setTransform(dpr, 0, 0, dpr, 0, 0);
    l.globalCompositeOperation = "lighter";
    return l;
  }

  /** Cut the terrain out of the light layer and composite it 1:1 onto `target`. */
  private finishAirLayer(
    target: CanvasRenderingContext2D,
    op: GlobalCompositeOperation,
    devW: number,
    devH: number,
    dpr: number,
  ): void {
    const l = this.layerCtx;
    // Soften shadow edges before the terrain cut, which stays pixel-sharp.
    if (this.softShadows) this.softener.soften(l, devW, devH);
    l.setTransform(1, 0, 0, 1, 0, 0);
    l.globalCompositeOperation = "destination-out";
    l.drawImage(this.maskCanvas, 0, 0, devW, devH);
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.globalCompositeOperation = op;
    target.drawImage(this.layerCanvas, 0, 0, devW, devH);
    target.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** Accumulate this frame's light per wall cell. Returns true if any cell is lit. */
  private updateWallLight(game: Game): boolean {
    const world = game.world;
    if (!this.wallImage) {
      this.wallImage = new ImageData(world.width, world.height);
      this.wallCanvas.width = world.width;
      this.wallCanvas.height = world.height;
    }
    const data = this.wallImage.data;
    const W = world.width;

    // Clear only last frame's lit region.
    const prevX0 = this.dirtyX0;
    const prevY0 = this.dirtyY0;
    const prevX1 = this.dirtyX1;
    const prevY1 = this.dirtyY1;
    for (let y = prevY0; y <= prevY1; y++) {
      data.fill(0, (y * W + prevX0) * 4, (y * W + prevX1 + 1) * 4);
    }

    this.dirtyX0 = W;
    this.dirtyY0 = world.height;
    this.dirtyX1 = -1;
    this.dirtyY1 = -1;

    const lighting = game.lighting;
    for (let i = 0; i < lighting.softCount; i++) {
      const l = lighting.softLights[i];
      this.addWallLight(game, l.lit, l.x, l.y, l.radius, l.strength, SOFT_LUT);
    }
    const flashMult = game.muzzleFlashMultiplier;
    const flashLut = game.fieryMuzzleFlash ? FIERY_FLASH_LUT : FLASH_LUT;
    if (flashMult > 0) {
      for (const fl of game.flashes) {
        if (!fl.hasPolygon) continue;
        const intensity = Math.pow(Math.max(0, fl.life / fl.maxLife), 0.65) * flashMult;
        this.addWallLight(game, fl.lit, fl.x, fl.y, fl.radius, intensity, flashLut);
      }
    }

    // Upload the union of last frame's and this frame's regions.
    const x0 = Math.min(prevX0, this.dirtyX0);
    const y0 = Math.min(prevY0, this.dirtyY0);
    const x1 = Math.max(prevX1, this.dirtyX1);
    const y1 = Math.max(prevY1, this.dirtyY1);
    if (x1 >= x0 && y1 >= y0) {
      this.wallCtx.putImageData(this.wallImage, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
    }
    return this.dirtyX1 >= 0;
  }

  private addWallLight(
    game: Game,
    lit: LitCells,
    x: number,
    y: number,
    radius: number,
    strength: number,
    lut: Float32Array,
  ): void {
    const data = this.wallImage!.data;
    const W = game.world.width;
    const cs = game.world.cellSize;
    for (let i = 0; i < lit.count; i++) {
      const cell = lit.cells[i];
      const cx = cell % W;
      const cy = (cell - cx) / W;
      const t = Math.hypot((cx + 0.5) * cs - x, (cy + 0.5) * cs - y) / radius;
      if (t >= 1) continue;
      const e = Math.floor(t * LUT_STEPS) * 3;
      const p = cell * 4;
      data[p] += lut[e] * strength;
      data[p + 1] += lut[e + 1] * strength;
      data[p + 2] += lut[e + 2] * strength;
      data[p + 3] = 255;
      if (cx < this.dirtyX0) this.dirtyX0 = cx;
      if (cx > this.dirtyX1) this.dirtyX1 = cx;
      if (cy < this.dirtyY0) this.dirtyY0 = cy;
      if (cy > this.dirtyY1) this.dirtyY1 = cy;
    }
  }

  /** Draw a subtle screen-edge vignette for depth. */
  renderVignette(ctx: CanvasRenderingContext2D, viewW: number, viewH: number): void {
    const w = Math.max(1, Math.round(viewW));
    const h = Math.max(1, Math.round(viewH));
    if (this.vigW !== w || this.vigH !== h) {
      this.vigW = w;
      this.vigH = h;
      this.vignetteCanvas.width = w;
      this.vignetteCanvas.height = h;
      const vg = this.vignetteCanvas.getContext("2d")!;
      const cx = w / 2;
      const cy = h / 2;
      const r0 = Math.min(w, h) * 0.36;
      const r1 = Math.hypot(cx, cy);
      const grad = vg.createRadialGradient(cx, cy, r0, cx, cy, r1);
      grad.addColorStop(0, "rgba(0, 0, 0, 0)");
      grad.addColorStop(0.7, "rgba(2, 4, 10, 0.28)");
      grad.addColorStop(1, "rgba(1, 2, 6, 0.72)");
      vg.fillStyle = grad;
      vg.fillRect(0, 0, w, h);
    }
    ctx.drawImage(this.vignetteCanvas, 0, 0, w, h);
  }

  tracePolygonPath(
    g: CanvasRenderingContext2D,
    game: Game,
    poly: Float32Array,
    count: number,
  ): void {
    const cam = game.camera;
    g.beginPath();
    g.moveTo(cam.worldToScreenX(poly[0]), cam.worldToScreenY(poly[1]));
    for (let i = 1; i < count; i++) {
      g.lineTo(cam.worldToScreenX(poly[i * 2]), cam.worldToScreenY(poly[i * 2 + 1]));
    }
    g.closePath();
  }
}

function gradientFor(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  stops: readonly Stop[],
  strength: number,
): CanvasGradient {
  const grad = g.createRadialGradient(x, y, 0, x, y, radius);
  for (const [o, r, gr, b, a] of stops) {
    grad.addColorStop(o, `rgba(${r}, ${gr}, ${b}, ${a * strength})`);
  }
  return grad;
}
