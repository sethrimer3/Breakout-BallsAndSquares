import { tierHealth } from "../config";
import type { Colony } from "./BlightColonies";
import type { BlightCore, PixelWorld } from "./PixelWorld";

/**
 * Blight generator tiers. Every generator (room Blight Core or tank
 * generator) has a level: the block tier of the zone it was found in. Its
 * cells hold about a fifth of that tier's block health, and its rim is
 * painted in that tier's colors.
 *
 * When the creep of a tougher generator joins a weaker one's (their colonies
 * merge), the tougher one takes the weaker over: over `convertSeconds` the
 * weaker generator's rim recolors and its health climbs smoothly to the
 * tougher level, keeping the share of health it had left.
 */
export const GENERATOR = {
  /** Generator cell health as a share of an ordinary block of its level. */
  healthFrac: 0.2,
  /** Seconds a takeover takes. */
  convertSeconds: 3.5,
} as const;

/**
 * Rim colors per generator level (index = tier): [dark outline, rim, bright].
 * The Lab's tiers stay in the Blight's pinks and reds; the Wards' turn
 * violet, toxic green and bone white.
 */
export const GENERATOR_TIER_COLORS: readonly (readonly [string, string, string])[] = [
  ["#3a0a22", "#c81e6a", "#ff7ab4"],
  ["#3a0a22", "#c81e6a", "#ff7ab4"], // T1: Blight pink
  ["#3d0808", "#d8322a", "#ff8a6a"], // T2: arterial red
  ["#3a1a04", "#e07a14", "#ffc46a"], // T3: infected amber
  ["#1e0a3a", "#8a3ae0", "#d0a4ff"], // T4: violet
  ["#0c2a0a", "#5cc81e", "#c4ff8a"], // T5: toxic green
  ["#2a2622", "#d8d0c0", "#ffffff"], // T6: bone white
];

/** Rim colors for a generator level (later tiers reuse the last). */
export function generatorColors(level: number): readonly [string, string, string] {
  return GENERATOR_TIER_COLORS[Math.max(1, Math.min(GENERATOR_TIER_COLORS.length - 1, Math.round(level)))];
}

/** Health of one generator cell of `level`: a fifth of that tier's block. */
export function generatorCellHealth(level: number): number {
  return Math.max(1, Math.round(tierHealth(level) * GENERATOR.healthFrac));
}

/** The generator's settled level (the zone's tier until something takes it over). */
export function coreLevel(world: PixelWorld, core: BlightCore): number {
  return (core.level ??= world.fillTierAt(core.cx, core.cy));
}

/** Smoothstep progress of a takeover (0 before, 1 when done). */
function eased(t: number): number {
  const k = Math.max(0, Math.min(1, t));
  return k * k * (3 - 2 * k);
}

/** Current max health of each of the generator's cells, mid-takeover included. */
export function coreCellMaxHealth(world: PixelWorld, core: BlightCore): number {
  const lvl = coreLevel(world, core);
  if (core.convertTo === undefined) return generatorCellHealth(lvl);
  const a = generatorCellHealth(lvl);
  const b = generatorCellHealth(core.convertTo);
  return Math.max(1, Math.round(a + (b - a) * eased(core.convert ?? 0)));
}

/** How far a takeover has gone (0..1), or 1 when no takeover is running. */
export function conversionProgress(core: BlightCore): number {
  return core.convertTo === undefined ? 1 : eased(core.convert ?? 0);
}

/**
 * Start takeovers in colonies that now hold generators of different levels,
 * and advance running ones. Returns the number of takeovers in progress.
 */
export function updateGeneratorTiers(world: PixelWorld, colonies: Iterable<Colony>, dt: number): number {
  const cores = world.blightCores;
  let running = 0;
  for (const c of colonies) {
    if (c.cores.length < 2) continue;
    let top = 0;
    for (const id of c.cores) {
      const core = cores[id - 1];
      if (!core?.alive) continue;
      top = Math.max(top, core.convertTo ?? coreLevel(world, core));
    }
    for (const id of c.cores) {
      const core = cores[id - 1];
      if (!core?.alive || core.convertTo !== undefined) continue;
      if (coreLevel(world, core) < top) {
        core.convertTo = top;
        core.convert = 0;
      }
    }
  }
  for (const core of cores) {
    if (core.convertTo === undefined) continue;
    if (!core.alive) {
      core.convertTo = undefined;
      core.convert = undefined;
      continue;
    }
    const before = coreCellMaxHealth(world, core);
    core.convert = Math.min(1, (core.convert ?? 0) + dt / GENERATOR.convertSeconds);
    if (core.convert >= 1) {
      core.level = core.convertTo;
      core.convertTo = undefined;
      core.convert = undefined;
    } else running++;
    const after = coreCellMaxHealth(world, core);
    if (after === before) continue;
    // Keep the share of health each cell had left.
    for (const i of core.cells) {
      const hp = world.health[i];
      if (hp > 0) world.health[i] = Math.max(1, Math.round((hp * after) / before));
    }
  }
  return running;
}
