import { fogAlpha } from "./FogRenderer";
import type { FogOfWar } from "../world/FogOfWar";
import type { DamageNumbers } from "../entities/DamageNumbers";
import type { CameraSystem } from "../systems/CameraSystem";

/** Small screen-sized black digits with a colored rim and restrained glow. */
export class DamageNumberRenderer {
  private readonly sprites = new Map<string, HTMLCanvasElement>();

  draw(ctx: CanvasRenderingContext2D, cam: CameraSystem, numbers: DamageNumbers, reduced: boolean, fog?: FogOfWar): void {
    if (!numbers.items.length) return;
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.imageSmoothingEnabled = true;
    for (const item of numbers.items) {
      const progress = item.age / numbers.duration;
      const x = cam.worldToScreenX(item.x) + (reduced ? 0 : item.dx * progress * 18);
      const y = cam.worldToScreenY(item.y) - 6 + (reduced ? 0 : item.dy * progress * 18);
      if (x < -40 || y < -20 || x > cam.viewW + 40 || y > cam.viewH + 20) continue;
      let visibility = 1;
      if (fog) {
        const tx = Math.floor(item.x / fog.tileSize), ty = Math.floor(item.y / fog.tileSize);
        if (tx < 0 || ty < 0 || tx >= fog.tw || ty >= fog.th) continue;
        visibility = 1 - fogAlpha(fog.light[ty * fog.tw + tx]) / 255;
        if (visibility <= 0) continue;
      }
      const sprite = this.sprite(String(item.amount), item.color);
      ctx.globalAlpha = Math.min(1, (1 - progress) / 0.35) * visibility;
      ctx.drawImage(sprite, Math.round(x - sprite.width / 2), Math.round(y - sprite.height / 2));
    }
    ctx.restore();
  }

  private sprite(text: string, color: string): HTMLCanvasElement {
    const key = color + text, cached = this.sprites.get(key);
    if (cached) return cached;
    const canvas = document.createElement("canvas"), g = canvas.getContext("2d")!;
    g.font = "bold 11px monospace";
    canvas.width = Math.ceil(g.measureText(text).width) + 12;
    canvas.height = 26;
    g.font = "bold 11px monospace";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.lineJoin = "round"; g.lineWidth = 2;
    g.strokeStyle = color; g.shadowColor = color; g.shadowBlur = 4;
    g.strokeText(text, canvas.width / 2, canvas.height / 2);
    g.shadowBlur = 0; g.fillStyle = "#080a10";
    g.fillText(text, canvas.width / 2, canvas.height / 2);
    if (this.sprites.size === 128) this.sprites.delete(this.sprites.keys().next().value!);
    this.sprites.set(key, canvas);
    return canvas;
  }
}
