/**
 * Body shapes for soldiers. Each loadout slot gets its own shape so soldiers can be
 * told apart: slot 0 keeps the round sphere, later slots get rounded polygons.
 *
 * Polygons are in body units (1 = `SOLDIER.renderRadius`) with the front of the
 * soldier pointing along +x; they are rotated to the soldier's facing angle when
 * drawn and when they block light.
 */
export interface SoldierShape {
  name: string;
  /** Outline vertices (counter-clockwise or clockwise), or null for the circle. */
  verts: readonly (readonly [number, number])[] | null;
  /** Corner rounding in body units (the outline grows by this much). */
  round: number;
}

function regular(n: number, r: number, startDeg = 0): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = ((startDeg + (360 * i) / n) * Math.PI) / 180;
    out.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return out;
}

export const SOLDIER_SHAPES: readonly SoldierShape[] = [
  { name: "sphere", verts: null, round: 0 },
  { name: "triangle", verts: regular(3, 1.12), round: 0.22 },
  { name: "square", verts: regular(4, 1.0, 45), round: 0.14 },
  { name: "pentagon", verts: regular(5, 1.0), round: 0.1 },
  { name: "hexagon", verts: regular(6, 1.0), round: 0.08 },
  {
    name: "chevron",
    verts: [
      [1.05, 0],
      [-0.75, 0.95],
      [-0.25, 0],
      [-0.75, -0.95],
    ],
    round: 0.2,
  },
  {
    name: "rhombus",
    verts: [
      [1.15, 0],
      [0, 0.66],
      [-1.15, 0],
      [0, -0.66],
    ],
    round: 0.18,
  },
  {
    name: "kite",
    verts: [
      [1.15, 0],
      [-0.2, 0.78],
      [-0.85, 0],
      [-0.2, -0.78],
    ],
    round: 0.18,
  },
];

/** The shape index for a loadout slot (slot 0 is the sphere). */
export function soldierShapeIndex(slotIndex: number): number {
  const n = SOLDIER_SHAPES.length;
  return ((slotIndex % n) + n) % n;
}

/**
 * Signed distance from (px, py) to a polygon outline: negative inside. Works for
 * concave polygons (the chevron).
 */
export function polygonSdf(verts: readonly (readonly [number, number])[], px: number, py: number): number {
  const n = verts.length;
  let d = Infinity;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = verts[i];
    const [xj, yj] = verts[j];
    const ex = xj - xi;
    const ey = yj - yi;
    const wx = px - xi;
    const wy = py - yi;
    const t = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (ex * ex + ey * ey)));
    const dx = wx - ex * t;
    const dy = wy - ey * t;
    d = Math.min(d, dx * dx + dy * dy);
    if (yi > py !== yj > py && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
  }
  d = Math.sqrt(d);
  return inside ? -d : d;
}

/** Signed distance to a shape's rounded outline, in body units (negative inside). */
export function shapeSdf(shape: SoldierShape, px: number, py: number): number {
  if (!shape.verts) return Math.hypot(px, py) - 1;
  return polygonSdf(shape.verts, px, py) - shape.round;
}

/**
 * Writes the shape's occluder outline in world space into `out` (x, y pairs) and
 * returns the vertex count, or 0 for the circle (which uses a circle occluder).
 * The polygon is scaled by `scale` and rotated by `angle` around (cx, cy).
 */
export function shapeOccluder(
  shape: SoldierShape,
  cx: number,
  cy: number,
  angle: number,
  scale: number,
  out: Float32Array,
): number {
  const v = shape.verts;
  if (!v) return 0;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  // Push the vertices out a little so the corner rounding is covered on average.
  for (let i = 0; i < v.length; i++) {
    const [x, y] = v[i];
    const len = Math.hypot(x, y) || 1;
    const k = scale * (1 + (shape.round * 0.5) / len);
    out[i * 2] = cx + (x * c - y * s) * k;
    out[i * 2 + 1] = cy + (x * s + y * c) * k;
  }
  return v.length;
}

/**
 * Distance along the ray `(ox, oy) + t*(dx, dy)` to the first polygon edge hit, or
 * `Infinity`. A ray starting inside the polygon hits nothing (no self-occlusion).
 */
export function rayPolygonDistance(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  poly: Float32Array,
  n: number,
): number {
  let best = Infinity;
  let crossings = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ax = poly[j * 2];
    const ay = poly[j * 2 + 1];
    const bx = poly[i * 2];
    const by = poly[i * 2 + 1];
    const ex = bx - ax;
    const ey = by - ay;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-9) continue;
    const fx = ax - ox;
    const fy = ay - oy;
    const t = (fx * ey - fy * ex) / den;
    const u = (fx * dy - fy * dx) / den;
    if (u < 0 || u >= 1 || t <= 0) continue;
    crossings++;
    if (t < best) best = t;
  }
  // An odd number of forward crossings means the origin is inside.
  return crossings % 2 === 1 ? Infinity : best;
}
