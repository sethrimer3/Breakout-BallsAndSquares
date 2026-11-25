import { LateEncounters } from "../src/systems/LateEncounters";
import { describe, expect, it } from "vitest";
import { Bullet, resetBulletFields } from "../src/entities/Bullet";
import { Soldier, baseSoldierStats } from "../src/entities/Soldier";
import { Rng } from "../src/core/Rng";
import { marketFor, marketNode } from "../src/progression/BlackMarket";
import { SaveManager, sanitizeSaveData, type StorageLike } from "../src/progression/SaveManager";
import { UpgradeManager } from "../src/progression/UpgradeManager";
import { CombatSystem } from "../src/systems/CombatSystem";
import { HOMING, steerHomingBullet } from "../src/systems/HomingSystem";
import { PixelWorld } from "../src/world/PixelWorld";
import { unlockTabs, findAllSpecials } from "./helpers/progression";

class MemoryStorage implements StorageLike {
  private data=new Map<string,string>();
  getItem(k:string){return this.data.get(k)??null;}
  setItem(k:string,v:string){this.data.set(k,v);}
}
function progression(){
  const storage=new MemoryStorage(),save=new SaveManager(storage);
  unlockTabs(save);findAllSpecials(save.data);
  save.data.bank=10000;save.data.crystals=10000;save.data.essence=1000; save.data.exoticMatter=10;save.data.lifetimePixels=10000;
  return{save,storage,u:new UpgradeManager(save)};
}
function flight(){
  const world=new PixelWorld({width:64,height:64,cellSize:8,roomSize:4}),b=new Bullet();
  b.homing=true;b.x=80;b.y=80;b.dx=1;b.dy=0;b.speed=200;b.damage=5;b.life=1;b.distanceLeft=200;
  return{world,b};
}

describe("SQUELCH as a base weapon",()=>{
  it("unlocks for gold without Shotgun or Black Market access, with independent squad ownership",()=>{
    const {save,u}=progression();
    expect(u.buy("goo_unlock")).toBe(true);
    expect(save.data.bank).toBe(9820);expect(save.data.essence).toBe(1000);
    expect(save.data.upgrades.shotgun_unlock).toBe(0);
    expect(marketNode("goo_unlock")).toBeUndefined();
    expect(u.setLoadoutWeapon(0,"squelch",null).ok).toBe(true);
    expect(u.buy("shotgun_unlock")).toBe(true);
    expect(u.setLoadoutWeapon(1,"shotgun",null).ok).toBe(true);
    expect(u.setLoadoutWeapon(2,"squelch",null).ok).toBe(false);
    const world=new PixelWorld({width:64,height:64,cellSize:8,roomSize:4});
    const combat=new CombatSystem(world,new Rng(1),u.getSoldierStats());
    const soldier=new Soldier(128,128,1,0,0,"squelch");
    combat.fire(soldier);
    expect(soldier.mutation).toBeNull();
    expect(combat.goo.orbs.activeCount).toBe(1);
    expect(combat.bullets.activeCount).toBe(0);
    expect(combat.effectiveFireRate(soldier)).toBe(u.getSoldierStats().gooFireRate);
  });

  it("migrates old Shotgun/SQUELCH and goo_mortar saves without losing research or gifting homing",()=>{
    const {save}=progression();
    save.data.upgrades.goo_unlock=1;save.data.upgrades.goo_mass=3;save.data.upgrades.goo_damage=2;
    save.data.blackMarketPaths.shotgun="goo_unlock";
    save.data.loadouts[0].weapon="shotgun";save.data.loadouts[0].mutation="squelch";
    const migrated=sanitizeSaveData(save.data);
    expect(migrated.loadouts[0]).toMatchObject({weapon:"squelch",mutation:null});
    expect(migrated.upgrades).toMatchObject({goo_mass:3,goo_damage:2,homing_shotgun_unlock:0});
    expect(migrated.blackMarketPaths.shotgun).toBeUndefined();
    save.data=migrated;
    const u=new UpgradeManager(save);
    expect(u.getSoldierStats().gooUnlocked).toBe(true);
    u.refundBlackMarket();
    expect(u.getSoldierStats().gooUnlocked).toBe(true);
    expect(save.data.upgrades.goo_damage).toBe(2);
    const legacy=JSON.parse(JSON.stringify(migrated));
    legacy.loadouts[0].weapon="goo_mortar";
    expect(sanitizeSaveData(legacy).loadouts[0]).toMatchObject({weapon:"squelch",mutation:null});
  });

  it("offers homing versus Vacuum on Shotgun's exclusive Black Market tree",()=>{
    const {save,storage,u}=progression();
    expect(marketFor("shotgun")?.paths.map(p=>p.root)).toEqual(["homing_shotgun_unlock","vacuum_unlock"]);
    expect(u.buy("shotgun_unlock")).toBe(true);
    expect(u.buy("homing_shotgun_unlock")).toBe(false);
    expect(u.buy("black_market_shotgun")).toBe(true);
    expect(u.buy("homing_shotgun_unlock")).toBe(true);
    expect(save.data.exoticMatter).toBe(8);
    expect(u.getSoldierStats().homingShotgunUnlocked).toBe(true);
    expect(u.setLoadoutWeapon(0,"shotgun","homing_shotgun").ok).toBe(true);
    expect(u.buy("vacuum_unlock")).toBe(true);
    expect(u.getSoldierStats()).toMatchObject({homingShotgunUnlocked:false,vacuumUnlocked:true});
    expect(u.buy("homing_shotgun_unlock")).toBe(true);
    const loaded=new SaveManager(storage);
    expect(loaded.data.loadouts[0]).toMatchObject({weapon:"shotgun",mutation:"homing_shotgun"});
    expect(new UpgradeManager(loaded).getSoldierStats().homingShotgunUnlocked).toBe(true);
  });
});

describe("homing Shotgun pellets",()=>{
  it("steers toward Blight with a bounded turn rate and unchanged projectile stats",()=>{
    const {world,b}=flight();world.setCell(16,15,100,"grown");
    steerHomingBullet(b,1/60,world);
    expect(b.homingLocked).toBe(true);
    expect(b.dy).toBeGreaterThan(0);
    expect(Math.atan2(b.dy,b.dx)).toBeCloseTo(HOMING.turnRate/60);
    expect(Math.hypot(b.dx,b.dy)).toBeCloseTo(1);
    expect([b.speed,b.damage,b.life,b.distanceLeft]).toEqual([200,5,1,200]);
  });

  it("ignores ordinary terrain, enemies behind the shot and targets behind walls",()=>{
    const {world,b}=flight();
    world.setCell(12,10,100);world.setCell(6,10,100,"grown");
    world.setCell(14,10,100,"grown"); // directly occluded by the ordinary wall
    steerHomingBullet(b,.1,world);
    expect(b.homingLocked).toBe(false);
    expect([b.dx,b.dy]).toEqual([1,0]);
  });

  it("finds half-size Blight and reacquires when it disappears",()=>{
    const {world,b}=flight();
    world.setSubCell(27,24,30);
    steerHomingBullet(b,.01,world);expect(b.homingLocked).toBe(true);
    world.setSubCell(27,24,0,"destroyed");
    steerHomingBullet(b,.2,world);expect(b.homingLocked).toBe(false);
  });

  it("tracks living enemies as well as Blight, and drops dead targets",()=>{
    const {world,b}=flight();
    const late=new LateEncounters(world,()=>{},()=>{});
    late.actors.push({
      id:"target",sector:0,x:130,y:100,homeX:130,homeY:100,hp:10,maxHp:10,alive:true,
      kind:"soldier",tier:1,cooldown:0,charge:0,phase:0,aimAngle:0,windup:0,
    });
    steerHomingBullet(b,.01,world,null,late);
    expect(b.homingLocked).toBe(true);
    expect([b.homingX,b.homingY]).toEqual([130,100]);
    late.actors[0].alive=false;
    steerHomingBullet(b,.2,world,null,late);
    expect(b.homingLocked).toBe(false);
  });

  it("keeps swept terrain collisions and does not leak homing into subsequent ordinary shots",()=>{
    const {world}=flight(),stats=baseSoldierStats();
    stats.shotgunPellets=1;stats.shotgunSpreadDeg=0;
    world.setCell(12,10,100);world.setCell(14,10,100,"grown");
    const combat=new CombatSystem(world,new Rng(1),stats);
    combat.fire(new Soldier(80,84,1,0,0,"shotgun","free",0,null,"homing_shotgun"));
    combat.updateBullets(.1);
    expect(world.health[10*world.width+12]).toBeLessThan(100);
    expect(world.health[10*world.width+14]).toBe(100);
    expect(combat.bullets.activeCount).toBe(0);
    combat.fire(new Soldier(80,84,1,0,0,"shotgun"));
    expect(combat.bullets.items.filter(b=>b.active).every(b=>!b.homing&&!b.homingLocked)).toBe(true);
  });

  it("launches a normal pellet volley with homing flags and resets pooled state",()=>{
    const {world}=flight(),stats=baseSoldierStats();
    const combat=new CombatSystem(world,new Rng(3),stats);
    combat.fire(new Soldier(80,80,1,0,0,"shotgun","free",0,null,"homing_shotgun"));
    const pellets=combat.bullets.items.filter(b=>b.active);
    expect(pellets).toHaveLength(stats.shotgunPellets);
    expect(pellets.every(b=>b.homing&&b.damage===stats.shotgunDamage)).toBe(true);
    const b=pellets[0];b.homingLocked=true;b.homingX=123;b.homingY=44;b.homingCooldown=1;
    resetBulletFields(b);
    expect([b.homing,b.homingLocked,b.homingX,b.homingY,b.homingCooldown]).toEqual([false,false,0,0,0]);
  });
});
