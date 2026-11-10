import { CREATURES, FACILITY } from "../config";
import { hash2, valueNoise } from "../core/math";
import { Rng } from "../core/Rng";
import { LIGHT_KIND, MAT, type PixelWorld, type RoomLight } from "./PixelWorld";
import { corridorCaveIns } from "./CaveIns";
import { ROOM_STATE, type LabCorridorSegment, type LabLayout, type LabRoom, type RoomState } from "./WorldGenerator";

/**
 * Facility set dressing painted over the lab maze: tiled floors, blast doors,
 * hazard stripes, glass specimen tanks and a few breached containment rooms.
 *
 * Most details are cosmetic and live in `world.decor`. Structural pieces are
 * the blast doors and glass specimen tanks (`world.mat`), the small blight
 * generators inside those tanks, dormant sentry spots, and a small breach in
 * some walls, which only adds routes. Blight regrowth clears a cell's detail
 * (see GrowthSystem).
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
  cleanFloor: 22,
  cleanSeam: 23,
  lightPanel: 24,
  deadPanel: 25,
  grime: 26,
  crack: 27,
  trim: 28,
  cleanWall: 29,
  cleanWallSeam: 30,
  grimeWall: 31,
  fleshWall: 32,
  missingTile: 33,
} as const;

/** Floor tile size, in cells. */
const TILE = 4;
/** Empty floor kept between a room's walls and its glass tanks. */
const TANK_MARGIN = 3;
/** Gap between two rows of tanks. */
const TANK_ROW_GAP = 3;
/** coreId is a Uint8Array, so ids stop at 255. */
const MAX_CORES = 255;
/** Longer wall openings are corridors running alongside the room, not doors. */
const MAX_DOOR_WIDTH = 6;
const BREACH_WIDTH = 5;

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

function paintCorridor(world: PixelWorld, seg: LabCorridorSegment, seed: number): void {
  // A hallway that caved in somewhere is never spotless.
  const state = seg.rubble && seg.state === ROOM_STATE.pristine ? ROOM_STATE.worn : (seg.state ?? ROOM_STATE.worn);
  const mid = seg.axis === "h" ? Math.floor((seg.y0 + seg.y1) / 2) : Math.floor((seg.x0 + seg.x1) / 2);
  for (let y = seg.y0; y <= seg.y1; y++) {
    for (let x = seg.x0; x <= seg.x1; x++) {
      const across = seg.axis === "h" ? y : x;
      const along = seg.axis === "h" ? x : y;
      const dash = across === mid && along % TILE < 2;
      if (state === ROOM_STATE.pristine) {
        setDecor(world, x, y, dash ? DECOR.guideLine : DECOR.cleanFloor);
      } else if (state === ROOM_STATE.decayed) {
        setDecor(world, x, y, decayedFloorAt(x, y, seed, dash ? DECOR.guideLine : DECOR.floor, 0));
      } else {
        setDecor(world, x, y, dash ? DECOR.guideLine : DECOR.floor);
      }
    }
  }
  // Ceiling tubes down the middle of the hall, set between the guide-line dashes;
  // none left where the ceiling came down.
  const falls = seg.rubble ? corridorCaveIns(seg, seed) : [];
  const pitch = FACILITY.panelPitch + 2;
  const a0 = seg.axis === "h" ? seg.x0 : seg.y0;
  const a1 = seg.axis === "h" ? seg.x1 : seg.y1;
  for (let a = a0 + 3; a + 1 <= a1 - 2; a += pitch) {
    const panel = seg.axis === "h"
      ? { x0: a, y0: mid, x1: a + 1, y1: mid }
      : { x0: mid, y0: a, x1: mid, y1: a + 1 };
    const px = (panel.x0 + panel.x1 + 1) / 2;
    const py = (panel.y0 + panel.y1 + 1) / 2;
    if (falls.some((f) => Math.hypot(f.x - px, f.y - py) < f.r * FACILITY.caveInScatter + 1)) continue;
    addPanel(world, panel, { cx0: seg.x0, cy0: seg.y0, cx1: seg.x1, cy1: seg.y1 }, state, hash2(a, mid, seed + 7));
  }
  if (state === ROOM_STATE.pristine) {
    world.roomLights.push({ kind: LIGHT_KIND.wash, x0: seg.x0, y0: seg.y0, x1: seg.x1, y1: seg.y1, cx0: seg.x0, cy0: seg.y0, cx1: seg.x1, cy1: seg.y1, phase: 0 });
  }
}

type Rect = { x0: number; y0: number; x1: number; y1: number };
type Clip = { cx0: number; cy0: number; cx1: number; cy1: number };

/**
 * A ceiling light panel: bright in pristine areas, mostly lit in worn ones,
 * mostly dead in decayed ones. `roll` (0..1) decides which.
 */
function addPanel(world: PixelWorld, p: Rect, clip: Clip, state: RoomState, roll: number): void {
  let kind: RoomLight["kind"] | -1;
  if (state === ROOM_STATE.pristine) kind = LIGHT_KIND.bright;
  else if (state === ROOM_STATE.worn) {
    kind = roll < FACILITY.wornDeadChance ? -1 : roll < FACILITY.wornDeadChance + FACILITY.wornFlickerChance ? LIGHT_KIND.flicker : LIGHT_KIND.dim;
  } else {
    kind = roll < FACILITY.decayedFlickerChance ? LIGHT_KIND.flicker : -1;
  }
  for (let y = p.y0; y <= p.y1; y++) {
    for (let x = p.x0; x <= p.x1; x++) setDecor(world, x, y, kind === -1 ? DECOR.deadPanel : DECOR.lightPanel);
  }
  if (kind !== -1) world.roomLights.push({ kind, ...p, ...clip, phase: (roll * 7.31) % 1 });
}

/**
 * Floor of a decayed area: blotches of grime, hairline cracks, missing tiles
 * and Blight stains creeping in. `base` is what an untouched cell shows.
 */
function decayedFloorAt(x: number, y: number, seed: number, base: number, edge: number): number {
  const stain = valueNoise(x, y, 6, seed + 211) + edge * 0.25;
  if (stain > 0.74) return DECOR.blightStain;
  // Thin crack lines along the crests of a coarse noise field.
  const c = valueNoise(x, y, 9, seed + 307);
  if (Math.abs(c - 0.5) < 0.025) return DECOR.crack;
  if (hash2(x >> 2, y >> 2, seed + 401) < 0.06) return DECOR.missingTile;
  if (valueNoise(x, y, 4, seed + 503) > 0.58) return DECOR.grime;
  return base;
}

function paintRoomFloor(world: PixelWorld, r: LabRoom, seed: number): void {
  const state = r.state ?? ROOM_STATE.worn;
  for (let y = 0; y < r.size; y++) {
    for (let x = 0; x < r.size; x++) {
      const wx = r.x + x;
      const wy = r.y + y;
      const line = wx % TILE === 0 || wy % TILE === 0;
      const edge = x === 0 || y === 0 || x === r.size - 1 || y === r.size - 1;
      let d: number;
      if (state === ROOM_STATE.pristine) d = edge ? DECOR.trim : line ? DECOR.cleanSeam : DECOR.cleanFloor;
      else if (state === ROOM_STATE.decayed) {
        const near = Math.min(x, y, r.size - 1 - x, r.size - 1 - y);
        d = decayedFloorAt(wx, wy, seed, line ? DECOR.floorLine : DECOR.floor, Math.max(0, 1 - near / 4));
      } else d = line ? DECOR.floorLine : DECOR.floor;
      setDecor(world, wx, wy, d);
    }
  }
  // A grid of ceiling panels, inset from the walls so equipment rarely hides them.
  const pitch = FACILITY.panelPitch;
  const span = r.size - 6;
  if (span < 3) return;
  const nx = Math.max(1, Math.floor((span + 2) / pitch));
  const ox = r.x + 3 + Math.floor((span - ((nx - 1) * pitch + 3)) / 2);
  const clip = { cx0: r.x, cy0: r.y, cx1: r.x + r.size - 1, cy1: r.y + r.size - 1 };
  for (let j = 0; j < nx; j++) {
    for (let i = 0; i < nx; i++) {
      const px = ox + i * pitch;
      const py = ox - r.x + r.y + j * pitch;
      addPanel(world, { x0: px, y0: py, x1: px + 2, y1: py }, clip, state, hash2(px, py, seed + 13));
    }
  }
  if (state === ROOM_STATE.pristine) world.roomLights.push({ kind: LIGHT_KIND.wash, x0: clip.cx0, y0: clip.cy0, x1: clip.cx1, y1: clip.cy1, ...clip, phase: 0 });
}

/**
 * Wall finish by condition: clean pale panels around pristine rooms, grime on
 * decayed ones, flecks of Blight around overrun ones. Worn walls stay bare.
 */
function paintRoomWalls(world: PixelWorld, r: LabRoom, seed: number): void {
  const state = r.state ?? ROOM_STATE.worn;
  if (state === ROOM_STATE.worn) return;
  const t = r.wallThickness;
  for (let y = r.y - t; y < r.y + r.size + t; y++) {
    for (let x = r.x - t; x < r.x + r.size + t; x++) {
      if (x >= r.x && x < r.x + r.size && y >= r.y && y < r.y + r.size) continue;
      if (wallAt(world, x, y) === 0) continue;
      const i = y * world.width + x;
      if (world.decor[i] === DECOR.doorLight) continue;
      let d: number;
      if (state === ROOM_STATE.pristine) d = (x + y) % 3 === 0 ? DECOR.cleanWallSeam : DECOR.cleanWall;
      else if (state === ROOM_STATE.decayed) d = valueNoise(x, y, 3, seed + 601) > 0.45 ? DECOR.grimeWall : DECOR.none;
      else d = valueNoise(x, y, 3, seed + 613) > 0.4 ? DECOR.fleshWall : DECOR.grimeWall;
      if (d !== DECOR.none) world.decor[i] = d;
    }
  }
}

/** Decay score of a spot: near Blight, deep zones and bad luck all wear a place down. */
function decayAt(x: number, y: number, zone: number, cores: { x: number; y: number }[], seed: number): number {
  let best = Infinity;
  for (const c of cores) best = Math.min(best, Math.hypot(c.x - x, c.y - y));
  const reach = FACILITY.decayReachCells;
  const near = Math.max(0, Math.min(1, 1 - (best - FACILITY.decayCoreCells) / reach));
  const noise = valueNoise(x, y, 28, seed + 919) - 0.5;
  return near * 0.75 + zone * FACILITY.decayPerZone + noise * FACILITY.decayNoise;
}

function stateFor(decay: number): RoomState {
  return decay < FACILITY.pristineBelow ? ROOM_STATE.pristine : decay < FACILITY.decayedAbove ? ROOM_STATE.worn : ROOM_STATE.decayed;
}

/**
 * A row (or two) of 3×3 glass specimen tanks, each holding a small dormant
 * blight generator. Tanks either share their glass walls, so one break shatters
 * the whole row, or stand a cell apart.
 */
function placeTanks(world: PixelWorld, r: LabRoom, rng: Rng): void {
  const shared = rng.next() < FACILITY.tankSharedWallChance;
  const stride = shared ? 2 : 4;
  const usable = r.size - TANK_MARGIN * 2;
  const nMax = shared ? Math.floor((usable - 1) / 2) : Math.floor((usable + 1) / 4);
  if (nMax < 1) return;
  const n = Math.max(1, Math.min(4, nMax) - rng.int(2));
  const width = shared ? n * 2 + 1 : n * 4 - 1;
  const rows = usable >= 3 * 2 + TANK_ROW_GAP ? 1 + rng.int(2) : 1;
  const height = rows * 3 + (rows - 1) * TANK_ROW_GAP;
  const ox = r.x + Math.floor((r.size - width) / 2);
  const oy = r.y + Math.floor((r.size - height) / 2);
  for (let row = 0; row < rows; row++) {
    const ty = oy + row * (3 + TANK_ROW_GAP);
    // A whole row holds one kind, so a chain-shatter releases one kind of trouble.
    const specimens = rng.next() < CREATURES.specimenRowChance;
    for (let k = 0; k < n; k++) {
      const tx = ox + k * stride;
      for (let y = 0; y < 3; y++) {
        for (let x = 0; x < 3; x++) {
          if (x === 1 && y === 1) continue;
          const cx = tx + x;
          const cy = ty + y;
          if (!world.inBounds(cx, cy)) continue;
          const i = cy * world.width + cx;
          world.mat[i] = MAT.glass;
          world.decor[i] = DECOR.glass;
        }
      }
      if (specimens) {
        const i = (ty + 1) * world.width + tx + 1;
        world.decor[i] = DECOR.fluid;
        world.specimenSpots.push({ cx: tx + 1, cy: ty + 1, zone: r.zone });
      } else {
        placeSmallGenerator(world, r, tx + 1, ty + 1);
      }
    }
  }
}

/** A 1×1 blight generator: a lab experiment that idles until its glass breaks. */
function placeSmallGenerator(world: PixelWorld, r: LabRoom, cx: number, cy: number): void {
  if (!world.inBounds(cx, cy) || world.blightCores.length >= MAX_CORES) return;
  const idx = cy * world.width + cx;
  const cid = world.blightCores.length + 1;
  world.wall[idx] = 0;
  world.mat[idx] = MAT.none;
  world.coreId[idx] = cid;
  world.blight[idx] = 1;
  world.decor[idx] = DECOR.blightCoreHeart;
  world.blightCores.push({ id: cid, roomId: r.id, zone: r.zone, cx, cy, cells: [idx], alive: true, size: 1 });
}

/** A dormant sentry turret tucked into one corner of the room. */
function placeSentry(world: PixelWorld, r: LabRoom, rng: Rng): void {
  const corner = rng.int(4);
  const cx = corner % 2 === 0 ? r.x + 1 : r.x + r.size - 2;
  const cy = corner < 2 ? r.y + 1 : r.y + r.size - 2;
  const cs = world.cellSize;
  world.sentrySpots.push({
    x: (cx + 0.5) * cs,
    y: (cy + 0.5) * cs,
    zone: r.zone,
    rx0: r.x,
    ry0: r.y,
    rx1: r.x + r.size - 1,
    ry1: r.y + r.size - 1,
  });
}

/** Two-cell-thick blast doors, jamb lights and hazard stripes at every corridor opening. */
function paintDoors(world: PixelWorld, r: LabRoom, interior: Uint8Array): void {
  const tier = world.tierBase + r.zone + 1;
  for (const cell of roomSides(r)) {
    let along = 0;
    while (along < r.size) {
      const start = cell(along, 0);
      // Inside another square of the same freeform room is not a doorway.
      const open = (p: { x: number; y: number }): boolean => wallAt(world, p.x, p.y) === 0 && !(world.inBounds(p.x, p.y) && interior[p.y * world.width + p.x]);
      if (!open(start)) {
        along++;
        continue;
      }
      const from = along;
      while (along < r.size) {
        if (!open(cell(along, 0))) break;
        along++;
      }
      const to = along - 1;
      if (to - from + 1 > MAX_DOOR_WIDTH) continue;

      const mid = Math.floor((from + to) / 2);
      const cells: number[] = [];
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (let a = from; a <= to; a++) {
        const inside = cell(a, -1);
        const stripe = (inside.x + inside.y) % 4 < 2 ? DECOR.hazardYellow : DECOR.hazardBlack;
        setDecor(world, inside.x, inside.y, stripe);
        for (let out = 0; out < 2; out++) {
          const p = cell(a, out);
          if (!world.inBounds(p.x, p.y) || wallAt(world, p.x, p.y) !== 0) continue;
          const i = p.y * world.width + p.x;
          if (world.mat[i] !== MAT.none || world.coreId[i] > 0) continue;
          world.mat[i] = MAT.door;
          setDecor(world, p.x, p.y, a === mid ? DECOR.doorSeam : DECOR.door);
          cells.push(i);
          x0 = Math.min(x0, p.x);
          y0 = Math.min(y0, p.y);
          x1 = Math.max(x1, p.x);
          y1 = Math.max(y1, p.y);
        }
      }
      if (cells.length > 0) {
        const id = world.doors.length + 1;
        for (const i of cells) world.doorId[i] = id;
        world.doors.push({ id, tier, cells, open: false, x0, y0, x1, y1 });
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
function overrunRoomWithBlight(world: PixelWorld, r: LabRoom, seed: number, core = true): void {
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
    }
  }

  // The rest of a freeform overrun room: Blight floor, no second core.
  if (!core) return;
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
      world.blight[idx] = 1;
      world.decor[idx] = dx === dy ? DECOR.blightCoreHeart : DECOR.blightCoreShell;
      cells.push(idx);
    }
  }
  r.overrun = true;
  r.coreId = cid;
  world.roomLights.push({
    kind: LIGHT_KIND.blight,
    x0: r.x, y0: r.y, x1: r.x + r.size - 1, y1: r.y + r.size - 1,
    cx0: r.x, cy0: r.y, cx1: r.x + r.size - 1, cy1: r.y + r.size - 1,
    phase: hash2(r.x, r.y, seed),
    coreId: cid,
  });
  world.blightCores.push({
    id: cid,
    roomId: r.id,
    zone: r.zone,
    cx: rcx,
    cy: rcy,
    cells,
    alive: true,
    size: 2,
  });
}

/** Dress a generated maze. Call before cell health is computed from `wall`. */
export function decorateLab(world: PixelWorld, layout: LabLayout): void {
  const seed = layout.seed;
  const rng = new Rng((seed ^ 0x2f6e2b1d) >>> 0 || 1);
  world.coreId.fill(0);
  world.blightCores = [];
  world.doors = [];
  world.sentrySpots = [];
  world.specimenSpots = [];
  world.roomLights = [];

  // Pick rooms in each zone to be overrun with dark pink blight and host a Blight Core
  // (~30% of rooms, and at least 1 room per zone that has rooms).
  const byZone: LabRoom[][] = [[], [], []];
  for (const room of layout.rooms) byZone[room.zone].push(room);
  const overrunIds = new Set<number>();
  // The hand-made lab says exactly which rooms are overrun.
  if (layout.frame) for (const r of layout.rooms) if (r.kind === "overrun" || r.kind === "blighted") overrunIds.add(r.id);
  // In a world the Blight has remade, nothing is clean any more.
  const rot = layout.frame?.def.alien ? FACILITY.alienDecay : 0;
  for (const zRooms of layout.frame ? [] : byZone) {
    if (zRooms.length === 0) continue;
    const count = Math.max(1, Math.round(zRooms.length * 0.3));
    const startIdx = rng.int(zRooms.length);
    const step = Math.max(1, Math.floor(zRooms.length / count));
    for (let k = 0; k < count; k++) {
      const r = zRooms[(startIdx + k * step) % zRooms.length];
      overrunIds.add(r.id);
    }
  }

  // Condition: rooms near an overrun room have decayed; far from the Blight the
  // facility still looks freshly built.
  const cores = layout.rooms.filter((r) => overrunIds.has(r.id)).map((r) => ({ x: r.x + r.size / 2, y: r.y + r.size / 2 }));
  for (const room of layout.rooms) {
    room.state = overrunIds.has(room.id)
      ? ROOM_STATE.overrun
      : stateFor(decayAt(room.x + room.size / 2, room.y + room.size / 2, room.zone, cores, seed) + rot);
  }
  for (const seg of layout.corridors) {
    seg.state = seg.gate ? ROOM_STATE.worn : stateFor(decayAt((seg.x0 + seg.x1) / 2, (seg.y0 + seg.y1) / 2, seg.zone, cores, seed) + rot);
    paintCorridor(world, seg, seed);
  }

  for (const room of layout.rooms) {
    if (overrunIds.has(room.id)) {
      overrunRoomWithBlight(world, room, seed, room.kind !== "blighted");
      if (room.kind !== "blighted") room.overrun = true;
    } else {
      paintRoomFloor(world, room, seed);
      const tanks = layout.frame ? room.kind === "tanks" : rng.next() < FACILITY.tankRoomChance;
      if (tanks) placeTanks(world, room, rng);
    }
    if (rng.next() < FACILITY.sentryRoomChance) placeSentry(world, room, rng);
  }
  // Worse finishes go on last, so a wall shared with a ruined room shows the damage.
  for (const state of [ROOM_STATE.pristine, ROOM_STATE.decayed, ROOM_STATE.overrun]) {
    for (const room of layout.rooms) if (room.state === state) paintRoomWalls(world, room, seed);
  }
  const interior = new Uint8Array(world.width * world.height);
  for (const r of layout.rooms) {
    for (let y = Math.max(0, r.y); y < Math.min(world.height, r.y + r.size); y++) {
      for (let x = Math.max(0, r.x); x < Math.min(world.width, r.x + r.size); x++) interior[y * world.width + x] = 1;
    }
  }
  for (const room of layout.rooms) paintDoors(world, room, interior);
  for (const room of layout.rooms) {
    const chance =
      room.state === ROOM_STATE.overrun ? 1
      : room.state === ROOM_STATE.decayed ? FACILITY.decayedBreachChance
      : room.state === ROOM_STATE.worn ? FACILITY.wornBreachChance
      : 0;
    if (rng.next() < chance) breachRoom(world, room, rng, seed);
  }
  // The starting room stays bare.
  for (let y = world.roomY0; y <= world.roomY1; y++) {
    for (let x = world.roomX0; x <= world.roomX1; x++) setDecor(world, x, y, DECOR.none);
  }
}

/** Keep at least one working, shootable ceiling fixture in rooms with open floor. */
export function ensureRoomFixtures(world: PixelWorld, layout: LabLayout): void {
  for (const room of layout.rooms) {
    const existing = world.roomLights.some((l) => l.kind !== LIGHT_KIND.wash && l.kind !== LIGHT_KIND.blight
      && l.x0 >= room.x && l.y0 >= room.y && l.x1 < room.x + room.size && l.y1 < room.y + room.size
      && world.decor[l.y0 * world.width + l.x0] === DECOR.lightPanel && !world.solidAt(l.x0, l.y0));
    if (existing) continue;
    let placed = false;
    for (let y = room.y + 1; y < room.y + room.size - 1 && !placed; y++) {
      for (let x = room.x + 1; x < room.x + room.size - 1; x++) {
        if (!world.inBounds(x, y) || world.solidAt(x, y)) continue;
        if (x >= world.roomX0 && x <= world.roomX1 && y >= world.roomY0 && y <= world.roomY1) continue;
        const i = y * world.width + x;
        if (world.mat[i] !== MAT.none || world.decor[i] === DECOR.none || world.decor[i] === DECOR.deadPanel) continue;
        // Don't hide a ceiling tube behind half-size consoles or rubble.
        let blocked = false;
        for (let sy = y * 2; sy <= y * 2 + 1; sy++) for (let sx = x * 2; sx <= x * 2 + 1; sx++) {
          if (world.subSolidAt(sx, sy)) blocked = true;
        }
        if (blocked) continue;
        setDecor(world, x, y, DECOR.lightPanel);
        const kind = room.state === ROOM_STATE.decayed || room.state === ROOM_STATE.overrun ? LIGHT_KIND.flicker : LIGHT_KIND.dim;
        world.roomLights.push({ kind, x0: x, y0: y, x1: x, y1: y,
          cx0: room.x, cy0: room.y, cx1: room.x + room.size - 1, cy1: room.y + room.size - 1,
          phase: hash2(x, y, layout.seed) });
        placed = true; break;
      }
    }
  }
}
