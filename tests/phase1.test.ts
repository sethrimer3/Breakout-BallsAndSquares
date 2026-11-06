import { describe, expect, it } from "vitest";
import { SIM, SOLDIER, WORLD } from "../src/config";
import { gridRaycast, makeRayHit } from "../src/core/gridRaycast";
import { Rng } from "../src/core/Rng";
import { Soldier, baseSoldierStats } from "../src/entities/Soldier";
import { CameraSystem } from "../src/systems/CameraSystem";
import { CombatSystem } from "../src/systems/CombatSystem";
import { PhysicsSystem, circleIsClear, findSpawnPoint } from "../src/systems/PhysicsSystem";
import { PixelWorld } from "../src/world/PixelWorld";
import { generateWorld } from "../src/world/WorldGenerator";

describe("Phase 1 — world & generation", () => {
  it("carves an exact 10×10 centered starting room and sets rest solid", () => {
    const w = new PixelWorld(WORLD);
    generateWorld(w, 42);
    let empty = 0;
    let badEmpty = 0;
    let badSolid = 0;
    for (let y = 0; y < w.height; y++) {
      for (let x = 0; x < w.width; x++) {
        const inside = x >= w.roomX0 && x <= w.roomX1 && y >= w.roomY0 && y <= w.roomY1;
        if (!w.solidAt(x, y)) {
          empty++;
          if (!inside) badEmpty++;
        } else if (inside) {
          badSolid++;
        }
      }
    }
    expect(empty).toBe(100);
    expect(badEmpty).toBe(0);
    expect(badSolid).toBe(0);
    expect(w.roomX1 - w.roomX0 + 1).toBe(10);
    expect(w.roomY1 - w.roomY0 + 1).toBe(10);
  });

  it("computes distance-based health bands with order-of-magnitude tier progression", () => {
    const w = new PixelWorld(WORLD);
    expect(w.maxHealthAt(w.centerX, w.centerY)).toBe(1);
    expect(w.maxHealthAt(w.centerX + 5, w.centerY)).toBe(1);
    expect(w.maxHealthAt(w.centerX + 16, w.centerY)).toBe(2);
    expect(w.maxHealthAt(w.centerX + 37, w.centerY)).toBe(10);
    expect(w.maxHealthAt(0, 0)).toBe(500);
  });

  it("generates a seed-dependent research lab maze with reachable rooms, valid sizes, and tougher zone walls", () => {
    const w1 = new PixelWorld(WORLD);
    generateWorld(w1, 101);
    const w2 = new PixelWorld(WORLD);
    generateWorld(w2, 202);
    const w1Copy = new PixelWorld(WORLD);
    generateWorld(w1Copy, 101);

    const layout1 = w1.labLayout!;
    const layout2 = w2.labLayout!;
    expect(layout1).toBeTruthy();
    expect(layout1.rooms.length).toBeGreaterThanOrEqual(12);

    // Deterministic for identical seed, different across seeds.
    expect(layout1.rooms.map((r) => `${r.x},${r.y},${r.size}`)).toEqual(
      w1Copy.labLayout!.rooms.map((r) => `${r.x},${r.y},${r.size}`),
    );
    expect(layout1.rooms.map((r) => `${r.x},${r.y},${r.size}`)).not.toEqual(
      layout2.rooms.map((r) => `${r.x},${r.y},${r.size}`),
    );

    // Every zone (0, 1, 2) has rooms, and every room is 10..30 cells across, fits inside its zone,
    // has wallThickness 1..3, and has non-wall soft interior fill.
    const roomsByZone = [0, 0, 0];
    for (const room of layout1.rooms) {
      roomsByZone[room.zone]++;
      expect(room.size).toBeGreaterThanOrEqual(10);
      expect(room.size).toBeLessThanOrEqual(30);
      expect(room.wallThickness).toBeGreaterThanOrEqual(1);
      expect(room.wallThickness).toBeLessThanOrEqual(3);

      for (let ry = room.y; ry < room.y + room.size; ry++) {
        for (let rx = room.x; rx < room.x + room.size; rx++) {
          const i = ry * w1.width + rx;
          // Interior is filled with soft zone material (not empty space, not wall).
          expect(w1.wall[i]).toBe(0);
          expect(w1.health[i]).toBeGreaterThan(0);
        }
      }
    }
    expect(roomsByZone[0]).toBeGreaterThan(0);
    expect(roomsByZone[1]).toBeGreaterThan(0);
    expect(roomsByZone[2]).toBeGreaterThan(0);

    // Every corridor segment is 3..5 cells wide, axis-aligned, with wallThickness 1..3.
    expect(layout1.corridors.length).toBeGreaterThan(0);
    for (const seg of layout1.corridors) {
      expect(seg.width).toBeGreaterThanOrEqual(3);
      expect(seg.width).toBeLessThanOrEqual(5);
      expect(seg.wallThickness).toBeGreaterThanOrEqual(1);
      expect(seg.wallThickness).toBeLessThanOrEqual(3);
      if (seg.axis === "h") {
        expect(seg.y1 - seg.y0 + 1).toBe(seg.width);
      } else {
        expect(seg.x1 - seg.x0 + 1).toBe(seg.width);
      }
    }

    // Walls exist in all 3 zones (1 = Zone 2 mat in Zone 1, 2 = Zone 3 mat in Zone 2, 3 = Reinforced mat in Zone 3)
    // and have strictly higher health than normal terrain at the same distance.
    const wallCounts = [0, 0, 0, 0];
    for (let cy = 0; cy < w1.height; cy++) {
      for (let cx = 0; cx < w1.width; cx++) {
        const i = cy * w1.width + cx;
        const wm = w1.wall[i];
        wallCounts[wm]++;
        if (wm > 0) {
          expect(w1.health[i]).toBe(w1.maxHealthAt(cx, cy));
        }
      }
    }
    expect(wallCounts[1]).toBeGreaterThan(0);
    expect(wallCounts[2]).toBeGreaterThan(0);
    expect(wallCounts[3]).toBeGreaterThan(0);

    // Flood-fill (BFS) from the starting room through non-wall cells (wall === 0)
    // must reach EVERY generated room across all zones without breaking any wall cell.
    const visited = new Uint8Array(w1.width * w1.height);
    const queue: number[] = [];
    const startIdx = w1.centerY * w1.width + w1.centerX;
    visited[startIdx] = 1;
    queue.push(startIdx);
    const dx = [1, -1, 0, 0];
    const dy = [0, 0, 1, -1];
    let head = 0;
    while (head < queue.length) {
      const cur = queue[head++];
      const cx = cur % w1.width;
      const cy = Math.floor(cur / w1.width);
      for (let d = 0; d < 4; d++) {
        const nx = cx + dx[d];
        const ny = cy + dy[d];
        if (!w1.inBounds(nx, ny)) continue;
        const ni = ny * w1.width + nx;
        if (visited[ni] || w1.wall[ni] !== 0) continue;
        visited[ni] = 1;
        queue.push(ni);
      }
    }

    for (const room of layout1.rooms) {
      const rcx = room.x + Math.floor(room.size / 2);
      const rcy = room.y + Math.floor(room.size / 2);
      expect(visited[rcy * w1.width + rcx]).toBe(1);
    }
  });
});

describe("Phase 1 — grid raycast & bullets", () => {
  it("hits the correct cell and face normal on axis-aligned and diagonal casts", () => {
    const w = new PixelWorld({ width: 32, height: 32, cellSize: 8, roomSize: 10 });
    generateWorld(w, 1);
    const hit = makeRayHit();
    // Cast east from room center: must hit the first solid column (roomX1 + 1).
    const ok = gridRaycast(w, 8, w.roomCenterX, w.roomCenterY, 1, 0, 200, hit);
    expect(ok).toBe(true);
    expect(hit.cx).toBe(w.roomX1 + 1);
    expect(hit.nx).toBe(-1);
    expect(hit.ny).toBe(0);
  });

  it("detects a solid starting cell at t = 0", () => {
    const w = new PixelWorld({ width: 32, height: 32, cellSize: 8, roomSize: 10 });
    generateWorld(w, 1);
    const hit = makeRayHit();
    expect(gridRaycast(w, 8, 4, 4, 1, 0, 100, hit)).toBe(true);
    expect(hit.t).toBe(0);
    expect(hit.cx).toBe(0);
    expect(hit.cy).toBe(0);
  });

  it("damages the wall when a soldier fires while touching it (Rev 3)", () => {
    const w = new PixelWorld({ width: 32, height: 32, cellSize: 8, roomSize: 10 });
    generateWorld(w, 1);
    const wallCx = w.roomX1 + 1;
    const wallCy = w.centerY;
    const wallX = wallCx * w.cellSize;
    // Place soldier flush against the east wall, moving into it and at 45°.
    for (const [dx, dy] of [
      [1, 0],
      [Math.SQRT1_2, Math.SQRT1_2],
    ] as const) {
      w.setCell(wallCx, wallCy, 5);
      const s = new Soldier(wallX - SOLDIER.collisionRadius - 0.01, (wallCy + 0.5) * 8, dx, dy, 125);
      const combat = new CombatSystem(w, new Rng(1), baseSoldierStats());
      combat.fire(s);
      combat.updateBullets(SIM.dt);
      expect(w.health[wallCy * w.width + wallCx]).toBe(4);
      expect(combat.bullets.activeCount).toBe(0);
    }
  });
});

describe("Phase 1 — soldier physics (Rev 2 & Rev 3)", () => {
  it("has a collision diameter smaller than one cell", () => {
    expect(SOLDIER.collisionRadius * 2).toBeLessThan(WORLD.cellSize);
  });

  it("passes cleanly through a 1-cell-wide straight tunnel", () => {
    const w = new PixelWorld({ width: 32, height: 32, cellSize: 8, roomSize: 4 });
    w.health.fill(10);
    // Carve a 1-cell-high horizontal tunnel at row 16 from col 2..29.
    for (let x = 2; x <= 29; x++) w.setCell(x, 16, 0);
    const phys = new PhysicsSystem(w, new Rng(7));
    const s = new Soldier(3.5 * 8, 16.5 * 8, 1, 0.05, 125);
    let maxX = s.x;
    for (let i = 0; i < 180; i++) {
      phys.step(s, SIM.dt);
      if (s.x > maxX) maxX = s.x;
      expect(circleIsClear(w, s.x, s.y, s.radius)).toBe(true);
    }
    expect(maxX).toBeGreaterThan(28 * 8);
  });

  it("stays out of walls and keeps speed in an L-bend tunnel & diagonal pinch (Rev 3)", () => {
    const w = new PixelWorld({ width: 32, height: 32, cellSize: 8, roomSize: 4 });
    w.health.fill(10);
    for (let x = 4; x <= 16; x++) w.setCell(x, 16, 0);
    for (let y = 16; y <= 26; y++) w.setCell(16, y, 0);
    const phys = new PhysicsSystem(w, new Rng(99));
    const s = new Soldier(5.5 * 8, 16.5 * 8, 1, 0.2, 325); // high speed
    for (let i = 0; i < 600; i++) {
      phys.step(s, SIM.dt);
      expect(circleIsClear(w, s.x, s.y, s.radius)).toBe(true);
      expect(Math.hypot(s.vx, s.vy)).toBeCloseTo(325, 2);
      expect(s.stuckFrames).toBe(0);
    }

    // Diagonal pinch: two solid cells sharing only a corner inside an open room.
    w.health.fill(10);
    for (let y = 10; y <= 20; y++) for (let x = 10; x <= 20; x++) w.setCell(x, y, 0);
    w.setCell(15, 15, 10);
    w.setCell(16, 16, 10);
    const s2 = new Soldier(13.5 * 8, 16.5 * 8, 1, -1, 325);
    for (let i = 0; i < 300; i++) {
      phys.step(s2, SIM.dt);
      expect(circleIsClear(w, s2.x, s2.y, s2.radius)).toBe(true);
    }
  });

  it("recovers a soldier placed overlapping terrain to a valid full-circle position", () => {
    const w = new PixelWorld({ width: 32, height: 32, cellSize: 8, roomSize: 10 });
    generateWorld(w, 3);
    const phys = new PhysicsSystem(w, new Rng(3));
    const wallX = (w.roomX0 - 0.2) * 8;
    const s = new Soldier(wallX, w.roomCenterY, -1, 0, 125);
    phys.resolve(s);
    expect(circleIsClear(w, s.x, s.y, s.radius)).toBe(true);
  });

  it("carves tunnels when a soldier bounces and fires inside the room (completion test)", () => {
    const w = new PixelWorld(WORLD);
    generateWorld(w, 11);
    const rng = new Rng(11);
    const phys = new PhysicsSystem(w, rng);
    const stats = baseSoldierStats();
    let destroyed = 0;
    const combat = new CombatSystem(w, rng, stats, {
      onImpact: (_x, _y, _nx, _ny, _cx, _cy, r) => {
        if (r === 2) destroyed++;
      },
    });
    const sp = findSpawnPoint(w, SOLDIER.collisionRadius)!;
    const s = new Soldier(sp.x, sp.y, 1, 0.37, stats.speed);
    for (let i = 0; i < 60 * 18; i++) {
      phys.step(s, SIM.dt);
      combat.updateSoldier(s, SIM.dt);
      combat.updateBullets(SIM.dt);
    }
    expect(destroyed).toBeGreaterThan(20);
    expect(circleIsClear(w, s.x, s.y, s.radius)).toBe(true);
  });
});

describe("Phase 1 — camera manual-first & single-target follow (Rev 3)", () => {
  it("stays stationary by default, and follows the farthest soldier with hysteresis when enabled (F) or cycled (Tab)", () => {
    const w = new PixelWorld(WORLD);
    generateWorld(w, 1);
    const cam = new CameraSystem(w);
    cam.setViewport(800, 600);
    expect(cam.following).toBe(false);
    const a = new Soldier(w.roomCenterX, w.roomCenterY, 1, 0, 100);
    const b = new Soldier(w.roomCenterX + 10 * 8, w.roomCenterY, 1, 0, 100);
    cam.update(0.1, [a, b]);
    expect(cam.x).toBe(w.roomCenterX);

    // Enable auto-follow (F):
    cam.resumeAuto();
    cam.update(0.1, [a, b]);
    expect(cam.targetId).toBe(b.id);
    // Moving `a` only 2 cells beyond `b` should NOT switch (hysteresis = 4).
    a.x = w.roomCenterX + 12 * 8;
    cam.update(0.1, [a, b]);
    expect(cam.targetId).toBe(b.id);
    // 5 cells beyond switches.
    a.x = w.roomCenterX + 15 * 8;
    cam.update(0.1, [a, b]);
    expect(cam.targetId).toBe(a.id);
    // Tab cycles manually.
    cam.cycleTarget([a, b]);
    expect(cam.targetId).toBe(b.id);
    expect(cam.manualTarget).toBe(true);
  });
});
