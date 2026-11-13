import {describe,expect,it} from "vitest";
import {SaveManager,type StorageLike} from "../src/progression/SaveManager";
import {UpgradeManager} from "../src/progression/UpgradeManager";
import {UPGRADE_DEFS} from "../src/progression/UpgradeDefinitions";
import {EXPANSION_DEFS} from "../src/progression/WeaponExpansionUpgrades";
import {unlockTabs} from "./helpers/progression";

class MemoryStorage implements StorageLike{
 private data=new Map<string,string>();getItem(k:string){return this.data.get(k)??null;}setItem(k:string,v:string){this.data.set(k,v);}
}
function scene(){const storage=new MemoryStorage();const save=new SaveManager(storage);const u=new UpgradeManager(save);return{storage,save,u};}

describe("weapon expansion release progression",()=>{
 it("keeps every tree node distinct, visible and within the existing 5×3 stage",()=>{
  const keys=new Set<string>();
  for(const def of UPGRADE_DEFS){
   const key=`${def.branch}:${def.grid.col},${def.grid.row}`;
   expect(keys.has(key),`${def.id} overlaps another node`).toBe(false);keys.add(key);
   if(EXPANSION_DEFS.includes(def)){expect(Math.abs(def.grid.col)).toBeLessThanOrEqual(3);expect(Math.abs(def.grid.row)).toBeLessThanOrEqual(2);}
  }
 });
 it("purchases and caps every new upgrade, then restores their exact levels",()=>{
  const{storage,save,u}=scene();unlockTabs(save);save.data.lifetimePixels=10000;
  for(const currency of ["bank","crystals","greenCrystals","essence","biomass"]as const)save.data[currency]=1e9;
  for(const def of UPGRADE_DEFS)save.data.upgrades[def.id]=def.maxLevel;
  for(const def of EXPANSION_DEFS){
   save.data.upgrades[def.id]=0;
   for(let level=0;level<def.maxLevel;level++)expect(u.buy(def.id),`${def.id} level ${level+1}`).toBe(true);
   expect(u.buy(def.id)).toBe(false);
  }
  const loaded=new SaveManager(storage);
  for(const def of EXPANSION_DEFS)expect(loaded.data.upgrades[def.id],def.id).toBe(def.maxLevel);
  const stats=new UpgradeManager(loaded).getSoldierStats();
  expect(stats).toMatchObject({gooDwell:0.08,gooDamage:11,gooResidue:true,droneCapacity:7,droneDamage:7,droneHealth:5,droneAim:20,droneRecall:true,
   prismDamage:9,prismSpectrum:6,prismBounces:7,prismShear:6,prismDistance:600,prismOverload:true,
   katanaDash:true,katanaDashPeak:3,katanaPerfect:true});
  expect(stats.gooRadius).toBeCloseTo(3.05);expect(stats.droneReleaseInterval).toBeCloseTo(2.7);
 });
 it("enforces category, weapon, dash and capstone prerequisites",()=>{
  const{save,u}=scene();save.data.lifetimePixels=10000;
  expect(u.isUnlocked("drone_unlock")).toBe(false);expect(u.isUnlocked("prism_unlock")).toBe(false);
  unlockTabs(save);expect(u.isUnlocked("drone_unlock")).toBe(true);
  expect(u.isUnlocked("drone_damage")).toBe(false);expect(u.isUnlocked("prism_shear")).toBe(false);
  save.data.upgrades.katana_unlock=1;expect(u.isUnlocked("katana_impulse")).toBe(false);
  save.data.upgrades.katana_dash=1;expect(u.isUnlocked("katana_impulse")).toBe(true);
  save.data.upgrades.sniper_unlock=1;save.data.upgrades.prism_unlock=1;save.data.upgrades.prism_spectrum=5;expect(u.isUnlocked("prism_overload")).toBe(false);
  save.data.upgrades.prism_spectrum=6;expect(u.isUnlocked("prism_overload")).toBe(true);
 });
 it("sanitizes locked loadouts, restores unlocked ones, and defaults new settings safely",()=>{
  const{storage,save}=scene();
  (save.data.loadouts[0] as {weapon:string}).weapon="drone_shepherd";(save.data.loadouts[1] as {weapon:string}).weapon="prism_laser";save.save();
  let loaded=new SaveManager(storage);
  expect(loaded.data.loadouts.slice(0,2).map(l=>`${l.weapon}:${l.mutation}`)).toEqual(["pistol:null","pistol:null"]);
  save.data.upgrades.drone_unlock=1;save.data.upgrades.prism_unlock=1;save.data.settings.prismPatterns=false;save.save();
  loaded=new SaveManager(storage);
  expect(loaded.data.loadouts.slice(0,2).map(l=>`${l.weapon}:${l.mutation}`)).toEqual(["pistol:drone_shepherd","sniper_rifle:chromatic_prism"]);
  expect(loaded.data.settings.prismPatterns).toBe(false);
  const legacy=loaded.data.settings as Partial<typeof loaded.data.settings>;delete legacy.prismPatterns;
  loaded.save();expect(new SaveManager(storage).data.settings.prismPatterns).toBe(true);
 });
 it("keeps pre-expansion saves usable with all new levels absent",()=>{
  const{storage,save}=scene();
  const upgrades=save.data.upgrades as Partial<typeof save.data.upgrades>;
  for(const def of EXPANSION_DEFS)delete upgrades[def.id];save.save();
  const loaded=new SaveManager(storage);for(const def of EXPANSION_DEFS)expect(loaded.data.upgrades[def.id]).toBe(0);
  expect(new UpgradeManager(loaded).getSoldierStats()).toMatchObject({droneUnlocked:false,prismUnlocked:false,katanaDash:false,gooResidue:false});
 });
});
