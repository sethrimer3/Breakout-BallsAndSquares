import { describe, expect, it } from "vitest";
import { FrameTimings } from "../src/core/FrameTimings";

describe("recent gameplay timing", () => {
  it("reports frame cadence below ten FPS independently of short CPU work", () => {
    const timing = new FrameTimings();
    for (let i = 0; i < 60; i++) timing.sample(200, 16.2);
    const result = timing.snapshot();
    expect(result.fps).toBe(5);
    expect(result.windowSeconds).toBe(12);
    expect(result.intervalMs.p95).toBe(200);
    expect(result.workMs.p95).toBe(16.2);
  });

  it("retains intermittent stalls instead of exporting only the latest cheap frame", () => {
    const timing = new FrameTimings();
    for (let i = 0; i < 120; i++) timing.sample(i % 10 ? 16 : 320, i % 10 ? 8 : 280);
    const result = timing.snapshot();
    expect(result.intervalMs.p50).toBe(16);
    expect(result.intervalMs.p95).toBe(320);
    expect(result.workMs.p95).toBe(280);
    expect(result.fps).toBeCloseTo(1000 / 46.4);
  });

  it("expires old samples on wraparound without sorting or mutating live storage", () => {
    const timing = new FrameTimings();
    timing.sample(1000, 900);
    for (let i = 0; i < 120; i++) timing.sample(20, 10);
    const before = timing.snapshot();
    expect(before.samples).toBe(120);
    expect(before.fps).toBe(50);
    expect(before.intervalMs.max).toBe(20);
    timing.sample(40, 30);
    expect(timing.snapshot().intervalMs.max).toBe(40);
    expect(timing.snapshot().workMs.max).toBe(30);
    expect(before.intervalMs.max).toBe(20);
  });

  it("ignores invalid samples and resets cleanly for a new gameplay window", () => {
    const timing = new FrameTimings();
    for (const [interval, work] of [[0, 10], [-1, 10], [NaN, 10], [Infinity, 10], [10, Infinity], [10, -1]]) timing.sample(interval, work);
    expect(timing.snapshot().samples).toBe(0);
    timing.sample(400, 0);
    expect(timing.snapshot().fps).toBe(2.5);
    timing.reset();
    expect(timing.snapshot()).toMatchObject({samples:0,windowSeconds:0,fps:0,intervalMs:{p50:0,p95:0,p99:0,max:0},workMs:{p50:0,p95:0,p99:0,max:0},slowestWorkFrames:[],longestIntervalFrames:[]});
  });
});


describe("correlated rendering metrics", () => {
  it("pairs an interval with previous CPU work, including the preceding unsampled callback", () => {
    const timing = new FrameTimings();
    timing.sample(200, 10, 200, 150);
    expect(timing.snapshot().outsideCallbackMs.p50).toBe(50);
    timing.sample(20, 100, 220);
    timing.sample(120, 5, 340);
    const row = timing.snapshot().longestIntervalFrames.find(row => row.startMs === 340)!;
    expect(row.outsideCallbackMs).toBe(20);
    expect(row.workMs).toBe(5);
  });

  it("keeps phase and workload values from the slow frame after the scene changes", () => {
    const timing = new FrameTimings();
    timing.current.bloomMs = 75;
    timing.current.bloomEnabled = 1;
    timing.current.bullets = 300;
    timing.current.simulationSteps = 5;
    timing.current.maskFullRebuilds = 1;
    timing.sample(110, 100, 1000, 10);
    timing.beginFrame();
    timing.current.bullets = 1;
    timing.sample(120, 20, 1120);
    const snapshot = timing.snapshot();
    expect(snapshot.counts.bullets.last).toBe(1);
    expect(snapshot.counts.bullets.max).toBe(300);
    expect(snapshot.phasesMs.bloomMs.max).toBe(75);
    expect(snapshot.slowestWorkFrames[0]).toMatchObject({workMs:100,phasesMs:{bloomMs:75},counts:{bullets:300,simulationSteps:5,maskFullRebuilds:1,bloomEnabled:1}});
    expect(snapshot.endMs).toBe(1140);
    timing.current.bloomMs = 999;
    expect(snapshot.slowestWorkFrames[0].phasesMs.bloomMs).toBe(75);
    for (let i=0;i<120;i++) {timing.beginFrame();timing.sample(16,8,1200+i*16);}
    expect(timing.snapshot().phasesMs.bloomMs.max).toBe(0);
    expect(timing.snapshot().counts.bullets.max).toBe(0);
  });
});


it("includes sampler bookkeeping in final callback work before evaluating the next interval", () => {
  const timing = new FrameTimings();
  timing.finishWork(10); // No sampled callback yet.
  timing.sample(16,8,100,5);
  timing.finishWork(12);
  timing.sample(20,3,120);
  expect(timing.snapshot().workMs.max).toBe(12);
  expect(timing.snapshot().longestIntervalFrames[0].outsideCallbackMs).toBe(8);
  expect(timing.snapshot().endMs).toBe(123);
});
