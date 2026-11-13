import { CREATURES } from "../config";
import type { Rng } from "../core/Rng";
import { circleIsClear, hasLineOfSight } from "../systems/PhysicsSystem";
import type { Colony } from "../world/BlightColonies";
import type { GrowthSystem } from "../world/GrowthSystem";
import type { PixelWorld, SpecimenSpot } from "../world/PixelWorld";
import type { Soldier } from "./Soldier";

/**
 * Biological Blight enemies. All of them follow the Blight's own rules:
 * flowers grow from living colonies and wilt when theirs goes dormant, worms
 * lay pink trails that join (or reconnect) colonies, and specimens wait in
 * their glass tanks until the glass breaks.
 *
 * Presentation is procedural pixel art (see CreatureRenderer): the state here
 * carries just enough (phases, segment chains, charge) to animate from.
 */

export interface Flower {
  kind: "flower";
  id: number;
  /** Half-size subcell the flower is rooted in. */
  anchor: number;
  /** Unit direction the stem grows (toward open air). */
  dx: number;
  dy: number;
  /** World position of the stem's root. */
  x: number;
  y: number;
  hp: number;
  /** 0..1 while sprouting. */
  grow: number;
  /** 0..1 while the petals spread before a shot. */
  charge: number;
  cooldown: number;
  /** True while the flower's colony is dormant. */
  wilted: boolean;
  /** 0..1 how far it has wilted (animates). */
  wilt: number;
  seed: number;
  /** Head position, kept for aiming and hit tests. */
  hx: number;
  hy: number;
}

export interface Worm {
  kind: "worm";
  id: number;
  /** Segment positions, head first: [x0, y0, x1, y1, ...]. */
  seg: Float32Array;
  angle: number;
  hp: number;
  life: number;
  /** Distance crawled since the last trail pixel. */
  trailAcc: number;
  tx: number;
  ty: number;
  retarget: number;
  phase: number;
  /** Seconds left of the burrowing-out animation (0 = crawling). */
  burrow: number;
  biteCd: number;
  hurt: number;
  /** True while heading for dormant Blight (it burrows in on arrival). */
  seeking: boolean;
  /** Last half-size subcell of trail laid (-1 = none), so the trail stays 4-connected. */
  lastTrail: number;
}

export interface Specimen {
  kind: "specimen";
  id: number;
  spot: SpecimenSpot;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: number;
  hp: number;
  maxHp: number;
  free: boolean;
  /** Walk cycle phase (radians); advances with distance moved. */
  gait: number;
  wanderAngle: number;
  wanderTimer: number;
  biteCd: number;
  hurt: number;
  seed: number;
}

export interface Spore {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  spin: number;
}

export type Creature = Flower | Worm | Specimen;

export interface CreatureEvents {
  /** A creature hit a soldier. */
  onSoldierHit?(s: Soldier, damage: number, x: number, y: number): void;
  onSporeLaunch?(x: number, y: number): void;
  onSporeBurst?(x: number, y: number, radius: number): void;
  onCreatureKilled?(c: Creature, x: number, y: number): void;
  onSpecimenFreed?(s: Specimen): void;
}

let nextId = 1;

const DX = [1, -1, 0, 0];
const DY = [0, 0, 1, -1];

export class CreatureSystem {
  flowers: Flower[] = [];
  /** Flower spawn rate and caps multiplier (higher where the Blight has remade the lab). */
  flowerMult = 1;
  worms: Worm[] = [];
  specimens: Specimen[] = [];
  spores: Spore[] = [];
  /** Seconds of run time (for spawn caps). */
  private runTime = 0;
  private spawnTimer = 0;
  /** Index into `seg` arrays for the last bullet raycast hit. */
  private lastHit: Creature | null = null;

  constructor(
    private world: PixelWorld,
    private rng: Rng,
    private events: CreatureEvents = {},
  ) {}

  /** Fresh creatures for a newly generated facility. */
  reset(): void {
    this.flowers = [];
    this.worms = [];
    this.spores = [];
    this.runTime = 0;
    this.spawnTimer = 0;
    const cs = this.world.cellSize;
    this.specimens = this.world.specimenSpots.map((spot) => {
      const maxHp = CREATURES.specimenHealth + CREATURES.specimenHealthPerZone * spot.zone;
      return {
        kind: "specimen" as const,
        id: nextId++,
        spot,
        x: (spot.cx + 0.5) * cs,
        y: (spot.cy + 0.5) * cs,
        vx: 0,
        vy: 0,
        facing: this.rng.range(0, Math.PI * 2),
        hp: maxHp,
        maxHp,
        free: false,
        gait: this.rng.range(0, 6),
        wanderAngle: this.rng.range(0, Math.PI * 2),
        wanderTimer: 0,
        biteCd: 0,
        hurt: 0,
        seed: this.rng.int(1000),
      };
    });
  }

  get count(): number {
    return this.flowers.length + this.worms.length + this.specimens.filter((s) => s.free).length;
  }

  update(dt: number, runTime: number, soldiers: readonly Soldier[], growth: GrowthSystem): void {
    this.runTime = runTime;
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 0.5;
      this.trySpawn(0.5, growth);
    }
    this.updateFlowers(dt, soldiers, growth);
    this.updateSpores(dt, soldiers);
    this.updateWorms(dt, soldiers, growth);
    this.updateSpecimens(dt, soldiers);
  }

  // ---------------------------------------------------------------------------
  // Spawning
  // ---------------------------------------------------------------------------

  private cap(base: number, perMin: number, max: number): number {
    return Math.min(max, base + Math.floor((this.runTime / 60) * perMin));
  }

  private trySpawn(dt: number, growth: GrowthSystem): void {
    if (growth.rate <= 0) return;
    const m = this.flowerMult;
    const flowerCap = Math.round(this.cap(CREATURES.flowerCap * m, CREATURES.flowerCapPerMinute * m, CREATURES.flowerCapMax * m));
    const wormCap =
      this.runTime < CREATURES.wormStartSeconds ? 0 : this.cap(CREATURES.wormCap, CREATURES.wormCapPerMinute, CREATURES.wormCapMax);
    for (const c of growth.colonies.list) {
      if (!c.active || c.edges.length === 0) continue;
      if (this.flowers.length < flowerCap) {
        const p = CREATURES.flowerSpawnPerSec * m * dt * Math.min(1, c.members.length / CREATURES.flowerColonySize);
        if (this.rng.next() < p) this.spawnFlower(c);
      }
      if (this.worms.length < wormCap && this.rng.next() < CREATURES.wormSpawnPerSec * dt) this.spawnWorm(c);
    }
  }

  /** Root a flower in a random edge pixel of `c`, facing the open air beside it. */
  spawnFlower(c: Colony): Flower | null {
    const w = this.world;
    const sw = w.subWidth;
    const ss = w.subCellSize;
    for (let attempt = 0; attempt < 6; attempt++) {
      const si = c.edges[this.rng.int(c.edges.length)];
      if (!w.isPinkSub(si)) continue;
      const sx = si % sw;
      const sy = (si - sx) / sw;
      const d = this.openDir(sx, sy);
      if (d < 0) continue;
      // Needs a little headroom for the stem.
      if (w.subSolidAt(sx + DX[d] * 2, sy + DY[d] * 2)) continue;
      const x = (sx + 0.5 + DX[d] * 0.5) * ss;
      const y = (sy + 0.5 + DY[d] * 0.5) * ss;
      const sp2 = CREATURES.flowerSpacing * CREATURES.flowerSpacing;
      if (this.flowers.some((f) => (f.x - x) ** 2 + (f.y - y) ** 2 < sp2)) continue;
      const f: Flower = {
        kind: "flower",
        id: nextId++,
        anchor: si,
        dx: DX[d],
        dy: DY[d],
        x,
        y,
        hp: CREATURES.flowerHealth,
        grow: 0,
        charge: 0,
        cooldown: CREATURES.flowerCooldown * this.rng.range(0.6, 1.2),
        wilted: false,
        wilt: 0,
        seed: this.rng.int(1000),
        hx: x,
        hy: y,
      };
      this.flowers.push(f);
      return f;
    }
    return null;
  }

  /** Crawl a worm out of a random edge of living colony `c`. */
  spawnWorm(c: Colony): Worm | null {
    const w = this.world;
    const sw = w.subWidth;
    const ss = w.subCellSize;
    for (let attempt = 0; attempt < 6; attempt++) {
      const si = c.edges[this.rng.int(c.edges.length)];
      const sx = si % sw;
      const sy = (si - sx) / sw;
      const d = this.openDir(sx, sy);
      if (d < 0) continue;
      const x = (sx + 0.5 + DX[d] * 1.5) * ss;
      const y = (sy + 0.5 + DY[d] * 1.5) * ss;
      if (!circleIsClear(w, x, y, 1.5)) continue;
      const n = CREATURES.wormSegments;
      const seg = new Float32Array(n * 2);
      // Curled up at the hole, so it uncoils as it crawls out.
      for (let i = 0; i < n; i++) {
        seg[i * 2] = x - DX[d] * Math.min(i, 2) * 0.5;
        seg[i * 2 + 1] = y - DY[d] * Math.min(i, 2) * 0.5;
      }
      const worm: Worm = {
        kind: "worm",
        id: nextId++,
        seg,
        angle: Math.atan2(DY[d], DX[d]),
        hp: CREATURES.wormHealth,
        life: CREATURES.wormLife,
        trailAcc: 0,
        tx: x,
        ty: y,
        retarget: 0,
        phase: this.rng.range(0, 6),
        burrow: 0,
        biteCd: 0,
        hurt: 0,
        seeking: false,
        // The trail starts from the pixel it crawled out of, so it stays attached.
        lastTrail: si,
      };
      this.worms.push(worm);
      return worm;
    }
    return null;
  }

  /** A random open-air direction (index into DX/DY) beside subcell (sx, sy), or -1. */
  private openDir(sx: number, sy: number): number {
    const start = this.rng.int(4);
    for (let k = 0; k < 4; k++) {
      const d = (start + k) & 3;
      if (!this.world.subSolidAt(sx + DX[d], sy + DY[d])) return d;
    }
    return -1;
  }

  // ---------------------------------------------------------------------------
  // Flowers & spores
  // ---------------------------------------------------------------------------

  private updateFlowers(dt: number, soldiers: readonly Soldier[], growth: GrowthSystem): void {
    const w = this.world;
    for (let i = this.flowers.length - 1; i >= 0; i--) {
      const f = this.flowers[i];
      // Rooted in Blight: when its pixel goes, so does the flower.
      if (!w.isPinkSub(f.anchor)) {
        this.kill(f, f.hx, f.hy);
        continue;
      }
      f.grow = Math.min(1, f.grow + dt / 1.4);
      f.wilted = growth.colonies.isDormantSub(f.anchor);
      f.wilt += ((f.wilted ? 1 : 0) - f.wilt) * Math.min(1, dt * 2);
      const stemLen = 2 + f.grow * 8;
      f.hx = f.x + f.dx * stemLen;
      f.hy = f.y + f.dy * stemLen;
      if (f.wilted || f.grow < 1) {
        f.charge = Math.max(0, f.charge - dt * 2);
        continue;
      }
      f.cooldown -= dt;
      const target = this.nearestVisible(f.hx, f.hy, CREATURES.flowerRange, soldiers);
      if (f.cooldown <= 0 && target) {
        f.charge = Math.min(1, f.charge + dt / CREATURES.flowerWindup);
        if (f.charge >= 1) {
          this.launchSpore(f, target);
          f.charge = 0;
          f.cooldown = CREATURES.flowerCooldown * this.rng.range(0.8, 1.25);
        }
      } else {
        f.charge = Math.max(0, f.charge - dt);
      }
    }
  }

  private launchSpore(f: Flower, target: Soldier): void {
    // Lead the target a little.
    const lead = Math.hypot(target.x - f.hx, target.y - f.hy) / CREATURES.sporeSpeed;
    const ax = target.x + target.vx * lead * 0.6 - f.hx;
    const ay = target.y + target.vy * lead * 0.6 - f.hy;
    const d = Math.hypot(ax, ay) || 1;
    this.spores.push({
      x: f.hx,
      y: f.hy,
      vx: (ax / d) * CREATURES.sporeSpeed,
      vy: (ay / d) * CREATURES.sporeSpeed,
      life: CREATURES.sporeLife,
      spin: this.rng.range(0, 6),
    });
    this.events.onSporeLaunch?.(f.hx, f.hy);
  }

  private updateSpores(dt: number, soldiers: readonly Soldier[]): void {
    const w = this.world;
    const ss = w.subCellSize;
    for (let i = this.spores.length - 1; i >= 0; i--) {
      const s = this.spores[i];
      s.life -= dt;
      s.spin += dt * 9;
      // Sub-steps so a fast spore can't tunnel through a half-size wall.
      const steps = Math.max(1, Math.ceil((Math.hypot(s.vx, s.vy) * dt) / 2));
      let burst = s.life <= 0;
      for (let k = 0; k < steps && !burst; k++) {
        s.x += (s.vx * dt) / steps;
        s.y += (s.vy * dt) / steps;
        if (w.subSolidAt(Math.floor(s.x / ss), Math.floor(s.y / ss))) burst = true;
        for (const sol of soldiers) {
          if (sol.alive && Math.hypot(sol.x - s.x, sol.y - s.y) < sol.radius + 1.5) burst = true;
        }
      }
      if (!burst) continue;
      this.spores.splice(i, 1);
      const r = CREATURES.sporeRadius;
      for (const sol of soldiers) {
        if (sol.alive && Math.hypot(sol.x - s.x, sol.y - s.y) < r + sol.radius) {
          this.events.onSoldierHit?.(sol, CREATURES.sporeDamage, s.x, s.y);
        }
      }
      this.events.onSporeBurst?.(s.x, s.y, r);
    }
  }

  // ---------------------------------------------------------------------------
  // Worms
  // ---------------------------------------------------------------------------

  private updateWorms(dt: number, soldiers: readonly Soldier[], growth: GrowthSystem): void {
    const w = this.world;
    const ss = w.subCellSize;
    const n = CREATURES.wormSegments;
    const spacing = CREATURES.wormSpacing;
    for (let i = this.worms.length - 1; i >= 0; i--) {
      const worm = this.worms[i];
      const seg = worm.seg;
      worm.hurt = Math.max(0, worm.hurt - dt);
      worm.biteCd -= dt;
      if (worm.burrow > 0) {
        // Sinking into the Blight it reached: segments pull into the head.
        worm.burrow -= dt;
        for (let k = n - 1; k > 0; k--) {
          seg[k * 2] += (seg[(k - 1) * 2] - seg[k * 2]) * Math.min(1, dt * 6);
          seg[k * 2 + 1] += (seg[(k - 1) * 2 + 1] - seg[k * 2 + 1]) * Math.min(1, dt * 6);
        }
        if (worm.burrow <= 0) this.worms.splice(i, 1);
        continue;
      }
      worm.life -= dt;
      if (worm.life <= 0) {
        worm.burrow = 0.6;
        continue;
      }
      worm.retarget -= dt;
      if (worm.retarget <= 0) {
        worm.retarget = 1.5;
        this.pickWormTarget(worm, soldiers, growth);
      }
      // Steer toward the target with a lazy sinuous wiggle.
      worm.phase += dt * 7;
      const hx = seg[0];
      const hy = seg[1];
      const want = Math.atan2(worm.ty - hy, worm.tx - hx) + Math.sin(worm.phase * 0.45) * 0.5;
      let da = want - worm.angle;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      worm.angle += Math.max(-1, Math.min(1, da)) * CREATURES.wormTurnRate * dt;
      const step = CREATURES.wormSpeed * dt;
      // Feel ahead; swing round obstacles.
      let moved = false;
      for (const off of [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6, 2.4, -2.4, Math.PI]) {
        const a = worm.angle + off;
        const nx = hx + Math.cos(a) * step;
        const ny = hy + Math.sin(a) * step;
        const lx = hx + Math.cos(a) * 2.5;
        const ly = hy + Math.sin(a) * 2.5;
        if (w.subSolidAt(Math.floor(nx / ss), Math.floor(ny / ss)) || w.subSolidAt(Math.floor(lx / ss), Math.floor(ly / ss))) continue;
        seg[0] = nx;
        seg[1] = ny;
        worm.angle = a;
        moved = true;
        break;
      }
      if (!moved) continue;
      // Each segment follows the one in front at a fixed spacing.
      for (let k = 1; k < n; k++) {
        const px = seg[(k - 1) * 2];
        const py = seg[(k - 1) * 2 + 1];
        const ddx = seg[k * 2] - px;
        const ddy = seg[k * 2 + 1] - py;
        const d = Math.hypot(ddx, ddy);
        if (d > spacing) {
          seg[k * 2] = px + (ddx / d) * spacing;
          seg[k * 2 + 1] = py + (ddy / d) * spacing;
        }
      }
      // Trail: Blight left behind the tail joins whatever colony it touches.
      worm.trailAcc += step;
      if (worm.trailAcc >= CREATURES.wormTrailStep) {
        worm.trailAcc = 0;
        this.layTrail(worm, seg[(n - 1) * 2], seg[(n - 1) * 2 + 1], soldiers);
      }
      // Reached dormant Blight: plug the gap and burrow in.
      if (worm.seeking && Math.hypot(worm.tx - seg[0], worm.ty - seg[1]) < 5) {
        // Close the gap from the tail's trail up to where the head is.
        for (let k = n - 1; k >= 0; k--) this.layTrail(worm, seg[k * 2], seg[k * 2 + 1], soldiers);
        worm.burrow = 0.6;
      }
      // Bite anything it crawls over.
      if (worm.biteCd <= 0) {
        for (const s of soldiers) {
          if (!s.alive) continue;
          if (Math.hypot(s.x - seg[0], s.y - seg[1]) < s.radius + 2.5) {
            this.events.onSoldierHit?.(s, CREATURES.biteDamage, seg[0], seg[1]);
            worm.biteCd = CREATURES.biteCooldown;
            break;
          }
        }
      }
    }
  }

  /**
   * Head for the nearest dormant Blight in range (to wake it up again); with
   * none about, follow the squad and spread new pathways toward it.
   */
  private pickWormTarget(worm: Worm, soldiers: readonly Soldier[], growth: GrowthSystem): void {
    const w = this.world;
    const sw = w.subWidth;
    const ss = w.subCellSize;
    const hx = worm.seg[0];
    const hy = worm.seg[1];
    let best = CREATURES.wormSeekRange * CREATURES.wormSeekRange;
    let found = false;
    // Its own fresh trail can be cut off for a moment; never chase that.
    const tx0 = worm.seg[worm.seg.length - 2];
    const ty0 = worm.seg[worm.seg.length - 1];
    const near = (x: number, y: number): boolean => {
      for (let k = 0; k < worm.seg.length; k += 2) if ((worm.seg[k] - x) ** 2 + (worm.seg[k + 1] - y) ** 2 < 144) return true;
      return (x - tx0) ** 2 + (y - ty0) ** 2 < 400;
    };
    for (const c of growth.colonies.list) {
      if (c.active || c.edges.length === 0) continue;
      for (let k = 0; k < 6; k++) {
        const si = c.edges[this.rng.int(c.edges.length)];
        const sx = si % sw;
        const x = (sx + 0.5) * ss;
        const y = ((si - sx) / sw + 0.5) * ss;
        const d2 = (x - hx) ** 2 + (y - hy) ** 2;
        if (d2 < best && !near(x, y)) {
          best = d2;
          worm.tx = x;
          worm.ty = y;
          found = true;
        }
      }
    }
    worm.seeking = found;
    if (found) return;
    const s = this.nearestVisible(hx, hy, 400, soldiers, false);
    if (s) {
      worm.tx = s.x;
      worm.ty = s.y;
    } else {
      worm.tx = hx + Math.cos(worm.angle) * 40 + this.rng.range(-20, 20);
      worm.ty = hy + Math.sin(worm.angle) * 40 + this.rng.range(-20, 20);
    }
  }

  /**
   * Lay trail Blight at (x, y), plus whatever half-size cells it takes to
   * reach the last trail pixel by orthogonal steps, so the trail is one
   * connected strand that can carry a colony's connection along it.
   */
  private layTrail(worm: Worm, x: number, y: number, soldiers: readonly Soldier[]): void {
    const w = this.world;
    const ss = w.subCellSize;
    const sw = w.subWidth;
    const tx = Math.floor(x / ss);
    const ty = Math.floor(y / ss);
    if (worm.lastTrail < 0) {
      this.putTrail(tx, ty, soldiers);
      worm.lastTrail = ty * sw + tx;
      return;
    }
    let cx = worm.lastTrail % sw;
    let cy = (worm.lastTrail - cx) / sw;
    for (let guard = 0; guard < 16 && (cx !== tx || cy !== ty); guard++) {
      if (Math.abs(tx - cx) >= Math.abs(ty - cy)) cx += Math.sign(tx - cx);
      else cy += Math.sign(ty - cy);
      this.putTrail(cx, cy, soldiers);
    }
    worm.lastTrail = cy * sw + cx;
  }

  private putTrail(sx: number, sy: number, soldiers: readonly Soldier[]): void {
    const w = this.world;
    const ss = w.subCellSize;
    if (w.subSolidAt(sx, sy)) return;
    // Never seal a soldier in.
    for (const s of soldiers) {
      if (s.alive && Math.hypot(s.x - (sx + 0.5) * ss, s.y - (sy + 0.5) * ss) < s.radius + ss) return;
    }
    w.subTint[sy * w.subWidth + sx] = this.rng.int(256);
    w.setSubCell(sx, sy, w.maxSubHealthAt(sx, sy), "grown");
  }

  // ---------------------------------------------------------------------------
  // Specimens
  // ---------------------------------------------------------------------------

  private updateSpecimens(dt: number, soldiers: readonly Soldier[]): void {
    const w = this.world;
    const r = CREATURES.specimenRadius;
    for (let i = this.specimens.length - 1; i >= 0; i--) {
      const s = this.specimens[i];
      s.hurt = Math.max(0, s.hurt - dt);
      if (!s.free) {
        s.gait += dt * 1.5;
        if (this.tankBroken(s.spot)) {
          s.free = true;
          this.events.onSpecimenFreed?.(s);
        }
        continue;
      }
      s.biteCd -= dt;
      const target = this.nearestVisible(s.x, s.y, CREATURES.specimenSightCells * w.cellSize, soldiers);
      let ax: number;
      let ay: number;
      let speed = CREATURES.specimenSpeed;
      if (target) {
        ax = target.x - s.x;
        ay = target.y - s.y;
      } else {
        s.wanderTimer -= dt;
        if (s.wanderTimer <= 0) {
          s.wanderTimer = this.rng.range(1, 2.5);
          s.wanderAngle += this.rng.range(-1.5, 1.5);
        }
        ax = Math.cos(s.wanderAngle);
        ay = Math.sin(s.wanderAngle);
        speed *= 0.45;
      }
      const d = Math.hypot(ax, ay) || 1;
      // Skittering: speed pulses with the gait.
      const pulse = 0.65 + 0.35 * Math.abs(Math.sin(s.gait));
      s.vx = (ax / d) * speed * pulse;
      s.vy = (ay / d) * speed * pulse;
      const nx = s.x + s.vx * dt;
      const ny = s.y + s.vy * dt;
      let moved = 0;
      if (circleIsClear(w, nx, ny, r)) {
        moved = Math.hypot(nx - s.x, ny - s.y);
        s.x = nx;
        s.y = ny;
      } else if (circleIsClear(w, nx, s.y, r)) {
        moved = Math.abs(nx - s.x);
        s.x = nx;
      } else if (circleIsClear(w, s.x, ny, r)) {
        moved = Math.abs(ny - s.y);
        s.y = ny;
      } else {
        s.wanderAngle += Math.PI * this.rng.range(0.5, 1.5);
        s.wanderTimer = 0.8;
      }
      if (moved > 0) s.facing = Math.atan2(s.vy, s.vx);
      s.gait += moved * 0.9;
      if (target && s.biteCd <= 0 && Math.hypot(target.x - s.x, target.y - s.y) < target.radius + r + 1) {
        this.events.onSoldierHit?.(target, CREATURES.biteDamage, s.x, s.y);
        s.biteCd = CREATURES.biteCooldown;
      }
    }
  }

  /** A tank is broken once any cell around its hollow center is open. */
  private tankBroken(spot: SpecimenSpot): boolean {
    const w = this.world;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        if (!w.inBounds(spot.cx + dx, spot.cy + dy)) continue;
        if (w.health[(spot.cy + dy) * w.width + spot.cx + dx] === 0) return true;
      }
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Targeting, damage, bullets
  // ---------------------------------------------------------------------------

  private nearestVisible(x: number, y: number, range: number, soldiers: readonly Soldier[], needSight = true): Soldier | null {
    let best: Soldier | null = null;
    let bd = range;
    for (const s of soldiers) {
      if (!s.alive) continue;
      const d = Math.hypot(s.x - x, s.y - y);
      if (d >= bd) continue;
      if (needSight && !hasLineOfSight(this.world, x, y, s.x, s.y)) continue;
      bd = d;
      best = s;
    }
    return best;
  }

  /**
   * Nearest creature along a bullet's path within `maxDist`, or -1. Remembers
   * the creature so `applyHit` can damage it.
   */
  get targetKey(): object | null { return this.lastHit; }
  raycast(ox: number, oy: number, dx: number, dy: number, maxDist: number, ignored?: ReadonlySet<object>): number {
    let best = maxDist;
    let hitC: Creature | null = null;
    const test = (c: Creature, cx: number, cy: number, r: number): void => {
      if(ignored?.has(c))return;
      const fx = ox - cx;
      const fy = oy - cy;
      const b = fx * dx + fy * dy;
      const cc = fx * fx + fy * fy - r * r;
      const disc = b * b - cc;
      if (disc < 0) return;
      const t = cc <= 0 ? 0 : -b - Math.sqrt(disc);
      if (t >= 0 && t < best) {
        best = t;
        hitC = c;
      }
    };
    for (const f of this.flowers) test(f, f.hx, f.hy, 3);
    for (const w of this.worms) {
      if (w.burrow > 0) continue;
      for (let k = 0; k < CREATURES.wormSegments; k += 2) test(w, w.seg[k * 2], w.seg[k * 2 + 1], 2.4);
    }
    for (const s of this.specimens) if (s.free) test(s, s.x, s.y, CREATURES.specimenRadius + 0.5);
    this.lastHit = hitC;
    return hitC ? best : -1;
  }

  /** Damage the creature the last `raycast` found. Returns true if it died. */
  applyHit(damage: number, x: number, y: number): boolean {
    const c = this.lastHit;
    this.lastHit = null;
    if (!c) return false;
    c.hp -= damage;
    if (c.kind !== "flower") c.hurt = 0.12;
    if (c.hp > 0) return false;
    this.kill(c, x, y);
    return true;
  }

  /** Damage every creature inside an explosion. */
  explode(x: number, y: number, radius: number, damage: number): void {
    const inside = (cx: number, cy: number): boolean => (cx - x) ** 2 + (cy - y) ** 2 <= radius * radius;
    for (const f of [...this.flowers]) if (inside(f.hx, f.hy) && (f.hp -= damage) <= 0) this.kill(f, f.hx, f.hy);
    for (const w of [...this.worms]) if (inside(w.seg[0], w.seg[1]) && (w.hp -= damage) <= 0) this.kill(w, w.seg[0], w.seg[1]);
    for (const s of [...this.specimens]) if (s.free && inside(s.x, s.y) && (s.hp -= damage) <= 0) this.kill(s, s.x, s.y);
  }

  private kill(c: Creature, x: number, y: number): void {
    if (c.kind === "flower") this.flowers.splice(this.flowers.indexOf(c), 1);
    else if (c.kind === "worm") this.worms.splice(this.worms.indexOf(c), 1);
    else this.specimens.splice(this.specimens.indexOf(c), 1);
    this.events.onCreatureKilled?.(c, x, y);
  }
}
