export interface ScreenRect { x: number; y: number; width: number; height: number; }

/** Conservative CSS-space union, resolved to a device-pixel work rectangle. */
export class LightRegion {
  private x0 = Infinity;
  private y0 = Infinity;
  private x1 = -Infinity;
  private y1 = -Infinity;

  reset(): void { this.x0 = this.y0 = Infinity; this.x1 = this.y1 = -Infinity; }

  include(x: number, y: number, radius: number): void {
    this.x0 = Math.min(this.x0, x - radius); this.y0 = Math.min(this.y0, y - radius);
    this.x1 = Math.max(this.x1, x + radius); this.y1 = Math.max(this.y1, y + radius);
  }

  resolve(width: number, height: number, dpr: number, padding: number): ScreenRect | null {
    const x = Math.max(0, Math.floor(this.x0 * dpr - padding));
    const y = Math.max(0, Math.floor(this.y0 * dpr - padding));
    const right = Math.min(width, Math.ceil(this.x1 * dpr + padding));
    const bottom = Math.min(height, Math.ceil(this.y1 * dpr + padding));
    if (right <= x || bottom <= y) return null;
    // Dense scenes retain the original path and avoid clip bookkeeping.
    if ((right - x) * (bottom - y) >= width * height * 0.65) return { x:0, y:0, width, height };
    return { x, y, width:right - x, height:bottom - y };
  }
}
