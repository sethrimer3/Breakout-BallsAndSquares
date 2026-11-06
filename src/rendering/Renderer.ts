import { ART_PIXEL, BULLET, COLORS, GROWTH, SOLDIER } from "../config";
import { PKind } from "../entities/ParticleSystem";
import type { Game } from "../Game";
import { hasLineOfSight } from "../systems/PhysicsSystem";
import { LightRenderer } from "./LightRenderer";
import { createSprites, type Sprites } from "./sprites";

function hexColor(c: number): string {
  return `#${c.toString(16).padStart(6, "0")}`;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private sprites: Sprites;
  private lightRenderer: LightRenderer;

  constructor(
    private canvas: HTMLCanvasElement,
    private game: Game,
  ) {
    this.ctx = canvas.getContext("2d", { alpha: false })!;
    this.sprites = createSprites();
    this.lightRenderer = new LightRenderer(this.sprites);
  }

  resize(): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
  }

  draw(): void {
    const { ctx, game } = this;
    const cam = game.camera;
    const w = cam.viewW;
    const h = cam.viewH;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // 1) Albedo pass: dark navy cavity background, terrain chunks, casings,
    //    and debris/smoke.
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, w, h);
    const rcx = cam.worldToScreenX(game.world.roomCenterX);
    const rcy = cam.worldToScreenY(game.world.roomCenterY);
    const rRad = 88 * cam.zoom;
    ctx.drawImage(this.sprites.soldierGlow, rcx - rRad, rcy - rRad, rRad * 2, rRad * 2);

    game.terrain.draw(ctx, cam, game.showChunkBorders);

    // Subtle starting-room frame so the spawn zone stays recognizable.
    const cs = game.world.cellSize;
    const rx0 = cam.worldToScreenX(game.world.roomX0 * cs);
    const ry0 = cam.worldToScreenY(game.world.roomY0 * cs);
    const rw = game.world.roomSize * cs * cam.zoom;
    ctx.strokeStyle = "rgba(110, 200, 240, 0.16)";
    ctx.lineWidth = 1;
    ctx.strokeRect(rx0 + 0.5, ry0 + 0.5, rw - 1, rw - 1);

    this.drawCasings();
    this.drawOpaqueParticles();

    // 2) Dynamic lighting pass: multiply shadow-clipped lightmap over the albedo
    //    scene + additive air-scatter cone so shadows behind walls & soldiers pop.
    this.lightRenderer.renderLighting(ctx, game, this.dpr);
    game.terrain.drawLabGlow(ctx, cam, game.runStats.time);
    // Soldiers are drawn after lighting so the pixel-art sprite keeps its full
    // palette instead of being darkened by the lightmap.
    this.drawSoldiers();

    // 3) Emissive / post-light pass: cell hit highlights, crimson growth pulses,
    //    directional muzzle flares, bullet tracers, sparks, aim indicator, vignette.
    this.drawCellFlashes();

    this.drawAimIndicator();
    this.drawMarker();

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    this.drawBlightCorePulses();
    this.drawLoot();
    this.drawGrowthPulses();
    this.drawMuzzleFlares();
    this.drawBullets();
    this.drawAdditiveParticles();
    ctx.restore();

    this.lightRenderer.renderVignette(ctx, w, h);
  }

  /**
   * Super-efficient rendering of up to thousands of glowing golden squares:
   * single pre-rendered glow+square sprite per item, fast frustum culling,
   * and zero per-item state changes unless fading out in the final second.
   */
  private drawLoot(): void {
    const { ctx, game } = this;
    const loot = game.loot;
    const n = loot.count;
    if (n === 0) return;
    const cam = game.camera;
    const vw = cam.viewW;
    const vh = cam.viewH;
    const zoom = cam.zoom;
    const camX = cam.x;
    const camY = cam.y;
    const halfW = vw * 0.5;
    const halfH = vh * 0.5;
    const goldSprite = this.sprites.goldSquare;
    const crystalSprite = this.sprites.orangeCrystal;
    const sz = Math.max(6, 5.2 * zoom);
    const half = sz * 0.5;
    const xs = loot.x;
    const ys = loot.y;
    const lives = loot.life;
    const kinds = loot.kind;

    ctx.globalAlpha = 1;
    let lastAlpha = 1;
    for (let i = 0; i < n; i++) {
      const sx = (xs[i] - camX) * zoom + halfW;
      if (sx < -sz || sx > vw + sz) continue;
      const sy = (ys[i] - camY) * zoom + halfH;
      if (sy < -sz || sy > vh + sz) continue;
      const rem = lives[i];
      const a = rem < 1 ? Math.max(0, rem) : 1;
      if (a !== lastAlpha) {
        ctx.globalAlpha = a;
        lastAlpha = a;
      }
      const sprite = kinds[i] === 1 ? crystalSprite : goldSprite;
      ctx.drawImage(sprite, sx - half, sy - half, sz, sz);
    }
    if (lastAlpha !== 1) ctx.globalAlpha = 1;
  }

  private drawCasings(): void {
    const { ctx, game } = this;
    const cam = game.camera;
    const c = game.casings;
    if (c.count === 0) return;
    const len = Math.max(2, 2.3 * cam.zoom);
    const wid = Math.max(1, 1.0 * cam.zoom);
    for (let i = 0; i < c.count; i++) {
      const sx = cam.worldToScreenX(c.x[i]);
      const sy = cam.worldToScreenY(c.y[i]);
      if (sx < -20 || sy < -20 || sx > cam.viewW + 20 || sy > cam.viewH + 20) continue;
      const a = Math.min(1, (c.life[i] / c.maxLife[i]) * 1.4);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(sx, sy);
      ctx.rotate(c.angle[i]);
      ctx.fillStyle = "#e8b85c";
      ctx.fillRect(-len / 2, -wid / 2, len, wid);
      ctx.fillStyle = "#fff1b8";
      ctx.fillRect(-len / 2, -wid / 2, len * 0.45, wid * 0.6);
      ctx.restore();
    }
  }

  private drawBlightCorePulses(): void {
    const { ctx, game } = this;
    const cores = game.world.blightCores;
    if (!cores || cores.length === 0) return;
    const cam = game.camera;
    const cs = game.world.cellSize;
    const now = game.runStats.time;
    const pulse = 0.65 + 0.35 * Math.sin(now * 4.5);
    for (let i = 0; i < cores.length; i++) {
      const c = cores[i];
      if (!c.alive) continue;
      const wx = (c.cx + 1) * cs;
      const wy = (c.cy + 1) * cs;
      const sx = cam.worldToScreenX(wx);
      const sy = cam.worldToScreenY(wy);
      const rad = cs * 3.8 * cam.zoom * (0.9 + 0.15 * pulse);
      if (sx + rad < 0 || sy + rad < 0 || sx - rad > cam.viewW || sy - rad > cam.viewH) continue;
      ctx.globalAlpha = 0.42 * pulse;
      ctx.drawImage(this.sprites.crimsonGlow, sx - rad, sy - rad, rad * 2, rad * 2);
    }
    ctx.globalAlpha = 1;
  }

  private drawGrowthPulses(): void {
    const { ctx, game } = this;
    const g = game.growth;
    if (g.glowCount === 0) return;
    const cam = game.camera;
    const w = game.world;
    const cs = w.cellSize;
    const sz = cs * cam.zoom;
    const now = game.runStats.time;
    const dur = GROWTH.glowDuration;
    for (let k = 0; k < g.glowCount; k++) {
      const idx = (g.glowHead - 1 - k + GROWTH.glowCap) % GROWTH.glowCap;
      const age = now - g.glowTime[idx];
      if (age < 0 || age >= dur) continue;
      const cell = g.glowIndex[idx];
      if (w.health[cell] === 0) continue;
      const cx = cell % w.width;
      const cy = Math.floor(cell / w.width);
      const sx = cam.worldToScreenX(cx * cs);
      const sy = cam.worldToScreenY(cy * cs);
      if (sx + sz < 0 || sy + sz < 0 || sx > cam.viewW || sy > cam.viewH) continue;
      const a = 1 - age / dur;
      ctx.fillStyle = `rgba(255, 38, 108, ${a * a * 0.6})`;
      ctx.fillRect(sx, sy, sz, sz);
      const gr = sz * (1.1 + (1 - a) * 0.5);
      ctx.globalAlpha = a * 0.28;
      ctx.drawImage(this.sprites.crimsonGlow, sx + sz / 2 - gr, sy + sz / 2 - gr, gr * 2, gr * 2);
      ctx.globalAlpha = 1;
    }
  }

  private drawCellFlashes(): void {
    const { ctx, game } = this;
    const cam = game.camera;
    const cs = game.world.cellSize;
    const sz = cs * cam.zoom;
    for (const f of game.cellFlashes) {
      const a = Math.max(0, f.life / f.maxLife);
      const sx = cam.worldToScreenX(f.cx * cs);
      const sy = cam.worldToScreenY(f.cy * cs);
      ctx.fillStyle = f.destroyed
        ? `rgba(255, 195, 115, ${a * 0.42})`
        : `rgba(255, 225, 165, ${a * 0.52})`;
      ctx.fillRect(sx, sy, sz, sz);
    }
  }

  private drawSoldiers(): void {
    const { ctx, game } = this;
    const cam = game.camera;
    const sprite = this.sprites.soldier;
    // Pixel-art sprite: nearest-neighbour scaling, snapped to whole screen pixels.
    const size = Math.max(1, Math.round(sprite.width * ART_PIXEL * cam.zoom));
    const half = size / 2;
    ctx.imageSmoothingEnabled = false;
    for (const s of game.soldiers) {
      if (!s.alive) continue;
      const sx = cam.worldToScreenX(s.x);
      const sy = cam.worldToScreenY(s.y);
      ctx.drawImage(sprite, Math.round(sx - half), Math.round(sy - half), size, size);
      const br = SOLDIER.renderRadius * cam.zoom;
      if (s.maxHealth > 0) {
        const barW = Math.max(12, 10 * cam.zoom);
        const barH = 2.5;
        const barX = sx - barW / 2;
        const barY = sy - br - 5;
        ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
        ctx.fillRect(barX - 0.5, barY - 0.5, barW + 1, barH + 1);
        const pct = Math.max(0, Math.min(1, s.health / s.maxHealth));
        ctx.fillStyle = pct > 0.4 ? "#38d6ff" : "#ff4b7d";
        ctx.fillRect(barX, barY, barW * pct, barH);
      }
      if (cam.manualTarget && cam.targetId === s.id) {
        ctx.strokeStyle = "rgba(160, 245, 255, 0.85)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(sx, sy, br + 4, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  /** Bright outward-facing muzzle core flare along the firing vector. */
  private drawMuzzleFlares(): void {
    const { ctx, game } = this;
    const mult = game.muzzleFlashMultiplier;
    if (mult <= 0) return;
    const cam = game.camera;
    for (const f of game.flashes) {
      const a = Math.max(0, f.life / f.maxLife) * mult;
      const sx = cam.worldToScreenX(f.x);
      const sy = cam.worldToScreenY(f.y);
      ctx.save();
      // The flare is drawn after the lighting pass, so stop it at walls here.
      if (f.hasPolygon) {
        this.lightRenderer.tracePolygonPath(ctx, game, f.poly, f.polyCount);
        ctx.clip();
      }
      ctx.translate(sx, sy);
      ctx.rotate(Math.atan2(f.dy, f.dx));
      const fl = 22 * cam.zoom * (0.45 + 0.55 * a);
      const fw = 7.5 * cam.zoom * (0.5 + 0.5 * a);
      ctx.globalAlpha = a;
      ctx.drawImage(this.sprites.hotGlow, -fw * 0.45, -fw, fl, fw * 2);
      // White-hot core pinpoint.
      const cr = 3.8 * cam.zoom * a;
      ctx.drawImage(this.sprites.dot, -cr, -cr, cr * 2, cr * 2);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  /**
   * Pixel-art bullets: a single bright head pixel with a one-pixel-wide trail that
   * fades toward the tail. Pixels sit on a world-aligned grid of `ART_PIXEL` cells,
   * stepped along the trail like a pixel-art line.
   */
  private drawBullets(): void {
    const { ctx, game } = this;
    const cam = game.camera;
    const items = game.combat.bullets.items;
    const px = ART_PIXEL;
    for (let i = 0; i < items.length; i++) {
      const b = items[i];
      if (!b.active) continue;
      const sx = cam.worldToScreenX(b.x);
      const sy = cam.worldToScreenY(b.y);
      if (sx < -40 || sy < -40 || sx > cam.viewW + 40 || sy > cam.viewH + 40) continue;
      const isRocket = b.style === 1;
      const isSniper = b.style === 2;
      const maxTracer = isSniper ? BULLET.tracerLength * 2.4 : isRocket ? BULLET.tracerLength * 1.4 : BULLET.tracerLength;
      const tLen = Math.min(maxTracer, b.traveled);

      // Head and tail in art-pixel grid coordinates.
      const hx = Math.floor(b.x / px);
      const hy = Math.floor(b.y / px);
      const tx = Math.floor((b.x - b.dx * tLen) / px);
      const ty = Math.floor((b.y - b.dy * tLen) / px);
      const steps = Math.max(Math.abs(hx - tx), Math.abs(hy - ty));

      ctx.fillStyle = isSniper ? "#d7fcff" : isRocket ? "#ffc86e" : "#fff2c3";
      // Trail: tail (k = 0) is faint, the pixel just behind the head is brightest.
      for (let k = 0; k < steps; k++) {
        const t = k / steps;
        ctx.globalAlpha = 0.12 + 0.6 * t;
        this.fillArtPixel(Math.round(tx + (hx - tx) * t), Math.round(ty + (hy - ty) * t), 1);
      }
      ctx.globalAlpha = 1;
      if (isRocket) {
        this.fillArtPixel(hx, hy, 2);
      } else {
        ctx.fillStyle = "#ffffff";
        this.fillArtPixel(hx, hy, 1);
      }
    }
    ctx.globalAlpha = 1;
  }

  /** Fill `n` x `n` art pixels starting at grid cell (gx, gy), snapped to screen pixels. */
  private fillArtPixel(gx: number, gy: number, n: number): void {
    const cam = this.game.camera;
    const x0 = Math.round(cam.worldToScreenX(gx * ART_PIXEL));
    const y0 = Math.round(cam.worldToScreenY(gy * ART_PIXEL));
    const x1 = Math.round(cam.worldToScreenX((gx + n) * ART_PIXEL));
    const y1 = Math.round(cam.worldToScreenY((gy + n) * ART_PIXEL));
    this.ctx.fillRect(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
  }

  private drawOpaqueParticles(): void {
    const { ctx, game } = this;
    const cam = game.camera;
    const p = game.particles;
    for (let i = 0; i < p.count; i++) {
      const k = p.kind[i];
      if (k !== PKind.Debris && k !== PKind.Smoke) continue;
      const a = Math.max(0, p.life[i] / p.maxLife[i]);
      const sx = cam.worldToScreenX(p.x[i]);
      const sy = cam.worldToScreenY(p.y[i]);
      if (sx < -20 || sy < -20 || sx > cam.viewW + 20 || sy > cam.viewH + 20) continue;
      const sz = Math.max(1.5, p.size[i] * cam.zoom);
      if (k === PKind.Smoke) {
        ctx.globalAlpha = a * 0.22;
        ctx.drawImage(this.sprites.dot, sx - sz, sy - sz, sz * 2, sz * 2);
      } else {
        ctx.globalAlpha = a;
        ctx.fillStyle = hexColor(p.color[i]);
        ctx.fillRect(sx - sz / 2, sy - sz / 2, sz, sz);
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawAdditiveParticles(): void {
    const { ctx, game } = this;
    const cam = game.camera;
    const p = game.particles;
    for (let i = 0; i < p.count; i++) {
      const k = p.kind[i];
      if (k === PKind.Debris || k === PKind.Smoke) continue;
      const a = Math.max(0, p.life[i] / p.maxLife[i]);
      const sx = cam.worldToScreenX(p.x[i]);
      const sy = cam.worldToScreenY(p.y[i]);
      if (sx < -30 || sy < -30 || sx > cam.viewW + 30 || sy > cam.viewH + 30) continue;
      ctx.globalAlpha = a;
      if (k === PKind.Spark) {
        const tx = cam.worldToScreenX(p.x[i] - p.vx[i] * 0.026);
        const ty = cam.worldToScreenY(p.y[i] - p.vy[i] * 0.026);
        ctx.strokeStyle = hexColor(p.color[i]);
        ctx.lineWidth = Math.max(1, p.size[i] * 0.72 * cam.zoom);
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(sx, sy);
        ctx.stroke();
      } else {
        const r = Math.max(2, p.size[i] * cam.zoom);
        ctx.drawImage(this.sprites.hotGlow, sx - r, sy - r, r * 2, r * 2);
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawAimIndicator(): void {
    const { ctx, game } = this;
    const cam = game.camera;

    if (game.aimState.active) {
      // The player is pressing and may be dragging to aim
      const sx = cam.worldToScreenX(game.aimState.startWx);
      const sy = cam.worldToScreenY(game.aimState.startWy);
      const gr = SOLDIER.glowRadius * cam.zoom;
      const br = SOLDIER.renderRadius * cam.zoom;

      // Draw ghost soldier at placement origin
      ctx.drawImage(this.sprites.soldierGlow, sx - gr, sy - gr, gr * 2, gr * 2);
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.drawImage(this.sprites.soldier, sx - br, sy - br, br * 2, br * 2);
      ctx.restore();

      // Outer targeting ring
      ctx.save();
      ctx.strokeStyle = "#9ff3ff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(sx, sy, br + 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      if (game.aimState.isDragging) {
        // Player is dragging: show the arrow facing the opposite direction of drag
        const curSx = game.aimState.curSx;
        const curSy = game.aimState.curSy;
        const dragDx = curSx - sx;
        const dragDy = curSy - sy;
        const dragDist = Math.hypot(dragDx, dragDy);

        if (dragDist > 1e-3) {
          // Opposite direction: away from where pointer is / away from drag
          const aimDx = -dragDx / dragDist;
          const aimDy = -dragDy / dragDist;

          // 1) Pull-back slingshot tether (elastic dotted line to cursor)
          ctx.save();
          ctx.strokeStyle = "rgba(160, 230, 255, 0.45)";
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(curSx, curSy);
          ctx.stroke();

          // Small tether handle at pointer
          ctx.fillStyle = "rgba(160, 230, 255, 0.75)";
          ctx.beginPath();
          ctx.arc(curSx, curSy, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();

          // 2) Arrow facing OPPOSITE direction (away from cursor / where player let go)
          const arrowLen = Math.min(100, Math.max(35, dragDist * 0.85));
          const startDist = br + 3;
          const startX = sx + aimDx * startDist;
          const startY = sy + aimDy * startDist;
          const tipX = sx + aimDx * (startDist + arrowLen);
          const tipY = sy + aimDy * (startDist + arrowLen);

          // Arrow shaft with glow
          ctx.save();
          // Glow layer
          ctx.strokeStyle = "rgba(0, 229, 255, 0.4)";
          ctx.lineWidth = 6;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(startX, startY);
          ctx.lineTo(tipX, tipY);
          ctx.stroke();

          // Core shaft
          ctx.strokeStyle = "#9ff3ff";
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(startX, startY);
          ctx.lineTo(tipX, tipY);
          ctx.stroke();

          // Arrowhead pointing forward
          const headLen = 14;
          const headWidth = 11;
          const nx = -aimDy; // normal vector
          const ny = aimDx;
          const baseMidX = tipX - aimDx * headLen;
          const baseMidY = tipY - aimDy * headLen;
          const c1X = baseMidX + nx * (headWidth / 2);
          const c1Y = baseMidY + ny * (headWidth / 2);
          const c2X = baseMidX - nx * (headWidth / 2);
          const c2Y = baseMidY - ny * (headWidth / 2);
          const notchX = tipX - aimDx * (headLen * 0.7);
          const notchY = tipY - aimDy * (headLen * 0.7);

          ctx.fillStyle = "#ffffff";
          ctx.shadowColor = "#00e5ff";
          ctx.shadowBlur = 10;
          ctx.beginPath();
          ctx.moveTo(tipX, tipY);
          ctx.lineTo(c1X, c1Y);
          ctx.lineTo(notchX, notchY);
          ctx.lineTo(c2X, c2Y);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      } else {
        // Active click/press before drag threshold: show 4 cardinal direction hints (straight up, right, down, left)
        ctx.save();
        ctx.strokeStyle = "rgba(160, 230, 255, 0.6)";
        ctx.lineWidth = 2;
        const tickDist = br + 4;
        const tickLen = 6;
        // Up
        ctx.beginPath();
        ctx.moveTo(sx, sy - tickDist);
        ctx.lineTo(sx, sy - tickDist - tickLen);
        // Right
        ctx.moveTo(sx + tickDist, sy);
        ctx.lineTo(sx + tickDist + tickLen, sy);
        // Down
        ctx.moveTo(sx, sy + tickDist);
        ctx.lineTo(sx, sy + tickDist + tickLen);
        // Left
        ctx.moveTo(sx - tickDist, sy);
        ctx.lineTo(sx - tickDist - tickLen, sy);
        ctx.stroke();
        ctx.restore();
      }
    } else if (game.input.mouseInside && game.canPlaceSoldier()) {
      // Hovering with mouse while soldiers are in reserve: show placement cursor reticle
      const sx = game.input.mouseX;
      const sy = game.input.mouseY;
      const br = SOLDIER.renderRadius * cam.zoom;
      ctx.save();
      ctx.strokeStyle = "rgba(160, 230, 255, 0.45)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(sx, sy, br, 0, Math.PI * 2);
      ctx.stroke();

      // Subtle center dot
      ctx.fillStyle = "rgba(160, 230, 255, 0.6)";
      ctx.beginPath();
      ctx.arc(sx, sy, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else if (game.input.mouseInside && !game.canPlaceSoldier() && !game.paused && !game.runOver) {
      // Hovering with mouse when soldiers are deployed: show marker placement preview reticle
      const sx = game.input.mouseX;
      const sy = game.input.mouseY;
      ctx.save();
      ctx.strokeStyle = "rgba(0, 240, 255, 0.45)";
      ctx.lineWidth = 1.5;
      const r = 8;
      // Diamond
      ctx.beginPath();
      ctx.moveTo(sx, sy - r);
      ctx.lineTo(sx + r, sy);
      ctx.lineTo(sx, sy + r);
      ctx.lineTo(sx - r, sy);
      ctx.closePath();
      ctx.stroke();

      // Crosshair ticks
      ctx.beginPath();
      ctx.moveTo(sx - r - 4, sy);
      ctx.lineTo(sx - r + 1, sy);
      ctx.moveTo(sx + r - 1, sy);
      ctx.lineTo(sx + r + 4, sy);
      ctx.moveTo(sx, sy - r - 4);
      ctx.lineTo(sx, sy - r + 1);
      ctx.moveTo(sx, sy + r - 1);
      ctx.lineTo(sx, sy + r + 4);
      ctx.stroke();

      // Center dot
      ctx.fillStyle = "rgba(0, 240, 255, 0.75)";
      ctx.beginPath();
      ctx.arc(sx, sy, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private drawMarker(): void {
    const { ctx, game } = this;
    const marker = game.marker;
    const cam = game.camera;

    if (!marker) return;

    const mx = cam.worldToScreenX(marker.x);
    const my = cam.worldToScreenY(marker.y);

    // Sight lines from soldiers to marker
    ctx.save();
    for (const s of game.soldiers) {
      if (!s.alive) continue;
      if (hasLineOfSight(game.world, s.x, s.y, marker.x, marker.y)) {
        const sx = cam.worldToScreenX(s.x);
        const sy = cam.worldToScreenY(s.y);
        ctx.strokeStyle = "rgba(0, 229, 255, 0.4)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(mx, my);
        ctx.stroke();
      }
    }
    ctx.restore();

    // Check if on-screen
    const w = cam.viewW;
    const h = cam.viewH;
    if (mx < -50 || mx > w + 50 || my < -50 || my > h + 50) return;

    const t = (performance.now() - marker.placedAt) / 1000;
    const zoom = cam.zoom;

    ctx.save();
    // Expanding radar pulse ring
    const pulsePhase = (t * 1.5) % 1;
    const pulseR = (6 + pulsePhase * 22) * zoom;
    const pulseAlpha = (1 - pulsePhase) * 0.7;
    ctx.strokeStyle = `rgba(0, 240, 255, ${pulseAlpha})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(mx, my, pulseR, 0, Math.PI * 2);
    ctx.stroke();

    // Rotating tactical diamond
    const rot = t * 1.2;
    const dr = 10 * zoom;
    ctx.strokeStyle = "#00e5ff";
    ctx.lineWidth = 2;
    ctx.shadowColor = "#00e5ff";
    ctx.shadowBlur = 8;
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const a = rot + (i * Math.PI) / 2;
      const px = mx + Math.cos(a) * dr;
      const py = my + Math.sin(a) * dr;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();

    // Center core
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(mx, my, 3 * zoom, 0, Math.PI * 2);
    ctx.fill();

    // Crosshair ticks
    const tr = 15 * zoom;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(mx - tr, my);
    ctx.lineTo(mx - tr + 4 * zoom, my);
    ctx.moveTo(mx + tr - 4 * zoom, my);
    ctx.lineTo(mx + tr, my);
    ctx.moveTo(mx, my - tr);
    ctx.lineTo(mx, my - tr + 4 * zoom);
    ctx.moveTo(mx, my + tr - 4 * zoom);
    ctx.lineTo(mx, my + tr);
    ctx.stroke();

    ctx.restore();
  }
}
