import { FOG } from "../config";
import { ConnectedAir } from "./ConnectedAir";

/** What `FogOfWar` needs from the terrain: is a cell opaque to sight? */
export interface SightQuery {
  readonly width: number;
  readonly height: number;
  readonly cellSize: number;
  solidAt(cx: number, cy: number): boolean;
  /** Half-size grid opacity (half-size blocks block sight too), when the terrain has one. */
  subSolidAt?(sx: number, sy: number): boolean;
  /** Optional terrain change listener so ConnectedAir only re-floods on geometry changes. */
  addListener?(fn: (cx: number, cy: number, kind: string) => void): void;
}

/** Something that sees: a soldier, a turret, or the spawn room. */
export interface SightSource {
  x: number;
  y: number;
  /** Sight radius in cells. */
  radiusCells: number;
  /** Soldiers look forward; room lights and turrets keep circular sight. */
  facingAngle?: number;
  /** Only living soldiers seed connected-air mapping. */
  airSeed?: boolean;
}

/**
 * Creeping fog of war on a coarse tile grid (`FOG.tileCells` cells per tile).
 *
 * `light[i]` (0 = black, 1 = fully seen) is what gets drawn. It never snaps:
 * - Seen tiles fill in from their brightest neighbor, so light flows outward
 *   from each soldier at a few tiles per second and lags behind fast movers.
 * - Unseen tiles stay fresh for `FOG.staleDelay` seconds, then darkness seeps
 *   back in, fastest where neighbors are already dark, so it closes in from
 *   the edges like ooze.
 * - With permanent mapping, explored tiles settle at `FOG.mappedLevel`
 *   instead of going black.
 *
 * Per-tile rate noise keeps both fronts ragged rather than perfectly round.
 * Only the bounding box of ever-touched tiles is updated each frame.
 */
export class FogOfWar {
  readonly tileCells: number;
  readonly tileSize: number;
  readonly tw: number;
  readonly th: number;
  /** Displayed brightness per tile (0..1). */
  light: Float32Array;
  private next: Float32Array;
  readonly explored: Uint8Array;
  private readonly lastSeen: Float32Array;
  private readonly seenStamp: Uint32Array;
  private readonly srcStamp: Uint32Array;
  private readonly revealBoost: Float32Array;
  private readonly noise: Float32Array;
  private stamp = 0;
  private time = 0;
  /** Inclusive bounds of tiles that may be non-zero. Empty when x0 > x1. */
  bx0 = 1;
  by0 = 1;
  bx1 = 0;
  by1 = 0;
  /** Explored areas keep a dim memory instead of going black. */
  permanent = false;
  connectedAir = false;
  readonly airMetrics = { updateMs: 0, floods: 0, visitedCells: 0, mappedTiles: 0 };
  /** How many solid terrain cells sight rays penetrate into walls (Better Flashlight). */
  wallPenetrationCells = 0;
  private air: ConnectedAir | null = null;
  /** Active 8×8 fog-tile blocks so settled dark/mapped regions cost zero per-step work. */
  private readonly blockCols: number;
  private readonly blockRows: number;
  private readonly blockActive: Uint8Array;
  private readonly activeBlocks: Int32Array;
  private activeBlockCount = 0;
  private lastPermanent = false;

  constructor(
    private readonly world: SightQuery,
    tileCells: number = FOG.tileCells,
  ) {
    this.tileCells = tileCells;
    this.tileSize = tileCells * world.cellSize;
    this.tw = Math.ceil(world.width / tileCells);
    this.th = Math.ceil(world.height / tileCells);
    const n = this.tw * this.th;
    this.light = new Float32Array(n);
    this.next = new Float32Array(n);
    this.explored = new Uint8Array(n);
    this.lastSeen = new Float32Array(n);
    this.seenStamp = new Uint32Array(n);
    this.srcStamp = new Uint32Array(n);
    this.revealBoost = new Float32Array(n);
    this.noise = new Float32Array(n);
    this.blockCols = (this.tw + 7) >> 3;
    this.blockRows = (this.th + 7) >> 3;
    const bn = this.blockCols * this.blockRows;
    this.blockActive = new Uint8Array(bn);
    this.activeBlocks = new Int32Array(bn);
    this.reseed(1);
  }

  /** Back to total darkness (new run / new map). */
  reset(seed = 1): void {
    this.air?.reset();
    this.light.fill(0);
    this.next.fill(0);
    this.explored.fill(0);
    this.lastSeen.fill(0);
    this.seenStamp.fill(0);
    this.srcStamp.fill(0);
    this.revealBoost.fill(0);
    this.blockActive.fill(0);
    this.activeBlockCount = 0;
    this.lastPermanent = this.permanent;
    this.stamp = 0;
    this.time = 0;
    this.bx0 = 1;
    this.by0 = 1;
    this.bx1 = 0;
    this.by1 = 0;
    this.reseed(seed);
  }

  private wakeBlock(tx: number, ty: number): void {
    const b = (ty >> 3) * this.blockCols + (tx >> 3);
    if (!this.blockActive[b]) {
      this.blockActive[b] = 1;
      this.activeBlocks[this.activeBlockCount++] = b;
    }
  }

  private reseed(seed: number): void {
    // Cheap hash noise in 0.35..1.65, smoothed once so the front has lumps, not salt.
    const { tw, th, noise } = this;
    let h = (seed | 0) ^ 0x9e3779b9;
    const raw = new Float32Array(tw * th);
    for (let i = 0; i < raw.length; i++) {
      h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
      h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
      h ^= h >>> 15;
      raw[i] = (h >>> 0) / 4294967296;
    }
    for (let y = 0; y < th; y++) {
      for (let x = 0; x < tw; x++) {
        let s = 0;
        let c = 0;
        for (let oy = -1; oy <= 1; oy++) {
          const yy = y + oy;
          if (yy < 0 || yy >= th) continue;
          for (let ox = -1; ox <= 1; ox++) {
            const xx = x + ox;
            if (xx < 0 || xx >= tw) continue;
            s += raw[yy * tw + xx];
            c++;
          }
        }
        noise[y * tw + x] = Math.min(1.65, Math.max(0.35, 1 + 2.2 * (s / c - 0.5)));
      }
    }
  }

  /** Brightness at a world position (0..1). */
  lightAt(wx: number, wy: number): number {
    const tx = Math.floor(wx / this.tileSize);
    const ty = Math.floor(wy / this.tileSize);
    if (tx < 0 || ty < 0 || tx >= this.tw || ty >= this.th) return 0;
    return this.light[ty * this.tw + tx];
  }

  isExplored(wx: number, wy: number): boolean {
    const tx = Math.floor(wx / this.tileSize);
    const ty = Math.floor(wy / this.tileSize);
    if (tx < 0 || ty < 0 || tx >= this.tw || ty >= this.th) return false;
    return this.explored[ty * this.tw + tx] === 1;
  }

  private grow(tx0: number, ty0: number, tx1: number, ty1: number): void {
    if (tx0 < 0) tx0 = 0;
    if (ty0 < 0) ty0 = 0;
    if (tx1 > this.tw - 1) tx1 = this.tw - 1;
    if (ty1 > this.th - 1) ty1 = this.th - 1;
    if (this.bx0 > this.bx1) {
      this.bx0 = tx0;
      this.by0 = ty0;
      this.bx1 = tx1;
      this.by1 = ty1;
      return;
    }
    if (tx0 < this.bx0) this.bx0 = tx0;
    if (ty0 < this.by0) this.by0 = ty0;
    if (tx1 > this.bx1) this.bx1 = tx1;
    if (ty1 > this.by1) this.by1 = ty1;
  }

  /** Trace sight rays from `src`, stamping every tile they cross (walls included). */
  private trace(src: SightSource, rays: number): void {
    const { world, tw, tileCells, seenStamp, srcStamp, stamp } = this;
    const cs = world.cellSize;
    const cx0 = src.x / cs;
    const cy0 = src.y / cs;
    const r = src.radiusCells;
    const directional = src.facingAngle !== undefined;
    const forwardX = directional ? Math.cos(src.facingAngle!) : 0;
    const forwardY = directional ? Math.sin(src.facingAngle!) : 0;
    const maxRadius = r * (directional ? FOG.forwardSightMult : 1);
    const ts = this.tileSize;
    const stx = Math.floor(src.x / ts);
    const sty = Math.floor(src.y / ts);
    if (stx >= 0 && sty >= 0 && stx < tw && sty < this.th) {
      seenStamp[sty * tw + stx] = stamp;
      srcStamp[sty * tw + stx] = stamp;
      this.revealBoost[sty * tw + stx] = 1;
      this.wakeBlock(stx, sty);
    }
    const pad = Math.ceil(maxRadius / tileCells) + 2;
    this.grow(stx - pad, sty - pad, stx + pad, sty + pad);
    const step = 0.5;
    const sub = world.subSolidAt;
    const wallDepth = src.airSeed !== false ? this.wallPenetrationCells : 0;
    for (let k = 0; k < rays; k++) {
      const a = (k / rays) * Math.PI * 2;
      const dx = Math.cos(a) * step;
      const dy = Math.sin(a) * step;
      // A broad, smoothly tapered lobe rather than a hard flashlight cone.
      const alignment = Math.max(0, (dx * forwardX + dy * forwardY) / step);
      const forward = alignment * alignment;
      const steps = Math.ceil(r * (1 + (FOG.forwardSightMult - 1) * forward) / step);
      const boost = 1 + (FOG.forwardRevealMult - 1) * forward;
      let px = cx0;
      let py = cy0;
      let lastTile = -1;
      let inWall = false;
      let wallDist = 0;
      for (let s = 0; s < steps; s++) {
        px += dx;
        py += dy;
        const cx = Math.floor(px);
        const cy = Math.floor(py);
        if (cx < 0 || cy < 0 || cx >= world.width || cy >= world.height) break;
        const solid = sub ? sub.call(world, Math.floor(px * 2), Math.floor(py * 2)) : world.solidAt(cx, cy);
        if (!solid && inWall) break;
        const tx = Math.floor(cx / tileCells);
        const ty = Math.floor(cy / tileCells);
        const ti = ty * tw + tx;
        if (ti !== lastTile) {
          this.revealBoost[ti] = seenStamp[ti] === stamp ? Math.max(this.revealBoost[ti], boost) : boost;
          seenStamp[ti] = stamp;
          this.wakeBlock(tx, ty);
          lastTile = ti;
        }
        if (solid) {
          if (wallDepth <= 0) break;
          inWall = true;
          wallDist += step;
          if (wallDist >= wallDepth) break;
        }
      }
    }
  }

  /** Advance the fog by `dt` seconds with this frame's sight sources. */
  update(dt: number, sources: readonly SightSource[]): void {
    this.time += dt;
    this.stamp++;
    const rays = FOG.sightRays;
    for (const s of sources) {
      const reach = s.facingAngle === undefined ? 1 : FOG.forwardSightMult;
      this.trace(s, Math.max(16, Math.round((rays * s.radiusCells * reach) / FOG.soldierSightCells)));
    }
    this.airMetrics.updateMs = this.airMetrics.floods = this.airMetrics.visitedCells = this.airMetrics.mappedTiles = 0;
    if (this.connectedAir) {
      const airStart = performance.now();
      this.air ??= new ConnectedAir(this.world, this.tileCells);
      for (const tile of this.air.update(dt, sources)) {
        this.revealBoost[tile] = this.seenStamp[tile] === this.stamp ? Math.max(1.5, this.revealBoost[tile]) : 1.5;
        this.seenStamp[tile] = this.stamp;
        const x = tile % this.tw, y = (tile - x) / this.tw;
        this.grow(x, y, x, y);
        this.wakeBlock(x, y);
      }
      this.airMetrics.updateMs = performance.now() - airStart;
      this.airMetrics.floods = this.air.rebuiltLastUpdate ? 1 : 0;
      this.airMetrics.visitedCells = this.air.visitedLastUpdate;
      this.airMetrics.mappedTiles = this.air.tiles.length;
    }
    if (this.bx0 > this.bx1) return;
    if (this.permanent !== this.lastPermanent) {
      this.lastPermanent = this.permanent;
      const b0x = this.bx0 >> 3, b1x = this.bx1 >> 3;
      const b0y = this.by0 >> 3, b1y = this.by1 >> 3;
      for (let by = b0y; by <= b1y; by++) {
        for (let bx = b0x; bx <= b1x; bx++) {
          const b = by * this.blockCols + bx;
          if (!this.blockActive[b]) {
            this.blockActive[b] = 1;
            this.activeBlocks[this.activeBlockCount++] = b;
          }
        }
      }
    }
    if (this.activeBlockCount === 0) return;

    const { tw, th, light, next, explored, lastSeen, seenStamp, srcStamp, noise, stamp, time } = this;
    const reveal = FOG.revealRate * dt;
    const stale = FOG.staleRate * dt;
    const delay = FOG.staleDelay;
    const floorMapped = this.permanent ? FOG.mappedLevel : 0;
    const thr = FOG.exploredThreshold;
    const blockCols = this.blockCols;
    const activeBlocks = this.activeBlocks;
    const blockActive = this.blockActive;
    let keepCount = 0;
    for (let bi = 0; bi < this.activeBlockCount; bi++) {
      const b = activeBlocks[bi];
      const bx = b % blockCols;
      const by = (b - bx) / blockCols;
      const x0 = bx << 3;
      const y0 = by << 3;
      const x1 = x0 + 7 < tw ? x0 + 7 : tw - 1;
      const y1 = y0 + 7 < th ? y0 + 7 : th - 1;
      let keep = false;
      for (let y = y0; y <= y1; y++) {
        const row = y * tw;
        for (let x = x0; x <= x1; x++) {
          const i = row + x;
          const v = light[i];
          const l = x > 0 ? light[i - 1] : 0;
          const r = x < tw - 1 ? light[i + 1] : 0;
          const u = y > 0 ? light[i - tw] : 0;
          const d = y < th - 1 ? light[i + tw] : 0;
          let nv = v;
          const seen = seenStamp[i] === stamp;
          if (seen) {
            lastSeen[i] = time;
            if (v < 1) {
              if (srcStamp[i] === stamp) {
                nv = v + reveal * 3;
              } else {
                let maxN = l > r ? l : r;
                if (u > maxN) maxN = u;
                if (d > maxN) maxN = d;
                // Light only seeps in from a lit neighbor, so it flows out from the soldier.
                nv = v + reveal * this.revealBoost[i] * noise[i] * maxN;
              }
              if (nv > 1) nv = 1;
            }
          } else if (time - lastSeen[i] > delay || lastSeen[i] === 0) {
            const floor = explored[i] ? floorMapped : 0;
            if (v > floor) {
              let minN = l < r ? l : r;
              if (u < minN) minN = u;
              if (d < minN) minN = d;
              // Darkness seeps in from darker neighbors first.
              nv = v - stale * noise[i] * (0.25 + 2.5 * (1 - minN));
              if (nv < floor) nv = floor;
            }
          }
          if (nv > thr) explored[i] = 1;
          next[i] = nv;
          if (seen || nv !== v || nv > (explored[i] ? floorMapped : 0)) keep = true;
        }
      }
      if (keep) activeBlocks[keepCount++] = b;
      else blockActive[b] = 0;
    }
    this.activeBlockCount = keepCount;
    this.next = light;
    this.light = next;
  }
}
