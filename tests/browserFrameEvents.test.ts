import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserEventWindow, BrowserFrameEvents } from "../src/core/BrowserFrameEvents";
import { FrameTimings } from "../src/core/FrameTimings";

const entry = (startTime: number, duration: number, rest = {}) => ({startTime,duration,...rest}) as PerformanceEntry;
afterEach(() => vi.unstubAllGlobals());

describe("browser performance events", () => {
  it("summarizes events overlapping the retained gameplay window and keeps costly layout data", () => {
    const events = new BrowserEventWindow();
    events.add(entry(10,60));
    events.add(entry(100,80,{blockingDuration:30,renderStart:150,scripts:[{forcedStyleAndLayoutDuration:12}]}));
    events.add(entry(300,90));
    const report=events.snapshot(90,200);
    expect(report).toMatchObject({count:1,totalMs:80,maxMs:80,blockingMs:30,renderingMs:30,forcedStyleAndLayoutMs:12,truncated:false});
    expect(report.slowest[0]).toMatchObject({startMs:100,durationMs:80});
    expect(events.snapshot(0,0).count).toBe(0);
  });

  it("bounds event storage and reports when eviction intersects the requested window", () => {
    const events = new BrowserEventWindow();
    for(let i=0;i<300;i++)events.add(entry(i*100,60));
    expect(events.snapshot(0,30000)).toMatchObject({count:256,truncated:true});
    expect(events.snapshot(29800,30000)).toMatchObject({count:2,truncated:false});
    events.reset();
    expect(events.snapshot(0,30000)).toMatchObject({count:0,truncated:false});
  });

  it("reports unsupported APIs explicitly", () => {
    vi.stubGlobal("PerformanceObserver",undefined);
    const monitor=new BrowserFrameEvents(new FrameTimings(),()=>true);
    expect(monitor.snapshot(0,100)).toEqual({longTasks:{supported:false},longAnimationFrames:{supported:false}});
    monitor.disconnect();
  });

  it("keeps delayed gameplay events after pausing and rejects later menu events", () => {
    const callbacks: PerformanceObserverCallback[]=[];
    const disconnect=vi.fn();
    class Observer {
      static supportedEntryTypes=["longtask","long-animation-frame"];
      constructor(callback: PerformanceObserverCallback) {callbacks.push(callback);}
      observe() {}
      disconnect=disconnect;
    }
    vi.stubGlobal("PerformanceObserver",Observer);
    const timings=new FrameTimings();timings.sample(100,60,100,0);
    let active=true;
    const monitor=new BrowserFrameEvents(timings,()=>active);
    const send=(callback:PerformanceObserverCallback,entries:PerformanceEntry[])=>callback({getEntries:()=>entries} as PerformanceObserverEntryList,{} as PerformanceObserver);
    send(callbacks[0],[entry(80,70)]);
    active=false;
    send(callbacks[1],[entry(90,100,{blockingDuration:50})]);
    send(callbacks[0],[entry(200,80)]);
    expect(monitor.snapshot(0,160)).toMatchObject({longTasks:{supported:true,count:1},longAnimationFrames:{supported:true,count:1,blockingMs:50}});
    monitor.reset();
    expect(monitor.snapshot(0,160)).toMatchObject({longTasks:{count:0},longAnimationFrames:{count:0}});
    monitor.disconnect();expect(disconnect).toHaveBeenCalledTimes(2);
  });

  it("handles observer setup failure without interrupting the game", () => {
    const disconnect=vi.fn();
    class Observer {
      static supportedEntryTypes=["longtask"];
      observe(){throw Error("unavailable");}
      disconnect=disconnect;
    }
    vi.stubGlobal("PerformanceObserver",Observer);
    const monitor=new BrowserFrameEvents(new FrameTimings(),()=>true);
    expect(monitor.snapshot(0,100).longTasks).toEqual({supported:false});
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
