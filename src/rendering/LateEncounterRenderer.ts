import type { CameraSystem } from "../systems/CameraSystem";
import type { Encounter } from "../systems/LateEncounters";

interface BossCollapse {
  x: number;
  y: number;
  t: number;
  duration: number;
}

/**
 * Procedurally animated pixel-art sprites for late-world encounters (Worlds 3–5):
 * rifle soldiers, brutes, hacked turrets, proximity mines, biomass groves, and
 * the multi-phase Leviathan Core boss (including its collapse animation).
 */
export class LateEncounterRenderer {
  private collapses: BossCollapse[] = [];

  /** Trigger the Leviathan Core collapse animation at `(x, y)`. */
  startBossCollapse(x: number, y: number): void {
    this.collapses.push({ x, y, t: 0, duration: 1.4 });
  }

  /** Advance active death collapse animations. */
  update(dt: number): void {
    for (let i = this.collapses.length - 1; i >= 0; i--) {
      this.collapses[i].t += dt;
      if (this.collapses[i].t >= this.collapses[i].duration) {
        this.collapses.splice(i, 1);
      }
    }
  }

  draw(
    ctx: CanvasRenderingContext2D,
    cam: CameraSystem,
    actors: readonly Encounter[],
    shots: readonly { x: number; y: number }[],
    cellSize: number,
    time: number,
  ): void {
    const px = Math.max(1, cam.zoom);

    for (const a of actors) {
      if (!a.alive) continue;
      const x = cam.worldToScreenX(a.x);
      const y = cam.worldToScreenY(a.y);
      const r = cellSize * cam.zoom;
      if (x < -r * 6 || y < -r * 6 || x > cam.viewW + r * 6 || y > cam.viewH + r * 6) continue;

      if (a.kind === "boss") {
        this.drawBoss(ctx, a, x, y, r, cam.zoom, time);
        continue;
      }

      if (a.kind === "grove") {
        this.drawGrove(ctx, a, x, y, r, time);
      } else if (a.kind === "trap") {
        this.drawMine(ctx, a, x, y, r, time);
      } else if (a.kind === "turret") {
        this.drawTurret(ctx, a, x, y, r, time);
      } else if (a.kind === "brute") {
        this.drawBrute(ctx, a, x, y, r, time);
      } else {
        this.drawSoldier(ctx, a, x, y, r, time);
      }

      if (a.hp < a.maxHp) {
        ctx.fillStyle = "#15151d";
        ctx.fillRect(x - r, y - r * 1.9, r * 2, Math.max(2, px * 1.5));
        ctx.fillStyle = "#fa6a9a";
        ctx.fillRect(x - r, y - r * 1.9, (r * 2 * Math.max(0, a.hp)) / a.maxHp, Math.max(2, px * 1.5));
      }
    }

    // Active boss collapse animations
    for (const c of this.collapses) {
      const p = c.t / c.duration;
      const x = cam.worldToScreenX(c.x);
      const y = cam.worldToScreenY(c.y);
      const r = cellSize * cam.zoom * 2.8;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - p);
      // Expanding shockwave ring
      ctx.strokeStyle = p < 0.5 ? "#ff88c0" : "#ff3366";
      ctx.lineWidth = Math.max(2, (1 - p) * 6 * cam.zoom);
      ctx.beginPath();
      ctx.arc(x, y, r * (0.6 + p * 2.4), 0, Math.PI * 2);
      ctx.stroke();
      // Imploding/scattering carapace shards
      for (let k = 0; k < 8; k++) {
        const ang = (k / 8) * Math.PI * 2 + p * 1.5;
        const dist = r * (0.4 + p * 1.3);
        const s = r * 0.35 * (1 - p);
        ctx.fillStyle = k % 2 === 0 ? "#800e3b" : "#ff66a3";
        ctx.fillRect(x + Math.cos(ang) * dist - s / 2, y + Math.sin(ang) * dist - s / 2, s, s);
      }
      ctx.restore();
    }

    // Hostile plasma/rifle bolts
    ctx.fillStyle = "#ff889e";
    for (const p of shots) {
      const sx = cam.worldToScreenX(p.x);
      const sy = cam.worldToScreenY(p.y);
      const s = Math.max(3, 4 * cam.zoom);
      ctx.fillRect(sx - s / 2, sy - s / 2, s, s);
    }
  }

  private tierPalette(tier: number): { armor: string; trim: string; core: string } {
    if (tier >= 11) return { armor: "#58245e", trim: "#a864c8", core: "#ff4488" };
    if (tier >= 10) return { armor: "#6b2b48", trim: "#c87a5a", core: "#ff6a9a" };
    if (tier >= 9) return { armor: "#3e2242", trim: "#885080", core: "#f05a98" };
    return { armor: "#522b44", trim: "#98647c", core: "#e85a98" };
  }

  private drawSoldier(ctx: CanvasRenderingContext2D, a: Encounter, x: number, y: number, r: number, time: number): void {
    const pal = this.tierPalette(a.tier);
    const walk = Math.sin(time * 8 + a.phase);
    const legOff = walk * r * 0.28;
    const bob = Math.abs(walk) * r * 0.08;
    ctx.save();
    ctx.translate(x, y - bob);
    ctx.rotate(a.aimAngle);
    // Legs (walk cycle)
    ctx.fillStyle = "#261626";
    ctx.fillRect(-r * 0.45 + legOff, -r * 0.55, r * 0.45, r * 0.3);
    ctx.fillRect(-r * 0.45 - legOff, r * 0.25, r * 0.45, r * 0.3);
    // Torso & tier armor plates
    ctx.fillStyle = pal.armor;
    ctx.fillRect(-r * 0.65, -r * 0.7, r * 1.25, r * 1.4);
    ctx.fillStyle = pal.trim;
    ctx.fillRect(-r * 0.4, -r * 0.75, r * 0.5, r * 0.3);
    ctx.fillRect(-r * 0.4, r * 0.45, r * 0.5, r * 0.3);
    // Visor / core
    ctx.fillStyle = (a.freezeTimer ?? 0) > 0 ? "#88e8ff" : pal.core;
    ctx.fillRect(r * 0.15, -r * 0.35, r * 0.35, r * 0.7);
    // Rifle barrel
    ctx.fillStyle = "#3a3846";
    ctx.fillRect(r * 0.35, -r * 0.16, r * 1.2, r * 0.32);
    ctx.fillStyle = "#ffddaa";
    ctx.fillRect(r * 1.2, -r * 0.12, r * 0.35, r * 0.24);
    // Muzzle flash right after firing
    if (a.cooldown > 1.05) {
      ctx.fillStyle = "#fff2b0";
      ctx.fillRect(r * 1.55, -r * 0.25, r * 0.45, r * 0.5);
    }
    ctx.restore();
  }

  private drawBrute(ctx: CanvasRenderingContext2D, a: Encounter, x: number, y: number, r: number, time: number): void {
    const pal = this.tierPalette(a.tier);
    const lumber = Math.sin(time * 5 + a.phase);
    const stride = lumber * r * 0.25;
    const br = r * 1.22;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a.aimAngle);
    // Heavy legs
    ctx.fillStyle = "#221220";
    ctx.fillRect(-br * 0.5 + stride, -br * 0.8, br * 0.55, br * 0.35);
    ctx.fillRect(-br * 0.5 - stride, br * 0.45, br * 0.55, br * 0.35);
    // Hulking torso
    ctx.fillStyle = pal.armor;
    ctx.fillRect(-br * 0.8, -br * 0.85, br * 1.5, br * 1.7);
    // Shoulder plates
    ctx.fillStyle = pal.trim;
    ctx.fillRect(-br * 0.55, -br * 0.95, br * 0.95, br * 0.35);
    ctx.fillRect(-br * 0.55, br * 0.6, br * 0.95, br * 0.35);
    // Glowing core / windup flare
    const winding = a.windup > 0;
    ctx.fillStyle = winding ? "#ffe066" : (a.freezeTimer ?? 0) > 0 ? "#88e8ff" : pal.core;
    ctx.fillRect(br * 0.1, -br * 0.4, br * 0.45, br * 0.8);
    // Claws / battering arms
    const reach = winding ? br * 0.35 : 0;
    ctx.fillStyle = "#d8c0c8";
    ctx.fillRect(br * 0.6 + reach, -br * 0.7, br * 0.45, br * 0.25);
    ctx.fillRect(br * 0.6 + reach, br * 0.45, br * 0.45, br * 0.25);
    ctx.restore();
  }

  private drawTurret(ctx: CanvasRenderingContext2D, a: Encounter, x: number, y: number, r: number, time: number): void {
    const pal = this.tierPalette(a.tier);
    const powering = a.cooldown < 0.35;
    const pulse = powering ? 0.5 + 0.5 * Math.sin(time * 24) : 0;
    ctx.save();
    ctx.translate(x, y);
    // Octagonal armored tripod base
    ctx.fillStyle = "#2c2a38";
    ctx.fillRect(-r * 0.95, -r * 0.95, r * 1.9, r * 1.9);
    ctx.fillStyle = pal.trim;
    ctx.fillRect(-r * 0.7, -r * 0.7, r * 1.4, r * 1.4);
    // Rotating turret head
    ctx.rotate(a.aimAngle);
    ctx.fillStyle = pal.armor;
    ctx.fillRect(-r * 0.55, -r * 0.55, r * 1.1, r * 1.1);
    ctx.fillStyle = "#3e3c4c";
    ctx.fillRect(r * 0.25, -r * 0.25, r * 1.3, r * 0.5);
    ctx.fillStyle = powering ? `rgba(255, 220, 120, ${0.6 + pulse * 0.4})` : pal.core;
    ctx.fillRect(-r * 0.2, -r * 0.2, r * 0.45, r * 0.4);
    ctx.restore();
  }

  private drawMine(ctx: CanvasRenderingContext2D, a: Encounter, x: number, y: number, r: number, time: number): void {
    const armed = a.charge > 0;
    const blink = armed ? Math.sin(time * (14 + a.charge * 20)) > 0 : Math.sin(time * 3 + a.phase) > 0.6;
    ctx.save();
    ctx.translate(x, y);
    // Spiked octagonal casing
    ctx.fillStyle = "#483838";
    ctx.fillRect(-r * 0.75, -r * 0.75, r * 1.5, r * 1.5);
    ctx.fillStyle = "#7a5c54";
    ctx.fillRect(-r * 0.55, -r * 0.55, r * 1.1, r * 1.1);
    // Blinking center beacon
    ctx.fillStyle = armed ? (blink ? "#ff3838" : "#ffb347") : blink ? "#ffb347" : "#6a4830";
    ctx.fillRect(-r * 0.28, -r * 0.28, r * 0.56, r * 0.56);
    ctx.restore();
  }

  private drawGrove(ctx: CanvasRenderingContext2D, a: Encounter, x: number, y: number, r: number, time: number): void {
    const sway = Math.sin(time * 2.2 + a.phase) * r * 0.08;
    const glow = 0.6 + 0.4 * Math.sin(time * 3 + a.phase);
    ctx.save();
    ctx.translate(x, y);
    // Outer fern leaves
    ctx.fillStyle = "#2d6a3e";
    ctx.fillRect(-r * 0.9, -r * 0.5, r * 1.8, r);
    ctx.fillRect(-r * 0.5, -r * 0.9, r, r * 1.8);
    // Inner lush canopy
    ctx.fillStyle = "#4eb86a";
    ctx.fillRect(-r * 0.65 + sway, -r * 0.65, r * 1.3, r * 1.3);
    // Glowing biomass pods
    ctx.fillStyle = `rgba(148, 255, 176, ${glow.toFixed(2)})`;
    ctx.fillRect(-r * 0.35 + sway, -r * 0.35, r * 0.32, r * 0.32);
    ctx.fillRect(r * 0.08 + sway, r * 0.08, r * 0.32, r * 0.32);
    ctx.restore();
  }

  private drawBoss(
    ctx: CanvasRenderingContext2D,
    a: Encounter,
    x: number,
    y: number,
    r: number,
    zoom: number,
    time: number,
  ): void {
    const br = r * 2.8;
    const hpRatio = Math.max(0, a.hp) / a.maxHp;
    const enraged = hpRatio <= 0.3;
    const exposed = hpRatio <= 0.6;
    const pulse = 0.5 + 0.5 * Math.sin(time * (enraged ? 14 : 5));

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a.aimAngle);

    // Organic tentacles / stabilizer fins
    ctx.fillStyle = enraged ? "#a81448" : "#5a1034";
    for (const sy of [-1, 1]) {
      const wag = Math.sin(time * 4 + sy) * br * 0.1;
      ctx.fillRect(-br * 1.15, sy * br * 0.55 + wag, br * 0.7, br * 0.25);
      ctx.fillRect(-br * 0.9, sy * br * 0.85 - wag, br * 0.5, br * 0.22);
    }

    // Outer armored carapace (splits open in phase 2/3)
    const split = exposed ? br * 0.14 : 0;
    ctx.fillStyle = enraged ? "#d6184c" : "#70103a";
    ctx.fillRect(-br - split, -br - split, br * 1.9, br * 0.9);
    ctx.fillRect(-br - split, split + br * 0.1, br * 1.9, br * 0.9);

    // Inner exposed organism core
    ctx.fillStyle = enraged ? `rgb(255, ${Math.round(70 + pulse * 90)}, 140)` : exposed ? "#ff4c94" : "#b82a68";
    ctx.fillRect(-br * 0.65, -br * 0.65, br * 1.3, br * 1.3);

    // Central matrix eye
    ctx.fillStyle = enraged ? "#ffffff" : "#ffd6ea";
    ctx.fillRect(-br * 0.26, -br * 0.26, br * 0.52, br * 0.52);
    ctx.fillStyle = enraged ? "#ff0044" : "#801040";
    ctx.fillRect(-br * 0.1, -br * 0.1, br * 0.2, br * 0.2);

    // Twin forward plasma cannons
    ctx.fillStyle = enraged ? "#ffe066" : "#d4a644";
    ctx.fillRect(br * 0.45, -br * 0.45, br * 0.85, br * 0.25);
    ctx.fillRect(br * 0.45, br * 0.2, br * 0.85, br * 0.25);
    ctx.restore();

    // Boss Health Bar
    const barW = br * 2.5;
    const barH = Math.max(4, 5 * zoom);
    const barY = y - br - 12 * zoom;
    ctx.fillStyle = "#15151d";
    ctx.fillRect(x - barW / 2, barY, barW, barH);
    ctx.fillStyle = enraged ? "#ff0055" : "#ff3377";
    ctx.fillRect(x - barW / 2, barY, barW * hpRatio, barH);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = Math.max(1, zoom);
    ctx.strokeRect(x - barW / 2, barY, barW, barH);
  }

  /** Post-fog overlay rendering so critical warnings remain readable through fog. */
  drawOverlay(ctx: CanvasRenderingContext2D, cam: CameraSystem, actors: readonly Encounter[], cellSize: number): void {
    for (const a of actors) {
      if (!a.alive) continue;
      const x = cam.worldToScreenX(a.x);
      const y = cam.worldToScreenY(a.y);
      const r = cellSize * cam.zoom;
      if (x < -r * 6 || y < -r * 6 || x > cam.viewW + r * 6 || y > cam.viewH + r * 6) continue;
      if (a.kind === "boss") {
        const br = r * 2.8;
        ctx.save();
        ctx.strokeStyle = a.hp / a.maxHp <= 0.3 ? "#ff0055" : "#ff4081";
        ctx.lineWidth = Math.max(2, 2.5 * cam.zoom);
        ctx.strokeRect(x - br - 2, y - br - 2, (br + 2) * 2, (br + 2) * 2);
        ctx.restore();
        continue;
      }
      if (a.kind === "trap" && a.charge > 0) {
        const pulse = 0.8 + 0.2 * Math.sin(performance.now() * 0.02);
        ctx.save();
        ctx.strokeStyle = a.charge > 0.6 ? "#ff4040" : "#ffb347";
        ctx.lineWidth = Math.max(2, 2.5 * cam.zoom);
        ctx.beginPath();
        ctx.arc(x, y, (r * 6 * a.charge) / 0.9, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = a.charge > 0.6 ? `rgba(255, 64, 64, ${0.15 * pulse})` : `rgba(255, 179, 71, ${0.12 * pulse})`;
        ctx.fill();
        ctx.restore();
      } else if (a.kind === "brute" && a.windup > 0) {
        const t = a.windup / 0.45;
        ctx.save();
        ctx.strokeStyle = t > 0.7 ? "#ff3366" : "#ffcc00";
        ctx.lineWidth = Math.max(1.5, 2 * cam.zoom);
        ctx.strokeRect(x - r - 3, y - r - 3, (r + 3) * 2, (r + 3) * 2);
        ctx.restore();
      }
    }
  }
}
