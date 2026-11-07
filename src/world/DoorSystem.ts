import { FACILITY } from "../config";
import type { Door, PixelWorld } from "./PixelWorld";

export interface DoorEvents {
  onOpen?(door: Door): void;
}

/**
 * Blast doors. A shot on a closed door whose tier the squad holds a keycard
 * for slides it open from the middle outward instead of damaging it. Without
 * the keycard a door is just very tough wall-grade material.
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
    if (door.open || this.world.keycardTier < door.tier) return false;
    door.open = true;
    const w = this.world;
    const mx = (door.x0 + door.x1) / 2;
    const my = (door.y0 + door.y1) / 2;
    for (const i of door.cells) {
      const cx = i % w.width;
      const cy = (i - cx) / w.width;
      const step = Math.round(Math.max(Math.abs(cx - mx), Math.abs(cy - my)));
      this.pendingCell.push(i);
      this.pendingAt.push(this.time + step * FACILITY.doorOpenStep);
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
