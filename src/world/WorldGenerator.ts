import { FACILITY, TERRAIN, zoneForDepth } from "../config";
import { hash2, valueNoise } from "../core/math";
import { Rng } from "../core/Rng";
import { placeLabEquipment } from "./LabEquipment";
import { decorateLab } from "./LabDetails";
import { buildAuthoredLayout, labFrame, sectorAtCell, sectorBounds, sectorRing, zoneForSectorRing, LAB_SEED, SECTORS_PER_SIDE, type LabFrame, type RoomKind } from "./labMap";
import { MAT, SUB, type PixelWorld } from "./PixelWorld";
import { corridorCaveIns, placeCaveIns, roomCaveIns, type CaveIn } from "./CaveIns";

export interface LabRoom {
  id: number;
  zone: 0 | 1 | 2;
  /** Top-left cell coordinate of the room interior. */
  x: number;
  y: number;
  /** Square edge length in cells (10..30). */
  size: number;
  /** Wall outline thickness in cells (1..3). */
  wallThickness: number;
  /** True if this room is overrun with dark pink blight and hosts a Blight Core. */
  overrun?: boolean;
  /** 1-based Blight Core id if `overrun` is true. */
  coreId?: number;
  /** How well the room has held up (`ROOM_STATE`): pristine, worn, decayed or overrun. */
  state?: RoomState;
  /** Hand-made lab only: the sector holding the room's center. */
  sector?: number;
  /** Hand-made lab only: what the blueprint asks for (overrun rooms and tank rooms are fixed). */
  kind?: RoomKind;
}

/** Condition of a lab room or hallway, from freshly built to swallowed by Blight. */
export const ROOM_STATE = { pristine: 0, worn: 1, decayed: 2, overrun: 3 } as const;
export type RoomState = (typeof ROOM_STATE)[keyof typeof ROOM_STATE];

export interface LabCorridorSegment {
  zone: 0 | 1 | 2;
  /** Axis of the straight segment. */
  axis: "h" | "v";
  /** Inclusive cell bounds of the corridor interior. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Corridor width in cells (3..5). */
  width: number;
  /** Wall outline thickness in cells (1..3). */
  wallThickness: number;
  /** True if this hallway has collapsed and is choked with half-size rubble. */
  rubble?: boolean;
  /** How well the hallway has held up (`ROOM_STATE`; never overrun). */
  state?: RoomState;
}

export interface LabLayout {
  seed: number;
  rooms: LabRoom[];
  corridors: LabCorridorSegment[];
  /** Set when the layout is the hand-made lab blueprint (see labMap.ts). */
  frame?: LabFrame;
}

export interface GenerateOptions {
  /** Sectors whose generators were all destroyed in earlier runs: they start cleared. */
  conquered?: ReadonlySet<number>;
  /** Force the old procedural maze even when the world fits the hand-made lab. */
  procedural?: boolean;
}

/** Cells kept between a lab room and the starting room. */
const START_ROOM_CLEARANCE = 5;

/** Room centers sit on this lattice (cells), so rooms line up like a real plan. */
const ROOM_LATTICE = 16;

function snapToLattice(v: number, center: number): number {
  return center + Math.round((v - center) / ROOM_LATTICE) * ROOM_LATTICE;
}

/**
 * Top-left cell of a room centered on lattice line `line`. Even rooms can't
 * center exactly, so the spare cell goes toward the world center on every side:
 * otherwise a room that fits east of the start would poke out of its zone west.
 */
function roomOrigin(line: number, size: number, center: number): number {
  const half = Math.floor(size / 2);
  return line < center ? line - (size - 1 - half) : line - half;
}

interface ZoneBand {
  zone: 0 | 1 | 2;
  minDepth: number;
  maxDepth: number;
}

/**
 * Fill the world with solid terrain and a procedurally generated research lab
 * layout of rooms and orthogonal corridors per zone, outlined by 1-3 cell walls
 * made of the next deeper zone's material (or reinforced wall material in the
 * deepest zone). Carves the empty starting room and leaves its exit clear.
 * Does not fire listeners.
 */
export function generateWorld(world: PixelWorld, seed: number, options: GenerateOptions = {}): void {
  const { width, height, health, tint, wall } = world;
  wall.fill(0);
  world.decor.fill(0);
  world.coreId.fill(0);
  world.blight.fill(0);
  world.subHealth.fill(0);
  world.subTint.fill(0);
  world.subKind.fill(0);
  world.mat.fill(0);
  world.doorId.fill(0);

  // The hand-made lab when the world can hold it; otherwise a procedural maze.
  // `seed` still drives what changes run to run (crystal veins).
  const frame = options.procedural ? null : labFrame(world);
  const layout = frame ? buildAuthoredLayout(frame) : buildLabLayout(world, seed);
  world.labLayout = layout;
  const runSeed = seed;
  if (frame) seed = LAB_SEED;

  // Pass 1: Paint 1-3 cell thick wall outlines around every room and corridor.
  for (const room of layout.rooms) {
    const t = room.wallThickness;
    const mat = (room.zone + 1) as 1 | 2 | 3;
    paintWallRect(world, room.x - t, room.y - t, room.x + room.size - 1 + t, room.y + room.size - 1 + t, mat);
  }
  for (const seg of layout.corridors) {
    const t = seg.wallThickness;
    paintWallCorridor(world, seg.x0 - t, seg.y0 - t, seg.x1 + t, seg.y1 + t);
  }

  // Pass 2: Carve soft-fill interiors of rooms and corridors (wall = 0),
  // automatically leaving openings wherever corridors meet rooms or each other.
  for (const room of layout.rooms) {
    clearWallRect(world, room.x, room.y, room.x + room.size - 1, room.y + room.size - 1);
  }
  for (const seg of layout.corridors) {
    clearWallRect(world, seg.x0, seg.y0, seg.x1, seg.y1);
  }

  // Keep a 1-cell margin immediately around the starting room free of lab walls
  // except where the exit corridor walls frame the exit, and ensure the starting
  // room itself is empty.
  clearWallRect(world, world.roomX0, world.roomY0, world.roomX1, world.roomY1);

  // Facility set dressing. A breach softens wall cells, so this runs before health.
  decorateLab(world, layout);

  // Pass 3: Populate cell health (using wall material health where wall > 0) and tint.
  for (let cy = 0; cy < height; cy++) {
    for (let cx = 0; cx < width; cx++) {
      const i = cy * width + cx;
      health[i] = world.maxHealthAt(cx, cy);
      // Large-scale blotches mixed with fine per-cell grain.
      const n = valueNoise(cx, cy, 23, seed) * 0.65 + valueNoise(cx, cy, 7, seed + 17) * 0.35;
      const grain = hash2(cx, cy, seed + 101);
      tint[i] = Math.min(255, Math.floor((n * 0.85 + grain * 0.15) * 256));
    }
  }

  // Rooms and hallways are empty space: only doors, glass tanks and generators stay solid.
  const roomMask = new Uint8Array(width * height);
  for (const room of layout.rooms) {
    forRect(world, room.x, room.y, room.x + room.size - 1, room.y + room.size - 1, (i) => {
      roomMask[i] = 1;
    });
  }
  const carve = (i: number): void => {
    if (wall[i] !== 0 || world.mat[i] !== MAT.none || world.coreId[i] > 0) return;
    health[i] = 0;
    world.blight[i] = 0;
  };
  for (const seg of layout.corridors) forRect(world, seg.x0, seg.y0, seg.x1, seg.y1, carve);
  for (const room of layout.rooms) forRect(world, room.x, room.y, room.x + room.size - 1, room.y + room.size - 1, carve);

  // Ensure Blight Cores are always solid living cells with full core health
  for (const core of world.blightCores) {
    for (const idx of core.cells) {
      const cx = idx % width;
      const cy = Math.floor(idx / width);
      health[idx] = world.maxHealthAt(cx, cy);
      world.blight[idx] = 1;
    }
  }

  // Carve the empty starting room.
  for (let cy = world.roomY0; cy <= world.roomY1; cy++) {
    for (let cx = world.roomX0; cx <= world.roomX1; cx++) {
      const i = cy * width + cx;
      wall[i] = 0;
      health[i] = 0;
      world.blight[i] = 0;
      world.mat[i] = MAT.none;
      roomMask[i] = 1;
    }
  }

  // Cave-ins: heaps of half-size rubble where a collapsed hallway's ceiling
  // came down, and wall sections that gave way in run-down rooms.
  const inStart = (i: number): boolean => {
    const x = i % width;
    const y = (i - x) / width;
    return x >= world.roomX0 - 2 && x <= world.roomX1 + 2 && y >= world.roomY0 - 2 && y <= world.roomY1 + 2;
  };
  const falls: CaveIn[] = [];
  for (const seg of layout.corridors) {
    if (!seg.rubble) continue;
    for (const c of corridorCaveIns(seg, seed)) {
      // Halls run into rooms; a fall belongs to the hallway part.
      if (!roomMask[Math.floor(c.y) * width + Math.floor(c.x)]) falls.push(c);
    }
  }
  for (const room of layout.rooms) falls.push(...roomCaveIns(room, seed));
  placeCaveIns(world, falls, seed, inStart);

  // Half-size consoles, racks, pipes and machines along room walls and some hallways.
  placeLabEquipment(world, layout);

  if (frame) {
    placeCrystalVeins(world, frame, runSeed);
    if (options.conquered) clearConqueredSectors(world, frame, options.conquered);
  }
}

/**
 * Seams of crystal in the lab's walls, rolled fresh every run: orange crystal
 * in tier 2 sectors, green in tier 3. A vein is a short random walk through
 * wall cells starting from a face that touches open floor, so it can be seen
 * and dug out. Crystal breaks like an ordinary block of its tier, a soft spot
 * in a hard wall, and is the only source of crystals.
 */
export function placeCrystalVeins(world: PixelWorld, frame: LabFrame, runSeed: number): void {
  const rng = new Rng((runSeed ^ 0x3c6ef372) >>> 0 || 1);
  const { width, health, wall, mat } = world;
  const open = (x: number, y: number): boolean => world.inBounds(x, y) && health[y * width + x] === 0;
  const isWall = (x: number, y: number): boolean => {
    if (!world.inBounds(x, y)) return false;
    const i = y * width + x;
    return wall[i] > 0 && health[i] > 0 && mat[i] === MAT.none && world.coreId[i] === 0 && world.blight[i] === 0;
  };
  const sectors = SECTORS_PER_SIDE * SECTORS_PER_SIDE;
  for (let s = 0; s < sectors; s++) {
    if (zoneForSectorRing(sectorRing(s)) < 1) continue;
    const b = sectorBounds(frame, s);
    // Exposed wall faces in this sector.
    const faces: number[] = [];
    for (let y = b.y0; y <= b.y1; y++) {
      for (let x = b.x0; x <= b.x1; x++) {
        if (isWall(x, y) && (open(x - 1, y) || open(x + 1, y) || open(x, y - 1) || open(x, y + 1))) faces.push(y * width + x);
      }
    }
    if (faces.length === 0) continue;
    const veins = FACILITY.crystalVeinsMin + rng.int(FACILITY.crystalVeinsMax - FACILITY.crystalVeinsMin + 1);
    for (let v = 0; v < veins; v++) {
      let i = faces[rng.int(faces.length)];
      const cells = FACILITY.crystalVeinMin + rng.int(FACILITY.crystalVeinMax - FACILITY.crystalVeinMin + 1);
      for (let k = 0; k < cells; k++) {
        mat[i] = MAT.crystal;
        const x = i % width;
        const y = (i - x) / width;
        const steps = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => isWall(x + dx, y + dy));
        if (steps.length === 0) break;
        const [dx, dy] = steps[rng.int(steps.length)];
        i = (y + dy) * width + x + dx;
      }
    }
  }
  // Veins are as tough as an ordinary block of their tier, not wall-grade.
  for (let i = 0; i < mat.length; i++) {
    if (mat[i] === MAT.crystal) health[i] = world.maxHealthAt(i % width, (i / width) | 0);
  }
}

/**
 * Sectors conquered in earlier runs start cleared: their generators are dead
 * and the Blight they fed is gone, though the scars stay.
 */
export function clearConqueredSectors(world: PixelWorld, frame: LabFrame, conquered: ReadonlySet<number>): void {
  if (conquered.size === 0) return;
  const { width } = world;
  for (const core of world.blightCores) {
    const s = sectorAtCell(frame, core.cx, core.cy);
    if (!conquered.has(s)) continue;
    core.alive = false;
    for (const i of core.cells) {
      world.health[i] = 0;
      world.blight[i] = 0;
    }
  }
  for (const s of conquered) {
    const b = sectorBounds(frame, s);
    for (let y = b.y0; y <= b.y1; y++) {
      for (let x = b.x0; x <= b.x1; x++) {
        const i = y * width + x;
        if (world.blight[i] && world.coreId[i] === 0) {
          world.blight[i] = 0;
          if (world.wall[i] === 0 && world.mat[i] === MAT.none) world.health[i] = 0;
        }
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const si = (y * 2 + dy) * world.subWidth + x * 2 + dx;
            if (world.subKind[si] === SUB.blight && world.subHealth[si] > 0) world.subHealth[si] = 0;
          }
        }
      }
    }
  }
}

/** Call `fn` with the index of every in-bounds cell of an inclusive rectangle. */
function forRect(world: PixelWorld, x0: number, y0: number, x1: number, y1: number, fn: (i: number) => void): void {
  const cx0 = Math.max(0, x0);
  const cy0 = Math.max(0, y0);
  const cx1 = Math.min(world.width - 1, x1);
  const cy1 = Math.min(world.height - 1, y1);
  for (let y = cy0; y <= cy1; y++) {
    const row = y * world.width;
    for (let x = cx0; x <= cx1; x++) fn(row + x);
  }
}

function paintWallRect(
  world: PixelWorld,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  mat: 1 | 2 | 3,
): void {
  const cx0 = Math.max(0, x0);
  const cy0 = Math.max(0, y0);
  const cx1 = Math.min(world.width - 1, x1);
  const cy1 = Math.min(world.height - 1, y1);
  for (let y = cy0; y <= cy1; y++) {
    const row = y * world.width;
    for (let x = cx0; x <= cx1; x++) {
      world.wall[row + x] = mat;
    }
  }
}

function paintWallCorridor(
  world: PixelWorld,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): void {
  const cx0 = Math.max(0, x0);
  const cy0 = Math.max(0, y0);
  const cx1 = Math.min(world.width - 1, x1);
  const cy1 = Math.min(world.height - 1, y1);
  for (let y = cy0; y <= cy1; y++) {
    const row = y * world.width;
    for (let x = cx0; x <= cx1; x++) {
      const z = zoneForDepth(world.depthOf(x, y));
      const mat = (z + 1) as 1 | 2 | 3;
      if (world.wall[row + x] === 0) {
        world.wall[row + x] = mat;
      }
    }
  }
}

function clearWallRect(world: PixelWorld, x0: number, y0: number, x1: number, y1: number): void {
  const cx0 = Math.max(0, x0);
  const cy0 = Math.max(0, y0);
  const cx1 = Math.min(world.width - 1, x1);
  const cy1 = Math.min(world.height - 1, y1);
  for (let y = cy0; y <= cy1; y++) {
    const row = y * world.width;
    for (let x = cx0; x <= cx1; x++) {
      world.wall[row + x] = 0;
    }
  }
}

function buildLabLayout(world: PixelWorld, seed: number): LabLayout {
  const rng = new Rng((seed ^ 0x6d2b79f5) >>> 0 || 1);
  const rooms: LabRoom[] = [];
  const corridors: LabCorridorSegment[] = [];

  const maxWorldDepth =
    Math.min(world.centerX, world.centerY, world.width - 1 - world.centerX, world.height - 1 - world.centerY) -
    Math.floor(world.roomSize / 2) -
    2;

  if (maxWorldDepth < 12) {
    return { seed, rooms, corridors };
  }

  const bands: ZoneBand[] = [
    { zone: 0, minDepth: 0, maxDepth: Math.min(maxWorldDepth, TERRAIN.zone2Depth - 1) },
    { zone: 1, minDepth: TERRAIN.zone2Depth, maxDepth: Math.min(maxWorldDepth, TERRAIN.zone3Depth - 1) },
    { zone: 2, minDepth: TERRAIN.zone3Depth, maxDepth: Math.min(maxWorldDepth, 135) },
  ];

  const zoneRooms: LabRoom[][] = [[], [], []];

  for (const band of bands) {
    const bandThickness = band.maxDepth - band.minDepth + 1;
    // A room must be at least 10 cells across and fit inside its zone.
    if (bandThickness < 10) continue;

    // Limit room size so it fits inside the zone's depth band (leaving room for walls when possible).
    const maxRoomSize = Math.min(30, Math.max(10, bandThickness - 4));
    const roomRadiusHalf = Math.floor(world.roomSize / 2);
    const innerDist = roomRadiusHalf + band.minDepth;

    // Target number of rooms scales with zone perimeter.
    const targetRooms = band.zone === 0 ? 12 : band.zone === 1 ? 14 : 18;
    const attempts = targetRooms * 18;

    for (let a = 0; a < attempts && zoneRooms[band.zone].length < targetRooms; a++) {
      let size = rng.int(maxRoomSize - 10 + 1) + 10; // 10..maxRoomSize
      const wallThickness = rng.int(3) + 1; // 1..3
      // Margin inside the zone band so the room interior stays strictly inside [innerDist, outerDist].
      const slack = Math.max(0, bandThickness - size);
      const radialOffset = slack > 0 ? rng.int(slack + 1) : 0;
      const slabDist = innerDist + radialOffset; // distance from center to inner edge of room

      // Pick one of the 4 sides (0=North, 1=East, 2=South, 3=West) of the square ring.
      const side = (a + rng.int(4)) % 4;
      let rx = 0;
      let ry = 0;

      // Tangential range along the ring so every cell of the room has Chebyshev distance in [innerDist, outerDist].
      // For a room on the North/South slab at distance [slabDist, slabDist + size - 1] from centerY,
      // any x in [centerX - (slabDist + size - 1), centerX + (slabDist + size - 1) - size + 1] keeps
      // max(|x - centerX|, |y - centerY|) <= slabDist + size - 1 <= outerDist.
      // To also ensure max(|x - centerX|, |y - centerY|) >= innerDist, |y - centerY| is already >= slabDist >= innerDist!
      // Reaches past the slab so the lattice's corner slots can be picked too;
      // roomFitsInZone below still rejects anything that leaves the zone.
      const maxTangentialReach = slabDist + size;
      const tMin = -maxTangentialReach;
      const tMax = maxTangentialReach - size;
      const tPos = tMax >= tMin ? tMin + rng.int(tMax - tMin + 1) : -Math.floor(size / 2);

      if (side === 0) {
        // North
        ry = world.centerY - slabDist - size + 1;
        rx = world.centerX + tPos;
      } else if (side === 2) {
        // South
        ry = world.centerY + slabDist;
        rx = world.centerX + tPos;
      } else if (side === 1) {
        // East
        rx = world.centerX + slabDist;
        ry = world.centerY + tPos;
      } else {
        // West
        rx = world.centerX - slabDist - size + 1;
        ry = world.centerY + tPos;
      }

      // Snap the room's center to the lattice, shrinking it if that pushes it
      // out of its zone: narrow zones would otherwise lose most of their rooms.
      const centerX = snapToLattice(rx + Math.floor(size / 2), world.centerX);
      const centerY = snapToLattice(ry + Math.floor(size / 2), world.centerY);
      let fits = false;
      for (; size >= 10; size--) {
        rx = roomOrigin(centerX, size, world.centerX);
        ry = roomOrigin(centerY, size, world.centerY);
        if (roomFitsInZone(world, rx, ry, size, band.zone)) {
          fits = true;
          break;
        }
      }
      if (!fits) continue;
      if (overlapsExistingRoom(rx, ry, size, wallThickness, rooms)) continue;

      const room: LabRoom = {
        id: rooms.length,
        zone: band.zone,
        x: rx,
        y: ry,
        size,
        wallThickness,
      };
      rooms.push(room);
      zoneRooms[band.zone].push(room);
    }
  }

  // Sort rooms in each zone by angle around the center so adjacent rooms form a natural ring maze.
  for (const zList of zoneRooms) {
    zList.sort((a, b) => {
      const angA = Math.atan2(roomCenterY(a) - world.centerY, roomCenterX(a) - world.centerX);
      const angB = Math.atan2(roomCenterY(b) - world.centerY, roomCenterX(b) - world.centerX);
      return angA - angB;
    });
  }

  // Connect rooms within each zone in a ring + random cross-links.
  for (let z = 0 as 0 | 1 | 2; z <= 2; z = (z + 1) as 0 | 1 | 2) {
    const list = zoneRooms[z];
    if (list.length === 0) continue;
    for (let i = 0; i < list.length; i++) {
      const next = list[(i + 1) % list.length];
      if (list.length === 1) break;
      // Connect around the ring using an L-shaped orthogonal corridor that stays near the ring.
      connectPointsL(
        world,
        corridors,
        rng,
        z,
        roomCenterX(list[i]),
        roomCenterY(list[i]),
        roomCenterX(next),
        roomCenterY(next),
      );
    }
  }

  // Connect the starting room to Zone 0's maze via 2..4 cardinal exit corridors (keeps starting room & exit clear).
  if (zoneRooms[0].length > 0) {
    const exits = Math.min(zoneRooms[0].length, 2 + rng.int(3));
    const step = Math.max(1, Math.floor(zoneRooms[0].length / exits));
    for (let k = 0; k < exits; k++) {
      const target = zoneRooms[0][(k * step) % zoneRooms[0].length];
      connectPointsL(
        world,
        corridors,
        rng,
        0,
        world.centerX,
        world.centerY,
        roomCenterX(target),
        roomCenterY(target),
      );
    }
  }

  // Connect each zone's maze to the next deeper zone's maze (Zone 0 -> Zone 1, Zone 1 -> Zone 2).
  for (let z = 0 as 0 | 1; z <= 1; z = (z + 1) as 0 | 1) {
    const innerList = zoneRooms[z];
    const outerList = zoneRooms[(z + 1) as 1 | 2];
    if (innerList.length === 0 || outerList.length === 0) continue;
    const links = Math.min(outerList.length, 3 + rng.int(3));
    for (let k = 0; k < links; k++) {
      const outerRoom = outerList[Math.floor((k * outerList.length) / links)];
      // Find closest room in innerList.
      let bestInner = innerList[0];
      let bestDist = Infinity;
      for (const cand of innerList) {
        const d =
          Math.abs(roomCenterX(cand) - roomCenterX(outerRoom)) +
          Math.abs(roomCenterY(cand) - roomCenterY(outerRoom));
        if (d < bestDist) {
          bestDist = d;
          bestInner = cand;
        }
      }
      connectPointsL(
        world,
        corridors,
        rng,
        (z + 1) as 1 | 2,
        roomCenterX(bestInner),
        roomCenterY(bestInner),
        roomCenterX(outerRoom),
        roomCenterY(outerRoom),
      );
    }
  }

  return { seed, rooms, corridors };
}

function roomCenterX(r: LabRoom): number {
  return r.x + Math.floor(r.size / 2);
}

function roomCenterY(r: LabRoom): number {
  return r.y + Math.floor(r.size / 2);
}

function roomFitsInZone(world: PixelWorld, x: number, y: number, size: number, zone: 0 | 1 | 2): boolean {
  const margin = 4;
  if (x < margin || y < margin || x + size + margin > world.width || y + size + margin > world.height) {
    return false;
  }
  // Check all 4 corners and closest points to center to verify every cell of the room is in `zone`.
  const x1 = x + size - 1;
  const y1 = y + size - 1;
  // Minimum Chebyshev distance from center to a rectangle [x..x1] × [y..y1]:
  const clampedX = Math.max(x, Math.min(world.centerX, x1));
  const clampedY = Math.max(y, Math.min(world.centerY, y1));
  // Note: Chebyshev distance on the rectangle is minimized at some point, and maximized at one of the 4 corners.
  // Because Chebyshev balls are squares centered at (centerX, centerY), a rectangle lies inside the annulus
  // [dMin, dMax] iff its 4 corners have distance <= dMax AND it does not overlap the inner square of radius dMin - 1.
  const corners = [
    [x, y],
    [x1, y],
    [x, y1],
    [x1, y1],
  ];
  for (const [cx, cy] of corners) {
    if (zoneForDepth(world.depthOf(cx, cy)) !== zone) return false;
  }
  // Stay clear of the starting room, leaving space for this room's walls.
  if (world.distanceOf(clampedX, clampedY) < Math.floor(world.roomSize / 2) + START_ROOM_CLEARANCE) return false;
  // Also check the point on the rectangle closest to the center:
  if (zoneForDepth(world.depthOf(clampedX, clampedY)) !== zone) return false;
  return true;
}

function overlapsExistingRoom(
  x: number,
  y: number,
  size: number,
  wallThickness: number,
  rooms: readonly LabRoom[],
): boolean {
  const pad = wallThickness + 2;
  for (const r of rooms) {
    const rPad = Math.max(pad, r.wallThickness + 2);
    if (
      x - rPad < r.x + r.size &&
      x + size + rPad > r.x &&
      y - rPad < r.y + r.size &&
      y + size + rPad > r.y
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Connect (ax, ay) to (bx, by) using 1 or 2 axis-aligned corridor segments
 * (width 3..5 cells, wallThickness 1..3 cells) with a right-angle turn.
 * Picks the L-bend corner that stays farthest from the starting room center so
 * ring corridors don't cut through the inner zone.
 */
function connectPointsL(
  world: PixelWorld,
  corridors: LabCorridorSegment[],
  rng: Rng,
  zone: 0 | 1 | 2,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): void {
  const width = 3 + rng.int(3); // 3..5
  const wallThickness = 1 + rng.int(3); // 1..3
  const rubble = rng.next() < FACILITY.rubbleCorridorChance;
  const halfLo = Math.floor((width - 1) / 2);
  const halfHi = width - 1 - halfLo;

  // Two candidate corners for the right-angle L-turn: (bx, ay) or (ax, by).
  // Choose the corner whose minimum distance from the world center is larger,
  // unless we are connecting directly from the world center itself.
  const d1 = world.distanceOf(bx, ay);
  const d2 = world.distanceOf(ax, by);
  const horizFirst = d1 >= d2;

  if (horizFirst) {
    if (ax !== bx) {
      const x0 = Math.min(ax, bx) - halfLo;
      const x1 = Math.max(ax, bx) + halfHi;
      const y0 = ay - halfLo;
      const y1 = ay + halfHi;
      corridors.push({ zone, axis: "h", x0, y0, x1, y1, width, wallThickness, rubble });
    }
    if (ay !== by) {
      const x0 = bx - halfLo;
      const x1 = bx + halfHi;
      const y0 = Math.min(ay, by) - halfLo;
      const y1 = Math.max(ay, by) + halfHi;
      corridors.push({ zone, axis: "v", x0, y0, x1, y1, width, wallThickness, rubble });
    }
  } else {
    if (ay !== by) {
      const x0 = ax - halfLo;
      const x1 = ax + halfHi;
      const y0 = Math.min(ay, by) - halfLo;
      const y1 = Math.max(ay, by) + halfHi;
      corridors.push({ zone, axis: "v", x0, y0, x1, y1, width, wallThickness, rubble });
    }
    if (ax !== bx) {
      const x0 = Math.min(ax, bx) - halfLo;
      const x1 = Math.max(ax, bx) + halfHi;
      const y0 = by - halfLo;
      const y1 = by + halfHi;
      corridors.push({ zone, axis: "h", x0, y0, x1, y1, width, wallThickness, rubble });
    }
  }
}
