import { SURFACE_OUTLINE_WIDTH } from "./surfaceOutline";
import type { SubcellRegion } from "./blightEdges";

interface SurfaceGrid { subSolidAt(sx: number, sy: number): boolean }

/** Retains built face/corner flags so later edits only resample their dirty region. */
export class SurfaceOutlineCache {
  private flags: Uint8Array | null = null;
  private occupied = 0;

  constructor(readonly subs: number) {}

  get empty(): boolean { return this.occupied === 0; }

  update(grid: SurfaceGrid, sx0: number, sy0: number, solid: Uint8Array, region: SubcellRegion): boolean {
    const { x0, y0, x1, y1 } = region, pad = this.subs + 2;
    for (let y = y0; y <= y1 + 2; y++) for (let x = x0; x <= x1 + 2; x++) {
      solid[y * pad + x] = grid.subSolidAt(sx0 + x - 1, sy0 + y - 1) ? 1 : 0;
    }
    let changed = false;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = (y + 1) * pad + x + 1;
      let value = 0;
      if (solid[i]) {
        const top = !solid[i - pad], bottom = !solid[i + pad];
        const left = !solid[i - 1], right = !solid[i + 1];
        if (top) value |= 1;
        if (bottom) value |= 2;
        if (left) value |= 4;
        if (right) value |= 8;
        if (!top && !left && !solid[i - pad - 1]) value |= 16;
        if (!top && !right && !solid[i - pad + 1]) value |= 32;
        if (!bottom && !left && !solid[i + pad - 1]) value |= 64;
        if (!bottom && !right && !solid[i + pad + 1]) value |= 128;
      }
      const index = y * this.subs + x, before = this.flags?.[index] ?? 0;
      if (value === before) continue;
      this.flags ??= new Uint8Array(this.subs * this.subs);
      this.flags[index] = value;
      this.occupied += Number(value !== 0) - Number(before !== 0);
      changed = true;
    }
    if (!this.occupied) this.flags = null;
    return changed;
  }

  /** Emit the original row-major rectangle sequence, with unchanged winding. */
  trace(rect: (x: number, y: number, w: number, h: number) => void): void {
    if (!this.flags) return;
    const width = SURFACE_OUTLINE_WIDTH, far = 0.5 - width;
    for (let y = 0; y < this.subs; y++) for (let x = 0; x < this.subs; x++) {
      const f = this.flags[y * this.subs + x];
      if (!f) continue;
      const px = x * 0.5, py = y * 0.5;
      if (f & 1) rect(px, py, 0.5, width);
      if (f & 2) rect(px, py + far, 0.5, width);
      if (f & 4) rect(px, py, width, 0.5);
      if (f & 8) rect(px + far, py, width, 0.5);
      if (f & 16) rect(px, py, width, width);
      if (f & 32) rect(px + far, py, width, width);
      if (f & 64) rect(px, py + far, width, width);
      if (f & 128) rect(px + far, py + far, width, width);
    }
  }
}
