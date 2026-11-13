import { describe, expect, it } from "vitest";
import { CIRCUIT } from "../src/config";
import { Rng } from "../src/core/Rng";
import { resetBulletFields } from "../src/entities/Bullet";
import { Soldier, baseSoldierStats, mutationCompatibility, resolvePrimaryMutation } from "../src/entities/Soldier";
import { CreatureSystem } from "../src/entities/Creatures";
import { CombatSystem, type BulletTargets } from "../src/systems/CombatSystem";
import { chooseOutgoingCardinal, circuitColorAt, circuitColorRgbAt } from "../src/systems/CircuitRunnerSystem";
import { SaveManager, type StorageLike } from "../src/progression/SaveManager";
import { UpgradeManager } from "../src/progression/UpgradeManager";
import { MAT, PixelWorld } from "../src/world/PixelWorld";
import { unlockTabs } from "./helpers/progression";

class MemoryStorage implements StorageLike {
  private map = new Map<string, string>();
  getItem(k: string): string | null { return this.map.get(k) ?? null; }
  setItem(k: string, v: string): void { this.map.set(k, v); }
}

function makeOpenWorld(width = 48, height = 32): PixelWorld {
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

function makeCircuitSoldier(x: number, y: number, stats = baseSoldierStats()): Soldier {
  stats.arUnlocked = true;
  stats.circuitUnlocked = true;
  stats.arSpreadDeg = 0;
  return new Soldier(x, y, 1, 0, 1, "assault_rifle", "free", 0, null, "circuit_runner");
}

function stepCombat(combat: CombatSystem, steps = 40, dt = 1 / 60): void {
  for (let i = 0; i < steps; i++) {
    combat.updateBullets(dt);
  }
}

describe("Circuit Runner — Assault Rifle branch 2", () => {
  it("supports Essence unlock, refundBlackMarket, SaveManager sanitation, and compatibility", () => {
    const storage = new MemoryStorage();
    const save = new SaveManager(storage);
    unlockTabs(save);
    save.data.lifetimePixels = 10000;
    save.data.gold = 5000;
    save.data.essence = 100;
    const upg = new UpgradeManager(save);

    expect(upg.buy("ar_unlock")).toBe(true);
    const res = upg.buy("circuit_unlock");
    expect(res).toBe(true);
    expect(save.data.essence).toBe(65);
    expect(upg.levelOf("circuit_unlock")).toBe(1);

    const stats = upg.deriveStats();
    expect(stats.circuitUnlocked).toBe(true);
    expect(resolvePrimaryMutation("assault_rifle", "circuit_runner", stats)).toBe("circuit_runner");
    expect(mutationCompatibility("circuit_runner").active.length).toBeGreaterThan(0);

    save.data.soldierLoadouts[0].weapon = "assault_rifle";
    save.data.soldierLoadouts[0].mutation = "circuit_runner";
    save.save();

    const reloaded = new SaveManager(storage);
    reloaded.load();
    expect(reloaded.data.soldierLoadouts[0].mutation).toBe("circuit_runner");

    // Sanitation rejects circuit_runner on non-AR weapon
    reloaded.data.soldierLoadouts[0].weapon = "pistol";
    reloaded.data.soldierLoadouts[0].mutation = "circuit_runner";
    reloaded.save();
    const reloaded2 = new SaveManager(storage);
    reloaded2.load();
    expect(reloaded2.data.soldierLoadouts[0].mutation).toBeNull();

    // Refund returns exact Essence
    const refund = upg.refundBlackMarket(false);
    expect(refund.ok).toBe(true);
    if (refund.ok) expect(refund.refunded.essence).toBe(35);
    expect(upg.levelOf("circuit_unlock")).toBe(0);
    expect(save.data.essence).toBe(100);
  });

  it("deals ordinary AR direct damage and uses ordinary AR spread (not Overcharge 0-DMG or ±10.5°)", () => {
    const w = makeOpenWorld();
    setBlock(w, 12, 10, 50);
    const stats = baseSoldierStats();
    stats.arDamage = 7;
    stats.arSpreadDeg = 0;
    stats.arUnlocked = true;
    stats.circuitUnlocked = true;

    const combat = new CombatSystem(w, new Rng(101), stats);
    const s = makeCircuitSoldier(8 * 8 + 4, 10 * 8 + 4, stats);
    combat.fire(s, 1, 0);

    const b = combat.bullets.items.find((it) => it.active);
    expect(b).toBeDefined();
    expect(b!.circuit).toBe(true);
    expect(b!.overcharge).toBe(false);
    expect(b!.damage).toBe(7);
    expect(b!.dx).toBeCloseTo(1, 5);
    expect(b!.dy).toBeCloseTo(0, 5);

    stepCombat(combat, 5);
    expect(w.health[10 * w.width + 12]).toBe(43);
  });

  it("centers on impacted normal cells and subcells before turning orthogonally", () => {
    // 1) Normal cell centering
    const w1 = makeOpenWorld();
    setBlock(w1, 12, 10, 100);
    const stats = baseSoldierStats();
    stats.arSpreadDeg = 0;
    const combat1 = new CombatSystem(w1, new Rng(7), stats);
    const s1 = makeCircuitSoldier(9 * 8 + 4, 10 * 8 + 4, stats);
    combat1.fire(s1, 1, 0);
    stepCombat(combat1, 5);

    const segs1 = combat1.circuit.segments.filter((seg) => seg.active);
    const expectedCenterX = 12.5 * w1.cellSize;
    const expectedCenterY = 10.5 * w1.cellSize;
    const centeredVertex = segs1.some(
      (seg) => Math.abs(seg.x2 - expectedCenterX) < 1e-3 && Math.abs(seg.y2 - expectedCenterY) < 1e-3,
    );
    expect(centeredVertex).toBe(true);

    // 2) Subcell centering (when w.health[ci] === 0 and a 50% subcell is solid)
    const w2 = makeOpenWorld();
    const ci = 10 * w2.width + 12;
    w2.health[ci] = 0;
    w2.subHealth[10 * 2 * w2.subWidth + 12 * 2] = 50;
    const combat2 = new CombatSystem(w2, new Rng(7), stats);
    // Aim along row y = 10*8 + 2 (center of NW subcell)
    const s2 = makeCircuitSoldier(9 * 8 + 4, 10 * 8 + 2, stats);
    combat2.fire(s2, 1, 0);
    stepCombat(combat2, 5);

    const segs2 = combat2.circuit.segments.filter((seg) => seg.active);
    const subCenterX = (12 * 2 + 0.5) * w2.subCellSize;
    const subCenterY = (10 * 2 + 0.5) * w2.subCellSize;
    const subCentered = segs2.some(
      (seg) => Math.abs(seg.x2 - subCenterX) < 1e-3 && Math.abs(seg.y2 - subCenterY) < 1e-3,
    );
    expect(subCentered).toBe(true);
  });

  it("excludes reversal direction and selects uniformly among straight, left, and right", () => {
    const rng = new Rng(2026);
    const dirs: readonly (readonly [number, number])[] = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (const [inDx, inDy] of dirs) {
      const counts = new Map<string, number>();
      for (let i = 0; i < 600; i++) {
        const [ox, oy] = chooseOutgoingCardinal(inDx, inDy, rng);
        // Never reverse
        expect(ox === -inDx && oy === -inDy).toBe(false);
        // Always cardinal unit vector
        expect(Math.abs(ox) + Math.abs(oy)).toBe(1);
        const key = `${ox},${oy}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      expect(counts.size).toBe(3);
      for (const c of counts.values()) {
        expect(c).toBeGreaterThan(140);
      }
    }

    // Non-cardinal incoming angle maps to dominant cardinal axis and excludes opposite
    const rng2 = new Rng(99);
    for (let i = 0; i < 200; i++) {
      const [ox, oy] = chooseOutgoingCardinal(0.85, 0.52, rng2);
      expect(ox === -1 && oy === 0).toBe(false);
      expect(Math.abs(ox) + Math.abs(oy)).toBe(1);
    }
  });

  it("captures incoming direction before damage destroys block and draws crisp right-angled segments", () => {
    const w = makeOpenWorld();
    setBlock(w, 12, 10, 1); // 1 HP block destroyed on impact
    const stats = baseSoldierStats();
    stats.arDamage = 5;
    stats.arSpreadDeg = 0;
    const combat = new CombatSystem(w, new Rng(123), stats);
    const s = makeCircuitSoldier(9 * 8 + 4, 10 * 8 + 4, stats);
    combat.fire(s, 1, 0);
    stepCombat(combat, 15);

    expect(w.health[10 * w.width + 12]).toBe(0);
    const segs = combat.circuit.segments.filter((seg) => seg.active);
    expect(segs.length).toBeGreaterThanOrEqual(2);
    // Every segment after centering should be orthogonal (axis-aligned)
    for (const seg of segs) {
      const dx = Math.abs(seg.x2 - seg.x1);
      const dy = Math.abs(seg.y2 - seg.y1);
      expect(Math.min(dx, dy)).toBeLessThan(1e-3);
    }
  });

  it("produces exactly one impact/routing event on a surviving block and exits cleanly across frames", () => {
    const w = makeOpenWorld();
    setBlock(w, 12, 10, 500); // survives shot
    const stats = baseSoldierStats();
    stats.arDamage = 10;
    stats.arSpreadDeg = 0;

    let impactsOnBlock = 0;
    const combat = new CombatSystem(w, new Rng(42), stats, {
      onImpact: (_x, _y, _nx, _ny, cx, cy) => {
        if (cx === 12 && cy === 10) impactsOnBlock++;
      },
    });
    const s = makeCircuitSoldier(10 * 8 + 4, 10 * 8 + 4, stats);
    combat.fire(s, 1, 0);

    // Step across many tiny frames (high frame rate / boundary stress)
    stepCombat(combat, 120, 1 / 240);

    expect(impactsOnBlock).toBe(1);
    expect(w.health[10 * w.width + 12]).toBe(490);
  });

  it("stops at closed gates and world boundaries without leaking into sealed rooms", () => {
    const w = makeOpenWorld();
    // Closed gate at x=12, y=10
    setBlock(w, 12, 10, 100, MAT.door);
    w.doorId[10 * w.width + 12] = 1;
    w.doors = [{
      id: 1,
      open: false,
      x: 12,
      y: 10,
      cells: [{ cx: 12, cy: 10 }],
    } as never];

    const stats = baseSoldierStats();
    stats.arSpreadDeg = 0;
    const combat = new CombatSystem(w, new Rng(5), stats);
    const s = makeCircuitSoldier(9 * 8 + 4, 10 * 8 + 4, stats);
    combat.fire(s, 1, 0);
    stepCombat(combat, 20);

    const segs = combat.circuit.segments.filter((seg) => seg.active);
    for (const seg of segs) {
      // Never passes beyond the gate cell x = 12 * 8 = 96
      expect(seg.x1).toBeLessThanOrEqual(12 * w.cellSize + 0.01);
      expect(seg.x2).toBeLessThanOrEqual(12 * w.cellSize + 0.01);
    }

    // World boundary stops the shot
    const w2 = makeOpenWorld(24, 16);
    const combat2 = new CombatSystem(w2, new Rng(5), stats);
    const s2 = makeCircuitSoldier(20 * 8, 8 * 8, stats);
    combat2.fire(s2, 1, 0);
    stepCombat(combat2, 30);
    const activeAfter = combat2.bullets.items.filter((b) => b.active);
    expect(activeAfter.length).toBe(0);
  });

  it("enforces cumulative path length across turns and cools orange -> light blue -> blue -> purple", () => {
    const w = makeOpenWorld(64, 48);
    // Place blocks along a corridor to force multiple turns
    for (let cx = 12; cx <= 26; cx += 3) {
      setBlock(w, cx, 20, 5);
    }
    const stats = baseSoldierStats();
    stats.arSpreadDeg = 0;
    const combat = new CombatSystem(w, new Rng(11), stats);
    const s = makeCircuitSoldier(8 * 8 + 4, 20 * 8 + 4, stats);
    combat.fire(s, 1, 0);
    stepCombat(combat, 20);

    const segs = combat.circuit.segments.filter((seg) => seg.active);
    const totalPathLen = segs.reduce((sum, seg) => sum + Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1), 0);
    expect(totalPathLen).toBeGreaterThan(CIRCUIT.baseRange - 1);
    expect(totalPathLen).toBeLessThanOrEqual(CIRCUIT.baseRange + 0.5);

    // Check monotonic normalized progress
    for (const seg of segs) {
      expect(seg.progress0).toBeLessThanOrEqual(seg.progress1 + 1e-6);
    }

    // Check color curve endpoints and midpoints
    expect(circuitColorRgbAt(0)).toEqual([255, 138, 43]);   // bright orange
    expect(circuitColorRgbAt(1 / 3)).toEqual([124, 232, 255]); // light blue
    expect(circuitColorRgbAt(2 / 3)).toEqual([59, 130, 246]);  // blue
    expect(circuitColorRgbAt(1)).toEqual([168, 85, 247]);      // purple
    expect(circuitColorAt(0)).toBe("rgb(255, 138, 43)");
  });

  it("pierces enemies once per distinct target without changing circuit direction", () => {
    const w = makeOpenWorld();
    const stats = baseSoldierStats();
    stats.arDamage = 8;
    stats.arSpreadDeg = 0;
    const combat = new CombatSystem(w, new Rng(17), stats);
    const enemy = { id: 1, hp: 50 };
    let hitCount = 0;
    const targets: BulletTargets = {
      targetKey: enemy,
      raycast: (ox, oy, dx, dy, maxDist, ignore) => {
        if (ignore?.has(enemy)) return -1;
        // Enemy sits at (100, 84) with radius 4
        const t = (100 - ox) * dx + (84 - oy) * dy;
        if (t < 0 || t > maxDist) return -1;
        const px = ox + dx * t;
        const py = oy + dy * t;
        return Math.hypot(px - 100, py - 84) <= 4 ? t : -1;
      },
      applyHit: (dmg) => {
        hitCount++;
        enemy.hp -= dmg;
      },
    };
    combat.targets = targets;
    const s = makeCircuitSoldier(76, 84, stats);
    combat.fire(s, 1, 0);
    stepCombat(combat, 15);

    expect(hitCount).toBe(1);
    expect(enemy.hp).toBe(42);
    // Bullet kept going straight (did not turn on enemy hit)
    const segs = combat.circuit.segments.filter((seg) => seg.active);
    expect(segs.length).toBeGreaterThan(0);
    expect(Math.abs(segs[0].y2 - segs[0].y1)).toBeLessThan(1e-3);
  });

  it("resets all circuit state on pool reuse and clearAll()", () => {
    const w = makeOpenWorld();
    const stats = baseSoldierStats();
    const combat = new CombatSystem(w, new Rng(1), stats);
    const s = makeCircuitSoldier(80, 80, stats);
    combat.fire(s, 1, 0);
    const b = combat.bullets.items.find((it) => it.active)!;
    expect(b.circuit).toBe(true);
    b.circuitHitKeys.add(999);
    b.circuitHitTargets.add({});

    stepCombat(combat, 5);
    expect(combat.circuit.segments.some((seg) => seg.active)).toBe(true);

    resetBulletFields(b);
    expect(b.circuit).toBe(false);
    expect(b.circuitMaxRange).toBe(0);
    expect(b.circuitTraveled).toBe(0);
    expect(b.circuitHitKeys.size).toBe(0);
    expect(b.circuitHitTargets.size).toBe(0);

    combat.clearAll();
    expect(combat.circuit.segments.some((seg) => seg.active)).toBe(false);

    // Unused import check for CreatureSystem
    expect(typeof CreatureSystem).toBe("function");
  });
});
