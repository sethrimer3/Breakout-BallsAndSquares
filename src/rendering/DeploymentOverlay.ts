import type { Game } from "../Game";
import { SECTOR_CELLS, sectorBounds, sectorName, worldRows } from "../world/labMap";
import { DEPLOYMENT_COLORS } from "../ui/deploymentStatus";

/** Tactical annotation only while choosing a portal. No terrain scan or blur. */
export class DeploymentOverlay {
  draw(ctx: CanvasRenderingContext2D, game: Game): void {
    if (!game.canPlaceSoldier()) return;
    const frame = game.world.labLayout?.frame;
    if (!frame) return;
    const cam = game.camera, cs = game.world.cellSize, unit = SECTOR_CELLS * cs;
    const left = Math.max(0, Math.floor((cam.screenToWorldX(0) / cs - frame.x0) / SECTOR_CELLS));
    const right = Math.min(frame.def.sectors - 1, Math.floor((cam.screenToWorldX(cam.viewW) / cs - frame.x0) / SECTOR_CELLS));
    const top = Math.max(0, Math.floor((cam.screenToWorldY(0) / cs - frame.y0) / SECTOR_CELLS));
    const bottom = Math.min(worldRows(frame.def) - 1, Math.floor((cam.screenToWorldY(cam.viewH) / cs - frame.y0) / SECTOR_CELLS));
    ctx.save();
    ctx.lineWidth = 1.5;
    for (let row = top; row <= bottom; row++) for (let col = left; col <= right; col++) {
      const s = row * frame.def.sectors + col;
      const available = game.canDeployInto(s);
      const b = sectorBounds(frame, s);
      const x = cam.worldToScreenX(b.x0 * cs), y = cam.worldToScreenY(b.y0 * cs), size = unit * cam.zoom;
      const color = available ? DEPLOYMENT_COLORS.available : DEPLOYMENT_COLORS.unknown;
      ctx.strokeStyle = color;
      ctx.globalAlpha = available ? 0.7 : 0.3;
      ctx.setLineDash(available ? [] : [2, 6]);
      ctx.strokeRect(x + 1, y + 1, size - 2, size - 2);
      ctx.setLineDash([]);
      if (!available) continue;
      const x0 = Math.max(0, x), y0 = Math.max(0, y), x1 = Math.min(cam.viewW, x + size), y1 = Math.min(cam.viewH, y + size);
      ctx.fillStyle = color; ctx.globalAlpha = 0.025;
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      // A clipped sector can fill the viewport: keep its label inside the view.
      const labelY = Math.min(cam.viewH - 110, y1 - 34);
      if (x1 - x0 > 180 && y1 - y0 > 120 && labelY >= (cam.viewH > 500 ? 190 : 100)) {
        this.label(ctx, Math.max(12,x+12), labelY, Math.min(cam.viewW-12,x1), Math.min(cam.viewH-85,y1), sectorName(s,frame.def.sectors));
      }
    }
    ctx.restore();
  }

  drawTargetLabel(ctx: CanvasRenderingContext2D, game: Game, wx: number, wy: number, unsurveyed: boolean, groundClear: boolean): void {
    const cam = game.camera;
    const text = unsurveyed ? "UNSURVEYED" : groundClear ? "PORTAL READY" : "CLEAR GROUND REQUIRED";
    const color = unsurveyed || !groundClear ? DEPLOYMENT_COLORS.blocked : DEPLOYMENT_COLORS.available;
    ctx.save();ctx.textAlign="left";ctx.textBaseline="alphabetic";ctx.font="10px monospace";
    const width = ctx.measureText(text).width + 18;
    const x = Math.max(8,Math.min(cam.viewW-width-8,cam.worldToScreenX(wx)-width/2));
    const y = Math.max(8,Math.min(cam.viewH-85,cam.worldToScreenY(wy)-30*cam.zoom-24));
    ctx.fillStyle="#07131c";ctx.globalAlpha=.96;ctx.fillRect(x,y,width,23);
    ctx.globalAlpha=1;ctx.strokeStyle=ctx.fillStyle=color;ctx.lineWidth=1;ctx.strokeRect(x+.5,y+.5,width-1,22);ctx.fillText(text,x+9,y+15);
    ctx.restore();
  }

  private label(ctx: CanvasRenderingContext2D, x: number, y: number, right: number, bottom: number, sector: string): void {
    const text = `${sector}  OPEN ZONE`;
    ctx.textAlign="left";ctx.textBaseline="alphabetic";ctx.font="10px monospace";
    const width=ctx.measureText(text).width+30;
    if(x+width>right||y+23>bottom)return;
    ctx.globalAlpha=0.94;ctx.fillStyle="#07131c";ctx.fillRect(x,y,width,23);
    ctx.globalAlpha=1;ctx.strokeStyle=ctx.fillStyle=DEPLOYMENT_COLORS.available;
    ctx.strokeRect(x+.5,y+.5,width-1,22);
    ctx.beginPath();
    ctx.moveTo(x + 7, y + 11);
    ctx.lineTo(x + 10, y + 14);
    ctx.lineTo(x + 16, y + 7);
    ctx.stroke();ctx.fillText(text,x+23,y+15);
  }
}
