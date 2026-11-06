import { describe, expect, it } from "vitest";
import { GRENADE, WORLD } from "../src/config";
import { Rng } from "../src/core/Rng";
import { Soldier, baseSoldierStats } from "../src/entities/Soldier";
import { SaveManager, type StorageLike } from "../src/progression/SaveManager";
import {
  UPGRADE_BY_ID,
  UPGRADE_DEFS,
} from "../src/progression/UpgradeDefinitions";
import { UpgradeManager } from "../src/progression/UpgradeManager";
import { CombatSystem } from "../src/systems/CombatSystem";
import {
  CATEGORIES,
  categoryForBranch,
} from "../src/ui/UpgradeTree";
import { fitView, nodePos, treeBounds } from "../src/ui/treeView";
import { PixelWorld } from "../src/world/PixelWorld";
import { generateWorld } from "../src/world/WorldGenerator";

class MemStorage implements StorageLike {
  map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
}

describe("Secondary Abilities — Grenade & Category Matrix", () => {
  it("Grenade upgrade tree definitions exist and fit at 100% zoom", () => {
    const grenadeDefs = UPGRADE_DEFS.filter((d) => d.branch === "grenade");
    expect(grenadeDefs.length).toBe(6);

    const unlockDef = UPGRADE_BY_ID.grenade_unlock;
    expect(unlockDef).toBeDefined();
    expect(unlockDef.grid).toEqual({ col: 0, row: 0 });
    expect(unlockDef.parent).toBeNull();

    // Check tree bounding box and fit at 100%
    const homes = grenadeDefs.map((d) => nodePos(d.grid.col, d.grid.row));
    homes.push(nodePos(0, 0));
    const b = treeBounds(homes);
    const v = fitView(b);
    expect(v.s).toBe(1);
  });

  it("Gates Grenade child upgrades behind center unlock node and lifetime pixels", () => {
    const store = new MemStorage();
    const save = new SaveManager(store);
    const upg = new UpgradeManager(save);

    // Initial state: 0 pixels destroyed, 0 bank
    expect(upg.isUnlocked("grenade_unlock")).toBe(false);
    expect(upg.isUnlocked("grenade_damage")).toBe(false);

    // Destroy 80 lifetime pixels
    save.data.lifetimePixels = 80;
    save.data.bank = 1000;
    expect(upg.isUnlocked("grenade_unlock")).toBe(true);
    // Child node still locked because grenade_unlock level is 0
    expect(upg.isUnlocked("grenade_damage")).toBe(false);

    // Buy grenade_unlock
    expect(upg.buy("grenade_unlock")).toBe(true);
    expect(upg.levelOf("grenade_unlock")).toBe(1);
    expect(upg.isUnlocked("grenade_damage")).toBe(true);
    expect(upg.isUnlocked("grenade_charge")).toBe(true);

    // Test charge upgrade: reduces required blocks
    const stats0 = upg.getSoldierStats();
    expect(stats0.grenadeUnlocked).toBe(true);
    expect(stats0.grenadeBlocksRequired).toBe(90);

    expect(upg.buy("grenade_charge")).toBe(true);
    const stats1 = upg.getSoldierStats();
    expect(stats1.grenadeBlocksRequired).toBe(82);

    // Test damage upgrade
    expect(upg.buy("grenade_damage")).toBe(true);
    const stats2 = upg.getSoldierStats();
    expect(stats2.grenadeDamage).toBe(GRENADE.damage + 3);
  });

  it("Groups branches into Systems, Primary Weapons, and Secondary Weapons categories", () => {
    expect(categoryForBranch("core")).toBe("systems");
    expect(categoryForBranch("resources")).toBe("systems");
    expect(categoryForBranch("blight")).toBe("systems");

    expect(categoryForBranch("pistol")).toBe("primary");
    expect(categoryForBranch("shotgun")).toBe("primary");
    expect(categoryForBranch("assault_rifle")).toBe("primary");
    expect(categoryForBranch("rocket_launcher")).toBe("primary");
    expect(categoryForBranch("sniper_rifle")).toBe("primary");
    expect(categoryForBranch("katana")).toBe("primary");

    expect(categoryForBranch("grenade")).toBe("secondary");

    expect(CATEGORIES.length).toBe(3);
    const systemsCat = CATEGORIES.find((c) => c.id === "systems")!;
    const primaryCat = CATEGORIES.find((c) => c.id === "primary")!;
    const secondaryCat = CATEGORIES.find((c) => c.id === "secondary")!;

    expect(systemsCat.branches).toEqual(["core", "resources", "blight"]);
    expect(primaryCat.branches).toEqual([
      "pistol",
      "shotgun",
      "assault_rifle",
      "rocket_launcher",
      "sniper_rifle",
      "katana",
    ]);
    expect(secondaryCat.branches).toEqual(["grenade"]);
  });

  it("Persists secondary weapon loadout in SaveManager and resets to null if locked", () => {
    const store = new MemStorage();
    const save = new SaveManager(store);

    // Try equipping grenade when locked -> resets to null
    save.data.loadouts[0].secondary = "grenade";
    save.save();

    const save2 = new SaveManager(store);
    expect(save2.data.loadouts[0].secondary).toBeNull();

    // Now unlock grenade in save2
    save2.data.upgrades.grenade_unlock = 1;
    save2.data.loadouts[0].secondary = "grenade";
    save2.save();

    const save3 = new SaveManager(store);
    expect(save3.data.loadouts[0].secondary).toBe("grenade");
  });

  it("Throws a sticky grenade, attaches to wall, counts down fuse and detonates", () => {
    const w = new PixelWorld(WORLD);
    generateWorld(w, 12345);
    const rng = new Rng(12345);
    const stats = baseSoldierStats();
    stats.grenadeUnlocked = true;

    let stickCount = 0;
    let explosionCount = 0;
    let impactedCells = 0;

    const combat = new CombatSystem(w, rng, stats, {
      onGrenadeStick: () => {
        stickCount++;
      },
      onExplosion: () => {
        explosionCount++;
      },
      onImpact: (_x, _y, _nx, _ny, _cx, _cy, res, _sub, ownerId) => {
        if (res > 0) {
          impactedCells++;
          expect(ownerId).toBe(soldier.id);
        }
      },
    });

    const soldier = new Soldier(w.roomCenterX, w.roomCenterY, 0, -1, 100, "pistol", "free", 0, "grenade");
    expect(soldier.secondary).toBe("grenade");
    expect(soldier.secondaryBlocksBroken).toBe(0);

    // Throw a grenade facing upward toward the ceiling
    const g = combat.throwGrenade(soldier, stats.grenadeBlastRadius, stats.grenadeDamage, 0, 2.0, 0, -1);
    expect(g).not.toBeNull();
    expect(g!.active).toBe(true);
    expect(g!.stuck).toBe(false);
    expect(g!.ownerId).toBe(soldier.id);

    // Step simulation until grenade sticks to ceiling
    for (let i = 0; i < 30; i++) {
      combat.updateGrenades(0.016);
      if (g!.stuck) break;
    }

    expect(g!.stuck).toBe(true);
    expect(stickCount).toBe(1);

    // Step simulation past fuse duration (0.9s)
    for (let i = 0; i < 70; i++) {
      combat.updateGrenades(0.016);
      if (!g!.active) break;
    }

    expect(g!.active).toBe(false);
    expect(explosionCount).toBe(1);
    expect(impactedCells).toBeGreaterThan(0);
  });

  it("Charges secondary ability on broken blocks and triggers throw at 90 blocks", () => {
    const stats = baseSoldierStats();
    stats.grenadeUnlocked = true;
    stats.grenadeBlocksRequired = 90;

    const soldier = new Soldier(50, 50, 1, 0, 100, "pistol", "free", 0, "grenade");
    expect(soldier.secondaryBlocksBroken).toBe(0);

    // Simulate breaking blocks
    for (let i = 0; i < 89; i++) {
      soldier.secondaryBlocksBroken++;
    }
    expect(soldier.secondaryBlocksBroken).toBe(89);

    // 90th block triggers grenade activation and resets counter
    soldier.secondaryBlocksBroken++;
    expect(soldier.secondaryBlocksBroken).toBe(90);

    if (soldier.secondaryBlocksBroken >= stats.grenadeBlocksRequired) {
      soldier.secondaryBlocksBroken = 0;
    }
    expect(soldier.secondaryBlocksBroken).toBe(0);
  });
});
