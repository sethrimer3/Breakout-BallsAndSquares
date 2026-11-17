import type { CameraSystem } from "../systems/CameraSystem";
import type { Encounter } from "../systems/LateEncounters";

type Ctx = CanvasRenderingContext2D;

interface BossCollapse {
  x: number;
  y: number;
  t: number;
  duration: number;
}

/** Collects one frame's 1-unit world pixels, then draws them as crisp world-aligned squares. */
class PixelBatch {
  private xs: number[] = [];
  private ys: number[] = [];
  private cs: string[] = [];

  put(x: number, y: number, c: string): void {
    this.xs.push(Math.floor(x));
    this.ys.push(Math.floor(y));
    this.cs.push(c);
  }

  /** Filled disc of radius `r` centered at `(x, y)`, shaded by `shade(dx, dy, edge)`. */
  disc(x: number, y: number, r: number, shade: (dx: number, dy: number, edge: boolean) => string): void {
    const R = Math.ceil(r);
    const r2 = r * r;
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const d2 = (dx + 0.5) ** 2 + (dy + 0.5) ** 2;
        if (d2 > r2) continue;
        const edge = d2 > (r - 1) * (r - 1);
        this.put(x + dx, y + dy, shade(dx, dy, edge));
      }
    }
  }

  /** One-pixel Bresenham line between two world-unit points. */
  line(x0: number, y0: number, x1: number, y1: number, c: string): void {
    let ax = Math.floor(x0);
    let ay = Math.floor(y0);
    const bx = Math.floor(x1);
    const by = Math.floor(y1);
    const dx = Math.abs(bx - ax);
    const dy = -Math.abs(by - ay);
    const sx = ax < bx ? 1 : -1;
    const sy = ay < by ? 1 : -1;
    let err = dx + dy;
    for (let guard = 0; guard < 64; guard++) {
      this.put(ax, ay, c);
      if (ax === bx && ay === by) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        ax += sx;
      }
      if (e2 <= dx) {
        err += dx;
        ay += sy;
      }
    }
  }

  flush(ctx: Ctx, cam: CameraSystem): void {
    const size = Math.max(1, Math.ceil(cam.zoom));
    let last = "";
    for (let i = 0; i < this.xs.length; i++) {
      const c = this.cs[i];
      if (c !== last) {
        ctx.fillStyle = c;
        last = c;
      }
      ctx.fillRect(
        Math.floor(cam.worldToScreenX(this.xs[i])),
        Math.floor(cam.worldToScreenY(this.ys[i])),
        size,
        size,
      );
    }
    this.xs.length = 0;
    this.ys.length = 0;
    this.cs.length = 0;
  }
}

type TierPal = readonly [string, string, string, string, string];
const TIER_PALS: Record<number, TierPal> = {
  8: ["#24101c", "#4c243a", "#7c3c5c", "#b86488", "#ff9ac4"],
  9: ["#1c0c1e", "#3c1c42", "#683270", "#9c54a8", "#f074c8"],
  10: ["#281418", "#5a2834", "#924248", "#c87858", "#ff9078"],
  11: ["#1a0a24", "#3e1a58", "#682c8e", "#a45cd4", "#ff5ca8"],
};
const GROVE_PAL = ["#102a18", "#205430", "#348a4c", "#62c87a", "#b8ffca"] as const;
const MINE_PAL = ["#241a18", "#4a3632", "#78584e", "#ffb347", "#ff3838"] as const;
const BOSS_PAL = ["#240414", "#5c0c2c", "#981a4e", "#e0387c", "#ff98c8"] as const;

/**
 * Procedural 1-unit pixel-art renderer for Worlds 3–5 encounters (matching
 * `CreatureRenderer` quality): rifle soldiers, brutes, hacked turrets, mines,
 * biomass groves, and the multi-phase Leviathan Core boss.
 */
export class LateEncounterRenderer {
  private batch = new PixelBatch();
  private collapses: BossCollapse[] = [];

  startBossCollapse(x: number, y: number): void {
    this.collapses.push({ x, y, t: 0, duration: 1.4 });
  }

  update(dt: number): void {
    for (let i = this.collapses.length - 1; i >= 0; i--) {
      this.collapses[i].t += dt;
      if (this.collapses[i].t >= this.collapses[i].duration) {
        this.collapses.splice(i, 1);
      }
    }
  }

  draw(
    ctx: Ctx,
    cam: CameraSystem,
    actors: readonly Encounter[],
    shots: readonly { x: number; y: number }[],
    cellSize: number,
    time: number,
  ): void {
    const margin = 36;
    const x0 = cam.screenToWorldX(0) - margin;
    const y0 = cam.screenToWorldY(0) - margin;
    const x1 = cam.screenToWorldX(cam.viewW) + margin;
    const y1 = cam.screenToWorldY(cam.viewH) + margin;
    const visible = (x: number, y: number): boolean => x >= x0 && y >= y0 && x <= x1 && y <= y1;

    for (const a of actors) {
      if (!a.alive || !visible(a.x, a.y)) continue;
      if (a.kind === "boss") this.boss(a, time);
      else if (a.kind === "grove") this.grove(a, time);
      else if (a.kind === "trap") this.mine(a, time);
      else if (a.kind === "turret") this.turret(a, time);
      else if (a.kind === "brute") this.brute(a, time);
      else this.soldier(a, time);
    }

    // Active boss collapse fragments in world pixels
    for (const c of this.collapses) {
      const p = c.t / c.duration;
      const count = 14;
      for (let k = 0; k < count; k++) {
        const ang = (k / count) * Math.PI * 2 + p * 2.2;
        const dist = 4 + p * 28;
        const fx = c.x + Math.cos(ang) * dist;
        const fy = c.y + Math.sin(ang) * dist;
        const rad = Math.max(1, 3.5 * (1 - p));
        this.batch.disc(fx, fy, rad, (_dx, _dy, edge) => (edge ? BOSS_PAL[0] : k % 2 ? BOSS_PAL[3] : BOSS_PAL[4]));
      }
    }

    // Hostile shots as crisp 2-tone pixel bolts
    for (const s of shots) {
      if (!visible(s.x, s.y)) continue;
      this.batch.disc(s.x, s.y, 2, (_dx, _dy, edge) => (edge ? "#ff4a7a" : "#ffd6e6"));
    }

    this.batch.flush(ctx, cam);

    // Health bars & shockwave rings (crisp HUD-aligned overlay on entity)
    for (const a of actors) {
      if (!a.alive || !visible(a.x, a.y)) continue;
      const sx = cam.worldToScreenX(a.x);
      const sy = cam.worldToScreenY(a.y);
      const r = cellSize * cam.zoom;
      if (a.kind === "boss") {
        const br = r * 2.8;
        const barW = br * 2.6;
        const barH = Math.max(4, 5 * cam.zoom);
        const barY = sy - br - 12 * cam.zoom;
        const ratio = Math.max(0, a.hp) / a.maxHp;
        ctx.fillStyle = "#15151d";
        ctx.fillRect(sx - barW / 2, barY, barW, barH);
        ctx.fillStyle = ratio <= 0.3 ? "#ff0055" : "#ff3377";
        ctx.fillRect(sx - barW / 2, barY, barW * ratio, barH);
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = Math.max(1, cam.zoom);
        ctx.strokeRect(sx - barW / 2, barY, barW, barH);
      } else if (a.hp < a.maxHp) {
        const barW = r * 2.2;
        const barH = Math.max(2, 1.5 * cam.zoom);
        ctx.fillStyle = "#15151d";
        ctx.fillRect(sx - barW / 2, sy - r * 1.9, barW, barH);
        ctx.fillStyle = "#fa6a9a";
        ctx.fillRect(sx - barW / 2, sy - r * 1.9, (barW * Math.max(0, a.hp)) / a.maxHp, barH);
      }
    }

    for (const c of this.collapses) {
      const p = c.t / c.duration;
      const sx = cam.worldToScreenX(c.x);
      const sy = cam.worldToScreenY(c.y);
      const r = cellSize * cam.zoom * 2.8;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - p);
      ctx.strokeStyle = p < 0.5 ? "#ff88c0" : "#ff3366";
      ctx.lineWidth = Math.max(2, (1 - p) * 5 * cam.zoom);
      ctx.beginPath();
      ctx.arc(sx, sy, r * (0.6 + p * 2.4), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  private pal(tier: number): TierPal {
    return TIER_PALS[Math.min(11, Math.max(8, tier))] ?? TIER_PALS[8];
  }

  private soldier(a: Encounter, time: number): void {
    const pal = this.pal(a.tier);
    const frozen = (a.freezeTimer ?? 0) > 0;
    const ca = Math.cos(a.aimAngle);
    const sa = Math.sin(a.aimAngle);
    const px = -sa;
    const py = ca;
    const walk = Math.sin(time * 8 + a.phase);
    // Boots/legs alternating along facing axis
    for (const side of [-1, 1]) {
      const step = side * walk * 2.2;
      this.batch.disc(a.x + px * side * 2.5 + ca * step, a.y + py * side * 2.5 + sa * step, 1.8, () => pal[0]);
    }
    // Armored torso & shoulder pads
    this.batch.disc(a.x, a.y, 4.8, (dx, dy, edge) => {
      if (edge) return pal[0];
      const lit = dx * ca + dy * sa > 1;
      return frozen ? "#88e8ff" : lit ? pal[3] : pal[2];
    });
    // Visor slit
    this.batch.line(a.x + ca * 2 - px * 2, a.y + sa * 2 - py * 2, a.x + ca * 2 + px * 2, a.y + sa * 2 + py * 2, frozen ? "#ffffff" : pal[4]);
    // Rifle barrel
    this.batch.line(a.x + ca * 3 + px * 1.5, a.y + sa * 3 + py * 1.5, a.x + ca * 9 + px * 1.5, a.y + sa * 9 + py * 1.5, "#3a3846");
    this.batch.put(a.x + ca * 9 + px * 1.5, a.y + sa * 9 + py * 1.5, "#ffddaa");
    // Muzzle flash
    if (a.cooldown > 1.05) {
      this.batch.disc(a.x + ca * 10.5 + px * 1.5, a.y + sa * 10.5 + py * 1.5, 2.2, (_dx, _dy, edge) => (edge ? "#ffb84d" : "#fff8cc"));
    }
  }

  private brute(a: Encounter, time: number): void {
    const pal = this.pal(a.tier);
    const frozen = (a.freezeTimer ?? 0) > 0;
    const ca = Math.cos(a.aimAngle);
    const sa = Math.sin(a.aimAngle);
    const px = -sa;
    const py = ca;
    const lumber = Math.sin(time * 5 + a.phase);
    const winding = a.windup > 0;
    // Heavy legs
    for (const side of [-1, 1]) {
      const step = side * lumber * 2.5;
      this.batch.disc(a.x + px * side * 4 + ca * step, a.y + py * side * 4 + sa * step, 2.5, () => pal[0]);
    }
    // Shoulder armor horns
    for (const side of [-1, 1]) {
      this.batch.disc(a.x + px * side * 5.2, a.y + py * side * 5.2, 3.2, (_dx, _dy, edge) => (edge ? pal[0] : pal[3]));
    }
    // Hulking carapace body
    this.batch.disc(a.x, a.y, 6.5, (dx, dy, edge) => {
      if (edge) return pal[0];
      const core = dx * dx + dy * dy < 6;
      if (core) return winding ? "#ffe066" : frozen ? "#88e8ff" : pal[4];
      return dx * ca + dy * sa > 0 ? pal[2] : pal[1];
    });
    // Battering claws
    const reach = winding ? 3 : 0;
    for (const side of [-1, 1]) {
      this.batch.line(
        a.x + ca * 4 + px * side * 4.5,
        a.y + sa * 4 + py * side * 4.5,
        a.x + ca * (8 + reach) + px * side * 3.5,
        a.y + sa * (8 + reach) + py * side * 3.5,
        winding ? "#fff0a0" : "#d8c0c8",
      );
    }
  }

  private turret(a: Encounter, time: number): void {
    const pal = this.pal(a.tier);
    const ca = Math.cos(a.aimAngle);
    const sa = Math.sin(a.aimAngle);
    const powering = a.cooldown < 0.35;
    const pulse = powering && Math.sin(time * 24) > 0;
    // Tripod legs
    for (let k = 0; k < 4; k++) {
      const ang = (k * Math.PI) / 2 + Math.PI / 4;
      this.batch.line(a.x, a.y, a.x + Math.cos(ang) * 7, a.y + Math.sin(ang) * 7, "#2a2836");
    }
    // Armored rotating dome
    this.batch.disc(a.x, a.y, 5.2, (dx, dy, edge) => {
      if (edge) return pal[0];
      if (dx * dx + dy * dy < 4) return pulse ? "#fff2a0" : pal[4];
      return dx + dy < 0 ? pal[3] : pal[1];
    });
    // Twin gun barrel
    this.batch.line(a.x + ca * 3, a.y + sa * 3, a.x + ca * 9.5, a.y + sa * 9.5, "#3e3c4c");
    this.batch.put(a.x + ca * 9.5, a.y + sa * 9.5, pulse ? "#ffe066" : "#ffddaa");
  }

  private mine(a: Encounter, time: number): void {
    const armed = a.charge > 0;
    const blink = armed ? Math.sin(time * (14 + a.charge * 20)) > 0 : Math.sin(time * 3 + a.phase) > 0.6;
    // Contact prongs
    for (let k = 0; k < 4; k++) {
      const ang = (k * Math.PI) / 2;
      this.batch.line(a.x, a.y, a.x + Math.cos(ang) * 6, a.y + Math.sin(ang) * 6, MINE_PAL[0]);
    }
    this.batch.disc(a.x, a.y, 4.4, (dx, dy, edge) => {
      if (edge) return MINE_PAL[0];
      if (dx * dx + dy * dy < 3.5) return armed ? (blink ? MINE_PAL[4] : MINE_PAL[3]) : blink ? MINE_PAL[3] : MINE_PAL[1];
      return dx + dy < 0 ? MINE_PAL[2] : MINE_PAL[1];
    });
  }

  private grove(a: Encounter, time: number): void {
    const sway = Math.sin(time * 2.2 + a.phase) * 1.1;
    // 3 overlapping leafy frond clusters + glowing biomass pods
    for (let k = 0; k < 3; k++) {
      const ang = (k * Math.PI * 2) / 3 + a.phase * 0.5;
      const fx = a.x + Math.cos(ang) * 3 + sway * 0.5;
      const fy = a.y + Math.sin(ang) * 3;
      this.batch.disc(fx, fy, 3.6, (dx, dy, edge) => (edge ? GROVE_PAL[0] : dx + dy < 0 ? GROVE_PAL[3] : GROVE_PAL[2]));
    }
    this.batch.disc(a.x + sway, a.y, 2.8, (_dx, _dy, edge) => (edge ? GROVE_PAL[1] : GROVE_PAL[4]));
  }

  private boss(a: Encounter, time: number): void {
    const hpRatio = Math.max(0, a.hp) / a.maxHp;
    const enraged = hpRatio <= 0.3;
    const exposed = hpRatio <= 0.6;
    const ca = Math.cos(a.aimAngle);
    const sa = Math.sin(a.aimAngle);
    const px = -sa;
    const py = ca;
    const pulse = Math.sin(time * (enraged ? 14 : 5));

    // 6 articulated biomechanical tentacles / stabilizer arms
    for (const side of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        const baseAng = a.aimAngle + side * (1.2 + k * 0.55);
        const wag = Math.sin(time * (enraged ? 7 : 3.5) + k * 1.4 + side) * 3.5;
        const mx = a.x + Math.cos(baseAng) * 14;
        const my = a.y + Math.sin(baseAng) * 14;
        const tx = a.x + Math.cos(baseAng) * 23 + px * wag;
        const ty = a.y + Math.sin(baseAng) * 23 + py * wag;
        this.batch.line(a.x + Math.cos(baseAng) * 8, a.y + Math.sin(baseAng) * 8, mx, my, BOSS_PAL[0]);
        this.batch.line(mx, my, tx, ty, enraged ? BOSS_PAL[3] : BOSS_PAL[1]);
        this.batch.disc(tx, ty, 2, () => (enraged ? BOSS_PAL[4] : BOSS_PAL[2]));
      }
    }

    // Outer segmented carapace (splits outward as phases progress)
    const split = exposed ? 2.5 : 0;
    for (const side of [-1, 1]) {
      this.batch.disc(a.x + px * side * (6 + split), a.y + py * side * (6 + split), 10.5, (dx, dy, edge) => {
        if (edge) return BOSS_PAL[0];
        const ridge = (dx + dy) % 3 === 0;
        return enraged ? (ridge ? BOSS_PAL[3] : BOSS_PAL[1]) : ridge ? BOSS_PAL[2] : BOSS_PAL[1];
      });
    }

    // Exposed pulsing Leviathan Core & matrix eye
    this.batch.disc(a.x, a.y, exposed ? 10.5 : 8.5, (dx, dy, edge) => {
      if (edge) return BOSS_PAL[0];
      const r2 = dx * dx + dy * dy;
      if (r2 < 9) return enraged && pulse > 0 ? "#ffffff" : "#ffe0f0";
      if (r2 < 36) return enraged ? BOSS_PAL[4] : BOSS_PAL[3];
      return BOSS_PAL[2];
    });

    // Twin forward plasma cannons
    for (const side of [-1, 1]) {
      const bx = a.x + ca * 6 + px * side * 6;
      const by = a.y + sa * 6 + py * side * 6;
      const ex = bx + ca * 13;
      const ey = by + sa * 13;
      this.batch.line(bx, by, ex, ey, "#382838");
      this.batch.disc(ex, ey, 2.2, () => (enraged ? "#ffe066" : "#d4a644"));
    }
  }

  /** Post-fog overlay rendering so critical warnings remain readable through fog. */
  drawOverlay(ctx: Ctx, cam: CameraSystem, actors: readonly Encounter[], cellSize: number): void {
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
