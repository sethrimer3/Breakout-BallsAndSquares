import { FACILITY } from "../config";
import type { CameraSystem } from "../systems/CameraSystem";
import { LIGHT_KIND, roomLightPosition, type PixelWorld, type RoomLight } from "../world/PixelWorld";

const SIZE = 32;

/** Static light bounds include room washes, panel recesses, and shadow halos. */
export class RoomLightIndex {
  private readonly columns: number;
  private readonly rows: number;
  private readonly buckets: number[][];
  private readonly stamps: Uint32Array;
  private stamp = 0;
  private readonly all: number[];
  private readonly found: number[] = [];
  private bounds: readonly number[] | null = null;

  constructor(lights: readonly RoomLight[], width: number, height: number, cellSize: number) {
    this.columns = Math.ceil(width / SIZE);
    this.rows = Math.ceil(height / SIZE);
    this.buckets = Array.from({ length: this.columns * this.rows }, () => []);
    this.stamps = new Uint32Array(lights.length);
    this.all = lights.map((_, i) => i);
    lights.forEach((light, i) => {
      let x0 = Math.min(light.x0, light.cx0), y0 = Math.min(light.y0, light.cy0);
      let x1 = Math.max(light.x1, light.cx1), y1 = Math.max(light.y1, light.cy1);
      if (light.kind !== LIGHT_KIND.wash && light.kind !== LIGHT_KIND.blight) {
        const source = roomLightPosition(light, cellSize);
        const x = source.x / cellSize, y = source.y / cellSize, r = FACILITY.panelRadiusCells;
        x0 = Math.min(x0, x - r); y0 = Math.min(y0, y - r);
        x1 = Math.max(x1, x + r); y1 = Math.max(y1, y + r);
      }
      for (let row = Math.max(0, Math.floor((y0 - 2) / SIZE)); row <= Math.min(this.rows - 1, Math.floor((y1 + 2) / SIZE)); row++) {
        for (let col = Math.max(0, Math.floor((x0 - 2) / SIZE)); col <= Math.min(this.columns - 1, Math.floor((x1 + 2) / SIZE)); col++) {
          this.buckets[row * this.columns + col].push(i);
        }
      }
    });
  }

  /** Ordered indices; the returned list remains valid until the next distinct query. */
  query(x0: number, y0: number, x1: number, y1: number): readonly number[] {
    const left = Math.max(0, Math.floor(x0 / SIZE)), right = Math.min(this.columns - 1, Math.floor(x1 / SIZE));
    const top = Math.max(0, Math.floor(y0 / SIZE)), bottom = Math.min(this.rows - 1, Math.floor(y1 / SIZE));
    const b = this.bounds;
    if (b && b[0] === left && b[1] === top && b[2] === right && b[3] === bottom) return this.found;
    this.bounds = [left, top, right, bottom];
    this.found.length = 0;
    // An overview can touch most buckets; scanning the original list is cheaper.
    if (Math.max(0, right - left + 1) * Math.max(0, bottom - top + 1) >= this.buckets.length / 3) {
      this.found.push(...this.all);
      return this.found;
    }
    this.stamp = (this.stamp + 1) >>> 0;
    if (!this.stamp) { this.stamps.fill(0); this.stamp = 1; }
    for (let row = top; row <= bottom; row++) for (let col = left; col <= right; col++) {
      for (const i of this.buckets[row * this.columns + col]) {
        if (this.stamps[i] === this.stamp) continue;
        this.stamps[i] = this.stamp;
        this.found.push(i);
      }
    }
    // Wall fixtures paint opaque recesses, so original painter order is required.
    this.found.sort((a, b) => a - b);
    return this.found;
  }
}

const indices = new WeakMap<PixelWorld, { source: RoomLight[]; count: number; index: RoomLightIndex }>();

/** Generation replaces roomLights; in-place appends also rebuild the shared index. */
export function visibleRoomLightIndices(world: PixelWorld, cam: CameraSystem): readonly number[] {
  let cached = indices.get(world);
  if (!cached || cached.source !== world.roomLights || cached.count !== world.roomLights.length) {
    cached = { source: world.roomLights, count: world.roomLights.length,
      index: new RoomLightIndex(world.roomLights, world.width, world.height, world.cellSize) };
    indices.set(world, cached);
  }
  return cached.index.query(cam.screenToWorldX(0) / world.cellSize - 2, cam.screenToWorldY(0) / world.cellSize - 2,
    cam.screenToWorldX(cam.viewW) / world.cellSize + 2, cam.screenToWorldY(cam.viewH) / world.cellSize + 2);
}
