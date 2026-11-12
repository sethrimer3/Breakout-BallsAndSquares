export type GooSound = "launch" | "stick" | "release" | "burst";

/** Short, deliberately restrained wet noise/chirp pairs. No per-orb audio loops. */
const CUES = {
  launch: { duration: 0.10, filter: 850, filterEnd: 260, pitch: 180, pitchEnd: 95, noise: 0.045, tone: 0.035 },
  stick: { duration: 0.14, filter: 600, filterEnd: 160, pitch: 245, pitchEnd: 68, noise: 0.08, tone: 0.055 },
  release: { duration: 0.11, filter: 1200, filterEnd: 450, pitch: 155, pitchEnd: 390, noise: 0.035, tone: 0.04 },
  burst: { duration: 0.18, filter: 700, filterEnd: 130, pitch: 155, pitchEnd: 48, noise: 0.09, tone: 0.075 },
} as const;

export const GOO_AUDIO = {
  maxVoices: 6,
  throttleMs: { launch: 60, stick: 45, release: 55, burst: 65 },
} as const;

/** One voice = two finite sources; completion also disconnects every local node. */
export function synthesizeGoo(
  ctx: BaseAudioContext, noiseBuffer: AudioBuffer, output: AudioNode,
  kind: GooSound, finished: () => void,
): void {
  const cue = CUES[kind];
  const t = ctx.currentTime;
  const end = t + cue.duration;
  const variation = 0.94 + Math.random() * 0.12;
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer;
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.Q.value = 0.85;
  filter.frequency.setValueAtTime(cue.filter * variation, t);
  filter.frequency.exponentialRampToValueAtTime(cue.filterEnd, end);
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.0001, t);
  ng.gain.linearRampToValueAtTime(cue.noise, t + 0.006);
  ng.gain.exponentialRampToValueAtTime(0.0001, end);
  noise.connect(filter).connect(ng).connect(output);

  const tone = ctx.createOscillator();
  tone.type = "sine";
  tone.frequency.setValueAtTime(cue.pitch * variation, t);
  tone.frequency.exponentialRampToValueAtTime(cue.pitchEnd, end);
  const tg = ctx.createGain();
  tg.gain.setValueAtTime(0.0001, t);
  tg.gain.linearRampToValueAtTime(cue.tone, t + 0.008);
  tg.gain.exponentialRampToValueAtTime(0.0001, end);
  tone.connect(tg).connect(output);
  tone.onended = () => {
    noise.disconnect(); filter.disconnect(); ng.disconnect(); tone.disconnect(); tg.disconnect();
    finished();
  };
  noise.start(t);
  noise.stop(end);
  tone.start(t);
  tone.stop(end + 0.01);
}
