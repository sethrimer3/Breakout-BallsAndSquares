/**
 * Every profile plays the same fixed, hand-drawn maps. The small amount of
 * seeded dressing on top of the blueprints (wall tint and grain, cave-ins,
 * crystal veins, alien warping and crust) uses one constant seed per world,
 * so a given world looks the same for every save.
 */
const FIXED_MAP_CODE = "BREACH";

/** Stable FNV-1a derivation isolates each world's generation from gameplay RNG. */
export function labWorldSeed(world: number): number {
  const text = `breach.world.v1:${FIXED_MAP_CODE}:${world}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return hash >>> 0;
}
