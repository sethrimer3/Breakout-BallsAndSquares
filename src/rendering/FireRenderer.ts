import { ART_PIXEL } from "../config";
import type { CameraSystem } from "../systems/CameraSystem";
import { FKind, flicker, type FireSystem } from "../systems/FireSystem";
import type { PixelWorld } from "../world/PixelWorld";

/** Flame colors from hottest to coolest. */
const FLAME_RAMP = ["#fff4cf", "#ffd84a", "#ff9c24", "#f2581a", "#a8260e", "#4a1006"] as const;
/** Temperature thresholds for `FLAME_RAMP` (temperature >= threshold picks that color). */
const FLAME_STEPS = [0.82, 0.62, 0.44, 0.28, 0.14, -1] as const;

/**
 * Draws fire on the world's pixel grid: smoke (normal blend, before the glow
 * pass), and glowing embers on burning rubble plus the flames themselves
 * (additive, after lighting, so fire is its own light source).
 */
export class FireRenderer {
  /** Dark, drifting smoke. Call in normal blend mode. */
  drawSmoke(ctx: CanvasRenderingContext2D, cam: CameraSystem, fire: FireSystem): void {
    ctx.fillStyle = "#1c1816";
    for (let i = 0; i < fire.count; i++) {
      if (fire.kind[i] !== FKind.Smoke) continue;
      const t = fire.life[i] / fire.maxLife[i];
      // Fade in quickly, then thin out.
      const a = Math.min(1, (1 - t) * 6) * t * 0.55;
      if (a <= 0.01) continue;
      ctx.globalAlpha = a;
      const n = t > 0.5 ? 2 : 1;
      this.pixel(ctx, cam, Math.floor(fire.x[i] / ART_PIXEL), Math.floor(fire.y[i] / ART_PIXEL), n);
    }
    ctx.globalAlpha = 1;
  }

  /** Embers on burning rubble, then flames and sparks. Call in "lighter" blend mode. */
  drawGlow(ctx: CanvasRenderingContext2D, cam: CameraSystem, fire: FireSystem, world: PixelWorld, now: number): void {
    this.drawEmbers(ctx, cam, fire, world, now);
    const vw = cam.viewW;
    const vh = cam.viewH;
    for (let i = 0; i < fire.count; i++) {
      const kind = fire.kind[i];
      if (kind === FKind.Smoke) continue;
      const sx = cam.worldToScreenX(fire.x[i]);
      const sy = cam.worldToScreenY(fire.y[i]);
      if (sx < -8 || sy < -8 || sx > vw + 8 || sy > vh + 8) continue;
      const age = 1 - fire.life[i] / fire.maxLife[i];
      const gx = Math.floor(fire.x[i] / ART_PIXEL);
      const gy = Math.floor(fire.y[i] / ART_PIXEL);
      if (kind === FKind.Ember) {
        ctx.globalAlpha = Math.min(1, (1 - age) * 1.6) * (0.6 + 0.4 * flicker(now * 3, i));
        ctx.fillStyle = age < 0.5 ? FLAME_RAMP[1] : FLAME_RAMP[2];
        this.pixel(ctx, cam, gx, gy, 1);
        continue;
      }
      const temp = fire.heat[i] * (1 - age * 0.95);
      let c = 0;
      while (temp < FLAME_STEPS[c]) c++;
      ctx.fillStyle = FLAME_RAMP[c];
      ctx.globalAlpha = Math.min(1, (1 - age) * 2.2) * 0.85;
      // Young, hot flames are chunkier; they thin to single pixels as they cool.
      this.pixel(ctx, cam, gx, gy, temp > 0.55 ? 2 : 1);
    }
    ctx.globalAlpha = 1;
  }

  /**
   * Burning rubble glows from within: each half-size pixel's four texels
   * smoulder on their own slow flicker, brightest while the fire is at its peak.
   */
  private drawEmbers(ctx: CanvasRenderingContext2D, cam: CameraSystem, fire: FireSystem, world: PixelWorld, now: number): void {
    const sw = world.subWidth;
    const ss = world.subCellSize;
    const half = ss / 2;
    const x0 = cam.screenToWorldX(0) - ss;
    const y0 = cam.screenToWorldY(0) - ss;
    const x1 = cam.screenToWorldX(cam.viewW) + ss;
    const y1 = cam.screenToWorldY(cam.viewH) + ss;
    for (let k = 0; k < fire.burnCount; k++) {
      const si = fire.burning[k];
      const sx = si % sw;
      const sy = (si - sx) / sw;
      const wx = sx * ss;
      const wy = sy * ss;
      if (wx < x0 || wy < y0 || wx > x1 || wy > y1) continue;
      const left = fire.burnLeft[k];
      const age = fire.burnTotal[k] - left;
      const life = Math.min(1, 0.3 + age * 1.4) * Math.min(1, left / 2);
      for (let t = 0; t < 4; t++) {
        const tx = t & 1;
        const ty = t >> 1;
        const f = flicker(now * 0.8, si * 4 + t);
        // Lower texels sit deeper in the heap and glow a little hotter.
        const heat = life * (f - 0.72) * 3.2 * (ty ? 1 : 0.8);
        if (heat <= 0.05) continue;
        ctx.globalAlpha = Math.min(0.9, heat);
        ctx.fillStyle = heat > 0.6 ? "#ff8a24" : heat > 0.3 ? "#d8481a" : "#86200c";
        const ax = cam.worldToScreenX(wx + tx * half);
        const ay = cam.worldToScreenY(wy + ty * half);
        const bx = cam.worldToScreenX(wx + (tx + 1) * half);
        const by = cam.worldToScreenY(wy + (ty + 1) * half);
        ctx.fillRect(Math.round(ax), Math.round(ay), Math.max(1, Math.round(bx) - Math.round(ax)), Math.max(1, Math.round(by) - Math.round(ay)));
      }
    }
  }

  private pixel(ctx: CanvasRenderingContext2D, cam: CameraSystem, gx: number, gy: number, n: number): void {
    const x0 = Math.round(cam.worldToScreenX(gx * ART_PIXEL));
    const y0 = Math.round(cam.worldToScreenY(gy * ART_PIXEL));
    const x1 = Math.round(cam.worldToScreenX((gx + n) * ART_PIXEL));
    const y1 = Math.round(cam.worldToScreenY((gy + n) * ART_PIXEL));
    ctx.fillRect(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
  }
}
