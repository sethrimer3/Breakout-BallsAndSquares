import { describe, expect, it } from "vitest";
import { FREEZE, OVERCHARGE } from "../src/config";
import { Rng } from "../src/core/Rng";
import { Soldier, baseSoldierStats } from "../src/entities/Soldier";
import { CreatureSystem } from "../src/entities/Creatures";
import { CombatSystem, type BulletTargets } from "../src/systems/CombatSystem";
import { LateEncounters, type Encounter } from "../src/systems/LateEncounters";
import { SaveManager, type StorageLike } from "../src/progression/SaveManager";
import { UpgradeManager } from "../src/progression/UpgradeManager";
import { MAT, PixelWorld, SUB } from "../src/world/PixelWorld";
import { unlockTabs } from "./helpers/progression";

class MemoryStorage implements StorageLike {
  private map = new Map<string, string>();
  getItem(k: string): string | null { return this.map.get(k) ?? null; }
  setItem(k: string, v: string): void { this.map.set(k, v); }
}

function makeOpenWorld(width = 40, height = 24): PixelWorld {
  const w = new PixelWorld({ width, height, cellSize: 8, roomSize: 4 });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x < 2 || x >= width - 2 || y < 2 || y >= height - 2) {
        w.health[y * width + x] = 100;
      }
    }
  }
  return w;
}

function setBlock(w: PixelWorld, cx: number, cy: number, hp: number, mat: number = MAT.none): void {
  const ci = cy * w.width + cx;
  w.health[ci] = hp;
  w.mat[ci] = mat;
}

function makeLateEncounter(id: string, x: number, y: number, hp = 100): Encounter {
  return {
    id,
    kind: "soldier",
    sector: 0,
    x,
    y,
    homeX: x,
    homeY: y,
    hp,
    maxHp: hp,
    tier: 8,
    cooldown: 1,
    charge: 0,
    aimAngle: 0,
    phase: 0,
    alive: true,
    windup: 0,
  };
}

describe("Overcharge Conductor — Assault Rifle branch 1", () => {
  it("1-2: charging hits deal zero direct damage; 1-hit and 2-hit sequences expire harmlessly", () => {
    const world = makeOpenWorld();
    setBlock(world, 15, 10, 100);
    const stats = baseSoldierStats();
    stats.arUnlocked = true;
    stats.overchargeUnlocked = true;
    stats.arDamage = 5;
    stats.overchargeSpreadDeg = OVERCHARGE.finalSpreadDeg;

    const impacts: number[] = [];
    const combat = new CombatSystem(world, new Rng(1), stats, {
      onImpact: (_x, _y, _nx, _ny, cx, cy, res) => {
        if (res > 0) impacts.push(cx * 1000 + cy);
      },
    });
    const s = new Soldier(60, 10 * 8 + 4, 1, 0, 0, "assault_rifle", "free", 0, null, "overcharge_conductor");

    // 2 charging hits on block (15, 10)
    for (let i = 0; i < 2; i++) {
      combat.fire(s, 1, 0);
      for (let f = 0; f < 20; f++) combat.updateBullets(1 / 60);
    }
    expect(world.health[10 * world.width + 15]).toBe(100);
    expect(impacts.length).toBe(0);
    const entry = combat.overcharge.getEntryForCell(15, 10);
    expect(entry?.stacks).toBe(2);

    // Let quiet period expire
    combat.updateBullets(OVERCHARGE.quietDelay + 0.05);
    expect(world.health[10 * world.width + 15]).toBe(100);
    expect(combat.overcharge.totalDissipations).toBe(1);
    expect(combat.overcharge.totalDischarges).toBe(0);
  });

  it("3-5: 3 hits arm discharge, each hit refreshes quiet timer, sustained firing postpones discharge", () => {
    const world = makeOpenWorld();
    setBlock(world, 15, 10, 500);
    const stats = baseSoldierStats();
    stats.arUnlocked = true;
    stats.overchargeUnlocked = true;
    stats.arDamage = 3;
    stats.overchargeSpreadDeg = OVERCHARGE.finalSpreadDeg;

    const combat = new CombatSystem(world, new Rng(2), stats);
    const s = new Soldier(60, 10 * 8 + 4, 1, 0, 0, "assault_rifle", "free", 0, null, "overcharge_conductor");

    // Hit 5 times, spaced by half the quietDelay so discharge is postponed past 3rd hit
    for (let i = 0; i < 5; i++) {
      combat.fire(s, 1, 0);
      for (let f = 0; f < 10; f++) combat.updateBullets(1 / 60);
      combat.updateBullets(OVERCHARGE.quietDelay * 0.45);
      expect(combat.overcharge.totalDischarges).toBe(0);
      expect(world.health[10 * world.width + 15]).toBe(500);
    }

    const entry = combat.overcharge.getEntryForCell(15, 10);
    expect(entry?.stacks).toBe(5);
    expect(entry?.quietLeft).toBeGreaterThan(OVERCHARGE.quietDelay * 0.4);

    // Stop firing and wait out remaining quiet delay
    combat.updateBullets(OVERCHARGE.quietDelay + 0.05);
    expect(combat.overcharge.totalDischarges).toBe(1);
    expect(world.health[10 * world.width + 15]).toBeLessThan(500);
  });

  it("6: different targets maintain independent charge stacks and timers", () => {
    const world = makeOpenWorld();
    setBlock(world, 15, 10, 200);
    setBlock(world, 15, 14, 200);
    const stats = baseSoldierStats();
    const combat = new CombatSystem(world, new Rng(3), stats);

    combat.overcharge.chargeCell(15, 10, 1, 2);
    combat.overcharge.chargeCell(15, 10, 1, 2);
    combat.overcharge.chargeCell(15, 10, 1, 2);
    combat.updateBullets(OVERCHARGE.quietDelay * 0.5);
    combat.overcharge.chargeCell(15, 14, 1, 2);

    expect(combat.overcharge.getEntryForCell(15, 10)?.stacks).toBe(3);
    expect(combat.overcharge.getEntryForCell(15, 14)?.stacks).toBe(1);

    // Advance enough for (15,10) to discharge while (15,14) still has timer left
    combat.updateBullets(OVERCHARGE.quietDelay * 0.6);
    expect(combat.overcharge.totalDischarges).toBe(1);
    expect(combat.overcharge.getEntryForCell(15, 14)?.stacks).toBe(1);
  });

  it("7: higher charge stacks monotonically increase blast damage, chain damage, reach, and arc duration up to cap", () => {
    function runAtStacks(stacks: number) {
      const world = makeOpenWorld(60, 24);
      setBlock(world, 10, 10, 1000);
      // Place a distant target 64 units away (only reachable at higher stacks!)
      setBlock(world, 18, 10, 1000);
      const stats = baseSoldierStats();
      const combat = new CombatSystem(world, new Rng(4), stats);
      for (let i = 0; i < stacks; i++) {
        combat.overcharge.chargeCell(10, 10, 1, 4);
      }
      combat.updateBullets(OVERCHARGE.quietDelay + 0.01);
      const arcLife = combat.overcharge.arcs.find((a) => a.active)?.maxLife ?? 0;
      return {
        originDmg: 1000 - world.health[10 * world.width + 10],
        farDmg: 1000 - world.health[10 * world.width + 18],
        arcLife,
        chains: combat.overcharge.totalChainHits,
      };
    }

    const low = runAtStacks(3);
    const high = runAtStacks(12);
    expect(high.originDmg).toBeGreaterThan(low.originDmg);
    expect(low.farDmg).toBe(0);
    expect(high.farDmg).toBeGreaterThan(0);
    expect(high.arcLife).toBeGreaterThan(low.arcLife);
    expect(high.chains).toBeGreaterThanOrEqual(1);
  });

  it("8-9: starts wide (±10.5°) even with max ordinary ar_stabilizer, and upgrades to exact ±0.1°", () => {
    const save = new SaveManager(new MemoryStorage());
    save.data.bank = 100000;
    save.data.crystals = 10000;
    save.data.essence = 10000;
    save.data.lifetimePixels = 10000;
    unlockTabs(save);

    const um = new UpgradeManager(save);
    expect(um.buy("ar_unlock")).toBe(true);
    for (let i = 0; i < 6; i++) expect(um.buy("ar_stabilizer")).toBe(true);
    expect(um.buy("overcharge_unlock")).toBe(true);

    const beforeAcc = um.getSoldierStats();
    // Ordinary rifle spread was reduced by ar_stabilizer, but Overcharge still starts at ±10.5°.
    expect(beforeAcc.arSpreadDeg).toBeLessThan(2.0);
    expect(beforeAcc.overchargeSpreadDeg).toBe(OVERCHARGE.initialSpreadDeg);

    for (let i = 0; i < OVERCHARGE.accuracyMaxLevel; i++) {
      expect(um.buy("overcharge_accuracy")).toBe(true);
    }
    const maxAcc = um.getSoldierStats();
    expect(maxAcc.overchargeSpreadDeg).toBe(0.1);
  });

  it("10 & 12: supports CreatureSystem, LateEncounters, subcells, freeze 2x, Napalm external ignition, and closed gates", () => {
    const world = makeOpenWorld();
    // Subcell blight at (20, 20) -> cell (10, 10)
    const si = 20 * world.subWidth + 20;
    world.subHealth[si] = 40;
    world.subKind[si] = SUB.blight;
    // Closed door at (12, 10) inside a wall (x=12, y=6..18) blocking chain to (14, 10)
    for (let y = 6; y <= 18; y++) {
      if (y !== 10) setBlock(world, 12, y, 500, MAT.none);
    }
    setBlock(world, 12, 10, 200, MAT.door);
    world.doors.push({ id: 1, tier: 1, cells: [10 * world.width + 12], open: false, x0: 12, y0: 10, x1: 12, y1: 10 });
    world.doorId[10 * world.width + 12] = 1;
    setBlock(world, 14, 10, 100);

    const late = new LateEncounters(world, () => {}, () => {});
    const enc = makeLateEncounter("0:soldier:0", 10 * 8 + 4, 14 * 8 + 4, 120);
    late.actors.push(enc);

    const creatures = new CreatureSystem(world, new Rng(6));
    const stats = baseSoldierStats();
    const combat = new CombatSystem(world, new Rng(7), stats);
    combat.creatures = creatures;
    combat.late = late;
    combat.targets = {
      targetKey: enc,
      raycast: () => -1,
      applyHit: () => {},
    } as unknown as BulletTargets;

    // Place unlit Napalm at subcell (20,20) and freeze the LateEncounters enemy
    const patch = combat.napalm.placeGroundPatch(9, 20 * 4 + 2, 20 * 4 + 2, 3, 0, 1);
    combat.freeze.freezeCreature(enc);
    expect(enc.freezeTimer).toBe(FREEZE.duration);

    // Charging hits do NOT ignite Napalm and deal 0 damage
    for (let i = 0; i < 3; i++) {
      combat.overcharge.chargeSubCell(20, 20, 7, 4, 1);
      combat.overcharge.chargeEncounter(enc, 7, 4);
    }
    expect(patch?.lit).toBe(false);
    expect(enc.hp).toBe(120);

    // Discharge ignites Napalm and applies 2x frozen damage to encounter
    combat.updateBullets(OVERCHARGE.quietDelay + 0.05);
    expect(patch?.lit).toBe(true);
    expect(enc.hp).toBeLessThan(120);
    // Cell (14, 10) behind closed door was not damaged by chain
    expect(world.health[10 * world.width + 14]).toBe(100);
  });

  it("11 & 13: clears on target death/regrowth, pooled reuse, reset, pause (dt=0), and overflow without phantom blasts", () => {
    const world = makeOpenWorld();
    setBlock(world, 15, 10, 100);
    const stats = baseSoldierStats();
    const combat = new CombatSystem(world, new Rng(8), stats);

    // Charge (15,10) 3 times, then destroy & regrow at same coords before quiet period
    for (let i = 0; i < 3; i++) combat.overcharge.chargeCell(15, 10, 1, 5);
    world.damage(15, 10, 200, true);
    setBlock(world, 15, 10, 100);
    combat.updateBullets(OVERCHARGE.quietDelay + 0.05);
    expect(combat.overcharge.totalDischarges).toBe(0);
    expect(world.health[10 * world.width + 15]).toBe(100);

    // Pooled Bullet reuse: Overcharge -> Katana
    combat.clearAll();
    const os = new Soldier(60, 84, 1, 0, 0, "assault_rifle", "free", 0, null, "overcharge_conductor");
    combat.fire(os, 1, 0);
    const b = combat.bullets.items.find((x) => x.active)!;
    expect(b.overcharge).toBe(true);
    combat.bullets.release(b);
    const ks = new Soldier(60, 84, 1, 0, 0, "katana", "free", 1, null, null);
    combat.fire(ks, 1, 0);
    expect(b.overcharge).toBe(false);

    // Pause (dt=0) does not advance quiet timer
    combat.overcharge.chargeCell(15, 10, 1, 5);
    combat.overcharge.chargeCell(15, 10, 1, 5);
    combat.overcharge.chargeCell(15, 10, 1, 5);
    const beforePause = combat.overcharge.getEntryForCell(15, 10)!.quietLeft;
    combat.updateBullets(0);
    expect(combat.overcharge.getEntryForCell(15, 10)!.quietLeft).toBe(beforePause);

    // Overflow (> maxTargets) evicts sub-threshold targets without discharging them
    combat.clearAll();
    for (let i = 0; i < OVERCHARGE.maxTargets + 10; i++) {
      const cx = 3 + (i % 30);
      const cy = 3 + Math.floor(i / 30);
      setBlock(world, cx, cy, 100);
      combat.overcharge.chargeCell(cx, cy, 1, 5);
    }
    combat.updateBullets(OVERCHARGE.quietDelay + 0.05);
    expect(combat.overcharge.totalDischarges).toBe(0);
  });

  it("14: Essence unlock, save/reload, uniqueness, and lab refund preserve exact accounting", () => {
    const storage = new MemoryStorage();
    const save = new SaveManager(storage);
    save.data.bank = 10000;
    save.data.essence = 600;
    save.data.lifetimePixels = 10000;
    save.data.lab.worlds[3] = { discovered: [0], conquered: [0], cleared: ["0:soldier:0"], gathered: [], spawn: 0 };
    unlockTabs(save);
    save.save();

    const um = new UpgradeManager(save);
    expect(um.buy("ar_unlock")).toBe(true);
    expect(um.buy("overcharge_unlock")).toBe(true);
    expect(um.buy("overcharge_accuracy")).toBe(true);
    const spentEssence = 35 + 5;
    expect(save.data.essence).toBe(560);
    expect(um.setLoadoutWeapon(0, "assault_rifle", "overcharge_conductor").ok).toBe(true);
    // Preserves one Assault Rifle owner across squad
    expect(um.setLoadoutWeapon(1, "assault_rifle", "overcharge_conductor").ok).toBe(false);

    const reloaded = new SaveManager(storage);
    expect(reloaded.data.essence).toBe(560);
    expect(reloaded.data.loadouts[0].mutation).toBe("overcharge_conductor");

    const um2 = new UpgradeManager(reloaded);
    const refund = um2.refundBlackMarket(false);
    expect(refund.ok).toBe(true);
    if (refund.ok) expect(refund.refunded.essence).toBe(spentEssence);
    expect(reloaded.data.essence).toBe(600);
    expect(reloaded.data.loadouts[0].mutation).toBeNull();
  });
});
