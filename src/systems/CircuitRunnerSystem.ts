import { CIRCUIT } from "../config";
import type { Rng } from "../core/Rng";

export interface CircuitTrailSegment {
  active: boolean;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  progress0: number;
  progress1: number;
  life: number;
  maxLife: number;
}

const CARDINAL_DIRS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function parseHexRgb(hex: string): readonly [number, number, number] {
  const clean = hex.startsWith("#") ? hex.slice(1) : hex;
  const n = parseInt(clean, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const;
}

const CIRCUIT_RGB = CIRCUIT.colors.map(parseHexRgb);

/**
 * Compute the RGB color along Circuit Runner's cooling curve:
 * bright orange (0) -> light blue (1/3) -> blue (2/3) -> purple (1).
 */
export function circuitColorRgbAt(progress: number): readonly [number, number, number] {
  const clamped = Math.max(0, Math.min(1, progress));
  const last = CIRCUIT_RGB.length - 1;
  const scaled = clamped * last;
  const idx = Math.min(last - 1, Math.floor(scaled));
  const frac = scaled - idx;
  const c0 = CIRCUIT_RGB[idx];
  const c1 = CIRCUIT_RGB[idx + 1];
  const r = Math.round(c0[0] + (c1[0] - c0[0]) * frac);
  const g = Math.round(c0[1] + (c1[1] - c0[1]) * frac);
  const b = Math.round(c0[2] + (c1[2] - c0[2]) * frac);
  return [r, g, b] as const;
}

/** CSS rgb(...) color string along Circuit Runner's cooling progression. */
export function circuitColorAt(progress: number): string {
  const [r, g, b] = circuitColorRgbAt(progress);
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Pick a random outgoing cardinal direction, excluding reversal back toward
 * where the shot came from.
 *
 * For cardinal incoming legs, the 3 available exits are straight ahead, left,
 * and right. Non-cardinal incoming angles map to their dominant cardinal axis
 * and exclude its opposite.
 */
export function chooseOutgoingCardinal(
  inDx: number,
  inDy: number,
  rng: Rng,
): readonly [number, number] {
  const axisX = Math.abs(inDx) >= Math.abs(inDy) ? (inDx >= 0 ? 1 : -1) : 0;
  const axisY = axisX === 0 ? (inDy >= 0 ? 1 : -1) : 0;
  const revX = -axisX;
  const revY = -axisY;
  const candidates: (readonly [number, number])[] = [];
  for (let i = 0; i < CARDINAL_DIRS.length; i++) {
    const dir = CARDINAL_DIRS[i];
    if (dir[0] === revX && dir[1] === revY) continue;
    candidates.push(dir);
  }
  return candidates[rng.int(candidates.length)];
}

/**
 * Bounded pool of retained right-angled "Tron-like" trail segments emitted by
 * Circuit Runner laser shots.
 */
export class CircuitRunnerSystem {
  readonly segments: CircuitTrailSegment[] = Array.from({ length: CIRCUIT.maxSegments }, () => ({
    active: false,
    x1: 0,
    y1: 0,
    x2: 0,
    y2: 0,
    progress0: 0,
    progress1: 0,
    life: 0,
    maxLife: CIRCUIT.trailLife,
  }));

  private nextSlot = 0;

  addSegment(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    progress0: number,
    progress1: number,
    maxLife = CIRCUIT.trailLife,
  ): void {
    if (Math.hypot(x2 - x1, y2 - y1) < 1e-4) return;
    const seg = this.segments[this.nextSlot];
    this.nextSlot = (this.nextSlot + 1) % this.segments.length;
    seg.active = true;
    seg.x1 = x1;
    seg.y1 = y1;
    seg.x2 = x2;
    seg.y2 = y2;
    seg.progress0 = Math.max(0, Math.min(1, progress0));
    seg.progress1 = Math.max(0, Math.min(1, progress1));
    seg.maxLife = maxLife;
    seg.life = maxLife;
  }

  update(dt: number): void {
    for (let i = 0; i < this.segments.length; i++) {
      const seg = this.segments[i];
      if (!seg.active) continue;
      seg.life -= dt;
      if (seg.life <= 0) {
        seg.active = false;
        seg.life = 0;
      }
    }
  }

  clear(): void {
    for (let i = 0; i < this.segments.length; i++) {
      this.segments[i].active = false;
      this.segments[i].life = 0;
    }
    this.nextSlot = 0;
  }
}
