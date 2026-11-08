import { FACILITY } from "../config";
import { hash2 } from "../core/math";
import type { LabCorridorSegment, LabLayout, LabRoom } from "./WorldGenerator";

/**
 * The hand-made research lab: one fixed blueprint shared by every run.
 *
 * The lab is a grid of SECTORS_PER_SIDE × SECTORS_PER_SIDE sectors, named like
 * a chess board: columns A.. left to right, rows 1.. top to bottom. The middle
 * sector is the starting area. Each sector is drawn below as SECTOR_CHARS ×
 * SECTOR_CHARS characters, and each character covers CHAR_CELLS × CHAR_CELLS
 * cells of the world. Edit the picture to change the lab.
 *
 * Legend:
 *   .  solid rock / fill
 *   R  room              (a filled square block of 2×2 .. 5×5 characters)
 *   G  overrun room      (same, swallowed by Blight around a Blight Core)
 *   T  specimen room     (same, with glass tanks holding small generators)
 *   -  hallway running east-west
 *   |  hallway running north-south
 *   +  hallway junction (joins every neighbor)
 *
 * Rooms must not touch each other orthogonally, or they would read as one
 * room. A hallway joins a room it points into. Difficulty rises by ring: the
 * middle sector and the ring around it are tier 1, ring 2 is tier 2 and rings
 * 3-4 are tier 3 (see `zoneForSectorRing`).
 */
export const LAB_BLUEPRINT: readonly string[] = [
  "...............................................................",  // 1
  ".GGG....+-+-+..RRR.......GG...GG....+-+-+..+-+-+....+TT....GG..",
  ".GGG....|...|..RRR.......GG...GG....|...|..|...|....|TT....GG..",
  ".GGG----+...+--RRR-+....++-----+----+...+..+...+--GGG------+...",
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
  ".RRR-+--GGGG---RRR----RRR-+---RRR-----RRR----+------+-----GGGG.",
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

export const SECTORS_PER_SIDE = 9;
export const SECTOR_CHARS = 7;
export const CHAR_CELLS = 7;
/** Edge length of one sector, in cells. */
export const SECTOR_CELLS = SECTOR_CHARS * CHAR_CELLS;
/** Edge length of the whole blueprint, in cells. */
export const LAB_CELLS = SECTORS_PER_SIDE * SECTOR_CELLS;
/** Seed for everything about the lab that should look the same every run. */
export const LAB_SEED = 0x1ab5eed;
/** Index of the middle (starting) sector. */
export const CENTER_SECTOR = ((SECTORS_PER_SIDE * SECTORS_PER_SIDE) / 2) | 0;

export type RoomKind = "room" | "overrun" | "tanks";

/** A room as drawn in the blueprint, in character units. */
export interface BlueprintRoom {
  col: number;
  row: number;
  /** Edge length in characters. */
  span: number;
  kind: RoomKind;
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
 * Parse a blueprint into rooms and straight hallway runs. Throws on a room
 * that is not a filled square, so a typo in the picture fails loudly.
 */
export function parseBlueprint(lines: readonly string[] = LAB_BLUEPRINT): Blueprint {
  const n = lines.length;
  const at = (c: number, r: number): string => (r >= 0 && r < n && c >= 0 && c < lines[r].length ? lines[r][c] : ".");
  for (const l of lines) if (l.length !== n) throw new Error(`Blueprint must be square: a row has ${l.length} chars, expected ${n}`);

  const rooms: BlueprintRoom[] = [];
  const seen = new Uint8Array(n * n);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!isRoomChar(at(c, r)) || seen[r * n + c]) continue;
      // Flood the room so a non-square block is caught.
      const stack = [[c, r]];
      seen[r * n + c] = 1;
      let c0 = c, c1 = c, r0 = r, r1 = r, count = 0;
      let kind: RoomKind = "room";
      while (stack.length) {
        const [x, y] = stack.pop()!;
        count++;
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
      if (span !== r1 - r0 + 1 || count !== span * span || span < 2) {
        throw new Error(`Blueprint room at column ${c0}, row ${r0} must be a filled square of at least 2×2`);
      }
      rooms.push({ col: c0, row: r0, span, kind });
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

/** Sector ring 0 (middle) .. 4 (outer edge) of sector `index`. */
export function sectorRing(index: number): number {
  const mid = (SECTORS_PER_SIDE - 1) / 2;
  const col = index % SECTORS_PER_SIDE;
  const row = (index - col) / SECTORS_PER_SIDE;
  return Math.max(Math.abs(col - mid), Math.abs(row - mid));
}

/** Zone (0 = tier 1, 1 = tier 2, 2 = tier 3) of a sector ring. */
export function zoneForSectorRing(ring: number): 0 | 1 | 2 {
  return ring <= 1 ? 0 : ring === 2 ? 1 : 2;
}

/** Map label of sector `index`, like "E5". */
export function sectorName(index: number): string {
  const col = index % SECTORS_PER_SIDE;
  const row = (index - col) / SECTORS_PER_SIDE;
  return `${String.fromCharCode(65 + col)}${row + 1}`;
}

/** Placement of the blueprint inside a world: centered on the world's middle cell. */
export interface LabFrame {
  /** World cell of the blueprint's top-left corner. */
  x0: number;
  y0: number;
}

/**
 * Where the blueprint sits in a world of this size, or null if the world is
 * too small to hold it (small test worlds keep the procedural maze).
 */
export function labFrame(world: { width: number; height: number; centerX: number; centerY: number }): LabFrame | null {
  const half = (LAB_CELLS - 1) / 2;
  const x0 = world.centerX - half;
  const y0 = world.centerY - half;
  const margin = 4;
  if (x0 < margin || y0 < margin || x0 + LAB_CELLS + margin > world.width || y0 + LAB_CELLS + margin > world.height) return null;
  return { x0, y0 };
}

/** Sector index of a world cell, or -1 outside the lab. */
export function sectorAtCell(frame: LabFrame, cx: number, cy: number): number {
  const lx = cx - frame.x0;
  const ly = cy - frame.y0;
  if (lx < 0 || ly < 0 || lx >= LAB_CELLS || ly >= LAB_CELLS) return -1;
  return Math.floor(ly / SECTOR_CELLS) * SECTORS_PER_SIDE + Math.floor(lx / SECTOR_CELLS);
}

/** Inclusive cell bounds of sector `index`. */
export function sectorBounds(frame: LabFrame, index: number): { x0: number; y0: number; x1: number; y1: number } {
  const col = index % SECTORS_PER_SIDE;
  const row = (index - col) / SECTORS_PER_SIDE;
  const x0 = frame.x0 + col * SECTOR_CELLS;
  const y0 = frame.y0 + row * SECTOR_CELLS;
  return { x0, y0, x1: x0 + SECTOR_CELLS - 1, y1: y0 + SECTOR_CELLS - 1 };
}

/**
 * Turn the blueprint into a lab layout placed at `frame`. Rooms get a 2-cell
 * margin inside their characters for walls; hallways run between character
 * centers, 3-5 cells wide.
 */
export function buildAuthoredLayout(frame: LabFrame, blueprint: Blueprint = parseBlueprint()): LabLayout {
  const rooms: LabRoom[] = [];
  const corridors: LabCorridorSegment[] = [];
  const charX = (c: number): number => frame.x0 + c * CHAR_CELLS;
  const charY = (r: number): number => frame.y0 + r * CHAR_CELLS;
  const mid = (CHAR_CELLS - 1) / 2;
  const zoneAt = (cx: number, cy: number): 0 | 1 | 2 => {
    const s = sectorAtCell(frame, cx, cy);
    return zoneForSectorRing(s < 0 ? SECTORS_PER_SIDE : sectorRing(s));
  };
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
      wallThickness: 1 + Math.floor(hash2(b.col, b.row, LAB_SEED) * 2),
      sector: sectorAtCell(frame, center.x, center.y),
      kind: b.kind,
    });
  }
  for (const h of blueprint.halls) {
    const roll = hash2(h.line * 3 + (h.axis === "h" ? 0 : 1), h.from, LAB_SEED + 5);
    const width = 3 + Math.floor(roll * 3);
    const halfLo = Math.floor((width - 1) / 2);
    const halfHi = width - 1 - halfLo;
    const wallThickness = 1 + Math.floor(hash2(h.from, h.line, LAB_SEED + 9) * 2);
    const rubble = hash2(h.to, h.line, LAB_SEED + 13) < FACILITY.rubbleCorridorChance;
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
  return { seed: LAB_SEED, rooms, corridors, frame };
}

/**
 * World cell where a squad deploying into sector `index` lands: the middle of
 * the sector's biggest room that is not overrun, else of any room, else the
 * hallway nearest the sector's middle (where a small landing clearing is cut).
 */
export function sectorSpawnCell(frame: LabFrame, index: number, lines: readonly string[] = LAB_BLUEPRINT): { cx: number; cy: number } {
  const col = index % SECTORS_PER_SIDE;
  const row = (index - col) / SECTORS_PER_SIDE;
  const c0 = col * SECTOR_CHARS;
  const r0 = row * SECTOR_CHARS;
  const inSector = (c: number, r: number): boolean => c >= c0 && c < c0 + SECTOR_CHARS && r >= r0 && r < r0 + SECTOR_CHARS;
  const rooms = parseBlueprint(lines).rooms.filter((b) => inSector(b.col + ((b.span - 1) >> 1), b.row + ((b.span - 1) >> 1)));
  const rank: Record<RoomKind, number> = { room: 0, tanks: 1, overrun: 2 };
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
