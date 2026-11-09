import { describe, it, expect } from "vitest";
import { spatialMix } from "../src/audio/spatialAudio";
import { CameraSystem } from "../src/systems/CameraSystem";
import { PixelWorld } from "../src/world/PixelWorld";

function camera() {
  const cam = new CameraSystem(new PixelWorld({ width: 128, height: 128, cellSize: 8, roomSize: 10 }));
  cam.viewW = 800; cam.viewH = 600; cam.x = cam.y = 512; cam.zoom = 1;
  return cam;
}

describe("screen-space audio", () => {
  it("is full at center, exactly 25% at every edge and corner", () => {
    const cam = camera();
    expect(spatialMix(cam, 512, 512)).toEqual({ gain: 1, pan: 0 });
    for (const [x, y] of [[0, 0], [400, 0], [800, 0], [0, 300], [800, 300], [0, 600], [400, 600], [800, 600]]) {
      expect(spatialMix(cam, cam.screenToWorldX(x), cam.screenToWorldY(y)).gain).toBeCloseTo(0.25);
    }
  });

  it("continues the same linear slope beyond the screen until silence", () => {
    const cam = camera();
    for (const distance of [0, 0.25, 0.5, 0.75, 1, 1.1, 1.2, 4 / 3, 2]) {
      expect(spatialMix(cam, cam.x + distance * 400, cam.y).gain).toBeCloseTo(Math.max(0, 1 - 0.75 * distance));
    }
  });

  it("pans horizontally, clamps off-screen bias and follows zoom, pan and viewport changes", () => {
    const cam = camera();
    expect(spatialMix(cam, 312, 512).pan).toBe(-0.5);
    expect(spatialMix(cam, 712, 512).pan).toBe(0.5);
    expect(spatialMix(cam, 1012, 512).pan).toBe(1);
    const original = spatialMix(cam, 712, 512);
    cam.zoom = 2;
    expect(spatialMix(cam, 712, 512)).toEqual({ gain: 0.25, pan: 1 });
    cam.x = 712;
    expect(spatialMix(cam, 712, 512)).toEqual({ gain: 1, pan: 0 });
    cam.x = 512; cam.viewW = 1600;
    expect(spatialMix(cam, 712, 512)).toEqual(original);
  });
});
