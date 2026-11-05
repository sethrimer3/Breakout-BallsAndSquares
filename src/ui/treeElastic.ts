/**
 * Elastic node physics for the upgrade tree.
 *
 * Each node sits on a spring to its home and on another that keeps its place
 * relative to its parent, and nodes push apart when crowded. Children follow
 * their parent, so dragging a node pulls its branch along and everything
 * eases back when let go. Pure math: no DOM.
 */

export interface ElasticBody {
  id: string;
  parent: string | null;
  /** Rest position. */
  hx: number;
  hy: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

const HOME_SPRING = 9;
const PARENT_SPRING = 16;
const CROWD_DISTANCE = 84;
const CROWD_FORCE = 30;
const DAMPING = 7;

/** Advance `bodies` by `dt` seconds; `heldId` stays where the pointer put it. */
export function stepElastic(bodies: ElasticBody[], dt: number, heldId: string | null = null): void {
  if (dt <= 0) return;
  const byId = new Map(bodies.map((b) => [b.id, b]));
  const damp = Math.exp(-DAMPING * dt);
  for (const b of bodies) {
    let ax = (b.hx - b.x) * HOME_SPRING;
    let ay = (b.hy - b.y) * HOME_SPRING;
    const p = b.parent ? byId.get(b.parent) : undefined;
    if (p) {
      ax += (p.x + b.hx - p.hx - b.x) * PARENT_SPRING;
      ay += (p.y + b.hy - p.hy - b.y) * PARENT_SPRING;
    }
    for (const o of bodies) {
      // A parent and child keep apart by their branch instead.
      if (o === b || o.id === b.parent || o.parent === b.id) continue;
      const dx = b.x - o.x;
      const dy = b.y - o.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > CROWD_DISTANCE * CROWD_DISTANCE || d2 < 0.01) continue;
      const d = Math.sqrt(d2);
      const f = (CROWD_DISTANCE - d) * CROWD_FORCE;
      ax += (dx / d) * f;
      ay += (dy / d) * f;
    }
    b.vx = (b.vx + ax * dt) * damp;
    b.vy = (b.vy + ay * dt) * damp;
  }
  for (const b of bodies) {
    if (b.id === heldId) {
      b.vx = 0;
      b.vy = 0;
      continue;
    }
    b.x += b.vx * dt;
    b.y += b.vy * dt;
  }
}
