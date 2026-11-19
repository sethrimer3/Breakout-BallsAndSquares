import type { FrameTimings } from "./FrameTimings";

type ExtendedEntry = PerformanceEntry & {
  blockingDuration?: number;
  renderStart?: number;
  scripts?: readonly { forcedStyleAndLayoutDuration?: number }[];
};

/** Bounded browser events, independent of the game's own stopwatch probes. */
export class BrowserEventWindow {
  private readonly starts = new Float64Array(256);
  private readonly durations = new Float64Array(256);
  private readonly blocking = new Float64Array(256);
  private readonly rendering = new Float64Array(256);
  private readonly forcedLayout = new Float64Array(256);
  private head = 0;
  private count = 0;
  private lastDroppedEnd = -Infinity;

  reset(): void { this.head = this.count = 0; this.lastDroppedEnd = -Infinity; }

  add(entry: ExtendedEntry): void {
    if (!Number.isFinite(entry.startTime) || !Number.isFinite(entry.duration) || entry.duration < 0) return;
    if (this.count === 256) this.lastDroppedEnd = Math.max(this.lastDroppedEnd, this.starts[this.head] + this.durations[this.head]);
    this.starts[this.head] = entry.startTime;
    this.durations[this.head] = entry.duration;
    this.blocking[this.head] = Math.max(0, entry.blockingDuration ?? 0);
    this.rendering[this.head] = entry.renderStart && entry.renderStart > 0 ? Math.max(0, entry.startTime + entry.duration - entry.renderStart) : 0;
    let forced = 0;
    for (const script of entry.scripts ?? []) forced += Math.max(0, script.forcedStyleAndLayoutDuration ?? 0);
    this.forcedLayout[this.head] = forced;
    this.head = (this.head + 1) % 256;
    this.count = Math.min(256, this.count + 1);
  }

  snapshot(startMs: number, endMs: number) {
    let count = 0, totalMs = 0, maxMs = 0, blockingMs = 0, renderingMs = 0, forcedStyleAndLayoutMs = 0;
    const slowest: {startMs: number; durationMs: number; blockingMs: number; renderingMs: number; forcedStyleAndLayoutMs: number}[] = [];
    if (endMs > startMs) for (let i = 0; i < this.count; i++) {
      if (this.starts[i] + this.durations[i] <= startMs || this.starts[i] >= endMs) continue;
      count++;
      totalMs += this.durations[i];
      maxMs = Math.max(maxMs, this.durations[i]);
      blockingMs += this.blocking[i];
      renderingMs += this.rendering[i];
      forcedStyleAndLayoutMs += this.forcedLayout[i];
      slowest.push({startMs:this.starts[i],durationMs:this.durations[i],blockingMs:this.blocking[i],renderingMs:this.rendering[i],forcedStyleAndLayoutMs:this.forcedLayout[i]});
    }
    return {
      count, totalMs, maxMs, blockingMs, renderingMs, forcedStyleAndLayoutMs,
      truncated: endMs > startMs && this.lastDroppedEnd > startMs,
      slowest: slowest.sort((a, b) => b.durationMs - a.durationMs).slice(0, 3),
    };
  }
}

/** Optional browser APIs. Unsupported or rejected observers never interrupt gameplay. */
export class BrowserFrameEvents {
  private readonly tasks = new BrowserEventWindow();
  private readonly frames = new BrowserEventWindow();
  private readonly observers: PerformanceObserver[] = [];
  private tasksSupported = false;
  private framesSupported = false;

  constructor(timing: FrameTimings, active: () => boolean) {
    if (typeof PerformanceObserver === "undefined") return;
    const observe = (type: string, window: BrowserEventWindow): boolean => {
      if (!PerformanceObserver.supportedEntryTypes?.includes(type)) return false;
      let observer: PerformanceObserver | undefined;
      try {
        observer = new PerformanceObserver(list => {
          for (const entry of list.getEntries()) {
            // Keep entries delivered just after pause if they began in the
            // saved gameplay window; later menu work must not evict it.
            if (active() || entry.startTime < timing.endMs) window.add(entry);
          }
        });
        observer.observe({type, buffered:false});
        this.observers.push(observer);
        return true;
      } catch {
        observer?.disconnect();
        return false;
      }
    };
    this.tasksSupported = observe("longtask", this.tasks);
    this.framesSupported = observe("long-animation-frame", this.frames);
  }

  reset(): void { this.tasks.reset(); this.frames.reset(); }
  disconnect(): void { for (const observer of this.observers) observer.disconnect(); }

  snapshot(startMs: number, endMs: number) {
    return {
      longTasks: this.tasksSupported ? {supported:true,...this.tasks.snapshot(startMs,endMs)} : {supported:false},
      longAnimationFrames: this.framesSupported ? {supported:true,...this.frames.snapshot(startMs,endMs)} : {supported:false},
    };
  }
}
