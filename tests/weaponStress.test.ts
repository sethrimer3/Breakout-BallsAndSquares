import {describe,expect,it} from "vitest";
import {Rng} from "../src/core/Rng";
import {Soldier,baseSoldierStats,type LegacyWeaponType,type WeaponType} from "../src/entities/Soldier";
import {SaveManager,type StorageLike} from "../src/progression/SaveManager";
import {UPGRADE_DEFS} from "../src/progression/UpgradeDefinitions";
import {UpgradeManager} from "../src/progression/UpgradeManager";
import {CombatSystem} from "../src/systems/CombatSystem";
import {PhysicsSystem,circleIsClear} from "../src/systems/PhysicsSystem";
import {PixelWorld} from "../src/world/PixelWorld";

const benchmark = (globalThis as typeof globalThis & { process?: { env: Record<string,string|undefined> } }).process?.env.BREACH_BENCHMARK === "1";

class MemoryStorage implements StorageLike{getItem(){return null;}setItem(){}}
function upgraded(){const save=new SaveManager(new MemoryStorage());for(const d of UPGRADE_DEFS)save.data.upgrades[d.id]=d.maxLevel;return new UpgradeManager(save).getSoldierStats();}

function simulate(layout:"open"|"corridor",weapon:WeaponType|LegacyWeaponType,maxed:boolean,squad=1){
 const world=new PixelWorld({width:64,height:64,cellSize:8,roomSize:4});
 for(let y=0;y<64;y++)for(let x=0;x<64;x++){
  const border=x<2||x>61||y<2||y>61;
  world.health[y*64+x]=border||(layout==="corridor"&&(y<30||y>33))?12:0;
 }
 const stats=maxed?upgraded():baseSoldierStats();const rng=new Rng(17);let destroyed=0;
 const combat=new CombatSystem(world,rng,stats,{onImpact:(_x,_y,_nx,_ny,_cx,_cy,result)=>{if(result===2)destroyed++;}});
 const physics=new PhysicsSystem(world,rng);
 const soldiers=Array.from({length:squad},(_,i)=>new Soldier(240+i*2,256,1,0.2,stats.speed,weapon,"free",i));
 const samples:number[]=[];let peakDrones=0,peakOrbs=0,peakMines=0,peakSegments=0;
 for(let frame=0;frame<720;frame++){
  const t0=performance.now();
  for(const s of soldiers){physics.step(s,1/60,stats);combat.updateSoldier(s,1/60);}
  combat.updateBullets(1/60);combat.goo.update(1/60);combat.drones.update(1/60);combat.laser.update(1/60);
  samples.push(performance.now()-t0);
  peakDrones=Math.max(peakDrones,combat.drones.pool.activeCount);peakOrbs=Math.max(peakOrbs,combat.goo.orbs.activeCount);
  peakMines=Math.max(peakMines,combat.goo.mines.activeCount);peakSegments=Math.max(peakSegments,combat.laser.segments.activeCount);
 }
 samples.sort((a,b)=>a-b);
 expect(peakDrones).toBeLessThanOrEqual(24);expect(peakOrbs).toBeLessThanOrEqual(16);expect(peakMines).toBeLessThanOrEqual(96);expect(peakSegments).toBeLessThanOrEqual(256);
 for(const s of soldiers){expect(Number.isFinite(s.x)&&Number.isFinite(s.y)).toBe(true);expect(circleIsClear(world,s.x,s.y,s.radius)).toBe(true);}
 return {layout,weapon,maxed,squad,seed:17,seconds:12,destroyed,ricochets:combat.telemetry.bulletRicochets,gooContacts:combat.goo.contacts,
  gooBursts:combat.goo.bursts,droneShots:combat.drones.shots,droneHits:combat.drones.usefulHits,laserHits:combat.laser.hits,laserBounces:combat.laser.bounces,
  peakDrones,peakOrbs,peakMines,peakSegments,p50Ms:+samples[360].toFixed(3),p95Ms:+samples[684].toFixed(3)};
}

describe("weapon release stress and repeatable balance samples",()=>{
 it("exercises base and fully upgraded builds in both open rooms and dense corridors",()=>{
  const reports=[];
  for(const layout of ["open","corridor"]as const)for(const weapon of ["pistol","shotgun","katana","goo_mortar","drone_shepherd","prism_laser"]as const)for(const maxed of [false,true])reports.push(simulate(layout,weapon,maxed));
  expect(reports.filter(r=>r.weapon==="drone_shepherd").every(r=>r.droneShots>0)).toBe(true);
  expect(reports.filter(r=>r.weapon==="prism_laser").every(r=>r.laserHits>0)).toBe(true);
  expect(reports.filter(r=>r.weapon==="goo_mortar").every(r=>r.gooContacts>0)).toBe(true);
  if(benchmark)console.info("WEAPON_BALANCE",JSON.stringify(reports));
 },30000);
 it("saturates eight fully upgraded carriers without consuming soldier slots or exceeding entity caps",()=>{
  const result=simulate("corridor","drone_shepherd",true,8);
  expect(result.peakDrones).toBe(24);expect(result.squad).toBe(8);expect(result.droneShots).toBeGreaterThan(100);
  if(benchmark)console.info("WEAPON_SQUAD",JSON.stringify(result));
 },15000);
});
