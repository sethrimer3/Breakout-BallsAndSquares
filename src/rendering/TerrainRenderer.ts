import { ChunkRegions } from "./ChunkRegions";
import { LightRegion, type ScreenRect } from "./LightRegion";
import { BinaryMask } from "./BinaryMask";
import { FloorRegions } from "./FloorRegions";
import { visibleRoomLightIndices } from "./RoomLightIndex";
import { fogRegionVisible } from "./fogRegionVisible";
import type { FogOfWar } from "../world/FogOfWar";
import { SortedGridIndex } from "./SortedGridIndex";
import { boundaryColor } from "../world/MapBoundary";
import { SurfaceOutlineCache } from "./SurfaceOutlineCache";
import { COLORS, FACILITY, TERRAIN, TERRAIN as T, zoneForDepth } from "../config";
import { EDGE_PIXELS_PER_SUB, markBlightEdges, type SubcellRegion } from "./blightEdges";
import { paintPortal } from "./portalNoise";
import type { CameraSystem } from "../systems/CameraSystem";
import { hash2 } from "../core/math";
import { DECOR } from "../world/LabDetails";
import { lateMaterial, materialColor, subPixelColor, subPixelTexelShade, TEX, TIER_PAINT, crackTexelAt, materialShade, type LateFeature } from "./materials";
import { CHAR_CELLS, SECTOR_CELLS, type LabFrame } from "../world/labMap";
import { roomLightPosition, LIGHT_KIND, MAT, SUB, type PixelWorld, type RoomLight } from "../world/PixelWorld";
import { TerrainChunks, type ChunkBounds } from "../world/TerrainChunks";

type RGB = readonly [number, number, number];

function lateBlendedTier(frame: LabFrame, cx: number, cy: number): number {
  if (frame.def.id !== 3) return frame.def.tierBase + 1;
  const col = (cx - frame.x0) / SECTOR_CELLS - 0.5;
  const row = (cy - frame.y0) / SECTOR_CELLS - 0.5;
  const sc = frame.def.start % frame.def.sectors;
  const sr = (frame.def.start - sc) / frame.def.sectors;
  const dist = Math.max(Math.abs(col - sc), Math.abs(row - sr));
  const [b0, b1] = frame.def.bands;
  if (dist < b0 - 0.75) return 7;
  if (dist < b0 + 0.75) {
    const t = (dist - b0 + 0.75) / 1.5;
    return 7 + t * t * (3 - 2 * t);
  }
  if (dist < b1 - 0.75) return 8;
  if (dist < b1 + 0.75) {
    const t = (dist - b1 + 0.75) / 1.5;
    return 8 + t * t * (3 - 2 * t);
  }
  return 9;
}

function lateCellFeature(frame: LabFrame, cx: number, cy: number): LateFeature {
  const col = Math.floor((cx - frame.x0) / CHAR_CELLS);
  const row = Math.floor((cy - frame.y0) / CHAR_CELLS);
  const lines = frame.def.blueprint;
  if (row >= 0 && row < lines.length && col >= 0 && col < lines[row].length) {
    const ch = lines[row][col];
    if (ch === "#") return "cover";
    if (ch === "=") return "bulkhead";
  }
  return "solid";
}

/** How large the burning dimension's noise reads through a Blight edge. */
const EDGE_FIRE_RATIO = 0.7;
/** Steps a second the edge fire redraws at (motion, not camera, drives this). */
const EDGE_FIRE_FPS = 15;
const EDGE_FIRE_FPS_MOBILE = 10;
/** Below this zoom the edges are so thin the fire paints at half size, then scales up. */
const EDGE_FIRE_FULL_ZOOM = 1.5;
/** Precomputed CSS color strings for blinking lab LEDs and pulsing machine cores. */
const LAB_LED_CSS = COLORS.labLed.map((c) => `rgb(${c[0]},${c[1]},${c[2]})`);
const LAB_CORE_CSS = COLORS.labCore.map((c) => `rgb(${c[0]},${c[1]},${c[2]})`);
/** The moment dormant Blight's edge fire is stopped at (any fixed time works). */
const FROZEN_FIRE_TIME = 7.25;
/** Edge canvases grow in steps this size, so a moving view doesn't reallocate them. */
const EDGE_CANVAS_STEP = 256;
/** Matte albedo of crystal veins: tier 2 orange, tier 3 green. */
const CRYSTAL_ORANGE = [212, 120, 48] as const;
const CRYSTAL_GREEN = [70, 182, 118] as const;
const CRYSTAL_GOLD = [214, 170, 52] as const;
const ZERO_RGB: RGB = [0, 0, 0];

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
export function ledLevel(r: number, time: number): number {
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
  /** Changes as chunks with potentially different alpha are published. */
  opacityRevision = 0;
  private opacityChunkRevisions: Uint32Array;
  /** Eight-cell opacity tiles retain revisions across frames and mask consumers. */
  private readonly opacityTileSize = 8;
  private readonly opacityTileCols: number;
  private readonly opacityTiles: Uint32Array;
  private readonly opacityRegion = new LightRegion();
  readonly chunks: TerrainChunks;
  private readonly paintRegions: ChunkRegions;
  private canvases: HTMLCanvasElement[] = [];
  private canvasCtxs: CanvasRenderingContext2D[] = [];
  private blightCanvases: (HTMLCanvasElement | null)[] = [];
  /** Four classification bits per terrain cell, allocated only in Blight chunks. */
  private blightCells: (Uint8Array | null)[] = [];
  private blightCellCounts: Uint32Array;
  private surfaceOutlines: (Path2D | null)[] = [];
  private surfaceGeometry: (SurfaceOutlineCache | null)[];
  /** One pixel per world cell: what the lab's emergency power keeps lit. */
  private glowCanvas: HTMLCanvasElement;
  private glowMask: Uint8Array;
  private glowChunks: Uint8Array;
  private image: ImageData;
  private scratch: number[] = [];
  private col: [number, number, number] = [0, 0, 0];
  private shaded: [number, number, number] = [0, 0, 0];
  rebuiltLastFrame = 0;
  visiblePendingLastFrame = 0;
  /** Per chunk: a mask of its Blight edges, made the first time it has any. */
  private edgeMasks: (HTMLCanvasElement | null)[] = [];
  private edgeValues: (BinaryMask | null)[] = [];
  private dormantValues: (BinaryMask | null)[] = [];
  private edgeLive: Uint8Array;
  private edgeVisibility: Uint8Array;
  private edgeBits: Uint8Array;
  private edgeSolid: Uint8Array;
  private edgeImage: ImageData;
  /** Bumped whenever a chunk's mask changes, so the fire knows to repaint. */
  private edgeVersion = 0;
  /** Unmasked noise changes on animation ticks, independently of growing contours. */
  private edgeNoise = new WeakMap<HTMLCanvasElement, {canvas:HTMLCanvasElement;key:string}>();
  private edgeChunkVersion: Uint32Array;
  private dormantChunkVersion: Uint32Array;
  private edgeUnion = document.createElement("canvas");
  private edgeFire = document.createElement("canvas");
  private edgeFireLow = document.createElement("canvas");
  private edgeFireKey = "";
  private edgeUnionKey = "";
  /** Per chunk: the edges of dormant Blight, drawn with a frozen, darkened fire. */
  private dormantMasks: (HTMLCanvasElement | null)[] = [];
  private dormantLive: Uint8Array;
  private dormantVersion = 0;
  private dormantUnion = document.createElement("canvas");
  private dormantFire = document.createElement("canvas");
  private dormantFireKey = "";
  private dormantUnionKey = "";
  /** True for a half-size subcell index whose colony has no living generator. */
  dormantAt: ((si: number) => boolean) | null = null;
  /** Subcell indices of every blinking status light and pulsing machine core. */
  private lights = new Int32Array(0);
  private lightIndex: SortedGridIndex | null = null;
  /** `TEX` texels per world cell: the lab's floors, under the terrain. */
  private floorCanvas: HTMLCanvasElement;
  private floorRevision = 0;
  private readonly floorRegions: FloorRegions;
  private floorView = document.createElement("canvas");
  private floorViewKey = "";
  private lastFloorKey = "";
  /** Soft round light sprites (white and Blight pink) for the room lights. */
  private panelGlow: HTMLCanvasElement;
  private blightGlow: HTMLCanvasElement;
  private reducedMotion: MediaQueryList | null =
    typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
  private coarsePointer: MediaQueryList | null =
    typeof matchMedia === "function" ? matchMedia("(pointer: coarse)") : null;

  constructor(private world: PixelWorld, chunkSize: number) {
    this.chunks = new TerrainChunks(world, chunkSize);
    this.paintRegions = new ChunkRegions(chunkSize, chunkSize, this.chunks.paintTileSize);
    this.floorRegions = new FloorRegions(world.width, world.height);
    const n = this.chunks.cols * this.chunks.rows;
    this.opacityChunkRevisions = new Uint32Array(n);
    this.opacityTileCols = Math.ceil(chunkSize / this.opacityTileSize);
    this.opacityTiles = new Uint32Array(n * this.opacityTileCols ** 2);
    const subChunk = chunkSize * 2;
    this.surfaceOutlines = new Array<Path2D | null>(n).fill(null);
    this.surfaceGeometry = new Array<SurfaceOutlineCache | null>(n).fill(null);
    for (let i = 0; i < n; i++) {
      const c = document.createElement("canvas");
      c.width = chunkSize * TEX;
      c.height = chunkSize * TEX;
      this.canvases.push(c);
      this.canvasCtxs.push(c.getContext("2d")!);
    }
    this.glowChunks = new Uint8Array(n);
    this.blightCanvases = new Array<HTMLCanvasElement | null>(n).fill(null);
    this.blightCells = new Array<Uint8Array | null>(n).fill(null);
    this.blightCellCounts = new Uint32Array(n);
    this.image = new ImageData(chunkSize * TEX, chunkSize * TEX);
    const edgeSize = subChunk * EDGE_PIXELS_PER_SUB;
    this.edgeMasks = new Array<HTMLCanvasElement | null>(n).fill(null);
    this.edgeValues = new Array<BinaryMask | null>(n).fill(null);
    this.dormantValues = new Array<BinaryMask | null>(n).fill(null);
    this.edgeLive = new Uint8Array(n);
    this.edgeChunkVersion = new Uint32Array(n);
    this.dormantChunkVersion = new Uint32Array(n);
    this.edgeVisibility = new Uint8Array(n);
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
    this.glowMask = new Uint8Array(world.width * world.height);
    this.floorCanvas = document.createElement("canvas");
    this.floorCanvas.width = world.width * TEX;
    this.floorCanvas.height = world.height * TEX;
    this.panelGlow = radialSprite([255, 255, 255]);
    this.blightGlow = radialSprite([255, 70, 160]);
    // Broken or overgrown machinery goes dark.
    world.addListener((cx, cy, kind, sx) => {
      if (kind === "destroyed" || kind === "grown") {
        const idx = cy * world.width + cx;
        if (this.glowMask[idx]) {
          this.glowMask[idx] = 0;
          this.glowCanvas.getContext("2d")!.clearRect(cx, cy, 1, 1);
        }
      }
      // Walls coming down (or Blight filling in) move the floor's contact shadows.
      // Floor contact shadows depend on full-size health, not subcell occupancy.
      if (kind !== "damaged" && sx === undefined) this.floorRegions.mark(cx - 1, cy - 1, cx + 1, cy + 1);
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
    this.floorRegions.clear();
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
    const frame = w.labLayout?.frame;
    const lateEnv = frame?.def.environment;
    const floorRgb: [number, number, number] = [0, 0, 0];
    const solid = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < w.height && w.health[y * W + x] > 0;
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const d = w.decor[cy * W + cx];
        if (d === 0) continue;
        const tiled = !lateEnv && (d === DECOR.cleanSeam || d === DECOR.floorLine);
        const tileTone = 0.93 + hash2(cx >> 2, cy >> 2, 303) * 0.14;
        const lateTier = lateEnv && frame ? lateBlendedTier(frame, cx, cy) : 0;
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
          if (lateEnv) {
            c = lateMaterial(lateEnv, lateTier, gx, gy, "floor", floorRgb);
          } else if (tiled) {
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
    this.flushFloor(this.visibleChunkBounds(cam));
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
      // Avoid clearing/redrawing a full offscreen canvas on every moving-camera frame.
      // Populate the cache only once the view stays unchanged for two consecutive frames.
      if (key !== this.lastFloorKey) {
        this.lastFloorKey = key;
        direct(ctx);
        return;
      }
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
    for (const n of visibleRoomLightIndices(w, cam)) {
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
      const source = roomLightPosition(l, cs);
      const mx = cam.worldToScreenX(source.x);
      const my = cam.worldToScreenY(source.y);
      const rad = l.kind === LIGHT_KIND.blight ? Math.max(rw, rh) * 0.75 : FACILITY.panelRadiusCells * cs * z;
      const needsClip = mx - rad < rx || mx + rad > rx + rw || my - rad < ry || my + rad > ry + rh;
      if (needsClip) {
        g.save();
        g.beginPath();
        g.rect(rx, ry, rw, rh);
        g.clip();
      }
      if (l.kind === LIGHT_KIND.blight) {
        g.globalAlpha = level * FACILITY.blightGlowStrength;
        g.drawImage(this.blightGlow, mx - rad, my - rad, rad * 2, rad * 2);
      } else {
        const strength = l.kind === LIGHT_KIND.bright ? 0.55 : l.kind === LIGHT_KIND.dim ? 0.4 : 0.6;
        g.globalAlpha = level * strength;
        g.drawImage(this.panelGlow, mx - rad, my - rad, rad * 2, rad * 2);
      }
      if (needsClip) g.restore();
    }
    g.restore();
  }

  /** The lit tubes themselves, drawn additively after the lighting pass. */
  drawPanels(ctx: CanvasRenderingContext2D, cam: CameraSystem, time: number, bloomOnly = false): void {
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
    for (const n of visibleRoomLightIndices(w, cam)) {
      const l = w.roomLights[n];
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
        if (!bloomOnly) {
          ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
          ctx.fillStyle = "#080c10"; ctx.fillRect(tx-unit*.06,ty-unit*.06,tw+unit*.12,th+unit*.12);
          ctx.fillStyle = color;
        }
        ctx.globalAlpha = level * .9;
        ctx.fillRect(tx,ty,tw,th);
        if (!bloomOnly) ctx.globalCompositeOperation = "lighter";
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
    this.lightIndex = new SortedGridIndex(this.lights, this.world.subWidth, this.world.subHeight);
  }

  /** Register a newly settled LED or Core subcell so its blinking/pulsing light stays active. */
  addLabLight(sx: number, sy: number): void {
    const si = sy * this.world.subWidth + sx;
    const k = this.world.subKind[si];
    if (this.world.subHealth[si] === 0 || (k !== SUB.led && k !== SUB.core)) return;
    // Binary search for insertion point in sorted `lights`.
    let lo = 0;
    let hi = this.lights.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.lights[mid] < si) lo = mid + 1;
      else hi = mid;
    }
    if (lo < this.lights.length && this.lights[lo] === si) return;
    const next = new Int32Array(this.lights.length + 1);
    next.set(this.lights.subarray(0, lo), 0);
    next[lo] = si;
    next.set(this.lights.subarray(lo), lo + 1);
    this.lights = next;
    this.lightIndex = new SortedGridIndex(this.lights, this.world.subWidth, this.world.subHeight);
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
    const index = this.lightIndex!;
    for (let row = Math.max(0, y0); row <= Math.min(w.subHeight-1, y1); row++) {
      const rowStart = index.rows[row], rowEnd = index.rows[row+1];
      if (rowStart === rowEnd) continue;
      const start = index.lowerBound(row*sw+x0, rowStart, rowEnd);
      const end = index.lowerBound(row*sw+x1+1, start, rowEnd);
      for (let n = start; n < end; n++) {
        const si = lights[n];
        const sy = row, sx = si - row * sw;
        if (w.subHealth[si] === 0) continue;
        const k = w.subKind[si];
        const tint = w.subTint[si];
        const r = tint & 63;
        let level: number;
        let css: string;
        if (k === SUB.led) {
          css = LAB_LED_CSS[tint >> 6];
          level = still ? 0.8 : ledLevel(r, t);
        } else if (k === SUB.core) {
          css = LAB_CORE_CSS[tint >> 6];
          level = still ? 0.7 : 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * (1.2 + (r & 7) * 0.15) + (sx + sy) * 0.45 + (r >> 3)));
        } else continue;
        if (level <= 0.02) continue;
        const lx = cam.worldToScreenX(sx * ss);
        const ly = cam.worldToScreenY(sy * ss);
        ctx.fillStyle = css;
        // Soft halo, then the lit pixel itself.
        ctx.globalAlpha = level * (k === SUB.core ? 0.16 : 0.12);
        ctx.fillRect(lx - px, ly - px, px * 3, px * 3);
        ctx.globalAlpha = level;
        ctx.fillRect(lx, ly, px, px);
      }
    }
    ctx.restore();
  }

  private buildGlow(): void {
    const { world } = this;
    const g = this.glowCanvas.getContext("2d")!;
    const image = g.createImageData(world.width, world.height);
    this.glowMask.fill(0);
    this.glowChunks.fill(0);
    const cs = this.chunks.chunkSize;
    const cols = this.chunks.cols;
    const W = world.width;
    const markGlowChunk = (i: number): void => {
      const cx = i % W;
      const cy = (i - cx) / W;
      this.glowChunks[Math.floor(cy / cs) * cols + Math.floor(cx / cs)] = 1;
    };
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
          this.glowMask[i] = 1;
          markGlowChunk(i);
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
      this.glowMask[i] = 1;
      markGlowChunk(i);
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
    this.drawCellOverlay(ctx, cam, this.glowCanvas, this.glowChunks);
    ctx.restore();
  }

  /** Only chunks drawn into the current terrain mask contribute to its revision. */
  visibleOpacityRevision(cam: CameraSystem): string {
    let revision = "";
    this.forEachVisibleChunk(cam, (kx, ky) => {
      const k = ky * this.chunks.cols + kx;
      revision += k + ":" + this.opacityChunkRevisions[k] + ",";
    });
    return revision;
  }

  /** A scroll is exact only when both ends of every visible chunk translate
   * equally, with no device-pixel resampling. Fractional zoom can reject it. */
  opacityScrollOffset(cam: CameraSystem, oldX: number, oldY: number, dpr: number): { dx: number; dy: number; sameChunks: boolean } | null {
    const unit = this.world.cellSize * this.chunks.chunkSize;
    const x0 = Math.max(0, Math.floor(((0 - cam.viewW / 2) / cam.zoom + oldX) / unit));
    const x1 = Math.min(this.chunks.cols - 1, Math.floor(((cam.viewW - cam.viewW / 2) / cam.zoom + oldX) / unit));
    const y0 = Math.max(0, Math.floor(((0 - cam.viewH / 2) / cam.zoom + oldY) / unit));
    const y1 = Math.min(this.chunks.rows - 1, Math.floor(((cam.viewH - cam.viewH / 2) / cam.zoom + oldY) / unit));
    let dx: number | undefined, dy: number | undefined, valid = true, sameChunks = true, count = 0;
    this.forEachVisibleChunk(cam, (kx, ky, sx, sy, sw, sh) => {
      const oldLeft = Math.round((kx * unit - oldX) * cam.zoom + cam.viewW / 2);
      const oldRight = Math.round(((kx + 1) * unit - oldX) * cam.zoom + cam.viewW / 2);
      const oldTop = Math.round((ky * unit - oldY) * cam.zoom + cam.viewH / 2);
      const oldBottom = Math.round(((ky + 1) * unit - oldY) * cam.zoom + cam.viewH / 2);
      dx ??= sx - oldLeft; dy ??= sy - oldTop;
      if (sx - oldLeft !== dx || sx + sw - oldRight !== dx || sy - oldTop !== dy || sy + sh - oldBottom !== dy) valid = false;
      if (kx < x0 || kx > x1 || ky < y0 || ky > y1) sameChunks = false;
      count++;
    });
    if (!valid || dx === undefined || dy === undefined || !Number.isInteger(dx * dpr) || !Number.isInteger(dy * dpr)) return null;
    sameChunks &&= count === Math.max(0, x1 - x0 + 1) * Math.max(0, y1 - y0 + 1);
    return { dx: dx * dpr, dy: dy * dpr, sameChunks };
  }

  /** Device-pixel union of opacity tiles changed since this mask's last build.
   * Revisions are persistent, so skipped frames and independent views are safe. */
  opacityUpdateBounds(cam: CameraSystem, since: number, width: number, height: number, dpr: number): ScreenRect | null {
    if (this.opacityRevision > 0xffffffff || since > this.opacityRevision) return { x: 0, y: 0, width, height };
    const region = this.opacityRegion, cols = this.opacityTileCols, cs = this.chunks.chunkSize;
    region.reset();
    this.forEachVisibleChunk(cam, (kx, ky, sx, sy, sw, sh) => {
      const k = ky * this.chunks.cols + kx;
      if (this.opacityChunkRevisions[k] <= since) return;
      for (let y = 0; y < cols; y++) for (let x = 0; x < cols; x++) {
        if (this.opacityTiles[k * cols * cols + y * cols + x] <= since) continue;
        const x0 = x * this.opacityTileSize, y0 = y * this.opacityTileSize;
        const x1 = Math.min(cs, x0 + this.opacityTileSize), y1 = Math.min(cs, y0 + this.opacityTileSize);
        region.include(sx + x0 / cs * sw, sy + y0 / cs * sh, 0);
        region.include(sx + x1 / cs * sw, sy + y1 / cs * sh, 0);
      }
    });
    return region.resolve(width, height, dpr, 2);
  }

  private buildChunk(k: number): void {
    this.renderRevision++;
    if (this.chunks.opacityDirty[k]) {
      this.opacityChunkRevisions[k] = ++this.opacityRevision;
      const cols = this.opacityTileCols, size = this.opacityTileSize;
      for (let y = Math.floor(this.chunks.y0[k] / size); y <= Math.floor(this.chunks.y1[k] / size); y++) {
        for (let x = Math.floor(this.chunks.x0[k] / size); x <= Math.floor(this.chunks.x1[k] / size); x++) {
          this.opacityTiles[k * cols * cols + y * cols + x] = this.opacityRevision;
        }
      }
      this.chunks.opacityDirty[k] = 0;
    }
    const { world, chunks, paintRegions } = this;
    const cs = chunks.chunkSize, kx = k % chunks.cols, ky = Math.floor(k / chunks.cols);
    const x0 = chunks.x0[k], y0 = chunks.y0[k], x1 = chunks.x1[k], y1 = chunks.y1[k];
    const count = chunks.paintTileCols ** 2;
    const tiles = chunks.paintTiles.subarray(k * count, (k + 1) * count);
    paintRegions.update(tiles, undefined, x0, y0, x1, y1);
    for (let r = 0; r < paintRegions.count; r++) {
      const p = r * 4, rects = paintRegions.rects;
      this.paintChunkRegion(k, rects[p], rects[p + 1], rects[p] + rects[p + 2] - 1, rects[p + 1] + rects[p + 3] - 1);
    }
    tiles.fill(0);

    if (this.chunks.geometryDirty[k]) {
      const subs = cs * 2;
      const geometry = this.surfaceGeometry[k] ?? new SurfaceOutlineCache(subs);
      const changed = geometry.update(world, kx * subs, ky * subs, this.edgeSolid, {
        x0: x0 * 2, y0: y0 * 2, x1: (x1 + 1) * 2 - 1, y1: (y1 + 1) * 2 - 1,
      });
      this.surfaceGeometry[k] = geometry.empty ? null : geometry;
      if (geometry.empty) this.surfaceOutlines[k] = null;
      else if (changed) {
        const path = new Path2D();
        geometry.trace((x, y, width, height) => path.rect(x, y, width, height));
        this.surfaceOutlines[k] = path;
      }
      this.buildEdgeMask(k, kx, ky);
      this.chunks.geometryDirty[k] = 0;
    }
  }

  /** Paint/upload only valid rectangles of the shared scratch image. */
  private paintChunkRegion(k: number, x0: number, y0: number, x1: number, y1: number): void {
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
    for (let ly = y0; ly <= y1; ly++) {
      const cy = ky * cs + ly;
      for (let lx = x0; lx <= x1; lx++) {
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
              const shaded = this.shaded;
              for (let oy = 0; oy < 2; oy++) {
                for (let ox = 0; ox < 2; ox++) {
                  subPixelTexelShade(sk, sx, sy, ox, oy, subUp, subLeft, subDown, subRight, col, shaded);
                  put(bx + ox, by + oy, shaded[0], shaded[1], shaded[2], 255);
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
          const crack = Math.max(world.glassCracked[i] ? 0.65 : 0, hp < maxHpG ? 1 - hp / maxHpG : 0);
          const a = Math.min(255, COLORS.glassAlpha + (edge ? 40 : 0) + crack * 90);
          for (let t = 0; t < TEX * TEX; t++) {
            const ox = t % TEX;
            const oy = (t - ox) / TEX;
            // A thin diagonal glint across each pane.
            const glint = (cx * TEX + ox + cy * TEX + oy) % 6 === 0 ? 26 : 0;
            const fracture = crack > 0 ? crackTexelAt(cx, cy, ox, oy, crack) : 0;
            const light = fracture ? (fracture === 2 ? 100 : 55) : glint;
            put(tx0 + ox, ty0 + oy, g[0] + light, g[1] + light, g[2] + light, fracture ? 240 : a);
          }
          continue;
        }
        if (material === MAT.crystal) {
          this.paintCrystal(cx, cy, i, hp, up, left, down, right, tx0, ty0, put);
          continue;
        }
        const t = tint[i] / 255;
        const tier = this.materialTier(cx, cy);
        const frame = world.labLayout?.frame;
        const lateEnv = frame?.def.environment;
        const lateTier = lateEnv && frame ? lateBlendedTier(frame, cx, cy) : tier;
        const lateFeature = lateEnv && frame ? lateCellFeature(frame, cx, cy) : "solid";
        const base = lateEnv ? ZERO_RGB : materialColor(tier, !!frame?.def.framework);
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
            if (lateEnv) {
              lateMaterial(lateEnv, lateTier, gx, gy, lateFeature, col);
              col[0] *= tone;
              col[1] *= tone;
              col[2] *= tone;
            } else {
              const s = materialShade(tier, gx, gy) * tone;
              col[0] = base[0] * s;
              col[1] = base[1] * s;
              col[2] = base[2] * s;
            }
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
    // The shared image contains valid pixels only inside this edit rectangle.
    const tx0 = x0 * TEX, ty0 = y0 * TEX;
    const tw = (x1 - x0 + 1) * TEX, th = (y1 - y0 + 1) * TEX;
    this.canvasCtxs[k].putImageData(this.image, 0, 0, tx0, ty0, tw, th);
    // Reuse the albedo pixels, masking everything except living Blight.
    // This cache changes with its terrain chunk, never by scanning the view.
    let cells = this.blightCells[k];
    let count = this.blightCellCounts[k];
    const geometry = this.chunks.geometryDirty[k];
    const halfTex = TEX / 2;
    for (let ly = y0; ly <= y1; ly++) for (let lx = x0; lx <= x1; lx++) {
      const ci = ly * cs + lx;
      const previous = cells?.[ci] ?? 0;
      let mask = previous;
      if (geometry) {
        mask = 0;
        for (let sub = 0; sub < 4; sub++) {
          const sx = (kx * cs + lx) * 2 + (sub & 1);
          const sy = (ky * cs + ly) * 2 + (sub >> 1);
          if (world.isBlightSubAt(sx, sy)) mask |= 1 << sub;
        }
        if (mask !== previous) {
          if (!cells) cells = new Uint8Array(cs * cs);
          cells[ci] = mask;
          count += (mask ? 1 : 0) - (previous ? 1 : 0);
        }
      }
      for (let sub = 0; sub < 4; sub++) {
        if (mask & (1 << sub)) continue;
        const tx = lx * TEX + (sub & 1) * halfTex;
        const ty = ly * TEX + (sub >> 1) * halfTex;
        for (let oy = 0; oy < halfTex; oy++) for (let ox = 0; ox < halfTex; ox++) {
          data[((ty + oy) * texCs + tx + ox) * 4 + 3] = 0;
        }
      }
    }
    this.blightCells[k] = count ? cells : null;
    this.blightCellCounts[k] = count;
    if (count) {
      const canvas = this.blightCanvases[k] ?? document.createElement("canvas");
      if (!this.blightCanvases[k]) canvas.width = canvas.height = texCs;
      canvas.getContext("2d")!.putImageData(this.image, 0, 0, tx0, ty0, tw, th);
      this.blightCanvases[k] = canvas;
    } else this.blightCanvases[k] = null;
  }

  /** Albedo of a live half-size pixel, before relief shading. */
  private subColor(si: number, sx: number, sy: number, subHp: number, col: number[]): void {
    const world = this.world;
    subPixelColor(
      world.subKind[si],
      world.subTint[si],
      sy,
      subHp,
      world.maxSubHealthAt(sx, sy),
      this.dormantAt?.(si) ?? false,
      col,
    );
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
    // A vein shows the currency it pays: gold in the Lab, orange crystal in the
    // Blighted Wards (procedural test worlds keep orange / green by wall tier).
    const base = w.labLayout?.frame ? (w.tierBase < 3 ? CRYSTAL_GOLD : CRYSTAL_ORANGE) : w.wall[i] >= 3 ? CRYSTAL_GREEN : CRYSTAL_ORANGE;
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
    const cs = this.chunks.chunkSize, subs = cs * 2;
    // Partial world-edge chunks retain the full scan's border conventions.
    const partial = (kx + 1) * cs > this.world.width || (ky + 1) * cs > this.world.height;
    const region: SubcellRegion = partial ? { x0: 0, y0: 0, x1: subs - 1, y1: subs - 1 } : {
      x0: this.chunks.x0[k] * 2, y0: this.chunks.y0[k] * 2,
      x1: (this.chunks.x1[k] + 1) * 2 - 1, y1: (this.chunks.y1[k] + 1) * 2 - 1,
    };
    const dormant = this.dormantAt, sw = this.world.subWidth;
    const live = dormant ? (sx: number, sy: number) => !dormant(sy * sw + sx) : undefined;
    const count = markBlightEdges(this.world, kx * subs, ky * subs, subs, this.edgeBits, this.edgeSolid, live, false, region);
    this.publishEdgeMask(k, region, count, false);
    if (dormant) {
      const count = markBlightEdges(this.world, kx * subs, ky * subs, subs, this.edgeBits, this.edgeSolid,
        (sx, sy) => dormant(sy * sw + sx), true, region);
      this.publishEdgeMask(k, region, count, true);
    } else {
      // A removed dormancy predicate may move all old dormant edges to live.
      // Its callers invalidate all chunks, so the full dirty region clears them.
      const size = this.edgeImage.width, scale = EDGE_PIXELS_PER_SUB;
      for (let y = region.y0 * scale; y < (region.y1 + 1) * scale; y++) {
        this.edgeBits.fill(0, y * size + region.x0 * scale, y * size + (region.x1 + 1) * scale);
      }
      this.publishEdgeMask(k, region, 0, true);
    }
  }

  private publishEdgeMask(k: number, region: SubcellRegion, regionalCount: number, frozen: boolean): void {
    const values = frozen ? this.dormantValues : this.edgeValues;
    const masks = frozen ? this.dormantMasks : this.edgeMasks;
    const live = frozen ? this.dormantLive : this.edgeLive;
    const revisions = frozen ? this.dormantChunkVersion : this.edgeChunkVersion;
    if (!regionalCount && !values[k]) return;
    const value = values[k] ?? (values[k] = new BinaryMask(this.edgeImage.width));
    const scale = EDGE_PIXELS_PER_SUB;
    const x = region.x0 * scale, y = region.y0 * scale;
    const width = (region.x1 - region.x0 + 1) * scale, height = (region.y1 - region.y0 + 1) * scale;
    if (!value.update(this.edgeBits, x, y, x + width - 1, y + height - 1)) return;
    revisions[k] = frozen ? ++this.dormantVersion : ++this.edgeVersion;
    live[k] = value.count ? 1 : 0;
    if (!value.count) {
      values[k] = null;
      masks[k] = null;
      return;
    }
    masks[k] = this.writeMask(masks[k], x, y, width, height);
  }

  /** Upload only scratch pixels belonging to this edit; the canvas keeps the rest. */
  private writeMask(mask: HTMLCanvasElement | null, x: number, y: number, width: number, height: number): HTMLCanvasElement {
    if (!mask) {
      mask = document.createElement("canvas");
      mask.width = mask.height = this.edgeImage.width;
    }
    const size = this.edgeImage.width, data = this.edgeImage.data, bits = this.edgeBits;
    for (let row = y; row < y + height; row++) for (let col = x; col < x + width; col++) {
      const i = row * size + col;
      data[i * 4 + 3] = bits[i] * 255;
    }
    mask.getContext("2d")!.putImageData(this.edgeImage, 0, 0, x, y, width, height);
    return mask;
  }

  /** Cached Blight albedo, drawn after fog without exposing other terrain. */
  drawBlightThroughFog(ctx: CanvasRenderingContext2D, cam: CameraSystem): void {
    const smoothing = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    this.forEachVisibleChunk(cam, (kx, ky, sx, sy, sw, sh) => {
      const canvas = this.blightCanvases[ky * this.chunks.cols + kx];
      if (canvas) ctx.drawImage(canvas, sx, sy, sw, sh);
    });
    ctx.imageSmoothingEnabled = smoothing;
  }

  /**
   * The burning dimension seen through a thin line round every Blight block,
   * after TowerDefense's pixel portal contours: fire is painted at the mask's own
   * pixel size, cut to the edges and scaled up unsmoothed. It is anchored to the
   * world and emissive, so draw it after the lighting pass. `seconds` is wall clock.
   */
  drawBlightEdges(ctx: CanvasRenderingContext2D, cam: CameraSystem, seconds: number, fog?: FogOfWar): void {
    let visible: Uint8Array | undefined;
    if (fog) {
      visible = this.edgeVisibility;
      visible.fill(0);
      const unit = this.chunks.chunkSize * this.world.cellSize;
      this.forEachVisibleChunk(cam, (kx, ky) => {
        const k = ky * this.chunks.cols + kx;
        if ((this.edgeLive[k] || this.dormantLive[k]) && fogRegionVisible(fog,kx*unit,ky*unit,(kx+1)*unit,(ky+1)*unit)) visible![k] = 1;
      });
    }
    const shrink = this.coarsePointer?.matches || cam.zoom < EDGE_FIRE_FULL_ZOOM ? 2 : 1;
    this.drawEdgeLayer(ctx, cam, this.edgeMasks, this.edgeLive, this.edgeUnion, this.edgeFire, seconds, shrink, false, visible);
    this.drawEdgeLayer(ctx, cam, this.dormantMasks, this.dormantLive, this.dormantUnion, this.dormantFire, seconds, shrink, true, visible);
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
    visible?: Uint8Array,
  ): void {
    const size = this.edgeImage.width;
    const cols = this.chunks.cols;
    let kx0 = Infinity;
    let ky0 = Infinity;
    let kx1 = -1;
    let ky1 = -1;
    this.forEachVisibleChunk(cam, (kx, ky) => {
      if (!live[ky * cols + kx] || (visible && !visible[ky * cols + kx])) return;
      if (kx < kx0) kx0 = kx;
      if (ky < ky0) ky0 = ky;
      if (kx > kx1) kx1 = kx;
      if (ky > ky1) ky1 = ky;
    });
    if (kx1 < 0) return;
    const w = (kx1 - kx0 + 1) * size;
    const h = (ky1 - ky0 + 1) * size;
    // Growth outside this view must not invalidate the visible fire/mask cache.
    const revisions = frozen ? this.dormantChunkVersion : this.edgeChunkVersion;
    let version = "";
    for (let ky = ky0; ky <= ky1; ky++) for (let kx = kx0; kx <= kx1; kx++) version += revisions[ky * cols + kx] + ",";
    const fps = this.coarsePointer?.matches ? EDGE_FIRE_FPS_MOBILE : EDGE_FIRE_FPS;
    const tick = frozen ? "frozen" : `${Math.floor(seconds * fps)}`;
    const key = `${tick}:${version}:${kx0}:${ky0}:${kx1}:${ky1}:${shrink}`;
    if (key !== (frozen ? this.dormantFireKey : this.edgeFireKey)) {
      if (frozen) this.dormantFireKey = key;
      else this.edgeFireKey = key;
      const maskKey = `${version}:${kx0}:${ky0}:${kx1}:${ky1}`;
      const rebuildMask = maskKey !== (frozen ? this.dormantUnionKey : this.edgeUnionKey);
      this.paintEdgeFire(masks, live, union, fire, kx0, ky0, kx1, ky1, w, h, frozen ? FROZEN_FIRE_TIME : seconds, shrink, frozen, rebuildMask);
      if (frozen) this.dormantUnionKey = maskKey;
      else this.edgeUnionKey = maskKey;
    }
    const smoothing = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    this.forEachVisibleChunk(cam, (kx, ky, sx, sy, sw, sh) => {
      if (!live[ky * cols + kx] || (visible && !visible[ky * cols + kx])) return;
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
    rebuildMask: boolean,
  ): void {
    const size = this.edgeImage.width;
    const cols = this.chunks.cols;
    if (union.width < w || union.height < h) {
      const cw = Math.max(union.width, Math.ceil(w / EDGE_CANVAS_STEP) * EDGE_CANVAS_STEP);
      const ch = Math.max(union.height, Math.ceil(h / EDGE_CANVAS_STEP) * EDGE_CANVAS_STEP);
      rebuildMask = true;
      union.width = fire.width = cw;
      union.height = fire.height = ch;
    }
    if (rebuildMask) {
      const u = union.getContext("2d")!;
      u.clearRect(0, 0, union.width, union.height);
      for (let ky = ky0; ky <= ky1; ky++) {
        for (let kx = kx0; kx <= kx1; kx++) {
          const k = ky * cols + kx;
          if (live[k]) u.drawImage(masks[k]!, (kx - kx0) * size, (ky - ky0) * size);
        }
      }
    }
    let cached = this.edgeNoise.get(fire);
    if (!cached) {
      cached = {canvas:document.createElement("canvas"),key:""};
      this.edgeNoise.set(fire,cached);
    }
    let occupancy = "";
    for (let ky=ky0;ky<=ky1;ky++) for(let kx=kx0;kx<=kx1;kx++) occupancy += live[ky*cols+kx] ? "1" : "0";
    const noiseKey = `${Math.floor(seconds * EDGE_FIRE_FPS)}:${kx0}:${ky0}:${kx1}:${ky1}:${shrink}:${frozen}:${occupancy}`;
    if (cached.key !== noiseKey || cached.canvas.width !== fire.width || cached.canvas.height !== fire.height) {
      cached.key = noiseKey;
      const noise = cached.canvas;
      if (noise.width !== fire.width || noise.height !== fire.height) { noise.width=fire.width;noise.height=fire.height; }
      const f = noise.getContext("2d")!;
      f.setTransform(1, 0, 0, 1, 0, 0);
      f.globalCompositeOperation = "source-over";
      f.clearRect(0, 0, noise.width, noise.height);
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
      f.restore();
      f.globalCompositeOperation = "source-over";
    }
    const f = fire.getContext("2d")!;
    f.setTransform(1,0,0,1,0,0);
    f.globalCompositeOperation = "source-over";
    f.clearRect(0,0,fire.width,fire.height);
    f.drawImage(cached.canvas,0,0);
    f.globalCompositeOperation = "destination-in";
    f.drawImage(union,0,0);
    f.globalCompositeOperation = "source-over";
  }

  /**
   * Draw a canvas holding one pixel per world cell with the exact chunk mapping of
   * `draw`, so each of its pixels covers the same screen pixels as that terrain cell.
   */
  drawCellOverlay(ctx: CanvasRenderingContext2D, cam: CameraSystem, overlay: HTMLCanvasElement, activeChunks?: Uint8Array): void {
    const cs = this.chunks.chunkSize;
    ctx.imageSmoothingEnabled = false;
    this.forEachVisibleChunk(cam, (kx, ky, sx, sy, sw, sh) => {
      if (activeChunks && !activeChunks[ky * this.chunks.cols + kx]) return;
      ctx.drawImage(overlay, kx * cs, ky * cs, cs, cs, sx, sy, sw, sh);
    });
  }

  /**
   * Copy the floors and terrain of cells (x0, y0)..(x0 + w - 1, y0 + h - 1) into
   * `ctx` at full texel resolution (TEX px per cell), top-left at (0, 0). Used
   * for the lab map's sector pictures.
   */
  drawRegion(ctx: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number): void {
    const region = this.chunkBounds(x0, y0, x0 + w - 1, y0 + h - 1);
    this.flushFloor(region);
    this.chunks.take(Infinity, this.scratch, region);
    for (const k of this.scratch) this.buildChunk(k);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.floorCanvas, x0 * TEX, y0 * TEX, w * TEX, h * TEX, 0, 0, w * TEX, h * TEX);
    const cs = this.chunks.chunkSize;
    const { x0: kx0, y0: ky0, x1: kx1, y1: ky1 } = region;
    for (let ky = ky0; ky <= ky1; ky++) {
      for (let kx = kx0; kx <= kx1; kx++) {
        ctx.drawImage(this.canvases[ky * this.chunks.cols + kx], (kx * cs - x0) * TEX, (ky * cs - y0) * TEX);
      }
    }
  }

  private flushFloor(region?: ChunkBounds): void {
    const cs = this.chunks.chunkSize;
    const cells = region && {
      x0: region.x0 * cs, y0: region.y0 * cs,
      x1: (region.x1 + 1) * cs - 1, y1: (region.y1 + 1) * cs - 1,
    };
    this.floorRegions.flush((x0, y0, x1, y1) => this.paintFloor(x0, y0, x1, y1), cells);
  }

  /** Publish the chunks used by the upcoming frame. Distant edits coalesce until viewed. */
  update(cam?: CameraSystem): void {
    const region = cam && this.visibleChunkBounds(cam);
    this.flushFloor(region);
    const budget = this.coarsePointer?.matches ? Math.min(8, TERRAIN.chunkRebuildBudget) : TERRAIN.chunkRebuildBudget;
    this.visiblePendingLastFrame = this.chunks.take(budget, this.scratch, region);
    this.rebuiltLastFrame = this.scratch.length;
    for (const k of this.scratch) this.buildChunk(k);
  }

  draw(ctx: CanvasRenderingContext2D, cam: CameraSystem, showBorders = false, region?: ScreenRect): void {
    ctx.imageSmoothingEnabled = false;
    this.forEachVisibleChunk(cam, (kx, ky, sx, sy, sw, sh) => {
      if (region && (sx + sw < region.x || sy + sh < region.y || sx > region.x + region.width || sy > region.y + region.height)) return;
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

  private chunkBounds(x0: number, y0: number, x1: number, y1: number): ChunkBounds {
    const cs = this.chunks.chunkSize;
    return {
      x0: Math.max(0, Math.floor(x0 / cs)),
      y0: Math.max(0, Math.floor(y0 / cs)),
      x1: Math.min(this.chunks.cols - 1, Math.floor(x1 / cs)),
      y1: Math.min(this.chunks.rows - 1, Math.floor(y1 / cs)),
    };
  }

  private visibleChunkBounds(cam: CameraSystem): ChunkBounds {
    const cs = this.world.cellSize;
    return this.chunkBounds(cam.screenToWorldX(0) / cs, cam.screenToWorldY(0) / cs,
      cam.screenToWorldX(cam.viewW) / cs, cam.screenToWorldY(cam.viewH) / cs);
  }

  private forEachVisibleChunk(
    cam: CameraSystem,
    fn: (kx: number, ky: number, sx: number, sy: number, sw: number, sh: number) => void,
  ): void {
    const unit = this.world.cellSize * this.chunks.chunkSize;
    const { x0: kx0, y0: ky0, x1: kx1, y1: ky1 } = this.visibleChunkBounds(cam);
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
