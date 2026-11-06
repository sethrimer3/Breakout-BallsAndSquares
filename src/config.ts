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
  /** Hard cap on pixel health (must fit in a Uint16). */
  maxHealthCap: 500,
  /** Distance from center (Chebyshev, cells) still considered "room" for depth. */
  roomRadius: 5,
  /** Max dirty chunks rebuilt per rendered frame. */
  chunkRebuildBudget: 24,
  /** How long a damaged-cell hit flash lasts (seconds). */
  hitFlashTime: 0.09,
  /** Depth (cells beyond the room edge) where Zone 2 starts. */
  zone2Depth: 32,
  /** Depth (cells beyond the room edge) where Zone 3 starts. */
  zone3Depth: 52,
};

/** 0 = Zone 1 (slate/grey/brown), 1 = Zone 2 (burnt orange/red/maroon/cream), 2 = Zone 3 (dark green/blue/turquoise/chartreuse). */
export function zoneForDepth(depth: number): 0 | 1 | 2 {
  if (depth < TERRAIN.zone2Depth) return 0;
  if (depth < TERRAIN.zone3Depth) return 1;
  return 2;
}

/** Configurable distance -> health curve with order-of-magnitude tier progression. */
export function maxHealthForDistance(distance: number): number {
  const depth = Math.max(0, distance - TERRAIN.roomRadius);
  if (depth < TERRAIN.zone2Depth) {
    // Tier 1 (Zone 1): 1 - 5 HP
    const span = Math.max(1, TERRAIN.zone2Depth - 1);
    return Math.min(5, Math.max(1, 1 + Math.floor((depth * 4) / span)));
  } else if (depth < TERRAIN.zone3Depth) {
    // Tier 2 (Zone 2): 10 - 50 HP (order of magnitude tougher)
    const depthInZone = depth - TERRAIN.zone2Depth;
    const span = Math.max(1, TERRAIN.zone3Depth - TERRAIN.zone2Depth - 1);
    return Math.min(50, Math.max(10, 10 + Math.floor((depthInZone * 40) / span)));
  } else {
    // Tier 3 (Zone 3): 100 - 500 HP
    const depthInZone = depth - TERRAIN.zone3Depth;
    const span = 40;
    return Math.min(TERRAIN.maxHealthCap, Math.max(100, 100 + Math.floor((depthInZone * 400) / span)));
  }
}

/**
 * Health of a lab wall cell in `zone` (0, 1, 2).
 * Zone 0 walls use Zone 1's material; Zone 1 walls use Zone 2's material;
 * Zone 2 (last zone) walls use reinforced wall material.
 */
export function wallHealthForZone(zone: 0 | 1 | 2, distance: number): number {
  const baseHp = maxHealthForDistance(distance);
  if (zone === 0) {
    return Math.min(TERRAIN.maxHealthCap, Math.max(10, baseHp * 2));
  }
  if (zone === 1) {
    return Math.min(TERRAIN.maxHealthCap, Math.max(100, baseHp * 2));
  }
  return Math.min(TERRAIN.maxHealthCap, Math.max(300, baseHp + 50));
}

/** Size of one pixel-art pixel (soldier sprites, bullets) in world units. */
export const ART_PIXEL = 1;

export const SOLDIER = {
  /** Collision radius. Must be < cellSize / 2 so soldiers fit one-cell tunnels. */
  collisionRadius: 3.2,
  /** Visual body radius (purely cosmetic), in world units = pixel-art pixels. */
  renderRadius: 4.5,
  /** Outer radius of the one-pixel ring drawn around each soldier sphere. */
  ringRadius: 8.5,
  /** Radius used when soldiers occlude light. */
  occluderRadius: 3.6,
  /** Base movement speed (units/s). Cut in half: 125 -> 62.5 */
  speed: 62.5,
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

export const SHOTGUN = {
  /** Base shots per second. */
  fireRate: 1.0,
  /** Base damage per pellet. */
  damage: 1,
  /** Base pellets per blast. */
  pellets: 5,
  /** Base pellet velocity (units/s). */
  bulletSpeed: 460,
  /** Base half-angle spread cone (degrees). */
  spreadDeg: 18,
  /** Base pellet lifetime (seconds) -> short-to-mid range blast. */
  lifetime: 0.48,
};

export const ASSAULT_RIFLE = {
  /** Fast automatic fire rate (shots/s). */
  fireRate: 6.5,
  /** Base damage per round. */
  damage: 1,
  /** Base bullet speed (units/s). */
  bulletSpeed: 580,
  /** Base half-angle spread jitter (degrees). */
  spreadDeg: 3.5,
  /** Base pierce count (extra blocks penetrated after first impact; upgrades up to 5). */
  pierce: 0,
  /** Bullet lifetime (seconds). */
  lifetime: 1.3,
};

export const ROCKET_LAUNCHER = {
  /** Base shots per second. */
  fireRate: 0.45,
  /** Direct impact / epicenter damage. */
  damage: 4,
  /** Rocket travel velocity (units/s). */
  bulletSpeed: 310,
  /** Explosion radius in cells. */
  blastRadiusCells: 2.5,
  /** Cluster mini-bombs spawned on detonation. */
  clusterCount: 0,
  /** Rocket lifetime (seconds). */
  lifetime: 2.2,
};

export const SNIPER_RIFLE = {
  /** Base shots per second (high-caliber bolt action). */
  fireRate: 0.65,
  /** High single-target & line-penetration damage. */
  damage: 6,
  /** Hyper-velocity round speed (units/s). */
  bulletSpeed: 980,
  /** Base pierce count (penetrates multiple blocks in a line). */
  pierce: 2,
  /** Critical strike chance (0..1) for 2x damage. */
  critChance: 0,
  /** Bullet lifetime (seconds). */
  lifetime: 1.8,
};

export const KATANA = {
  /** Base swings per second. */
  fireRate: 2.2,
  /** Base damage per slash against normal blocks. */
  damage: 3,
  /** Damage multiplier that ONLY affects blight blocks. */
  blightMultiplier: 3.0,
  /** Slash wave velocity (units/s). */
  bulletSpeed: 420,
  /** Base pierce count (blocks penetrated per slash). */
  pierce: 3,
  /** Slash arc width in world units (perpendicular to slash cut). */
  slashWidth: 16,
  /** Slash lifetime (seconds). */
  lifetime: 0.28,
};

export const GRENADE = {
  /** Energy requirement to activate sticky grenade. */
  energyRequired: 90,
  /** Number of blocks broken required to activate (legacy alias). */
  blocksRequired: 90,
  /** Thrown velocity in world units/sec. */
  throwSpeed: 190,
  /** Fuse duration after sticking before detonation (seconds). */
  fuseSeconds: 0.9,
  /** Explosion blast radius in grid cells. */
  blastRadiusCells: 2.8,
  /** Center explosion damage against blocks. */
  damage: 8,
  /** Number of shrapnel bullets expelled on detonation. */
  shrapnelCount: 0,
  /** Damage multiplier against blight blocks. */
  blightMultiplier: 2.0,
  /** Object pool capacity. */
  poolSize: 32,
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

export const GROWTH = {
  /** Seconds at the start of a run with zero growth (starts at 5s, upgrades to 15s). */
  graceSeconds: 5,
  /** Initial successful copy events per second right after the grace period. */
  baseRate: 1.0,
  /** Exponential base per elapsed second after the grace period. */
  expBase: 1.055,
  /** Hard cap on copy events per second. */
  maxRate: 150,
  /** Max copy events executed in a single fixed step (bounds frame spikes). */
  maxEventsPerStep: 12,
  /** How long a newly grown cell pulses crimson/magenta (seconds). */
  glowDuration: 0.65,
  /** Ring buffer size for growth-glow visuals. */
  glowCap: 4096,
  /** Rev 2 telemetry: cell distance within which a growth event counts as "near a soldier". */
  nearRadiusCells: 12,
  /** Rolling window (seconds) for the near-soldier growth % metric. */
  telemetryWindow: 10,
  /**
   * Rev 2 optional localized pressure (0 = pure uniform frontier pick).
   * If > 0, this fraction of events rejection-samples near a random living soldier first.
   */
  localBias: 0,
  /** Half-width (cells) of the local sampling box around a soldier. */
  localRadiusCells: 16,
  /** Rejection-sample attempts before falling back to uniform pick. */
  localSamples: 12,
  /** Seconds subtracted from the blight timer when the player destroys a Blight Core. */
  coreKillTimeReduction: 12,
  /** Health bonus added to a Blight Core cell relative to normal cell health at its distance. */
  coreHealthBonus: 4,
};

/** Growth rate (copy events / second) at `runTime` seconds into the run (spec §7). */
export function growthRateAt(runTime: number, startRate = GROWTH.baseRate): number {
  if (runTime < GROWTH.graceSeconds) return 0;
  const elapsed = Math.max(0, runTime - GROWTH.graceSeconds);
  return Math.min(GROWTH.maxRate, Math.max(0, startRate + Math.pow(GROWTH.expBase, elapsed) - 1));
}

export const LIGHT = {
  /** Maximum radius (world units) of a muzzle-flash shadow light (spec §6: 100..130). */
  radius: 122,
  /** Flash duration (seconds, spec §6: 60..100ms). */
  flashDuration: 0.085,
  /** Evenly spaced base rays around the flash. */
  baseRays: 96,
  /** Extra rays concentrated within +/-30° of the firing direction. */
  coneRays: 16,
  /** Angular offset (radians) on either side of a silhouette corner / tangent. */
  cornerEpsilon: 0.00055,
  /** Hard cap on corner-pair rays per light (2 rays per corner). */
  maxCornerRays: 1024,
  /** Hard cap on total rays / polygon vertices per light. */
  maxRays: 2048,
  /**
   * Polygon overdraw past a wall face (world units). Hidden by the terrain mask;
   * it only guarantees air light reaches the rendered wall pixels with no seam.
   */
  faceOverdraw: 1.25,
  /** Hard cap on wall cells lit by a single light. */
  maxLitCells: 4096,
  /** Fraction of wall light added on top of the multiplied scene. */
  wallScatter: 0.22,
  /** Max simultaneous shadow-casting flashes; older/excess flashes fall back to cheap glow. */
  maxShadowLights: 20,
  /** Ambient darkness RGB multiplied over the scene (low = dark atmosphere). */
  ambientRgb: [46, 52, 74] as const,
  /** Faint ambient self-glow radius around each soldier (world units). */
  soldierLightRadius: 34,
  /** Soldier self-glow strength. */
  soldierLightStrength: 0.55,
  /** Faint glow radius at the center of the spawn room (world units). */
  roomLightRadius: 54,
  /** Spawn-room glow strength. */
  roomLightStrength: 0.28,
  /** Evenly spaced base rays for soldier / room glows (corners add precision). */
  softBaseRays: 48,
  /** Max soldier glows that cast shadows; the rest light open air only. */
  maxSoftShadowLights: 48,
  /** Auto-downgrade quality if lighting takes longer than this (ms). */
  budgetMs: 4.2,
  /** Consecutive over-budget frames before downgrading (ignores one-off spikes). */
  budgetFrames: 12,
};

export const CASING = {
  poolSize: 400,
  minSpeed: 58,
  maxSpeed: 92,
  /** Seconds before a casing finishes fading. */
  minLife: 1.1,
  maxLife: 1.85,
  drag: 4.5,
  gravity: 38,
};

export const LOOT = {
  /** Maximum active golden square pickups (SoA pool capacity). */
  poolSize: 8192,
  /** Base probability (0..1) of a destroyed pixel dropping a golden square (1/5 = 0.2). */
  baseDropChance: 0.2,
  /** Base attraction radius (world units) within which pickups are pulled toward a soldier. */
  baseMagnetRange: 32,
  /** Base time (seconds) before an uncollected pickup despawns. */
  baseLifetime: 6,
  /** Distance from soldier center (world units) at which a pickup is collected. */
  pickupRadius: 6.5,
  /** Initial scatter speed range when popped out of a broken block (units/s). */
  minPopSpeed: 18,
  maxPopSpeed: 55,
  /** Air drag applied to scatter velocity. */
  drag: 5.5,
  /** Magnetic pull acceleration (units/s²). */
  magnetAccel: 540,
  /** Max magnetic pull speed (units/s). */
  magnetMaxSpeed: 380,
  /** Blight Essence drops erupting from a destroyed Blight Core, by the core's zone. */
  coreEssence: [3, 5, 8] as const,
  /** Blight Essence lingers this many times longer than other pickups. */
  essenceLifetimeMult: 3,
};

export const COLORS = {
  background: "#05070d",
  backgroundGlow: "#0b1020",
  /** Terrain base palette (RGB) for Zone 1: muted dark greys, blues, browns. */
  terrainA: [30, 32, 38] as const, // muted dark grey
  terrainB: [34, 46, 62] as const, // muted slate blue
  terrainC: [52, 41, 34] as const, // muted dark brown
  /** Zone 1..3 four-stop color ramps (RGB). */
  zone1: [
    [28, 30, 36], // dark charcoal grey
    [34, 46, 62], // muted dark blue
    [44, 44, 50], // muted slate grey
    [54, 41, 33], // muted dark brown
  ] as const,
  zone2: [
    [76, 38, 22], // muted burnt orange
    [64, 22, 24], // dark red
    [48, 18, 28], // dark maroon
    [74, 62, 46], // dark cream
  ] as const,
  zone3: [
    [22, 48, 34], // dark green
    [22, 40, 62], // dark blue
    [22, 58, 60], // dark turquoise
    [54, 64, 26], // muted chartreuse
  ] as const,
  /** Reinforced bulkhead wall material used for walls in the deepest zone (Zone 3). */
  reinforcedWall: [
    [72, 78, 94], // cold titanium slate
    [52, 44, 76], // dark amethyst alloy
    [88, 94, 112], // brushed steel bulkhead
    [64, 54, 88], // reinforced violet-grey plating
  ] as const,
  /** Pink blight subcell four-stop color ramp (RGB) for 50% sub-pixels grown by Blight Cores. */
  pinkBlight: [
    [175, 24, 96], // deep magenta-pink
    [215, 38, 122], // vivid blight pink
    [245, 68, 152], // bright hot pink
    [255, 118, 188], // glowing pale pink highlight
  ] as const,
  /** Lab detail colors, indexed by `DECOR` in world/LabDetails.ts. */
  labDecor: [
    [0, 0, 0], // none
    [58, 68, 78], // floor: sterile steel
    [78, 90, 102], // floor tile line
    [70, 150, 160], // corridor guide line
    [120, 30, 70], // blight stain
    [96, 104, 116], // blast door
    [30, 34, 42], // door seam
    [90, 230, 150], // door jamb light
    [190, 150, 40], // hazard yellow
    [24, 24, 28], // hazard black
    [104, 114, 128], // equipment frame
    [120, 200, 210], // tank glass
    [50, 170, 130], // specimen fluid
    [120, 255, 170], // status LED
    [36, 42, 54], // dark panel
    [128, 118, 100], // bench top
    [170, 176, 184], // bunk linen
    [22, 16, 16], // scorched breach
    [76, 14, 46], // dark pink blight overrun floor
    [138, 24, 78], // dark pink blight vein / tendril
    [185, 28, 98], // blight core outer shell
    [255, 72, 164], // blight core pulsing heart
  ] as const,
  /** How strongly each lab detail covers the cell's own color (same order). */
  labDecorMix: [0, 0.45, 0.55, 0.7, 0.55, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0.85, 0.92, 1, 1] as const,
  /** Emergency-power glow added over the dark scene (same order; black = none). */
  labGlow: [
    [0, 0, 0], // none
    [0, 0, 0], // floor
    [7, 9, 12], // floor tile line
    [14, 42, 48], // corridor guide line
    [44, 8, 26], // blight stain
    [0, 0, 0], // blast door
    [0, 0, 0], // door seam
    [50, 170, 100], // door jamb light
    [70, 52, 10], // hazard yellow
    [0, 0, 0], // hazard black
    [0, 0, 0], // equipment frame
    [40, 90, 100], // tank glass
    [20, 90, 70], // specimen fluid
    [70, 190, 110], // status LED
    [0, 0, 0], // dark panel
    [0, 0, 0], // bench top
    [0, 0, 0], // bunk linen
    [0, 0, 0], // scorched breach
    [52, 8, 30], // dark pink blight overrun floor
    [110, 18, 64], // dark pink blight vein / tendril
    [175, 28, 96], // blight core outer shell
    [255, 90, 180], // blight core pulsing heart
  ] as const,
  /** Tint applied to damaged cells. */
  damage: [120, 70, 52] as const,
  soldierCore: "#1b2a3a",
  soldierHighlight: "#9ff3ff",
  soldierGlow: "rgba(110, 220, 255, 0.35)",
  bullet: "#fff2c4",
  tracer: "rgba(255, 214, 140, ",
  aim: "rgba(160, 230, 255, 0.55)",
};
