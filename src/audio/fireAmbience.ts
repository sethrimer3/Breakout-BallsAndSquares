import { spatialMix, type SpatialMix } from "./spatialAudio";
import type { CameraSystem } from "../systems/CameraSystem";
import { FKind, type FireSystem } from "../systems/FireSystem";
import type { PixelWorld } from "../world/PixelWorld";

/** Independent spatial and size factors; the audio mixer applies their product. */
export function fireAmbienceMix(fire: FireSystem, world: PixelWorld, cam: CameraSystem): SpatialMix {
  if (cam.viewW <= 0 || cam.viewH <= 0) return { gain: 0, pan: 0 };
  let audibleSize = 0;
  let weightedGain = 0;
  let weightedPan = 0;
  const add = (wx: number, wy: number, size: number): void => {
    const mix = spatialMix(cam, wx, wy);
    if (mix.gain === 0) return;
    audibleSize += size;
    weightedGain += size * mix.gain;
    weightedPan += size * mix.gain * mix.pan;
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
  if (audibleSize === 0) return { gain: 0, pan: 0 };
  const attenuation = weightedGain / audibleSize;
  // Screen area shrinks with zoom; small fires get a second, independent damping.
  const sizeDamping = 1 - Math.exp(-audibleSize * cam.zoom ** 2 / 40);
  return { gain: attenuation * sizeDamping, pan: weightedGain > 0 ? weightedPan / weightedGain : 0 };
}

export function fireAmbienceLevel(fire: FireSystem, world: PixelWorld, cam: CameraSystem): number {
  return fireAmbienceMix(fire, world, cam).gain;
}
