import { FACILITY } from "../config";
import { Rng } from "../core/Rng";
import { MAT, SUB, type PixelWorld } from "./PixelWorld";
import type { LabLayout, LabRoom } from "./WorldGenerator";

/**
 * Half-size destructible lab equipment: consoles, server racks, pipe runs and
 * bulky machines along room walls, and pipes down some hallways. Built from
 * half-size pixels so it reads as fine machinery while room centers stay open.
 * Runs after rooms and corridors are carved (it only fills empty cells).
 */

/** Room-interior offset (in cells) from each wall, per side: top, right, bottom, left. */
type Side = 0 | 1 | 2 | 3;

export function placeLabEquipment(world: PixelWorld, layout: LabLayout): void {
  const rng = new Rng((layout.seed ^ 0x51e7c0de) >>> 0 || 1);
  for (const room of layout.rooms) {
    if (room.overrun || inStartRoom(world, room)) continue;
    for (let side = 0 as Side; side < 4; side = (side + 1) as Side) {
      if (rng.next() > FACILITY.equipmentSideChance) continue;
      const pieces = 1 + rng.int(2);
      for (let p = 0; p < pieces; p++) placePiece(world, room, side, rng);
    }
  }
  // Corridor segments run into rooms; hallway pipes stop at the room's edge.
  const inRoom = new Uint8Array(world.width * world.height);
  for (const r of layout.rooms) {
    for (let y = r.y - r.wallThickness; y < r.y + r.size + r.wallThickness; y++) {
      for (let x = r.x - r.wallThickness; x < r.x + r.size + r.wallThickness; x++) {
        if (world.inBounds(x, y)) inRoom[y * world.width + x] = 1;
      }
    }
  }
  const pipe = (sx: number, sy: number, k: number, tint: number): void => {
    if (world.subInBounds(sx, sy) && !inRoom[(sy >> 1) * world.width + (sx >> 1)]) putSub(world, sx, sy, k, tint);
  };
  for (const seg of layout.corridors) {
    if (seg.rubble || seg.width < 3 || rng.next() > FACILITY.corridorPipeChance) continue;
    // A pipe bundle hugging one side of the hallway, one half-cell thick.
    const near = rng.next() < 0.5;
    const tint = rng.int(256);
    if (seg.axis === "h") {
      const sy = near ? seg.y0 * 2 : seg.y1 * 2 + 1;
      for (let sx = seg.x0 * 2 + 2; sx <= seg.x1 * 2 - 1; sx++) pipe(sx, sy, sx % 7 === 0 ? SUB.metal : SUB.pipe, tint);
    } else {
      const sx = near ? seg.x0 * 2 : seg.x1 * 2 + 1;
      for (let sy = seg.y0 * 2 + 2; sy <= seg.y1 * 2 - 1; sy++) pipe(sx, sy, sy % 7 === 0 ? SUB.metal : SUB.pipe, tint);
    }
  }
}

function inStartRoom(world: PixelWorld, r: LabRoom): boolean {
  return r.x <= world.roomX1 && r.x + r.size - 1 >= world.roomX0 && r.y <= world.roomY1 && r.y + r.size - 1 >= world.roomY0;
}

/** Half-size coordinates of a piece cell `(along, depth)` measured in subcells from the wall on `side`. */
function subAt(r: LabRoom, side: Side, along: number, depth: number): { sx: number; sy: number } {
  const x0 = r.x * 2;
  const y0 = r.y * 2;
  const n = r.size * 2;
  if (side === 0) return { sx: x0 + along, sy: y0 + depth };
  if (side === 1) return { sx: x0 + n - 1 - depth, sy: y0 + along };
  if (side === 2) return { sx: x0 + along, sy: y0 + n - 1 - depth };
  return { sx: x0 + depth, sy: y0 + along };
}

function placePiece(world: PixelWorld, r: LabRoom, side: Side, rng: Rng): void {
  const n = r.size * 2;
  const kind = rng.int(4);
  // Lengths and depths in subcells.
  const len = kind === 0 ? 4 + rng.int(5) : kind === 1 ? 2 + rng.int(2) : kind === 2 ? 8 + rng.int(9) : 4 + rng.int(3);
  const depth = kind === 0 ? 2 : kind === 1 ? 2 : kind === 2 ? 1 : 3 + rng.int(2);
  // Keep clear of the corners and the room's door thresholds.
  const start = 3 + rng.int(Math.max(1, n - len - 6));
  if (start + len > n - 3) return;
  for (let a = start - 1; a <= start + len; a++) {
    for (let d = 0; d <= depth; d++) {
      const { sx, sy } = subAt(r, side, a, d);
      if (!free(world, sx, sy)) return;
    }
  }
  const tint = rng.int(256);
  for (let a = start; a < start + len; a++) {
    for (let d = 0; d < depth; d++) {
      const { sx, sy } = subAt(r, side, a, d);
      const i = a - start;
      let k: number = SUB.metal;
      if (kind === 0) {
        // Console: metal back against the wall, a strip of screens facing the room.
        k = d === depth - 1 && i > 0 && i < len - 1 ? SUB.screen : SUB.metal;
      } else if (kind === 1) {
        // Server rack: blinking LEDs dotted down a metal cabinet.
        k = (i + d) % 2 === 0 ? SUB.screen : SUB.metal;
      } else if (kind === 2) {
        // Pipe run with valve collars.
        k = i % 5 === 0 ? SUB.metal : SUB.pipe;
      } else {
        // Machine block with a vent grille on its face.
        k = d === depth - 1 && i % 2 === 1 ? SUB.pipe : SUB.metal;
      }
      putSub(world, sx, sy, k, (tint + i * 37 + d * 11) & 255);
    }
  }
}

/** A subcell inside an empty, plain floor cell (not door, glass, generator, threshold or occupied). */
function free(world: PixelWorld, sx: number, sy: number): boolean {
  if (!world.subInBounds(sx, sy)) return false;
  const ci = (sy >> 1) * world.width + (sx >> 1);
  if (world.health[ci] > 0 || world.mat[ci] !== MAT.none || world.coreId[ci] > 0) return false;
  // Hazard stripes (8, 9) mark the floor just inside a door.
  const d = world.decor[ci];
  if (d === 8 || d === 9) return false;
  return world.subHealth[sy * world.subWidth + sx] === 0;
}

function putSub(world: PixelWorld, sx: number, sy: number, kind: number, tint: number): void {
  if (!free(world, sx, sy)) return;
  const si = sy * world.subWidth + sx;
  world.subKind[si] = kind;
  world.subTint[si] = tint;
  world.subHealth[si] = world.maxSubHealthAt(sx, sy);
}
