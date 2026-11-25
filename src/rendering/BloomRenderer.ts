import type { Game } from "../Game";
import { GROWTH } from "../config";
import { LIGHT_KIND } from "../world/PixelWorld";
import type { FireRenderer } from "./FireRenderer";
import { visibleRoomLightIndices } from "./RoomLightIndex";
import { fogRegionVisible } from "./fogRegionVisible";
import { bakeSoftGlow, SoftLightBuffer, type SoftStop } from "./SoftLight";
import { drawSpecialGlow } from "./SpecialUpgradeRenderer";
import type { Sprites } from "./sprites";

/**
 * Tuning for the subtle, lightweight light-bloom pass.
 * Renders soft pre-baked glow sprites and bright emitters into a quarter-res
 * buffer, blurs once, and composites back with `screen` so lights, bullets,
 * explosions, and blight glow softly without blowing out.
 */
export const BLOOM = {
  /** Low-res buffer scale per CSS pixel (0.25 = 1/16th pixel count). */
  scale: 0.25,
  /** Blur radius in buffer pixels (~9 CSS px). */
  blur: 2.2,
  /** Final screen-composite opacity. */
  compositeAlpha: 0.85,
} as const;

const COOL_STOPS: readonly SoftStop[] = [
  [0, "rgba(220, 238, 255, 0.95)"],
  [0.35, "rgba(180, 215, 255, 0.55)"],
  [0.75, "rgba(130, 185, 255, 0.16)"],
  [1, "rgba(100, 160, 255, 0)"],
];

const WARM_STOPS: readonly SoftStop[] = [
  [0, "rgba(255, 236, 190, 0.95)"],
  [0.35, "rgba(255, 195, 110, 0.55)"],
  [0.75, "rgba(240, 140, 50, 0.16)"],
  [1, "rgba(200, 90, 20, 0)"],
];

const MINT_STOPS: readonly SoftStop[] = [
  [0, "rgba(210, 255, 230, 0.95)"],
  [0.35, "rgba(150, 255, 200, 0.55)"],
  [0.75, "rgba(90, 220, 155, 0.16)"],
  [1, "rgba(50, 180, 120, 0)"],
];

const CYAN_STOPS: readonly SoftStop[] = [
  [0, "rgba(210, 250, 255, 0.95)"],
  [0.35, "rgba(120, 225, 255, 0.55)"],
  [0.75, "rgba(60, 180, 255, 0.16)"],
  [1, "rgba(30, 130, 230, 0)"],
];

const GLOW_OPTS = { layers: 8, baseAlpha: 0.34, spread: 3.0, falloff: 2.2 } as const;

/**
 * Lightweight bloom pass for facility light panels, lab LEDs/cores, glowing
 * screens, bullets, explosions, blight, special crystals, and fire.
 * Composites before fog of war so unexplored areas remain hidden.
 */
export class BloomRenderer {
  private readonly coarsePointer = typeof matchMedia === "function" ? matchMedia("(pointer: coarse)") : null;
  private buffer: SoftLightBuffer;
  private panelCool = bakeSoftGlow(64, COOL_STOPS, GLOW_OPTS);
  private panelWarm = bakeSoftGlow(64, WARM_STOPS, GLOW_OPTS);
  private panelMint = bakeSoftGlow(64, MINT_STOPS, GLOW_OPTS);
  private cyanGlow = bakeSoftGlow(64, CYAN_STOPS, GLOW_OPTS);

  constructor(private sprites: Sprites) {
    this.buffer = new SoftLightBuffer({
      scale: this.coarsePointer?.matches ? 0.18 : BLOOM.scale,
      blur: BLOOM.blur,
    });
  }

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

    this.drawPanelBlooms(b, game, nowSec);
    game.terrain.drawLabGlow(b, cam, game.runStats.time);
    // Tiny 1-subcell LEDs already draw their own 3x3 additive halos in the main pass;
    // skip their extra per-LED fillRects inside the quarter-res bloom buffer on phones.
    if (!this.coarsePointer?.matches) game.terrain.drawLabLights(b, cam, nowSec, still);
    this.drawBlightBlooms(b, game, animTime);
    this.drawBulletBlooms(b, game);
    this.drawFlashBlooms(b, game);
    drawSpecialGlow(b, cam, game.specials, animTime);
    fireRenderer.drawGlow(b, cam, game.fire, game.world, animTime);

    this.buffer.composite(ctx, "screen", BLOOM.compositeAlpha);
  }

  private drawPanelBlooms(b: CanvasRenderingContext2D, game: Game, nowSec: number): void {
    const w = game.world;
    const cam = game.camera;
    const cs = w.cellSize;
    const z = cam.zoom;
    const unit = cs * z;
    const fog = game.devMapAccess ? undefined : game.fog;
    for (const n of visibleRoomLightIndices(w, cam)) {
      const l = w.roomLights[n];
      if (l.kind === LIGHT_KIND.wash || l.kind === LIGHT_KIND.blight) continue;
      if (fog) {
        const pad = 3 * cs;
        if (!fogRegionVisible(fog, l.x0 * cs - pad, l.y0 * cs - pad, (l.x1 + 1) * cs + pad, (l.y1 + 1) * cs + pad)) continue;
      }
      const level = game.terrain.lightLevel(l, nowSec);
      if (level <= 0.02) continue;

      const x = cam.worldToScreenX(l.x0 * cs);
      const y = cam.worldToScreenY(l.y0 * cs);
      const pw = (l.x1 - l.x0 + 1) * unit;
      const ph = (l.y1 - l.y0 + 1) * unit;
      let cx = x + pw * 0.5;
      let cy = y + ph * 0.5;
      if (l.wallFace) {
        const horiz = l.wallFace === "north" || l.wallFace === "south";
        cx = x + (horiz ? 0.5 : l.wallFace === "east" ? 0.825 : 0.175) * unit;
        cy = y + (horiz ? (l.wallFace === "south" ? 0.825 : 0.175) : 0.5) * unit;
      }
      const rad = (l.wallFace ? 2.1 : 2.6) * unit;
      if (cx + rad < 0 || cy + rad < 0 || cx - rad > cam.viewW || cy - rad > cam.viewH) continue;

      const sprite = l.kind === LIGHT_KIND.bright ? this.panelCool : l.kind === LIGHT_KIND.dim ? this.panelWarm : this.panelMint;
      b.globalAlpha = level * (l.wallFace ? 0.65 : 0.75);
      b.drawImage(sprite, cx - rad, cy - rad, rad * 2, rad * 2);
    }
    b.globalAlpha = 1;
  }

  private drawBlightBlooms(b: CanvasRenderingContext2D, game: Game, animTime: number): void {
    const cam = game.camera;
    const w = game.world;
    const cs = w.cellSize;

    // Blight edges (cached per chunk) provide the colony-wide crimson/pink aura.
    game.terrain.drawBlightEdges(b, cam, animTime);

    const cores = w.blightCores;
    if (cores && cores.length > 0) {
      const pulse = 0.65 + 0.35 * Math.sin(game.runStats.time * 4.5);
      for (let i = 0; i < cores.length; i++) {
        const c = cores[i];
        if (!c.alive) continue;
        const sx = cam.worldToScreenX((c.cx + c.size * 0.5) * cs);
        const sy = cam.worldToScreenY((c.cy + c.size * 0.5) * cs);
        const rad = cs * (c.size === 1 ? 2.8 : 5.5) * cam.zoom * (0.92 + 0.12 * pulse);
        if (sx + rad < 0 || sy + rad < 0 || sx - rad > cam.viewW || sy - rad > cam.viewH) continue;
        b.globalAlpha = 0.7 * pulse;
        b.drawImage(this.sprites.crimsonGlow, sx - rad, sy - rad, rad * 2, rad * 2);
      }
    }

    const gr = game.growth;
    if (gr.glowCount > 0) {
      const now = game.runStats.time;
      const dur = GROWTH.glowDuration;
      for (let k = 0; k < gr.glowCount; k++) {
        const idx = (gr.glowHead - 1 - k + GROWTH.glowCap) % GROWTH.glowCap;
        const age = now - gr.glowTime[idx];
        if (age < 0 || age >= dur) continue;
        const cell = gr.glowIndex[idx];
        if (w.health[cell] === 0) continue;
        const cx = cell % w.width;
        const cy = (cell - cx) / w.width;
        const sx = cam.worldToScreenX((cx + 0.5) * cs);
        const sy = cam.worldToScreenY((cy + 0.5) * cs);
        const rad = cs * 3.2 * cam.zoom;
        if (sx + rad < 0 || sy + rad < 0 || sx - rad > cam.viewW || sy - rad > cam.viewH) continue;
        b.globalAlpha = (1 - age / dur) * 0.5;
        b.drawImage(this.sprites.crimsonGlow, sx - rad, sy - rad, rad * 2, rad * 2);
      }
    }
    b.globalAlpha = 1;
  }

  private drawBulletBlooms(b: CanvasRenderingContext2D, game: Game): void {
    if (game.combat.bullets.activeCount === 0) return;
    const cam = game.camera;
    const z = cam.zoom;
    const vw = cam.viewW;
    const vh = cam.viewH;
    const items = game.combat.bullets.items;
    for (let i = 0; i < items.length; i++) {
      const bul = items[i];
      if (!bul.active) continue;
      const sx = cam.worldToScreenX(bul.x);
      const sy = cam.worldToScreenY(bul.y);
      const isRocket = bul.style === 1;
      const isSniper = bul.style === 2;
      const rad = (isRocket ? 15 : isSniper ? 11 : 8) * z;
      if (sx + rad < 0 || sy + rad < 0 || sx - rad > vw || sy - rad > vh) continue;
      const sprite = isRocket ? this.sprites.hotGlow : isSniper ? this.cyanGlow : this.panelWarm;
      b.globalAlpha = isRocket ? 0.65 : isSniper ? 0.52 : 0.42;
      b.drawImage(sprite, sx - rad, sy - rad, rad * 2, rad * 2);
    }
    b.globalAlpha = 1;
  }

  private drawFlashBlooms(b: CanvasRenderingContext2D, game: Game): void {
    const mult = game.muzzleFlashMultiplier;
    if (mult <= 0 || game.flashes.length === 0) return;
    const cam = game.camera;
    const z = cam.zoom;
    const vw = cam.viewW;
    const vh = cam.viewH;
    for (const f of game.flashes) {
      const life = Math.max(0, f.life / f.maxLife);
      if (life <= 0) continue;
      const intensity = Math.pow(life, 0.7) * mult;
      const sx = cam.worldToScreenX(f.x);
      const sy = cam.worldToScreenY(f.y);
      const isExplosion = f.ownerId < 0;
      const rad = (isExplosion ? Math.min(f.radius * 0.55, 72) : 15) * z;
      if (sx + rad < 0 || sy + rad < 0 || sx - rad > vw || sy - rad > vh) continue;
      b.globalAlpha = Math.min(1, intensity * (isExplosion ? 0.85 : 0.55));
      b.drawImage(isExplosion ? this.sprites.hotGlow : this.sprites.warmGlow, sx - rad, sy - rad, rad * 2, rad * 2);
    }
    b.globalAlpha = 1;
  }
}
