import type { PixelWorld } from "./PixelWorld";

/**
 * O(1) indexed set of frontier cells: solid cells that have at least one empty
 * cardinal neighbor. Supports O(1) add, swap-remove, membership and random pick.
 */
export class Frontier {
  readonly list: Int32Array;
  /** Position in `list`, or -1 if not present. */
  readonly pos: Int32Array;
  size = 0;

  constructor(private world: PixelWorld) {
    const n = world.width * world.height;
    this.list = new Int32Array(n);
    this.pos = new Int32Array(n).fill(-1);
    world.addListener((cx, cy) => this.onCellChanged(cx, cy));
  }

  clear(): void {
    for (let k = 0; k < this.size; k++) this.pos[this.list[k]] = -1;
    this.size = 0;
  }

  /** Seed the frontier from the perimeter of the starting room (no full-world scan). */
  seedFromRoom(): void {
    this.clear();
    const w = this.world;
    for (let cy = w.roomY0 - 1; cy <= w.roomY1 + 1; cy++) {
      for (let cx = w.roomX0 - 1; cx <= w.roomX1 + 1; cx++) {
        this.refresh(cx, cy);
      }
    }
  }

  /** Full-world rebuild (used by tests to verify incremental maintenance). */
  rebuildFull(): void {
    this.clear();
    const w = this.world;
    for (let cy = 0; cy < w.height; cy++) {
      for (let cx = 0; cx < w.width; cx++) {
        this.refresh(cx, cy);
      }
    }
  }

  has(cx: number, cy: number): boolean {
    if (!this.world.inBounds(cx, cy)) return false;
    return this.pos[cy * this.world.width + cx] >= 0;
  }

  private onCellChanged(cx: number, cy: number): void {
    this.refresh(cx, cy);
    this.refresh(cx - 1, cy);
    this.refresh(cx + 1, cy);
    this.refresh(cx, cy - 1);
    this.refresh(cx, cy + 1);
  }

  refresh(cx: number, cy: number): void {
    const w = this.world;
    if (!w.inBounds(cx, cy)) return;
    const i = cy * w.width + cx;
    // Blight Cores generate pink sub-pixel blight instead of normal blight, and a
    // cell holding pink sub-pixels is not open space for normal blight.
    const isFront =
      w.health[i] > 0 &&
      w.coreId[i] === 0 &&
      ((cx > 0 && !w.anySolidInCell(cx - 1, cy)) ||
        (cx < w.width - 1 && !w.anySolidInCell(cx + 1, cy)) ||
        (cy > 0 && !w.anySolidInCell(cx, cy - 1)) ||
        (cy < w.height - 1 && !w.anySolidInCell(cx, cy + 1)));
    if (isFront) this.add(i);
    else this.remove(i);
  }

  private add(i: number): void {
    if (this.pos[i] >= 0) return;
    const k = this.size++;
    this.list[k] = i;
    this.pos[i] = k;
  }

  remove(i: number): void {
    const k = this.pos[i];
    if (k < 0) return;
    const last = this.list[--this.size];
    this.list[k] = last;
    this.pos[last] = k;
    this.pos[i] = -1;
  }
}
