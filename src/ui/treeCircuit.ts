/**
 * Tron-style light cycles on the upgrade tree.
 *
 * Links are right-angle circuit traces that stay orthogonal however far the
 * elastic nodes stretch. Cycles ride the traces one art pixel at a time,
 * wrap round each node's frame at 90 degrees, pick a branch at every junction
 * and leave a hard-pixel trail that steps down through three shades. They run
 * only on live (unlocked) nodes. All coordinates are art pixels on the link
 * canvas. Pure logic apart from `draw`, which takes a 2D context.
 */
import { paletteColor } from "./pixelArt";

export interface Pt {
  x: number;
  y: number;
}

export interface CircuitNode extends Pt {
  id: string;
  /** Rest position: gives each link its side, however the node is stretched. */
  hx: number;
  hy: number;
  color: string;
  live: boolean;
}

export interface Circuit {
  nodes: Map<string, CircuitNode>;
  neighbors: Map<string, string[]>;
}

/** Half-size of the square lap round a node: just outside its frame. */
export const RING = 12;
const SPEED = 62;
const TRAIL = 34;
const MAX_CYCLES = 5;

/** Clockwise from right: right, down, left, up. */
const SIDES: readonly Pt[] = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
];
/** The corner clockwise of each side. */
const CORNERS: readonly Pt[] = [
  { x: 1, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: -1 },
  { x: 1, y: -1 },
];

const opposite = (side: number): number => (side + 2) % 4;

/** The side of `a` facing `b`, from their rest positions. */
export function sideToward(a: CircuitNode, b: CircuitNode): number {
  const dx = b.hx - a.hx;
  const dy = b.hy - a.hy;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 0 : 2;
  return dy >= 0 ? 1 : 3;
}

/** Right-angle trace from `a` to `b`, jogging across at the midpoint. */
export function trace(a: Pt, b: Pt, horizontal: boolean): Pt[] {
  if (horizontal) {
    const mx = Math.round((a.x + b.x) / 2);
    return [a, { x: mx, y: a.y }, { x: mx, y: b.y }, b];
  }
  const my = Math.round((a.y + b.y) / 2);
  return [a, { x: a.x, y: my }, { x: b.x, y: my }, b];
}

function ringPoint(n: Pt, side: number): Pt {
  return { x: n.x + SIDES[side].x * RING, y: n.y + SIDES[side].y * RING };
}

/** Lap round `n` from side `from` to side `to`; equal sides make a full lap. */
function ringArc(n: Pt, from: number, to: number, clockwise: boolean): Pt[] {
  const pts = [ringPoint(n, from)];
  let side = from;
  do {
    const corner = CORNERS[clockwise ? side : (side + 3) % 4];
    pts.push({ x: n.x + corner.x * RING, y: n.y + corner.y * RING });
    side = (side + (clockwise ? 1 : 3)) % 4;
    pts.push(ringPoint(n, side));
  } while (side !== to);
  return pts;
}

/** One leg of a ride: round `a` from `entry` to `exit`, then along the trace to `b`. */
export function legPath(a: CircuitNode, b: CircuitNode, entry: number, exit: number, clockwise: boolean): Pt[] {
  const arc = ringArc(a, entry, exit, clockwise);
  if (a.id === b.id) return arc;
  return arc.concat(trace(ringPoint(a, exit), ringPoint(b, opposite(exit)), exit % 2 === 0).slice(1));
}

export function pathLength(path: readonly Pt[]): number {
  let len = 0;
  for (let i = 1; i < path.length; i++) {
    len += Math.abs(path[i].x - path[i - 1].x) + Math.abs(path[i].y - path[i - 1].y);
  }
  return len;
}

/** The pixel `dist` along an orthogonal `path`. */
export function pointAt(path: readonly Pt[], dist: number): Pt {
  let left = dist;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const len = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    if (left <= len) {
      return { x: a.x + Math.sign(b.x - a.x) * left, y: a.y + Math.sign(b.y - a.y) * left };
    }
    left -= len;
  }
  return path[path.length - 1];
}

/** One ridden leg. Trails are kept as legs, not pixels, so they stay on the
 * traces however the elastic nodes move. */
interface Leg {
  a: string;
  b: string;
  entry: number;
  exit: number;
  clockwise: boolean;
  /** Pixels ridden so far along this leg. */
  dist: number;
  color: string;
}

interface Cycle {
  /** Oldest first; the last is the leg being ridden. */
  legs: Leg[];
  carry: number;
}

function pathOf(leg: Leg, circuit: Circuit): Pt[] {
  return legPath(circuit.nodes.get(leg.a)!, circuit.nodes.get(leg.b)!, leg.entry, leg.exit, leg.clockwise);
}

export class TronCycles {
  private cycles: Cycle[] = [];

  constructor(private rng: () => number = Math.random) {}

  get count(): number {
    return this.cycles.length;
  }

  reset(): void {
    this.cycles = [];
  }

  step(dt: number, circuit: Circuit): void {
    const live = [...circuit.nodes.values()].filter((n) => n.live);
    const want = live.length === 0 ? 0 : Math.min(MAX_CYCLES, Math.ceil(live.length / 2));
    this.cycles.length = Math.min(this.cycles.length, want);
    while (this.cycles.length < want) {
      const start = live[Math.floor(this.rng() * live.length)];
      const entry = Math.floor(this.rng() * 4);
      this.cycles.push({ legs: [this.chooseLeg(start, entry, null, circuit)], carry: 0 });
    }
    for (const cycle of this.cycles) {
      cycle.carry += SPEED * dt;
      while (cycle.carry >= 1) {
        cycle.carry -= 1;
        this.advance(cycle, circuit);
      }
    }
  }

  /** The next leg from `node`: never back the way it came, unless at a dead end. */
  private chooseLeg(node: CircuitNode, entry: number, cameFrom: string | null, circuit: Circuit): Leg {
    const options = (circuit.neighbors.get(node.id) ?? []).filter((id) => circuit.nodes.get(id)?.live);
    const onward = options.filter((id) => id !== cameFrom);
    const pool = onward.length > 0 ? onward : options;
    const nextId = pool.length > 0 ? pool[Math.floor(this.rng() * pool.length)] : node.id;
    const next = circuit.nodes.get(nextId)!;
    return {
      a: node.id,
      b: nextId,
      entry,
      exit: nextId === node.id ? entry : sideToward(node, next),
      clockwise: this.rng() < 0.5,
      dist: 0,
      color: next.color,
    };
  }

  private advance(cycle: Cycle, circuit: Circuit): void {
    let leg = cycle.legs[cycle.legs.length - 1];
    if (leg.dist >= pathLength(pathOf(leg, circuit))) {
      const entry = leg.a === leg.b ? leg.entry : opposite(leg.exit);
      leg = this.chooseLeg(circuit.nodes.get(leg.b)!, entry, leg.a, circuit);
      cycle.legs.push(leg);
      // Forget legs the trail has run off the end of.
      let kept = 0;
      for (let i = cycle.legs.length - 2; i >= 0; i--) {
        kept += cycle.legs[i].dist;
        if (kept >= TRAIL) {
          cycle.legs.splice(0, i);
          break;
        }
      }
    }
    leg.dist += 1;
  }

  draw(g: CanvasRenderingContext2D, circuit: Circuit): void {
    for (const { legs } of this.cycles) {
      const pixels: (Pt & { color: string })[] = [];
      for (let i = legs.length - 1; i >= 0 && pixels.length < TRAIL; i--) {
        const path = pathOf(legs[i], circuit);
        const end = Math.min(legs[i].dist, pathLength(path));
        for (let d = end; d > 0 && pixels.length < TRAIL; d--) {
          pixels.push({ ...pointAt(path, d), color: legs[i].color });
        }
      }
      // Tail first, so the white head lands on top where the trail crosses itself.
      for (let i = pixels.length - 1; i >= 0; i--) {
        const age = i / TRAIL;
        const shade = age < 0.3 ? "+" : age < 0.65 ? "#" : "-";
        g.fillStyle = i === 0 ? "#ffffff" : (paletteColor(shade, pixels[i].color) as string);
        g.fillRect(pixels[i].x, pixels[i].y, 1, 1);
      }
    }
  }
}
