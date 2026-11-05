import { GROWTH, LIGHT } from "../config";
import type { Game } from "../Game";
import type { Sprites } from "./sprites";

/**
 * Renders the 2D lightmap (offscreen canvas multiplied over the albedo scene)
 * and the low-alpha air-scatter pass that makes muzzle-flash cones and shadow
 * wedges visible across open cavities.
 */
export class LightRenderer {
  private lmCanvas: HTMLCanvasElement;
  private lmCtx: CanvasRenderingContext2D;
  private vignetteCanvas: HTMLCanvasElement;
  private vigW = 0;
  private vigH = 0;

  constructor(private sprites: Sprites) {
    this.lmCanvas = document.createElement("canvas");
    this.lmCtx = this.lmCanvas.getContext("2d", { alpha: false })!;
    this.vignetteCanvas = document.createElement("canvas");
  }

  /**
   * Build the lightmap and composite it onto `ctx` (which must currently be in
   * CSS-pixel coordinates via `setTransform(dpr, 0, 0, dpr, 0, 0)`).
   */
  renderLighting(ctx: CanvasRenderingContext2D, game: Game): void {
    const cam = game.camera;
    const viewW = Math.max(1, Math.round(cam.viewW));
    const viewH = Math.max(1, Math.round(cam.viewH));
    const preset = game.lighting.preset;
    const scale = preset.halfResLightmap ? 0.5 : 1;
    const lw = Math.max(1, Math.round(viewW * scale));
    const lh = Math.max(1, Math.round(viewH * scale));
    if (this.lmCanvas.width !== lw || this.lmCanvas.height !== lh) {
      this.lmCanvas.width = lw;
      this.lmCanvas.height = lh;
    }

    const g = this.lmCtx;
    g.setTransform(scale, 0, 0, scale, 0, 0);

    // 1) Fill with dark ambient illumination.
    const [ar, ag, ab] = LIGHT.ambientRgb;
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
    g.fillStyle = `rgb(${ar}, ${ag}, ${ab})`;
    g.fillRect(0, 0, viewW, viewH);

    g.globalCompositeOperation = "lighter";

    // Faint ambient glow in the spawn room so the starting chamber is softly discernible.
    const rcx = cam.worldToScreenX(game.world.roomCenterX);
    const rcy = cam.worldToScreenY(game.world.roomCenterY);
    const roomR = 54 * cam.zoom;
    g.globalAlpha = 0.28;
    g.drawImage(this.sprites.soldierGlow, rcx - roomR, rcy - roomR, roomR * 2, roomR * 2);

    // 2) Faint self-glow around living soldiers (muzzle flash remains dominant).
    for (const s of game.soldiers) {
      if (!s.alive) continue;
      const sx = cam.worldToScreenX(s.x);
      const sy = cam.worldToScreenY(s.y);
      const sr = LIGHT.soldierLightRadius * cam.zoom;
      g.globalAlpha = 0.55;
      g.drawImage(this.sprites.soldierGlow, sx - sr, sy - sr, sr * 2, sr * 2);
    }

    // 3) Dim crimson light from recently replicated hostile terrain cells.
    const gr = game.growth;
    if (gr.glowCount > 0) {
      const w = game.world;
      const cs = w.cellSize;
      const now = game.runStats.time;
      const dur = GROWTH.glowDuration;
      for (let k = 0; k < gr.glowCount; k++) {
        const idx = (gr.glowHead - 1 - k + GROWTH.glowCap) % GROWTH.glowCap;
        const age = now - gr.glowTime[idx];
        if (age < 0 || age >= dur) continue;
        const cell = gr.glowIndex[idx];
        if (w.health[cell] === 0) continue;
        const cx = cell % w.width;
        const cy = Math.floor(cell / w.width);
        const sx = cam.worldToScreenX((cx + 0.5) * cs);
        const sy = cam.worldToScreenY((cy + 0.5) * cs);
        if (sx < -60 || sy < -60 || sx > viewW + 60 || sy > viewH + 60) continue;
        const a = 1 - age / dur;
        const cr = cs * 2.6 * cam.zoom;
        g.globalAlpha = a * 0.42;
        g.drawImage(this.sprites.crimsonGlow, sx - cr, sy - cr, cr * 2, cr * 2);
      }
    }

    // 4) Muzzle-flash lights: clip radial gradient to visibility polygon.
    for (const fl of game.flashes) {
      const a = Math.max(0, fl.life / fl.maxLife);
      const intensity = Math.pow(a, 0.65);
      const sx = cam.worldToScreenX(fl.x);
      const sy = cam.worldToScreenY(fl.y);
      const rad = fl.radius * cam.zoom;
      if (sx + rad < 0 || sy + rad < 0 || sx - rad > viewW || sy - rad > viewH) continue;

      if (fl.hasPolygon && fl.polyCount >= 3) {
        g.save();
        this.tracePolygonPath(g, game, fl.poly, fl.polyCount);
        g.clip();
        const grad = g.createRadialGradient(sx, sy, 0, sx, sy, rad);
        grad.addColorStop(0, `rgba(255, 252, 238, ${intensity})`);
        grad.addColorStop(0.18, `rgba(255, 224, 150, ${intensity * 0.92})`);
        grad.addColorStop(0.5, `rgba(255, 148, 52, ${intensity * 0.55})`);
        grad.addColorStop(0.82, `rgba(210, 82, 20, ${intensity * 0.2})`);
        grad.addColorStop(1, "rgba(140, 40, 0, 0)");
        g.globalAlpha = 1;
        g.fillStyle = grad;
        g.fillRect(sx - rad, sy - rad, rad * 2, rad * 2);
        g.restore();
      } else {
        // Fallback cheap glow when over the shadow-light budget.
        g.globalAlpha = intensity * 0.65;
        g.drawImage(this.sprites.warmGlow, sx - rad * 0.7, sy - rad * 0.7, rad * 1.4, rad * 1.4);
      }
    }
    g.globalAlpha = 1;

    // 5) Multiply lightmap over the albedo scene -> unlit areas become dark,
    //    lit walls pop with warm color, occluded regions stay in shadow.
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    ctx.drawImage(this.lmCanvas, 0, 0, viewW, viewH);
    ctx.restore();

    // 6) Air-scatter pass: draw the clipped light polygon at low alpha with
    //    additive blending so the light cone and soldier/wall shadow silhouettes
    //    are clearly visible across empty space.
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const fl of game.flashes) {
      if (!fl.hasPolygon || fl.polyCount < 3) continue;
      const a = Math.max(0, fl.life / fl.maxLife);
      const intensity = Math.pow(a, 0.7);
      const sx = cam.worldToScreenX(fl.x);
      const sy = cam.worldToScreenY(fl.y);
      const rad = fl.radius * cam.zoom;
      if (sx + rad < 0 || sy + rad < 0 || sx - rad > viewW || sy - rad > viewH) continue;

      ctx.save();
      this.tracePolygonPath(ctx, game, fl.poly, fl.polyCount);
      ctx.clip();
      const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, rad);
      grad.addColorStop(0, `rgba(255, 246, 215, ${intensity * 0.34})`);
      grad.addColorStop(0.28, `rgba(255, 196, 105, ${intensity * 0.2})`);
      grad.addColorStop(0.65, `rgba(255, 125, 35, ${intensity * 0.08})`);
      grad.addColorStop(1, "rgba(255, 90, 0, 0)");
      ctx.fillStyle = grad;
      ctx.fillRect(sx - rad, sy - rad, rad * 2, rad * 2);
      ctx.restore();
    }
    ctx.restore();
  }

  /** Draw a subtle screen-edge vignette for depth. */
  renderVignette(ctx: CanvasRenderingContext2D, viewW: number, viewH: number): void {
    const w = Math.max(1, Math.round(viewW));
    const h = Math.max(1, Math.round(viewH));
    if (this.vigW !== w || this.vigH !== h) {
      this.vigW = w;
      this.vigH = h;
      this.vignetteCanvas.width = w;
      this.vignetteCanvas.height = h;
      const vg = this.vignetteCanvas.getContext("2d")!;
      const cx = w / 2;
      const cy = h / 2;
      const r0 = Math.min(w, h) * 0.36;
      const r1 = Math.hypot(cx, cy);
      const grad = vg.createRadialGradient(cx, cy, r0, cx, cy, r1);
      grad.addColorStop(0, "rgba(0, 0, 0, 0)");
      grad.addColorStop(0.7, "rgba(2, 4, 10, 0.28)");
      grad.addColorStop(1, "rgba(1, 2, 6, 0.72)");
      vg.fillStyle = grad;
      vg.fillRect(0, 0, w, h);
    }
    ctx.drawImage(this.vignetteCanvas, 0, 0, w, h);
  }

  private tracePolygonPath(
    g: CanvasRenderingContext2D,
    game: Game,
    poly: Float32Array,
    count: number,
  ): void {
    const cam = game.camera;
    g.beginPath();
    g.moveTo(cam.worldToScreenX(poly[0]), cam.worldToScreenY(poly[1]));
    for (let i = 1; i < count; i++) {
      g.lineTo(cam.worldToScreenX(poly[i * 2]), cam.worldToScreenY(poly[i * 2 + 1]));
    }
    g.closePath();
  }
}
