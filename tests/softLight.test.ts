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

});
