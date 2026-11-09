import { FIRE } from "../config";
import type { Rng } from "../core/Rng";
import type { Bullet } from "../entities/Bullet";
import { SUB, type PixelWorld } from "../world/PixelWorld";

/** Kinds of fire particle. */
export const FKind = {
  /** A lick of flame: hot, buoyant, cools from white-yellow to deep red. */
  Flame: 0,
  /** Dark smoke left behind by dying flames. */
  Smoke: 1,
  /** A tiny spark thrown off burning rubble. */
  Ember: 2,
} as const;

/** Burn state per rubble sub-pixel (`FireSystem.state`). */
export const BURN = { none: 0, burning: 1, charred: 2 } as const;

/** Tint of burnt-out rubble: the "char" palette entry (5) at low brightness (see CaveIns stoneTint). */
export const CHAR_TINT = (2 << 3) | 5;

/** A warm light from the fire this frame. */
export interface FireLight {
  x: number;
  y: number;
  radius: number;
  strength: number;
  warm: true;
}

/**
 * Fire: the flamethrower's pixel flames and rubble that catches and burns.
 *
 * Flames are a small particle sim on the world's pixel grid. They rise, drift
 * on a cheap turbulence field, and collide with terrain one axis at a time, so
 * fire hugs ceilings and spills sideways along floors and walls instead of
 * passing through them.
 *
 * Rubble hit by a flame burns for a few seconds, slowly catching its rubble
 * neighbors, and is left charred and crumbly. Burning rubble is grouped into
 * coarse bins that each give one warm, flickering light.
 */
export class FireSystem {
  readonly cap = FIRE.particleCap;
  count = 0;
  readonly x = new Float32Array(this.cap);
  readonly y = new Float32Array(this.cap);
  readonly vx = new Float32Array(this.cap);
  readonly vy = new Float32Array(this.cap);
  readonly life = new Float32Array(this.cap);
  readonly maxLife = new Float32Array(this.cap);
  /** 0..1 starting temperature: hotter flames start whiter and burn longer. */
  readonly heat = new Float32Array(this.cap);
  readonly kind = new Uint8Array(this.cap);
  /** Per-particle phase for the turbulence field. */
  readonly seed = new Float32Array(this.cap);

  /** Per-subcell burn state (`BURN`). */
  readonly state: Uint8Array;
  /** Subcell indices of burning rubble, `burnCount` long. */
  readonly burning: Int32Array;
  /** Seconds left to burn, parallel to `burning`. */
  readonly burnLeft: Float32Array;
  /** Total burn seconds, parallel to `burning`. */
  readonly burnTotal: Float32Array;
  burnCount = 0;

  /** Multiplier on burn duration (Kindling upgrade). */
  burnMult = 1;
  /** Called when a sub-pixel burns out, so the terrain can repaint it charred. */
  onChar: ((sx: number, sy: number) => void) | null = null;

  /** Warm lights from burning rubble and live nozzles, rebuilt by `collectLights`. */
  readonly lights: FireLight[] = [];
  private nozzles: { id: number; x: number; y: number; life: number }[] = [];
  private time = 0;
  private binKeys: number[] = [];
  private bins = new Map<number, { n: number; sx: number; sy: number; heat: number }>();

  constructor(
    private world: PixelWorld,
    private rng: Rng,
  ) {
    this.state = new Uint8Array(world.subWidth * world.subHeight);
    this.burning = new Int32Array(FIRE.maxBurning);
    this.burnLeft = new Float32Array(FIRE.maxBurning);
    this.burnTotal = new Float32Array(FIRE.maxBurning);
  }

  clear(): void {
    this.count = 0;
    this.burnCount = 0;
    this.state.fill(0);
    this.nozzles.length = 0;
    this.lights.length = 0;
  }

  /** True if subcell index `si` is burning right now. */
  isBurning(si: number): boolean {
    return this.state[si] === BURN.burning;
  }

  /**
   * Set the rubble sub-pixel at `(sx, sy)` alight. Only intact, unburnt rubble
   * burns. Returns true if it caught.
   */
  ignite(sx: number, sy: number): boolean {
    const w = this.world;
    if (!w.subInBounds(sx, sy)) return false;
    if (w.health[(sy >> 1) * w.width + (sx >> 1)] > 0) return false;
    const si = sy * w.subWidth + sx;
    if (!w.isRubbleSub(si) || this.state[si] !== BURN.none) return false;
    if (this.burnCount >= FIRE.maxBurning) return false;
    const k = this.burnCount++;
    const t = this.rng.range(FIRE.burnMin, FIRE.burnMax) * this.burnMult;
    this.burning[k] = si;
    this.burnLeft[k] = t;
    this.burnTotal[k] = t;
    this.state[si] = BURN.burning;
    return true;
  }

  /** Keep a warm light at a firing flamethrower's nozzle for a moment. */
  nozzle(id: number, x: number, y: number): void {
    for (const n of this.nozzles) {
      if (n.id === id) {
        n.x = x;
        n.y = y;
        n.life = 0.12;
        return;
      }
    }
    this.nozzles.push({ id, x, y, life: 0.12 });
  }

  /** A flame jet splashing on a surface: flames fan out along it. */
  splash(x: number, y: number, nx: number, ny: number): void {
    const n = 3;
    for (let i = 0; i < n; i++) {
      const side = this.rng.range(-1, 1);
      const sp = this.rng.range(18, 46);
      // Along the surface (perpendicular to the normal), pushed slightly off it.
      const vx = -ny * side * sp + nx * this.rng.range(4, 14);
      const vy = nx * side * sp + ny * this.rng.range(4, 14);
      this.spawn(FKind.Flame, x + nx * 0.6, y + ny * 0.6, vx, vy, this.rng.range(0.22, 0.48), this.rng.range(0.6, 0.95));
    }
  }

  spawn(kind: number, x: number, y: number, vx: number, vy: number, life: number, heat: number): void {
    let i: number;
    if (this.count < this.cap) i = this.count++;
    else i = this.rng.int(this.cap);
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.heat[i] = heat;
    this.kind[i] = kind;
    this.seed[i] = this.rng.range(0, 100);
  }

  /** Advance flames, burning rubble and nozzle lights; trail flames behind live flame jets. */
  update(dt: number, bullets: readonly Bullet[]): void {
    this.time += dt;
    this.emitJets(dt, bullets);
    this.updateBurning(dt);
    this.updateParticles(dt);
    for (let i = this.nozzles.length - 1; i >= 0; i--) {
      if ((this.nozzles[i].life -= dt) <= 0) this.nozzles.splice(i, 1);
    }
  }

  /** Each flame jet sheds flames along its path, hottest near the nozzle. */
  private emitJets(dt: number, bullets: readonly Bullet[]): void {
    for (let i = 0; i < bullets.length; i++) {
      const b = bullets[i];
      if (!b.active || b.style !== 4) continue;
      const age = 1 - b.life / Math.max(1e-6, b.maxLife);
      const n = Math.max(1, Math.round(dt * 220));
      for (let k = 0; k < n; k++) {
        const back = this.rng.range(0, b.speed * dt);
        const spread = 10 + age * 26;
        const a = this.rng.range(-1, 1);
        const sp = b.speed * this.rng.range(0.35, 0.7);
        this.spawn(
          FKind.Flame,
          b.x - b.dx * back + this.rng.range(-0.8, 0.8),
          b.y - b.dy * back + this.rng.range(-0.8, 0.8),
          b.dx * sp - b.dy * a * spread,
          b.dy * sp + b.dx * a * spread,
          this.rng.range(0.16, 0.34) + age * 0.16,
          0.92 - age * 0.5,
        );
      }
    }
  }

  private updateBurning(dt: number): void {
    const w = this.world;
    const sw = w.subWidth;
    const ss = w.subCellSize;
    let k = 0;
    while (k < this.burnCount) {
      const si = this.burning[k];
      // Shot away while burning: the fire goes with it.
      if (w.subHealth[si] === 0 || w.subKind[si] !== SUB.rubble) {
        this.state[si] = BURN.none;
        this.removeBurning(k);
        continue;
      }
      const sx = si % sw;
      const sy = (si - sx) / sw;
      const left = (this.burnLeft[k] -= dt);
      if (left <= 0) {
        this.char(si, sx, sy);
        this.removeBurning(k);
        continue;
      }
      const intensity = this.intensityAt(k);

      // Fire creeps through the heap.
      const p = FIRE.spreadPerSecond * dt * intensity;
      if (this.rng.next() < p) this.ignite(sx + 1, sy);
      if (this.rng.next() < p) this.ignite(sx - 1, sy);
      if (this.rng.next() < p * 1.6) this.ignite(sx, sy - 1); // fire climbs
      if (this.rng.next() < p * 0.5) this.ignite(sx, sy + 1);

      // Flames lick up from exposed faces, mostly the top.
      const open = !w.subSolidAt(sx, sy - 1);
      const side = !w.subSolidAt(sx - 1, sy) || !w.subSolidAt(sx + 1, sy);
      const rate = FIRE.emitPerSecond * intensity * (open ? 1 : side ? 0.35 : 0.06);
      if (this.rng.next() < rate * dt) {
        const ox = (sx + this.rng.next()) * ss;
        const oy = open ? sy * ss - 0.3 : (sy + this.rng.next()) * ss;
        this.spawn(
          FKind.Flame,
          ox,
          oy,
          this.rng.range(-6, 6),
          -this.rng.range(6, 18),
          this.rng.range(FIRE.flameLifeMin, FIRE.flameLifeMax),
          this.rng.range(0.45, 0.85) * (0.6 + 0.4 * intensity),
        );
      }
      if (open && this.rng.next() < 0.35 * dt * intensity) {
        this.spawn(FKind.Ember, (sx + this.rng.next()) * ss, sy * ss - 0.3, this.rng.range(-10, 10), -this.rng.range(18, 40), this.rng.range(0.5, 1.1), 1);
      }
      k++;
    }
  }

  /** 0..1 strength of a burning sub-pixel: flares up fast, dies down at the end. */
  private intensityAt(k: number): number {
    const age = this.burnTotal[k] - this.burnLeft[k];
    return Math.min(1, 0.35 + age * 1.6) * Math.min(1, this.burnLeft[k] / 1.6);
  }

  private char(si: number, sx: number, sy: number): void {
    const w = this.world;
    this.state[si] = BURN.charred;
    w.subTint[si] = CHAR_TINT;
    // Burnt stone is brittle: one more hit crumbles it.
    w.subHealth[si] = 1;
    const ss = w.subCellSize;
    for (let i = 0; i < 2; i++) {
      this.spawn(FKind.Smoke, (sx + this.rng.next()) * ss, sy * ss, this.rng.range(-4, 4), -this.rng.range(4, 10), this.rng.range(0.9, 1.6), 0);
    }
    this.onChar?.(sx, sy);
  }

  private removeBurning(k: number): void {
    const j = --this.burnCount;
    this.burning[k] = this.burning[j];
    this.burnLeft[k] = this.burnLeft[j];
    this.burnTotal[k] = this.burnTotal[j];
  }

  private updateParticles(dt: number): void {
    const w = this.world;
    const inv = 1 / w.subCellSize;
    const t = this.time;
    let i = 0;
    while (i < this.count) {
      if ((this.life[i] -= dt) <= 0) {
        // Some dying flames leave a wisp of smoke.
        if (this.kind[i] === FKind.Flame && this.rng.next() < 0.12) {
          const x = this.x[i];
          const y = this.y[i];
          const vx = this.vx[i] * 0.3;
          this.removeAt(i);
          this.spawn(FKind.Smoke, x, y, vx, -this.rng.range(6, 12), this.rng.range(0.7, 1.3), 0);
          continue;
        }
        this.removeAt(i);
        continue;
      }
      const kind = this.kind[i];
      const age = 1 - this.life[i] / this.maxLife[i];
      let vx = this.vx[i];
      let vy = this.vy[i];
      if (kind === FKind.Flame) {
        // Hot gas rises harder as the jet's push bleeds off, and wobbles.
        vy -= FIRE.buoyancy * (0.4 + age) * dt;
        vx += Math.sin(this.y[i] * 0.45 + t * 9 + this.seed[i]) * 70 * dt;
        const d = Math.exp(-3.2 * dt);
        vx *= d;
        vy *= d;
      } else if (kind === FKind.Smoke) {
        vy -= 6 * dt;
        vx += Math.sin(this.y[i] * 0.2 + t * 2 + this.seed[i]) * 12 * dt;
        const d = Math.exp(-1.5 * dt);
        vx *= d;
        vy *= d;
      } else {
        vy += 30 * dt; // embers arc and fall
        const d = Math.exp(-1.2 * dt);
        vx *= d;
        vy *= d;
      }
      // Collide one axis at a time, so flames slide along walls and spread under ceilings.
      const nx = this.x[i] + vx * dt;
      if (w.subSolidAt(Math.floor(nx * inv), Math.floor(this.y[i] * inv))) {
        vy -= Math.abs(vx) * 0.25;
        vx *= -0.15;
      } else {
        this.x[i] = nx;
      }
      const ny = this.y[i] + vy * dt;
      if (w.subSolidAt(Math.floor(this.x[i] * inv), Math.floor(ny * inv))) {
        const push = Math.abs(vy) * 0.6 + 8;
        vx += (vx >= 0 ? 1 : -1) * push * (0.5 + this.rng.next() * 0.5);
        vy *= -0.1;
      } else {
        this.y[i] = ny;
      }
      this.vx[i] = vx;
      this.vy[i] = vy;
      i++;
    }
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
    this.heat[i] = this.heat[j];
    this.kind[i] = this.kind[j];
    this.seed[i] = this.seed[j];
  }

  /**
   * Gather this frame's warm lights: one per bin of burning rubble (biggest
   * fires first, up to `FIRE.maxLights`) plus one per live nozzle. Each light
   * flickers on its own slow noise, never strobing.
   */
  collectLights(now: number): FireLight[] {
    const out = this.lights;
    out.length = 0;
    const w = this.world;
    const sw = w.subWidth;
    const ss = w.subCellSize;
    const binSubs = FIRE.lightBinCells * 2;
    const bins = this.bins;
    bins.clear();
    const keys = this.binKeys;
    keys.length = 0;
    for (let k = 0; k < this.burnCount; k++) {
      const si = this.burning[k];
      const sx = si % sw;
      const sy = (si - sx) / sw;
      const key = Math.floor(sy / binSubs) * 4096 + Math.floor(sx / binSubs);
      let b = bins.get(key);
      if (!b) {
        b = { n: 0, sx: 0, sy: 0, heat: 0 };
        bins.set(key, b);
        keys.push(key);
      }
      const h = this.intensityAt(k);
      b.n++;
      b.sx += (sx + 0.5) * h;
      b.sy += (sy + 0.5) * h;
      b.heat += h;
    }
    keys.sort((a, b) => bins.get(b)!.heat - bins.get(a)!.heat);
    const lim = Math.min(keys.length, FIRE.maxLights);
    for (let i = 0; i < lim; i++) {
      const key = keys[i];
      const b = bins.get(key)!;
      if (b.heat < 0.05) continue;
      let lx = b.sx / b.heat;
      let ly = b.sy / b.heat;
      // Lift the light out of the heap into the air above it.
      let sx = Math.floor(lx);
      let sy = Math.floor(ly);
      for (let up = 0; up < 6 && w.subSolidAt(sx, sy); up++) sy--;
      if (w.subSolidAt(sx, sy)) continue;
      lx = lx * ss;
      ly = Math.min(ly * ss, (sy + 0.6) * ss);
      const size = Math.min(1, Math.sqrt(b.heat) / 5);
      out.push({
        x: lx,
        y: ly,
        radius: FIRE.lightRadiusMin + (FIRE.lightRadiusMax - FIRE.lightRadiusMin) * size,
        strength:
          (FIRE.lightStrengthMin + (FIRE.lightStrengthMax - FIRE.lightStrengthMin) * size) * flicker(now, key),
        warm: true,
      });
    }
    for (const n of this.nozzles) {
      out.push({
        x: n.x,
        y: n.y,
        radius: FIRE.nozzleLightRadius,
        strength: FIRE.nozzleLightStrength * Math.min(1, n.life / 0.06) * flicker(now * 1.7, n.id * 31),
        warm: true,
      });
    }
    return out;
  }
}

/**
 * Gentle fire flicker in 0.78..1: two slow sines and a faster one, phased per
 * light, so neighbouring fires don't pulse together.
 */
export function flicker(t: number, phase: number): number {
  const p = (phase * 0.6180339) % 1 * 6.283;
  const v = Math.sin(t * 7.3 + p) * 0.5 + Math.sin(t * 13.1 + p * 2.3) * 0.3 + Math.sin(t * 23.7 + p * 3.1) * 0.2;
  return 0.89 + 0.11 * v;
}
