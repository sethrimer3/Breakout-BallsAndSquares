import { describe, expect, it } from "vitest";
import { WORLD } from "../src/config";
import type { Soldier } from "../src/entities/Soldier";
import { BlightWardenSystem, WARDEN, clearOfCells, wardenHealth } from "../src/systems/BlightWardens";
import { SPECIAL_UPGRADE, SpecialUpgradeSystem } from "../src/systems/SpecialUpgrades";
import { LAB_WORLDS } from "../src/world/labMap";
import { PixelWorld } from "../src/world/PixelWorld";
import { generateWorld } from "../src/world/WorldGenerator";

const soldier = (x: number, y: number) => ({ x, y, vx: 0, vy: 0, radius: 3, alive: true, health: 0 }) as unknown as Soldier;

function lab(id = 1): { w: PixelWorld; specials: SpecialUpgradeSystem; wardens: BlightWardenSystem } {
  const w = new PixelWorld(WORLD);
  generateWorld(w, 5, { labWorld: LAB_WORLDS[id] });
  w.damageRollMin = 1;
  w.damageRollMax = 1;
  const specials = new SpecialUpgradeSystem(w, () => []);
  specials.reset([]);
  const wardens = new BlightWardenSystem(w, {}, () => 0.5);
  wardens.reset(specials.blocks);
  specials.isShielded = (id) => wardens.isGuarded(id);
  return { w, specials, wardens };
}

describe("Blight Wardens", () => {
  it("guard every gold block in each lab from clear posts, scaled to the block's tier", () => {
    for (const id of [1, 2]) {
      const { w, specials, wardens } = lab(id);
      expect(specials.blocks.length).toBeGreaterThan(0);
      expect(wardens.wardens.length).toBe(specials.blocks.length * WARDEN.perBlock);
      for (const b of specials.blocks) {
        expect(wardens.isGuarded(b.id)).toBe(true);
        const mine = wardens.wardens.filter((g) => g.blockId === b.id);
        expect(mine).toHaveLength(WARDEN.perBlock);
        for (const g of mine) {
          expect(g.maxHp).toBe(wardenHealth(w.fillTierAt(b.cx, b.cy)));
          expect(clearOfCells(w, g.x, g.y, WARDEN.radius)).toBe(true);
        }
        // The pair flank the block rather than stack on one spot.
        expect(Math.hypot(mine[0].x - mine[1].x, mine[0].y - mine[1].y)).toBeGreaterThan(WARDEN.radius * 2);
      }
    }
  });

  it("seal their block until every one of them is dead", () => {
    const { specials, wardens } = lab();
    const b = specials.blocks[0];
    const cx = (b.x0 + b.x1) / 2;
    // Shots glance off the membrane while a warden lives.
    for (let i = 0; i < SPECIAL_UPGRADE.hits + 2; i++) {
      expect(specials.raycast(cx, b.y1 + 20, 0, -1, 100)).toBeGreaterThanOrEqual(0);
      specials.applyHit(1, cx, b.y1);
    }
    expect(b.broken).toBe(false);
    expect(b.hitsLeft).toBe(SPECIAL_UPGRADE.hits);

    let freed = "";
    const mine = wardens.wardens.filter((g) => g.blockId === b.id);
    (wardens as unknown as { events: { onBlockFreed: (id: string) => void } }).events.onBlockFreed = (id) => (freed = id);
    wardens.damage(mine[0], mine[0].maxHp, mine[0].x, mine[0].y);
    expect(mine[0].alive).toBe(false);
    expect(wardens.isGuarded(b.id)).toBe(true);
    wardens.damage(mine[1], mine[1].maxHp, mine[1].x, mine[1].y);
    expect(wardens.isGuarded(b.id)).toBe(false);
    expect(freed).toBe(b.id);

    for (let i = 0; i < SPECIAL_UPGRADE.hits; i++) {
      specials.raycast(cx, b.y1 + 20, 0, -1, 100);
      specials.applyHit(1, cx, b.y1);
    }
    expect(b.broken).toBe(true);
  });

  it("take bullets by raycast, with Calibration applied like Blight", () => {
    const { w, wardens } = lab();
    const g = wardens.wardens[0];
    w.playerDamageMult = 3;
    const t = wardens.raycast(g.x - 30, g.y, 1, 0, 100);
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThan(30);
    expect(wardens.applyHit(2, g.x - WARDEN.hitRadius, g.y)).toBe(true);
    expect(g.maxHp - g.hp).toBe(6);
  });

  it("wake for a soldier in sight, lunge when close, and stay leashed to their block", () => {
    const { w, wardens } = lab();
    const cs = w.cellSize;
    const g = wardens.wardens[0];
    // Idle: they hover by their posts beside the block.
    for (let i = 0; i < 120; i++) wardens.update(1 / 60, []);
    expect(g.state).toBe("guard");
    expect(Math.hypot(g.x - g.postX, g.y - g.postY)).toBeLessThanOrEqual(WARDEN.driftCells * cs + 1);

    // A soldier right beside it: windup, then a lunge that bites.
    const hits: number[] = [];
    (wardens as unknown as { events: { onSoldierHit: (s: Soldier, d: number) => void } }).events.onSoldierHit = (_s, d) => hits.push(d);
    const s = soldier(g.x + cs * 2, g.y);
    g.lungeCd = 0;
    g.aggro = 100; // the soldier's spot may be behind rubble; a shot wakes it anyway
    let sawWindup = false;
    let sawLunge = false;
    for (let i = 0; i < 120; i++) {
      s.x = g.x + cs * 1.2;
      s.y = g.y;
      wardens.update(1 / 60, [s]);
      sawWindup ||= g.state === "windup";
      sawLunge ||= g.state === "lunge";
    }
    expect(sawWindup).toBe(true);
    expect(sawLunge).toBe(true);
    expect(hits.length).toBeGreaterThan(0);

    // A soldier far away across the map never drags it off its leash.
    const far = soldier(g.homeX + cs * 40, g.homeY);
    g.aggro = 100;
    for (let i = 0; i < 600; i++) wardens.update(1 / 60, [far]);
    expect(Math.hypot(g.x - g.homeX, g.y - g.homeY)).toBeLessThanOrEqual(WARDEN.leashCells * cs + WARDEN.lungeSpeed * WARDEN.lungeTime + 1);
  });
});
