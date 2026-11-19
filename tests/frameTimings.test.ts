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
    expect(timing.snapshot()).toEqual({samples:0,windowSeconds:0,fps:0,intervalMs:{p50:0,p95:0,p99:0,max:0},workMs:{p50:0,p95:0,p99:0,max:0}});
  });
});
