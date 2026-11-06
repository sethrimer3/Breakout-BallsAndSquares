import { GROWTH, growthRateAt } from "../config";
import type { Rng } from "../core/Rng";
import type { Soldier } from "../entities/Soldier";
import { cellOverlapsCircle } from "../systems/PhysicsSystem";
import { Frontier } from "./Frontier";
import type { PixelWorld } from "./PixelWorld";

export interface GrowthEvents {
  onGrow?(cx: number, cy: number): void;
  onSoldierKilled?(soldier: Soldier, cx: number, cy: number): void;
}

const DX = [1, -1, 0, 0];
const DY = [0, 0, 1, -1];

/**
 * Hostile terrain replication. Solid frontier cells copy into empty cardinal
 * neighbors at an escalating rate; overlapping soldiers die immediately.
 */
export class GrowthSystem {
  readonly frontier: Frontier;
  /** Ring buffer of recently grown cells (for crimson pulse rendering). */
  readonly glowIndex = new Int32Array(GROWTH.glowCap);
  readonly glowTime = new Float32Array(GROWTH.glowCap);
  glowHead = 0;
  glowCount = 0;

  rate = 0;
  graceSeconds = GROWTH.graceSeconds;
  rateMultiplier = 1;
  weakenChance = 0;
  /** Cumulative seconds subtracted from the blight timer by destroying Blight Cores. */
  timeOffset = 0;
  coresDestroyed = 0;
  totalEvents = 0;
  nearEventsTotal = 0;
  private acc = 0;
  /** Rolling telemetry ring (time, 1 if near soldier else 0). */
  private telTime: number[] = [];
  private telNear: number[] = [];

  constructor(
    private world: PixelWorld,
    private rng: Rng,
    private events: GrowthEvents = {},
  ) {
    this.frontier = new Frontier(world);
  }

  reset(): void {
    this.frontier.seedFromRoom();
    this.rate = 0;
    this.acc = 0;
    this.timeOffset = 0;
    this.coresDestroyed = 0;
    this.totalEvents = 0;
    this.nearEventsTotal = 0;
    this.glowHead = 0;
    this.glowCount = 0;
    this.telTime.length = 0;
    this.telNear.length = 0;
  }

  /** Effective blight timer (seconds) after accounting for upgrade grace and destroyed Blight Cores. */
  effectiveBlightTime(runTime: number): number {
    return Math.max(0, runTime - (this.graceSeconds - GROWTH.graceSeconds) - this.timeOffset);
  }

  /**Remaining seconds before blight starts/resumes replicating (0 if already active). */
  graceRemaining(runTime: number): number {
    const shifted = runTime - (this.graceSeconds - GROWTH.graceSeconds) - this.timeOffset;
    return Math.max(0, GROWTH.graceSeconds - shifted);
  }

  /**
   * Called when the player destroys a Blight Core: reduces the blight timer
   * by `seconds` (default `GROWTH.coreKillTimeReduction`) and immediately
   * recalculates the blight replication rate.
   */
  reduceBlightTimer(runTime: number, seconds = GROWTH.coreKillTimeReduction): void {
    this.timeOffset += seconds;
    this.coresDestroyed++;
    this.acc = 0;
    const shiftedTime = runTime - (this.graceSeconds - GROWTH.graceSeconds) - this.timeOffset;
    this.rate = growthRateAt(shiftedTime) * this.rateMultiplier;
  }

  /** Rolling percentage (0..100) of growth events within `nearRadiusCells` of a living soldier. */
  nearSoldierPercent(now: number): number {
    this.pruneTelemetry(now);
    if (this.telNear.length === 0) return 0;
    let s = 0;
    for (let i = 0; i < this.telNear.length; i++) s += this.telNear[i];
    return (s / this.telNear.length) * 100;
  }

  private pruneTelemetry(now: number): void {
    const cutoff = now - GROWTH.telemetryWindow;
    while (this.telTime.length > 0 && this.telTime[0] < cutoff) {
      this.telTime.shift();
      this.telNear.shift();
    }
  }

  update(dt: number, runTime: number, soldiers: readonly Soldier[]): void {
    const shiftedTime = runTime - (this.graceSeconds - GROWTH.graceSeconds) - this.timeOffset;
    this.rate = growthRateAt(shiftedTime) * this.rateMultiplier;
    if (this.rate <= 0 || this.frontier.size === 0) return;
    this.acc += this.rate * dt;
    let steps = 0;
    while (this.acc >= 1 && steps < GROWTH.maxEventsPerStep && this.frontier.size > 0) {
      if (this.replicateOne(runTime, soldiers)) {
        this.acc -= 1;
      } else {
        // Could not find a valid source after retries; drop fractional pressure.
        this.acc = 0;
        break;
      }
      steps++;
    }
    if (this.acc > GROWTH.maxEventsPerStep) this.acc = GROWTH.maxEventsPerStep;
  }

  /** Execute one copy event. Returns true on success. */
  replicateOne(runTime: number, soldiers: readonly Soldier[]): boolean {
    const w = this.world;
    const f = this.frontier;
    const neighbors: number[] = [];
    for (let attempt = 0; attempt < 8 && f.size > 0; attempt++) {
      const src = this.pickSource(soldiers);
      const sx = src % w.width;
      const sy = Math.floor(src / w.width);
      neighbors.length = 0;
      for (let d = 0; d < 4; d++) {
        const nx = sx + DX[d];
        const ny = sy + DY[d];
        if (w.inBounds(nx, ny) && !w.solidAt(nx, ny)) {
          neighbors.push(ny * w.width + nx);
        }
      }
      if (neighbors.length === 0) {
        f.remove(src);
        continue;
      }
      const dest = neighbors[this.rng.int(neighbors.length)];
      const dx = dest % w.width;
      const dy = Math.floor(dest / w.width);
      const hp =
        this.weakenChance > 0 && this.rng.next() < this.weakenChance
          ? 1
          : w.maxHealthAt(dx, dy);
      w.setCell(dx, dy, hp, "grown");
      // Copy tint with a slight variation from parent.
      w.tint[dest] = (w.tint[src] + this.rng.int(17) - 8) & 255;
      // Blight overwrites whatever the facility had here.
      w.decor[dest] = 0;
      this.recordGlow(dest, runTime);
      this.recordTelemetry(dx, dy, runTime, soldiers);
      this.totalEvents++;
      this.events.onGrow?.(dx, dy);

      // Kill any soldier whose collision circle overlaps the new cell.
      const cs = w.cellSize;
      for (let i = 0; i < soldiers.length; i++) {
        const s = soldiers[i];
        if (s.alive && cellOverlapsCircle(cs, dx, dy, s.x, s.y, s.radius)) {
          s.alive = false;
          this.events.onSoldierKilled?.(s, dx, dy);
        }
      }
      return true;
    }
    return false;
  }

  private pickSource(soldiers: readonly Soldier[]): number {
    const f = this.frontier;
    if (GROWTH.localBias > 0 && this.rng.next() < GROWTH.localBias) {
      const alive = soldiers.filter((s) => s.alive);
      if (alive.length > 0) {
        const s = alive[this.rng.int(alive.length)];
        const scx = Math.floor(s.x / this.world.cellSize);
        const scy = Math.floor(s.y / this.world.cellSize);
        const R = GROWTH.localRadiusCells;
        for (let k = 0; k < GROWTH.localSamples; k++) {
          const cx = scx + this.rng.int(R * 2 + 1) - R;
          const cy = scy + this.rng.int(R * 2 + 1) - R;
          if (f.has(cx, cy)) return cy * this.world.width + cx;
        }
      }
    }
    return f.list[this.rng.int(f.size)];
  }

  private recordGlow(cellIndex: number, runTime: number): void {
    this.glowIndex[this.glowHead] = cellIndex;
    this.glowTime[this.glowHead] = runTime;
    this.glowHead = (this.glowHead + 1) % GROWTH.glowCap;
    if (this.glowCount < GROWTH.glowCap) this.glowCount++;
  }

  private recordTelemetry(cx: number, cy: number, runTime: number, soldiers: readonly Soldier[]): void {
    const cs = this.world.cellSize;
    const r = GROWTH.nearRadiusCells;
    let near = 0;
    for (let i = 0; i < soldiers.length; i++) {
      const s = soldiers[i];
      if (!s.alive) continue;
      const sx = Math.floor(s.x / cs);
      const sy = Math.floor(s.y / cs);
      if (Math.max(Math.abs(cx - sx), Math.abs(cy - sy)) <= r) {
        near = 1;
        break;
      }
    }
    if (near) this.nearEventsTotal++;
    this.telTime.push(runTime);
    this.telNear.push(near);
    this.pruneTelemetry(runTime);
  }
}
