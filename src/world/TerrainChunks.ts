import type { PixelWorld } from "./PixelWorld";

/**
 * Tracks which terrain chunks need re-rendering. Pure bookkeeping (no DOM),
 * so it can be shared by the renderer and unit-tested.
 */
export class TerrainChunks {
  readonly chunkSize: number;
  readonly cols: number;
  readonly rows: number;
  readonly dirty: Uint8Array;
  /** Queue of dirty chunk indices (deduplicated via `dirty`). */
  private queue: number[] = [];

  constructor(world: PixelWorld, chunkSize: number) {
    this.chunkSize = chunkSize;
    this.cols = Math.ceil(world.width / chunkSize);
    this.rows = Math.ceil(world.height / chunkSize);
    this.dirty = new Uint8Array(this.cols * this.rows);
    world.addListener((cx, cy) => this.markCell(cx, cy));
  }

  markAll(): void {
    this.queue.length = 0;
    for (let i = 0; i < this.dirty.length; i++) {
      this.dirty[i] = 1;
      this.queue.push(i);
    }
  }

  /** Edge masks read all eight neighbors, including across diagonal chunk boundaries. */
  markCell(cx: number, cy: number): void {
    for (let y = cy - 1; y <= cy + 1; y++) {
      for (let x = cx - 1; x <= cx + 1; x++) this.markChunkAt(x, y);
    }
  }

  private markChunkAt(cx: number, cy: number): void {
    if (cx < 0 || cy < 0) return;
    const kx = Math.floor(cx / this.chunkSize);
    const ky = Math.floor(cy / this.chunkSize);
    if (kx >= this.cols || ky >= this.rows) return;
    const k = ky * this.cols + kx;
    if (!this.dirty[k]) {
      this.dirty[k] = 1;
      this.queue.push(k);
    }
  }

  /** Pop up to `budget` dirty chunk indices. */
  take(budget: number, out: number[]): void {
    out.length = 0;
    while (out.length < budget && this.queue.length > 0) {
      const k = this.queue.shift()!;
      this.dirty[k] = 0;
      out.push(k);
    }
  }

  get pending(): number {
    return this.queue.length;
  }
}
