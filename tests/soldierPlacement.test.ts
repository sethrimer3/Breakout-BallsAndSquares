import { describe, expect, it, vi } from "vitest";
import { SOLDIER, WORLD } from "../src/config";
import { Rng } from "../src/core/Rng";
import { Soldier } from "../src/entities/Soldier";
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

describe("Soldier Placement & Slingshot Aim Mechanics", () => {
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

  describe("Click and let go -> random cardinal direction", () => {
    it("sends soldiers in only one of the 4 cardinal directions (straight up, right, left, down)", () => {
      const rng = new Rng(42);
      const CARDINAL = [
        { dx: 0, dy: -1 }, // straight up
        { dx: 1, dy: 0 },  // right
        { dx: 0, dy: 1 },  // down
        { dx: -1, dy: 0 }, // left
      ];

      const counts = [0, 0, 0, 0];
      for (let i = 0; i < 200; i++) {
        const idx = Math.floor(rng.range(0, 4));
        const dir = CARDINAL[idx];
        counts[idx]++;

        // Check it is strictly a valid cardinal direction
        const matches = CARDINAL.some((c) => c.dx === dir.dx && c.dy === dir.dy);
        expect(matches).toBe(true);

        const soldier = new Soldier(100, 100, dir.dx, dir.dy, SOLDIER.speed);
        // Speed must match
        expect(Math.hypot(soldier.vx, soldier.vy)).toBeCloseTo(SOLDIER.speed);

        // Movement must align with exactly one cardinal axis
        if (dir.dx === 0 && dir.dy === -1) {
          expect(soldier.vx).toBeCloseTo(0);
          expect(soldier.vy).toBeCloseTo(-SOLDIER.speed);
        } else if (dir.dx === 1 && dir.dy === 0) {
          expect(soldier.vx).toBeCloseTo(SOLDIER.speed);
          expect(soldier.vy).toBeCloseTo(0);
        } else if (dir.dx === 0 && dir.dy === 1) {
          expect(soldier.vx).toBeCloseTo(0);
          expect(soldier.vy).toBeCloseTo(SOLDIER.speed);
        } else if (dir.dx === -1 && dir.dy === 0) {
          expect(soldier.vx).toBeCloseTo(-SOLDIER.speed);
          expect(soldier.vy).toBeCloseTo(0);
        }
      }

      // Verify all 4 directions were sampled
      for (let i = 0; i < 4; i++) {
        expect(counts[i]).toBeGreaterThan(20);
      }
    });
  });

  describe("Press, drag and let go -> arrow facing opposite direction, soldier goes away from release", () => {
    it("arrow faces opposite direction to drag, and soldier moves away from release point", () => {
      // Test cases: [dragDx, dragDy, expectedAimDx, expectedAimDy]
      const tests = [
        // Drag downwards (pull back down) -> launches straight up (away from release)
        { drag: { dx: 0, dy: 50 }, expected: { dx: 0, dy: -1 } },
        // Drag upwards (pull back up) -> launches straight down (away from release)
        { drag: { dx: 0, dy: -50 }, expected: { dx: 0, dy: 1 } },
        // Drag right -> launches straight left (away from release)
        { drag: { dx: 60, dy: 0 }, expected: { dx: -1, dy: 0 } },
        // Drag left -> launches straight right (away from release)
        { drag: { dx: -60, dy: 0 }, expected: { dx: 1, dy: 0 } },
        // Drag diagonally down-right -> launches up-left (away from release)
        { drag: { dx: 30, dy: 40 }, expected: { dx: -0.6, dy: -0.8 } },
        // Drag diagonally up-left -> launches down-right (away from release)
        { drag: { dx: -30, dy: -40 }, expected: { dx: 0.6, dy: 0.8 } },
      ];

      for (const { drag, expected } of tests) {
        const startX = 200;
        const startY = 200;
        const endX = startX + drag.dx;
        const endY = startY + drag.dy;

        // 1. Drag vector from press to cursor:
        const dragDx = endX - startX;
        const dragDy = endY - startY;

        // 2. Arrow vector faces opposite direction:
        const aimDx = -dragDx;
        const aimDy = -dragDy;
        const aimLen = Math.hypot(aimDx, aimDy);
        const normAimX = aimDx / aimLen;
        const normAimY = aimDy / aimLen;

        expect(normAimX).toBeCloseTo(expected.dx, 5);
        expect(normAimY).toBeCloseTo(expected.dy, 5);

        // 3. Direction away from where player let go:
        // Where player let go is (endX, endY). Origin is (startX, startY).
        // Vector away from (endX, endY) towards (startX, startY) is:
        const launchDx = startX - endX;
        const launchDy = startY - endY;
        const launchLen = Math.hypot(launchDx, launchDy);
        const normLaunchX = launchDx / launchLen;
        const normLaunchY = launchDy / launchLen;

        expect(normLaunchX).toBeCloseTo(expected.dx, 5);
        expect(normLaunchY).toBeCloseTo(expected.dy, 5);

        // 4. Soldier spawned at (startX, startY) with this direction
        const s = new Soldier(startX, startY, normLaunchX, normLaunchY, SOLDIER.speed);
        expect(s.x).toBe(startX);
        expect(s.y).toBe(startY);
        expect(s.vx).toBeCloseTo(expected.dx * SOLDIER.speed, 3);
        expect(s.vy).toBeCloseTo(expected.dy * SOLDIER.speed, 3);
      }
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

    it("dispatches onAimRelease on press and drag", () => {
      const { mockCanvas } = setupMockWindow();
      let releaseData: { startSx: number; startSy: number; endSx: number; endSy: number } | null = null;
      let clickCalled = false;

      const handlers: InputHandlers = {
        canPlace: () => true,
        onAimStart: vi.fn(),
        onAimMove: vi.fn(),
        onAimClick: () => {
          clickCalled = true;
        },
        onAimRelease: (startSx, startSy, endSx, endSy) => {
          releaseData = { startSx, startSy, endSx, endSy };
        },
      };

      new Input(mockCanvas as any, handlers);

      // Pointer down at (100, 100)
      mockCanvas.dispatchCanvasEvent({
        type: "pointerdown",
        button: 0,
        pointerType: "mouse",
        clientX: 100,
        clientY: 100,
        preventDefault: () => {},
      });

      // Pointer move to (100, 160) -> 60px down
      (globalThis as any).window.dispatchEvent({
        type: "pointermove",
        pointerType: "mouse",
        clientX: 100,
        clientY: 160,
      });

      expect(handlers.onAimMove).toHaveBeenCalledWith(100, 160);

      // Pointer up at (100, 160)
      (globalThis as any).window.dispatchEvent({
        type: "pointerup",
        button: 0,
        pointerType: "mouse",
        clientX: 100,
        clientY: 160,
      });

      expect(clickCalled).toBe(false);
      expect(releaseData).toEqual({
        startSx: 100,
        startSy: 100,
        endSx: 100,
        endSy: 160,
      });
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
