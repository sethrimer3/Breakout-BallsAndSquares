import { MAT, type PixelWorld } from "../world/PixelWorld";

export interface DamageNumber {
  x: number;
  y: number;
  amount: number;
  color: string;
  age: number;
  dx: number;
  dy: number;
}

/** Bounded visual feedback; never consumes the combat RNG or changes damage. */
export class DamageNumbers {
  readonly items: DamageNumber[] = [];
  readonly duration = 0.65;
  readonly capacity = 128;

  constructor(world: PixelWorld, random: () => number = Math.random) {
    world.addDamageListener((x, y, amount, sub, dx, dy) => {
      const cx = Math.floor(x / world.cellSize), cy = Math.floor(y / world.cellSize);
      const i = cy * world.width + cx;
      const color = sub ? "#ff83c8" : world.mat[i] === MAT.glass ? "#a5edff"
        : ["#ffd479", "#ffa56b", "#8fe8a9"][world.zoneAt(cx, cy)];
      if (this.items.length === this.capacity) this.items.shift();
      // A triangular spread favors the incoming direction and stays within ±10°.
      const base = Math.hypot(dx, dy) > 1e-8 ? Math.atan2(dy, dx) : -Math.PI / 2;
      const angle = base + (random() + random() - 1) * Math.PI / 18;
      this.items.push({ x, y, amount, color, age: 0, dx: Math.cos(angle), dy: Math.sin(angle) });
    });
  }

  update(dt: number): void {
    let keep = 0;
    for (const item of this.items) {
      item.age += dt;
      if (item.age < this.duration) this.items[keep++] = item;
    }
    this.items.length = keep;
  }

  clear(): void { this.items.length = 0; }
}
