import { PRISM } from "../config";
import { gridRaycast, makeRayHit } from "../core/gridRaycast";
import { FixedPool } from "../core/FixedPool";
import type { Soldier, SoldierStats } from "../entities/Soldier";
import { MAT, type PixelWorld } from "../world/PixelWorld";

export class LaserSegment {
  active = false;
  x1 = 0; y1 = 0; x2 = 0; y2 = 0;
  band = 0; life = 0; reflected = false;
}
export interface LaserEvents {
  onImpact(x: number, y: number, nx: number, ny: number, cx: number, cy: number,
    result: 0 | 1 | 2, sub: boolean, ownerId: number): void;
  onBounce?(x: number, y: number, band: number): void;
  onOverload?(x: number, y: number): void;
  /** Returns true when a creature consumes this segment before terrain. */
  hitCreature?(x: number, y: number, dx: number, dy: number, distance: number, damage: number): number;
}

export class LaserSystem {
  readonly segments = new FixedPool(PRISM.segmentPoolSize, () => new LaserSegment());
  private readonly hit = makeRayHit();
  private readonly visited = new Set<number>();
  private shotSegments = 0;
  shots = 0; bounces = 0; hits = 0; droppedSegments = 0;
  lastHits = 0; lastBounces = 0; lastDistance = 0;
  constructor(private world: PixelWorld, private events: LaserEvents) {}

  traceShot(s: Soldier, dx: number, dy: number, stats: SoldierStats): void {
    const length = Math.hypot(dx, dy);
    if (!Number.isFinite(length) || length < 1e-6) return;
    dx /= length; dy /= length;
    let x = s.x; let y = s.y;
    let remaining = Math.min(PRISM.maxDistance, Math.max(0, stats.prismDistance));
    let bounces = 0; let hits = 0; let pierce = 0;
    const maxBounces = Math.min(PRISM.maxBounces, Math.max(0, stats.prismBounces));
    const base = stats.prismDamage + stats.globalDamageBonus + s.mods.damageBonus;
    this.visited.clear(); this.shotSegments = 0; this.shots++;
    const initialDistance = remaining;
    for (let guard = 0; guard < 64 && remaining > 1e-6 && hits < PRISM.maxHits; guard++) {
      const band = Math.min(6, Math.max(0, Math.floor(stats.prismSpectrum)) + bounces);
      const damage = Math.max(1, Math.round(base * Math.min(6, 1 + stats.prismGain * bounces)));
      const hit = this.hit;
      const collided = gridRaycast(this.world.subSolidQuery, this.world.subCellSize, x, y, dx, dy, remaining, hit);
      const distance = collided ? hit.t : remaining;
      const creature = this.events.hitCreature?.(x, y, dx, dy, distance, damage) ?? -1;
      if (creature >= 0) {
        this.segment(x, y, x + dx * creature, y + dy * creature, band, false);
        remaining -= creature; break;
      }
      this.segment(x, y, hit.x, hit.y, band, collided);
      remaining -= distance;
      if (!collided || !this.world.subInBounds(hit.cx, hit.cy)) break; // Boundaries absorb lasers.
      const cx = hit.cx >> 1; const cy = hit.cy >> 1;
      const index = cy * this.world.width + cx;
      const sub = this.world.health[index] === 0;
      const key = sub ? this.world.width * this.world.height + hit.cy * this.world.subWidth + hit.cx : index;
      const penetrable = this.world.mat[index] !== MAT.door;
      // Snapshot all surface information before callbacks can destroy/open it.
      const hx = hit.x; const hy = hit.y; const nx = hit.nx; const ny = hit.ny;
      if (!this.visited.has(key)) {
        this.visited.add(key); hits++;
        let dealt = damage + s.mods.terrainDamageBonus + (this.world.coreId[index] > 0 ? stats.coreDamageBonus : 0);
        if (this.world.isBlightAt(cx, cy)) dealt = Math.round(dealt * s.mods.blightMult);
        const result = this.world.damageSub(hit.cx, hit.cy, dealt, true);
        this.events.onImpact(hx, hy, nx, ny, cx, cy, result, sub, s.id);
      }
      if (hits >= PRISM.maxHits) break;
      if (pierce > 0 && penetrable) {
        pierce--;
        const size = sub ? this.world.subCellSize : this.world.cellSize;
        const gx = sub ? hit.cx : cx; const gy = sub ? hit.cy : cy;
        const tx = Math.abs(dx) > 1e-9 ? (((dx > 0 ? gx + 1 : gx) * size) - hx) / dx : Infinity;
        const ty = Math.abs(dy) > 1e-9 ? (((dy > 0 ? gy + 1 : gy) * size) - hy) / dy : Infinity;
        const exit = Math.max(1e-3, Math.min(tx >= 0 ? tx : Infinity, ty >= 0 ? ty : Infinity) + 1e-3);
        const advance = Math.min(remaining, exit);
        x = hx + dx * advance; y = hy + dy * advance;
        this.segment(hx, hy, x, y, band, false);
        remaining -= advance;
        continue;
      }
      if (bounces >= maxBounces) break;
      bounces++;
      pierce = Math.min(PRISM.maxHits, pierce + stats.prismShear);
      const dot = dx * nx + dy * ny;
      dx -= 2 * dot * nx; dy -= 2 * dot * ny;
      x = hx + nx * 1e-3; y = hy + ny * 1e-3;
      remaining = Math.max(0, remaining - 1e-3);
      this.events.onBounce?.(hx, hy, Math.min(6, band + 1));
      if (stats.prismOverload && Math.min(6,band+1) >= 6 && bounces === maxBounces) this.events.onOverload?.(hx, hy);
    }
    this.hits += hits; this.bounces += bounces;
    this.lastHits = hits; this.lastBounces = bounces; this.lastDistance = initialDistance - remaining;
  }

  private segment(x1: number, y1: number, x2: number, y2: number, band: number, reflected: boolean): void {
    if (Math.hypot(x2 - x1, y2 - y1) < 1e-6) return;
    if (this.shotSegments++ >= PRISM.maxSegments) { this.droppedSegments++; return; }
    const segment = this.segments.acquire();
    if (!segment) { this.droppedSegments++; return; }
    segment.x1 = x1; segment.y1 = y1; segment.x2 = x2; segment.y2 = y2;
    segment.band = band; segment.reflected = reflected; segment.life = PRISM.visualLife;
  }

  update(dt: number): void {
    // The ray is never traced again while its visual fades.
    for (const segment of this.segments.items) if (segment.active) {
      segment.life -= dt;
      if (segment.life <= 0) this.segments.release(segment);
    }
  }
  clear(): void {
    this.segments.clear(); this.visited.clear();
    this.shots = this.bounces = this.hits = this.droppedSegments = 0;
    this.lastHits = this.lastBounces = this.lastDistance = 0;
  }
}
