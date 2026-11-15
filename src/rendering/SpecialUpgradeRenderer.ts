import type { Soldier } from "../entities/Soldier";
import type { CameraSystem } from "../systems/CameraSystem";
import { SPECIAL_UPGRADE, type SpecialBlock, type SpecialUpgradeSystem } from "../systems/SpecialUpgrades";
import type { PixelWorld } from "../world/PixelWorld";
import { radialSprite } from "./sprites";

/**
 * Special upgrades are the one deliberate exception to the matte lab: a 3x3
 * block of glowing gold, ringed by drifting gold motes, that bursts into a
 * stream of motes flying into the nearest soldier when shot open.
 */

/** Art texels across the block (4 per cell, like the terrain). */
const ART = SPECIAL_UPGRADE.size * 4;

// 0 outline, 1 deep shadow, 2 shadow, 3 base, 4 light, 5 highlight.
const PALETTE = ["#4a2c05", "#8a5a0c", "#b9800f", "#e3ac25", "#f8d34f", "#fff4bd"];
const BLOCK_ART = [
  "000000000000",
  "055555555440",
  "054444444320",
  "054333333320",
  "054355553220",
  "054354443220",
  "054354433220",
  "054354333220",
  "054333332220",
  "043222222210",
  "032222222110",
  "000000000000",
];

/** Crack texels revealed as the block takes hits (index = hits taken - 1). */
const CRACKS: readonly (readonly [number, number])[][] = [
  [[8, 2], [8, 3], [9, 4]],
  [[3, 8], [4, 7], [4, 9], [2, 9]],
  [[6, 1], [6, 2], [7, 3], [5, 3], [9, 8], [10, 7], [8, 9]],
];

let blockCanvas: HTMLCanvasElement | null = null;
function blockSprite(): HTMLCanvasElement {
  if (blockCanvas) return blockCanvas;
  const c = document.createElement("canvas");
  c.width = ART;
  c.height = ART;
  const g = c.getContext("2d")!;
  BLOCK_ART.forEach((row, y) => {
    for (let x = 0; x < ART; x++) {
      g.fillStyle = PALETTE[+row[x]];
      g.fillRect(x, y, 1, 1);
    }
  });
  blockCanvas = c;
  return c;
}

let goldGlow: HTMLCanvasElement | null = null;
function glowSprite(): HTMLCanvasElement {
  return (goldGlow ??= radialSprite(64, [
    [0, "rgba(255, 236, 150, 0.95)"],
    [0.25, "rgba(255, 196, 60, 0.45)"],
    [0.6, "rgba(220, 140, 20, 0.12)"],
    [1, "rgba(160, 90, 0, 0)"],
  ]));
}

/** Small deterministic hash in [0, 1). */
function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function onScreen(cam: CameraSystem, b: SpecialBlock, pad: number): boolean {
  const x0 = cam.worldToScreenX(b.x0), y0 = cam.worldToScreenY(b.y0);
  const x1 = cam.worldToScreenX(b.x1), y1 = cam.worldToScreenY(b.y1);
  return x1 > -pad && y1 > -pad && x0 < cam.viewW + pad && y0 < cam.viewH + pad;
}

/** The empty dark plinth every spot sits on (also left behind once collected). */
export function drawSpecialPlinths(ctx: CanvasRenderingContext2D, cam: CameraSystem, world: PixelWorld): void {
  const cs = world.cellSize;
  const half = (SPECIAL_UPGRADE.size / 2 + 0.25) * cs;
  const u = Math.max(1, (cs / 4) * cam.zoom);
  for (const spot of world.upgradeSpots) {
    const x = cam.worldToScreenX((spot.cx + 0.5) * cs);
    const y = cam.worldToScreenY((spot.cy + 0.5) * cs);
    const r = half * cam.zoom;
    if (x < -r || y < -r || x > cam.viewW + r || y > cam.viewH + r) continue;
    ctx.fillStyle = "#0d0e11";
    ctx.fillRect(Math.round(x - r), Math.round(y - r), Math.round(r * 2), Math.round(r * 2));
    ctx.fillStyle = "#24252a";
    ctx.fillRect(Math.round(x - r + u), Math.round(y - r + u), Math.round(r * 2 - 2 * u), Math.round(r * 2 - 2 * u));
    ctx.fillStyle = "#3a2c12";
    ctx.fillRect(Math.round(x - r + 2 * u), Math.round(y - r + 2 * u), Math.round(r * 2 - 4 * u), Math.round(r * 2 - 4 * u));
    ctx.fillStyle = "#17181c";
    ctx.fillRect(Math.round(x - r + 3 * u), Math.round(y - r + 3 * u), Math.round(r * 2 - 6 * u), Math.round(r * 2 - 6 * u));
  }
}

/** The gold blocks themselves, drawn after lighting so they read as emissive. */
export function drawSpecialBlocks(ctx: CanvasRenderingContext2D, cam: CameraSystem, sys: SpecialUpgradeSystem, t: number): void {
  const sprite = blockSprite();
  for (const b of sys.blocks) {
    if (b.broken || !onScreen(cam, b, 4)) continue;
    const x0 = Math.round(cam.worldToScreenX(b.x0));
    const y0 = Math.round(cam.worldToScreenY(b.y0));
    const size = Math.round((b.x1 - b.x0) * cam.zoom);
    const u = size / ART;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sprite, x0, y0, size, size);
    // A slow pulse brightens the whole face.
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.4 + b.cx);
    ctx.globalAlpha = 0.04 + 0.1 * pulse;
    ctx.fillStyle = "#fff4bd";
    ctx.fillRect(x0 + u, y0 + u, size - 2 * u, size - 2 * u);
    // A diagonal shimmer sweeps across every couple of seconds.
    const period = 2.6;
    const sweep = (((t + b.cy * 0.37) % period) / period) * (ART * 2 + 6) - 3;
    for (let ty = 1; ty < ART - 1; ty++) {
      for (let tx = 1; tx < ART - 1; tx++) {
        const d = Math.abs(tx + ty - sweep);
        if (d > 1.5) continue;
        ctx.globalAlpha = d < 0.6 ? 0.75 : 0.35;
        ctx.fillRect(x0 + tx * u, y0 + ty * u, Math.ceil(u), Math.ceil(u));
      }
    }
    // Cracks from the hits it has taken.
    const taken = SPECIAL_UPGRADE.hits - b.hitsLeft;
    ctx.globalAlpha = 1;
    ctx.fillStyle = PALETTE[0];
    for (let i = 0; i < Math.min(taken, CRACKS.length); i++) {
      for (const [tx, ty] of CRACKS[i]) ctx.fillRect(x0 + tx * u, y0 + ty * u, Math.ceil(u), Math.ceil(u));
    }
    if (b.flash > 0) {
      ctx.globalAlpha = Math.min(1, b.flash / 0.12) * 0.85;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(x0, y0, size, size);
    }
    ctx.restore();
  }
}

/**
 * Additive pass: the gold halo, the motes drifting round each block, the
 * stream of motes flying into a soldier, and the shimmer on that soldier.
 */
export function drawSpecialGlow(ctx: CanvasRenderingContext2D, cam: CameraSystem, sys: SpecialUpgradeSystem, t: number): void {
  const glow = glowSprite();
  const z = cam.zoom;
  const px = Math.max(1, 2 * z);
  for (const b of sys.blocks) {
    if (b.broken || !onScreen(cam, b, 60 * z)) continue;
    const wx = (b.x0 + b.x1) / 2, wy = (b.y0 + b.y1) / 2;
    const sx = cam.worldToScreenX(wx), sy = cam.worldToScreenY(wy);
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.4 + b.cx);
    let r = (46 + 6 * pulse) * z;
    ctx.globalAlpha = 0.5 + 0.2 * pulse;
    ctx.drawImage(glow, sx - r, sy - r, r * 2, r * 2);
    r = 20 * z;
    ctx.globalAlpha = 0.22 + 0.14 * pulse + (b.flash > 0 ? 0.4 : 0);
    ctx.drawImage(glow, sx - r, sy - r, r * 2, r * 2);
    // Ambient motes: rise from round the block, sway, twinkle out.
    const seed = b.cx * 31 + b.cy * 17;
    for (let i = 0; i < 18; i++) {
      const h1 = hash(seed + i), h2 = hash(seed + i * 7.3), h3 = hash(seed + i * 13.1);
      const p = (t * (0.28 + 0.3 * h2) + h1) % 1;
      const ang = h3 * Math.PI * 2;
      const rad = 10 + 10 * h1 + 4 * p;
      const mx = wx + Math.cos(ang) * rad + Math.sin(t * 1.7 + i) * 2.5;
      const my = wy + Math.sin(ang) * rad * 0.8 - p * 16;
      const a = Math.sin(p * Math.PI) * (0.55 + 0.45 * Math.sin(t * 9 + i * 2.1));
      if (a <= 0.02) continue;
      const qx = cam.worldToScreenX(mx), qy = cam.worldToScreenY(my);
      ctx.globalAlpha = a * 0.6;
      const gr = 4 * z;
      ctx.drawImage(glow, qx - gr, qy - gr, gr * 2, gr * 2);
      ctx.globalAlpha = a;
      ctx.fillStyle = i % 3 === 0 ? "#fff4bd" : "#ffcc3a";
      const s = i % 4 === 0 ? px * 1.5 : px;
      ctx.fillRect(Math.round(qx - s / 2), Math.round(qy - s / 2), Math.ceil(s), Math.ceil(s));
    }
  }

  for (const m of sys.motes) {
    if (m.age < 0) continue;
    const sx = cam.worldToScreenX(m.x), sy = cam.worldToScreenY(m.y);
    if (sx < -20 || sy < -20 || sx > cam.viewW + 20 || sy > cam.viewH + 20) continue;
    const tx = cam.worldToScreenX(m.x - m.vx * 0.035), ty = cam.worldToScreenY(m.y - m.vy * 0.035);
    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = "#e9a91f";
    ctx.lineWidth = Math.max(1, m.size * z);
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(sx, sy);
    ctx.stroke();
    const gr = 5 * m.size * z;
    ctx.globalAlpha = 0.55;
    ctx.drawImage(glow, sx - gr, sy - gr, gr * 2, gr * 2);
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#fff4bd";
    const s = Math.max(1, m.size * 1.6 * z);
    ctx.fillRect(Math.round(sx - s / 2), Math.round(sy - s / 2), Math.ceil(s), Math.ceil(s));
  }

  for (const [s, left] of sys.glow) drawSoldierShimmer(ctx, cam, s, left, glow);
  ctx.globalAlpha = 1;
}

function drawSoldierShimmer(ctx: CanvasRenderingContext2D, cam: CameraSystem, s: Soldier, left: number, glow: HTMLCanvasElement): void {
  if (!s.alive) return;
  const sx = cam.worldToScreenX(s.x), sy = cam.worldToScreenY(s.y);
  const r = (14 + 10 * Math.min(1, left)) * cam.zoom;
  ctx.globalAlpha = Math.min(1, left) * 0.9;
  ctx.drawImage(glow, sx - r, sy - r, r * 2, r * 2);
}

/** Seconds the "Special Upgrade" banner rises, holds and fades. */
const NOTICE = { rise: 0.35, hold: 1.6, fade: 0.6, lift: 22 };

/** "SPECIAL UPGRADE ACQUIRED" rising over the soldier who absorbed it. */
export function drawSpecialNotice(
  ctx: CanvasRenderingContext2D,
  cam: CameraSystem,
  notice: { soldier: Soldier; t0: number } | null,
  now: number,
): void {
  if (!notice) return;
  const t = now - notice.t0;
  const { rise, hold, fade, lift } = NOTICE;
  if (t < 0 || t > rise + hold + fade) return;
  const p = t < rise ? 1 - (1 - t / rise) ** 3 : 1;
  const alpha = t < rise ? t / rise : t < rise + hold ? 1 : 1 - (t - rise - hold) / fade;
  const s = notice.soldier;
  const x = Math.round(cam.worldToScreenX(s.x));
  const y = Math.round(cam.worldToScreenY(s.y - 10 - lift * p));
  const scale = Math.max(1, Math.round(Math.min(1.5, Math.max(0.7, cam.zoom)) * 1.5));
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  const big = 10 * scale, small = 7 * scale;
  ctx.font = `${big}px Silkscreen, "Press Start 2P", monospace`;
  ctx.fillStyle = "#2a1702";
  ctx.fillText("SPECIAL UPGRADE", x + scale, y + scale);
  ctx.fillStyle = "#ffd75a";
  ctx.fillText("SPECIAL UPGRADE", x, y);
  ctx.font = `${small}px Silkscreen, "Press Start 2P", monospace`;
  ctx.fillStyle = "#2a1702";
  ctx.fillText("ACQUIRED", x + scale, y + big + scale);
  ctx.fillStyle = "#fff4bd";
  ctx.fillText("ACQUIRED", x, y + big);
  ctx.restore();
}
