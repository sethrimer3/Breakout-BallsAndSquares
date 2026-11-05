/**
 * Struct-of-arrays particle pool. Purely visual; never touches terrain collision.
 */
export const PKind = {
  Spark: 0,
  Debris: 1,
  Smoke: 2,
  Burst: 3,
  Ember: 4,
} as const;
export type PKind = (typeof PKind)[keyof typeof PKind];

export class ParticleSystem {
  readonly cap: number;
  count = 0;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly life: Float32Array;
  readonly maxLife: Float32Array;
  readonly size: Float32Array;
  readonly drag: Float32Array;
  readonly kind: Uint8Array;
  /** Packed 0xRRGGBB color. */
  readonly color: Uint32Array;

  constructor(cap: number) {
    this.cap = cap;
    this.x = new Float32Array(cap);
    this.y = new Float32Array(cap);
    this.vx = new Float32Array(cap);
    this.vy = new Float32Array(cap);
    this.life = new Float32Array(cap);
    this.maxLife = new Float32Array(cap);
    this.size = new Float32Array(cap);
    this.drag = new Float32Array(cap);
    this.kind = new Uint8Array(cap);
    this.color = new Uint32Array(cap);
  }

  spawn(
    kind: PKind,
    x: number,
    y: number,
    vx: number,
    vy: number,
    life: number,
    size: number,
    color: number,
    drag = 4,
  ): void {
    let i: number;
    if (this.count < this.cap) i = this.count++;
    else i = (Math.random() * this.cap) | 0; // overwrite a random particle when full
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size[i] = size;
    this.kind[i] = kind;
    this.color[i] = color;
    this.drag[i] = drag;
  }

  update(dt: number): void {
    let i = 0;
    while (i < this.count) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.removeAt(i);
        continue;
      }
      const d = Math.exp(-this.drag[i] * dt);
      this.vx[i] *= d;
      this.vy[i] *= d;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      if (this.kind[i] === PKind.Smoke) this.size[i] += dt * 6;
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
    this.size[i] = this.size[j];
    this.drag[i] = this.drag[j];
    this.kind[i] = this.kind[j];
    this.color[i] = this.color[j];
  }

  clear(): void {
    this.count = 0;
  }
}
