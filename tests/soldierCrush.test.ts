import { describe, expect, it } from "vitest";
import { Rng } from "../src/core/Rng";
import { Soldier, baseSoldierStats } from "../src/entities/Soldier";
import { DamageNumbers } from "../src/entities/DamageNumbers";
import { CombatSystem } from "../src/systems/CombatSystem";
import { circleIsClear, PhysicsSystem } from "../src/systems/PhysicsSystem";
import { PixelWorld, SUB } from "../src/world/PixelWorld";

function scene(kind: number = SUB.blight, hp = 500) {
  const world=new PixelWorld({width:32,height:32,cellSize:8,roomSize:4});
  const si=10*world.subWidth+10;
  world.subKind[si]=kind;world.subHealth[si]=hp;
  const s=new Soldier(36.9,42,1,0,60);
  return {world,si,s,physics:new PhysicsSystem(world,new Rng(1))};
}

describe("soldier contact with half-size blocks",()=>{
  it.each(Object.values(SUB))("destroys kind %s completely, without bouncing off the removed block",kind=>{
    const {world,si,s,physics}=scene(kind,65000);
    const numbers=new DamageNumbers(world), destroyed:number[]=[];
    world.addDestroyListener((_cx,_cy,sub,sx,sy)=>{if(sub)destroyed.push(sy*world.subWidth+sx)});
    expect(physics.resolve(s)).toBe(false);
    expect(world.subHealth[si]).toBe(0);
    expect(s.vx).toBe(60);
    expect(circleIsClear(world,s.x,s.y,s.radius)).toBe(true);
    expect(destroyed).toEqual([si]);
    expect(numbers.items).toHaveLength(0);
    physics.resolve(s);expect(destroyed).toHaveLength(1);
  });

  it("does not destroy a block merely inside the circle's bounding box",()=>{
    const {world,si,s,physics}=scene();
    s.x=s.y=36.9;
    physics.resolve(s);
    expect(world.subHealth[si]).toBe(500);
  });

  it("leaves full-size blocks and protected boundary cells intact",()=>{
    const {world,si,s,physics}=scene();
    world.setCell(5,5,500);world.subHealth[si]=100;
    expect(physics.resolve(s)).toBe(true);
    expect(world.health[5*world.width+5]).toBe(500);
    expect(world.subHealth[si]).toBe(100);
    world.health[5*world.width+5]=0;world.boundary[5*world.width+5]=1;
    s.x=36.9;s.y=42;
    physics.resolve(s);
    expect(world.subHealth[si]).toBe(100);
  });

  it.each([false,true])("crushes at high speed with manual movement=%s",manual=>{
    const {world,si,s,physics}=scene();
    s.x=20;s.speed=900;s.vx=900;s.isManual=manual;
    physics.step(s,.05);
    expect(world.subHealth[si]).toBe(0);
    expect(s.x).toBeCloseTo(65);
    expect(s.vx).toBe(900);
  });

  it("preserves effects, destruction events and the soldier's freeze-chain ownership",()=>{
    const {world,si,s,physics}=scene(SUB.blight,100);
    world.setSubCell(11,10,200);
    const hits: {result:number;sub:boolean|undefined;owner:number|undefined}[]=[];
    const combat=new CombatSystem(world,new Rng(2),baseSoldierStats(),{
      onImpact:(_x,_y,_nx,_ny,_cx,_cy,result,sub,owner)=>hits.push({result,sub,owner}),
    });
    combat.freeze.freezeSubCell(10,10,99);
    physics.step(s,0,undefined,undefined,undefined,(soldier,sx,sy)=>combat.crushSubcell(soldier,sx,sy));
    expect(world.subHealth[si]).toBe(0);
    expect(hits).toEqual([{result:2,sub:true,owner:s.id}]);
    expect(combat.freeze.pending.some(p=>p.triggerOwnerId===s.id&&p.freezeOwnerId===99)).toBe(true);
    combat.crushSubcell(s,10,10);expect(hits).toHaveLength(1);
  });
});
