import type { PixelWorld } from '../world/PixelWorld';
import type { CameraSystem } from '../systems/CameraSystem';
import { boundaryColor, BOUNDARY_VOID } from '../world/MapBoundary';

/** Opaque pass keeps lighting out of the void; gameplay fog must be drawn afterward. */
export function drawMapBoundary(ctx: CanvasRenderingContext2D, w: PixelWorld, cam: CameraSystem): void {
  const cs=w.cellSize, size=cs*cam.zoom;
  const x0=Math.floor(cam.screenToWorldX(0)/cs), x1=Math.ceil(cam.screenToWorldX(cam.viewW)/cs);
  const y0=Math.floor(cam.screenToWorldY(0)/cs), y1=Math.ceil(cam.screenToWorldY(cam.viewH)/cs);
  ctx.save();
  ctx.globalAlpha=1; ctx.globalCompositeOperation='source-over';
  for(let y=y0;y<y1;y++) for(let x=x0;x<x1;x++) {
    const layer=w.inBounds(x,y)?w.boundary[y*w.width+x]:BOUNDARY_VOID;
    if(!layer) continue;
    const sx=cam.worldToScreenX(x*cs),sy=cam.worldToScreenY(y*cs);
    if(layer===BOUNDARY_VOID||layer===w.boundaryThickness) {
      let end=x+1;
      while(end<x1) {
        const next=w.inBounds(end,y)?w.boundary[y*w.width+end]:BOUNDARY_VOID;
        if(next!==BOUNDARY_VOID&&next!==w.boundaryThickness) break;
        end++;
      }
      ctx.fillStyle='#000';ctx.fillRect(sx,sy,(end-x)*size+.25,size+.25);x=end-1;
    } else {
      // Match terrain's four-texel brushed plates / rough cliff faces.
      for(let oy=0;oy<4;oy++) for(let ox=0;ox<4;ox++) {
        const c=boundaryColor(w,x,y,ox,oy);
        ctx.fillStyle=`rgb(${c[0]} ${c[1]} ${c[2]})`;
        ctx.fillRect(sx+ox*size/4,sy+oy*size/4,size/4+.25,size/4+.25);
      }
    }
  }
  ctx.restore();
}
