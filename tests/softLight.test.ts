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
});
