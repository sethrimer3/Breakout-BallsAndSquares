/** Recent active-gameplay timing. Sampling allocates nothing; exports sort copies. */
export class FrameTimings {
  private readonly intervals = new Float64Array(120);
  private readonly work = new Float64Array(120);
  private count = 0;
  private head = 0;

  reset(): void { this.count = this.head = 0; }

  sample(intervalMs: number, workMs: number): void {
    if (!Number.isFinite(intervalMs) || intervalMs <= 0 || !Number.isFinite(workMs) || workMs < 0) return;
    this.intervals[this.head] = intervalMs;
    this.work[this.head] = workMs;
    this.head = (this.head + 1) % this.intervals.length;
    this.count = Math.min(this.count + 1, this.intervals.length);
  }

  snapshot() {
    const summarize = (array: Float64Array) => {
      const values = Array.from(array.subarray(0, this.count)).sort((a, b) => a - b);
      const percentile = (q: number) => values.length ? values[Math.min(values.length - 1, Math.floor(values.length * q))] : 0;
      return { p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99), max: percentile(1) };
    };
    let totalMs = 0;
    for (let i = 0; i < this.count; i++) totalMs += this.intervals[i];
    return {
      samples: this.count,
      windowSeconds: totalMs / 1000,
      fps: totalMs > 0 ? this.count * 1000 / totalMs : 0,
      intervalMs: summarize(this.intervals),
      workMs: summarize(this.work),
    };
  }
}
