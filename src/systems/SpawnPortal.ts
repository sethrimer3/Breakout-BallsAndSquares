/**
 * Squad deployment through a portal. The player taps one spot, a circular
 * portal opens there, and every operator in reserve steps through it one
 * after another, `interval` seconds apart. They fan out clockwise at equal
 * angles (360 / n degrees apart), and the first one always heads north.
 */
export const PORTAL = {
  /** Seconds for the portal to swirl open before the first operator. */
  openTime: 0.7,
  /** Seconds between operators stepping through. */
  interval: 0.5,
  /** Seconds the portal stays open after the last operator. */
  holdTime: 0.35,
  /** Seconds for it to collapse shut. */
  closeTime: 0.45,
  /** Radius of the open portal (world units). */
  radius: 10,
} as const;

/**
 * Heading of the `k`-th of `n` operators through the portal: north first,
 * then clockwise in equal steps. Screen y grows downward, so clockwise is a
 * growing angle from -90 degrees.
 */
export function portalHeading(k: number, n: number): { dx: number; dy: number } {
  const a = -Math.PI / 2 + (k * Math.PI * 2) / Math.max(1, n);
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  // Snap float dust so north is exactly (0, -1), east exactly (1, 0), and so on.
  return { dx: Math.abs(dx) < 1e-9 ? 0 : dx, dy: Math.abs(dy) < 1e-9 ? 0 : dy };
}

export type PortalPhase = "opening" | "open" | "closing" | "done";

export class SpawnPortal {
  /** Seconds since the portal began to open. */
  t = 0;
  /** Operators sent through so far. */
  emitted = 0;

  constructor(
    readonly x: number,
    readonly y: number,
    /** Operators that will come through. */
    readonly count: number,
  ) {}

  /** Seconds after opening at which operator `k` steps out. */
  emitTime(k: number): number {
    return PORTAL.openTime + k * PORTAL.interval;
  }

  /** When the portal starts to close. */
  get closeAt(): number {
    return this.emitTime(Math.max(0, this.count - 1)) + PORTAL.holdTime;
  }

  /** Total lifetime, open to shut. */
  get duration(): number {
    return this.closeAt + PORTAL.closeTime;
  }

  get phase(): PortalPhase {
    if (this.t >= this.duration) return "done";
    if (this.t >= this.closeAt) return "closing";
    if (this.t >= PORTAL.openTime) return "open";
    return "opening";
  }

  /** How open the portal is, 0 (a point) to 1 (full size). */
  get openness(): number {
    if (this.t < PORTAL.openTime) {
      // Ease out with a small overshoot, so it bursts open and settles.
      const p = this.t / PORTAL.openTime;
      const c = 1.6;
      return 1 + (c + 1) * (p - 1) ** 3 + c * (p - 1) ** 2;
    }
    if (this.t < this.closeAt) return 1;
    const p = Math.min(1, (this.t - this.closeAt) / PORTAL.closeTime);
    return 1 - p * p;
  }

  /**
   * Advance by `dt`, calling `emit` for each operator whose turn came (in
   * order, with its heading). Returns false once the portal has shut.
   */
  update(dt: number, emit: (k: number, dx: number, dy: number) => void): boolean {
    this.t += dt;
    while (this.emitted < this.count && this.t >= this.emitTime(this.emitted)) {
      const k = this.emitted++;
      const h = portalHeading(k, this.count);
      emit(k, h.dx, h.dy);
    }
    return this.t < this.duration;
  }
}
