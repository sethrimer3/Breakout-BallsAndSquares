import { MAT, type PixelWorld } from "./PixelWorld";

/** Inclusive rectangle in chunk coordinates. */
export interface ChunkBounds { x0: number; y0: number; x1: number; y1: number; }

/**
 * Tracks which terrain chunks need re-rendering. Pure bookkeeping (no DOM),
 * so it can be shared by the renderer and unit-tested.
 */
export class TerrainChunks {
  readonly chunkSize: number;
  readonly cols: number;
  readonly rows: number;
  readonly dirty: Uint8Array;
  /** Geometry/classification changed, rather than only HP-dependent artwork. */
  readonly geometryDirty: Uint8Array;
  /** Alpha may change, including HP-only damage to translucent glass. */
  readonly opacityDirty: Uint8Array;
  /** Small artwork tiles retain separated edits inside a chunk's enclosing bounds. */
  readonly paintTileSize = 2;
  readonly paintTileCols: number;
  readonly paintTiles: Uint8Array;
  /** Inclusive local cell bounds of pending artwork edits, including neighboring relief. */
  readonly x0: Uint32Array;
  readonly y0: Uint32Array;
  readonly x1: Uint32Array;
  readonly y1: Uint32Array;
  /** Queue of dirty chunk indices (deduplicated via `dirty`). */
  private queue: number[] = [];

  constructor(world: PixelWorld, chunkSize: number) {
    this.chunkSize = chunkSize;
    this.cols = Math.ceil(world.width / chunkSize);
    this.rows = Math.ceil(world.height / chunkSize);
    this.paintTileCols = Math.ceil(chunkSize / this.paintTileSize);
    this.paintTiles = new Uint8Array(this.cols * this.rows * this.paintTileCols ** 2);
    this.dirty = new Uint8Array(this.cols * this.rows);
    this.x0 = new Uint32Array(this.dirty.length);
    this.y0 = new Uint32Array(this.dirty.length);
    this.x1 = new Uint32Array(this.dirty.length);
    this.y1 = new Uint32Array(this.dirty.length);
    this.geometryDirty = new Uint8Array(this.dirty.length);
    this.opacityDirty = new Uint8Array(this.dirty.length);
    world.addListener((cx, cy, kind, sx, sy) => {
      const geometry = kind !== "damaged";
      const opacity = geometry || world.mat[cy * world.width + cx] === MAT.glass;
      if (sx === undefined || sy === undefined) this.markCell(cx, cy, geometry, opacity);
      else {
        // Edge masks still need all eight coarse neighbors. Albedo relief only
        // reads face-sharing fine cells: the parent and at most two neighbors.
        for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 1; x <= cx + 1; x++) {
          this.markChunkAt(x, y, geometry, opacity, false);
        }
        this.markChunkAt(cx, cy, false, false);
        if (geometry) {
          this.markChunkAt(cx + (sx % 2 ? 1 : -1), cy, false, false);
          this.markChunkAt(cx, cy + (sy % 2 ? 1 : -1), false, false);
        }
      }
    });
  }

  markAll(): void {
    this.queue.length = 0;
    this.paintTiles.fill(1);
    for (let i = 0; i < this.dirty.length; i++) {
      this.dirty[i] = this.geometryDirty[i] = this.opacityDirty[i] = 1;
      this.x0[i] = this.y0[i] = 0;
      this.x1[i] = this.y1[i] = this.chunkSize - 1;
      this.queue.push(i);
    }
  }

  /** Edge masks read all eight neighbors, including across diagonal chunk boundaries. */
  markCell(cx: number, cy: number, geometry = true, opacity = geometry): void {
    for (let y = cy - 1; y <= cy + 1; y++) {
      for (let x = cx - 1; x <= cx + 1; x++) this.markChunkAt(x, y, geometry, opacity);
    }
  }

  private markChunkAt(cx: number, cy: number, geometry: boolean, opacity: boolean, paint = true): void {
    if (cx < 0 || cy < 0) return;
    const kx = Math.floor(cx / this.chunkSize);
    const ky = Math.floor(cy / this.chunkSize);
    if (kx >= this.cols || ky >= this.rows) return;
    const k = ky * this.cols + kx;
    if (geometry) this.geometryDirty[k] = 1;
    if (opacity) this.opacityDirty[k] = 1;
    const x = cx - kx * this.chunkSize, y = cy - ky * this.chunkSize;
    const tiles = this.paintTileCols;
    if (paint) this.paintTiles[k * tiles * tiles + Math.floor(y / this.paintTileSize) * tiles + Math.floor(x / this.paintTileSize)] = 1;
    if (this.dirty[k]) {
      this.x0[k] = Math.min(this.x0[k], x);
      this.y0[k] = Math.min(this.y0[k], y);
      this.x1[k] = Math.max(this.x1[k], x);
      this.y1[k] = Math.max(this.y1[k], y);
    } else {
      this.x0[k] = this.x1[k] = x;
      this.y0[k] = this.y1[k] = y;
      this.dirty[k] = 1;
      this.queue.push(k);
    }
  }

  /** Take dirty chunks in queue order, retaining work outside the requested region. */
  take(budget: number, out: number[], region?: ChunkBounds): number {
    out.length = 0;
    let keep = 0, remainingInRegion = 0;
    for (const k of this.queue) {
      const selected = !region || this.contains(region, k);
      if (out.length < budget && selected) {
        this.dirty[k] = 0;
        out.push(k);
      } else {
        this.queue[keep++] = k;
        if (selected) remainingInRegion++;
      }
    }
    this.queue.length = keep;
    return remainingInRegion;
  }

  private contains(region: ChunkBounds, k: number): boolean {
    const x = k % this.cols;
    const y = Math.floor(k / this.cols);
    return x >= region.x0 && x <= region.x1 && y >= region.y0 && y <= region.y1;
  }

  get pending(): number {
    return this.queue.length;
  }
}
