import { ART_PIXEL, OVERCHARGE } from "../config";
import type { Game } from "../Game";
import type { CameraSystem } from "../systems/CameraSystem";
import type { OverchargeEntry } from "../systems/OverchargeSystem";
import { bayer, drawPixelSprite, fillArtPixel, forEachLinePixel, pixelDiscSprite } from "./pixelFx";

/**
 * Overcharge Conductor visuals, all on the art-pixel grid and blended
 * additively so they read as light:
 * - charged rounds: short pixel trails with a white head;
 * - charged blocks: the block itself fills with dithered electricity, crawling
 *   veins and a glowing outline that heats up toward discharge (creatures and
 *   late-world encounters get a pixel glow disc instead);
 * - discharge: a pixel electric explosion (flash, jagged shock ring, radial bolts, sparks);
 * - chain lightning: jagged forked pixel bolts with a cyan halo and impact flare.
 */

const CORE = "#f0fcff";
const HALO = "#52d8ff";
const DEEP = "#1d6f9a";
const BRIGHT = "#8af0ff";

/** Small integer hash → [0, 1). Stable for the same inputs. */
function hash3(a: number, b: number, c: number): number {
  let h = (Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Deterministic random stream for one effect instance. */
function stream(seed: number): () => number {
  let i = 0;
  return () => hash3(seed, i++, 0x5bd1e995);
}

export function drawOvercharge(ctx: CanvasRenderingContext2D, game: Game, reduced: boolean): void {
  const cam = game.camera;
  const now = reduced ? 0 : performance.now() / 1000;
  const tick = Math.floor(now * 14);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";

  for (const b of game.combat.bullets.items) {
    if (!b.active || !b.overcharge) continue;
    const x = cam.worldToScreenX(b.x);
    const y = cam.worldToScreenY(b.y);
    if (x < -16 || y < -16 || x > cam.viewW + 16 || y > cam.viewH + 16) continue;
    const tail = Math.min(5, b.traveled);
    ctx.fillStyle = HALO;
    forEachLinePixel(b.x - b.dx * tail, b.y - b.dy * tail, b.x, b.y, (gx, gy, t) => {
      ctx.globalAlpha = 0.25 + 0.7 * t;
      fillArtPixel(ctx, cam, gx, gy);
    });
    ctx.globalAlpha = 1;
    ctx.fillStyle = CORE;
    fillArtPixel(ctx, cam, Math.floor(b.x / ART_PIXEL), Math.floor(b.y / ART_PIXEL));
  }

  const cs = game.world.cellSize;
  const ss = game.world.subCellSize;
  for (const e of game.combat.overcharge.entries) {
    if (!e.active) continue;
    const x = cam.worldToScreenX(e.x);
    const y = cam.worldToScreenY(e.y);
    if (x < -32 || y < -32 || x > cam.viewW + 32 || y > cam.viewH + 32) continue;
    if (e.kind === "cell") drawChargedBlock(ctx, cam, e, e.cx * cs, e.cy * cs, cs, tick, reduced);
    else if (e.kind === "subcell") drawChargedBlock(ctx, cam, e, e.sx * ss, e.sy * ss, ss, tick, reduced);
    else drawChargedBody(ctx, cam, e, now, reduced);
  }

  for (const bl of game.combat.overcharge.blasts) {
    if (!bl.active) continue;
    const pad = bl.radius * 1.4 * cam.zoom + 8;
    const x = cam.worldToScreenX(bl.x);
    const y = cam.worldToScreenY(bl.y);
    if (x < -pad || y < -pad || x > cam.viewW + pad || y > cam.viewH + pad) continue;
    drawElectricExplosion(ctx, cam, bl.x, bl.y, bl.radius, bl.life, bl.maxLife, bl.stacks, tick, reduced);
  }

  for (const arc of game.combat.overcharge.arcs) {
    if (!arc.active) continue;
    const pad = 16;
    const sx1 = cam.worldToScreenX(arc.x1), sy1 = cam.worldToScreenY(arc.y1);
    const sx2 = cam.worldToScreenX(arc.x2), sy2 = cam.worldToScreenY(arc.y2);
    if (Math.max(sx1, sx2) < -pad || Math.min(sx1, sx2) > cam.viewW + pad ||
        Math.max(sy1, sy2) < -pad || Math.min(sy1, sy2) > cam.viewH + pad) continue;
    const fade = Math.max(0, arc.life / Math.max(1e-4, arc.maxLife));
    const alpha = reduced ? 0.85 : Math.min(1, fade * 1.3);
    // Re-roll the bolt's shape ~30 times a second as it fades (static under reduced motion).
    const seed = (Math.floor(arc.x1) * 7919) ^ (Math.floor(arc.y2) * 104729) ^ (reduced ? 0 : Math.floor(arc.life * 30));
    drawPixelBolt(ctx, cam, arc.x1, arc.y1, arc.x2, arc.y2, seed, alpha, arc.stacks >= 8, true);
  }

  ctx.restore();
}

/**
 * A charged terrain block fills with electricity in its own square: a dithered
 * glow whose density follows the charge, crawling white veins, a glowing
 * outline, and (once armed) sparks leaking off its edges. Everything brightens
 * as the quiet timer runs out and the block is about to discharge.
 */
function drawChargedBlock(
  ctx: CanvasRenderingContext2D, cam: CameraSystem, e: OverchargeEntry,
  wx: number, wy: number, wsize: number, tick: number, reduced: boolean,
): void {
  const gx0 = Math.round(wx / ART_PIXEL);
  const gy0 = Math.round(wy / ART_PIXEL);
  const n = Math.max(2, Math.round(wsize / ART_PIXEL));
  const frac = Math.min(1, e.stacks / OVERCHARGE.maxChargeStacks);
  const armed = e.stacks >= OVERCHARGE.armThreshold;
  const urgency = armed ? 1 - Math.max(0, Math.min(1, e.quietLeft / OVERCHARGE.quietDelay)) : 0;
  const heat = Math.min(1, 0.25 + frac * 0.5 + urgency * 0.5);
  const slow = reduced ? 0 : tick >> 1;

  // 1) Electric fill: brightest at the block's heart, dithered toward its
  //    edges, with per-pixel crackle noise that shimmers over time.
  const mid = (n - 1) / 2;
  for (let j = 1; j < n - 1; j++) {
    for (let i = 1; i < n - 1; i++) {
      const d = Math.max(Math.abs(i - mid), Math.abs(j - mid)) / mid; // 0 center .. 1 edge
      const noise = hash3(gx0 + i, gy0 + j, slow);
      const v = heat * (1.1 - 0.7 * d) + (noise - 0.5) * 0.5;
      if (v < bayer(gx0 + i, gy0 + j) * 0.9) continue;
      if (v > 0.95) { ctx.fillStyle = CORE; ctx.globalAlpha = 0.85; }
      else if (v > 0.6) { ctx.fillStyle = BRIGHT; ctx.globalAlpha = 0.7; }
      else if (v > 0.3) { ctx.fillStyle = HALO; ctx.globalAlpha = 0.55; }
      else { ctx.fillStyle = DEEP; ctx.globalAlpha = 0.6; }
      fillArtPixel(ctx, cam, gx0 + i, gy0 + j);
    }
  }

  // 2) Glowing outline, pulsing faster as discharge nears.
  const pulse = reduced ? 1 : 0.7 + 0.3 * Math.sin(tick * (0.9 + urgency * 2.2));
  ctx.fillStyle = armed ? BRIGHT : HALO;
  ctx.globalAlpha = (armed ? 0.7 : 0.45) * pulse;
  for (let i = 0; i < n; i++) {
    fillArtPixel(ctx, cam, gx0 + i, gy0);
    fillArtPixel(ctx, cam, gx0 + i, gy0 + n - 1);
    if (i > 0 && i < n - 1) {
      fillArtPixel(ctx, cam, gx0, gy0 + i);
      fillArtPixel(ctx, cam, gx0 + n - 1, gy0 + i);
    }
  }

  // 3) Crawling veins: short random walks across the block, re-rolled each tick.
  const veins = armed ? 2 + Math.floor(frac * 2 + urgency * 2) : 1;
  const rnd = stream(gx0 * 92821 + gy0 * 68917 + tick * 131);
  ctx.fillStyle = CORE;
  for (let v = 0; v < veins; v++) {
    let px = 1 + Math.floor(rnd() * (n - 2));
    let py = 1 + Math.floor(rnd() * (n - 2));
    let dir = Math.floor(rnd() * 4);
    const len = Math.max(2, Math.round(n * (0.6 + 0.6 * rnd())));
    for (let s = 0; s < len; s++) {
      ctx.globalAlpha = (armed ? 0.95 : 0.6) * (0.55 + 0.45 * (s / len));
      fillArtPixel(ctx, cam, gx0 + px, gy0 + py);
      if (rnd() < 0.45) dir = (dir + (rnd() < 0.5 ? 1 : 3)) & 3;
      px += dir === 0 ? 1 : dir === 2 ? -1 : 0;
      py += dir === 1 ? 1 : dir === 3 ? -1 : 0;
      if (px < 0 || py < 0 || px >= n || py >= n) break;
    }
  }

  // 4) Armed blocks leak sparks just outside their edges.
  if (armed) {
    const sparks = 1 + Math.floor(heat * 3);
    ctx.fillStyle = BRIGHT;
    for (let s = 0; s < sparks; s++) {
      const side = Math.floor(rnd() * 4);
      const along = Math.floor(rnd() * n);
      const out = 1 + Math.floor(rnd() * 2);
      const sx = side === 0 ? -out : side === 1 ? n - 1 + out : along;
      const sy = side === 2 ? -out : side === 3 ? n - 1 + out : along;
      ctx.globalAlpha = 0.5 + 0.4 * rnd();
      fillArtPixel(ctx, cam, gx0 + sx, gy0 + sy);
    }
  }
}

/** Creatures and encounters have no block shape: a pixel glow disc with spark ticks. */
function drawChargedBody(ctx: CanvasRenderingContext2D, cam: CameraSystem, e: OverchargeEntry, now: number, reduced: boolean): void {
  const frac = Math.min(1, e.stacks / OVERCHARGE.maxChargeStacks);
  const armed = e.stacks >= OVERCHARGE.armThreshold;
  const glowR = Math.max(2, 4 + frac * 6);
  ctx.globalAlpha = 0.24 + frac * 0.44;
  drawPixelSprite(ctx, cam, pixelDiscSprite(glowR / ART_PIXEL, armed ? 0x6ce5ff : 0x3fa8e8, 0), e.x, e.y);
  const accents = armed ? Math.min(6, 2 + Math.floor((e.stacks - OVERCHARGE.armThreshold) / 2)) : 1;
  const phase = reduced ? 0 : now * 4;
  ctx.globalAlpha = armed ? 0.85 : 0.5;
  ctx.fillStyle = armed ? "#d8f9ff" : "#7dd6ff";
  for (let i = 0; i < accents; i++) {
    const a = phase + (i * Math.PI * 2) / accents;
    const r0 = glowR * 0.65;
    const r1 = glowR * (armed ? 1.25 : 0.95);
    forEachLinePixel(e.x + Math.cos(a) * r0, e.y + Math.sin(a) * r0,
      e.x + Math.cos(a + 0.18) * r1, e.y + Math.sin(a + 0.18) * r1,
      (gx, gy) => fillArtPixel(ctx, cam, gx, gy));
  }
}

/**
 * Pixel electric explosion over the blast's lifetime: a white-hot flash that
 * collapses fast, a jagged shock ring racing outward, forked bolts from the
 * center to the ring and a scatter of sparks, all fading together.
 */
function drawElectricExplosion(
  ctx: CanvasRenderingContext2D, cam: CameraSystem,
  x: number, y: number, radius: number, life: number, maxLife: number, stacks: number,
  tick: number, reduced: boolean,
): void {
  const p = reduced ? 0.4 : 1 - Math.max(0, Math.min(1, life / Math.max(1e-4, maxLife)));
  const fade = reduced ? 0.75 : 1 - p * p;
  const ease = 1 - (1 - p) * (1 - p);
  const ringR = radius * (0.3 + 0.7 * ease);
  const seed = Math.floor(x) * 31337 + Math.floor(y) * 7331;
  const rnd = stream(seed + (reduced ? 0 : tick) * 17);

  // 1) Flash: a dithered white-cyan disc that shrinks away in the first third.
  if (p < 0.4) {
    ctx.globalAlpha = 1 - p / 0.4;
    drawPixelSprite(ctx, cam, pixelDiscSprite(Math.max(2, radius * 0.5 * (1 - p)) / ART_PIXEL, 0x8af0ff, 1), x, y);
  }

  // 2) Jagged shock ring: one pixel per step around the circle, nudged in or out.
  const gcx = Math.floor(x / ART_PIXEL);
  const gcy = Math.floor(y / ART_PIXEL);
  const rg = ringR / ART_PIXEL;
  const steps = Math.max(12, Math.ceil(Math.PI * 2 * rg));
  const seen = new Set<number>();
  for (let k = 0; k < steps; k++) {
    const a = (k / steps) * Math.PI * 2;
    const jag = (hash3(seed, k >> 1, reduced ? 0 : tick) - 0.5) * 2.2;
    const r = rg + jag;
    const gx = gcx + Math.round(Math.cos(a) * r);
    const gy = gcy + Math.round(Math.sin(a) * r);
    const key = (gx << 16) ^ (gy & 0xffff);
    if (seen.has(key)) continue;
    seen.add(key);
    ctx.fillStyle = jag > 0.6 ? CORE : BRIGHT;
    ctx.globalAlpha = fade * (jag > 0.6 ? 1 : 0.8);
    fillArtPixel(ctx, cam, gx, gy);
    // A dimmer inner echo pixel thickens the ring.
    if ((k & 1) === 0) {
      ctx.fillStyle = HALO;
      ctx.globalAlpha = fade * 0.45;
      fillArtPixel(ctx, cam, gcx + Math.round(Math.cos(a) * (r - 1.5)), gcy + Math.round(Math.sin(a) * (r - 1.5)));
    }
  }

  // 3) Forked bolts from the center out to the ring.
  const bolts = 4 + Math.min(4, Math.max(0, Math.floor((stacks - OVERCHARGE.armThreshold) / 2)));
  const spin = rnd() * Math.PI * 2;
  for (let i = 0; i < bolts; i++) {
    const a = spin + (i / bolts) * Math.PI * 2 + (rnd() - 0.5) * 0.6;
    const len = ringR * (0.75 + 0.35 * rnd());
    drawPixelBolt(ctx, cam, x, y, x + Math.cos(a) * len, y + Math.sin(a) * len, seed + i * 101 + (reduced ? 0 : tick), fade * 0.9, false, false);
  }

  // 4) Sparks thrown past the ring.
  ctx.fillStyle = BRIGHT;
  const sparks = 8 + bolts;
  for (let i = 0; i < sparks; i++) {
    const a = rnd() * Math.PI * 2;
    const r = ringR * (0.6 + 0.7 * rnd());
    ctx.globalAlpha = fade * (0.4 + 0.6 * rnd());
    fillArtPixel(ctx, cam, gcx + Math.round(Math.cos(a) * r / ART_PIXEL), gcy + Math.round(Math.sin(a) * r / ART_PIXEL));
  }
}

/**
 * Pixel lightning between two world points: a jagged midpoint-displaced path
 * with optional side forks, drawn as a white one-pixel core inside a cyan halo
 * (two rings wide when `heavy`), plus an impact flare at the far end when `flare`.
 */
function drawPixelBolt(
  ctx: CanvasRenderingContext2D, cam: CameraSystem,
  x1: number, y1: number, x2: number, y2: number,
  seed: number, alpha: number, heavy: boolean, flare: boolean,
): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const nx = -uy, ny = ux;
  const rnd = stream(seed);
  const segs = Math.max(2, Math.min(12, Math.round(len / 5)));
  const amp = Math.min(3.5, len * 0.16);

  const core = new Set<number>();
  const cells: number[] = [];
  const addLine = (ax: number, ay: number, bx: number, by: number): void => {
    forEachLinePixel(ax, ay, bx, by, (gx, gy) => {
      const key = (gx << 16) ^ (gy & 0xffff);
      if (!core.has(key)) { core.add(key); cells.push(gx, gy); }
    });
  };

  // Main channel.
  const pts: number[] = [x1, y1];
  for (let k = 1; k < segs; k++) {
    const t = k / segs;
    const off = (rnd() * 2 - 1) * amp * Math.sin(t * Math.PI);
    pts.push(x1 + dx * t + nx * off, y1 + dy * t + ny * off);
  }
  pts.push(x2, y2);
  for (let i = 0; i + 3 < pts.length; i += 2) addLine(pts[i], pts[i + 1], pts[i + 2], pts[i + 3]);
  const mainCount = cells.length;

  // Side forks off interior joints.
  const forks = len > 10 ? 1 + Math.floor(rnd() * Math.min(3, len / 14)) : 0;
  for (let f = 0; f < forks; f++) {
    const j = 1 + Math.floor(rnd() * (segs - 1));
    const fx = pts[j * 2], fy = pts[j * 2 + 1];
    const side = rnd() < 0.5 ? -1 : 1;
    const flen = 3 + rnd() * Math.min(6, len * 0.25);
    const ang = 0.5 + rnd() * 0.6;
    const ex = fx + (ux * Math.cos(ang) + nx * side * Math.sin(ang)) * flen;
    const ey = fy + (uy * Math.cos(ang) + ny * side * Math.sin(ang)) * flen;
    const mx = (fx + ex) / 2 + nx * side * (rnd() - 0.5) * 2;
    const my = (fy + ey) / 2 + ny * side * (rnd() - 0.5) * 2;
    addLine(fx, fy, mx, my);
    addLine(mx, my, ex, ey);
  }

  // Halo rings around the main channel only, so forks stay thin.
  const halo = new Set<number>();
  const reach = heavy ? 2 : 1;
  for (let ring = reach; ring >= 1; ring--) {
    ctx.fillStyle = ring === 1 ? HALO : DEEP;
    ctx.globalAlpha = alpha * (ring === 1 ? 0.65 : 0.5);
    for (let i = 0; i < mainCount; i += 2) {
      for (let oy = -ring; oy <= ring; oy++) {
        for (let ox = -ring; ox <= ring; ox++) {
          if (Math.abs(ox) + Math.abs(oy) !== ring) continue;
          const gx = cells[i] + ox, gy = cells[i + 1] + oy;
          const key = (gx << 16) ^ (gy & 0xffff);
          if (core.has(key) || halo.has(key)) continue;
          halo.add(key);
          if (ring > 1 && bayer(gx, gy) > 0.5) continue;
          fillArtPixel(ctx, cam, gx, gy);
        }
      }
    }
  }

  // Core: main channel full white, forks a little dimmer.
  ctx.fillStyle = CORE;
  for (let i = 0; i < cells.length; i += 2) {
    ctx.globalAlpha = alpha * (i < mainCount ? 1 : 0.7);
    fillArtPixel(ctx, cam, cells[i], cells[i + 1]);
  }

  // Impact flare: a small pixel plus where the bolt lands.
  if (flare) {
    const gx = Math.floor(x2 / ART_PIXEL), gy = Math.floor(y2 / ART_PIXEL);
    ctx.fillStyle = BRIGHT;
    ctx.globalAlpha = alpha * 0.8;
    fillArtPixel(ctx, cam, gx - 2, gy); fillArtPixel(ctx, cam, gx + 2, gy);
    fillArtPixel(ctx, cam, gx, gy - 2); fillArtPixel(ctx, cam, gx, gy + 2);
    ctx.fillStyle = CORE;
    ctx.globalAlpha = alpha;
    fillArtPixel(ctx, cam, gx - 1, gy); fillArtPixel(ctx, cam, gx + 1, gy);
    fillArtPixel(ctx, cam, gx, gy - 1); fillArtPixel(ctx, cam, gx, gy + 1);
  }
}
