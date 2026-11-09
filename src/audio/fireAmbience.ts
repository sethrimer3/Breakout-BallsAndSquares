import type { CameraSystem } from "../systems/CameraSystem";
import { FKind, type FireSystem } from "../systems/FireSystem";
import type { PixelWorld } from "../world/PixelWorld";

/** Independent spatial and size factors; the audio mixer applies their product. */
export function fireAmbienceLevel(fire: FireSystem, world: PixelWorld, cam: CameraSystem): number {
  if (cam.viewW <= 0 || cam.viewH <= 0) return 0;
  let visibleSize = 0;
  let centeredSize = 0;
  const add = (wx: number, wy: number, size: number): void => {
    const x = cam.worldToScreenX(wx);
    const y = cam.worldToScreenY(wy);
    if (x < 0 || y < 0 || x > cam.viewW || y > cam.viewH) return;
    const distance = Math.hypot((x - cam.viewW / 2) / (cam.viewW / 2), (y - cam.viewH / 2) / (cam.viewH / 2));
    const center = Math.max(0, 1 - distance) ** 2;
    visibleSize += size;
    centeredSize += size * center;
  };
  for (let i = 0; i < fire.count; i++) {
    if (fire.kind[i] !== FKind.Flame) continue;
    const remaining = fire.life[i] / fire.maxLife[i];
    add(fire.x[i], fire.y[i], fire.heat[i] * remaining);
  }
  for (let i = 0; i < fire.burnCount; i++) {
    const si = fire.burning[i];
    const sx = si % world.subWidth;
    const sy = (si - sx) / world.subWidth;
    add((sx + 0.5) * world.subCellSize, (sy + 0.5) * world.subCellSize,
      Math.min(1, fire.burnLeft[i] / 1.6));
  }
  if (visibleSize === 0) return 0;
  const centering = centeredSize / visibleSize;
  // Screen area shrinks with zoom; small fires get a second, independent damping.
  const sizeDamping = 1 - Math.exp(-visibleSize * cam.zoom ** 2 / 40);
  return centering * sizeDamping;
}
