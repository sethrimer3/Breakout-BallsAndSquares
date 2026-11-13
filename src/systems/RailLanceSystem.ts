import { RAIL } from "../config";
import { FixedPool } from "../core/FixedPool";
import { gridRaycast, makeRayHit } from "../core/gridRaycast";
import type { Soldier } from "../entities/Soldier";
import { MAT, type PixelWorld } from "../world/PixelWorld";
import type { BulletTargets } from "./CombatSystem";

export interface RailBeam {
  active: boolean;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  life: number;
  maxLife: number;
  crit: boolean;
}

const rayHit = makeRayHit();

/**
 * Rail Lance (Sniper Rifle branch 2):
 * Resolves one ultra-long, narrow, straight-line piercing strike on charge completion
 * and manages fading beam visuals without ever retracing during fade.
 */
export class RailLanceSystem {
  readonly beams = new FixedPool<RailBeam>(RAIL.beamPoolSize, () => ({
    active: false,
    x1: 0,
    y1: 0,
    x2: 0,
    y2: 0,
    life: 0,
    maxLife: RAIL.beamFadeTime,
    crit: false,
  }));

  totalStrikes = 0;
  totalHits = 0;

  constructor(private world: PixelWorld) {}

  clear(): void {
    this.beams.releaseAll();
  }

  update(dt: number): void {
    for (const b of this.beams.items) {
      if (!b.active) continue;
      b.life -= dt;
      if (b.life <= 0) this.beams.release(b);
    }
  }

  /**
   * Execute a single straight-line piercing strike from `(ox, oy)` along `(dx, dy)`.
   * No reflections, no Prism spectrum inheritance, stops at world borders and closed gates.
   */
  fireStrike(
    owner: Soldier,
    ox: number,
    oy: number,
    dx: number,
    dy: number,
    damage: number,
    pierceBudget: number,
    crit: boolean,
    targets: BulletTargets | null,
    onTerrainHit: (cx: number, cy: number, result: 0 | 1 | 2, sub: boolean, hx: number, hy: number, nx: number, ny: number, ownerId: number) => void,
    onCreatureHit: (hx: number, hy: number, nx: number, ny: number) => void,
  ): { endX: number; endY: number; hits: number } {
    this.totalStrikes++;
    const maxDist = RAIL.maxRange;
    let remainingDist = maxDist;
    let remainingHits = Math.max(1, pierceBudget + 1);
    let curX = ox;
    let curY = oy;
    let hits = 0;

    const hitCells = new Set<number>();
    const hitTargets = new Set<object>();
    const stepAdvance = 0.25;

    let guard = 0;
    while (remainingDist > 0.05 && remainingHits > 0 && guard++ < 128) {
      const tDist = targets ? targets.raycast(curX, curY, dx, dy, remainingDist, hitTargets) : -1;
      const wHit = gridRaycast(this.world, curX, curY, dx, dy, remainingDist, rayHit);
      const wDist = wHit ? rayHit.distance : -1;

      if (tDist >= 0 && (wDist < 0 || tDist <= wDist)) {
        const hx = curX + dx * tDist;
        const hy = curY + dy * tDist;
        if (targets?.targetKey) hitTargets.add(targets.targetKey);
        targets?.applyHit(damage, hx, hy);
        onCreatureHit(hx, hy, -dx, -dy);
        remainingHits--;
        hits++;
        this.totalHits++;
        const adv = tDist + stepAdvance;
        curX += dx * adv;
        curY += dy * adv;
        remainingDist -= adv;
        continue;
      }

      if (wHit) {
        const hx = rayHit.x;
        const hy = rayHit.y;
        const cx = rayHit.cellX;
        const cy = rayHit.cellY;

        // World boundary: stop immediately.
        if (!this.world.inBounds(cx, cy)) {
          curX = hx;
          curY = hy;
          break;
        }

        // Authoritative door/gate check.
        const ci = cy * this.world.width + cx;
        if (this.world.mat[ci] === MAT.door) {
          const door = this.world.doors[this.world.doorId[ci] - 1];
          if (door && !door.open) {
            this.world.damage(cx, cy, damage, true);
            if (!door.open) {
              // Gate or locked door remains closed: stop strike.
              curX = hx;
              curY = hy;
              onTerrainHit(cx, cy, 0, false, hx, hy, rayHit.normalX, rayHit.normalY, owner.id);
              break;
            }
          }
        }

        const key = rayHit.sub ? -(rayHit.subY * this.world.subWidth + rayHit.subX + 1) : ci + 1;
        if (!hitCells.has(key)) {
          hitCells.add(key);
          const isPink = rayHit.sub
            ? this.world.isPinkSub(rayHit.subY * this.world.subWidth + rayHit.subX)
            : this.world.blight[ci] > 0;
          const totalDmg = (damage + owner.mods.terrainDamageBonus) * (isPink ? owner.mods.blightMult : 1);
          const res = rayHit.sub
            ? this.world.damageSub(rayHit.subX, rayHit.subY, totalDmg, true)
            : this.world.damage(cx, cy, totalDmg, true);
          onTerrainHit(cx, cy, res, rayHit.sub, hx, hy, rayHit.normalX, rayHit.normalY, owner.id);
          remainingHits--;
          hits++;
          this.totalHits++;
        }

        const adv = Math.max(stepAdvance, rayHit.distance + stepAdvance);
        curX += dx * adv;
        curY += dy * adv;
        remainingDist -= adv;
        continue;
      }

      // Open air to max range.
      curX += dx * remainingDist;
      curY += dy * remainingDist;
      remainingDist = 0;
    }

    const beam = this.beams.acquire();
    if (beam) {
      beam.x1 = ox;
      beam.y1 = oy;
      beam.x2 = curX;
      beam.y2 = curY;
      beam.life = RAIL.beamFadeTime;
      beam.maxLife = RAIL.beamFadeTime;
      beam.crit = crit;
    }

    return { endX: curX, endY: curY, hits };
  }
}
