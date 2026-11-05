import { valueNoise, hash2 } from "../core/math";
import type { PixelWorld } from "./PixelWorld";

/**
 * Fill the world with solid terrain (health by distance), assign procedural
 * color variation, and carve the empty starting room. Does not fire listeners.
 */
export function generateWorld(world: PixelWorld, seed: number): void {
  const { width, height, health, tint } = world;
  for (let cy = 0; cy < height; cy++) {
    for (let cx = 0; cx < width; cx++) {
      const i = cy * width + cx;
      health[i] = world.maxHealthAt(cx, cy);
      // Large-scale blotches mixed with fine per-cell grain.
      const n = valueNoise(cx, cy, 23, seed) * 0.65 + valueNoise(cx, cy, 7, seed + 17) * 0.35;
      const grain = hash2(cx, cy, seed + 101);
      tint[i] = Math.min(255, Math.floor((n * 0.85 + grain * 0.15) * 256));
    }
  }
  for (let cy = world.roomY0; cy <= world.roomY1; cy++) {
    for (let cx = world.roomX0; cx <= world.roomX1; cx++) {
      health[cy * width + cx] = 0;
    }
  }
}
