import type { Soldier } from "../entities/Soldier";
import type { PixelWorld } from "../world/PixelWorld";
import type { BulletTargets } from "./CombatSystem";

/** Tuning for the glowing gold special-upgrade blocks. */
export const SPECIAL_UPGRADE = {
  /** Block size in cells (square). */
  size: 3,
  /** Bullet/explosion hits it takes to shatter. */
  hits: 4,
  /** Gold motes the block bursts into. */
  motes: 72,
  /** Seconds the motes fly outward before homing. */
  burstTime: 0.6,
  /** Homing acceleration (world units / s²) and top speed. */
  homeAccel: 900,
  homeMaxSpeed: 420,
  /** Distance at which a mote is absorbed by its soldier. */
  absorbRadius: 4,
  /** Seconds a homing mote may fly before it is absorbed regardless. */
  maxHomeTime: 3,
} as const;

export interface SpecialBlock {
  id: string;
  /** Center cell. */
  cx: number;
  cy: number;
  /** World-space AABB. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  hitsLeft: number;
  /** Seconds left on the white hit flash. */
  flash: number;
  broken: boolean;
}

/** One golden mote flying from a shattered block into a soldier. */
export interface GoldMote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  size: number;
  /** Index into `streams`. */
  stream: number;
}

/** The motes from one block, all heading for the same soldier. */
interface MoteStream {
  id: string;
  soldier: Soldier;
  left: number;
  x: number;
  y: number;
}

export interface SpecialUpgradeEvents {
  onHit?(block: SpecialBlock, x: number, y: number): void;
  onShatter?(block: SpecialBlock, soldier: Soldier): void;
  onMoteAbsorbed?(soldier: Soldier, x: number, y: number): void;
  /** Every mote has reached the soldier: the upgrade is theirs. */
  onAbsorbed?(id: string, soldier: Soldier): void;
}

/**
 * Special upgrades: 3x3 glowing gold blocks in lab rooms. Shooting one enough
 * shatters it into golden motes that burst out, then home into the nearest
 * soldier; once they have all been absorbed the upgrade is granted.
 */
export class SpecialUpgradeSystem implements BulletTargets {
  blocks: SpecialBlock[] = [];
  motes: GoldMote[] = [];
  private streams: MoteStream[] = [];
  private selected: SpecialBlock | null = null;
  /** Soldier-glow timers keyed by soldier, for the absorb shimmer. */
  readonly glow = new Map<Soldier, number>();
  get targetKey(): object | null {
    return this.selected;
  }

  constructor(
    private world: PixelWorld,
    private soldiers: () => readonly Soldier[],
    private events: SpecialUpgradeEvents = {},
    private rand: () => number = Math.random,
  ) {}

  /** Blocks for every spot in the current world that hasn't been collected. */
  reset(collected: readonly string[]): void {
    const cs = this.world.cellSize;
    const half = SPECIAL_UPGRADE.size / 2;
    this.blocks = this.world.upgradeSpots
      .filter((s) => !collected.includes(s.id))
      .map((s) => ({
        id: s.id,
        cx: s.cx,
        cy: s.cy,
        x0: (s.cx + 0.5 - half) * cs,
        y0: (s.cy + 0.5 - half) * cs,
        x1: (s.cx + 0.5 + half) * cs,
        y1: (s.cy + 0.5 + half) * cs,
        hitsLeft: SPECIAL_UPGRADE.hits,
        flash: 0,
        broken: false,
      }));
    this.motes = [];
    this.streams = [];
    this.glow.clear();
    this.selected = null;
  }

  raycast(x: number, y: number, dx: number, dy: number, max: number, ignored?: ReadonlySet<object>): number {
    this.selected = null;
    let best = -1;
    for (const b of this.blocks) {
      if (b.broken || ignored?.has(b)) continue;
      const t = rayBox(x, y, dx, dy, b.x0, b.y0, b.x1, b.y1);
      if (t >= 0 && t <= max && (best < 0 || t < best)) {
        best = t;
        this.selected = b;
      }
    }
    return best;
  }

  applyHit(damage: number, x: number, y: number): boolean {
    const b = this.selected;
    if (!b || b.broken || damage <= 0) return false;
    this.hit(b, x, y);
    return true;
  }

  /** Rockets, grenades and other blasts count as a hit on blocks they reach. */
  explode(x: number, y: number, radius: number): void {
    for (const b of this.blocks) {
      if (b.broken) continue;
      const nx = Math.max(b.x0, Math.min(b.x1, x));
      const ny = Math.max(b.y0, Math.min(b.y1, y));
      if (Math.hypot(x - nx, y - ny) <= radius) this.hit(b, nx, ny);
    }
  }

  private hit(b: SpecialBlock, x: number, y: number): void {
    b.hitsLeft--;
    b.flash = 0.12;
    this.events.onHit?.(b, x, y);
    if (b.hitsLeft <= 0) this.shatter(b);
  }

  private nearestSoldier(x: number, y: number): Soldier | null {
    let best: Soldier | null = null;
    let bd = Infinity;
    for (const s of this.soldiers()) {
      if (!s.alive) continue;
      const d = (s.x - x) ** 2 + (s.y - y) ** 2;
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }

  private shatter(b: SpecialBlock): void {
    b.broken = true;
    const cx = (b.x0 + b.x1) / 2;
    const cy = (b.y0 + b.y1) / 2;
    const soldier = this.nearestSoldier(cx, cy);
    if (!soldier) return;
    const stream = this.streams.length;
    const n = SPECIAL_UPGRADE.motes;
    this.streams.push({ id: b.id, soldier, left: n, x: cx, y: cy });
    const w = b.x1 - b.x0;
    for (let i = 0; i < n; i++) {
      // Motes come from all over the block's face, flung outward from its center.
      const px = b.x0 + this.rand() * w;
      const py = b.y0 + this.rand() * w;
      const a = Math.atan2(py - cy, px - cx) + (this.rand() - 0.5) * 0.9;
      const sp = 90 + this.rand() * 200;
      this.motes.push({ x: px, y: py, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, age: -this.rand() * 0.25, size: 0.6 + this.rand() * 0.9, stream });
    }
    this.events.onShatter?.(b, soldier);
  }

  update(dt: number): void {
    for (const b of this.blocks) {
      if (b.flash > 0) b.flash = Math.max(0, b.flash - dt);
    }
    for (const [s, t] of this.glow) {
      if (t - dt <= 0) this.glow.delete(s);
      else this.glow.set(s, t - dt);
    }
    this.pushSoldiersOut();
    if (this.motes.length === 0) return;
    const { burstTime, homeAccel, homeMaxSpeed, absorbRadius, maxHomeTime } = SPECIAL_UPGRADE;
    let write = 0;
    for (let i = 0; i < this.motes.length; i++) {
      const m = this.motes[i];
      const st = this.streams[m.stream];
      // The soldier fell: hand the stream to whoever is closest now.
      if (!st.soldier.alive) {
        const next = this.nearestSoldier(m.x, m.y);
        if (next) st.soldier = next;
      }
      m.age += dt;
      if (m.age < burstTime) {
        const d = Math.exp(-4 * dt);
        m.vx *= d;
        m.vy *= d;
      } else {
        const tx = st.soldier.x - m.x;
        const ty = st.soldier.y - m.y;
        const dist = Math.hypot(tx, ty) || 1;
        const k = Math.min(1, (m.age - burstTime) * 1.6);
        m.vx += (tx / dist) * homeAccel * k * dt;
        m.vy += (ty / dist) * homeAccel * k * dt;
        // Bleed sideways velocity so motes curve in rather than orbit forever.
        const along = (m.vx * tx + m.vy * ty) / dist;
        const px = m.vx - (tx / dist) * along;
        const py = m.vy - (ty / dist) * along;
        const side = Math.exp(-3.5 * k * dt);
        m.vx = (tx / dist) * along + px * side;
        m.vy = (ty / dist) * along + py * side;
        const sp = Math.hypot(m.vx, m.vy);
        if (sp > homeMaxSpeed) {
          m.vx *= homeMaxSpeed / sp;
          m.vy *= homeMaxSpeed / sp;
        }
        const step = sp * dt;
        if (dist <= absorbRadius + st.soldier.radius * 0.5 || step >= dist || m.age > burstTime + maxHomeTime) {
          this.absorb(st, m);
          continue;
        }
      }
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      this.motes[write++] = m;
    }
    this.motes.length = write;
    if (write === 0) this.streams = [];
  }

  private absorb(st: MoteStream, m: GoldMote): void {
    this.glow.set(st.soldier, 0.5);
    this.events.onMoteAbsorbed?.(st.soldier, m.x, m.y);
    st.left--;
    if (st.left === 0) {
      this.glow.set(st.soldier, 1.4);
      this.events.onAbsorbed?.(st.id, st.soldier);
    }
  }

  /** Intact blocks are solid: nudge soldiers out of them. */
  private pushSoldiersOut(): void {
    for (const b of this.blocks) {
      if (b.broken) continue;
      for (const s of this.soldiers()) {
        if (!s.alive) continue;
        const nx = Math.max(b.x0, Math.min(b.x1, s.x));
        const ny = Math.max(b.y0, Math.min(b.y1, s.y));
        let dx = s.x - nx;
        let dy = s.y - ny;
        const d = Math.hypot(dx, dy);
        if (d >= s.radius) continue;
        if (d < 1e-6) {
          // Center is inside: leave by the nearest face.
          const l = s.x - b.x0, r = b.x1 - s.x, t = s.y - b.y0, bo = b.y1 - s.y;
          const m = Math.min(l, r, t, bo);
          if (m === l) s.x = b.x0 - s.radius;
          else if (m === r) s.x = b.x1 + s.radius;
          else if (m === t) s.y = b.y0 - s.radius;
          else s.y = b.y1 + s.radius;
          continue;
        }
        dx /= d;
        dy /= d;
        s.x = nx + dx * s.radius;
        s.y = ny + dy * s.radius;
        const vn = s.vx * dx + s.vy * dy;
        if (vn < 0) {
          s.vx -= vn * dx;
          s.vy -= vn * dy;
        }
      }
    }
  }
}

/** Distance along a ray to an AABB, or -1 (0 when the origin is inside). */
export function rayBox(ox: number, oy: number, dx: number, dy: number, x0: number, y0: number, x1: number, y1: number): number {
  let tmin = 0;
  let tmax = Infinity;
  if (Math.abs(dx) < 1e-9) {
    if (ox < x0 || ox > x1) return -1;
  } else {
    let a = (x0 - ox) / dx;
    let b = (x1 - ox) / dx;
    if (a > b) [a, b] = [b, a];
    tmin = Math.max(tmin, a);
    tmax = Math.min(tmax, b);
  }
  if (Math.abs(dy) < 1e-9) {
    if (oy < y0 || oy > y1) return -1;
  } else {
    let a = (y0 - oy) / dy;
    let b = (y1 - oy) / dy;
    if (a > b) [a, b] = [b, a];
    tmin = Math.max(tmin, a);
    tmax = Math.min(tmax, b);
  }
  return tmin <= tmax ? tmin : -1;
}
