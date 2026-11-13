import { describe, expect, it } from "vitest";
import { CIRCUIT } from "../src/config";
import { Rng } from "../src/core/Rng";
import { resetBulletFields } from "../src/entities/Bullet";
import { Soldier, baseSoldierStats, mutationCompatibility, resolvePrimaryMutation } from "../src/entities/Soldier";
import { CreatureSystem } from "../src/entities/Creatures";
import { CombatSystem, type BulletTargets } from "../src/systems/CombatSystem";
import { chooseOutgoingCardinal, circuitColorAt, circuitColorRgbAt } from "../src/systems/CircuitRunnerSystem";
import { Renderer } from "../src/rendering/Renderer";
import { drawWeaponExpansion } from "../src/rendering/WeaponExpansionRenderer";
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
    save.data.bank = 5000;
    save.data.essence = 100;
    const upg = new UpgradeManager(save);

    expect(upg.buy("ar_unlock")).toBe(true);
    const res = upg.buy("circuit_unlock");
    expect(res).toBe(true);
    expect(save.data.essence).toBe(65);
    expect(upg.levelOf("circuit_unlock")).toBe(1);

    const stats = upg.getSoldierStats();
    expect(stats.circuitUnlocked).toBe(true);
    expect(resolvePrimaryMutation("assault_rifle", "circuit_runner", stats)).toBe("circuit_runner");
    expect(mutationCompatibility("circuit_runner").active.length).toBeGreaterThan(0);

    save.data.loadouts[0].weapon = "assault_rifle";
    save.data.loadouts[0].mutation = "circuit_runner";
    save.save();

    const reloaded = new SaveManager(storage);
    reloaded.load();
    expect(reloaded.data.loadouts[0].mutation).toBe("circuit_runner");

    // Sanitation rejects circuit_runner on non-AR weapon
    reloaded.data.loadouts[0].weapon = "pistol";
    reloaded.data.loadouts[0].mutation = "circuit_runner";
    reloaded.save();
    const reloaded2 = new SaveManager(storage);
    reloaded2.load();
    expect(reloaded2.data.loadouts[0].mutation).toBeNull();

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
        return true;
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
    expect(b.circuitPhase).toBe("flight");
    expect(b.circuitMidX).toBe(0);
    expect(b.circuitMidY).toBe(0);
    expect(b.circuitCenterX).toBe(0);
    expect(b.circuitCenterY).toBe(0);
    expect(b.circuitOutDx).toBe(0);
    expect(b.circuitOutDy).toBe(0);
    expect(b.circuitExitLeft).toBe(0);

    combat.clearAll();
    expect(combat.circuit.segments.some((seg) => seg.active)).toBe(false);

    // Unused import check for CreatureSystem
    expect(typeof CreatureSystem).toBe("function");
  });

  it("Bug 1 regression: centering across split frames produces identical turn, position, and damage", () => {
    function runWithSteps(steps: number[], blockHp: number, speed = 100) {
      const w = makeOpenWorld();
      setBlock(w, 12, 10, blockHp);
      const stats = baseSoldierStats();
      stats.arSpreadDeg = 0;
      stats.arDamage = 10;
      // Controlled RNG that always picks downward exit (index 1 of [(1,0),(0,1),(0,-1)])
      const fakeRng = new Rng(1);
      fakeRng.int = () => 1;
      fakeRng.range = () => 0;

      let impacts = 0;
      const combat = new CombatSystem(w, fakeRng, stats, {
        onImpact: (_x, _y, _nx, _ny, cx, cy) => {
          if (cx === 12 && cy === 10) impacts++;
        },
      });
      const s = makeCircuitSoldier(86, 84, stats);
      combat.fire(s, 1, 0);
      const b = combat.bullets.items.find((it) => it.active)!;
      b.speed = speed;
      b.x = 92;
      b.y = 84;
      b.circuitPrevX = 92;
      b.circuitPrevY = 84;

      for (const dt of steps) {
        combat.updateBullets(dt);
      }
      return {
        x: b.x,
        y: b.y,
        dx: b.dx,
        dy: b.dy,
        traveled: b.circuitTraveled,
        impacts,
        hpAfter: w.health[10 * w.width + 12],
      };
    }

    // Surviving block: 0.1s whole step vs two 0.05s steps vs 6x (1/60s) vs 24x (1/240s)
    const wholeSurv = runWithSteps([0.1], 100);
    const halfSurv = runWithSteps([0.05, 0.05], 100);
    const sixtySurv = runWithSteps(Array(6).fill(0.1 / 6), 100);
    const tinySurv = runWithSteps(Array(24).fill(0.1 / 24), 100);

    expect(wholeSurv.dy).toBe(1);
    expect(wholeSurv.dx).toBe(0);
    expect(wholeSurv.impacts).toBe(1);
    for (const variant of [halfSurv, sixtySurv, tinySurv]) {
      expect(variant.x).toBeCloseTo(wholeSurv.x, 4);
      expect(variant.y).toBeCloseTo(wholeSurv.y, 4);
      expect(variant.dx).toBeCloseTo(wholeSurv.dx, 5);
      expect(variant.dy).toBeCloseTo(wholeSurv.dy, 5);
      expect(variant.traveled).toBeCloseTo(wholeSurv.traveled, 4);
      expect(variant.impacts).toBe(1);
      expect(variant.hpAfter).toBe(wholeSurv.hpAfter);
    }

    // Destroyed block: whole 0.1s vs two 0.05s steps
    const wholeDest = runWithSteps([0.1], 5);
    const halfDest = runWithSteps([0.05, 0.05], 5);
    expect(wholeDest.hpAfter).toBe(0);
    expect(halfDest.x).toBeCloseTo(wholeDest.x, 4);
    expect(halfDest.y).toBeCloseTo(wholeDest.y, 4);
    expect(halfDest.dx).toBeCloseTo(wholeDest.dx, 5);
    expect(halfDest.dy).toBeCloseTo(wholeDest.dy, 5);
    expect(halfDest.impacts).toBe(1);
  });

  it("Bug 2 regression: off-center impacts use axis-aligned connectors from all sides and preserve diagonal initial flight", () => {
    const stats = baseSoldierStats();
    stats.arSpreadDeg = 0;

    // 1) Horizontal off-center impact at y=82 into block centered at (100, 84)
    const w1 = makeOpenWorld();
    setBlock(w1, 12, 10, 100);
    const fakeRng = new Rng(1);
    fakeRng.int = () => 1;
    fakeRng.range = () => 0;
    const combat1 = new CombatSystem(w1, fakeRng, stats);
    const s1 = makeCircuitSoldier(86, 82, stats);
    combat1.fire(s1, 1, 0);
    stepCombat(combat1, 5);

    const segs1 = combat1.circuit.segments.filter((seg) => seg.active);
    expect(segs1.length).toBeGreaterThanOrEqual(3);
    // Every segment (initial horizontal + 2-leg connector + routed exit) must be axis-aligned (no diagonal)
    for (const seg of segs1) {
      const dx = Math.abs(seg.x2 - seg.x1);
      const dy = Math.abs(seg.y2 - seg.y1);
      expect(Math.min(dx, dy)).toBeLessThan(1e-4);
    }
    // Must pass through elbow (100, 82) and center (100, 84)
    expect(segs1.some((seg) => Math.abs(seg.x2 - 100) < 1e-3 && Math.abs(seg.y2 - 82) < 1e-3)).toBe(true);
    expect(segs1.some((seg) => Math.abs(seg.x2 - 100) < 1e-3 && Math.abs(seg.y2 - 84) < 1e-3)).toBe(true);

    // 2) Vertical off-center impact at x=98 into block centered at (100, 84)
    const w2 = makeOpenWorld();
    setBlock(w2, 12, 10, 100);
    const combat2 = new CombatSystem(w2, fakeRng, stats);
    const s2 = makeCircuitSoldier(98, 70, stats);
    combat2.fire(s2, 0, 1);
    stepCombat(combat2, 5);
    const segs2 = combat2.circuit.segments.filter((seg) => seg.active);
    for (const seg of segs2) {
      expect(Math.min(Math.abs(seg.x2 - seg.x1), Math.abs(seg.y2 - seg.y1))).toBeLessThan(1e-4);
    }
    expect(segs2.some((seg) => Math.abs(seg.x2 - 98) < 1e-3 && Math.abs(seg.y2 - 84) < 1e-3)).toBe(true);
    expect(segs2.some((seg) => Math.abs(seg.x2 - 100) < 1e-3 && Math.abs(seg.y2 - 84) < 1e-3)).toBe(true);

    // 3) Diagonal initial flight is preserved before impact, then connector + routed legs are strictly orthogonal
    const w3 = makeOpenWorld();
    setBlock(w3, 12, 10, 100);
    const combat3 = new CombatSystem(w3, fakeRng, stats);
    const s3 = makeCircuitSoldier(80, 68, stats);
    const len = Math.hypot(16, 14);
    combat3.fire(s3, 16 / len, 14 / len);
    stepCombat(combat3, 5);
    const segs3 = combat3.circuit.segments.filter((seg) => seg.active);
    expect(segs3.length).toBeGreaterThanOrEqual(3);
    // First segments before impact are diagonal initial flight
    expect(Math.abs(segs3[0].x2 - segs3[0].x1)).toBeGreaterThan(1);
    expect(Math.abs(segs3[0].y2 - segs3[0].y1)).toBeGreaterThan(1);
    // Find first segment reaching the block's X/Y boundary; all subsequent connector & routed segments are strictly orthogonal
    const postImpactStart = segs3.findIndex((seg) => Math.abs(seg.x2 - 96) < 0.1 || Math.abs(seg.y2 - 80) < 0.1) + 1;
    expect(postImpactStart).toBeGreaterThan(0);
    for (let i = postImpactStart; i < segs3.length; i++) {
      expect(Math.min(Math.abs(segs3[i].x2 - segs3[i].x1), Math.abs(segs3[i].y2 - segs3[i].y1))).toBeLessThan(1e-4);
    }
  });

  it("Bug 3 regression: ordinary bullet renderer emits zero yellow tracer pixels for Circuit shots", () => {
    const w = makeOpenWorld();
    const stats = baseSoldierStats();
    stats.arSpreadDeg = 0;
    const combat = new CombatSystem(w, new Rng(1), stats);
    const s = makeCircuitSoldier(80, 84, stats);
    combat.fire(s, 1, 0);
    stepCombat(combat, 2);

    const b = combat.bullets.items.find((it) => it.active)!;
    expect(b.circuit).toBe(true);

    const ordinaryFills: string[] = [];
    const mockCtx = {
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      lineCap: "butt",
      lineJoin: "miter",
      globalAlpha: 1,
      save() {},
      restore() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      stroke() {},
      fillRect: () => {
        ordinaryFills.push(String(mockCtx.fillStyle));
      },
    } as unknown as CanvasRenderingContext2D;

    const fakeCam = {
      viewW: 800,
      viewH: 600,
      zoom: 2,
      worldToScreenX: (wx: number) => wx * 2,
      worldToScreenY: (wy: number) => wy * 2,
      screenToWorldX: (sx: number) => sx / 2,
      screenToWorldY: (sy: number) => sy / 2,
    };
    const fakeGame = {
      world: w,
      camera: fakeCam,
      combat,
      soldiers: [],
    };
    const fakeRenderer = {
      ctx: mockCtx,
      game: fakeGame,
      fillArtPixel: () => {
        ordinaryFills.push(String(mockCtx.fillStyle));
      },
      drawSlash: () => {},
      drawRocket: () => {},
    };

    // Exercise actual Renderer.prototype.drawBullets on active Circuit bullet
    (Renderer.prototype as unknown as { drawBullets: () => void }).drawBullets.call(fakeRenderer);
    expect(ordinaryFills.length).toBe(0);

    // Exercise dedicated Circuit renderer: emits Circuit head & trail
    const expansionFills: string[] = [];
    mockCtx.fillRect = () => {
      expansionFills.push(String(mockCtx.fillStyle));
    };
    drawWeaponExpansion(mockCtx, fakeGame as never, false);
    expect(expansionFills.length).toBeGreaterThan(0);

    // Control: ordinary non-Circuit AR bullet still renders via Renderer.drawBullets
    combat.clearAll();
    const std = new Soldier(80, 84, 1, 0, 2, "assault_rifle", "free", 0, null, null);
    combat.fire(std, 1, 0);
    stepCombat(combat, 2);
    (Renderer.prototype as unknown as { drawBullets: () => void }).drawBullets.call(fakeRenderer);
    expect(ordinaryFills.some((c) => c === "#fff2c3" || c === "#ffffff")).toBe(true);
  });
});
