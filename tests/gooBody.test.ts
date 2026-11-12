import { describe, expect, it, vi } from "vitest";
import { GOO } from "../src/config";
import { GooBody, GOO_BODY_POINTS } from "../src/entities/GooBody";
import { PixelWorld } from "../src/world/PixelWorld";
import { GooOrbSystem } from "../src/systems/GooOrbSystem";
import { CombatSystem } from "../src/systems/CombatSystem";
import { Soldier, baseSoldierStats } from "../src/entities/Soldier";
import { Rng } from "../src/core/Rng";

function scene() {
  const world = new PixelWorld({ width: 16, height: 16, cellSize: 8, roomSize: 4 });
  world.health[7 * world.width + 8] = 1000;
  const residue = vi.fn();
  const goo = new GooOrbSystem(world, { onMineBurst: () => {}, onResidueLost: residue });
  const shot = { x: 60, y: 60, dx: 1, dy: 0, speed: 100, mass: 1, distance: 300, damage: 5, terrainDamageBonus: 0, blightMultiplier: 1, ownerId: 1 };
  return { goo, shot, residue };
}

function energy(body: GooBody): number {
  let sum = 0;
  for (let i = 0; i < GOO_BODY_POINTS; i++) {
    const angle = i * Math.PI * 2 / GOO_BODY_POINTS;
    sum += (body.x[i] - Math.cos(angle)) ** 2 + (body.y[i] - Math.sin(angle)) ** 2;
  }
  return sum;
}

describe("SQUELCH visual spring ring", () => {
  it("compresses on the contact normal while three surface points stay anchored", () => {
    const body = new GooBody();
    body.impact(0, -1);
    expect(body.angle).toBeCloseTo(-Math.PI / 2);
    expect(body.x[0]).toBeCloseTo(1.28);
    const freeY = body.y[2];
    body.advance(0.04, "clinging");
    expect(body.y[2]).not.toBe(freeY);
    for (const i of [4, 5, 6]) {
      expect(body.x[i]).toBe(0);
      expect(body.vx[i]).toBe(0);
      expect(body.vy[i]).toBe(0);
    }
  });

  it("stretches for peel, rebounds, then damps back to its resting silhouette", () => {
    const body = new GooBody();
    body.impact(-1, 0);
    body.advance(0.13, "clinging");
    const compressedWidth = body.x[0];
    body.advance(0.05, "peeling");
    expect(body.x[0]).toBeGreaterThan(compressedWidth);
    body.release();
    expect(body.phase).toBe("flight");
    const displaced = energy(body);
    for (let i = 0; i < 240; i++) body.advance(1 / 60, "flight");
    expect(energy(body)).toBeLessThan(displaced * 0.001);
  });

  it("reuses point buffers and stays finite through repeated contacts and long visual gaps", () => {
    const body = new GooBody();
    const x = body.x; const y = body.y;
    for (let contact = 0; contact < 100; contact++) {
      body.impact(contact % 2 ? -1 : 1, 0);
      body.advance(100, "peeling");
      body.release();
      body.advance(100, "flight");
      for (let i = 0; i < GOO_BODY_POINTS; i++) {
        expect(Number.isFinite(body.x[i])).toBe(true);
        expect(Math.abs(body.x[i])).toBeLessThanOrEqual(2.5);
        expect(Math.abs(body.y[i])).toBeLessThanOrEqual(1.7);
      }
    }
    body.reset();
    expect(body.x).toBe(x); expect(body.y).toBe(y);
    expect(body.phase).toBe("flight"); expect(body.angle).toBe(0);
    expect(energy(body)).toBeLessThan(1e-12);
    expect([...body.vx, ...body.vy].every((v) => v === 0)).toBe(true);
  });

  it("peels during the existing dwell without changing flight, fuse or mass accounting", () => {
    const { goo, shot } = scene();
    const orb = goo.launch(shot)!;
    goo.update(0.04); // contact at x=64
    expect(orb.body.phase).toBe("clinging");
    goo.update(GOO.dwell - GOO.peelSeconds + 0.01);
    expect(orb.body.phase).toBe("peeling");
    expect(orb.state).toBe("stuck");
    expect(orb.distanceRemaining).toBe(296);
    expect(orb.mass).toBeCloseTo(0.925);
    expect(goo.mines.items[0].fuse).toBeCloseTo(0.61);
    goo.update(GOO.peelSeconds - 0.01);
    expect(orb.state).toBe("flying");
    expect(orb.body.phase).toBe("flight");
    expect(orb.distanceRemaining).toBe(296);
  });

  it("clears visual impulses and pressure counters when pools restart", () => {
    const { goo, shot } = scene();
    const orb = goo.launch(shot)!;
    goo.update(0.1);
    goo.droppedMines = goo.droppedOrbs = 12;
    goo.clear();
    expect(goo.launch(shot)).toBe(orb);
    expect(orb.body.phase).toBe("flight");
    expect(energy(orb.body)).toBeLessThan(1e-12);
    expect(goo.droppedMines + goo.droppedOrbs).toBe(0);
  });

  it("signals dissipated residue exactly once per dropped fragment", () => {
    const { goo, shot, residue } = scene();
    for (let i = 0; i < GOO.minePoolSize; i++) goo.mines.acquire()!.fuse = 10;
    const orb = goo.launch(shot)!;
    goo.update(0.1);
    expect(goo.droppedMines).toBe(1);
    expect(residue).toHaveBeenCalledTimes(1);
    expect(orb.mass).toBeCloseTo(0.925);
    expect(orb.body.phase).toBe("clinging");
  });

  it("does not emit launch sound/shot effects when the orb pool is full", () => {
    const world = new PixelWorld({ width: 16, height: 16, cellSize: 8, roomSize: 4 });
    const onShot = vi.fn(); const blocked = vi.fn();
    const combat = new CombatSystem(world, new Rng(1), baseSoldierStats(), { onShot, onGooLaunchBlocked: blocked });
    const s = new Soldier(60, 60, 1, 0, 60, "goo_mortar");
    for (let i = 0; i < GOO.orbPoolSize + 1; i++) combat.fire(s);
    expect(onShot).toHaveBeenCalledTimes(GOO.orbPoolSize);
    expect(blocked).toHaveBeenCalledTimes(1);
    expect(combat.goo.droppedOrbs).toBe(1);
    expect(combat.bullets.activeCount).toBe(0);
  });
  it("accelerates nearby residue fuses once per burst without recursion or affecting distant mines", () => {
    const { goo } = scene();
    const first=goo.mines.acquire()!;Object.assign(first,{x:50,y:50,fuse:0,radiusCells:1.8,residue:true});
    const near=goo.mines.acquire()!;Object.assign(near,{x:55,y:50,fuse:0.3});
    const far=goo.mines.acquire()!;Object.assign(far,{x:200,y:200,fuse:0.3});
    goo.update(0.01);
    expect(goo.bursts).toBe(1);expect(near.fuse).toBeCloseTo(0.17);expect(far.fuse).toBeCloseTo(0.29);
    expect(near.active).toBe(true);expect(far.active).toBe(true);
  });

});
