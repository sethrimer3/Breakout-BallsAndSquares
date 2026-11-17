import { GROWTH } from "../config";
import type { CameraSystem } from "../systems/CameraSystem";
import type { GrowthSystem } from "../world/GrowthSystem";
import type { PixelWorld } from "../world/PixelWorld";

type GlowHistory = Pick<GrowthSystem, "glowCount" | "glowHead" | "glowIndex" | "glowTime">;
type GlowWorld = Pick<PixelWorld, "width" | "health" | "cellSize">;
type GlowCamera = Pick<CameraSystem, "viewW" | "viewH" | "worldToScreenX" | "worldToScreenY">;

/** Whether the original growth-pulse draw loop would submit any sprites.
 * Keep age/health/viewport checks aligned with LightRenderer's pulse pass. */
export function hasVisibleGrowthGlows(
  world: GlowWorld,
  growth: GlowHistory,
  cam: GlowCamera,
  now: number,
): boolean {
  const cap = growth.glowIndex.length;
  const viewW = Math.max(1, Math.round(cam.viewW));
  const viewH = Math.max(1, Math.round(cam.viewH));
  for (let k = 0; k < growth.glowCount; k++) {
    const idx = (growth.glowHead - 1 - k + cap) % cap;
    const age = now - growth.glowTime[idx];
    if (age < 0 || age >= GROWTH.glowDuration) continue;
    const cell = growth.glowIndex[idx];
    if (world.health[cell] === 0) continue;
    const cx = cell % world.width;
    const cy = Math.floor(cell / world.width);
    const sx = cam.worldToScreenX((cx + 0.5) * world.cellSize);
    const sy = cam.worldToScreenY((cy + 0.5) * world.cellSize);
    if (sx < -60 || sy < -60 || sx > viewW + 60 || sy > viewH + 60) continue;
    return true;
  }
  return false;
}
