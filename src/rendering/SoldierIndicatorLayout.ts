export interface IndicatorRect { x: number; y: number; width: number; height: number; }
export interface IndicatorBounds { left: number; top: number; right: number; bottom: number; }
export interface SoldierIndicator {
  x: number; y: number; edge: number; ideal: number; targetX: number; targetY: number;
}
export const INDICATOR_RADIUS = 16;
export const INDICATOR_SPACING = 36;

/** Match the main renderer's snapped sprite placement, ignoring transparent padding. */
export function soldierPixelsOnscreen(sx:number,sy:number,size:number,width:number,height:number,bounds:IndicatorBounds): boolean {
  const x=Math.round(sx-size/2),y=Math.round(sy-size/2);
  return x+bounds.right*size>0&&x+bounds.left*size<width&&y+bounds.bottom*size>0&&y+bounds.top*size<height;
}

/** Project only wholly off-screen sprites onto an inset viewport rectangle. */
export function projectSoldierIndicator(out: SoldierIndicator, sx: number, sy: number, radius: number, width: number, height: number, bounds: IndicatorBounds): boolean {
  if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(radius) || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return false;
  if (sx + radius >= 0 && sx - radius <= width && sy + radius >= 0 && sy - radius <= height) return false;
  const cx=(bounds.left+bounds.right)/2,cy=(bounds.top+bounds.bottom)/2,dx=sx-cx,dy=sy-cy;
  const tx=dx ? (bounds.right-bounds.left)/2/Math.abs(dx) : Infinity;
  const ty=dy ? (bounds.bottom-bounds.top)/2/Math.abs(dy) : Infinity;
  const t=Math.min(tx,ty);
  out.x=cx+dx*t;out.y=cy+dy*t;
  out.edge=tx<ty ? (dx>0?1:3) : (dy>0?2:0);
  out.ideal=out.edge%2 ? out.y : out.x;
  out.targetX=sx;out.targetY=sy;
  return true;
}

/** Quantized direction is recomputed AFTER packing, so the arrow still points at its soldier. */
export function soldierIndicatorDirection(marker: SoldierIndicator): number {
  return (Math.round(Math.atan2(marker.targetY-marker.y,marker.targetX-marker.x)/(Math.PI/4))+8)%8;
}

/** Reuse caller storage. Slide along the edge around HUD/other markers, then use inner lanes. */
export function packSoldierIndicators(markers: SoldierIndicator[], bounds: IndicatorBounds, obstacles: readonly IndicatorRect[]): void {
  markers.sort((a,b)=>a.edge-b.edge||a.ideal-b.ideal);
  const radius=INDICATOR_RADIUS+2;
  for(let i=0;i<markers.length;i++){
    const m=markers[i],vertical=m.edge%2===1;
    const low=vertical?bounds.top:bounds.left,high=vertical?bounds.bottom:bounds.right;
    const steps=Math.ceil((high-low)/INDICATOR_SPACING)+1;
    let placed=false;
    for(let lane=0;lane<4&&!placed;lane++)for(let n=0;n<=steps*2&&!placed;n++){
      const offset=n===0?0:Math.ceil(n/2)*INDICATOR_SPACING*(n%2?1:-1);
      const along=Math.max(low,Math.min(high,m.ideal+offset));
      const inward=lane*INDICATOR_SPACING;
      const x=vertical?(m.edge===1?bounds.right-inward:bounds.left+inward):along;
      const y=vertical?along:(m.edge===2?bounds.bottom-inward:bounds.top+inward);
      if(x<bounds.left||x>bounds.right||y<bounds.top||y>bounds.bottom)continue;
      let blocked=false;
      for(const r of obstacles)if(x+radius>r.x&&x-radius<r.x+r.width&&y+radius>r.y&&y-radius<r.y+r.height){blocked=true;break;}
      if(blocked)continue;
      for(let j=0;j<i;j++)if(Math.abs(x-markers[j].x)<INDICATOR_SPACING&&Math.abs(y-markers[j].y)<INDICATOR_SPACING){blocked=true;break;}
      if(!blocked){m.x=x;m.y=y;placed=true;}
    }
    // Extremely small/fully covered viewports still retain the directional marker.
    m.x=Math.round(m.x);m.y=Math.round(m.y);
  }
}
