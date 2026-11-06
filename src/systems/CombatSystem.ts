import { ASSAULT_RIFLE, BULLET, GRENADE, KATANA, ROCKET_LAUNCHER, SNIPER_RIFLE } from "../config";
import { DEG } from "../core/math";
import { gridRaycast, makeRayHit } from "../core/gridRaycast";
import type { Rng } from "../core/Rng";
import { BulletPool, type Bullet } from "../entities/Bullet";
import type { Soldier, SoldierStats } from "../entities/Soldier";
import { StickyGrenadePool, type StickyGrenade } from "../entities/StickyGrenade";
import type { PixelWorld } from "../world/PixelWorld";

export interface CombatEvents {
  /** A soldier fired (once per trigger pull). */
  onShot?(s: Soldier, dirX: number, dirY: number, muzzleX: number, muzzleY: number): void;
  /** A bullet or explosion damaged/destroyed terrain. result: 1 damaged, 2 destroyed, 0 border. `sub`: hit a 50% pink sub-pixel in cell (cx, cy). */
  onImpact?(
    x: number,
    y: number,
    nx: number,
    ny: number,
    cx: number,
    cy: number,
    result: 0 | 1 | 2,
    sub?: boolean,
    ownerId?: number,
  ): void;
  /** A rocket or cluster bomb detonated at (x, y) with radius (world units). */
  onExplosion?(x: number, y: number, radiusWorld: number): void;
  /** A sticky grenade was thrown. */
  onGrenadeThrow?(s: Soldier, x: number, y: number, dx: number, dy: number): void;
  /** A sticky grenade stuck to a surface. */
  onGrenadeStick?(x: number, y: number, nx: number, ny: number): void;
  /** A sticky grenade beeped during fuse countdown. */
  onGrenadeBeep?(x: number, y: number, pct: number): void;
}

const hit = makeRayHit();

export class CombatSystem {
  readonly bullets = new BulletPool(BULLET.poolSize);
  readonly grenades = new StickyGrenadePool(GRENADE.poolSize);
  stats: SoldierStats;
  /** The soldier firing right now, whose own tree shapes the shots they spawn. */
  private shooter: Soldier | null = null;

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
    if (s.isManual) return; // Driven by player control in Game.step

    if (s.behavior === "sentry_slow") {
      s.facingAngle += (Math.PI / 3) * dt;
    } else if (s.behavior === "sentry_fast") {
      s.facingAngle += (4 * Math.PI / 3) * dt;
    }

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
      case "katana":
        rate = this.stats.katanaFireRate;
        break;
    }
    rate *= this.stats.globalFireRateMult * s.mods.fireRateMult;
    const interval = 1 / Math.max(0.05, rate);
    let guard = 0;
    while (s.fireCooldown <= 0 && guard++ < 8) {
      this.fire(s);
      if (s.mods.twinChance > 0 && this.rng.next() < s.mods.twinChance) this.fire(s);
      s.fireCooldown += interval;
    }
  }

  /** Fire along the soldier's current velocity, aim direction, or explicit vector. */
  fire(s: Soldier, overrideDx?: number, overrideDy?: number): void {
    let dx = 0;
    let dy = 0;
    if (overrideDx !== undefined && overrideDy !== undefined) {
      const len = Math.hypot(overrideDx, overrideDy);
      if (len > 1e-6) {
        dx = overrideDx / len;
        dy = overrideDy / len;
      }
    }
    if (dx === 0 && dy === 0) {
      const vlen = Math.hypot(s.vx, s.vy);
      if (vlen > 1e-6) {
        dx = s.vx / vlen;
        dy = s.vy / vlen;
      } else if (Number.isFinite(s.facingAngle)) {
        dx = Math.cos(s.facingAngle);
        dy = Math.sin(s.facingAngle);
      }
    }
    if (dx === 0 && dy === 0) return;
    s.facingAngle = Math.atan2(dy, dx);
    this.shooter = s;

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
    } else if (s.weapon === "katana") {
      s.slashIndex = ((s.slashIndex ?? 0) + 1) % 2;
      const tilt = (s.slashIndex === 0 ? -1 : 1) * 0.38;

      this.spawnSlash(
        s.x,
        s.y,
        dx,
        dy,
        this.stats.katanaBulletSpeed,
        this.stats.katanaDamage,
        KATANA.lifetime,
        s.radius + BULLET.muzzleGap,
        s.id,
        this.stats.katanaPierce,
        this.stats.katanaBlightMultiplier,
        this.stats.katanaSlashWidth,
        tilt,
      );

      // Multishot: fire a cross-slash in the opposite direction!
      if (this.stats.multishotChance > 0 && this.rng.next() < this.stats.multishotChance) {
        this.spawnSlash(
          s.x,
          s.y,
          dx,
          dy,
          this.stats.katanaBulletSpeed,
          this.stats.katanaDamage,
          KATANA.lifetime,
          s.radius + BULLET.muzzleGap,
          s.id,
          this.stats.katanaPierce,
          this.stats.katanaBlightMultiplier,
          this.stats.katanaSlashWidth,
          -tilt,
        );
      }
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
    this.shooter = null;
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
    style: 0 | 1 | 2 | 3,
  ): void {
    const b = this.bullets.acquire();
    if (!b) return;
    b.x = x;
    b.y = y;
    b.dx = dx;
    b.dy = dy;
    const mods = this.shooter?.mods;
    b.speed = speed * this.stats.globalBulletSpeedMult;
    b.damage = damage + this.stats.globalDamageBonus + (mods?.damageBonus ?? 0);
    b.life = life;
    b.maxLife = life;
    b.traveled = 0;
    b.pendingAdvance = pendingAdvance;
    b.ownerId = ownerId;
    b.pierceLeft = pierceLeft + (explosionRadius > 0 ? 0 : (mods?.pierce ?? 0));
    b.explosionRadius = explosionRadius;
    b.clusterCount = clusterCount;
    b.style = style;
    b.blightMultiplier = mods?.blightMult ?? 1;
    b.slashWidth = 0;
    b.slashAngle = 0;
  }

  private spawnSlash(
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
    blightMultiplier: number,
    slashWidth: number,
    slashAngle: number,
  ): void {
    const b = this.bullets.acquire();
    if (!b) return;
    b.x = x;
    b.y = y;
    b.dx = dx;
    b.dy = dy;
    const mods = this.shooter?.mods;
    b.speed = speed * this.stats.globalBulletSpeedMult;
    b.damage = damage + this.stats.globalDamageBonus + (mods?.damageBonus ?? 0);
    b.life = life;
    b.maxLife = life;
    b.traveled = 0;
    b.pendingAdvance = pendingAdvance;
    b.ownerId = ownerId;
    b.pierceLeft = pierceLeft + (mods?.pierce ?? 0);
    b.explosionRadius = 0;
    b.clusterCount = 0;
    b.style = 3;
    b.blightMultiplier = blightMultiplier * (mods?.blightMult ?? 1);
    b.slashWidth = slashWidth;
    b.slashAngle = slashAngle;
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
    const w = this.world;
    const cs = w.cellSize;
    const ss = w.subCellSize;
    let curX = b.x;
    let curY = b.y;
    let guard = 0;

    while (remDist > 1e-4 && guard++ < 8) {
      // Fine-grid traversal: sees normal cells and 50% pink sub-pixels alike.
      if (gridRaycast(w.subSolidQuery, ss, curX, curY, b.dx, b.dy, remDist, hit)) {
        const hcx = hit.cx >> 1;
        const hcy = hit.cy >> 1;
        // Rocket / explosive projectile detonates on impact!
        if (b.explosionRadius > 0) {
          this.detonateRocket(b, hit.x, hit.y, hit.nx, hit.ny, hcx, hcy);
          this.bullets.release(b);
          return;
        }

        const inside = w.inBounds(hcx, hcy);
        const cellIdx = hcy * w.width + hcx;
        const isSub = inside && w.health[cellIdx] === 0;
        const isCore = inside && !isSub && w.coreId[cellIdx] > 0;
        const isBlight = isSub ? w.isBlightSubAt(hit.cx, hit.cy) : w.isBlightAt(hcx, hcy);
        let hitDmg = b.damage + (isCore ? this.stats.coreDamageBonus : 0);
        if (isBlight && b.blightMultiplier > 1) {
          hitDmg = Math.round(hitDmg * b.blightMultiplier);
        }
        const result = w.damageSub(hit.cx, hit.cy, hitDmg);
        this.events.onImpact?.(hit.x, hit.y, hit.nx, hit.ny, hcx, hcy, result, isSub, b.ownerId);

        // Katana slashes cleave adjacent subcells across the slash arc width!
        if (b.style === 3 && b.slashWidth > 0) {
          this.cleaveSlashSides(b, hit.cx, hit.cy, hit.nx, hit.ny);
        }

        // If the bullet hit the indestructible world border (result === 0) or has no pierce left, stop.
        if (result === 0 || b.pierceLeft <= 0) {
          this.bullets.release(b);
          return;
        }

        // Pierce! Step past the impacted cell and continue along the ray.
        b.pierceLeft--;
        const S = isSub ? ss : cs;
        const targetX = isSub ? hit.cx : hcx;
        const targetY = isSub ? hit.cy : hcy;

        let distToExit = hit.t + S * 1.05;
        if (Math.abs(b.dx) > 1e-6) {
          const exitX = (b.dx > 0 ? targetX + 1 : targetX) * S;
          const tx = (exitX - curX) / b.dx;
          if (tx > hit.t) distToExit = Math.min(distToExit, tx + 0.5);
        }
        if (Math.abs(b.dy) > 1e-6) {
          const exitY = (b.dy > 0 ? targetY + 1 : targetY) * S;
          const ty = (exitY - curY) / b.dy;
          if (ty > hit.t) distToExit = Math.min(distToExit, ty + 0.5);
        }

        const stepPast = Math.max(0.5, distToExit);
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

  /** Cleave adjacent cells across the katana slash arc width. */
  private cleaveSlashSides(
    b: Bullet,
    hitSubX: number,
    hitSubY: number,
    nx: number,
    ny: number,
  ): void {
    const w = this.world;
    const ss = w.subCellSize;
    // Perpendicular vector to projectile direction: (-dy, dx)
    const px = -b.dy;
    const py = b.dx;
    const maxSteps = Math.min(2, Math.max(1, Math.floor(b.slashWidth / (ss * 2))));
    const centerNormIdx = (hitSubY >> 1) * w.width + (hitSubX >> 1);
    let cleavedNormIdx = -1;

    for (let step = 1; step <= maxSteps; step++) {
      for (const sign of [-1, 1]) {
        const sx = hitSubX + Math.round(px * step * sign);
        const sy = hitSubY + Math.round(py * step * sign);
        if (!w.subInBounds(sx, sy)) continue;
        if (!w.subSolidAt(sx, sy)) continue;

        const hcx = sx >> 1;
        const hcy = sy >> 1;
        const inside = w.inBounds(hcx, hcy);
        if (!inside) continue;
        const cellIdx = hcy * w.width + hcx;

        // If this is a normal solid cell, don't re-damage the center cell or a cell already cleaved this strike
        const isSub = w.health[cellIdx] === 0;
        if (!isSub) {
          if (cellIdx === centerNormIdx || cellIdx === cleavedNormIdx) continue;
          cleavedNormIdx = cellIdx;
        }

        const isCore = !isSub && w.coreId[cellIdx] > 0;
        const isBlight = isSub ? w.isBlightSubAt(sx, sy) : w.isBlightAt(hcx, hcy);

        let dmg = b.damage + (isCore ? this.stats.coreDamageBonus : 0);
        if (isBlight && b.blightMultiplier > 1) {
          dmg = Math.round(dmg * b.blightMultiplier);
        }
        const res = w.damageSub(sx, sy, dmg);
        if (res > 0) {
          const wx = (sx + 0.5) * ss;
          const wy = (sy + 0.5) * ss;
          this.events.onImpact?.(wx, wy, nx, ny, hcx, hcy, res, isSub, b.ownerId);
        }
      }
    }
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
        const idx = cy * w.width + cx;
        const wasSub = w.health[idx] === 0;
        const isCore = !wasSub && w.coreId[idx] > 0;
        let dmg = Math.max(1, Math.round(b.damage * falloff)) + (isCore ? this.stats.coreDamageBonus : 0);
        if (b.blightMultiplier > 1 && w.isBlightAt(cx, cy)) dmg = Math.round(dmg * b.blightMultiplier);
        const res = w.damage(cx, cy, dmg);
        if (res > 0) {
          const wx = (cx + 0.5) * cs;
          const wy = (cy + 0.5) * cs;
          this.events.onImpact?.(wx, wy, nx, ny, cx, cy, res, wasSub, b.ownerId);
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

  /** Throw an equippable secondary sticky grenade from a soldier. */
  throwGrenade(
    s: Soldier,
    blastRadius: number,
    damage: number,
    shrapnelCount: number,
    blightMult: number,
    overrideDx?: number,
    overrideDy?: number,
  ): StickyGrenade | null {
    let dx = 0;
    let dy = 0;
    if (overrideDx !== undefined && overrideDy !== undefined) {
      const len = Math.hypot(overrideDx, overrideDy);
      if (len > 1e-6) {
        dx = overrideDx / len;
        dy = overrideDy / len;
      }
    }
    if (dx === 0 && dy === 0) {
      const vlen = Math.hypot(s.vx, s.vy);
      if (vlen > 1e-6) {
        dx = s.vx / vlen;
        dy = s.vy / vlen;
      } else if (Number.isFinite(s.facingAngle)) {
        dx = Math.cos(s.facingAngle);
        dy = Math.sin(s.facingAngle);
      } else {
        dx = 0;
        dy = 1;
      }
    }

    const g = this.grenades.acquire();
    if (!g) return null;
    g.x = s.x + dx * 6;
    g.y = s.y + dy * 6;
    g.dx = dx;
    g.dy = dy;
    g.speed = GRENADE.throwSpeed;
    g.stuck = false;
    g.stuckCx = 0;
    g.stuckCy = 0;
    g.stuckNx = 0;
    g.stuckNy = 0;
    g.fuse = GRENADE.fuseSeconds;
    g.maxFuse = GRENADE.fuseSeconds;
    g.radiusCells = blastRadius;
    g.damage = damage + this.stats.globalDamageBonus;
    g.shrapnelCount = shrapnelCount;
    g.blightMultiplier = blightMult;
    g.ownerId = s.id;
    g.age = 0;
    g.beepTimer = 0.25;
    g.rotation = Math.atan2(dy, dx);
    this.events.onGrenadeThrow?.(s, g.x, g.y, dx, dy);
    return g;
  }

  /** Update all active flying and stuck grenades. */
  updateGrenades(dt: number): void {
    const items = this.grenades.items;
    const w = this.world;
    const cs = w.cellSize;
    const ss = w.subCellSize;

    for (let i = 0; i < items.length; i++) {
      const g = items[i];
      if (!g.active) continue;

      g.age += dt;

      if (!g.stuck) {
        g.rotation += 10 * dt;
        const dist = g.speed * dt;
        if (gridRaycast(w.subSolidQuery, ss, g.x, g.y, g.dx, g.dy, dist, hit)) {
          g.stuck = true;
          g.x = hit.x;
          g.y = hit.y;
          g.stuckNx = hit.nx;
          g.stuckNy = hit.ny;
          g.stuckCx = hit.cx >> 1;
          g.stuckCy = hit.cy >> 1;
          g.fuse = g.maxFuse;
          g.beepTimer = 0.2;
          this.events.onGrenadeStick?.(g.x, g.y, g.stuckNx, g.stuckNy);
        } else {
          g.x += g.dx * dist;
          g.y += g.dy * dist;
          if (g.age > 2.5 || !w.inBounds(Math.floor(g.x / cs), Math.floor(g.y / cs))) {
            this.detonateGrenade(g);
          }
        }
      } else {
        g.fuse -= dt;
        g.beepTimer -= dt;
        if (g.beepTimer <= 0) {
          g.beepTimer = Math.max(0.08, g.fuse * 0.35);
          this.events.onGrenadeBeep?.(g.x, g.y, Math.max(0, g.fuse / g.maxFuse));
        }

        const inside = w.inBounds(g.stuckCx, g.stuckCy);
        const cellIdx = g.stuckCy * w.width + g.stuckCx;
        if (inside && w.health[cellIdx] === 0 && w.subHealth[cellIdx] === 0) {
          this.detonateGrenade(g);
        } else if (g.fuse <= 0) {
          this.detonateGrenade(g);
        }
      }
    }
  }

  /** Detonate a sticky grenade, creating explosive damage and secondary shrapnel. */
  detonateGrenade(g: StickyGrenade): void {
    const w = this.world;
    const cs = w.cellSize;
    const centerCx = Math.floor(g.x / cs);
    const centerCy = Math.floor(g.y / cs);
    const radCells = g.radiusCells;
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

        const falloff = 1 - 0.3 * (Math.sqrt(d2) / Math.max(1, radCells));
        const idx = cy * w.width + cx;
        const wasSub = w.health[idx] === 0;
        const isCore = !wasSub && w.coreId[idx] > 0;
        const isBlight = wasSub ? w.isBlightSubAt(cx * 2, cy * 2) : w.isBlightAt(cx, cy);

        let dmg = Math.max(1, Math.round(g.damage * falloff)) + (isCore ? this.stats.coreDamageBonus : 0);
        if (isBlight && g.blightMultiplier > 1) {
          dmg = Math.round(dmg * g.blightMultiplier);
        }

        const res = w.damage(cx, cy, dmg);
        if (res > 0) {
          const wx = (cx + 0.5) * cs;
          const wy = (cy + 0.5) * cs;
          this.events.onImpact?.(wx, wy, g.stuckNx || 0, g.stuckNy || -1, cx, cy, res, wasSub, g.ownerId);
        }
      }
    }

    this.events.onExplosion?.(g.x, g.y, radCells * cs);

    // Expel shrapnel fragments if upgraded
    if (g.shrapnelCount > 0) {
      const baseAng = Math.atan2(g.stuckNy || -g.dy, g.stuckNx || -g.dx);
      for (let i = 0; i < g.shrapnelCount; i++) {
        const a = baseAng + this.rng.range(-1.4, 1.4);
        const spd = this.rng.range(130, 220);
        this.spawnBullet(
          g.x + (g.stuckNx || 0) * 2,
          g.y + (g.stuckNy || 0) * 2,
          Math.cos(a),
          Math.sin(a),
          spd,
          Math.max(1, Math.ceil(g.damage * 0.4)),
          this.rng.range(0.25, 0.45),
          0,
          g.ownerId,
          0,
          0,
          0,
          0,
        );
      }
    }

    this.grenades.release(g);
  }
}
