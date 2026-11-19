import { BrowserFrameEvents } from "./core/BrowserFrameEvents";
import { FrameTimings } from "./core/FrameTimings";
import { DamageNumbers } from "./entities/DamageNumbers";
import { LateEncounters } from "./systems/LateEncounters";
import { GROVE_CACHE_STACKS, LATE_DROP_CHANCE, lateBlockReward } from "./world/campaignBalance";
import { BULLET, CAMERA, DAMAGE_ROLL, COLORS, FACILITY, FOG, GROWTH, LIGHT, LOOT, SIM, SOLDIER, TERRAIN, WORLD } from "./config";
import { AudioSystem } from "./audio/AudioSystem";
import { fireAmbienceMix } from "./audio/fireAmbience";
import { labWorldSeed } from "./core/WorldSeed";
import { SpeedrunTimer } from "./core/SpeedrunTimer";
import { Rng } from "./core/Rng";
import { CasingSystem } from "./entities/CasingSystem";
import { SubPixelPhysics } from "./systems/SubPixelPhysics";
import { SentrySystem } from "./entities/Sentry";
import { CreatureSystem, type Creature } from "./entities/Creatures";
import { LootKind, lootKindForZone, LootSystem } from "./entities/LootSystem";
import { tierLootValue, VEIN_DROPS, worldLootKind } from "./world/tierEconomy";
import { PKind, ParticleSystem } from "./entities/ParticleSystem";
import { Soldier, resolvePrimaryMutation, baseSoldierStats, type SecondaryWeaponType, type SoldierStats } from "./entities/Soldier";
import { markCampaignComplete, MUZZLE_FLASH_MULTIPLIER, SaveManager, type SoldierBehavior } from "./progression/SaveManager";
import { UpgradeManager } from "./progression/UpgradeManager";
import type { RenderQuality } from "./rendering/RenderScale";
import { Renderer } from "./rendering/Renderer";
import { ScreenTransition } from "./rendering/ScreenTransition";
import { TerrainRenderer } from "./rendering/TerrainRenderer";
import { CameraSystem } from "./systems/CameraSystem";
import { CombatSystem } from "./systems/CombatSystem";
import { CombinedTargets, RoomFixtures } from "./systems/RoomFixtures";
import { SpecialUpgradeSystem } from "./systems/SpecialUpgrades";
import { BlightWardenSystem, type Warden } from "./systems/BlightWardens";
import { SpawnPortal } from "./systems/SpawnPortal";
import { SPECIAL_UNLOCKS } from "./progression/specialUnlocks";
import { UPGRADE_BY_ID } from "./progression/UpgradeDefinitions";
import { FireSystem } from "./systems/FireSystem";
import { Input } from "./systems/Input";
import { LightingSystem, makeLitCells, type LitCells, type MuzzleLight } from "./systems/LightingSystem";
import { PhysicsSystem, circleIsClear, findClearDeployPoint, findSpawnPoint, hasCircleLineOfSight } from "./systems/PhysicsSystem";
import { RunStats } from "./systems/RunStats";
import { HUD } from "./ui/HUD";
import { DebugOverlay } from "./ui/DebugOverlay";
import { DualStick } from "./ui/DualStick";
import { MainMenu } from "./ui/MainMenu";
import { PauseMenu } from "./ui/PauseMenu";
import { ResultsScreen } from "./ui/ResultsScreen";
import { CampaignEndingScreen } from "./ui/CampaignEndingScreen";
import { UpgradeTree } from "./ui/UpgradeTree";
import { DoorSystem } from "./world/DoorSystem";
import { GlassSystem } from "./world/GlassSystem";
import { GrowthSystem } from "./world/GrowthSystem";
import { FogOfWar, type SightSource } from "./world/FogOfWar";
import { MAT, PixelWorld, SUB } from "./world/PixelWorld";
import { generateWorld } from "./world/WorldGenerator";
import { LabMap } from "./ui/LabMap";
import { renderSectorThumbs } from "./rendering/SectorThumbs";
import { LabProgress } from "./world/LabProgress";
import { gateGeometry, labWorld, LAB_WORLD_COUNT, sectorCount, sectorSpawnCell, upgradeSpotSector, type LabWorldDef } from "./world/labMap";
import type { Door } from "./world/PixelWorld";
import type { LabWorldProgress } from "./progression/SaveManager";

export type Flash = MuzzleLight;

/** Brief highlight on a terrain cell (hit or destroy). */
export interface CellFlash {
  cx: number;
  cy: number;
  life: number;
  maxLife: number;
  destroyed: boolean;
}

/** Soft glow flash when a door cell is opening. */
export interface DoorFlash {
  cx: number;
  cy: number;
  delay: number;
  life: number;
  maxLife: number;
  tier: number;
}

export class Game {
  readonly canvas: HTMLCanvasElement;
  readonly world: PixelWorld;
  readonly rng = new Rng();
  readonly physics: PhysicsSystem;
  readonly combat: CombatSystem;
  readonly fixtures: RoomFixtures;
  /** Glowing gold special-upgrade blocks and the motes they burst into. */
  readonly specials: SpecialUpgradeSystem;
  /** Blight Wardens guarding the gold special-upgrade blocks. */
  readonly wardens: BlightWardenSystem;
  readonly late: LateEncounters;
  /** Flamethrower flames and burning rubble. */
  readonly fire: FireSystem;
  readonly growth: GrowthSystem;
  readonly lighting: LightingSystem;
  readonly fog: FogOfWar;
  readonly glass: GlassSystem;
  readonly doors: DoorSystem;
  readonly sentries: SentrySystem;
  /** The Blight's flowers, worms and escaped tank specimens. */
  readonly creatures: CreatureSystem;
  private sightSources: SightSource[] = [];
  readonly camera: CameraSystem;
  readonly terrain: TerrainRenderer;
  readonly renderer: Renderer;
  readonly damageNumbers: DamageNumbers;
  readonly particles = new ParticleSystem(3000);
  readonly casings = new CasingSystem();
  readonly subPixels: SubPixelPhysics;
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
  readonly campaignEnding: CampaignEndingScreen;
  private pendingEndingTimer = -1;
  readonly upgradeTree: UpgradeTree;
  readonly dualStick: DualStick;
  readonly input: Input;

  autoMove = true;
  activeFormation: "none" | "line" | "triangle" = "none";
  stats: SoldierStats = baseSoldierStats();
  soldiers: Soldier[] = [];
  flashes: Flash[] = [];
  cellFlashes: CellFlash[] = [];
  doorFlashes: DoorFlash[] = [];
  reserves = 0;
  canDeploy = true;
  /** The squad's deployment portal while it is open (see SpawnPortal). */
  portal: SpawnPortal | null = null;
  /** Last refused portal tap (wall-clock seconds), shown as a red mark. */
  spawnDenied: { x: number; y: number; t0: number; guarded: boolean } | null = null;
  growthRate = 0;
  private readonly speedrunClock = new SpeedrunTimer();
  private speedrunSavedAt = 0;
  private runStarted = false;
  /** Last frame was live gameplay (for render quality sampling). */
  private wasPlaying = false;
  private _paused = false;
  private _runOver = false;
  get paused(): boolean { return this._paused; }
  set paused(value: boolean) {
    const wasPaused = this._paused;
    this._paused = value;
    this.syncSpeedrun();
    if (value && !wasPaused && this.runStarted && this.save?.data.speedrun.enabled) this.save.save();
  }
  get runOver(): boolean { return this._runOver; }
  set runOver(value: boolean) {
    this._runOver = value;
    this.syncSpeedrun();
    if (value && this.save?.data.speedrun.enabled) this.save.save();
  }

  /** Flush time at state transitions as well as frames, without simulation scaling. */
  syncSpeedrun(now = performance.now()): void {
    if (!this.save) return;
    const running = this.runStarted && this.runStats?.soldiersDeployed > 0 && !this.paused && !this.runOver && !document.hidden
      && !this.mainMenu?.visible && !this.pauseMenu?.visible && !this.upgradeTree?.visible
      && !this.labMap?.visible && !this.resultsScreen?.visible;
    this.speedrunClock.sync(now, this.save.data.speedrun, running);
  }

  setSpeedrunEnabled(enabled: boolean): void {
    this.syncSpeedrun();
    this.save.data.speedrun.enabled = enabled;
    this.syncSpeedrun();
    this.save.save();
  }
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
  /** Discovered / conquered sectors of the hand-made lab (mirrors `save.data.lab`). */
  labProgress = new LabProgress();
  labMap!: LabMap;
  private labCheckT = 0;
  /** The "access needed" notice over a locked world gate (run seconds it started), or null. */
  gateNotice: { door: Door; t0: number } | null = null;
  /** "Special Upgrade Acquired" banner over the soldier who absorbed one (run seconds it started), or null. */
  specialNotice: { soldier: Soldier; t0: number; label: string } | null = null;
  /** Recent shots on locked gates (run seconds), for when to show the notice. */
  private gateHits: number[] = [];
  /** True while the iris is closing to carry the squad through a gate. */
  private traveling = false;
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
  debug = false;
  debugInfo = { fps: 0, frameMs: 0, simMs: 0, lightMs: 0 };
  private flashPolyPool: Float32Array[] = [];
  private flashLitPool: LitCells[] = [];
  private lightOverBudgetFrames = 0;
  /** Historical trail of commander positions for obstacle-aware squad navigation. */
  private commanderTrail: { x: number; y: number }[] = [];
  /** Currently selected commander soldier ID (0 = lowest-numbered living soldier). */
  private commanderId = 0;

  private acc = 0;
  private last = 0;
  readonly frameTimings = new FrameTimings();
  private readonly browserFrameEvents = new BrowserFrameEvents(this.frameTimings, () => this.wasPlaying);
  private fpsAcc = 0;
  private fpsFrames = 0;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.canvas = canvas;
    this.world = new PixelWorld(WORLD);
    this.damageNumbers = new DamageNumbers(this.world);
    if (2 * SOLDIER.collisionRadius >= WORLD.cellSize) {
      console.warn("Soldier collision diameter >= cell size: soldiers cannot fit 1-cell tunnels.");
    }
    this.save = new SaveManager();
    this.debug = this.save.data.settings.devMode;
    this.upgrades = new UpgradeManager(this.save);
    this.audio = new AudioSystem(this.save);
    this.stats = this.upgrades.getSoldierStats();
    this.onUpgradePurchased = () => this.audio.playPurchase();

    this.physics = new PhysicsSystem(this.world, this.rng);
    this.combat = new CombatSystem(this.world, this.rng, this.stats, {
      onShot: (s, dx, dy, mx, my) => this.onShot(s, dx, dy, mx, my),
      onImpact: (x, y, nx, ny, cx, cy, result, sub, ownerId) =>
        this.onImpact(x, y, nx, ny, cx, cy, result, sub, ownerId),
      onExplosion: (x, y, rad, damage, visualOnly) => this.onExplosion(x, y, rad, damage, visualOnly),
      onGrenadeThrow: (s, x, y, dx, dy) => this.onGrenadeThrow(s, x, y, dx, dy),
      onGrenadeStick: (x, y, nx, ny) => this.onGrenadeStick(x, y, nx, ny),
      onGrenadeBeep: (x, y, pct) => this.onGrenadeBeep(x, y, pct),
      onRevolverReturn: (x,y) => this.audio.playRicochet(x,y),
      onDroneLaunch: (x,y) => this.audio.playDrone(x,y),
      onDroneShot: (x,y) => this.audio.playShot(x,y),
      onLaserBounce: (x,y) => this.audio.playRicochet(x,y),
      onLaserOverload: (x,y) => this.particles.spawn(PKind.Burst,x,y,0,0,0.12,12,0xd37cff,8),
      onGooStick: (x, y, nx, ny) => {
        this.audio.playGoo("stick", x, y);
        this.particles.spawn(PKind.Spark, x, y, nx * 20, ny * 20, 0.12, 2, 0x9cde68, 8);
      },
      onGooRelease: (x, y) => this.audio.playGoo("release", x, y),
      onGooResidueLost: (x, y) => this.particles.spawn(PKind.Smoke, x, y, 0, -8, 0.2, 1.5, 0x9cde68, 8),
      onGooLaunchBlocked: (x, y) => this.particles.spawn(PKind.Smoke, x, y, 0, -6, 0.15, 1, 0x9cde68, 8),
      onGooMineBurst: (x, y, radius, damage) => {
        this.creatures.explode(x, y, radius, damage);
        this.fixtures.explode(x, y, radius);
        this.late.explode(x, y, radius, damage);
        this.wardens.explode(x, y, radius, damage);
        this.specials.explode(x, y, radius);
        this.audio.playGoo("burst", x, y);
        this.particles.spawn(PKind.Burst, x, y, 0, 0, 0.2, radius, 0xff963c, 8);
      },
      onCreatureHit: (x, y, nx, ny) => this.onCreatureHit(x, y, nx, ny),
      onBulletRicochet: (x, y, nx, ny) => {
        this.audio.playRicochet(x, y);
        this.particles.spawn(PKind.Spark, x, y, nx * 55, ny * 55, 0.06, 1.5, 0x8eeaff, 8);
      },
      onFlameHit: (sx, sy, x, y, nx, ny) => {
        this.fire.splash(x, y, nx, ny);
        return this.fire.ignite(sx, sy) || this.fire.isBurning(sy * this.world.subWidth + sx);
      },
    });
    this.fire = new FireSystem(this.world, this.rng);
    // Burnt-out rubble repaints charred.
    this.fire.onChar = (sx, sy) => this.terrain.chunks.markCell(sx >> 1, sy >> 1);
    this.growth = new GrowthSystem(this.world, this.rng, {
      onSoldierKilled: (s) => this.onSoldierKilled(s),
      onSoldierRescued: (s, fromCx, fromCy, toCx, toCy, hpCost) =>
        this.onSoldierRescued(s, fromCx, fromCy, toCx, toCy, hpCost),
      onBlightExplode: (cx, cy, rad, dmg) => this.onBlightExplode(cx, cy, rad, dmg),
      onDecay: (sx, sy) => this.onBlightDecay(sx, sy),
      onOverdrive: (on) => this.onOverdrive(on),
    });
    this.growth.freeze = this.combat.freeze;
    this.lighting = new LightingSystem(this.world);
    this.fog = new FogOfWar(this.world);
    this.glass = new GlassSystem(this.world, { onShatter: (cx, cy) => this.onGlassShatter(cx, cy) });
    this.doors = new DoorSystem(this.world, {
      onOpen: (door) => this.audio.playDoorOpen((door.x0 + door.x1 + 1) * this.world.cellSize / 2, (door.y0 + door.y1 + 1) * this.world.cellSize / 2),
      onCellOpen: (cx, cy, delay, tier) => {
        const dur = 0.22;
        this.doorFlashes.push({ cx, cy, delay, life: dur, maxLife: dur, tier });
      },
      onGateLocked: (door) => this.onGateLocked(door),
    });
    this.sentries = new SentrySystem(this.world, (s) => this.audio.playSentryWake(s.x, s.y));
    this.creatures = new CreatureSystem(this.world, this.rng, {
      onSoldierHit: (s, dmg, x, y) => this.hurtSoldier(s, dmg, x, y),
      onSporeLaunch: (x, y) => this.audio.playSpore(x, y),
      onSporeBurst: (x, y, r) => this.onSporeBurst(x, y, r),
      onCreatureKilled: (c, x, y) => this.onCreatureKilled(c, x, y),
      onSpecimenFreed: (s) => this.audio.playSpore(s.x, s.y),
    });
    this.fixtures = new RoomFixtures(this.world, (l) => {
      this.terrain.darkenFixture(l);
      const x = (l.x0 + l.x1 + 1) * this.world.cellSize / 2;
      const y = (l.y0 + l.y1 + 1) * this.world.cellSize / 2;
      this.audio.playGlassShatter(x, y);
      for (let i = 0; i < 14; i++) {
        const a = this.rng.range(0, Math.PI * 2), speed = this.rng.range(35, 115);
        this.particles.spawn(PKind.Spark, x, y, Math.cos(a) * speed, Math.sin(a) * speed, this.rng.range(0.1, 0.3), 1, i % 2 ? 0xffce70 : 0xb7e6ff, 6);
      }
      this.particles.spawn(PKind.Burst, x, y, 0, 0, 0.1, 8, 0xffdf9a, 1);
    });
    this.late = new LateEncounters(this.world, (a, kind, value) => {
      const list = a.kind === "grove" ? this.labSave.gathered : this.labSave.cleared;
      if (list.includes(a.id)) return;
      list.push(a.id);
      // Authoritative durable reward: credit persistent resources atomically into wallet immediately upon clear.
      if (kind === LootKind.Biomass) {
        this.save.data.biomass += value;
      } else if (kind === LootKind.Essence) {
        this.save.data.essence += value;
      }
      let cacheRewardKind: LootKind = LootKind.Gold;
      let cacheRewardVal = 0;
      if (a.kind === "grove") {
        const reward = lateBlockReward(a.tier);
        cacheRewardKind = reward.kind;
        cacheRewardVal = reward.value * GROVE_CACHE_STACKS;
        if (cacheRewardKind === LootKind.Crystal) this.save.data.crystals += cacheRewardVal;
        else if (cacheRewardKind === LootKind.GreenCrystal) this.save.data.greenCrystals += cacheRewardVal;
        else if (cacheRewardKind === LootKind.Essence) this.save.data.essence += cacheRewardVal;
        else this.save.data.bank += cacheRewardVal;
      }
      this.save.save();

      // Drop physical pickups for in-world player audiovisual gratification.
      // Flagged as feedback drops so physical collection produces effects/sounds
      // but does NOT double-credit the authoritative wallet balance.
      this.loot.spawnOne(a.x, a.y, Math.max(90, this.stats.pickupLifetime), this.rng, kind, value, true);
      if (a.kind === "grove") {
        this.loot.spawnOne(a.x, a.y, 90, this.rng, cacheRewardKind, cacheRewardVal, true);
      }
      if (a.kind === "boss") {
        markCampaignComplete(this.save.data, this.runStats.time);
        this.save.save();
        this.pendingEndingTimer = 1.4;
        this.addScreenShake(8);
        for (let i = 0; i < 48; i++) {
          const ang = this.rng.range(0, Math.PI * 2);
          const sp = this.rng.range(50, 180);
          this.particles.spawn(PKind.Spark, a.x, a.y, Math.cos(ang) * sp, Math.sin(ang) * sp, this.rng.range(0.4, 0.9), 1, i % 2 ? 0xff0055 : 0xffd84d, 8);
        }
        this.particles.spawn(PKind.Burst, a.x, a.y, 0, 0, 0.4, 18, 0xff3377, 1);
        this.particles.spawn(PKind.Burst, a.x, a.y, 0, 0, 0.25, 28, 0xffd84d, 1);
      }
      this.audio.playDestroy(a.x, a.y);
    }, (soldier, damage, x, y) => this.hurtSoldier(soldier, damage, x, y), (x, y) => this.audio.playSpore(x, y));
    this.specials = new SpecialUpgradeSystem(this.world, () => this.soldiers, {
      onHit: (_b, x, y) => {
        this.audio.playImpact(x, y);
        for (let i = 0; i < 6; i++) {
          const a = this.rng.range(0, Math.PI * 2), sp = this.rng.range(30, 90);
          this.particles.spawn(PKind.Spark, x, y, Math.cos(a) * sp, Math.sin(a) * sp, this.rng.range(0.1, 0.25), 1, i % 2 ? 0xffd75a : 0xfff1b0, 6);
        }
      },
      onShatter: (b) => {
        const x = (b.x0 + b.x1) / 2, y = (b.y0 + b.y1) / 2;
        this.audio.playGlassShatter(x, y);
        this.audio.playDestroy(x, y);
        this.addScreenShake(5);
        this.particles.spawn(PKind.Burst, x, y, 0, 0, 0.18, 26, 0xffd75a, 1);
        this.particles.spawn(PKind.Burst, x, y, 0, 0, 0.32, 16, 0xfff1b0, 1);
      },
      onMoteAbsorbed: (s) => this.audio.playPickup(s.x, s.y),
      onAbsorbed: (id, s) => this.grantSpecialUpgrade(id, s),
    }, () => this.rng.next());
    this.wardens = new BlightWardenSystem(this.world, {
      onSoldierHit: (s, dmg, x, y) => this.hurtSoldier(s, dmg, x, y),
      onSpit: (x, y) => this.audio.playSpore(x, y),
      onSpitBurst: (x, y, r) => this.onSporeBurst(x, y, r),
      onLunge: (w) => this.audio.playSpore(w.x, w.y),
      onHurt: (_w, x, y) => {
        for (let i = 0; i < 3; i++) {
          const a = this.rng.range(0, Math.PI * 2), sp = this.rng.range(20, 70);
          this.particles.spawn(PKind.Debris, x, y, Math.cos(a) * sp, Math.sin(a) * sp, this.rng.range(0.2, 0.4), 1, 0xd8267a, 4);
        }
      },
      onKilled: (w) => this.onWardenKilled(w),
      onBlockFreed: (_id, x, y) => {
        this.audio.playGlassShatter(x, y);
        this.particles.spawn(PKind.Burst, x, y, 0, 0, 0.3, 22, 0xff4b8b, 1);
      },
    }, () => this.rng.next());
    this.specials.isShielded = (id) => this.wardens.isGuarded(id);
    this.combat.targets = new CombinedTargets([this.creatures, this.fixtures, this.late, this.wardens, this.specials]);
    this.combat.late = this.late;
    this.camera = new CameraSystem(this.world);
    this.audio.setCamera(this.camera);
    this.camera.defaultFollow = this.save.data.settings.autoFollowCamera;
    this.camera.following = this.camera.defaultFollow;
    this.subPixels = new SubPixelPhysics(this.world);
    this.lighting.subPixels = this.subPixels;
    // When a non-Blight 0.5 pixel breaks, push nearby 0.5 pixels away with physics.
    this.world.onSubBreakPush = (sx, sy) => this.subPixels.pushFromBreak(sx, sy);
    this.loadLabProgress();
    this.generateLab();
    this.terrain = new TerrainRenderer(this.world, WORLD.chunkSize);
    this.subPixels.onSubLightSettled = (sx, sy) => this.terrain.addLabLight(sx, sy);
    this.terrain.dormantAt = (si) => this.growth.colonies.isDormantSub(si);
    this.growth.colonies.onVisualChange = (sx, sy) => this.terrain.chunks.markCell(sx >> 1, sy >> 1);
    this.terrain.rebuildAll();
    this.resetFog();
    this.resetFacility();
    this.renderer = new Renderer(canvas, this);
    this.autoMove = this.save.data.settings.autoMove;
    this.dualStick = new DualStick(uiRoot, this);
    this.hud = new HUD(uiRoot, this);
    this.debugOverlay = new DebugOverlay(uiRoot, this);
    this.mainMenu = new MainMenu(uiRoot, this);
    this.pauseMenu = new PauseMenu(uiRoot, this);
    this.resultsScreen = new ResultsScreen(uiRoot, this);
    this.campaignEnding = new CampaignEndingScreen(uiRoot, this);
    this.upgradeTree = new UpgradeTree(uiRoot, this);
    this.labMap = new LabMap(uiRoot, this);
    this.refreshSectorThumbs();
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
      onWheel: (sx, sy, dy) =>
        this.camera.zoomAt(sx, sy, dy < 0 ? CAMERA.wheelStep : 1 / CAMERA.wheelStep),
      onPinch: (sx, sy, factor) => this.camera.zoomAt(sx, sy, factor),
      onPan: (dx, dy) => this.camera.panBy(dx, dy),
      onKey: (code) => this.onKey(code),
    });
    window.addEventListener("resize", () => this.resize());
    document.addEventListener("visibilitychange", () => {
      this.syncSpeedrun();
      if (this.save.data.speedrun.enabled) this.save.save();
    });
    window.addEventListener("pagehide", () => {
      this.syncSpeedrun();
      this.speedrunClock.sync(performance.now(), this.save.data.speedrun, false);
      if (this.save.data.speedrun.enabled) this.save.save();
    });
    window.addEventListener("pageshow", () => this.syncSpeedrun());
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

  get devMapAccess(): boolean {
    const settings = this.save.data.settings;
    return settings.devMode && settings.devMapAccess;
  }

  get biomass(): number {
    return this.save.data.biomass;
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

  /** Canvas pixel density setting ("auto" adapts to the frame rate). */
  get renderQuality(): RenderQuality {
    return this.save.data.settings.renderQuality;
  }

  /** Apply a new render quality setting to the canvas. */
  setRenderQuality(q: RenderQuality): void {
    this.save.data.settings.renderQuality = q;
    this.save.save();
    this.resize();
  }

  /** Blurred shadow edges in the open-air light (visual setting). */
  get softShadows(): boolean {
    return this.save.data.settings.softShadows;
  }

  /** Subtle low-res bloom around glowing lights and panels (visual setting). */
  get bloom(): boolean {
    return this.save.data.settings.bloom;
  }

  get lifetimePixels(): number {
    return this.save.data.lifetimePixels;
  }

  get bests(): { time: number; depth: number; pixels: number } {
    return this.save.data.bests;
  }

  applyUpgrades(): void {
    this.stats = this.upgrades.getSoldierStats();
    this.fog.permanent = this.stats.permanentMapping;
    this.fog.connectedAir = this.stats.connectedAirMapping;
    this.fog.wallPenetrationCells = this.stats.betterFlashlight
      ? LIGHT.betterFlashlightWallWeights.length
      : 0;
    this.lighting.soldierLightRadius = this.stats.betterFlashlight
      ? LIGHT.betterFlashlightRadius
      : LIGHT.soldierLightRadius;
    this.lighting.soldierLightStrength = this.stats.betterFlashlight
      ? LIGHT.betterFlashlightStrength
      : LIGHT.soldierLightStrength;
    this.lighting.soldierWallDepth = this.stats.betterFlashlight
      ? LIGHT.betterFlashlightWallWeights.length
      : 1;
    this.applyFacilityStats();
    this.combat.stats = this.stats;
    this.world.playerDamageMult = this.stats.terrainDamageMult;
    this.world.damageRollMin = DAMAGE_ROLL.min;
    this.world.damageRollMax = DAMAGE_ROLL.max;
    this.growth.graceSeconds = this.stats.blightGraceSeconds;
    this.growth.startRate = this.stats.blightStartRate;
    this.growth.expBase = this.stats.blightExpBase;
    this.growth.rateMultiplier = this.stats.blightRateMultiplier;
    this.growth.weakenChance = this.stats.blightWeakenChance;
    this.growth.decayRate = this.stats.blightNecrosisRate;
    this.growth.explosiveChance = this.stats.explosiveBlightChance;
    this.growth.explosiveDamage = this.stats.explosiveBlightDamage;
    this.growth.explosiveRadius = this.stats.explosiveBlightRadius;
    for (const s of this.soldiers) {
      if (!s.alive) continue;
      s.mods = this.upgrades.soldierMods(s.slotIndex);
      s.mutation = resolvePrimaryMutation(s.weapon, s.mutation, this.stats);
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
    this.paused = true;
    this.runStarted = true;
    if (!this.devMapAccess && this.upgrades.levelOf("unlock_map") === 0) {
      this.save.data.lab.world = 1;
      this.labSave.spawn = 0;
      this.loadLabProgress();
    }
    if (!this.devMapAccess && this.save.data.lab.world > this.save.data.lab.unlocked) {
      this.selectLabWorld(this.save.data.lab.unlocked);
    }
    this.mainMenu.hide();
    this.pauseMenu.hide();
    this.resultsScreen.hide();
    this.campaignEnding.hide();
    this.pendingEndingTimer = -1;
    this.upgradeTree.hide();
    this.labMap?.hide();
    // The hand-made lab is rebuilt every run: the chosen spawn and conquered sectors may have changed.
    const regen = this.runStats.time > 0 || !!this.world.labLayout?.frame;
    if (regen) this.generateLab();
    this.growth.reset();
    if (regen) {
      this.terrain.rebuildAll();
      this.refreshSectorThumbs();
    }
    this.stats = this.upgrades.getSoldierStats();
    this.resetFog();
    this.resetFacility();
    this.combat.stats = this.stats;
    this.world.playerDamageMult = this.stats.terrainDamageMult;
    this.world.damageRollMin = DAMAGE_ROLL.min;
    this.world.damageRollMax = DAMAGE_ROLL.max;
    this.growth.graceSeconds = this.stats.blightGraceSeconds;
    this.growth.startRate = this.stats.blightStartRate;
    this.growth.expBase = this.stats.blightExpBase;
    this.growth.rateMultiplier = this.stats.blightRateMultiplier;
    this.growth.weakenChance = this.stats.blightWeakenChance;
    this.growth.decayRate = this.stats.blightNecrosisRate;
    this.growth.explosiveChance = this.stats.explosiveBlightChance;
    this.growth.explosiveDamage = this.stats.explosiveBlightDamage;
    this.growth.explosiveRadius = this.stats.explosiveBlightRadius;
    this.soldiers = [];
    this.commanderId = 0;
    this.commanderTrail.length = 0;
    for (const fl of this.flashes) {
      this.flashPolyPool.push(fl.poly);
      this.flashLitPool.push(fl.lit);
    }
    this.flashes = [];
    this.cellFlashes = [];
    this.doorFlashes = [];
    this.combat.creatures = this.creatures;
    this.combat.clearAll();
    this.combat.resetTelemetry();
    this.particles.clear();
    this.damageNumbers.clear();
    this.fire.clear();
    this.fire.burnMult = this.stats.flameBurnMult;
    this.casings.clear();
    this.subPixels.clear();
    this.loot.clear();
    this.runStats.reset();
    this.acc = 0;
    this.reserves = this.stats.maxSoldiers;
    this.canDeploy = true;
    this.portal = null;
    this.spawnDenied = null;
    this.growthRate = 0;
    this.paused = false;
    this.runOver = false;
    this.bankedThisRun = false;
    this.aimState.active = false;
    this.aimState.isDragging = false;
    this.camera.reset();
    this.camera.setViewport(this.canvas.clientWidth, this.canvas.clientHeight);
    this.cancelDeathSequence();
    this.shakeAmp = 0;
    this.canvas.style.transform = "";
    this.transition.reveal(DEATH_SEQ.revealSeconds);
    this.hud.update(this, performance.now(), true);
  }

  /** The lab world (zone) squads deploy into. */
  get labDef(): LabWorldDef {
    return labWorld(this.save.data.lab.world);
  }

  /** Saved progress through the current lab world. */
  get labSave(): LabWorldProgress {
    const lab = this.save.data.lab;
    return lab.worlds[lab.world];
  }

  /** Read lab progress from the active save slot. */
  private loadLabProgress(): void {
    const w = this.labSave;
    this.labProgress = new LabProgress(this.labDef, w.discovered, w.conquered);
  }

  /** Show another reached world on the lab map (rebuilds the world behind it). */
  selectLabWorld(id: number): void {
    const lab = this.save.data.lab;
    if (!Number.isInteger(id) || id < 1 || id > (this.devMapAccess ? LAB_WORLD_COUNT : lab.unlocked) || id === lab.world) return;
    lab.world = id;
    this.save.save();
    this.loadLabProgress();
    this.generateLab();
    this.terrain.rebuildAll();
    this.refreshSectorThumbs();
  }

  /**
   * Regenerate the world for a new run: the hand-made lab with conquered
   * sectors already cleared, and the starting room moved to the chosen
   * spawn sector (A1 until the Lab Map is unlocked).
   */
  private generateLab(): void {
    const def = this.labDef;
    const lab = this.labSave;
    if (!this.canDeployInto(lab.spawn)) lab.spawn = def.start;
    generateWorld(this.world, labWorldSeed(def.id), { conquered: this.labProgress.conquered, labWorld: def, spawn: lab.spawn });
    this.labProgress.attach(this.world);
    this.creatures.flowerMult = def.alien ? FACILITY.alienFlowerMult : 1;
    this.gateNotice = null;
    this.gateHits.length = 0;
  }

  /** Photograph every sector of the freshly built lab for the lab map. */
  private refreshSectorThumbs(): void {
    const frame = this.world.labLayout?.frame;
    if (frame && this.labMap) this.labMap.setThumbs(renderSectorThumbs(this.world, this.terrain, frame));
  }

  /**
   * Normal deployments require conquest; the dev override allows any valid
   * sector. Either way, a sector whose gold block is still uncollected is
   * held by its Blight Wardens and cannot be deployed into.
   */
  canDeployInto(sector: number): boolean {
    return Number.isInteger(sector) && sector >= 0 && sector < sectorCount(this.labDef)
      && (this.devMapAccess || this.labProgress.conquered.has(sector))
      && !this.sectorGuarded(sector);
  }

  /** True while Blight Wardens hold `sector`: it has a gold block not yet collected. */
  sectorGuarded(sector: number): boolean {
    const def = this.labDef;
    const collected = this.labSave.specials;
    return def.upgrades.some((spot) => upgradeSpotSector(def, spot) === sector && !collected.includes(spot.id));
  }

  /**
   * Begin deploying a new run: the lab map to pick a sector when the world is
   * the hand-made lab, else straight into a run.
   */
  beginDeploy(): void {
    if (!this.devMapAccess && this.save.data.lab.world > this.save.data.lab.unlocked) this.selectLabWorld(this.save.data.lab.unlocked);
    if (!this.world.labLayout?.frame || (!this.devMapAccess && this.upgrades.levelOf("unlock_map") === 0)) {
      this.startRun();
      return;
    }
    this.abortDeathSequence();
    this.mainMenu.hide();
    this.pauseMenu.hide();
    this.resultsScreen.hide();
    this.campaignEnding.hide();
    this.pendingEndingTimer = -1;
    this.upgradeTree.hide();
    this.paused = true;
    this.labMap.show();
  }

  /** Start a run deployed into a conquered `sector`. */
  deployInto(sector: number): void {
    if (!this.canDeployInto(sector)) return;
    this.labSave.spawn = sector;
    this.save.save();
    this.startRun();
  }

  /**
   * A shot bounced off a world gate the squad has no keycard for. Enough of
   * them in a short while raise the "access needed" notice over the gate.
   */
  private onGateLocked(door: Door): void {
    const now = this.runStats.time;
    const notice = this.gateNotice;
    const showing = notice && now - notice.t0 < FACILITY.gateNoticeRise + FACILITY.gateNoticeHold + FACILITY.gateNoticeFade + 0.6;
    if (showing) return;
    this.gateHits.push(now);
    while (this.gateHits.length && now - this.gateHits[0] > FACILITY.gateHitWindow) this.gateHits.shift();
    if (this.gateHits.length < FACILITY.gateHitsForNotice) return;
    this.gateHits.length = 0;
    this.gateNotice = { door, t0: now };
    this.audio.playDoorOpen((door.x0 + door.x1 + 1) * this.world.cellSize / 2, (door.y0 + door.y1 + 1) * this.world.cellSize / 2);
  }

  /** Carry the squad on when a soldier walks into the passage beyond an open gate. */
  private updateGates(): void {
    const frame = this.world.labLayout?.frame;
    if (!frame || this.traveling || this.runOver) return;
    const portal = frame.def.teleporter;
    if (portal) {
      const at = sectorSpawnCell(frame, portal.sector), cs = this.world.cellSize;
      if (this.soldiers.some((s) => s.alive && Math.hypot(s.x - at.cx * cs, s.y - at.cy * cs) < cs * 2)) {
        this.travelToWorld(portal.to); return;
      }
    }
    for (const door of this.world.doors) {
      if (!door.gate || !door.open || door.gate.to < 1 || door.gate.to > LAB_WORLD_COUNT) continue;
      const g = frame.def.gates.find((x) => x.to === door.gate!.to);
      if (!g) continue;
      const { pocket } = gateGeometry(frame, g);
      const cs = this.world.cellSize;
      const through = this.soldiers.some((s) => {
        if (!s.alive) return false;
        const cx = Math.floor(s.x / cs);
        const cy = Math.floor(s.y / cs);
        return cx >= pocket.x0 && cx <= pocket.x1 && cy >= pocket.y0 && cy <= pocket.y1;
      });
      if (through) {
        this.travelToWorld(door.gate.to);
        return;
      }
    }
  }

  /**
   * Take the squad through a gate into world `id`: the iris closes, the new
   * world is built and the surviving soldiers arrive in its gateway room. The
   * run (its earnings and reserves) carries on.
   */
  travelToWorld(id: number): void {
    if (this.traveling || id < 1 || id > LAB_WORLD_COUNT || !Number.isInteger(id)) return;
    this.traveling = true;
    const lab = this.save.data.lab;
    lab.unlocked = Math.max(lab.unlocked, id);
    this.save.save();
    this.transition.close(0.6, () => {
      this.loot.clear();
      lab.world = id;
      this.labSave.spawn = this.labDef.start;
      this.save.save();
      this.loadLabProgress();
      this.generateLab();
      this.growth.reset();
      this.terrain.rebuildAll();
      this.refreshSectorThumbs();
      this.resetFog();
      this.resetFacility();
      for (const fl of this.flashes) {
        this.flashPolyPool.push(fl.poly);
        this.flashLitPool.push(fl.lit);
      }
      this.flashes = [];
      this.cellFlashes = [];
    this.doorFlashes = [];
      this.combat.clearAll();
      this.combat.resetTelemetry();
      this.particles.clear();
      this.damageNumbers.clear();
      this.fire.clear();
      this.casings.clear();
    this.subPixels.clear();
      this.loot.clear();
      // Arrive in a loose huddle in the gateway room.
      const cs = this.world.cellSize;
      const alive = this.soldiers.filter((s) => s.alive);
      alive.forEach((s, k) => {
        const a = (k / Math.max(1, alive.length)) * Math.PI * 2;
        const r = alive.length > 1 ? cs * 2 : 0;
        s.x = this.world.roomCenterX + Math.cos(a) * r;
        s.y = this.world.roomCenterY + Math.sin(a) * r;
        s.dashLeft = s.dashCooldown = 0;
        s.dashAfterimage = false;
        s.formationAvoidSign = 0;
        const speed = Math.hypot(s.vx, s.vy);
        if (speed > 1e-6) { s.vx *= s.speed / speed; s.vy *= s.speed / speed; }
      });
      this.soldiers = alive;
      this.camera.reset();
      this.camera.setViewport(this.canvas.clientWidth, this.canvas.clientHeight);
      this.traveling = false;
      this.transition.reveal(0.9);
    });
  }

  /** Discover sectors the squad stands in, conquer cleared ones, and save progress. */
  private updateLabProgress(dt: number): void {
    this.labCheckT -= dt;
    if (this.labCheckT > 0 || !this.world.labLayout?.frame) return;
    this.labCheckT = 0.5;
    const cs = this.world.cellSize;
    const cells: { cx: number; cy: number }[] = [];
    for (const s of this.soldiers) if (s.alive) cells.push({ cx: Math.floor(s.x / cs), cy: Math.floor(s.y / cs) });
    if (!this.labProgress.update(cells)) return;
    const lab = this.labSave;
    lab.discovered = [...this.labProgress.discovered].sort((a, b) => a - b);
    lab.conquered = [...this.labProgress.conquered].sort((a, b) => a - b);
    this.save.save();
  }

  /** Bank currency & lifetime pixels earned in the current run (idempotent per run). */
  bankCurrentRun(): { time: boolean; depth: boolean; pixels: boolean } {
    if (!this.runStarted) return { time: false, depth: false, pixels: false };
    this.syncSpeedrun();
    this.loot.clear();
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
      this.save.data.biomass += r.biomass;
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
    this.beginDeploy();
  }

  togglePauseMenu(show?: boolean): void {
    if (this.runOver || this.upgradeTree.visible || this.mainMenu.visible || this.labMap.visible) return;
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
    this.campaignEnding.hide();
    this.pendingEndingTimer = -1;
    this.mainMenu.hide();
    this.paused = true;
    this.upgradeTree.show();
    this.hud.update(this, performance.now(), true);
  }

  selectSaveSlot(slot: number): void {
    this.syncSpeedrun();
    if (this.save.slotExists(this.save.activeSlot)) this.save.save();
    this.runStarted = false;
    this.save.selectSlot(slot);
    this.syncSpeedrun();
    this.debug = this.save.data.settings.devMode;
    this.timeScale = 1;
    this.showChunkBorders = false;
    this.loadLabProgress();
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
    this.campaignEnding.hide();
    this.pendingEndingTimer = -1;
    this.upgradeTree.hide();
    this.labMap?.hide();
    this.paused = true;
    this.mainMenu.show();
    this.hud.update(this, performance.now(), true);
  }

  private onKey(code: string): void {
    if (this.labMap.visible) {
      this.labMap.onKey(code);
      return;
    }
    if (this.upgradeTree.visible) {
      if (code === "Space" || code === "Enter") {
        this.upgradeTree.onPrimaryAction();
      } else if (code === "Escape" || code === "KeyU") {
        this.upgradeTree.closeAndDeploy();
      }
      return;
    }
    if (this.mainMenu.visible) {
      this.mainMenu.onKey(code);
      return;
    }
    switch (code) {
      case "KeyF":
        if (!this.autoMove) this.cycleCommander();
        else this.camera.resumeAuto();
        break;
      case "Tab":
        if (!this.autoMove) this.cycleCommander();
        else this.camera.cycleTarget(this.soldiers);
        break;
      case "Space":
        if (!this.runOver && !this.pauseMenu.visible) this.paused = !this.paused;
        break;
      case "Escape":
        if (this.aimState.active) this.onAimCancel();
        else if (this.resultsScreen.visible) this.beginDeploy();
        else this.togglePauseMenu();
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
        if (this.save.data.settings.devMode) this.debug = !this.debug;
        break;
    }
    this.hud.update(this, performance.now(), true);
  }

  canPlaceSoldier(): boolean {
    return !this.paused && !this.runOver && this.reserves > 0 && !this.portal;
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
  }

  /** Tap and let go: open the squad's portal on that spot. */
  onAimClick(_sx: number, _sy: number): void {
    if (!this.aimState.active) return;
    this.aimState.active = false;
    this.aimState.isDragging = false;
    this.openPortal(this.aimState.startWx, this.aimState.startWy);
  }

  /** There is no aiming any more: a press that ends elsewhere still opens the portal where it began. */
  onAimRelease(_startSx: number, _startSy: number, _endSx: number, _endSy: number): void {
    this.onAimClick(0, 0);
  }

  onAimCancel(): void {
    this.aimState.active = false;
    this.aimState.isDragging = false;
  }

  /**
   * True when Blight Wardens still guard the zone holding world point (wx, wy):
   * in the hand-made lab, any sector whose gold block has a living Warden; in
   * small test worlds, the ground within a Warden's leash of its block.
   */
  spawnGuardedAt(wx: number, wy: number): boolean {
    return this.wardens.guardsZoneAt(wx, wy);
  }

  /**
   * Open a portal at world point (wx, wy) and send the whole reserve through
   * it. Refused (with a red mark on the spot) inside a Warden-guarded zone or
   * where no clear ground is near. Returns the portal, or null if refused.
   */
  openPortal(wx: number, wy: number): SpawnPortal | null {
    if (!this.canPlaceSoldier()) return null;
    const spot = this.clearDeploySpot(wx, wy);
    if (!spot || this.spawnGuardedAt(spot.x, spot.y)) {
      this.spawnDenied = { x: spot?.x ?? wx, y: spot?.y ?? wy, t0: performance.now() / 1000, guarded: !!spot };
      return null;
    }
    this.spawnDenied = null;
    this.portal = new SpawnPortal(spot.x, spot.y, this.reserves);
    this.audio.playMarkerPing(spot.x, spot.y);
    return this.portal;
  }

  /** Step the open portal: operators come through on schedule, then it shuts. */
  private updatePortal(dt: number): void {
    const p = this.portal;
    if (!p) return;
    const alive = p.update(dt, (_k, dx, dy) => {
      this.deploySoldier(p.x, p.y, dx, dy);
    });
    if (!alive) this.portal = null;
  }

  /** Nearest spot to (wx, wy), inside the world, with clearance for a soldier. */
  private clearDeploySpot(wx: number, wy: number): { x: number; y: number } | null {
    const cs = this.world.cellSize;
    const r = SOLDIER.collisionRadius;
    const maxX = this.world.width * cs - r;
    const maxY = this.world.height * cs - r;
    return findClearDeployPoint(
      this.world,
      Math.max(r, Math.min(maxX, wx)),
      Math.max(r, Math.min(maxY, wy)),
      r,
      SOLDIER.deployClearance,
    );
  }

  /** Deploy a reserve soldier at world coordinates (wx, wy) with direction (dx, dy). */
  deploySoldier(wx: number, wy: number, dx: number, dy: number): Soldier | null {
    if (this.paused || this.runOver || this.reserves <= 0) return null;

    // Never drop a soldier inside terrain: nudge it to the nearest spot with at
    // least a pixel of clearance from every wall, or keep it in reserve.
    const spot = this.clearDeploySpot(wx, wy);
    if (!spot) return null;
    const clampedX = spot.x;
    const clampedY = spot.y;

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
    s.mutation = resolvePrimaryMutation(weapon,this.save.data.loadouts[slotIdx]?.mutation,this.stats);
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

  /** The HUD's deploy button: open the portal at the current landing spot. */
  deployAtLandingSpot(): void {
    if (!this.canPlaceSoldier()) return;
    const spawn = findSpawnPoint(this.world, SOLDIER.collisionRadius) ?? {
      x: this.camera.x,
      y: this.camera.y,
    };
    this.openPortal(spawn.x, spawn.y);
  }

  isWeaponUnlocked(w: Soldier["weapon"]): boolean {
    switch (w) {
      case "pistol":
        return true;
      case "shotgun":
        return this.stats.shotgunUnlocked;
      case "squelch":
        return this.stats.gooUnlocked;
      case "assault_rifle":
        return this.stats.arUnlocked;
      case "rocket_launcher":
        return this.stats.rocketUnlocked;
      case "sniper_rifle":
        return this.stats.sniperUnlocked;
      case "katana":
        return this.stats.katanaUnlocked;
      case "flamethrower":
        return this.stats.flameUnlocked;
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

  private releaseManualControl(s: Soldier): void {
    // Hand the soldier back to autonomous bounce in a fresh random direction
    // (it may have been standing still or crawling along a wall under manual control).
    s.isManual = false;
    s.wasManualShooting = false;
    this.combat.cancelRailCharge(s);
    const a = this.rng.range(0, Math.PI * 2);
    s.vx = Math.cos(a) * s.speed;
    s.vy = Math.sin(a) * s.speed;
    s.facingAngle = a;
  }

  setAutoMove(enabled: boolean): void {
    this.autoMove = enabled;
    this.save.data.settings.autoMove = enabled;
    this.save.save();
    if (enabled) {
      const cmdr = this.getCommander();
      if (cmdr) this.releaseManualControl(cmdr);
    } else {
      const cmdr = this.getCommander();
      if (cmdr) {
        this.camera.lockOn(cmdr.id);
      }
    }
  }

  /** Switch manual commander control to the next living soldier in deploy-slot order. */
  cycleCommander(): void {
    const living = this.soldiers
      .filter((s) => s.alive)
      .sort((a, b) => a.slotIndex - b.slotIndex || a.id - b.id);
    if (living.length === 0) return;

    const current = this.getCommander();
    const idx = current ? living.findIndex((s) => s.id === current.id) : -1;
    const next = living[(idx + 1) % living.length];

    if (current && current !== next) {
      this.releaseManualControl(current);
      this.commanderTrail.length = 0;
    }

    this.commanderId = next.id;
    next.isManual = true;
    this.camera.lockOn(next.id);
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
    const chosen = living.find((s) => s.id === this.commanderId) ?? living[0];
    this.commanderId = chosen.id;
    return chosen;
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
    if (commander.weapon === "sniper_rifle" && commander.mutation === "rail_lance") {
      if (!commander.railCharging) {
        commander.railCharging = true;
        commander.railCharge = 0;
        commander.railChargeTotal = 1 / Math.max(0.05, this.combat.effectiveFireRate(commander));
        commander.railLockDx = Math.cos(commander.facingAngle);
        commander.railLockDy = Math.sin(commander.facingAngle);
      }
      return;
    }
    if (commander.fireCooldown <= 0) {
      const cdx = Math.cos(commander.facingAngle);
      const cdy = Math.sin(commander.facingAngle);
      this.combat.fire(commander, cdx, cdy);
      this.onShot(commander, cdx, cdy, commander.x, commander.y);
      const rate = this.combat.effectiveFireRate(commander);
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
    if (s.weapon === "sniper_rifle" && s.mutation === "chromatic_prism") { this.audio.playPrism(mx, my); return; }
    if (s.weapon === "pistol" && s.mutation === "drone_shepherd") return;
    if (s.weapon === "squelch") {
      this.audio.playGoo("launch", mx, my);
      return;
    }
    if (s.weapon === "flamethrower") {
      if (s.mutation === "cryospray" || s.mutation === "napalm_garden") return;
      // No white muzzle flash: the stream lights its surroundings with warm firelight.
      this.audio.playFlame(mx, my);
      this.fire.nozzle(s.id, mx + dx * 10, my + dy * 10);
      return;
    }
    if (s.weapon === "katana") {
      this.audio.playSlash(mx, my);
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
    this.audio.playShot(mx, my);
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
    if (destroyed) this.audio.playDestroy(x, y);
    else if (result === 1) this.audio.playImpact(x, y);
    const n = destroyed ? 10 : 4;
    for (let i = 0; i < n; i++) {
      const a = Math.atan2(ny, nx) + this.rng.range(-1.1, 1.1);
      const sp = this.rng.range(40, destroyed ? 150 : 110);
      this.particles.spawn(PKind.Spark, x, y, Math.cos(a) * sp, Math.sin(a) * sp, this.rng.range(0.08, 0.2), 1, sub ? 0xff6ab8 : 0xffc070, 8);
    }
    if (sub) {
      // A 50% sub-pixel (pink core blight or rubble): debris, quarter-cell loot odds, no normal terrain stats.
      if (destroyed) {
        const ss = this.world.subCellSize;
        const si = Math.floor(y / ss) * this.world.subWidth + Math.floor(x / ss);
        const sk = this.world.subKind[si];
        const rubble = sk !== SUB.blight;
        for (let i = 0; i < 3; i++) {
          const a = Math.atan2(ny, nx) + this.rng.range(-1.3, 1.3);
          const sp = this.rng.range(20, 70);
          this.particles.spawn(PKind.Debris, x, y, Math.cos(a) * sp, Math.sin(a) * sp, this.rng.range(0.3, 0.6), 1, sk === SUB.pipe ? 0xac7646 : sk === SUB.wreck ? 0x3a3640 : sk === SUB.core ? 0x9a6ae0 : sk >= SUB.metal ? 0x60708a : rubble ? 0x6a625a : 0xd8267a, 4);
        }
        const subZone = this.world.zoneAt(cx, cy);
        const subLoot = this.terrainLoot(cx, cy, subZone);
        this.loot.spawnDropsForBlock(x, y, this.dropChanceFor(subLoot.kind, ownerId) * 0.25, this.stats.pickupLifetime, this.rng, subLoot.kind, subLoot.value);
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
      const zone = this.world.zoneAt(cx, cy);
      const blockLoot = this.terrainLoot(cx, cy, zone);
      const lootKind = blockLoot.kind;
      const ci = cy * this.world.width + cx;
      if (this.labDef.framework) {
        const reward = lateBlockReward(this.world.fillTierAt(cx, cy));
        this.loot.spawnDropsForBlock(ccx, ccy, LATE_DROP_CHANCE * (1 + this.kindBonus(reward.kind)), this.stats.pickupLifetime, this.rng, reward.kind, reward.value);
      } else if (this.world.mat[ci] === MAT.crystal) {
        // A rich vein: several pickups of this world's currency at the vein's tier value.
        this.world.mat[ci] = MAT.none;
        const veinTier = this.world.tierBase + Math.max(1, this.world.wall[ci]);
        const veinKind = this.world.labLayout?.frame ? worldLootKind(this.labDef.id) : lootKindForZone(Math.max(1, Math.min(2, this.world.wall[ci] - 1)));
        this.loot.spawnDropsForBlock(
          ccx,
          ccy,
          VEIN_DROPS * (this.dropChanceFor(veinKind, ownerId) / Math.max(1e-6, this.stats.dropChance)),
          this.stats.pickupLifetime,
          this.rng,
          veinKind,
          this.world.labLayout?.frame ? tierLootValue(veinTier) : 1,
        );
      } else {
        this.loot.spawnDropsForBlock(
          ccx,
          ccy,
          this.dropChanceFor(lootKind, ownerId),
          this.stats.pickupLifetime,
          this.rng,
          lootKind,
          blockLoot.value,
        );
      }
      const destroyedCore = this.world.checkCoreDestroyedAt(cx, cy);
      if (destroyedCore) {
        const small = destroyedCore.size === 1;
        this.growth.reduceBlightTimer(
          this.runStats.time,
          this.stats.coreTimeReduction * (small ? FACILITY.smallCoreTimeMult : 1),
        );
        this.growthRate = this.growth.rate;
        // Center of the core: the shared corner of a 2×2 core, the middle of a 1×1 generator.
        const coreWx = (destroyedCore.cx + destroyedCore.size / 2) * cs;
        const coreWy = (destroyedCore.cy + destroyedCore.size / 2) * cs;
        const burst = small ? Math.ceil(this.stats.coreLootBurst / 2) : this.stats.coreLootBurst;
        for (let i = 0; i < burst; i++) {
          this.loot.spawnOne(coreWx, coreWy, this.stats.pickupLifetime, this.rng, lootKind, blockLoot.value);
        }
        const essenceLife = this.stats.pickupLifetime * LOOT.essenceLifetimeMult;
        const essence = small ? Math.ceil(LOOT.coreEssence[destroyedCore.zone] / 3) : LOOT.coreEssence[destroyedCore.zone];
        for (let i = 0; i < essence; i++) {
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

  private onExplosion(x: number, y: number, radiusWorld: number, damage = 6 + this.stats.globalDamageBonus, visualOnly = false): void {
    if (!visualOnly && damage > 0) {
      this.creatures.explode(x, y, radiusWorld, damage);
      this.late.explode(x, y, radiusWorld, damage);
      this.wardens.explode(x, y, radiusWorld, damage);
      this.specials.explode(x, y, radiusWorld);
    }
    this.fixtures.explode(x, y, radiusWorld);
    this.audio.playDestroy(x, y);
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

  /**
   * What an ordinary block at cell `(cx, cy)` drops. A hand-made world's
   * terrain drops only that world's currency, in bigger stacks at deeper
   * tiers (see world/tierEconomy.ts). Procedural test worlds keep the old
   * gold / orange / green by zone.
   */
  private terrainLoot(cx: number, cy: number, zone: number): { kind: LootKind; value: number } {
    if (this.labDef.framework && this.world.labLayout?.frame) return lateBlockReward(this.world.fillTierAt(cx, cy));
    if (!this.world.labLayout?.frame) return { kind: lootKindForZone(zone), value: 1 };
    return { kind: worldLootKind(this.labDef.id), value: tierLootValue(this.world.fillTierAt(cx, cy)) };
  }

  /** Resource-tree yield bonus for one currency. */
  private kindBonus(kind: LootKind): number {
    if (kind === LootKind.Crystal) return this.stats.crystalDropBonus;
    if (kind === LootKind.GreenCrystal) return this.stats.tier3ResourceBonus;
    return 0;
  }

  /** A destroyed block's drop chance for a currency, then the soldier who broke it. */
  private dropChanceFor(kind: LootKind, ownerId: number): number {
    let chance = this.stats.dropChance * (1 + this.kindBonus(kind));
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
      this.audio.playShot(soldier.x, soldier.y);
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
    this.audio.playShot(x, y);
    for (let i = 0; i < 4; i++) {
      const a = Math.atan2(dy, dx) + this.rng.range(-0.4, 0.4);
      const sp = this.rng.range(15, 35);
      this.particles.spawn(PKind.Smoke, x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.25, 2, 0x4a5a6a, 2);
    }
  }

  private onGrenadeStick(x: number, y: number, nx: number, ny: number): void {
    this.audio.playImpact(x, y);
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
    this.combat.orbit.clearFor(s.id);
    this.combat.debris.releaseFor(s.id);
    s.railCharging = false;
    this.audio.playSoldierDeath(s.x, s.y);
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
    this.audio.playImpact(fromWx, fromWy);
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

  /**
   * A creature's bite or spore. Soldier health soaks hits first; a soldier
   * with none left (or none to begin with) dies on the next one.
   */
  private hurtSoldier(s: Soldier, damage: number, x: number, y: number): void {
    if (!s.alive) return;
    if (s.health > 0) {
      s.health = Math.max(0, s.health - damage);
      this.audio.playImpact(s.x, s.y);
      for (let i = 0; i < 6; i++) {
        const a = Math.atan2(s.y - y, s.x - x) + this.rng.range(-1, 1);
        const sp = this.rng.range(30, 90);
        this.particles.spawn(PKind.Spark, s.x, s.y, Math.cos(a) * sp, Math.sin(a) * sp, 0.2, 1, 0xff4b8b, 5);
      }
      return;
    }
    s.alive = false;
    this.onSoldierKilled(s);
  }

  private onCreatureHit(x: number, y: number, nx: number, ny: number): void {
    this.audio.playImpact(x, y);
    for (let i = 0; i < 5; i++) {
      const a = Math.atan2(ny, nx) + this.rng.range(-1.2, 1.2);
      const sp = this.rng.range(30, 100);
      this.particles.spawn(PKind.Spark, x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.15, 1, 0xff6ab8, 6);
    }
  }

  private onSporeBurst(x: number, y: number, r: number): void {
    for (let i = 0; i < 14; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const sp = this.rng.range(15, r * 7);
      this.particles.spawn(PKind.Spark, x, y, Math.cos(a) * sp, Math.sin(a) * sp, this.rng.range(0.2, 0.45), 1, i % 2 ? 0xff4b8b : 0xffc0e0, 5);
    }
    this.particles.spawn(PKind.Burst, x, y, 0, 0, 0.25, r, 0xff4b8b, 1);
  }

  /** Splatter, and a little loot for the trouble. */
  private onCreatureKilled(c: Creature, x: number, y: number): void {
    this.audio.playDestroy(x, y);
    const col = c.kind === "specimen" ? 0x56c49a : 0xd8267a;
    for (let i = 0; i < 16; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const sp = this.rng.range(20, 110);
      this.particles.spawn(PKind.Debris, x, y, Math.cos(a) * sp, Math.sin(a) * sp, this.rng.range(0.3, 0.7), 1, col, 4);
    }
    const cx = Math.floor(x / this.world.cellSize);
    const cy = Math.floor(y / this.world.cellSize);
    const loot = this.terrainLoot(cx, cy, this.world.zoneAt(cx, cy));
    const chance = c.kind === "flower" ? 0.6 : c.kind === "worm" ? 1 : 2;
    this.loot.spawnDropsForBlock(x, y, chance, this.stats.pickupLifetime, this.rng, loot.kind, loot.value);
  }

  /** A Blight Warden fell: a burst of pink gore and a heavy drop of its zone's loot. */
  private onWardenKilled(w: Warden): void {
    this.audio.playDestroy(w.x, w.y);
    this.addScreenShake(4);
    for (let i = 0; i < 28; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const sp = this.rng.range(25, 140);
      this.particles.spawn(PKind.Debris, w.x, w.y, Math.cos(a) * sp, Math.sin(a) * sp, this.rng.range(0.35, 0.8), 1, i % 3 ? 0xd8267a : 0x5a0f36, 4);
    }
    this.particles.spawn(PKind.Burst, w.x, w.y, 0, 0, 0.25, 16, 0xff4b8b, 1);
    const cx = Math.floor(w.x / this.world.cellSize);
    const cy = Math.floor(w.y / this.world.cellSize);
    const loot = this.terrainLoot(cx, cy, this.world.zoneAt(cx, cy));
    this.loot.spawnDropsForBlock(w.x, w.y, 8, this.stats.pickupLifetime, this.rng, loot.kind, loot.value);
  }

  /** A dormant pixel crumbled to Necrosis Protocol: a puff of dark dust. */
  private onBlightDecay(sx: number, sy: number): void {
    if (this.rng.next() > 0.35) return;
    const ss = this.world.subCellSize;
    const x = (sx + 0.5) * ss;
    const y = (sy + 0.5) * ss;
    this.particles.spawn(PKind.Debris, x, y, this.rng.range(-12, 12), this.rng.range(-18, 4), this.rng.range(0.4, 0.8), 1, 0x3a2a4a, 4);
  }

  /** The Blight hit overdrive (walls start replicating) or was beaten back below it. */
  private onOverdrive(on: boolean): void {
    if (!on) return;
    this.audio.playOverdrive();
    this.addScreenShake(6);
  }

  /** Fresh doors, glass and dormant sentries for a newly generated facility. */
  private resetFacility(): void {
    this.late.reset(this.labSave.cleared, this.labSave.gathered);
    this.labProgress.attachThreats(this.late.actors);
    this.fixtures.reset();
    this.specials.reset(this.labSave.specials);
    this.wardens.reset(this.specials.blocks);
    this.specialNotice = null;
    this.glass.reset();
    this.doors.reset();
    this.sentries.reset();
    this.creatures.reset();
    this.applyFacilityStats();
  }

  /**
   * Every gold mote from a special-upgrade block reached its soldier: record
   * it so the block stays gone (and its upgrade can now be bought in the
   * upgrade tree, see progression/specialUnlocks.ts), and celebrate.
   */
  private grantSpecialUpgrade(id: string, soldier: Soldier): void {
    const list = this.labSave.specials;
    if (!list.includes(id)) {
      list.push(id);
      this.save.save();
    }
    const unlock = SPECIAL_UNLOCKS[id];
    const label = unlock ? UPGRADE_BY_ID[unlock].name.replace(/^Unlock /, "") : "Special Upgrade";
    this.specialNotice = { soldier, t0: this.runStats.time, label: label.toUpperCase() };
    this.audio.playPurchase(soldier.x, soldier.y);
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2, sp = this.rng.range(70, 130);
      this.particles.spawn(PKind.Spark, soldier.x, soldier.y, Math.cos(a) * sp, Math.sin(a) * sp, this.rng.range(0.25, 0.45), 1, i % 2 ? 0xffd75a : 0xfff1b0, 5);
    }
    this.particles.spawn(PKind.Burst, soldier.x, soldier.y, 0, 0, 0.3, 20, 0xffd75a, 1);
  }

  /** Keycards and sentry upgrades from the research-base tree. */
  private applyFacilityStats(): void {
    this.world.keycardTier = this.stats.keycardTier;
    this.sentries.enabled = this.stats.sentryUplink;
    this.sentries.damage = this.stats.sentryDamage + this.stats.globalDamageBonus;
    this.sentries.fireRate = this.stats.sentryFireRate;
  }

  /** A pane burst in a glass chain: glittering shards, no loot. */
  private onGlassShatter(cx: number, cy: number): void {
    this.audio.playGlassShatter((cx + 0.5) * this.world.cellSize, (cy + 0.5) * this.world.cellSize);
    const cs = this.world.cellSize;
    const x = (cx + 0.5) * cs;
    const y = (cy + 0.5) * cs;
    for (let i = 0; i < 4; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const sp = this.rng.range(30, 110);
      this.particles.spawn(PKind.Spark, x, y, Math.cos(a) * sp, Math.sin(a) * sp, this.rng.range(0.15, 0.35), 1, i % 2 ? 0xbfefff : 0x7fd4e8, 6);
    }
    this.cellFlashes.push({ cx, cy, life: TERRAIN.hitFlashTime * 2, maxLife: TERRAIN.hitFlashTime * 2, destroyed: true });
  }

  /** One fixed simulation step. */
  /** Back to a dark map, with the spawn room already lit so the iris opens on it. */
  private resetFog(): void {
    this.fog.reset(this.rng.int(1 << 30));
    this.fog.permanent = this.stats.permanentMapping;
    this.fog.connectedAir = this.stats.connectedAirMapping;
    this.fog.wallPenetrationCells = this.stats.betterFlashlight
      ? LIGHT.betterFlashlightWallWeights.length
      : 0;
    this.lighting.soldierLightRadius = this.stats.betterFlashlight
      ? LIGHT.betterFlashlightRadius
      : LIGHT.soldierLightRadius;
    this.lighting.soldierLightStrength = this.stats.betterFlashlight
      ? LIGHT.betterFlashlightStrength
      : LIGHT.soldierLightStrength;
    this.lighting.soldierWallDepth = this.stats.betterFlashlight
      ? LIGHT.betterFlashlightWallWeights.length
      : 1;
    for (let i = 0; i < 40; i++) this.updateFog(0.1, true);
  }

  /** Feed this frame's eyes (soldiers, turrets, the spawn room) into the fog. */
  private updateFog(dt: number, roomOnly = false): void {
    const src = this.sightSources;
    let n = 0;
    const take = (): SightSource => {
      if (n === src.length) src.push({ x: 0, y: 0, radiusCells: 0 });
      const source = src[n++];
      source.facingAngle = undefined;
      source.airSeed = false;
      return source;
    };
    const w = this.world;
    const room = take();
    room.x = w.roomCenterX;
    room.y = w.roomCenterY;
    room.radiusCells = w.roomSize * 0.5 + 2;
    if (w.startingTube) {
      const core = w.blightCores[w.startingTube.coreId - 1];
      const containment = take();
      containment.x = (core.cx + 0.5) * w.cellSize;
      containment.y = (core.cy + 0.5) * w.cellSize;
      containment.radiusCells = 7;
    }
    if (!roomOnly) {
      for (const s of this.soldiers) {
        if (!s.alive) continue;
        const e = take();
        e.x = s.x;
        e.y = s.y;
        e.radiusCells = this.stats.sightCells;
        e.facingAngle = s.facingAngle;
        e.airSeed = true;
      }
      for (const t of this.combat.turrets.items) {
        if (!t.active) continue;
        const e = take();
        e.x = t.x;
        e.y = t.y;
        e.radiusCells = FOG.turretSightCells;
      }
      for (const t of this.sentries.sentries) {
        if (!t.awake) continue;
        const e = take();
        e.x = t.x;
        e.y = t.y;
        e.radiusCells = FOG.turretSightCells;
      }
    }
    src.length = n;
    this.fog.update(dt, src);
  }

  step(dt: number): void {
    this.updatePortal(dt);
    if (this.runStats.soldiersDeployed === 0) return;
    this.runStats.time += dt;
    this.updateLabProgress(dt);
    this.updateGates();

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
      if (commander.weapon === "sniper_rifle" && commander.mutation === "rail_lance") {
        if (shouldShoot) {
          const cdx = Math.cos(commander.facingAngle);
          const cdy = Math.sin(commander.facingAngle);
          if (this.combat.advanceRailCharge(commander, dt, cdx, cdy)) {
            this.onShot(commander, commander.railLockDx, commander.railLockDy, commander.x, commander.y);
          }
        } else {
          this.combat.cancelRailCharge(commander);
        }
      } else if (shouldShoot && commander.fireCooldown <= 0) {
        this.shootCommanderManual(commander);
      }
      if (commander.weapon === "pistol" && commander.mutation === "orbit_cylinder") {
        if ((!shouldShoot && commander.wasManualShooting) || (shouldShoot && this.save.data.settings.alwaysShootWhenAutoMoveOff && this.combat.orbit.isFull(commander.id))) {
          this.combat.releaseOrbitManual(commander);
        }
        commander.wasManualShooting = shouldShoot;
      }

      // Ensure camera tracks commander
      this.camera.lockOn(commander.id);
    } else {
      for (const s of this.soldiers) s.isManual = false;
    }

    if (commander) this.stepFormation(dt, commander);

    this.dualStick.update();

    this.combat.debris.update(dt, this.soldiers);
    this.combat.orbit.update(dt, this.soldiers);

    for (const s of this.soldiers) {
      if (!s.alive) continue;
      s.age += dt;
      this.physics.step(
        s,
        dt,
        this.stats,
        (soldier) => {
          this.combat.telemetry.katanaDashes++;
          this.audio.playSlash(soldier.x, soldier.y);
          this.particles.spawn(PKind.Burst, soldier.x, soldier.y, 0, 0, 0.12, 10, 0x83ecff, 8);
        },
        (soldier, nx, ny) => {
          this.combat.onSoldierBounce(soldier, nx, ny);
        },
        (soldier, sx, sy) => this.combat.crushSubcell(soldier, sx, sy),
      );
      if (s.dashLeft > 0) this.combat.telemetry.katanaBoostedSeconds += dt;
      this.combat.updateSoldier(s, dt);
    }
    // Soldier-to-soldier soft separation to prevent clustering, jamming, or stacking
    const livingSoldiers = this.soldiers.filter((s) => s.alive);
    for (let i = 0; i < livingSoldiers.length; i++) {
      const a = livingSoldiers[i];
      for (let j = i + 1; j < livingSoldiers.length; j++) {
        const b = livingSoldiers[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const minDist = a.radius + b.radius + 1;
        const dist2 = dx * dx + dy * dy;
        if (dist2 < minDist * minDist && dist2 > 1e-4) {
          const dist = Math.sqrt(dist2);
          const push = (minDist - dist) * 0.5;
          const nx = dx / dist;
          const ny = dy / dist;
          if (circleIsClear(this.world, a.x - nx * push, a.y - ny * push, a.radius)) {
            a.x -= nx * push;
            a.y -= ny * push;
          }
          if (circleIsClear(this.world, b.x + nx * push, b.y + ny * push, b.radius)) {
            b.x += nx * push;
            b.y += ny * push;
          }
        }
      }
    }
    this.combat.updateBullets(dt);
    this.fire.update(dt, this.combat.bullets.items);
    this.combat.updateGrenades(dt);
    this.combat.goo.update(dt);
    this.combat.drones.update(dt);
    this.combat.laser.update(dt);
    this.combat.updateTurrets(dt);
    this.glass.update(dt, this.growth.overdrive);
    this.late.update(dt, this.soldiers);
    if (this.pendingEndingTimer > 0) {
      this.pendingEndingTimer -= dt;
      if (this.pendingEndingTimer <= 0) {
        this.pendingEndingTimer = -1;
        const alive = this.soldiers.filter((s) => s.alive).length;
        const soldiersLost = Math.max(0, this.runStats.soldiersDeployed - alive);
        this.campaignEnding.show({ time: this.runStats.time, soldiersLost, essence: this.runStats.essence });
      }
    }
    this.creatures.update(dt, this.runStats.time, this.soldiers, this.growth);
    this.doors.update(dt);
    this.sentries.update(dt, this.soldiers, (x, y, dx, dy, dmg) => this.combat.fireTurretShot(0, x, y, dx, dy, dmg));
    this.wardens.update(dt, this.soldiers);
    this.specials.update(dt);
    const fogStart = performance.now();
    this.updateFog(dt);
    const growthStart = performance.now();
    const metrics = this.frameTimings.current;
    metrics.fogUpdateMs += growthStart - fogStart;
    metrics.airMappingMs += this.fog.airMetrics.updateMs;
    metrics.airFloods += this.fog.airMetrics.floods;
    metrics.airCellsVisited += this.fog.airMetrics.visitedCells;
    metrics.mappedAirTiles = this.fog.airMetrics.mappedTiles;
    if (!this.labDef.framework) this.growth.update(dt, this.runStats.time, this.soldiers);
    metrics.growthUpdateMs += performance.now() - growthStart;
    this.growthRate = this.growth.rate;
    this.runStats.recordSampleIfDue(this.growthRate);
    this.particles.update(dt);
    this.damageNumbers.update(dt);
    this.casings.update(dt, this.world);
    const subStart = performance.now();
    this.subPixels.update(dt, this.soldiers);
    this.lighting.invalidateMovingSubPixels();
    metrics.subPixelSimulationMs += performance.now() - subStart;
    const collected = this.loot.update(dt, this.soldiers, this.stats.magnetRange, (x, y) => this.audio.playPickup(x, y));
    if (collected > 0) {
      this.runStats.currency += this.loot.collectedGold;
      this.runStats.crystals += this.loot.collectedCrystals;
      this.runStats.greenCrystals += this.loot.collectedGreenCrystals;
      this.runStats.essence += this.loot.collectedEssence;
      this.runStats.biomass += this.loot.collectedBiomass;
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
    for (let i = this.doorFlashes.length - 1; i >= 0; i--) {
      const df = this.doorFlashes[i];
      if (df.delay > 0) {
        df.delay -= dt;
        continue;
      }
      if ((df.life -= dt) <= 0) this.doorFlashes.splice(i, 1);
    }
    if (this.doorFlashes.length > 256) this.doorFlashes.splice(0, this.doorFlashes.length - 256);
    this.canDeploy = this.reserves > 0 && !this.portal;

    // Once deployment has begun, losing the last active soldier ends the run,
    // even when undeployed reserves remain.
    const alive = this.soldiers.some((s) => s.alive);
    if (!alive && this.runStats.soldiersDeployed > 0 && !this.portal) {
      this.endRun();
    }
  }

  stepFormation(_dt: number, commander: Soldier): void {
    if (this.activeFormation === "none" || !commander) {
      this.commanderTrail.length = 0;
      for (const s of this.soldiers) s.isInFormation = false;
      return;
    }

    // Maintain breadcrumb trail of commander positions
    if (
      this.commanderTrail.length === 0 ||
      Math.hypot(
        commander.x - this.commanderTrail[this.commanderTrail.length - 1].x,
        commander.y - this.commanderTrail[this.commanderTrail.length - 1].y,
      ) >= 8
    ) {
      this.commanderTrail.push({ x: commander.x, y: commander.y });
      if (this.commanderTrail.length > 50) this.commanderTrail.shift();
    }

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
        let sideDist = side * row * 14;
        let candX = commander.x - cdx * backDist - cdy * sideDist;
        let candY = commander.y - cdy * backDist + cdx * sideDist;
        // Compression: if the flank target is obstructed by walls or cover,
        // compress inward toward the center line to fit through narrow passages.
        if (!circleIsClear(this.world, candX, candY, f.radius)) {
          sideDist *= 0.4;
          candX = commander.x - cdx * backDist - cdy * sideDist;
          candY = commander.y - cdy * backDist + cdx * sideDist;
          if (!circleIsClear(this.world, candX, candY, f.radius)) {
            // Full collapse to single-file trail behind commander
            candX = commander.x - cdx * spacing * (i + 1);
            candY = commander.y - cdy * spacing * (i + 1);
          }
        }
        tx = candX;
        ty = candY;
      }

      // Obstacle-aware navigation: check direct line-of-sight to target
      let steerX = tx;
      let steerY = ty;
      if (!hasCircleLineOfSight(this.world, f.x, f.y, tx, ty, f.radius)) {
        // 1) Search breadcrumbs from newest to oldest for one visible to follower
        let foundBreadcrumb = false;
        for (let bIdx = this.commanderTrail.length - 1; bIdx >= 0; bIdx--) {
          const pt = this.commanderTrail[bIdx];
          if (
            Math.hypot(pt.x - f.x, pt.y - f.y) > 4 &&
            hasCircleLineOfSight(this.world, f.x, f.y, pt.x, pt.y, f.radius)
          ) {
            steerX = pt.x;
            steerY = pt.y;
            foundBreadcrumb = true;
            break;
          }
        }
        // 2) If no breadcrumb is visible (e.g. commander stopped or jumped),
        // probe tangential flanking rays around obstacle contour
        if (!foundBreadcrumb) {
          const directDx = tx - f.x;
          const directDy = ty - f.y;
          const directDist = Math.hypot(directDx, directDy) || 1;
          const nx = directDx / directDist;
          const ny = directDy / directDist;
          // Test lateral angles on both sides
          let bestAngDist = Infinity;
          let chosenSign = 0;
          for (const sign of [-1, 1]) {
            if (f.formationAvoidSign !== 0 && sign !== f.formationAvoidSign) continue;
            for (const deg of [30, 60, 85, 90, 110]) {
              const rad = (deg * Math.PI) / 180 * sign;
              const cosA = Math.cos(rad);
              const sinA = Math.sin(rad);
              const probeX = f.x + (nx * cosA - ny * sinA) * Math.min(24, directDist);
              const probeY = f.y + (nx * sinA + ny * cosA) * Math.min(24, directDist);
              if (
                circleIsClear(this.world, probeX, probeY, f.radius) &&
                hasCircleLineOfSight(this.world, f.x, f.y, probeX, probeY, f.radius)
              ) {
                const toGoal = Math.hypot(tx - probeX, ty - probeY);
                if (toGoal < bestAngDist) {
                  bestAngDist = toGoal;
                  chosenSign = sign;
                  steerX = probeX;
                  steerY = probeY;
                }
              }
            }
          }
          if (chosenSign !== 0) f.formationAvoidSign = chosenSign;
        }
      } else {
        f.formationAvoidSign = 0;
      }

      const fdx = steerX - f.x;
      const fdy = steerY - f.y;
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
    const grenadeLights: { x: number; y: number; radius: number; strength: number; warm?: boolean }[] = [];
    for (let i = 0; i < this.combat.grenades.items.length; i++) {
      const g = this.combat.grenades.items[i];
      if (g.active && g.stuck) {
        const flash = (g.fuse % 0.22) < 0.11;
        grenadeLights.push({ x: g.x, y: g.y, radius: 24, strength: flash ? 0.9 : 0.45 });
      }
    }
    let gooLights = 0;
    for (const mine of this.combat.goo.mines.items) {
      if (!mine.active || gooLights >= 16) continue;
      const charge = 1 - Math.max(0, mine.fuse / mine.maxFuse);
      grenadeLights.push({ x: mine.x, y: mine.y, radius: 12 + charge * 8, strength: 0.25 + charge * 0.45, warm: true });
      gooLights++;
    }
    const fireLights = this.fire.collectLights(performance.now() / 1000);
    for (let i = 0; i < fireLights.length; i++) grenadeLights.push(fireLights[i]);
    this.lighting.updateSoftLights(this.soldiers, this.world.roomCenterX, this.world.roomCenterY, cam, grenadeLights);
    this.lighting.updateFixtures(cam);
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
    const memory = (performance as Performance & {memory?: {usedJSHeapSize:number;totalJSHeapSize:number;jsHeapSizeLimit:number}}).memory;
    const heapAtExport = memory ? {usedBytes:memory.usedJSHeapSize,allocatedBytes:memory.totalJSHeapSize,limitBytes:memory.jsHeapSizeLimit} : null;
    const recent = this.frameTimings.snapshot();
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
        timing: {
          schemaVersion: 3,
          heapAtExport,
          ...this.debugInfo,
          recentActiveFrames: recent,
          browserEvents: this.browserFrameEvents.snapshot(recent.startMs, recent.endMs),
          simulation: { fixedStepMs: SIM.dt * 1000, timeScale: this.timeScale, deathTimeScale: this.deathTimeScale, maxStepsPerFrame: SIM.maxStepsPerFrame * Math.max(1, this.timeScale) },
          rendering: this.renderer.diagnostics(),
          connectedAirMapping: this.stats.connectedAirMapping,
          visible: !document.hidden,
          paused: this.paused,
          userAgent: navigator.userAgent,
        },
        weapons: { combat: this.combat.telemetry, goo: { contacts: this.combat.goo.contacts, deposits: this.combat.goo.deposits, bursts: this.combat.goo.bursts, bounceHistogram: this.combat.goo.bounceHistogram, orbs: this.combat.goo.orbs.activeCount, mines: this.combat.goo.mines.activeCount, droppedOrbs: this.combat.goo.droppedOrbs, droppedMines: this.combat.goo.droppedMines },
          drones: { active: this.combat.drones.pool.activeCount, launched: this.combat.drones.launched, shots: this.combat.drones.shots, hits: this.combat.drones.usefulHits, dropped: this.combat.drones.dropped },
          prism: { shots: this.combat.laser.shots, bounces: this.combat.laser.bounces, hits: this.combat.laser.hits, droppedSegments: this.combat.laser.droppedSegments } },
      },
      null,
      2,
    );
  }

  frame = (now: number): void => {
    const frameStart = performance.now();
    const previousWorkMs = this.debugInfo.frameMs;
    const metrics = this.frameTimings.current;
    this.frameTimings.beginFrame();
    this.syncSpeedrun(now);
    if (this.runStarted && !this.paused && !this.runOver && this.save.data.speedrun.enabled && now - this.speedrunSavedAt >= 5000) {
      this.speedrunSavedAt = now;
      this.save.save();
    }
    const intervalMs = this.last ? now - this.last : 0;
    const real = this.last ? Math.min(0.1, intervalMs / 1000) : SIM.dt;
    this.last = now;
    // Only live gameplay frames tune the auto render quality.
    const playing = this.runStarted && this.runStats.soldiersDeployed > 0 && !this.paused && !this.runOver && !document.hidden;
    const continuousGameplay = playing && this.wasPlaying;
    if (playing && !this.wasPlaying) {
      this.frameTimings.reset();
      this.browserFrameEvents.reset();
    }
    if (playing && this.wasPlaying) this.renderer.sampleFrame(intervalMs);
    else if (!playing && this.wasPlaying) this.renderer.resetFrameSampling();
    this.wasPlaying = playing;
    const t0 = performance.now();
    metrics.preFrameMs = t0 - frameStart;
    metrics.clampedWallTimeMs = Math.max(0, intervalMs - 100);
    const cameraX = this.camera.x, cameraY = this.camera.y;
    const growthBefore = this.growth.totalEvents;
    if (!this.paused) {
      if (this.runStats.soldiersDeployed > 0 || this.portal) this.acc += real * this.timeScale * this.deathTimeScale;
      const maxSteps = SIM.maxStepsPerFrame * Math.max(1, this.timeScale);
      let steps = 0;
      while (this.acc >= SIM.dt && steps < maxSteps) {
        this.step(SIM.dt);
        this.acc -= SIM.dt;
        steps++;
      }
      metrics.simulationSteps = steps;
      if (steps >= maxSteps) {
        metrics.discardedSimulationMs = this.acc * 1000;
        this.acc = 0;
      }
      if (!this.aimState.active) {
        this.camera.update(real, this.soldiers);
      }
    }
    this.updateDeathSequence(real);
    this.updateScreenShake(real);
    this.transition.update(real);
    const t1 = performance.now();
    metrics.simulationMs = t1 - t0;
    metrics.growthEvents = Math.max(0, this.growth.totalEvents - growthBefore);
    metrics.cameraTravelWorld = Math.hypot(this.camera.x - cameraX, this.camera.y - cameraY);
    metrics.cameraZoom = this.camera.zoom;
    // The opaque main menu has its own gameplay backdrop. Other full menus
    // retain the upstream last-frame cache, including redraws after resizing.
    if (!this.mainMenu.visible) {
      const terrainStart = performance.now();
      this.terrain.update();
      metrics.terrainUpdateMs = performance.now() - terrainStart;
      metrics.terrainChunksRebuilt = this.terrain.rebuiltLastFrame;
      metrics.terrainChunksPending = this.terrain.chunks.pending;
      const covered = this.paused && (this.upgradeTree.visible || this.labMap?.visible || this.resultsScreen.visible);
      if (!covered || this.renderer.needsDraw) {
        const shadowStart = performance.now();
        this.updateFlashPolygons();
        metrics.shadowPreparationMs = performance.now() - shadowStart;
        metrics.fixtureRetraces = this.lighting.retracedLastUpdate;
        this.renderer.draw();
      }
    }
    const hudStart = performance.now();
    const fireMix = this.paused || this.runOver ? { gain: 0, pan: 0 } : fireAmbienceMix(this.fire, this.world, this.camera);
    this.audio.updateFireAmbience(fireMix.gain, fireMix.pan);
    this.hud.update(this, now);
    this.debugOverlay.update();
    const t2 = performance.now();
    metrics.hudAudioMs = t2 - hudStart;

    // Simulation time is capped for catch-up; FPS must use real elapsed time.
    // Otherwise every interval >=100 ms is incorrectly reported as 10 FPS.
    this.fpsAcc += intervalMs / 1000;
    this.fpsFrames++;
    if (this.fpsAcc >= 0.5) {
      this.debugInfo.fps = this.fpsFrames / this.fpsAcc;
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
    this.debugInfo.simMs = t1 - t0;
    this.debugInfo.frameMs = t2 - frameStart;
    // Keep the last gameplay window while paused, so opening diagnostics does
    // not overwrite slow gameplay with cheap menu frames. Resume starts fresh.
    if (continuousGameplay) this.frameTimings.sample(intervalMs, this.debugInfo.frameMs, frameStart, previousWorkMs);
    requestAnimationFrame(this.frame);
    this.debugInfo.frameMs = performance.now() - frameStart;
    if (continuousGameplay) this.frameTimings.finishWork(this.debugInfo.frameMs);
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
