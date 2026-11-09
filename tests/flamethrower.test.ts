import { unlockTabs } from "./helpers/progression";
import { describe, expect, it } from "vitest";
import { FIRE, FLAMETHROWER } from "../src/config";
import { Rng } from "../src/core/Rng";
import { Soldier } from "../src/entities/Soldier";
import { SaveManager, type StorageLike } from "../src/progression/SaveManager";
import { UpgradeManager } from "../src/progression/UpgradeManager";
import { CombatSystem } from "../src/systems/CombatSystem";
import { BURN, CHAR_TINT, FireSystem, FKind, flicker } from "../src/systems/FireSystem";
import { PixelWorld, SUB } from "../src/world/PixelWorld";

class MemStorage implements StorageLike {
  map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
}

function world(): PixelWorld {
  return new PixelWorld({ width: 40, height: 40, cellSize: 8, roomSize: 6 });
}

function rubble(w: PixelWorld, sx: number, sy: number, hp = 6): number {
  const si = sy * w.subWidth + sx;
  w.subKind[si] = SUB.rubble;
  w.subHealth[si] = hp;
  w.subTint[si] = (12 << 3) | 0;
  return si;
}

describe("Flamethrower weapon", () => {
  it("gates its tree behind the unlock and applies upgrades", () => {
    const save = new SaveManager(new MemStorage());
    unlockTabs(save);
    const upg = new UpgradeManager(save);
    save.data.bank = 100_000;
    save.data.crystals = 100_000;
    save.data.lifetimePixels = 500;

    expect(upg.isUnlocked("flame_damage")).toBe(false);
    expect(upg.buy("flame_unlock")).toBe(true);
    expect(upg.buy("flame_damage")).toBe(true);
    expect(upg.buy("flame_range")).toBe(true);
    expect(upg.buy("flame_fire_rate")).toBe(true);
    expect(upg.buy("flame_kindling")).toBe(true);

    const st = upg.getSoldierStats();
    expect(st.flameUnlocked).toBe(true);
    expect(st.flameDamage).toBe(FLAMETHROWER.damage + 1);
    expect(st.flameLifetime).toBeCloseTo(FLAMETHROWER.lifetime * 1.15, 5);
    expect(st.flameFireRate).toBeCloseTo(FLAMETHROWER.fireRate * 1.12, 5);
    expect(st.flameBurnMult).toBeCloseTo(1.3, 5);
  });

  it("keeps a flamethrower loadout only while unlocked", () => {
    const store = new MemStorage();
    const s1 = new SaveManager(store);
    s1.data.upgrades.flame_unlock = 1;
    s1.data.loadouts[0].weapon = "flamethrower";
    s1.save();
    expect(new SaveManager(store).data.loadouts[0].weapon).toBe("flamethrower");
    s1.data.upgrades.flame_unlock = 0;
    s1.save();
    expect(new SaveManager(store).data.loadouts[0].weapon).toBe("pistol");
  });

  it("fires short-lived flame jets (style 4)", () => {
    const stats = new UpgradeManager(new SaveManager(new MemStorage())).getSoldierStats();
    stats.flameUnlocked = true;
    const combat = new CombatSystem(world(), new Rng(3), stats);
    const s = new Soldier(100, 100, 1, 0, stats.speed, "flamethrower");
    combat.fire(s);
    const jet = combat.bullets.items.find((b) => b.active)!;
    expect(jet.style).toBe(4);
    expect(jet.life).toBeLessThan(FLAMETHROWER.lifetime * 1.2);
    expect(jet.speed).toBeLessThan(FLAMETHROWER.bulletSpeed * 1.2);
  });

  it("sets rubble alight instead of chipping it, and damages other terrain", () => {
    const w = world();
    const stats = new UpgradeManager(new SaveManager(new MemStorage())).getSoldierStats();
    const fire = new FireSystem(w, new Rng(5));
    const combat = new CombatSystem(w, new Rng(9), stats, {
      onFlameHit: (sx, sy) => fire.ignite(sx, sy) || fire.isBurning(sy * w.subWidth + sx),
    });
    // A rubble sub-pixel straight ahead of the soldier at subcell (30, 25).
    const si = rubble(w, 30, 25);
    const s = new Soldier(100, 25 * 4 + 2, 1, 0, stats.speed, "flamethrower");
    for (let i = 0; i < 20 && !fire.isBurning(si); i++) {
      combat.bullets.clear();
      combat.fire(s, 1, 0);
      for (let t = 0; t < 10; t++) combat.updateBullets(0.03);
    }
    expect(fire.isBurning(si)).toBe(true);
    expect(w.subHealth[si]).toBe(6);

    // A normal block takes flame damage as usual.
    w.setCell(15, 30, 9, "set", true);
    const s2 = new Soldier(100, 30 * 8 + 4, 1, 0, stats.speed, "flamethrower");
    combat.bullets.clear();
    combat.fire(s2, 1, 0);
    for (let t = 0; t < 12; t++) combat.updateBullets(0.03);
    expect(w.health[30 * w.width + 15]).toBeLessThan(9);
  });
});

describe("Burning rubble", () => {
  it("only ignites intact, unburnt rubble", () => {
    const w = world();
    const fire = new FireSystem(w, new Rng(1));
    expect(fire.ignite(10, 10)).toBe(false); // empty air
    rubble(w, 10, 10);
    expect(fire.ignite(10, 10)).toBe(true);
    expect(fire.ignite(10, 10)).toBe(false); // already burning
    w.setCell(20, 20, 5, "set", true);
    expect(fire.ignite(40, 40)).toBe(false); // a full block, not rubble
  });

  it("burns for a while, then leaves brittle charred rubble", () => {
    const w = world();
    const fire = new FireSystem(w, new Rng(2));
    const si = rubble(w, 12, 12);
    let charred = 0;
    fire.onChar = () => charred++;
    fire.ignite(12, 12);
    for (let t = 0; t < FIRE.burnMin - 0.5; t += 0.1) fire.update(0.1, []);
    expect(fire.isBurning(si)).toBe(true);
    for (let t = 0; t < FIRE.burnMax + 1; t += 0.1) fire.update(0.1, []);
    expect(fire.state[si]).toBe(BURN.charred);
    expect(w.subTint[si]).toBe(CHAR_TINT);
    expect(w.subHealth[si]).toBe(1);
    expect(charred).toBe(1);
    // Charred rubble can't catch again.
    expect(fire.ignite(12, 12)).toBe(false);
  });

  it("creeps through a heap but never jumps gaps", () => {
    const w = world();
    const fire = new FireSystem(w, new Rng(7));
    for (let x = 10; x < 20; x++) for (let y = 30; y < 34; y++) rubble(w, x, y);
    const lone = rubble(w, 30, 32);
    fire.ignite(10, 33);
    for (let t = 0; t < 30; t += 0.05) fire.update(0.05, []);
    let touched = 0;
    for (let x = 10; x < 20; x++) for (let y = 30; y < 34; y++) if (fire.state[y * w.subWidth + x] !== BURN.none) touched++;
    expect(touched).toBeGreaterThan(4);
    expect(fire.state[lone]).toBe(BURN.none);
  });

  it("stops burning when the rubble is shot away", () => {
    const w = world();
    const fire = new FireSystem(w, new Rng(3));
    const si = rubble(w, 8, 8);
    fire.ignite(8, 8);
    w.damageSub(8, 8, 99);
    fire.update(0.05, []);
    expect(fire.burnCount).toBe(0);
    expect(fire.state[si]).toBe(BURN.none);
  });

  it("sends flames upward from the top of a burning heap", () => {
    const w = world();
    const fire = new FireSystem(w, new Rng(4));
    rubble(w, 20, 40);
    fire.ignite(20, 40);
    for (let t = 0; t < 2; t += 0.05) fire.update(0.05, []);
    let flames = 0;
    let rising = 0;
    for (let i = 0; i < fire.count; i++) {
      if (fire.kind[i] !== FKind.Flame) continue;
      flames++;
      if (fire.y[i] < 40 * w.subCellSize) rising++;
    }
    expect(flames).toBeGreaterThan(0);
    expect(rising).toBe(flames);
  });

  it("gives burning heaps warm, gently flickering light", () => {
    const w = world();
    const fire = new FireSystem(w, new Rng(6));
    for (let x = 20; x < 26; x++) for (let y = 40; y < 44; y++) {
      rubble(w, x, y);
      fire.ignite(x, y);
    }
    fire.update(0.6, []);
    const lights = fire.collectLights(1);
    expect(lights.length).toBeGreaterThan(0);
    expect(lights.length).toBeLessThanOrEqual(FIRE.maxLights);
    for (const l of lights) {
      expect(l.warm).toBe(true);
      // Light sits in open air above the heap.
      expect(w.subSolidAt(Math.floor(l.x / w.subCellSize), Math.floor(l.y / w.subCellSize))).toBe(false);
    }
    // Flicker is subtle: never drops below ~78% or strobes.
    for (let t = 0; t < 5; t += 0.013) {
      const f = flicker(t, 3);
      expect(f).toBeGreaterThanOrEqual(0.77);
      expect(f).toBeLessThanOrEqual(1.0001);
    }
  });

  it("keeps flames out of solid terrain", () => {
    const w = world();
    const fire = new FireSystem(w, new Rng(8));
    // A ceiling over the spawn point.
    for (let x = 0; x < 40; x++) w.setCell(x, 9, 9, "set", true);
    for (let i = 0; i < 60; i++) fire.spawn(FKind.Flame, 100 + i * 0.5, 84, 0, -40, 1.5, 1);
    for (let t = 0; t < 1; t += 1 / 60) fire.update(1 / 60, []);
    for (let i = 0; i < fire.count; i++) {
      expect(w.subSolidAt(Math.floor(fire.x[i] / w.subCellSize), Math.floor(fire.y[i] / w.subCellSize))).toBe(false);
    }
  });
});
