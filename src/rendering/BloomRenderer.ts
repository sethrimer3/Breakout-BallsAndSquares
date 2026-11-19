import type { Game } from "../Game";
import type { FireRenderer } from "./FireRenderer";
import { SoftLightBuffer } from "./SoftLight";
import { drawSpecialGlow } from "./SpecialUpgradeRenderer";

/**
 * Tuning for the subtle, lightweight light-bloom pass.
 * Renders bright light emitters into a quarter-resolution buffer, blurs once,
 * and composites back with `screen` so lights glow softly without blowing out.
 */
export const BLOOM = {
  /** Low-res buffer scale per CSS pixel (0.25 = 1/16th pixel count). */
  scale: 0.25,
  /** Blur radius in buffer pixels (~12 CSS px). */
  blur: 3,
  /** Final screen-composite opacity (keeps the glow subtle). */
  compositeAlpha: 0.45,
} as const;

/**
 * Lightweight bloom pass for facility light panels, lab LEDs/cores, glowing
 * screens, special upgrade crystals, and fire. Composites before fog of war so
 * unexplored areas stay hidden.
 */
export class BloomRenderer {
  private buffer = new SoftLightBuffer({ scale: BLOOM.scale, blur: BLOOM.blur });

  /** Render light emitters into the low-res buffer and screen-composite onto `ctx`. */
  render(
    ctx: CanvasRenderingContext2D,
    game: Game,
    fireRenderer: FireRenderer,
    still: boolean,
    nowSec: number,
  ): void {
    if (!game.bloom) return;
    const cam = game.camera;
    const b = this.buffer.begin(cam.viewW, cam.viewH);
    const animTime = still ? 0 : nowSec;

    game.terrain.drawLabGlow(b, cam, game.runStats.time);
    game.terrain.drawPanels(b, cam, nowSec, true);
    game.terrain.drawLabLights(b, cam, nowSec, still);
    drawSpecialGlow(b, cam, game.specials, animTime);
    fireRenderer.drawGlow(b, cam, game.fire, game.world, animTime);

    this.buffer.composite(ctx, "screen", BLOOM.compositeAlpha);
  }
}
