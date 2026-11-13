import { describe, it, expect, vi } from "vitest";
import { ReverseRevolver } from "../src/systems/ReverseRevolver";
import { REVERSE, GALE } from "../src/config";
import { CombatSystem } from "../src/systems/CombatSystem";
import { SaveManager, type StorageLike } from "../src/progression/SaveManager";
import { PixelWorld, MAT } from "../src/world/PixelWorld";
import { Rng } from "../src/core/Rng";
import { Soldier, baseSoldierStats, resolvePrimaryMutation } from "../src/entities/Soldier";

function fixture() {
  const world = new PixelWorld({width:128,height:32,cellSize:8,roomSize:4});
  const stats=baseSoldierStats();stats.reverseUnlocked=true;stats.galeUnlocked=true;
  const combat=new CombatSystem(world,new Rng(1),stats,{});
  return {world,stats,combat};
}

describe("Reverse-Playback Revolver",()=>{
  it("pauses then retraces bankshot vertices in reverse order without corner shortcuts",()=>{
    const moves:number[][]=[];const returned=vi.fn();
    const r=new ReverseRevolver((_s,x,y,tx,ty)=>moves.push([x,y,tx,ty]),returned);
    const shot=r.begin(0,0,100,2,0,1,7)!;
    r.record(shot,5,0);r.record(shot,10,0);r.record(shot,10,10);
    expect(shot.count).toBe(3);r.finish(shot);
    r.update(REVERSE.pause/2);expect(moves).toHaveLength(0);
    r.update(REVERSE.pause/2);expect(returned).toHaveBeenCalledTimes(1);
    r.update(.2);
    expect(moves).toEqual([[10,10,10,0],[10,0,0,0]]);
    expect(r.pool.activeCount).toBe(0);
  });
  it("bounds path records and resets ownership, damage dedup and phases on reuse",()=>{
    const r=new ReverseRevolver(()=>{});const s=r.begin(0,0,1,1,0,1,1)!;
    for(let i=1;i<REVERSE.maxPoints;i++)expect(r.record(s,i,i%2)).toBe(true);
    expect(r.record(s,REVERSE.maxPoints,0)).toBe(false);
    s.targets.add({});s.cells.add(4);s.coreDamageBonus=99;r.clear();
    const fresh=r.begin(9,9,10,8,3,2,42)!;
    expect(fresh).toBe(s);expect(fresh.targets.size).toBe(0);expect(fresh.cells.size).toBe(0);
    expect(fresh.ownerId).toBe(42);expect(fresh.count).toBe(1);expect(fresh.coreDamageBonus).toBe(0);
  });
  it("records real wall reflections and damages a surviving wall again on return",()=>{
    const {world,stats,combat}=fixture();stats.pistolBounces=1;
    world.health[7*world.width+8]=100;
    const soldier=new Soldier(60,60,1,0,stats.speed,"pistol");soldier.mutation="reverse_revolver";
    combat.fire(soldier,1,0);const bullet=combat.bullets.items.find(b=>b.active)!;
    bullet.pendingAdvance=0;bullet.speed=100;bullet.damage=10;
    const replay=bullet.replay!;replay.speed=100;replay.damage=10;
    combat.updateBullet(bullet,.1);expect(bullet.dx).toBe(-1);
    expect(world.health[7*world.width+8]).toBe(90);
    bullet.life=0;combat.updateBullet(bullet,.01);
    expect(replay.phase).toBe("waiting");
    for(let i=0;i<20;i++)combat.revolver.update(.02);
    expect(world.health[7*world.width+8]).toBe(80);
    expect(combat.revolver.pool.activeCount).toBe(0);
  });
  it("damages each target identity only once across successive return segments",()=>{
    const {combat}=fixture();const target={};const damage=vi.fn(()=>true);
    combat.targets={targetKey:target,raycast:(_x,_y,_dx,_dy,_len,ignored)=>ignored?.has(target)?-1:0,applyHit:damage};
    const shot=combat.revolver.begin(0,0,100,2,0,1,1)!;
    combat.revolver.record(shot,100,0);combat.revolver.finish(shot);
    for(let i=0;i<30;i++)combat.revolver.update(.05);
    expect(damage).toHaveBeenCalledTimes(1);
  });
});

describe("Gale Edge",()=>{
  it("travels its explicit range independently of speed and suppresses Momentum scaling",()=>{
    const {stats,combat}=fixture();stats.katanaDash=true;
    const soldier=new Soldier(100,100,1,0,stats.speed,"katana");soldier.mutation="gale_edge";
    soldier.vx=10000;combat.fire(soldier,1,0);
    const b=combat.bullets.items.find(b=>b.active)!;
    expect(b.gale).toBe(true);expect(b.momentumBoosted).toBe(false);
    expect(b.distanceLeft).toBe(GALE.distance);b.pendingAdvance=0;b.speed=2000;b.life=10;
    combat.updateBullet(b,.2);expect(b.active).toBe(false);expect(b.totalTraveled).toBeCloseTo(GALE.distance);
  });
  it("cleaves terrain beside an empty center path once per crescent",()=>{
    const {world,stats,combat}=fixture();world.health[11*world.width+20]=1000;
    const soldier=new Soldier(100,100,1,0,stats.speed,"katana");soldier.mutation="gale_edge";
    combat.fire(soldier,1,0);const b=combat.bullets.items.find(b=>b.active)!;
    b.pendingAdvance=0;b.speed=100;b.damage=10;
    combat.updateBullet(b,.7);
    expect(world.health[11*world.width+20]).toBe(990);
    combat.updateBullet(b,.05);expect(world.health[11*world.width+20]).toBe(990);
  });
  it("requires a compatible unlocked base weapon",()=>{
    const stats=baseSoldierStats();
    expect(resolvePrimaryMutation("pistol","reverse_revolver",stats)).toBe(null);
    stats.reverseUnlocked=true;expect(resolvePrimaryMutation("pistol","reverse_revolver",stats)).toBe("reverse_revolver");
    expect(resolvePrimaryMutation("katana","reverse_revolver",stats)).toBe(null);
    stats.galeUnlocked=true;expect(resolvePrimaryMutation("katana","gale_edge",stats)).toBe("gale_edge");
    expect(resolvePrimaryMutation("pistol","gale_edge",stats)).toBe(null);
  });
});

class MemoryStorage implements StorageLike {
  values=new Map<string,string>();
  getItem(k:string){return this.values.get(k)??null;}
  setItem(k:string,v:string){this.values.set(k,v);}
}
it("restores compatible unlocked mutations and removes locked or mismatched selections",()=>{
  const storage=new MemoryStorage();const save=new SaveManager(storage);
  save.data.loadouts[0].mutation="reverse_revolver";save.save();
  expect(new SaveManager(storage).data.loadouts[0].mutation).toBe(null);
  save.data.upgrades.reverse_unlock=1;save.save();
  expect(new SaveManager(storage).data.loadouts[0].mutation).toBe("reverse_revolver");
  save.data.loadouts[0].mutation="gale_edge";save.data.upgrades.gale_unlock=1;save.save();
  expect(new SaveManager(storage).data.loadouts[0].mutation).toBe(null);
  save.data.upgrades.katana_unlock=1;save.data.loadouts[0].weapon="katana";save.save();
  expect(new SaveManager(storage).data.loadouts[0].mutation).toBe("gale_edge");
});

it("Gale stops at a closed world gate even with penetration remaining",()=>{
  const {world,stats,combat}=fixture();const i=12*world.width+20;
  world.health[i]=1000;world.mat[i]=MAT.door;world.doorId[i]=1;
  world.doors.push({id:1,tier:1,gate:{to:2,side:"east"},cells:[i],open:false,x0:20,x1:20,y0:12,y1:12});
  const soldier=new Soldier(100,100,1,0,stats.speed,"katana");soldier.mutation="gale_edge";
  combat.fire(soldier,1,0);const b=combat.bullets.items.find(b=>b.active)!;
  b.pendingAdvance=0;b.speed=100;combat.updateBullet(b,.7);
  expect(b.active).toBe(false);expect(world.health[i]).toBe(1000);expect(world.doors[0].open).toBe(false);
});
