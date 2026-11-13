import { PRISM } from "../config";
import type { Game } from "../Game";

/** Bounded Canvas-only effects; never alter weapon simulation. */
export function drawWeaponExpansion(ctx: CanvasRenderingContext2D, game: Game, reduced: boolean): void {
  const cam = game.camera;
  ctx.save();
  if (!reduced) for (const s of game.soldiers) {
    if (!s.alive || s.dashLeft <= 0) continue;
    const speed = Math.hypot(s.vx,s.vy); if (speed < 1e-6) continue;
    const x = cam.worldToScreenX(s.x); const y = cam.worldToScreenY(s.y);
    ctx.strokeStyle = "rgba(115,235,255,0.65)"; ctx.lineWidth = Math.max(1,cam.zoom*2);
    ctx.beginPath(); ctx.moveTo(x,y);
    ctx.lineTo(x-s.vx/speed*16*cam.zoom,y-s.vy/speed*16*cam.zoom); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(x,y,Math.max(2,7*cam.zoom),Math.max(1,4*cam.zoom),s.facingAngle,0,Math.PI*2);ctx.stroke();
  }
  for (const drone of game.combat.drones.pool.items) {
    if (!drone.active) continue;
    const x=cam.worldToScreenX(drone.x);const y=cam.worldToScreenY(drone.y);
    if (x < -24 || y < -24 || x > cam.viewW+24 || y > cam.viewH+24) continue;
    const z=Math.max(0.75,cam.zoom);
    ctx.fillStyle="#213541";ctx.fillRect(x-3*z,y-2*z,6*z,4*z);
    ctx.fillStyle="#7ce4df";ctx.fillRect(x-z,y-z,2*z,2*z);
    const rotor=reduced?1:0.5+0.5*Math.abs(Math.sin(drone.phase*5));
    ctx.fillStyle="#c5f9ff";ctx.fillRect(x-5*z,y-z,rotor*3*z,z);ctx.fillRect(x+2*z,y-z,rotor*3*z,z);
    if (drone.fireCooldown>1/drone.fireRate-0.06) {ctx.fillStyle="#fff1ae";ctx.fillRect(x+drone.dx*4*z,y+drone.dy*4*z,z,z);}
  }
  for (const segment of game.combat.laser.segments.items) {
    if (!segment.active) continue;
    const x1=cam.worldToScreenX(segment.x1);const y1=cam.worldToScreenY(segment.y1);
    const x2=cam.worldToScreenX(segment.x2);const y2=cam.worldToScreenY(segment.y2);
    ctx.globalAlpha=reduced?0.85:Math.min(1,segment.life/PRISM.visualLife);
    ctx.strokeStyle=PRISM.colors[segment.band];
    ctx.lineWidth=Math.max(1.5,cam.zoom*(0.8+segment.band*0.13));
    ctx.setLineDash([]);ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();
    ctx.strokeStyle="#ffffff";ctx.lineWidth=Math.max(0.6,cam.zoom*0.25);
    if (game.save.data.settings.prismPatterns) ctx.setLineDash([2+segment.band,3]);
    ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();ctx.setLineDash([]);
    if(segment.reflected){ctx.beginPath();ctx.moveTo(x2-3,y2);ctx.lineTo(x2+3,y2);ctx.moveTo(x2,y2-3);ctx.lineTo(x2,y2+3);ctx.stroke();}
  }
  for(const shot of game.combat.revolver.pool.items){
    if(!shot.active || shot.phase==="recording")continue;
    const x=cam.worldToScreenX(shot.x);const y=cam.worldToScreenY(shot.y);
    if(x < -24 || y < -24 || x > cam.viewW+24 || y > cam.viewH+24)continue;
    ctx.globalAlpha=0.75;ctx.strokeStyle="#d7a5ff";ctx.lineWidth=Math.max(1,cam.zoom);
    if(shot.phase==="waiting"){
      ctx.beginPath();ctx.arc(x,y,Math.max(2,cam.zoom*2),0,Math.PI*2);ctx.stroke();
    }else{
      const from=(shot.cursor+1)*2;const dx=shot.points[from]-shot.x;const dy=shot.points[from+1]-shot.y;
      const length=Math.hypot(dx,dy);const tail=Math.min(12,length)*cam.zoom;
      ctx.beginPath();ctx.moveTo(x,y);if(length>1e-8)ctx.lineTo(x+dx/length*tail,y+dy/length*tail);ctx.stroke();
    }
    ctx.fillStyle="#f5e8ff";ctx.fillRect(x-1,y-1,Math.max(1,cam.zoom),Math.max(1,cam.zoom));
  }
  // Perfect Rebound is a visual echo, not an additional damage actor.
  if (!reduced) for (const b of game.combat.bullets.items) {
    if (!b.active || !b.afterimage || b.style!==3) continue;
    ctx.globalAlpha=0.3;ctx.strokeStyle="#aff7ff";ctx.lineWidth=Math.max(1,cam.zoom);
    const x=cam.worldToScreenX(b.x-b.dx*5);const y=cam.worldToScreenY(b.y-b.dy*5);
    ctx.beginPath();ctx.arc(x,y,Math.max(2,b.slashWidth*cam.zoom*0.5),Math.atan2(b.dy,b.dx)-0.9,Math.atan2(b.dy,b.dx)+0.9);ctx.stroke();
  }
  ctx.restore();
}
