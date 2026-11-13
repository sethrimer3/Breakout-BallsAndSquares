import { REVERSE } from "../config";
import { FixedPool } from "../core/FixedPool";

export class ReverseShot {
  active = false;
  phase: "recording" | "waiting" | "returning" = "recording";
  readonly points = new Float64Array(REVERSE.maxPoints * 2);
  readonly cells = new Set<number>();
  readonly targets = new Set<object>();
  count = 0; cursor = 0; x = 0; y = 0; age = 0; pause = 0;
  ownerId = 0; speed = 0; damage = 0; terrainDamageBonus = 0; blightMultiplier = 1;
  hits = 0; coreDamageBonus = 0;
}

/** Replays a bounded polyline backwards. Damage callbacks never steer the echo. */
export class ReverseRevolver {
  readonly pool = new FixedPool(REVERSE.poolSize, () => new ReverseShot());
  dropped = 0;
  constructor(private damageSegment: (shot: ReverseShot, x: number, y: number, tx: number, ty: number) => void,
    private onReturn: (shot: ReverseShot) => void = () => {}) {}

  begin(x: number, y: number, speed: number, damage: number, bonus: number, multiplier: number, ownerId: number): ReverseShot | null {
    const shot = this.pool.acquire();
    if (!shot) { this.dropped++; return null; }
    shot.phase="recording";shot.count=1;shot.cursor=0;shot.points[0]=shot.x=x;shot.points[1]=shot.y=y;
    shot.speed=speed;shot.damage=damage;shot.terrainDamageBonus=bonus;shot.blightMultiplier=multiplier;shot.ownerId=ownerId;
    shot.age=shot.pause=shot.hits=shot.coreDamageBonus=0;shot.cells.clear();shot.targets.clear();
    return shot;
  }

  record(shot: ReverseShot, x: number, y: number): boolean {
    const last=(shot.count-1)*2;const lx=shot.points[last];const ly=shot.points[last+1];
    const dx=x-lx;const dy=y-ly;
    if(Math.hypot(dx,dy)<1e-8)return true;
    if(shot.count>=2){
      const ax=lx-shot.points[last-2];const ay=ly-shot.points[last-1];
      // Collapse only straight, forward motion. Bankshots retain their vertices.
      if(ax*dx+ay*dy>0 && Math.abs(ax*dy-ay*dx)<1e-7*Math.hypot(ax,ay)*Math.hypot(dx,dy)){
        shot.points[last]=x;shot.points[last+1]=y;return true;
      }
    }
    if(shot.count>=REVERSE.maxPoints)return false;
    shot.points[shot.count*2]=x;shot.points[shot.count*2+1]=y;shot.count++;
    return true;
  }

  finish(shot: ReverseShot): void {
    if(!shot.active || shot.phase!=="recording")return;
    if(shot.count<2){this.pool.release(shot);return;}
    shot.phase="waiting";shot.pause=REVERSE.pause;shot.cursor=shot.count-2;
    shot.x=shot.points[(shot.count-1)*2];shot.y=shot.points[(shot.count-1)*2+1];
  }

  update(dt: number): void {
    for(const shot of this.pool.items){
      if(!shot.active)continue;
      shot.age+=dt;
      if(shot.age>REVERSE.safetyLife){this.pool.release(shot);continue;}
      if(shot.phase==="recording")continue;
      let time=dt;
      if(shot.phase==="waiting"){
        const wait=Math.min(time,shot.pause);shot.pause-=wait;time-=wait;
        if(shot.pause>1e-9)continue;
        shot.phase="returning";this.onReturn(shot);
      }
      let guard=0;
      while(shot.active && time>1e-9 && guard++<16){
        if(shot.cursor<0){this.pool.release(shot);break;}
        const tx=shot.points[shot.cursor*2];const ty=shot.points[shot.cursor*2+1];
        const distance=Math.hypot(tx-shot.x,ty-shot.y);
        if(distance<1e-8){shot.cursor--;continue;}
        const advance=Math.min(distance,shot.speed*time);
        const nx=shot.x+(tx-shot.x)*advance/distance;const ny=shot.y+(ty-shot.y)*advance/distance;
        this.damageSegment(shot,shot.x,shot.y,nx,ny);
        shot.x=nx;shot.y=ny;time-=advance/shot.speed;
        if(advance>=distance-1e-8)shot.cursor--;
        if(shot.cursor<0)this.pool.release(shot);
      }
    }
  }

  clear(): void {this.pool.clear();this.dropped=0;for(const shot of this.pool.items){shot.cells.clear();shot.targets.clear();}}
}
