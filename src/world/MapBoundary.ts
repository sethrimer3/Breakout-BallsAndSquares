import type { PixelWorld } from './PixelWorld';
import { gateGeometry, labCells, SECTOR_CELLS, worldRows } from './labMap';

/** 0 = playable, 1..thickness = permanent wall (inside to outside), 255 = void. */
export const BOUNDARY_VOID = 255;

/** Install after carving/fixtures. Gates retain their doors and a protected exit pocket. */
export function installMapBoundary(w: PixelWorld): void {
  w.boundaryRevision++;
  const f = w.labLayout?.frame;
  const ship = f?.def.environment === 'mothership';
  w.boundaryStone = f?.def.environment === 'forest' || f?.def.environment === 'city';
  w.boundaryThickness = ship ? 2 : 3;
  const { width: W, height: H } = w;
  const inside = new Uint8Array(W * H);
  const x0 = f ? f.x0 : 3, y0 = f ? f.y0 : 3;
  const x1 = f ? x0 + labCells(f.def) - 1 : W - 4;
  const y1 = f ? y0 + worldRows(f.def) * SECTOR_CELLS - 1 : H - 4;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    // Slow, continuous cliff undulations, outside the authored playable rectangle.
    // The hull has chamfered corners, with no playable rooms removed.
    if (ship && Math.min(x-x0, x1-x) + Math.min(y-y0, y1-y) < 8) continue;
    inside[y * W + x] = 1;
  }
  if (w.boundaryStone) {
    for (let y = y0 - 4; y <= y1 + 4; y++) for (let x = x0 - 4; x <= x1 + 4; x++) {
      if (!w.inBounds(x,y)) continue;
      const wave = (n: number) => Math.round(2 + Math.sin(n * .13) + Math.sin(n * .037 + (w.labLayout?.seed ?? 0) % 31));
      if (x >= x0-wave(y) && x <= x1+wave(y+71) && y >= y0-wave(x+113) && y <= y1+wave(x+197)) inside[y*W+x] = 1;
    }
  }
  if (f) for (const g of f.def.gates) {
    const { door, pocket } = gateGeometry(f,g);
    for (const b of [door,pocket]) for (let y=b.y0; y<=b.y1; y++) for(let x=b.x0; x<=b.x1; x++) {
      if(w.inBounds(x,y)) inside[y*W+x]=1;
    }
  }
  w.boundary.fill(BOUNDARY_VOID);
  for(let i=0;i<inside.length;i++) if(inside[i]) w.boundary[i]=0;
  // Chebyshev rings give continuous, precisely N-cell-thick corners as well as faces.
  for(let layer=1;layer<=w.boundaryThickness;layer++) {
    const pending: number[]=[];
    for(let y=0;y<H;y++) for(let x=0;x<W;x++) {
      const i=y*W+x;
      if(w.boundary[i]!==BOUNDARY_VOID) continue;
      let adjacent=false;
      for(let dy=-1;dy<=1&&!adjacent;dy++) for(let dx=-1;dx<=1;dx++) {
        if(w.inBounds(x+dx,y+dy)&&w.boundary[(y+dy)*W+x+dx]===layer-1) {adjacent=true;break;}
      }
      if(adjacent) pending.push(i);
    }
    for(const i of pending) w.boundary[i]=layer;
  }
  for(let i=0;i<w.boundary.length;i++) if(w.boundary[i]) {
    w.health[i]=65535; w.wall[i]=0; w.decor[i]=0; w.mat[i]=0;
    w.doorId[i]=0; w.coreId[i]=0; w.blight[i]=0;
    const x=i%W,y=Math.floor(i/W);
    for(let dy=0;dy<2;dy++) for(let dx=0;dx<2;dx++) {
      const si=(y*2+dy)*w.subWidth+x*2+dx;
      w.subHealth[si]=0; w.subKind[si]=0;
    }
  }
}

/** Stable albedo, without animated flashes. The outermost layer is pure black. */
export function boundaryColor(w: PixelWorld, x: number, y: number, ox=0, oy=0): [number,number,number] {
  const layer=w.boundary[y*w.width+x];
  if(!layer||layer===BOUNDARY_VOID) return [0,0,0];
  const fade=1-(layer-1)/(w.boundaryThickness-1);
  if(w.boundaryStone) {
    const grain=((x*73+y*139+ox*31+oy*17)&15)/15;
    const v=(10+grain*12+(oy===0?5:0))*fade;
    return [v*.8,v*.9,v];
  }
  const glint=oy===0?38:ox===0?20:((ox+oy+x+y)%7===0?12:0);
  return [(22+glint)*fade,(31+glint)*fade,(39+glint)*fade];
}
