import { describe, expect, it } from "vitest";
import { Rng } from "../src/core/Rng";
import { baseSoldierStats, Soldier } from "../src/entities/Soldier";
import { WEAPON_MARKETS } from "../src/progression/BlackMarket";
import { MARKET_RESEARCH_DEFS } from "../src/progression/MarketResearch";
import { SaveManager, type StorageLike } from "../src/progression/SaveManager";
import { UPGRADE_BY_ID } from "../src/progression/UpgradeDefinitions";
import { UpgradeManager } from "../src/progression/UpgradeManager";
import { CombatSystem } from "../src/systems/CombatSystem";
import { PixelWorld } from "../src/world/PixelWorld";
import { CIRCUIT, ORBIT } from "../src/config";
import { findAllSpecials, unlockTabs } from "./helpers/progression";

class MemoryStorage implements StorageLike {
  private data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
}
function scene() {
  const save = new SaveManager(new MemoryStorage());
  unlockTabs(save);
  findAllSpecials(save.data);
  save.data.essence = 1e6; save.data.bank = 1e6; save.data.crystals = 1e6; save.data.lifetimePixels = 1e6;
  for (const id of ["shotgun_unlock", "ar_unlock", "rocket_unlock", "sniper_unlock", "katana_unlock", "flame_unlock"] as const) save.data.upgrades[id] = 1;
  return { save, u: new UpgradeManager(save) };
}

describe("Black Market path research", () => {
  it("gives every mutation path something to research after it is picked", () => {
    for (const market of WEAPON_MARKETS) {
      for (const path of market.paths) {
        expect(path.nodes.length, path.root).toBeGreaterThan(1);
        for (const id of path.nodes.slice(1)) expect(UPGRADE_BY_ID[id].maxLevel, id).toBeGreaterThan(0);
      }
    }
    for (const def of MARKET_RESEARCH_DEFS) {
      expect(def.currency).toBe("essence");
      expect(def.maxLevel).toBeGreaterThanOrEqual(3);
    }
  });

  it("only sells research for the active path, and keeps it when switching away and back", () => {
    const { save, u } = scene();
    expect(u.buy("black_market_pistol")).toBe(true);
    expect(u.buy("orbit_capacity")).toBe(false);
    expect(u.buy("orbit_unlock")).toBe(true);
    expect(u.buy("orbit_capacity")).toBe(true);
    expect(u.buy("orbit_capacity")).toBe(true);
    expect(u.getSoldierStats().orbitMaxRounds).toBe(ORBIT.maxRounds + 4);
    expect(u.buy("reverse_unlock")).toBe(true);
    expect(u.canBuy("orbit_capacity")).toBe(false);
    expect(u.getSoldierStats().orbitMaxRounds).toBe(ORBIT.maxRounds);
    expect(u.buy("orbit_unlock")).toBe(true);
    expect(u.getSoldierStats().orbitMaxRounds).toBe(ORBIT.maxRounds + 4);
    expect(save.data.upgrades.orbit_capacity).toBe(2);
  });

  it("refunds research along with its path", () => {
    const { save, u } = scene();
    u.buy("black_market_rocket_launcher");
    u.buy("burrower_unlock");
    u.buy("burrower_payload");
    const before = save.data.essence;
    const spent = save.data.upgradeSpent?.burrower_payload?.essence ?? 0;
    expect(spent).toBeGreaterThan(0);
    const result = u.refundBlackMarket();
    expect(result.ok).toBe(true);
    expect(save.data.upgrades.burrower_payload).toBe(0);
    expect(save.data.essence).toBeGreaterThan(before + spent - 1);
  });

  it("lengthens a Circuit Runner laser with Long Trace", () => {
    const { u } = scene();
    u.buy("black_market_assault_rifle");
    u.buy("circuit_unlock");
    for (let i = 0; i < 4; i++) expect(u.buy("circuit_trace")).toBe(true);
    const stats = u.getSoldierStats();
    expect(stats.circuitRange).toBe(CIRCUIT.baseRange + 160);
    const world = new PixelWorld({ width: 32, height: 32, cellSize: 8, roomSize: 10 });
    const combat = new CombatSystem(world, new Rng(3), stats);
    const s = new Soldier(128, 128, 1, 0, 60);
    s.weapon = "assault_rifle";
    s.mutation = "circuit_runner";
    combat.fire(s);
    const laser = combat.bullets.items.find((b) => b.active && b.circuit);
    expect(laser?.circuitMaxRange).toBe(CIRCUIT.baseRange + 160);
  });

  it("starts every research stat at the unresearched value", () => {
    const base = baseSoldierStats();
    const fresh = scene().u.getSoldierStats();
    for (const key of ["reverseDamageMult", "orbitMaxRounds", "vacuumRange", "circuitRange", "railPierce", "napalmFuelLife", "cryoDuration"] as const) {
      expect(fresh[key], key).toBe(base[key]);
    }
  });
});
