import { describe, expect, it, vi } from "vitest";
import { Rng } from "../src/core/Rng";
import { LootKind, LootSystem } from "../src/entities/LootSystem";
import { Soldier, baseSoldierStats } from "../src/entities/Soldier";
import { latentTree } from "../src/progression/LatentAbilities";
import { SaveManager, sanitizeSaveData, type StorageLike } from "../src/progression/SaveManager";
import { UpgradeManager } from "../src/progression/UpgradeManager";
import { CombatSystem } from "../src/systems/CombatSystem";
import { PhysicsSystem } from "../src/systems/PhysicsSystem";
import { PixelWorld } from "../src/world/PixelWorld";

const soldier = (slot: number, x = 100, y = 100) => new Soldier(x, y, 1, 0, 60, "pistol", "free", slot);
const room = () => new PixelWorld({ width: 32, height: 32, cellSize: 8, roomSize: 4 });

describe("latent soldier research", () => {
  it("charges DNA once and Blight Essence for independent ranks on the correct shape", () => {
    const map = new Map<string, string>();
    const storage: StorageLike = {
      getItem: (key) => map.get(key) ?? null,
      setItem: (key, value) => { map.set(key, value); },
    };
    const save = new SaveManager(storage);
    const upgrades = new UpgradeManager(save);
    save.data.exoticMatter = 2;
    save.data.essence = 1_000;
    expect(upgrades.latentBuy(0, "latent_resources")).toBe(false);
    expect(upgrades.latentBuy(1, "latent_unlock")).toBe(false);
    expect(upgrades.latentBuy(0, "latent_unlock")).toBe(true);
    expect(upgrades.latentBuy(0, "latent_unlock")).toBe(false);
    expect(upgrades.latentBuy(0, "latent_resources")).toBe(true);
    expect(upgrades.latentBuy(0, "latent_armor")).toBe(false);
    expect(save.data.exoticMatter).toBe(1);
    expect(save.data.essence).toBe(990);
    const loaded = new SaveManager(storage);
    expect(loaded.data.loadouts[0].latent).toEqual({ latent_unlock: 1, latent_resources: 1 });
    const orb = soldier(0);
    orb.applyLatentAbilities(loaded.data.loadouts[0].latent);
    expect(orb.resourceBonusPct).toBe(10);
    expect(orb.pickupRangeScale).toBe(1.05);
    expect(latentTree(7)).toHaveLength(0);
    expect(sanitizeSaveData({ loadouts: [{ latent: { latent_resources: 9 } }] }).loadouts[0].latent).toBeUndefined();
  });

  it("keeps traits dormant and reaches the requested caps", () => {
    const triangle = soldier(1);
    const hexagon = soldier(4);
    const diamond = soldier(6);
    expect(triangle.fireRateScale).toBe(1);
    expect(hexagon.projectileScale).toBe(1);
    expect(diamond.wingmen).toHaveLength(0);

    triangle.applyLatentAbilities({ latent_unlock: 1 });
    hexagon.applyLatentAbilities({ latent_unlock: 1 });
    diamond.applyLatentAbilities({ latent_unlock: 1, latent_tracking: 4, latent_wingmen: 5 });
    expect(triangle.fireRateScale).toBe(1.05);
    expect(hexagon.projectileScale).toBe(1.1);
    expect(diamond.wingmen).toHaveLength(2);
    expect(diamond.damageScale).toBe(0.5);
    expect(diamond.wingmanSpacing).toBe(0.75);
    expect(diamond.wingmanTracking).toBe(36);

    const square = soldier(2);
    square.applyLatentAbilities({ latent_unlock: 1, latent_armor: 9 });
    expect(square.incomingDamageScale).toBe(0.5);
    const sphere = soldier(0);
    sphere.applyLatentAbilities({ latent_unlock: 1, latent_resources: 9, latent_magnet: 9 });
    expect(sphere.resourceBonusPct).toBe(50);
    expect(sphere.pickupRangeScale).toBe(1.5);
  });

  it("credits fractional pickup bonuses to the sphere that collects them", () => {
    const loot = new LootSystem();
    const rng = new Rng(7);
    const orb = soldier(0);
    orb.applyLatentAbilities({ latent_unlock: 1 });
    const rival = soldier(1, 140);
    for (let i = 0; i < 20; i++) loot.spawnOne(orb.x, orb.y, 5, rng, LootKind.Essence);
    expect(loot.update(0, [orb, rival], 20)).toBe(20);
    expect(loot.collectedEssence).toBe(21);
    for (let i = 0; i < 20; i++) loot.spawnOne(rival.x, rival.y, 5, rng, LootKind.Essence);
    expect(loot.update(0, [orb, rival], 20)).toBe(20);
    expect(loot.collectedEssence).toBe(20);
  });

  it("boosts player damage inside the living Pentagon's aura only", () => {
    const world = room();
    const pentagon = soldier(3);
    pentagon.applyLatentAbilities({ latent_unlock: 1, latent_aura_damage: 9, latent_aura_range: 10 });
    world.damageAuraSoldier = pentagon;
    expect(pentagon.auraRadiusCells).toBe(8);
    const hp = (cx: number) => world.health[12 * world.width + cx];
    world.setCell(13, 12, 100);
    world.setCell(25, 12, 100);
    world.damage(13, 12, 10, true);
    world.damage(25, 12, 10, true);
    world.damage(13, 12, 10, false);
    expect(hp(13)).toBe(75);
    expect(hp(25)).toBe(90);
    pentagon.alive = false;
    world.damage(13, 12, 10, true);
    expect(hp(13)).toBe(65);
  });

  it("explodes on a real wall rebound with weapon damage and fades to normal speed in one second", () => {
    const world = room();
    const stats = baseSoldierStats();
    stats.damage = 20;
    const onExplosion = vi.fn();
    const rng = new Rng(1);
    const combat = new CombatSystem(world, rng, stats, { onExplosion });
    const physics = new PhysicsSystem(world, rng);
    const chevron = soldier(5, 99);
    chevron.applyLatentAbilities({ latent_unlock: 1, latent_rebound: 9, latent_blast_damage: 4, latent_blast_range: 4 });
    world.setCell(13, 12, 100);
    expect(physics.step(chevron, 0.05, stats, undefined, (s, nx, ny) => combat.onSoldierBounce(s, nx, ny))).toBe(1);
    expect(onExplosion.mock.calls[0][2]).toBe(20);
    expect(onExplosion.mock.calls[0][3]).toBe(10);
    expect(world.health[12 * world.width + 13]).toBeLessThan(100);
    expect(Math.hypot(chevron.vx, chevron.vy)).toBeCloseTo(90);
    physics.step(chevron, 0.5);
    expect(Math.hypot(chevron.vx, chevron.vy)).toBeCloseTo(75);
    physics.step(chevron, 0.5);
    expect(Math.hypot(chevron.vx, chevron.vy)).toBeCloseTo(60);
  });
});
