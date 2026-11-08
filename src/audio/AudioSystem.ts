import type { SaveManager } from "../progression/SaveManager";

/**
 * Procedural Web Audio synthesizer (no external assets).
 * AudioContext is lazily created on the first user gesture and throttled per
 * sound category so high fire rates never saturate the mixer.
 */
export class AudioSystem {
  private ctx: AudioContext | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private lastShotAt = 0;
  private lastImpactAt = 0;
  private lastDestroyAt = 0;
  private lastPickupAt = 0;
  private lastGlassAt = 0;

  constructor(private save: SaveManager) {}

  get muted(): boolean {
    return this.save.data.settings.muted;
  }

  toggleMute(): boolean {
    this.save.data.settings.muted = !this.save.data.settings.muted;
    this.save.save();
    return this.save.data.settings.muted;
  }

  private ensure(): AudioContext | null {
    if (this.muted) return null;
    if (typeof window === "undefined") return null;
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    if (!this.ctx) {
      try {
        this.ctx = new AC();
        const len = Math.floor(this.ctx.sampleRate * 0.25);
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const data = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      } catch {
        return null;
      }
    }
    if (this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private vol(scale: number): number {
    return Math.max(0.0001, this.save.data.settings.volume * scale);
  }

  /** Crisp pistol crack: filtered noise burst + short punchy pitch drop. */
  playShot(): void {
    const now = performance.now();
    if (now - this.lastShotAt < 28) return;
    this.lastShotAt = now;
    const ctx = this.ensure();
    if (!ctx || !this.noiseBuf) return;
    const t = ctx.currentTime;

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(1600 + Math.random() * 450, t);
    filter.Q.value = 1.4;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(this.vol(0.18), t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.055);
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start(t);
    src.stop(t + 0.06);

    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(320, t);
    osc.frequency.exponentialRampToValueAtTime(75, t + 0.045);
    const og = ctx.createGain();
    og.gain.setValueAtTime(this.vol(0.14), t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    osc.connect(og).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.055);
  }

  /** Sharp blade slice / whoosh. */
  playSlash(): void {
    const now = performance.now();
    if (now - this.lastShotAt < 28) return;
    this.lastShotAt = now;
    const ctx = this.ensure();
    if (!ctx || !this.noiseBuf) return;
    const t = ctx.currentTime;

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(2600 + Math.random() * 400, t);
    filter.frequency.exponentialRampToValueAtTime(700, t + 0.07);
    filter.Q.value = 3.2;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(this.vol(0.2), t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start(t);
    src.stop(t + 0.075);
  }

  /** Subtle tick when a bullet damages a pixel without destroying it. */
  playImpact(): void {
    const now = performance.now();
    if (now - this.lastImpactAt < 35) return;
    this.lastImpactAt = now;
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(520 + Math.random() * 180, t);
    osc.frequency.exponentialRampToValueAtTime(160, t + 0.03);
    const g = ctx.createGain();
    g.gain.setValueAtTime(this.vol(0.07), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.032);
    osc.connect(g).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.035);
  }

  /** Low, satisfying pop when a terrain pixel shatters. */
  playDestroy(): void {
    const now = performance.now();
    if (now - this.lastDestroyAt < 24) return;
    this.lastDestroyAt = now;
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(210 + Math.random() * 70, t);
    osc.frequency.exponentialRampToValueAtTime(58, t + 0.065);
    const g = ctx.createGain();
    g.gain.setValueAtTime(this.vol(0.14), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    osc.connect(g).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.075);
  }

  /** Descending sweep when a soldier is crushed by replicating terrain. */
  playSoldierDeath(): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(480, t);
    osc.frequency.exponentialRampToValueAtTime(65, t + 0.28);
    const g = ctx.createGain();
    g.gain.setValueAtTime(this.vol(0.22), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    osc.connect(g).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.32);
  }

  /** Bright high-pitched coin ping when a soldier collects a golden square. */
  playPickup(): void {
    const now = performance.now();
    if (now - this.lastPickupAt < 38) return;
    this.lastPickupAt = now;
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    const base = 980 + Math.random() * 180;
    osc.frequency.setValueAtTime(base, t);
    osc.frequency.exponentialRampToValueAtTime(base * 1.35, t + 0.05);
    const g = ctx.createGain();
    g.gain.setValueAtTime(this.vol(0.09), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.055);
    osc.connect(g).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.06);
  }

  /** Bright two-tone chime on upgrade purchase. */
  playPurchase(): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    const notes = [523.25, 783.99];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      const start = t + idx * 0.06;
      osc.frequency.setValueAtTime(freq, start);
      const g = ctx.createGain();
      g.gain.setValueAtTime(this.vol(0.18), start);
      g.gain.exponentialRampToValueAtTime(0.001, start + 0.14);
      osc.connect(g).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.15);
    });
  }

  /** Crisp high-tech radar ping when placing a tactical marker. */
  playMarkerPing(): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(1046.5, t);
    osc.frequency.exponentialRampToValueAtTime(1318.5, t + 0.08);
    const g = ctx.createGain();
    g.gain.setValueAtTime(this.vol(0.14), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    osc.connect(g).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.13);
  }

  /** Short pneumatic hiss with a soft mechanical clunk as a blast door slides open. */
  playDoorOpen(): void {
    const ctx = this.ensure();
    if (!ctx || !this.noiseBuf) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(900, t);
    filter.frequency.exponentialRampToValueAtTime(2400, t + 0.18);
    filter.Q.value = 0.9;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(this.vol(0.001), t);
    gain.gain.exponentialRampToValueAtTime(this.vol(0.12), t + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start(t);
    src.stop(t + 0.23);

    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(70, t + 0.08);
    const og = ctx.createGain();
    og.gain.setValueAtTime(this.vol(0.06), t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    osc.connect(og).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.1);
  }

  /** Bright tinkle of a glass pane bursting (throttled, so a chain sounds like a cascade). */
  playGlassShatter(): void {
    const now = performance.now();
    if (now - this.lastGlassAt < 30) return;
    this.lastGlassAt = now;
    const ctx = this.ensure();
    if (!ctx || !this.noiseBuf) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.setValueAtTime(3800 + Math.random() * 1600, t);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(this.vol(0.1), t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start(t);
    src.stop(t + 0.1);

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(2600 + Math.random() * 1400, t);
    const og = ctx.createGain();
    og.gain.setValueAtTime(this.vol(0.04), t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    osc.connect(og).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.13);
  }

  /** Rising two-step chirp as a dormant sentry boots up. */
  playSentryWake(): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    [440, 880].forEach((freq, idx) => {
      const start = t + idx * 0.07;
      const osc = ctx.createOscillator();
      osc.type = "square";
      osc.frequency.setValueAtTime(freq, start);
      const g = ctx.createGain();
      g.gain.setValueAtTime(this.vol(0.05), start);
      g.gain.exponentialRampToValueAtTime(0.001, start + 0.06);
      osc.connect(g).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.07);
    });
  }

  /** Falling sawtooth wail as the Blight goes into overdrive. */
  playOverdrive(): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(55, t + 0.9);
    const g = ctx.createGain();
    g.gain.setValueAtTime(this.vol(0.09), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.0);
    osc.connect(g).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 1.05);
  }

  /** Wet pop of a Blight flower launching a spore, or a creature lunging. */
  playSpore(): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(180 + Math.random() * 60, t);
    osc.frequency.exponentialRampToValueAtTime(420, t + 0.08);
    const g = ctx.createGain();
    g.gain.setValueAtTime(this.vol(0.05), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    osc.connect(g).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.11);
  }
}
