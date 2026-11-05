import { LIGHT, SOLDIER } from "../config";
import { gridRaycast, makeRayHit } from "../core/gridRaycast";
import type { Soldier } from "../entities/Soldier";
import type { PixelWorld } from "../world/PixelWorld";

export type LightQuality = "high" | "medium" | "low";

export interface QualityPreset {
  baseRays: number;
  coneRays: number;
  maxCornerRays: number;
  maxShadowLights: number;
  halfResLightmap: boolean;
}

export const QUALITY_PRESETS: Record<LightQuality, QualityPreset> = {
  high: {
    baseRays: LIGHT.baseRays,
    coneRays: LIGHT.coneRays,
    maxCornerRays: LIGHT.maxCornerRays,
    maxShadowLights: LIGHT.maxShadowLights,
    halfResLightmap: false,
  },
  medium: {
    baseRays: 80,
    coneRays: 12,
    maxCornerRays: 220,
    maxShadowLights: 16,
    halfResLightmap: false,
  },
  low: {
    baseRays: 64,
    coneRays: 8,
    maxCornerRays: 120,
    maxShadowLights: 10,
    halfResLightmap: true,
  },
};

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
 */
export class LightingSystem {
  quality: LightQuality = "high";
  /** Telemetry from the most recent frame. */
  lastRaysCast = 0;
  lastShadowLights = 0;
  lastComputeMs = 0;

  private angles = new Float64Array(1024);
  private order = new Int32Array(1024);
  private corners: CornerCand[] = [];

  constructor(private world: PixelWorld) {}

  get preset(): QualityPreset {
    return QUALITY_PRESETS[this.quality];
  }

  /**
   * Build the visibility polygon for one light at `(ox, oy)` firing along `(dirX, dirY)`.
   * Writes vertices into `outPoly` (must have length >= 2 * maxRays) and returns vertex count.
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
  ): number {
    const preset = this.preset;
    const angles = this.angles;
    let n = 0;

    // 1) Evenly spaced base rays around the full 360°.
    const baseN = preset.baseRays;
    for (let i = 0; i < baseN; i++) {
      angles[n++] = (i / baseN) * Math.PI * 2 - Math.PI;
    }

    // 2) Extra rays inside +/-30° of the firing direction for a crisp forward cone.
    const fireAng = Math.atan2(dirY, dirX);
    const coneN = preset.coneRays;
    const halfCone = Math.PI / 6;
    for (let i = 0; i < coneN; i++) {
      const f = (i / Math.max(1, coneN - 1)) * 2 - 1;
      angles[n++] = normalizeAngle(fireAng + f * halfCone);
    }

    // 3) Silhouette corners of solid terrain cells within the light radius (Rev 2).
    const cs = this.world.cellSize;
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

    // Nearest corners first if over budget.
    const maxCorners = Math.floor(preset.maxCornerRays / 2);
    if (corners.length > maxCorners) {
      corners.sort((a, b) => a.dist2 - b.dist2);
      corners.length = maxCorners;
    }
    const eps = LIGHT.cornerEpsilon;
    for (let i = 0; i < corners.length && n + 2 <= angles.length; i++) {
      const a = corners[i].angle;
      angles[n++] = normalizeAngle(a - eps);
      angles[n++] = normalizeAngle(a + eps);
    }

    // 4) Tangent rays to nearby soldier balls (excluding the shooter).
    const occR = SOLDIER.occluderRadius;
    for (let i = 0; i < soldiers.length && n + 4 <= angles.length; i++) {
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
    const order = this.order;
    for (let i = 0; i < n; i++) order[i] = i;
    const sub = order.subarray(0, n);
    sub.sort((a, b) => angles[a] - angles[b]);

    // Trace each ray against the terrain grid and occluding soldiers.
    const maxVerts = Math.min(n, outPoly.length >>> 1);
    for (let k = 0; k < maxVerts; k++) {
      const ang = angles[sub[k]];
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

      // Extend terrain hits slightly into the hit cell so the lit wall face receives light.
      const finalT = hitTerrain ? Math.min(radius, bestT + LIGHT.wallPenetration) : bestT;
      outPoly[k * 2] = ox + rdx * finalT;
      outPoly[k * 2 + 1] = oy + rdy * finalT;
    }

    this.lastRaysCast += maxVerts;
    return maxVerts;
  }
}

function normalizeAngle(a: number): number {
  while (a <= -Math.PI) a += Math.PI * 2;
  while (a > Math.PI) a -= Math.PI * 2;
  return a;
}
