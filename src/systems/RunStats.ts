export interface RateSample {
  t: number;
  destroyRate: number;
  growthRate: number;
}

/** Per-run statistics + 5-second rate telemetry samples (Rev 2). */
export class RunStats {
  time = 0;
  pixelsDestroyed = 0;
  currency = 0;
  crystals = 0;
  greenCrystals = 0;
  essence = 0;
  /** Max depth (cells beyond the room edge) of any destroyed pixel. */
  maxDepth = 0;
  soldiersDeployed = 0;
  shotsFired = 0;
  /** 5s telemetry samples of destroyRate vs growthRate. */
  samples: RateSample[] = [];
  private lastSampleTime = 0;
  private lastSamplePixels = 0;

  reset(): void {
    this.time = 0;
    this.pixelsDestroyed = 0;
    this.currency = 0;
    this.crystals = 0;
    this.greenCrystals = 0;
    this.essence = 0;
    this.maxDepth = 0;
    this.soldiersDeployed = 0;
    this.shotsFired = 0;
    this.samples.length = 0;
    this.lastSampleTime = 0;
    this.lastSamplePixels = 0;
  }

  recordSampleIfDue(growthRate: number): void {
    if (this.time - this.lastSampleTime < 5) return;
    const dt = this.time - this.lastSampleTime;
    const dp = this.pixelsDestroyed - this.lastSamplePixels;
    this.samples.push({
      t: Math.round(this.time),
      destroyRate: +(dp / dt).toFixed(2),
      growthRate: +growthRate.toFixed(2),
    });
    this.lastSampleTime = this.time;
    this.lastSamplePixels = this.pixelsDestroyed;
  }
}
