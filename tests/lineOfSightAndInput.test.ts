import { describe, expect, it, vi } from "vitest";
import { SOLDIER } from "../src/config";
import { Rng } from "../src/core/Rng";
import { Soldier } from "../src/entities/Soldier";
import { Input, type InputHandlers } from "../src/systems/Input";
import { hasLineOfSight, PhysicsSystem } from "../src/systems/PhysicsSystem";
import { PixelWorld } from "../src/world/PixelWorld";

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

describe("Line of sight, bouncing and click dispatch", () => {
  describe("Line of Sight (hasLineOfSight)", () => {
    it("returns true across clear empty space", () => {
      const world = new PixelWorld({ width: 32, height: 32, cellSize: 8, roomSize: 10 });
      // world starts with all cells empty (health = 0)
      const clear = hasLineOfSight(world, 50, 50, 150, 120);
      expect(clear).toBe(true);
    });

    it("returns false when a solid normal cell obstructs the ray", () => {
      const world = new PixelWorld({ width: 32, height: 32, cellSize: 8, roomSize: 10 });
      // Place a solid wall at cx=12, cy=6 (world x in [96, 104], y in [48, 56])
      const cellIdx = 6 * world.width + 12;
      world.health[cellIdx] = 100;

      // Ray from (50, 52) to (150, 52) passes directly through cell (12, 6)
      const obstructed = hasLineOfSight(world, 50, 52, 150, 52);
      expect(obstructed).toBe(false);
    });

    it("returns true when target is on a solid cell that is directly visible", () => {
      const world = new PixelWorld({ width: 32, height: 32, cellSize: 8, roomSize: 10 });
      // Target block at cx=12, cy=6 (x=96..104, y=48..56)
      const cellIdx = 6 * world.width + 12;
      world.health[cellIdx] = 100;

      // Target is at (100, 52) which is inside that block; start is at (50, 52)
      const clear = hasLineOfSight(world, 50, 52, 100, 52);
      expect(clear).toBe(true);
    });

    it("returns false when a pink sub-pixel blight obstructs the ray", () => {
      const world = new PixelWorld({ width: 32, height: 32, cellSize: 8, roomSize: 10 });
      // subCellSize = 4. Subcell at sx=24, sy=12 corresponds to x in [96, 100], y in [48, 52]
      const subIdx = 12 * world.subWidth + 24;
      world.subHealth[subIdx] = 50;

      const obstructed = hasLineOfSight(world, 50, 50, 150, 50);
      expect(obstructed).toBe(false);
    });

    it("returns false around a 90-degree corner wall", () => {
      const world = new PixelWorld({ width: 32, height: 32, cellSize: 8, roomSize: 10 });
      // Corner wall block at cx=10, cy=10 (world x in [80, 88], y in [80, 88])
      world.health[10 * world.width + 10] = 100;

      // Ray from (70, 95) to (95, 70) crosses through the corner cell (10, 10)
      const obstructed = hasLineOfSight(world, 70, 95, 95, 70);
      expect(obstructed).toBe(false);
    });
  });

  describe("Soldier bouncing", () => {
    it("reflects off a wall at full speed", () => {
      const world = new PixelWorld({ width: 32, height: 32, cellSize: 8, roomSize: 10 });
      const rng = new Rng(42);
      const phys = new PhysicsSystem(world, rng);

      // Left wall
      for (let y = 0; y < world.height; y++) {
        world.health[y * world.width + 0] = 100;
      }

      const speed = 100;
      const s = new Soldier(8 + SOLDIER.collisionRadius - 0.5, 50, -1, 0, speed);
      const bounced = phys.resolve(s);
      expect(bounced).toBe(true);
      expect(s.vx).toBeGreaterThan(0);
      expect(Math.hypot(s.vx, s.vy)).toBeCloseTo(speed, 2);
    });
  });

  describe("Input click dispatch", () => {
    it("dispatches onPrimaryClick when canPlace is false and no drag occurred", () => {
      const { mockCanvas } = setupMockWindow();
      let clickPos: { sx: number; sy: number } | null = null;

      const handlers: InputHandlers = {
        canPlace: () => false,
        onPrimaryClick: (sx, sy) => {
          clickPos = { sx, sy };
        },
      };

      new Input(mockCanvas as any, handlers);

      // Left click down at (200, 150)
      mockCanvas.dispatchCanvasEvent({
        type: "pointerdown",
        button: 0,
        pointerType: "mouse",
        clientX: 200,
        clientY: 150,
        preventDefault: () => {},
      });

      // Left click up within slop at (201, 150)
      (globalThis as any).window.dispatchEvent({
        type: "pointerup",
        button: 0,
        pointerType: "mouse",
        clientX: 201,
        clientY: 150,
      });

      expect(clickPos).toEqual({ sx: 201, sy: 150 });
    });

    it("does not dispatch onPrimaryClick when dragging beyond slop", () => {
      const { mockCanvas } = setupMockWindow();
      let clicked = false;
      const onPan = vi.fn();

      const handlers: InputHandlers = {
        canPlace: () => false,
        onPrimaryClick: () => {
          clicked = true;
        },
        onPan,
      };

      new Input(mockCanvas as any, handlers);

      // Pointer down at (200, 150)
      mockCanvas.dispatchCanvasEvent({
        type: "pointerdown",
        button: 0,
        pointerType: "mouse",
        clientX: 200,
        clientY: 150,
        preventDefault: () => {},
      });

      // Pointer move by 30px (drag)
      (globalThis as any).window.dispatchEvent({
        type: "pointermove",
        pointerType: "mouse",
        clientX: 230,
        clientY: 150,
      });

      // Pointer up at (230, 150)
      (globalThis as any).window.dispatchEvent({
        type: "pointerup",
        button: 0,
        pointerType: "mouse",
        clientX: 230,
        clientY: 150,
      });

      expect(onPan).toHaveBeenCalled();
      expect(clicked).toBe(false);
    });

    it("dispatches onSecondaryClick on right click without drag", () => {
      const { mockCanvas } = setupMockWindow();
      let secClickPos: { sx: number; sy: number } | null = null;

      const handlers: InputHandlers = {
        canPlace: () => true, // even when canPlace is true!
        onSecondaryClick: (sx, sy) => {
          secClickPos = { sx, sy };
        },
      };

      new Input(mockCanvas as any, handlers);

      // Right-click down (button 2)
      mockCanvas.dispatchCanvasEvent({
        type: "pointerdown",
        button: 2,
        pointerType: "mouse",
        clientX: 300,
        clientY: 250,
        preventDefault: () => {},
      });

      // Right-click up within slop
      (globalThis as any).window.dispatchEvent({
        type: "pointerup",
        button: 2,
        pointerType: "mouse",
        clientX: 301,
        clientY: 250,
      });

      expect(secClickPos).toEqual({ sx: 301, sy: 250 });
    });
  });
});
