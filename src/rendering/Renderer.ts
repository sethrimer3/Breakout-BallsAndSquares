import { BULLET, COLORS, GROWTH, SOLDIER } from "../config";
import { PKind } from "../entities/ParticleSystem";
import type { Game } from "../Game";
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
    //    debris/smoke, and metallic soldier spheres.
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
    this.drawSoldiers();

    // 2) Dynamic lighting pass: multiply shadow-clipped lightmap over the albedo
    //    scene + additive air-scatter cone so shadows behind walls & soldiers pop.
    this.lightRenderer.renderLighting(ctx, game, this.dpr);
    game.terrain.drawLabGlow(ctx, cam, game.runStats.time);

    // 3) Emissive / post-light pass: cell hit highlights, crimson growth pulses,
    //    directional muzzle flares, bullet tracers, sparks, aim indicator, vignette.
    this.drawCellFlashes();

    const aim = game.aimOrigin();
    if (aim && game.input.mouseInside) {
      const sx = cam.worldToScreenX(aim.x);
      const sy = cam.worldToScreenY(aim.y);
      ctx.save();
      ctx.strokeStyle = COLORS.aim;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(game.input.mouseX, game.input.mouseY);
      ctx.stroke();
      ctx.restore();
      const gr = SOLDIER.renderRadius * cam.zoom;
      ctx.strokeStyle = COLORS.aim;
      ctx.beginPath();
      ctx.arc(sx, sy, gr, 0, Math.PI * 2);
      ctx.stroke();
    }

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
    for (const s of game.soldiers) {
      if (!s.alive) continue;
      const sx = cam.worldToScreenX(s.x);
      const sy = cam.worldToScreenY(s.y);
      const gr = SOLDIER.glowRadius * cam.zoom;
      ctx.drawImage(this.sprites.soldierGlow, sx - gr, sy - gr, gr * 2, gr * 2);
      const br = SOLDIER.renderRadius * cam.zoom;
      ctx.drawImage(this.sprites.soldier, sx - br, sy - br, br * 2, br * 2);
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

  private drawBullets(): void {
    const { ctx, game } = this;
    const cam = game.camera;
    const items = game.combat.bullets.items;
    ctx.lineCap = "round";
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
      const tx = cam.worldToScreenX(b.x - b.dx * tLen);
      const ty = cam.worldToScreenY(b.y - b.dy * tLen);
      const grad = ctx.createLinearGradient(tx, ty, sx, sy);
      if (isSniper) {
        grad.addColorStop(0, "rgba(120, 235, 255, 0)");
        grad.addColorStop(1, "rgba(215, 252, 255, 0.98)");
      } else if (isRocket) {
        grad.addColorStop(0, "rgba(255, 90, 20, 0)");
        grad.addColorStop(1, "rgba(255, 200, 110, 0.95)");
      } else {
        grad.addColorStop(0, "rgba(255, 195, 100, 0)");
        grad.addColorStop(1, "rgba(255, 242, 195, 0.92)");
      }
      ctx.strokeStyle = grad;
      ctx.lineWidth = Math.max(1.2, (isRocket ? 2.4 : isSniper ? 1.9 : 1.3) * cam.zoom);
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(sx, sy);
      ctx.stroke();

      const rScale = isRocket ? 4.2 : isSniper ? 3.2 : 2.6;
      const r = Math.max(2, BULLET.radius * rScale * cam.zoom);
      ctx.drawImage(isRocket ? this.sprites.warmGlow : this.sprites.hotGlow, sx - r, sy - r, r * 2, r * 2);
    }
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
}
