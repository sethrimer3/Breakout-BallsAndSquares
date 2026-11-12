import { afterEach, describe, expect, it, vi } from "vitest";
import { AudioSystem } from "../src/audio/AudioSystem";
import { GOO_AUDIO, type GooSound } from "../src/audio/gooAudio";
import { SaveManager, type StorageLike } from "../src/progression/SaveManager";
import { CameraSystem } from "../src/systems/CameraSystem";
import { PixelWorld } from "../src/world/PixelWorld";

class MemoryStorage implements StorageLike {
  private data = new Map<string, string>();
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
}

function param() {
  return { value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() };
}
function node() {
  return {
    gain: param(), frequency: param(), Q: param(), pan: param(),
    type: "", buffer: null, onended: null as (() => void) | null,
    connect: vi.fn((destination: unknown) => destination), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(),
  };
}

function setup() {
  let unlock = () => {};
  let now = 1000;
  const tones: ReturnType<typeof node>[] = [];
  const noises: ReturnType<typeof node>[] = [];
  const gains: ReturnType<typeof node>[] = [];
  const pans: ReturnType<typeof node>[] = [];
  const filters: ReturnType<typeof node>[] = [];
  const ctx = {
    state: "running", currentTime: 1, sampleRate: 8000, destination: {},
    createBuffer: (_channels: number, length: number) => ({ getChannelData: () => new Float32Array(length) }),
    createOscillator: () => { const n = node(); tones.push(n); return n; },
    createBufferSource: () => { const n = node(); noises.push(n); return n; },
    createGain: () => { const n = node(); gains.push(n); return n; },
    createStereoPanner: () => { const n = node(); pans.push(n); return n; },
    createBiquadFilter: () => { const n = node(); filters.push(n); return n; },
  };
  const create = vi.fn(function () { return ctx; });
  vi.stubGlobal("window", { AudioContext: create, addEventListener: (name: string, fn: () => void) => { if (name === "pointerdown") unlock = fn; } });
  vi.stubGlobal("document", { hidden: false, addEventListener: vi.fn() });
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const save = new SaveManager(new MemoryStorage());
  const audio = new AudioSystem(save);
  return { audio, save, ctx, create, tones, noises, gains, pans, filters, unlock: () => unlock(), time: (t: number) => { now = t; } };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("SQUELCH audio voices", () => {
  it("requires a gesture and suppresses muted, zero-volume and off-screen effects", () => {
    const f = setup();
    f.audio.playGoo("stick", 0, 0);
    expect(f.create).not.toHaveBeenCalled();
    f.unlock();
    f.save.data.settings.muted = true;
    f.audio.playGoo("stick", 0, 0);
    f.save.data.settings.muted = false;
    f.save.data.settings.volume = 0;
    f.audio.playGoo("stick", 0, 0);
    f.save.data.settings.volume = 0.6;
    const cam = new CameraSystem(new PixelWorld({ width: 128, height: 128, cellSize: 8, roomSize: 4 }));
    cam.viewW = 800; cam.viewH = 600; cam.zoom = 1; cam.x = cam.y = 512;
    f.audio.setCamera(cam);
    f.audio.playGoo("stick", 10000, 10000);
    expect(f.tones).toHaveLength(0);
    f.audio.playGoo("stick", 512, 512);
    expect(f.tones).toHaveLength(1);
  });

  it("retains spatial falloff, stereo pan and the user's effects volume", () => {
    const f = setup(); f.unlock();
    const cam = new CameraSystem(new PixelWorld({ width: 128, height: 128, cellSize: 8, roomSize: 4 }));
    cam.viewW = 800; cam.viewH = 600; cam.zoom = 1; cam.x = cam.y = 512;
    f.audio.setCamera(cam);
    f.save.data.settings.volume = 0.4;
    f.audio.playGoo("release", 912, 512);
    expect(f.gains[0].gain.value).toBeCloseTo(0.4 * 0.25);
    expect(f.pans[0].pan.value).toBe(1);
  });

  it("throttles each cue independently rather than losing the impact/release pair", () => {
    const f = setup(); f.unlock();
    f.audio.playGoo("stick", 0, 0);
    f.audio.playGoo("stick", 0, 0);
    f.audio.playGoo("release", 0, 0);
    expect(f.tones).toHaveLength(2);
    f.time(1044); f.audio.playGoo("stick", 0, 0);
    expect(f.tones).toHaveLength(2);
    f.time(1046); f.audio.playGoo("stick", 0, 0);
    expect(f.tones).toHaveLength(3);
  });

  it("caps concurrent two-source voices and recovers slots only after completion", () => {
    const f = setup(); f.unlock();
    for (let i = 0; i < 100; i++) {
      f.time(1000 + i * 70);
      f.audio.playGoo("burst", 0, 0);
    }
    expect(f.tones).toHaveLength(GOO_AUDIO.maxVoices);
    expect(f.noises).toHaveLength(GOO_AUDIO.maxVoices);
    f.tones[0].onended!();
    for (const n of [f.tones[0], f.noises[0], f.filters[0], f.gains[0], f.gains[1], f.gains[2], f.pans[0]]) {
      expect(n.disconnect).toHaveBeenCalledTimes(1);
    }
    f.time(10000); f.audio.playGoo("burst", 0, 0);
    expect(f.tones).toHaveLength(GOO_AUDIO.maxVoices + 1);
  });

  it("schedules distinct, finite noise and pitch envelopes for all four cues", () => {
    const f = setup(); f.unlock();
    const kinds: GooSound[] = ["launch", "stick", "release", "burst"];
    for (const kind of kinds) f.audio.playGoo(kind, 0, 0);
    const ends = f.tones.map((n) => n.frequency.exponentialRampToValueAtTime.mock.calls[0][0]);
    expect(new Set(ends).size).toBe(4);
    for (const n of [...f.tones, ...f.noises]) {
      expect(n.start).toHaveBeenCalledWith(f.ctx.currentTime);
      const end = n.stop.mock.calls[0][0];
      expect(end).toBeGreaterThan(f.ctx.currentTime);
      expect(end).toBeLessThanOrEqual(f.ctx.currentTime + 0.2);
    }
    for (const n of f.tones) n.onended!();
    for (let i = 0; i < 6; i++) {
      f.time(2000 + i * 70); f.audio.playGoo("launch", 0, 0);
    }
    expect(f.tones).toHaveLength(10);
  });
  it("bounds the shared electronic drone/prism voices and disconnects their routes", () => {
    const f=setup();f.unlock();
    for(let i=0;i<100;i++) {f.time(1000+i*100);f.audio.playDrone(0,0);f.audio.playPrism(0,0);}
    expect(f.tones).toHaveLength(4);
    f.tones[0].onended!();
    expect(f.tones[0].disconnect).toHaveBeenCalledTimes(1);
    expect(f.pans[0].disconnect).toHaveBeenCalledTimes(1);
    f.time(20000);f.audio.playPrism(0,0);expect(f.tones).toHaveLength(5);
    f.save.data.settings.muted=true;f.tones[1].onended!();f.audio.playDrone(0,0);expect(f.tones).toHaveLength(5);
  });

});
