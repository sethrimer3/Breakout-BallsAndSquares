import type { CameraSystem } from "../systems/CameraSystem";
import { spatialMix } from "./spatialAudio";
import type { SaveManager } from "../progression/SaveManager";
import fireCrackleUrl from "../assets/audio/fire-crackle.mp3?url";

/**
 * Procedural effects and a quiet, sampled fire ambience loop.
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
  private lastFlameAt = 0;
  private fireBuffer: AudioBuffer | null = null;
  private fireLoad: Promise<void> | null = null;
  private fireFailed = false;
  private fireSource: AudioBufferSourceNode | null = null;
  private fireGain: GainNode | null = null;
  private fireSilentAt: number | null = null;
  private hasGesture = false;
  private camera: CameraSystem | null = null;
  private firePan: StereoPannerNode | null = null;

  constructor(private save: SaveManager) {
    if (typeof window === "undefined") return;
    const unlock = (): void => { this.hasGesture = true; this.ensure(); };
    window.addEventListener("pointerdown", unlock, { passive: true });
    window.addEventListener("keydown", unlock);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.stopFireAmbience();
    });
  }

  setCamera(camera: CameraSystem): void { this.camera = camera; }

  private audible(x?: number, y?: number): boolean {
    return !this.camera || x === undefined || y === undefined || spatialMix(this.camera, x, y).gain > 0;
  }

  private output(ctx: AudioContext, x?: number, y?: number): AudioNode {
    if (!this.camera || x === undefined || y === undefined) return ctx.destination;
    const mix = spatialMix(this.camera, x, y);
    const gain = ctx.createGain();
    const pan = ctx.createStereoPanner();
    gain.gain.value = mix.gain;
    pan.pan.value = mix.pan;
    gain.connect(pan).connect(ctx.destination);
    return gain;
  }

  get muted(): boolean {
    return this.save.data.settings.muted;
  }

  toggleMute(): boolean {
    this.save.data.settings.muted = !this.save.data.settings.muted;
    this.save.save();
    if (this.muted) this.stopFireAmbience();
    else this.ensure();
    return this.save.data.settings.muted;
  }

  /** One loop for all fires, capped at 8% before master volume, with smooth camera fades. */
  updateFireAmbience(level: number, pan = 0): void {
    const target = this.muted || document.hidden ? 0
      : Math.max(0, Math.min(1, level)) * this.save.data.settings.volume * 0.08;
    const ctx = target > 0 && this.hasGesture ? this.ensure() : this.ctx;
    if (!ctx) return;
    if (target > 0 && this.hasGesture && !this.fireBuffer && !this.fireLoad && !this.fireFailed) {
      this.fireLoad = (async () => {
        const response = await fetch(fireCrackleUrl);
        if (!response.ok) throw new Error("Fire ambience asset could not be loaded");
        this.fireBuffer = await ctx.decodeAudioData(await response.arrayBuffer());
      })().catch(() => {
        this.fireFailed = true;
        console.warn("BREACH: fire ambience unavailable; other sound effects remain active.");
      }).finally(() => { this.fireLoad = null; });
    }
    if (target > 0 && this.hasGesture && this.fireBuffer && !this.fireSource) {
      this.fireGain = ctx.createGain();
      this.fireGain.gain.value = 0;
      this.fireSource = ctx.createBufferSource();
      this.fireSource.buffer = this.fireBuffer;
      this.fireSource.loop = true;
      this.firePan = ctx.createStereoPanner();
      this.fireSource.connect(this.fireGain).connect(this.firePan).connect(ctx.destination);
      this.fireSource.start();
    }
    if (!this.fireGain) return;
    this.fireGain.gain.setTargetAtTime(target, ctx.currentTime, 0.12);
    this.firePan!.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), ctx.currentTime, 0.12);
    if (target > 0) this.fireSilentAt = null;
    else {
      this.fireSilentAt ??= ctx.currentTime;
      if (ctx.currentTime - this.fireSilentAt > 0.8) this.stopFireAmbience();
    }
  }

  private stopFireAmbience(): void {
    if (this.fireGain && this.ctx) {
      this.fireGain.gain.cancelScheduledValues(this.ctx.currentTime);
      this.fireGain.gain.setValueAtTime(0, this.ctx.currentTime);
    }
    this.fireSource?.stop();
    this.fireSource?.disconnect();
    this.fireGain?.disconnect();
    this.firePan?.disconnect();
    this.firePan = null;
    this.fireSource = null;
    this.fireGain = null;
    this.fireSilentAt = null;
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
  playShot(x?: number, y?: number): void {
    if (!this.audible(x, y)) return;
    const now = performance.now();
    if (now - this.lastShotAt < 28) return;
    this.lastShotAt = now;
    const ctx = this.ensure();
    if (!ctx || !this.noiseBuf) return;
    const output = this.output(ctx, x, y);
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
    src.connect(filter).connect(gain).connect(output);
    src.start(t);
    src.stop(t + 0.06);

    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(320, t);
    osc.frequency.exponentialRampToValueAtTime(75, t + 0.045);
    const og = ctx.createGain();
    og.gain.setValueAtTime(this.vol(0.14), t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    osc.connect(og).connect(output);
    osc.start(t);
    osc.stop(t + 0.055);
  }

  /** Flamethrower: a soft, low roar of filtered noise, overlapping into a steady hiss. */
  playFlame(x?: number, y?: number): void {
    if (!this.audible(x, y)) return;
    const now = performance.now();
    if (now - this.lastFlameAt < 70) return;
    this.lastFlameAt = now;
    const ctx = this.ensure();
    if (!ctx || !this.noiseBuf) return;
    const output = this.output(ctx, x, y);
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.6 + Math.random() * 0.15;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(900 + Math.random() * 300, t);
    filter.Q.value = 0.8;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(this.vol(0.11), t + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    src.connect(filter).connect(gain).connect(output);
    src.start(t);
    src.stop(t + 0.17);
  }

  /** Sharp blade slice / whoosh. */
  playSlash(x?: number, y?: number): void {
    if (!this.audible(x, y)) return;
    const now = performance.now();
    if (now - this.lastShotAt < 28) return;
    this.lastShotAt = now;
    const ctx = this.ensure();
    if (!ctx || !this.noiseBuf) return;
    const output = this.output(ctx, x, y);
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
    src.connect(filter).connect(gain).connect(output);
    src.start(t);
    src.stop(t + 0.075);
  }

  /** Subtle tick when a bullet damages a pixel without destroying it. */
  playImpact(x?: number, y?: number): void {
    if (!this.audible(x, y)) return;
    const now = performance.now();
    if (now - this.lastImpactAt < 35) return;
    this.lastImpactAt = now;
    const ctx = this.ensure();
    if (!ctx) return;
    const output = this.output(ctx, x, y);
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(520 + Math.random() * 180, t);
    osc.frequency.exponentialRampToValueAtTime(160, t + 0.03);
    const g = ctx.createGain();
    g.gain.setValueAtTime(this.vol(0.07), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.032);
    osc.connect(g).connect(output);
    osc.start(t);
    osc.stop(t + 0.035);
  }

  /** Low, satisfying pop when a terrain pixel shatters. */
  playDestroy(x?: number, y?: number): void {
    if (!this.audible(x, y)) return;
    const now = performance.now();
    if (now - this.lastDestroyAt < 24) return;
    this.lastDestroyAt = now;
    const ctx = this.ensure();
    if (!ctx) return;
    const output = this.output(ctx, x, y);
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(210 + Math.random() * 70, t);
    osc.frequency.exponentialRampToValueAtTime(58, t + 0.065);
    const g = ctx.createGain();
    g.gain.setValueAtTime(this.vol(0.14), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    osc.connect(g).connect(output);
    osc.start(t);
    osc.stop(t + 0.075);
  }

  /** Descending sweep when a soldier is crushed by replicating terrain. */
  playSoldierDeath(x?: number, y?: number): void {
    if (!this.audible(x, y)) return;
    const ctx = this.ensure();
    if (!ctx) return;
    const output = this.output(ctx, x, y);
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(480, t);
    osc.frequency.exponentialRampToValueAtTime(65, t + 0.28);
    const g = ctx.createGain();
    g.gain.setValueAtTime(this.vol(0.22), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    osc.connect(g).connect(output);
    osc.start(t);
    osc.stop(t + 0.32);
  }

  /** Bright high-pitched coin ping when a soldier collects a golden square. */
  playPickup(x?: number, y?: number): void {
    if (!this.audible(x, y)) return;
    const now = performance.now();
    if (now - this.lastPickupAt < 38) return;
    this.lastPickupAt = now;
    const ctx = this.ensure();
    if (!ctx) return;
    const output = this.output(ctx, x, y);
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    const base = 980 + Math.random() * 180;
    osc.frequency.setValueAtTime(base, t);
    osc.frequency.exponentialRampToValueAtTime(base * 1.35, t + 0.05);
    const g = ctx.createGain();
    g.gain.setValueAtTime(this.vol(0.09), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.055);
    osc.connect(g).connect(output);
    osc.start(t);
    osc.stop(t + 0.06);
  }

  /** Bright two-tone chime on upgrade purchase. */
  playPurchase(x?: number, y?: number): void {
    if (!this.audible(x, y)) return;
    const ctx = this.ensure();
    if (!ctx) return;
    const output = this.output(ctx, x, y);
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
      osc.connect(g).connect(output);
      osc.start(start);
      osc.stop(start + 0.15);
    });
  }

  /** Crisp high-tech radar ping when placing a tactical marker. */
  playMarkerPing(x?: number, y?: number): void {
    if (!this.audible(x, y)) return;
    const ctx = this.ensure();
    if (!ctx) return;
    const output = this.output(ctx, x, y);
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(1046.5, t);
    osc.frequency.exponentialRampToValueAtTime(1318.5, t + 0.08);
    const g = ctx.createGain();
    g.gain.setValueAtTime(this.vol(0.14), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    osc.connect(g).connect(output);
    osc.start(t);
    osc.stop(t + 0.13);
  }

  /** Short pneumatic hiss with a soft mechanical clunk as a blast door slides open. */
  playDoorOpen(x?: number, y?: number): void {
    if (!this.audible(x, y)) return;
    const ctx = this.ensure();
    if (!ctx || !this.noiseBuf) return;
    const output = this.output(ctx, x, y);
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
    src.connect(filter).connect(gain).connect(output);
    src.start(t);
    src.stop(t + 0.23);

    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(70, t + 0.08);
    const og = ctx.createGain();
    og.gain.setValueAtTime(this.vol(0.06), t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    osc.connect(og).connect(output);
    osc.start(t);
    osc.stop(t + 0.1);
  }

  /** Bright tinkle of a glass pane bursting (throttled, so a chain sounds like a cascade). */
  playGlassShatter(x?: number, y?: number): void {
    if (!this.audible(x, y)) return;
    const now = performance.now();
    if (now - this.lastGlassAt < 30) return;
    this.lastGlassAt = now;
    const ctx = this.ensure();
    if (!ctx || !this.noiseBuf) return;
    const output = this.output(ctx, x, y);
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.setValueAtTime(3800 + Math.random() * 1600, t);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(this.vol(0.1), t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    src.connect(filter).connect(gain).connect(output);
    src.start(t);
    src.stop(t + 0.1);

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(2600 + Math.random() * 1400, t);
    const og = ctx.createGain();
    og.gain.setValueAtTime(this.vol(0.04), t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    osc.connect(og).connect(output);
    osc.start(t);
    osc.stop(t + 0.13);
  }

  /** Rising two-step chirp as a dormant sentry boots up. */
  playSentryWake(x?: number, y?: number): void {
    if (!this.audible(x, y)) return;
    const ctx = this.ensure();
    if (!ctx) return;
    const output = this.output(ctx, x, y);
    const t = ctx.currentTime;
    [440, 880].forEach((freq, idx) => {
      const start = t + idx * 0.07;
      const osc = ctx.createOscillator();
      osc.type = "square";
      osc.frequency.setValueAtTime(freq, start);
      const g = ctx.createGain();
      g.gain.setValueAtTime(this.vol(0.05), start);
      g.gain.exponentialRampToValueAtTime(0.001, start + 0.06);
      osc.connect(g).connect(output);
      osc.start(start);
      osc.stop(start + 0.07);
    });
  }

  /** Falling sawtooth wail as the Blight goes into overdrive. */
  playOverdrive(x?: number, y?: number): void {
    if (!this.audible(x, y)) return;
    const ctx = this.ensure();
    if (!ctx) return;
    const output = this.output(ctx, x, y);
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(55, t + 0.9);
    const g = ctx.createGain();
    g.gain.setValueAtTime(this.vol(0.09), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.0);
    osc.connect(g).connect(output);
    osc.start(t);
    osc.stop(t + 1.05);
  }

  /** Wet pop of a Blight flower launching a spore, or a creature lunging. */
  playSpore(x?: number, y?: number): void {
    if (!this.audible(x, y)) return;
    const ctx = this.ensure();
    if (!ctx) return;
    const output = this.output(ctx, x, y);
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(180 + Math.random() * 60, t);
    osc.frequency.exponentialRampToValueAtTime(420, t + 0.08);
    const g = ctx.createGain();
    g.gain.setValueAtTime(this.vol(0.05), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    osc.connect(g).connect(output);
    osc.start(t);
    osc.stop(t + 0.11);
  }
}
