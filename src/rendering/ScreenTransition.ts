/**
 * Full-screen pixel-art iris transition drawn on its own canvas above the game and UI.
 *
 * - `reveal()`: the screen starts fully black and a circle opens from the centre outward.
 * - `close()`: black closes in from the edges toward the centre.
 *
 * The edge of the circle is a short ordered-dither band so the wave reads as blocky pixels
 * instead of a smooth gradient (matching the hard-edged pixel UI).
 */

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

/** CSS pixels per transition block. */
const BLOCK = 6;
/** Width of the dithered edge band, in blocks. */
const BAND = 5;

type Mode = "idle" | "reveal" | "close" | "black";

export class ScreenTransition {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private img: ImageData | null = null;
  private mode: Mode = "idle";
  private t = 0;
  private duration = 1;
  private onDone: (() => void) | null = null;
  private lastDrawnKey = "";

  constructor(parent?: HTMLElement) {
    if (typeof document !== "undefined") {
      this.canvas = document.createElement("canvas");
      this.canvas.className = "screen-transition";
      const s = this.canvas.style;
      s.position = "fixed";
      s.inset = "0";
      s.width = "100%";
      s.height = "100%";
      s.pointerEvents = "none";
      s.zIndex = "1000";
      s.imageRendering = "pixelated";
      s.display = "none";
      (parent ?? document.body)?.append(this.canvas);
      this.ctx = this.canvas.getContext("2d")!;
    } else {
      this.canvas = {} as HTMLCanvasElement;
      this.ctx = {} as CanvasRenderingContext2D;
    }
  }

  get active(): boolean {
    return this.mode !== "idle";
  }

  /** Snap to fully black, then open a circle from the centre outward. */
  reveal(duration = 0.9, onDone?: () => void): void {
    this.start("reveal", duration, onDone);
  }

  /** Close black in from the screen edges to the centre, then stay black. */
  close(duration = 0.75, onDone?: () => void): void {
    this.start("close", duration, onDone);
  }

  private start(mode: Mode, duration: number, onDone?: () => void): void {
    this.mode = mode;
    this.t = 0;
    this.duration = Math.max(0.01, duration);
    this.onDone = onDone ?? null;
    this.lastDrawnKey = "";
    this.canvas.style.display = "block";
    this.draw();
  }

  /** Advance with real (unscaled) seconds. */
  update(realDt: number): void {
    if (this.mode === "idle" || this.mode === "black") return;
    this.t += realDt;
    if (this.t >= this.duration) {
      const finished = this.mode;
      const cb = this.onDone;
      this.onDone = null;
      if (finished === "reveal") {
        this.mode = "idle";
        this.canvas.style.display = "none";
      } else {
        this.mode = "black";
        this.draw();
      }
      cb?.();
      return;
    }
    this.draw();
  }

  /** Fraction of the half-diagonal (plus band) that is open: 0 = all black, 1 = all clear. */
  private openness(): number {
    const p = Math.min(1, this.t / this.duration);
    if (this.mode === "reveal") return 1 - Math.pow(1 - p, 2.2); // fast burst, gentle finish
    if (this.mode === "close") return 1 - Math.pow(p, 1.6); // accelerate into the centre
    return 0;
  }

  private draw(): void {
    const cw = Math.max(1, Math.ceil(window.innerWidth / BLOCK));
    const ch = Math.max(1, Math.ceil(window.innerHeight / BLOCK));
    if (this.canvas.width !== cw || this.canvas.height !== ch || !this.img) {
      this.canvas.width = cw;
      this.canvas.height = ch;
      this.img = this.ctx.createImageData(cw, ch);
      this.lastDrawnKey = "";
    }
    const open = this.openness();
    // Radius in blocks. Fully open must clear the corners plus the dither band.
    const cx = cw / 2;
    const cy = ch / 2;
    const maxR = Math.hypot(cx, cy) + BAND + 1;
    const r = open * maxR;
    const key = `${cw}x${ch}:${r.toFixed(2)}`;
    if (key === this.lastDrawnKey) return;
    this.lastDrawnKey = key;
    const data = this.img.data;
    const inner = r - BAND;
    for (let y = 0; y < ch; y++) {
      const dy = y + 0.5 - cy;
      for (let x = 0; x < cw; x++) {
        const dx = x + 0.5 - cx;
        const d = Math.sqrt(dx * dx + dy * dy);
        let black: boolean;
        if (d <= inner) black = false;
        else if (d >= r) black = true;
        else black = (r - d) / BAND < BAYER4[(y & 3) * 4 + (x & 3)];
        const i = (y * cw + x) * 4;
        data[i] = 0;
        data[i + 1] = 0;
        data[i + 2] = 0;
        data[i + 3] = black ? 255 : 0;
      }
    }
    this.ctx.putImageData(this.img, 0, 0);
  }
}
