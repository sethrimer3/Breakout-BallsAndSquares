import type { CameraSystem } from "../systems/CameraSystem";
import { WARDEN, type BlightWardenSystem, type Warden, type WardenSpit } from "../systems/BlightWardens";
import type { SpecialUpgradeSystem } from "../systems/SpecialUpgrades";
import { generatorColors } from "../world/GeneratorTiers";
import { PixelBatch } from "./CreatureRenderer";

/**
 * Procedural pixel art for the Blight Wardens: a lumpy pink mass ringed by
 * writhing tendrils, crowned with spikes in its tier's colors (the same
 * scheme as the generators), with one bone-white eye that tracks its prey.
 * Each gold block they guard is wrapped in a pulsing membrane of veins,
 * tethered to every warden still alive.
 */

const PINK = ["#3a0820", "#5a0f36", "#9c1c58", "#d8267a", "#ff4b8b", "#ff9cc8"] as const;
const BONE = ["#2a2420", "#b8ac98", "#efe6d4"] as const;

function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export class WardenRenderer {
  private batch = new PixelBatch();
  private glow = new PixelBatch();

  draw(ctx: CanvasRenderingContext2D, cam: CameraSystem, sys: BlightWardenSystem, specials: SpecialUpgradeSystem, time: number): void {
    if (sys.wardens.length === 0) return;
    const margin = 40;
    const x0 = cam.screenToWorldX(0) - margin;
    const y0 = cam.screenToWorldY(0) - margin;
    const x1 = cam.screenToWorldX(cam.viewW) + margin;
    const y1 = cam.screenToWorldY(cam.viewH) + margin;
    const visible = (x: number, y: number): boolean => x >= x0 && y >= y0 && x <= x1 && y <= y1;

    for (const b of specials.blocks) {
      if (b.broken || !sys.isGuarded(b.id)) continue;
      const hx = (b.x0 + b.x1) / 2, hy = (b.y0 + b.y1) / 2;
      if (!visible(hx, hy)) continue;
      this.membrane(b.x0, b.y0, b.x1 - b.x0, time, b.cx * 7 + b.cy);
      for (const w of sys.wardens) if (w.alive && w.blockId === b.id) this.tether(hx, hy, w, time);
    }
    for (const w of sys.wardens) if (w.alive && visible(w.x, w.y)) this.warden(w, time);
    for (const s of sys.spits) if (visible(s.x, s.y)) this.spit(s);
    this.batch.flush(ctx, cam);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    this.glow.flush(ctx, cam);
    ctx.restore();
    // Health bars over wounded wardens.
    for (const w of sys.wardens) {
      if (!w.alive || w.hp >= w.maxHp || !visible(w.x, w.y)) continue;
      const bw = 14 * cam.zoom, bh = Math.max(2, 1.5 * cam.zoom);
      const sx = cam.worldToScreenX(w.x) - bw / 2;
      const sy = cam.worldToScreenY(w.y - WARDEN.hitRadius - 5);
      ctx.fillStyle = "#1a0610";
      ctx.fillRect(Math.round(sx - 1), Math.round(sy - 1), Math.round(bw + 2), Math.round(bh + 2));
      ctx.fillStyle = "#ff4b8b";
      ctx.fillRect(Math.round(sx), Math.round(sy), Math.round(bw * Math.max(0, w.hp / w.maxHp)), Math.round(bh));
    }
  }

  /**
   * A cage of Blight wrapped round a guarded gold block: a knotted rim and a
   * few veins across its face, sparse enough that the gold still shows.
   */
  private membrane(x0: number, y0: number, size: number, t: number, seed: number): void {
    const n = Math.round(size);
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.2 + seed);
    for (let k = 0; k < n; k++) {
      // Rim: every other pixel, so it reads as sinew over the gold edge.
      const c = (k + seed) % 2 ? PINK[2] : PINK[1];
      if ((k + seed) % 3 !== 0) {
        this.batch.put(x0 + k, y0, c);
        this.batch.put(x0 + k, y0 + n - 1, c);
        this.batch.put(x0, y0 + k, c);
        this.batch.put(x0 + n - 1, y0 + k, c);
      }
      // Two crossing veins that throb with the pulse.
      const vc = pulse > 0.65 ? PINK[4] : PINK[3];
      const wob = Math.round(Math.sin(k * 0.9 + seed) * 0.8);
      if (k > 0 && k < n - 1) {
        this.batch.put(x0 + k, y0 + Math.min(n - 2, Math.max(1, k + wob)), vc);
        this.batch.put(x0 + k, y0 + Math.min(n - 2, Math.max(1, n - 1 - k + wob)), k % 2 ? vc : PINK[2]);
      }
    }
    for (const [cx, cy] of [[0, 0], [n - 1, 0], [0, n - 1], [n - 1, n - 1]]) {
      this.batch.put(x0 + cx, y0 + cy, PINK[1]);
      this.glow.put(x0 + cx, y0 + cy, pulse > 0.5 ? PINK[3] : PINK[1]);
    }
  }

  /** A sagging, pulsing cord from the block to a warden. */
  private tether(hx: number, hy: number, w: Warden, t: number): void {
    const dx = w.x - hx, dy = w.y - hy;
    const d = Math.hypot(dx, dy);
    if (d < 1) return;
    const steps = Math.ceil(d);
    const nx = -dy / d, ny = dx / d;
    const beat = (t * 1.6 + w.id * 0.3) % 1;
    for (let i = 0; i <= steps; i++) {
      const k = i / steps;
      const sag = Math.sin(k * Math.PI) * (2 + Math.sin(t * 1.3 + w.id) * 1.2);
      const x = hx + dx * k + nx * sag, y = hy + dy * k + ny * sag;
      if (Math.abs(k - beat) < 0.06) this.glow.put(x, y, PINK[4]);
      else if (i % 2 === 0) this.batch.put(x, y, PINK[1]);
    }
  }

  private warden(w: Warden, t: number): void {
    const b = this.batch;
    const hurt = w.hurt > 0;
    const windup = w.state === "windup" ? 1 - w.timer / WARDEN.lungeWindup : 0;
    const lunge = w.state === "lunge";
    const crown = generatorColors(w.tier);
    const ca = Math.cos(w.facing), sa = Math.sin(w.facing);
    const breathe = Math.sin(w.phase * 3) * 0.35;
    const R = WARDEN.radius + 0.5 + breathe + windup * 1.5;
    // Tendrils: eight writhing arms, pulled in during the windup.
    for (let k = 0; k < 8; k++) {
      const base = (k / 8) * Math.PI * 2 + w.phase * 0.25;
      const len = (4 + 3 * hash(w.id + k)) * (1 - windup * 0.6) * (lunge ? 0.5 : 1);
      let px = w.x + Math.cos(base) * R * 0.85, py = w.y + Math.sin(base) * R * 0.85;
      for (let s = 1; s <= 4; s++) {
        const curl = Math.sin(t * 3 + k * 1.7 + s * 0.8) * 0.5 * s;
        const a = base + curl * 0.35;
        const nx = px + Math.cos(a) * (len / 4), ny = py + Math.sin(a) * (len / 4);
        b.line(px, py, nx, ny, s < 3 ? PINK[2] : PINK[1]);
        px = nx;
        py = ny;
      }
      b.put(px, py, PINK[3]);
    }
    // Body: a lumpy disc, stretched along the facing while lunging.
    const stretch = lunge ? 1.35 : 1;
    const cx = w.x - 0.5, cy = w.y - 0.5;
    const rr = Math.ceil(R * stretch) + 1;
    for (let dy = -rr; dy <= rr; dy++) {
      for (let dx = -rr; dx <= rr; dx++) {
        // Into the warden's frame: u along facing, v across.
        const u = (dx * ca + dy * sa) / stretch;
        const v = -dx * sa + dy * ca;
        const ang = Math.atan2(v, u);
        const lump = R + Math.sin(ang * 5 + w.phase * 1.5) * 0.6 + Math.sin(ang * 3 - w.phase) * 0.4;
        const d = Math.hypot(u, v);
        if (d > lump) continue;
        let c: string;
        if (hurt) c = d > lump - 1 ? PINK[4] : PINK[5];
        else if (d > lump - 1) c = PINK[0];
        else {
          // Lit from the upper left: highlight, base, then a dark underside.
          const lx = (dx + dy) / (R * 1.6);
          const spot = hash(Math.floor(u * 0.5 + 50) * 31 + Math.floor(v * 0.5 + 50) + w.id * 7) > 0.93;
          if (spot) c = PINK[1];
          else if (lx < -0.45 && d < lump - 1.5) c = PINK[4];
          else if (lx < 0) c = PINK[3];
          else if (lx < 0.45) c = PINK[2];
          else c = PINK[1];
        }
        b.put(cx + dx + 0.5, cy + dy + 0.5, c);
      }
    }
    // Crown of spikes on the back, in the tier's colors.
    for (let k = -2; k <= 2; k++) {
      const a = w.facing + Math.PI + k * 0.42;
      const r0 = R - 0.5, r1 = R + 3 - Math.abs(k) * 0.6;
      b.line(w.x + Math.cos(a) * r0, w.y + Math.sin(a) * r0, w.x + Math.cos(a) * r1, w.y + Math.sin(a) * r1, crown[1]);
      b.put(w.x + Math.cos(a) * r1, w.y + Math.sin(a) * r1, crown[2]);
    }
    // One eye that tracks its prey; it flares white in the windup.
    const ex = w.x + ca * R * 0.4, ey = w.y + sa * R * 0.4;
    b.disc(ex - 0.5, ey - 0.5, 2.8, (dx, dy, edge) => (edge ? BONE[0] : dx + dy < -1 ? BONE[2] : BONE[1]));
    const iris = windup > 0 || lunge ? "#ffffff" : PINK[4];
    const ix = ex + ca * 1.1, iy = ey + sa * 1.1;
    b.put(ix, iy, PINK[0]);
    b.put(ix + 1, iy, PINK[0]);
    b.put(ix, iy + 1, PINK[0]);
    b.put(ix + 1, iy + 1, PINK[0]);
    this.glow.put(ix, iy, iris);
    // A gaping maw opens under the eye during a lunge.
    if (lunge || windup > 0.5) {
      const mx = w.x + ca * (R - 1), my = w.y + sa * (R - 1);
      for (let s = -3; s <= 3; s++) {
        b.put(mx - sa * s, my + ca * s, PINK[0]);
        b.put(mx - sa * s - ca, my + ca * s - sa, PINK[0]);
      }
      for (const s of [-3, -1, 1, 3]) b.put(mx - sa * s + ca, my + ca * s + sa, BONE[2]);
    }
  }

  /** A wobbling blob of spore pulp with a short glowing wake. */
  private spit(s: WardenSpit): void {
    const g = this.glow;
    this.batch.disc(s.x - 0.5, s.y - 0.5, 1.6, (_dx, _dy, edge) => (edge ? PINK[1] : PINK[3]));
    g.put(s.x, s.y, PINK[5]);
    const sp = Math.hypot(s.vx, s.vy) || 1;
    for (let k = 1; k <= 3; k++) g.put(s.x - (s.vx / sp) * k * 1.6, s.y - (s.vy / sp) * k * 1.6, PINK[k === 1 ? 3 : 2]);
  }
}
