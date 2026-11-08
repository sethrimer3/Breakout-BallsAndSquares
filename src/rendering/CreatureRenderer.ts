import { CREATURES, WORLD } from "../config";
import type { CreatureSystem, Flower, Specimen, Spore, Worm } from "../entities/Creatures";
import type { CameraSystem } from "../systems/CameraSystem";

/**
 * Procedural pixel art for the Blight's creatures. Every creature is rebuilt
 * each frame from a handful of animation values (phase, charge, a segment
 * chain), rasterized onto the world's one-unit pixel grid and drawn as crisp
 * squares, so they match the terrain and soldier sprites at any zoom.
 */

type Ctx = CanvasRenderingContext2D;

const PINK = ["#5a0f36", "#9c1c58", "#d8267a", "#ff4b8b", "#ff9cc8", "#ffe0f0"] as const;
const WILT = ["#241a2c", "#3a2a46", "#544063", "#6e5a7c", "#8a7896", "#a898b0"] as const;
const SPECIMEN = ["#0d2a22", "#1d5244", "#2f8a6c", "#56c49a", "#a8f0cf"] as const;

/** Collects one frame's pixels, then draws them as screen rects. */
class PixelBatch {
  private xs: number[] = [];
  private ys: number[] = [];
  private cs: string[] = [];

  put(x: number, y: number, c: string): void {
    this.xs.push(Math.floor(x));
    this.ys.push(Math.floor(y));
    this.cs.push(c);
  }

  /** A filled disc of radius `r` centered at (x, y), shaded by `shade(dx, dy)`. */
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

  /** A one-pixel line (Bresenham) between two points. */
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
    const z = cam.zoom;
    const size = Math.max(1, Math.ceil(z));
    let last = "";
    for (let i = 0; i < this.xs.length; i++) {
      const c = this.cs[i];
      if (c !== last) {
        ctx.fillStyle = c;
        last = c;
      }
      ctx.fillRect(Math.floor(cam.worldToScreenX(this.xs[i])), Math.floor(cam.worldToScreenY(this.ys[i])), size, size);
    }
    this.xs.length = 0;
    this.ys.length = 0;
    this.cs.length = 0;
  }
}

export class CreatureRenderer {
  private batch = new PixelBatch();
  private glow = new PixelBatch();

  draw(ctx: Ctx, cam: CameraSystem, sys: CreatureSystem, time: number): void {
    const margin = 24;
    const x0 = cam.screenToWorldX(0) - margin;
    const y0 = cam.screenToWorldY(0) - margin;
    const x1 = cam.screenToWorldX(cam.viewW) + margin;
    const y1 = cam.screenToWorldY(cam.viewH) + margin;
    const visible = (x: number, y: number): boolean => x >= x0 && y >= y0 && x <= x1 && y <= y1;

    for (const f of sys.flowers) if (visible(f.hx, f.hy)) this.flower(f, time);
    for (const w of sys.worms) if (visible(w.seg[0], w.seg[1])) this.worm(w, time);
    for (const s of sys.specimens) if (visible(s.x, s.y)) this.specimen(s, time);
    for (const s of sys.spores) if (visible(s.x, s.y)) this.spore(s, time);
    this.batch.flush(ctx, cam);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    this.glow.flush(ctx, cam);
    ctx.restore();
  }

  /**
   * A stem that sways from its root, a bulb of petals that spread as it
   * charges a spore, and droops gray once its colony is cut off.
   */
  private flower(f: Flower, t: number): void {
    const b = this.batch;
    const pal = f.wilt > 0.5 ? WILT : PINK;
    const px = -f.dy;
    const py = f.dx;
    const len = 2 + f.grow * 8;
    const sway = (1 - f.wilt) * 1.3;
    // Wilting bends the stem over to one side.
    const droop = f.wilt * 0.9;
    let hx = f.x;
    let hy = f.y;
    const n = Math.max(2, Math.round(len));
    for (let i = 0; i <= n; i++) {
      const k = i / n;
      const off = Math.sin(t * 2.1 + f.seed + i * 0.55) * sway * k + droop * k * k * len * 0.6;
      hx = f.x + f.dx * i * (1 - droop * 0.35 * k) + px * off;
      hy = f.y + f.dy * i * (1 - droop * 0.35 * k) + py * off;
      b.put(hx, hy, i < 2 ? pal[1] : pal[2]);
      // Leaf nubs halfway up.
      if (i === Math.floor(n / 2) && f.grow > 0.6) {
        b.put(hx + px, hy + py, pal[2]);
        b.put(hx - px * 2, hy - py * 2, pal[1]);
      }
    }
    if (f.grow < 0.4) return;
    // Head: a dark bulb ringed by petals that spread with the charge.
    const open = f.wilt > 0.5 ? 0.2 : 0.35 + f.charge * 0.65;
    const petals = 5;
    const spin = t * 0.6 + f.seed;
    for (let p = 0; p < petals; p++) {
      const a = spin + (p / petals) * Math.PI * 2;
      const r0 = 2;
      const r1 = 2 + open * 3.4;
      for (let r = r0; r <= r1; r += 0.9) {
        b.put(hx + Math.cos(a) * r, hy + Math.sin(a) * r, r > r1 - 0.9 ? pal[4] : pal[3]);
      }
    }
    b.disc(hx - 0.5, hy - 0.5, 2.3, (dx, dy, edge) => (edge ? pal[1] : dx + dy < 0 ? pal[2] : pal[0]));
    if (f.wilt < 0.5) {
      // The spore swells in the throat as it charges.
      const c = f.charge > 0.66 ? PINK[5] : f.charge > 0.25 ? PINK[4] : PINK[3];
      this.glow.put(hx, hy, c);
      if (f.charge > 0.5) {
        this.glow.put(hx + 1, hy, PINK[3]);
        this.glow.put(hx, hy + 1, PINK[3]);
      }
    }
  }

  /** A tapering segmented body with a peristaltic swell rolling tail-ward. */
  private worm(w: Worm, t: number): void {
    const b = this.batch;
    const n = CREATURES.wormSegments;
    const seg = w.seg;
    const hurt = w.hurt > 0;
    for (let k = n - 1; k >= 0; k--) {
      const x = seg[k * 2];
      const y = seg[k * 2 + 1];
      const along = k / (n - 1);
      const swell = 0.45 * Math.max(0, Math.sin(w.phase * 1.4 - k * 0.9));
      const r = (2.8 - along * 1.5 + swell) * (w.burrow > 0 ? Math.max(0.3, w.burrow / 0.6) : 1);
      const band = k % 2 === 0;
      b.disc(x - 0.5, y - 0.5, r, (dx, dy, edge) => {
        if (hurt) return edge ? PINK[4] : PINK[5];
        if (edge) return PINK[0];
        // Light from the upper left, a darker band every other segment.
        const lit = dx + dy < -1 ? 4 : dx + dy < 1 ? 3 : 2;
        return PINK[band ? lit - 1 : lit];
      });
    }
    // Head: mandibles that open and close, and two glowing eye pits.
    const hx = seg[0];
    const hy = seg[1];
    const ca = Math.cos(w.angle);
    const sa = Math.sin(w.angle);
    const chew = Math.abs(Math.sin(t * 9 + w.id)) * 1.2;
    for (const side of [-1, 1]) {
      const mx = hx + ca * 2.6 - sa * side * (0.8 + chew);
      const my = hy + sa * 2.6 + ca * side * (0.8 + chew);
      b.put(mx, my, PINK[0]);
      b.put(mx + ca, my + sa, PINK[1]);
      this.glow.put(hx + ca * 1.2 - sa * side * 1.1, hy + sa * 1.2 + ca * side * 1.1, "#ffd27a");
    }
  }

  /**
   * A six-legged crawler. In its tank it floats curled up; once free its legs
   * step in alternating tripods driven by the distance it has covered.
   */
  private specimen(s: Specimen, t: number): void {
    const b = this.batch;
    const hurt = s.hurt > 0;
    if (!s.free) {
      // Still in its tank: murky specimen fluid with bubbles rising past it.
      const cx0 = s.spot.cx * WORLD.cellSize;
      const cy0 = s.spot.cy * WORLD.cellSize;
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) b.put(cx0 + x, cy0 + y, (x + y + s.seed) % 5 === 0 ? "#174e40" : "#123f35");
      }
      for (let k = 0; k < 3; k++) {
        const by = 7 - ((t * 5 + k * 2.7 + s.seed) % 8);
        this.glow.put(cx0 + ((k * 3 + s.seed) % 7), cy0 + by, "#1f5a4a");
      }
    }
    const bob = s.free ? Math.sin(s.gait * 2) * 0.4 : Math.sin(t * 1.6 + s.seed) * 1.2;
    const x = s.x;
    const y = s.y + bob;
    const ca = Math.cos(s.facing);
    const sa = Math.sin(s.facing);
    // Legs first, under the body.
    for (let i = 0; i < 3; i++) {
      for (const side of [-1, 1]) {
        const along = (i - 1) * 1.6;
        const hipX = x + ca * along - sa * side * 1.4;
        const hipY = y + sa * along + ca * side * 1.4;
        let reach = 3.2;
        let swing = 0;
        if (s.free) {
          const phase = s.gait + (i + (side > 0 ? 1 : 0)) * Math.PI;
          swing = Math.sin(phase) * 1.6;
          reach += Math.max(0, Math.cos(phase)) * 0.6;
        } else {
          reach = 2 + Math.sin(t * 2 + i + side) * 0.4; // curled
        }
        const kneeX = hipX - sa * side * reach * 0.6 + ca * (swing * 0.5);
        const kneeY = hipY + ca * side * reach * 0.6 + sa * (swing * 0.5);
        const footX = hipX - sa * side * reach + ca * (swing + (i - 1) * 0.8);
        const footY = hipY + ca * side * reach + sa * (swing + (i - 1) * 0.8);
        b.line(hipX, hipY, kneeX, kneeY, SPECIMEN[2]);
        b.line(kneeX, kneeY, footX, footY, SPECIMEN[1]);
      }
    }
    // Body: a segmented oval along the facing direction.
    for (let k = -1; k <= 1; k++) {
      const r = k === 1 ? 2.1 : k === 0 ? 2.6 : 2.2;
      b.disc(x + ca * k * 1.8 - 0.5, y + sa * k * 1.8 - 0.5, r, (dx, dy, edge) => {
        if (hurt) return edge ? SPECIMEN[3] : SPECIMEN[4];
        if (edge) return SPECIMEN[0];
        return dx + dy < -1 ? SPECIMEN[3] : dx + dy < 1 ? SPECIMEN[2] : SPECIMEN[1];
      });
    }
    // Eyes on the head end; they blink in the tank.
    const blink = !s.free && Math.sin(t * 0.9 + s.seed) > 0.96;
    if (!blink) {
      const ex = x + ca * 2.8;
      const ey = y + sa * 2.8;
      const eye = s.free ? "#ffef6a" : "#9affd6";
      this.glow.put(ex - sa * 0.9, ey + ca * 0.9, eye);
      this.glow.put(ex + sa * 0.9, ey - ca * 0.9, eye);
    }
  }

  /** A tumbling 2×2 spore with a faint glowing wake. */
  private spore(s: Spore, _t: number): void {
    const g = this.glow;
    const r = Math.floor(s.spin) % 4;
    const ox = r === 1 || r === 2 ? 1 : 0;
    const oy = r >= 2 ? 1 : 0;
    g.put(s.x - ox, s.y - oy, PINK[5]);
    g.put(s.x + 1 - ox, s.y - oy, PINK[4]);
    g.put(s.x - ox, s.y + 1 - oy, PINK[4]);
    g.put(s.x + 1 - ox, s.y + 1 - oy, PINK[3]);
    const sp = Math.hypot(s.vx, s.vy) || 1;
    for (let k = 1; k <= 3; k++) g.put(s.x - (s.vx / sp) * k * 1.5, s.y - (s.vy / sp) * k * 1.5, PINK[k === 1 ? 2 : 1]);
  }
}
