import { ASSAULT_RIFLE, BULLET, ROCKET_LAUNCHER, SNIPER_RIFLE } from "../config";
import { DEG } from "../core/math";
import { gridRaycast, makeRayHit } from "../core/gridRaycast";
import type { Rng } from "../core/Rng";
import { BulletPool, type Bullet } from "../entities/Bullet";
import type { Soldier, SoldierStats } from "../entities/Soldier";
import type { PixelWorld } from "../world/PixelWorld";

export interface CombatEvents {
  /** A soldier fired (once per trigger pull). */
  onShot?(s: Soldier, dirX: number, dirY: number, muzzleX: number, muzzleY: number): void;
  /** A bullet or explosion damaged/destroyed terrain. result: 1 damaged, 2 destroyed, 0 border. */
  onImpact?(
    x: number,
    y: number,
    nx: number,
    ny: number,
    cx: number,
    cy: number,
    result: 0 | 1 | 2,
  ): void;
  /** A rocket or cluster bomb detonated at (x, y) with radius (world units). */
  onExplosion?(x: number, y: number, radiusWorld: number): void;
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

  /** Tick a soldier's weapon according to its equipped weapon type. */
  updateSoldier(s: Soldier, dt: number): void {
    s.fireCooldown -= dt;
    let rate = this.stats.fireRate;
    switch (s.weapon) {
      case "shotgun":
        rate = this.stats.shotgunFireRate;
        break;
      case "assault_rifle":
        rate = this.stats.arFireRate;
        break;
      case "rocket_launcher":
        rate = this.stats.rocketFireRate;
        break;
      case "sniper_rifle":
        rate = this.stats.sniperFireRate;
        break;
    }
    rate *= this.stats.globalFireRateMult;
    const interval = 1 / Math.max(0.05, rate);
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

    if (s.weapon === "shotgun") {
      const n = Math.max(1, this.stats.shotgunPellets);
      const halfSpreadRad = this.stats.shotgunSpreadDeg * DEG;
      for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;
        const jitter = this.rng.range(-0.18, 0.18) * halfSpreadRad;
        const a = t * halfSpreadRad + jitter;
        const c = Math.cos(a);
        const sn = Math.sin(a);
        const spd = this.stats.shotgunBulletSpeed * this.rng.range(0.92, 1.08);
        this.spawnBullet(
          s.x,
          s.y,
          dx * c - dy * sn,
          dx * sn + dy * c,
          spd,
          this.stats.shotgunDamage,
          this.stats.shotgunLifetime,
          s.radius + BULLET.muzzleGap,
          s.id,
          0,
          0,
          0,
          0,
        );
      }
    } else if (s.weapon === "assault_rifle") {
      const halfSpreadRad = this.stats.arSpreadDeg * DEG;
      const a = this.rng.range(-halfSpreadRad, halfSpreadRad);
      const c = Math.cos(a);
      const sn = Math.sin(a);
      this.spawnBullet(
        s.x,
        s.y,
        dx * c - dy * sn,
        dx * sn + dy * c,
        this.stats.arBulletSpeed,
        this.stats.arDamage,
        ASSAULT_RIFLE.lifetime,
        s.radius + BULLET.muzzleGap,
        s.id,
        this.stats.arPierce,
        0,
        0,
        0,
      );
    } else if (s.weapon === "rocket_launcher") {
      this.spawnBullet(
        s.x,
        s.y,
        dx,
        dy,
        this.stats.rocketBulletSpeed,
        this.stats.rocketDamage,
        ROCKET_LAUNCHER.lifetime,
        s.radius + BULLET.muzzleGap,
        s.id,
        0,
        this.stats.rocketBlastRadius,
        this.stats.rocketClusterCount,
        1,
      );
    } else if (s.weapon === "sniper_rifle") {
      const isCrit = this.stats.sniperCritChance > 0 && this.rng.next() < this.stats.sniperCritChance;
      const dmg = isCrit ? this.stats.sniperDamage * 2 : this.stats.sniperDamage;
      this.spawnBullet(
        s.x,
        s.y,
        dx,
        dy,
        this.stats.sniperBulletSpeed,
        dmg,
        SNIPER_RIFLE.lifetime,
        s.radius + BULLET.muzzleGap,
        s.id,
        this.stats.sniperPierce,
        0,
        0,
        2,
      );
    } else {
      // Pistol
      this.spawnBullet(
        s.x,
        s.y,
        dx,
        dy,
        this.stats.bulletSpeed,
        this.stats.damage,
        BULLET.lifetime,
        s.radius + BULLET.muzzleGap,
        s.id,
        0,
        0,
        0,
        0,
      );
      if (this.stats.multishotChance > 0 && this.rng.next() < this.stats.multishotChance) {
        const pairs = Math.max(1, Math.floor(BULLET.multishotExtra / 2));
        for (let p = 1; p <= pairs; p++) {
          const a = BULLET.multishotSpreadDeg * DEG * p;
          for (const sign of [-1, 1]) {
            const c = Math.cos(a * sign);
            const sn = Math.sin(a * sign);
            this.spawnBullet(
              s.x,
              s.y,
              dx * c - dy * sn,
              dx * sn + dy * c,
              this.stats.bulletSpeed,
              this.stats.damage,
              BULLET.lifetime,
              s.radius + BULLET.muzzleGap,
              s.id,
              0,
              0,
              0,
              0,
            );
          }
        }
      }
    }
    const off = s.radius + BULLET.muzzleGap;
    this.events.onShot?.(s, dx, dy, s.x + dx * off, s.y + dy * off);
  }

  private spawnBullet(
    x: number,
    y: number,
    dx: number,
    dy: number,
    speed: number,
    damage: number,
    life: number,
    pendingAdvance: number,
    ownerId: number,
    pierceLeft: number,
    explosionRadius: number,
    clusterCount: number,
    style: 0 | 1 | 2,
  ): void {
    const b = this.bullets.acquire();
    if (!b) return;
    b.x = x;
    b.y = y;
    b.dx = dx;
    b.dy = dy;
    b.speed = speed * this.stats.globalBulletSpeedMult;
    b.damage = damage + this.stats.globalDamageBonus;
    b.life = life;
    b.traveled = 0;
    b.pendingAdvance = pendingAdvance;
    b.ownerId = ownerId;
    b.pierceLeft = pierceLeft;
    b.explosionRadius = explosionRadius;
    b.clusterCount = clusterCount;
    b.style = style;
  }

  updateBullets(dt: number): void {
    const items = this.bullets.items;
    for (let i = 0; i < items.length; i++) {
      const b = items[i];
      if (b.active) this.updateBullet(b, dt);
    }
  }

  /** Swept bullet update: supports multi-block pierce and explosive detonation. */
  updateBullet(b: Bullet, dt: number): void {
    b.life -= dt;
    if (b.life <= 0) {
      if (b.explosionRadius > 0) {
        this.detonateRocket(b, b.x, b.y, -b.dx, -b.dy, Math.floor(b.x / this.world.cellSize), Math.floor(b.y / this.world.cellSize));
      }
      this.bullets.release(b);
      return;
    }

    let remDist = b.speed * dt + b.pendingAdvance;
    b.pendingAdvance = 0;
    const cs = this.world.cellSize;
    let curX = b.x;
    let curY = b.y;
    let guard = 0;

    while (remDist > 1e-4 && guard++ < 8) {
      if (gridRaycast(this.world, cs, curX, curY, b.dx, b.dy, remDist, hit)) {
        // Rocket / explosive projectile detonates on impact!
        if (b.explosionRadius > 0) {
          this.detonateRocket(b, hit.x, hit.y, hit.nx, hit.ny, hit.cx, hit.cy);
          this.bullets.release(b);
          return;
        }

        const isCore = this.world.coreId[hit.cy * this.world.width + hit.cx] > 0;
        const hitDmg = b.damage + (isCore ? this.stats.coreDamageBonus : 0);
        const result = this.world.damage(hit.cx, hit.cy, hitDmg);
        this.events.onImpact?.(hit.x, hit.y, hit.nx, hit.ny, hit.cx, hit.cy, result);

        // If the bullet hit the indestructible world border (result === 0) or has no pierce left, stop.
        if (result === 0 || b.pierceLeft <= 0) {
          this.bullets.release(b);
          return;
        }

        // Pierce! Step past the impacted cell and continue along the ray.
        b.pierceLeft--;
        const stepPast = Math.max(0.5, hit.t + cs * 0.65);
        b.traveled += stepPast;
        remDist -= stepPast;
        curX += b.dx * stepPast;
        curY += b.dy * stepPast;
        if (!this.world.inBounds(Math.floor(curX / cs), Math.floor(curY / cs))) {
          this.bullets.release(b);
          return;
        }
        continue;
      }

      // No hit along the remaining segment.
      curX = hit.x;
      curY = hit.y;
      b.traveled += remDist;
      break;
    }

    b.x = curX;
    b.y = curY;
  }

  private detonateRocket(
    b: Bullet,
    ix: number,
    iy: number,
    nx: number,
    ny: number,
    centerCx: number,
    centerCy: number,
  ): void {
    const w = this.world;
    const cs = w.cellSize;
    const radCells = b.explosionRadius;
    const rCeil = Math.ceil(radCells);
    const r2 = radCells * radCells;

    for (let dy = -rCeil; dy <= rCeil; dy++) {
      const cy = centerCy + dy;
      if (cy < 0 || cy >= w.height) continue;
      for (let dx = -rCeil; dx <= rCeil; dx++) {
        const cx = centerCx + dx;
        if (cx < 0 || cx >= w.width) continue;
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        // Full damage near epicenter, tapering slightly at outer blast edge.
        const falloff = 1 - 0.35 * (Math.sqrt(d2) / Math.max(1, radCells));
        const isCore = w.coreId[cy * w.width + cx] > 0;
        const dmg = Math.max(1, Math.round(b.damage * falloff)) + (isCore ? this.stats.coreDamageBonus : 0);
        const res = w.damage(cx, cy, dmg);
        if (res > 0) {
          const wx = (cx + 0.5) * cs;
          const wy = (cy + 0.5) * cs;
          this.events.onImpact?.(wx, wy, nx, ny, cx, cy, res);
        }
      }
    }

    this.events.onExplosion?.(ix, iy, radCells * cs);

    // Spawn secondary cluster mini-bombs if upgraded.
    if (b.clusterCount > 0) {
      const baseAng = Math.atan2(ny || -b.dy, nx || -b.dx);
      for (let i = 0; i < b.clusterCount; i++) {
        const a = baseAng + this.rng.range(-1.2, 1.2);
        const spd = this.rng.range(110, 195);
        this.spawnBullet(
          ix + (nx || 0) * 2,
          iy + (ny || 0) * 2,
          Math.cos(a),
          Math.sin(a),
          spd,
          Math.max(1, Math.ceil(b.damage * 0.5)),
          this.rng.range(0.18, 0.32),
          0,
          b.ownerId,
          0,
          Math.max(1.4, radCells * 0.55),
          0,
          1,
        );
      }
    }
  }
}
