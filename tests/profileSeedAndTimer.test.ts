import { describe, expect, it } from "vitest";
import { parseProfileSeed, profileWorldSeed } from "../src/core/ProfileSeed";
import { SpeedrunTimer, formatSpeedrunTime } from "../src/core/SpeedrunTimer";
import { SaveManager, SAVE_KEY, NEW_PROFILE_SEED_KEY, sanitizeSaveData, type StorageLike } from "../src/progression/SaveManager";
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

describe("profile generation seeds",()=>{
  it("normalizes short codes, rejects invalid input and derives stable world-specific seeds",()=>{
    expect(parseProfileSeed(" abc123 ")).toBe("ABC123");
    for(const input of ["", "a-b", "<img>", "123456789", 42, null])expect(parseProfileSeed(input)).toBe(null);
    expect(profileWorldSeed("ABC123",1)).toBe(profileWorldSeed("ABC123",1));
    expect(profileWorldSeed("ABC123",1)).not.toBe(profileWorldSeed("ABC123",2));
    expect(profileWorldSeed("ABC123",1)).not.toBe(profileWorldSeed("ABC124",1));
  });
  it("uses the installation default for newly created saves while preserving existing profiles",()=>{
    const storage=new Storage();const save=new SaveManager(storage);
    expect(save.data.seed).toMatch(/^[A-Z0-9]{8}$/);
    expect(save.setNewProfileSeed("speed42")).toBe(true);
    expect(save.slotExists(1)).toBe(false);
    expect(save.data.seed).toBe("SPEED42");save.save();
    save.data.speedrun={enabled:true,elapsedMs:1234};save.save();
    expect(save.setNewProfileSeed("next")).toBe(true);
    expect(save.data.seed).toBe("SPEED42");
    save.reset(2);save.selectSlot(2);
    expect(save.data.seed).toBe("NEXT");expect(save.data.speedrun).toEqual({enabled:false,elapsedMs:0});
    const loaded=new SaveManager(storage);expect(loaded.newProfileSeed).toBe("NEXT");
    loaded.selectSlot(1);expect(loaded.data.seed).toBe("SPEED42");expect(loaded.data.speedrun.elapsedMs).toBe(1234);
    expect(loaded.setNewProfileSeed("bad-code")).toBe(false);expect(loaded.newProfileSeed).toBe("NEXT");
    expect(loaded.setNewProfileSeed("")).toBe(true);loaded.reset(3);loaded.selectSlot(3);
    expect(loaded.data.seed).toMatch(/^[A-Z0-9]{8}$/);
    loaded.deleteAllData();expect(storage.getItem(NEW_PROFILE_SEED_KEY)).toBe(null);
  });
  it("migrates a legacy code once without changing saved progression or timestamps",()=>{
    const storage=new Storage();storage.setItem(SAVE_KEY,JSON.stringify({bank:750,lastSaved:123}));
    const save=new SaveManager(storage);const seed=save.data.seed;
    expect(save.data.bank).toBe(750);expect(save.data.lastSaved).toBe(123);
    expect(new SaveManager(storage).data.seed).toBe(seed);
    expect(save.getSlotSummary(1).seed).toBe(seed);
    expect(save.data.speedrun).toEqual({enabled:false,elapsedMs:0});
  });
  it("keeps readable legacy progress when migration cannot write to storage",()=>{
    const storage={getItem:(k:string)=>k===SAVE_KEY?'{"bank":750}':null,setItem:()=>{throw Error("read only");}};
    expect(new SaveManager(storage).data.bank).toBe(750);
  });
  it("sanitizes corrupt timer data without enabling or accumulating offline time",()=>{
    expect(sanitizeSaveData({seed:"abc",speedrun:{enabled:"true",elapsedMs:-50}})).toMatchObject({seed:"ABC",speedrun:{enabled:false,elapsedMs:0}});
    expect(sanitizeSaveData({speedrun:{enabled:true,elapsedMs:Infinity}}).speedrun).toEqual({enabled:true,elapsedMs:0});
  });
  it("reproduces all generated terrain data for a code while varying dressing across codes and keeping routes/gates",()=>{
    const w=new PixelWorld(WORLD);
    const generate=(code:string,id=1)=>{
      generateWorld(w,profileWorldSeed(code,id),{labWorld:LAB_WORLDS[id]});
      return {
        terrain:[w.health,w.wall,w.tint,w.decor,w.mat,w.subHealth,w.subKind,w.subTint].map(fingerprint),
        routes:w.labLayout!.rooms.map(r=>[r.x,r.y,r.size]),
        gates:w.doors.filter(d=>d.gate).map(d=>[d.x0,d.y0,d.x1,d.y1,d.tier,d.gate]),
      };
    };
    const a=generate("RACE42");const b=generate("RACE42");expect(b).toEqual(a);
    const c=generate("RACE43");expect(c.terrain).not.toEqual(a.terrain);
    expect(c.routes).toEqual(a.routes);expect(c.gates).toEqual(a.gates);
    const late=generate("RACE42",3);expect(generate("RACE42",3)).toEqual(late);
    expect(generate("RACE43",3).terrain).not.toEqual(late.terrain);
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
