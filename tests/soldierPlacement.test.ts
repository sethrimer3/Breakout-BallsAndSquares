import { describe, expect, it, vi } from "vitest";
import { SOLDIER, WORLD } from "../src/config";
import { Soldier } from "../src/entities/Soldier";
import { PORTAL, portalHeading, SpawnPortal } from "../src/systems/SpawnPortal";
import { Input, type InputHandlers } from "../src/systems/Input";
import { PixelWorld } from "../src/world/PixelWorld";

// Helper to simulate window event handling in Node/Vitest
function setupMockWindow() {
  const windowListeners: Record<string, Function[]> = {};
  const mockWindow = {
    addEventListener: (type: string, fn: Function) => {
      windowListeners[type] = windowListeners[type] || [];
      windowListeners[type].push(fn);
    },
    removeEventListener: (type: string, fn: Function) => {
      if (windowListeners[type]) {
        windowListeners[type] = windowListeners[type].filter((f) => f !== fn);
      }
    },
    dispatchEvent: (event: any) => {
      const fns = windowListeners[event.type] || [];
      for (const fn of fns) fn(event);
    },
  };
  (globalThis as any).window = mockWindow;

  const canvasListeners: Record<string, Function[]> = {};
  const mockCanvas = {
    addEventListener: (type: string, fn: Function) => {
      canvasListeners[type] = canvasListeners[type] || [];
      canvasListeners[type].push(fn);
    },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    style: {},
    dispatchCanvasEvent: (event: any) => {
      const fns = canvasListeners[event.type] || [];
      for (const fn of fns) fn(event);
    },
  };

  return { mockWindow, mockCanvas, windowListeners, canvasListeners };
}

describe("Soldier Placement & Deployment Portal", () => {
  describe("Deployment anywhere and boundary clamping", () => {
    it("places soldiers at the exact specified world coordinates", () => {
      const speed = SOLDIER.speed;

      // Deploy at center
      const s1 = new Soldier(200, 300, 1, 0, speed);
      expect(s1.x).toBe(200);
      expect(s1.y).toBe(300);
      expect(s1.vx).toBeCloseTo(speed);
      expect(s1.vy).toBeCloseTo(0);

      // Deploy in deep lab / far away from spawn
      const s2 = new Soldier(1500, 2400, 0, -1, speed);
      expect(s2.x).toBe(1500);
      expect(s2.y).toBe(2400);
      expect(s2.vx).toBeCloseTo(0);
      expect(s2.vy).toBeCloseTo(-speed);
    });

    it("clamps soldier placement inside world bounds", () => {
      const world = new PixelWorld(WORLD);
      const r = SOLDIER.collisionRadius;
      const maxX = world.worldWidth - r;
      const maxY = world.worldHeight - r;

      function clampDeploy(wx: number, wy: number) {
        return {
          x: Math.max(r, Math.min(maxX, wx)),
          y: Math.max(r, Math.min(maxY, wy)),
        };
      }

      // Out of bounds negative
      const pNeg = clampDeploy(-100, -50);
      expect(pNeg.x).toBe(r);
      expect(pNeg.y).toBe(r);

      // Out of bounds excessive
      const pFar = clampDeploy(100000, 999999);
      expect(pFar.x).toBe(maxX);
      expect(pFar.y).toBe(maxY);

      // In-bounds remains untouched
      const pMid = clampDeploy(500, 600);
      expect(pMid.x).toBe(500);
      expect(pMid.y).toBe(600);
    });
  });

  describe("Deployment portal: everyone through one portal, clockwise from north", () => {
    it("fans n operators out at equal clockwise angles, the first heading north", () => {
      const close = (h: { dx: number; dy: number }, dx: number, dy: number) => {
        expect(h.dx).toBeCloseTo(dx, 9);
        expect(h.dy).toBeCloseTo(dy, 9);
      };
      close(portalHeading(0, 1), 0, -1);
      // Two: north, then south (180 degrees).
      close(portalHeading(0, 2), 0, -1);
      close(portalHeading(1, 2), 0, 1);
      // Four: north, east, south, west (clockwise on a y-down screen).
      close(portalHeading(0, 4), 0, -1);
      close(portalHeading(1, 4), 1, 0);
      close(portalHeading(2, 4), 0, 1);
      close(portalHeading(3, 4), -1, 0);
      // Three: 120 degrees apart, the second one down and to the right.
      const h = portalHeading(1, 3);
      expect(Math.atan2(h.dy, h.dx) * 180 / Math.PI).toBeCloseTo(30, 6);
      for (let n = 1; n <= 8; n++) {
        for (let k = 0; k < n; k++) {
          const a = portalHeading(k, n);
          const b = portalHeading((k + 1) % n, n);
          expect(Math.hypot(a.dx, a.dy)).toBeCloseTo(1, 9);
          // Each next operator is turned clockwise by exactly 360/n degrees.
          if (n > 1) {
            const turn = Math.atan2(a.dx * b.dy - a.dy * b.dx, a.dx * b.dx + a.dy * b.dy);
            const want = n === 2 ? Math.PI : (Math.PI * 2) / n;
            expect(Math.abs(turn)).toBeCloseTo(want, 6);
            if (n > 2) expect(turn).toBeGreaterThan(0);
          }
        }
      }
    });

    it("opens first, then sends every operator through 0.5 s apart, then shuts", () => {
      const p = new SpawnPortal(50, 60, 3);
      const out: { k: number; t: number; dx: number; dy: number }[] = [];
      const dt = 1 / 120;
      let alive = true;
      let steps = 0;
      while (alive && steps++ < 2000) alive = p.update(dt, (k, dx, dy) => out.push({ k, t: p.t, dx, dy }));
      expect(alive).toBe(false);
      expect(out.map((o) => o.k)).toEqual([0, 1, 2]);
      expect(out[0].t).toBeGreaterThanOrEqual(PORTAL.openTime - 1e-9);
      expect(out[0].t).toBeLessThan(PORTAL.openTime + dt * 1.5);
      expect(out[1].t - out[0].t).toBeCloseTo(0.5, 1);
      expect(out[2].t - out[1].t).toBeCloseTo(0.5, 1);
      expect(PORTAL.interval).toBe(0.5);
      expect(out[0].dy).toBeCloseTo(-1, 9);
      expect(p.phase).toBe("done");
    });

    it("grows open, stays open while operators come through, then collapses", () => {
      const p = new SpawnPortal(0, 0, 2);
      expect(p.openness).toBeCloseTo(0, 6);
      p.update(PORTAL.openTime + 0.1, () => {});
      expect(p.phase).toBe("open");
      expect(p.openness).toBe(1);
      p.update(p.closeAt - p.t + PORTAL.closeTime / 2, () => {});
      expect(p.phase).toBe("closing");
      expect(p.openness).toBeGreaterThan(0);
      expect(p.openness).toBeLessThan(1);
      // A long frame still sends everyone, in order.
      const big = new SpawnPortal(0, 0, 4);
      const ks: number[] = [];
      big.update(10, (k) => ks.push(k));
      expect(ks).toEqual([0, 1, 2, 3]);
    });
  });

  describe("Input system gesture dispatch", () => {
    it("dispatches onAimClick on click and let go without drag", () => {
      const { mockCanvas } = setupMockWindow();
      let clickCoords: { sx: number; sy: number } | null = null;
      let releaseCalled = false;

      const handlers: InputHandlers = {
        canPlace: () => true,
        onAimStart: vi.fn(),
        onAimClick: (sx, sy) => {
          clickCoords = { sx, sy };
        },
        onAimRelease: () => {
          releaseCalled = true;
        },
      };

      new Input(mockCanvas as any, handlers);

      // Pointer down at (150, 250)
      mockCanvas.dispatchCanvasEvent({
        type: "pointerdown",
        button: 0,
        pointerType: "mouse",
        clientX: 150,
        clientY: 250,
        preventDefault: () => {},
      });

      expect(handlers.onAimStart).toHaveBeenCalledWith(150, 250);

      // Pointer up at (151, 250) - within slop (<= 4px)
      (globalThis as any).window.dispatchEvent({
        type: "pointerup",
        button: 0,
        pointerType: "mouse",
        clientX: 151,
        clientY: 250,
      });

      expect(clickCoords).toEqual({ sx: 150, sy: 250 });
      expect(releaseCalled).toBe(false);
    });

    it("turns a press and drag into a camera pan, with no portal", () => {
      const { mockCanvas } = setupMockWindow();
      let clickCalled = false;
      let releaseCalled = false;
      const onPan = vi.fn();
      const onAimCancel = vi.fn();

      const handlers: InputHandlers = {
        canPlace: () => true,
        onAimStart: vi.fn(),
        onAimMove: vi.fn(),
        onAimCancel,
        onPan,
        onAimClick: () => {
          clickCalled = true;
        },
        onAimRelease: () => {
          releaseCalled = true;
        },
      };

      new Input(mockCanvas as any, handlers);

      mockCanvas.dispatchCanvasEvent({
        type: "pointerdown",
        button: 0,
        pointerType: "mouse",
        clientX: 100,
        clientY: 100,
        preventDefault: () => {},
      });
      (globalThis as any).window.dispatchEvent({ type: "pointermove", pointerType: "mouse", clientX: 100, clientY: 160 });
      (globalThis as any).window.dispatchEvent({ type: "pointermove", pointerType: "mouse", clientX: 110, clientY: 170 });
      (globalThis as any).window.dispatchEvent({ type: "pointerup", button: 0, pointerType: "mouse", clientX: 110, clientY: 170 });

      expect(onAimCancel).toHaveBeenCalled();
      expect(onPan).toHaveBeenCalledWith(0, 60);
      expect(onPan).toHaveBeenCalledWith(10, 10);
      expect(clickCalled).toBe(false);
      expect(releaseCalled).toBe(false);
    });

    it("pans camera when canPlace returns false", () => {
      const { mockCanvas } = setupMockWindow();
      const onPan = vi.fn();
      const onAimStart = vi.fn();

      const handlers: InputHandlers = {
        canPlace: () => false,
        onAimStart,
        onPan,
      };

      new Input(mockCanvas as any, handlers);

      // Pointer down at (50, 50)
      mockCanvas.dispatchCanvasEvent({
        type: "pointerdown",
        button: 0,
        pointerType: "mouse",
        clientX: 50,
        clientY: 50,
        preventDefault: () => {},
      });

      expect(onAimStart).not.toHaveBeenCalled();

      // Pointer move by 20px
      (globalThis as any).window.dispatchEvent({
        type: "pointermove",
        pointerType: "mouse",
        clientX: 70,
        clientY: 50,
      });

      expect(onPan).toHaveBeenCalledWith(20, 0);
    });

    it("right click always pans even when canPlace is true", () => {
      const { mockCanvas } = setupMockWindow();
      const onPan = vi.fn();
      const onAimStart = vi.fn();

      const handlers: InputHandlers = {
        canPlace: () => true,
        onAimStart,
        onPan,
      };

      new Input(mockCanvas as any, handlers);

      // Right-click down (button 2)
      mockCanvas.dispatchCanvasEvent({
        type: "pointerdown",
        button: 2,
        pointerType: "mouse",
        clientX: 50,
        clientY: 50,
        preventDefault: () => {},
      });

      expect(onAimStart).not.toHaveBeenCalled();

      // Pointer move by 30px
      (globalThis as any).window.dispatchEvent({
        type: "pointermove",
        pointerType: "mouse",
        clientX: 80,
        clientY: 50,
      });

      expect(onPan).toHaveBeenCalledWith(30, 0);
    });
  });
});

describe("Deploy clearance", () => {
  it("nudges a soldier dropped inside a wall to a spot at least 1px clear of terrain", async () => {
    const { findClearDeployPoint, circleIsClear } = await import("../src/systems/PhysicsSystem");
    const world = new PixelWorld({ width: 32, height: 32, cellSize: 8, roomSize: 6 });
    // Solid block filling x in [0, 10) cells; open space to the right.
    for (let y = 0; y < world.height; y++) {
      for (let x = 0; x < 10; x++) world.health[y * world.width + x] = 50;
    }
    const r = SOLDIER.collisionRadius;
    const p = findClearDeployPoint(world, 9.5 * 8, 100, r, 1)!;
    expect(p).not.toBeNull();
    expect(circleIsClear(world, p.x, p.y, r + 1)).toBe(true);
    expect(p.x - r).toBeGreaterThanOrEqual(80 + 1);
    // And it stays close to where the player clicked.
    expect(Math.hypot(p.x - 9.5 * 8, p.y - 100)).toBeLessThan(16);
  });

  it("keeps an already clear click exactly where it was", async () => {
    const { findClearDeployPoint } = await import("../src/systems/PhysicsSystem");
    const world = new PixelWorld({ width: 32, height: 32, cellSize: 8, roomSize: 6 });
    expect(findClearDeployPoint(world, 120, 130, SOLDIER.collisionRadius, 1)).toEqual({ x: 120, y: 130 });
  });

  it("refuses when nothing nearby is open", async () => {
    const { findClearDeployPoint } = await import("../src/systems/PhysicsSystem");
    const world = new PixelWorld({ width: 32, height: 32, cellSize: 8, roomSize: 6 });
    world.health.fill(50);
    expect(findClearDeployPoint(world, 120, 130, SOLDIER.collisionRadius, 1, 4)).toBeNull();
  });
});
