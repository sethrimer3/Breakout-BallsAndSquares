import { tierHealth } from "../config";
import type { Soldier } from "../entities/Soldier";
import { CAMPAIGN, campaignTier } from "../world/campaignBalance";
import { sectorAtCell } from "../world/labMap";
import type { PixelWorld } from "../world/PixelWorld";
import type { BulletTargets } from "./CombatSystem";
import { cellOverlapsCircle, hasLineOfSight } from "./PhysicsSystem";
import type { SpecialBlock } from "./SpecialUpgrades";

/**
 * Blight Wardens: bosses that guard every golden special-upgrade block. A
 * pair of them circles each block; while either lives the block is sealed in
 * a Blight membrane and shrugs off every hit. They wake when a soldier comes
 * into view (or shoots them), spit spore blobs from range, wind up and lunge
 * when close, and never stray far from the block they guard.
 *
 * Wardens are Blight, so squad hits on them roll and get Arsenal Calibration
 * like hits on Blight blocks, and their health is counted in ordinary blocks
 * of the tier they stand in.
 */
export const WARDEN = {
  /** Wardens round each gold block. */
  perBlock: 2,
  /** Health, in ordinary blocks of the spot's tier. */
  hpBlocks: 4,
  /** Body radius (world units) for movement; hits use `hitRadius`. */
  radius: 6,
  hitRadius: 7.5,
  /** Guard posts sit this many cells from the block's center (nearest that fits first). */
  postMinCells: 2,
  postMaxCells: 4,
  /** Idle drift round the post (cells). */
  driftCells: 0.7,
  /** A soldier in sight within this many cells wakes them. */
  aggroCells: 13,
  /** They never go farther than this from the block's center (cells). */
  leashCells: 8,
  /** Seconds a hit keeps them awake with nobody in sight. */
  hurtAggro: 6,
  speed: 26,
  /** Lunge: range (cells), windup, dash speed and duration, cooldown. */
  lungeCells: 4.5,
  lungeWindup: 0.6,
  lungeSpeed: 130,
  lungeTime: 0.32,
  lungeCooldown: 2.4,
  /** Spore blobs: cooldown, speed, life, blast radius (world units). */
  spitCooldown: 2.8,
  spitSpeed: 64,
  spitLife: 2.6,
  spitRadius: 9,
  /** Seconds between contact bites. */
  biteCooldown: 0.8,
} as const;

export type WardenState = "guard" | "chase" | "windup" | "lunge";

export interface Warden {
  id: number;
  /** Id of the gold block it guards. */
  blockId: string;
  /** Block center (world units). */
  homeX: number;
  homeY: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Guard post beside the block (world units), where it idles. */
  postX: number;
  postY: number;
  tier: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  state: WardenState;
  /** Seconds left in the current windup/lunge. */
  timer: number;
  lungeCd: number;
  spitCd: number;
  biteCd: number;
  /** Seconds it stays awake after a hit with nobody in sight. */
  aggro: number;
  /** Seconds left on the hurt flash. */
  hurt: number;
  /** Facing, radians (for the eye and the lunge maw). */
  facing: number;
  /** Animation phase. */
  phase: number;
  /** Soldiers already bitten by the current lunge. */
  struck: Set<Soldier>;
}

export interface WardenSpit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  damage: number;
}

export interface WardenEvents {
  onSoldierHit?(s: Soldier, damage: number, x: number, y: number): void;
  onSpit?(x: number, y: number): void;
  onSpitBurst?(x: number, y: number, radius: number): void;
  onLunge?(w: Warden): void;
  onHurt?(w: Warden, x: number, y: number): void;
  onKilled?(w: Warden): void;
  /** The last warden round a block died: its membrane falls away. */
  onBlockFreed?(blockId: string, x: number, y: number): void;
}

let nextId = 1;

/**
 * True if no full-size solid cell overlaps the circle. Wardens are big enough
 * to squeeze through half-size rubble, creep and lab clutter.
 */
export function clearOfCells(world: PixelWorld, x: number, y: number, r: number): boolean {
  const cs = world.cellSize;
  for (let cy = Math.floor((y - r) / cs); cy <= Math.floor((y + r) / cs); cy++) {
    for (let cx = Math.floor((x - r) / cs); cx <= Math.floor((x + r) / cs); cx++) {
      if (world.solidAt(cx, cy) && cellOverlapsCircle(cs, cx, cy, x, y, r)) return false;
    }
  }
  return true;
}

/** Damage a warden deals per bite, lunge or blob at a tier. */
export function wardenDamage(tier: number): number {
  if (tier >= 7) return Math.max(1, CAMPAIGN[campaignTier(tier)].damage);
  return 1 + Math.floor((Math.max(1, tier) - 1) / 3);
}

/** Warden health at a tier: `hpBlocks` ordinary blocks of that tier. */
export function wardenHealth(tier: number): number {
  return tierHealth(tier) * WARDEN.hpBlocks;
}

export class BlightWardenSystem implements BulletTargets {
  wardens: Warden[] = [];
  spits: WardenSpit[] = [];
  private selected: Warden | null = null;
  /** Living wardens per guarded block id. */
  private guards = new Map<string, number>();
  get targetKey(): object | null {
    return this.selected;
  }

  constructor(
    private world: PixelWorld,
    private events: WardenEvents = {},
    private rand: () => number = Math.random,
  ) {}

  /**
   * True when living Wardens hold the zone around world point (x, y), so no
   * squad may be deployed there. In the hand-made lab the zone is the whole
   * sector holding their gold block; in small test worlds it is the ground
   * within a few cells past their leash.
   */
  guardsZoneAt(x: number, y: number): boolean {
    const cs = this.world.cellSize;
    const frame = this.world.labLayout?.frame;
    const here = frame ? sectorAtCell(frame, Math.floor(x / cs), Math.floor(y / cs)) : -1;
    for (const w of this.wardens) {
      if (!w.alive) continue;
      if (frame && here >= 0) {
        if (sectorAtCell(frame, Math.floor(w.homeX / cs), Math.floor(w.homeY / cs)) === here) return true;
      } else if (Math.hypot(x - w.homeX, y - w.homeY) <= (WARDEN.leashCells + 4) * cs) {
        return true;
      }
    }
    return false;
  }

  /** A pair of wardens round every gold block still standing. */
  reset(blocks: readonly SpecialBlock[]): void {
    this.wardens = [];
    this.spits = [];
    this.guards.clear();
    this.selected = null;
    for (const b of blocks) {
      if (b.broken) continue;
      const hx = (b.x0 + b.x1) / 2;
      const hy = (b.y0 + b.y1) / 2;
      const tier = Math.max(1, this.world.fillTierAt(b.cx, b.cy));
      const hp = wardenHealth(tier);
      const posts = this.guardPosts(hx, hy);
      for (let k = 0; k < WARDEN.perBlock; k++) {
        const [px, py] = posts[k];
        const a = Math.atan2(py - hy, px - hx);
        this.wardens.push({
          id: nextId++,
          blockId: b.id,
          homeX: hx,
          homeY: hy,
          x: px,
          y: py,
          vx: 0,
          vy: 0,
          postX: px,
          postY: py,
          tier,
          hp,
          maxHp: hp,
          alive: true,
          state: "guard",
          timer: 0,
          lungeCd: 1 + k * 0.7,
          spitCd: 1.5 + k * 1.1,
          biteCd: 0,
          aggro: 0,
          hurt: 0,
          facing: a,
          phase: this.rand() * 10,
          struck: new Set(),
        });
      }
      this.guards.set(b.id, WARDEN.perBlock);
    }
  }

  /**
   * Clear spots for every warden beside a block, spread round it as far
   * apart as the room allows. Gold blocks often sit in a room's corner, so
   * posts are searched on rings from close in to farther out, and each next
   * post is the clear spot farthest (by angle) from those already taken.
   */
  private guardPosts(hx: number, hy: number): [number, number][] {
    const cs = this.world.cellSize;
    const clear: [number, number, number][] = [];
    for (let rc = WARDEN.postMinCells; rc <= WARDEN.postMaxCells + 1e-6; rc += 0.5) {
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2;
        const x = hx + Math.cos(a) * rc * cs, y = hy + Math.sin(a) * rc * cs;
        if (clearOfCells(this.world, x, y, WARDEN.radius + 1)) clear.push([x, y, a]);
      }
    }
    const posts: [number, number, number][] = [];
    if (clear.length === 0) {
      for (let k = 0; k < WARDEN.perBlock; k++) posts.push([hx + (k ? -1 : 1) * WARDEN.postMinCells * cs, hy, 0]);
      return posts.map(([x, y]) => [x, y]);
    }
    // Start from the clear spot facing most into the room (the middle of the clear arc).
    let sx = 0, sy = 0;
    for (const [, , a] of clear) {
      sx += Math.cos(a);
      sy += Math.sin(a);
    }
    const open = Math.atan2(sy, sx);
    const angDist = (a: number, b: number): number => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
    clear.sort((p, q) => angDist(p[2], open) - angDist(q[2], open));
    posts.push(clear[0]);
    while (posts.length < WARDEN.perBlock) {
      let best = clear[0];
      let bestD = -1;
      for (const c of clear) {
        const d = Math.min(...posts.map((p) => angDist(p[2], c[2]) * 4 + Math.hypot(p[0] - c[0], p[1] - c[1]) / cs));
        if (d > bestD) {
          bestD = d;
          best = c;
        }
      }
      posts.push(best);
    }
    return posts.map(([x, y]) => [x, y]);
  }

  /** True while any warden guarding block `id` lives. */
  isGuarded(id: string): boolean {
    return (this.guards.get(id) ?? 0) > 0;
  }

  get aliveCount(): number {
    let n = 0;
    for (const w of this.wardens) if (w.alive) n++;
    return n;
  }

  update(dt: number, soldiers: readonly Soldier[]): void {
    const cs = this.world.cellSize;
    for (const w of this.wardens) {
      if (!w.alive) continue;
      w.phase += dt;
      if (w.hurt > 0) w.hurt = Math.max(0, w.hurt - dt);
      if (w.aggro > 0) w.aggro = Math.max(0, w.aggro - dt);
      w.lungeCd -= dt;
      w.spitCd -= dt;
      w.biteCd -= dt;

      // Nearest soldier in sight (or anyone near, while it's been hurt).
      let target: Soldier | null = null;
      let best = Infinity;
      for (const s of soldiers) {
        if (!s.alive) continue;
        const d = Math.hypot(s.x - w.x, s.y - w.y);
        if (d >= best) continue;
        const near = d <= WARDEN.aggroCells * cs;
        if ((near && hasLineOfSight(this.world, w.x, w.y, s.x, s.y)) || (w.aggro > 0 && d <= WARDEN.aggroCells * cs * 1.6)) {
          best = d;
          target = s;
        }
      }

      if (w.state === "windup") {
        w.timer -= dt;
        if (target) w.facing = Math.atan2(target.y - w.y, target.x - w.x);
        if (w.timer <= 0) {
          w.state = "lunge";
          w.timer = WARDEN.lungeTime;
          w.vx = Math.cos(w.facing) * WARDEN.lungeSpeed;
          w.vy = Math.sin(w.facing) * WARDEN.lungeSpeed;
          w.struck.clear();
          this.events.onLunge?.(w);
        }
        continue;
      }
      if (w.state === "lunge") {
        w.timer -= dt;
        this.move(w, w.vx * dt, w.vy * dt);
        for (const s of soldiers) {
          if (!s.alive || w.struck.has(s)) continue;
          if (Math.hypot(s.x - w.x, s.y - w.y) <= WARDEN.hitRadius + s.radius) {
            w.struck.add(s);
            this.events.onSoldierHit?.(s, wardenDamage(w.tier) * 2, w.x, w.y);
          }
        }
        if (w.timer <= 0) {
          w.state = target ? "chase" : "guard";
          w.lungeCd = WARDEN.lungeCooldown;
          w.vx = 0;
          w.vy = 0;
        }
        continue;
      }

      if (!target) {
        w.state = "guard";
        // Idle: drift in a slow loop round its post, eye on the approach.
        const dr = WARDEN.driftCells * cs;
        const tx = w.postX + Math.cos(w.phase * 0.5) * dr;
        const ty = w.postY + Math.sin(w.phase * 0.8) * dr * 0.6;
        this.seek(w, tx, ty, WARDEN.speed * 0.5, dt);
        w.facing = Math.atan2(w.postY - w.homeY, w.postX - w.homeX) + Math.sin(w.phase * 0.4) * 0.6;
        continue;
      }

      w.state = "chase";
      w.facing = Math.atan2(target.y - w.y, target.x - w.x);
      if (best <= WARDEN.lungeCells * cs && w.lungeCd <= 0) {
        w.state = "windup";
        w.timer = WARDEN.lungeWindup;
        continue;
      }
      // Close in, but stay on the leash round the block.
      let tx = target.x;
      let ty = target.y;
      const lx = tx - w.homeX;
      const ly = ty - w.homeY;
      const ld = Math.hypot(lx, ly);
      const leash = WARDEN.leashCells * cs;
      if (ld > leash) {
        tx = w.homeX + (lx / ld) * leash;
        ty = w.homeY + (ly / ld) * leash;
      }
      if (best > WARDEN.hitRadius + target.radius) this.seek(w, tx, ty, WARDEN.speed, dt);
      else if (w.biteCd <= 0) {
        w.biteCd = WARDEN.biteCooldown;
        this.events.onSoldierHit?.(target, wardenDamage(w.tier), w.x, w.y);
      }
      if (w.spitCd <= 0 && best > WARDEN.lungeCells * cs * 0.8) {
        w.spitCd = WARDEN.spitCooldown;
        const a = w.facing;
        this.spits.push({
          x: w.x + Math.cos(a) * WARDEN.hitRadius,
          y: w.y + Math.sin(a) * WARDEN.hitRadius,
          vx: Math.cos(a) * WARDEN.spitSpeed,
          vy: Math.sin(a) * WARDEN.spitSpeed,
          life: WARDEN.spitLife,
          damage: wardenDamage(w.tier),
        });
        this.events.onSpit?.(w.x, w.y);
      }
    }
    this.separate();
    this.updateSpits(dt, soldiers);
  }

  /** Push overlapping wardens apart so a pair never melts into one blob. */
  private separate(): void {
    const min = WARDEN.radius * 2;
    const list = this.wardens;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (!b.alive || b.blockId !== a.blockId) continue;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        if (d >= min) continue;
        if (d < 1e-3) {
          dx = 1;
          dy = 0;
          d = 1;
        }
        const push = (min - d) / 2;
        this.move(a, (-dx / d) * push, (-dy / d) * push);
        this.move(b, (dx / d) * push, (dy / d) * push);
      }
    }
  }

  private seek(w: Warden, tx: number, ty: number, speed: number, dt: number): void {
    const dx = tx - w.x;
    const dy = ty - w.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.5) return;
    const step = Math.min(d, speed * dt);
    this.move(w, (dx / d) * step, (dy / d) * step);
  }

  private move(w: Warden, mx: number, my: number): void {
    const r = WARDEN.radius;
    if (clearOfCells(this.world, w.x + mx, w.y, r)) w.x += mx;
    if (clearOfCells(this.world, w.x, w.y + my, r)) w.y += my;
  }

  private updateSpits(dt: number, soldiers: readonly Soldier[]): void {
    const cs = this.world.cellSize;
    let write = 0;
    for (const p of this.spits) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      let burst = p.life <= 0 || this.world.solidAt(Math.floor(p.x / cs), Math.floor(p.y / cs));
      if (!burst) {
        for (const s of soldiers) {
          if (s.alive && Math.hypot(s.x - p.x, s.y - p.y) <= s.radius + 1.5) {
            burst = true;
            break;
          }
        }
      }
      if (burst) {
        for (const s of soldiers) {
          if (s.alive && Math.hypot(s.x - p.x, s.y - p.y) <= WARDEN.spitRadius + s.radius) this.events.onSoldierHit?.(s, p.damage, p.x, p.y);
        }
        this.events.onSpitBurst?.(p.x, p.y, WARDEN.spitRadius);
        continue;
      }
      this.spits[write++] = p;
    }
    this.spits.length = write;
  }

  raycast(ox: number, oy: number, dx: number, dy: number, maxDist: number, ignored?: ReadonlySet<object>): number {
    this.selected = null;
    let best = maxDist;
    const r = WARDEN.hitRadius;
    for (const w of this.wardens) {
      if (!w.alive || ignored?.has(w)) continue;
      const fx = ox - w.x;
      const fy = oy - w.y;
      const b = fx * dx + fy * dy;
      const c = fx * fx + fy * fy - r * r;
      const disc = b * b - c;
      if (disc < 0) continue;
      const t = c <= 0 ? 0 : -b - Math.sqrt(disc);
      if (t >= 0 && t <= best) {
        best = t;
        this.selected = w;
      }
    }
    return this.selected ? best : -1;
  }

  applyHit(damage: number, x: number, y: number): boolean {
    const w = this.selected;
    this.selected = null;
    if (!w || !w.alive || damage <= 0) return false;
    this.damage(w, damage, x, y);
    return true;
  }

  explode(x: number, y: number, radius: number, damage: number): void {
    for (const w of this.wardens) {
      if (w.alive && Math.hypot(w.x - x, w.y - y) <= radius + WARDEN.hitRadius) this.damage(w, damage, w.x, w.y);
    }
  }

  /** Squad damage: Blight rules, so it rolls and takes Arsenal Calibration. */
  damage(w: Warden, amount: number, x: number, y: number): void {
    if (!w.alive) return;
    w.hp -= this.world.squadBlightDamage(amount) * this.world.auraDamageMultiplier(w.x, w.y);
    w.hurt = 0.12;
    w.aggro = WARDEN.hurtAggro;
    this.events.onHurt?.(w, x, y);
    if (w.hp <= 0) this.kill(w);
  }

  private kill(w: Warden): void {
    w.alive = false;
    w.hp = 0;
    this.events.onKilled?.(w);
    const left = (this.guards.get(w.blockId) ?? 1) - 1;
    this.guards.set(w.blockId, left);
    if (left <= 0) this.events.onBlockFreed?.(w.blockId, w.homeX, w.homeY);
  }
}
