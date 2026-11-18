import { describe, expect, it } from "vitest";
import { labWorldSeed } from "../src/core/WorldSeed";
import { SpeedrunTimer, formatSpeedrunTime } from "../src/core/SpeedrunTimer";
import { SaveManager, SAVE_KEY, LEGACY_NEW_PROFILE_SEED_KEY, sanitizeSaveData, type StorageLike } from "../src/progression/SaveManager";
import { WORLD } from "../src/config";
import { PixelWorld } from "../src/world/PixelWorld";
import { LAB_WORLDS } from "../src/world/labMap";
import { generateWorld } from "../src/world/WorldGenerator";

class Storage implements StorageLike {
  map = new Map<string,string>();
  getItem(k:string){return this.map.get(k)??null;}
  setItem(k:string,v:string){this.map.set(k,v);}
  removeItem(k:string){this.map.delete(k);}
}
function fingerprint(a: ArrayLike<number>): number {
  let hash=0x811c9dc5;
  for(let i=0;i<a.length;i++)hash=Math.imul(hash^a[i],0x01000193);
  return hash>>>0;
}

describe("fixed maps (no per-profile seed)",()=>{
  it("derives one stable seed per world",()=>{
    expect(labWorldSeed(1)).toBe(labWorldSeed(1));
    expect(labWorldSeed(1)).not.toBe(labWorldSeed(2));
  });
  it("creates saves without a seed and keeps per-profile timers",()=>{
    const storage=new Storage();const save=new SaveManager(storage);
    expect("seed" in save.data).toBe(false);
    save.data.speedrun={enabled:true,elapsedMs:1234};save.save();
    save.reset(2);save.selectSlot(2);
    expect(save.data.speedrun).toEqual({enabled:false,elapsedMs:0});
    const loaded=new SaveManager(storage);loaded.selectSlot(1);
    expect(loaded.data.speedrun.elapsedMs).toBe(1234);
    expect("seed" in loaded.getSlotSummary(1)).toBe(false);
  });
  it("loads old saves that still carry a seed, without rewriting them on load",()=>{
    const storage=new Storage();
    const raw=JSON.stringify({seed:"OLD42",bank:750,lastSaved:123});
    storage.setItem(SAVE_KEY,raw);storage.setItem(LEGACY_NEW_PROFILE_SEED_KEY,"NEXT");
    const save=new SaveManager(storage);
    expect(save.data.bank).toBe(750);expect(save.data.lastSaved).toBe(123);
    expect("seed" in save.data).toBe(false);expect(storage.getItem(SAVE_KEY)).toBe(raw);
    expect(save.data.speedrun).toEqual({enabled:false,elapsedMs:0});
    save.deleteAllData();expect(storage.getItem(LEGACY_NEW_PROFILE_SEED_KEY)).toBe(null);
  });
  it("keeps readable legacy progress when storage is read-only",()=>{
    const storage={getItem:(k:string)=>k===SAVE_KEY?'{"bank":750}':null,setItem:()=>{throw Error("read only");}};
    expect(new SaveManager(storage).data.bank).toBe(750);
  });
  it("sanitizes corrupt timer data without enabling or accumulating offline time",()=>{
    expect(sanitizeSaveData({seed:"abc",speedrun:{enabled:"true",elapsedMs:-50}})).toMatchObject({speedrun:{enabled:false,elapsedMs:0}});
    expect(sanitizeSaveData({speedrun:{enabled:true,elapsedMs:Infinity}}).speedrun).toEqual({enabled:true,elapsedMs:0});
  });
  it("generates identical terrain for every profile in each world",()=>{
    const w=new PixelWorld(WORLD);
    const generate=(id:number)=>{
      generateWorld(w,labWorldSeed(id),{labWorld:LAB_WORLDS[id]});
      return {
        terrain:[w.health,w.wall,w.tint,w.decor,w.mat,w.subHealth,w.subKind,w.subTint].map(fingerprint),
        routes:w.labLayout!.rooms.map(r=>[r.x,r.y,r.size]),
        gates:w.doors.filter(d=>d.gate).map(d=>[d.x0,d.y0,d.x1,d.y1,d.tier,d.gate]),
      };
    };
    expect(generate(1)).toEqual(generate(1));
    expect(generate(3)).toEqual(generate(3));
  });
});

describe("cumulative active-run clock",()=>{
  it("charges exact real intervals at transitions, excluding all inactive time and time before first deployment",()=>{
    const timer=new SpeedrunTimer();const data={enabled:true,elapsedMs:0};
    timer.sync(0,data,false);timer.sync(50000,data,false);expect(data.elapsedMs).toBe(0);
    timer.sync(50000,data,true);timer.sync(51234,data,false);expect(data.elapsedMs).toBe(1234);
    // Menus, upgrade tree, map, results, paused or hidden tabs use the same inactive transition.
    timer.sync(80000,data,false);timer.sync(90000,data,true);timer.sync(93000,data,false);
    expect(data.elapsedMs).toBe(4234);
  });
  it("preserves separate profile totals, retains time while disabled, and never includes offline gaps",()=>{
    const timer=new SpeedrunTimer();const a={enabled:true,elapsedMs:100};const b={enabled:true,elapsedMs:200};
    timer.sync(0,a,true);timer.sync(1000,a,false);expect(a.elapsedMs).toBe(1100);
    timer.sync(1000,b,true);timer.sync(2000,b,false);expect(b.elapsedMs).toBe(1200);
    a.enabled=false;timer.sync(2000,a,true);timer.sync(9999,a,false);expect(a.elapsedMs).toBe(1100);
    a.enabled=true;const reloaded=new SpeedrunTimer();reloaded.sync(1e8,a,true);expect(a.elapsedMs).toBe(1100);
    reloaded.sync(1e8+50,a,false);expect(a.elapsedMs).toBe(1150);
  });
  it("does not double-count when an animation timestamp precedes a transition timestamp",()=>{
    const timer=new SpeedrunTimer();const data={enabled:true,elapsedMs:0};
    timer.sync(100,data,true);timer.sync(99,data,true);timer.sync(110,data,false);
    expect(data.elapsedMs).toBe(10);
  });
  it("counts stalled active frames fully and formats hours and milliseconds",()=>{
    const timer=new SpeedrunTimer();const data={enabled:true,elapsedMs:0};
    timer.sync(0,data,true);timer.sync(10000,data,false);expect(data.elapsedMs).toBe(10000);
    expect(formatSpeedrunTime(3723456.9)).toBe("01:02:03.456");
    expect(formatSpeedrunTime(0)).toBe("00:00:00.000");
  });
});
