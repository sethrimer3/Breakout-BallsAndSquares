import {describe,expect,it,vi} from "vitest";
import {PRISM} from "../src/config";
import {Soldier,baseSoldierStats} from "../src/entities/Soldier";
import {LaserSystem} from "../src/systems/LaserSystem";
import {MAT,PixelWorld,SUB} from "../src/world/PixelWorld";

function scene(){
 const world=new PixelWorld({width:64,height:16,cellSize:8,roomSize:4});
 const stats=baseSoldierStats();const soldier=new Soldier(60,60,1,0,60,"prism_laser");
 const impact=vi.fn();const bounce=vi.fn();const overload=vi.fn();
 const laser=new LaserSystem(world,{onImpact:impact,onBounce:bounce,onOverload:overload});
 const wall=(x:number)=>{for(let y=0;y<16;y++)world.health[y*64+x]=1000;};
 return {world,stats,soldier,impact,bounce,overload,laser,wall};
}

describe("Chromatic Prism",()=>{
 it.each([0,1,2,3,4,5,6])("starts at spectrum band %s and advances on reflection",level=>{
  const {stats,soldier,laser,wall}=scene();wall(8);stats.prismSpectrum=level;
  laser.traceShot(soldier,1,0,stats);
  const segments=laser.segments.items.filter(s=>s.active);
  expect(segments[0].band).toBe(level);expect(segments.some(s=>s.band===Math.min(6,level+1))).toBe(true);
 });
 it("increases damage on bounce, spends acquired pierce first, and damages each cell once",()=>{
  const {world,stats,soldier,laser,wall,impact}=scene();wall(8);wall(6);wall(4);
  laser.traceShot(soldier,1,0,stats);
  expect(world.health[7*64+8]).toBe(997);expect(world.health[7*64+6]).toBe(996);
  expect(impact.mock.calls.filter(a=>a[4]===6)).toHaveLength(1);
  expect(laser.lastBounces).toBe(2);
  const cells=impact.mock.calls.map(a=>`${a[4]},${a[5]}`);expect(new Set(cells).size).toBe(cells.length);
 });
 it("does not retrace or repeat damage while the visual lives",()=>{
  const {world,stats,soldier,laser,wall,impact}=scene();wall(8);laser.traceShot(soldier,1,0,stats);
  const hp=world.health[7*64+8];const calls=impact.mock.calls.length;
  for(let i=0;i<20;i++)laser.update(1/60);
  expect(world.health[7*64+8]).toBe(hp);expect(impact).toHaveBeenCalledTimes(calls);
  expect(laser.segments.activeCount).toBe(0);expect(laser.shots).toBe(1);
 });
 it("stops at world boundaries and refuses to penetrate closed doors",()=>{
  const {world,stats,soldier,laser,wall}=scene();
  soldier.x=508;laser.traceShot(soldier,1,0,stats);expect(laser.lastBounces).toBe(0);expect(laser.lastHits).toBe(0);
  laser.clear();soldier.x=60;wall(8);wall(6);world.mat[7*64+6]=MAT.door;stats.prismShear=16;
  laser.traceShot(soldier,1,0,stats);expect(laser.lastBounces).toBe(2);
  expect(laser.segments.items.filter(s=>s.active).every(s=>Math.min(s.x1,s.x2)>=55.99)).toBe(true);
 });
 it("bounds hit, bounce, segment and travel budgets even with corrupted excessive stats",()=>{
  const {stats,soldier,laser,wall}=scene();wall(20);for(let x=1;x<=18;x++)wall(x);
  soldier.x=156;stats.prismShear=1000;stats.prismDistance=10000;stats.prismBounces=1000;
  laser.traceShot(soldier,1,0,stats);
  expect(laser.lastHits).toBe(16);expect(laser.lastDistance).toBeLessThanOrEqual(600);expect(laser.lastBounces).toBeLessThanOrEqual(8);
  expect(laser.segments.activeCount).toBeLessThanOrEqual(PRISM.maxSegments);
 });
 it("terminates opposing-face and exact-edge loops with no repeated cell damage",()=>{
  const {stats,soldier,laser,wall,impact}=scene();wall(6);wall(8);stats.prismShear=0;stats.prismBounces=100;
  soldier.x=64;laser.traceShot(soldier,1,0,stats);
  expect(laser.lastBounces).toBe(8);expect(impact).toHaveBeenCalledTimes(2);expect(laser.lastDistance).toBeLessThanOrEqual(600);
 });
 it("handles half-size terrain and a surface destroyed by the same shot",()=>{
  const {world,stats,soldier,laser,bounce}=scene();const i=15*world.subWidth+16;
  world.subKind[i]=SUB.blight;world.subHealth[i]=1;
  laser.traceShot(soldier,1,0,stats);
  expect(world.subHealth[i]).toBe(0);expect(bounce).toHaveBeenCalledTimes(1);
 });
 it("resets pooled segment state and reports saturated visuals without retracing damage",()=>{
  const {stats,soldier,laser,wall}=scene();wall(8);stats.prismSpectrum=6;laser.traceShot(soldier,1,0,stats);
  laser.clear();stats.prismSpectrum=0;laser.traceShot(soldier,1,0,stats);
  expect(laser.segments.items[0]).toMatchObject({band:0,x1:60,y1:60,life:0.12});
  laser.clear();for(let i=0;i<PRISM.segmentPoolSize;i++)laser.segments.acquire();
  laser.traceShot(soldier,1,0,stats);expect(laser.droppedSegments).toBeGreaterThan(0);expect(laser.lastHits).toBeGreaterThan(0);
 });
 it("emits a harmless final violet overload only when purchased",()=>{
  const {stats,soldier,laser,wall,overload}=scene();wall(8);stats.prismSpectrum=6;stats.prismBounces=1;
  laser.traceShot(soldier,1,0,stats);expect(overload).not.toHaveBeenCalled();
  stats.prismOverload=true;laser.traceShot(soldier,1,0,stats);expect(overload).toHaveBeenCalledTimes(1);
 });
 it("handles diagonal corners deterministically without repeated-cell damage",()=>{
  const {world,stats,soldier,laser,impact}=scene();
  for(const [x,y]of [[8,7],[7,8],[8,8]])world.health[y*64+x]=1000;
  laser.traceShot(soldier,1,1,stats);
  const first=laser.segments.items.filter(s=>s.active).map(s=>[s.x1,s.y1,s.x2,s.y2,s.band]);
  const keys=impact.mock.calls.map(a=>`${a[4]},${a[5]}`);expect(new Set(keys).size).toBe(keys.length);
  expect(first.flat().every(Number.isFinite)).toBe(true);
  laser.clear();laser.traceShot(soldier,1,1,stats);
  expect(laser.segments.items.filter(s=>s.active).map(s=>[s.x1,s.y1,s.x2,s.y2,s.band])).toEqual(first);
 });

});
