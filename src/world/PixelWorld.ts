import { blockHealthForTier, FACILITY, GROWTH, maxHealthForDistance, TERRAIN, wallHealthForZone } from "../config";
import type { SolidQuery } from "../core/gridRaycast";
import type { LabLayout } from "./WorldGenerator";

export interface BlightCore {
  id: number;
  roomId: number;
  zone: 0 | 1 | 2;
  /** Top-left cell coordinates of the 2×2 blight core. */
  cx: number;
  cy: number;
  /** Indices of the 4 normal cells (or fewer if clipped) belonging to this core. */
  cells: number[];
  alive: boolean;
  /** Edge length in cells: 2 for a room's Blight Core, 1 for a small generator in a glass tank. */
  size: 1 | 2;
}

/** Special block materials (`world.mat`). */
export const MAT = {
  none: 0,
  /** See-through containment glass; one break shatters every orthogonally touching pane. */
  glass: 1,
  /** Blast door; opens when shot by a squad holding its tier's keycard. */
  door: 2,
} as const;

/** Kinds of 50% sub-pixels (`world.subKind`). */
export const SUB = {
  blight: 0,
  rubble: 1,
  /** Lab equipment: machine casing. */
  metal: 2,
  /** Lab equipment: pipework and vents. */
  pipe: 3,
  /** Lab equipment: screens. */
  screen: 4,
  /** Lab equipment: a tiny blinking status light (tint bits 6-7 = color, 0-5 = rhythm). */
  led: 5,
  /** Mystery machine: a slowly pulsing energy core (tint bits 6-7 = color). */
  core: 6,
  /** Smashed, scorched equipment casing in overrun rooms. */
  wreck: 7,
} as const;

/** True for a half-size decor kind (lab equipment), which breaks more easily than rubble or blight. */
export function isDecorSub(kind: number): boolean {
  return kind >= SUB.metal;
}

/** How a room light behaves. */
export const LIGHT_KIND = {
  /** Bright, steady clinical panel in a pristine area. */
  bright: 0,
  /** Dimmer, warmer panel in a worn area. */
  dim: 1,
  /** A failing tube that sputters on and off. */
  flicker: 2,
  /** Pink glow thrown by a living Blight Core over its overrun room. */
  blight: 3,
  /** Even wash over a whole pristine room or hallway (no panel of its own). */
  wash: 4,
} as const;

export interface RoomLight {
  kind: (typeof LIGHT_KIND)[keyof typeof LIGHT_KIND];
  /** Panel bounds in cells (inclusive); for a wash or blight glow, the area lit. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Light never spills past this inclusive cell rectangle (the room or hallway interior). */
  cx0: number;
  cy0: number;
  cx1: number;
  cy1: number;
  /** Per-light random phase (0..1) for flicker timing. */
  phase: number;
  /** For a blight glow: the Blight Core id that powers it. */
  coreId?: number;
}

export interface Door {
  id: number;
  /** Keycard tier that opens it (1..3, the zone of the room it seals + 1). */
  tier: 1 | 2 | 3;
  cells: number[];
  open: boolean;
  /** Inclusive cell bounds. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Where a dormant sentry turret sits, in world units, and the room it guards (inclusive cells). */
export interface SentrySpot {
  x: number;
  y: number;
  zone: 0 | 1 | 2;
  rx0: number;
  ry0: number;
  rx1: number;
  ry1: number;
}

/** A creature floating in a glass tank, released when the tank breaks. */
export interface SpecimenSpot {
  /** Cell of the tank's hollow center. */
  cx: number;
  cy: number;
  zone: 0 | 1 | 2;
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
 * Typed-array pixel terrain with dual-resolution support:
 * - Normal grid (`width × height`, edge `cellSize`): `health[i] > 0` means solid normal pixel.
 * - Sub-grid (`subWidth × subHeight`, edge `subCellSize = cellSize / 2`, 4 subcells per normal cell):
 *   `subHealth[si] > 0` means a 50%-smaller pink blight pixel occupying that subcell when the parent
 *   normal cell is empty (`health[i] === 0`).
 * Cells outside the world are solid and indestructible (the world border).
 */
export class PixelWorld implements SolidQuery {
  readonly width: number;
  readonly height: number;
  readonly cellSize: number;
  readonly subWidth: number;
  readonly subHeight: number;
  readonly subCellSize: number;
  readonly roomSize: number;
  /** Center cell coordinates (used for distance / depth). */
  readonly centerX: number;
  readonly centerY: number;
  /** Inclusive bounds of the starting room, in cells. */
  readonly roomX0: number;
  readonly roomY0: number;
  readonly roomX1: number;
  readonly roomY1: number;

  readonly health: Uint16Array;
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
  /** Per-cell Blight flag (`1` = block generated/replicated by Blight or overrun with Blight). */
  readonly blight: Uint8Array;
  /** Per-cell special material (`MAT`). */
  readonly mat: Uint8Array;
  /** Per-cell door id (`0` = none, `id >= 1` = `doors[id - 1]`). */
  readonly doorId: Uint16Array;
  /** Per-subcell kind (`SUB`): pink blight or collapsed rubble. */
  readonly subKind: Uint8Array;

  /**
   * 50%-smaller sub-pixel grid (4 subcells fit inside 1 normal cell).
   * `subHealth[sy * subWidth + sx]` > 0 when a small pink blight pixel occupies `(sx, sy)`.
   */
  readonly subHealth: Uint16Array;
  readonly subTint: Uint8Array;

  /** Active/destroyed Blight Cores (each 2×2 normal cells) located inside blight-overrun rooms. */
  blightCores: BlightCore[] = [];
  /** Procedurally generated lab rooms & corridors from the most recent `generateWorld` call. */
  labLayout: LabLayout | null = null;
  /** Blast doors between rooms and hallways. */
  doors: Door[] = [];
  /** Light panels and room glows, drawn into the lightmap (see TerrainRenderer.drawRoomLight). */
  roomLights: RoomLight[] = [];
  /** Dormant sentry turret positions from generation. */
  sentrySpots: SentrySpot[] = [];
  /** Glass tanks holding a specimen instead of a small generator. */
  specimenSpots: SpecimenSpot[] = [];
  /** Highest keycard tier the squad holds (0 = none). */
  keycardTier = 0;
  /**
   * Called when a closed door cell is hit. Return true when the hit opens the
   * door instead of damaging it (see DoorSystem).
   */
  onDoorHit: ((door: Door) => boolean) | null = null;

  /** Fine-gridSolidQuery view for `gridRaycast` at `subCellSize` resolution. */
  readonly subSolidQuery: SolidQuery;

  private listeners: CellListener[] = [];

  constructor(dims: WorldDims) {
    this.width = dims.width;
    this.height = dims.height;
    this.cellSize = dims.cellSize;
    this.subWidth = dims.width * 2;
    this.subHeight = dims.height * 2;
    this.subCellSize = dims.cellSize / 2;
    this.roomSize = dims.roomSize;
    this.centerX = Math.floor(dims.width / 2);
    this.centerY = Math.floor(dims.height / 2);
    const half = Math.floor(dims.roomSize / 2);
    this.roomX0 = this.centerX - half;
    this.roomY0 = this.centerY - half;
    this.roomX1 = this.roomX0 + dims.roomSize - 1;
    this.roomY1 = this.roomY0 + dims.roomSize - 1;
    this.health = new Uint16Array(dims.width * dims.height);
    this.tint = new Uint8Array(dims.width * dims.height);
    this.wall = new Uint8Array(dims.width * dims.height);
    this.decor = new Uint8Array(dims.width * dims.height);
    this.coreId = new Uint8Array(dims.width * dims.height);
    this.blight = new Uint8Array(dims.width * dims.height);
    this.mat = new Uint8Array(dims.width * dims.height);
    this.doorId = new Uint16Array(dims.width * dims.height);
    this.subKind = new Uint8Array(dims.width * 2 * dims.height * 2);
    this.subHealth = new Uint16Array(this.subWidth * this.subHeight);
    this.subTint = new Uint8Array(this.subWidth * this.subHeight);
    this.subSolidQuery = {
      solidAt: (sx: number, sy: number) => this.subSolidAt(sx, sy),
    };
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

  subInBounds(sx: number, sy: number): boolean {
    return sx >= 0 && sy >= 0 && sx < this.subWidth && sy < this.subHeight;
  }

  solidAt(cx: number, cy: number): boolean {
    if (cx < 0 || cy < 0 || cx >= this.width || cy >= this.height) return true;
    return this.health[cy * this.width + cx] > 0;
  }

  /**
   * True if the 50% sub-pixel at `(sx, sy)` is solid — either because its parent
   * normal cell `(sx >> 1, sy >> 1)` is solid OR because a small pink blight pixel
   * (`subHealth > 0`) occupies `(sx, sy)`.
   */
  subSolidAt(sx: number, sy: number): boolean {
    if (sx < 0 || sy < 0 || sx >= this.subWidth || sy >= this.subHeight) return true;
    const cx = sx >> 1;
    const cy = sy >> 1;
    if (this.health[cy * this.width + cx] > 0) return true;
    return this.subHealth[sy * this.subWidth + sx] > 0;
  }

  /** True if the normal cell `(cx, cy)` or any of its 4 subcells is solid. */
  anySolidInCell(cx: number, cy: number): boolean {
    if (cx < 0 || cy < 0 || cx >= this.width || cy >= this.height) return true;
    if (this.health[cy * this.width + cx] > 0) return true;
    const sx0 = cx * 2;
    const sy0 = cy * 2;
    const sw = this.subWidth;
    const row0 = sy0 * sw + sx0;
    const row1 = row0 + sw;
    return (
      this.subHealth[row0] > 0 ||
      this.subHealth[row0 + 1] > 0 ||
      this.subHealth[row1] > 0 ||
      this.subHealth[row1 + 1] > 0
    );
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
      const m = this.mat[i];
      if (m === MAT.door) {
        const door = this.doors[this.doorId[i] - 1];
        // Doors break like ordinary blocks of their tier; a keycard just opens them in one hit.
        return blockHealthForTier(door ? door.tier : 1, dist);
      }
      if (m === MAT.glass) {
        return Math.max(1, Math.ceil(maxHealthForDistance(dist) * FACILITY.glassHealthMult));
      }
      const w = this.wall[i];
      if (w > 0) {
        const z = Math.min(2, Math.max(0, w - 1)) as 0 | 1 | 2;
        return wallHealthForZone(z, dist);
      }
      if (this.coreId[i] > 0) {
        return Math.min(TERRAIN.maxHealthCap, maxHealthAtCore(dist));
      }
    }
    return maxHealthForDistance(dist);
  }

  /**
   * Max health for a half-size sub-pixel at `(sx, sy)`: about a quarter of a
   * full-size block there, and half that again for lab decor.
   */
  maxSubHealthAt(sx: number, sy: number): number {
    const dist = this.distanceOf(sx >> 1, sy >> 1);
    let mult = FACILITY.subHealthMult;
    if (this.subInBounds(sx, sy) && isDecorSub(this.subKind[sy * this.subWidth + sx])) mult *= FACILITY.decorHealthMult;
    return Math.max(1, Math.round(maxHealthForDistance(dist) * mult));
  }

  /**
   * Directly set a normal cell's health (used by generation and growth).
   * Also clears any subcells inside `(cx, cy)`. Fires listeners unless `silent`.
   */
  setCell(cx: number, cy: number, hp: number, kind: CellChangeKind = "set", silent = false): void {
    if (!this.inBounds(cx, cy)) return;
    const idx = cy * this.width + cx;
    this.health[idx] = hp;
    if (kind === "grown") {
      this.blight[idx] = 1;
      // Blight replaces whatever material was here.
      this.mat[idx] = MAT.none;
      this.doorId[idx] = 0;
    } else if (hp === 0) {
      this.blight[idx] = 0;
    }
    const sx0 = cx * 2;
    const sy0 = cy * 2;
    const sw = this.subWidth;
    const row0 = sy0 * sw + sx0;
    const row1 = row0 + sw;
    this.subHealth[row0] = 0;
    this.subHealth[row0 + 1] = 0;
    this.subHealth[row1] = 0;
    this.subHealth[row1 + 1] = 0;
    if (!silent) this.emit(cx, cy, kind);
  }

  /**
   * Directly set a 50% subcell's health (pink blight pixel).
   * Fires listeners on the parent normal cell `(sx >> 1, sy >> 1)` unless `silent`.
   */
  setSubCell(sx: number, sy: number, hp: number, kind: CellChangeKind = "grown", silent = false): void {
    if (!this.subInBounds(sx, sy)) return;
    const si = sy * this.subWidth + sx;
    this.subHealth[si] = hp;
    if (kind === "grown") this.subKind[si] = SUB.blight;
    if (!silent) this.emit(sx >> 1, sy >> 1, kind);
  }

  /**
   * True if normal cell `(cx, cy)` is a Blight block (Blight Core, grown blight,
   * blight decor, or contains pink sub-pixel blight).
   */
  isBlightAt(cx: number, cy: number): boolean {
    if (!this.inBounds(cx, cy)) return false;
    const i = cy * this.width + cx;
    if (this.health[i] > 0) {
      if (this.coreId[i] > 0 || this.blight[i] > 0) return true;
      const d = this.decor[i];
      if (d === 4 || (d >= 18 && d <= 21)) return true;
    }
    const sx0 = cx * 2;
    const sy0 = cy * 2;
    const sw = this.subWidth;
    const row0 = sy0 * sw + sx0;
    const row1 = row0 + sw;
    return this.isPinkSub(row0) || this.isPinkSub(row0 + 1) || this.isPinkSub(row1) || this.isPinkSub(row1 + 1);
  }

  /** True if subcell index `si` holds a pink blight sub-pixel (not rubble). */
  isPinkSub(si: number): boolean {
    return this.subHealth[si] > 0 && this.subKind[si] === SUB.blight;
  }

  /** True if subcell index `si` holds a rubble sub-pixel. */
  isRubbleSub(si: number): boolean {
    return this.subHealth[si] > 0 && this.subKind[si] === SUB.rubble;
  }

  /**
   * True if subcell `(sx, sy)` is a Blight block (either because its parent normal cell
   * is a solid Blight block or because `(sx, sy)` has pink sub-blight).
   */
  isBlightSubAt(sx: number, sy: number): boolean {
    if (!this.subInBounds(sx, sy)) return false;
    const cx = sx >> 1;
    const cy = sy >> 1;
    const i = cy * this.width + cx;
    if (this.health[i] > 0) {
      return this.isBlightAt(cx, cy);
    }
    return this.isPinkSub(sy * this.subWidth + sx);
  }

  /**
   * Apply damage to a normal cell `(cx, cy)`. If the normal cell is empty (`hp === 0`)
   * and any of its 4 subcells are solid, damages those subcells instead.
   * Returns 0 if nothing happened, 1 if damaged, 2 if destroyed.
   */
  damage(cx: number, cy: number, amount: number): 0 | 1 | 2 {
    if (!this.inBounds(cx, cy)) return 0;
    const i = cy * this.width + cx;
    const hp = this.health[i];
    if (hp === 0) {
      // Check if any subcell in this normal cell is occupied.
      const sx0 = cx * 2;
      const sy0 = cy * 2;
      let bestRes: 0 | 1 | 2 = 0;
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const r = this.damageSub(sx0 + dx, sy0 + dy, amount);
          if (r > bestRes) bestRes = r;
        }
      }
      return bestRes;
    }
    if (this.mat[i] === MAT.door && this.onDoorHit) {
      const door = this.doors[this.doorId[i] - 1];
      if (door && !door.open && this.onDoorHit(door)) {
        this.emit(cx, cy, "damaged");
        return 1;
      }
    }
    const next = Math.max(0, hp - amount);
    this.health[i] = next;
    if (next === 0) {
      this.blight[i] = 0;
      this.emit(cx, cy, "destroyed");
      return 2;
    }
    this.emit(cx, cy, "damaged");
    return 1;
  }

  /**
   * Apply damage at subcell coordinates `(sx, sy)`.
   * If the parent normal cell `(sx >> 1, sy >> 1)` is solid, damages the parent normal cell.
   * Otherwise damages the 50% pink blight subcell at `(sx, sy)`.
   */
  damageSub(sx: number, sy: number, amount: number): 0 | 1 | 2 {
    if (!this.subInBounds(sx, sy)) return 0;
    const cx = sx >> 1;
    const cy = sy >> 1;
    const i = cy * this.width + cx;
    if (this.health[i] > 0) {
      return this.damage(cx, cy, amount);
    }
    const si = sy * this.subWidth + sx;
    const hp = this.subHealth[si];
    if (hp === 0) return 0;
    const next = Math.max(0, hp - amount);
    this.subHealth[si] = next;
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

function maxHealthAtCore(dist: number): number {
  return maxHealthForDistance(dist) + GROWTH.coreHealthBonus;
}
