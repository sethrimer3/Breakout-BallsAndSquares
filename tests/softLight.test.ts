import { Soldier } from "../src/entities/Soldier";
import { LightingSystem } from "../src/systems/LightingSystem";
import { CameraSystem } from "../src/systems/CameraSystem";
import { PixelWorld } from "../src/world/PixelWorld";
import { describe, expect, it } from "vitest";
import { sanitizeSaveData, SaveManager, type StorageLike } from "../src/progression/SaveManager";
import { softLayerAlpha, softLayerScale } from "../src/rendering/SoftLight";

class MemStorage implements StorageLike {
  map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
}

describe("Fiery muzzle flash setting & soft-light layers", () => {
  it("defaults off, persists, and sanitizes bad values", () => {
    const store = new MemStorage();
    const s1 = new SaveManager(store);
    expect(s1.data.settings.fieryMuzzleFlash).toBe(false);
    s1.data.settings.fieryMuzzleFlash = true;
    s1.save();
    expect(new SaveManager(store).data.settings.fieryMuzzleFlash).toBe(true);
    expect(sanitizeSaveData({ settings: { fieryMuzzleFlash: "yes" } }).settings.fieryMuzzleFlash).toBe(false);
  });

  it("soft shadows default off, persist, and sanitize bad values", () => {
    const store = new MemStorage();
    const s1 = new SaveManager(store);
    expect(s1.data.settings.softShadows).toBe(false);
    s1.data.settings.softShadows = true;
    s1.save();
    expect(new SaveManager(store).data.settings.softShadows).toBe(true);
    expect(sanitizeSaveData({ settings: { softShadows: 1 } }).settings.softShadows).toBe(false);
  });

  it("light bloom defaults on, persists off, and sanitizes bad values", () => {
    const store = new MemStorage();
    const s1 = new SaveManager(store);
    expect(s1.data.settings.bloom).toBe(true);
    s1.data.settings.bloom = false;
    s1.save();
    expect(new SaveManager(store).data.settings.bloom).toBe(false);
    expect(sanitizeSaveData({ settings: { bloom: "no" } }).settings.bloom).toBe(true);
  });

  it("layers widen outward while alpha falls off smoothly to zero", () => {
    const opts = { layers: 10, baseAlpha: 0.3, spread: 3, falloff: 2.2 };
    expect(softLayerAlpha(0, opts)).toBeCloseTo(0.3);
    expect(softLayerAlpha(9, opts)).toBeCloseTo(0);
    expect(softLayerScale(0, opts)).toBe(1);
    expect(softLayerScale(9, opts)).toBeCloseTo(3);
    for (let i = 1; i < 10; i++) {
      expect(softLayerAlpha(i, opts)).toBeLessThan(softLayerAlpha(i - 1, opts));
      expect(softLayerScale(i, opts)).toBeGreaterThan(softLayerScale(i - 1, opts));
    }
  });
  it("steadily illuminates nearby walls without firing and keeps room/fire profiles separate", () => {
    const world=new PixelWorld({width:64,height:64,cellSize:8,roomSize:10});
    const wall=32*world.width+37;world.health[wall]=10; // 40 units from the soldier, beyond the old glow.
    const soldier=new Soldier(256,256,1,0,60);
    const dead=new Soldier(240,240,1,0,60);dead.alive=false;
    const camera=new CameraSystem(world);camera.viewW=800;camera.viewH=600;camera.x=camera.y=256;camera.zoom=2;
    const lighting=new LightingSystem(world);
    let intensity=0;
    for(let frame=0;frame<20;frame++){
      lighting.updateSoftLights([soldier,dead],256,256,camera,[{x:270,y:270,radius:20,strength:0.3,warm:true}]);
      expect(lighting.softCount).toBe(3);
      const glow=lighting.softLights[1];
      expect(glow.soldier).toBe(true);expect(glow.warm).toBe(false);
      expect(Array.from(glow.lit.cells.subarray(0,glow.lit.count))).toContain(wall);
      if(frame===0)intensity=glow.strength;else expect(glow.strength).toBe(intensity);
      expect(lighting.softLights[0].soldier).toBe(false);
      expect(lighting.softLights[2].warm).toBe(true);expect(lighting.softLights[2].soldier).toBe(false);
    }
  });

  it("illuminates deeper into solid walls with Better Flashlight, attenuating by distance from exposed air", () => {
    const world = new PixelWorld({ width: 32, height: 32, cellSize: 8, roomSize: 10 });
    // Build a 5-thick solid wall starting at x = 18..22 along y = 14..18, with air at x = 17 and x = 23.
    for (let y = 14; y <= 18; y++) {
      for (let x = 18; x <= 22; x++) {
        world.health[y * world.width + x] = 20;
      }
    }
    const soldier = new Soldier(16 * 8 + 4, 16 * 8 + 4, 1, 0, 60);
    const camera = new CameraSystem(world);
    camera.viewW = 800; camera.viewH = 600; camera.x = soldier.x; camera.y = soldier.y; camera.zoom = 2;
    const lighting = new LightingSystem(world);

    // Without Better Flashlight: only the exposed wall face (x = 18) is lit.
    lighting.updateSoftLights([soldier], soldier.x, soldier.y, camera);
    const baseGlow = lighting.softLights[1];
    const baseCells = Array.from(baseGlow.lit.cells.subarray(0, baseGlow.lit.count));
    expect(baseCells).toContain(16 * world.width + 18);
    expect(baseCells).not.toContain(16 * world.width + 19);

    // With Better Flashlight: radius grows and wall depth 1..4 are lit at 100%, 75%, 50%, 25%,
    // while depth 5 (x = 22) and air beyond (x = 23) remain unlit.
    lighting.soldierLightRadius = 96;
    lighting.soldierLightStrength = 1.0;
    lighting.soldierWallDepth = 4;
    lighting.updateSoftLights([soldier], soldier.x, soldier.y, camera);
    const upgradedGlow = lighting.softLights[1];
    expect(upgradedGlow.radius).toBe(96);
    expect(upgradedGlow.strength).toBe(1.0);
    const weightByCell = new Map<number, number>();
    for (let i = 0; i < upgradedGlow.lit.count; i++) {
      weightByCell.set(upgradedGlow.lit.cells[i], upgradedGlow.lit.weights![i]);
    }
    expect(weightByCell.get(16 * world.width + 18)).toBe(1);
    expect(weightByCell.get(16 * world.width + 19)).toBe(0.75);
    expect(weightByCell.get(16 * world.width + 20)).toBe(0.5);
    expect(weightByCell.get(16 * world.width + 21)).toBe(0.25);
    expect(weightByCell.has(16 * world.width + 22)).toBe(false);
    expect(weightByCell.has(16 * world.width + 23)).toBe(false);
  });

});
