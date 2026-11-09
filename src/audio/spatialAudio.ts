import type { CameraSystem } from "../systems/CameraSystem";

export interface SpatialMix { gain: number; pan: number }

/** Rectangular screen distance: all four edges and corners are exactly 25%. */
export function spatialMix(camera: CameraSystem, wx: number, wy: number): SpatialMix {
  if (camera.viewW <= 0 || camera.viewH <= 0) return { gain: 0, pan: 0 };
  const x = (camera.worldToScreenX(wx) - camera.viewW / 2) / (camera.viewW / 2);
  const y = (camera.worldToScreenY(wy) - camera.viewH / 2) / (camera.viewH / 2);
  // The same linear slope continues off-screen to zero at 4/3 of the half-view.
  return { gain: Math.max(0, 1 - 0.75 * Math.max(Math.abs(x), Math.abs(y))), pan: Math.max(-1, Math.min(1, x)) };
}
