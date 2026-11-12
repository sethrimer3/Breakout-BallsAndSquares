import { describe,expect,it,vi } from "vitest";
import { DRONE } from "../src/config";
import { Rng } from "../src/core/Rng";
import { Soldier,baseSoldierStats } from "../src/entities/Soldier";
import { DroneSystem } from "../src/systems/DroneSystem";
import { CombatSystem } from "../src/systems/CombatSystem";
import { circleIsClear } from "../src/systems/PhysicsSystem";
import { PixelWorld,SUB } from "../src/world/PixelWorld";

function scene(){
 const world=new PixelWorld({width:32,height:32,cellSize:8,roomSize:4});
 const stats=baseSoldierStats();const owner=new Soldier(100,100,1,0,60,"drone_shepherd");
 const fire=vi.fn();const launch=vi.fn();const drones=new DroneSystem(world,fire,launch);
 return {world,stats,owner,fire,launch,drones};
}

describe("Drone Shepherd",()=>{
 it("releases on its own interval and does not fire carrier bullets",()=>{
  const {world,stats,owner}=scene();const combat=new CombatSystem(world,new Rng(1),stats);
  for(let i=0;i<360;i++)combat.updateSoldier(owner,1/60);
  expect(combat.drones.pool.activeCount).toBe(2);expect(combat.bullets.activeCount).toBe(0);
 });
 it("enforces per-owner and global caps across eight carriers",()=>{
  const {stats,drones,owner}=scene();
  for(let i=0;i<8;i++)drones.release(owner,stats);
  expect(drones.pool.activeCount).toBe(2);
  stats.droneCapacity=7;
  for(let n=0;n<8;n++){
   const carrier=new Soldier(100,100,1,0,60,"drone_shepherd");
   for(let i=0;i<7;i++)drones.release(carrier,stats);
  }
  expect(drones.pool.activeCount).toBe(DRONE.poolSize);expect(drones.dropped).toBeGreaterThan(0);
 });
 it.each([false,true])("never crosses a sealed %s-size wall or teleports to its owner",half=>{
  const {world,stats,owner,drones}=scene();
  if(half){for(let y=0;y<world.subHeight;y++){const i=y*world.subWidth+26;world.subHealth[i]=100;world.subKind[i]=SUB.blight;}}
  else for(let y=0;y<world.height;y++)world.health[y*world.width+13]=100;
  const drone=drones.release(owner,stats)!;owner.x=200;
  for(let i=0;i<600;i++){
   drones.update(1/60);
   if(!drone.active)break;
   expect(drone.x).toBeLessThan(104);expect(circleIsClear(world,drone.x,drone.y,DRONE.radius)).toBe(true);
  }
 });
 it("preserves ownership through the emergency lifetime and emits one recall shot",()=>{
  const {stats,owner,drones,fire}=scene();stats.droneRecall=true;
  const drone=drones.release(owner,stats)!;owner.alive=false;
  drones.update(0.1);expect(drone.life).toBeCloseTo(1.4);
  for(let i=0;i<90;i++)drones.update(1/60);
  expect(drone.active).toBe(false);
  expect(fire.mock.calls.every(([shot])=>shot.ownerId===owner.id)).toBe(true);
  const shots=fire.mock.calls.length;drones.update(1);expect(fire).toHaveBeenCalledTimes(shots);
 });
 it("takes damage from newly grown terrain instead of receiving soldier rescue",()=>{
  const {world,stats,owner,drones}=scene();const drone=drones.release(owner,stats)!;
  world.health[Math.floor(drone.y/8)*world.width+Math.floor(drone.x/8)]=100;
  drones.update(1/60);expect(drone.active).toBe(false);
 });
 it("snapshots modifiers, attributes bullets, and explicitly excludes Pistol Bankshot",()=>{
  const {world,stats,owner,drones,fire}=scene();owner.mods.damageBonus=2;owner.mods.terrainDamageBonus=3;owner.mods.pierce=1;
  drones.release(owner,stats);for(let i=0;i<60;i++)drones.update(1/60);
  const shot=fire.mock.calls[0][0];expect(shot.damage).toBe(3);expect(shot.ownerId).toBe(owner.id);
  const combat=new CombatSystem(world,new Rng(1),stats);stats.pistolBounces=5;combat.fireDroneShot(shot);
  const bullet=combat.bullets.items.find(b=>b.active)!;
  expect(bullet).toMatchObject({ownerId:owner.id,damage:3,terrainDamageBonus:3,pierceLeft:1,bounceLeft:0,fromDrone:true});
 });
 it("throttles local target searches and keeps aim corrections within the purchased angle",()=>{
  const {world,stats,owner,drones,fire}=scene();stats.droneAim=20;
  const search=vi.spyOn(world,"isBlightAt");const drone=drones.release(owner,stats)!;
  for(let i=0;i<60;i++)drones.update(1/60);
  expect(search.mock.calls.length).toBeLessThanOrEqual(169*5);
  expect(fire.mock.calls.every(([shot])=>Math.hypot(shot.dx,shot.dy)>0.99)).toBe(true);
  expect(drone.active).toBe(true);
 });
 it("clears actors and resets every field when pool slots are reused",()=>{
  const {stats,owner,drones}=scene();const drone=drones.release(owner,stats)!;
  drone.hp=0;drone.life=0;drone.recall=true;drones.clear();
  expect(drone.owner).toBeNull();expect(drones.pool.activeCount).toBe(0);
  expect(drones.release(owner,stats)).toBe(drone);
  expect(drone.hp).toBe(1);expect(drone.life).toBe(12);expect(drone.recall).toBe(false);expect(drone.ownerId).toBe(owner.id);
 });
});
