/**
 * Picks how many backing-store pixels the game canvas gets per CSS pixel.
 *
 * Every full-screen pass (lightmap, terrain mask, multiply, fog, scatter) costs
 * fill rate in proportion to the canvas's pixel count, and phones pair weak GPUs
 * with 2.5-3x screens. Pixel art reads fine below native density, so the game
 * trades density for frame rate:
 *
 * - "high" / "medium" / "low" pin a density cap.
 * - "auto" starts at a cap suited to the device and steps down while sustained
 *   frame intervals stay slow. A step that does not help (the frame rate is
 *   capped by the display or bound by the simulation) is undone and auto stops,
 *   so 30 Hz battery-saver screens don't get blurred for nothing.
 *
 * Pure logic, no DOM: `RenderScaleGovernor` is fed frame intervals and reports
 * when the density should change.
 */

export type RenderQuality = "auto" | "high" | "medium" | "low";
export const RENDER_QUALITIES: readonly RenderQuality[] = ["auto", "high", "medium", "low"];

/** Density caps for the fixed settings. */
export const FIXED_CAPS: Record<Exclude<RenderQuality, "auto">, number> = {
  high: 2,
  medium: 1.25,
  low: 1,
};

/** Auto mode's ladder of density caps, best first. */
export const AUTO_STEPS: readonly number[] = [2, 1.5, 1.25, 1, 0.75];

export const GOVERNOR = {
  /** Frames per measurement window. */
  windowFrames: 60,
  /** A window whose typical frame interval is above this (ms) is slow (under ~50 fps). */
  slowMs: 20,
  /** Consecutive slow windows before stepping down. */
  slowWindows: 2,
  /** Frames ignored after a change, while the resize settles. */
  settleFrames: 20,
  /** A step must cut the typical interval by at least this fraction to be kept. */
  minGain: 0.05,
  /** Frames to wait after undoing an unhelpful step before trying again. */
  retryFrames: 1800,
  /** Unhelpful steps before auto stops for the session. */
  maxFailedSteps: 2,
  /** Intervals longer than this (ms) are tab switches or hitches, not load. */
  maxSampleMs: 250,
};

/** Starting auto cap: phones and tablets start one step down. */
export function autoStartIndex(coarsePointer: boolean, cssPixels: number): number {
  return coarsePointer || cssPixels < 700 * 700 ? 1 : 0;
}

/** Backing pixels per CSS pixel for a cap on a screen of `devicePixelRatio`. */
export function densityFor(cap: number, devicePixelRatio: number): number {
  return Math.max(0.5, Math.min(cap, devicePixelRatio || 1));
}

export class RenderScaleGovernor {
  /** Index into `AUTO_STEPS`. */
  step: number;
  /** Auto has finished adjusting for this session. */
  locked = false;
  /** Typical frame interval (ms) of the last full window, for the debug overlay. */
  lastTypical = 0;
  private samples = new Float32Array(GOVERNOR.windowFrames);
  private sampleCount = 0;
  private settle = GOVERNOR.settleFrames;
  private slowStreak = 0;
  /** Typical interval of the last window before the most recent step down, or 0. */
  private beforeStep = 0;
  private failedSteps = 0;

  constructor(startIndex: number, private devicePixelRatio: number) {
    this.step = Math.max(0, Math.min(AUTO_STEPS.length - 1, startIndex));
  }

  get cap(): number {
    return AUTO_STEPS[this.step];
  }

  /** Reset the measurement (call when gameplay pauses or the view resizes). */
  reset(): void {
    this.sampleCount = 0;
    this.slowStreak = 0;
    this.settle = Math.max(this.settle, GOVERNOR.settleFrames);
  }

  /**
   * Record one active-gameplay frame interval (ms). Returns true when `cap`
   * changed and the canvas should be resized.
   */
  sample(intervalMs: number): boolean {
    if (this.locked) return false;
    if (this.settle > 0) {
      this.settle--;
      return false;
    }
    if (!(intervalMs > 0) || intervalMs > GOVERNOR.maxSampleMs) return false;
    this.samples[this.sampleCount++] = intervalMs;
    if (this.sampleCount < GOVERNOR.windowFrames) return false;
    this.sampleCount = 0;
    const typical = typicalOf(this.samples);
    this.lastTypical = typical;

    if (this.beforeStep > 0) {
      // Judge the last step down: keep it only if frames actually got faster.
      // Load drifts during a run, so one miss only pauses auto for a while;
      // repeated misses mean the frame rate isn't limited by fill rate at all.
      const helped = typical <= this.beforeStep * (1 - GOVERNOR.minGain);
      this.beforeStep = 0;
      if (!helped) {
        this.step--;
        this.locked = ++this.failedSteps >= GOVERNOR.maxFailedSteps;
        this.settle = GOVERNOR.retryFrames;
        return true;
      }
    }

    if (typical <= GOVERNOR.slowMs) {
      this.slowStreak = 0;
      return false;
    }
    if (++this.slowStreak < GOVERNOR.slowWindows) return false;
    this.slowStreak = 0;
    // Further steps can't lower the density on this screen: nothing left to try.
    const next = this.step + 1;
    if (next >= AUTO_STEPS.length ||
        densityFor(AUTO_STEPS[next], this.devicePixelRatio) >= densityFor(this.cap, this.devicePixelRatio)) {
      this.locked = true;
      return false;
    }
    this.step = next;
    this.beforeStep = typical;
    this.settle = GOVERNOR.settleFrames;
    return true;
  }
}

/**
 * Mean of the middle 80% of a window. Frame intervals snap to vsync multiples,
 * so a median can hide a real gain (7 frames of 16.7 ms vs a mix of 6 and 7);
 * the trimmed mean still sees it while ignoring the odd hitch.
 */
function typicalOf(a: Float32Array): number {
  const s = Array.from(a).sort((x, y) => x - y);
  const cut = Math.floor(s.length * 0.1);
  let sum = 0;
  for (let i = cut; i < s.length - cut; i++) sum += s[i];
  return sum / (s.length - 2 * cut);
}
