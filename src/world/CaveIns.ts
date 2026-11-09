import { FACILITY } from "../config";
import { hash2, valueNoise } from "../core/math";
import { MAT, SUB, type PixelWorld } from "./PixelWorld";
import { ROOM_STATE, type LabCorridorSegment, type LabRoom } from "./WorldGenerator";

/**
 * Cave-ins: places where part of the ceiling or a wall came down. Each one is
 * a heap of half-size rubble, densest where it fell and thinning to a few
 * stray stones, and it knocks out the stretch of wall it landed against.
 * Collapsed hallways get one to three cave-ins along their length instead of
 * being filled end to end, and some decayed or overrun rooms have a corner or
 * wall that gave way.
 */
export interface CaveIn {
  /** Center of the fall, in cells. */
  x: number;
  y: number;
  /** Radius of the heap, in cells. */
  r: number;
}

/** Rubble palette indices (COLORS.rubble) weighted toward concrete and ash, with a little rust and sand. */
const STONE_MIX = [0, 0, 0, 0, 1, 1, 1, 5, 5, 2, 3, 4];

/** Where a collapsed hallway caved in. Deterministic in `seed`. */
export function corridorCaveIns(seg: LabCorridorSegment, seed: number): CaveIn[] {
  const h = seg.axis === "h";
  const a0 = h ? seg.x0 : seg.y0;
  const a1 = h ? seg.x1 : seg.y1;
  const c0 = h ? seg.y0 : seg.x0;
  const c1 = h ? seg.y1 : seg.x1;
  const len = a1 - a0 + 1;
  const key = seg.x0 * 31 + seg.y0 * 17 + (h ? 0 : 7);
  const count = Math.max(1, Math.min(FACILITY.caveInsPerHallMax, Math.round(len / FACILITY.caveInSpacing + hash2(key, 1, seed) - 0.5)));
  const out: CaveIn[] = [];
  for (let k = 0; k < count; k++) {
    // Spread along the hall, jittered, clear of the ends where it meets rooms.
    const slot = (k + 0.25 + hash2(key, k + 2, seed) * 0.5) / count;
    const along = a0 + 4 + slot * Math.max(0, len - 9);
    const across = c0 + hash2(key, k + 11, seed) * (c1 - c0 + 1);
    const r = FACILITY.caveInRadiusMin + hash2(key, k + 23, seed) * (FACILITY.caveInRadiusMax - FACILITY.caveInRadiusMin);
    out.push(h ? { x: along, y: across, r } : { x: across, y: along, r });
  }
  return out;
}

/** A wall section that gave way into a run-down room, or none. Deterministic in `seed`. */
export function roomCaveIns(room: LabRoom, seed: number): CaveIn[] {
  if (room.state !== ROOM_STATE.decayed && room.state !== ROOM_STATE.overrun) return [];
  const roll = hash2(room.x, room.y, seed + 41);
  if (roll > FACILITY.roomCaveInChance) return [];
  const side = Math.floor(hash2(room.x, room.y, seed + 43) * 4);
  const t = 0.15 + hash2(room.x, room.y, seed + 47) * 0.7;
  const along = t * room.size;
  const r = FACILITY.caveInRadiusMin + 1 + hash2(room.x, room.y, seed + 53) * (FACILITY.caveInRadiusMax - FACILITY.caveInRadiusMin);
  // Centered just inside the wall, so the heap spills into the room.
  const inset = 0.5;
  const x = side === 1 ? room.x + room.size - inset : side === 3 ? room.x + inset : room.x + along;
  const y = side === 0 ? room.y + inset : side === 2 ? room.y + room.size - inset : room.y + along;
  return [{ x, y, r }];
}

/**
 * Pile rubble for `caveIns`. Walls inside the inner part of a fall collapse
 * into the heap; doors, glass, Blight Cores and anything in `protect` stay.
 * Run after cell health is set.
 */
export function placeCaveIns(world: PixelWorld, caveIns: readonly CaveIn[], seed: number, protect: (i: number) => boolean): void {
  const { width, health, wall } = world;
  for (const c of caveIns) {
    // 1. The wall it landed against breaks open along a ragged edge.
    const wr = c.r * FACILITY.caveInWallBreak;
    const broken = new Set<number>();
    for (let y = Math.floor(c.y - wr); y <= Math.ceil(c.y + wr); y++) {
      for (let x = Math.floor(c.x - wr); x <= Math.ceil(c.x + wr); x++) {
        if (!world.inBounds(x, y)) continue;
        const i = y * width + x;
        if (wall[i] === 0 || protect(i) || world.mat[i] !== MAT.none || world.coreId[i] > 0 || world.doorId[i] > 0) continue;
        const d = Math.hypot(x + 0.5 - c.x, y + 0.5 - c.y) / wr;
        if (d + (valueNoise(x, y, 3, seed + 61) - 0.5) * 0.6 > 1) continue;
        wall[i] = 0;
        health[i] = 0;
        broken.add(i);
        world.blight[i] = 0;
        world.decor[i] = 0;
      }
    }
    // 2. The heap: densest in the middle, thinning out, then a few strays.
    const reach = c.r * FACILITY.caveInScatter;
    const sx0 = Math.floor((c.x - reach) * 2);
    const sy0 = Math.floor((c.y - reach) * 2);
    const sx1 = Math.ceil((c.x + reach) * 2);
    const sy1 = Math.ceil((c.y + reach) * 2);
    for (let sy = sy0; sy <= sy1; sy++) {
      for (let sx = sx0; sx <= sx1; sx++) {
        if (!world.subInBounds(sx, sy)) continue;
        const ci = (sy >> 1) * width + (sx >> 1);
        if (health[ci] > 0 || wall[ci] !== 0 || protect(ci) || world.mat[ci] !== MAT.none || world.coreId[ci] > 0) continue;
        const si = sy * world.subWidth + sx;
        if (world.subHealth[si] > 0) continue;
        // Lumpy outline: distance warped by low-frequency noise.
        const warp = (valueNoise(sx, sy, 6, seed + 67) - 0.5) * 0.5;
        const d = Math.hypot((sx + 0.5) / 2 - c.x, (sy + 0.5) / 2 - c.y) / c.r + warp;
        let p: number;
        if (d < 0.5) p = 0.97;
        else if (d < 1) p = 0.97 * (1 - (d - 0.5) / 0.5) ** 1.4;
        else if (d < FACILITY.caveInScatter) p = FACILITY.caveInStrayChance * (1 - (d - 1) / (FACILITY.caveInScatter - 1));
        else if (!broken.has(ci)) continue;
        else p = 0;
        // Where a wall came down, its own wreckage fills the gap.
        if (broken.has(ci)) p = Math.max(p, 0.85);
        if (hash2(sx, sy, seed + 71) > p) continue;
        world.subKind[si] = SUB.rubble;
        world.subTint[si] = stoneTint(sx, sy, Math.max(0, 1 - d), seed);
        world.subHealth[si] = world.maxSubHealthAt(sx, sy);
      }
    }
  }
}

/**
 * Tint of a rubble sub-pixel: bits 0-2 pick the stone's color, bits 3-7 its
 * brightness. Neighboring sub-pixels share a stone (2-3 wide in the heart of
 * the heap, single grit at its edge), and the top of the heap is lit brighter.
 */
function stoneTint(sx: number, sy: number, height: number, seed: number): number {
  const size = height > 0.5 ? 3 : height > 0.2 ? 2 : 1;
  const ox = Math.floor(hash2(Math.floor(sy / size), 3, seed + 73) * size);
  const kx = Math.floor((sx + ox) / size);
  const ky = Math.floor(sy / size);
  const stone = hash2(kx * size, ky * size, seed + 79 + size);
  const color = STONE_MIX[Math.floor(stone * STONE_MIX.length)];
  const light = Math.max(0, Math.min(31, Math.round(1 + height * 13 + hash2(kx, ky, seed + 83) * 7)));
  return (light << 3) | color;
}
