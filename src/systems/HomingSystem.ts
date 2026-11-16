import type { Bullet } from "../entities/Bullet";
import type { CreatureSystem } from "../entities/Creatures";
import type { PixelWorld } from "../world/PixelWorld";
import type { LateEncounters } from "./LateEncounters";
import { hasLineOfSight } from "./PhysicsSystem";

export const HOMING = { range: 128, retargetSeconds: 0.12, turnRate: Math.PI * 1.5, minForwardDot: 0.25 } as const;

/** Steering preserves speed, damage and range; movement still uses swept collisions. */
export function steerHomingBullet(b: Bullet, dt: number, world: PixelWorld, creatures?: CreatureSystem | null, late?: LateEncounters | null): void {
  if (!b.homing) return;
  b.homingCooldown -= dt;
  if (b.homingCooldown <= 0) {
    b.homingCooldown = HOMING.retargetSeconds;
    b.homingLocked = false;
    let best = HOMING.range * HOMING.range;
    const consider = (x: number, y: number): void => {
      const dx=x-b.x,dy=y-b.y,d2=dx*dx+dy*dy;
      if (d2 < 1e-6 || d2 >= best || (dx*b.dx+dy*b.dy)/Math.sqrt(d2) < HOMING.minForwardDot) return;
      if (!hasLineOfSight(world,b.x,b.y,x,y)) return;
      best=d2;b.homingX=x;b.homingY=y;b.homingLocked=true;
    };
    if (creatures) {
      for (const f of creatures.flowers) if(f.hp>0&&!f.wilted)consider(f.hx,f.hy);
      for (const w of creatures.worms) if(w.hp>0)consider(w.seg[0],w.seg[1]);
      for (const s of creatures.specimens) if(s.hp>0&&s.free)consider(s.x,s.y);
    }
    if (late) for (const actor of late.actors) if(actor.alive&&actor.hp>0)consider(actor.x,actor.y);
    // Scan only a bounded neighborhood, and only at the acquisition cadence.
    const cs=world.cellSize,ss=world.subCellSize;
    const x0=Math.max(0,Math.floor((b.x-HOMING.range)/cs)),x1=Math.min(world.width-1,Math.floor((b.x+HOMING.range)/cs));
    const y0=Math.max(0,Math.floor((b.y-HOMING.range)/cs)),y1=Math.min(world.height-1,Math.floor((b.y+HOMING.range)/cs));
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
      const i=y*world.width+x;
      if(world.boundary[i])continue;
      if(world.health[i]>0){if(world.blight[i])consider((x+.5)*cs,(y+.5)*cs);continue;}
      for(let oy=0;oy<2;oy++)for(let ox=0;ox<2;ox++){
        const sx=x*2+ox,sy=y*2+oy;
        if(world.isBlightSubAt(sx,sy))consider((sx+.5)*ss,(sy+.5)*ss);
      }
    }
  }
  if (!b.homingLocked) return;
  const desired=Math.atan2(b.homingY-b.y,b.homingX-b.x),current=Math.atan2(b.dy,b.dx);
  const delta=Math.atan2(Math.sin(desired-current),Math.cos(desired-current));
  const turn=Math.max(-HOMING.turnRate*dt,Math.min(HOMING.turnRate*dt,delta));
  b.dx=Math.cos(current+turn);b.dy=Math.sin(current+turn);
}
