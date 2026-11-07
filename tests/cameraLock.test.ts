import { describe, expect, it } from "vitest";
import { Soldier } from "../src/entities/Soldier";
import { CameraSystem } from "../src/systems/CameraSystem";
import { PixelWorld } from "../src/world/PixelWorld";

describe("camera lock-on", () => {
  it("stays on the locked soldier even when another soldier is much farther out", () => {
    const world = new PixelWorld({ width: 200, height: 200, cellSize: 8, roomSize: 10 });
    const cam = new CameraSystem(world);
    cam.setViewport(400, 300);
    const near = new Soldier(world.roomCenterX, world.roomCenterY, 1, 0, 50);
    const far = new Soldier(world.roomCenterX + 600, world.roomCenterY, 1, 0, 50);
    cam.lockOn(near.id);
    for (let i = 0; i < 60; i++) cam.update(1 / 60, [near, far]);
    expect(cam.targetId).toBe(near.id);
    expect(cam.following).toBe(true);
  });
});
