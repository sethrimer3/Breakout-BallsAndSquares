import { COLORS } from "../config";
import { hash2, valueNoise } from "../core/math";
import { SUB } from "../world/PixelWorld";

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

export type LateEnv = "forest" | "city" | "mothership";
export type LateFeature = "solid" | "cover" | "bulkhead" | "floor";

const _tmpRgb: [number, number, number] = [0, 0, 0];

function forestSolidTexel(tier: number, gx: number, gy: number, out: [number, number, number]): void {
  const grain = 0.92 + hash2(gx, gy, 211) * 0.16;
  if (tier <= 7) {
    // Tier 7: moss and loam with grass tufts
    const tuft = hash2(gx >> 1, gy >> 1, 709) < 0.28 && (gy & 1) === 0;
    if (tuft) {
      out[0] = 74 * grain;
      out[1] = 124 * grain;
      out[2] = 48 * grain;
    } else {
      out[0] = 50 * grain;
      out[1] = 86 * grain;
      out[2] = 38 * grain;
    }
  } else if (tier === 8) {
    // Tier 8: drier brown earth with leaf litter
    const leaf = hash2(gx, gy, 811) < 0.14;
    if (leaf) {
      out[0] = 104 * grain;
      out[1] = 70 * grain;
      out[2] = 36 * grain;
    } else {
      out[0] = 76 * grain;
      out[1] = 58 * grain;
      out[2] = 35 * grain;
    }
  } else {
    // Tier 9: dark Blight-stained soil with faint vein lines
    const vein = Math.abs(valueNoise(gx, gy, 10, 907) - 0.5) < 0.04;
    if (vein) {
      out[0] = 62 * grain;
      out[1] = 34 * grain;
      out[2] = 52 * grain;
    } else {
      out[0] = 24 * grain;
      out[1] = 36 * grain;
      out[2] = 26 * grain;
    }
  }
}

function forestFloorTexel(tier: number, gx: number, gy: number, out: [number, number, number]): void {
  const grain = 0.94 + hash2(gx, gy, 77) * 0.12;
  const blade = hash2(gx, gy, 313) < 0.22;
  if (tier <= 7) {
    out[0] = (blade ? 78 : 62) * grain;
    out[1] = (blade ? 122 : 102) * grain;
    out[2] = (blade ? 48 : 44) * grain;
  } else if (tier === 8) {
    out[0] = (blade ? 88 : 74) * grain;
    out[1] = (blade ? 72 : 62) * grain;
    out[2] = (blade ? 42 : 40) * grain;
  } else {
    out[0] = (blade ? 40 : 30) * grain;
    out[1] = (blade ? 48 : 40) * grain;
    out[2] = (blade ? 38 : 32) * grain;
  }
}

/**
 * Environment-specific matte pixel-art material for Worlds 3–5.
 * Supports continuous tier blending (e.g. `tier = 7.4` in Forest).
 * Pass `out` to avoid allocations inside tight texel loops.
 */
export function lateMaterial(
  env: LateEnv,
  tier: number,
  gx: number,
  gy: number,
  feature: LateFeature = "solid",
  out: [number, number, number] = _tmpRgb,
): RGB {
  const grain = 0.92 + hash2(gx, gy, 211) * 0.16;

  if (env === "forest") {
    if (feature === "cover") {
      // Tree trunks (ring/bark texture) or boulders, picked per 7x7 char block
      const isTree = hash2(Math.floor(gx / 28), Math.floor(gy / 28), 353) < 0.6;
      if (isTree) {
        const ring = Math.sin(Math.hypot((gx % 28) - 13.5, (gy % 28) - 13.5) * 0.85) > 0.2 ? 1.15 : 0.82;
        out[0] = 68 * ring * grain;
        out[1] = 48 * ring * grain;
        out[2] = 30 * ring * grain;
      } else {
        const ridge = valueNoise(gx, gy, 6, 359) > 0.52 ? 1.14 : 0.84;
        out[0] = 64 * ridge * grain;
        out[1] = 66 * ridge * grain;
        out[2] = 62 * ridge * grain;
      }
      return out;
    }

    const t0 = Math.floor(tier);
    const frac = tier - t0;
    if (feature === "floor") {
      if (frac <= 0.001) {
        forestFloorTexel(t0, gx, gy, out);
      } else {
        const a: [number, number, number] = [0, 0, 0];
        const b: [number, number, number] = [0, 0, 0];
        forestFloorTexel(t0, gx, gy, a);
        forestFloorTexel(t0 + 1, gx, gy, b);
        out[0] = a[0] + (b[0] - a[0]) * frac;
        out[1] = a[1] + (b[1] - a[1]) * frac;
        out[2] = a[2] + (b[2] - a[2]) * frac;
      }
      return out;
    }

    if (frac <= 0.001) {
      forestSolidTexel(t0, gx, gy, out);
    } else {
      const a: [number, number, number] = [0, 0, 0];
      const b: [number, number, number] = [0, 0, 0];
      forestSolidTexel(t0, gx, gy, a);
      forestSolidTexel(t0 + 1, gx, gy, b);
      out[0] = a[0] + (b[0] - a[0]) * frac;
      out[1] = a[1] + (b[1] - a[1]) * frac;
      out[2] = a[2] + (b[2] - a[2]) * frac;
    }
    return out;
  }

  if (env === "city") {
    if (feature === "bulkhead") {
      const stripe = ((gx + gy) & 4) === 0;
      out[0] = (stripe ? 142 : 44) * grain;
      out[1] = (stripe ? 104 : 40) * grain;
      out[2] = (stripe ? 30 : 42) * grain;
      return out;
    }
    if (feature === "cover") {
      // Car wrecks / concrete barricades
      const px = gx & 7;
      const py = gy & 7;
      const seam = px === 0 || py === 0 ? 0.65 : px === 1 ? 1.15 : 1;
      const rust = hash2(gx >> 1, gy >> 1, 419) < 0.2;
      out[0] = (rust ? 96 : 62) * seam * grain;
      out[1] = (rust ? 58 : 66) * seam * grain;
      out[2] = (rust ? 40 : 72) * seam * grain;
      return out;
    }
    if (feature === "floor") {
      // Asphalt with faded lane paint
      const lane = ((gx & 15) === 0 && (gy & 7) < 4) || ((gy & 15) === 0 && (gx & 7) < 4);
      if (lane) {
        out[0] = 88 * grain;
        out[1] = 80 * grain;
        out[2] = 56 * grain;
      } else {
        out[0] = 40 * grain;
        out[1] = 38 * grain;
        out[2] = 42 * grain;
      }
      return out;
    }
    // Fractured concrete and brick with rebar
    const course = Math.floor(gy / 6);
    const off = (course & 1) * 6;
    const mortar = gy % 6 === 0 || (gx + off) % 12 === 0;
    const rebar = !mortar && hash2(gx >> 2, gy >> 2, 431) < 0.08 && (gy & 3) === 2;
    if (mortar) {
      out[0] = 46 * grain;
      out[1] = 36 * grain;
      out[2] = 34 * grain;
    } else if (rebar) {
      out[0] = 104 * grain;
      out[1] = 52 * grain;
      out[2] = 36 * grain;
    } else {
      const brick = 0.9 + hash2(Math.floor((gx + off) / 12), course, 433) * 0.2;
      out[0] = 84 * brick * grain;
      out[1] = 54 * brick * grain;
      out[2] = 44 * brick * grain;
    }
    return out;
  }

  // Mothership
  if (feature === "bulkhead") {
    const stripe = ((gx - gy) & 4) === 0;
    out[0] = (stripe ? 132 : 34) * grain;
    out[1] = (stripe ? 76 : 24) * grain;
    out[2] = (stripe ? 148 : 48) * grain;
    return out;
  }
  if (feature === "cover") {
    // Reinforced blast pillars
    const px = gx & 7;
    const py = gy & 7;
    const bevel = px === 0 || py === 0 ? 0.62 : px === 1 || py === 1 ? 1.18 : 1;
    out[0] = 54 * bevel * grain;
    out[1] = 40 * bevel * grain;
    out[2] = 72 * bevel * grain;
    return out;
  }
  if (feature === "floor") {
    // Ribbed deck panels: noticeably darker than hull walls for clear figure-ground contrast
    const panel = (gx & 15) === 0 || (gy & 15) === 0 ? 0.65 : 1;
    const rib = (gy & 3) === 0 ? 1.15 : 0.94;
    out[0] = 20 * panel * rib * grain;
    out[1] = 16 * panel * rib * grain;
    out[2] = 30 * panel * rib * grain;
    return out;
  }
  // Organic-metal hull plates with seams
  const px = gx & 7;
  const py = gy & 7;
  const seam = px === 0 || py === 0 ? 0.58 : px === 1 || py === 1 ? 1.18 : 1;
  const rib = valueNoise(gx, gy, 10, 521) > 0.58 ? 1.1 : 0.92;
  out[0] = 56 * seam * rib * grain;
  out[1] = 36 * seam * rib * grain;
  out[2] = 78 * seam * rib * grain;
  return out;
}

/** Preview albedos only; later-world biome art/materials are still placeholders. */
const FRAMEWORK_BASE: Readonly<Record<number, RGB>> = {
  7: [55, 94, 43], 8: [80, 62, 37], 9: [24, 39, 28], 10: [86, 48, 29], 11: [44, 29, 61],
};
export function materialColor(tier: number, framework = false): RGB {
  return (framework ? FRAMEWORK_BASE[tier] : undefined) ?? MATERIAL_BASE[tier] ?? MATERIAL_BASE[MATERIAL_BASE.length - 1];
}

type Ramp4 = readonly [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]];

function sampleSubRamp(ramp: Ramp4, t: number, out: number[]): void {
  const s = t * 3;
  const idx = Math.min(2, Math.floor(s));
  const f = s - idx;
  const a = ramp[idx];
  const b = ramp[idx + 1];
  out[0] = a[0] + (b[0] - a[0]) * f;
  out[1] = a[1] + (b[1] - a[1]) * f;
  out[2] = a[2] + (b[2] - a[2]) * f;
}

/** Albedo of a live half-size pixel, before relief shading. */
export function subPixelColor(
  kind: number,
  tint: number,
  sy: number,
  hp: number,
  maxHp: number,
  dormant: boolean,
  out: number[],
): void {
  const subT = tint / 255;
  if (kind === SUB.rubble) {
    const pal = COLORS.rubble;
    const c = pal[(tint & 7) % pal.length];
    const v = 0.82 + ((tint >> 3) / 32) * 0.36;
    out[0] = c[0] * v;
    out[1] = c[1] * v;
    out[2] = c[2] * v;
  } else if (kind === SUB.metal || kind === SUB.pipe) {
    sampleSubRamp(kind === SUB.metal ? COLORS.labMetal : COLORS.labPipe, 0.3 + subT * 0.4, out);
  } else if (kind === SUB.led) {
    const c = COLORS.labLed[tint >> 6];
    out[0] = 24 + c[0] * 0.22;
    out[1] = 24 + c[1] * 0.22;
    out[2] = 28 + c[2] * 0.22;
  } else if (kind === SUB.core) {
    const c = COLORS.labCore[tint >> 6];
    out[0] = c[0] * 0.6;
    out[1] = c[1] * 0.6;
    out[2] = c[2] * 0.6;
  } else if (kind === SUB.wreck) {
    sampleSubRamp(COLORS.labWreck, subT, out);
  } else if (kind === SUB.screen) {
    const c = COLORS.labScreen[(tint >> 6) & 3];
    const v = (sy & 1) === 0 ? 0.95 : 0.7;
    out[0] = c[0] * v;
    out[1] = c[1] * v;
    out[2] = c[2] * v;
  } else {
    sampleSubRamp(COLORS.pinkBlight, subT, out);
  }
  if (dormant) {
    const rot = hp < maxHp ? 1 - hp / maxHp : 0;
    const lum = (out[0] + out[1] + out[2]) / 3;
    const k = 0.5 - rot * 0.3;
    out[0] = (lum * 0.55 + out[0] * 0.45) * k;
    out[1] = (lum * 0.55 + out[1] * 0.45) * k * 0.85;
    out[2] = (lum * 0.55 + out[2] * 0.45) * k * 1.1;
  } else if (hp < maxHp) {
    const d = 1 - hp / maxHp;
    const lighten = d * 0.55;
    out[0] += (255 - out[0]) * lighten;
    out[1] += (255 - out[1]) * lighten;
    out[2] += (255 - out[2]) * lighten;
  }
}

/**
 * Apply the 2×2 micro-grain and bevel relief shading for one texel `(ox, oy)`
 * of a half-size pixel originating at `(origSx, origSy)`.
 */
export function subPixelTexelShade(
  kind: number,
  origSx: number,
  origSy: number,
  ox: number,
  oy: number,
  subUp: boolean,
  subLeft: boolean,
  subDown: boolean,
  subRight: boolean,
  col: readonly number[],
  out: number[],
): void {
  const flat = kind === SUB.screen || kind === SUB.led || kind === SUB.core;
  let m = flat ? 1 : 0.92 + hash2(origSx * 2 + ox, origSy * 2 + oy, 5) * 0.16;
  let add = 0;
  if ((subUp && oy === 0) || (subLeft && ox === 0)) {
    m *= 1.4;
    add = 8;
  } else if ((subDown && oy === 1) || (subRight && ox === 1)) {
    m *= 0.7;
  }
  out[0] = Math.min(255, Math.max(0, Math.round(col[0] * m + add)));
  out[1] = Math.min(255, Math.max(0, Math.round(col[1] * m + add)));
  out[2] = Math.min(255, Math.max(0, Math.round(col[2] * m + add)));
}
