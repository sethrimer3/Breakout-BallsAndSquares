import { visibleRoomLightIndices } from "../rendering/RoomLightIndex";
import { fogRegionVisible } from "../rendering/fogRegionVisible";
import type { FogOfWar } from "../world/FogOfWar";
import { FACILITY, LIGHT, SOLDIER } from "../config";
import { gridRaycast, makeRayHit } from "../core/gridRaycast";
import type { Soldier } from "../entities/Soldier";
import { SOLDIER_SHAPES, rayPolygonDistance, shapeOccluder, soldierShapeIndex } from "../entities/soldierShapes";
import type { CameraSystem } from "./CameraSystem";
import type { SubPixelPhysics } from "./SubPixelPhysics";
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
  /** Optional per-cell illumination weight in [0..1] (e.g. wall depth attenuation). */
  weights?: Float32Array;
}

export function makeLitCells(withWeights = false): LitCells {
  return {
    cells: new Int32Array(LIGHT.maxLitCells),
    count: 0,
    ...(withWeights ? { weights: new Float32Array(LIGHT.maxLitCells) } : {}),
  };
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
    lit: makeLitCells(true),
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

/**
 * Computes 2D visibility polygons for active muzzle flashes.
 * Combines evenly spaced base rays, forward-cone rays, silhouette-corner
 * grazing rays (Rev 2), and soldier-circle tangent rays (Rev 2).
 *
 * Polygons stop at wall faces and describe light in open air. Light on walls is
 * resolved per cell (see `markLitCells`) so it can never cut across the grid.
 */
const MAX_SUB_OCCLUDERS = 32;

function rayAabbDistance(
  ox: number,
  oy: number,
  rdx: number,
  rdy: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): number {
  const invX = rdx !== 0 ? 1 / rdx : 1e12;
  const invY = rdy !== 0 ? 1 / rdy : 1e12;
  const t1 = (minX - ox) * invX;
  const t2 = (maxX - ox) * invX;
  const t3 = (minY - oy) * invY;
  const t4 = (maxY - oy) * invY;
  const tmin = Math.max(Math.min(t1, t2), Math.min(t3, t4));
  const tmax = Math.min(Math.max(t1, t2), Math.max(t3, t4));
  if (tmax < 0 || tmin > tmax) return Infinity;
  return tmin >= 0 ? tmin : tmax;
}

export class LightingSystem {
  quality: LightQuality = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches ? "medium" : "high";
  /** Telemetry from the most recent frame. */
  lastRaysCast = 0;
  lastShadowLights = 0;
  lastComputeMs = 0;

  /** Soldier / room glows for the current frame (index 0 is the room). */
  softLights: SoftLight[] = [];
  softCount = 0;
  /** Active soldier flashlight radius, strength, and wall penetration depth. */
  soldierLightRadius = LIGHT.soldierLightRadius;
  soldierLightStrength = LIGHT.soldierLightStrength;
  soldierWallDepth = 1;

  private angles = new Float64Array(LIGHT.maxRays);
  /** Reusable typed buffers for silhouette corners (avoids thousands of per-frame object allocations). */
  private cornerAngles = new Float64Array(2048);
  private cornerDist2 = new Float64Array(2048);
  private cornerOrder = new Int32Array(2048);
  /** Soldier occluders gathered for the current trace. */
  private occluders: { x: number; y: number; n: number; poly: Float32Array; minAngle: number; maxAngle: number }[] = [];
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
  subPixels: SubPixelPhysics | null = null;
  private readonly subOccX = new Float32Array(MAX_SUB_OCCLUDERS);
  private readonly subOccY = new Float32Array(MAX_SUB_OCCLUDERS);
  private readonly subOccMinA = new Float32Array(MAX_SUB_OCCLUDERS);
  private readonly subOccMaxA = new Float32Array(MAX_SUB_OCCLUDERS);

  /** Monotonic counter bumped on non-damage terrain changes for static-light polygon caching. */
  private terrainGeoRev = 0;
  private roomCache: {
    x: number;
    y: number;
    radius: number;
    quality: LightQuality;
    rev: number;
    polyCount: number;
    litCount: number;
  } | null = null;

  constructor(private world: PixelWorld) {
    this.litStamps = new Uint32Array(world.width * world.height);
    world.addListener((cx, cy, kind) => {
      if (kind !== "damaged") {
        this.terrainGeoRev++;
        this.invalidateFixtures(cx, cy);
      }
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

  /** Mark any ceiling fixtures overlapping active moving 0.5 pixels dirty so their shadows update. */
  invalidateMovingSubPixels(): void {
    const sp = this.subPixels;
    if (!sp || sp.count === 0 || this.fixtureBuckets.length === 0) return;
    const cs = this.world.cellSize;
    const bucketUnits = this.fixtureBucketCells * cs;
    const columns = Math.ceil(this.world.width / this.fixtureBucketCells);
    for (let i = 0; i < sp.count; i++) {
      const px = sp.x[i];
      const py = sp.y[i];
      const bx = Math.floor(px / bucketUnits);
      const by = Math.floor(py / bucketUnits);
      const bucket = this.fixtureBuckets[by * columns + bx];
      if (!bucket) continue;
      for (let k = 0; k < bucket.length; k++) {
        const f = bucket[k];
        if (f.dirty) continue;
        const r = f.radius + cs;
        if (Math.abs(f.x - px) < r && Math.abs(f.y - py) < r) f.dirty = true;
      }
    }
  }

  /**
   * Trace light and shadow for the ceiling panels near the view: up to
   * `FACILITY.panelTracesPerFrame` stale ones a frame, nearest first in list order.
   */
  retracedLastUpdate = 0;

  updateFixtures(cam: CameraSystem, fog?: FogOfWar): void {
    this.retracedLastUpdate = 0;
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
    for (const fixtureId of visibleRoomLightIndices(w, cam)) {
      const f = this.fixtures[fixtureId];
      if (budget <= 0) break;
      if (!f || f.light.destroyed || !f.dirty || f.x < x0 || f.x > x1 || f.y < y0 || f.y > y1) continue;
      if (fog && !fogRegionVisible(fog, f.x - f.radius, f.y - f.radius, f.x + f.radius, f.y + f.radius)) continue;
      budget--;
      f.dirty = false;
      this.retracedLastUpdate++;
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
        s.x, s.y, this.soldierLightRadius, this.soldierLightStrength, s.id, soldiers, cam,
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
    // Cache the static spawn-room glow when terrain hasn't changed, no moving
    // sub-pixels exist, and no living soldier is inside its occlusion radius.
    if (ownerId === -1 && (!this.subPixels || this.subPixels.count === 0)) {
      const occBound = radius + SOLDIER.occluderRadius * 1.5;
      const occBound2 = occBound * occBound;
      let clearOfSoldiers = true;
      for (let i = 0; i < soldiers.length; i++) {
        const s = soldiers[i];
        if (!s.alive) continue;
        const dx = s.x - x, dy = s.y - y;
        if (dx * dx + dy * dy <= occBound2) { clearOfSoldiers = false; break; }
      }
      const rc = this.roomCache;
      if (clearOfSoldiers && rc && rc.x === x && rc.y === y && rc.radius === radius &&
          rc.quality === this.quality && rc.rev === this.terrainGeoRev) {
        l.polyCount = rc.polyCount;
        l.lit.count = rc.litCount;
        return;
      }
      l.polyCount = this.trace(
        x, y, 1, 0, radius, ownerId, soldiers, l.poly, l.lit,
        LIGHT.softBaseRays, 0, this.preset.maxCornerRays, 1,
      );
      this.roomCache = clearOfSoldiers
        ? { x, y, radius, quality: this.quality, rev: this.terrainGeoRev, polyCount: l.polyCount, litCount: l.lit.count }
        : null;
      return;
    }
    l.polyCount = this.trace(
      x, y, 1, 0, radius, ownerId, soldiers, l.poly, l.lit,
      LIGHT.softBaseRays, 0, this.preset.maxCornerRays,
      ownerId >= 0 ? this.soldierWallDepth : 1,
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
    wallDepth = 1,
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
    let cornerAngles = this.cornerAngles;
    let cornerDist2 = this.cornerDist2;
    let cornerCount = 0;

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
      if (cornerCount >= cornerAngles.length) {
        const nextLen = cornerAngles.length * 2;
        const na = new Float64Array(nextLen);
        const nd = new Float64Array(nextLen);
        na.set(cornerAngles);
        nd.set(cornerDist2);
        this.cornerAngles = cornerAngles = na;
        this.cornerDist2 = cornerDist2 = nd;
        this.cornerOrder = new Int32Array(nextLen);
      }
      cornerAngles[cornerCount] = Math.atan2(dy, dx);
      cornerDist2[cornerCount] = d2;
      cornerCount++;
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
    const eps = LIGHT.cornerEpsilon;
    if (cornerCount > maxCorners) {
      const order = this.cornerOrder;
      for (let i = 0; i < cornerCount; i++) order[i] = i;
      order.subarray(0, cornerCount).sort((a, b) => cornerDist2[a] - cornerDist2[b]);
      for (let i = 0; i < maxCorners; i++) {
        const a = cornerAngles[order[i]];
        angles[n++] = normalizeAngle(a - eps);
        angles[n++] = normalizeAngle(a + eps);
      }
    } else {
      for (let i = 0; i < cornerCount; i++) {
        const a = cornerAngles[i];
        angles[n++] = normalizeAngle(a - eps);
        angles[n++] = normalizeAngle(a + eps);
      }
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
      const o = occ[occN] ?? (occ[occN] = { x: 0, y: 0, n: 0, poly: new Float32Array(16), minAngle: -Math.PI, maxAngle: Math.PI });
      occN++;
      o.x = s.x;
      o.y = s.y;
      o.n = shapeOccluder(SOLDIER_SHAPES[soldierShapeIndex(s.slotIndex)], s.x, s.y, s.facingAngle, occScale, o.poly);
      // Keep exact intersection tests as the fallback if the ray budget leaves
      // no room to calculate this occluder's silhouette rays.
      o.minAngle = -Math.PI;
      o.maxAngle = Math.PI;
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
      if (hi - lo < Math.PI) {
        o.minAngle = normalizeAngle(lo - eps);
        o.maxAngle = normalizeAngle(hi + eps);
      }
      angles[n++] = normalizeAngle(lo - eps);
      angles[n++] = normalizeAngle(lo + eps);
      angles[n++] = normalizeAngle(hi - eps);
      angles[n++] = normalizeAngle(hi + eps);
    }

    // 4b) Silhouette rays for active moving 0.5 pixels within light radius.
    let subOccN = 0;
    const hs = ss * 0.5;
    const sp = this.subPixels;
    if (sp && sp.count > 0) {
      const maxR = radius + ss;
      const maxR2 = maxR * maxR;
      const minD = hs * 1.45;
      for (let i = 0; i < sp.count && subOccN < MAX_SUB_OCCLUDERS; i++) {
        const px = sp.x[i];
        const py = sp.y[i];
        const dx = px - ox;
        const dy = py - oy;
        const d2 = dx * dx + dy * dy;
        if (d2 > maxR2 || d2 <= minD * minD) continue;
        const dist = Math.sqrt(d2);
        const centerAng = Math.atan2(dy, dx);
        const half = Math.asin(Math.min(0.9999, (hs * 1.414) / dist));
        const lo = normalizeAngle(centerAng - half - eps);
        const hi = normalizeAngle(centerAng + half + eps);
        const idx = subOccN++;
        this.subOccX[idx] = px;
        this.subOccY[idx] = py;
        this.subOccMinA[idx] = lo;
        this.subOccMaxA[idx] = hi;
        if (n + 2 <= maxVerts) {
          angles[n++] = lo;
          angles[n++] = hi;
        }
      }
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
        if (!angleInShadowSpan(ang, o.minAngle, o.maxAngle)) continue;
        const ct = o.n === 0
          ? rayCircleDistance(ox, oy, rdx, rdy, o.x, o.y, occR)
          : rayPolygonDistance(ox, oy, rdx, rdy, o.poly, o.n);
        if (ct < bestT) {
          bestT = ct;
          hitTerrain = false;
        }
      }

      // Check active moving 0.5-pixel occluders.
      for (let j = 0; j < subOccN; j++) {
        if (!angleInShadowSpan(ang, this.subOccMinA[j], this.subOccMaxA[j])) continue;
        const px = this.subOccX[j];
        const py = this.subOccY[j];
        const bt = rayAabbDistance(ox, oy, rdx, rdy, px - hs, py - hs, px + hs, py + hs);
        if (bt < bestT) {
          bestT = bt;
          hitTerrain = true;
        }
      }

      // Air light stops at the wall face; the small overdraw is cut by the terrain mask.
      const finalT = hitTerrain ? Math.min(radius, bestT + LIGHT.faceOverdraw) : bestT;
      outPoly[k * 2] = ox + rdx * finalT;
      outPoly[k * 2 + 1] = oy + rdy * finalT;
    }

    if (outLit) this.markLitCells(ox, oy, outPoly, n, outLit, radius, wallDepth);
    this.lastRaysCast += n;
    return n;
  }

  /**
   * List the wall cells the light reaches by walking the polygon's perimeter: it
   * runs just inside every visible wall face and crosses only air everywhere else.
   * Wall light is applied to whole cells, so it follows the grid, not the polygon.
   */
  private markLitCells(
    ox: number,
    oy: number,
    poly: Float32Array,
    n: number,
    out: LitCells,
    radius: number,
    wallDepth = 1,
  ): void {
    const cs = this.world.cellSize;
    const step = cs * 0.5;
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
        const cx = Math.floor(px / cs), cy = Math.floor(py / cs);
        this.markCell(cx, cy, out);
        const adjacentX = Math.floor((px + (px > ox ? 1 : -1)) / cs);
        const adjacentY = Math.floor((py + (py > oy ? 1 : -1)) / cs);
        if (adjacentX !== cx) this.markCell(adjacentX, cy, out);
        if (adjacentY !== cy) this.markCell(cx, adjacentY, out);
      }
      ax = bx;
      ay = by;
    }
    if (wallDepth > 1 && out.weights) {
      this.expandLitWallDepth(ox, oy, radius, out, wallDepth);
    }
  }

  /**
   * Expand wall illumination inward from exposed surface cells (depth 1 = 100%)
   * by `maxDepth - 1` additional solid-block layers with decreasing weights.
   */
  private expandLitWallDepth(
    ox: number,
    oy: number,
    radius: number,
    out: LitCells,
    maxDepth: number,
  ): void {
    const w = this.world;
    const W = w.width;
    const cs = w.cellSize;
    const weights = out.weights!;
    const depthWeights = LIGHT.betterFlashlightWallWeights;
    const r2 = radius * radius;
    let layerStart = 0;
    let layerEnd = out.count;
    for (let depth = 2; depth <= maxDepth; depth++) {
      const weight = depth - 1 < depthWeights.length
        ? depthWeights[depth - 1]
        : depthWeights[depthWeights.length - 1];
      for (let i = layerStart; i < layerEnd; i++) {
        const cell = out.cells[i];
        const cx = cell % W;
        const cy = (cell - cx) / W;
        for (let d = 0; d < 4; d++) {
          const nx = d === 0 ? cx + 1 : d === 1 ? cx - 1 : cx;
          const ny = d === 2 ? cy + 1 : d === 3 ? cy - 1 : cy;
          if (!w.inBounds(nx, ny)) continue;
          const ni = ny * W + nx;
          if (this.litStamps[ni] === this.litStamp) continue;
          if (w.health[ni] === 0 && !w.anySolidInCell(nx, ny)) continue;
          const dx = (nx + 0.5) * cs - ox;
          const dy = (ny + 0.5) * cs - oy;
          if (dx * dx + dy * dy >= r2) continue;
          this.litStamps[ni] = this.litStamp;
          if (out.count < out.cells.length) {
            out.cells[out.count] = ni;
            weights[out.count] = weight;
            out.count++;
          }
        }
      }
      layerStart = layerEnd;
      layerEnd = out.count;
      if (layerStart === layerEnd) break;
    }
  }

  private markCell(cx: number, cy: number, out: LitCells): void {
    const w = this.world;
    if (!w.inBounds(cx, cy)) return;
    const i = cy * w.width + cx;
    if (this.litStamps[i] === this.litStamp) return;
    // Empty cells are also stable for the duration of this synchronous trace.
    this.litStamps[i] = this.litStamp;
    if (w.health[i] === 0 && !w.anySolidInCell(cx, cy)) return;
    if (out.count < out.cells.length) {
      if (out.weights) out.weights[out.count] = 1;
      out.cells[out.count++] = i;
    }
  }
}

function normalizeAngle(a: number): number {
  while (a <= -Math.PI) a += Math.PI * 2;
  while (a > Math.PI) a -= Math.PI * 2;
  return a;
}

/** Conservative angular broad phase; normalized bounds may cross the ±π seam. */
export function angleInShadowSpan(angle: number, lo: number, hi: number): boolean {
  return lo <= hi ? angle >= lo && angle <= hi : angle >= lo || angle <= hi;
}
