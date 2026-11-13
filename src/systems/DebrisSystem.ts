import { VACUUM } from "../config";
import type { Soldier } from "../entities/Soldier";
import type { PixelWorld } from "../world/PixelWorld";

export interface DebrisRecord {
  active: boolean;
  id: number;
  worldGen: number;
  x: number;
  y: number;
  mass: number;
  life: number;
  reservedBy: number;
  pullStartX: number;
  pullStartY: number;
  pullT: number;
}

/**
 * Authoritative gameplay debris ledger for Vacuum Pulse.
 * Records destroyed normal cells (mass 1.0) and half-size subcells (mass 0.25)
 * independently of visual particle pools or currency pickups.
 */
export class DebrisSystem {
  readonly items: DebrisRecord[] = [];
  private nextId = 1;
  worldGen = 1;

  constructor(private world: PixelWorld) {
    for (let i = 0; i < VACUUM.debrisCap; i++) {
      this.items.push({
        active: false,
        id: 0,
        worldGen: 0,
        x: 0,
        y: 0,
        mass: 0,
        life: 0,
        reservedBy: 0,
        pullStartX: 0,
        pullStartY: 0,
        pullT: 0,
      });
    }
  }

  clear(): void {
    this.worldGen++;
    for (const d of this.items) {
      d.active = false;
      d.reservedBy = 0;
      d.mass = 0;
    }
  }

  recordCellDestroyed(cx: number, cy: number): void {
    const cs = this.world.cellSize;
    this.addRecord((cx + 0.5) * cs, (cy + 0.5) * cs, 1.0);
  }

  recordSubDestroyed(sx: number, sy: number): void {
    const ss = this.world.subCellSize;
    this.addRecord((sx + 0.5) * ss, (sy + 0.5) * ss, VACUUM.subcellMass);
  }

  private addRecord(x: number, y: number, mass: number): void {
    let slot: DebrisRecord | null = null;
    let oldestUnreserved: DebrisRecord | null = null;
    let lowestLife = Infinity;
    for (const d of this.items) {
      if (!d.active) {
        slot = d;
        break;
      }
      if (d.reservedBy === 0 && d.life < lowestLife) {
        lowestLife = d.life;
        oldestUnreserved = d;
      }
    }
    if (!slot) {
      if (oldestUnreserved) {
        // Aggregate mass onto an existing unreserved record so total material is preserved under cap.
        oldestUnreserved.mass += mass;
        oldestUnreserved.life = VACUUM.debrisLife;
        return;
      }
      return;
    }
    slot.active = true;
    slot.id = this.nextId++;
    slot.worldGen = this.worldGen;
    slot.x = x;
    slot.y = y;
    slot.mass = mass;
    slot.life = VACUUM.debrisLife;
    slot.reservedBy = 0;
    slot.pullStartX = x;
    slot.pullStartY = y;
    slot.pullT = 0;
  }

  /** Atomically reserve unreserved debris within `range` of `(x, y)` for `soldierId`. */
  reserveInRange(soldierId: number, x: number, y: number, range: number, maxNew = VACUUM.maxReservePerShot): number {
    let already = 0;
    for (const d of this.items) {
      if (d.active && d.worldGen === this.worldGen && d.reservedBy === soldierId) already++;
    }
    if (already >= maxNew) return 0;
    const r2 = range * range;
    let added = 0;
    for (const d of this.items) {
      if (!d.active || d.worldGen !== this.worldGen || d.reservedBy !== 0) continue;
      const dx = d.x - x;
      const dy = d.y - y;
      if (dx * dx + dy * dy <= r2) {
        d.reservedBy = soldierId;
        d.pullStartX = d.x;
        d.pullStartY = d.y;
        d.pullT = 0;
        added++;
        if (already + added >= maxNew) break;
      }
    }
    return added;
  }

  /** Consume all debris reserved by `soldierId`, returning total mass and record count. */
  consumeFor(soldierId: number): { mass: number; count: number } {
    let mass = 0;
    let count = 0;
    for (const d of this.items) {
      if (!d.active || d.worldGen !== this.worldGen || d.reservedBy !== soldierId) continue;
      mass += d.mass;
      count++;
      d.active = false;
      d.reservedBy = 0;
      d.mass = 0;
    }
    return { mass, count };
  }

  /** Release any reservations held by `soldierId` (e.g. on soldier death). */
  releaseFor(soldierId: number): void {
    for (const d of this.items) {
      if (d.active && d.reservedBy === soldierId) {
        d.reservedBy = 0;
        d.pullT = 0;
      }
    }
  }

  update(dt: number, soldiers: readonly Soldier[]): void {
    const aliveById = new Map<number, Soldier>();
    for (const s of soldiers) {
      if (s.alive) aliveById.set(s.id, s);
    }
    const dur = Math.max(0.05, VACUUM.intakeDuration);
    for (const d of this.items) {
      if (!d.active) continue;
      if (d.worldGen !== this.worldGen) {
        d.active = false;
        d.reservedBy = 0;
        continue;
      }
      if (d.reservedBy !== 0) {
        const owner = aliveById.get(d.reservedBy);
        if (!owner) {
          d.reservedBy = 0;
          d.pullT = 0;
        } else {
          d.pullT = Math.min(1, d.pullT + dt / dur);
          const ease = d.pullT * d.pullT;
          d.x = d.pullStartX + (owner.x - d.pullStartX) * ease;
          d.y = d.pullStartY + (owner.y - d.pullStartY) * ease;
          continue;
        }
      }
      d.life -= dt;
      if (d.life <= 0) {
        d.active = false;
        d.reservedBy = 0;
      }
    }
  }

  get activeCount(): number {
    let n = 0;
    for (const d of this.items) if (d.active) n++;
    return n;
  }
}
