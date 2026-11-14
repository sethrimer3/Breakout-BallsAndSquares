import { FACILITY, LIGHT, SOLDIER } from "../config";
import { gridRaycast, makeRayHit } from "../core/gridRaycast";
import type { Soldier } from "../entities/Soldier";
import { SOLDIER_SHAPES, rayPolygonDistance, shapeOccluder, soldierShapeIndex } from "../entities/soldierShapes";
import type { CameraSystem } from "./CameraSystem";
import { roomLightPosition, LIGHT_KIND, type PixelWorld, type RoomLight } from "../world/PixelWorld";

export type LightQuality = "high" | "medium" | "low";

export interface QualityPreset {
  baseRays: number;
  coneRays: number;
  maxCornerRays: number;
  maxShadowLights: number;
}

export const QUALITY_PRESETS: Record<LightQuality, QualityPreset> = {
  high: {
    baseRays: LIGHT.baseRays,
    coneRays: LIGHT.coneRays,
    maxCornerRays: LIGHT.maxCornerRays,
    maxShadowLights: LIGHT.maxShadowLights,
  },
  medium: {
    baseRays: 80,
    coneRays: 12,
    maxCornerRays: 512,
    maxShadowLights: 16,
  },
  low: {
    baseRays: 64,
    coneRays: 8,
    maxCornerRays: 256,
    maxShadowLights: 10,
  },
};

/** Wall cells (world indices) with a face visible from a light. */
export interface LitCells {
  cells: Int32Array;
  count: number;
}

export function makeLitCells(): LitCells {
  return { cells: new Int32Array(LIGHT.maxLitCells), count: 0 };
}

export interface MuzzleLight {
  x: number;
  y: number;
  dx: number;
  dy: number;
  life: number;
  maxLife: number;
  radius: number;
  ownerId: number;
  /** World-space visibility polygon vertices `[x0, y0, x1, y1, ...]`. */
  poly: Float32Array;
  polyCount: number;
  hasPolygon: boolean;
  /** Wall cells this flash lights. Whole cells, so wall light stays on the grid. */
  lit: LitCells;
}

/** Always-on light (soldier visibility pool, spawn room, or environmental glow). */
export interface SoftLight {
  x: number;
  y: number;
  radius: number;
  strength: number;
  /** Uses the broader, brighter steady visibility profile. */
  soldier: boolean;
  /** Warm firelight (burning rubble, flamethrower nozzle) instead of the cool soldier glow. */
  warm: boolean;
  poly: Float32Array;
  /** 0 when not shadow-traced this frame: the glow then lights open air only. */
  polyCount: number;
  lit: LitCells;
}

function makeSoftLight(): SoftLight {
  return {
    x: 0,
    y: 0,
    radius: 0,
    strength: 0,
    warm: false,
    soldier: false,
    poly: new Float32Array(LIGHT.maxRays * 2),
    polyCount: 0,
    lit: makeLitCells(),
  };
}

/**
 * A ceiling panel's shadow-traced light. Panels never move, so the polygon is
 * kept until terrain near the panel changes.
 */
export interface FixtureLight {
  light: RoomLight;
  x: number;
  y: number;
  radius: number;
  poly: Float32Array | null;
  polyCount: number;
  lit: LitCells;
  dirty: boolean;
}

const EMPTY_LIT: LitCells = { cells: new Int32Array(0), count: 0 };

const rayHit = makeRayHit();

/**
 * Ray-circle intersection distance along ray `(ox, oy) + t*(dx, dy)` for `t >= 0`.
 * Returns `Infinity` if no positive hit. If the ray origin lies inside the circle,
 * ignores the circle (so a flash close to its own soldier never self-occludes).
 */
export function rayCircleDistance(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  cx: number,
  cy: number,
  r: number,
): number {
  const fx = ox - cx;
  const fy = oy - cy;
  const c = fx * fx + fy * fy - r * r;
  if (c <= 0) return Infinity;
  const b = fx * dx + fy * dy;
  if (b >= 0) return Infinity;
  const disc = b * b - c;
  if (disc < 0) return Infinity;
  const t = -b - Math.sqrt(disc);
  return t > 0 ? t : Infinity;
}

interface CornerCand {
  angle: number;
  dist2: number;
}

/**
 * Computes 2D visibility polygons for active muzzle flashes.
 * Combines evenly spaced base rays, forward-cone rays, silhouette-corner
 * grazing rays (Rev 2), and soldier-circle tangent rays (Rev 2).
 *
 * Polygons stop at wall faces and describe light in open air. Light on walls is
 * resolved per cell (see `markLitCells`) so it can never cut across the grid.
 */
export class LightingSystem {
  quality: LightQuality = "high";
  /** Telemetry from the most recent frame. */
  lastRaysCast = 0;
  lastShadowLights = 0;
  lastComputeMs = 0;

  /** Soldier / room glows for the current frame (index 0 is the room). */
  softLights: SoftLight[] = [];
  softCount = 0;

  private angles = new Float64Array(LIGHT.maxRays);
  private corners: CornerCand[] = [];
  /** Soldier occluders gathered for the current trace. */
  private occluders: { x: number; y: number; n: number; poly: Float32Array }[] = [];
  /** Per-cell stamp so `markLitCells` lists each cell once per light. */
  private litStamps: Uint32Array;
  private litStamp = 0;

  /** Shadow-traced ceiling panels, parallel to `world.roomLights` (null for washes and Blight glows). */
  fixtures: (FixtureLight | null)[] = [];
  private fixtureSource: RoomLight[] | null = null;
  /** Spatial buckets contain only fixtures whose shadow radius reaches that bucket. */
  private fixtureBuckets: FixtureLight[][] = [];
  private readonly fixtureBucketCells = 32;
  private scratchPoly = new Float32Array(LIGHT.maxRays * 2);
  private scratchLit = makeLitCells();

  constructor(private world: PixelWorld) {
    this.litStamps = new Uint32Array(world.width * world.height);
    world.addListener((cx, cy, kind) => {
      if (kind !== "damaged") this.invalidateFixtures(cx, cy);
    });
  }

  /** Re-trace every panel whose light could reach cell (cx, cy). */
  private invalidateFixtures(cx: number, cy: number): void {
    const cs = this.world.cellSize;
    const x = (cx + 0.5) * cs;
    const y = (cy + 0.5) * cs;
    const columns = Math.ceil(this.world.width / this.fixtureBucketCells);
    const key = Math.floor(cy / this.fixtureBucketCells) * columns + Math.floor(cx / this.fixtureBucketCells);
    for (const f of this.fixtureBuckets[key] ?? []) {
      if (f.dirty) continue;
      const r = f.radius + cs;
      if (Math.abs(f.x - x) < r && Math.abs(f.y - y) < r) f.dirty = true;
    }
  }

  /**
   * Trace light and shadow for the ceiling panels near the view: up to
   * `FACILITY.panelTracesPerFrame` stale ones a frame, nearest first in list order.
   */
  updateFixtures(cam: CameraSystem): void {
    const w = this.world;
    if (w.roomLights !== this.fixtureSource) {
      this.fixtureSource = w.roomLights;
      const cs = w.cellSize;
      this.fixtures = w.roomLights.map((l) =>
        l.kind === LIGHT_KIND.wash || l.kind === LIGHT_KIND.blight
          ? null
          : {
              light: l,
              ...roomLightPosition(l, cs),
              radius: FACILITY.panelRadiusCells * cs,
              poly: null,
              polyCount: 0,
              lit: EMPTY_LIT,
              dirty: true,
            },
      );
      const unit = this.fixtureBucketCells * cs;
      const columns = Math.ceil(w.width / this.fixtureBucketCells), rows = Math.ceil(w.height / this.fixtureBucketCells);
      this.fixtureBuckets = Array.from({ length: columns * rows }, () => []);
      for (const f of this.fixtures) if (f) {
        const r = f.radius + cs;
        const x0 = Math.max(0, Math.floor((f.x-r)/unit)), x1 = Math.min(columns-1, Math.floor((f.x+r)/unit));
        const y0 = Math.max(0, Math.floor((f.y-r)/unit)), y1 = Math.min(rows-1, Math.floor((f.y+r)/unit));
        for (let y=y0;y<=y1;y++) for (let x=x0;x<=x1;x++) this.fixtureBuckets[y*columns+x].push(f);
      }
    }
    let budget = FACILITY.panelTracesPerFrame;
    const margin = FACILITY.panelRadiusCells * w.cellSize;
    const x0 = cam.screenToWorldX(0) - margin;
    const y0 = cam.screenToWorldY(0) - margin;
    const x1 = cam.screenToWorldX(cam.viewW) + margin;
    const y1 = cam.screenToWorldY(cam.viewH) + margin;
    for (const f of this.fixtures) {
      if (budget <= 0) break;
      if (!f || f.light.destroyed || !f.dirty || f.x < x0 || f.x > x1 || f.y < y0 || f.y > y1) continue;
      budget--;
      f.dirty = false;
      const n = this.trace(
        f.x, f.y, 1, 0, f.radius, -3, [], this.scratchPoly, this.scratchLit,
        FACILITY.panelBaseRays, 0, this.preset.maxCornerRays,
      );
      f.poly = n > 0 ? this.scratchPoly.slice(0, n * 2) : null;
      f.polyCount = n;
      const lc = this.scratchLit.count;
      f.lit = { cells: this.scratchLit.cells.slice(0, lc), count: lc };
    }
  }

  get preset(): QualityPreset {
    return QUALITY_PRESETS[this.quality];
  }

  /**
   * Build the visibility polygon for one light at `(ox, oy)` firing along `(dirX, dirY)`.
   * Writes vertices into `outPoly` and returns the vertex count; if `outLit` is given,
   * also fills it with the wall cells this light reaches.
   */
  computeVisibilityPolygon(
    ox: number,
    oy: number,
    dirX: number,
    dirY: number,
    radius: number,
    ownerId: number,
    soldiers: readonly Soldier[],
    outPoly: Float32Array,
    outLit?: LitCells,
  ): number {
    const p = this.preset;
    return this.trace(
      ox, oy, dirX, dirY, radius, ownerId, soldiers, outPoly, outLit,
      p.baseRays, p.coneRays, p.maxCornerRays,
    );
  }

  /**
   * Rebuild the room glow and one glow per living soldier. Shadow-traced glows
   * are capped; the camera culls off-screen ones.
   */
  updateSoftLights(
    soldiers: readonly Soldier[],
    roomX: number,
    roomY: number,
    cam: CameraSystem,
    extraLights?: readonly { x: number; y: number; radius: number; strength: number; warm?: boolean }[],
  ): void {
    this.softCount = 0;
    this.addSoftLight(roomX, roomY, LIGHT.roomLightRadius, LIGHT.roomLightStrength, -1, soldiers, cam);
    for (let i = 0; i < soldiers.length; i++) {
      const s = soldiers[i];
      if (!s.alive) continue;
      this.addSoftLight(
        s.x, s.y, LIGHT.soldierLightRadius, LIGHT.soldierLightStrength, s.id, soldiers, cam,
      );
    }
    if (extraLights) {
      for (let i = 0; i < extraLights.length; i++) {
        const el = extraLights[i];
        this.addSoftLight(el.x, el.y, el.radius, el.strength, -2, soldiers, cam, el.warm ?? false);
      }
    }
  }

  private addSoftLight(
    x: number,
    y: number,
    radius: number,
    strength: number,
    ownerId: number,
    soldiers: readonly Soldier[],
    cam: CameraSystem,
    warm = false,
  ): void {
    const idx = this.softCount++;
    const l = this.softLights[idx] ?? (this.softLights[idx] = makeSoftLight());
    l.warm = warm;
    l.soldier = ownerId >= 0;
    l.x = x;
    l.y = y;
    l.radius = radius;
    l.strength = strength;
    l.polyCount = 0;
    l.lit.count = 0;
    const sx = cam.worldToScreenX(x);
    const sy = cam.worldToScreenY(y);
    const rad = radius * cam.zoom;
    if (sx + rad < 0 || sy + rad < 0 || sx - rad > cam.viewW || sy - rad > cam.viewH) return;
    if (idx > LIGHT.maxSoftShadowLights) return;
    l.polyCount = this.trace(
      x, y, 1, 0, radius, ownerId, soldiers, l.poly, l.lit,
      LIGHT.softBaseRays, 0, this.preset.maxCornerRays,
    );
  }

  private trace(
    ox: number,
    oy: number,
    dirX: number,
    dirY: number,
    radius: number,
    ownerId: number,
    soldiers: readonly Soldier[],
    outPoly: Float32Array,
    outLit: LitCells | undefined,
    baseN: number,
    coneN: number,
    maxCornerRays: number,
  ): number {
    const angles = this.angles;
    const cs = this.world.cellSize;
    if (outLit) outLit.count = 0;

    // A muzzle pressed against a wall sits inside it: back the light out to the
    // wall face, or every ray would hit at t = 0 and the flash would vanish.
    const world = this.world;
    const ss = world.subCellSize;
    for (let i = 0; i < 16 && world.subSolidAt(Math.floor(ox / ss), Math.floor(oy / ss)); i++) {
      ox -= dirX;
      oy -= dirY;
    }
    if (world.subSolidAt(Math.floor(ox / ss), Math.floor(oy / ss))) return 0;

    let n = 0;
    const maxVerts = Math.min(angles.length, outPoly.length >>> 1);

    // 1) Evenly spaced base rays around the full 360°.
    for (let i = 0; i < baseN; i++) {
      angles[n++] = (i / baseN) * Math.PI * 2 - Math.PI;
    }

    // 2) Extra rays inside +/-30° of the firing direction for a crisp forward cone.
    const fireAng = Math.atan2(dirY, dirX);
    const halfCone = Math.PI / 6;
    for (let i = 0; i < coneN; i++) {
      const f = (i / Math.max(1, coneN - 1)) * 2 - 1;
      angles[n++] = normalizeAngle(fireAng + f * halfCone);
    }

    // 3) Silhouette corners of solid terrain cells within the light radius (Rev 2).
    const gx0 = Math.max(1, Math.floor((ox - radius) / cs));
    const gy0 = Math.max(1, Math.floor((oy - radius) / cs));
    const gx1 = Math.min(this.world.width - 1, Math.ceil((ox + radius) / cs));
    const gy1 = Math.min(this.world.height - 1, Math.ceil((oy + radius) / cs));
    const r2 = radius * radius;
    const corners = this.corners;
    corners.length = 0;

    // Corners are found on the half-size grid, so half-size blocks (Blight
    // sub-pixels, rubble, lab equipment) cast their own shadows. Whole-cell
    // vertices are always checked; the extra half-step vertices only inside
    // cells that hold half-size blocks.
    const addCorner = (vx: number, vy: number): void => {
      const s00 = world.subSolidAt(vx - 1, vy - 1) ? 1 : 0;
      const s10 = world.subSolidAt(vx, vy - 1) ? 1 : 0;
      const s01 = world.subSolidAt(vx - 1, vy) ? 1 : 0;
      const s11 = world.subSolidAt(vx, vy) ? 1 : 0;
      const sum = s00 + s10 + s01 + s11;
      // Only outer/inner corners (1 or 3 solid cells, or 2 diagonal cells) are silhouette vertices;
      // 0 (open air), 4 (interior solid), or 2 side-by-side (flat wall seam) need no corner ray.
      const isDiagonal = sum === 2 && s00 === s11;
      if (sum !== 1 && sum !== 3 && !isDiagonal) return;
      const dx = vx * ss - ox;
      const dy = vy * ss - oy;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2 || d2 < 1e-6) return;
      corners.push({ angle: Math.atan2(dy, dx), dist2: d2 });
    };
    for (let gy = gy0; gy <= gy1; gy++) {
      const dy = gy * cs - oy;
      if (dy * dy > r2) continue;
      for (let gx = gx0; gx <= gx1; gx++) addCorner(gx * 2, gy * 2);
    }
    const W = world.width;
    for (let cy = gy0 - 1; cy <= gy1; cy++) {
      if (cy < 0 || cy >= world.height) continue;
      for (let cx = gx0 - 1; cx <= gx1; cx++) {
        if (cx < 0 || cx >= W || world.health[cy * W + cx] > 0 || !world.anySolidInCell(cx, cy)) continue;
        const vx = cx * 2;
        const vy = cy * 2;
        addCorner(vx + 1, vy + 1);
        addCorner(vx + 1, vy);
        addCorner(vx, vy + 1);
        // The far edges' midpoints belong to the neighbor too; skip them if it is mixed as well.
        if (cx + 1 >= W || world.health[cy * W + cx + 1] > 0 || !world.anySolidInCell(cx + 1, cy)) addCorner(vx + 2, vy + 1);
        if (cy + 1 >= world.height || world.health[(cy + 1) * W + cx] > 0 || !world.anySolidInCell(cx, cy + 1)) addCorner(vx + 1, vy + 2);
      }
    }

    // Nearest corners first if over budget, leaving room for soldier tangents so the
    // sorted ray fan is never truncated.
    const soldierRays = Math.min(soldiers.length * 4, maxVerts >>> 2);
    const maxCorners = Math.floor(Math.min(maxCornerRays, maxVerts - n - soldierRays) / 2);
    if (corners.length > maxCorners) {
      corners.sort((a, b) => a.dist2 - b.dist2);
      corners.length = maxCorners;
    }
    const eps = LIGHT.cornerEpsilon;
    for (let i = 0; i < corners.length; i++) {
      const a = corners[i].angle;
      angles[n++] = normalizeAngle(a - eps);
      angles[n++] = normalizeAngle(a + eps);
    }

    // 4) Silhouette rays to nearby soldiers (excluding the shooter). Round soldiers
    //    use circle tangents; shaped soldiers use the outermost corners of their
    //    rotated outline, so their shadows turn with them.
    const occR = SOLDIER.occluderRadius;
    const occScale = occR / SOLDIER.renderRadius;
    const occ = this.occluders;
    let occN = 0;
    for (let i = 0; i < soldiers.length; i++) {
      const s = soldiers[i];
      if (!s.alive || s.id === ownerId) continue;
      const dx = s.x - ox;
      const dy = s.y - oy;
      const dist = Math.hypot(dx, dy);
      if (dist <= occR + 0.2 || dist > radius + occR * 1.5) continue;
      const o = occ[occN] ?? (occ[occN] = { x: 0, y: 0, n: 0, poly: new Float32Array(16) });
      occN++;
      o.x = s.x;
      o.y = s.y;
      o.n = shapeOccluder(SOLDIER_SHAPES[soldierShapeIndex(s.slotIndex)], s.x, s.y, s.facingAngle, occScale, o.poly);
      if (n + 4 > maxVerts) continue;
      const centerAng = Math.atan2(dy, dx);
      let lo: number;
      let hi: number;
      if (o.n === 0) {
        const half = Math.asin(Math.min(0.9999, occR / dist));
        lo = centerAng - half;
        hi = centerAng + half;
      } else {
        lo = Infinity;
        hi = -Infinity;
        for (let v = 0; v < o.n; v++) {
          const rel = normalizeAngle(Math.atan2(o.poly[v * 2 + 1] - oy, o.poly[v * 2] - ox) - centerAng);
          if (rel < lo) lo = rel;
          if (rel > hi) hi = rel;
        }
        lo += centerAng;
        hi += centerAng;
      }
      angles[n++] = normalizeAngle(lo - eps);
      angles[n++] = normalizeAngle(lo + eps);
      angles[n++] = normalizeAngle(hi - eps);
      angles[n++] = normalizeAngle(hi + eps);
    }

    // Sort ray angles in ascending order.
    angles.subarray(0, n).sort();

    // Trace each ray against the terrain grid and occluding soldiers.
    for (let k = 0; k < n; k++) {
      const ang = angles[k];
      const rdx = Math.cos(ang);
      const rdy = Math.sin(ang);

      let bestT = radius;
      let hitTerrain = false;
      if (gridRaycast(world.subSolidQuery, ss, ox, oy, rdx, rdy, radius, rayHit)) {
        bestT = rayHit.t;
        hitTerrain = true;
      }

      // Check soldier occluders (circles or rotated outlines).
      for (let j = 0; j < occN; j++) {
        const o = occ[j];
        const ct = o.n === 0
          ? rayCircleDistance(ox, oy, rdx, rdy, o.x, o.y, occR)
          : rayPolygonDistance(ox, oy, rdx, rdy, o.poly, o.n);
        if (ct < bestT) {
          bestT = ct;
          hitTerrain = false;
        }
      }

      // Air light stops at the wall face; the small overdraw is cut by the terrain mask.
      const finalT = hitTerrain ? Math.min(radius, bestT + LIGHT.faceOverdraw) : bestT;
      outPoly[k * 2] = ox + rdx * finalT;
      outPoly[k * 2 + 1] = oy + rdy * finalT;
    }

    if (outLit) this.markLitCells(ox, oy, outPoly, n, outLit);
    this.lastRaysCast += n;
    return n;
  }

  /**
   * List the wall cells the light reaches by walking the polygon's perimeter: it
   * runs just inside every visible wall face and crosses only air everywhere else.
   * Wall light is applied to whole cells, so it follows the grid, not the polygon.
   */
  private markLitCells(ox: number, oy: number, poly: Float32Array, n: number, out: LitCells): void {
    const step = this.world.cellSize * 0.5;
    if (++this.litStamp === 0xffffffff) {
      this.litStamps.fill(0);
      this.litStamp = 1;
    }
    let ax = poly[(n - 1) * 2];
    let ay = poly[(n - 1) * 2 + 1];
    for (let i = 0; i < n; i++) {
      const bx = poly[i * 2];
      const by = poly[i * 2 + 1];
      const steps = Math.ceil(Math.hypot(bx - ax, by - ay) / step);
      for (let k = 1; k <= steps; k++) {
        const f = k / steps;
        const px = ax + (bx - ax) * f;
        const py = ay + (by - ay) * f;
        // At grazing angles the perimeter can sit on the face itself, so also look
        // slightly further from the light along each axis.
        this.markCellAt(px, py, out);
        this.markCellAt(px + (px > ox ? 1 : -1), py, out);
        this.markCellAt(px, py + (py > oy ? 1 : -1), out);
      }
      ax = bx;
      ay = by;
    }
  }

  private markCellAt(x: number, y: number, out: LitCells): void {
    const w = this.world;
    const cx = Math.floor(x / w.cellSize);
    const cy = Math.floor(y / w.cellSize);
    if (!w.inBounds(cx, cy)) return;
    const i = cy * w.width + cx;
    if (this.litStamps[i] === this.litStamp || (w.health[i] === 0 && !w.anySolidInCell(cx, cy))) return;
    this.litStamps[i] = this.litStamp;
    if (out.count < out.cells.length) out.cells[out.count++] = i;
  }
}

function normalizeAngle(a: number): number {
  while (a <= -Math.PI) a += Math.PI * 2;
  while (a > Math.PI) a -= Math.PI * 2;
  return a;
}
