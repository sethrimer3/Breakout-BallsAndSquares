import { MAT, type PixelWorld } from "../world/PixelWorld";

export interface DamageNumber {
  x: number;
  y: number;
  amount: number;
  color: string;
  age: number;
  drift: number;
}

/** Bounded visual feedback; never consumes the combat RNG or changes damage. */
export class DamageNumbers {
  readonly items: DamageNumber[] = [];
  readonly duration = 0.65;
  readonly capacity = 128;
  private sequence = 0;

  constructor(world: PixelWorld) {
    world.addDamageListener((x, y, amount, sub) => {
      const cx = Math.floor(x / world.cellSize), cy = Math.floor(y / world.cellSize);
      const i = cy * world.width + cx;
      const color = sub ? "#ff83c8" : world.mat[i] === MAT.glass ? "#a5edff"
        : ["#ffd479", "#ffa56b", "#8fe8a9"][world.zoneAt(cx, cy)];
      if (this.items.length === this.capacity) this.items.shift();
      this.items.push({ x, y, amount, color, age:0, drift:(this.sequence++ % 5 - 2) * 2 });
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

  clear(): void { this.items.length = 0; this.sequence = 0; }
}
