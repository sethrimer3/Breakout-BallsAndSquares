import type { Soldier } from "../entities/Soldier";

/**
 * Tuning for the exotic DNA show when a Blight generator dies. The DNA is
 * already in the wallet by then: this is purely cosmetic.
 */
export const EXOTIC_BURST = {
  /** Seconds the DNA strand pops out and hangs over the dead generator. */
  hold: 0.75,
  /** Pixels the strand bursts into. */
  motes: 48,
  /** Seconds the pixels fly outward before homing. */
  burstTime: 0.5,
  homeAccel: 950,
  homeMaxSpeed: 440,
  /** Distance at which a pixel is absorbed by its soldier. */
  absorbRadius: 4,
  /** Seconds a homing pixel may fly before it is absorbed regardless. */
  maxHomeTime: 3,
} as const;

/** Black, ember orange and Blight pink, the colors of the exotic matter. */
export const EXOTIC_MOTE_COLORS = ["#0b0610", "#ff8a1e", "#ff48a4", "#ffb4dd", "#ffc066"] as const;

/** The DNA strand, hovering over the generator it came from before it bursts. */
export interface ExoticShow {
  x: number;
  y: number;
  /** Seconds since the generator died. */
  age: number;
}

export interface ExoticMote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  size: number;
  /** Index into EXOTIC_MOTE_COLORS. */
  color: number;
  soldier: Soldier;
}

export interface ExoticBurstEvents {
  onBurst?(x: number, y: number): void;
  onMoteAbsorbed?(soldier: Soldier): void;
}

/**
 * The exotic DNA drop: the strand appears over a destroyed generator, hangs a
 * moment, then bursts into black, orange and pink pixels that are sucked into
 * the nearest soldier. Mirrors the gold special-upgrade motes.
 */
export class ExoticBurstSystem {
  shows: ExoticShow[] = [];
  motes: ExoticMote[] = [];
  /** Soldier-glow timers for the absorb shimmer. */
  readonly glow = new Map<Soldier, number>();

  constructor(
    private soldiers: () => readonly Soldier[],
    private events: ExoticBurstEvents = {},
    private rand: () => number = Math.random,
  ) {}

  reset(): void {
    this.shows = [];
    this.motes = [];
    this.glow.clear();
  }

  /** Start the show over a generator that just died. */
  spawn(x: number, y: number): void {
    this.shows.push({ x, y, age: 0 });
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

  private burst(show: ExoticShow): void {
    this.events.onBurst?.(show.x, show.y);
    const soldier = this.nearestSoldier(show.x, show.y);
    if (!soldier) return;
    for (let i = 0; i < EXOTIC_BURST.motes; i++) {
      // The strand is taller than it is wide: pixels come off its whole length.
      const px = show.x + (this.rand() - 0.5) * 8;
      const py = show.y + (this.rand() - 0.5) * 12;
      const a = this.rand() * Math.PI * 2;
      const sp = 80 + this.rand() * 190;
      this.motes.push({
        x: px, y: py,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        age: -this.rand() * 0.2,
        size: this.rand() < 0.25 ? 2 : 1,
        color: i % EXOTIC_MOTE_COLORS.length,
        soldier,
      });
    }
  }

  update(dt: number): void {
    for (const [s, t] of this.glow) {
      if (t - dt <= 0) this.glow.delete(s);
      else this.glow.set(s, t - dt);
    }
    if (this.shows.length) {
      let keep = 0;
      for (const show of this.shows) {
        show.age += dt;
        if (show.age >= EXOTIC_BURST.hold) this.burst(show);
        else this.shows[keep++] = show;
      }
      this.shows.length = keep;
    }
    if (!this.motes.length) return;
    const { burstTime, homeAccel, homeMaxSpeed, absorbRadius, maxHomeTime } = EXOTIC_BURST;
    let write = 0;
    for (const m of this.motes) {
      if (!m.soldier.alive) {
        const next = this.nearestSoldier(m.x, m.y);
        if (!next) continue; // Nobody left to absorb it: let it vanish.
        m.soldier = next;
      }
      m.age += dt;
      if (m.age < burstTime) {
        const d = Math.exp(-4 * dt);
        m.vx *= d;
        m.vy *= d;
      } else {
        const tx = m.soldier.x - m.x;
        const ty = m.soldier.y - m.y;
        const dist = Math.hypot(tx, ty) || 1;
        const k = Math.min(1, (m.age - burstTime) * 1.6);
        m.vx += (tx / dist) * homeAccel * k * dt;
        m.vy += (ty / dist) * homeAccel * k * dt;
        // Bleed sideways velocity so pixels curve in rather than orbit.
        const along = (m.vx * tx + m.vy * ty) / dist;
        const side = Math.exp(-3.5 * k * dt);
        m.vx = (tx / dist) * along + (m.vx - (tx / dist) * along) * side;
        m.vy = (ty / dist) * along + (m.vy - (ty / dist) * along) * side;
        const sp = Math.hypot(m.vx, m.vy);
        if (sp > homeMaxSpeed) {
          m.vx *= homeMaxSpeed / sp;
          m.vy *= homeMaxSpeed / sp;
        }
        if (dist <= absorbRadius + m.soldier.radius * 0.5 || sp * dt >= dist || m.age > burstTime + maxHomeTime) {
          this.glow.set(m.soldier, 0.6);
          this.events.onMoteAbsorbed?.(m.soldier);
          continue;
        }
      }
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      this.motes[write++] = m;
    }
    this.motes.length = write;
  }
}
