import { ART_PIXEL } from "../config";
import type { Game } from "../Game";
import type { Soldier } from "../entities/Soldier";
import { soldierShapeIndex } from "../entities/soldierShapes";
import { soldierShapeSprite, soldierSpriteBounds } from "./sprites";
import { packSoldierIndicators, projectSoldierIndicator, soldierIndicatorDirection, soldierPixelsOnscreen, type SoldierIndicator } from "./SoldierIndicatorLayout";

interface Marker extends SoldierIndicator { soldier: Soldier | null; sprite: HTMLCanvasElement | null; }

/** Screen-space miniatures, drawn after fog/lighting at a fixed readable size. */
export class OffscreenSoldierRenderer {
  private readonly pool: Marker[]=[];
  private readonly active: Marker[]=[];
  private readonly arrows: HTMLCanvasElement[]=[];

  draw(ctx: CanvasRenderingContext2D, game: Game): void {
    if(game.soldiers.length===0){
      if(this.active.length){this.active.length=0;for(const marker of this.pool){marker.soldier=null;marker.sprite=null;}}
      return;
    }
    const cam=game.camera,w=cam.viewW,h=cam.viewH;
    const padding=Math.min(20,w/4,h/4),hud=game.hud.soldierIndicatorLayout;
    const top=Math.min(Math.max(padding,hud.top),h/2-1);
    const bottom=Math.max(Math.min(h-padding,hud.bottom),h/2+1);
    const bounds={left:Math.min(Math.max(padding,hud.left),w/2-1),top,right:Math.max(Math.min(w-padding,hud.right),w/2+1),bottom};
    this.active.length=0;
    for(const s of game.soldiers){
      if(!s.alive)continue;
      const selected=cam.following&&cam.targetId===s.id;
      const sprite=soldierShapeSprite(soldierShapeIndex(s.slotIndex),s.facingAngle,selected);
      const i=this.active.length;
      const marker=this.pool[i]??(this.pool[i]={x:0,y:0,edge:0,ideal:0,targetX:0,targetY:0,soldier:null,sprite:null});
      const sx=cam.worldToScreenX(s.x),sy=cam.worldToScreenY(s.y),size=Math.max(1,Math.round(sprite.width*ART_PIXEL*cam.zoom));
      if(soldierPixelsOnscreen(sx,sy,size,w,h,soldierSpriteBounds(sprite)))continue;
      if(!projectSoldierIndicator(marker,sx,sy,0,w,h,bounds))continue;
      marker.soldier=s;marker.sprite=sprite;this.active.push(marker);
    }
    for(let i=this.active.length;i<this.pool.length;i++){this.pool[i].soldier=null;this.pool[i].sprite=null;}
    if(this.active.length===0)return;
    packSoldierIndicators(this.active,bounds,hud.obstacles);
    ctx.save();ctx.globalAlpha=1;ctx.globalCompositeOperation="source-over";ctx.imageSmoothingEnabled=false;
    for(const m of this.active){
      const direction=soldierIndicatorDirection(m),a=direction*Math.PI/4;
      const sprite=m.sprite!;
      ctx.fillStyle="rgba(4,12,22,0.9)";
      ctx.fillRect(m.x-9,m.y-10,18,20);ctx.fillRect(m.x-10,m.y-9,20,18);
      ctx.drawImage(sprite,m.x-9,m.y-9,18,18);
      const arrow=this.arrows[direction]??(this.arrows[direction]=this.makeArrow(direction));
      ctx.drawImage(arrow,Math.round(m.x+Math.cos(a)*11)-5,Math.round(m.y+Math.sin(a)*11)-5);
    }
    ctx.restore();
  }

  private makeArrow(direction: number): HTMLCanvasElement {
    const canvas=document.createElement("canvas");canvas.width=canvas.height=11;
    const ctx=canvas.getContext("2d")!,dx=Math.round(Math.cos(direction*Math.PI/4)),dy=Math.round(Math.sin(direction*Math.PI/4));
    const pixels=new Set<number>();
    const line=(x0:number,y0:number,x1:number,y1:number)=>{
      const n=Math.max(Math.abs(x1-x0),Math.abs(y1-y0));
      for(let i=0;i<=n;i++)pixels.add((5+Math.round(y0+(y1-y0)*i/n))*11+5+Math.round(x0+(x1-x0)*i/n));
    };
    line(-2*dx,-2*dy,3*dx,3*dy);
    line(3*dx,3*dy,dx-2*dy,dy+2*dx);line(3*dx,3*dy,dx+2*dy,dy-2*dx);
    ctx.fillStyle="#030810";
    for(const p of pixels){const x=p%11,y=Math.floor(p/11);ctx.fillRect(x-1,y-1,3,3);}
    ctx.fillStyle="#a5efff";
    for(const p of pixels)ctx.fillRect(p%11,Math.floor(p/11),1,1);
    return canvas;
  }
}
