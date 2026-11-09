import { FACILITY } from "../config";
import { hash2 } from "../core/math";
import type { LabCorridorSegment, LabLayout, LabRoom } from "./WorldGenerator";

/**
 * The hand-made research lab: fixed blueprints shared by every run, one per
 * world (zone). Zone 1 is the lab itself; a huge tier 3 gate on its east side
 * leads into zone 2, where the Blight has begun turning the lab into something
 * alien; a gate on zone 2's east side leads into zone 3 (not built yet).
 *
 * Each world is a grid of sectors, named like a chess board: columns A.. left
 * to right, rows 1.. top to bottom. Each sector is drawn below as SECTOR_CHARS
 * × SECTOR_CHARS characters, and each character covers CHAR_CELLS × CHAR_CELLS
 * cells of the world. Edit the pictures to change the lab.
 *
 * Legend:
 *   .  solid rock / fill
 *   R  room              (zone 1: a filled square block of 2×2 .. 5×5 characters;
 *                         alien worlds: any shape at least 2 characters thick)
 *   G  overrun room      (same, swallowed by Blight around a Blight Core)
 *   T  specimen room     (same, with glass tanks holding small generators)
 *   -  hallway running east-west
 *   |  hallway running north-south
 *   +  hallway junction (joins every neighbor)
 *
 * Rooms must not touch each other orthogonally, or they would read as one
 * room. A hallway joins a room it points into. Difficulty rises with distance
 * from the world's starting sector (see `sectorZone`).
 */
export const LAB_BLUEPRINT: readonly string[] = [
  "...............................................................",  // 1
  ".RRR....+-+-+..RRR.......GG...GG....+-+-+..+-+-+....+TT....GG..",
  ".RRR....|...|..RRR.......GG...GG....|...|..|...|....|TT....GG..",
  ".RRR----+...+--RRR-+....++-----+----+...+..+...+--GGG------+...",
  "...|TT..|...|....|TT....|TT....RR...|...|..|...|..GGG.....TT...",
  "...+TT..+-+-+....|TT....|TT....RR...+-+-+..+-+-+..GGG.....TT...",
  "...|.............|......|.............|......|.............|...",
  "...|.............|......|.............|......|.............|...",  // 2
  "...|RR....+RR..RR+......|RR...TTTT....+RR..RRR....+-+-+..GGG...",
  "...|RR....|RR..RR|......|RR...TTTT....|RR..RRR....|...|..GGG...",
  ".GGG-+----+......GGG--+-+-+...TTTT--GGG----RRR....+...+--GGG...",
  ".GGG....TT|......GGG..RR......TTTT..GGG......|RR..|...|....|RR.",
  ".GGG....TT+......GGG..RR............GGG......+RR..+-+-+....+RR.",
  "...|......|......|....................|.............|......|...",
  "...|......|......|....................|.............|......|...",  // 3
  "..RR......|......|....GG........RR....+TT...........|......|...",
  "..RR....GGGG.....|....GG........RR....|TT...GGGG....|RR..TTTT..",
  "...+....GGGG-----+-----++----GGG-+..GGG-----GGGG--RR+RR..TTTT..",
  "...TT...GGGG.....|....RR.....GGG....GGG.....GGGG..RR.....TTTT..",
  "...TT...GGGG.....|....RR.....GGG....GGG.....GGGG.........TTTT..",
  "...|.............|.............|......|....................|...",
  "...|.............|.............|......|....................|...",  // 4
  ".GG+....RR+......|....RR.......|RR....|......+GG..GG.......|...",
  ".GG|....RR|....GGGG...RR.......|RR..RR|......|GG..GG.......|...",
  "...+------+....GGGG...+-+-+--+-+-+--RR+TT----+.....++------+...",
  "...|RR....|RR..GGGG.....|TT..RR.......|TT..RR|....TT|......|...",
  "...+RR....+RR..GGGG.....|TT..RR.......|....RR+....TT|......|...",
  "..........|......|......|.............|.............|......|...",
  "..........|......|......|.............|.............|......|...",  // 5
  ".RRR......|......+TT..RRR...........RR+.............|.....GGGG.",
  ".RRR....GGGG.....|TT..RRR.....RRR...RR|.............|.....GGGG.",
  ".RRR-+--GGGG---RRR----RRR-+---RRR-----RRR----+------+-----GGGG-",
  "...|TT..GGGG...RRR......|RR...RRR.....RRR....|............GGGG.",
  "...|TT..GGGG...RRR......|RR...........RRR....|.............|...",
  "...|.............|......|.............|......|.............|...",
  "...|.............|......|.............|......|.............|...",  // 6
  "...|GG..GGGG...RRR......|.............GG....RR....RR.RR....|...",
  "...|GG..GGGG...RRR....RR|.......RR....GG....RR....RR+RR....|...",
  ".+-+-+--GGGG...RRR....RR+TT--RR+RR....+......+......+------+...",
  ".RR|....GGGG.....|RR.....TT..RR|.....RR......TT.....|..........",
  ".RR|......|......+RR...........|.....RR......TT.....|..........",
  "...|......|......|.............|......|......|......|..........",
  "...|......|......|.............|......|......|......|..........",  // 7
  "...|......|....+-+-+..+-+-+....|......|RR..TT+......+RR........",
  "...|....TTTT...|...|..|...|....|......|RR..TT|......|RR..RR....",
  "...+....TTTT---+...+--+...+....+----RRR-+----GGG--GGG----RR+TT.",
  "...|....TTTT...|...|..|...|....|....RRR......GGG..GGG......|TT.",
  "...|....TTTT...+-+-+..+-+-+....|....RRR......GGG..GGG......|...",
  "...|.............|.............|.............|......|......|...",
  "...|.............|.............|.............|......|......|...",  // 8
  "...|....RR.....GG|....+-+-+....|...........RRR....GG|....+-+-+.",
  "...|....RR.....GG|....|...|....|.....GGGG..RRR....GG|....|...|.",
  "...+-----++.....++----+...+----+.....GGGG..RRR-+..+-+-+..+...+.",
  "...|....RR|....TT|....|...|....|.....GGGG....|TT....|RR..|...|.",
  "...|....RR|....TT|....+-+-+....|.....GGGG....|TT....|RR..+-+-+.",
  "...|......|......|.............|......|......|......|......|...",
  "...|......|......|.............|......|......|......|......|...",  // 9
  ".GG|TT..+-+-+....|....GG.....TT|......|......|......|....+-+-+.",
  ".GG+TT..|...|..RR|....GG.....TT|......|......|....GG|....|...|.",
  "...+----+...+--RR+TT---++....+-GGG----+......+----GG+TT--+...+.",
  "........|...|.....TT..RR.......GGG...................TT..|...|.",
  "........+-+-+.........RR.......GGG.......................+-+-+.",
  "...............................................................",
];

/**
 * Zone 2: the lab after the Blight began to remake it. Rooms here are odd,
 * lumpy shapes (any shape at least two characters thick), most walls are
 * crusted with Blight, and Blight flower turrets are common. The squad enters
 * from the gate in the middle of the west side (A6); the gate to zone 3 is in
 * the middle of the east side (K6).
 */
export const ZONE2_BLUEPRINT: readonly string[] = [
  ".............................................................................",  // 1
  "....TT..TT............RR.RR.........GG............RRRR...GG.......GG....GGG..",
  "....TT..TTT...........RR.RR.........GG......RRR...RRRR...GGG.....GGGG..GGGGG.",
  ".TTTTT---TTT-----+----RRRRR----+----GGGGG---RRR-----RR----GGGG--GGGGG--GGGGG.",
  ".TTTTT....TTT....|....RRRRR....|....GGGGG...RRR.....RR.....GGG..GGGG...GGGGG.",
  "...|.......TT....|.............|......|......|......RR.....|.....GG.....GGG..",
  "...|.............|.............|......|......|......|......|.............|...",
  "...|.............|.............|......|......|......|......|.............|...",  // 2
  "...|.............|....GGGG....TTT....RRRR..RRRR.....|.....RR.......GG....|GG.",
  ".GGGGG...RRRR..GGGGG..GGGGG..TTTTT...RRRR..RRRR...RRRRR..RRRR.....GGG...GGGG.",
  ".GGGGG---RRRR--GGGGG-----GG--TT+TT---RR....RRRR...RRRRR..RRRRR---GGG....GGGG.",
  ".GG|GG...RRRR.....GG..GGGGG..TT|TT...RRRR..RRRR...RR|.....RRRR..GGG......|GG.",
  ".GG|GG...RRRR.....GG..GGGG...TT|TT...RRRR....|....RR|......RR...GG|......|GG.",
  "...|......|....................|.............|......|.............|......|...",
  "...|......|....................|.............|......|.............|......|...",  // 3
  "..RRRR...RRRR...RRRR...GGG....RR.....RR.....RRR.....|....RR.......|......|RR.",
  "..RRRR...RRRR...RRRR..GGGGG...RR....RRRR...RRRRR...RRR...RRR....RRRRR....|RR.",
  "..RR-----RRRR...RRRR--GGGGG---RR....RRRRR--RR+RR...RRR----RRRR--RRRRR--RRRRR.",
  "..RRRR...RRRR...RRRR..GGGGG...RRRR...RRRR..RR|RR...RRR.....RRR..RR|RR..RRRRR.",
  "..RRRR...........|.....GGG....RRRR....RR...RR|RR....|......|....RR|RR....|...",
  "...|.............|......|......|.............|......|......|......|......|...",
  "...|.............|......|......|.............|......|......|......|......|...",  // 4
  "..RR...........RR|......|....RR|....GG.GG..RR|......|....GG|......|.....TT...",
  "..RR.....RRR...RRRR....RRR...RRR....GG.GG..RRR......|....GG|......|....TTTT..",
  "..RR.....RRR---RRRR....RRR----RRR...GGGGG---RRR.....|....GGGGG----+....TTTTT.",
  "..RRRR...RRR...RR|.....RRR.....RR...GGGGG....RR.....|....GGGGG..........TTTT.",
  "..RRRR....|....RR|......|......RR.....|......RR.....|......|.............TT..",
  "...|......|......|......|......|......|.............|......|.............|...",
  "...|......|......|......|......|......|.............|......|.............|...",  // 5
  ".GG|......|.....RRR.....|....TTTTT...GG.............|....GG|......GG.....|...",
  ".GGG.....GGG...RRRRR....|....TTTTT...GG....RRRR.....|....GGG.....GGGG...RRR..",
  "..GGGG---GGG...RRRRR----+-----TT-----GGG---RRRR-----+-----GGG...GGGGG---RRR..",
  "...GGG...GGG...RRRRR..........TT......GGG..RRRR.....|......GGG..GGGG....RRR..",
  "...|............RRR............|......|GG..RRRR.....|......|GG...GG......|...",
  "...|.............|.............|......|......|......|......|......|......|...",
  "...|.............|.............|......|......|......|......|......|......|...",  // 6
  "...|.............|RR....GG.....|....GGGGG....|......|......RR....TTT....GGG..",
  "..RRR............RRR...GGGG...GGGG..GGGGG..RRRRR....|......RR...TTTTT..GGGGG.",
  "--RRR.....|.....RRR---GGGGG...GGGG....GG---RRRRR....+------RR---TTTTT..GGGGG-",
  "..RRR.....|....RRR....GGGG....GGGG....GG......RR....|....RRRR...TTTTT..GGGGG.",
  "...|......|....RR......GG.....GGGG....|.......RR....|....RRRR....TTT....GGG..",
  "...|......|.............|......|......|.............|......|.............|...",
  "...|......|.............|......|......|.............|......|.............|...",  // 7
  "...|......|RR..GGGG.....|......|GG...RRR...GGGG...TTTT.....|.......RR....|...",
  ".RRRRR....RRR..GGGGG..RRR.....GGGG..RRRRR..GGGG...TTTTT..RRRRR.....RR...RRR..",
  ".RRRRR---RRR------GG..RRRR----GGGG--RRRRR--GGGG.....+TT--RRRRR...RRRR...RRR..",
  "...|RR...RR....GGGGG....RRR....|GG..RRRRR..GGGG...TTTTT..RR|RR...RRRR...RRR..",
  "...|RR...RR....GGGG.....|RR....|GG...RRR.....|....TTTT...RR|RR....|RR....|...",
  "...|....................|......|......|......|.............|......|......|...",
  "...|....................|......|......|......|.............|......|......|...",  // 8
  "..RRRR...RRRR...RRR....RRR.....|RR...RRRR..RRRR....TTTT...TTTT....|......GG..",
  "..RRRR...RRRR..RRRRR..RRRRR....RRR...RRRR..RRRR....TTTT...TTTT...GGG....GGGG.",
  "..RRRR---RR----RRRRR--RR+RR..RRRR....RR----RRRR----TTTT---TT.....GGG...GGGGG.",
  "..RRRR...RRRR..RRRRR..RR.RR..RRR.....RR....RRRR....TTTT...TTTT...GGG...GGGG..",
  "...|.....RRRR...RRR...RR.RR..........RR......|......|.....TTTT....|.....GG...",
  "...|......|...........................|......|......|.............|......|...",
  "...|......|...........................|......|......|.............|......|...",  // 9
  "...GG...GG|GG..TT.....RRRRR..RR.....RRRR.....|RR..RRRR.....GG...GG|.....GG...",
  "..GGGG..GG|GG..TTT....RRRRR..RRRR...RRRRR...RRRR..RRRR.....GG...GGGG....GG...",
  ".GGGGG..GG+GG---TTT----RR----RRRR-----+RR---RRRR----RR.....GG---GGGG....GGG..",
  ".GGGG...GGGGG....TT....RR....RR|....RRRRR.....RR..RRRR...GGGG...GG.......GGG.",
  "..GG.....GGG.....TT..........RR|....RRRR......RR..RRRR...GGGG...GG.......|GG.",
  "...|...........................|....................|......|.............|...",
  "...|...........................|....................|......|.............|...",  // 10
  "..GG.......GG...RR....RR......RRR...RRRRR..TTTT.....|....RR|.....RR.....RR...",
  "..GG......GGG..RRRR...RRR....RRRRR..RRRRR..TTTT...RRRRR..RRR.....RR....RRRR..",
  "..GG-----GGG---RRRRR---RRRR--RRRRR----RR---TTTT---RRRRR...RRR----RR....RRRRR.",
  "..GGGG..GGG.....RRRR....RRR..RRRRR....RR...TTTT...RR.RR....RRR...RRRR...RRRR.",
  "..GGGG..GG|......RR...........RRR.................RR.RR....|RR...RRRR....RR..",
  "...|......|................................................|......|......|...",
  "...|......|................................................|......|......|...",  // 11
  ".RRRR....TT.....RR....RR.RR..........TTTT...RR.....GGGG....|.....GGGG....|...",
  ".RRRR...TTTT....RR....RR.RR.........TTTTT..RRRR...GGGGG...RRRR...GGGG....TT..",
  ".RRRR---TTTTT---RR----RRRRR---------TT-----RRRRR--GG------RRRR...GG------TT..",
  ".RRRR....TTTT...RRRR..RRRRR.........TTTTT...RRRR..GGGGG...RRRR...GGGG..TTTTT.",
  "..........TT....RRRR.................TTTT....RR....GGGG...RRRR...GGGG..TTTTT.",
  ".............................................................................",
];

/**
 * Zone 3: 13 × 13 sectors, entered from the middle of the west side. Not
 * designed yet: only the arrival room exists.
 */
export const ZONE3_BLUEPRINT: readonly string[] = emptyBlueprint(13, 6);

/** A blank blueprint with just an arrival room behind a west-side entry on sector row `row`. */
function emptyBlueprint(sectors: number, row: number): string[] {
  const chars = 7; // SECTOR_CHARS, which is declared below this call
  const n = sectors * chars;
  const lines = Array.from({ length: n }, () => ".".repeat(n));
  const mid = row * chars + 3;
  const put = (c: number, r: number, ch: string): void => {
    lines[r] = lines[r].slice(0, c) + ch + lines[r].slice(c + 1);
  };
  put(0, mid, "-");
  put(1, mid, "-");
  for (let r = mid - 1; r <= mid + 1; r++) for (let c = 2; c <= 4; c++) put(c, r, "R");
  return lines;
}

export const SECTOR_CHARS = 7;
export const CHAR_CELLS = 7;
/** Edge length of one sector, in cells. */
export const SECTOR_CELLS = SECTOR_CHARS * CHAR_CELLS;
/** Seed for everything about zone 1 that should look the same every run. */
export const LAB_SEED = 0x1ab5eed;

/** A world gate: a huge locked door in the middle of one side of a world's lab. */
export interface GateDef {
  /** Side of the lab the gate sits on. East gates lead onward; west gates are where the squad arrived. */
  side: "east" | "west";
  /** Sector row (0-based) whose middle character row the gate sits on. */
  row: number;
  /** Keycard tier that opens it. */
  tier: number;
  /** World the gate leads to, or 0 for a sealed arrival gate that never opens. */
  to: number;
}

/** A placeholder for a special upgrade Seth will define later. */
export interface UpgradeSpotDef {
  id: string;
  /** Blueprint character (must be part of a room). */
  col: number;
  row: number;
}

export interface LabWorldDef {
  /** 1-based world (zone) number. */
  id: number;
  name: string;
  blueprint: readonly string[];
  /** Sectors per side. */
  sectors: number;
  /** Sector the squad starts in; tiers rise with distance from it. */
  start: number;
  /** Tier of the world's first band minus one: zone 1 has tiers 1-3, zone 2 tiers 4-6. */
  tierBase: number;
  /** Sector distance (Chebyshev, from `start`) where the 2nd and 3rd tier bands begin. */
  bands: readonly [number, number];
  /** Rooms may be any shape at least two characters thick (see `parseBlueprint`). */
  freeform: boolean;
  /** Blight has remade this world: crusted walls, lumpy rooms, many flower turrets. */
  alien: boolean;
  seed: number;
  gates: readonly GateDef[];
  upgrades: readonly UpgradeSpotDef[];
}

export const LAB_WORLDS: Readonly<Record<number, LabWorldDef>> = {
  1: {
    id: 1,
    name: "RESEARCH LAB",
    blueprint: LAB_BLUEPRINT,
    sectors: 9,
    start: 0,
    tierBase: 0,
    bands: [3, 6],
    freeform: false,
    alien: false,
    seed: LAB_SEED,
    gates: [{ side: "east", row: 4, tier: 3, to: 2 }],
    upgrades: [
      { id: "z1-special-1", col: 22, row: 18 },
      { id: "z1-special-2", col: 30, row: 30 },
      { id: "z1-special-3", col: 43, row: 8 },
      { id: "z1-special-4", col: 8, row: 50 },
    ],
  },
  2: {
    id: 2,
    name: "BLIGHTED WARDS",
    blueprint: ZONE2_BLUEPRINT,
    sectors: 11,
    start: 55,
    tierBase: 3,
    bands: [4, 7],
    freeform: true,
    alien: true,
    seed: 0x2b11e7,
    gates: [
      { side: "west", row: 5, tier: 3, to: 0 },
      { side: "east", row: 5, tier: 6, to: 3 },
    ],
    upgrades: [
      { id: "z2-special-1", col: 16, row: 15 },
      { id: "z2-special-2", col: 43, row: 22 },
      { id: "z2-special-3", col: 36, row: 64 },
      { id: "z2-special-4", col: 72, row: 30 },
    ],
  },
  3: {
    id: 3,
    name: "UNCHARTED",
    blueprint: ZONE3_BLUEPRINT,
    sectors: 13,
    start: 78,
    // Placeholder until zone 3 is designed: tier 6 throughout.
    tierBase: 3,
    bands: [0, 0],
    freeform: true,
    alien: true,
    seed: 0x3c0de3,
    gates: [{ side: "west", row: 6, tier: 6, to: 0 }],
    upgrades: [],
  },
};

/** Number of lab worlds that exist. */
export const LAB_WORLD_COUNT = 3;

/** The world definition for `id`, falling back to zone 1. */
export function labWorld(id: number): LabWorldDef {
  return LAB_WORLDS[id] ?? LAB_WORLDS[1];
}

/** Cells beyond a gate's door: the passage the squad walks into to travel on. */
export const GATE_POCKET = 8;
/** Thickness of a gate's door, in cells. */
export const GATE_THICKNESS = 4;
/** Half the height of a gate's opening (cells above and below its middle row). */
export const GATE_HALF = 5;

export type RoomKind = "room" | "overrun" | "tanks" | "blighted";

/** A room as drawn in the blueprint, in character units. */
export interface BlueprintRoom {
  col: number;
  row: number;
  /** Edge length in characters. */
  span: number;
  kind: RoomKind;
  /** Freeform rooms are unions of overlapping squares; squares of one room share a group. */
  group: number;
}

/** A straight hallway run between two character centers. */
export interface BlueprintHall {
  axis: "h" | "v";
  /** Fixed coordinate (row for "h", column for "v"). */
  line: number;
  from: number;
  to: number;
}

export interface Blueprint {
  rooms: BlueprintRoom[];
  halls: BlueprintHall[];
}

const ROOM_CHARS = "RGT";

function isRoomChar(ch: string): boolean {
  return ROOM_CHARS.includes(ch);
}

/** Can `ch` join its east/west (`h`) or north/south (`v`) neighbor? */
function joins(ch: string, axis: "h" | "v"): boolean {
  if (ch === "+" || isRoomChar(ch)) return true;
  return axis === "h" ? ch === "-" : ch === "|";
}

/**
 * Parse a blueprint into rooms and straight hallway runs. Without `freeform`,
 * throws on a room that is not a filled square, so a typo in the picture
 * fails loudly. With `freeform`, a room may be any shape whose every character
 * lies in a 2×2 block of the room; it becomes the overlapping squares that
 * cover it, and only the biggest square carries the room's core or tanks.
 */
export function parseBlueprint(lines: readonly string[] = LAB_BLUEPRINT, freeform = false): Blueprint {
  const n = lines.length;
  const at = (c: number, r: number): string => (r >= 0 && r < n && c >= 0 && c < lines[r].length ? lines[r][c] : ".");
  for (const l of lines) if (l.length !== n) throw new Error(`Blueprint must be square: a row has ${l.length} chars, expected ${n}`);

  const rooms: BlueprintRoom[] = [];
  const seen = new Uint8Array(n * n);
  let group = 0;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!isRoomChar(at(c, r)) || seen[r * n + c]) continue;
      // Flood the room so a non-square block is caught.
      const stack = [[c, r]];
      const cells: number[][] = [];
      seen[r * n + c] = 1;
      let c0 = c, c1 = c, r0 = r, r1 = r;
      let kind: RoomKind = "room";
      while (stack.length) {
        const [x, y] = stack.pop()!;
        cells.push([x, y]);
        c0 = Math.min(c0, x); c1 = Math.max(c1, x); r0 = Math.min(r0, y); r1 = Math.max(r1, y);
        const ch = at(x, y);
        if (ch === "G") kind = "overrun";
        else if (ch === "T" && kind === "room") kind = "tanks";
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (isRoomChar(at(nx, ny)) && !seen[ny * n + nx]) {
            seen[ny * n + nx] = 1;
            stack.push([nx, ny]);
          }
        }
      }
      const span = c1 - c0 + 1;
      const square = span === r1 - r0 + 1 && cells.length === span * span && span >= 2;
      if (square) {
        rooms.push({ col: c0, row: r0, span, kind, group: group++ });
        continue;
      }
      if (!freeform) throw new Error(`Blueprint room at column ${c0}, row ${r0} must be a filled square of at least 2×2`);
      rooms.push(...coverWithSquares(cells, at, kind, group++));
    }
  }

  const halls: BlueprintHall[] = [];
  const link = (a: string, b: string, axis: "h" | "v"): boolean =>
    joins(a, axis) && joins(b, axis) && !(isRoomChar(a) && isRoomChar(b));
  for (let r = 0; r < n; r++) {
    let start = -1;
    for (let c = 0; c < n; c++) {
      const linked = link(at(c, r), at(c + 1, r), "h");
      if (linked && start < 0) start = c;
      if (!linked && start >= 0) {
        halls.push({ axis: "h", line: r, from: start, to: c });
        start = -1;
      }
    }
  }
  for (let c = 0; c < n; c++) {
    let start = -1;
    for (let r = 0; r < n; r++) {
      const linked = link(at(c, r), at(c, r + 1), "v");
      if (linked && start < 0) start = r;
      if (!linked && start >= 0) {
        halls.push({ axis: "v", line: c, from: start, to: r });
        start = -1;
      }
    }
  }
  return { rooms, halls };
}

/**
 * The maximal squares (2×2 or bigger) inside a freeform room that together
 * cover every character of it. The biggest square keeps the room's kind; the
 * rest of an overrun room is "blighted" (Blight floor, no second core).
 */
function coverWithSquares(cells: number[][], at: (c: number, r: number) => string, kind: RoomKind, group: number): BlueprintRoom[] {
  const inRoom = (c: number, r: number): boolean => isRoomChar(at(c, r));
  const fits = (c: number, r: number, s: number): boolean => {
    for (let y = r; y < r + s; y++) for (let x = c; x < c + s; x++) if (!inRoom(x, y)) return false;
    return true;
  };
  const squares: { col: number; row: number; span: number }[] = [];
  for (const [c, r] of cells) {
    let s = 2;
    if (!fits(c, r, 2)) continue;
    while (fits(c, r, s + 1)) s++;
    squares.push({ col: c, row: r, span: s });
  }
  // Drop squares inside a bigger one.
  const inside = (a: { col: number; row: number; span: number }, b: { col: number; row: number; span: number }): boolean =>
    a !== b && a.col >= b.col && a.row >= b.row && a.col + a.span <= b.col + b.span && a.row + a.span <= b.row + b.span;
  const keep = squares.filter((a) => !squares.some((b) => inside(a, b) && !(b.span === a.span && b.col === a.col && b.row === a.row)));
  for (const [c, r] of cells) {
    if (!keep.some((q) => c >= q.col && c < q.col + q.span && r >= q.row && r < q.row + q.span)) {
      throw new Error(`Freeform room character at column ${c}, row ${r} must lie in a 2×2 block of the room`);
    }
  }
  keep.sort((a, b) => b.span - a.span || a.row - b.row || a.col - b.col);
  return keep.map((q, k) => ({
    ...q,
    kind: k === 0 ? kind : kind === "overrun" ? "blighted" : "room",
    group,
  }));
}

/** Sector distance (Chebyshev) of sector `index` from the world's starting sector. */
export function sectorDistance(def: LabWorldDef, index: number): number {
  const n = def.sectors;
  const col = index % n;
  const row = (index - col) / n;
  const sc = def.start % n;
  const sr = (def.start - sc) / n;
  return Math.max(Math.abs(col - sc), Math.abs(row - sr));
}

/** Tier band (0..2) of a sector: rises with distance from the starting sector. */
export function sectorZone(def: LabWorldDef, index: number): 0 | 1 | 2 {
  const d = sectorDistance(def, index);
  return d < def.bands[0] ? 0 : d < def.bands[1] ? 1 : 2;
}

/** Terrain tier (1..6) of a sector's ordinary blocks. */
export function sectorTier(def: LabWorldDef, index: number): number {
  return def.tierBase + sectorZone(def, index) + 1;
}

/** Map label of sector `index`, like "E5". */
export function sectorName(index: number, sectors = 9): string {
  const col = index % sectors;
  const row = (index - col) / sectors;
  return `${String.fromCharCode(65 + col)}${row + 1}`;
}

/** Placement of a world's blueprint inside the game world: centered on the world's middle cell. */
export interface LabFrame {
  /** World cell of the blueprint's top-left corner. */
  x0: number;
  y0: number;
  /** Which lab world this is. */
  def: LabWorldDef;
}

/** Edge length of a world's blueprint, in cells. */
export function labCells(def: LabWorldDef): number {
  return def.sectors * SECTOR_CELLS;
}

/**
 * Where the blueprint sits in a world of this size, or null if the world is
 * too small to hold it and its gates (small test worlds keep the procedural maze).
 */
export function labFrame(world: { width: number; height: number; centerX: number; centerY: number }, def: LabWorldDef = LAB_WORLDS[1]): LabFrame | null {
  const cells = labCells(def);
  const half = (cells - 1) / 2;
  const x0 = Math.round(world.centerX - half);
  const y0 = Math.round(world.centerY - half);
  const margin = def.gates.length > 0 ? GATE_THICKNESS + GATE_POCKET + 4 : 4;
  if (x0 < margin || y0 < 4 || x0 + cells + margin > world.width || y0 + cells + 4 > world.height) return null;
  return { x0, y0, def };
}

/** Sector index of a world cell, or -1 outside the lab. */
export function sectorAtCell(frame: LabFrame, cx: number, cy: number): number {
  const n = frame.def.sectors;
  const cells = n * SECTOR_CELLS;
  const lx = cx - frame.x0;
  const ly = cy - frame.y0;
  if (lx < 0 || ly < 0 || lx >= cells || ly >= cells) return -1;
  return Math.floor(ly / SECTOR_CELLS) * n + Math.floor(lx / SECTOR_CELLS);
}

/** Sector index of a world cell, clamped onto the lab's edge for cells outside it. */
export function nearestSector(frame: LabFrame, cx: number, cy: number): number {
  const n = frame.def.sectors;
  const col = Math.max(0, Math.min(n - 1, Math.floor((cx - frame.x0) / SECTOR_CELLS)));
  const row = Math.max(0, Math.min(n - 1, Math.floor((cy - frame.y0) / SECTOR_CELLS)));
  return row * n + col;
}

/** Inclusive cell bounds of sector `index`. */
export function sectorBounds(frame: LabFrame, index: number): { x0: number; y0: number; x1: number; y1: number } {
  const n = frame.def.sectors;
  const col = index % n;
  const row = (index - col) / n;
  const x0 = frame.x0 + col * SECTOR_CELLS;
  const y0 = frame.y0 + row * SECTOR_CELLS;
  return { x0, y0, x1: x0 + SECTOR_CELLS - 1, y1: y0 + SECTOR_CELLS - 1 };
}

/** Parse a world's blueprint (cached: blueprints never change at run time). */
const parsed = new Map<LabWorldDef, Blueprint>();
export function worldBlueprint(def: LabWorldDef): Blueprint {
  let bp = parsed.get(def);
  if (!bp) parsed.set(def, (bp = parseBlueprint(def.blueprint, def.freeform)));
  return bp;
}

/**
 * Turn the blueprint into a lab layout placed at `frame`. Rooms get a 2-cell
 * margin inside their characters for walls; hallways run between character
 * centers, 3-5 cells wide.
 */
export function buildAuthoredLayout(frame: LabFrame, blueprint: Blueprint = worldBlueprint(frame.def)): LabLayout {
  const def = frame.def;
  const rooms: LabRoom[] = [];
  const corridors: LabCorridorSegment[] = [];
  const charX = (c: number): number => frame.x0 + c * CHAR_CELLS;
  const charY = (r: number): number => frame.y0 + r * CHAR_CELLS;
  const mid = (CHAR_CELLS - 1) / 2;
  const zoneAt = (cx: number, cy: number): 0 | 1 | 2 => sectorZone(def, nearestSector(frame, cx, cy));
  for (const b of blueprint.rooms) {
    const x = charX(b.col) + 2;
    const y = charY(b.row) + 2;
    const size = b.span * CHAR_CELLS - 4;
    const center = { x: x + (size >> 1), y: y + (size >> 1) };
    rooms.push({
      id: rooms.length,
      zone: zoneAt(center.x, center.y),
      x,
      y,
      size,
      wallThickness: 1 + Math.floor(hash2(b.col, b.row, def.seed) * 2),
      sector: sectorAtCell(frame, center.x, center.y),
      kind: b.kind,
      group: b.group,
    });
  }
  for (const h of blueprint.halls) {
    const roll = hash2(h.line * 3 + (h.axis === "h" ? 0 : 1), h.from, def.seed + 5);
    const width = 3 + Math.floor(roll * 3);
    const halfLo = Math.floor((width - 1) / 2);
    const halfHi = width - 1 - halfLo;
    const wallThickness = 1 + Math.floor(hash2(h.from, h.line, def.seed + 9) * 2);
    const rubble = hash2(h.to, h.line, def.seed + 13) < FACILITY.rubbleCorridorChance;
    const a = (h.axis === "h" ? charX(h.from) : charY(h.from)) + mid;
    const b = (h.axis === "h" ? charX(h.to) : charY(h.to)) + mid;
    const across = (h.axis === "h" ? charY(h.line) : charX(h.line)) + mid;
    const seg: LabCorridorSegment =
      h.axis === "h"
        ? { zone: 0, axis: "h", x0: a - halfLo, x1: b + halfHi, y0: across - halfLo, y1: across + halfHi, width, wallThickness, rubble }
        : { zone: 0, axis: "v", x0: across - halfLo, x1: across + halfHi, y0: a - halfLo, y1: b + halfHi, width, wallThickness, rubble };
    seg.zone = zoneAt((seg.x0 + seg.x1) >> 1, (seg.y0 + seg.y1) >> 1);
    corridors.push(seg);
  }
  // Gates: a wide vestibule from the edge character's hallway out through the
  // lab's edge, a huge door, and a short passage beyond it.
  const cells = labCells(def);
  for (const g of def.gates) {
    const cy = charY(g.row * SECTOR_CHARS + 3) + mid;
    const east = g.side === "east";
    const edge = east ? frame.x0 + cells : frame.x0 - 1;
    const inner = east ? edge - CHAR_CELLS - 2 : edge + CHAR_CELLS + 2;
    const outer = east ? edge + GATE_THICKNESS + GATE_POCKET - 1 : edge - GATE_THICKNESS - GATE_POCKET + 1;
    corridors.push({
      zone: zoneAt(edge, cy),
      axis: "h",
      x0: Math.min(inner, outer),
      x1: Math.max(inner, outer),
      y0: cy - GATE_HALF,
      y1: cy + GATE_HALF,
      width: GATE_HALF * 2 + 1,
      wallThickness: 2,
      rubble: false,
      gate: true,
    });
  }
  return { seed: def.seed, rooms, corridors, frame };
}

/** Inclusive cell bounds of a gate's door and of the passage beyond it. */
export function gateGeometry(frame: LabFrame, g: GateDef): { door: { x0: number; y0: number; x1: number; y1: number }; pocket: { x0: number; y0: number; x1: number; y1: number } } {
  const cells = labCells(frame.def);
  const cy = frame.y0 + (g.row * SECTOR_CHARS + 3) * CHAR_CELLS + (CHAR_CELLS - 1) / 2;
  const y0 = cy - GATE_HALF - 1;
  const y1 = cy + GATE_HALF + 1;
  if (g.side === "east") {
    const x0 = frame.x0 + cells;
    return {
      door: { x0, y0, x1: x0 + GATE_THICKNESS - 1, y1 },
      pocket: { x0: x0 + GATE_THICKNESS, y0: cy - GATE_HALF, x1: x0 + GATE_THICKNESS + GATE_POCKET - 1, y1: cy + GATE_HALF },
    };
  }
  const x1 = frame.x0 - 1;
  return {
    door: { x0: x1 - GATE_THICKNESS + 1, y0, x1, y1 },
    pocket: { x0: x1 - GATE_THICKNESS - GATE_POCKET + 1, y0: cy - GATE_HALF, x1: x1 - GATE_THICKNESS, y1: cy + GATE_HALF },
  };
}

/** World cell of a special-upgrade placeholder. */
export function upgradeSpotCell(frame: LabFrame, spot: UpgradeSpotDef): { cx: number; cy: number } {
  const mid = (CHAR_CELLS - 1) / 2;
  return { cx: frame.x0 + spot.col * CHAR_CELLS + mid, cy: frame.y0 + spot.row * CHAR_CELLS + mid };
}

/** Sector holding a special-upgrade placeholder. */
export function upgradeSpotSector(def: LabWorldDef, spot: UpgradeSpotDef): number {
  return Math.floor(spot.row / SECTOR_CHARS) * def.sectors + Math.floor(spot.col / SECTOR_CHARS);
}

/**
 * World cell where a squad deploying into sector `index` lands: the middle of
 * the sector's biggest room that is not overrun, else of any room, else the
 * hallway nearest the sector's middle (where a small landing clearing is cut).
 */
export function sectorSpawnCell(frame: LabFrame, index: number): { cx: number; cy: number } {
  const def = frame.def;
  const lines = def.blueprint;
  const n = def.sectors;
  const col = index % n;
  const row = (index - col) / n;
  const c0 = col * SECTOR_CHARS;
  const r0 = row * SECTOR_CHARS;
  const inSector = (c: number, r: number): boolean => c >= c0 && c < c0 + SECTOR_CHARS && r >= r0 && r < r0 + SECTOR_CHARS;
  const rooms = worldBlueprint(def).rooms.filter((b) => inSector(b.col + ((b.span - 1) >> 1), b.row + ((b.span - 1) >> 1)));
  const rank: Record<RoomKind, number> = { room: 0, tanks: 1, blighted: 2, overrun: 3 };
  rooms.sort((a, b) => rank[a.kind] - rank[b.kind] || b.span - a.span);
  if (rooms.length > 0) {
    const b = rooms[0];
    const size = b.span * CHAR_CELLS - 4;
    return { cx: frame.x0 + b.col * CHAR_CELLS + 2 + (size >> 1), cy: frame.y0 + b.row * CHAR_CELLS + 2 + (size >> 1) };
  }
  const mid = (SECTOR_CHARS - 1) / 2;
  let best = { c: c0 + mid, r: r0 + mid };
  let bestD = Infinity;
  for (let r = r0; r < r0 + SECTOR_CHARS; r++) {
    for (let c = c0; c < c0 + SECTOR_CHARS; c++) {
      if (!"-|+".includes(lines[r][c])) continue;
      const d = Math.abs(c - c0 - mid) + Math.abs(r - r0 - mid);
      if (d < bestD) {
        bestD = d;
        best = { c, r };
      }
    }
  }
  const half = (CHAR_CELLS - 1) / 2;
  return { cx: frame.x0 + best.c * CHAR_CELLS + half, cy: frame.y0 + best.r * CHAR_CELLS + half };
}
