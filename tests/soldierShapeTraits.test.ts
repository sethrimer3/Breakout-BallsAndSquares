import { describe, expect, it, vi } from "vitest";
import { Rng } from "../src/core/Rng";
import { Soldier, baseSoldierStats } from "../src/entities/Soldier";
import { CombatSystem } from "../src/systems/CombatSystem";
import { PixelWorld } from "../src/world/PixelWorld";

function fixture() {
  const world = new PixelWorld({ width: 32, height: 32, cellSize: 8, roomSize: 4 });
  const stats = baseSoldierStats();
  const onShot = vi.fn();
  const onExplosion = vi.fn();
  const combat = new CombatSystem(world, new Rng(12), stats, { onShot, onExplosion });
  const bullets = () => combat.bullets.items.filter((b) => b.active);
  return { world, stats, combat, onShot, onExplosion, bullets };
}

describe("soldier shape traits", () => {
  it("multiplies triangle cadence after the squad and soldier upgrades", () => {
    const { stats, combat, onShot } = fixture();
    stats.globalFireRateMult = 1.2;
    const triangle = new Soldier(100, 100, 1, 0, 0, "pistol", "free", 1);
    triangle.applyLatentAbilities({ latent_unlock: 1, latent_cadence: 9 });
    triangle.mods.fireRateMult = 1.1;
    const rate = stats.fireRate * 1.2 * 1.1 * 1.5;
    expect(combat.effectiveFireRate(triangle)).toBeCloseTo(rate);
    triangle.fireCooldown = 0;
    combat.updateSoldier(triangle, 0);
    expect(onShot).toHaveBeenCalledTimes(1);
    expect(triangle.fireCooldown).toBeCloseTo(1 / rate);
  });

  it("fires from both trailing diamonds at half damage and preserves half-point terrain hits", () => {
    const { world, stats, combat, onShot, bullets } = fixture();
    stats.damage = 1;
    const diamond = new Soldier(100, 100, 1, 0, 0, "pistol", "free", 6);
    diamond.applyLatentAbilities({ latent_unlock: 1 });
    combat.fire(diamond, 1, 0);
    expect(onShot).toHaveBeenCalledTimes(2);
    expect(bullets()).toHaveLength(2);
    expect(bullets().map(({ x, y }) => [x, y])).toEqual(diamond.wingmen.map(({ x, y }) => [x, y]));
    expect(bullets().every((b) => b.ownerId === diamond.id && b.damage === 0.5 && b.x < diamond.x)).toBe(true);
    expect(bullets()[0].y).toBeLessThan(diamond.y);
    expect(bullets()[1].y).toBeGreaterThan(diamond.y);

    const first = diamond.wingmen[0];
    const cy = Math.floor(first.y / world.cellSize);
    const cx = 15;
    world.setCell(cx, cy, 3);
    combat.updateBullets(0.12);
    expect(world.health[cy * world.width + cx]).toBe(3);
    combat.fire(diamond, 1, 0);
    combat.updateBullets(0.12);
    expect(world.health[cy * world.width + cx]).toBe(2);

    diamond.y += 4;
    const previousY = first.y;
    combat.updateWingmen(diamond, 1 / 60);
    expect(first.y).toBeGreaterThan(previousY);
    expect(first.y).toBeLessThan(previousY + 4);
  });

  it("doubles hexagon rockets, cluster charges, and grenade blast radii", () => {
    const { world, stats, combat, onExplosion, bullets } = fixture();
    const hexagon = new Soldier(100, 100, 1, 0, 0, "rocket_launcher", "free", 4);
    hexagon.applyLatentAbilities({ latent_unlock: 1, latent_size: 9 });
    stats.rocketClusterCount = 1;
    combat.fire(hexagon, 1, 0);
    const rocket = bullets()[0];
    expect(rocket.sizeScale).toBe(2);
    expect(rocket.explosionRadius).toBe(stats.rocketBlastRadius * 2);
    world.setCell(15, 12, 100);
    combat.updateBullet(rocket, 0.2);
    expect(onExplosion.mock.calls[0][2]).toBeCloseTo(stats.rocketBlastRadius * world.cellSize * 2);
    expect(bullets()[0].sizeScale).toBe(2);
    expect(bullets()[0].explosionRadius).toBeCloseTo(Math.max(1.4, stats.rocketBlastRadius * 0.55) * 2);

    const grenade = combat.throwGrenade(hexagon, 3, 8, 0, 1, 1, 0)!;
    expect(grenade.sizeScale).toBe(2);
    expect(grenade.radiusCells).toBe(6);
  });

  it("pulls wingmen back onto the soldier's side of a wall before firing", () => {
    const { world, combat, bullets } = fixture();
    const diamond = new Soldier(100, 100, 1, 0, 0, "pistol", "free", 6);
    for (let cx = 10; cx < 15; cx++) world.setCell(cx, 11, 100);
    diamond.applyLatentAbilities({ latent_unlock: 1 });
    combat.fire(diamond, 1, 0);
    expect(bullets()).toHaveLength(2);
    expect(bullets()[0].y).toBeGreaterThanOrEqual(12 * world.cellSize);
  });
});
