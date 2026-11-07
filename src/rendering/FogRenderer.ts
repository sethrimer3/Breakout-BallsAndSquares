import { FOG } from "../config";
import type { CameraSystem } from "../systems/CameraSystem";
import type { FogOfWar } from "../world/FogOfWar";

/** Fog alpha (0..255) for a tile brightness: smoothstep so the edge reads as a soft lip, not a ramp. */
export function fogAlpha(light: number): number {
  const d = light >= 1 ? 0 : light <= 0 ? 1 : 1 - light;
  return Math.round(255 * d * d * (3 - 2 * d));
}

/**
 * Draws `FogOfWar` as one tiny canvas (one texel per fog tile), stretched over
 * the view with bilinear filtering. Only the on-screen tiles are rewritten
 * each frame, so the cost is a few thousand texels and a single drawImage.
 */
export class FogRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private img: ImageData;

  constructor(private fog: FogOfWar) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = fog.tw;
    this.canvas.height = fog.th;
    this.ctx = this.canvas.getContext("2d")!;
    this.img = this.ctx.createImageData(fog.tw, fog.th);
    const [r, g, b] = FOG.color;
    const px = this.img.data;
    for (let i = 0; i < px.length; i += 4) {
      px[i] = r;
      px[i + 1] = g;
      px[i + 2] = b;
      px[i + 3] = 255;
    }
  }

  draw(ctx: CanvasRenderingContext2D, cam: CameraSystem): void {
    const { fog } = this;
    const ts = fog.tileSize;
    const tx0 = Math.max(0, Math.floor(cam.screenToWorldX(0) / ts) - 1);
    const ty0 = Math.max(0, Math.floor(cam.screenToWorldY(0) / ts) - 1);
    const tx1 = Math.min(fog.tw - 1, Math.floor(cam.screenToWorldX(cam.viewW) / ts) + 1);
    const ty1 = Math.min(fog.th - 1, Math.floor(cam.screenToWorldY(cam.viewH) / ts) + 1);
    if (tx1 < tx0 || ty1 < ty0) return;
    const w = tx1 - tx0 + 1;
    const h = ty1 - ty0 + 1;
    const light = fog.light;
    const px = this.img.data;
    const tw = fog.tw;
    for (let y = ty0; y <= ty1; y++) {
      let i = y * tw + tx0;
      let p = i * 4 + 3;
      for (let x = 0; x < w; x++, i++, p += 4) px[p] = fogAlpha(light[i]);
    }
    this.ctx.putImageData(this.img, 0, 0, tx0, ty0, w, h);

    const sx = cam.worldToScreenX(tx0 * ts);
    const sy = cam.worldToScreenY(ty0 * ts);
    const size = ts * cam.zoom;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "low";
    ctx.drawImage(this.canvas, tx0, ty0, w, h, sx, sy, w * size, h * size);
    ctx.restore();
  }
}
