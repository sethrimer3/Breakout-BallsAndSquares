import { BULLET, CAMERA, COLORS, GROWTH, LIGHT, LOOT, SIM, SOLDIER, TERRAIN, WORLD, zoneForDepth } from "./config";
import { AudioSystem } from "./audio/AudioSystem";
import { Rng } from "./core/Rng";
import { CasingSystem } from "./entities/CasingSystem";
import { LootKind, lootKindForZone, LootSystem } from "./entities/LootSystem";
import { PKind, ParticleSystem } from "./entities/ParticleSystem";
import { Soldier, baseSoldierStats, type SecondaryWeaponType, type SoldierStats } from "./entities/Soldier";
import { MUZZLE_FLASH_MULTIPLIER, SaveManager, type SoldierBehavior } from "./progression/SaveManager";
import { UpgradeManager } from "./progression/UpgradeManager";
import { Renderer } from "./rendering/Renderer";
import { ScreenTransition } from "./rendering/ScreenTransition";
import { TerrainRenderer } from "./rendering/TerrainRenderer";
import { CameraSystem } from "./systems/CameraSystem";
import { CombatSystem } from "./systems/CombatSystem";
import { Input } from "./systems/Input";
import { LightingSystem, makeLitCells, type LitCells, type MuzzleLight } from "./systems/LightingSystem";
import { PhysicsSystem, findSpawnPoint } from "./systems/PhysicsSystem";
import { RunStats } from "./systems/RunStats";
import { HUD } from "./ui/HUD";
import { DebugOverlay } from "./ui/DebugOverlay";
import { DualStick } from "./ui/DualStick";
import { MainMenu } from "./ui/MainMenu";
import { PauseMenu } from "./ui/PauseMenu";
import { ResultsScreen } from "./ui/ResultsScreen";
import { UpgradeTree } from "./ui/UpgradeTree";
import { GrowthSystem } from "./world/GrowthSystem";
import { PixelWorld } from "./world/PixelWorld";
import { generateWorld } from "./world/WorldGenerator";

export type Flash = MuzzleLight;

/** Tactical marker for directing bouncing soldiers. */
export interface Marker {
  x: number;
  y: number;
  placedAt: number;
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
  readonly dualStick: DualStick;
  readonly input: Input;

  autoMove = true;
  activeFormation: "none" | "line" | "triangle" = "none";
  stats: SoldierStats = baseSoldierStats();
  soldiers: Soldier[] = [];
  flashes: Flash[] = [];
  cellFlashes: CellFlash[] = [];
  marker: Marker | null = null;
  markerMode = false;
  reserves = 0;
  canDeploy = true;
  growthRate = 0;
  paused = false;
  runOver = false;
  aimState = {
    active: false,
    startSx: 0,
    startSy: 0,
    curSx: 0,
    curSy: 0,
    startWx: 0,
    startWy: 0,
    isDragging: false,
  };
  private bankedThisRun = false;
  onUpgradePurchased?: () => void;
  timeScale = 1;
  /** Full-screen iris used for level intro and run-end transitions. */
  readonly transition = new ScreenTransition();
  /**
   * Last-soldier death sequence (real seconds since it started), or -1 when not running.
   * Shakes the screen, slows sim time to a stop, then closes the iris before results show.
   */
  private deathSeqT = -1;
  /** Extra sim-time multiplier driven by the death sequence (1 = normal speed). */
  private deathTimeScale = 1;
  private deathClosing = false;
  /** Current screen-shake amplitude in CSS pixels; decays in real time. */
  private shakeAmp = 0;
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
      onImpact: (x, y, nx, ny, cx, cy, result, sub, ownerId) =>
        this.onImpact(x, y, nx, ny, cx, cy, result, sub, ownerId),
      onExplosion: (x, y, rad) => this.onExplosion(x, y, rad),
      onGrenadeThrow: (s, x, y, dx, dy) => this.onGrenadeThrow(s, x, y, dx, dy),
      onGrenadeStick: (x, y, nx, ny) => this.onGrenadeStick(x, y, nx, ny),
      onGrenadeBeep: (x, y, pct) => this.onGrenadeBeep(x, y, pct),
    });
    this.growth = new GrowthSystem(this.world, this.rng, {
      onSoldierKilled: (s) => this.onSoldierKilled(s),
      onSoldierRescued: (s, fromCx, fromCy, toCx, toCy, hpCost) =>
        this.onSoldierRescued(s, fromCx, fromCy, toCx, toCy, hpCost),
      onBlightExplode: (cx, cy, rad, dmg) => this.onBlightExplode(cx, cy, rad, dmg),
    });
    this.lighting = new LightingSystem(this.world);
    this.camera = new CameraSystem(this.world);
    this.camera.defaultFollow = this.save.data.settings.autoFollowCamera;
    this.camera.following = this.camera.defaultFollow;
    generateWorld(this.world, WORLD.seed || this.rng.int(1 << 30));
    this.terrain = new TerrainRenderer(this.world, WORLD.chunkSize);
    this.terrain.rebuildAll();
    this.renderer = new Renderer(canvas, this);
    this.autoMove = this.save.data.settings.autoMove;
    this.dualStick = new DualStick(uiRoot, this);
    this.hud = new HUD(uiRoot, this);
    this.debugOverlay = new DebugOverlay(uiRoot, this);
    this.mainMenu = new MainMenu(uiRoot, this);
    this.pauseMenu = new PauseMenu(uiRoot, this);
    this.resultsScreen = new ResultsScreen(uiRoot, this);
    this.upgradeTree = new UpgradeTree(uiRoot, this);
    this.input = new Input(canvas, {
      canPlace: () => this.canPlaceSoldier(),
      canShootManual: () => this.canShootManual(),
      onManualShootStart: () => {
        if (this.canShootManual()) {
          const cmdr = this.getCommander();
          if (cmdr) this.shootCommanderManual(cmdr);
        }
      },
      onAimStart: (sx, sy) => this.onAimStart(sx, sy),
      onAimMove: (sx, sy) => this.onAimMove(sx, sy),
      onAimClick: (sx, sy) => this.onAimClick(sx, sy),
      onAimRelease: (startSx, startSy, endSx, endSy) =>
        this.onAimRelease(startSx, startSy, endSx, endSy),
      onAimCancel: () => this.onAimCancel(),
      onPrimaryClick: (sx, sy) => this.onPrimaryClick(sx, sy),
      onSecondaryClick: (sx, sy) => this.onPrimaryClick(sx, sy),
      onWheel: (sx, sy, dy) =>
        this.camera.zoomAt(sx, sy, dy < 0 ? CAMERA.wheelStep : 1 / CAMERA.wheelStep),
      onPinch: (sx, sy, factor) => this.camera.zoomAt(sx, sy, factor),
      onPan: (dx, dy) => this.camera.panBy(dx, dy),
      onKey: (code) => this.onKey(code),
    });
    window.addEventListener("resize", () => this.resize());
    this.resize();
    this.openMainMenu();
  }

  get bank(): number {
    return this.save.data.bank;
  }

  get crystals(): number {
    return this.save.data.crystals;
  }

  get greenCrystals(): number {
    return this.save.data.greenCrystals;
  }

  get essence(): number {
    return this.save.data.essence;
  }

  get muzzleFlashMultiplier(): number {
    return MUZZLE_FLASH_MULTIPLIER[this.save.data.settings.muzzleFlash] ?? 1;
  }

  /** Soft, orange "fiery" muzzle flashes (visual setting). */
  get fieryMuzzleFlash(): boolean {
    return this.save.data.settings.fieryMuzzleFlash;
  }

  /** Blurred shadow edges in the open-air light (visual setting). */
  get softShadows(): boolean {
    return this.save.data.settings.softShadows;
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
    this.growth.startRate = this.stats.blightStartRate;
    this.growth.rateMultiplier = this.stats.blightRateMultiplier;
    this.growth.weakenChance = this.stats.blightWeakenChance;
    this.growth.explosiveChance = this.stats.explosiveBlightChance;
    this.growth.explosiveDamage = this.stats.explosiveBlightDamage;
    this.growth.explosiveRadius = this.stats.explosiveBlightRadius;
    for (const s of this.soldiers) {
      if (!s.alive) continue;
      s.mods = this.upgrades.soldierMods(s.slotIndex);
      const speed = this.stats.speed * s.mods.speedMult;
      const len = Math.hypot(s.vx, s.vy) || 1;
      s.vx = (s.vx / len) * speed;
      s.vy = (s.vy / len) * speed;
      s.speed = speed;
      s.maxHealth = this.stats.soldierHealth + s.mods.healthBonus;
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
    this.growth.startRate = this.stats.blightStartRate;
    this.growth.rateMultiplier = this.stats.blightRateMultiplier;
    this.growth.weakenChance = this.stats.blightWeakenChance;
    this.growth.explosiveChance = this.stats.explosiveBlightChance;
    this.growth.explosiveDamage = this.stats.explosiveBlightDamage;
    this.growth.explosiveRadius = this.stats.explosiveBlightRadius;
    this.soldiers = [];
    for (const fl of this.flashes) {
      this.flashPolyPool.push(fl.poly);
      this.flashLitPool.push(fl.lit);
    }
    this.flashes = [];
    this.cellFlashes = [];
    this.combat.bullets.clear();
    this.combat.grenades.clear();
    this.combat.turrets.clear();
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
    this.aimState.active = false;
    this.aimState.isDragging = false;
    this.clearMarker();
    this.markerMode = false;
    this.camera.reset();
    this.camera.setViewport(this.canvas.clientWidth, this.canvas.clientHeight);
    this.cancelDeathSequence();
    this.shakeAmp = 0;
    this.canvas.style.transform = "";
    this.transition.reveal(DEATH_SEQ.revealSeconds);
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
      this.save.data.greenCrystals += r.greenCrystals;
      this.save.data.essence += r.essence;
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
    this.aimState.active = false;
    this.aimState.isDragging = false;
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
    this.abortDeathSequence();
    this.aimState.active = false;
    this.aimState.isDragging = false;
    this.pauseMenu.hide();
    this.resultsScreen.hide();
    this.mainMenu.hide();
    this.paused = true;
    this.upgradeTree.show();
    this.hud.update(this, performance.now(), true);
  }

  selectSaveSlot(slot: number): void {
    this.save.selectSlot(slot);
    this.applyUpgrades();
    this.camera.defaultFollow = this.save.data.settings.autoFollowCamera;
    this.autoMove = this.save.data.settings.autoMove;
  }

  openMainMenu(): void {
    this.abortDeathSequence();
    this.aimState.active = false;
    this.aimState.isDragging = false;
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
      if (code === "Space" || code === "Enter") {
        this.upgradeTree.onPrimaryAction();
      } else if (code === "Escape" || code === "KeyU") {
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
      } else if (code === "Digit1" || code === "Numpad1") {
        this.mainMenu.selectSlot(1);
      } else if (code === "Digit2" || code === "Numpad2") {
        this.mainMenu.selectSlot(2);
      } else if (code === "Digit3" || code === "Numpad3") {
        this.mainMenu.selectSlot(3);
      } else if (code === "Escape") {
        this.mainMenu.onEscape();
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
        if (this.aimState.active) this.onAimCancel();
        else if (this.marker) this.clearMarker();
        else if (this.resultsScreen.visible) this.startRun();
        else this.togglePauseMenu();
        break;
      case "KeyT":
        this.toggleMarkerMode();
        break;
      case "Digit1":
        this.toggleFormation("line");
        this.hud.update(this, performance.now(), true);
        break;
      case "Digit2":
        this.toggleFormation("triangle");
        this.hud.update(this, performance.now(), true);
        break;
      case "KeyG":
        this.triggerReadySecondary();
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

  canPlaceSoldier(): boolean {
    return !this.paused && !this.runOver && this.reserves > 0 && !this.markerMode;
  }

  onAimStart(sx: number, sy: number): void {
    if (!this.canPlaceSoldier()) return;
    this.aimState.active = true;
    this.aimState.startSx = sx;
    this.aimState.startSy = sy;
    this.aimState.curSx = sx;
    this.aimState.curSy = sy;
    this.aimState.startWx = this.camera.screenToWorldX(sx);
    this.aimState.startWy = this.camera.screenToWorldY(sy);
    this.aimState.isDragging = false;
  }

  onAimMove(sx: number, sy: number): void {
    if (!this.aimState.active) return;
    this.aimState.curSx = sx;
    this.aimState.curSy = sy;
    const dist = Math.hypot(sx - this.aimState.startSx, sy - this.aimState.startSy);
    if (dist >= 6) {
      this.aimState.isDragging = true;
    }
  }

  onAimClick(_sx: number, _sy: number): void {
    if (!this.aimState.active) return;
    const wx = this.aimState.startWx;
    const wy = this.aimState.startWy;
    this.aimState.active = false;
    this.aimState.isDragging = false;

    // Click and let go: send in a random direction (straight up, right, left, down)
    const CARDINAL = [
      { dx: 0, dy: -1 }, // straight up
      { dx: 1, dy: 0 },  // right
      { dx: 0, dy: 1 },  // down
      { dx: -1, dy: 0 }, // left
    ];
    const dir = CARDINAL[Math.floor(this.rng.range(0, 4))];
    this.deploySoldier(wx, wy, dir.dx, dir.dy);
  }

  onAimRelease(startSx: number, startSy: number, endSx: number, endSy: number): void {
    if (!this.aimState.active) return;
    const wx = this.aimState.startWx;
    const wy = this.aimState.startWy;
    this.aimState.active = false;
    this.aimState.isDragging = false;

    // Soldier will go away from where the player let go (endSx, endSy).
    // Vector from end to start points away from release:
    const dx = startSx - endSx;
    const dy = startSy - endSy;
    this.deploySoldier(wx, wy, dx, dy);
  }

  onAimCancel(): void {
    this.aimState.active = false;
    this.aimState.isDragging = false;
  }

  /** Deploy a reserve soldier at world coordinates (wx, wy) with direction (dx, dy). */
  deploySoldier(wx: number, wy: number, dx: number, dy: number): Soldier | null {
    if (this.paused || this.runOver || this.reserves <= 0) return null;

    const cs = this.world.cellSize;
    const r = SOLDIER.collisionRadius;
    const minX = r;
    const minY = r;
    const maxX = this.world.width * cs - r;
    const maxY = this.world.height * cs - r;
    const clampedX = Math.max(minX, Math.min(maxX, wx));
    const clampedY = Math.max(minY, Math.min(maxY, wy));

    const len = Math.hypot(dx, dy);
    let ndx = dx;
    let ndy = dy;
    if (len < 1e-4) {
      ndx = 0;
      ndy = -1; // straight up default
    } else {
      ndx /= len;
      ndy /= len;
    }

    const slotIdx = this.runStats.soldiersDeployed;
    const rawWeapon = this.save.data.loadouts[slotIdx]?.weapon ?? "pistol";
    const weapon = this.isWeaponUnlocked(rawWeapon) ? rawWeapon : "pistol";
    const rawBehavior = this.save.data.loadouts[slotIdx]?.behavior ?? "free";
    const behavior = this.isBehaviorUnlocked(rawBehavior) ? rawBehavior : "free";
    const rawSecondary = this.save.data.loadouts[slotIdx]?.secondary ?? null;
    const secondary = rawSecondary && this.isSecondaryUnlocked(rawSecondary) ? rawSecondary : null;
    const mods = this.upgrades.soldierMods(slotIdx);
    const s = new Soldier(clampedX, clampedY, ndx, ndy, this.stats.speed * mods.speedMult, weapon, behavior, slotIdx, secondary);
    s.mods = mods;
    s.maxHealth = this.stats.soldierHealth + mods.healthBonus;
    s.health = s.maxHealth;
    this.soldiers.push(s);
    this.reserves--;
    this.runStats.soldiersDeployed++;
    // Launch puff.
    for (let i = 0; i < 14; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const sp = this.rng.range(20, 70);
      this.particles.spawn(PKind.Spark, clampedX, clampedY, Math.cos(a) * sp, Math.sin(a) * sp, 0.35, 1, 0x9ff3ff, 5);
    }
    return s;
  }

  launchInRandomDirection(): void {
    if (this.reserves <= 0 || this.paused || this.runOver) return;
    const spawn = findSpawnPoint(this.world, SOLDIER.collisionRadius) ?? {
      x: this.camera.x,
      y: this.camera.y,
    };
    const CARDINAL = [
      { dx: 0, dy: -1 },
      { dx: 1, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: -1, dy: 0 },
    ];
    const dir = CARDINAL[Math.floor(this.rng.range(0, 4))];
    this.deploySoldier(spawn.x, spawn.y, dir.dx, dir.dy);
  }

  /** Launch a reserve soldier toward screen position in a random cardinal direction or directly. */
  tryLaunch(sx: number, sy: number): void {
    if (this.paused || this.runOver || this.reserves <= 0) return;
    const wx = this.camera.screenToWorldX(sx);
    const wy = this.camera.screenToWorldY(sy);
    const CARDINAL = [
      { dx: 0, dy: -1 },
      { dx: 1, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: -1, dy: 0 },
    ];
    const dir = CARDINAL[Math.floor(this.rng.range(0, 4))];
    this.deploySoldier(wx, wy, dir.dx, dir.dy);
  }

  onPrimaryClick(sx: number, sy: number): void {
    if (this.paused || this.runOver) return;
    const wx = this.camera.screenToWorldX(sx);
    const wy = this.camera.screenToWorldY(sy);
    this.setMarker(wx, wy);
  }

  setMarker(wx: number, wy: number): void {
    if (this.paused || this.runOver) return;
    const cs = this.world.cellSize;
    const minX = cs;
    const minY = cs;
    const maxX = this.world.width * cs - cs;
    const maxY = this.world.height * cs - cs;
    const clampedX = Math.max(minX, Math.min(maxX, wx));
    const clampedY = Math.max(minY, Math.min(maxY, wy));
    this.marker = { x: clampedX, y: clampedY, placedAt: performance.now() };
    this.physics.marker = this.marker;
    this.audio.playMarkerPing();
    for (let i = 0; i < 14; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const sp = this.rng.range(30, 90);
      this.particles.spawn(PKind.Spark, clampedX, clampedY, Math.cos(a) * sp, Math.sin(a) * sp, 0.35, 1.5, 0x00ffff, 4);
    }
    this.hud.update(this, performance.now(), true);
  }

  clearMarker(): void {
    this.marker = null;
    this.physics.marker = null;
    this.hud.update(this, performance.now(), true);
  }

  toggleMarkerMode(): void {
    this.markerMode = !this.markerMode;
    this.hud.update(this, performance.now(), true);
  }

  isWeaponUnlocked(w: Soldier["weapon"]): boolean {
    switch (w) {
      case "pistol":
        return true;
      case "shotgun":
        return this.stats.shotgunUnlocked;
      case "assault_rifle":
        return this.stats.arUnlocked;
      case "rocket_launcher":
        return this.stats.rocketUnlocked;
      case "sniper_rifle":
        return this.stats.sniperUnlocked;
      case "katana":
        return this.stats.katanaUnlocked;
    }
  }

  isSecondaryUnlocked(s: SecondaryWeaponType | null): boolean {
    if (!s) return true;
    if (s === "grenade") return this.stats.grenadeUnlocked;
    if (s === "turret") return this.stats.turretUnlocked;
    return false;
  }

  getSecondaryEnergyRequired(sec: SecondaryWeaponType | null): number {
    if (sec === "turret") return this.stats.turretEnergyRequired;
    return this.stats.grenadeBlocksRequired;
  }

  setAutoMove(enabled: boolean): void {
    this.autoMove = enabled;
    this.save.data.settings.autoMove = enabled;
    this.save.save();
    if (!enabled) {
      const cmdr = this.getCommander();
      if (cmdr) {
        this.camera.targetId = cmdr.id;
        this.camera.following = true;
      }
    }
  }

  toggleFormation(formation: "line" | "triangle"): void {
    if (formation === "line" && this.upgrades.levelOf("formation_line") === 0) return;
    if (formation === "triangle" && this.upgrades.levelOf("formation_triangle") === 0) return;
    if (this.activeFormation === formation) {
      this.activeFormation = "none";
    } else {
      this.activeFormation = formation;
    }
    this.audio.playPickup();
  }

  getCommander(): Soldier | null {
    const living = this.soldiers.filter((s) => s.alive);
    if (living.length === 0) return null;
    living.sort((a, b) => a.slotIndex - b.slotIndex || a.id - b.id);
    return living[0];
  }

  isBehaviorUnlocked(b: SoldierBehavior): boolean {
    if (b === "free") return true;
    if (b === "orthogonal") return this.upgrades.levelOf("behavior_orthogonal") > 0;
    if (b === "vertical" || b === "horizontal") return this.upgrades.levelOf("behavior_patrol") > 0;
    if (b === "turn_left" || b === "turn_right") return this.upgrades.levelOf("behavior_turns") > 0;
    if (b === "sentry_slow" || b === "sentry_fast") return this.upgrades.levelOf("behavior_sentry") > 0;
    return false;
  }

  canShootManual(): boolean {
    return !this.autoMove && !this.paused && !this.runOver && this.getCommander() !== null;
  }

  shootCommanderManual(commander: Soldier): void {
    if (commander.fireCooldown <= 0) {
      const cdx = Math.cos(commander.facingAngle);
      const cdy = Math.sin(commander.facingAngle);
      this.combat.fire(commander, cdx, cdy);
      this.onShot(commander, cdx, cdy, commander.x, commander.y);
      let rate = this.stats.fireRate;
      if (commander.weapon === "shotgun") rate = this.stats.shotgunFireRate;
      else if (commander.weapon === "assault_rifle") rate = this.stats.arFireRate;
      else if (commander.weapon === "rocket_launcher") rate = this.stats.rocketFireRate;
      else if (commander.weapon === "sniper_rifle") rate = this.stats.sniperFireRate;
      commander.fireCooldown = 1 / Math.max(0.1, rate);
    }
  }

  /** Current aim origin for rendering the aim line (null if cannot deploy). */
  aimOrigin(): { x: number; y: number } | null {
    if (this.reserves <= 0 || this.paused) return null;
    return findSpawnPoint(this.world, SOLDIER.collisionRadius);
  }

  private onShot(s: Soldier, dx: number, dy: number, mx: number, my: number): void {
    this.runStats.shotsFired++;
    if (s.weapon === "katana") {
      this.audio.playSlash();
      for (let i = 0; i < 4; i++) {
        const a = Math.atan2(dy, dx) + this.rng.range(-0.7, 0.7);
        const sp = this.rng.range(50, 130);
        this.particles.spawn(
          PKind.Spark,
          mx,
          my,
          Math.cos(a) * sp,
          Math.sin(a) * sp,
          this.rng.range(0.06, 0.12),
          1,
          0xa0f4ff,
          8,
        );
      }
      return;
    }
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
    this.casings.spawn(s.x ?? mx, s.y ?? my, dx, dy, s.ejectSide ?? 1, this.rng);
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
    sub = false,
    ownerId = 0,
  ): void {
    const destroyed = result === 2;
    if (destroyed) this.audio.playDestroy();
    else if (result === 1) this.audio.playImpact();
    const n = destroyed ? 10 : 4;
    for (let i = 0; i < n; i++) {
      const a = Math.atan2(ny, nx) + this.rng.range(-1.1, 1.1);
      const sp = this.rng.range(40, destroyed ? 150 : 110);
      this.particles.spawn(PKind.Spark, x, y, Math.cos(a) * sp, Math.sin(a) * sp, this.rng.range(0.08, 0.2), 1, sub ? 0xff6ab8 : 0xffc070, 8);
    }
    if (sub) {
      // A 50% pink core-blight pixel: pink debris, quarter-cell loot odds, no normal terrain stats.
      if (destroyed) {
        for (let i = 0; i < 3; i++) {
          const a = Math.atan2(ny, nx) + this.rng.range(-1.3, 1.3);
          const sp = this.rng.range(20, 70);
          this.particles.spawn(PKind.Debris, x, y, Math.cos(a) * sp, Math.sin(a) * sp, this.rng.range(0.3, 0.6), 1, 0xd8267a, 4);
        }
        const subZone = zoneForDepth(this.world.depthOf(cx, cy));
        this.loot.spawnDropsForBlock(x, y, this.dropChanceAt(subZone, ownerId) * 0.25, this.stats.pickupLifetime, this.rng, lootKindForZone(subZone));
        this.checkSecondaryCharge(ownerId);
      }
      return;
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
      this.checkSecondaryCharge(ownerId);
      const depth = this.world.depthOf(cx, cy);
      if (depth > this.runStats.maxDepth) this.runStats.maxDepth = depth;
      const zone = zoneForDepth(depth);
      const lootKind = lootKindForZone(zone);
      this.loot.spawnDropsForBlock(
        ccx,
        ccy,
        this.dropChanceAt(zone, ownerId),
        this.stats.pickupLifetime,
        this.rng,
        lootKind,
      );
      const destroyedCore = this.world.checkCoreDestroyedAt(cx, cy);
      if (destroyedCore) {
        this.growth.reduceBlightTimer(this.runStats.time, this.stats.coreTimeReduction);
        this.growthRate = this.growth.rate;
        // 2×2 core: its center is the shared corner of its four cells.
        const coreWx = (destroyedCore.cx + 1) * cs;
        const coreWy = (destroyedCore.cy + 1) * cs;
        for (let i = 0; i < this.stats.coreLootBurst; i++) {
          this.loot.spawnOne(coreWx, coreWy, this.stats.pickupLifetime, this.rng, lootKind);
        }
        const essenceLife = this.stats.pickupLifetime * LOOT.essenceLifetimeMult;
        for (let i = 0; i < LOOT.coreEssence[destroyedCore.zone]; i++) {
          this.loot.spawnOne(coreWx, coreWy, essenceLife, this.rng, LootKind.Essence);
        }
        this.particles.spawn(PKind.Burst, coreWx, coreWy, 0, 0, 0.45, 28, 0xff48a4, 1);
        for (let i = 0; i < 36; i++) {
          const a = this.rng.range(0, Math.PI * 2);
          const sp = this.rng.range(45, 220);
          const col = i % 2 === 0 ? 0xff48a4 : 0xff9ad5;
          this.particles.spawn(
            PKind.Spark,
            coreWx,
            coreWy,
            Math.cos(a) * sp,
            Math.sin(a) * sp,
            this.rng.range(0.22, 0.5),
            this.rng.range(1.4, 2.4),
            col,
            5,
          );
        }
      }
    }
  }

  private onExplosion(x: number, y: number, radiusWorld: number): void {
    this.audio.playDestroy();
    this.shakeForExplosion(x, y, radiusWorld);
    const poly = this.flashPolyPool.pop() ?? new Float32Array(LIGHT.maxRays * 2);
    const lit = this.flashLitPool.pop() ?? makeLitCells();
    this.flashes.push({
      x,
      y,
      dx: 1,
      dy: 0,
      life: LIGHT.flashDuration * 1.9,
      maxLife: LIGHT.flashDuration * 1.9,
      radius: Math.max(LIGHT.radius * 1.2, radiusWorld * 3.2),
      ownerId: -1,
      poly,
      polyCount: 0,
      hasPolygon: false,
      lit,
    });
    this.particles.spawn(PKind.Burst, x, y, 0, 0, 0.28, radiusWorld * 0.75, 0xffaa44, 1);
    for (let i = 0; i < 24; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const sp = this.rng.range(45, 220);
      const col = i % 2 === 0 ? 0xff7722 : 0xffdd77;
      this.particles.spawn(
        PKind.Spark,
        x,
        y,
        Math.cos(a) * sp,
        Math.sin(a) * sp,
        this.rng.range(0.15, 0.35),
        this.rng.range(1.2, 2.2),
        col,
        6,
      );
    }
  }

  /** A destroyed block's drop chance: its zone's, then the soldier who broke it. */
  private dropChanceAt(zone: number, ownerId: number): number {
    let chance = this.stats.dropChance;
    if (zone === 1) chance *= 1 + this.stats.crystalDropBonus;
    else if (zone >= 2) chance *= 1 + this.stats.tier3ResourceBonus;
    if (ownerId > 0) {
      const owner = this.soldiers.find((s) => s.id === ownerId);
      if (owner) chance *= owner.mods.dropMult;
    }
    return chance;
  }

  private checkSecondaryCharge(ownerId: number): void {
    if (ownerId <= 0) return;
    const soldier = this.soldiers.find((s) => s.id === ownerId && s.alive);
    if (!soldier || !soldier.secondary) return;
    const rate = soldier.mods?.energyPerBlock ?? 0.1;
    soldier.secondaryEnergy += rate;
    const req = this.getSecondaryEnergyRequired(soldier.secondary);
    if (soldier.secondaryEnergy >= req) {
      if (this.stats.autoAbility) {
        this.activateSecondary(soldier);
      } else {
        soldier.secondaryEnergy = req;
      }
    }
  }

  /**
   * Activates a soldier's equipped secondary weapon if fully charged.
   * Resets their accumulated energy to 0 and executes the weapon action.
   */
  activateSecondary(soldier: Soldier): boolean {
    if (!soldier || !soldier.alive || !soldier.secondary) return false;
    const req = this.getSecondaryEnergyRequired(soldier.secondary);
    if (soldier.secondaryEnergy < req) return false;
    soldier.secondaryEnergy = 0;

    if (soldier.secondary === "grenade") {
      this.combat.throwGrenade(
        soldier,
        this.stats.grenadeBlastRadius,
        this.stats.grenadeDamage,
        this.stats.grenadeShrapnel,
        this.stats.grenadeBlightMult,
      );
      return true;
    }
    if (soldier.secondary === "turret") {
      this.combat.deployTurrets(
        soldier,
        this.stats.turretCount,
        this.stats.turretDamage,
        this.stats.turretFireRate,
        this.stats.turretTurnSpeed,
      );
      this.audio.playShot();
      for (let i = 0; i < 8; i++) {
        const a = this.rng.range(0, Math.PI * 2);
        const sp = this.rng.range(30, 90);
        this.particles.spawn(PKind.Spark, soldier.x, soldier.y, Math.cos(a) * sp, Math.sin(a) * sp, 0.2, 1, 0x38d6ff, 5);
      }
      return true;
    }
    return false;
  }

  /** Triggers the first ready secondary ability among alive soldiers (e.g. from hotkey). */
  triggerReadySecondary(): boolean {
    const ready = this.soldiers.find(
      (s) => s.alive && s.secondary && s.secondaryEnergy >= this.getSecondaryEnergyRequired(s.secondary),
    );
    if (ready) {
      return this.activateSecondary(ready);
    }
    return false;
  }

  private onGrenadeThrow(_s: Soldier, x: number, y: number, dx: number, dy: number): void {
    this.audio.playShot();
    for (let i = 0; i < 4; i++) {
      const a = Math.atan2(dy, dx) + this.rng.range(-0.4, 0.4);
      const sp = this.rng.range(15, 35);
      this.particles.spawn(PKind.Smoke, x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.25, 2, 0x4a5a6a, 2);
    }
  }

  private onGrenadeStick(x: number, y: number, nx: number, ny: number): void {
    this.audio.playImpact();
    for (let i = 0; i < 6; i++) {
      const a = Math.atan2(ny, nx) + this.rng.range(-0.8, 0.8);
      const sp = this.rng.range(30, 80);
      this.particles.spawn(PKind.Spark, x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.2, 1, 0xff7830, 5);
    }
  }

  private onGrenadeBeep(x: number, y: number, _pct: number): void {
    this.particles.spawn(PKind.Spark, x, y, 0, 0, 0.08, 1, 0xff2040, 3);
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

  private onSoldierRescued(s: Soldier, fromCx: number, fromCy: number, _toCx: number, _toCy: number, _hpCost: number): void {
    const cs = this.world.cellSize;
    const fromWx = (fromCx + 0.5) * cs;
    const fromWy = (fromCy + 0.5) * cs;
    this.audio.playImpact();
    for (let i = 0; i < 16; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const sp = this.rng.range(50, 160);
      this.particles.spawn(PKind.Spark, fromWx, fromWy, Math.cos(a) * sp, Math.sin(a) * sp, 0.25, 1.5, 0x38d6ff, 4);
      this.particles.spawn(PKind.Spark, s.x, s.y, Math.cos(a) * sp, Math.sin(a) * sp, 0.25, 1.5, 0x9ff3ff, 4);
    }
    this.particles.spawn(PKind.Burst, s.x, s.y, 0, 0, 0.25, 12, 0x38d6ff, 1);
  }

  private onBlightExplode(centerCx: number, centerCy: number, radiusCells: number, damage: number): void {
    const w = this.world;
    const cs = w.cellSize;
    const rCeil = Math.ceil(radiusCells);
    const r2 = radiusCells * radiusCells;
    const wx = (centerCx + 0.5) * cs;
    const wy = (centerCy + 0.5) * cs;

    for (let dy = -rCeil; dy <= rCeil; dy++) {
      const cy = centerCy + dy;
      for (let dx = -rCeil; dx <= rCeil; dx++) {
        const cx = centerCx + dx;
        const d2 = dx * dx + dy * dy;
        if (d2 > r2 || !w.inBounds(cx, cy)) continue;
        w.damage(cx, cy, damage);
      }
    }

    this.onExplosion(wx, wy, radiusCells * cs);
  }

  /** One fixed simulation step. */
  step(dt: number): void {
    this.runStats.time += dt;

    const commander = this.getCommander();

    // 1. Manual Commander Control
    if (!this.autoMove && commander) {
      commander.isManual = true;
      for (const s of this.soldiers) {
        if (s !== commander) s.isManual = false;
      }

      // Movement: Keyboard (WASD/arrows) or Left Virtual Stick
      const kmv = this.input.getMovementVector();
      const smv = this.dualStick.move;
      const mx = smv.active ? smv.x : kmv.x;
      const my = smv.active ? smv.y : kmv.y;
      const mlen = Math.hypot(mx, my);
      if (mlen > 1e-4) {
        commander.vx = (mx / mlen) * commander.speed;
        commander.vy = (my / mlen) * commander.speed;
      } else {
        commander.vx = 0;
        commander.vy = 0;
      }

      // Aiming: Right Virtual Stick or Mouse Reticle
      if (this.dualStick.aim.active) {
        commander.facingAngle = this.dualStick.aim.angle;
      } else if (this.input.mouseInside) {
        const wx = this.camera.screenToWorldX(this.input.mouseX);
        const wy = this.camera.screenToWorldY(this.input.mouseY);
        const adx = wx - commander.x;
        const ady = wy - commander.y;
        if (Math.hypot(adx, ady) > 1e-4) {
          commander.facingAngle = Math.atan2(ady, adx);
        }
      }

      // Shooting
      commander.fireCooldown -= dt;
      const shouldShoot =
        this.save.data.settings.alwaysShootWhenAutoMoveOff ||
        this.input.isMouseDown ||
        this.dualStick.aim.active;
      if (shouldShoot && commander.fireCooldown <= 0) {
        this.shootCommanderManual(commander);
      }

      // Ensure camera tracks commander
      this.camera.targetId = commander.id;
      this.camera.following = true;
    } else {
      for (const s of this.soldiers) s.isManual = false;
    }

    // 2. Formations (Override individual behaviors)
    if (this.activeFormation !== "none" && commander) {
      const followers = this.soldiers
        .filter((s) => s.alive && s !== commander)
        .sort((a, b) => a.slotIndex - b.slotIndex || a.id - b.id);

      let cdx = Math.cos(commander.facingAngle);
      let cdy = Math.sin(commander.facingAngle);
      const cvLen = Math.hypot(commander.vx, commander.vy);
      if (cvLen > 10) {
        cdx = commander.vx / cvLen;
        cdy = commander.vy / cvLen;
      }

      const spacing = 16;
      for (let i = 0; i < followers.length; i++) {
        const f = followers[i];
        f.isInFormation = true;
        let tx = 0;
        let ty = 0;
        if (this.activeFormation === "line") {
          tx = commander.x - cdx * spacing * (i + 1);
          ty = commander.y - cdy * spacing * (i + 1);
        } else {
          // Triangle formation (wedge)
          const row = Math.floor(i / 2) + 1;
          const side = i % 2 === 0 ? -1 : 1;
          const backDist = row * spacing;
          const sideDist = side * row * 14;
          tx = commander.x - cdx * backDist - cdy * sideDist;
          ty = commander.y - cdy * backDist + cdx * sideDist;
        }

        const fdx = tx - f.x;
        const fdy = ty - f.y;
        const fdist = Math.hypot(fdx, fdy);
        if (fdist > 3) {
          const fsp = Math.min(f.speed * 1.6, Math.max(f.speed, fdist * 3.5));
          f.vx = (fdx / fdist) * fsp;
          f.vy = (fdy / fdist) * fsp;
          f.facingAngle = Math.atan2(f.vy, f.vx);
        } else {
          f.vx = commander.vx;
          f.vy = commander.vy;
          f.facingAngle = commander.facingAngle;
        }
      }
    } else {
      for (const s of this.soldiers) s.isInFormation = false;
    }

    this.dualStick.update();

    for (const s of this.soldiers) {
      if (!s.alive) continue;
      s.age += dt;
      this.physics.step(s, dt);
      this.combat.updateSoldier(s, dt);
    }
    this.combat.updateBullets(dt);
    this.combat.updateGrenades(dt);
    this.combat.updateTurrets(dt);
    this.growth.update(dt, this.runStats.time, this.soldiers);
    this.growthRate = this.growth.rate;
    this.runStats.recordSampleIfDue(this.growthRate);
    this.particles.update(dt);
    this.casings.update(dt, this.world);
    const collected = this.loot.update(dt, this.soldiers, this.stats.magnetRange);
    if (collected > 0) {
      this.runStats.currency += this.loot.collectedGold;
      this.runStats.crystals += this.loot.collectedCrystals;
      this.runStats.greenCrystals += this.loot.collectedGreenCrystals;
      this.runStats.essence += this.loot.collectedEssence;
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
    this.canDeploy = this.reserves > 0;

    // Run ends once at least one soldier has been deployed and no living or deployable soldiers remain.
    const alive = this.soldiers.some((s) => s.alive);
    const canStillDeploy = this.reserves > 0 && this.canDeploy;
    if (!alive && !canStillDeploy && this.runStats.soldiersDeployed > 0) {
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
    const grenadeLights: { x: number; y: number; radius: number; strength: number }[] = [];
    for (let i = 0; i < this.combat.grenades.items.length; i++) {
      const g = this.combat.grenades.items[i];
      if (g.active && g.stuck) {
        const flash = (g.fuse % 0.22) < 0.11;
        grenadeLights.push({ x: g.x, y: g.y, radius: 24, strength: flash ? 0.9 : 0.45 });
      }
    }
    this.lighting.updateSoftLights(this.soldiers, this.world.roomCenterX, this.world.roomCenterY, cam, grenadeLights);
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

  /**
   * Run is lost: play the death sequence (shake, slow time to a stop, close the iris), then
   * show the results screen with the iris opening from the centre.
   */
  endRun(): void {
    if (this.runOver) return;
    this.runOver = true;
    this.aimState.active = false;
    this.aimState.isDragging = false;
    this.deathSeqT = 0;
    this.deathTimeScale = 1;
    this.deathClosing = false;
    this.addScreenShake(DEATH_SEQ.shakeAmplitude);
    this.hud.update(this, performance.now(), true);
  }

  /** Kick the screen shake to at least `amp` CSS pixels (stronger kicks win). */
  addScreenShake(amp: number): void {
    if (amp > this.shakeAmp) this.shakeAmp = Math.min(SHAKE.maxAmplitude, amp);
  }

  /** Larger blasts (rockets, grenades, explosive blight) shake the screen; small pops do not. */
  private shakeForExplosion(x: number, y: number, radiusWorld: number): void {
    const radCells = radiusWorld / this.world.cellSize;
    if (radCells < SHAKE.minBlastCells) return;
    // Fade out for blasts away from the view so off-screen explosions barely register.
    const cam = this.camera;
    const dx = Math.abs(cam.worldToScreenX(x) - cam.viewW / 2) - cam.viewW / 2;
    const dy = Math.abs(cam.worldToScreenY(y) - cam.viewH / 2) - cam.viewH / 2;
    const outside = Math.max(0, dx, dy);
    const falloff = Math.max(0, 1 - outside / SHAKE.offscreenFalloffPx);
    if (falloff <= 0) return;
    this.addScreenShake(SHAKE.perBlastCell * radCells * falloff);
  }

  /** Apply and decay the screen shake on the game canvas (the UI stays put). */
  private updateScreenShake(real: number): void {
    if (this.shakeAmp <= 0) return;
    this.shakeAmp = Math.max(0, this.shakeAmp - real * SHAKE.decayPerSecond * Math.max(1, this.shakeAmp));
    if (this.shakeAmp < 0.35) {
      this.shakeAmp = 0;
      this.canvas.style.transform = "";
      return;
    }
    const ox = Math.round((Math.random() * 2 - 1) * this.shakeAmp);
    const oy = Math.round((Math.random() * 2 - 1) * this.shakeAmp);
    this.canvas.style.transform = `translate(${ox}px, ${oy}px)`;
  }

  private updateDeathSequence(real: number): void {
    if (this.deathSeqT < 0) return;
    this.deathSeqT += real;
    const t = this.deathSeqT;
    const D = DEATH_SEQ;
    // Ease sim time down to a full stop.
    const p = Math.min(1, t / D.slowSeconds);
    this.deathTimeScale = (1 - p) * (1 - p);
    if (!this.deathClosing && t >= D.slowSeconds + D.holdSeconds) {
      this.deathClosing = true;
      this.transition.close(D.closeSeconds, () => {
        if (this.deathSeqT < 0) return; // cancelled (e.g. restarted mid-close)
        this.cancelDeathSequence();
        this.finishRun();
        this.transition.reveal(D.revealSeconds);
      });
    }
  }

  /** Leaving the run mid-sequence (menu/upgrades): stop it and open the iris if it was closing. */
  private abortDeathSequence(): void {
    if (this.deathSeqT < 0) return;
    const wasClosing = this.deathClosing;
    this.cancelDeathSequence();
    if (wasClosing) this.transition.reveal(DEATH_SEQ.revealSeconds);
  }

  private cancelDeathSequence(): void {
    this.deathSeqT = -1;
    this.deathTimeScale = 1;
    this.deathClosing = false;
  }

  private finishRun(): void {
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
        crystals: r.crystals,
        greenCrystals: r.greenCrystals,
        essence: r.essence,
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
      this.acc += real * this.timeScale * this.deathTimeScale;
      const maxSteps = SIM.maxStepsPerFrame * Math.max(1, this.timeScale);
      let steps = 0;
      while (this.acc >= SIM.dt && steps < maxSteps) {
        this.step(SIM.dt);
        this.acc -= SIM.dt;
        steps++;
      }
      if (steps >= maxSteps) this.acc = 0;
      if (!this.aimState.active) {
        this.camera.update(real, this.soldiers);
      }
    }
    this.updateDeathSequence(real);
    this.updateScreenShake(real);
    this.transition.update(real);
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

/** Screen shake tuning (CSS pixels / real seconds). */
const SHAKE = {
  /** Blasts smaller than this (cluster mini-bombs, tiny blight pops) don't shake. */
  minBlastCells: 2,
  /** Amplitude per cell of blast radius: rocket (2.5) ≈ 2px, grenade (2.8) ≈ 2.2px. */
  perBlastCell: 0.8,
  maxAmplitude: 6,
  /** Linear decay rate, scaled by amplitude so kicks settle in ~0.3-0.45s. */
  decayPerSecond: 6,
  /** Distance beyond the screen edge at which a blast no longer shakes. */
  offscreenFalloffPx: 240,
};

/** Timings (real seconds) for the last-soldier death sequence and level intro. */
const DEATH_SEQ = {
  shakeAmplitude: 5,
  slowSeconds: 1.3,
  holdSeconds: 0.25,
  closeSeconds: 0.75,
  revealSeconds: 0.9,
};

// Re-export for convenience in renderers.
export { BULLET, COLORS, GROWTH };
