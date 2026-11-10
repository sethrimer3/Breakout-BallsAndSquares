import { FACILITY } from "../config";
import type { Door, PixelWorld } from "./PixelWorld";

export interface DoorEvents {
  onOpen?(door: Door): void;
  /** Each cell of a door individually opening/disappearing, with its delay before opening. */
  onCellOpen?(cx: number, cy: number, delay: number, tier: number): void;
  /** A shot hit a world gate the squad has no keycard for. */
  onGateLocked?(door: Door): void;
}

/**
 * Blast doors. A shot on a closed door whose tier the squad holds a keycard
 * for slides it open from the middle outward instead of damaging it. Without
 * the keycard a door breaks like an ordinary block of its tier.
 */
export class DoorSystem {
  private pendingCell: number[] = [];
  private pendingAt: number[] = [];
  private time = 0;

  constructor(
    private world: PixelWorld,
    private events: DoorEvents = {},
  ) {
    world.onDoorHit = (door) => this.tryOpen(door);
  }

  reset(): void {
    this.pendingCell.length = 0;
    this.pendingAt.length = 0;
    this.time = 0;
  }

  /** Open `door` if the squad's keycard covers its tier. */
  tryOpen(door: Door): boolean {
    if (door.open) return false;
    // A sealed gate (the one the squad came through) never opens.
    if (door.gate && door.gate.to === 0) return false;
    if (this.world.keycardTier < door.tier) {
      if (door.gate) this.events.onGateLocked?.(door);
      return false;
    }
    door.open = true;
    const w = this.world;
    const mx = (door.x0 + door.x1) / 2;
    const my = (door.y0 + door.y1) / 2;
    for (const i of door.cells) {
      const cx = i % w.width;
      const cy = (i - cx) / w.width;
      const step = Math.round(Math.max(Math.abs(cx - mx), Math.abs(cy - my)));
      const delay = step * FACILITY.doorOpenStep;
      this.pendingCell.push(i);
      this.pendingAt.push(this.time + delay);
      this.events.onCellOpen?.(cx, cy, delay, door.tier);
    }
    this.events.onOpen?.(door);
    return true;
  }

  update(dt: number): void {
    this.time += dt;
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
      if (w.health[i] > 0) {
        const cx = i % w.width;
        w.setCell(cx, (i - cx) / w.width, 0, "set");
      }
    }
    this.pendingCell.length = keep;
    this.pendingAt.length = keep;
  }
}
