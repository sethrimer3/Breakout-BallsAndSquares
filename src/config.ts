/**
 * Central configuration for BREACH.
 * Every gameplay / balance / visual tunable lives here so it can be tweaked
 * without touching game systems.
 */

export const WORLD = {
  /** World width in cells. */
  width: 512,
  /** World height in cells. */
  height: 512,
  /** Logical world units per cell edge. */
  cellSize: 8,
  /** Edge length (cells) of the empty starting room. */
  roomSize: 10,
  /** Terrain chunk edge length in cells (rendering cache granularity). */
  chunkSize: 32,
  /** Seed for procedural color variation (0 = random each run). */
  seed: 0,
};

export const TERRAIN = {
  /** Depth (cells beyond the room edge) per additional point of max health. */
  healthBandWidth: 12,
  /** Hard cap on pixel health (must fit in a Uint8). */
  maxHealthCap: 12,
  /** Distance from center (Chebyshev, cells) still considered "room" for depth. */
  roomRadius: 5,
  /** Max dirty chunks rebuilt per rendered frame. */
  chunkRebuildBudget: 24,
  /** How long a damaged-cell hit flash lasts (seconds). */
  hitFlashTime: 0.09,
};

/** Configurable distance -> health curve (spec §3). */
export function maxHealthForDistance(distance: number): number {
  const depth = Math.max(0, distance - TERRAIN.roomRadius);
  return Math.min(TERRAIN.maxHealthCap, 1 + Math.floor(depth / TERRAIN.healthBandWidth));
}

export const SOLDIER = {
  /** Collision radius. Must be < cellSize / 2 so soldiers fit one-cell tunnels. */
  collisionRadius: 3.2,
  /** Visual body radius (purely cosmetic). */
  renderRadius: 4.5,
  /** Visual glow halo radius. */
  glowRadius: 7,
  /** Radius used when soldiers occlude light. */
  occluderRadius: 3.6,
  /** Base movement speed (units/s). */
  speed: 125,
  /** Base shots per second. */
  fireRate: 2.5,
  /** Base bullet damage. */
  damage: 1,
  /** Base bullet speed (units/s). */
  bulletSpeed: 520,
  /** Base multishot chance (0..1). */
  multishotChance: 0,
  /** Base max soldiers per run. */
  maxSoldiers: 1,
  /** Random rotation applied on each bounce (degrees, +/-), breaks axis-locked loops. */
  bounceJitterDeg: 1.5,
  /** Max distance a stuck soldier may be relocated (units). */
  maxRelocateDist: 12,
  /** Collision resolve iterations per substep. */
  resolveIterations: 4,
};

export const BULLET = {
  /** Seconds before an unimpacted bullet expires. */
  lifetime: 1.4,
  /** Extra distance in front of the soldier surface where bullets "appear". */
  muzzleGap: 2,
  /** Tracer length (units). */
  tracerLength: 14,
  /** Visual radius. */
  radius: 1.1,
  /** Multishot: number of extra side bullets on success (one per side pair). */
  multishotExtra: 2,
  /** Multishot spread (degrees from main direction). */
  multishotSpreadDeg: 8,
  /** Pool size. */
  poolSize: 1024,
};

export const CAMERA = {
  defaultZoom: 2.5,
  minZoom: 0.5,
  maxZoom: 8,
  /** Wheel zoom factor per notch. */
  wheelStep: 1.15,
  /** Follow smoothing (higher = snappier), per second. */
  followSharpness: 5,
  /** Auto-follow switches target only if another soldier is this many cells farther out. */
  switchHysteresisCells: 4,
};

export const SIM = {
  /** Fixed simulation step (seconds). */
  dt: 1 / 60,
  /** Max fixed steps per rendered frame (avoid spiral of death). */
  maxStepsPerFrame: 5,
};

export const COLORS = {
  background: "#05070d",
  backgroundGlow: "#0b1020",
  /** Terrain base palette (RGB). */
  terrainA: [30, 32, 40] as const, // charcoal
  terrainB: [38, 46, 64] as const, // slate blue
  terrainC: [46, 36, 60] as const, // dark desaturated purple
  /** Tint applied to damaged cells. */
  damage: [120, 70, 52] as const,
  soldierCore: "#1b2a3a",
  soldierHighlight: "#9ff3ff",
  soldierGlow: "rgba(110, 220, 255, 0.35)",
  bullet: "#fff2c4",
  tracer: "rgba(255, 214, 140, ",
  aim: "rgba(160, 230, 255, 0.55)",
};
