/** Coalesces local floor-shadow edits without turning sparse hits into a
 * world-sized bounding rectangle. Pending work is flushed in the area a draw will sample. */
export class FloorRegions {
  private readonly columns: number;
  private readonly dirty: Uint8Array;
  private readonly rects: Int32Array;
  private readonly queue: number[] = [];

  constructor(private width: number, private height: number, private size = 8) {
    this.columns = Math.ceil(width / size);
    this.dirty = new Uint8Array(this.columns * Math.ceil(height / size));
    this.rects = new Int32Array(this.dirty.length * 4);
  }

  mark(x0: number, y0: number, x1: number, y1: number): void {
    x0 = Math.max(0, x0); y0 = Math.max(0, y0);
    x1 = Math.min(this.width - 1, x1); y1 = Math.min(this.height - 1, y1);
    if (x0 > x1 || y0 > y1) return;
    for (let row = Math.floor(y0 / this.size); row <= Math.floor(y1 / this.size); row++) {
      for (let col = Math.floor(x0 / this.size); col <= Math.floor(x1 / this.size); col++) {
        const k = row * this.columns + col, p = k * 4;
        const left = Math.max(x0, col * this.size), top = Math.max(y0, row * this.size);
        const right = Math.min(x1, (col + 1) * this.size - 1), bottom = Math.min(y1, (row + 1) * this.size - 1);
        if (!this.dirty[k]) {
          this.dirty[k] = 1; this.queue.push(k);
          this.rects[p] = left; this.rects[p + 1] = top; this.rects[p + 2] = right; this.rects[p + 3] = bottom;
        } else {
          this.rects[p] = Math.min(this.rects[p], left); this.rects[p + 1] = Math.min(this.rects[p + 1], top);
          this.rects[p + 2] = Math.max(this.rects[p + 2], right); this.rects[p + 3] = Math.max(this.rects[p + 3], bottom);
        }
      }
    }
  }

  flush(
    paint: (x0: number, y0: number, x1: number, y1: number) => void,
    region?: { x0: number; y0: number; x1: number; y1: number },
  ): void {
    let keep = 0;
    for (const k of this.queue) {
      const p = k * 4;
      const x0 = this.rects[p], y0 = this.rects[p + 1];
      const x1 = this.rects[p + 2], y1 = this.rects[p + 3];
      if (region && (x1 < region.x0 || x0 > region.x1 || y1 < region.y0 || y0 > region.y1)) {
        this.queue[keep++] = k;
        continue;
      }
      paint(x0, y0, x1, y1);
      this.dirty[k] = 0;
    }
    this.queue.length = keep;
  }

  clear(): void { for (const k of this.queue) this.dirty[k] = 0; this.queue.length = 0; }
}
