/**
 * Central configuration for BREACH.
 * Every gameplay / balance / visual tunable lives here so it can be tweaked
 * without touching game systems.
 */

export const WORLD = {
  /** World width in cells (holds the biggest lab world, 13 × 13 sectors, plus its gates). */
  width: 672,
  /** World height in cells. */
  height: 672,
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
  /**
   * Depth (cells beyond the room edge) where Zone 2 starts: the inner edge of
   * the hand-made lab's sector ring 2 (sectors are 49 cells, see labMap.ts).
   */
  zone2Depth: 69,
  /** Depth (cells beyond the room edge) where Zone 3 starts: the inner edge of sector ring 3. */
  zone3Depth: 118,
  /** Depth past the start of Zone 3 over which its blocks climb from 100 HP to the cap. */
  zone3Span: 100,
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
    const span = TERRAIN.zone3Span;
    return Math.min(TERRAIN.maxHealthCap, Math.max(100, 100 + Math.floor((depthInZone * 400) / span)));
  }
}

/**
 * Health of an ordinary block of `tier` (1 = blue zone 1 .. 3 = burnt orange
 * zone 3) at `distance`: the normal distance curve held inside that tier's
 * band (1-5, 10-50, 100+), so a tier keeps its toughness wherever it sits.
 */
export function blockHealthForTier(tier: 1 | 2 | 3, distance: number): number {
  const hp = maxHealthForDistance(distance);
  if (tier === 1) return Math.min(5, Math.max(1, hp));
  if (tier === 2) return Math.min(50, Math.max(10, hp));
  return Math.min(TERRAIN.maxHealthCap, Math.max(100, hp));
}

/**
 * Health of a lab wall cell in `zone` (0, 1, 2).
 * Zone 0 walls use Zone 1's material; Zone 1 walls use Zone 2's material;
 * Zone 2 (last zone) walls use reinforced wall material.
 */
export function wallHealthForZone(zone: 0 | 1 | 2, distance: number): number {
  const baseHp = maxHealthForDistance(distance);
  if (zone === 0) {
    // Tier 2 material, toughened so corridors beat tunnelling until the squad is strong.
    return Math.min(TERRAIN.maxHealthCap, Math.max(FACILITY.zone1WallHealth, baseHp * 2));
  }
  if (zone === 1) {
    return Math.min(TERRAIN.maxHealthCap, Math.max(100, baseHp * 2));
  }
  return Math.min(TERRAIN.maxHealthCap, Math.max(300, baseHp + 50));
}

/**
 * Ordinary block health of each terrain tier in the hand-made lab worlds
 * (index = tier): [first sector of the tier band, last]. Zone 1 holds tiers
 * 1-3, zone 2 tiers 4-6. Health is a Uint16, so nothing may pass 65535.
 */
export const TIER_HEALTH: readonly (readonly [number, number])[] = [
  [1, 1],
  [1, 5],
  [10, 50],
  [100, 500],
  [800, 2400],
  [3000, 9000],
  [12000, 30000],
  [800, 2400],
  [3000, 9000],
  [12000, 30000],
  [24000, 45000],
  [50000, 65000],
];

/** Highest terrain tier with stats. */
export const MAX_TIER = TIER_HEALTH.length - 1;

/** Health of an ordinary block of `tier`, `t` (0..1) of the way through its band. */
export function tierHealth(tier: number, t: number): number {
  const [lo, hi] = TIER_HEALTH[Math.max(1, Math.min(MAX_TIER, tier))];
  return Math.round(lo + (hi - lo) * Math.max(0, Math.min(1, t)));
}

/**
 * Health of a lab wall in a band whose ordinary blocks are `tier`. Walls are
 * built of the next tier's material and stay well above tunnelling strength.
 */
export function tierWallHealth(tier: number, t: number): number {
  const hp = tierHealth(tier, t);
  if (tier <= 1) return FACILITY.zone1WallHealth;
  if (tier === 2) return Math.max(100, hp * 2);
  if (tier === 3) return Math.min(TERRAIN.maxHealthCap, Math.max(300, hp + 50));
  return Math.min(65000, Math.round(hp * 2.5));
}

/** Research-base structures: doors, glass containment tanks, rubble and sentries. */
export const FACILITY = {
  /** Minimum health of a Zone 1 wall (Tier 2 material). */
  zone1WallHealth: 25,
  /** Hits on a locked world gate (within `gateHitWindow` seconds) before the "access needed" notice shows. */
  gateHitsForNotice: 6,
  gateHitWindow: 2.5,
  /** Notice timeline (seconds): rise and fade in, float, fade out. */
  gateNoticeRise: 0.45,
  gateNoticeHold: 1,
  gateNoticeFade: 0.55,
  /** Cells the notice climbs from the middle of the gate. */
  gateNoticeLift: 4,
  /** Blight Flower spawn rate and caps are multiplied by this in Blight-remade worlds. */
  alienFlowerMult: 3,
  /** Share of open cells beside a wall that grow a Blight crust in Blight-remade worlds. */
  alienCrustChance: 0.62,
  /** Extra decay score everywhere in a Blight-remade world (so rooms read decayed). */
  alienDecay: 0.5,
  /** Seconds between neighbouring glass blocks shattering in a chain. */
  glassChainDelay: 0.05,
  /** Glass health as a share of the zone's normal block health. */
  glassHealthMult: 0.5,
  /** Seconds between door cells sliding open, from the middle outward. */
  doorOpenStep: 0.03,
  /** Chance a normal room holds a row of glass specimen tanks. */
  tankRoomChance: 0.45,
  /** Chance a row of tanks shares its glass walls (so one break shatters the row). */
  tankSharedWallChance: 0.6,
  /** Chance a hallway is choked with collapsed rubble. */
  rubbleCorridorChance: 0.3,
  /** Crystal veins rolled per tier 2 / tier 3 sector each run (inclusive range). */
  crystalVeinsMin: 2,
  crystalVeinsMax: 4,
  /** Cells per crystal vein (inclusive range). */
  crystalVeinMin: 3,
  crystalVeinMax: 7,
  /** Crystals dropped per broken vein cell, before drop-rate upgrades. */
  crystalVeinDrops: 2.5,
  /** Collapsed hallways cave in about once per this many cells of length... */
  caveInSpacing: 26,
  /** ...up to this many cave-ins per hallway. */
  caveInsPerHallMax: 3,
  /** Radius range of a cave-in's rubble heap, in cells. */
  caveInRadiusMin: 3.5,
  caveInRadiusMax: 7,
  /** Walls within this share of a cave-in's radius collapse into the heap. */
  caveInWallBreak: 0.9,
  /** Stray stones scatter out to this multiple of the heap radius... */
  caveInScatter: 2.2,
  /** ...filling this share of the sub-pixels just past the heap's edge. */
  caveInStrayChance: 0.15,
  /** Chance a decayed or overrun room has a wall section caved in. */
  roomCaveInChance: 0.35,
  /** Chance each wall of a lab room gets half-size equipment (consoles, racks, pipes, machines). */
  equipmentSideChance: 0.8,
  /** Chance a clear hallway carries a pipe run along one side. */
  corridorPipeChance: 0.35,
  /** Half-size pixel health as a share of a full-size block's health at the same spot. */
  subHealthMult: 0.25,
  /**
   * Extra multiplier for half-size decor (consoles, computers, machines) on top of
   * `subHealthMult`, so set dressing breaks before rubble, walls and structure.
   */
  decorHealthMult: 0.5,
  /** Chance a lab room gets free-standing machines, workstations and benches. */
  machineRoomChance: 0.85,
  /** Most free-standing pieces tried per room (fewer fit in small or crowded rooms). */
  machinesPerRoom: 5,
  /** Chance a lab room is a server farm: rows of blinking racks instead of machines. */
  serverRoomChance: 0.18,
  /** Chance a clear hallway gets wall terminals, junction boxes and emergency beacons. */
  corridorFixtureChance: 0.6,
  /** Loose scraps of smashed equipment scattered over an overrun room's floor, per cell of room edge. */
  overrunDebrisPerCell: 1.2,
  /** Chance each wall piece in an overrun room survives as smashed wreckage. */
  wreckSideChance: 0.7,
  /**
   * Room condition. Each room and hallway gets a decay score from how close it is
   * to a Blight-overrun room, how deep its zone is, and some noise: below
   * `pristineBelow` it is clean and brightly lit, above `decayedAbove` it is
   * grimy, cracked, stained and lit by failing tubes, and worn in between.
   */
  decayReachCells: 34,
  /** Distance (cells) from an overrun room's center inside which decay is strongest. */
  decayCoreCells: 10,
  decayPerZone: 0.14,
  decayNoise: 0.5,
  pristineBelow: 0.34,
  decayedAbove: 0.62,
  /** Lightmap brightness of the even wash over pristine rooms and halls (0..1). */
  washStrength: 0.08,
  /** Radius (cells) of the pool of light under each ceiling panel (shadow-traced). */
  panelRadiusCells: 9,
  /** Evenly spaced base rays per panel light (terrain corners add precision). */
  panelBaseRays: 64,
  /** Most stale panel lights re-traced per frame (panels are cached until nearby terrain changes). */
  panelTracesPerFrame: 6,
  /** Lightmap strength of the pink glow a living Blight Core throws over its room. */
  blightGlowStrength: 0.4,
  /** Spacing (cells) of ceiling light panels in rooms and hallways. */
  panelPitch: 6,
  /** Share of worn-area panels that are dead or flickering. */
  wornDeadChance: 0.25,
  wornFlickerChance: 0.15,
  /** Share of decayed-area panels that still sputter (the rest are dead). */
  decayedFlickerChance: 0.3,
  /** Chance a decayed room's wall is blown out (pristine rooms never are). */
  decayedBreachChance: 0.5,
  /** Chance a worn room's wall is blown out. */
  wornBreachChance: 0.15,
  /** Chance a decayed room's equipment piece is smashed, pixel by pixel. */
  decayedWreckChance: 0.45,
  /** Chance a room holds a dormant sentry turret. */
  sentryRoomChance: 0.4,
  /** Blight generation rate of a small (1×1) generator relative to a full Blight Core. */
  smallCoreRateMult: 0.5,
  /** Blight timer reduction of a small generator relative to a full Blight Core. */
  smallCoreTimeMult: 0.5,
  /** Sentry targeting range, in cells. */
  sentryRangeCells: 16,
  sentryDamage: 2,
  sentryFireRate: 2.5,
  sentryTurnSpeed: Math.PI * 1.2,
};

/** Biological Blight enemies: flowers, worms and escaped tank specimens. */
export const CREATURES = {
  /** Flowers: chance per second that an exposed, living colony sprouts one (scaled by its size). */
  flowerSpawnPerSec: 0.18,
  /** Colony size (half-size pixels) at which the flower chance is at full strength. */
  flowerColonySize: 600,
  /** Max flowers alive at once, plus this many per minute of run time. */
  flowerCap: 4,
  flowerCapPerMinute: 2,
  flowerCapMax: 24,
  /** No new flower within this many world units of another. */
  flowerSpacing: 40,
  flowerHealth: 3,
  flowerRange: 112,
  flowerCooldown: 3.6,
  /** Seconds the petals spread before a spore launches. */
  flowerWindup: 0.8,
  sporeSpeed: 58,
  sporeLife: 3,
  /** Blast radius of a spore (world units). */
  sporeRadius: 9,
  sporeDamage: 1,

  /** Worms appear after this many seconds of run time. */
  wormStartSeconds: 19,
  /** Chance per second, per exposed living colony, that a worm crawls out. */
  wormSpawnPerSec: 0.035,
  wormCap: 2,
  wormCapPerMinute: 1,
  wormCapMax: 8,
  wormSegments: 14,
  /** World units between segments. */
  wormSpacing: 1.7,
  wormSpeed: 22,
  wormTurnRate: 3.2,
  wormHealth: 6,
  wormLife: 26,
  /** World units crawled between trail pixels. */
  wormTrailStep: 3,
  /** Range (world units) at which a worm looks for dormant Blight to reconnect. */
  wormSeekRange: 640,

  /** Chance a row of glass tanks holds specimens instead of small generators. */
  specimenRowChance: 0.4,
  specimenHealth: 10,
  specimenHealthPerZone: 8,
  specimenSpeed: 34,
  specimenSightCells: 18,
  specimenRadius: 3,

  /** Damage a creature deals on contact, and how often. */
  biteDamage: 1,
  biteCooldown: 0.7,
};

/** Size of one pixel-art pixel (soldier sprites, bullets) in world units. */
export const ART_PIXEL = 1;

export const SOLDIER = {
  /** Collision radius. Must be < cellSize / 2 so soldiers fit one-cell tunnels. */
  collisionRadius: 3.2,
  /** Minimum gap (px) between a freshly deployed soldier and any terrain. */
  deployClearance: 1,
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

export const FLAMETHROWER = {
  /** Flame jets per second (a steady stream). */
  fireRate: 14,
  /** Damage per jet. Low, but the stream lands a lot of them. */
  damage: 1,
  /** Jet speed (units/s). Slow, so the stream has a short reach. */
  bulletSpeed: 150,
  /** Jet lifetime (seconds); with `bulletSpeed` this sets the reach (~6 cells). */
  lifetime: 0.32,
  /** Half-angle spread jitter (degrees). */
  spreadDeg: 9,
};

/** Fire: flame particles and burning rubble (see FireSystem). */
export const FIRE = {
  /** Max live flame/smoke particles. */
  particleCap: 1400,
  /** Max rubble sub-pixels burning at once. */
  maxBurning: 900,
  /** Seconds a rubble sub-pixel burns (random in range), before upgrades. */
  burnMin: 4,
  burnMax: 7.5,
  /** Chance per second that a burning sub-pixel lights each rubble neighbor. */
  spreadPerSecond: 0.35,
  /** Flame particles per second rising off each exposed burning sub-pixel. */
  emitPerSecond: 20,
  /** Upward pull on flames (units/s^2). */
  buoyancy: 46,
  /** Flame particle lifetime range (seconds). */
  flameLifeMin: 0.28,
  flameLifeMax: 0.62,
  /** Burning rubble is grouped into light bins this many cells wide. */
  lightBinCells: 3,
  /** Max warm lights from burning rubble per frame (strongest first). */
  maxLights: 10,
  /** Light radius (world units) for one burning sub-pixel; grows with more fire. */
  lightRadiusMin: 30,
  lightRadiusMax: 70,
  /** Light strength range for a burning bin. */
  lightStrengthMin: 0.35,
  lightStrengthMax: 1.1,
  /** Radius (world units) and strength of the warm light at a firing nozzle. */
  nozzleLightRadius: 62,
  nozzleLightStrength: 0.8,
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

export const TURRET = {
  /** Energy requirement to activate autoturret deployment. */
  energyRequired: 150,
  /** Base number of deployed autoturrets. */
  baseCount: 2,
  /** Duration autoturrets remain active (seconds). */
  lifetime: 10,
  /** Base bullet damage. */
  baseDamage: 2,
  /** Base shots per second. */
  baseFireRate: 3.5,
  /** Base tracking/turning speed (radians/sec). PI * 1.5 = 270 deg/s. */
  baseTurnSpeed: Math.PI * 1.5,
  /** Targeting range in grid cells. */
  rangeCells: 18,
  /** Bullet speed in world units/sec. */
  bulletSpeed: 450,
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
  expBase: 1.2,
  /** Soft threshold on exponential rise; after this rate is reached, rate grows linearly by +1/s every 1s forever. */
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
  /**
   * Generator rate (sub-pixels / second) at which the Blight goes into OVERDRIVE.
   * Only in overdrive do the facility's walls themselves replicate as Blight.
   */
  overdriveRate: 70,
  /** Wall replication rate (copy events / second) the moment overdrive begins. */
  overdriveWallBase: 1.5,
  /** Exponential base per second of overdrive for wall replication. */
  overdriveExpBase: 1.07,
  /** Seconds between checks for colonies a cut split in two (dormancy shows within this). */
  splitCheckSeconds: 0.1,
  /** Max decayed pixels per colony per physics step. */
  maxDecayPerStep: 6,
};

/** Wall replication rate after `overdriveSeconds` of overdrive. */
export function overdriveWallRate(overdriveSeconds: number): number {
  if (overdriveSeconds <= 0) return 0;
  const baseRate = GROWTH.overdriveWallBase + Math.pow(GROWTH.overdriveExpBase, overdriveSeconds) - 1;
  if (baseRate <= GROWTH.maxRate) return baseRate;
  const targetExp = Math.max(1, GROWTH.maxRate - GROWTH.overdriveWallBase + 1);
  const tMax = Math.log(targetExp) / Math.log(GROWTH.overdriveExpBase);
  const extraSeconds = Math.max(0, overdriveSeconds - tMax);
  return GROWTH.maxRate + extraSeconds * 1.0;
}

/** Growth rate (copy events / second) at `runTime` seconds into the run (spec §7). */
export function growthRateAt(runTime: number, startRate = GROWTH.baseRate, expBase = GROWTH.expBase): number {
  if (runTime < GROWTH.graceSeconds) return 0;
  const elapsed = Math.max(0, runTime - GROWTH.graceSeconds);
  const baseRateTerm = Math.max(0, startRate + Math.pow(expBase, elapsed) - 1);
  if (baseRateTerm <= GROWTH.maxRate) {
    return baseRateTerm;
  }
  // Once the exponential formula reaches maxRate, it grows by a flat rate of 1 more every 1 second forever
  const targetExp = Math.max(1, GROWTH.maxRate - startRate + 1);
  const tMax = Math.log(targetExp) / Math.log(expBase);
  const extraSeconds = Math.max(0, elapsed - tMax);
  return GROWTH.maxRate + extraSeconds * 1.0;
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
  ambientRgb: [50, 46, 46] as const,
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
  /** Starting expected currency drops per destroyed block, before resource upgrades. */
  baseDropChance: 0.4,
  /** Base attraction radius (world units) within which pickups are pulled toward a soldier. */
  baseMagnetRange: 48,
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

/**
 * Fog of war: the map starts dark, each soldier sees a radius around itself,
 * and unseen areas slowly go stale and dark again. Light creeps outward from
 * soldiers like receding ooze instead of snapping to a radius.
 */
export const FOG = {
  /** Fog tile edge, in terrain cells (2 = 16 world units). */
  tileCells: 2,
  /** Soldier sight radius, in cells. Walls block sight. */
  soldierSightCells: 13,
  /** Sight stretches smoothly toward a soldier's facing direction. */
  forwardSightMult: 1.8,
  /** Fog clears faster directly ahead, tapering back to normal at the sides. */
  forwardRevealMult: 2.5,
  /** Extra soldier sight radius per Recon Optics level, in cells. */
  sightPerLevel: 2,
  /** Autoturret sight radius, in cells. */
  turretSightCells: 7,
  /** Rays cast per soldier when tracing sight. */
  sightRays: 72,
  /** How fast light floods into newly seen tiles (per second, x neighbor light). */
  revealRate: 1.5,
  /** Seconds an unseen tile stays fresh before darkness starts creeping back. */
  staleDelay: 4,
  /** How fast darkness creeps back into stale tiles (per second, before neighbor scaling). */
  staleRate: 0.07,
  /** Brightness explored tiles settle at once mapping is permanent (0..1). */
  mappedLevel: 0.42,
  /** Brightness above which a tile counts as explored. */
  exploredThreshold: 0.55,
  /** Fog color (near-black, a touch of navy). */
  color: [3, 4, 8] as const,
};

export const COLORS = {
  background: "#060505",
  /** Bare slab of the spawn room. */
  spawnFloor: "#2c2a28",
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
    [60, 58, 55], // floor: dusty matte concrete tile
    [34, 32, 30], // floor tile grout
    [96, 84, 50], // corridor guide line: faded ochre paint
    [120, 30, 70], // blight stain
    [70, 68, 66], // blast door
    [30, 34, 42], // door seam
    [44, 84, 64], // door jamb light
    [138, 108, 38], // hazard yellow (matte, worn)
    [24, 24, 28], // hazard black
    [84, 82, 80], // equipment frame
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
    [112, 108, 100], // pristine floor: aged bone tile
    [70, 66, 62], // pristine tile grout
    [236, 246, 255], // light panel (lit)
    [58, 62, 68], // dead light panel
    [40, 38, 34], // grime
    [14, 12, 12], // floor crack
    [136, 132, 122], // pristine wall trim
    [112, 108, 100], // pristine wall panel
    [74, 70, 66], // pristine wall panel seam
    [40, 36, 34], // grimy, stained wall
    [104, 24, 62], // Blight-flecked wall
    [18, 18, 22], // missing floor tile
  ] as const,
  /** How strongly each lab detail covers the cell's own color (same order). */
  labDecorMix: [
    0, 0.45, 0.55, 0.7, 0.55, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0.85, 0.92, 1, 1,
    0.5, 0.55, 1, 1, 0.5, 0.7, 0.6, 0.74, 0.74, 0.5, 0.55, 0.8,
  ] as const,
  /** Emergency-power glow added over the dark scene (same order; black = none). */
  labGlow: [
    [0, 0, 0], // none
    [0, 0, 0], // floor
    [7, 9, 12], // floor tile line
    [0, 0, 0], // corridor guide line (paint, no glow)
    [44, 8, 26], // blight stain
    [0, 0, 0], // blast door
    [0, 0, 0], // door seam
    [6, 22, 14], // door jamb light
    [0, 0, 0], // hazard yellow (paint, no glow)
    [0, 0, 0], // hazard black
    [0, 0, 0], // equipment frame
    [40, 90, 100], // tank glass
    [20, 90, 70], // specimen fluid
    [70, 190, 110], // status LED
    [0, 0, 0], // dark panel
    [0, 0, 0], // bench top
    [0, 0, 0], // bunk linen
    [0, 0, 0], // scorched breach
    [34, 5, 20], // dark pink blight overrun floor
    [72, 12, 42], // dark pink blight vein / tendril
    [175, 28, 96], // blight core outer shell
    [255, 90, 180], // blight core pulsing heart
    [0, 0, 0], // pristine floor
    [0, 0, 0], // pristine tile seam
    [0, 0, 0], // light panel (lit separately, see TerrainRenderer.drawPanels)
    [0, 0, 0], // dead light panel
    [0, 0, 0], // grime
    [0, 0, 0], // floor crack
    [0, 0, 0], // pristine wall trim
    [0, 0, 0], // pristine wall panel
    [0, 0, 0], // pristine wall panel seam
    [0, 0, 0], // grimy wall
    [26, 4, 14], // Blight-flecked wall
    [0, 0, 0], // missing floor tile
  ] as const,
  /** Collapsed rubble sub-pixel colors (RGB), matte and close to the wall materials: concrete, ash, rust, sand, slate, char. */
  rubble: [
    [82, 77, 70],
    [62, 60, 58],
    [88, 56, 40],
    [98, 88, 68],
    [60, 66, 76],
    [40, 36, 33],
  ] as const,
  /** Half-size lab equipment ramps (dark to light): machine casing, pipes, and screen colors. */
  labMetal: [
    [50, 50, 52],
    [76, 74, 74],
    [104, 100, 96],
    [138, 132, 124],
  ] as const,
  labPipe: [
    [70, 46, 34],
    [124, 82, 52],
    [172, 118, 70],
    [214, 168, 112],
  ] as const,
  labScreen: [
    [80, 230, 255],
    [110, 255, 160],
    [255, 190, 70],
    [255, 90, 110],
  ] as const,
  /** Blinking status lights (lit colors): green, amber, red, cyan. */
  labLed: [
    [120, 255, 150],
    [255, 200, 70],
    [255, 70, 80],
    [90, 220, 255],
  ] as const,
  /** Pulsing cores of the mystery machines: violet, teal, sickly green, magenta. */
  labCore: [
    [176, 110, 255],
    [70, 240, 210],
    [190, 255, 90],
    [255, 90, 210],
  ] as const,
  /** Smashed, scorched equipment casing in overrun rooms (dark to light). */
  labWreck: [
    [26, 24, 30],
    [46, 44, 52],
    [70, 64, 70],
    [96, 84, 82],
  ] as const,
  /** Containment glass (RGB) and how opaque it is (0..255). */
  glass: [120, 190, 210] as const,
  glassAlpha: 92,
  /** Blast door: dark core and lighter rim. */
  doorCore: "#1c1a19",
  doorRim: "#55514c",
  /** Tint applied to damaged cells. */
  damage: [120, 70, 52] as const,
  soldierCore: "#1b2a3a",
  soldierHighlight: "#9ff3ff",
  soldierGlow: "rgba(110, 220, 255, 0.35)",
  bullet: "#fff2c4",
  tracer: "rgba(255, 214, 140, ",
  aim: "rgba(160, 230, 255, 0.55)",
};
