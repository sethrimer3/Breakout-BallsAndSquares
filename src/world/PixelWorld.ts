import { GROWTH, maxHealthForDistance, TERRAIN, wallHealthForZone } from "../config";
import type { SolidQuery } from "../core/gridRaycast";
import type { LabLayout } from "./WorldGenerator";

export interface BlightCore {
  id: number;
  roomId: number;
  zone: 0 | 1 | 2;
  /** Center cell coordinates of the 3×3 blight core. */
  cx: number;
  cy: number;
  /** Indices of the 9 cells (or fewer if clipped) belonging to this core. */
  cells: number[];
  alive: boolean;
}

export type CellChangeKind = "damaged" | "destroyed" | "grown" | "set";

export type CellListener = (cx: number, cy: number, kind: CellChangeKind) => void;

export interface WorldDims {
  width: number;
  height: number;
  cellSize: number;
  roomSize: number;
}

/**
 * Typed-array pixel terrain. health[i] == 0 means empty; > 0 means solid with
 * that much remaining health. Cells outside the world are solid and
 * indestructible (the world border).
 */
export class PixelWorld implements SolidQuery {
  readonly width: number;
  readonly height: number;
  readonly cellSize: number;
  readonly roomSize: number;
  /** Center cell coordinates (used for distance / depth). */
  readonly centerX: number;
  readonly centerY: number;
  /** Inclusive bounds of the starting room, in cells. */
  readonly roomX0: number;
  readonly roomY0: number;
  readonly roomX1: number;
  readonly roomY1: number;

  readonly health: Uint8Array;
  /** Per-cell color variation seed (0..255). */
  readonly tint: Uint8Array;
  /**
   * Per-cell wall material flag:
   * 0 = normal fill of the cell's own zone
   * 1 = lab wall made of Zone 2 material (in Zone 1)
   * 2 = lab wall made of Zone 3 material (in Zone 2)
   * 3 = lab wall made of Reinforced Wall material (in Zone 3)
   */
  readonly wall: Uint8Array;
  /** Per-cell lab set dressing (`DECOR` in LabDetails.ts). Purely cosmetic. */
  readonly decor: Uint8Array;
  /** Per-cell Blight Core id (`0` = not a core cell, `id >= 1` = belongs to `blightCores[id - 1]`). */
  readonly coreId: Uint8Array;
  /** Active/destroyed Blight Cores located inside blight-overrun rooms. */
  blightCores: BlightCore[] = [];
  /** Procedurally generated lab rooms & corridors from the most recent `generateWorld` call. */
  labLayout: LabLayout | null = null;

  private listeners: CellListener[] = [];

  constructor(dims: WorldDims) {
    this.width = dims.width;
    this.height = dims.height;
    this.cellSize = dims.cellSize;
    this.roomSize = dims.roomSize;
    this.centerX = Math.floor(dims.width / 2);
    this.centerY = Math.floor(dims.height / 2);
    const half = Math.floor(dims.roomSize / 2);
    this.roomX0 = this.centerX - half;
    this.roomY0 = this.centerY - half;
    this.roomX1 = this.roomX0 + dims.roomSize - 1;
    this.roomY1 = this.roomY0 + dims.roomSize - 1;
    this.health = new Uint8Array(dims.width * dims.height);
    this.tint = new Uint8Array(dims.width * dims.height);
    this.wall = new Uint8Array(dims.width * dims.height);
    this.decor = new Uint8Array(dims.width * dims.height);
    this.coreId = new Uint8Array(dims.width * dims.height);
  }

  get worldWidth(): number {
    return this.width * this.cellSize;
  }

  get worldHeight(): number {
    return this.height * this.cellSize;
  }

  /** World-space center of the starting room. */
  get roomCenterX(): number {
    return ((this.roomX0 + this.roomX1 + 1) / 2) * this.cellSize;
  }

  get roomCenterY(): number {
    return ((this.roomY0 + this.roomY1 + 1) / 2) * this.cellSize;
  }

  addListener(fn: CellListener): void {
    this.listeners.push(fn);
  }

  inBounds(cx: number, cy: number): boolean {
    return cx >= 0 && cy >= 0 && cx < this.width && cy < this.height;
  }

  solidAt(cx: number, cy: number): boolean {
    if (cx < 0 || cy < 0 || cx >= this.width || cy >= this.height) return true;
    return this.health[cy * this.width + cx] > 0;
  }

  /** Chebyshev distance of a cell from the world center. */
  distanceOf(cx: number, cy: number): number {
    return Math.max(Math.abs(cx - this.centerX), Math.abs(cy - this.centerY));
  }

  /** Depth beyond the starting room (0 inside / at the room edge). */
  depthOf(cx: number, cy: number): number {
    return Math.max(0, this.distanceOf(cx, cy) - Math.floor(this.roomSize / 2));
  }

  maxHealthAt(cx: number, cy: number): number {
    const dist = this.distanceOf(cx, cy);
    if (this.inBounds(cx, cy)) {
      const i = cy * this.width + cx;
      const w = this.wall[i];
      if (w > 0) {
        const z = Math.min(2, Math.max(0, w - 1)) as 0 | 1 | 2;
        return wallHealthForZone(z, dist);
      }
      if (this.coreId[i] > 0) {
        return Math.min(TERRAIN.maxHealthCap, maxHealthForDistance(dist) + GROWTH.coreHealthBonus);
      }
    }
    return maxHealthForDistance(dist);
  }

  /**
   * Directly set a cell's health (used by generation and growth).
   * Fires listeners unless `silent`.
   */
  setCell(cx: number, cy: number, hp: number, kind: CellChangeKind = "set", silent = false): void {
    if (!this.inBounds(cx, cy)) return;
    this.health[cy * this.width + cx] = hp;
    if (!silent) this.emit(cx, cy, kind);
  }

  /**
   * Apply damage. Returns 0 if nothing happened (empty / out of bounds),
   * 1 if damaged, 2 if destroyed.
   */
  damage(cx: number, cy: number, amount: number): 0 | 1 | 2 {
    if (!this.inBounds(cx, cy)) return 0;
    const i = cy * this.width + cx;
    const hp = this.health[i];
    if (hp === 0) return 0;
    const next = Math.max(0, hp - amount);
    this.health[i] = next;
    if (next === 0) {
      this.emit(cx, cy, "destroyed");
      return 2;
    }
    this.emit(cx, cy, "damaged");
    return 1;
  }

  /**
   * Check if destroying cell `(cx, cy)` finished off a Blight Core.
   * Returns the newly destroyed `BlightCore` (once), or `null`.
   */
  checkCoreDestroyedAt(cx: number, cy: number): BlightCore | null {
    if (!this.inBounds(cx, cy)) return null;
    const cid = this.coreId[cy * this.width + cx];
    if (cid === 0) return null;
    const core = this.blightCores[cid - 1];
    if (!core || !core.alive) return null;
    for (let k = 0; k < core.cells.length; k++) {
      if (this.health[core.cells[k]] > 0) return null;
    }
    core.alive = false;
    return core;
  }

  private emit(cx: number, cy: number, kind: CellChangeKind): void {
    for (let k = 0; k < this.listeners.length; k++) this.listeners[k](cx, cy, kind);
  }
}
