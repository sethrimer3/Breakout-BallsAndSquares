import { LOOT } from "../config";
import type { Rng } from "../core/Rng";
import type { Soldier } from "./Soldier";

export const LootKind = {
  Gold: 0,
  Crystal: 1,
} as const;
export type LootKind = (typeof LootKind)[keyof typeof LootKind];

/**
 * High-capacity Struct-of-Arrays (SoA) pool for glowing currency pickups
 * (Zone 1 golden squares, Zone 2+ glowing orange crystals).
 * Supports thousands of simultaneous pickups with zero per-frame allocations.
 */
export class LootSystem {
  readonly cap: number;
  count = 0;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly life: Float32Array;
  readonly maxLife: Float32Array;
  readonly kind: Uint8Array;

  /** Per-step collection counters populated by `update()`. */
  collectedGold = 0;
  collectedCrystals = 0;

  constructor(cap = LOOT.poolSize) {
    this.cap = cap;
    this.x = new Float32Array(cap);
    this.y = new Float32Array(cap);
    this.vx = new Float32Array(cap);
    this.vy = new Float32Array(cap);
    this.life = new Float32Array(cap);
    this.maxLife = new Float32Array(cap);
    this.kind = new Uint8Array(cap);
  }

  /**
   * Roll how many currency items drop for `dropChance` (e.g. 0.2 -> 20% for 1;
   * 1.5 -> 1 guaranteed + 50% for a 2nd; 2.25 -> 2 guaranteed + 25% for a 3rd)
   * and spawn them at `(x, y)`.
   */
  spawnDropsForBlock(
    x: number,
    y: number,
    dropChance: number,
    lifetime: number,
    rng: Rng,
    kind: LootKind = LootKind.Gold,
  ): number {
    let guaranteed = Math.floor(dropChance);
    const rem = dropChance - guaranteed;
    if (rem > 0 && rng.next() < rem) guaranteed++;
    for (let i = 0; i < guaranteed; i++) {
      this.spawnOne(x, y, lifetime, rng, kind);
    }
    return guaranteed;
  }

  spawnOne(
    x: number,
    y: number,
    lifetime: number,
    rng: Rng,
    kind: LootKind = LootKind.Gold,
  ): void {
    let i: number;
    if (this.count < this.cap) {
      i = this.count++;
    } else {
      i = rng.int(this.cap);
    }
    const a = rng.range(0, Math.PI * 2);
    const sp = rng.range(LOOT.minPopSpeed, LOOT.maxPopSpeed);
    this.x[i] = x + rng.range(-2.5, 2.5);
    this.y[i] = y + rng.range(-2.5, 2.5);
    this.vx[i] = Math.cos(a) * sp;
    this.vy[i] = Math.sin(a) * sp;
    this.life[i] = lifetime;
    this.maxLife[i] = lifetime;
    this.kind[i] = kind;
  }

  /**
   * Step all active pickups: apply drag, magnetically pull toward the nearest
   * living soldier within `magnetRange`, and collect pickups that reach
   * `LOOT.pickupRadius`. Returns the total number of pickups collected this step
   * (and populates `collectedGold` / `collectedCrystals`).
   */
  update(
    dt: number,
    soldiers: readonly Soldier[],
    magnetRange: number,
    onCollect?: (x: number, y: number, kind: LootKind) => void,
  ): number {
    this.collectedGold = 0;
    this.collectedCrystals = 0;
    if (this.count === 0) return 0;
    const damp = Math.exp(-LOOT.drag * dt);
    const magR2 = magnetRange * magnetRange;
    const pickR2 = LOOT.pickupRadius * LOOT.pickupRadius;
    const accel = LOOT.magnetAccel;
    const maxSpd2 = LOOT.magnetMaxSpeed * LOOT.magnetMaxSpeed;
    const nSoldiers = soldiers.length;

    let collected = 0;
    let i = 0;
    while (i < this.count) {
      const rem = (this.life[i] -= dt);
      if (rem <= 0) {
        this.removeAt(i);
        continue;
      }

      let px = this.x[i];
      let py = this.y[i];
      let vx = this.vx[i] * damp;
      let vy = this.vy[i] * damp;
      const k = this.kind[i] as LootKind;

      // Find closest living soldier within magnet range.
      let bestDist2 = magR2;
      let bestDx = 0;
      let bestDy = 0;
      let pickedUp = false;

      for (let sIdx = 0; sIdx < nSoldiers; sIdx++) {
        const s = soldiers[sIdx];
        if (!s.alive) continue;
        const dx = s.x - px;
        const dy = s.y - py;
        const d2 = dx * dx + dy * dy;
        if (d2 <= pickR2) {
          pickedUp = true;
          break;
        }
        if (d2 < bestDist2) {
          bestDist2 = d2;
          bestDx = dx;
          bestDy = dy;
        }
      }

      if (pickedUp) {
        collected++;
        if (k === LootKind.Crystal) this.collectedCrystals++;
        else this.collectedGold++;
        onCollect?.(px, py, k);
        this.removeAt(i);
        continue;
      }

      if (bestDist2 < magR2 && bestDist2 > 1e-6) {
        const dist = Math.sqrt(bestDist2);
        const inv = 1 / dist;
        // Stronger pull as the pickup gets closer to the soldier.
        const pull = accel * (1.15 - 0.65 * (dist / magnetRange));
        vx += bestDx * inv * pull * dt;
        vy += bestDy * inv * pull * dt;
        const sp2 = vx * vx + vy * vy;
        if (sp2 > maxSpd2) {
          const s = LOOT.magnetMaxSpeed / Math.sqrt(sp2);
          vx *= s;
          vy *= s;
        }
      }

      px += vx * dt;
      py += vy * dt;

      // Check post-move pickup so fast-moving magnetized pickups don't overshoot.
      for (let sIdx = 0; sIdx < nSoldiers; sIdx++) {
        const s = soldiers[sIdx];
        if (!s.alive) continue;
        const dx = s.x - px;
        const dy = s.y - py;
        if (dx * dx + dy * dy <= pickR2) {
          pickedUp = true;
          break;
        }
      }

      if (pickedUp) {
        collected++;
        if (k === LootKind.Crystal) this.collectedCrystals++;
        else this.collectedGold++;
        onCollect?.(px, py, k);
        this.removeAt(i);
        continue;
      }

      this.x[i] = px;
      this.y[i] = py;
      this.vx[i] = vx;
      this.vy[i] = vy;
      i++;
    }
    return collected;
  }

  private removeAt(i: number): void {
    const j = --this.count;
    if (i === j) return;
    this.x[i] = this.x[j];
    this.y[i] = this.y[j];
    this.vx[i] = this.vx[j];
    this.vy[i] = this.vy[j];
    this.life[i] = this.life[j];
    this.maxLife[i] = this.maxLife[j];
    this.kind[i] = this.kind[j];
  }

  clear(): void {
    this.count = 0;
    this.collectedGold = 0;
    this.collectedCrystals = 0;
  }
}
