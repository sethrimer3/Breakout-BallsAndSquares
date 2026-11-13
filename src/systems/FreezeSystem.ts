import { FACILITY, FREEZE } from "../config";
import type { Creature } from "../entities/Creatures";
import type { Encounter } from "./LateEncounters";
import { MAT, type PixelWorld } from "../world/PixelWorld";

interface PendingShatter {
  isSub: boolean;
  x: number;
  y: number;
  damage: number;
  executeAt: number;
  waveId: number;
  triggerOwnerId: number;
  freezeOwnerId: number;
}

const DX = [1, -1, 0, 0];
const DY = [0, 0, 1, -1];

/**
 * Shared Freeze & Orthogonal Shatter system for Freeze Rockets and Cryospray.
 * - Freezing is non-destructive (0 HP damage) and refreshes duration without stacking.
 * - Frozen enemies move at 50% speed and take 2x incoming damage.
 * - Frozen Blight grows at 0.5x local rate.
 * - Destroying a frozen block deals 50% of its frozen max HP to its 4 orthogonal neighbors
 *   on the FACILITY.glassChainDelay (0.05s) cadence, propagating through frozen neighbors.
 */
export class FreezeSystem {
  readonly cellTimer: Float32Array;
  readonly cellHalfHp: Uint16Array;
  readonly cellOwner: Int32Array;
  readonly cellWave: Uint32Array;
  private activeCells: number[] = [];

  readonly subTimer: Float32Array;
  readonly subHalfHp: Uint16Array;
  readonly subOwner: Int32Array;
  readonly subWave: Uint32Array;
  private activeSubs: number[] = [];

  readonly pending: PendingShatter[] = [];
  private time = 0;
  private nextWaveId = 1;
  private activeWaveId = 0;

  onShatterHit: ((cx: number, cy: number, result: 0 | 1 | 2, isSub: boolean, sx: number, sy: number, triggerOwnerId: number, freezeOwnerId: number) => void) | null = null;

  constructor(private world: PixelWorld) {
    const n = world.width * world.height;
    this.cellTimer = new Float32Array(n);
    this.cellHalfHp = new Uint16Array(n);
    this.cellOwner = new Int32Array(n);
    this.cellWave = new Uint32Array(n);

    const sn = world.subWidth * world.subHeight;
    this.subTimer = new Float32Array(sn);
    this.subHalfHp = new Uint16Array(sn);
    this.subOwner = new Int32Array(sn);
    this.subWave = new Uint32Array(sn);
  }

  clear(): void {
    this.cellTimer.fill(0);
    this.cellHalfHp.fill(0);
    this.cellOwner.fill(0);
    this.cellWave.fill(0);
    this.activeCells.length = 0;

    this.subTimer.fill(0);
    this.subHalfHp.fill(0);
    this.subOwner.fill(0);
    this.subWave.fill(0);
    this.activeSubs.length = 0;

    this.pending.length = 0;
    this.time = 0;
    this.nextWaveId = 1;
    this.activeWaveId = 0;
  }

  isCellFrozen(cx: number, cy: number): boolean {
    if (!this.world.inBounds(cx, cy) || this.world.boundary[cy * this.world.width + cx]) return false;
    return this.cellTimer[cy * this.world.width + cx] > 0;
  }

  isSubFrozen(sx: number, sy: number): boolean {
    if (!this.world.subInBounds(sx, sy)) return false;
    const cx = sx >> 1;
    const cy = sy >> 1;
    if (this.cellTimer[cy * this.world.width + cx] > 0) return true;
    return this.subTimer[sy * this.world.subWidth + sx] > 0;
  }

  /** Freeze a normal cell without dealing damage. Refreshes duration on overlap. */
  freezeCell(cx: number, cy: number, ownerId: number, duration = FREEZE.duration): boolean {
    if (!this.world.inBounds(cx, cy) || this.world.boundary[cy * this.world.width + cx]) return false;
    const i = cy * this.world.width + cx;
    if (this.world.health[i] === 0) return false;
    if (this.cellTimer[i] <= 0) {
      // Snapshot 50% of max block HP at freeze time (rounded, min 1).
      const maxHp = Math.max(1, this.world.maxHealthAt(cx, cy));
      this.cellHalfHp[i] = Math.max(1, Math.round(maxHp * 0.5));
      this.cellOwner[i] = ownerId;
      this.activeCells.push(i);
    }
    if (duration > this.cellTimer[i]) {
      this.cellTimer[i] = duration;
    }
    return true;
  }

  /** Freeze a half-size subcell (or its parent normal cell if solid) without dealing damage. */
  freezeSubCell(sx: number, sy: number, ownerId: number, duration = FREEZE.duration): boolean {
    if (!this.world.subInBounds(sx, sy)) return false;
    const cx = sx >> 1;
    const cy = sy >> 1;
    const pi = cy * this.world.width + cx;
    if (this.world.health[pi] > 0) {
      return this.freezeCell(cx, cy, ownerId, duration);
    }
    const si = sy * this.world.subWidth + sx;
    if (this.world.subHealth[si] === 0) return false;
    if (this.subTimer[si] <= 0) {
      const subMax = Math.max(1, Math.round(this.world.maxHealthAt(cx, cy) * FACILITY.subHealthMult));
      this.subHalfHp[si] = Math.max(1, Math.round(subMax * 0.5));
      this.subOwner[si] = ownerId;
      this.activeSubs.push(si);
    }
    if (duration > this.subTimer[si]) {
      this.subTimer[si] = duration;
    }
    return true;
  }

  /** Freeze a creature or late-world enemy without dealing damage. Refreshes duration without compounding multipliers. */
  freezeCreature(c: Creature | Encounter, duration = FREEZE.duration): void {
    if (c.kind === "grove") return;
    const cur = c.freezeTimer ?? 0;
    if (duration > cur) c.freezeTimer = duration;
  }

  /** Freeze all solid cells, subcells, and enemies within `radiusWorld` of `(x, y)`. */
  freezeArea(
    x: number,
    y: number,
    radiusWorld: number,
    ownerId: number,
    creatures?: readonly (Creature | Encounter)[],
    duration = FREEZE.duration,
  ): void {
    const cs = this.world.cellSize;
    const ss = this.world.subCellSize;
    const r2 = radiusWorld * radiusWorld;

    const x0 = Math.floor((x - radiusWorld) / cs);
    const x1 = Math.floor((x + radiusWorld) / cs);
    const y0 = Math.floor((y - radiusWorld) / cs);
    const y1 = Math.floor((y + radiusWorld) / cs);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        if (!this.world.inBounds(cx, cy)) continue;
        const px = (cx + 0.5) * cs;
        const py = (cy + 0.5) * cs;
        const dx = px - x;
        const dy = py - y;
        if (dx * dx + dy * dy > r2) continue;
        const i = cy * this.world.width + cx;
        if (this.world.health[i] > 0) {
          this.freezeCell(cx, cy, ownerId, duration);
        } else if (this.world.anySolidInCell(cx, cy)) {
          for (let sy = cy * 2; sy <= cy * 2 + 1; sy++) {
            for (let sx = cx * 2; sx <= cx * 2 + 1; sx++) {
              const spx = (sx + 0.5) * ss;
              const spy = (sy + 0.5) * ss;
              if ((spx - x) ** 2 + (spy - y) ** 2 <= r2) {
                this.freezeSubCell(sx, sy, ownerId, duration);
              }
            }
          }
        }
      }
    }

    if (creatures) {
      for (const c of creatures) {
        if (c.hp <= 0) continue;
        let cx = 0;
        let cy = 0;
        if (c.kind === "flower") {
          cx = c.hx;
          cy = c.hy;
        } else if (c.kind === "worm") {
          cx = c.seg[0];
          cy = c.seg[1];
        } else if (c.kind === "specimen") {
          if (!c.free) continue;
          cx = c.x;
          cy = c.y;
        } else {
          if (!c.alive || c.kind === "grove") continue;
          cx = c.x;
          cy = c.y;
        }
        if ((cx - x) ** 2 + (cy - y) ** 2 <= (radiusWorld + 4) ** 2) {
          this.freezeCreature(c, duration);
        }
      }
    }
  }

  /** Called when a normal cell is destroyed by an external damaging weapon or shatter step. */
  onCellDestroyed(cx: number, cy: number, triggerOwnerId = 0): void {
    if (!this.world.inBounds(cx, cy)) return;
    const i = cy * this.world.width + cx;
    if (this.cellTimer[i] <= 0) return;
    const damage = this.cellHalfHp[i];
    const freezeOwnerId = this.cellOwner[i];
    this.cellTimer[i] = 0;
    this.cellHalfHp[i] = 0;
    if (damage <= 0) return;

    const waveId = this.activeWaveId || this.nextWaveId++;
    const executeAt = this.time + FACILITY.glassChainDelay;
    for (let k = 0; k < 4; k++) {
      const nx = cx + DX[k];
      const ny = cy + DY[k];
      if (!this.world.inBounds(nx, ny)) continue;
      const ni = ny * this.world.width + nx;
      if (this.cellWave[ni] === waveId) continue;
      if (this.world.health[ni] === 0 && !this.world.anySolidInCell(nx, ny)) continue;
      if (this.pending.length >= FREEZE.maxPendingShatters) break;
      this.cellWave[ni] = waveId;
      this.pending.push({
        isSub: false,
        x: nx,
        y: ny,
        damage,
        executeAt,
        waveId,
        triggerOwnerId,
        freezeOwnerId,
      });
    }
  }

  /** Called when a half-size subcell is destroyed by an external damaging weapon or shatter step. */
  onSubDestroyed(sx: number, sy: number, triggerOwnerId = 0): void {
    if (!this.world.subInBounds(sx, sy)) return;
    const si = sy * this.world.subWidth + sx;
    if (this.subTimer[si] <= 0) return;
    const damage = this.subHalfHp[si];
    const freezeOwnerId = this.subOwner[si];
    this.subTimer[si] = 0;
    this.subHalfHp[si] = 0;
    if (damage <= 0) return;

    const waveId = this.activeWaveId || this.nextWaveId++;
    const executeAt = this.time + FACILITY.glassChainDelay;
    for (let k = 0; k < 4; k++) {
      const nx = sx + DX[k];
      const ny = sy + DY[k];
      if (!this.world.subInBounds(nx, ny)) continue;
      const ni = ny * this.world.subWidth + nx;
      if (this.subWave[ni] === waveId) continue;
      if (this.world.subHealth[ni] === 0 && this.world.health[(ny >> 1) * this.world.width + (nx >> 1)] === 0) continue;
      if (this.pending.length >= FREEZE.maxPendingShatters) break;
      this.subWave[ni] = waveId;
      this.pending.push({
        isSub: true,
        x: nx,
        y: ny,
        damage,
        executeAt,
        waveId,
        triggerOwnerId,
        freezeOwnerId,
      });
    }
  }

  update(dt: number): void {
    this.time += dt;

    // Tick frozen normal cells.
    let keepC = 0;
    for (let k = 0; k < this.activeCells.length; k++) {
      const i = this.activeCells[k];
      if (this.cellTimer[i] <= 0 || this.world.health[i] === 0) {
        this.cellTimer[i] = 0;
        this.cellHalfHp[i] = 0;
        continue;
      }
      this.cellTimer[i] -= dt;
      if (this.cellTimer[i] > 0) {
        this.activeCells[keepC++] = i;
      } else {
        this.cellTimer[i] = 0;
        this.cellHalfHp[i] = 0;
      }
    }
    this.activeCells.length = keepC;

    // Tick frozen subcells.
    let keepS = 0;
    for (let k = 0; k < this.activeSubs.length; k++) {
      const si = this.activeSubs[k];
      if (this.subTimer[si] <= 0 || this.world.subHealth[si] === 0) {
        this.subTimer[si] = 0;
        this.subHalfHp[si] = 0;
        continue;
      }
      this.subTimer[si] -= dt;
      if (this.subTimer[si] > 0) {
        this.activeSubs[keepS++] = si;
      } else {
        this.subTimer[si] = 0;
        this.subHalfHp[si] = 0;
      }
    }
    this.activeSubs.length = keepS;

    // Process due orthogonal shatters up to per-step budget.
    if (this.pending.length === 0) return;
    let processed = 0;
    let keepP = 0;
    for (let k = 0; k < this.pending.length; k++) {
      const item = this.pending[k];
      if (item.executeAt > this.time || processed >= FREEZE.maxShattersPerStep) {
        this.pending[keepP++] = item;
        continue;
      }
      processed++;
      this.executeShatter(item);
    }
    this.pending.length = keepP;
  }

  private executeShatter(item: PendingShatter): void {
    const w = this.world;
    const prevWave = this.activeWaveId;
    this.activeWaveId = item.waveId;
    try {
      if (!item.isSub) {
        const cx = item.x;
        const cy = item.y;
        if (!w.inBounds(cx, cy)) return;
        const i = cy * w.width + cx;
        if (w.mat[i] === MAT.door) {
          const door = w.doors[w.doorId[i] - 1];
          if (door && !door.open && door.gate) return;
        }
        const res = w.damage(cx, cy, item.damage, true);
        if (res === 2) {
          this.onCellDestroyed(cx, cy, item.triggerOwnerId);
        }
        if (res > 0) {
          this.onShatterHit?.(cx, cy, res, false, cx * 2, cy * 2, item.triggerOwnerId, item.freezeOwnerId);
        }
      } else {
        const sx = item.x;
        const sy = item.y;
        if (!w.subInBounds(sx, sy)) return;
        const res = w.damageSub(sx, sy, item.damage, true);
        const cx = sx >> 1;
        const cy = sy >> 1;
        if (res === 2) {
          this.onSubDestroyed(sx, sy, item.triggerOwnerId);
        }
        if (res > 0) {
          this.onShatterHit?.(cx, cy, res, true, sx, sy, item.triggerOwnerId, item.freezeOwnerId);
        }
      }
    } finally {
      this.activeWaveId = prevWave;
    }
  }

  get activeFrozenCells(): number {
    return this.activeCells.length;
  }

  get activeFrozenSubs(): number {
    return this.activeSubs.length;
  }
}
