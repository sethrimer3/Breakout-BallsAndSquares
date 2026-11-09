import { ART_PIXEL, SOLDIER } from "../config";
import { SOLDIER_SHAPES, shapeSdf, type SoldierShape } from "../entities/soldierShapes";

/** Pre-rendered sprites (avoid creating gradients per particle per frame). */

function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  return [c, c.getContext("2d")!];
}

/** Radial glow: stops are [offset, rgba] pairs. */
export function radialSprite(size: number, stops: [number, string][]): HTMLCanvasElement {
  const [c, g] = makeCanvas(size);
  const r = size / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  for (const [o, col] of stops) grad.addColorStop(o, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

/** Palette for the pixel-art soldier: shadow, body, light, highlight, ring. */
export const SOLDIER_PALETTE = {
  "-": "#1c6b80",
  "#": "#38d6ff",
  "+": "#92e8ff",
  w: "#ffffff",
  o: "#38d6ff",
} as const;

/**
 * Pixel grid for the soldier: a shaded sphere (lit from the upper left), optionally
 * inside a one-pixel ring (shown only on the selected soldier). One character per pixel; "." is transparent, the rest index
 * `SOLDIER_PALETTE`. The grid is square with an odd side so the sphere has a
 * center pixel.
 */
export function soldierGrid(sphereRadius: number, ringRadius: number, withRing = true): string[] {
  return soldierShapeGrid(SOLDIER_SHAPES[0], 0, sphereRadius, ringRadius, withRing);
}

/** Bevel width of polygon bodies, in body units (about 1.5 art pixels). */
const SHAPE_BEVEL = 0.34;

/** How much of the full dome curve polygon tops keep (0 = flat, 1 = dome). */
const SHAPE_DOME = 0.6;

/** Deepest point inside a shape (body units), used to normalise its dome. */
const shapeDepthCache = new Map<SoldierShape, number>();
function shapeMaxDepth(shape: SoldierShape): number {
  let d = shapeDepthCache.get(shape);
  if (d !== undefined) return d;
  d = 0;
  for (let y = -1.5; y <= 1.5; y += 0.02) {
    for (let x = -1.5; x <= 1.5; x += 0.02) d = Math.max(d, -shapeSdf(shape, x, y));
  }
  shapeDepthCache.set(shape, d);
  return d;
}

/**
 * Pixel grid for a soldier of any body shape, rotated so its front points along
 * `angle` (radians, screen space). The body is shaded as a bevelled slab (the
 * sphere as a dome), always lit from the upper left, so rotated sprites keep
 * consistent lighting. For the sphere this is exactly the shaded ball.
 */
export function soldierShapeGrid(
  shape: SoldierShape,
  angle: number,
  sphereRadius: number,
  ringRadius: number,
  withRing = true,
): string[] {
  const n = 2 * Math.ceil(ringRadius - 0.5) + 1;
  const c = n / 2;
  const lx = -0.5;
  const ly = -0.55;
  const lz = 0.67;
  const lm = Math.hypot(lx, ly, lz);
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  // The sphere is a full dome; polygons get a flat top with a narrow bevel so
  // their straight edges and corners still read at this tiny size, plus a
  // gentle curve over the top so they keep the sphere's soft shading.
  const maxDepth = shapeMaxDepth(shape);
  const bevel = shape.verts ? Math.min(SHAPE_BEVEL, maxDepth) : maxDepth;
  const h = 0.01;
  const rows: string[] = [];
  for (let y = 0; y < n; y++) {
    let row = "";
    for (let x = 0; x < n; x++) {
      const dx = x + 0.5 - c;
      const dy = y + 0.5 - c;
      const d = Math.hypot(dx, dy);
      // Screen pixel -> body space (undo the rotation, scale to body units).
      const bx = (dx * ca + dy * sa) / sphereRadius;
      const by = (-dx * sa + dy * ca) / sphereRadius;
      const sd = shapeSdf(shape, bx, by);
      if (sd <= 0) {
        // Outward gradient of the outline, back in screen space.
        let gx = shapeSdf(shape, bx + h, by) - shapeSdf(shape, bx - h, by);
        let gy = shapeSdf(shape, bx, by + h) - shapeSdf(shape, bx, by - h);
        const gl = Math.hypot(gx, gy) || 1;
        gx /= gl;
        gy /= gl;
        const sgx = gx * ca - gy * sa;
        const sgy = gx * sa + gy * ca;
        const dome = Math.max(0, 1 + sd / maxDepth);
        const q = Math.min(1, Math.max(0, 1 + sd / bevel, shape.verts ? dome * SHAPE_DOME : dome));
        const nx = sgx * q;
        const ny = sgy * q;
        const nz = Math.sqrt(Math.max(0, 1 - q * q));
        const i = (nx * lx + ny * ly + nz * lz) / lm;
        row += i > 0.96 ? "w" : i > 0.82 ? "+" : i > 0.3 ? "#" : "-";
      } else if (withRing && d <= ringRadius && d > ringRadius - 1) {
        row += "o";
      } else {
        row += ".";
      }
    }
    rows.push(row);
  }
  return rows;
}

function gridToCanvas(grid: string[]): HTMLCanvasElement {
  const [c, g] = makeCanvas(grid.length);
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < grid.length; x++) {
      const ch = grid[y][x] as keyof typeof SOLDIER_PALETTE | ".";
      if (ch === ".") continue;
      g.fillStyle = SOLDIER_PALETTE[ch];
      g.fillRect(x, y, 1, 1);
    }
  }
  return c;
}

/** Rotation steps cached per shape (11.25 degrees each). */
export const SOLDIER_ANGLE_STEPS = 32;
const shapeSpriteCache = new Map<string, HTMLCanvasElement>();

/**
 * Cached pixel-art sprite for a soldier shape facing `angle`. The sphere ignores
 * the angle. Drawn at one canvas pixel per art pixel, like `soldierSprite`.
 */
export function soldierShapeSprite(shapeIndex: number, angle: number, withRing: boolean): HTMLCanvasElement {
  const shape = SOLDIER_SHAPES[shapeIndex] ?? SOLDIER_SHAPES[0];
  const steps = SOLDIER_ANGLE_STEPS;
  const step = shape.verts
    ? ((Math.round((angle / (Math.PI * 2)) * steps) % steps) + steps) % steps
    : 0;
  const key = `${shapeIndex}:${step}:${withRing ? 1 : 0}`;
  let c = shapeSpriteCache.get(key);
  if (!c) {
    const grid = soldierShapeGrid(
      shape,
      (step / steps) * Math.PI * 2,
      SOLDIER.renderRadius / ART_PIXEL,
      SOLDIER.ringRadius / ART_PIXEL,
      withRing,
    );
    c = gridToCanvas(grid);
    shapeSpriteCache.set(key, c);
  }
  return c;
}

/** Pixel-art soldier sprite at one canvas pixel per art pixel (draw with smoothing off). */
export function soldierSprite(sphereRadius: number, ringRadius: number, withRing = true): HTMLCanvasElement {
  return gridToCanvas(soldierGrid(sphereRadius, ringRadius, withRing));
}

/** Pre-rendered golden square with a soft outer radial glow for ultra-fast single-drawImage loot rendering. */
export function goldSquareSprite(size: number): HTMLCanvasElement {
  const [c, g] = makeCanvas(size);
  const r = size / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, "rgba(255, 240, 130, 0.95)");
  grad.addColorStop(0.28, "rgba(255, 195, 40, 0.55)");
  grad.addColorStop(0.62, "rgba(255, 140, 10, 0.16)");
  grad.addColorStop(1, "rgba(255, 110, 0, 0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);

  // Crisp pixel-art golden square core in the center.
  const sq = Math.round(size * 0.34);
  const x0 = Math.round(r - sq / 2);
  const y0 = Math.round(r - sq / 2);
  g.fillStyle = "#e89a10";
  g.fillRect(x0 - 1, y0 - 1, sq + 2, sq + 2);
  g.fillStyle = "#ffd942";
  g.fillRect(x0, y0, sq, sq);
  const inner = Math.max(2, Math.round(sq * 0.5));
  g.fillStyle = "#fffbe0";
  g.fillRect(x0 + 1, y0 + 1, inner, inner);
  return c;
}

/** A crystal drop's colors: glow stops, then shell, face and highlight. */
interface CrystalPalette {
  glow: [string, string, string, string];
  shell: string;
  face: string;
  shine: string;
}

const ORANGE_CRYSTAL: CrystalPalette = {
  glow: ["rgba(255, 190, 95, 0.95)", "rgba(255, 115, 25, 0.58)", "rgba(215, 55, 5, 0.18)", "rgba(160, 25, 0, 0)"],
  shell: "#b83804",
  face: "#ff7b1c",
  shine: "#ffe6b0",
};

const GREEN_CRYSTAL: CrystalPalette = {
  glow: ["rgba(190, 255, 205, 0.95)", "rgba(50, 225, 130, 0.58)", "rgba(10, 150, 80, 0.18)", "rgba(0, 90, 50, 0)"],
  shell: "#0c7a45",
  face: "#34e088",
  shine: "#dcffe8",
};

/** Pre-rendered glowing crystal (Zone 2 and Zone 3 currency) with baked radial glow. */
export function crystalSprite(size: number, palette: CrystalPalette): HTMLCanvasElement {
  const [c, g] = makeCanvas(size);
  const r = size / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, palette.glow[0]);
  grad.addColorStop(0.28, palette.glow[1]);
  grad.addColorStop(0.62, palette.glow[2]);
  grad.addColorStop(1, palette.glow[3]);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);

  // Crisp faceted diamond/crystal in the center.
  const hw = Math.round(size * 0.19);
  const hh = Math.round(size * 0.27);
  g.fillStyle = palette.shell;
  g.beginPath();
  g.moveTo(r, r - hh - 1);
  g.lineTo(r + hw + 1, r);
  g.lineTo(r, r + hh + 1);
  g.lineTo(r - hw - 1, r);
  g.closePath();
  g.fill();

  g.fillStyle = palette.face;
  g.beginPath();
  g.moveTo(r, r - hh);
  g.lineTo(r + hw, r);
  g.lineTo(r, r + hh);
  g.lineTo(r - hw, r);
  g.closePath();
  g.fill();

  // Upper-left bright facet highlight.
  g.fillStyle = palette.shine;
  g.beginPath();
  g.moveTo(r, r - hh + 1.5);
  g.lineTo(r + hw * 0.45, r);
  g.lineTo(r, r + hh * 0.25);
  g.lineTo(r - hw * 0.65, r);
  g.closePath();
  g.fill();
  return c;
}

export interface Sprites {
  /** Sphere only. Same canvas size as `soldierSelected`, so both draw identically. */
  soldier: HTMLCanvasElement;
  /** Sphere inside the pixel ring, for the soldier the camera is following. */
  soldierSelected: HTMLCanvasElement;
  soldierGlow: HTMLCanvasElement;
  warmGlow: HTMLCanvasElement;
  hotGlow: HTMLCanvasElement;
  crimsonGlow: HTMLCanvasElement;
  goldSquare: HTMLCanvasElement;
  orangeCrystal: HTMLCanvasElement;
  greenCrystal: HTMLCanvasElement;
  dot: HTMLCanvasElement;
}

export function createSprites(): Sprites {
  return {
    soldier: soldierSprite(SOLDIER.renderRadius / ART_PIXEL, SOLDIER.ringRadius / ART_PIXEL, false),
    soldierSelected: soldierSprite(SOLDIER.renderRadius / ART_PIXEL, SOLDIER.ringRadius / ART_PIXEL, true),
    soldierGlow: radialSprite(64, [
      [0, "rgba(120, 225, 255, 0.45)"],
      [0.4, "rgba(80, 180, 255, 0.15)"],
      [1, "rgba(40, 120, 255, 0)"],
    ]),
    warmGlow: radialSprite(64, [
      [0, "rgba(255, 245, 220, 1)"],
      [0.15, "rgba(255, 220, 140, 0.8)"],
      [0.45, "rgba(255, 140, 40, 0.25)"],
      [1, "rgba(255, 90, 0, 0)"],
    ]),
    hotGlow: radialSprite(64, [
      [0, "rgba(255, 255, 255, 1)"],
      [0.3, "rgba(255, 240, 200, 0.6)"],
      [1, "rgba(255, 200, 120, 0)"],
    ]),
    crimsonGlow: radialSprite(64, [
      [0, "rgba(255, 60, 110, 0.9)"],
      [0.4, "rgba(200, 20, 80, 0.35)"],
      [1, "rgba(120, 0, 60, 0)"],
    ]),
    goldSquare: goldSquareSprite(32),
    orangeCrystal: crystalSprite(32, ORANGE_CRYSTAL),
    greenCrystal: crystalSprite(32, GREEN_CRYSTAL),
    dot: radialSprite(16, [
      [0, "rgba(255,255,255,1)"],
      [0.5, "rgba(255,255,255,0.6)"],
      [1, "rgba(255,255,255,0)"],
    ]),
  };
}
