import type { SightQuery, SightSource } from "./FogOfWar";

/** Cached four-connected air on the fine collision grid, never a diagonal shortcut. */
export class ConnectedAir {
  readonly tiles: number[] = [];
  private readonly visited: Uint32Array;
  private readonly queue: Int32Array;
  private readonly marked: Uint8Array;
  private readonly scale: number;
  private readonly width: number;
  private readonly height: number;
  private stamp = 0;
  private elapsed = 1;

  constructor(private world: SightQuery, private tileCells: number) {
    this.scale = world.subSolidAt ? 2 : 1;
    this.width = world.width * this.scale;
    this.height = world.height * this.scale;
    this.visited = new Uint32Array(this.width * this.height);
    this.queue = new Int32Array(this.visited.length);
    this.marked = new Uint8Array(Math.ceil(world.width / tileCells) * Math.ceil(world.height / tileCells));
  }

  reset(): void { this.tiles.length = 0; this.elapsed = 1; }

  update(dt: number, sources: readonly SightSource[]): readonly number[] {
    this.elapsed += dt;
    if (!sources.some((s) => s.airSeed)) { this.reset(); return this.tiles; }
    // Refresh frequently enough for opening doors, breaking rubble and regrowth,
    // without flooding a potentially huge component once per soldier per frame.
    if (this.elapsed < 0.2) return this.tiles;
    this.elapsed = 0;
    this.tiles.length = 0;
    this.marked.fill(0);
    if (++this.stamp === 0xffffffff) { this.visited.fill(0); this.stamp = 1; }
    const { width, height, visited, queue, stamp, scale, world } = this;
    const tw = Math.ceil(world.width / this.tileCells);
    const fineTile = this.tileCells * scale;
    let head = 0, tail = 0;
    const enter = (x: number, y: number): void => {
      if (x < 0 || y < 0 || x >= width || y >= height) return;
      const i = y * width + x;
      if (visited[i] === stamp) return;
      visited[i] = stamp;
      if (world.subSolidAt ? world.subSolidAt(x, y) : world.solidAt(x, y)) return;
      queue[tail++] = i;
    };
    for (const s of sources) if (s.airSeed) enter(Math.floor(s.x / world.cellSize * scale), Math.floor(s.y / world.cellSize * scale));
    while (head < tail) {
      const i = queue[head++];
      const x = i % width, y = (i - x) / width;
      const tile = Math.floor(y / fineTile) * tw + Math.floor(x / fineTile);
      if (!this.marked[tile]) { this.marked[tile] = 1; this.tiles.push(tile); }
      enter(x - 1, y); enter(x + 1, y); enter(x, y - 1); enter(x, y + 1);
    }
    return this.tiles;
  }
}
