import { BULLET } from "../config";
import { DEG } from "../core/math";
import { gridRaycast, makeRayHit } from "../core/gridRaycast";
import type { Rng } from "../core/Rng";
import { BulletPool, type Bullet } from "../entities/Bullet";
import type { Soldier, SoldierStats } from "../entities/Soldier";
import type { PixelWorld } from "../world/PixelWorld";

export interface CombatEvents {
  /** A soldier fired (once per trigger pull, even with multishot). */
  onShot?(s: Soldier, dirX: number, dirY: number, muzzleX: number, muzzleY: number): void;
  /** A bullet hit terrain. result: 1 damaged, 2 destroyed, 0 border/indestructible. */
  onImpact?(
    x: number,
    y: number,
    nx: number,
    ny: number,
    cx: number,
    cy: number,
    result: 0 | 1 | 2,
  ): void;
}

const hit = makeRayHit();

export class CombatSystem {
  readonly bullets = new BulletPool(BULLET.poolSize);
  stats: SoldierStats;

  constructor(
    private world: PixelWorld,
    private rng: Rng,
    stats: SoldierStats,
    private events: CombatEvents = {},
  ) {
    this.stats = stats;
  }

  /** Tick a soldier's weapon. */
  updateSoldier(s: Soldier, dt: number): void {
    s.fireCooldown -= dt;
    const interval = 1 / this.stats.fireRate;
    let guard = 0;
    while (s.fireCooldown <= 0 && guard++ < 8) {
      this.fire(s);
      s.fireCooldown += interval;
    }
  }

  /** Fire along the soldier's current velocity. */
  fire(s: Soldier): void {
    const len = Math.hypot(s.vx, s.vy);
    if (len < 1e-6) return;
    const dx = s.vx / len;
    const dy = s.vy / len;
    this.spawnBullet(s, dx, dy);
    if (this.stats.multishotChance > 0 && this.rng.next() < this.stats.multishotChance) {
      const pairs = Math.max(1, Math.floor(BULLET.multishotExtra / 2));
      for (let p = 1; p <= pairs; p++) {
        const a = BULLET.multishotSpreadDeg * DEG * p;
        for (const sign of [-1, 1]) {
          const c = Math.cos(a * sign);
          const sn = Math.sin(a * sign);
          this.spawnBullet(s, dx * c - dy * sn, dx * sn + dy * c);
        }
      }
    }
    const off = s.radius + BULLET.muzzleGap;
    this.events.onShot?.(s, dx, dy, s.x + dx * off, s.y + dy * off);
  }

  private spawnBullet(s: Soldier, dx: number, dy: number): void {
    const b = this.bullets.acquire();
    if (!b) return;
    b.x = s.x;
    b.y = s.y;
    b.dx = dx;
    b.dy = dy;
    b.speed = this.stats.bulletSpeed;
    b.damage = this.stats.damage;
    b.life = BULLET.lifetime;
    b.traveled = 0;
    b.pendingAdvance = s.radius + BULLET.muzzleGap;
    b.ownerId = s.id;
  }

  updateBullets(dt: number): void {
    const items = this.bullets.items;
    for (let i = 0; i < items.length; i++) {
      const b = items[i];
      if (b.active) this.updateBullet(b, dt);
    }
  }

  /** Swept bullet update: cast from current position over this step's travel. */
  updateBullet(b: Bullet, dt: number): void {
    b.life -= dt;
    if (b.life <= 0) {
      this.bullets.release(b);
      return;
    }
    const dist = b.speed * dt + b.pendingAdvance;
    b.pendingAdvance = 0;
    const cs = this.world.cellSize;
    if (gridRaycast(this.world, cs, b.x, b.y, b.dx, b.dy, dist, hit)) {
      const result = this.world.damage(hit.cx, hit.cy, b.damage);
      this.events.onImpact?.(hit.x, hit.y, hit.nx, hit.ny, hit.cx, hit.cy, result);
      this.bullets.release(b);
      return;
    }
    b.x = hit.x;
    b.y = hit.y;
    b.traveled += dist;
  }
}
