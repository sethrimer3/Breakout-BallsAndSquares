import { boundaryColor } from "../world/MapBoundary";
import { traceSurfaceOutline } from "./surfaceOutline";
import { COLORS, FACILITY, TERRAIN, TERRAIN as T, zoneForDepth } from "../config";
import { EDGE_PIXELS_PER_SUB, markBlightEdges } from "./blightEdges";
import { paintPortal } from "./portalNoise";
import type { CameraSystem } from "../systems/CameraSystem";
import { hash2 } from "../core/math";
import { DECOR } from "../world/LabDetails";
import { materialColor, TEX, TIER_PAINT, crackTexelAt, materialShade } from "./materials";
import { roomLightPosition, LIGHT_KIND, MAT, SUB, type PixelWorld, type RoomLight } from "../world/PixelWorld";
import { TerrainChunks } from "../world/TerrainChunks";

type RGB = readonly [number, number, number];
type Ramp4 = readonly [RGB, RGB, RGB, RGB];

/** How large the burning dimension's noise reads through a Blight edge. */
const EDGE_FIRE_RATIO = 0.7;
/** Steps a second the edge fire redraws at (motion, not camera, drives this). */
const EDGE_FIRE_FPS = 15;
/** Below this zoom the edges are so thin the fire paints at half size, then scales up. */
const EDGE_FIRE_FULL_ZOOM = 1.5;
/** The moment dormant Blight's edge fire is stopped at (any fixed time works). */
const FROZEN_FIRE_TIME = 7.25;
/** Edge canvases grow in steps this size, so a moving view doesn't reallocate them. */
const EDGE_CANVAS_STEP = 256;
/** Matte albedo of crystal veins: tier 2 orange, tier 3 green. */
const CRYSTAL_ORANGE = [212, 120, 48] as const;
const CRYSTAL_GREEN = [70, 182, 118] as const;

/** A soft round light falloff in one color, for drawing scaled into the lightmap. */
function radialSprite(c: RGB): HTMLCanvasElement {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext("2d")!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},1)`);
  grad.addColorStop(0.4, `rgba(${c[0]},${c[1]},${c[2]},0.5)`);
  grad.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return canvas;
}

/**
 * A failing fluorescent tube: dark most of the time, then a burst of stutters,
 * sometimes catching for a moment. `phase` (0..1) staggers tubes apart.
 */
export function flickerLevel(t: number, phase: number): number {
  const period = 2.5 + phase * 3;
  const f = ((t + phase * 17) % period) / period;
  if (f > 0.35) return 0.04;
  const step = Math.floor(t * 14);
  const h = hash2(step, Math.floor(phase * 1000), 91);
  if (f > 0.22) return h < 0.85 ? 0.95 : 0.2; // caught, with a hiccup
  return h < 0.45 ? 0.9 : 0.06;
}

function mix(a: RGB, b: RGB, t: number, out: number[]): void {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
}

function sampleRamp(ramp: Ramp4, t: number, out: number[]): void {
  if (t < 1 / 3) mix(ramp[0], ramp[1], t * 3, out);
  else if (t < 2 / 3) mix(ramp[1], ramp[2], (t - 1 / 3) * 3, out);
  else mix(ramp[2], ramp[3], (t - 2 / 3) * 3, out);
}

/**
 * True when texel (ox, oy) lies on the band `depth` texels in from an open
 * diagonal neighbor, joining the bands of the two walls that meet at an inside
 * corner (depth 0 is the outer lip, 1 the paint stripe).
 */
export function innerCornerBand(
  ox: number,
  oy: number,
  ul: boolean,
  ur: boolean,
  dl: boolean,
  dr: boolean,
  depth: number,
): boolean {
  const lo = depth;
  const hi = TEX - 1 - depth;
  const hit = (col: number, row: number, left: boolean, upper: boolean): boolean =>
    (ox === col && (upper ? oy <= row : oy >= row)) || (oy === row && (left ? ox <= col : ox >= col));
  return (
    (ul && hit(lo, lo, true, true)) ||
    (ur && hit(hi, lo, false, true)) ||
    (dl && hit(lo, hi, true, false)) ||
    (dr && hit(hi, hi, false, false))
  );
}

/** Cheap integer hash to 0..1, for activity-light flicker. */
function hash01(n: number): number {
  n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d);
  n = Math.imul(n ^ (n >>> 12), 0x297a2d39);
  return ((n ^ (n >>> 15)) >>> 0) / 4294967296;
}

/** Brightness (0..1) of a status light with rhythm `r` (0..63) at `time`. */
function ledLevel(r: number, time: number): number {
  const rate = 0.5 + (r & 7) * 0.22;
  const phase = (r >> 3) / 8;
  const f = (time * rate + phase) % 1;
  switch (r % 4) {
    case 0:
      // Slow steady blink.
      return f < 0.5 ? 1 : 0;
    case 1:
      // Disk/network activity: random flicker.
      return hash01(Math.floor(time * 9) * 64 + r) > 0.45 ? 1 : 0.1;
    case 2:
      // Mostly on, with a short blip off.
      return f < 0.88 ? 0.9 : 0;
    default:
      // Heartbeat double blink.
      return f < 0.1 || (f > 0.2 && f < 0.3) ? 1 : 0.05;
  }
}

/**
 * Renders terrain via cached 1-pixel-per-cell chunk canvases scaled up with
 * nearest-neighbor sampling, so terrain stays crisp at any zoom.
 */
export class TerrainRenderer {
  /** Changes only when cached terrain artwork changes, for dependent raster caches. */
  renderRevision = 0;
  readonly chunks: TerrainChunks;
  private canvases: HTMLCanvasElement[] = [];
  private surfaceOutlines: (Path2D | null)[] = [];
  /** One pixel per world cell: what the lab's emergency power keeps lit. */
  private glowCanvas: HTMLCanvasElement;
  private image: ImageData;
  private scratch: number[] = [];
  private col = [0, 0, 0];
  rebuiltLastFrame = 0;
  /** Per chunk: a mask of its Blight edges, made the first time it has any. */
  private edgeMasks: (HTMLCanvasElement | null)[] = [];
  private edgeLive: Uint8Array;
  private edgeBits: Uint8Array;
  private edgeSolid: Uint8Array;
  private edgeImage: ImageData;
  /** Bumped whenever a chunk's mask changes, so the fire knows to repaint. */
  private edgeVersion = 0;
  private edgeUnion = document.createElement("canvas");
  private edgeFire = document.createElement("canvas");
  private edgeFireLow = document.createElement("canvas");
  private edgeFireKey = "";
  /** Per chunk: the edges of dormant Blight, drawn with a frozen, darkened fire. */
  private dormantMasks: (HTMLCanvasElement | null)[] = [];
  private dormantLive: Uint8Array;
  private dormantVersion = 0;
  private dormantUnion = document.createElement("canvas");
  private dormantFire = document.createElement("canvas");
  private dormantFireKey = "";
  /** True for a half-size subcell index whose colony has no living generator. */
  dormantAt: ((si: number) => boolean) | null = null;
  /** Subcell indices of every blinking status light and pulsing machine core. */
  private lights = new Int32Array(0);
  /** `TEX` texels per world cell: the lab's floors, under the terrain. */
  private floorCanvas: HTMLCanvasElement;
  private floorRevision = 0;
  private floorView = document.createElement("canvas");
  private floorViewKey = "";
  /** Soft round light sprites (white and Blight pink) for the room lights. */
  private panelGlow: HTMLCanvasElement;
  private blightGlow: HTMLCanvasElement;
  private reducedMotion: MediaQueryList | null =
    typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;

  constructor(private world: PixelWorld, chunkSize: number) {
    this.chunks = new TerrainChunks(world, chunkSize);
    const n = this.chunks.cols * this.chunks.rows;
    const subChunk = chunkSize * 2;
    this.surfaceOutlines = new Array<Path2D | null>(n).fill(null);
    for (let i = 0; i < n; i++) {
      const c = document.createElement("canvas");
      c.width = chunkSize * TEX;
      c.height = chunkSize * TEX;
      this.canvases.push(c);
    }
    this.image = new ImageData(chunkSize * TEX, chunkSize * TEX);
    const edgeSize = subChunk * EDGE_PIXELS_PER_SUB;
    this.edgeMasks = new Array<HTMLCanvasElement | null>(n).fill(null);
    this.edgeLive = new Uint8Array(n);
    this.dormantMasks = new Array<HTMLCanvasElement | null>(n).fill(null);
    this.dormantLive = new Uint8Array(n);
    this.edgeBits = new Uint8Array(edgeSize * edgeSize);
    this.edgeSolid = new Uint8Array((subChunk + 2) * (subChunk + 2));
    this.edgeImage = new ImageData(edgeSize, edgeSize);
    this.edgeImage.data.fill(255);
    this.chunks.markAll();
    this.glowCanvas = document.createElement("canvas");
    this.glowCanvas.width = world.width;
    this.glowCanvas.height = world.height;
    this.floorCanvas = document.createElement("canvas");
    this.floorCanvas.width = world.width * TEX;
    this.floorCanvas.height = world.height * TEX;
    this.panelGlow = radialSprite([255, 255, 255]);
    this.blightGlow = radialSprite([255, 70, 160]);
    // Broken or overgrown machinery goes dark.
    world.addListener((cx, cy, kind) => {
      if (kind === "destroyed" || kind === "grown") {
        this.glowCanvas.getContext("2d")!.clearRect(cx, cy, 1, 1);
      }
      // Walls coming down (or Blight filling in) move the floor's contact shadows.
      if (kind !== "damaged") this.paintFloor(cx - 1, cy - 1, cx + 1, cy + 1);
    });
  }

  /** Rebuild everything immediately (e.g. after generating a new world). */
  rebuildAll(): void {
    this.chunks.markAll();
    this.chunks.take(Infinity, this.scratch);
    for (const k of this.scratch) this.buildChunk(k);
    this.buildGlow();
    this.buildFloor();
    this.collectLights();
  }

  /** Paint every lab floor. */
  private buildFloor(): void {
    this.paintFloor(0, 0, this.world.width - 1, this.world.height - 1);
  }

  /**
   * Paint the lab floors in cells (x0..x1, y0..y1): matte tiles four cells
   * across with thin dark grout, each tile a slightly different shade, fine
   * grain, and a soft contact shadow where the floor meets a standing wall.
   * Empty cells with no decor stay clear, so the cavity background shows
   * through dug-out rock.
   */
  private paintFloor(x0: number, y0: number, x1: number, y1: number): void {
    this.floorRevision++;
    const w = this.world;
    x0 = Math.max(0, x0);
    y0 = Math.max(0, y0);
    x1 = Math.min(w.width - 1, x1);
    y1 = Math.min(w.height - 1, y1);
    if (x1 < x0 || y1 < y0) return;
    const g = this.floorCanvas.getContext("2d")!;
    const iw = (x1 - x0 + 1) * TEX;
    const image = g.createImageData(iw, (y1 - y0 + 1) * TEX);
    const data = image.data;
    const pal = COLORS.labDecor;
    const W = w.width;
    const solid = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < w.height && w.health[y * W + x] > 0;
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const d = w.decor[cy * W + cx];
        if (d === 0) continue;
        const tiled = d === DECOR.cleanSeam || d === DECOR.floorLine;
        const tileTone = 0.93 + hash2(cx >> 2, cy >> 2, 303) * 0.14;
        // Walls standing next to this cell, for the contact shadow.
        const nU = solid(cx, cy - 1);
        const nD = solid(cx, cy + 1);
        const nL = solid(cx - 1, cy);
        const nR = solid(cx + 1, cy);
        const nUL = solid(cx - 1, cy - 1);
        const nUR = solid(cx + 1, cy - 1);
        const nDL = solid(cx - 1, cy + 1);
        const nDR = solid(cx + 1, cy + 1);
        for (let k = 0; k < TEX * TEX; k++) {
          const tx = k % TEX;
          const ty = (k - tx) / TEX;
          const gx = cx * TEX + tx;
          const gy = cy * TEX + ty;
          let c: RGB = pal[d];
          let v = 1;
          if (tiled) {
            // One-texel grout along the top and left edge of each 4-cell tile.
            const seam = (cx % 4 === 0 && tx === 0) || (cy % 4 === 0 && ty === 0);
            if (!seam) {
              c = pal[d === DECOR.cleanSeam ? DECOR.cleanFloor : DECOR.floor];
              v = tileTone;
            }
          } else if (d === DECOR.grime || d === DECOR.blightStain) {
            // Grime and stains soak in unevenly, speckled over the old floor.
            if (hash2(gx, gy, 131) < 0.3) c = pal[DECOR.floor];
          }
          v *= 0.94 + hash2(gx, gy, 77) * 0.12;
          // Contact shadow: darkest against the wall, fading over half a cell.
          let ao = 1;
          const near = (dist: number): number => (dist === 0 ? 0.5 : dist === 1 ? 0.72 : 0.9);
          if (nU && ty < 3) ao = Math.min(ao, near(ty));
          if (nD && ty > 0) ao = Math.min(ao, near(TEX - 1 - ty));
          if (nL && tx < 3) ao = Math.min(ao, near(tx));
          if (nR && tx > 0) ao = Math.min(ao, near(TEX - 1 - tx));
          if (nUL && tx + ty < 2) ao = Math.min(ao, near(tx + ty));
          if (nUR && TEX - 1 - tx + ty < 2) ao = Math.min(ao, near(TEX - 1 - tx + ty));
          if (nDL && tx + TEX - 1 - ty < 2) ao = Math.min(ao, near(tx + TEX - 1 - ty));
          if (nDR && 2 * (TEX - 1) - tx - ty < 2) ao = Math.min(ao, near(2 * (TEX - 1) - tx - ty));
          v *= ao;
          const p = (((cy - y0) * TEX + ty) * iw + (cx - x0) * TEX + tx) * 4;
          data[p] = Math.min(255, c[0] * v);
          data[p + 1] = Math.min(255, c[1] * v);
          data[p + 2] = Math.min(255, c[2] * v);
          data[p + 3] = 255;
        }
      }
    }
    g.putImageData(image, x0 * TEX, y0 * TEX);
  }

  /** Draw the lab floors. Call before `draw`, in the albedo pass. */
  drawFloor(ctx: CanvasRenderingContext2D, cam: CameraSystem): void {
    ctx.imageSmoothingEnabled = false;
    const transform = ctx.getTransform();
    // Main gameplay and the menu use an origin-aligned, uniform device scale.
    // Keep the direct path for other transforms rather than changing their output.
    const scale = transform.a;
    const cacheable = scale > 0 && transform.d === scale && transform.b === 0 &&
      transform.c === 0 && transform.e === 0 && transform.f === 0;
    const direct = (target: CanvasRenderingContext2D): void => {
      const cs = this.chunks.chunkSize;
      this.forEachVisibleChunk(cam, (kx, ky, sx, sy, sw, sh) => {
        target.drawImage(this.floorCanvas, kx * cs * TEX, ky * cs * TEX, cs * TEX, cs * TEX, sx, sy, sw, sh);
      });
    };
    if (!cacheable) { direct(ctx); return; }
    const key = [this.floorRevision, cam.x, cam.y, cam.zoom, cam.viewW, cam.viewH, scale].join(":");
    if (key !== this.floorViewKey) {
      const width = Math.max(1, Math.ceil(cam.viewW * scale));
      const height = Math.max(1, Math.ceil(cam.viewH * scale));
      if (this.floorView.width !== width) this.floorView.width = width;
      if (this.floorView.height !== height) this.floorView.height = height;
      const target = this.floorView.getContext("2d")!;
      target.setTransform(1, 0, 0, 1, 0, 0);
      target.clearRect(0, 0, width, height);
      target.setTransform(scale, 0, 0, scale, 0, 0);
      target.imageSmoothingEnabled = false;
      direct(target);
      this.floorViewKey = key;
    }
    ctx.drawImage(this.floorView, 0, 0, this.floorView.width / scale, this.floorView.height / scale);
  }

  /** Brightness (0..1) of a room light at wall-clock `t`; 0 when it is off or gone. */
  lightLevel(l: RoomLight, t: number, still = this.reducedMotion?.matches ?? false): number {
    if (l.destroyed) return 0;
    const w = this.world;
    if (l.kind === LIGHT_KIND.blight) {
      const core = l.coreId ? w.blightCores[l.coreId - 1] : undefined;
      if (!core || !core.alive) return 0;
      return still ? 0.8 : 0.7 + 0.3 * Math.sin(t * 1.3 + l.phase * 6.28);
    }
    if (l.kind !== LIGHT_KIND.wash) {
      // A panel goes dark once Blight grows over it or rock fills its cell.
      const i = l.y0 * w.width + l.x0;
      if (w.decor[i] !== DECOR.lightPanel || w.blight[i] > 0) return 0;
      if (l.wallFace ? w.health[i] === 0 : w.health[i] > 0) return 0;
    }
    if (l.kind === LIGHT_KIND.flicker) return still ? 0.35 : flickerLevel(t, l.phase);
    return 1;
  }

  /** Repaint a shot-out panel without rebuilding the whole floor texture. */
  darkenFixture(light: RoomLight): void {
    this.paintFloor(light.x0, light.y0, light.x1, light.y1);
    if (light.wallFace) this.chunks.markCell(light.x0, light.y0);
  }

  /**
   * Add the lab's own lighting to the lightmap: an even wash over pristine
   * rooms and halls, a pool under each working panel, and a pink glow around
   * each living Blight Core. Each light stays inside its room.
   */
  drawRoomLight(
    g: CanvasRenderingContext2D,
    cam: CameraSystem,
    time: number,
    shadowed?: readonly ({ poly: Float32Array | null } | null)[],
  ): void {
    const w = this.world;
    const lights = w.roomLights;
    if (lights.length === 0) return;
    const still = this.reducedMotion?.matches ?? false;
    const cs = w.cellSize;
    const vx0 = cam.screenToWorldX(0) / cs - 2;
    const vy0 = cam.screenToWorldY(0) / cs - 2;
    const vx1 = cam.screenToWorldX(cam.viewW) / cs + 2;
    const vy1 = cam.screenToWorldY(cam.viewH) / cs + 2;
    const z = cam.zoom;
    g.save();
    g.globalCompositeOperation = "lighter";
    for (let n = 0; n < lights.length; n++) {
      const l = lights[n];
      // Panels already drawn with shadows (LightRenderer) skip the flat pool.
      if (shadowed?.[n]?.poly) continue;
      if (l.cx1 < vx0 || l.cy1 < vy0 || l.cx0 > vx1 || l.cy0 > vy1) continue;
      const level = this.lightLevel(l, time, still);
      if (level <= 0.02) continue;
      const rx = cam.worldToScreenX(l.cx0 * cs);
      const ry = cam.worldToScreenY(l.cy0 * cs);
      const rw = (l.cx1 - l.cx0 + 1) * cs * z;
      const rh = (l.cy1 - l.cy0 + 1) * cs * z;
      if (l.kind === LIGHT_KIND.wash) {
        g.globalAlpha = FACILITY.washStrength;
        g.fillStyle = "rgb(176, 164, 140)";
        g.fillRect(rx, ry, rw, rh);
        continue;
      }
      g.save();
      g.beginPath();
      g.rect(rx, ry, rw, rh);
      g.clip();
      const source = roomLightPosition(l, cs);
      const mx = cam.worldToScreenX(source.x);
      const my = cam.worldToScreenY(source.y);
      let rad: number;
      if (l.kind === LIGHT_KIND.blight) {
        rad = Math.max(rw, rh) * 0.75;
        g.globalAlpha = level * FACILITY.blightGlowStrength;
        g.drawImage(this.blightGlow, mx - rad, my - rad, rad * 2, rad * 2);
      } else {
        rad = FACILITY.panelRadiusCells * cs * z;
        const strength = l.kind === LIGHT_KIND.bright ? 0.55 : l.kind === LIGHT_KIND.dim ? 0.4 : 0.6;
        g.globalAlpha = level * strength;
        g.drawImage(this.panelGlow, mx - rad, my - rad, rad * 2, rad * 2);
      }
      g.restore();
    }
    g.restore();
  }

  /** The lit tubes themselves, drawn additively after the lighting pass. */
  drawPanels(ctx: CanvasRenderingContext2D, cam: CameraSystem, time: number): void {
    const w = this.world;
    const still = this.reducedMotion?.matches ?? false;
    const cs = w.cellSize;
    const vx0 = cam.screenToWorldX(0) / cs - 2;
    const vy0 = cam.screenToWorldY(0) / cs - 2;
    const vx1 = cam.screenToWorldX(cam.viewW) / cs + 2;
    const vy1 = cam.screenToWorldY(cam.viewH) / cs + 2;
    const z = cam.zoom;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const l of w.roomLights) {
      if (l.kind === LIGHT_KIND.wash || l.kind === LIGHT_KIND.blight) continue;
      if (l.x1 < vx0 || l.y1 < vy0 || l.x0 > vx1 || l.y0 > vy1) continue;
      const level = this.lightLevel(l, time, still);
      if (level <= 0.02) continue;
      const x = cam.worldToScreenX(l.x0 * cs);
      const y = cam.worldToScreenY(l.y0 * cs);
      const pw = (l.x1 - l.x0 + 1) * cs * z;
      const ph = (l.y1 - l.y0 + 1) * cs * z;
      ctx.fillStyle = l.kind === LIGHT_KIND.bright ? "rgb(200, 225, 255)" : l.kind === LIGHT_KIND.dim ? "rgb(255, 225, 170)" : "rgb(190, 255, 220)";
      if (l.wallFace) {
        // A dark recess with a narrow tube flush to the hallway-facing wall lip.
        const unit = cs * z, horizontal = l.wallFace === "north" || l.wallFace === "south";
        const tx = x + (horizontal ? .15 : l.wallFace === "east" ? .75 : .1) * unit;
        const ty = y + (horizontal ? l.wallFace === "south" ? .75 : .1 : .15) * unit;
        const tw = (horizontal ? .7 : .15) * unit, th = (horizontal ? .15 : .7) * unit;
        const color = ctx.fillStyle;
        ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
        ctx.fillStyle = "#080c10"; ctx.fillRect(tx-unit*.06,ty-unit*.06,tw+unit*.12,th+unit*.12);
        ctx.fillStyle = color; ctx.globalAlpha = level * .9;
        ctx.fillRect(tx,ty,tw,th);
        ctx.globalCompositeOperation = "lighter";
        continue;
      }
      // Halo, then the tube, inset half a subcell so the panel frame shows.
      ctx.globalAlpha = level * 0.18;
      ctx.fillRect(x - cs * z * 0.5, y - cs * z * 0.5, pw + cs * z, ph + cs * z);
      ctx.globalAlpha = level * 0.85;
      const inset = cs * z * 0.25;
      ctx.fillRect(x + inset, y + inset, pw - inset * 2, ph - inset * 2);
    }
    ctx.restore();
  }

  private collectLights(): void {
    const { subKind, subHealth } = this.world;
    const found: number[] = [];
    for (let si = 0; si < subKind.length; si++) {
      const k = subKind[si];
      if (subHealth[si] > 0 && (k === SUB.led || k === SUB.core)) found.push(si);
    }
    this.lights = Int32Array.from(found);
  }

  /**
   * Blinking status lights and pulsing machine cores, drawn additively after the
   * lighting pass so they shine in the dark. `still` (reduced motion) holds them steady.
   */
  drawLabLights(ctx: CanvasRenderingContext2D, cam: CameraSystem, time: number, still: boolean): void {
    const w = this.world;
    const lights = this.lights;
    if (lights.length === 0) return;
    const ss = w.subCellSize;
    const sw = w.subWidth;
    const x0 = Math.floor(cam.screenToWorldX(0) / ss) - 2;
    const y0 = Math.floor(cam.screenToWorldY(0) / ss) - 2;
    const x1 = Math.ceil(cam.screenToWorldX(cam.viewW) / ss) + 2;
    const y1 = Math.ceil(cam.screenToWorldY(cam.viewH) / ss) + 2;
    const px = ss * cam.zoom;
    const t = still ? 0 : time;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let n = 0; n < lights.length; n++) {
      const si = lights[n];
      const sx = si % sw;
      const sy = (si - sx) / sw;
      if (sx < x0 || sx > x1 || sy < y0 || sy > y1 || w.subHealth[si] === 0) continue;
      const k = w.subKind[si];
      const tint = w.subTint[si];
      const r = tint & 63;
      let level: number;
      let c: RGB;
      if (k === SUB.led) {
        c = COLORS.labLed[tint >> 6];
        level = still ? 0.8 : ledLevel(r, t);
      } else if (k === SUB.core) {
        c = COLORS.labCore[tint >> 6];
        level = still ? 0.7 : 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * (1.2 + (r & 7) * 0.15) + (sx + sy) * 0.45 + (r >> 3)));
      } else continue;
      if (level <= 0.02) continue;
      const lx = cam.worldToScreenX(sx * ss);
      const ly = cam.worldToScreenY(sy * ss);
      ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
      // Soft halo, then the lit pixel itself.
      ctx.globalAlpha = level * (k === SUB.core ? 0.16 : 0.12);
      ctx.fillRect(lx - px, ly - px, px * 3, px * 3);
      ctx.globalAlpha = level;
      ctx.fillRect(lx, ly, px, px);
    }
    ctx.restore();
  }

  private buildGlow(): void {
    const { world } = this;
    const g = this.glowCanvas.getContext("2d")!;
    const image = g.createImageData(world.width, world.height);
    for (let i = 0; i < world.decor.length; i++) {
      if (world.health[i] === 0) {
        // Half-size screens and status LEDs cast a soft monitor glow over their cell.
        const sc = this.screenIn(i);
        if (sc >= 0) {
          const c = sc < 4 ? COLORS.labScreen[sc] : COLORS.labCore[sc - 4];
          const p = i * 4;
          image.data[p] = c[0] * 0.4;
          image.data[p + 1] = c[1] * 0.4;
          image.data[p + 2] = c[2] * 0.4;
          image.data[p + 3] = 255;
        }
        continue;
      }
      const c = COLORS.labGlow[world.decor[i]];
      if ((c[0] === 0 && c[1] === 0 && c[2] === 0) || world.health[i] === 0) continue;
      const p = i * 4;
      image.data[p] = c[0];
      image.data[p + 1] = c[1];
      image.data[p + 2] = c[2];
      image.data[p + 3] = 255;
    }
    g.putImageData(image, 0, 0);
  }

  /** Screen color index of the first live screen sub-pixel in cell `i` (4+ for a machine core), or -1. */
  private screenIn(i: number): number {
    const w = this.world;
    const cx = i % w.width;
    const cy = (i - cx) / w.width;
    for (let k = 0; k < 4; k++) {
      const si = (cy * 2 + (k >> 1)) * w.subWidth + cx * 2 + (k & 1);
      if (w.subHealth[si] > 0 && w.subKind[si] === SUB.screen) return (w.subTint[si] >> 6) & 3;
      if (w.subHealth[si] > 0 && w.subKind[si] === SUB.core) return 4 + ((w.subTint[si] >> 6) & 3);
    }
    return -1;
  }

  /** Add the lab's slowly pulsing glow. Call after the lighting pass. */
  drawLabGlow(ctx: CanvasRenderingContext2D, cam: CameraSystem, time: number): void {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.8 + 0.2 * Math.sin(time * 1.6);
    this.drawCellOverlay(ctx, cam, this.glowCanvas);
    ctx.restore();
  }

  private buildChunk(k: number): void {
    this.renderRevision++;
    const { world } = this;
    const cs = this.chunks.chunkSize;
    const texCs = cs * TEX;
    const kx = k % this.chunks.cols;
    const ky = Math.floor(k / this.chunks.cols);
    const data = this.image.data;
    const W = world.width;
    const health = world.health;
    const tint = world.tint;
    const col = this.col;
    const maxCap = T.maxHealthCap;
    const put = (tx: number, ty: number, r: number, g: number, b: number, a: number): void => {
      const p = (ty * texCs + tx) * 4;
      data[p] = r < 0 ? 0 : r > 255 ? 255 : r;
      data[p + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
      data[p + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
      data[p + 3] = a;
    };
    for (let ly = 0; ly < cs; ly++) {
      const cy = ky * cs + ly;
      for (let lx = 0; lx < cs; lx++) {
        const cx = kx * cs + lx;
        const tx0 = lx * TEX;
        const ty0 = ly * TEX;
        if (cx >= W || cy >= world.height) {
          for (let t = 0; t < TEX * TEX; t++) put(tx0 + (t % TEX), ty0 + Math.floor(t / TEX), 0, 0, 0, 0);
          continue;
        }
        const i = cy * W + cx;
        const hp = health[i];
        if (hp === 0) {
          // Half-size pixels (Blight, rubble, lab equipment): 2×2 texels each.
          for (let dy = 0; dy < 2; dy++) {
            for (let dx = 0; dx < 2; dx++) {
              const sx = cx * 2 + dx;
              const sy = cy * 2 + dy;
              const si = sy * world.subWidth + sx;
              const subHp = world.subHealth[si];
              const bx = tx0 + dx * 2;
              const by = ty0 + dy * 2;
              if (subHp === 0) {
                put(bx, by, 0, 0, 0, 0);
                put(bx + 1, by, 0, 0, 0, 0);
                put(bx, by + 1, 0, 0, 0, 0);
                put(bx + 1, by + 1, 0, 0, 0, 0);
                continue;
              }
              this.subColor(si, sx, sy, subHp, col);
              const subUp = sy > 0 && !world.subSolidAt(sx, sy - 1);
              const subLeft = sx > 0 && !world.subSolidAt(sx - 1, sy);
              const subDown = sy < world.subHeight - 1 && !world.subSolidAt(sx, sy + 1);
              const subRight = sx < world.subWidth - 1 && !world.subSolidAt(sx + 1, sy);
              const sk = world.subKind[si];
              const flat = sk === SUB.screen || sk === SUB.led || sk === SUB.core;
              for (let oy = 0; oy < 2; oy++) {
                for (let ox = 0; ox < 2; ox++) {
                  let m = flat ? 1 : 0.92 + hash2(sx * 2 + ox, sy * 2 + oy, 5) * 0.16;
                  let add = 0;
                  // A lit lip on the faces toward the upper left, a shadow on the others.
                  if ((subUp && oy === 0) || (subLeft && ox === 0)) {
                    m *= 1.4;
                    add = 8;
                  } else if ((subDown && oy === 1) || (subRight && ox === 1)) {
                    m *= 0.7;
                  }
                  put(bx + ox, by + oy, col[0] * m + add, col[1] * m + add, col[2] * m + add, 255);
                }
              }
            }
          }
          continue;
        }
        if (world.boundary[i]) {
          for(let oy=0;oy<TEX;oy++) for(let ox=0;ox<TEX;ox++) {
            const c=boundaryColor(world,cx,cy,ox,oy);
            put(tx0+ox,ty0+oy,c[0],c[1],c[2],255);
          }
          continue;
        }
        const material = world.mat[i];
        const up = cy > 0 && health[i - W] === 0;
        const left = cx > 0 && health[i - 1] === 0;
        const down = cy < world.height - 1 && health[i + W] === 0;
        const right = cx < W - 1 && health[i + 1] === 0;
        // Inside corners: both side neighbors solid, only the diagonal open.
        const hasL = cx > 0;
        const hasR = cx < W - 1;
        const hasU = cy > 0;
        const hasD = cy < world.height - 1;
        const cUL = !up && !left && hasU && hasL && health[i - W - 1] === 0;
        const cUR = !up && !right && hasU && hasR && health[i - W + 1] === 0;
        const cDL = !down && !left && hasD && hasL && health[i + W - 1] === 0;
        const cDR = !down && !right && hasD && hasR && health[i + W + 1] === 0;
        const anyCorner = cUL || cUR || cDL || cDR;
        if (material === MAT.glass) {
          // See-through containment glass, brighter along faces that touch the air.
          const g = COLORS.glass;
          const edge = up || left || down || right;
          const maxHpG = world.maxHealthAt(cx, cy);
          const crack = hp < maxHpG ? 1 - hp / maxHpG : 0;
          const a = Math.min(255, COLORS.glassAlpha + (edge ? 40 : 0) + crack * 90);
          for (let t = 0; t < TEX * TEX; t++) {
            const ox = t % TEX;
            const oy = (t - ox) / TEX;
            // A thin diagonal glint across each pane.
            const glint = (cx * TEX + ox + cy * TEX + oy) % 6 === 0 ? 26 : 0;
            put(tx0 + ox, ty0 + oy, g[0] + glint, g[1] + glint, g[2] + glint, a);
          }
          continue;
        }
        if (material === MAT.crystal) {
          this.paintCrystal(cx, cy, i, hp, up, left, down, right, tx0, ty0, put);
          continue;
        }
        const t = tint[i] / 255;
        const tier = this.materialTier(cx, cy);
        const base = materialColor(tier, !!world.labLayout?.frame?.def.framework);
        const tone = 0.88 + t * 0.24;
        const detail = world.decor[i];
        const dc = COLORS.labDecor[detail];
        const dm = detail > 0 ? COLORS.labDecorMix[detail] : 0;
        const dGrain = 0.94 + t * 0.12;
        const maxHp = world.maxHealthAt(cx, cy);
        // Deeper bands darken slightly for depth perception.
        const band = Math.min(1, (maxHp - 1) / Math.max(1, maxCap - 1));
        const shade = band > 0 ? 1 - band * 0.18 : 1;
        const dmg = hp < maxHp ? (1 - hp / maxHp) * 0.5 : 0;
        // Structural walls and doors carry a band of matte tier paint on their open faces.
        const painted = (world.wall[i] > 0 || material === MAT.door) && material !== MAT.crystal && world.blight[i] === 0 && world.coreId[i] === 0;
        const paintTier = painted ? this.tierAt(cx, cy) : 0;
        const paint = TIER_PAINT[paintTier] ?? materialColor(paintTier, true);
        for (let oy = 0; oy < TEX; oy++) {
          for (let ox = 0; ox < TEX; ox++) {
            const gx = cx * TEX + ox;
            const gy = cy * TEX + oy;
            const s = materialShade(tier, gx, gy) * tone;
            col[0] = base[0] * s;
            col[1] = base[1] * s;
            col[2] = base[2] * s;
            if (dm > 0) {
              const g = dGrain * (0.95 + hash2(gx, gy, 9) * 0.1);
              col[0] += (dc[0] * g - col[0]) * dm;
              col[1] += (dc[1] * g - col[1]) * dm;
              col[2] += (dc[2] * g - col[2]) * dm;
            }
            // Paint sits one texel in from an open face, worn through in places.
            if (
              paintTier > 0 &&
              ((up && oy === 1) ||
                (left && ox === 1) ||
                (down && oy === TEX - 2) ||
                (right && ox === TEX - 2) ||
                (anyCorner && innerCornerBand(ox, oy, cUL, cUR, cDL, cDR, 1))) &&
              hash2(gx, gy, 77) > 0.2
            ) {
              const pg = 0.9 + hash2(gx, gy, 78) * 0.16;
              col[0] = paint[0] * pg;
              col[1] = paint[1] * pg;
              col[2] = paint[2] * pg;
            }
            col[0] *= shade;
            col[1] *= shade;
            col[2] *= shade;
            if (dmg > 0) {
              // Damage scuffs the surface toward pale dust.
              col[0] += (150 - col[0]) * dmg;
              col[1] += (140 - col[1]) * dmg;
              col[2] += (128 - col[2]) * dmg;
              // Subtle pixel-art cracks that spread the more the block is damaged
              const crack = crackTexelAt(cx, cy, ox, oy, 1 - hp / maxHp);
              if (crack > 0) {
                const dark = crack === 2 ? 0.38 : 0.62;
                col[0] *= dark;
                col[1] *= dark;
                col[2] *= dark;
              }
            }
            // Matte relief: a pale lip on faces toward the upper left, shadow on the rest.
            let m = 1;
            let add = 0;
            if ((up && oy === 0) || (left && ox === 0) || (anyCorner && innerCornerBand(ox, oy, cUL, cUR, cDL, false, 0))) {
              m = 1.7;
              add = 22;
            } else if ((down && oy === TEX - 1) || (right && ox === TEX - 1) || (cDR && innerCornerBand(ox, oy, false, false, false, true, 0))) {
              m = 0.62;
            }
            put(tx0 + ox, ty0 + oy, col[0] * m + add, col[1] * m + add, col[2] * m + add, 255);
          }
        }
      }
    }
    this.canvases[k].getContext("2d")!.putImageData(this.image, 0, 0);
    const outline = new Path2D();
    const subs = cs * 2;
    const edges = traceSurfaceOutline(world, kx * subs, ky * subs, subs, this.edgeSolid,
      (x, y, width, height) => outline.rect(x, y, width, height));
    this.surfaceOutlines[k] = edges ? outline : null;
    this.buildEdgeMask(k, kx, ky);
  }

  /** Albedo of a live half-size pixel, before relief shading. */
  private subColor(si: number, sx: number, sy: number, subHp: number, col: number[]): void {
    const world = this.world;
    const subT = world.subTint[si] / 255;
    const sk = world.subKind[si];
    if (sk === SUB.rubble) {
      const pal = COLORS.rubble;
      // Tint bits 0-2 pick the stone's color, bits 3-7 its brightness (see CaveIns).
      const c = pal[(world.subTint[si] & 7) % pal.length];
      const v = 0.82 + ((world.subTint[si] >> 3) / 32) * 0.36;
      col[0] = c[0] * v;
      col[1] = c[1] * v;
      col[2] = c[2] * v;
    } else if (sk === SUB.metal || sk === SUB.pipe) {
      sampleRamp(sk === SUB.metal ? COLORS.labMetal : COLORS.labPipe, 0.3 + subT * 0.4, col);
    } else if (sk === SUB.led) {
      // Unlit lamp housing; the blinking light is drawn on top each frame.
      const c = COLORS.labLed[world.subTint[si] >> 6];
      col[0] = 24 + c[0] * 0.22;
      col[1] = 24 + c[1] * 0.22;
      col[2] = 28 + c[2] * 0.22;
    } else if (sk === SUB.core) {
      const c = COLORS.labCore[world.subTint[si] >> 6];
      col[0] = c[0] * 0.6;
      col[1] = c[1] * 0.6;
      col[2] = c[2] * 0.6;
    } else if (sk === SUB.wreck) {
      sampleRamp(COLORS.labWreck, subT, col);
    } else if (sk === SUB.screen) {
      const c = COLORS.labScreen[(world.subTint[si] >> 6) & 3];
      // Scanline flicker baked per pixel; brighter on even rows.
      const v = (sy & 1) === 0 ? 0.95 : 0.7;
      col[0] = c[0] * v;
      col[1] = c[1] * v;
      col[2] = c[2] * v;
    } else {
      sampleRamp(COLORS.pinkBlight, subT, col);
    }
    const maxSubHp = world.maxSubHealthAt(sx, sy);
    if (this.dormantAt?.(si)) {
      // Dormant: drained to a bruised violet, and decay darkens it further.
      const rot = subHp < maxSubHp ? 1 - subHp / maxSubHp : 0;
      const lum = (col[0] + col[1] + col[2]) / 3;
      const k = 0.5 - rot * 0.3;
      col[0] = (lum * 0.55 + col[0] * 0.45) * k;
      col[1] = (lum * 0.55 + col[1] * 0.45) * k * 0.85;
      col[2] = (lum * 0.55 + col[2] * 0.45) * k * 1.1;
    } else if (subHp < maxSubHp) {
      const d = 1 - subHp / maxSubHp;
      const lighten = d * 0.55;
      col[0] += (255 - col[0]) * lighten;
      col[1] += (255 - col[1]) * lighten;
      col[2] += (255 - col[2]) * lighten;
    }
  }

  /**
   * A seam of crystal set in a wall: matte faceted shards, orange in tier 2
   * walls and green in tier 3, lit on the upper-left faces like the rock
   * around it. No glow: lights and muzzle flashes reveal it.
   */
  private paintCrystal(
    cx: number,
    cy: number,
    i: number,
    hp: number,
    up: boolean,
    left: boolean,
    down: boolean,
    right: boolean,
    tx0: number,
    ty0: number,
    put: (x: number, y: number, r: number, g: number, b: number, a: number) => void,
  ): void {
    const w = this.world;
    const green = w.wall[i] >= 3;
    const base = green ? CRYSTAL_GREEN : CRYSTAL_ORANGE;
    const maxHp = w.maxHealthAt(cx, cy);
    const dmg = hp < maxHp ? (1 - hp / maxHp) * 0.45 : 0;
    for (let oy = 0; oy < TEX; oy++) {
      for (let ox = 0; ox < TEX; ox++) {
        const gx = cx * TEX + ox;
        const gy = cy * TEX + oy;
        // Facets: diagonal bands cut at a per-cell angle; odd bands catch the light.
        const cut = hash2(cx, cy, 41) > 0.5 ? gx + gy : gx - gy;
        const band = Math.floor((cut + Math.floor(hash2(cx, cy, 43) * 4)) / 2) & 1;
        let m = band ? 1.18 : 0.78;
        m *= 0.9 + hash2(gx, gy, 44) * 0.2;
        // A few dark grains of host rock between shards.
        if (hash2(gx, gy, 45) < 0.12) m = 0.42;
        let add = 0;
        if ((up && oy === 0) || (left && ox === 0)) {
          m *= 1.45;
          add = 18;
        } else if ((down && oy === TEX - 1) || (right && ox === TEX - 1)) {
          m *= 0.6;
        }
        let r = base[0] * m + add;
        let g = base[1] * m + add;
        let b = base[2] * m + add;
        if (dmg > 0) {
          r += (150 - r) * dmg;
          g += (140 - g) * dmg;
          b += (128 - b) * dmg;
          const crack = crackTexelAt(cx, cy, ox, oy, 1 - hp / maxHp);
          if (crack > 0) {
            const dark = crack === 2 ? 0.38 : 0.62;
            r *= dark;
            g *= dark;
            b *= dark;
          }
        }
        put(tx0 + ox, ty0 + oy, r, g, b, 255);
      }
    }
  }

  /**
   * Tier of an ordinary block: its lab sector's tier, or zone by depth in small
   * procedural worlds (dithered so the boundary isn't a ruler line).
   */
  private fillTier(cx: number, cy: number, i: number): number {
    const w = this.world;
    if (w.labLayout?.frame) return w.fillTierAt(cx, cy);
    const dither = (w.tint[i] / 255 - 0.5) * 3;
    return zoneForDepth(w.depthOf(cx, cy) + dither) + 1;
  }

  /** Material tier: starter walls match local fill; later walls are one tier up; doors follow keycards. */
  private materialTier(cx: number, cy: number): number {
    const w = this.world;
    const i = cy * w.width + cx;
    if (w.mat[i] === MAT.door) return w.doors[w.doorId[i] - 1]?.tier ?? 1;
    const wm = w.wall[i];
    if (wm > 0) return w.wallTierAt(cx, cy);
    return this.fillTier(cx, cy, i);
  }

  /**
   * Terrain tier of a solid cell for its matte paint band (0 = unpainted):
   * 1..3 for zone fill and starter walls, later walls one tier up, doors by
   * the keycard tier that opens them. Glass, Blight and rubble have none.
   */
  tierAt(cx: number, cy: number): number {
    const w = this.world;
    const i = cy * w.width + cx;
    if (w.health[i] === 0) return 0;
    const m = w.mat[i];
    if (m === MAT.glass) return 0;
    if (m === MAT.door) return w.doors[w.doorId[i] - 1]?.tier ?? 0;
    if (w.coreId[i] > 0 || w.blight[i] > 0) return 0;
    const wm = w.wall[i];
    if (wm > 0) return w.wallTierAt(cx, cy);
    return this.fillTier(cx, cy, i);
  }

  private buildEdgeMask(k: number, kx: number, ky: number): void {
    const subs = this.chunks.chunkSize * 2;
    const dormant = this.dormantAt;
    const sw = this.world.subWidth;
    const live = dormant ? (sx: number, sy: number) => !dormant(sy * sw + sx) : undefined;
    const count = markBlightEdges(this.world, kx * subs, ky * subs, subs, this.edgeBits, this.edgeSolid, live);
    if (count === 0) {
      if (this.edgeLive[k]) {
        this.edgeLive[k] = 0;
        this.edgeVersion++;
      }
    } else {
      this.edgeMasks[k] = this.writeMask(this.edgeMasks[k]);
      this.edgeLive[k] = 1;
      this.edgeVersion++;
    }
    const dCount = dormant
      ? markBlightEdges(this.world, kx * subs, ky * subs, subs, this.edgeBits, this.edgeSolid, (sx, sy) => dormant(sy * sw + sx))
      : 0;
    if (dCount === 0) {
      if (this.dormantLive[k]) {
        this.dormantLive[k] = 0;
        this.dormantVersion++;
      }
    } else {
      this.dormantMasks[k] = this.writeMask(this.dormantMasks[k]);
      this.dormantLive[k] = 1;
      this.dormantVersion++;
    }
  }

  /** Copy `edgeBits` into a chunk mask canvas (made on first use). */
  private writeMask(mask: HTMLCanvasElement | null): HTMLCanvasElement {
    if (!mask) {
      mask = document.createElement("canvas");
      mask.width = mask.height = this.edgeImage.width;
    }
    const data = this.edgeImage.data;
    const bits = this.edgeBits;
    for (let i = 0; i < bits.length; i++) data[i * 4 + 3] = bits[i] * 255;
    mask.getContext("2d")!.putImageData(this.edgeImage, 0, 0);
    return mask;
  }

  /**
   * The burning dimension seen through a thin line round every Blight block,
   * after TowerDefense's pixel portal contours: fire is painted at the mask's own
   * pixel size, cut to the edges and scaled up unsmoothed. It is anchored to the
   * world and emissive, so draw it after the lighting pass. `seconds` is wall clock.
   */
  drawBlightEdges(ctx: CanvasRenderingContext2D, cam: CameraSystem, seconds: number): void {
    const shrink = cam.zoom < EDGE_FIRE_FULL_ZOOM ? 2 : 1;
    this.drawEdgeLayer(ctx, cam, this.edgeMasks, this.edgeLive, this.edgeUnion, this.edgeFire, seconds, shrink, false);
    this.drawEdgeLayer(ctx, cam, this.dormantMasks, this.dormantLive, this.dormantUnion, this.dormantFire, seconds, shrink, true);
  }

  /**
   * One edge layer: live Blight burns with moving fire; dormant Blight shows the
   * same fire stopped dead (painted once at a fixed time) and dimmed.
   */
  private drawEdgeLayer(
    ctx: CanvasRenderingContext2D,
    cam: CameraSystem,
    masks: (HTMLCanvasElement | null)[],
    live: Uint8Array,
    union: HTMLCanvasElement,
    fire: HTMLCanvasElement,
    seconds: number,
    shrink: number,
    frozen: boolean,
  ): void {
    const size = this.edgeImage.width;
    const cols = this.chunks.cols;
    let kx0 = Infinity;
    let ky0 = Infinity;
    let kx1 = -1;
    let ky1 = -1;
    this.forEachVisibleChunk(cam, (kx, ky) => {
      if (!live[ky * cols + kx]) return;
      if (kx < kx0) kx0 = kx;
      if (ky < ky0) ky0 = ky;
      if (kx > kx1) kx1 = kx;
      if (ky > ky1) ky1 = ky;
    });
    if (kx1 < 0) return;
    const w = (kx1 - kx0 + 1) * size;
    const h = (ky1 - ky0 + 1) * size;
    const version = frozen ? this.dormantVersion : this.edgeVersion;
    const tick = frozen ? "frozen" : `${Math.floor(seconds * EDGE_FIRE_FPS)}`;
    const key = `${tick}:${version}:${kx0}:${ky0}:${kx1}:${ky1}:${shrink}`;
    if (key !== (frozen ? this.dormantFireKey : this.edgeFireKey)) {
      if (frozen) this.dormantFireKey = key;
      else this.edgeFireKey = key;
      this.paintEdgeFire(masks, live, union, fire, kx0, ky0, kx1, ky1, w, h, frozen ? FROZEN_FIRE_TIME : seconds, shrink, frozen);
    }
    const smoothing = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    this.forEachVisibleChunk(cam, (kx, ky, sx, sy, sw, sh) => {
      if (!live[ky * cols + kx]) return;
      ctx.drawImage(fire, (kx - kx0) * size, (ky - ky0) * size, size, size, sx, sy, sw, sh);
    });
    ctx.imageSmoothingEnabled = smoothing;
  }

  private paintEdgeFire(
    masks: (HTMLCanvasElement | null)[],
    live: Uint8Array,
    union: HTMLCanvasElement,
    fire: HTMLCanvasElement,
    kx0: number,
    ky0: number,
    kx1: number,
    ky1: number,
    w: number,
    h: number,
    seconds: number,
    shrink: number,
    frozen: boolean,
  ): void {
    const size = this.edgeImage.width;
    const cols = this.chunks.cols;
    if (union.width < w || union.height < h) {
      const cw = Math.max(union.width, Math.ceil(w / EDGE_CANVAS_STEP) * EDGE_CANVAS_STEP);
      const ch = Math.max(union.height, Math.ceil(h / EDGE_CANVAS_STEP) * EDGE_CANVAS_STEP);
      union.width = fire.width = cw;
      union.height = fire.height = ch;
    }
    const u = union.getContext("2d")!;
    u.clearRect(0, 0, union.width, union.height);
    for (let ky = ky0; ky <= ky1; ky++) {
      for (let kx = kx0; kx <= kx1; kx++) {
        const k = ky * cols + kx;
        if (live[k]) u.drawImage(masks[k]!, (kx - kx0) * size, (ky - ky0) * size);
      }
    }
    const f = fire.getContext("2d")!;
    f.setTransform(1, 0, 0, 1, 0, 0);
    f.globalCompositeOperation = "source-over";
    f.clearRect(0, 0, fire.width, fire.height);
    // Clip procedural painting to occupied chunks, not the empty space between
    // distant Blight patches. Keep world coordinates so noise remains seamless.
    const clipChunks = (target: CanvasRenderingContext2D, worldSpace: boolean): void => {
      target.beginPath();
      for (let ky = ky0; ky <= ky1; ky++) for (let kx = kx0; kx <= kx1; kx++) {
        if (live[ky * cols + kx]) target.rect((kx - (worldSpace ? 0 : kx0)) * size, (ky - (worldSpace ? 0 : ky0)) * size, size, size);
      }
      target.clip();
    };
    f.save();
    clipChunks(f, false);
    // World-anchored: the fire stays put under the camera.
    const ox = kx0 * size;
    const oy = ky0 * size;
    const box = { x: ox, y: oy, w, h };
    if (shrink > 1) {
      const low = this.edgeFireLow;
      const lw = Math.ceil(w / shrink);
      const lh = Math.ceil(h / shrink);
      if (low.width < lw) low.width = lw;
      if (low.height < lh) low.height = lh;
      const l = low.getContext("2d")!;
      l.setTransform(1 / shrink, 0, 0, 1 / shrink, -ox / shrink, -oy / shrink);
      l.save();
      clipChunks(l, true);
      paintPortal(l, box, seconds, EDGE_FIRE_RATIO);
      l.restore();
      f.imageSmoothingEnabled = false;
      f.drawImage(low, 0, 0, lw, lh, 0, 0, lw * shrink, lh * shrink);
    } else {
      f.setTransform(1, 0, 0, 1, -ox, -oy);
      paintPortal(f, box, seconds, EDGE_FIRE_RATIO);
      f.setTransform(1, 0, 0, 1, 0, 0);
    }
    if (frozen) {
      // Cold and still: the fire's colors pulled toward a dull violet.
      f.globalCompositeOperation = "source-atop";
      f.fillStyle = "rgba(70, 52, 110, 0.62)";
      f.fillRect(0, 0, w, h);
    }
    f.globalCompositeOperation = "destination-in";
    f.drawImage(union, 0, 0);
    f.restore();
    f.globalCompositeOperation = "source-over";
  }

  /**
   * Draw a canvas holding one pixel per world cell with the exact chunk mapping of
   * `draw`, so each of its pixels covers the same screen pixels as that terrain cell.
   */
  drawCellOverlay(ctx: CanvasRenderingContext2D, cam: CameraSystem, overlay: HTMLCanvasElement): void {
    const cs = this.chunks.chunkSize;
    ctx.imageSmoothingEnabled = false;
    this.forEachVisibleChunk(cam, (kx, ky, sx, sy, sw, sh) => {
      ctx.drawImage(overlay, kx * cs, ky * cs, cs, cs, sx, sy, sw, sh);
    });
  }

  /**
   * Copy the floors and terrain of cells (x0, y0)..(x0 + w - 1, y0 + h - 1) into
   * `ctx` at full texel resolution (TEX px per cell), top-left at (0, 0). Used
   * for the lab map's sector pictures; chunks must already be built.
   */
  drawRegion(ctx: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number): void {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.floorCanvas, x0 * TEX, y0 * TEX, w * TEX, h * TEX, 0, 0, w * TEX, h * TEX);
    const cs = this.chunks.chunkSize;
    const kx0 = Math.max(0, Math.floor(x0 / cs));
    const ky0 = Math.max(0, Math.floor(y0 / cs));
    const kx1 = Math.min(this.chunks.cols - 1, Math.floor((x0 + w - 1) / cs));
    const ky1 = Math.min(this.chunks.rows - 1, Math.floor((y0 + h - 1) / cs));
    for (let ky = ky0; ky <= ky1; ky++) {
      for (let kx = kx0; kx <= kx1; kx++) {
        ctx.drawImage(this.canvases[ky * this.chunks.cols + kx], (kx * cs - x0) * TEX, (ky * cs - y0) * TEX);
      }
    }
  }

  update(): void {
    this.chunks.take(TERRAIN.chunkRebuildBudget, this.scratch);
    this.rebuiltLastFrame = this.scratch.length;
    for (const k of this.scratch) this.buildChunk(k);
  }

  draw(ctx: CanvasRenderingContext2D, cam: CameraSystem, showBorders = false): void {
    ctx.imageSmoothingEnabled = false;
    this.forEachVisibleChunk(cam, (kx, ky, sx, sy, sw, sh) => {
      ctx.drawImage(this.canvases[ky * this.chunks.cols + kx], sx, sy, sw, sh);
      if (showBorders) {
        ctx.strokeStyle = "rgba(80, 210, 255, 0.25)";
        ctx.strokeRect(sx + 0.5, sy + 0.5, sw - 1, sh - 1);
      }
    });
  }

  /** Thin exposed-surface rims stay readable after lighting, but underneath fog. */
  drawSurfaceOutlines(ctx: CanvasRenderingContext2D, cam: CameraSystem): void {
    ctx.save();
    ctx.fillStyle = "#000000";
    const size = this.chunks.chunkSize;
    this.forEachVisibleChunk(cam, (kx, ky, sx, sy, sw, sh) => {
      const outline = this.surfaceOutlines[ky * this.chunks.cols + kx];
      if (!outline) return;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.scale(sw / size, sh / size);
      ctx.fill(outline);
      ctx.restore();
    });
    ctx.restore();
  }

  private forEachVisibleChunk(
    cam: CameraSystem,
    fn: (kx: number, ky: number, sx: number, sy: number, sw: number, sh: number) => void,
  ): void {
    const world = this.world;
    const cs = this.chunks.chunkSize;
    const unit = world.cellSize * cs;
    const x0 = cam.screenToWorldX(0);
    const y0 = cam.screenToWorldY(0);
    const x1 = cam.screenToWorldX(cam.viewW);
    const y1 = cam.screenToWorldY(cam.viewH);
    const kx0 = Math.max(0, Math.floor(x0 / unit));
    const ky0 = Math.max(0, Math.floor(y0 / unit));
    const kx1 = Math.min(this.chunks.cols - 1, Math.floor(x1 / unit));
    const ky1 = Math.min(this.chunks.rows - 1, Math.floor(y1 / unit));
    for (let ky = ky0; ky <= ky1; ky++) {
      const sy0 = Math.round(cam.worldToScreenY(ky * unit));
      const sy1 = Math.round(cam.worldToScreenY((ky + 1) * unit));
      for (let kx = kx0; kx <= kx1; kx++) {
        const sx0 = Math.round(cam.worldToScreenX(kx * unit));
        const sx1 = Math.round(cam.worldToScreenX((kx + 1) * unit));
        fn(kx, ky, sx0, sy0, sx1 - sx0, sy1 - sy0);
      }
    }
  }
}
