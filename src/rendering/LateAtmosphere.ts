import type { CameraSystem } from "../systems/CameraSystem";
import type { PixelWorld } from "../world/PixelWorld";
import type { Atmosphere } from "../world/worldAtmosphere";
import { SECTOR_CELLS, sectorBounds, sectorSpawnCell } from "../world/labMap";
import { hash2 } from "../core/math";

/**
 * Cached, low-cost atmospheric overlays and biome props for Worlds 3–5:
 * - Forest: parallax-free cached canopy shadow patches & sun shafts.
 * - City: orange haze tint & drifting ember particles.
 * - Teleporter pad (`P` in D4) & Mothership Command Sanctum (`B2`) arena floor.
 */
export class LateAtmosphere {
  private canopyCanvas: HTMLCanvasElement | null = null;
  private beamCanvas: HTMLCanvasElement | null = null;

  private ensureCanopy(): HTMLCanvasElement {
    if (this.canopyCanvas) return this.canopyCanvas;
    const size = 256;
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    const g = c.getContext("2d")!;
    // Soft organic shadow patches representing overhead tree canopy
    for (let i = 0; i < 36; i++) {
      const x = hash2(i, 1, 911) * size;
      const y = hash2(i, 2, 911) * size;
      const r = 22 + hash2(i, 3, 911) * 34;
      for (const ox of [-size, 0, size]) {
        for (const oy of [-size, 0, size]) {
          if (x + ox + r < 0 || x + ox - r > size || y + oy + r < 0 || y + oy - r > size) continue;
          const grad = g.createRadialGradient(x + ox, y + oy, r * 0.15, x + ox, y + oy, r);
          grad.addColorStop(0, "rgba(6, 16, 8, 0.55)");
          grad.addColorStop(0.65, "rgba(8, 20, 10, 0.28)");
          grad.addColorStop(1, "rgba(8, 20, 10, 0)");
          g.fillStyle = grad;
          g.beginPath();
          g.arc(x + ox, y + oy, r, 0, Math.PI * 2);
          g.fill();
        }
      }
    }
    this.canopyCanvas = c;
    return c;
  }

  private ensureBeam(): HTMLCanvasElement {
    if (this.beamCanvas) return this.beamCanvas;
    const size = 128;
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
    grad.addColorStop(0, "rgba(255, 242, 196, 0.36)");
    grad.addColorStop(0.45, "rgba(255, 232, 170, 0.14)");
    grad.addColorStop(1, "rgba(255, 225, 155, 0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    this.beamCanvas = c;
    return c;
  }

  /**
   * Draws floor-level biome details (Mothership arena floor markings, Teleporter pad).
   * Called in the albedo pass before dynamic lighting.
   */
  drawFloorProps(ctx: CanvasRenderingContext2D, cam: CameraSystem, world: PixelWorld, time: number): void {
    const frame = world.labLayout?.frame;
    if (!frame?.def.framework) return;
    const cs = world.cellSize;

    // World 4: Animated teleporter pad at D4
    const portal = frame.def.teleporter;
    if (portal) {
      const at = sectorSpawnCell(frame, portal.sector);
      const px = cam.worldToScreenX((at.cx + 0.5) * cs);
      const py = cam.worldToScreenY((at.cy + 0.5) * cs);
      const r = cs * 2.2 * cam.zoom;
      const pulse = 0.65 + 0.35 * Math.sin(time * 3.2);
      ctx.save();
      ctx.translate(px, py);
      // Outer octagonal pad
      ctx.fillStyle = "rgba(18, 42, 48, 0.9)";
      ctx.strokeStyle = `rgba(90, 245, 228, ${0.55 + pulse * 0.35})`;
      ctx.lineWidth = Math.max(1.5, cam.zoom * 1.6);
      ctx.beginPath();
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4 + Math.PI / 8;
        const vx = Math.cos(a) * r;
        const vy = Math.sin(a) * r;
        if (k === 0) ctx.moveTo(vx, vy);
        else ctx.lineTo(vx, vy);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Rotating inner energy ring
      ctx.rotate(time * 0.8);
      ctx.strokeStyle = `rgba(130, 255, 240, ${0.4 + pulse * 0.4})`;
      ctx.lineWidth = Math.max(1, cam.zoom * 1.2);
      ctx.setLineDash([r * 0.35, r * 0.2]);
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.66, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      // Core glow disc
      ctx.fillStyle = `rgba(100, 255, 235, ${0.22 + pulse * 0.25})`;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.38, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // World 5: Command Sanctum (sector 4 = B2) floor markings
    if (frame.def.id === 5) {
      const b = sectorBounds(frame, 4);
      const cx = cam.worldToScreenX(((b.x0 + b.x1 + 1) / 2) * cs);
      const cy = cam.worldToScreenY(((b.y0 + b.y1 + 1) / 2) * cs);
      const r = cs * 12 * cam.zoom;
      if (cx + r > 0 && cx - r < cam.viewW && cy + r > 0 && cy - r < cam.viewH) {
        ctx.save();
        ctx.strokeStyle = "rgba(138, 86, 178, 0.26)";
        ctx.lineWidth = Math.max(1, cam.zoom * 1.5);
        ctx.beginPath();
        for (let k = 0; k < 8; k++) {
          const a = (k * Math.PI) / 4 + Math.PI / 8;
          const vx = cx + Math.cos(a) * r;
          const vy = cy + Math.sin(a) * r;
          if (k === 0) ctx.moveTo(vx, vy);
          else ctx.lineTo(vx, vy);
        }
        ctx.closePath();
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.45, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  /**
   * Draws forest canopy shadow patches, sun shafts, and city haze + embers.
   * Called after terrain & lighting in the world-space / screen-space pass.
   */
  drawAtmosphere(
    ctx: CanvasRenderingContext2D,
    cam: CameraSystem,
    world: PixelWorld,
    atmo: Atmosphere | null,
    time: number,
  ): void {
    const frame = world.labLayout?.frame;
    if (!frame?.def.framework || !atmo) return;
    const env = frame.def.environment;

    if (env === "forest") {
      // 1) Cached parallax-free canopy shadow patches
      if (atmo.canopy > 0.02) {
        const canopy = this.ensureCanopy();
        const tileWorld = 256;
        const tilePx = tileWorld * cam.zoom;
        const vx0 = cam.x - cam.viewW / (2 * cam.zoom);
        const vy0 = cam.y - cam.viewH / (2 * cam.zoom);
        const vx1 = cam.x + cam.viewW / (2 * cam.zoom);
        const vy1 = cam.y + cam.viewH / (2 * cam.zoom);
        const tx0 = Math.floor(vx0 / tileWorld);
        const ty0 = Math.floor(vy0 / tileWorld);
        const tx1 = Math.floor(vx1 / tileWorld);
        const ty1 = Math.floor(vy1 / tileWorld);
        ctx.save();
        ctx.globalAlpha = Math.min(0.65, atmo.canopy * 0.55);
        for (let ty = ty0; ty <= ty1; ty++) {
          for (let tx = tx0; tx <= tx1; tx++) {
            const sx = cam.worldToScreenX(tx * tileWorld);
            const sy = cam.worldToScreenY(ty * tileWorld);
            ctx.drawImage(canopy, sx, sy, tilePx, tilePx);
          }
        }
        ctx.restore();
      }

      // 2) Cached sun shafts whose strength comes from atmosphere.beams
      if (atmo.beams > 0.04) {
        const beam = this.ensureBeam();
        const cs = world.cellSize;
        const step = SECTOR_CELLS * 0.5;
        const wx0 = Math.floor((cam.x - cam.viewW / (2 * cam.zoom)) / cs / step) - 1;
        const wy0 = Math.floor((cam.y - cam.viewH / (2 * cam.zoom)) / cs / step) - 1;
        const wx1 = Math.ceil((cam.x + cam.viewW / (2 * cam.zoom)) / cs / step) + 1;
        const wy1 = Math.ceil((cam.y + cam.viewH / (2 * cam.zoom)) / cs / step) + 1;
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = Math.min(0.85, atmo.beams * 0.75);
        for (let gy = wy0; gy <= wy1; gy++) {
          for (let gx = wx0; gx <= wx1; gx++) {
            if (hash2(gx, gy, 401) > 0.42) continue;
            const bx = (gx + 0.25 + hash2(gx, gy, 403) * 0.5) * step * cs;
            const by = (gy + 0.25 + hash2(gx, gy, 405) * 0.5) * step * cs;
            const r = (48 + hash2(gx, gy, 407) * 44) * cam.zoom;
            const sx = cam.worldToScreenX(bx);
            const sy = cam.worldToScreenY(by);
            ctx.drawImage(beam, sx - r, sy - r * 1.25, r * 2, r * 2.5);
          }
        }
        ctx.restore();
      }
      return;
    }

    if (env === "city" && atmo.haze > 0.02) {
      // Cheap screen-space orange haze + drifting ember particles
      ctx.save();
      ctx.fillStyle = `rgba(195, 86, 26, ${(atmo.haze * 0.14).toFixed(3)})`;
      ctx.fillRect(0, 0, cam.viewW, cam.viewH);
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < 24; i++) {
        const speedX = 14 + hash2(i, 1, 613) * 18;
        const speedY = 18 + hash2(i, 2, 613) * 22;
        const px = ((hash2(i, 3, 613) * cam.viewW + time * speedX) % cam.viewW + cam.viewW) % cam.viewW;
        const py = ((hash2(i, 4, 613) * cam.viewH - time * speedY) % cam.viewH + cam.viewH) % cam.viewH;
        const sz = (1.5 + hash2(i, 5, 613) * 2) * Math.max(0.8, cam.zoom * 0.5);
        ctx.fillStyle = `rgba(255, 148, 64, ${(0.35 + 0.35 * Math.sin(time * 4 + i)).toFixed(2)})`;
        ctx.fillRect(px, py, sz, sz);
      }
      ctx.restore();
    }
  }
}
