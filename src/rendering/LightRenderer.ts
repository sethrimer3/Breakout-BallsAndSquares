import { hasVisibleGrowthGlows } from "./GrowthGlowVisibility";
import { LightRegion, type ScreenRect } from "./LightRegion";
import { visibleRoomLightIndices } from "./RoomLightIndex";
import { ChunkRegions } from "./ChunkRegions";
import { WallLightFalloff } from "./WallLightFalloff";
import { worldAtmosphere } from "../world/worldAtmosphere";
import { GROWTH, LIGHT, SOLDIER_AMBIENT_STOPS } from "../config";
import type { Game } from "../Game";
import type { LitCells } from "../systems/LightingSystem";
import { LIGHT_KIND } from "../world/PixelWorld";
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

/** Firelight from burning rubble and a flamethrower's nozzle: deep amber, no white core. */
const FIRE_STOPS: readonly Stop[] = [
  [0, 255, 176, 92, 0.85],
  [0.3, 255, 128, 44, 0.45],
  [0.7, 210, 70, 18, 0.12],
  [1, 130, 32, 0, 0],
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
const SOLDIER_LUT = buildLut(SOLDIER_AMBIENT_STOPS);
const FIRE_LUT = buildLut(FIRE_STOPS);

/** Ceiling panel light by `LIGHT_KIND`: cold clinical white, warm worn tube, sickly failing tube. */
const PANEL_COLORS: readonly (readonly [number, number, number])[] = [
  [200, 225, 255],
  [255, 222, 168],
  [190, 255, 220],
];
const PANEL_STOPS: readonly (readonly Stop[])[] = PANEL_COLORS.map(([r, g, b]) => [
  [0, r, g, b, 0.62],
  [0.35, r, g, b, 0.3],
  [0.75, r, g, b, 0.08],
  [1, r, g, b, 0],
]);
const PANEL_LUTS = PANEL_STOPS.map(buildLut);

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
  private maskState: {
    terrain: Game["terrain"]; revision: string; x: number; y: number; zoom: number;
    viewW: number; viewH: number; width: number; height: number; dpr: number; ambient: string;
  } | null = null;
  private maskCanvas: HTMLCanvasElement;
  private maskCtx: CanvasRenderingContext2D;
  private softener = new CanvasSoftener(SOFT_SHADOWS);
  /** Set per frame from the visual setting. */
  private softShadows = false;
  private emptyLightmap: { mask: object; soft: boolean } | null = null;
  private readonly layerRegion = new LightRegion();
  private previousLayerRegion: ScreenRect | null = null;
  private fixtureView: readonly number[] | null = null;
  private fixtureViewChanged = true;
  private readonly fixturePaths = new WeakMap<Float32Array, {
    count: number; screen: Path2D; x: number; y: number; zoom: number; w: number; h: number;
  }>();

  /** One pixel per world cell: light added to wall cells this frame. */
  private wallCanvas: HTMLCanvasElement;
  private wallCtx: CanvasRenderingContext2D;
  private wallImage: ImageData | null = null;
  private wallChunks = new Uint8Array(0);
  private previousWallChunks = new Uint8Array(0);
  private wallRegions: ChunkRegions | null = null;
  private readonly fixtureFalloff = new WallLightFalloff();
  private dirtyX0 = 0;
  private dirtyY0 = 0;
  private dirtyX1 = -1;
  private dirtyY1 = -1;

  constructor(private sprites: Sprites) {
    [this.lmCanvas, this.lmCtx] = makeLayer(false);
    [this.layerCanvas, this.layerCtx] = makeLayer(true);
    [this.maskCanvas, this.maskCtx] = makeLayer(true);
    [this.wallCanvas, this.wallCtx] = makeLayer(true);
  }

  /** Build the lightmap and composite it onto the scene in `ctx`. */
  renderLighting(ctx: CanvasRenderingContext2D, game: Game, dpr: number): void {
    const cam = game.camera;
    this.softShadows = game.softShadows;
    const view = this.fixtureView;
    this.fixtureViewChanged = !view || view[0] !== cam.x || view[1] !== cam.y || view[2] !== cam.zoom || view[3] !== cam.viewW || view[4] !== cam.viewH;
    if (this.fixtureViewChanged) this.fixtureView = [cam.x, cam.y, cam.zoom, cam.viewW, cam.viewH];
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

    const [ar, ag, ab] = worldAtmosphere(game.world, cam.x, cam.y)?.ambient ?? LIGHT.ambientRgb;
    const ambient = `rgb(${ar}, ${ag}, ${ab})`;

    // Reuse the ambient-colored silhouette while camera, size and terrain opacity
    // are unchanged. Pending chunk work invalidates it as each chunk is built.
    const m = this.maskState, terrain = game.terrain;
    const revision = terrain.visibleOpacityRevision(cam);
    if (!m || m.terrain !== terrain || m.revision !== revision ||
        m.x !== cam.x || m.y !== cam.y || m.zoom !== cam.zoom ||
        m.viewW !== cam.viewW || m.viewH !== cam.viewH || m.dpr !== dpr ||
        m.width !== devW || m.height !== devH || m.ambient !== ambient) {
      const mask = this.maskCtx;
      mask.setTransform(1, 0, 0, 1, 0, 0);
      mask.globalCompositeOperation = "source-over";
      mask.clearRect(0, 0, devW, devH);
      mask.setTransform(dpr, 0, 0, dpr, 0, 0);
      terrain.draw(mask, cam);
      mask.setTransform(1, 0, 0, 1, 0, 0);
      mask.globalCompositeOperation = "source-in";
      mask.fillStyle = ambient;
      mask.fillRect(0, 0, devW, devH);
      mask.globalCompositeOperation = "source-over";
      this.maskState = { terrain, revision, x: cam.x, y: cam.y,
        zoom: cam.zoom, viewW: cam.viewW, viewH: cam.viewH, width: devW, height: devH, dpr, ambient };
    }

    // Empty views need only the ambient/terrain result. Reuse that exact
    // upstream composite, including its blurred screen edges, instead of
    // repeating the full-screen primary pass. Any possible light disables it.
    // Partially covered backing pixels can retain color from earlier fills.
    // Preserve the full-render history path there instead of freezing that fringe.
    const growthCacheSafe = game.growth.glowCount === 0 || (devW <= viewW * dpr && devH <= viewH * dpr);
    let empty = growthCacheSafe && game.world.roomLights.length === 0 && game.flashes.length === 0;
    for (let i = 0; empty && i < game.lighting.softCount; i++) {
      const light = game.lighting.softLights[i];
      const x = cam.worldToScreenX(light.x), y = cam.worldToScreenY(light.y), r = light.radius * cam.zoom;
      if (light.lit.count > 0 || (x + r >= -2 && y + r >= -2 && x - r <= viewW + 2 && y - r <= viewH + 2)) empty = false;
    }
    if (empty && this.emptyLightmap?.mask === this.maskState && this.emptyLightmap.soft === this.softShadows &&
        !hasVisibleGrowthGlows(game.world, game.growth, cam, game.runStats.time)) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = "multiply";
      ctx.drawImage(this.lmCanvas, 0, 0);
      ctx.restore();
      return;
    }
    this.emptyLightmap = null;

    const g = this.lmCtx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 1) Fill with dark ambient illumination.
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
    g.fillStyle = ambient;
    g.fillRect(0, 0, viewW, viewH);

    // 2) Light in open air: glows and muzzle flashes, each clipped by its polygon.
    // Primary air lights use the upstream direct ambient-lightmap path. Only
    // the separate muzzle-scatter layer needs a temporary cropped buffer.
    const air = g;
    air.globalCompositeOperation = "lighter";
    const soft = game.lighting.softLights;
    for (let i = 0; i < game.lighting.softCount; i++) {
      const l = soft[i];
      const sx = cam.worldToScreenX(l.x);
      const sy = cam.worldToScreenY(l.y);
      const rad = l.radius * cam.zoom;
      if (sx + rad < -2 || sy + rad < -2 || sx - rad > viewW + 2 || sy - rad > viewH + 2) continue;
      if (l.polyCount >= 3) {
        this.tracePolygonPath(air, game, l.poly, l.polyCount);
        air.fillStyle = gradientFor(air, sx, sy, rad, l.warm ? FIRE_STOPS : l.soldier ? SOLDIER_AMBIENT_STOPS : SOFT_STOPS, l.strength);
        air.fill();
      } else {
        // Past the shadow budget, or inside new terrain: air only (masked below).
        air.globalAlpha = l.strength;
        air.drawImage(l.warm ? this.sprites.warmGlow : l.soldier ? this.sprites.soldierAmbientGlow : this.sprites.soldierGlow, sx - rad, sy - rad, rad * 2, rad * 2);
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
    // Ceiling panels: cached shadow-traced pools, so lab equipment and walls cast shadows.
    const now = performance.now() / 1000;
    for (const n of visibleRoomLightIndices(game.world, cam)) {
      const f = game.lighting.fixtures[n];
      if (!f || !f.poly) continue;
      const sx = cam.worldToScreenX(f.x);
      const sy = cam.worldToScreenY(f.y);
      const rad = f.radius * cam.zoom;
      if (sx + rad < 0 || sy + rad < 0 || sx - rad > viewW || sy - rad > viewH) continue;
      const level = game.terrain.lightLevel(f.light, now);
      if (level <= 0.02) continue;
      // Moving views keep the original path submission: rebuilding hundreds of
      // cached screen paths every frame allocates more than it saves.
      let path: Path2D | undefined;
      if (this.fixtureViewChanged) this.tracePolygonPath(air, game, f.poly, f.polyCount);
      else path = this.fixturePath(game, f.poly, f.polyCount);
      air.fillStyle = gradientFor(air, sx, sy, rad, PANEL_STOPS[panelIndex(f.light.kind)], level);
      if (path) air.fill(path);
      else air.fill();
    }
    if (this.softShadows) this.softener.soften(g, devW, devH);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = "source-over";
    g.drawImage(this.maskCanvas, 0, 0, devW, devH);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);

    g.globalCompositeOperation = "lighter";

    // 3) Dim crimson light from recently replicated hostile terrain cells.
    const gr = game.growth;
    let growthVisible = false;
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
        growthVisible = true;
        const a = 1 - age / dur;
        const cr = cs * 2.6 * cam.zoom;
        g.globalAlpha = a * 0.42;
        g.drawImage(this.sprites.crimsonGlow, sx - cr, sy - cr, cr * 2, cr * 2);
      }
      g.globalAlpha = 1;
    }

    // The lab's own ceiling panels and Blight glows, kept inside their rooms.
    game.terrain.drawRoomLight(g, cam, performance.now() / 1000, game.lighting.fixtures);

    // 4) Light on walls, whole cells at a time.
    const wallsLit = this.updateWallLight(game);
    if (wallsLit) game.terrain.drawCellOverlay(g, cam, this.wallCanvas, this.wallChunks);

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
        this.layerRegion.include(sx, sy, rad);
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
      game.terrain.drawCellOverlay(ctx, cam, this.wallCanvas, this.wallChunks);
      ctx.restore();
    }
    if (empty && !growthVisible && this.maskState) this.emptyLightmap = { mask: this.maskState, soft: this.softShadows };
  }

  /** Clear the shared light layer for additive drawing in CSS-pixel coordinates. */
  private beginLayer(_devW: number, _devH: number, dpr: number): CanvasRenderingContext2D {
    const l = this.layerCtx;
    l.setTransform(1, 0, 0, 1, 0, 0);
    l.globalCompositeOperation = "source-over";
    const previous = this.previousLayerRegion;
    if (previous) l.clearRect(previous.x, previous.y, previous.width, previous.height);
    this.layerRegion.reset();
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
    // Align every operation to the original full-canvas sampling grid. Clipping
    // rather than resizing/cropping preserves fractional-DPR blur and mask pixels.
    const padding = this.softShadows ? Math.ceil((SOFT_SHADOWS.blur * 6 + 3) / SOFT_SHADOWS.scale) + 2 : 2;
    const region = this.layerRegion.resolve(devW, devH, dpr, padding);
    this.previousLayerRegion = region;
    if (!region) return;
    const bounded = region.width !== devW || region.height !== devH;
    if (this.softShadows) this.softener.soften(l, devW, devH, bounded ? region : undefined);
    l.save();
    l.setTransform(1, 0, 0, 1, 0, 0);
    if (bounded) { l.beginPath(); l.rect(region.x, region.y, region.width, region.height); l.clip(); }
    l.globalCompositeOperation = "destination-out";
    l.drawImage(this.maskCanvas, 0, 0, devW, devH);
    l.restore();
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.globalCompositeOperation = op;
    target.save();
    if (bounded) { target.beginPath(); target.rect(region.x, region.y, region.width, region.height); target.clip(); }
    target.drawImage(this.layerCanvas, 0, 0, devW, devH);
    target.restore();
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
    const chunkCount = game.terrain.chunks.cols * game.terrain.chunks.rows;
    if (this.wallChunks.length !== chunkCount) {
      this.wallChunks = new Uint8Array(chunkCount);
      this.previousWallChunks = new Uint8Array(chunkCount);
      this.wallRegions = new ChunkRegions(world.width,world.height,game.terrain.chunks.chunkSize);
    }
    this.previousWallChunks.set(this.wallChunks);
    const regions = this.wallRegions!;
    const data = this.wallImage.data;
    const W = world.width;

    // Clear only last frame's lit region.
    const prevX0 = this.dirtyX0;
    const prevY0 = this.dirtyY0;
    const prevX1 = this.dirtyX1;
    const prevY1 = this.dirtyY1;
    regions.update(this.previousWallChunks,undefined,prevX0,prevY0,prevX1,prevY1);
    for(let i=0;i<regions.count;i++) {
      const k=i*4,x=regions.rects[k],y=regions.rects[k+1],w=regions.rects[k+2],h=regions.rects[k+3];
      for(let row=y;row<y+h;row++)data.fill(0,(row*W+x)*4,(row*W+x+w)*4);
    }
    this.wallChunks.fill(0);

    this.dirtyX0 = W;
    this.dirtyY0 = world.height;
    this.dirtyX1 = -1;
    this.dirtyY1 = -1;

    const lighting = game.lighting;
    for (let i = 0; i < lighting.softCount; i++) {
      const l = lighting.softLights[i];
      this.addWallLight(game, l.lit, l.x, l.y, l.radius, l.strength, l.warm ? FIRE_LUT : l.soldier ? SOLDIER_LUT : SOFT_LUT);
    }
    const now = performance.now() / 1000;
    const cam = game.camera;
    const vx0 = cam.screenToWorldX(0), vy0 = cam.screenToWorldY(0);
    const vx1 = cam.screenToWorldX(cam.viewW), vy1 = cam.screenToWorldY(cam.viewH);
    for (const f of lighting.fixtures) {
      if (!f || !f.poly || f.lit.count === 0) continue;
      if (f.x + f.radius < vx0 || f.y + f.radius < vy0 || f.x - f.radius > vx1 || f.y - f.radius > vy1) continue;
      const level = game.terrain.lightLevel(f.light, now);
      if (level <= 0.02) continue;
      this.addWallLight(game, f.lit, f.x, f.y, f.radius, level, PANEL_LUTS[panelIndex(f.light.kind)], true);
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
    regions.update(this.wallChunks,this.previousWallChunks,x0,y0,x1,y1);
    for(let i=0;i<regions.count;i++) {
      const k=i*4;
      this.wallCtx.putImageData(this.wallImage,0,0,regions.rects[k],regions.rects[k+1],regions.rects[k+2],regions.rects[k+3]);
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
    fixedFixture = false,
  ): void {
    const data = this.wallImage!.data;
    const W = game.world.width;
    const cs = game.world.cellSize;
    const offsets = fixedFixture ? this.fixtureFalloff.get(lit,x,y,radius,W,cs,LUT_STEPS) : null;
    for (let i = 0; i < lit.count; i++) {
      const cell = lit.cells[i];
      const cx = cell % W;
      const cy = (cell - cx) / W;
      let e: number;
      if (offsets) {
        e = offsets[i];
        if (e < 0) continue;
      } else {
        const t = Math.hypot((cx + 0.5) * cs - x, (cy + 0.5) * cs - y) / radius;
        if (t >= 1) continue;
        e = Math.floor(t * LUT_STEPS) * 3;
      }
      const p = cell * 4;
      data[p] += lut[e] * strength;
      data[p + 1] += lut[e + 1] * strength;
      data[p + 2] += lut[e + 2] * strength;
      data[p + 3] = 255;
      const chunks = game.terrain.chunks;
      this.wallChunks[Math.floor(cy / chunks.chunkSize) * chunks.cols + Math.floor(cx / chunks.chunkSize)] = 1;
      if (cx < this.dirtyX0) this.dirtyX0 = cx;
      if (cx > this.dirtyX1) this.dirtyX1 = cx;
      if (cy < this.dirtyY0) this.dirtyY0 = cy;
      if (cy > this.dirtyY1) this.dirtyY1 = cy;
    }
  }

  /** Fixtures receive a fresh polygon array on every shadow retrace. */
  private fixturePath(game: Game, poly: Float32Array, count: number): Path2D {
    const cam = game.camera;
    let cached = this.fixturePaths.get(poly);
    if (!cached || cached.count !== count) {
      cached = { count, screen: new Path2D(), x: NaN, y: NaN, zoom: NaN, w: NaN, h: NaN };
      this.fixturePaths.set(poly, cached);
    }
    if (cached.x !== cam.x || cached.y !== cam.y || cached.zoom !== cam.zoom || cached.w !== cam.viewW || cached.h !== cam.viewH) {
      const screen = new Path2D();
      // Match the original subtraction-before-multiplication exactly. Native
      // transforms of world-space paths can change fractional-zoom edge pixels.
      screen.moveTo(cam.worldToScreenX(poly[0]), cam.worldToScreenY(poly[1]));
      for (let i = 1; i < count; i++) screen.lineTo(cam.worldToScreenX(poly[i * 2]), cam.worldToScreenY(poly[i * 2 + 1]));
      screen.closePath();
      cached.screen = screen;
      cached.x = cam.x; cached.y = cam.y; cached.zoom = cam.zoom; cached.w = cam.viewW; cached.h = cam.viewH;
    }
    return cached.screen;
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

function panelIndex(kind: number): number {
  return kind === LIGHT_KIND.dim ? 1 : kind === LIGHT_KIND.flicker ? 2 : 0;
}
