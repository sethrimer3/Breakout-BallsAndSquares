/**
 * Reusable soft-light rendering helpers.
 *
 * Soft light is treated as a field of light density rather than a visible shape:
 * 1. Many faint nested layers (each wider and fainter) build a bright core with a
 *    fading edge, instead of one hard-edged polygon.
 * 2. Gradients fade the light along its length / radius.
 * 3. Everything is drawn into a small offscreen light buffer, blurred once, and
 * 4. composited back onto the scene with `screen` so it brightens what is below.
 *
 * Performance: the layered shapes are baked ONCE into sprites (`bakeSoftBeam`,
 * `bakeSoftGlow`), so a frame costs one `drawImage` per effect into a low-res
 * buffer plus a single blur + composite. Buffers are reused and only resized
 * when the view changes. Nothing here allocates per frame.
 */

/** Gradient stop: `[offset 0..1, css color]`. */
export type SoftStop = readonly [number, string];

export interface SoftLayerOptions {
  /** Number of nested layers (8..16 looks smooth). */
  layers: number;
  /** Alpha of the innermost layer; outer layers fall off from this. */
  baseAlpha: number;
  /** Size multiplier of the outermost layer relative to the innermost. */
  spread: number;
  /** Falloff exponent: alpha = baseAlpha * (1 - t)^falloff (2..3 is natural). */
  falloff: number;
}

/** Alpha for layer `i` of `layers` (0 = innermost). Pure, exported for tests. */
export function softLayerAlpha(i: number, opts: SoftLayerOptions): number {
  const t = opts.layers > 1 ? i / (opts.layers - 1) : 0;
  return opts.baseAlpha * Math.pow(1 - t, opts.falloff);
}

/** Size scale for layer `i` of `layers` (1 = innermost, `spread` = outermost). */
export function softLayerScale(i: number, opts: SoftLayerOptions): number {
  const t = opts.layers > 1 ? i / (opts.layers - 1) : 0;
  return 1 + t * (opts.spread - 1);
}

function newCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

/**
 * Bake a soft beam / flame sprite pointing along +x. The source sits at
 * `(originX, h / 2)`; the beam is `length` long with a half-width of `halfWidth`
 * for its innermost layer. Draw it rotated so +x is the beam direction.
 */
export function bakeSoftBeam(
  w: number,
  h: number,
  originX: number,
  length: number,
  halfWidth: number,
  stops: readonly SoftStop[],
  opts: SoftLayerOptions,
): HTMLCanvasElement {
  const c = newCanvas(w, h);
  const g = c.getContext("2d")!;
  g.globalCompositeOperation = "lighter";
  const cy = h / 2;
  for (let i = opts.layers - 1; i >= 0; i--) {
    const s = softLayerScale(i, opts);
    // Outer layers widen a lot but lengthen only a little, so the tip stays tapered.
    const len = Math.min(w - originX, length * (1 + (s - 1) * 0.25));
    const hw = Math.min(cy, halfWidth * s);
    const back = Math.min(originX, hw * 0.6);
    const grad = g.createLinearGradient(originX - back, cy, originX + len, cy);
    for (const [o, col] of stops) grad.addColorStop(o, col);
    g.fillStyle = grad;
    g.globalAlpha = softLayerAlpha(i, opts);
    // Teardrop: rounded behind the source, tapering to a point at the tip.
    g.beginPath();
    g.moveTo(originX - back, cy);
    g.bezierCurveTo(originX - back, cy - hw * 0.8, originX + len * 0.2, cy - hw, originX + len * 0.45, cy - hw * 0.7);
    g.quadraticCurveTo(originX + len * 0.8, cy - hw * 0.3, originX + len, cy);
    g.quadraticCurveTo(originX + len * 0.8, cy + hw * 0.3, originX + len * 0.45, cy + hw * 0.7);
    g.bezierCurveTo(originX + len * 0.2, cy + hw, originX - back, cy + hw * 0.8, originX - back, cy);
    g.fill();
  }
  return c;
}

/** Bake a soft radial glow sprite (`size` x `size`), built from nested layers. */
export function bakeSoftGlow(size: number, stops: readonly SoftStop[], opts: SoftLayerOptions): HTMLCanvasElement {
  const c = newCanvas(size, size);
  const g = c.getContext("2d")!;
  g.globalCompositeOperation = "lighter";
  const r = size / 2;
  const r0 = r / opts.spread;
  for (let i = opts.layers - 1; i >= 0; i--) {
    const lr = r0 * softLayerScale(i, opts);
    const grad = g.createRadialGradient(r, r, 0, r, r, lr);
    for (const [o, col] of stops) grad.addColorStop(o, col);
    g.fillStyle = grad;
    g.globalAlpha = softLayerAlpha(i, opts);
    g.beginPath();
    g.arc(r, r, lr, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

export interface SoftLightBufferOptions {
  /** Buffer pixels per CSS pixel (0.25..0.5). Lower = softer and cheaper. */
  scale: number;
  /** Blur radius in buffer pixels, applied once to the combined buffer. */
  blur: number;
}

let filterSupport: boolean | null = null;

/** True when `ctx.filter = "blur(...)"` is honoured (not on older Safari). */
function supportsCanvasFilter(ctx: CanvasRenderingContext2D): boolean {
  if (filterSupport === null) {
    filterSupport = typeof ctx.filter === "string";
    if (filterSupport) {
      ctx.filter = "blur(1px)";
      filterSupport = ctx.filter === "blur(1px)";
      ctx.filter = "none";
    }
  }
  return filterSupport;
}

/**
 * Low-resolution offscreen light buffer. Usage per frame:
 *   const g = buf.begin(viewW, viewH);   // CSS-pixel coordinates, additive
 *   g.drawImage(sprite, ...);            // any number of soft sprites / shapes
 *   buf.composite(ctx, "screen", 0.9);   // blur once, blend onto the scene
 */
export class SoftLightBuffer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  /** Blur target (same size), or half-size when downsampling is the blur. */
  private blurCanvas: HTMLCanvasElement;
  private blurCtx: CanvasRenderingContext2D;
  private bufW = 0;
  private bufH = 0;

  constructor(public opts: SoftLightBufferOptions) {
    this.canvas = document.createElement("canvas");
    this.ctx = this.canvas.getContext("2d")!;
    this.blurCanvas = document.createElement("canvas");
    this.blurCtx = this.blurCanvas.getContext("2d")!;
  }

  /** Clear the buffer and return its context, mapped to CSS-pixel coordinates. */
  begin(viewW: number, viewH: number): CanvasRenderingContext2D {
    const s = this.opts.scale;
    const w = Math.max(1, Math.ceil(viewW * s));
    const h = Math.max(1, Math.ceil(viewH * s));
    if (w !== this.bufW || h !== this.bufH) {
      this.bufW = this.canvas.width = w;
      this.bufH = this.canvas.height = h;
      const useFilter = supportsCanvasFilter(this.ctx);
      this.blurCanvas.width = useFilter ? w : Math.max(1, w >> 1);
      this.blurCanvas.height = useFilter ? h : Math.max(1, h >> 1);
    }
    const g = this.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
    g.clearRect(0, 0, w, h);
    g.setTransform(s, 0, 0, s, 0, 0);
    g.globalCompositeOperation = "lighter";
    g.imageSmoothingEnabled = true;
    return g;
  }

  /**
   * Blur the buffer once and draw it over `target` (whose transform maps CSS
   * pixels) with the given blend mode. `screen` reads as light; `lighter` is a
   * hotter arcade glow that blows out sooner.
   */
  composite(target: CanvasRenderingContext2D, op: GlobalCompositeOperation = "screen", alpha = 1): void {
    const s = this.opts.scale;
    const b = this.blurCtx;
    const bw = this.blurCanvas.width;
    const bh = this.blurCanvas.height;
    b.setTransform(1, 0, 0, 1, 0, 0);
    b.globalCompositeOperation = "source-over";
    b.clearRect(0, 0, bw, bh);
    b.imageSmoothingEnabled = true;
    if (supportsCanvasFilter(b) && this.opts.blur > 0) {
      b.filter = `blur(${this.opts.blur}px)`;
      b.drawImage(this.canvas, 0, 0);
      b.filter = "none";
    } else {
      // Fallback blur: bilinear downsample, then the upscale below re-smooths it.
      b.drawImage(this.canvas, 0, 0, bw, bh);
    }
    target.save();
    target.globalCompositeOperation = op;
    target.globalAlpha = alpha;
    target.imageSmoothingEnabled = true;
    target.drawImage(this.blurCanvas, 0, 0, bw, bh, 0, 0, this.bufW / s, this.bufH / s);
    target.restore();
  }
}
