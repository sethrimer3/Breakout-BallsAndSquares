import { COLORS, TERRAIN, TERRAIN as T, zoneForDepth } from "../config";
import type { CameraSystem } from "../systems/CameraSystem";
import type { PixelWorld } from "../world/PixelWorld";
import { TerrainChunks } from "../world/TerrainChunks";

type RGB = readonly [number, number, number];
type Ramp4 = readonly [RGB, RGB, RGB, RGB];

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

  constructor(private world: PixelWorld, chunkSize: number) {
    this.chunks = new TerrainChunks(world, chunkSize);
    const n = this.chunks.cols * this.chunks.rows;
    for (let i = 0; i < n; i++) {
      const c = document.createElement("canvas");
      c.width = chunkSize;
      c.height = chunkSize;
      this.canvases.push(c);
    }
    this.image = new ImageData(chunkSize, chunkSize);
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
        const p = (ly * cs + lx) * 4;
        if (cx >= W || cy >= world.height) {
          data[p + 3] = 0;
          continue;
        }
        const i = cy * W + cx;
        const hp = health[i];
        if (hp === 0) {
          data[p] = 0;
          data[p + 1] = 0;
          data[p + 2] = 0;
          data[p + 3] = 0;
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

        // Damage tint.
        if (hp < maxHp) {
          const d = 1 - hp / maxHp;
          const f = 0.25 + d * 0.4;
          col[0] += (COLORS.damage[0] - col[0]) * f;
          col[1] += (COLORS.damage[1] - col[1]) * f;
          col[2] += (COLORS.damage[2] - col[2]) * f;
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
        data[p] = Math.min(255, col[0] * m + add);
        data[p + 1] = Math.min(255, col[1] * m + add);
        data[p + 2] = Math.min(255, col[2] * m + add * 1.3);
        data[p + 3] = 255;
      }
    }
    this.canvases[k].getContext("2d")!.putImageData(this.image, 0, 0);
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
