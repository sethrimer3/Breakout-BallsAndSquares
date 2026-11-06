import { ART_PIXEL } from "../config";
import type { Game } from "../Game";
import type { LightRenderer } from "./LightRenderer";
import { bakeSoftBeam, bakeSoftGlow, SoftLightBuffer, type SoftStop } from "./SoftLight";

/**
 * Tuning for the "fiery muzzle flash" visual setting. All sizes are world units
 * (multiplied by camera zoom), alphas are 0..1.
 */
export const FIERY_FLASH = {
  /** Light buffer resolution per CSS pixel. Lower = softer + cheaper. */
  bufferScale: 0.35,
  /** Blur radius in buffer pixels (about bufferScale^-1 CSS px each). */
  blur: 1.2,
  /** Final screen-composite opacity. */
  compositeAlpha: 1,
  /** Flame length / half-width at full intensity. */
  flameLength: 34,
  flameHalfWidth: 6.5,
  /** Muzzle bloom radius around the barrel tip. */
  glowRadius: 13,
  /** Explosion bloom radius as a fraction of the flash's light radius. */
  explosionGlow: 0.32,
  /** Per-shot shape variation (stable per flash, no random flicker). */
  lengthJitter: 0.18,
  angleJitter: 0.09,
  /** Nested layers baked into each sprite. */
  layers: 12,
} as const;

/** White-hot root -> yellow -> orange -> deep red tip. */
const HOT_FLAME: readonly SoftStop[] = [
  [0, "rgba(255, 250, 225, 1)"],
  [0.18, "rgba(255, 214, 110, 0.95)"],
  [0.5, "rgba(255, 130, 30, 0.6)"],
  [0.8, "rgba(220, 60, 10, 0.25)"],
  [1, "rgba(160, 30, 0, 0)"],
];

/** Cooler, wider ember tongue that outlives the hot core. */
const EMBER_FLAME: readonly SoftStop[] = [
  [0, "rgba(255, 170, 70, 0.9)"],
  [0.4, "rgba(255, 100, 20, 0.5)"],
  [0.8, "rgba(190, 40, 5, 0.18)"],
  [1, "rgba(120, 20, 0, 0)"],
];

const FIRE_GLOW: readonly SoftStop[] = [
  [0, "rgba(255, 236, 170, 1)"],
  [0.3, "rgba(255, 160, 55, 0.6)"],
  [0.7, "rgba(230, 80, 15, 0.18)"],
  [1, "rgba(160, 40, 0, 0)"],
];

// Beam sprites: source at BEAM_ORIGIN px from the left, pointing +x.
const BEAM_W = 128;
const BEAM_H = 64;
const BEAM_ORIGIN = 12;
const BEAM_LEN = 100;
const BEAM_HALF = 7;
const BEAM_SPREAD = 3;

/** Stable 0..1 hash of a flash so each shot gets its own flame shape. */
function flashSeed(x: number, y: number, maxLife: number): number {
  const v = Math.sin(x * 12.9898 + y * 78.233 + maxLife * 37.719) * 43758.5453;
  return v - Math.floor(v);
}

/**
 * Soft, fiery muzzle flashes: layered flame + bloom sprites drawn into a
 * low-res light buffer, blurred once and screen-composited over the scene.
 * A single crisp hot pixel at the barrel keeps the pixel-art read.
 */
export class FieryFlashRenderer {
  private buffer = new SoftLightBuffer({ scale: FIERY_FLASH.bufferScale, blur: FIERY_FLASH.blur });
  private hotFlame: HTMLCanvasElement;
  private emberFlame: HTMLCanvasElement;
  private glow: HTMLCanvasElement;

  constructor(private lightRenderer: LightRenderer) {
    const layers = FIERY_FLASH.layers;
    this.hotFlame = bakeSoftBeam(BEAM_W, BEAM_H, BEAM_ORIGIN, BEAM_LEN * 0.8, BEAM_HALF * 0.7, HOT_FLAME, {
      layers,
      baseAlpha: 0.6,
      spread: BEAM_SPREAD,
      falloff: 2.4,
    });
    this.emberFlame = bakeSoftBeam(BEAM_W, BEAM_H, BEAM_ORIGIN, BEAM_LEN, BEAM_HALF, EMBER_FLAME, {
      layers,
      baseAlpha: 0.42,
      spread: BEAM_SPREAD,
      falloff: 2.2,
    });
    this.glow = bakeSoftGlow(64, FIRE_GLOW, { layers, baseAlpha: 0.4, spread: 3.2, falloff: 2.3 });
  }

  /** Render all live flashes into the light buffer and composite onto `ctx`. */
  render(ctx: CanvasRenderingContext2D, game: Game): void {
    const mult = game.muzzleFlashMultiplier;
    if (mult <= 0 || game.flashes.length === 0) return;
    const cam = game.camera;
    const zoom = cam.zoom;
    const viewW = cam.viewW;
    const viewH = cam.viewH;
    let g: CanvasRenderingContext2D | null = null;

    // Sprite pixels -> world units, so the flame's length matches FIERY_FLASH.
    const beamScale = FIERY_FLASH.flameLength / BEAM_LEN;

    for (const f of game.flashes) {
      const life = Math.max(0, f.life / f.maxLife);
      if (life <= 0) continue;
      const sx = cam.worldToScreenX(f.x);
      const sy = cam.worldToScreenY(f.y);
      const isExplosion = f.ownerId < 0;
      const reach = (isExplosion ? f.radius * FIERY_FLASH.explosionGlow : FIERY_FLASH.flameLength) * zoom;
      if (sx + reach < 0 || sy + reach < 0 || sx - reach > viewW || sy - reach > viewH) continue;

      g ??= this.buffer.begin(viewW, viewH);
      g.save();
      // Keep the flame out of walls, same as the shadow-cast light.
      if (f.hasPolygon) {
        this.lightRenderer.tracePolygonPath(g, game, f.poly, f.polyCount);
        g.clip();
      }
      g.translate(sx, sy);

      if (isExplosion) {
        const r = reach * (0.7 + 0.3 * life);
        g.globalAlpha = Math.min(1, life * mult);
        g.drawImage(this.glow, -r, -r, r * 2, r * 2);
        g.restore();
        continue;
      }

      const seed = flashSeed(f.x, f.y, f.maxLife);
      // Hot core fades fast; ember tongue lingers, shortens and widens as it cools.
      const hotA = Math.pow(life, 1.4) * mult;
      const emberA = Math.pow(life, 0.7) * mult;
      const lenJ = 1 + (seed - 0.5) * 2 * FIERY_FLASH.lengthJitter;
      const ang = Math.atan2(f.dy, f.dx) + (seed - 0.5) * 2 * FIERY_FLASH.angleJitter;
      g.rotate(ang);

      const s = beamScale * zoom * lenJ;
      const widen = FIERY_FLASH.flameHalfWidth / BEAM_HALF / beamScale;
      // Ember: wider, slightly shorter as it decays.
      const eLen = s * (0.75 + 0.25 * life);
      const eWid = s * widen * (1.25 - 0.25 * life);
      g.globalAlpha = Math.min(1, emberA);
      g.drawImage(this.emberFlame, -BEAM_ORIGIN * eLen, (-BEAM_H / 2) * eWid, BEAM_W * eLen, BEAM_H * eWid);
      // Hot core: long and narrow at the moment of firing.
      const hLen = s * (0.55 + 0.45 * life);
      const hWid = s * widen * 0.85;
      g.globalAlpha = Math.min(1, hotA);
      g.drawImage(this.hotFlame, -BEAM_ORIGIN * hLen, (-BEAM_H / 2) * hWid, BEAM_W * hLen, BEAM_H * hWid);
      // Bloom around the barrel tip.
      const r = FIERY_FLASH.glowRadius * zoom * (0.6 + 0.4 * life);
      g.globalAlpha = Math.min(1, emberA * 0.8);
      g.drawImage(this.glow, -r, -r, r * 2, r * 2);
      g.restore();
    }

    if (g) this.buffer.composite(ctx, "screen", FIERY_FLASH.compositeAlpha);
  }

  /**
   * One crisp, art-pixel-aligned hot pixel at each fresh muzzle so the soft
   * flame still reads as pixel art. Call inside an additive ("lighter") pass.
   */
  drawHotPixels(ctx: CanvasRenderingContext2D, game: Game): void {
    const mult = game.muzzleFlashMultiplier;
    if (mult <= 0) return;
    const cam = game.camera;
    ctx.fillStyle = "#fff0b0";
    for (const f of game.flashes) {
      if (f.ownerId < 0) continue;
      const life = f.life / f.maxLife;
      if (life < 0.35) continue;
      const gx = Math.floor((f.x + f.dx * ART_PIXEL) / ART_PIXEL);
      const gy = Math.floor((f.y + f.dy * ART_PIXEL) / ART_PIXEL);
      const x0 = Math.round(cam.worldToScreenX(gx * ART_PIXEL));
      const y0 = Math.round(cam.worldToScreenY(gy * ART_PIXEL));
      const x1 = Math.round(cam.worldToScreenX((gx + 1) * ART_PIXEL));
      const y1 = Math.round(cam.worldToScreenY((gy + 1) * ART_PIXEL));
      ctx.globalAlpha = Math.min(1, life * mult);
      ctx.fillRect(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
    }
    ctx.globalAlpha = 1;
  }
}
