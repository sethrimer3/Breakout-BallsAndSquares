import { describe, expect, it } from "vitest";
import { AUTO_STEPS, autoStartIndex, densityFor, GOVERNOR, RenderScaleGovernor } from "../src/rendering/RenderScale";

/** Feed `frames` intervals of `ms`, returning how many times the cap changed. */
function feed(g: RenderScaleGovernor, ms: number | (() => number), frames: number): number {
  let changes = 0;
  for (let i = 0; i < frames; i++) if (g.sample(typeof ms === "number" ? ms : ms())) changes++;
  return changes;
}

const windowAndSettle = GOVERNOR.windowFrames * GOVERNOR.slowWindows + GOVERNOR.settleFrames;

describe("render scale governor", () => {
  it("starts phones one step down and clamps density to the screen", () => {
    expect(autoStartIndex(true, 400 * 900)).toBe(1);
    expect(autoStartIndex(false, 1440 * 900)).toBe(0);
    expect(densityFor(2, 1)).toBe(1);
    expect(densityFor(1.25, 3)).toBe(1.25);
  });

  it("keeps the density while frames are fast", () => {
    const g = new RenderScaleGovernor(0, 3);
    expect(feed(g, 16.7, 1000)).toBe(0);
    expect(g.cap).toBe(AUTO_STEPS[0]);
  });

  it("steps down under sustained slow frames and keeps steps that help", () => {
    const g = new RenderScaleGovernor(0, 3);
    let ms = 40;
    // Each step down makes frames 25% faster until they're under the threshold.
    for (let i = 0; i < 20 && ms > GOVERNOR.slowMs; i++) {
      if (feed(g, ms, windowAndSettle) > 0) ms *= 0.75;
    }
    expect(g.step).toBeGreaterThan(0);
    expect(g.locked).toBe(false);
    expect(ms).toBeLessThanOrEqual(GOVERNOR.slowMs);
  });

  it("undoes a step that doesn't help and stops (30 Hz caps, CPU-bound frames)", () => {
    const g = new RenderScaleGovernor(1, 3);
    feed(g, 33.3, windowAndSettle + GOVERNOR.windowFrames * 3);
    expect(g.step).toBe(1);
    expect(g.locked).toBe(false); // one miss only pauses it
    feed(g, 33.3, GOVERNOR.retryFrames + windowAndSettle + GOVERNOR.windowFrames * 3);
    expect(g.locked).toBe(true);
    expect(g.step).toBe(1);
    expect(feed(g, 33.3, 1000)).toBe(0);
  });

  it("ignores hitches like tab switches", () => {
    const g = new RenderScaleGovernor(0, 2);
    let i = 0;
    expect(feed(g, () => (i++ % 10 === 0 ? 1000 : 16), 2000)).toBe(0);
  });

  it("stops when lower caps can't lower the density on this screen", () => {
    const g = new RenderScaleGovernor(3, 1); // cap 1 on a 1x screen; 0.75 is the floor
    feed(g, 40, windowAndSettle * 4);
    expect(densityFor(g.cap, 1)).toBeGreaterThanOrEqual(0.75);
  });

  it.each([[1,0.75],[1.25,1],[0.8,0.75]])("skips native-density plateaus at DPR %s", (dpr,expected) => {
    const g = new RenderScaleGovernor(0,dpr);
    expect(feed(g,40,windowAndSettle)).toBe(1);
    expect(densityFor(g.cap,dpr)).toBe(expected);
    feed(g,20,GOVERNOR.settleFrames+GOVERNOR.windowFrames);
    expect(densityFor(g.cap,dpr)).toBe(expected);
  });

  it.each([0,1,2])("restores the original plateau index %s after an unhelpful skipped step", index => {
    const g = new RenderScaleGovernor(index,1);
    feed(g,40,windowAndSettle);
    expect(g.cap).toBe(0.75);
    feed(g,40,GOVERNOR.settleFrames+GOVERNOR.windowFrames);
    expect(g.step).toBe(index);
    expect(g.cap).toBe(AUTO_STEPS[index]);
  });

});
