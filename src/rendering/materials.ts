import { hash2 } from "../core/math";

/**
 * Matte wall materials, one per terrain tier, painted at quarter-pixel
 * resolution (4 texels per world cell). Tiers read apart by surface pattern and
 * hue rather than by glow:
 *
 * - Tier 1: coursed concrete/stone block with dark mortar joints.
 * - Tier 2: rusted iron plate with seams, rivets and rust streaks.
 * - Tier 3: ribbed oxidized-bronze bulkhead.
 * - Tier 4: reinforced gunmetal tread plate.
 */

/** Texels per world cell edge in the terrain and floor canvases. */
export const TEX = 4;

type RGB = readonly [number, number, number];

/** Base albedo of each tier's material (index = tier; 0 unused). */
export const MATERIAL_BASE: readonly RGB[] = [
  [0, 0, 0],
  [44, 40, 35], // weathered concrete / sandstone block
  [52, 31, 25], // rusted iron plate
  [34, 42, 33], // oxidized bronze bulkhead
  [42, 42, 52], // reinforced gunmetal
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
