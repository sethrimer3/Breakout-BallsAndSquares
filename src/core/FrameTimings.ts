/** Exclusive callback stages, followed by nested preparation stages. All values are CPU ms. */
export const FRAME_PHASES = [
  "preFrameMs", "simulationMs", "terrainUpdateMs", "shadowPreparationMs",
  "albedoMs", "lightingMs", "worldEffectsMs", "combatEffectsMs", "bloomMs",
  "fogRenderMs", "blightEdgesMs", "actorsAndUiMs", "hudAudioMs",
  // These overlap the containing simulation/lighting stages; do not sum them again.
  "fogUpdateMs", "airMappingMs", "growthUpdateMs", "lightingMaskMs",
  "wardenDrawMs", "subPixelDrawMs", "subPixelSimulationMs",
] as const;
export const FRAME_COUNTS = [
  "simulationSteps", "clampedWallTimeMs", "discardedSimulationMs", "terrainChunksRebuilt", "terrainChunksPending", "visibleTerrainChunksPending",
  "growthEvents", "airFloods", "airCellsVisited", "mappedAirTiles", "fixtureRetraces",
  "maskFullRebuilds", "maskPartialRegions", "maskScrolls", "maskReuses", "maskRepaintPixels",
  "candidateRoomLights", "softLights", "muzzleFlashes", "shadowRays", "shadowedMuzzleLights", "soldiers", "bullets", "particles",
  "fireParticles", "loot", "damageNumbers", "movingSubPixels", "creatures", "wardens",
  "cameraTravelWorld", "cameraZoom", "backingPixels", "renderDensity",
  "bloomEnabled", "softShadowsEnabled", "lightingQualityLevel",
] as const;
const FIELDS = [...FRAME_PHASES, ...FRAME_COUNTS] as const;
type Metric = typeof FIELDS[number];
export type FrameMetrics = Record<Metric, number>;

/** Recent active-gameplay timing. Sampling allocates nothing; only exports sort copies. */
export class FrameTimings {
  readonly current = Object.fromEntries(FIELDS.map(key => [key, 0])) as FrameMetrics;
  private readonly intervals = new Float64Array(120);
  private readonly work = new Float64Array(120);
  private readonly outside = new Float64Array(120);
  private readonly starts = new Float64Array(120);
  private readonly metrics = Object.fromEntries(FIELDS.map(key => [key, new Float64Array(120)])) as Record<Metric, Float64Array>;
  private count = 0;
  private head = 0;

  beginFrame(): void { for (const key of FIELDS) this.current[key] = 0; }
  reset(): void { this.count = this.head = 0; this.beginFrame(); }

  /** Last sampled callback end, using the browser's monotonic performance clock. */
  get endMs(): number {
    const last = (this.head + 119) % 120;
    return this.count ? this.starts[last] + this.work[last] : 0;
  }

  sample(intervalMs: number, workMs: number, startMs = 0, previousWorkMs?: number): void {
    if (!Number.isFinite(intervalMs) || intervalMs <= 0 || !Number.isFinite(workMs) || workMs < 0) return;
    const previous = previousWorkMs ?? (this.count ? this.work[(this.head + 119) % 120] : NaN);
    this.intervals[this.head] = intervalMs;
    this.work[this.head] = workMs;
    // A rAF interval spans the PREVIOUS callback. Subtracting current work
    // would incorrectly blame a cheap frame following an expensive one.
    this.outside[this.head] = Number.isFinite(previous) ? Math.max(0, intervalMs - previous) : NaN;
    this.starts[this.head] = startMs;
    for (const key of FIELDS) this.metrics[key][this.head] = Number.isFinite(this.current[key]) ? this.current[key] : 0;
    this.head = (this.head + 1) % this.intervals.length;
    this.count = Math.min(this.count + 1, this.intervals.length);
  }

  /** Include collection and rAF scheduling in the callback's final work time. */
  finishWork(workMs: number): void {
    if (this.count && Number.isFinite(workMs) && workMs >= 0) this.work[(this.head + 119) % 120] = workMs;
  }

  snapshot() {
    const summarize = (array: Float64Array) => {
      const values = Array.from(array.subarray(0, this.count)).filter(Number.isFinite).sort((a, b) => a - b);
      const percentile = (q: number) => values.length ? values[Math.min(values.length - 1, Math.floor(values.length * q))] : 0;
      return { p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99), max: percentile(1) };
    };
    let totalMs = 0;
    for (let i = 0; i < this.count; i++) totalMs += this.intervals[i];
    const indices = Array.from({length: this.count}, (_, i) => i);
    const rounded = (value: number) => Math.round(value * 1000) / 1000;
    const roundedSummary = (array: Float64Array) => {
      const value = summarize(array);
      return {p50:rounded(value.p50),p95:rounded(value.p95),p99:rounded(value.p99),max:rounded(value.max)};
    };
    const row = (index: number) => ({
      startMs: rounded(this.starts[index]), intervalMs: rounded(this.intervals[index]), workMs: rounded(this.work[index]),
      outsideCallbackMs: Number.isFinite(this.outside[index]) ? rounded(this.outside[index]) : null,
      phasesMs: Object.fromEntries(FRAME_PHASES.filter(key => this.metrics[key][index] !== 0).map(key => [key, rounded(this.metrics[key][index])])),
      counts: Object.fromEntries(FRAME_COUNTS.filter(key => this.metrics[key][index] !== 0).map(key => [key, rounded(this.metrics[key][index])])),
    });
    const oldest = this.count === 120 ? this.head : 0;
    const last = (this.head + 119) % 120;
    return {
      samples: this.count,
      windowSeconds: totalMs / 1000,
      startMs: this.count ? this.starts[oldest] - this.intervals[oldest] : 0,
      endMs: this.endMs,
      fps: totalMs > 0 ? this.count * 1000 / totalMs : 0,
      intervalMs: summarize(this.intervals), workMs: summarize(this.work),
      outsideCallbackMs: summarize(this.outside),
      phasesMs: Object.fromEntries(FRAME_PHASES.map(key => [key, roundedSummary(this.metrics[key])])),
      counts: Object.fromEntries(FRAME_COUNTS.map(key => [key, {
        last: this.count ? rounded(this.metrics[key][last]) : 0, ...roundedSummary(this.metrics[key]),
      }])),
      slowestWorkFrames: [...indices].sort((a, b) => this.work[b] - this.work[a]).slice(0, 3).map(row),
      longestIntervalFrames: indices.sort((a, b) => this.intervals[b] - this.intervals[a]).slice(0, 3).map(row),
    };
  }
}
