import { describe, expect, it } from "vitest";
import { WORLD } from "../src/config";
import { Rng } from "../src/core/Rng";
import { baseSoldierStats, Soldier } from "../src/entities/Soldier";
import { CombatSystem } from "../src/systems/CombatSystem";
import { CombinedTargets, RoomFixtures } from "../src/systems/RoomFixtures";
import { DECOR } from "../src/world/LabDetails";
import { LIGHT_KIND, PixelWorld, type RoomLight } from "../src/world/PixelWorld";
import { generateWorld } from "../src/world/WorldGenerator";

function fixtureScene() {
  const world = new PixelWorld({ width: 24, height: 20, cellSize: 8, roomSize: 6 });
  const light: RoomLight = { kind: LIGHT_KIND.bright, x0: 10, x1: 12, y0: 10, y1: 10, cx0: 2, cy0: 2, cx1: 20, cy1: 18, phase: 0 };
  world.roomLights = [light];
  for (let x = 10; x <= 12; x++) { world.setCell(x, 10, 0); world.decor[10 * world.width + x] = DECOR.lightPanel; }
  let breaks = 0;
  const fixtures = new RoomFixtures(world, () => breaks++); fixtures.reset();
  return { world, light, fixtures, breaks: () => breaks };
}

describe("destructible room lighting", () => {
  it("gives most rooms a working fixture after equipment and rubble generation", () => {
    const world = new PixelWorld(WORLD); generateWorld(world, 101);
    const rooms = world.labLayout!.rooms;
    const lit = rooms.filter((r) => world.roomLights.some((l) => l.kind !== LIGHT_KIND.blight && l.kind !== LIGHT_KIND.wash
      && l.x0 >= r.x && l.y0 >= r.y && l.x1 < r.x + r.size && l.y1 < r.y + r.size
      && world.decor[l.y0 * world.width + l.x0] === DECOR.lightPanel && !world.solidAt(l.x0, l.y0)));
    expect(lit.length / rooms.length).toBeGreaterThan(0.6);
  });

  it("lets a shot break a fixture once without adding terrain or blocking air", () => {
    const { world, light, fixtures, breaks } = fixtureScene();
    for (let x = 3; x < 10; x++) world.setCell(x, 10, 0);
    const combat = new CombatSystem(world, new Rng(1), baseSoldierStats()); combat.targets = fixtures;
    combat.fire(new Soldier(28, 84, 1, 0, 60)); combat.updateBullets(0.25);
    expect(light.destroyed).toBe(true);
    expect(breaks()).toBe(1);
    expect(world.decor[10 * world.width + 11]).toBe(DECOR.deadPanel);
    expect(world.solidAt(11, 10)).toBe(false);
    fixtures.explode(88, 84, 50);
    expect(breaks()).toBe(1);
    expect(fixtures.raycast(28, 84, 1, 0, 100)).toBe(-1);
  });

  it("doesn't shoot fixtures through walls and lets explosions break them", () => {
    const { world, light, fixtures, breaks } = fixtureScene();
    for (let x = 3; x < 10; x++) world.setCell(x, 10, 0);
    world.setCell(7, 10, 100);
    const combat = new CombatSystem(world, new Rng(1), baseSoldierStats()); combat.targets = fixtures;
    combat.fire(new Soldier(28, 84, 1, 0, 60)); combat.updateBullets(0.25);
    expect(light.destroyed).not.toBe(true);
    fixtures.explode(88, 84, 12);
    expect(breaks()).toBe(1);
  });

  it("preserves nearest-hit ordering with creatures", () => {
    const { fixtures, light } = fixtureScene();
    let hits = 0;
    const creature = { raycast: () => 10, applyHit: () => { hits++; return true; } };
    const targets = new CombinedTargets([creature, fixtures]);
    expect(targets.raycast(28, 84, 1, 0, 100)).toBe(10);
    targets.applyHit(1, 38, 84);
    expect(hits).toBe(1); expect(light.destroyed).not.toBe(true);
  });
});
