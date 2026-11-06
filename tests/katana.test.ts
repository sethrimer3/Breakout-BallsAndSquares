import { describe, expect, it } from "vitest";
import { KATANA } from "../src/config";
import { Rng } from "../src/core/Rng";
import { Soldier } from "../src/entities/Soldier";
import { SaveManager, type StorageLike } from "../src/progression/SaveManager";
import { UpgradeManager } from "../src/progression/UpgradeManager";
import { CombatSystem } from "../src/systems/CombatSystem";
import { DECOR } from "../src/world/LabDetails";
import { PixelWorld } from "../src/world/PixelWorld";

class MemStorage implements StorageLike {
  map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
}

describe("Katana Weapon & Blight Damage Multiplier", () => {
  it("gates Katana unlock and scales upgrades through the UpgradeManager", () => {
    const save = new SaveManager(new MemStorage());
    const upg = new UpgradeManager(save);
    save.data.bank = 100_000;
    save.data.lifetimePixels = 500;

    // Gated until katana_unlock is purchased
    expect(upg.isUnlocked("katana_damage")).toBe(false);
    expect(upg.isUnlocked("katana_blight_mult")).toBe(false);
    expect(upg.isUnlocked("katana_unlock")).toBe(true);

    expect(upg.buy("katana_unlock")).toBe(true);
    expect(upg.isUnlocked("katana_damage")).toBe(true);
    expect(upg.isUnlocked("katana_blight_mult")).toBe(true);

    // Buy damage and blight multiplier upgrades
    expect(upg.buy("katana_damage")).toBe(true);
    expect(upg.buy("katana_blight_mult")).toBe(true);
    expect(upg.buy("katana_pierce")).toBe(true);
    expect(upg.buy("katana_arc")).toBe(true);

    const stats = upg.getSoldierStats();
    expect(stats.katanaUnlocked).toBe(true);
    expect(stats.katanaDamage).toBe(KATANA.damage + 2);
    expect(stats.katanaBlightMultiplier).toBeCloseTo(KATANA.blightMultiplier + 0.5, 5);
    expect(stats.katanaPierce).toBe(KATANA.pierce + 1);
    expect(stats.katanaSlashWidth).toBe(KATANA.slashWidth + 3);
  });

  it("persists Katana in soldier loadout and reverts if locked", () => {
    const store = new MemStorage();
    const save1 = new SaveManager(store);
    save1.data.upgrades.katana_unlock = 1;
    save1.data.loadouts[0].weapon = "katana";
    save1.save();

    const save2 = new SaveManager(store);
    expect(save2.data.loadouts[0].weapon).toBe("katana");

    // If katana_unlock is 0, falls back to pistol
    save2.data.upgrades.katana_unlock = 0;
    save2.save();

    const save3 = new SaveManager(store);
    expect(save3.data.loadouts[0].weapon).toBe("pistol");
  });

  it("fires slashes with visual style = 3, slash width, and alternating swing angles", () => {
    const store = new MemStorage();
    const save = new SaveManager(store);
    const upg = new UpgradeManager(save);
    const stats = upg.getSoldierStats();
    stats.katanaUnlocked = true;

    const world = new PixelWorld({ width: 30, height: 30, cellSize: 8, roomSize: 6 });
    const combat = new CombatSystem(world, new Rng(42), stats);

    const soldier = new Soldier(100, 100, 1, 0, stats.speed, "katana");
    soldier.fireCooldown = 0;

    // Swing 1
    combat.fire(soldier);
    expect(combat.bullets.activeCount).toBe(1);
    const slash1 = combat.bullets.items.find((b) => b.active)!;
    expect(slash1.style).toBe(3); // Style 3 = Katana slash
    expect(slash1.damage).toBe(stats.katanaDamage);
    expect(slash1.blightMultiplier).toBe(stats.katanaBlightMultiplier);
    expect(slash1.slashWidth).toBe(stats.katanaSlashWidth);
    const angle1 = slash1.slashAngle;

    combat.bullets.clear();

    // Swing 2 (alternating swing angle)
    combat.fire(soldier);
    const slash2 = combat.bullets.items.find((b) => b.active)!;
    expect(slash2.style).toBe(3);
    expect(slash2.slashAngle).toBe(-angle1); // Alternated!
  });

  it("deals normal damage to regular blocks, but applies the multiplier ONLY to Blight blocks", () => {
    const store = new MemStorage();
    const save = new SaveManager(store);
    const upg = new UpgradeManager(save);
    const stats = upg.getSoldierStats();
    stats.katanaUnlocked = true;
    stats.katanaDamage = 3;
    stats.katanaBlightMultiplier = 3.0; // 3x multiplier vs blight
    stats.globalDamageBonus = 0;

    const w = new PixelWorld({ width: 40, height: 40, cellSize: 10, roomSize: 6 });

    // Set up 4 different cells with 9 HP:
    // Cell (10, 5): Regular normal lab block (not blight)
    w.setCell(10, 5, 9, "set", true);
    expect(w.isBlightAt(10, 5)).toBe(false);

    // Cell (15, 5): Grown Blight block (grown by GrowthSystem)
    w.setCell(15, 5, 9, "grown", true);
    expect(w.isBlightAt(15, 5)).toBe(true);

    // Cell (20, 5): Blight Core block
    w.setCell(20, 5, 9, "set", true);
    w.coreId[5 * w.width + 20] = 1;
    expect(w.isBlightAt(20, 5)).toBe(true);

    // Cell (25, 5): Blight overrun decor block
    w.setCell(25, 5, 9, "set", true);
    w.decor[5 * w.width + 25] = DECOR.blightFloor;
    expect(w.isBlightAt(25, 5)).toBe(true);

    const combat = new CombatSystem(w, new Rng(123), stats);

    // 1. Attack normal block at (10, 5) with Katana slash
    // Normal damage = 3 -> cell should have 9 - 3 = 6 HP remaining (multiplier NOT applied!)
    const s1 = new Soldier(70, 55, 1, 0, stats.speed, "katana");
    s1.fireCooldown = 0;
    combat.fire(s1);
    combat.updateBullets(0.15);

    const normalHp = w.health[5 * w.width + 10];
    expect(normalHp).toBe(6); // Multiplier not applied to regular block!
    combat.bullets.clear();

    // 2. Attack Grown Blight block at (15, 5) with Katana slash
    // Multiplier 3x * 3 dmg = 9 damage -> completely destroys the 9 HP blight block!
    const s2 = new Soldier(120, 55, 1, 0, stats.speed, "katana");
    s2.fireCooldown = 0;
    combat.fire(s2);
    combat.updateBullets(0.15);

    const grownBlightHp = w.health[5 * w.width + 15];
    expect(grownBlightHp).toBe(0); // Destroyed because of 3x blight multiplier!
    combat.bullets.clear();

    // 3. Attack Blight Core block at (20, 5) with Katana slash
    // Multiplier 3x * 3 dmg = 9 damage -> destroys the 9 HP core block!
    const s3 = new Soldier(170, 55, 1, 0, stats.speed, "katana");
    s3.fireCooldown = 0;
    combat.fire(s3);
    combat.updateBullets(0.15);

    const coreBlightHp = w.health[5 * w.width + 20];
    expect(coreBlightHp).toBe(0); // Destroyed by 3x blight multiplier!
    combat.bullets.clear();

    // 4. Attack Blight decor block at (25, 5) with Katana slash
    // Multiplier 3x * 3 dmg = 9 damage -> destroys the 9 HP decor block!
    const s4 = new Soldier(220, 55, 1, 0, stats.speed, "katana");
    s4.fireCooldown = 0;
    combat.fire(s4);
    combat.updateBullets(0.15);

    const decorBlightHp = w.health[5 * w.width + 25];
    expect(decorBlightHp).toBe(0); // Destroyed by 3x blight multiplier!
    combat.bullets.clear();
  });

  it("applies the damage multiplier to 50% pink sub-pixel blight", () => {
    const store = new MemStorage();
    const save = new SaveManager(store);
    const upg = new UpgradeManager(save);
    const stats = upg.getSoldierStats();
    stats.katanaUnlocked = true;
    stats.katanaDamage = 2;
    stats.katanaBlightMultiplier = 3.0; // 2 * 3 = 6 damage to pink sub-blight

    const w = new PixelWorld({ width: 30, height: 30, cellSize: 10, roomSize: 6 });
    // Subcell at sx = 20, sy = 20 (inside normal cell cx = 10, cy = 10)
    w.setSubCell(20, 20, 6, "grown", true);
    expect(w.isBlightSubAt(20, 20)).toBe(true);

    const combat = new CombatSystem(w, new Rng(111), stats);
    // Subcell 20 in world units is 20 * 5 = 100.
    // Soldier at x = 75, y = 102.5, aiming right
    const s = new Soldier(75, 102.5, 1, 0, stats.speed, "katana");
    s.fireCooldown = 0;
    combat.fire(s);
    combat.updateBullets(0.15);

    // Pink sub-pixel had 6 HP; 2 dmg * 3 = 6 dmg -> completely destroyed!
    const remainingSubHp = w.subHealth[20 * w.subWidth + 20];
    expect(remainingSubHp).toBe(0);
  });

  it("does not apply the blight multiplier when using non-katana weapons", () => {
    const store = new MemStorage();
    const save = new SaveManager(store);
    const upg = new UpgradeManager(save);
    const stats = upg.getSoldierStats();
    stats.damage = 3; // Pistol damage = 3

    const w = new PixelWorld({ width: 30, height: 30, cellSize: 10, roomSize: 6 });
    // Grown blight cell with 9 HP
    w.setCell(10, 5, 9, "grown", true);
    expect(w.isBlightAt(10, 5)).toBe(true);

    const combat = new CombatSystem(w, new Rng(1), stats);
    const pistolSoldier = new Soldier(70, 55, 1, 0, stats.speed, "pistol");
    pistolSoldier.fireCooldown = 0;
    combat.fire(pistolSoldier);
    combat.updateBullets(0.15);

    // Pistol bullet does not have blightMultiplier -> deals standard 3 damage (9 - 3 = 6 HP left)
    const remainingHp = w.health[5 * w.width + 10];
    expect(remainingHp).toBe(6);
  });

  it("cleaves adjacent cells across the slash arc width", () => {
    const store = new MemStorage();
    const save = new SaveManager(store);
    const upg = new UpgradeManager(save);
    const stats = upg.getSoldierStats();
    stats.katanaUnlocked = true;
    stats.katanaDamage = 5;
    stats.katanaBlightMultiplier = 1.0;
    stats.katanaSlashWidth = 16; // 16 units wide

    const w = new PixelWorld({ width: 30, height: 30, cellSize: 10, roomSize: 6 });
    // Center block at (10, 5) and adjacent block at (10, 6)
    w.setCell(10, 5, 5, "set", true);
    w.setCell(10, 6, 5, "set", true);

    const combat = new CombatSystem(w, new Rng(1), stats);
    // Soldier at x = 70, y = 55 aiming right (dx = 1, dy = 0)
    // Directly hits row 5, and the side cleave reaches row 6!
    const s = new Soldier(70, 55, 1, 0, stats.speed, "katana");
    s.fireCooldown = 0;
    combat.fire(s);
    combat.updateBullets(0.15);

    // Both center block and cleaved side block should take damage!
    expect(w.health[5 * w.width + 10]).toBe(0);
    expect(w.health[6 * w.width + 10]).toBe(0);
  });

  it("spawns a cross-slash when multishot triggers", () => {
    const store = new MemStorage();
    const save = new SaveManager(store);
    const upg = new UpgradeManager(save);
    const stats = upg.getSoldierStats();
    stats.katanaUnlocked = true;
    stats.multishotChance = 1.0; // 100% multishot

    const w = new PixelWorld({ width: 30, height: 30, cellSize: 10, roomSize: 6 });
    const combat = new CombatSystem(w, new Rng(1), stats);

    const s = new Soldier(100, 100, 1, 0, stats.speed, "katana");
    s.fireCooldown = 0;
    combat.fire(s);

    // Should have spawned 2 slashes: main slash and cross-slash
    const active = combat.bullets.items.filter((b) => b.active);
    expect(active.length).toBe(2);
    expect(active[0].style).toBe(3);
    expect(active[1].style).toBe(3);
    expect(active[0].slashAngle).toBe(-active[1].slashAngle);
  });
});
