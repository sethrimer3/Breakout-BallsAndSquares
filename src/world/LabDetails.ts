import { valueNoise } from "../core/math";
import { Rng } from "../core/Rng";
import type { PixelWorld } from "./PixelWorld";
import type { LabCorridorSegment, LabLayout, LabRoom } from "./WorldGenerator";

/**
 * Facility set dressing painted over the lab maze: tiled floors, blast doors,
 * hazard stripes, room furnishings and a few breached containment rooms.
 *
 * Details are cosmetic. They live in `world.decor`, leave cell health alone
 * and never empty a cell, so soldiers, currency and blight play the same. The
 * one structural change is a small breach in a wall, which only adds routes.
 * Blight regrowth clears a cell's detail (see GrowthSystem).
 */

/** Values of `world.decor`, indexing `COLORS.labDecor` and `labDecorMix`. */
export const DECOR = {
  none: 0,
  floor: 1,
  floorLine: 2,
  guideLine: 3,
  blightStain: 4,
  door: 5,
  doorSeam: 6,
  doorLight: 7,
  hazardYellow: 8,
  hazardBlack: 9,
  frame: 10,
  glass: 11,
  fluid: 12,
  led: 13,
  panel: 14,
  bench: 15,
  linen: 16,
  scorch: 17,
  blightFloor: 18,
  blightVein: 19,
  blightCoreShell: 20,
  blightCoreHeart: 21,
} as const;

/** Floor tile size, in cells. */
const TILE = 4;
/** Empty floor kept between a room's walls and its furnishings. */
const FURNITURE_MARGIN = 2;
const FURNITURE_GAP = 2;
/** Longer wall openings are corridors running alongside the room, not doors. */
const MAX_DOOR_WIDTH = 6;
const BREACHED_ROOM_CHANCE = 0.2;
const BREACH_WIDTH = 5;

/** Furnishing stamps: `.` leaves the floor showing. */
const STAMP_CELLS: Record<string, number> = {
  F: DECOR.frame,
  G: DECOR.glass,
  W: DECOR.fluid,
  L: DECOR.led,
  P: DECOR.panel,
  B: DECOR.bench,
  N: DECOR.linen,
};

export const ROOM_STAMPS: Record<string, readonly string[]> = {
  /** Specimen tanks. */
  tanks: [".FF.", "FGGF", "FWWF", "FWWF", "FFFF"],
  /** Server racks. */
  servers: ["PPP", "PLP", "PPP", "PLP", "PPP", "PLP"],
  /** Lab benches with equipment. */
  benches: ["BBBBBB", "BPBBLB", "BBBBBB"],
  /** Staff bunks. */
  bunks: ["NNN", "PPP", "PPP", "PPP", "PPP", "PPP"],
};
const STAMP_NAMES = Object.keys(ROOM_STAMPS);

/** Cell `along` a room's side and `out` cells past its interior (-1 = inside). */
type SideCell = (along: number, out: number) => { x: number; y: number };

function roomSides(r: LabRoom): SideCell[] {
  return [
    (along, out) => ({ x: r.x + along, y: r.y - 1 - out }),
    (along, out) => ({ x: r.x + r.size + out, y: r.y + along }),
    (along, out) => ({ x: r.x + along, y: r.y + r.size + out }),
    (along, out) => ({ x: r.x - 1 - out, y: r.y + along }),
  ];
}

function setDecor(world: PixelWorld, x: number, y: number, value: number): void {
  if (world.inBounds(x, y)) world.decor[y * world.width + x] = value;
}

function wallAt(world: PixelWorld, x: number, y: number): number {
  return world.inBounds(x, y) ? world.wall[y * world.width + x] : 0;
}

function paintCorridor(world: PixelWorld, seg: LabCorridorSegment): void {
  const mid = seg.axis === "h" ? Math.floor((seg.y0 + seg.y1) / 2) : Math.floor((seg.x0 + seg.x1) / 2);
  for (let y = seg.y0; y <= seg.y1; y++) {
    for (let x = seg.x0; x <= seg.x1; x++) {
      const across = seg.axis === "h" ? y : x;
      const along = seg.axis === "h" ? x : y;
      const dash = across === mid && along % TILE < 2;
      setDecor(world, x, y, dash ? DECOR.guideLine : DECOR.floor);
    }
  }
}

function paintRoomFloor(world: PixelWorld, r: LabRoom): void {
  for (let y = 0; y < r.size; y++) {
    for (let x = 0; x < r.size; x++) {
      const line = x % TILE === 0 || y % TILE === 0;
      setDecor(world, r.x + x, r.y + y, line ? DECOR.floorLine : DECOR.floor);
    }
  }
}

/** Repeat a stamp in rows across the room, centered, clear of the walls. */
function furnishRoom(world: PixelWorld, r: LabRoom, stamp: readonly string[]): void {
  const w = stamp[0].length;
  const h = stamp.length;
  const usable = r.size - FURNITURE_MARGIN * 2;
  const cols = Math.floor((usable + FURNITURE_GAP) / (w + FURNITURE_GAP));
  const rows = Math.floor((usable + FURNITURE_GAP) / (h + FURNITURE_GAP));
  const startX = r.x + Math.floor((r.size - (cols * (w + FURNITURE_GAP) - FURNITURE_GAP)) / 2);
  const startY = r.y + Math.floor((r.size - (rows * (h + FURNITURE_GAP) - FURNITURE_GAP)) / 2);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const ox = startX + col * (w + FURNITURE_GAP);
      const oy = startY + row * (h + FURNITURE_GAP);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const cell = STAMP_CELLS[stamp[y][x]];
          if (cell !== undefined) setDecor(world, ox + x, oy + y, cell);
        }
      }
    }
  }
}

/** Blast doors, jamb lights and hazard stripes at every corridor opening. */
function paintDoors(world: PixelWorld, r: LabRoom): void {
  for (const cell of roomSides(r)) {
    let along = 0;
    while (along < r.size) {
      const start = cell(along, 0);
      if (wallAt(world, start.x, start.y) !== 0) {
        along++;
        continue;
      }
      const from = along;
      while (along < r.size) {
        const p = cell(along, 0);
        if (wallAt(world, p.x, p.y) !== 0) break;
        along++;
      }
      const to = along - 1;
      if (to - from + 1 > MAX_DOOR_WIDTH) continue;

      const mid = Math.floor((from + to) / 2);
      for (let a = from; a <= to; a++) {
        const inside = cell(a, -1);
        const stripe = (inside.x + inside.y) % 4 < 2 ? DECOR.hazardYellow : DECOR.hazardBlack;
        setDecor(world, inside.x, inside.y, stripe);
        for (let out = 0; out < r.wallThickness; out++) {
          const p = cell(a, out);
          if (wallAt(world, p.x, p.y) !== 0) continue;
          setDecor(world, p.x, p.y, a === mid ? DECOR.doorSeam : DECOR.door);
        }
      }
      for (const a of [from - 1, to + 1]) {
        const jamb = cell(a, 0);
        if (wallAt(world, jamb.x, jamb.y) !== 0) setDecor(world, jamb.x, jamb.y, DECOR.doorLight);
      }
    }
  }
}

/** A containment failure: blight stains the floor and a wall is blown out. */
function breachRoom(world: PixelWorld, r: LabRoom, rng: Rng, seed: number): void {
  for (let y = r.y; y < r.y + r.size; y++) {
    for (let x = r.x; x < r.x + r.size; x++) {
      const i = y * world.width + x;
      const d = world.decor[i];
      if (d !== DECOR.floor && d !== DECOR.floorLine) continue;
      if (valueNoise(x, y, 5, seed + 41) > 0.5) world.decor[i] = DECOR.blightStain;
    }
  }
  const cell = roomSides(r)[rng.int(4)];
  const from = rng.int(r.size - BREACH_WIDTH + 1);
  for (let a = from; a < from + BREACH_WIDTH; a++) {
    // Tapers toward the ends so the hole looks torn rather than cut.
    const edge = a === from || a === from + BREACH_WIDTH - 1;
    const depth = edge ? Math.max(1, r.wallThickness - 1) : r.wallThickness;
    for (let out = 0; out < depth; out++) {
      const p = cell(a, out);
      if (wallAt(world, p.x, p.y) === 0) continue;
      world.wall[p.y * world.width + p.x] = 0;
      setDecor(world, p.x, p.y, DECOR.scorch);
    }
  }
}

/**
 * Paint a room completely overrun with dark pink blight and spawn a 2×2
 * glowing Blight Core at its center. Destroying all cells of the core reduces
 * the blight timer.
 */
function overrunRoomWithBlight(world: PixelWorld, r: LabRoom, seed: number): void {
  const rcx = r.x + Math.floor((r.size - 2) / 2);
  const rcy = r.y + Math.floor((r.size - 2) / 2);
  const centerFx = rcx + 0.5;
  const centerFy = rcy + 0.5;

  // Overrun room interior with dark pink blight floor & glowing veins radiating from the core.
  for (let y = r.y; y < r.y + r.size; y++) {
    for (let x = r.x; x < r.x + r.size; x++) {
      const i = y * world.width + x;
      const dx = x - centerFx;
      const dy = y - centerFy;
      const dist = Math.hypot(dx, dy);
      const ang = Math.atan2(dy, dx);
      // Organic radiating tendrils + noise blotches.
      const n = valueNoise(x, y, 4, seed + 73);
      const ray = Math.abs(Math.sin(ang * 4 + n * 2.2));
      const isVein = ray < 0.24 || n > 0.62 || dist <= 2.8;
      world.decor[i] = isVein ? DECOR.blightVein : DECOR.blightFloor;
      world.blight[i] = 1;
    }
  }

  // Place a 2×2 Blight Core of normal-sized pixels at (rcx..rcx+1, rcy..rcy+1).
  const cid = world.blightCores.length + 1;
  const cells: number[] = [];
  for (let dy = 0; dy <= 1; dy++) {
    for (let dx = 0; dx <= 1; dx++) {
      const cx = rcx + dx;
      const cy = rcy + dy;
      if (!world.inBounds(cx, cy)) continue;
      const idx = cy * world.width + cx;
      world.wall[idx] = 0;
      world.coreId[idx] = cid;
      world.decor[idx] = dx === dy ? DECOR.blightCoreHeart : DECOR.blightCoreShell;
      cells.push(idx);
    }
  }
  r.overrun = true;
  r.coreId = cid;
  world.blightCores.push({
    id: cid,
    roomId: r.id,
    zone: r.zone,
    cx: rcx,
    cy: rcy,
    cells,
    alive: true,
  });
}

/** Dress a generated maze. Call before cell health is computed from `wall`. */
export function decorateLab(world: PixelWorld, layout: LabLayout): void {
  const seed = layout.seed;
  const rng = new Rng((seed ^ 0x2f6e2b1d) >>> 0 || 1);
  world.coreId.fill(0);
  world.blightCores = [];

  for (const seg of layout.corridors) paintCorridor(world, seg);

  // Pick rooms in each zone to be overrun with dark pink blight and host a Blight Core
  // (~30% of rooms, and at least 1 room per zone that has rooms).
  const byZone: LabRoom[][] = [[], [], []];
  for (const room of layout.rooms) byZone[room.zone].push(room);
  const overrunIds = new Set<number>();
  for (const zRooms of byZone) {
    if (zRooms.length === 0) continue;
    const count = Math.max(1, Math.round(zRooms.length * 0.3));
    const startIdx = rng.int(zRooms.length);
    const step = Math.max(1, Math.floor(zRooms.length / count));
    for (let k = 0; k < count; k++) {
      const r = zRooms[(startIdx + k * step) % zRooms.length];
      overrunIds.add(r.id);
    }
  }

  for (const room of layout.rooms) {
    if (overrunIds.has(room.id)) {
      overrunRoomWithBlight(world, room, seed);
    } else {
      paintRoomFloor(world, room);
      const stamp = STAMP_NAMES[rng.int(STAMP_NAMES.length)];
      furnishRoom(world, room, ROOM_STAMPS[stamp]);
    }
  }
  for (const room of layout.rooms) paintDoors(world, room);
  for (const room of layout.rooms) {
    if (overrunIds.has(room.id) || rng.next() < BREACHED_ROOM_CHANCE) {
      breachRoom(world, room, rng, seed);
    }
  }
  // The starting room stays bare.
  for (let y = world.roomY0; y <= world.roomY1; y++) {
    for (let x = world.roomX0; x <= world.roomX1; x++) setDecor(world, x, y, DECOR.none);
  }
}
