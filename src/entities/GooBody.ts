/** A bounded visual spring ring. Coordinates are relative to the collision center,
 * in the contact normal's frame; no outline point ever collides or deals damage. */
export const GOO_BODY_POINTS = 10;
const REST_X = Float32Array.from({ length: GOO_BODY_POINTS }, (_, i) => Math.cos(i * Math.PI * 2 / GOO_BODY_POINTS));
const REST_Y = Float32Array.from({ length: GOO_BODY_POINTS }, (_, i) => Math.sin(i * Math.PI * 2 / GOO_BODY_POINTS));
export type GooBodyPhase = "flight" | "clinging" | "peeling";

export class GooBody {
  readonly x = new Float32Array(GOO_BODY_POINTS);
  readonly y = new Float32Array(GOO_BODY_POINTS);
  readonly vx = new Float32Array(GOO_BODY_POINTS);
  readonly vy = new Float32Array(GOO_BODY_POINTS);
  angle = 0;
  phase: GooBodyPhase = "flight";

  constructor() { this.reset(); }

  reset(): void {
    this.x.set(REST_X);
    this.y.set(REST_Y);
    this.vx.fill(0);
    this.vy.fill(0);
    this.angle = 0;
    this.phase = "flight";
  }

  impact(nx: number, ny: number): void {
    this.angle = Math.atan2(ny, nx);
    this.phase = "clinging";
    for (let i = 0; i < GOO_BODY_POINTS; i++) {
      this.x[i] = 0.64 + REST_X[i] * 0.64;
      this.y[i] = REST_Y[i] * 1.15;
      this.vx[i] = -REST_X[i] * 3;
      this.vy[i] = REST_Y[i] * 4;
    }
    this.anchor();
  }

  release(): void {
    this.phase = "flight";
    for (let i = 0; i < GOO_BODY_POINTS; i++) this.vx[i] += 3.5;
  }

  /** Stable, fixed-step visual integration. Long catch-up calls may drop visual
   * time, never simulation time; storage and spring work remain bounded. */
  advance(dt: number, phase: GooBodyPhase): void {
    if (phase === "peeling" && this.phase !== "peeling") {
      // One suction/stretch impulse when the peel begins, never once per frame.
      for (let i = 0; i < GOO_BODY_POINTS; i++) {
        this.vx[i] += (1 + REST_X[i]) * 3;
        this.vy[i] -= REST_Y[i] * 2;
      }
    }
    this.phase = phase;
    const time = Math.min(0.25, Math.max(0, dt));
    const steps = Math.ceil(time * 240);
    if (steps === 0) return;
    const h = time / steps;
    const attached = phase !== "flight";
    const width = phase === "peeling" ? 0.94 : attached ? 0.64 : 1;
    const height = phase === "peeling" ? 0.82 : attached ? 1.15 : 1;
    const shift = attached ? width : 0;
    for (let step = 0; step < steps; step++) {
      for (let i = 0; i < GOO_BODY_POINTS; i++) {
        const tx = shift + REST_X[i] * width;
        const ty = REST_Y[i] * height;
        this.vx[i] += ((tx - this.x[i]) * 190 - this.vx[i] * 11) * h;
        this.vy[i] += ((ty - this.y[i]) * 190 - this.vy[i] * 11) * h;
        this.x[i] = Math.max(-1.7, Math.min(2.5, this.x[i] + this.vx[i] * h));
        this.y[i] = Math.max(-1.7, Math.min(1.7, this.y[i] + this.vy[i] * h));
      }
      if (attached) this.anchor();
    }
  }

  private anchor(): void {
    // Keep three contact-side points on the surface while the free side jiggles.
    for (let i = 0; i < GOO_BODY_POINTS; i++) {
      if (REST_X[i] > -0.8) continue;
      this.x[i] = 0;
      this.vx[i] = this.vy[i] = 0;
      this.y[i] = REST_Y[i] * 0.85;
    }
  }
}
