import { COLORS, FACILITY, TERRAIN, TERRAIN as T, zoneForDepth } from "../config";
import { EDGE_PIXELS_PER_SUB, markBlightEdges } from "./blightEdges";
import { paintPortal } from "./portalNoise";
import type { CameraSystem } from "../systems/CameraSystem";
import { hash2 } from "../core/math";
import { DECOR } from "../world/LabDetails";
import { LIGHT_KIND, MAT, SUB, type PixelWorld, type RoomLight } from "../world/PixelWorld";
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
/** Tier glow canvases hold this many pixels per cell edge. */
const GLOW_RES = 4;
/** Glow alpha (0..255) by pixel step from a block's exposed face: inside, then outside. */
const GLOW_IN = [210, 80] as const;
const GLOW_OUT = [90, 26] as const;

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
  readonly chunks: TerrainChunks;
  private canvases: HTMLCanvasElement[] = [];
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
  /** Per chunk: soft tier-colored glow on exposed block faces, made the first time it has any. */
  private glowCanvases: (HTMLCanvasElement | null)[] = [];
  private glowLive: Uint8Array;
  private glowImage: ImageData;
  /** Subcell indices of every blinking status light and pulsing machine core. */
  private lights = new Int32Array(0);
  /** Two pixels per world cell: the lab's floors, under the terrain. */
  private floorCanvas: HTMLCanvasElement;
  /** Soft round light sprites (white and Blight pink) for the room lights. */
  private panelGlow: HTMLCanvasElement;
  private blightGlow: HTMLCanvasElement;
  private reducedMotion: MediaQueryList | null =
    typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;

  constructor(private world: PixelWorld, chunkSize: number) {
    this.chunks = new TerrainChunks(world, chunkSize);
    const n = this.chunks.cols * this.chunks.rows;
    const subChunk = chunkSize * 2;
    for (let i = 0; i < n; i++) {
      const c = document.createElement("canvas");
      c.width = subChunk;
      c.height = subChunk;
      this.canvases.push(c);
    }
    this.image = new ImageData(subChunk, subChunk);
    const edgeSize = subChunk * EDGE_PIXELS_PER_SUB;
    this.edgeMasks = new Array<HTMLCanvasElement | null>(n).fill(null);
    this.edgeLive = new Uint8Array(n);
    this.dormantMasks = new Array<HTMLCanvasElement | null>(n).fill(null);
    this.dormantLive = new Uint8Array(n);
    this.edgeBits = new Uint8Array(edgeSize * edgeSize);
    this.edgeSolid = new Uint8Array((subChunk + 2) * (subChunk + 2));
    this.edgeImage = new ImageData(edgeSize, edgeSize);
    this.edgeImage.data.fill(255);
    this.glowCanvases = new Array<HTMLCanvasElement | null>(n).fill(null);
    this.glowLive = new Uint8Array(n);
    this.glowImage = new ImageData(chunkSize * GLOW_RES, chunkSize * GLOW_RES);
    this.chunks.markAll();
    this.glowCanvas = document.createElement("canvas");
    this.glowCanvas.width = world.width;
    this.glowCanvas.height = world.height;
    this.floorCanvas = document.createElement("canvas");
    this.floorCanvas.width = world.width * 2;
    this.floorCanvas.height = world.height * 2;
    this.panelGlow = radialSprite([255, 255, 255]);
    this.blightGlow = radialSprite([255, 70, 160]);
    // Broken or overgrown machinery goes dark.
    world.addListener((cx, cy, kind) => {
      if (kind === "destroyed" || kind === "grown") {
        this.glowCanvas.getContext("2d")!.clearRect(cx, cy, 1, 1);
      }
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

  /**
   * Paint the lab floors: tile seams one half-cell wide, a little grain per
   * pixel, light panels and cracks. Empty cells with no decor stay clear, so the
   * cavity background shows through dug-out rock.
   */
  private buildFloor(): void {
    const w = this.world;
    const W2 = w.width * 2;
    const g = this.floorCanvas.getContext("2d")!;
    const image = g.createImageData(W2, w.height * 2);
    const data = image.data;
    const pal = COLORS.labDecor;
    for (let cy = 0; cy < w.height; cy++) {
      for (let cx = 0; cx < w.width; cx++) {
        const d = w.decor[cy * w.width + cx];
        if (d === 0) continue;
        for (let k = 0; k < 4; k++) {
          const dx = k & 1;
          const dy = k >> 1;
          let c: RGB = pal[d];
          // Seams run along the top and left half of the tile's first row and column.
          if (d === DECOR.cleanSeam || d === DECOR.floorLine) {
            const seam = (cx % 4 === 0 && dx === 0) || (cy % 4 === 0 && dy === 0);
            if (!seam) c = pal[d === DECOR.cleanSeam ? DECOR.cleanFloor : DECOR.floor];
          } else if (d === DECOR.grime || d === DECOR.blightStain) {
            // Grime and stains soak in unevenly, speckled over the old floor.
            if (hash2(cx * 2 + dx, cy * 2 + dy, 131) < 0.3) c = pal[DECOR.floor];
          }
          const px = cx * 2 + dx;
          const py = cy * 2 + dy;
          const grain = 0.95 + hash2(px, py, 77) * 0.1;
          const p = (py * W2 + px) * 4;
          data[p] = Math.min(255, c[0] * grain);
          data[p + 1] = Math.min(255, c[1] * grain);
          data[p + 2] = Math.min(255, c[2] * grain);
          data[p + 3] = 255;
        }
      }
    }
    g.putImageData(image, 0, 0);
  }

  /** Draw the lab floors. Call before `draw`, in the albedo pass. */
  drawFloor(ctx: CanvasRenderingContext2D, cam: CameraSystem): void {
    const cs = this.chunks.chunkSize;
    ctx.imageSmoothingEnabled = false;
    this.forEachVisibleChunk(cam, (kx, ky, sx, sy, sw, sh) => {
      ctx.drawImage(this.floorCanvas, kx * cs * 2, ky * cs * 2, cs * 2, cs * 2, sx, sy, sw, sh);
    });
  }

  /** Brightness (0..1) of a room light right now; 0 when it is off or gone. */
  private lightLevel(l: RoomLight, t: number, still: boolean): number {
    const w = this.world;
    if (l.kind === LIGHT_KIND.blight) {
      const core = l.coreId ? w.blightCores[l.coreId - 1] : undefined;
      if (!core || !core.alive) return 0;
      return still ? 0.8 : 0.7 + 0.3 * Math.sin(t * 1.3 + l.phase * 6.28);
    }
    if (l.kind !== LIGHT_KIND.wash) {
      // A panel goes dark once Blight grows over it or rock fills its cell.
      const i = l.y0 * w.width + l.x0;
      if (w.health[i] > 0 || w.decor[i] !== DECOR.lightPanel) return 0;
    }
    if (l.kind === LIGHT_KIND.flicker) return still ? 0.35 : flickerLevel(t, l.phase);
    return 1;
  }

  /**
   * Add the lab's own lighting to the lightmap: an even wash over pristine
   * rooms and halls, a pool under each working panel, and a pink glow around
   * each living Blight Core. Each light stays inside its room.
   */
  drawRoomLight(g: CanvasRenderingContext2D, cam: CameraSystem, time: number): void {
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
    for (const l of lights) {
      if (l.cx1 < vx0 || l.cy1 < vy0 || l.cx0 > vx1 || l.cy0 > vy1) continue;
      const level = this.lightLevel(l, time, still);
      if (level <= 0.02) continue;
      const rx = cam.worldToScreenX(l.cx0 * cs);
      const ry = cam.worldToScreenY(l.cy0 * cs);
      const rw = (l.cx1 - l.cx0 + 1) * cs * z;
      const rh = (l.cy1 - l.cy0 + 1) * cs * z;
      if (l.kind === LIGHT_KIND.wash) {
        g.globalAlpha = FACILITY.washStrength;
        g.fillStyle = "rgb(150, 170, 190)";
        g.fillRect(rx, ry, rw, rh);
        continue;
      }
      g.save();
      g.beginPath();
      g.rect(rx, ry, rw, rh);
      g.clip();
      const mx = cam.worldToScreenX(((l.x0 + l.x1 + 1) / 2) * cs);
      const my = cam.worldToScreenY(((l.y0 + l.y1 + 1) / 2) * cs);
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
    const { world } = this;
    const cs = this.chunks.chunkSize;
    const subCs = cs * 2;
    const kx = k % this.chunks.cols;
    const ky = Math.floor(k / this.chunks.cols);
    const data = this.image.data;
    const W = world.width;
    const health = world.health;
    const tint = world.tint;
    const col = this.col;
    const maxCap = T.maxHealthCap;
    for (let ly = 0; ly < cs; ly++) {
      const cy = ky * cs + ly;
      for (let lx = 0; lx < cs; lx++) {
        const cx = kx * cs + lx;
        if (cx >= W || cy >= world.height) {
          for (let dy = 0; dy < 2; dy++) {
            for (let dx = 0; dx < 2; dx++) {
              const p = ((ly * 2 + dy) * subCs + (lx * 2 + dx)) * 4;
              data[p + 3] = 0;
            }
          }
          continue;
        }
        const i = cy * W + cx;
        const hp = health[i];
        if (hp === 0) {
          // Check 4 sub-pixels in this cell (pink core blight)
          for (let dy = 0; dy < 2; dy++) {
            for (let dx = 0; dx < 2; dx++) {
              const slx = lx * 2 + dx;
              const sly = ly * 2 + dy;
              const p = (sly * subCs + slx) * 4;
              const sx = cx * 2 + dx;
              const sy = cy * 2 + dy;
              const si = sy * world.subWidth + sx;
              const subHp = world.subHealth[si];
              if (subHp === 0) {
                data[p] = 0;
                data[p + 1] = 0;
                data[p + 2] = 0;
                data[p + 3] = 0;
              } else {
                const subT = world.subTint[si] / 255;
                const sk = world.subKind[si];
                if (sk === SUB.rubble) {
                  const pal = COLORS.rubble;
                  const c = pal[world.subTint[si] % pal.length];
                  const v = 0.82 + (world.subTint[si] >> 3) / 32 * 0.36;
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
                const subUp = sy > 0 && !world.subSolidAt(sx, sy - 1);
                const subLeft = sx > 0 && !world.subSolidAt(sx - 1, sy);
                const subDown = sy < world.subHeight - 1 && !world.subSolidAt(sx, sy + 1);
                const subRight = sx < world.subWidth - 1 && !world.subSolidAt(sx + 1, sy);
                let sm = 1;
                let sadd = 0;
                if (subUp || subLeft) {
                  sm = 1.35;
                  sadd = 10;
                } else if (subDown || subRight) {
                  sm = 1.15;
                  sadd = 4;
                }
                data[p] = Math.min(255, col[0] * sm + sadd);
                data[p + 1] = Math.min(255, col[1] * sm + sadd);
                data[p + 2] = Math.min(255, col[2] * sm + sadd * 1.2);
                data[p + 3] = 255;
              }
            }
          }
          continue;
        }
        const material = world.mat[i];
        if (material === MAT.glass) {
          // See-through containment glass, brighter along faces that touch the air.
          const g = COLORS.glass;
          const edge =
            (cy > 0 && health[i - W] === 0) ||
            (cx > 0 && health[i - 1] === 0) ||
            (cy < world.height - 1 && health[i + W] === 0) ||
            (cx < W - 1 && health[i + 1] === 0);
          const maxHpG = world.maxHealthAt(cx, cy);
          const crack = hp < maxHpG ? 1 - hp / maxHpG : 0;
          const a = Math.min(255, COLORS.glassAlpha + (edge ? 50 : 0) + crack * 90);
          for (let dy = 0; dy < 2; dy++) {
            for (let dx = 0; dx < 2; dx++) {
              const p = ((ly * 2 + dy) * subCs + (lx * 2 + dx)) * 4;
              // A diagonal glint across each pane.
              const glint = (dx + dy + cx + cy) % 3 === 0 ? 30 : 0;
              data[p] = Math.min(255, g[0] + glint);
              data[p + 1] = Math.min(255, g[1] + glint);
              data[p + 2] = Math.min(255, g[2] + glint);
              data[p + 3] = a;
            }
          }
          continue;
        }
        const t = tint[i] / 255;
        const depth = world.depthOf(cx, cy);
        const wMat = world.wall[i];
        let ramp: Ramp4;
        if (wMat === 1) {
          ramp = COLORS.zone2;
        } else if (wMat === 2) {
          ramp = COLORS.zone3;
        } else if (wMat === 3) {
          ramp = COLORS.reinforcedWall;
        } else {
          // Organic 2-cell transition dither at zone boundaries based on tint.
          const dither = (t - 0.5) * 3;
          const z = zoneForDepth(depth + dither);
          ramp = z === 0 ? COLORS.zone1 : z === 1 ? COLORS.zone2 : COLORS.zone3;
        }
        sampleRamp(ramp, t, col);

        // Lab set dressing, with a touch of the cell's grain so it isn't flat.
        const detail = world.decor[i];
        if (detail > 0) {
          const dc = COLORS.labDecor[detail];
          const dm = COLORS.labDecorMix[detail];
          const grain = 0.94 + t * 0.12;
          col[0] += (dc[0] * grain - col[0]) * dm;
          col[1] += (dc[1] * grain - col[1]) * dm;
          col[2] += (dc[2] * grain - col[2]) * dm;
        }

        const maxHp = world.maxHealthAt(cx, cy);
        // Deeper bands darken slightly for depth perception while preserving zone palette.
        const band = (maxHp - 1) / Math.max(1, maxCap - 1);
        if (band > 0) {
          const shade = 1 - band * 0.18;
          col[0] *= shade;
          col[1] *= shade;
          col[2] *= shade;
        }

        // Damage indicator: lighter shade of cell color proportional to relative damage percent.
        if (hp < maxHp) {
          const d = 1 - hp / maxHp;
          const lighten = d * 0.55;
          col[0] += (255 - col[0]) * lighten;
          col[1] += (255 - col[1]) * lighten;
          col[2] += (255 - col[2]) * lighten;
        }

        // Edge highlights where terrain faces open space.
        const up = cy > 0 && health[i - W] === 0;
        const left = cx > 0 && health[i - 1] === 0;
        const down = cy < world.height - 1 && health[i + W] === 0;
        const right = cx < W - 1 && health[i + 1] === 0;
        let m = 1;
        let add = 0;
        if (up || left) {
          m = 1.6;
          add = 8;
        } else if (down || right) {
          m = 1.3;
          add = 3;
        }
        const rVal = Math.min(255, col[0] * m + add);
        const gVal = Math.min(255, col[1] * m + add);
        const bVal = Math.min(255, col[2] * m + add * 1.3);

        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const p = ((ly * 2 + dy) * subCs + (lx * 2 + dx)) * 4;
            data[p] = rVal;
            data[p + 1] = gVal;
            data[p + 2] = bVal;
            data[p + 3] = 255;
          }
        }
      }
    }
    this.canvases[k].getContext("2d")!.putImageData(this.image, 0, 0);
    this.buildEdgeMask(k, kx, ky);
    this.buildTierGlow(k, kx, ky);
  }

  /**
   * Terrain tier of a solid cell for the exposed-edge glow (0 = no glow):
   * 1..3 for zone fill, wall material one tier up (4 = reinforced), doors by
   * the keycard tier that opens them. Glass, Blight and rubble don't glow.
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
    if (wm > 0) return wm + 1;
    // Matches the color ramp's dithered zone boundary.
    const dither = (w.tint[i] / 255 - 0.5) * 3;
    return zoneForDepth(w.depthOf(cx, cy) + dither) + 1;
  }

  private buildTierGlow(k: number, kx: number, ky: number): void {
    const w = this.world;
    const cs = this.chunks.chunkSize;
    const size = cs * GLOW_RES;
    const data = this.glowImage.data;
    data.fill(0);
    let any = false;
    const open = (x: number, y: number): boolean => w.inBounds(x, y) && !w.anySolidInCell(x, y);
    const put = (px: number, py: number, tier: number, a: number): void => {
      if (px < 0 || py < 0 || px >= size || py >= size) return;
      const p = (py * size + px) * 4;
      if (data[p + 3] >= a) return;
      const c = FACILITY.tierGlow[tier];
      data[p] = c[0];
      data[p + 1] = c[1];
      data[p + 2] = c[2];
      data[p + 3] = a;
      any = true;
    };
    // Paint a band `steps` deep along one face of cell (lx, ly), stepping inward from the face.
    const band = (lx: number, ly: number, dir: number, tier: number, alphas: readonly number[], inward: boolean): void => {
      const bx = lx * GLOW_RES;
      const by = ly * GLOW_RES;
      for (let s = 0; s < alphas.length; s++) {
        const d = inward ? s : GLOW_RES - 1 - s;
        for (let a = 0; a < GLOW_RES; a++) {
          // dir: 0 = face up, 1 = right, 2 = down, 3 = left.
          if (dir === 0) put(bx + a, by + d, tier, alphas[s]);
          else if (dir === 2) put(bx + a, by + GLOW_RES - 1 - d, tier, alphas[s]);
          else if (dir === 3) put(bx + d, by + a, tier, alphas[s]);
          else put(bx + GLOW_RES - 1 - d, by + a, tier, alphas[s]);
        }
      }
    };
    const DX = [0, 1, 0, -1];
    const DY = [-1, 0, 1, 0];
    for (let ly = 0; ly < cs; ly++) {
      const cy = ky * cs + ly;
      if (cy >= w.height) break;
      for (let lx = 0; lx < cs; lx++) {
        const cx = kx * cs + lx;
        if (cx >= w.width) break;
        const tier = this.tierAt(cx, cy);
        if (tier > 0) {
          for (let d = 0; d < 4; d++) {
            if (open(cx + DX[d], cy + DY[d])) band(lx, ly, d, tier, GLOW_IN, true);
          }
        } else if (open(cx, cy)) {
          // A faint halo spills into the air in front of each glowing face.
          for (let d = 0; d < 4; d++) {
            const nx = cx + DX[d];
            const ny = cy + DY[d];
            if (!w.inBounds(nx, ny)) continue;
            const nt = this.tierAt(nx, ny);
            // Face of this empty cell that touches the neighbor: same direction `d`, painted from that side.
            if (nt > 0) band(lx, ly, d, nt, GLOW_OUT, true);
          }
        }
      }
    }
    if (!any) {
      this.glowLive[k] = 0;
      return;
    }
    let canvas = this.glowCanvases[k];
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      this.glowCanvases[k] = canvas;
    }
    canvas.getContext("2d")!.putImageData(this.glowImage, 0, 0);
    this.glowLive[k] = 1;
  }

  /**
   * Soft tier-colored glow along every exposed block face: blue Tier 1, red
   * Tier 2, burnt orange Tier 3. Cached per chunk and drawn smoothed and
   * additive after the lighting pass, so it costs one draw per visible chunk.
   */
  drawTierGlow(ctx: CanvasRenderingContext2D, cam: CameraSystem, time: number): void {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = FACILITY.tierGlowAlpha * (0.9 + 0.1 * Math.sin(time * 1.3));
    ctx.imageSmoothingEnabled = true;
    const cols = this.chunks.cols;
    this.forEachVisibleChunk(cam, (kx, ky, sx, sy, sw, sh) => {
      const k = ky * cols + kx;
      if (this.glowLive[k]) ctx.drawImage(this.glowCanvases[k]!, sx, sy, sw, sh);
    });
    ctx.restore();
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
      paintPortal(l, box, seconds, EDGE_FIRE_RATIO);
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
