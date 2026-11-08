import { FACILITY } from "../config";
import { Rng } from "../core/Rng";
import { MAT, SUB, type PixelWorld } from "./PixelWorld";
import { ROOM_STATE, type LabCorridorSegment, type LabLayout, type LabRoom } from "./WorldGenerator";

/**
 * Half-size destructible lab equipment: consoles, computers, server racks and
 * mainframes with blinking status lights, pipe runs, bulky machines and wall
 * apparatus along room walls, free-standing mystery machines with pulsing cores
 * in some rooms, smashed wreckage in overrun rooms, and pipes down some
 * hallways. Built from half-size pixels so it reads as fine machinery while room
 * centers stay mostly open. Runs after rooms and corridors are carved (it only
 * fills empty cells).
 */

/** How a piece has fared: freshly installed, in daily use, or smashed. */
type Style = "new" | "worn" | "wreck";

/** Room-interior offset (in cells) from each wall, per side: top, right, bottom, left. */
type Side = 0 | 1 | 2 | 3;

export function placeLabEquipment(world: PixelWorld, layout: LabLayout): void {
  const rng = new Rng((layout.seed ^ 0x51e7c0de) >>> 0 || 1);
  for (const room of layout.rooms) {
    if (inStartRoom(world, room)) continue;
    // Overrun rooms keep only smashed remains of what used to stand there;
    // decayed rooms lose some pieces; pristine rooms gleam.
    const wreck = !!room.overrun;
    const decayed = room.state === ROOM_STATE.decayed;
    const pieceStyle = (): Style =>
      wreck || (decayed && rng.next() < FACILITY.decayedWreckChance) ? "wreck"
      : room.state === ROOM_STATE.pristine ? "new"
      : "worn";
    const sideChance = wreck ? FACILITY.wreckSideChance : FACILITY.equipmentSideChance;
    for (let side = 0 as Side; side < 4; side = (side + 1) as Side) {
      if (rng.next() > sideChance) continue;
      const pieces = wreck ? 1 + rng.int(2) : 2 + rng.int(3);
      for (let p = 0; p < pieces; p++) {
        const style = pieceStyle();
        retry(() => placePiece(world, room, side, rng, style));
      }
    }
    if (wreck) scatterDebris(world, room, rng, 1);
    else if (decayed) scatterDebris(world, room, rng, 0.4);
    if (!wreck && rng.next() < FACILITY.serverRoomChance) {
      placeServerFarm(world, room, rng);
    } else if (rng.next() < FACILITY.machineRoomChance) {
      const count = wreck ? 1 + rng.int(2) : 2 + rng.int(FACILITY.machinesPerRoom - 1);
      for (let m = 0; m < count; m++) {
        const style = pieceStyle();
        retry(() => placeMachine(world, room, rng, style));
      }
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
    if (seg.rubble || seg.width < 3) continue;
    const near = rng.next() < 0.5;
    if (rng.next() < FACILITY.corridorFixtureChance) placeCorridorFixtures(world, seg, !near, rng, inRoom);
    if (rng.next() > FACILITY.corridorPipeChance) continue;
    // A pipe bundle hugging one side of the hallway, one half-cell thick.
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

/**
 * Hallway fixtures along one wall: terminals with a screen, junction boxes with
 * status lights, and lone red emergency beacons, spaced out down the hall.
 */
function placeCorridorFixtures(world: PixelWorld, seg: LabCorridorSegment, near: boolean, rng: Rng, inRoom: Uint8Array): void {
  const h = seg.axis === "h";
  const a0 = (h ? seg.x0 : seg.y0) * 2 + 3;
  const a1 = (h ? seg.x1 : seg.y1) * 2 - 3;
  // Depth 0 hugs the wall; depth 1 is one subcell further into the hall.
  const at = (along: number, d: number): { sx: number; sy: number } => {
    const across = near ? (h ? seg.y0 : seg.x0) * 2 + d : (h ? seg.y1 : seg.x1) * 2 + 1 - d;
    return h ? { sx: along, sy: across } : { sx: across, sy: along };
  };
  const ok = (sx: number, sy: number): boolean =>
    world.subInBounds(sx, sy) && !inRoom[(sy >> 1) * world.width + (sx >> 1)] && free(world, sx, sy);
  for (let a = a0 + rng.int(6); a + 2 <= a1; a += 7 + rng.int(9)) {
    const kind = rng.int(3);
    // [along offset, depth, kind]
    const parts: [number, number, number][] =
      kind === 0
        ? [[0, 0, SUB.metal], [1, 0, SUB.metal], [2, 0, SUB.metal], [0, 1, SUB.metal], [1, 1, SUB.screen], [2, 1, SUB.metal]]
        : kind === 1
          ? [[0, 0, SUB.metal], [1, 0, SUB.metal], [0, 1, SUB.led], [1, 1, SUB.led]]
          : [[0, 0, SUB.metal], [0, 1, SUB.led]];
    if (!parts.every(([o, d]) => { const p = at(a + o, d); return ok(p.sx, p.sy); })) continue;
    const tint = rng.int(256);
    for (const [o, d, k] of parts) {
      const p = at(a + o, d);
      let t = (tint + o * 41) & 255;
      if (k === SUB.led) t = kind === 2 ? (2 << 6) | (rng.int(16) * 4) : ledTint(rng);
      putSub(world, p.sx, p.sy, k, t);
    }
  }
}

/** A server farm: rows of two-wide racks with lit faces, aisles between them. */
function placeServerFarm(world: PixelWorld, r: LabRoom, rng: Rng): void {
  const n = r.size * 2;
  const vertical = rng.next() < 0.5;
  const pitch = 5; // 2 rack + 3 aisle
  const inset = MACHINE_WALL_GAP;
  const tint = rng.int(256);
  for (let row = inset; row + 2 <= n - inset; row += pitch) {
    // Each row is broken into racks with a 1-subcell gap so the room stays passable.
    for (let a = inset; a < n - inset; a++) {
      if ((a - inset) % 6 === 5) continue;
      for (let d = 0; d < 2; d++) {
        const sx = r.x * 2 + (vertical ? row + d : a);
        const sy = r.y * 2 + (vertical ? a : row + d);
        if (!free(world, sx, sy)) continue;
        const lit = (a + d) % 2 === 0;
        putSub(world, sx, sy, lit ? SUB.led : SUB.metal, lit ? ledTint(rng) : (tint + a * 17) & 255);
      }
    }
  }
}

/** Loose scraps of smashed equipment strewn over an overrun room's floor. */
function scatterDebris(world: PixelWorld, r: LabRoom, rng: Rng, amount: number): void {
  const n = r.size * 2;
  const count = Math.round(r.size * FACILITY.overrunDebrisPerCell * amount);
  for (let i = 0; i < count; i++) {
    const sx = r.x * 2 + 2 + rng.int(n - 4);
    const sy = r.y * 2 + 2 + rng.int(n - 4);
    if (!free(world, sx, sy)) continue;
    const roll = rng.next();
    const k = roll < 0.75 ? SUB.wreck : roll < 0.92 ? SUB.metal : SUB.pipe;
    putSub(world, sx, sy, k, rng.int(256));
  }
}

/** Spots tried for each piece before giving up (crowded walls reject most spots). */
const PLACE_TRIES = 4;

function retry(place: () => boolean): void {
  for (let t = 0; t < PLACE_TRIES && !place(); t++);
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

/** Pieces that stand against a wall. */
const WALL_PIECES = 7;

function placePiece(world: PixelWorld, r: LabRoom, side: Side, rng: Rng, style: Style): boolean {
  const n = r.size * 2;
  const kind = rng.int(WALL_PIECES);
  // Lengths and depths in subcells.
  const [len, depth] =
    kind === 0 ? [4 + rng.int(5), 2]
    : kind === 1 ? [2 + rng.int(2), 2]
    : kind === 2 ? [8 + rng.int(9), 1]
    : kind === 3 ? [4 + rng.int(3), 3 + rng.int(2)]
    : kind === 4 ? [5 + rng.int(3), 3]
    : kind === 5 ? [6 + rng.int(6), 2]
    : [5 + rng.int(2), 3];
  // Keep clear of the corners and the room's door thresholds.
  const start = 3 + rng.int(Math.max(1, n - len - 6));
  if (start + len > n - 3) return false;
  for (let a = start - 1; a <= start + len; a++) {
    for (let d = 0; d <= depth; d++) {
      const { sx, sy } = subAt(r, side, a, d);
      if (!free(world, sx, sy)) return false;
    }
  }
  const tint = rng.int(256);
  const coreColor = rng.int(4);
  const last = len - 1;
  for (let a = start; a < start + len; a++) {
    for (let d = 0; d < depth; d++) {
      const { sx, sy } = subAt(r, side, a, d);
      const i = a - start;
      const front = d === depth - 1;
      let k: number = SUB.metal;
      if (kind === 0) {
        // Console: metal back against the wall, a strip of screens facing the room.
        k = front && i > 0 && i < last ? SUB.screen : SUB.metal;
      } else if (kind === 1) {
        // Server rack: blinking LEDs dotted down a metal cabinet.
        k = (i + d) % 2 === 0 ? SUB.led : SUB.metal;
      } else if (kind === 2) {
        // Pipe run with valve collars.
        k = i % 5 === 0 ? SUB.metal : SUB.pipe;
      } else if (kind === 3) {
        // Machine block with a vent grille on its face.
        k = front && i % 2 === 1 ? SUB.pipe : SUB.metal;
      } else if (kind === 4) {
        // Computer: tower and monitor on the back row, keyboard lights in front.
        if (d === 0) k = i === 0 || i === last ? SUB.metal : SUB.screen;
        else if (d === 1) k = i === 0 ? SUB.led : SUB.metal;
        else k = i % 2 === 1 && i < last ? SUB.led : SUB.metal;
      } else if (kind === 5) {
        // Mainframe bank: rows of blinkenlights, a reel slot every third column.
        k = front && i % 3 !== 0 ? SUB.led : SUB.metal;
      } else {
        // Wall apparatus: pipes feeding a glowing chamber, a status light beside it.
        if (d === 0) k = SUB.pipe;
        else if (d === 1) k = i > 0 && i < last ? SUB.core : SUB.metal;
        else k = i === 1 ? SUB.led : SUB.metal;
      }
      let t = (tint + i * 37 + d * 11) & 255;
      if (k === SUB.led) t = ledTint(rng);
      else if (k === SUB.core) t = (coreColor << 6) | rng.int(64);
      putPart(world, sx, sy, k, t, rng, style);
    }
  }
  return true;
}

/**
 * Free-standing mystery machines, drawn in subcells:
 * M casing, P pipe, S screen, L status light, C pulsing core, `.` empty.
 */
const MACHINES: readonly (readonly string[])[] = [
  // Resonator: an energy mote suspended in an open ring.
  ["..MMM..", ".M...M.", "M..C..M", "M.CCC.M", "M..C..M", ".M...M.", "..MLM.."],
  // Reactor drum with a hot core.
  ["PMMMMP", "MSLLSM", "MLCCLM", "MLCCLM", "MSLLSM", "PMMMMP"],
  // Antenna pylon with a glowing tip.
  [".C.", "MCM", ".P.", ".P.", "MLM", "MMM"],
  // Specimen analyzer: a lit sample chamber under a readout.
  ["MSSSM", "MCCCM", "MCCCM", "MLMLM"],
  // Monolith with glowing glyphs.
  ["MMM", "MCM", "MMM", "MCM", "MLM"],
  // Centrifuge: four sample arms around a hub.
  [".P.P.", "PMCMP", ".CLC.", "PMCMP", ".P.P."],
  // Cryo pod: a frosted capsule with something glowing inside.
  [".MMM.", "MSCSM", "MCCCM", "MSCSM", ".MLM."],
  // Workstation island: back-to-back desks, each with a monitor and a lit tower.
  ["MSSMMSSM", "MLMMMMLM", "MMLMMLMM", "MSSMMSSM"],
  // Computer desk with two monitors.
  ["MSSMSSM", "MMLMMLM"],
  // Chemistry bench: glowing flasks on a long worktop.
  [".C.C.C.", "MMMMMMM", "P.....P"],
  // Tesla pair: two coils sparking at each other over a base.
  ["C...C", "M...M", "P.L.P", "MMMMM"],
  // Sample freezer bank with a row of status lights.
  ["MMMMMM", "MLMLML", "MSSSSM"],
  // Holo table: a projector ring around a glowing display.
  [".MSM.", "MSCSM", "SCCCS", "MSCSM", ".MLM."],
  // Robotic arm on a turntable, reaching for something.
  ["....C", "...P.", "..P..", "MMP..", "MLM.."],
  // Containment field generator: two emitters holding a shimmering field.
  ["MLM", "P.P", "CCC", "CCC", "P.P", "MLM"],
  // Particle accelerator: a long ring with a hot spot and beam monitors.
  ["..MPPPPPM..", ".P.......P.", "M.........M", "P...SLS...P", "P...LCL...P", "P...SLS...P", "M.........M", ".P.......P.", "..MPPCPPM.."],
  // Gene sequencer: stacked sample trays beside a readout.
  ["MSSM", "MLLM", "MCCM", "MLLM", "MMMM"],
];

/** Subcells kept between a free-standing machine and the room walls. */
const MACHINE_WALL_GAP = 4;

function placeMachine(world: PixelWorld, r: LabRoom, rng: Rng, style: Style): boolean {
  const art = MACHINES[rng.int(MACHINES.length)];
  // Random quarter turn and mirror.
  const swap = rng.next() < 0.5;
  const flipX = rng.next() < 0.5;
  const flipY = rng.next() < 0.5;
  const h0 = art.length;
  const w0 = art[0].length;
  const w = swap ? h0 : w0;
  const h = swap ? w0 : h0;
  const n = r.size * 2;
  const span = n - MACHINE_WALL_GAP * 2;
  if (span < Math.max(w, h)) return false;
  const ox = r.x * 2 + MACHINE_WALL_GAP + rng.int(span - w + 1);
  const oy = r.y * 2 + MACHINE_WALL_GAP + rng.int(span - h + 1);
  // One clear subcell all round so machines never fuse with each other or the tanks.
  for (let y = -1; y <= h; y++) {
    for (let x = -1; x <= w; x++) if (!free(world, ox + x, oy + y)) return false;
  }
  const coreColor = rng.int(4);
  const tint = rng.int(256);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let ax = flipX ? w - 1 - x : x;
      let ay = flipY ? h - 1 - y : y;
      if (swap) [ax, ay] = [ay, ax];
      const ch = art[ay][ax];
      if (ch === ".") continue;
      const k = ch === "M" ? SUB.metal : ch === "P" ? SUB.pipe : ch === "S" ? SUB.screen : ch === "L" ? SUB.led : SUB.core;
      let t = (tint + x * 29 + y * 13) & 255;
      if (k === SUB.led) t = ledTint(rng);
      else if (k === SUB.core) t = (coreColor << 6) | rng.int(64);
      putPart(world, ox + x, oy + y, k, t, rng, style);
    }
  }
  return true;
}

/** A status light: mostly green, some cyan, a few amber and red; random rhythm. */
function ledTint(rng: Rng): number {
  const r = rng.next();
  const color = r < 0.55 ? 0 : r < 0.75 ? 3 : r < 0.9 ? 1 : 2;
  return (color << 6) | rng.int(64);
}

/**
 * Place one equipment pixel. In overrun rooms the piece is smashed: chunks are
 * missing, casings are scorched, and only a few lights still blink, mostly red.
 */
function putPart(world: PixelWorld, sx: number, sy: number, kind: number, tint: number, rng: Rng, style: Style): void {
  if (style === "new") {
    // Fresh casings are polished bright, and every status light reads all-clear.
    if (kind === SUB.metal) tint = 150 + (tint % 106);
    else if (kind === SUB.led) tint = ((rng.next() < 0.7 ? 0 : 3) << 6) | (tint & 63);
  } else if (style === "wreck") {
    if (rng.next() < 0.3) return;
    if (kind === SUB.led || kind === SUB.screen) {
      if (rng.next() < 0.35) {
        kind = SUB.led;
        tint = ((rng.next() < 0.7 ? 2 : 1) << 6) | rng.int(64);
      } else kind = SUB.wreck;
    } else if (kind === SUB.metal || (kind === SUB.pipe && rng.next() < 0.4)) {
      kind = rng.next() < 0.75 ? SUB.wreck : SUB.metal;
    } else if (kind === SUB.core && rng.next() < 0.5) {
      kind = SUB.wreck;
    }
  }
  putSub(world, sx, sy, kind, tint);
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
