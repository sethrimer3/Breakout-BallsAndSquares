/**
 * Blight Essence's living black glob, ported from TowerDefense's
 * `src/ui/currency-icons.ts`: a black body whose edge is Perlin noise read round
 * a circle and moved through time, ringed in fire instead of ink. Used for the
 * drops in the world and for the inventory icons. Presentation only: the wobble
 * is wall-clock noise and never touches the run's Rng.
 */

/** Art pixels across the glob's body, before its outline. */
export const ESSENCE_BODY = 12;
/** Art pixels across the sprite, outline included. */
export const ESSENCE_SIZE = ESSENCE_BODY + 2;
/** Frames a second the glob steps at. */
export const ESSENCE_FPS = 10;

/** Pixels in rows of `w`: an RGB colour, or -1 for clear. */
export interface Pixels {
  w: number;
  h: number;
  px: number[];
}

/** Rings every painted pixel with `ink` on the clear pixels beside it (four
 * neighbours), growing the picture by one pixel each way. */
export function outlined(src: Pixels, ink: number): Pixels {
  const w = src.w + 2;
  const h = src.h + 2;
  const px = new Array<number>(w * h).fill(-1);
  for (let y = 0; y < src.h; y++) {
    for (let x = 0; x < src.w; x++) px[(y + 1) * w + x + 1] = src.px[y * src.w + x];
  }
  const solid = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h && px[y * w + x] >= 0;
  const ring: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!solid(x, y) && (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))) {
        ring.push(y * w + x);
      }
    }
  }
  for (const i of ring) px[i] = ink;
  return { w, h, px };
}

/** A fixed shuffle for the gradient noise, so the glob's wobble is the same in
 * every browser and never draws from the game's streams. */
const PERM = ((): number[] => {
  const p = Array.from({ length: 256 }, (_, i) => i);
  let s = 0x9e3779b9;
  for (let i = 255; i > 0; i--) {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6b43a9b5) >>> 0;
    const j = s % (i + 1);
    [p[i], p[j]] = [p[j], p[i]];
  }
  return [...p, ...p];
})();
const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
function grad(h: number, x: number, y: number, z: number): number {
  const u = h & 8 ? y : x;
  const v = h & 12 ? (h === 12 || h === 14 ? x : z) : y;
  return (h & 1 ? -u : u) + (h & 2 ? -v : v);
}
const lerp = (t: number, a: number, b: number): number => a + t * (b - a);

/** Ken Perlin's improved 3D noise, about -1 to 1. */
export function perlin(x: number, y: number, z: number): number {
  const X = Math.floor(x) & 255;
  const Y = Math.floor(y) & 255;
  const Z = Math.floor(z) & 255;
  x -= Math.floor(x);
  y -= Math.floor(y);
  z -= Math.floor(z);
  const u = fade(x);
  const v = fade(y);
  const w = fade(z);
  const P = PERM;
  const A = P[X] + Y;
  const AA = P[A] + Z;
  const AB = P[A + 1] + Z;
  const B = P[X + 1] + Y;
  const BA = P[B] + Z;
  const BB = P[B + 1] + Z;
  return lerp(
    w,
    lerp(
      v,
      lerp(u, grad(P[AA], x, y, z), grad(P[BA], x - 1, y, z)),
      lerp(u, grad(P[AB], x, y - 1, z), grad(P[BB], x - 1, y - 1, z)),
    ),
    lerp(
      v,
      lerp(u, grad(P[AA + 1], x, y, z - 1), grad(P[BA + 1], x - 1, y, z - 1)),
      lerp(u, grad(P[AB + 1], x, y - 1, z - 1), grad(P[BB + 1], x - 1, y - 1, z - 1)),
    ),
  );
}

/** The glob's black, a glossy sheen on its upper left, and the burning
 * dimension showing round its edge. */
const ESSENCE = { body: 0x050407, deep: 0x120c18, sheen: 0x2c2238, glint: 0x7a6a8c };
const FIRE = [0x7a1c06, 0xc23a0a, 0xf07a18, 0xffc040];
/** The glob's mean radius in art pixels, and how far the noise pushes it. */
const GLOB = { radius: 4.3, wobble: 1.5, scale: 1.25, speed: 0.55 };

/** The glob at `seconds`, outlined, so `ESSENCE_SIZE` across. */
export function essencePixels(seconds: number): Pixels {
  const n = ESSENCE_BODY;
  const c = (n - 1) / 2;
  const t = seconds * GLOB.speed;
  const px = new Array<number>(n * n).fill(-1);
  const edge = (a: number): number =>
    GLOB.radius + GLOB.wobble * perlin(Math.cos(a) * GLOB.scale + 7.3, Math.sin(a) * GLOB.scale + 3.1, t);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = x - c;
      const dy = y - c;
      const r = Math.hypot(dx, dy);
      const reach = edge(Math.atan2(dy, dx));
      if (r > reach) continue;
      // Lit from the upper left: a soft sheen, a glint, the rest pitch black.
      const lit = (-dx - dy) / (Math.SQRT2 * Math.max(reach, 1));
      const rim = r > reach - 1.6;
      px[y * n + x] =
        lit > 0.72 && rim ? ESSENCE.glint : lit > 0.45 && rim ? ESSENCE.sheen : r > reach - 1 ? ESSENCE.deep : ESSENCE.body;
    }
  }
  // The ring burns: each outline pixel's heat is noise moving with time.
  const out = outlined({ w: n, h: n, px }, -2);
  const w = out.w;
  for (let i = 0; i < out.px.length; i++) {
    if (out.px[i] !== -2) continue;
    const x = i % w;
    const y = Math.floor(i / w);
    const heat = 0.5 + 0.5 * perlin(x * 0.55 + 11.7, y * 0.55 + 5.2, seconds * 1.4);
    out.px[i] = FIRE[Math.max(0, Math.min(FIRE.length - 1, Math.floor(heat * FIRE.length)))];
  }
  return out;
}

/** Paints `p` into `canvas`, sizing it to the art. */
export function paintPixels(canvas: HTMLCanvasElement, p: Pixels): void {
  if (canvas.width !== p.w) canvas.width = p.w;
  if (canvas.height !== p.h) canvas.height = p.h;
  const c = canvas.getContext("2d");
  if (!c) return;
  const img = c.createImageData(p.w, p.h);
  for (let i = 0; i < p.px.length; i++) {
    const rgb = p.px[i];
    if (rgb < 0) continue;
    const o = i * 4;
    img.data[o] = rgb >> 16;
    img.data[o + 1] = (rgb >> 8) & 255;
    img.data[o + 2] = rgb & 255;
    img.data[o + 3] = 255;
  }
  c.putImageData(img, 0, 0);
}

/** The animation frame at wall-clock `nowMs`; frame 0 under Reduce Motion. */
export function essenceFrame(nowMs: number, still: boolean): number {
  return still ? 0 : Math.floor((nowMs * ESSENCE_FPS) / 1000);
}
