import { BULLET, CAMERA, COLORS, GROWTH, LIGHT, SIM, SOLDIER, TERRAIN, WORLD, zoneForDepth } from "./config";
import { AudioSystem } from "./audio/AudioSystem";
import { Rng } from "./core/Rng";
import { CasingSystem } from "./entities/CasingSystem";
import { LootKind, LootSystem } from "./entities/LootSystem";
import { PKind, ParticleSystem } from "./entities/ParticleSystem";
import { Soldier, baseSoldierStats, type SoldierStats } from "./entities/Soldier";
import { MUZZLE_FLASH_MULTIPLIER, SaveManager } from "./progression/SaveManager";
import { UpgradeManager } from "./progression/UpgradeManager";
import { Renderer } from "./rendering/Renderer";
import { TerrainRenderer } from "./rendering/TerrainRenderer";
import { CameraSystem } from "./systems/CameraSystem";
import { CombatSystem } from "./systems/CombatSystem";
import { Input } from "./systems/Input";
import { LightingSystem, makeLitCells, type LitCells, type MuzzleLight } from "./systems/LightingSystem";
import { PhysicsSystem, findSpawnPoint } from "./systems/PhysicsSystem";
import { RunStats } from "./systems/RunStats";
import { HUD } from "./ui/HUD";
import { DebugOverlay } from "./ui/DebugOverlay";
import { MainMenu } from "./ui/MainMenu";
import { PauseMenu } from "./ui/PauseMenu";
import { ResultsScreen } from "./ui/ResultsScreen";
import { UpgradeTree } from "./ui/UpgradeTree";
import { GrowthSystem } from "./world/GrowthSystem";
import { PixelWorld } from "./world/PixelWorld";
import { generateWorld } from "./world/WorldGenerator";

export type Flash = MuzzleLight;

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
  readonly growth: GrowthSystem;
  readonly lighting: LightingSystem;
  readonly camera: CameraSystem;
  readonly terrain: TerrainRenderer;
  readonly renderer: Renderer;
  readonly particles = new ParticleSystem(3000);
  readonly casings = new CasingSystem();
  readonly loot = new LootSystem();
  readonly runStats = new RunStats();
  readonly save: SaveManager;
  readonly upgrades: UpgradeManager;
  readonly audio: AudioSystem;
  readonly hud: HUD;
  readonly debugOverlay: DebugOverlay;
  readonly mainMenu: MainMenu;
  readonly pauseMenu: PauseMenu;
  readonly resultsScreen: ResultsScreen;
  readonly upgradeTree: UpgradeTree;
  readonly input: Input;

  stats: SoldierStats = baseSoldierStats();
  soldiers: Soldier[] = [];
  flashes: Flash[] = [];
  cellFlashes: CellFlash[] = [];
  reserves = 0;
  canDeploy = true;
  growthRate = 0;
  paused = false;
  runOver = false;
  private bankedThisRun = false;
  onUpgradePurchased?: () => void;
  timeScale = 1;
  showChunkBorders = false;
  debug = new URLSearchParams(location.search).has("debug") || import.meta.env.DEV;
  debugInfo = { fps: 0, frameMs: 0, simMs: 0, lightMs: 0 };
  private flashPolyPool: Float32Array[] = [];
  private flashLitPool: LitCells[] = [];
  private lightOverBudgetFrames = 0;

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
    this.save = new SaveManager();
    this.upgrades = new UpgradeManager(this.save);
    this.audio = new AudioSystem(this.save);
    this.stats = this.upgrades.getSoldierStats();
    this.onUpgradePurchased = () => this.audio.playPurchase();

    this.physics = new PhysicsSystem(this.world, this.rng);
    this.combat = new CombatSystem(this.world, this.rng, this.stats, {
      onShot: (s, dx, dy, mx, my) => this.onShot(s, dx, dy, mx, my),
      onImpact: (x, y, nx, ny, cx, cy, result) => this.onImpact(x, y, nx, ny, cx, cy, result),
    });
    this.growth = new GrowthSystem(this.world, this.rng, {
      onSoldierKilled: (s) => this.onSoldierKilled(s),
    });
    this.lighting = new LightingSystem(this.world);
    this.camera = new CameraSystem(this.world);
    this.camera.defaultFollow = this.save.data.settings.autoFollowCamera;
    this.camera.following = this.camera.defaultFollow;
    generateWorld(this.world, WORLD.seed || this.rng.int(1 << 30));
    this.terrain = new TerrainRenderer(this.world, WORLD.chunkSize);
    this.terrain.rebuildAll();
    this.renderer = new Renderer(canvas, this);
    this.hud = new HUD(uiRoot, this);
    this.debugOverlay = new DebugOverlay(uiRoot, this);
    this.mainMenu = new MainMenu(uiRoot, this);
    this.pauseMenu = new PauseMenu(uiRoot, this);
    this.resultsScreen = new ResultsScreen(uiRoot, this);
    this.upgradeTree = new UpgradeTree(uiRoot, this);
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

  get bank(): number {
    return this.save.data.bank;
  }

  get crystals(): number {
    return this.save.data.crystals;
  }

  get muzzleFlashMultiplier(): number {
    return MUZZLE_FLASH_MULTIPLIER[this.save.data.settings.muzzleFlash] ?? 1;
  }

  get lifetimePixels(): number {
    return this.save.data.lifetimePixels;
  }

  get bests(): { time: number; depth: number; pixels: number } {
    return this.save.data.bests;
  }

  applyUpgrades(): void {
    this.stats = this.upgrades.getSoldierStats();
    this.combat.stats = this.stats;
    this.growth.graceSeconds = this.stats.blightGraceSeconds;
    this.growth.rateMultiplier = this.stats.blightRateMultiplier;
    this.growth.weakenChance = this.stats.blightWeakenChance;
    for (const s of this.soldiers) {
      if (!s.alive) continue;
      const len = Math.hypot(s.vx, s.vy) || 1;
      s.vx = (s.vx / len) * this.stats.speed;
      s.vy = (s.vy / len) * this.stats.speed;
      s.speed = this.stats.speed;
    }
  }

  resize(): void {
    this.renderer.resize();
    this.camera.setViewport(this.canvas.clientWidth, this.canvas.clientHeight);
  }

  /** Begin a fresh run (regenerates the world in place). */
  startRun(): void {
    this.mainMenu.hide();
    this.pauseMenu.hide();
    this.resultsScreen.hide();
    this.upgradeTree.hide();
    if (this.runStats.time > 0) {
      generateWorld(this.world, WORLD.seed || this.rng.int(1 << 30));
      this.terrain.rebuildAll();
    }
    this.growth.reset();
    this.stats = this.upgrades.getSoldierStats();
    this.combat.stats = this.stats;
    this.growth.graceSeconds = this.stats.blightGraceSeconds;
    this.growth.rateMultiplier = this.stats.blightRateMultiplier;
    this.growth.weakenChance = this.stats.blightWeakenChance;
    this.soldiers = [];
    for (const fl of this.flashes) {
      this.flashPolyPool.push(fl.poly);
      this.flashLitPool.push(fl.lit);
    }
    this.flashes = [];
    this.cellFlashes = [];
    this.combat.bullets.clear();
    this.particles.clear();
    this.casings.clear();
    this.loot.clear();
    this.runStats.reset();
    this.reserves = this.stats.maxSoldiers;
    this.canDeploy = true;
    this.growthRate = 0;
    this.paused = false;
    this.runOver = false;
    this.bankedThisRun = false;
    this.camera.reset();
    this.camera.setViewport(this.canvas.clientWidth, this.canvas.clientHeight);
    this.hud.update(this, performance.now(), true);
  }

  /** Bank currency & lifetime pixels earned in the current run (idempotent per run). */
  bankCurrentRun(): { time: boolean; depth: boolean; pixels: boolean } {
    const r = this.runStats;
    const b = this.save.data.bests;
    const newBests = {
      time: r.time > b.time && r.soldiersDeployed > 0,
      depth: r.maxDepth > b.depth && r.maxDepth > 0,
      pixels: r.pixelsDestroyed > b.pixels && r.pixelsDestroyed > 0,
    };
    if (!this.bankedThisRun) {
      this.bankedThisRun = true;
      this.save.data.bank += r.currency;
      this.save.data.crystals += r.crystals;
      this.save.data.lifetimePixels += r.pixelsDestroyed;
      if (r.time > b.time) b.time = r.time;
      if (r.maxDepth > b.depth) b.depth = r.maxDepth;
      if (r.pixelsDestroyed > b.pixels) b.pixels = r.pixelsDestroyed;
      this.save.save();
    }
    return newBests;
  }

  restartAndBank(): void {
    this.bankCurrentRun();
    this.startRun();
  }

  togglePauseMenu(show?: boolean): void {
    if (this.runOver || this.upgradeTree.visible || this.mainMenu.visible) return;
    const next = show ?? !this.pauseMenu.visible;
    if (next) {
      this.paused = true;
      this.pauseMenu.show();
    } else {
      this.pauseMenu.hide();
      this.paused = false;
    }
    this.hud.update(this, performance.now(), true);
  }

  openUpgrades(): void {
    this.pauseMenu.hide();
    this.resultsScreen.hide();
    this.mainMenu.hide();
    this.paused = true;
    this.upgradeTree.show();
    this.hud.update(this, performance.now(), true);
  }

  openMainMenu(): void {
    this.bankCurrentRun();
    this.pauseMenu.hide();
    this.resultsScreen.hide();
    this.upgradeTree.hide();
    this.paused = true;
    this.mainMenu.show();
    this.hud.update(this, performance.now(), true);
  }

  private onKey(code: string): void {
    if (this.upgradeTree.visible) {
      if (code === "Escape" || code === "KeyU" || code === "Space") {
        this.upgradeTree.closeAndDeploy();
      }
      return;
    }
    if (this.mainMenu.visible) {
      if (code === "Space" || code === "Enter") {
        this.mainMenu.hide();
        this.startRun();
      } else if (code === "KeyU") {
        this.openUpgrades();
      }
      return;
    }
    switch (code) {
      case "KeyF":
        this.camera.resumeAuto();
        break;
      case "Tab":
        this.camera.cycleTarget(this.soldiers);
        break;
      case "Space":
        if (!this.runOver && !this.pauseMenu.visible) this.paused = !this.paused;
        break;
      case "Escape":
        if (this.resultsScreen.visible) this.startRun();
        else this.togglePauseMenu();
        break;
      case "KeyU":
        this.bankCurrentRun();
        this.openUpgrades();
        break;
      case "KeyR":
        this.restartAndBank();
        break;
      case "KeyM":
        this.audio.toggleMute();
        break;
      case "Backquote":
        this.debug = !this.debug;
        break;
    }
    this.hud.update(this, performance.now(), true);
  }

  launchInRandomDirection(): void {
    const spawn = findSpawnPoint(this.world, SOLDIER.collisionRadius);
    if (!spawn) return;
    const a = this.rng.range(0, Math.PI * 2);
    const sx = this.camera.worldToScreenX(spawn.x + Math.cos(a) * 40);
    const sy = this.camera.worldToScreenY(spawn.y + Math.sin(a) * 40);
    this.tryLaunch(sx, sy);
  }

  /** Launch a reserve soldier from the spawn point toward a screen position. */
  tryLaunch(sx: number, sy: number): void {
    if (this.paused || this.runOver || this.reserves <= 0) return;
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
    const slotIdx = this.runStats.soldiersDeployed;
    const rawWeapon = this.save.data.loadouts[slotIdx]?.weapon ?? "pistol";
    const weapon = rawWeapon === "shotgun" && !this.stats.shotgunUnlocked ? "pistol" : rawWeapon;
    const s = new Soldier(spawn.x, spawn.y, dx, dy, this.stats.speed, weapon);
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
    this.audio.playShot();
    const poly = this.flashPolyPool.pop() ?? new Float32Array(LIGHT.maxRays * 2);
    const lit = this.flashLitPool.pop() ?? makeLitCells();
    this.flashes.push({
      x: mx,
      y: my,
      dx,
      dy,
      life: LIGHT.flashDuration,
      maxLife: LIGHT.flashDuration,
      radius: LIGHT.radius,
      ownerId: s.id,
      poly,
      polyCount: 0,
      hasPolygon: false,
      lit,
    });
    // Eject a spinning brass shell casing perpendicular to firing direction.
    this.casings.spawn(s.x, s.y, dx, dy, s.ejectSide, this.rng);
    // Muzzle spark burst + wisp of gunsmoke.
    for (let i = 0; i < 5; i++) {
      const a = Math.atan2(dy, dx) + this.rng.range(-0.55, 0.55);
      const sp = this.rng.range(65, 175);
      this.particles.spawn(
        PKind.Spark,
        mx,
        my,
        Math.cos(a) * sp,
        Math.sin(a) * sp,
        this.rng.range(0.06, 0.14),
        1,
        0xffdc96,
        10,
      );
    }
    this.particles.spawn(
      PKind.Smoke,
      mx + dx * 2,
      my + dy * 2,
      dx * this.rng.range(10, 28) + this.rng.range(-12, 12),
      dy * this.rng.range(10, 28) + this.rng.range(-12, 12),
      this.rng.range(0.28, 0.5),
      2.2,
      0x8ca0ba,
      3.5,
    );
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
    if (destroyed) this.audio.playDestroy();
    else if (result === 1) this.audio.playImpact();
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
      const depth = this.world.depthOf(cx, cy);
      if (depth > this.runStats.maxDepth) this.runStats.maxDepth = depth;
      const zone = zoneForDepth(depth);
      const lootKind = zone >= 1 ? LootKind.Crystal : LootKind.Gold;
      this.loot.spawnDropsForBlock(
        ccx,
        ccy,
        this.stats.dropChance,
        this.stats.pickupLifetime,
        this.rng,
        lootKind,
      );
    }
  }

  private onSoldierKilled(s: Soldier): void {
    this.audio.playSoldierDeath();
    for (let i = 0; i < 36; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const sp = this.rng.range(30, 220);
      const col = i % 3 === 0 ? 0xff4b7d : i % 2 === 0 ? 0x9ff3ff : 0xffffff;
      this.particles.spawn(PKind.Spark, s.x, s.y, Math.cos(a) * sp, Math.sin(a) * sp, this.rng.range(0.25, 0.55), this.rng.range(1.2, 2.2), col, 5);
    }
    this.particles.spawn(PKind.Burst, s.x, s.y, 0, 0, 0.35, 16, 0x9ff3ff, 1);
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
    this.growth.update(dt, this.runStats.time, this.soldiers);
    this.growthRate = this.growth.rate;
    this.runStats.recordSampleIfDue(this.growthRate);
    this.particles.update(dt);
    this.casings.update(dt);
    const collected = this.loot.update(dt, this.soldiers, this.stats.magnetRange);
    if (collected > 0) {
      this.runStats.currency += this.loot.collectedGold;
      this.runStats.crystals += this.loot.collectedCrystals;
      this.audio.playPickup();
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      if ((this.flashes[i].life -= dt) <= 0) {
        this.flashPolyPool.push(this.flashes[i].poly);
        this.flashLitPool.push(this.flashes[i].lit);
        this.flashes.splice(i, 1);
      }
    }
    for (let i = this.cellFlashes.length - 1; i >= 0; i--) {
      if ((this.cellFlashes[i].life -= dt) <= 0) this.cellFlashes.splice(i, 1);
    }
    if (this.cellFlashes.length > 512) this.cellFlashes.splice(0, this.cellFlashes.length - 512);
    this.canDeploy = findSpawnPoint(this.world, SOLDIER.collisionRadius) !== null;

    // Run ends once at least one soldier has been deployed (or the room is
    // overrun) and no living or deployable soldiers remain.
    const alive = this.soldiers.some((s) => s.alive);
    const canStillDeploy = this.reserves > 0 && this.canDeploy;
    if (!alive && !canStillDeploy && (this.runStats.soldiersDeployed > 0 || !this.canDeploy)) {
      this.endRun();
    }
  }

  /** Compute visibility polygons for visible active flashes within the shadow-light budget. */
  private updateFlashPolygons(): void {
    const t0 = performance.now();
    this.lighting.lastRaysCast = 0;
    this.lighting.lastShadowLights = 0;
    const cam = this.camera;
    const maxLights = this.lighting.preset.maxShadowLights;
    let shadowed = 0;
    // Newest flashes first so fresh shots always get crisp shadows.
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const fl = this.flashes[i];
      const sx = cam.worldToScreenX(fl.x);
      const sy = cam.worldToScreenY(fl.y);
      const rad = fl.radius * cam.zoom;
      const onScreen = sx + rad >= 0 && sy + rad >= 0 && sx - rad <= cam.viewW && sy - rad <= cam.viewH;
      if (onScreen && shadowed < maxLights) {
        fl.polyCount = this.lighting.computeVisibilityPolygon(
          fl.x,
          fl.y,
          fl.dx,
          fl.dy,
          fl.radius,
          fl.ownerId,
          this.soldiers,
          fl.poly,
          fl.lit,
        );
        fl.hasPolygon = fl.polyCount >= 3;
        shadowed++;
      } else {
        fl.hasPolygon = false;
      }
    }
    this.lighting.lastShadowLights = shadowed;
    this.lighting.updateSoftLights(this.soldiers, this.world.roomCenterX, this.world.roomCenterY, cam);
    const elapsed = performance.now() - t0;
    this.lighting.lastComputeMs = elapsed;
    this.debugInfo.lightMs = elapsed;
    this.lightOverBudgetFrames = elapsed > LIGHT.budgetMs ? this.lightOverBudgetFrames + 1 : 0;
    if (this.lightOverBudgetFrames >= LIGHT.budgetFrames) {
      this.lightOverBudgetFrames = 0;
      if (this.lighting.quality === "high") this.lighting.quality = "medium";
      else if (elapsed > LIGHT.budgetMs * 1.5 && this.lighting.quality === "medium") {
        this.lighting.quality = "low";
      }
    }
  }

  endRun(): void {
    if (this.runOver) return;
    this.runOver = true;
    this.paused = true;
    const newBests = this.bankCurrentRun();
    this.resultsScreen.show(newBests);
    this.hud.update(this, performance.now(), true);
  }

  exportTelemetryJson(): string {
    const r = this.runStats;
    return JSON.stringify(
      {
        time: +r.time.toFixed(2),
        pixels: r.pixelsDestroyed,
        currency: r.currency,
        maxDepth: r.maxDepth,
        soldiersDeployed: r.soldiersDeployed,
        nearSoldierGrowthPct: +this.growth.nearSoldierPercent(r.time).toFixed(1),
        upgrades: this.save.data.upgrades,
        samples: r.samples,
      },
      null,
      2,
    );
  }

  frame = (now: number): void => {
    const real = this.last ? Math.min(0.1, (now - this.last) / 1000) : SIM.dt;
    this.last = now;
    const t0 = performance.now();
    if (!this.paused) {
      this.acc += real * this.timeScale;
      const maxSteps = SIM.maxStepsPerFrame * Math.max(1, this.timeScale);
      let steps = 0;
      while (this.acc >= SIM.dt && steps < maxSteps) {
        this.step(SIM.dt);
        this.acc -= SIM.dt;
        steps++;
      }
      if (steps >= maxSteps) this.acc = 0;
      this.camera.update(real, this.soldiers);
    }
    const t1 = performance.now();
    this.updateFlashPolygons();
    this.terrain.update();
    this.renderer.draw();
    this.hud.update(this, now);
    this.debugOverlay.update();
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
export { BULLET, COLORS, GROWTH };
