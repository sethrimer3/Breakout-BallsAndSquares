import { describe, expect, it } from "vitest";
import { fireAmbienceLevel, fireAmbienceMix } from "../src/audio/fireAmbience";
import { Rng } from "../src/core/Rng";
import { CameraSystem } from "../src/systems/CameraSystem";
import { FireSystem, FKind } from "../src/systems/FireSystem";
import { PixelWorld } from "../src/world/PixelWorld";

function scene(count = 40) {
  const world = new PixelWorld({ width: 128, height: 128, cellSize: 8, roomSize: 10 });
  const camera = new CameraSystem(world);
  camera.viewW = 800; camera.viewH = 600; camera.zoom = 1;
  camera.x = camera.y = 512;
  const fire = new FireSystem(world, new Rng(1));
  fire.count = count;
  for (let i = 0; i < count; i++) {
    fire.x[i] = fire.y[i] = 512;
    fire.life[i] = fire.maxLife[i] = fire.heat[i] = 1;
    fire.kind[i] = FKind.Flame;
  }
  const level = () => fireAmbienceLevel(fire, world, camera);
  return { fire, camera, level };
}

describe("Fire ambience spatial mix", () => {
  it("is loudest at the screen center and reaches 25% at the edge and fades to silence off-screen", () => {
    const { camera, level } = scene();
    const center = level();
    camera.x -= 200;
    expect(level()).toBeCloseTo(center * 0.625);
    camera.x -= 200;
    expect(level()).toBeCloseTo(center * 0.25);
    camera.x -= 100;
    expect(level()).toBeGreaterThan(0);
    camera.x -= 40;
    expect(level()).toBe(0);
  });

  it("dampens small fires separately from their centered position and caps huge fires", () => {
    const small = scene(1).level();
    const big = scene(100).level();
    expect(small).toBeGreaterThan(0);
    expect(small).toBeLessThan(big * 0.05);
    expect(big).toBeLessThanOrEqual(1);
    expect(scene(1400).level()).toBeLessThanOrEqual(1);
  });

  it("pans fire left and right, including fires that have not entered the screen", () => {
    const { fire, camera } = scene();
    const world = new PixelWorld({ width: 128, height: 128, cellSize: 8, roomSize: 10 });
    camera.x += 450;
    const left = fireAmbienceMix(fire, world, camera);
    expect(left.gain).toBeGreaterThan(0);
    expect(left.pan).toBe(-1);
    camera.x -= 900;
    const right = fireAmbienceMix(fire, world, camera);
    expect(right.gain).toBeCloseTo(left.gain);
    expect(right.pan).toBe(1);
  });

  it("tracks apparent fire size as the camera zooms and excludes smoke", () => {
    const { fire, camera, level } = scene();
    const normal = level();
    camera.zoom = 0.5;
    expect(level()).toBeLessThan(normal);
    for (let i = 0; i < fire.count; i++) fire.kind[i] = FKind.Smoke;
    expect(level()).toBe(0);
  });

  it("includes burning rubble and fades it as the fuel runs out", () => {
    const { fire, camera, level } = scene(0);
    fire.burnCount = 1; fire.burning[0] = 128 * 256 + 128;
    fire.burnLeft[0] = 5;
    const burning = level();
    expect(burning).toBeGreaterThan(0);
    fire.burnLeft[0] = 0.2;
    expect(level()).toBeLessThan(burning);
    camera.x = -100;
    expect(level()).toBe(0);
    fire.clear();
    expect(level()).toBe(0);
  });
});
