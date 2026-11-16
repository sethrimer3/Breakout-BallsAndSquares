import { FACILITY } from "../config";
import { MAT, type PixelWorld } from "./PixelWorld";

export interface GlassEvents {
  /** A pane burst as part of a chain (not the pane that was shot). */
  onShatter?(cx: number, cy: number): void;
}

const DX = [1, -1, 0, 0];
const DY = [0, 0, 1, -1];

/**
 * Containment glass shatters as one: when a pane breaks, every glass block
 * orthogonally connected to it bursts in turn, one step outward every
 * `FACILITY.glassChainDelay` seconds, so the break ripples out from the hit.
 */
export class GlassSystem {
  /** Cells already claimed by a running chain, so a chain never restarts itself. */
  private claimed: Uint8Array;
  private pendingCell: number[] = [];
  private pendingAt: number[] = [];
  private time = 0;
  private panes = new Set<number>();
  private contact = new Map<number, number>();
  private queue: Int32Array;

  constructor(
    private world: PixelWorld,
    private events: GlassEvents = {},
  ) {
    const n = world.width * world.height;
    this.claimed = new Uint8Array(n);
    this.queue = new Int32Array(n);
    world.addListener((cx, cy, kind) => {
      const changed = cy * world.width + cx;
      if (world.mat[changed] === MAT.glass && world.health[changed] > 0) this.panes.add(changed);
      else { this.panes.delete(changed); this.contact.delete(changed); }
      if (kind !== "destroyed") return;
      const i = cy * world.width + cx;
      if (world.mat[i] !== MAT.glass || this.claimed[i] || world.health[i] > 0) return;
      this.startChain(i);
    });
    this.reset();
  }

  reset(): void {
    this.claimed.fill(0);
    this.pendingCell.length = 0;
    this.pendingAt.length = 0;
    this.time = 0;
    this.panes.clear();
    this.contact.clear();
    this.world.glassCracked.fill(0);
    for (let i = 0; i < this.world.health.length; i++) {
      if (this.world.mat[i] === MAT.glass && this.world.health[i] > 0) this.panes.add(i);
    }
  }

  /** Panes still waiting to burst. */
  get pending(): number {
    return this.pendingCell.length;
  }

  private startChain(origin: number): void {
    const w = this.world;
    const W = w.width;
    const queue = this.queue;
    // Distance rides along in a parallel array keyed by queue slot.
    const dist: number[] = [0];
    this.claimed[origin] = 1;
    queue[0] = origin;
    let head = 0;
    let tail = 1;
    while (head < tail) {
      const cur = queue[head];
      const d = dist[head];
      head++;
      const cx = cur % W;
      const cy = (cur - cx) / W;
      for (let k = 0; k < 4; k++) {
        const nx = cx + DX[k];
        const ny = cy + DY[k];
        if (!w.inBounds(nx, ny)) continue;
        const ni = ny * W + nx;
        if (this.claimed[ni] || w.mat[ni] !== MAT.glass || w.health[ni] === 0) continue;
        this.claimed[ni] = 1;
        queue[tail] = ni;
        dist[tail] = d + 1;
        tail++;
        this.pendingCell.push(ni);
        this.pendingAt.push(this.time + (d + 1) * FACILITY.glassChainDelay);
      }
    }
  }

  /** Only face-sharing Blight counts; rubble and diagonal contact do not. */
  private touchesBlight(cx: number, cy: number): boolean {
    const w = this.world;
    for (let k = 0; k < 4; k++) {
      const nx = cx + DX[k], ny = cy + DY[k];
      if (!w.inBounds(nx, ny)) continue;
      const i = ny * w.width + nx;
      if (w.health[i] > 0 && w.blight[i]) return true;
      // Only the two subcells on the face actually touching this pane.
      for (let side = 0; side < 2; side++) {
        const sx = DX[k] ? nx * 2 + (DX[k] < 0 ? 1 : 0) : cx * 2 + side;
        const sy = DY[k] ? ny * 2 + (DY[k] < 0 ? 1 : 0) : cy * 2 + side;
        if (w.isBlightSubAt(sx, sy)) return true;
      }
    }
    return false;
  }

  update(dt: number, overdrive = false): void {
    this.time += dt;
    // Evaluate contact before shattering anything, so newly exposed layers
    // cannot inherit elapsed time from this step.
    const shatter: number[] = [];
    if (overdrive || this.contact.size > 0) for (const i of this.panes) {
      const cx = i % this.world.width, cy = Math.floor(i / this.world.width);
      if (!overdrive || !this.touchesBlight(cx, cy)) {
        this.contact.delete(i);
        this.world.setGlassCracked(cx, cy, false);
        continue;
      }
      const elapsed = (this.contact.get(i) ?? 0) + dt;
      this.contact.set(i, elapsed);
      if (elapsed >= 1 - 1e-8) this.world.setGlassCracked(cx, cy, true);
      if (elapsed >= 2 - 1e-8) shatter.push(i);
    }
    for (const i of shatter) {
      const cx = i % this.world.width, cy = Math.floor(i / this.world.width);
      this.world.setCell(cx, cy, 0, "destroyed");
      this.events.onShatter?.(cx, cy);
    }
    if (this.pendingCell.length === 0) return;
    const w = this.world;
    let keep = 0;
    for (let k = 0; k < this.pendingCell.length; k++) {
      const i = this.pendingCell[k];
      if (this.pendingAt[k] > this.time) {
        this.pendingCell[keep] = i;
        this.pendingAt[keep] = this.pendingAt[k];
        keep++;
        continue;
      }
      if (w.health[i] > 0 && w.mat[i] === MAT.glass) {
        const cx = i % w.width;
        const cy = (i - cx) / w.width;
        w.setCell(cx, cy, 0, "destroyed");
        this.events.onShatter?.(cx, cy);
      }
    }
    this.pendingCell.length = keep;
    this.pendingAt.length = keep;
  }
}
