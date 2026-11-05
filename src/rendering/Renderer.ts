import { BULLET, COLORS, GROWTH, SOLDIER } from "../config";
import { PKind } from "../entities/ParticleSystem";
import type { Game } from "../Game";
import { createSprites, type Sprites } from "./sprites";

function hexColor(c: number): string {
  return `#${c.toString(16).padStart(6, "0")}`;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private sprites: Sprites;

  constructor(
    private canvas: HTMLCanvasElement,
    private game: Game,
  ) {
    this.ctx = canvas.getContext("2d", { alpha: false })!;
    this.sprites = createSprites();
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

    // Background with a faint radial glow at the room center.
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, w, h);
    const rcx = cam.worldToScreenX(game.world.roomCenterX);
    const rcy = cam.worldToScreenY(game.world.roomCenterY);
    const rRad = 80 * cam.zoom;
    ctx.drawImage(this.sprites.soldierGlow, rcx - rRad, rcy - rRad, rRad * 2, rRad * 2);

    // Terrain chunks.
    game.terrain.draw(ctx, cam);

    // Subtle starting-room frame so the spawn zone stays recognizable.
    const cs = game.world.cellSize;
    const rx0 = cam.worldToScreenX(game.world.roomX0 * cs);
    const ry0 = cam.worldToScreenY(game.world.roomY0 * cs);
    const rw = game.world.roomSize * cs * cam.zoom;
    ctx.strokeStyle = "rgba(110, 200, 240, 0.14)";
    ctx.lineWidth = 1;
    ctx.strokeRect(rx0 + 0.5, ry0 + 0.5, rw - 1, rw - 1);

    // Cell hit / destroy highlights.
    this.drawCellFlashes();

    // Debris & smoke particles (under soldiers / additive effects).
    this.drawOpaqueParticles();

    // Aim line when a reserve soldier can be launched.
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

    // Soldiers.
    this.drawSoldiers();

    // Additive pass: muzzle flashes, bullets + tracers, sparks, growth pulses.
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    this.drawGrowthPulses();
    this.drawFlashes();
    this.drawBullets();
    this.drawAdditiveParticles();
    ctx.restore();
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
      if (w.health[cell] === 0) continue; // already destroyed again
      const cx = cell % w.width;
      const cy = Math.floor(cell / w.width);
      const sx = cam.worldToScreenX(cx * cs);
      const sy = cam.worldToScreenY(cy * cs);
      if (sx + sz < 0 || sy + sz < 0 || sx > cam.viewW || sy > cam.viewH) continue;
      const a = 1 - age / dur;
      ctx.fillStyle = `rgba(255, 40, 110, ${a * a * 0.65})`;
      ctx.fillRect(sx, sy, sz, sz);
      const gr = sz * (1.2 + (1 - a) * 0.6);
      ctx.globalAlpha = a * 0.35;
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
        ? `rgba(255, 200, 120, ${a * 0.45})`
        : `rgba(255, 220, 160, ${a * 0.55})`;
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
      if (cam.manualTarget && cam.targetId === s.id) {
        ctx.strokeStyle = "rgba(160, 245, 255, 0.8)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(sx, sy, br + 4, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  private drawFlashes(): void {
    const { ctx, game } = this;
    const cam = game.camera;
    for (const f of game.flashes) {
      const a = Math.max(0, f.life / f.maxLife);
      const sx = cam.worldToScreenX(f.x);
      const sy = cam.worldToScreenY(f.y);
      // Local ambient splash.
      const r = 90 * cam.zoom * (0.6 + 0.4 * a);
      ctx.globalAlpha = a * 0.55;
      ctx.drawImage(this.sprites.warmGlow, sx - r, sy - r, r * 2, r * 2);
      // Directional flare along the firing vector.
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(Math.atan2(f.dy, f.dx));
      const fl = 18 * cam.zoom * (0.5 + 0.5 * a);
      const fw = 7 * cam.zoom;
      ctx.globalAlpha = a;
      ctx.drawImage(this.sprites.hotGlow, -fw * 0.4, -fw, fl, fw * 2);
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
      const tLen = Math.min(BULLET.tracerLength, b.traveled);
      const tx = cam.worldToScreenX(b.x - b.dx * tLen);
      const ty = cam.worldToScreenY(b.y - b.dy * tLen);
      const grad = ctx.createLinearGradient(tx, ty, sx, sy);
      grad.addColorStop(0, "rgba(255, 200, 110, 0)");
      grad.addColorStop(1, "rgba(255, 240, 190, 0.9)");
      ctx.strokeStyle = grad;
      ctx.lineWidth = Math.max(1.2, 1.3 * cam.zoom);
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(sx, sy);
      ctx.stroke();

      const r = Math.max(2, BULLET.radius * 2.5 * cam.zoom);
      ctx.drawImage(this.sprites.hotGlow, sx - r, sy - r, r * 2, r * 2);
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
      const sz = Math.max(1.5, p.size[i] * cam.zoom);
      ctx.globalAlpha = k === PKind.Smoke ? a * 0.25 : a;
      ctx.fillStyle = hexColor(p.color[i]);
      ctx.fillRect(sx - sz / 2, sy - sz / 2, sz, sz);
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
      ctx.globalAlpha = a;
      if (k === PKind.Spark) {
        const tx = cam.worldToScreenX(p.x[i] - p.vx[i] * 0.025);
        const ty = cam.worldToScreenY(p.y[i] - p.vy[i] * 0.025);
        ctx.strokeStyle = hexColor(p.color[i]);
        ctx.lineWidth = Math.max(1, p.size[i] * 0.7 * cam.zoom);
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
