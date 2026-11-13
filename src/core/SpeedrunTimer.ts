export interface SpeedrunData {
  enabled: boolean;
  elapsedMs: number;
}

/** A real-time clock, independent of simulation time scale or frame limits. */
export class SpeedrunTimer {
  private last: number | null = null;
  private running = false;
  private profile: SpeedrunData | null = null;

  sync(now: number, profile: SpeedrunData, running: boolean): void {
    if (!Number.isFinite(now)) return;
    if (this.last !== null && this.profile === profile) now = Math.max(now, this.last);
    if (this.last !== null && this.profile === profile && this.running) {
      profile.elapsedMs = Math.min(1e12, profile.elapsedMs + Math.max(0, now - this.last));
    }
    this.last = now;
    this.profile = profile;
    this.running = running && profile.enabled;
  }
}

export function formatSpeedrunTime(ms: number): string {
  const total = Math.floor(Math.max(0, ms));
  const hours = Math.floor(total / 3600000);
  const minutes = Math.floor(total / 60000) % 60;
  const seconds = Math.floor(total / 1000) % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(total % 1000).padStart(3, "0")}`;
}
