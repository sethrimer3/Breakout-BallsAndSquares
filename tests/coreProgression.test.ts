import { describe, expect, it } from "vitest";
import { ACTIVE_SLOT_KEY, defaultSaveData, getSlotKey, sanitizeSaveData, SaveManager, type StorageLike } from "../src/progression/SaveManager";
import { CORE_PATH, UPGRADE_BY_ID, UPGRADE_DEFS } from "../src/progression/UpgradeDefinitions";
import { UpgradeManager } from "../src/progression/UpgradeManager";
import { Rng } from "../src/core/Rng";
import { Soldier } from "../src/entities/Soldier";
import { CombatSystem } from "../src/systems/CombatSystem";
import { PixelWorld } from "../src/world/PixelWorld";

class Storage implements StorageLike {
  items = new Map<string, string>();
  getItem(key: string) { return this.items.get(key) ?? null; }
  setItem(key: string, value: string) { this.items.set(key, value); }
  removeItem(key: string) { this.items.delete(key); }
}

function setup() {
  const storage = new Storage();
  const save = new SaveManager(storage);
  save.data.biomass = save.data.bank = save.data.crystals = save.data.greenCrystals = save.data.essence = 1e6;
  save.data.lifetimePixels = 1e6;
  return { storage, save, upg: new UpgradeManager(save) };
}

describe("Core progression", () => {
  it("locks tabs at first, then opens them by following the snake, skipping unbuyable placeholders", () => {
    const { upg } = setup();
    for (const branch of ["resources", "pistol", "blight", "formations", "grenade", "facility"] as const) {
      expect(upg.isBranchUnlocked(branch)).toBe(false);
    }
    expect(upg.canBuy("fire_rate")).toBe(false);
    const opened: string[] = [];
    expect(upg.canBuy("keycard_t1")).toBe(true);
    const milestones = CORE_PATH.filter((id) => !UPGRADE_BY_ID[id].placeholder);
    for (let i = 0; i < milestones.length; i++) {
      const id = milestones[i];
      if (i + 1 < milestones.length) expect(upg.canBuy(milestones[i + 1])).toBe(false);
      expect(upg.buy(id), id).toBe(true);
      if (id.startsWith("unlock_") && id !== "unlock_map") opened.push(id);
    }
    expect(opened).toEqual(["unlock_resources", "unlock_primary", "unlock_blight", "unlock_formations", "unlock_secondary", "unlock_facility"]);
    expect(upg.canBuy("fire_rate")).toBe(true);
    expect(upg.getSoldierStats().keycardTier).toBe(9);
  });

  it("snakes through six centered columns and continues onto a fourth row", () => {
    const positions = CORE_PATH.map((id) => UPGRADE_BY_ID[id].grid);
    expect(positions[0]).toEqual({ col: -2.5, row: -1.5 });
    expect(positions[5]).toEqual({ col: 2.5, row: -1.5 });
    expect(positions[6]).toEqual({ col: 2.5, row: -0.5 });
    expect(positions[11]).toEqual({ col: -2.5, row: -0.5 });
    expect(positions[12]).toEqual({ col: -2.5, row: 0.5 });
    expect(positions[17]).toEqual({ col: 2.5, row: 0.5 });
    expect(positions[18]).toEqual({ col: 2.5, row: 1.5 });
    expect(positions[20]).toEqual({ col: 0.5, row: 1.5 });
    for (let i = 1; i < positions.length; i++) {
      expect(Math.abs(positions[i].col - positions[i - 1].col) + Math.abs(positions[i].row - positions[i - 1].row)).toBe(1);
    }
  });

  it("refunds removed squad stat purchases exactly once and preserves other progress", () => {
    const migrated = sanitizeSaveData({ bank: 100, upgrades: { ball_speed: 2, core_damage: 1, keycard_t1: 1 }, lifetimePixels: 90 });
    expect(migrated.bank).toBe(100 + 15 + 24 + 45);
    expect(migrated.upgrades.keycard_t1).toBe(1);
    expect(migrated.lifetimePixels).toBe(90);
    expect(sanitizeSaveData(migrated).bank).toBe(migrated.bank);
    expect(UPGRADE_DEFS.some((d) => ["ball_speed", "soldier_health", "core_fire_rate", "core_damage", "core_velocity"].includes(d.id))).toBe(false);
  });

  it("applies projectile speed to only the soldier that bought Ballistics", () => {
    const { upg } = setup();
    expect(upg.soldierBuy(0, "s_ballistics")).toBe(true);
    expect(upg.soldierBuy(0, "s_rate")).toBe(true);
    expect(upg.soldierMods(0).fireRateMult).toBeGreaterThan(1);
    expect(upg.soldierMods(1).fireRateMult).toBe(1);
    const world = new PixelWorld({ width: 32, height: 32, cellSize: 8, roomSize: 10 });
    const combat = new CombatSystem(world, new Rng(1), upg.getSoldierStats());
    const s = new Soldier(128, 128, 1, 0, 60);
    s.mods = upg.soldierMods(0); combat.fire(s);
    const boosted = combat.bullets.items[0].speed;
    combat.bullets.clear();
    s.mods = upg.soldierMods(1); combat.fire(s);
    expect(boosted / combat.bullets.items[0].speed).toBeCloseTo(1.08);
  });

  it("deletes all save slots and settings, then boots with fresh A1 progress", () => {
    const { storage, save } = setup();
    for (let slot = 1; slot <= 3; slot++) save.save(slot);
    storage.setItem(ACTIVE_SLOT_KEY, "3"); storage.setItem("other-app", "keep");
    save.deleteAllData();
    for (let slot = 1; slot <= 3; slot++) expect(storage.getItem(getSlotKey(slot))).toBeNull();
    expect(storage.getItem(ACTIVE_SLOT_KEY)).toBeNull();
    expect(storage.getItem("other-app")).toBe("keep");
    const fresh = new SaveManager(storage);
    expect(fresh.activeSlot).toBe(1);
    expect(fresh.data).toEqual(defaultSaveData());
    expect(fresh.data.lab.worlds[1].spawn).toBe(0);
    expect(fresh.data.settings.devMode).toBe(false);
  });
});
