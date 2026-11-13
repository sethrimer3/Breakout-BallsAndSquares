import { describe, expect, it } from "vitest";
import { MenuGameplaySimulation, menuWorldSize } from "../src/ui/MenuGameplaySimulation";
import { circleIsClear } from "../src/systems/PhysicsSystem";

function reachable(demo: MenuGameplaySimulation): Set<number> {
  const w=demo.world;const first=demo.rooms[0];const start=(first.y+5)*w.width+first.x+5;
  const seen=new Set<number>([start]);const todo=[start];
  while(todo.length){const i=todo.pop()!;const x=i%w.width,y=Math.floor(i/w.width);
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,ny=y+dy,ni=ny*w.width+nx;
      if(w.inBounds(nx,ny)&&!w.solidAt(nx,ny)&&!seen.has(ni)){seen.add(ni);todo.push(ni);}
    }
  }
  return seen;
}

describe("main menu gameplay",()=>{
  it("builds connected random rooms, safe pistol spawns and living tier-1 generators across screen shapes",()=>{
    for(const aspect of [390/844,1,16/9,32/9])for(const seed of [1,7,42,123]){
      const demo=new MenuGameplaySimulation(aspect,seed);const w=demo.world;
      expect(demo.rooms).toHaveLength(6);expect(demo.soldiers).toHaveLength(2);
      expect(w.blightCores.filter(c=>c.alive).length).toBeGreaterThanOrEqual(1);
      const seen=reachable(demo);
      for(const r of demo.rooms)expect(seen.has((r.y+2)*w.width+r.x+2),`room ${r.id} at aspect ${aspect}, seed ${seed}`).toBe(true);
      for(const s of demo.soldiers){
        expect(s.weapon).toBe("pistol");expect(s.mutation).toBe(null);
        expect(circleIsClear(w,s.x,s.y,s.radius)).toBe(true);
        expect(s.x).toBeGreaterThan(w.roomX0*w.cellSize);expect(s.x).toBeLessThan((w.roomX1+1)*w.cellSize);
      }
      for(let y=w.roomY0;y<=w.roomY1;y++)for(let x=w.roomX0;x<=w.roomX1;x++){
        expect(w.health[y*w.width+x]).toBe(0);expect(w.blight[y*w.width+x]).toBe(0);expect(w.coreId[y*w.width+x]).toBe(0);
      }
      for(let y=0;y<w.height;y++)for(let x=0;x<w.width;x++)expect(w.fillTierAt(x,y)).toBe(1);
      expect([...w.wall].every(v=>v===0)).toBe(true);
    }
  });
  it("reproduces a demo seed and generates a different room arrangement for a different seed",()=>{
    const layout=(seed:number)=>new MenuGameplaySimulation(16/9,seed).rooms.map(r=>[r.x,r.y,r.size]);
    expect(layout(7)).toEqual(layout(7));expect(layout(7)).not.toEqual(layout(8));
  });
  it("uses live pistol combat, destructible terrain, bouncing soldiers and generator growth",()=>{
    const d=new MenuGameplaySimulation(16/9,7);
    for(let i=0;i<60*35;i++){
      d.step(1/60);
      expect(d.world.blightCores.some(c=>c.alive)).toBe(true);
      expect(d.soldiers.filter(s=>s.alive).every(s=>Number.isFinite(s.x)&&Number.isFinite(s.y))).toBe(true);
    }
    expect(d.shots).toBeGreaterThan(30);expect(d.destroyed).toBeGreaterThan(10);
    expect(d.growth.totalSubBlightEvents).toBeGreaterThan(0);
    expect(d.combat.bullets.activeCount).toBeLessThanOrEqual(d.combat.bullets.items.length);
    expect(d.loot.count).toBeLessThanOrEqual(d.loot.cap);
  });
  it("renews a cleared/lost skirmish with two safe soldiers and living generators",()=>{
    const d=new MenuGameplaySimulation(1,42);const first=d.generation;
    for(const c of d.world.blightCores)c.alive=false;
    d.step(1/60);expect(d.generation).toBe(first+1);expect(d.world.blightCores.some(c=>c.alive)).toBe(true);
    for(const s of d.soldiers)s.alive=false;
    d.step(1/60);expect(d.generation).toBe(first+2);expect(d.soldiers.filter(s=>s.alive)).toHaveLength(2);
    expect(d.combat.bullets.activeCount).toBe(0);
  });
  it("uses fixed steps without catching up a suspended menu",()=>{
    const a=new MenuGameplaySimulation(1,3),b=new MenuGameplaySimulation(1,3);
    a.advance(1/30);b.advance(1/60);b.advance(1/60);
    expect(a.soldiers.map(s=>[s.x,s.y])).toEqual(b.soldiers.map(s=>[s.x,s.y]));
    a.advance(10000);expect(a.time).toBeLessThan(.2);
    expect(menuWorldSize(NaN).width).toBe(64);
  });
});
