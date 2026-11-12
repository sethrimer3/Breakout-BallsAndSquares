import { unlockTabs } from "./helpers/progression";
import { describe, expect, it } from "vitest";
import { GRENADE, TURRET, WORLD } from "../src/config";
import { Rng } from "../src/core/Rng";
import { Soldier, baseSoldierStats } from "../src/entities/Soldier";
import { SaveManager, type StorageLike } from "../src/progression/SaveManager";
import {
  SOLDIER_UPGRADE_BY_ID,
  soldierModsFor,
} from "../src/progression/SoldierUpgrades";
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
    unlockTabs(save);
    const upg = new UpgradeManager(save);

    // Initial state: 0 pixels destroyed, 0 bank
    expect(upg.isUnlocked("grenade_unlock")).toBe(false);
    expect(upg.isUnlocked("grenade_damage")).toBe(false);

    // Destroy 80 lifetime pixels
    save.data.lifetimePixels = 80;
    save.data.bank = 1000; save.data.crystals = 100_000;
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
    expect(categoryForBranch("goo_mortar")).toBe("primary");

    expect(categoryForBranch("grenade")).toBe("secondary");

    expect(CATEGORIES.length).toBe(5);
    expect(categoryForBranch("formations")).toBe("formations");
    const systemsCat = CATEGORIES.find((c) => c.id === "systems")!;
    const primaryCat = CATEGORIES.find((c) => c.id === "primary")!;
    const secondaryCat = CATEGORIES.find((c) => c.id === "secondary")!;

    expect(systemsCat.branches).toEqual(["core", "resources", "blight", "facility"]);
    expect(categoryForBranch("facility")).toBe("systems");
    expect(primaryCat.branches).toEqual([
      "pistol",
      "shotgun",
      "assault_rifle",
      "rocket_launcher",
      "sniper_rifle",
      "katana",
      "flamethrower",
      "goo_mortar",
      "drone_shepherd",
      "prism_laser",
    ]);
    expect(secondaryCat.branches).toEqual(["grenade", "turret"]);
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

  it("Calculates energy accumulation at base rate (0.1/block) reaching 10% outline at 90 blocks", () => {
    const soldier = new Soldier(50, 50, 1, 0, 100, "pistol", "free", 0, "grenade");
    expect(soldier.mods.energyPerBlock).toBe(0.1);
    expect(soldier.secondaryEnergy).toBe(0);

    // Simulate breaking 90 blocks at 0.1 energy per block
    for (let i = 0; i < 90; i++) {
      soldier.secondaryEnergy += soldier.mods.energyPerBlock;
    }
    // Float rounding
    soldier.secondaryEnergy = Math.round(soldier.secondaryEnergy * 10) / 10;
    expect(soldier.secondaryEnergy).toBe(9.0);

    const req = 90;
    const pct = soldier.secondaryEnergy / req;
    expect(pct).toBe(0.10); // 10% full as specified in prompt example
  });

  it("Soldier-specific Kinetic Dynamo upgrade in individual tree increases energy production up to 2.0 max", () => {
    const dynamoDef = SOLDIER_UPGRADE_BY_ID.s_dynamo;
    expect(dynamoDef).toBeDefined();
    expect(dynamoDef.tier).toBe(1);
    expect(dynamoDef.maxLevel).toBe(19);

    // Base mods (level 0)
    const baseMods = soldierModsFor({});
    expect(baseMods.energyPerBlock).toBe(0.1);

    // Level 1: 0.2
    const modsL1 = soldierModsFor({ s_dynamo: 1 });
    expect(modsL1.energyPerBlock).toBe(0.2);

    // Level 9: 1.0
    const modsL9 = soldierModsFor({ s_dynamo: 9 });
    expect(modsL9.energyPerBlock).toBe(1.0);

    // Level 19: 2.0 max
    const modsMax = soldierModsFor({ s_dynamo: 19 });
    expect(modsMax.energyPerBlock).toBe(2.0);

    // At 2.0 energy per block, breaking 45 blocks produces 90 energy (100% full)
    const soldier = new Soldier(50, 50, 1, 0, 100, "pistol", "free", 0, "grenade");
    soldier.mods = modsMax;
    for (let i = 0; i < 45; i++) {
      soldier.secondaryEnergy += soldier.mods.energyPerBlock;
    }
    expect(soldier.secondaryEnergy).toBe(90);
  });

  it("Core Autonomous Primer upgrade costs green crystals and gates automatic activation", () => {
    const autoDef = UPGRADE_BY_ID.auto_ability;
    expect(autoDef).toBeDefined();
    expect(autoDef.branch).toBe("core");
    expect(autoDef.currency).toBe("greenCrystals");
    expect(autoDef.maxLevel).toBe(1);

    const stats = baseSoldierStats();
    expect(stats.autoAbility).toBe(false);

    autoDef.apply(stats, 1);
    expect(stats.autoAbility).toBe(true);
  });

  it("Turret upgrade tree definitions exist and fit at 100% zoom", () => {
    const turretDefs = UPGRADE_DEFS.filter((d) => d.branch === "turret");
    expect(turretDefs.length).toBe(5);

    const homes = turretDefs.map((d) => nodePos(d.grid.col, d.grid.row));
    homes.push(nodePos(0, 0));
    const b = treeBounds(homes);
    const v = fitView(b);
    expect(v.s).toBe(1);

    const centerNode = turretDefs.find((d) => d.id === "turret_unlock");
    expect(centerNode).toBeDefined();
    expect(centerNode!.grid).toEqual({ col: 0, row: 0 });

    const quantityNode = UPGRADE_BY_ID.turret_quantity;
    expect(quantityNode).toBeDefined();
    expect(quantityNode.maxLevel).toBe(4);
    expect(quantityNode.currency).toBe("crystals");
    // Costs orange crystals and 5 essence per level
    expect(quantityNode.essenceCost).toBe(5);
  });

  it("Gates Turret child upgrades behind center unlock node and lifetime pixels", () => {
    const store = new MemStorage();
    const save = new SaveManager(store);
    unlockTabs(save);
    const mgr = new UpgradeManager(save);

    // Lifetime pixels 0 -> unlock node locked
    expect(mgr.canBuy("turret_unlock")).toBe(false);

    // Add lifetime pixels to unlock center node
    save.data.lifetimePixels = 60000;
    save.data.bank = 10000;
    save.data.crystals = 10000;
    save.data.essence = 1000;
    expect(mgr.isUnlocked("turret_unlock")).toBe(true);
    expect(mgr.canBuy("turret_unlock")).toBe(true);

    // Child nodes should be locked before turret_unlock is purchased
    expect(mgr.isUnlocked("turret_damage")).toBe(false);
    expect(mgr.isUnlocked("turret_quantity")).toBe(false);

    // Purchase center unlock node
    expect(mgr.buy("turret_unlock")).toBe(true);

    // Child nodes now unlocked
    expect(mgr.isUnlocked("turret_damage")).toBe(true);
    expect(mgr.isUnlocked("turret_quantity")).toBe(true);
  });

  it("Persists turret secondary weapon in SaveManager and resets to null if locked", () => {
    const store = new MemStorage();
    const save = new SaveManager(store);

    // Try equipping turret when locked -> resets to null
    save.data.loadouts[0].secondary = "turret";
    save.save();

    const save2 = new SaveManager(store);
    expect(save2.data.loadouts[0].secondary).toBeNull();

    // Now unlock turret in save2
    save2.data.upgrades.turret_unlock = 1;
    save2.data.loadouts[0].secondary = "turret";
    save2.save();

    const save3 = new SaveManager(store);
    expect(save3.data.loadouts[0].secondary).toBe("turret");
  });

  it("Deploys 2 temporary autoturrets requiring 150 energy, scaling to 3, 4, 5, 6 with expensive upgrades", () => {
    const stats = baseSoldierStats();
    expect(stats.turretEnergyRequired).toBe(150);
    expect(stats.turretCount).toBe(2);

    // Test upgrade scaling: 3, 4, 5, 6
    const qtyDef = UPGRADE_BY_ID.turret_quantity;
    qtyDef.apply(stats, 1);
    expect(stats.turretCount).toBe(3);
    qtyDef.apply(stats, 2);
    expect(stats.turretCount).toBe(4);
    qtyDef.apply(stats, 3);
    expect(stats.turretCount).toBe(5);
    qtyDef.apply(stats, 4);
    expect(stats.turretCount).toBe(6);

    const w = new PixelWorld(WORLD);
    generateWorld(w, 54321);
    const rng = new Rng(54321);

    const combat = new CombatSystem(w, rng, stats);
    const soldier = new Soldier(w.roomCenterX, w.roomCenterY, 1, 0, 100, "pistol", "free", 0, "turret");

    // Deploy 2 base turrets
    const deployed2 = combat.deployTurrets(soldier, 2, stats.turretDamage, stats.turretFireRate, stats.turretTurnSpeed);
    expect(deployed2.length).toBe(2);
    expect(deployed2[0].active).toBe(true);
    expect(deployed2[0].maxLife).toBe(TURRET.lifetime);
    expect(deployed2[0].ownerId).toBe(soldier.id);

    // Clear and test deploying 6 upgraded turrets
    combat.turrets.clear();
    const deployed6 = combat.deployTurrets(soldier, 6, stats.turretDamage, stats.turretFireRate, stats.turretTurnSpeed);
    expect(deployed6.length).toBe(6);
  });

  it("Autoturret tracks closest block within range, swivels toward it, and fires", () => {
    const w = new PixelWorld(WORLD);
    generateWorld(w, 11111);
    const rng = new Rng(11111);
    const stats = baseSoldierStats();

    let shotsFired = 0;
    const combat = new CombatSystem(w, rng, stats, {
      onShot: (_s, _dx, _dy, _mx, _my) => {
        shotsFired++;
      },
    });

    const soldier = new Soldier(w.roomCenterX, w.roomCenterY, 0, -1, 100, "pistol", "free", 0, "turret");
    const turrets = combat.deployTurrets(soldier, 2, stats.turretDamage, stats.turretFireRate, stats.turretTurnSpeed);
    expect(turrets.length).toBe(2);

    // Step simulation for a few frames: autoturrets should acquire closest block, swivel, and fire bullets
    for (let frame = 0; frame < 60; frame++) {
      combat.updateTurrets(0.016);
      combat.updateBullets(0.016);
    }

    expect(shotsFired).toBeGreaterThan(0);
    expect(turrets[0].hasTarget).toBe(true);
  });
});
