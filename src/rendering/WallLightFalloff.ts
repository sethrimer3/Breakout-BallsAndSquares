import type { LitCells } from '../systems/LightingSystem';

interface Entry {
  x: number; y: number; radius: number; width: number; cellSize: number; count: number; steps: number;
  offsets: Int32Array;
}
/** Only use for immutable fixture LitCells. Moving lights retain their direct calculation. */
export class WallLightFalloff {
  private readonly entries = new WeakMap<LitCells, Entry>();

  get(lit: LitCells, x: number, y: number, radius: number, width: number, cellSize: number, steps: number): Int32Array {
    const old = this.entries.get(lit);
    if (old && old.x===x && old.y===y && old.radius===radius && old.width===width &&
        old.cellSize===cellSize && old.count===lit.count && old.steps===steps) return old.offsets;
    const offsets = new Int32Array(lit.count);
    for (let i=0;i<lit.count;i++) {
      const cell=lit.cells[i], cx=cell%width, cy=(cell-cx)/width;
      const t=Math.hypot((cx+.5)*cellSize-x,(cy+.5)*cellSize-y)/radius;
      offsets[i]=t>=1 ? -1 : Math.floor(t*steps)*3;
    }
    this.entries.set(lit,{x,y,radius,width,cellSize,count:lit.count,steps,offsets});
    return offsets;
  }
}
