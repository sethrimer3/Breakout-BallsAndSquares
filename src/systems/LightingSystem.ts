import { LIGHT, SOLDIER } from "../config";
import { gridRaycast, makeRayHit } from "../core/gridRaycast";
import type { Soldier } from "../entities/Soldier";
import type { CameraSystem } from "./CameraSystem";
import type { PixelWorld } from "../world/PixelWorld";

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

/** Faint always-on glow (soldier self-light or the spawn room). */
export interface SoftLight {
  x: number;
  y: number;
  radius: number;
  strength: number;
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
    poly: new Float32Array(LIGHT.maxRays * 2),
    polyCount: 0,
    lit: makeLitCells(),
  };
}

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
  /** Per-cell stamp so `markLitCells` lists each cell once per light. */
  private litStamps: Uint32Array;
  private litStamp = 0;

  constructor(private world: PixelWorld) {
    this.litStamps = new Uint32Array(world.width * world.height);
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
    extraLights?: readonly { x: number; y: number; radius: number; strength: number }[],
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
        this.addSoftLight(el.x, el.y, el.radius, el.strength, -2, soldiers, cam);
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
  ): void {
    const idx = this.softCount++;
    const l = this.softLights[idx] ?? (this.softLights[idx] = makeSoftLight());
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
    for (let i = 0; i < 16 && this.world.solidAt(Math.floor(ox / cs), Math.floor(oy / cs)); i++) {
      ox -= dirX;
      oy -= dirY;
    }
    if (this.world.solidAt(Math.floor(ox / cs), Math.floor(oy / cs))) return 0;

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

    for (let gy = gy0; gy <= gy1; gy++) {
      const wy = gy * cs;
      const dy = wy - oy;
      const dy2 = dy * dy;
      if (dy2 > r2) continue;
      for (let gx = gx0; gx <= gx1; gx++) {
        // Check the 2x2 neighborhood around grid vertex (gx, gy).
        const s00 = this.world.solidAt(gx - 1, gy - 1) ? 1 : 0;
        const s10 = this.world.solidAt(gx, gy - 1) ? 1 : 0;
        const s01 = this.world.solidAt(gx - 1, gy) ? 1 : 0;
        const s11 = this.world.solidAt(gx, gy) ? 1 : 0;
        const sum = s00 + s10 + s01 + s11;
        // Only outer/inner corners (1 or 3 solid cells, or 2 diagonal cells) are silhouette vertices;
        // 0 (open air), 4 (interior solid), or 2 side-by-side (flat wall seam) need no corner ray.
        const isDiagonal = sum === 2 && s00 === s11;
        if (sum !== 1 && sum !== 3 && !isDiagonal) continue;
        const wx = gx * cs;
        const dx = wx - ox;
        const d2 = dx * dx + dy2;
        if (d2 > r2 || d2 < 1e-6) continue;
        corners.push({ angle: Math.atan2(dy, dx), dist2: d2 });
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

    // 4) Tangent rays to nearby soldier balls (excluding the shooter).
    const occR = SOLDIER.occluderRadius;
    for (let i = 0; i < soldiers.length && n + 4 <= maxVerts; i++) {
      const s = soldiers[i];
      if (!s.alive || s.id === ownerId) continue;
      const dx = s.x - ox;
      const dy = s.y - oy;
      const dist = Math.hypot(dx, dy);
      if (dist <= occR + 0.2 || dist > radius + occR) continue;
      const centerAng = Math.atan2(dy, dx);
      const half = Math.asin(Math.min(0.9999, occR / dist));
      angles[n++] = normalizeAngle(centerAng - half - eps);
      angles[n++] = normalizeAngle(centerAng - half + eps);
      angles[n++] = normalizeAngle(centerAng + half - eps);
      angles[n++] = normalizeAngle(centerAng + half + eps);
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
      if (gridRaycast(this.world, cs, ox, oy, rdx, rdy, radius, rayHit)) {
        bestT = rayHit.t;
        hitTerrain = true;
      }

      // Check soldier circle occluders.
      for (let j = 0; j < soldiers.length; j++) {
        const s = soldiers[j];
        if (!s.alive || s.id === ownerId) continue;
        const ct = rayCircleDistance(ox, oy, rdx, rdy, s.x, s.y, occR);
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
    if (w.health[i] === 0 || this.litStamps[i] === this.litStamp) return;
    this.litStamps[i] = this.litStamp;
    if (out.count < out.cells.length) out.cells[out.count++] = i;
  }
}

function normalizeAngle(a: number): number {
  while (a <= -Math.PI) a += Math.PI * 2;
  while (a > Math.PI) a -= Math.PI * 2;
  return a;
}
