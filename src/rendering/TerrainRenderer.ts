import { COLORS, TERRAIN, TERRAIN as T, zoneForDepth } from "../config";
import { EDGE_PIXELS_PER_SUB, markBlightEdges } from "./blightEdges";
import { paintPortal } from "./portalNoise";
import type { CameraSystem } from "../systems/CameraSystem";
import type { PixelWorld } from "../world/PixelWorld";
import { TerrainChunks } from "../world/TerrainChunks";

type RGB = readonly [number, number, number];
type Ramp4 = readonly [RGB, RGB, RGB, RGB];

/** How large the burning dimension's noise reads through a Blight edge. */
const EDGE_FIRE_RATIO = 0.7;
/** Steps a second the edge fire redraws at (motion, not camera, drives this). */
const EDGE_FIRE_FPS = 15;
/** Below this zoom the edges are so thin the fire paints at half size, then scales up. */
const EDGE_FIRE_FULL_ZOOM = 1.5;
/** Edge canvases grow in steps this size, so a moving view doesn't reallocate them. */
const EDGE_CANVAS_STEP = 256;

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
    this.edgeBits = new Uint8Array(edgeSize * edgeSize);
    this.edgeSolid = new Uint8Array((subChunk + 2) * (subChunk + 2));
    this.edgeImage = new ImageData(edgeSize, edgeSize);
    this.edgeImage.data.fill(255);
    this.chunks.markAll();
    this.glowCanvas = document.createElement("canvas");
    this.glowCanvas.width = world.width;
    this.glowCanvas.height = world.height;
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
  }

  private buildGlow(): void {
    const { world } = this;
    const g = this.glowCanvas.getContext("2d")!;
    const image = g.createImageData(world.width, world.height);
    for (let i = 0; i < world.decor.length; i++) {
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
                sampleRamp(COLORS.pinkBlight, subT, col);
                const maxSubHp = world.maxSubHealthAt(sx, sy);
                if (subHp < maxSubHp) {
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
  }

  private buildEdgeMask(k: number, kx: number, ky: number): void {
    const subs = this.chunks.chunkSize * 2;
    const count = markBlightEdges(this.world, kx * subs, ky * subs, subs, this.edgeBits, this.edgeSolid);
    if (count === 0) {
      if (this.edgeLive[k]) {
        this.edgeLive[k] = 0;
        this.edgeVersion++;
      }
      return;
    }
    let mask = this.edgeMasks[k];
    if (!mask) {
      mask = document.createElement("canvas");
      mask.width = mask.height = this.edgeImage.width;
      this.edgeMasks[k] = mask;
    }
    const data = this.edgeImage.data;
    const bits = this.edgeBits;
    for (let i = 0; i < bits.length; i++) data[i * 4 + 3] = bits[i] * 255;
    mask.getContext("2d")!.putImageData(this.edgeImage, 0, 0);
    this.edgeLive[k] = 1;
    this.edgeVersion++;
  }

  /**
   * The burning dimension seen through a thin line round every Blight block,
   * after TowerDefense's pixel portal contours: fire is painted at the mask's own
   * pixel size, cut to the edges and scaled up unsmoothed. It is anchored to the
   * world and emissive, so draw it after the lighting pass. `seconds` is wall clock.
   */
  drawBlightEdges(ctx: CanvasRenderingContext2D, cam: CameraSystem, seconds: number): void {
    const size = this.edgeImage.width;
    const cols = this.chunks.cols;
    let kx0 = Infinity;
    let ky0 = Infinity;
    let kx1 = -1;
    let ky1 = -1;
    this.forEachVisibleChunk(cam, (kx, ky) => {
      if (!this.edgeLive[ky * cols + kx]) return;
      if (kx < kx0) kx0 = kx;
      if (ky < ky0) ky0 = ky;
      if (kx > kx1) kx1 = kx;
      if (ky > ky1) ky1 = ky;
    });
    if (kx1 < 0) return;
    const w = (kx1 - kx0 + 1) * size;
    const h = (ky1 - ky0 + 1) * size;
    const shrink = cam.zoom < EDGE_FIRE_FULL_ZOOM ? 2 : 1;
    const key = `${Math.floor(seconds * EDGE_FIRE_FPS)}:${this.edgeVersion}:${kx0}:${ky0}:${kx1}:${ky1}:${shrink}`;
    if (key !== this.edgeFireKey) {
      this.edgeFireKey = key;
      this.paintEdgeFire(kx0, ky0, kx1, ky1, w, h, seconds, shrink);
    }
    const smoothing = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    this.forEachVisibleChunk(cam, (kx, ky, sx, sy, sw, sh) => {
      if (!this.edgeLive[ky * cols + kx]) return;
      ctx.drawImage(this.edgeFire, (kx - kx0) * size, (ky - ky0) * size, size, size, sx, sy, sw, sh);
    });
    ctx.imageSmoothingEnabled = smoothing;
  }

  private paintEdgeFire(
    kx0: number,
    ky0: number,
    kx1: number,
    ky1: number,
    w: number,
    h: number,
    seconds: number,
    shrink: number,
  ): void {
    const size = this.edgeImage.width;
    const cols = this.chunks.cols;
    const union = this.edgeUnion;
    const fire = this.edgeFire;
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
        if (this.edgeLive[k]) u.drawImage(this.edgeMasks[k]!, (kx - kx0) * size, (ky - ky0) * size);
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
