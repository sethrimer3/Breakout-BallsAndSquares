import { BULLET, CAMERA, COLORS, SIM, SOLDIER, TERRAIN, WORLD } from "./config";
import { Rng } from "./core/Rng";
import { PKind, ParticleSystem } from "./entities/ParticleSystem";
import { Soldier, baseSoldierStats, type SoldierStats } from "./entities/Soldier";
import { Renderer } from "./rendering/Renderer";
import { TerrainRenderer } from "./rendering/TerrainRenderer";
import { CameraSystem } from "./systems/CameraSystem";
import { CombatSystem } from "./systems/CombatSystem";
import { Input } from "./systems/Input";
import { PhysicsSystem, findSpawnPoint } from "./systems/PhysicsSystem";
import { RunStats } from "./systems/RunStats";
import { HUD } from "./ui/HUD";
import { PixelWorld } from "./world/PixelWorld";
import { generateWorld } from "./world/WorldGenerator";

/** Short-lived muzzle flash (visual; becomes a shadow-casting light in Phase 4). */
export interface Flash {
  x: number;
  y: number;
  dx: number;
  dy: number;
  life: number;
  maxLife: number;
  ownerId: number;
}

/** Brief highlight on a terrain cell (hit or destroy). */
export interface CellFlash {
  cx: number;
  cy: number;
  life: number;
  maxLife: number;
  destroyed: boolean;
}

export class Game {
  readonly canvas: HTMLCanvasElement;
  readonly world: PixelWorld;
  readonly rng = new Rng();
  readonly physics: PhysicsSystem;
  readonly combat: CombatSystem;
  readonly camera: CameraSystem;
  readonly terrain: TerrainRenderer;
  readonly renderer: Renderer;
  readonly particles = new ParticleSystem(3000);
  readonly runStats = new RunStats();
  readonly hud: HUD;
  readonly input: Input;

  stats: SoldierStats = baseSoldierStats();
  soldiers: Soldier[] = [];
  flashes: Flash[] = [];
  cellFlashes: CellFlash[] = [];
  reserves = 0;
  canDeploy = true;
  growthRate = 0;
  paused = false;
  debug = new URLSearchParams(location.search).has("debug") || import.meta.env.DEV;
  debugInfo = { fps: 0, frameMs: 0, simMs: 0 };

  private acc = 0;
  private last = 0;
  private fpsAcc = 0;
  private fpsFrames = 0;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.canvas = canvas;
    this.world = new PixelWorld(WORLD);
    if (2 * SOLDIER.collisionRadius >= WORLD.cellSize) {
      console.warn("Soldier collision diameter >= cell size: soldiers cannot fit 1-cell tunnels.");
    }
    this.physics = new PhysicsSystem(this.world, this.rng);
    this.combat = new CombatSystem(this.world, this.rng, this.stats, {
      onShot: (s, dx, dy, mx, my) => this.onShot(s, dx, dy, mx, my),
      onImpact: (x, y, nx, ny, cx, cy, result) => this.onImpact(x, y, nx, ny, cx, cy, result),
    });
    this.camera = new CameraSystem(this.world);
    generateWorld(this.world, WORLD.seed || this.rng.int(1 << 30));
    this.terrain = new TerrainRenderer(this.world, WORLD.chunkSize);
    this.terrain.rebuildAll();
    this.renderer = new Renderer(canvas, this);
    this.hud = new HUD(uiRoot);
    this.input = new Input(canvas, {
      onPrimaryClick: (sx, sy) => this.tryLaunch(sx, sy),
      onWheel: (sx, sy, dy) =>
        this.camera.zoomAt(sx, sy, dy < 0 ? CAMERA.wheelStep : 1 / CAMERA.wheelStep),
      onPan: (dx, dy) => this.camera.panBy(dx, dy),
      onKey: (code) => this.onKey(code),
    });
    window.addEventListener("resize", () => this.resize());
    this.resize();
    this.startRun();
  }

  resize(): void {
    this.renderer.resize();
    this.camera.setViewport(this.canvas.clientWidth, this.canvas.clientHeight);
  }

  /** Begin a fresh run (regenerates the world in place). */
  startRun(): void {
    if (this.runStats.time > 0) {
      generateWorld(this.world, WORLD.seed || this.rng.int(1 << 30));
      this.terrain.rebuildAll();
    }
    this.combat.stats = this.stats;
    this.soldiers = [];
    this.flashes = [];
    this.cellFlashes = [];
    this.combat.bullets.clear();
    this.particles.clear();
    this.runStats.reset();
    this.reserves = this.stats.maxSoldiers;
    this.canDeploy = true;
    this.growthRate = 0;
    this.paused = false;
    this.camera.reset();
    this.camera.setViewport(this.canvas.clientWidth, this.canvas.clientHeight);
  }

  private onKey(code: string): void {
    switch (code) {
      case "KeyF":
        this.camera.resumeAuto();
        break;
      case "Tab":
        this.camera.cycleTarget(this.soldiers);
        break;
      case "Space":
      case "Escape":
        this.paused = !this.paused;
        break;
      case "KeyR":
        this.startRun();
        break;
      case "Backquote":
        this.debug = !this.debug;
        break;
    }
    this.hud.update(this, performance.now(), true);
  }

  /** Launch a reserve soldier from the spawn point toward a screen position. */
  tryLaunch(sx: number, sy: number): void {
    if (this.paused || this.reserves <= 0) return;
    const spawn = findSpawnPoint(this.world, SOLDIER.collisionRadius);
    if (!spawn) {
      this.canDeploy = false;
      return;
    }
    const wx = this.camera.screenToWorldX(sx);
    const wy = this.camera.screenToWorldY(sy);
    let dx = wx - spawn.x;
    let dy = wy - spawn.y;
    if (Math.hypot(dx, dy) < 1e-3) {
      dx = 1;
      dy = 0.3;
    }
    const s = new Soldier(spawn.x, spawn.y, dx, dy, this.stats.speed);
    this.soldiers.push(s);
    this.reserves--;
    this.runStats.soldiersDeployed++;
    // Launch puff.
    for (let i = 0; i < 14; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const sp = this.rng.range(20, 70);
      this.particles.spawn(PKind.Spark, spawn.x, spawn.y, Math.cos(a) * sp, Math.sin(a) * sp, 0.35, 1, 0x9ff3ff, 5);
    }
  }

  /** Current aim origin for rendering the aim line (null if cannot deploy). */
  aimOrigin(): { x: number; y: number } | null {
    if (this.reserves <= 0 || this.paused) return null;
    return findSpawnPoint(this.world, SOLDIER.collisionRadius);
  }

  private onShot(s: Soldier, dx: number, dy: number, mx: number, my: number): void {
    this.runStats.shotsFired++;
    this.flashes.push({ x: mx, y: my, dx, dy, life: 0.08, maxLife: 0.08, ownerId: s.id });
    for (let i = 0; i < 4; i++) {
      const a = Math.atan2(dy, dx) + this.rng.range(-0.5, 0.5);
      const sp = this.rng.range(60, 160);
      this.particles.spawn(PKind.Spark, mx, my, Math.cos(a) * sp, Math.sin(a) * sp, this.rng.range(0.06, 0.14), 1, 0xffd890, 10);
    }
  }

  private onImpact(
    x: number,
    y: number,
    nx: number,
    ny: number,
    cx: number,
    cy: number,
    result: 0 | 1 | 2,
  ): void {
    const destroyed = result === 2;
    const n = destroyed ? 10 : 4;
    for (let i = 0; i < n; i++) {
      const a = Math.atan2(ny, nx) + this.rng.range(-1.1, 1.1);
      const sp = this.rng.range(40, destroyed ? 150 : 110);
      this.particles.spawn(PKind.Spark, x, y, Math.cos(a) * sp, Math.sin(a) * sp, this.rng.range(0.08, 0.2), 1, 0xffc070, 8);
    }
    if (result > 0) {
      this.cellFlashes.push({ cx, cy, life: TERRAIN.hitFlashTime * (destroyed ? 2 : 1), maxLife: TERRAIN.hitFlashTime * (destroyed ? 2 : 1), destroyed });
    }
    if (destroyed) {
      const cs = this.world.cellSize;
      const ccx = (cx + 0.5) * cs;
      const ccy = (cy + 0.5) * cs;
      for (let i = 0; i < 6; i++) {
        const a = Math.atan2(ny, nx) + this.rng.range(-1.3, 1.3);
        const sp = this.rng.range(20, 80);
        const col = this.world.tint[cy * this.world.width + cx] > 128 ? 0x5a4a78 : 0x4a5674;
        this.particles.spawn(PKind.Debris, ccx + this.rng.range(-3, 3), ccy + this.rng.range(-3, 3), Math.cos(a) * sp, Math.sin(a) * sp, this.rng.range(0.4, 0.8), this.rng.range(1, 2), col, 4);
      }
      this.runStats.pixelsDestroyed++;
      this.runStats.currency++;
      const depth = this.world.depthOf(cx, cy);
      if (depth > this.runStats.maxDepth) this.runStats.maxDepth = depth;
    }
  }

  /** One fixed simulation step. */
  step(dt: number): void {
    this.runStats.time += dt;
    for (const s of this.soldiers) {
      if (!s.alive) continue;
      s.age += dt;
      this.physics.step(s, dt);
      this.combat.updateSoldier(s, dt);
    }
    this.combat.updateBullets(dt);
    this.particles.update(dt);
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      if ((this.flashes[i].life -= dt) <= 0) this.flashes.splice(i, 1);
    }
    for (let i = this.cellFlashes.length - 1; i >= 0; i--) {
      if ((this.cellFlashes[i].life -= dt) <= 0) this.cellFlashes.splice(i, 1);
    }
    if (this.cellFlashes.length > 512) this.cellFlashes.splice(0, this.cellFlashes.length - 512);
    this.canDeploy = findSpawnPoint(this.world, SOLDIER.collisionRadius) !== null;
  }

  frame = (now: number): void => {
    const real = this.last ? Math.min(0.1, (now - this.last) / 1000) : SIM.dt;
    this.last = now;
    const t0 = performance.now();
    if (!this.paused) {
      this.acc += real;
      let steps = 0;
      while (this.acc >= SIM.dt && steps < SIM.maxStepsPerFrame) {
        this.step(SIM.dt);
        this.acc -= SIM.dt;
        steps++;
      }
      if (steps >= SIM.maxStepsPerFrame) this.acc = 0;
      this.camera.update(real, this.soldiers);
    }
    const t1 = performance.now();
    this.terrain.update();
    this.renderer.draw();
    this.hud.update(this, now);
    const t2 = performance.now();

    this.fpsAcc += real;
    this.fpsFrames++;
    if (this.fpsAcc >= 0.5) {
      this.debugInfo.fps = this.fpsFrames / this.fpsAcc;
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
    this.debugInfo.simMs = t1 - t0;
    this.debugInfo.frameMs = t2 - t0;
    requestAnimationFrame(this.frame);
  };

  start(): void {
    requestAnimationFrame(this.frame);
  }
}

// Re-export for convenience in renderers.
export { BULLET, COLORS };
