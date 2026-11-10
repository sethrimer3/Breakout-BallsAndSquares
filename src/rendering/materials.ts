import { hash2, valueNoise } from "../core/math";

/**
 * Matte wall materials, one per terrain tier, painted at quarter-pixel
 * resolution (4 texels per world cell). Tiers read apart by surface pattern and
 * hue rather than by glow:
 *
 * - Tier 1: coursed concrete/stone block with dark mortar joints.
 * - Tier 2: rusted iron plate with seams, rivets and rust streaks.
 * - Tier 3: ribbed oxidized-bronze bulkhead.
 * - Tier 4: reinforced gunmetal tread plate.
 *
 * Zone 2, where the Blight has begun remaking the lab, grows its own:
 * - Tier 5: fused resin hull, lumpy ridges like poured wax.
 * - Tier 6: overlapping chitin scales.
 * - Tier 7: black carapace split by dark veins (zone 2's deepest walls).
 */

/** Texels per world cell edge in the terrain and floor canvases. */
export const TEX = 4;

/**
 * Pixel-art crack patterns for damaged blocks at 4x4 texels per cell.
 * Subtle hairline fractures that spread as damage increases (like Minecraft's break stages).
 * 4 unique variants to avoid repetitive tiling.
 *
 * Each variant has:
 * - stage 1 (light damage, ~25-50%): 2-3 hairline crack texels
 * - stage 2 (moderate damage, ~50-75%): 4-6 branching crack texels
 * - stage 3 (heavy damage, ~75%+): 7-9 deep branching fracture texels
 */
export const CRACK_PATTERNS: readonly (readonly [
  readonly [number, number][], // stage 1
  readonly [number, number][], // stage 2
  readonly [number, number][], // stage 3
])[] = [
  // Variant 0: diagonal fracture upper-left to bottom-right
  [
    [[1, 1], [2, 2]],
    [[1, 1], [2, 2], [1, 2], [2, 3], [0, 1]],
    [[0, 0], [1, 1], [2, 2], [1, 2], [2, 3], [3, 3], [0, 1], [2, 1]],
  ],
  // Variant 1: cross / star split from center
  [
    [[2, 1], [2, 2]],
    [[2, 1], [2, 2], [1, 2], [3, 2], [2, 3]],
    [[2, 0], [2, 1], [2, 2], [1, 2], [0, 2], [3, 2], [2, 3], [3, 1]],
  ],
  // Variant 2: jagged zig-zag descending from top-right
  [
    [[2, 1], [1, 2]],
    [[3, 0], [2, 1], [1, 2], [1, 3], [2, 2]],
    [[3, 0], [2, 1], [1, 2], [1, 3], [0, 3], [2, 2], [3, 1], [1, 1]],
  ],
  // Variant 3: fork splitting near bottom-left
  [
    [[1, 2], [2, 1]],
    [[0, 3], [1, 2], [2, 1], [3, 1], [2, 3]],
    [[0, 3], [1, 2], [2, 1], [3, 1], [3, 0], [2, 3], [3, 3], [1, 1]],
  ],
];

/**
 * Returns crack texel intensity (0 = none, 1 = hairline, 2 = deep crack)
 * for a texel (ox, oy) within a cell (cx, cy) at damage fraction d (0..1).
 */
export function crackTexelAt(cx: number, cy: number, ox: number, oy: number, d: number): number {
  if (d < 0.25) return 0;
  const stage = d >= 0.75 ? 2 : d >= 0.5 ? 1 : 0;
  // Pick variant pseudo-randomly per cell coordinates
  const v = Math.floor(hash2(cx, cy, 337) * CRACK_PATTERNS.length) % CRACK_PATTERNS.length;
  const pattern = CRACK_PATTERNS[v][stage];
  for (let i = 0; i < pattern.length; i++) {
    const pt = pattern[i];
    if (pt[0] === ox && pt[1] === oy) {
      // First 2 points are the main fissures, later points are branches
      return i < 3 ? 2 : 1;
    }
  }
  return 0;
}

type RGB = readonly [number, number, number];

/** Base albedo of each tier's material (index = tier; 0 unused). */
export const MATERIAL_BASE: readonly RGB[] = [
  [0, 0, 0],
  [44, 40, 35], // weathered concrete / sandstone block
  [52, 31, 25], // rusted iron plate
  [34, 42, 33], // oxidized bronze bulkhead
  [42, 42, 52], // reinforced gunmetal
  [46, 30, 42], // fused resin hull (dark plum)
  [30, 40, 38], // chitin plating (blackened teal)
  [28, 22, 30], // black carapace
];

/**
 * Matte safety paint along the room-facing faces of walls and doors, in the
 * keycard colors: blue Tier 1, oxide red Tier 2, ochre Tier 3, violet reinforced.
 */
export const TIER_PAINT: readonly RGB[] = [
  [0, 0, 0],
  [62, 92, 138],
  [140, 42, 32],
  [164, 96, 30],
  [104, 78, 140],
  [92, 132, 58], // sickly green
  [176, 162, 128], // bone
  [124, 34, 64], // clotted crimson
];

/** Brightness multiplier of a tier's surface pattern at global texel (gx, gy). */
export function materialShade(tier: number, gx: number, gy: number): number {
  const grain = 0.93 + hash2(gx, gy, 211) * 0.14;
  switch (tier) {
    case 1: {
      // Blocks 4 cells long, 2 cells tall, each course offset by half a block.
      const course = Math.floor(gy / 8);
      const off = (course & 1) * 8;
      const bx = Math.floor((gx + off) / 16);
      if (gy % 8 === 0 || (gx + off) % 16 === 0) return 0.6 * grain;
      const block = 0.9 + hash2(bx, course, 17) * 0.2;
      const pit = hash2(gx, gy, 43) < 0.05 ? 0.72 : 1;
      // Upper lip of each block catches a little light.
      const lip = gy % 8 === 1 ? 1.1 : 1;
      return block * pit * lip * grain;
    }
    case 2: {
      // Plates 2 cells square; seam, highlight lip, corner rivets, rust streaks.
      const px = gx & 7;
      const py = gy & 7;
      if (px === 0 || py === 0) return 0.55 * grain;
      if (px === 1 || py === 1) return 1.14 * grain;
      if ((px === 2 || px === 6) && (py === 2 || py === 6)) return 1.4;
      const plate = 0.92 + hash2(gx >> 3, gy >> 3, 29) * 0.16;
      const streak = hash2(gx, gy >> 2, 61) < 0.18 ? 0.8 : 1;
      return plate * streak * grain;
    }
    case 3: {
      // Horizontal ribs every cell: a raised lit edge, then its shadow.
      const r = gy & 3;
      const rib = r === 0 ? 1.22 : r === 1 ? 0.78 : 1;
      const panel = (gx & 15) === 0 ? 0.62 : 1;
      return rib * panel * grain;
    }
    case 5: {
      // Fused resin: wandering ridges, each with a lit crest and a soft trough.
      const warp = valueNoise(gx, gy, 14, 501) * 9;
      const r = (gx * 0.35 + gy * 0.22 + warp) % 3;
      const ridge = r < 0.8 ? 1.2 : r < 1.6 ? 0.98 : 0.78;
      const blob = 0.9 + valueNoise(gx, gy, 6, 503) * 0.2;
      return ridge * blob * grain;
    }
    case 6: {
      // Chitin scales in offset rows: bright upper rim, darkening toward the lower edge.
      const row = gy >> 2;
      const sx = (gx + (row & 1) * 3) % 6;
      const sy = gy & 3;
      const rim = sy === 0 ? 1.25 : sy === 3 ? 0.66 : 1 - sy * 0.06;
      const edge = sx === 0 ? 0.72 : 1;
      const scale = 0.9 + hash2((gx + (row & 1) * 3) / 6 | 0, row, 601) * 0.2;
      return rim * edge * scale * grain;
    }
    case 7: {
      // Carapace: smooth dark plates split by branching veins.
      const v = valueNoise(gx, gy, 10, 701);
      const vein = Math.abs(v - 0.5) < 0.035 ? 0.5 : 1;
      const sheen = 0.88 + valueNoise(gx, gy, 18, 703) * 0.26;
      return vein * sheen * grain;
    }
    default: {
      // Tread plate: small raised diagonal lugs on a dark plate.
      const lx = gx & 3;
      const ly = gy & 3;
      const lug = (((gx >> 2) + (gy >> 2)) & 1) === 0 ? lx === ly : lx === 3 - ly;
      const seam = (gx & 15) === 0 || (gy & 15) === 0 ? 0.6 : 1;
      return (lug ? 1.28 : 0.94) * seam * grain;
    }
  }
}
