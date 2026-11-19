import { describe, expect, it } from "vitest";
import { SPECIAL_UPGRADE, SpecialUpgradeSystem, rayBox } from "../src/systems/SpecialUpgrades";
import type { PixelWorld } from "../src/world/PixelWorld";
import type { Soldier } from "../src/entities/Soldier";
import { SaveManager, type StorageLike } from "../src/progression/SaveManager";
import { UpgradeManager } from "../src/progression/UpgradeManager";
import { SPECIAL_UNLOCKS, specialSpotFor, specialWorld } from "../src/progression/specialUnlocks";
import { CORE_PATH, UPGRADE_BY_ID } from "../src/progression/UpgradeDefinitions";
import { LAB_WORLDS, parseLateMarkers, sectorTier, upgradeSpotSector } from "../src/world/labMap";
import { unlockTabs } from "./helpers/progression";

class MemStorage implements StorageLike {
  map = new Map<string, string>();
  getItem(k: string): string | null { return this.map.get(k) ?? null; }
  setItem(k: string, v: string): void { this.map.set(k, v); }
}

const world = { cellSize: 8, upgradeSpots: [{ id: "z1:a", cx: 10, cy: 10, sector: 0 }, { id: "z1:b", cx: 40, cy: 10, sector: 0 }] } as unknown as PixelWorld;
const soldier = (x: number, y: number) => ({ x, y, vx: 0, vy: 0, radius: 3, alive: true }) as unknown as Soldier;

describe("special upgrade blocks", () => {
  it("are 2x2 cells and skip collected spots", () => {
    const sys = new SpecialUpgradeSystem(world, () => []);
    sys.reset(["z1:b"]);
    expect(sys.blocks).toHaveLength(1);
    const b = sys.blocks[0];
    expect(b.x1 - b.x0).toBe(16);
    expect(b.x0).toBe(9.5 * 8);
  });

  it("take bullet hits via raycast, then shatter into motes absorbed by the nearest soldier", () => {
    const near = soldier(84, 140);
    const far = soldier(84, 400);
    const absorbed: string[] = [];
    const sys = new SpecialUpgradeSystem(world, () => [far, near], { onAbsorbed: (id, s) => absorbed.push(`${id}:${s === near}`) });
    sys.reset([]);
    for (let i = 0; i < SPECIAL_UPGRADE.hits; i++) {
      const t = sys.raycast(84, 140, 0, -1, 200);
      expect(t).toBeCloseTo(140 - 92);
      expect(sys.applyHit(1, 84, 96)).toBe(true);
    }
    expect(sys.blocks[0].broken).toBe(true);
    expect(sys.raycast(84, 140, 0, -1, 200)).toBe(-1);
    expect(sys.motes.length).toBe(SPECIAL_UPGRADE.motes);
    for (let i = 0; i < 600 && sys.motes.length; i++) sys.update(1 / 60);
    expect(sys.motes.length).toBe(0);
    expect(absorbed).toEqual(["z1:a:true"]);
  });

  it("blasts count as hits and intact blocks push soldiers out", () => {
    const s = soldier(84, 84);
    const sys = new SpecialUpgradeSystem(world, () => [s]);
    sys.reset([]);
    sys.update(0.016);
    const b = sys.blocks[0];
    const inside = s.x > b.x0 - 3 && s.x < b.x1 + 3 && s.y > b.y0 - 3 && s.y < b.y1 + 3 && Math.min(Math.abs(s.x - b.x0), Math.abs(s.x - b.x1), Math.abs(s.y - b.y0), Math.abs(s.y - b.y1)) < 2.999;
    expect(inside).toBe(false);
    sys.explode(84, 120, 30);
    expect(b.hitsLeft).toBe(SPECIAL_UPGRADE.hits - 1);
  });

  it("rayBox misses parallel rays outside the box", () => {
    expect(rayBox(0, 0, 1, 0, 5, 5, 10, 10)).toBe(-1);
    expect(rayBox(0, 7, 1, 0, 5, 5, 10, 10)).toBe(5);
  });
});

describe("special upgrade unlocks", () => {
  it("map every lab spot to a real upgrade, each at most once", () => {
    const spots = Object.values(LAB_WORLDS).flatMap((w) => {
      if (!w.framework) return w.upgrades.map((u) => u.id);
      let idx = 0;
      return parseLateMarkers(w.blueprint)
        .filter((m) => m.kind === "special")
        .map(() => `z${w.id}-special-${++idx}`);
    });
    for (const [spot, id] of Object.entries(SPECIAL_UNLOCKS)) {
      expect(spots).toContain(spot);
      expect(UPGRADE_BY_ID[id]).toBeDefined();
      const w = LAB_WORLDS[specialWorld(spot)];
      if (!w.framework) {
        expect(w.upgrades.some((u) => u.id === spot)).toBe(true);
      }
    }
    expect(new Set(Object.values(SPECIAL_UNLOCKS)).size).toBe(Object.keys(SPECIAL_UNLOCKS).length);
  });

  it("places all core upgrades (except keycard_t1) on the map and puts secondary weapons in Tier 4 after Tier 4 keycard", () => {
    expect(specialSpotFor("keycard_t1")).toBeUndefined();
    expect(UPGRADE_BY_ID.keycard_t1.baseCost).toBe(5);
    expect(UPGRADE_BY_ID.keycard_t1.currency ?? "gold").toBe("gold");
    for (const id of CORE_PATH) {
      if (id !== "keycard_t1" && id !== "better_flashlight" && id !== "cartography_uplink" && !UPGRADE_BY_ID[id].placeholder) {
        expect(specialSpotFor(id), `core upgrade ${id} must have a golden block`).toBeDefined();
      }
    }
    expect(CORE_PATH.indexOf("unlock_secondary")).toBeGreaterThan(CORE_PATH.indexOf("keycard_t4"));
    for (const id of ["unlock_secondary", "grenade_unlock", "turret_unlock"] as const) {
      const spotId = specialSpotFor(id)!;
      expect(specialWorld(spotId)).toBe(2);
      const def = LAB_WORLDS[2];
      const spot = def.upgrades.find((u) => u.id === spotId)!;
      expect(sectorTier(def, upgradeSpotSector(def, spot))).toBe(4);
    }
  });

  it("keep an upgrade unbuyable until its block is found, and survive a reload", () => {
    const store = new MemStorage();
    const save = new SaveManager(store);
    save.data.lifetimePixels = 1e6;
    save.data.bank = 1e6;
    unlockTabs(save);
    const upg = new UpgradeManager(save);
    expect(upg.needsFinding("shotgun_unlock")).toBe(true);
    expect(upg.canBuy("shotgun_unlock")).toBe(false);
    save.data.lab.worlds[1].specials.push("z1-special-1");
    save.save();
    const again = new UpgradeManager(new SaveManager(store));
    expect(again.needsFinding("shotgun_unlock")).toBe(false);
    expect(again.canBuy("shotgun_unlock")).toBe(true);
  });

  it("never re-locks an upgrade an older save already owns", () => {
    const save = new SaveManager(new MemStorage());
    unlockTabs(save);
    save.data.upgrades.ar_unlock = 1;
    expect(new UpgradeManager(save).needsFinding("ar_unlock")).toBe(false);
  });
});
