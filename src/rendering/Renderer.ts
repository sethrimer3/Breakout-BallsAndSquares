import { exoticMatterPixels } from "./exoticMatterSprite";
import { OffscreenSoldierRenderer } from "./OffscreenSoldierRenderer";
import { circleIsClear } from "../systems/PhysicsSystem";
import { DeploymentOverlay } from "./DeploymentOverlay";
import { visibleRoomLightIndices } from "./RoomLightIndex";
import { DamageNumberRenderer } from "./DamageNumberRenderer";
import { drawMapBoundary } from "./MapBoundaryRenderer";
import { drawWeaponExpansion } from "./WeaponExpansionRenderer";
import { drawGoo } from "./GooRenderer";
import { LateAtmosphere } from "./LateAtmosphere";
import { drawPortalPreview, drawSpawnDenied, drawSpawnPortal } from "./PortalRenderer";
import { bayer, drawPixelSprite, fillArtPixel, pixelDiscSprite } from "./pixelFx";
import { worldAtmosphere } from "../world/worldAtmosphere";
import { LootKind } from "../entities/LootSystem";
import { ESSENCE_FPS, ESSENCE_SIZE, essenceFrame, essencePixels, paintPixels } from "./blightEssence";
import { ART_PIXEL, BULLET, COLORS, GROWTH, SOLDIER } from "../config";
import type { Bullet } from "../entities/Bullet";
import type { Soldier } from "../entities/Soldier";
import { PKind } from "../entities/ParticleSystem";
import type { Game } from "../Game";
import { FieryFlashRenderer } from "./FieryFlashRenderer";
import { BloomRenderer } from "./BloomRenderer";
import { FireRenderer } from "./FireRenderer";
import { CreatureRenderer } from "./CreatureRenderer";
import { FogRenderer } from "./FogRenderer";
import { LightRenderer } from "./LightRenderer";
import { createSprites, radialSprite, soldierShapeSprite, type Sprites } from "./sprites";
import { soldierShapeIndex } from "../entities/soldierShapes";
import { CRACK_PATTERNS, subPixelColor, subPixelTexelShade, TIER_PAINT } from "./materials";
import { ledLevel } from "./TerrainRenderer";
import { SUB } from "../world/PixelWorld";
import { FACILITY } from "../config";
import { paletteColor, SPRITES } from "../ui/pixelArt";
import type { Door } from "../world/PixelWorld";
import { autoStartIndex, densityFor, FIXED_CAPS, RenderScaleGovernor } from "./RenderScale";
import { drawGeneratorRims } from "./GeneratorRimRenderer";
import { WardenRenderer } from "./WardenRenderer";
import { drawSpecialBlocks, drawSpecialGlow, drawSpecialNotice, drawSpecialPlinths } from "./SpecialUpgradeRenderer";

/** Keycard colors by tier, as on the research-base upgrades. */
const KEYCARD_COLORS = ["#3078ff", "#3078ff", "#ff2a2a", "#d65c12", "#8a6ad0", "#6aa040", "#d8c8a0"];

/** Door core lightened toward the rim as it takes damage. */
function doorCoreDamaged(d: number): string {
  const l = Math.round(35 + d * 70);
  return `rgb(${l}, ${l + 6}, ${l + 16})`;
}

const HEX_CACHE = new Map<number, string>();
function hexColor(c: number): string {
  let s = HEX_CACHE.get(c);
  if (s === undefined) {
    s = `#${c.toString(16).padStart(6, "0")}`;
    if (HEX_CACHE.size < 256) HEX_CACHE.set(c, s);
  }
  return s;
}

export class Renderer {
  private motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  /** The one living frame every Blight Essence drop shares. */
  private essenceCanvas = document.createElement("canvas");
  private essenceShown = -1;
  private exoticCanvas: HTMLCanvasElement | null = null;
  private exoticFrame = -1;
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  /** Adjusts the canvas density in "auto" render quality; null when pinned. */
  private governor: RenderScaleGovernor | null = null;
  /** The canvas was resized (and cleared) since the last full draw. */
  needsDraw = true;
  /** CSS overlay standing in for a full-screen vignette pass on the canvas. */
  private vignette: HTMLDivElement;
  private sprites: Sprites;
  private doorGlowSprites: (HTMLCanvasElement | undefined)[] = [];
  private creatureRenderer = new CreatureRenderer();
  private wardenRenderer = new WardenRenderer();
  private lightRenderer: LightRenderer;
  private fieryFlash: FieryFlashRenderer;
  private bloomRenderer: BloomRenderer;
  private damageNumberRenderer = new DamageNumberRenderer();
  private fireRenderer = new FireRenderer();
  private lateAtmosphere = new LateAtmosphere();
  private fogRenderer: FogRenderer;
  private readonly offscreenSoldiers = new OffscreenSoldierRenderer();
  private readonly deploymentOverlay = new DeploymentOverlay();

  constructor(
    private canvas: HTMLCanvasElement,
    private game: Game,
  ) {
    this.ctx = canvas.getContext("2d", { alpha: false })!;
    this.sprites = createSprites();
    this.lightRenderer = new LightRenderer(this.sprites);
    this.fieryFlash = new FieryFlashRenderer(this.lightRenderer);
    this.bloomRenderer = new BloomRenderer(this.sprites);
    this.fogRenderer = new FogRenderer(game.fog);
    this.vignette = document.createElement("div");
    this.vignette.className = "game-vignette";
    canvas.after(this.vignette);
  }

  /** Backing-store pixels per CSS pixel currently in use. */
  get density(): number {
    return this.dpr;
  }

  /** Capture actual density and auto-quality state when exporting diagnostics. */
  diagnostics() {
    return {
      quality: this.game.renderQuality,
      density: this.dpr,
      devicePixelRatio: window.devicePixelRatio || 1,
      cssSize: [window.innerWidth, window.innerHeight],
      backingSize: [this.canvas.width, this.canvas.height],
      softShadows: this.game.save.data.settings.softShadows,
      bloom: this.game.bloom,
      lightingQuality: this.game.lighting.quality,
      reducedMotion: this.motion.matches,
      camera: { x: this.game.camera.x, y: this.game.camera.y, zoom: this.game.camera.zoom },
      contextAttributes: this.ctx.getContextAttributes?.() ?? null,
      auto: this.governor ? {
        step: this.governor.step, cap: this.governor.cap,
        locked: this.governor.locked, typicalIntervalMs: this.governor.lastTypical,
      } : null,
    };
  }

  resize(): void {
    const deviceRatio = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const quality = this.game.renderQuality;
    let cap: number;
    if (quality === "auto") {
      this.governor ??= new RenderScaleGovernor(
        autoStartIndex(window.matchMedia("(pointer: coarse)").matches, w * h),
        deviceRatio,
      );
      this.governor.reset();
      cap = this.governor.cap;
    } else {
      this.governor = null;
      cap = FIXED_CAPS[quality];
    }
    this.dpr = densityFor(cap, deviceRatio);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    // Below native density, keep upscaled pixel art crisp rather than blurred.
    this.canvas.style.imageRendering = this.dpr < deviceRatio ? "pixelated" : "";
    const cw = Math.round(w * this.dpr);
    const ch = Math.round(h * this.dpr);
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
      this.needsDraw = true;
    }
    this.updateVignette(w, h);
  }

  /** Feed one active-gameplay frame interval to the auto quality governor. */
  sampleFrame(intervalMs: number): void {
    if (this.governor?.sample(intervalMs)) this.resize();
  }

  /** Pause measuring (menus, pauses) so their frames don't count as gameplay. */
  resetFrameSampling(): void {
    this.governor?.reset();
  }

  /**
   * Same falloff the canvas vignette used (clear inside 36% of the short side,
   * darkest at the corners), as a compositor layer instead of a full-screen blend.
   */
  private updateVignette(w: number, h: number): void {
    const r1 = Math.hypot(w / 2, h / 2) || 1;
    const t0 = Math.min(1, (Math.min(w, h) * 0.36) / r1);
    const pct = (t: number): string => `${((t0 + (1 - t0) * t) * 100).toFixed(2)}%`;
    this.vignette.style.background =
      `radial-gradient(circle farthest-corner at 50% 50%, rgba(0,0,0,0) ${pct(0)}, ` +
      `rgba(2,4,10,0.28) ${pct(0.7)}, rgba(1,2,6,0.72) 100%)`;
  }

  draw(): void {
    const { ctx, game } = this;
    const metrics = game.frameTimings?.current;
    let passStart = performance.now();
    const cam = game.camera;
    const w = cam.viewW;
    const h = cam.viewH;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // 1) Albedo pass: dark navy cavity background, terrain chunks, casings,
    //    and debris/smoke.
    const atmosphere = worldAtmosphere(game.world, cam.x, cam.y);
    ctx.fillStyle = atmosphere ? `rgb(${atmosphere.background.join(",")})` : COLORS.background;
    ctx.fillRect(0, 0, w, h);
    // The spawn room's bare concrete slab.
    {
      const cs = game.world.cellSize;
      const tube = game.labSave.spawn === game.labDef.start ? game.world.startingTube : null;
      const sx = cam.worldToScreenX((tube?.x0 ?? game.world.roomX0) * cs);
      const sy = cam.worldToScreenY((tube?.y0 ?? game.world.roomY0) * cs);
      const sw = (tube ? tube.x1 - tube.x0 + 1 : game.world.roomSize) * cs * cam.zoom;
      const sh = (tube ? tube.y1 - tube.y0 + 1 : game.world.roomSize) * cs * cam.zoom;
      ctx.fillStyle = COLORS.spawnFloor;
      ctx.fillRect(sx, sy, sw, sh);
    }

    game.terrain.drawFloor(ctx, cam);
    game.terrain.draw(ctx, cam, game.showChunkBorders);
    { const start = performance.now(); this.drawSubPixels(); if (metrics) metrics.subPixelDrawMs = performance.now() - start; }
    this.drawDoors();
    drawSpecialPlinths(ctx, cam, game.world);
    this.lateAtmosphere.drawFloorProps(ctx, cam, game.world, this.motion.matches ? 0 : performance.now() / 1000);

    // Subtle starting-room frame so the spawn zone stays recognizable.
    const cs = game.world.cellSize;
    const rx0 = cam.worldToScreenX(game.world.roomX0 * cs);
    const ry0 = cam.worldToScreenY(game.world.roomY0 * cs);
    const rw = game.world.roomSize * cs * cam.zoom;
    ctx.strokeStyle = "rgba(150, 140, 120, 0.14)";
    ctx.lineWidth = 1;
    ctx.strokeRect(rx0 + 0.5, ry0 + 0.5, rw - 1, rw - 1);

    this.drawCasings();
    this.drawOpaqueParticles();
    { const end = performance.now(); if (metrics) metrics.albedoMs = end - passStart; passStart = end; }

    // 2) Dynamic lighting pass: multiply shadow-clipped lightmap over the albedo
    //    scene + additive air-scatter cone so shadows behind walls & soldiers pop.
    this.lightRenderer.renderLighting(ctx, game, this.dpr);
    { const end = performance.now(); if (metrics) metrics.lightingMs = end - passStart; passStart = end; }
    this.lateAtmosphere.drawAtmosphere(ctx, cam, game.world, atmosphere, this.motion.matches ? 0 : performance.now() / 1000);
    const fog = game.devMapAccess ? undefined : game.fog;
    game.terrain.drawLabGlow(ctx, cam, game.runStats.time);
    game.terrain.drawPanels(ctx, cam, performance.now() / 1000, false, fog);
    game.terrain.drawLabLights(ctx, cam, performance.now() / 1000, this.motion.matches, fog);
    { const start = performance.now(); this.drawSubPixelLights(performance.now() / 1000, this.motion.matches); if (metrics) metrics.subPixelDrawMs += performance.now() - start; }
    this.drawSentries();
    game.late.draw(ctx, cam);
    this.creatureRenderer.draw(ctx, cam, game.creatures, this.motion.matches ? 0 : performance.now() / 1000);
    const wallClockMs = performance.now();
    const still = this.motion.matches;
    game.terrain.drawSurfaceOutlines(ctx, cam);
    drawSpecialBlocks(ctx, cam, game.specials, this.motion.matches ? 0 : performance.now() / 1000);
    { const start = performance.now(); this.wardenRenderer.draw(ctx, cam, game.wardens, game.specials, this.motion.matches ? 0 : performance.now() / 1000); if (metrics) metrics.wardenDrawMs = performance.now() - start; }
    { const end = performance.now(); if (metrics) metrics.worldEffectsMs = end - passStart; passStart = end; }

    // 3) Emissive / post-light pass: cell hit highlights, crimson growth pulses,
    //    directional muzzle flares, bullet tracers, sparks, aim indicator, vignette.
    this.drawCellFlashes();
    this.drawDoorFlashes();

    // Fiery mode: soft flames via a blurred low-res light buffer (screen blend),
    // drawn before tracers/sparks so those stay crisp on top.
    const fiery = game.fieryMuzzleFlash;
    if (fiery) this.fieryFlash.render(ctx, game);

    // Blight Essence is black, so it can't go in the additive pass below.
    this.drawEssence(wallClockMs, still);
    this.fireRenderer.drawSmoke(ctx, cam, game.fire);

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    this.drawDoorGlow(still ? 0 : wallClockMs / 1000);
    this.drawBlightCorePulses();
    this.drawLoot();
    drawSpecialGlow(ctx, cam, game.specials, this.motion.matches ? 0 : performance.now() / 1000);
    this.drawGrowthPulses();
    if (fiery) this.fieryFlash.drawHotPixels(ctx, game);
    else this.drawMuzzleFlares();
    this.drawBullets();
    this.fireRenderer.drawGlow(ctx, cam, game.fire, game.world, still ? 0 : wallClockMs / 1000);
    this.drawAdditiveParticles();
    ctx.restore();

    { const end = performance.now(); if (metrics) metrics.combatEffectsMs = end - passStart; passStart = end; }
    this.bloomRenderer.render(ctx, game, this.fireRenderer, still, wallClockMs / 1000);
    { const end = performance.now(); if (metrics) metrics.bloomMs = end - passStart; passStart = end; }

    drawMapBoundary(ctx, game.world, cam);

    // 4) Fog of war over the whole world; the aim indicator stays readable on top.
    if (!game.devMapAccess) {
      this.fogRenderer.draw(ctx, cam);
      game.terrain.drawBlightThroughFog(ctx, cam);
    }
    { const end = performance.now(); if (metrics) metrics.fogRenderMs = end - passStart; passStart = end; }
    game.terrain.drawBlightEdges(ctx, cam, still ? 0 : wallClockMs / 1000);
    { const end = performance.now(); if (metrics) metrics.blightEdgesMs = end - passStart; passStart = end; }
    this.deploymentOverlay.draw(ctx, game);
    // Generator tier rims sit on top of the Blight's own edges (Blight shows through fog).
    drawGeneratorRims(ctx, cam, game.world, still ? 0 : wallClockMs / 1000);
    this.drawExoticMatter(wallClockMs, still);
    // Soldiers are drawn after lighting and fog so the pixel-art sprite keeps
    // its full palette even when it outruns the light creeping after it.
    drawWeaponExpansion(ctx, game, still);
    // The deployment portal sits under the operators stepping out of it.
    if (game.portal) drawSpawnPortal(ctx, cam, game.portal, still ? 0 : wallClockMs / 1000);
    this.drawSoldiers();
    this.drawGrenades();
    drawGoo(ctx, cam, game.combat.goo, still, game.lighting.quality === "low");
    this.drawTurrets();
    game.late.drawOverlay(ctx, cam);
    this.damageNumberRenderer.draw(ctx, cam, game.damageNumbers, this.motion.matches, game.devMapAccess ? undefined : game.fog);
    this.drawAimIndicator();
    this.drawGateNotice();
    drawSpecialNotice(ctx, cam, game.specialNotice, game.runStats.time);
    this.offscreenSoldiers.draw(ctx, game);
    if (metrics) {
      metrics.actorsAndUiMs = performance.now() - passStart;
      metrics.candidateRoomLights = visibleRoomLightIndices(game.world, cam).length;
      metrics.softLights = game.lighting.softCount;
      metrics.muzzleFlashes = game.flashes.length;
      metrics.shadowRays = game.lighting.lastRaysCast;
      metrics.shadowedMuzzleLights = game.lighting.lastShadowLights;
      metrics.soldiers = 0;
      for (const soldier of game.soldiers) if (soldier.alive) metrics.soldiers++;
      metrics.bullets = game.combat.bullets.activeCount;
      metrics.particles = game.particles.count;
      metrics.fireParticles = game.fire.count;
      metrics.loot = game.loot.count;
      metrics.damageNumbers = game.damageNumbers.items.length;
      metrics.movingSubPixels = game.subPixels.count;
      metrics.creatures = game.creatures.flowers.length + game.creatures.worms.length;
      for (const specimen of game.creatures.specimens) if (specimen.free) metrics.creatures++;
      metrics.wardens = game.wardens.aliveCount;
      metrics.backingPixels = this.canvas.width * this.canvas.height;
      metrics.renderDensity = this.dpr;
      metrics.bloomEnabled = game.bloom ? 1 : 0;
      metrics.softShadowsEnabled = game.softShadows ? 1 : 0;
      metrics.lightingQualityLevel = game.lighting.quality === "high" ? 2 : game.lighting.quality === "medium" ? 1 : 0;
    }
    this.needsDraw = false;
  }

  /**
   * Super-efficient rendering of up to thousands of glowing golden squares:
   * single pre-rendered glow+square sprite per item, fast frustum culling,
   * and zero per-item state changes unless fading out in the final second.
   */
  private drawLoot(): void {
    const { ctx, game } = this;
    const loot = game.loot;
    const n = loot.count;
    if (n === 0) return;
    const cam = game.camera;
    const vw = cam.viewW;
    const vh = cam.viewH;
    const zoom = cam.zoom;
    const camX = cam.x;
    const camY = cam.y;
    const halfW = vw * 0.5;
    const halfH = vh * 0.5;
    const goldSprite = this.sprites.goldSquare;
    const crystalSprite = this.sprites.orangeCrystal;
    const greenSprite = this.sprites.greenCrystal;
    const sz = Math.max(6, 5.2 * zoom);
    const xs = loot.x;
    const ys = loot.y;
    const lives = loot.life;
    const kinds = loot.kind;

    ctx.globalAlpha = 1;
    let lastAlpha = 1;
    let fontSet = false;
    for (let i = 0; i < n; i++) {
      if (kinds[i] === LootKind.Essence) continue;
      const sx = (xs[i] - camX) * zoom + halfW;
      if (sx < -sz || sx > vw + sz) continue;
      const sy = (ys[i] - camY) * zoom + halfH;
      if (sy < -sz || sy > vh + sz) continue;
      const rem = lives[i];
      const a = rem < 1 ? Math.max(0, rem) : 1;
      if (a !== lastAlpha) {
        ctx.globalAlpha = a;
        lastAlpha = a;
      }
      const sprite = kinds[i] === LootKind.Crystal ? crystalSprite : kinds[i] === LootKind.GreenCrystal ? greenSprite : goldSprite;
      const size = sz * (loot.value[i] > 1 ? 1.7 : 1);
      if(kinds[i] === LootKind.Biomass) {ctx.fillStyle="#7fe39a";ctx.fillRect(sx-size/2,sy-size/2,size,size);}
      else ctx.drawImage(sprite, sx-size/2, sy-size/2, size, size);
      if(loot.value[i]>1){
        if(!fontSet){ctx.font="9px monospace";fontSet=true;}
        ctx.fillStyle="#e4f4e9";
        ctx.fillText(`×${loot.value[i]}`,sx+size/2,sy);
      }
    }
    if (lastAlpha !== 1) ctx.globalAlpha = 1;
  }

  /** Blight Essence drops: the living glob, on whole screen pixels so it stays crisp. */
  private drawExoticMatter(now: number, still: boolean): void {
    const { game, ctx } = this;
    if (!game.exoticDrops.length) return;
    const cam = game.camera;
    const frame = essenceFrame(now, still);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    for (const drop of game.exoticDrops) {
      const x = cam.worldToScreenX(drop.x), y = cam.worldToScreenY(drop.y);
      if (x < -32 || y < -32 || x > cam.viewW + 32 || y > cam.viewH + 32) continue;
      if (!game.devMapAccess && game.fog.lightAt(drop.x, drop.y) <= 0) continue;
      const canvas = this.exoticCanvas ??= document.createElement("canvas");
      if (frame !== this.exoticFrame) {
        paintPixels(canvas, exoticMatterPixels(frame * 0.09));
        this.exoticFrame = frame;
      }
      const scale = Math.max(1, Math.min(3, Math.round(cam.zoom)));
      const bob = still ? 0 : Math.sin(now / 350) * 3;
      ctx.drawImage(canvas, Math.round(x - canvas.width * scale / 2), Math.round(y - canvas.height * scale / 2 + bob), canvas.width * scale, canvas.height * scale);
    }
    ctx.restore();
  }

  private drawEssence(nowMs: number, still: boolean): void {
    const { ctx, game } = this;
    const loot = game.loot;
    if (loot.essenceCount === 0) return;
    const frame = essenceFrame(nowMs, still);
    let painted = false;
    const cam = game.camera;
    const scale = Math.max(1, Math.round(cam.zoom * 0.75));
    const sz = ESSENCE_SIZE * scale;
    const smoothing = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    for (let i = 0; i < loot.count; i++) {
      if (loot.kind[i] !== LootKind.Essence) continue;
      const sx = Math.round(cam.worldToScreenX(loot.x[i]) - sz / 2);
      const sy = Math.round(cam.worldToScreenY(loot.y[i]) - sz / 2);
      if (sx < -sz || sy < -sz || sx > cam.viewW || sy > cam.viewH) continue;
      if (!painted && frame !== this.essenceShown) {
        paintPixels(this.essenceCanvas, essencePixels(frame / ESSENCE_FPS));
        this.essenceShown = frame;
      }
      painted = true;
      ctx.globalAlpha = Math.min(1, Math.max(0, loot.life[i]));
      ctx.drawImage(this.essenceCanvas, sx, sy, sz, sz);
    }
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = smoothing;
  }

  private readonly subColorScratch = [0, 0, 0];
  private readonly subTexelScratch = [0, 0, 0];

  private drawSubPixels(): void {
    const { ctx, game } = this;
    const sp = game.subPixels;
    if (sp.count === 0) return;
    const cam = game.camera;
    const ss = game.world.subCellSize;
    const sz = Math.max(1, ss * cam.zoom);
    const half = sz * 0.5;
    const col = this.subColorScratch;
    const tex = this.subTexelScratch;
    const simple = half <= 1.5;
    for (let i = 0; i < sp.count; i++) {
      const sx = cam.worldToScreenX(sp.x[i]);
      const sy = cam.worldToScreenY(sp.y[i]);
      if (sx + half < 0 || sy + half < 0 || sx - half > cam.viewW || sy - half > cam.viewH) continue;
      const origSx = sp.origSx[i];
      const origSy = sp.origSy[i];
      const kind = sp.kind[i];
      subPixelColor(kind, sp.tint[i], origSy, sp.hp[i], sp.maxHp[i], false, col);
      const x0 = sx - half;
      const y0 = sy - half;
      if (simple) {
        ctx.fillStyle = `rgb(${col[0] | 0},${col[1] | 0},${col[2] | 0})`;
        ctx.fillRect(x0, y0, sz, sz);
        continue;
      }
      for (let oy = 0; oy < 2; oy++) {
        for (let ox = 0; ox < 2; ox++) {
          subPixelTexelShade(kind, origSx, origSy, ox, oy, true, true, true, true, col, tex);
          ctx.fillStyle = `rgb(${tex[0]},${tex[1]},${tex[2]})`;
          ctx.fillRect(x0 + ox * half, y0 + oy * half, half, half);
        }
      }
    }
  }

  private drawSubPixelLights(time: number, still: boolean): void {
    const { ctx, game } = this;
    const sp = game.subPixels;
    if (sp.activeLightCount === 0) return;
    const cam = game.camera;
    const ss = game.world.subCellSize;
    const px = ss * cam.zoom;
    const half = px * 0.5;
    const t = still ? 0 : time;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < sp.count; i++) {
      const k = sp.kind[i];
      if (k !== SUB.led && k !== SUB.core) continue;
      const tint = sp.tint[i];
      const r = tint & 63;
      let level: number;
      let c: readonly [number, number, number];
      if (k === SUB.led) {
        c = COLORS.labLed[tint >> 6];
        level = still ? 0.8 : ledLevel(r, t);
      } else {
        c = COLORS.labCore[tint >> 6];
        level = still ? 0.7 : 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * (1.2 + (r & 7) * 0.15) + (sp.origSx[i] + sp.origSy[i]) * 0.45 + (r >> 3)));
      }
      if (level <= 0.02) continue;
      const lx = cam.worldToScreenX(sp.x[i]) - half;
      const ly = cam.worldToScreenY(sp.y[i]) - half;
      if (lx + px * 2 < 0 || ly + px * 2 < 0 || lx - px > cam.viewW || ly - px > cam.viewH) continue;
      ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
      ctx.globalAlpha = level * (k === SUB.core ? 0.16 : 0.12);
      ctx.fillRect(lx - px, ly - px, px * 3, px * 3);
      ctx.globalAlpha = level;
      ctx.fillRect(lx, ly, px, px);
    }
    ctx.restore();
  }

  private drawCasings(): void {
    const { ctx, game } = this;
    const cam = game.camera;
    const c = game.casings;
    if (c.count === 0) return;
    const len = Math.max(2, 2.3 * cam.zoom);
    const wid = Math.max(1, 1.0 * cam.zoom);
    const halfL = len * 0.5;
    const halfW = wid * 0.5;
    const dpr = this.dpr;
    const vw = cam.viewW;
    const vh = cam.viewH;
    let drew = false;
    for (let i = 0; i < c.count; i++) {
      const sx = cam.worldToScreenX(c.x[i]);
      const sy = cam.worldToScreenY(c.y[i]);
      if (sx < -20 || sy < -20 || sx > vw + 20 || sy > vh + 20) continue;
      drew = true;
      const a = Math.min(1, (c.life[i] / c.maxLife[i]) * 1.4);
      const ang = c.angle[i];
      const cos = Math.cos(ang) * dpr;
      const sin = Math.sin(ang) * dpr;
      ctx.globalAlpha = a;
      ctx.setTransform(cos, sin, -sin, cos, sx * dpr, sy * dpr);
      ctx.fillStyle = "#e8b85c";
      ctx.fillRect(-halfL, -halfW, len, wid);
      ctx.fillStyle = "#fff1b8";
      ctx.fillRect(-halfL, -halfW, len * 0.45, wid * 0.6);
    }
    if (drew) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalAlpha = 1;
    }
  }

  private drawBlightCorePulses(): void {
    const { ctx, game } = this;
    const cores = game.world.blightCores;
    if (!cores || cores.length === 0) return;
    const cam = game.camera;
    const cs = game.world.cellSize;
    const now = game.runStats.time;
    const pulse = 0.65 + 0.35 * Math.sin(now * 4.5);
    for (let i = 0; i < cores.length; i++) {
      const c = cores[i];
      if (!c.alive) continue;
      const wx = (c.cx + c.size / 2) * cs;
      const wy = (c.cy + c.size / 2) * cs;
      const sx = cam.worldToScreenX(wx);
      const sy = cam.worldToScreenY(wy);
      const rad = cs * (c.size === 1 ? 1.6 : 3.8) * cam.zoom * (0.9 + 0.15 * pulse);
      if (sx + rad < 0 || sy + rad < 0 || sx - rad > cam.viewW || sy - rad > cam.viewH) continue;
      ctx.globalAlpha = 0.42 * pulse;
      ctx.drawImage(this.sprites.crimsonGlow, sx - rad, sy - rad, rad * 2, rad * 2);
    }
    ctx.globalAlpha = 1;
  }

  /**
   * Blast doors: every door pixel is a dark core inside a thin lighter rim
   * (outer 10%), so doors read apart from the walls around them.
   */
  private drawDoors(): void {
    const { ctx, game } = this;
    const w = game.world;
    if (w.doors.length === 0) return;
    const cam = game.camera;
    const cs = w.cellSize;
    const sz = cs * cam.zoom;
    const x0 = cam.screenToWorldX(0) / cs - 1;
    const y0 = cam.screenToWorldY(0) / cs - 1;
    const x1 = cam.screenToWorldX(cam.viewW) / cs + 1;
    const y1 = cam.screenToWorldY(cam.viewH) / cs + 1;
    const rim = Math.max(1, sz * 0.1);
    for (const d of w.doors) {
      if (d.x1 < x0 || d.y1 < y0 || d.x0 > x1 || d.y0 > y1) continue;
      if (d.gate) {
        this.drawGate(d);
        continue;
      }
      for (const i of d.cells) {
        const hp = w.health[i];
        if (hp === 0) continue;
        const cx = i % w.width;
        const cy = (i - cx) / w.width;
        const sx = Math.round(cam.worldToScreenX(cx * cs));
        const sy = Math.round(cam.worldToScreenY(cy * cs));
        const ex = Math.round(cam.worldToScreenX((cx + 1) * cs));
        const ey = Math.round(cam.worldToScreenY((cy + 1) * cs));
        ctx.fillStyle = COLORS.doorRim;
        ctx.fillRect(sx, sy, ex - sx, ey - sy);
        const maxHp = w.maxHealthAt(cx, cy);
        ctx.fillStyle = hp < maxHp ? doorCoreDamaged(1 - hp / maxHp) : COLORS.doorCore;
        ctx.fillRect(sx + rim, sy + rim, ex - sx - rim * 2, ey - sy - rim * 2);
        // Checkered bands of matte paint in the keycard's color mark the door's tier.
        if (((cx + cy) & 1) === 0 && hp === maxHp) {
          const c = TIER_PAINT[d.tier] ?? TIER_PAINT[1];
          ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
          ctx.fillRect(sx + rim * 2, sy + rim * 2, ex - sx - rim * 4, ey - sy - rim * 4);
        }
        // Pixel-art cracks on damaged doors
        if (hp < maxHp) {
          const dmgRatio = 1 - hp / maxHp;
          if (dmgRatio >= 0.25) {
            const stage = dmgRatio >= 0.75 ? 2 : dmgRatio >= 0.5 ? 1 : 0;
            const v = (cx * 11 + cy * 17) % CRACK_PATTERNS.length;
            const pattern = CRACK_PATTERNS[v][stage];
            const pw = (ex - sx) / 4;
            const ph = (ey - sy) / 4;
            ctx.fillStyle = "rgba(10, 8, 12, 0.65)";
            for (let ptIdx = 0; ptIdx < pattern.length; ptIdx++) {
              const pt = pattern[ptIdx];
              ctx.fillRect(Math.floor(sx + pt[0] * pw), Math.floor(sy + pt[1] * ph), Math.ceil(pw), Math.ceil(ph));
            }
          }
        }
      }
    }
  }

  /** Subtle, slowly pulsing tier-colored glow around closed doors. */
  private drawDoorGlow(t: number): void {
    const { ctx, game } = this;
    const w = game.world;
    if (w.doors.length === 0) return;
    const cam = game.camera;
    const cs = w.cellSize;
    const sz = cs * cam.zoom;
    const x0 = cam.screenToWorldX(0) / cs - 2;
    const y0 = cam.screenToWorldY(0) / cs - 2;
    const x1 = cam.screenToWorldX(cam.viewW) / cs + 2;
    const y1 = cam.screenToWorldY(cam.viewH) / cs + 2;
    for (const d of w.doors) {
      if (d.open || d.x1 < x0 || d.y1 < y0 || d.x0 > x1 || d.y0 > y1) continue;
      let sprite = this.doorGlowSprites[d.tier];
      if (!sprite) {
        const [r, g, b] = TIER_PAINT[d.tier] ?? TIER_PAINT[1];
        sprite = radialSprite(64, [
          [0, `rgba(${r}, ${g}, ${b}, 0.55)`],
          [0.45, `rgba(${r}, ${g}, ${b}, 0.18)`],
          [1, `rgba(${r}, ${g}, ${b}, 0)`],
        ]);
        this.doorGlowSprites[d.tier] = sprite;
      }
      const pulse = 0.5 + 0.5 * Math.sin(t * 1.1 + d.id * 1.37);
      const rad = sz * (1.2 + 0.25 * pulse);
      ctx.globalAlpha = 0.16 + 0.18 * pulse;
      for (const i of d.cells) {
        if (w.health[i] === 0) continue;
        const cx = i % w.width;
        const cy = (i - cx) / w.width;
        const sx = cam.worldToScreenX((cx + 0.5) * cs);
        const sy = cam.worldToScreenY((cy + 0.5) * cs);
        ctx.drawImage(sprite, sx - rad, sy - rad, rad * 2, rad * 2);
      }
    }
    ctx.globalAlpha = 1;
  }

  /**
   * A world gate: one huge slab of dark plate set into the lab's edge, with a
   * heavy frame, a seam where its halves part, and bands of matte keycard paint.
   * Drawn cell by cell, so it splits from the middle as it slides open.
   */
  private drawGate(d: Door): void {
    const { ctx, game } = this;
    const w = game.world;
    const cam = game.camera;
    const cs = w.cellSize;
    const h = d.y1 - d.y0 + 1;
    const mid = (d.y0 + d.y1) / 2;
    const paint = TIER_PAINT[d.tier] ?? TIER_PAINT[1];
    for (const i of d.cells) {
      if (w.health[i] === 0) continue;
      const cx = i % w.width;
      const cy = (i - cx) / w.width;
      const sx = Math.round(cam.worldToScreenX(cx * cs));
      const sy = Math.round(cam.worldToScreenY(cy * cs));
      const ex = Math.round(cam.worldToScreenX((cx + 1) * cs));
      const ey = Math.round(cam.worldToScreenY((cy + 1) * cs));
      const ry = cy - d.y0;
      const edgeX = cx === d.x0 || cx === d.x1;
      const edgeY = ry === 0 || ry === h - 1;
      let col: string;
      if (edgeX || edgeY) col = "#1c1e24";
      else if (Math.abs(cy - mid) < 0.6) col = "#101115";
      else if (ry === 2 || ry === h - 3) col = `rgb(${paint[0]},${paint[1]},${paint[2]})`;
      else if ((ry === 3 || ry === h - 4) && ((cx + cy) & 1) === 0) col = `rgb(${paint[0] * 0.75 | 0},${paint[1] * 0.75 | 0},${paint[2] * 0.75 | 0})`;
      else col = (ry >> 1) & 1 ? "#4a4e58" : "#585d68";
      ctx.fillStyle = col;
      ctx.fillRect(sx, sy, ex - sx, ey - sy);
    }
  }

  private keycardSprites = new Map<number, HTMLCanvasElement>();

  /** The keycard sprite in a tier's color, at one canvas pixel per sprite pixel. */
  private keycardSprite(tier: number): HTMLCanvasElement {
    let c = this.keycardSprites.get(tier);
    if (c) return c;
    const grid = SPRITES.keycard;
    c = document.createElement("canvas");
    c.width = grid[0].length;
    c.height = grid.length;
    const g = c.getContext("2d")!;
    const tint = KEYCARD_COLORS[tier] ?? KEYCARD_COLORS[1];
    grid.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const color = paletteColor(row[x], tint);
        if (!color) continue;
        g.fillStyle = color;
        g.fillRect(x, y, 1, 1);
      }
    });
    this.keycardSprites.set(tier, c);
    return c;
  }

  /**
   * "Tier N Access Needed" over a locked gate the squad keeps shooting: the
   * keycard and its caption rise out of the middle of the wall fading in, hang
   * for a second, then fade away.
   */
  private drawGateNotice(): void {
    const { ctx, game } = this;
    const n = game.gateNotice;
    if (!n) return;
    const t = game.runStats.time - n.t0;
    const { gateNoticeRise: rise, gateNoticeHold: hold, gateNoticeFade: fade, gateNoticeLift: lift } = FACILITY;
    if (t < 0 || t > rise + hold + fade) return;
    let alpha: number;
    let p: number;
    if (t < rise) {
      p = 1 - (1 - t / rise) ** 3;
      alpha = t / rise;
    } else {
      p = 1;
      alpha = t < rise + hold ? 1 : 1 - (t - rise - hold) / fade;
    }
    const cam = game.camera;
    const cs = game.world.cellSize;
    const d = n.door;
    const bob = t > rise ? Math.sin((t - rise) * 3) * 0.15 : 0;
    const wx = ((d.x0 + d.x1 + 1) / 2) * cs;
    const wy = ((d.y0 + d.y1 + 1) / 2 - lift * p + bob) * cs;
    const x = cam.worldToScreenX(wx);
    const y = cam.worldToScreenY(wy);
    const sprite = this.keycardSprite(d.tier);
    const scale = Math.max(2, Math.round(3 * Math.min(1.5, Math.max(0.7, cam.zoom))));
    const sw = sprite.width * scale;
    const sh = sprite.height * scale;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sprite, Math.round(x - sw / 2), Math.round(y - sh / 2), sw, sh);
    const fontPx = 8 * Math.max(1, Math.round(scale / 2));
    ctx.font = `${fontPx}px Silkscreen, "Press Start 2P", monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    const text = `Tier ${d.tier} Access Needed`;
    const ty = Math.round(y - sh / 2 - scale * 2);
    ctx.fillStyle = "#05070d";
    ctx.fillText(text, Math.round(x) + scale, ty + scale);
    ctx.fillStyle = "#f0e8d8";
    ctx.fillText(text, Math.round(x), ty);
    ctx.restore();
  }

  /** Research-base sentries: dark and slumped while dormant, red-eyed once awake. */
  private drawSentries(): void {
    const { ctx, game } = this;
    const cam = game.camera;
    const z = cam.zoom;
    for (const t of game.sentries.sentries) {
      const sx = cam.worldToScreenX(t.x);
      const sy = cam.worldToScreenY(t.y);
      if (sx < -40 || sy < -40 || sx > cam.viewW + 40 || sy > cam.viewH + 40) continue;
      const baseR = Math.max(2.5, 3.6 * z);
      // Boot flicker for the first moment after waking.
      const live = t.awake && (t.wakeAge > 0.5 || Math.floor(t.wakeAge * 20) % 2 === 0);
      ctx.save();
      ctx.translate(sx, sy);
      ctx.fillStyle = "#151b24";
      ctx.fillRect(-baseR, -baseR, baseR * 2, baseR * 2);
      ctx.strokeStyle = live ? "#5d7590" : "#2c3644";
      ctx.lineWidth = 1;
      ctx.strokeRect(-baseR + 0.5, -baseR + 0.5, baseR * 2 - 1, baseR * 2 - 1);
      ctx.rotate(t.angle);
      const barrelLen = Math.max(4, 6 * z);
      const barrelW = Math.max(1, 1.4 * z);
      ctx.fillStyle = live ? "#6c859e" : "#2f3a48";
      ctx.fillRect(0, -barrelW / 2, barrelLen, barrelW);
      ctx.fillStyle = live ? "#2c3b4d" : "#1c242f";
      const domeR = Math.round(baseR * 0.7);
      ctx.fillRect(-domeR, -domeR, domeR * 2, domeR * 2);
      ctx.fillStyle = live ? (t.hasTarget ? "#ff4040" : "#ff9a3b") : "#3a2a2a";
      const eyeR = Math.max(1, Math.round(1.1 * z));
      ctx.fillRect(Math.round(baseR * 0.3) - eyeR / 2, -eyeR / 2, eyeR, eyeR);
      ctx.restore();
    }
  }

  private drawGrowthPulses(): void {
    const { ctx, game } = this;
    const g = game.growth;
    if (g.glowCount === 0) return;
    const cam = game.camera;
    const w = game.world;
    const cs = w.cellSize;
    const sz = cs * cam.zoom;
    const now = game.runStats.time;
    const dur = GROWTH.glowDuration;
    for (let k = 0; k < g.glowCount; k++) {
      const idx = (g.glowHead - 1 - k + GROWTH.glowCap) % GROWTH.glowCap;
      const age = now - g.glowTime[idx];
      if (age < 0 || age >= dur) continue;
      const cell = g.glowIndex[idx];
      if (w.health[cell] === 0) continue;
      const cx = cell % w.width;
      const cy = Math.floor(cell / w.width);
      const sx = cam.worldToScreenX(cx * cs);
      const sy = cam.worldToScreenY(cy * cs);
      if (sx + sz < 0 || sy + sz < 0 || sx > cam.viewW || sy > cam.viewH) continue;
      const a = 1 - age / dur;
      ctx.fillStyle = `rgba(255, 38, 108, ${a * a * 0.6})`;
      ctx.fillRect(sx, sy, sz, sz);
      const gr = sz * (1.1 + (1 - a) * 0.5);
      ctx.globalAlpha = a * 0.28;
      ctx.drawImage(this.sprites.crimsonGlow, sx + sz / 2 - gr, sy + sz / 2 - gr, gr * 2, gr * 2);
      ctx.globalAlpha = 1;
    }
  }

  private drawCellFlashes(): void {
    const { ctx, game } = this;
    const cam = game.camera;
    const cs = game.world.cellSize;
    const sz = cs * cam.zoom;
    const vw = cam.viewW;
    const vh = cam.viewH;
    for (const f of game.cellFlashes) {
      const sx = cam.worldToScreenX(f.cx * cs);
      const sy = cam.worldToScreenY(f.cy * cs);
      if (sx + sz < 0 || sy + sz < 0 || sx > vw || sy > vh) continue;
      const a = Math.max(0, f.life / f.maxLife);
      ctx.fillStyle = f.destroyed
        ? `rgba(255, 195, 115, ${a * 0.42})`
        : `rgba(255, 225, 165, ${a * 0.52})`;
      ctx.fillRect(sx, sy, sz, sz);
    }
  }

  /**
   * Gently flashing soft glow as each door tile individually lights up and disappears.
   */
  private drawDoorFlashes(): void {
    const { ctx, game } = this;
    const cam = game.camera;
    const cs = game.world.cellSize;
    const sz = cs * cam.zoom;
    if (game.doorFlashes.length === 0) return;
    for (const f of game.doorFlashes) {
      if (f.delay > 0) continue;
      const progress = 1 - Math.max(0, f.life / f.maxLife); // 0 -> 1
      // Soft gentle pulse: rises softly, then fades away smoothly
      const glow = Math.sin(progress * Math.PI);
      const sx = cam.worldToScreenX(f.cx * cs);
      const sy = cam.worldToScreenY(f.cy * cs);
      if (sx + sz < 0 || sy + sz < 0 || sx > cam.viewW || sy > cam.viewH) continue;
      const paint = TIER_PAINT[f.tier] ?? TIER_PAINT[1];

      // Soft outer ambient aura
      const halo = sz * 0.6;
      ctx.fillStyle = `rgba(${paint[0]}, ${paint[1]}, ${paint[2]}, ${glow * 0.28})`;
      ctx.fillRect(sx - halo, sy - halo, sz + halo * 2, sz + halo * 2);

      // Warm bright inner core flash
      ctx.fillStyle = `rgba(255, 248, 220, ${glow * 0.65})`;
      ctx.fillRect(sx, sy, sz, sz);
    }
  }

  /** Draw a pixel-art soldier sprite centred on a screen point (nearest-neighbour, pixel-snapped). */
  private drawSoldierSprite(sprite: HTMLCanvasElement, sx: number, sy: number): void {
    const size = Math.max(1, Math.round(sprite.width * ART_PIXEL * this.game.camera.zoom));
    const half = size / 2;
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(sprite, Math.round(sx - half), Math.round(sy - half), size, size);
  }

  private drawSoldiers(): void {
    const { ctx, game } = this;
    const cam = game.camera;
    const commander = game.getCommander();
    const pad = (SOLDIER.ringRadius + 16) * cam.zoom + 24;
    const vw = cam.viewW;
    const vh = cam.viewH;
    for (const s of game.soldiers) {
      if (!s.alive) continue;
      const sx = cam.worldToScreenX(s.x);
      const sy = cam.worldToScreenY(s.y);
      if (sx + pad < 0 || sy + pad < 0 || sx - pad > vw || sy - pad > vh) continue;
      // The ring marks the soldier the camera is following (auto or Tab-selected).
      const selected = cam.following && cam.targetId === s.id;
      // Each loadout slot has its own body shape, rotated to face where it aims.
      this.drawSoldierSprite(soldierShapeSprite(soldierShapeIndex(s.slotIndex), s.facingAngle, selected), sx, sy);
      if (s.secondary) {
        this.drawSoldierEnergyOutline(s, sx, sy);
      }
      const br = SOLDIER.renderRadius * cam.zoom;

      if (s === commander) {
        ctx.save();
        ctx.fillStyle = "#ffd84d";
        ctx.strokeStyle = "#fffbe0";
        ctx.lineWidth = 1;
        // Commander chevron orbits the soldier, pointing where it aims
        // (the player's aim under manual control, its heading otherwise).
        const a = s.facingAngle;
        const orbit = SOLDIER.ringRadius * cam.zoom + 5;
        ctx.translate(sx + Math.cos(a) * orbit, sy + Math.sin(a) * orbit);
        ctx.rotate(a + Math.PI / 2);
        ctx.beginPath();
        ctx.moveTo(-3.5, 1.75);
        ctx.lineTo(0, -1.75);
        ctx.lineTo(3.5, 1.75);
        ctx.lineTo(0, 0.25);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
      if (s.maxHealth > 0) {
        const barW = Math.max(12, 10 * cam.zoom);
        const barH = 2.5;
        const barX = sx - barW / 2;
        const barY = sy - br - 5;
        ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
        ctx.fillRect(barX - 0.5, barY - 0.5, barW + 1, barH + 1);
        const pct = Math.max(0, Math.min(1, s.health / s.maxHealth));
        ctx.fillStyle = pct > 0.4 ? "#38d6ff" : "#ff4b7d";
        ctx.fillRect(barX, barY, barW * pct, barH);
      }
    }
  }

  private readonly outlineX = new Float32Array(10);
  private readonly outlineY = new Float32Array(10);
  private readonly outlineLen = new Float32Array(9);

  /**
   * 1-pixel-thick golden outline around the soldier sprite orthogonally (with cut corners).
   * Starts at 12 o'clock (top/north) and fills clockwise proportional to secondary energy.
   * Batched into 3-4 strokes (instead of up to 54 individual segment strokes) for mobile speed.
   */
  private drawSoldierEnergyOutline(s: Soldier, sx: number, sy: number): void {
    const req = this.game.getSecondaryEnergyRequired(s.secondary);
    if (req <= 0) return;
    const pct = Math.max(0, Math.min(1, s.secondaryEnergy / req));
    if (pct <= 0) return;

    const { ctx } = this;
    const cam = this.game.camera;
    const br = Math.max(4, SOLDIER.renderRadius * cam.zoom);
    const R = Math.round(br + Math.max(2.5, 3.5 * cam.zoom));
    const C = Math.max(2, Math.round(R * 0.35));

    const diag = C * Math.SQRT2;
    const flatHalf = R - C;
    const flatFull = 2 * (R - C);

    const ox = this.outlineX;
    const oy = this.outlineY;
    const ol = this.outlineLen;
    ox[0] = sx;            oy[0] = sy - R;
    ox[1] = sx + flatHalf; oy[1] = sy - R;
    ox[2] = sx + R;        oy[2] = sy - flatHalf;
    ox[3] = sx + R;        oy[3] = sy + flatHalf;
    ox[4] = sx + flatHalf; oy[4] = sy + R;
    ox[5] = sx - flatHalf; oy[5] = sy + R;
    ox[6] = sx - R;        oy[6] = sy + flatHalf;
    ox[7] = sx - R;        oy[7] = sy - flatHalf;
    ox[8] = sx - flatHalf; oy[8] = sy - R;
    ox[9] = sx;            oy[9] = sy - R;

    ol[0] = flatHalf; ol[1] = diag; ol[2] = flatFull; ol[3] = diag;
    ol[4] = flatFull; ol[5] = diag; ol[6] = flatFull; ol[7] = diag; ol[8] = flatHalf;

    const totalPerimeter = flatHalf * 2 + flatFull * 3 + diag * 4;
    const targetDist = pct * totalPerimeter;

    ctx.save();
    ctx.lineWidth = 1;

    // Faint dark-gold background guide track
    ctx.strokeStyle = "rgba(180, 140, 20, 0.2)";
    ctx.beginPath();
    ctx.moveTo(ox[0], oy[0]);
    for (let i = 1; i <= 9; i++) ctx.lineTo(ox[i], oy[i]);
    ctx.stroke();

    const strokeRange = (dStart: number, dEnd: number, style: string): void => {
      if (dEnd <= dStart) return;
      ctx.strokeStyle = style;
      ctx.beginPath();
      let acc = 0;
      let started = false;
      for (let i = 0; i < 9; i++) {
        const segLen = ol[i];
        const segEnd = acc + segLen;
        if (segEnd > dStart && acc < dEnd) {
          const t0 = segLen > 0 ? Math.max(0, (dStart - acc) / segLen) : 0;
          const t1 = segLen > 0 ? Math.min(1, (dEnd - acc) / segLen) : 1;
          const ax = ox[i] + (ox[i + 1] - ox[i]) * t0;
          const ay = oy[i] + (oy[i + 1] - oy[i]) * t0;
          const bx = ox[i] + (ox[i + 1] - ox[i]) * t1;
          const by = oy[i] + (oy[i + 1] - oy[i]) * t1;
          if (!started) {
            ctx.moveTo(ax, ay);
            started = true;
          }
          ctx.lineTo(bx, by);
        }
        acc = segEnd;
        if (acc >= dEnd) break;
      }
      ctx.stroke();
    };

    if (pct >= 1) {
      const shimmer = 0.8 + 0.2 * Math.sin(performance.now() * 0.008);
      ctx.strokeStyle = `rgba(255, 225, 90, ${shimmer})`;
      ctx.beginPath();
      ctx.moveTo(ox[0], oy[0]);
      for (let i = 1; i <= 9; i++) ctx.lineTo(ox[i], oy[i]);
      ctx.stroke();
    } else {
      // Three batched gradient bands: dim tail (0..55%), bright gold (55..92%), hot tip (92..100%)
      strokeRange(0, targetDist * 0.55, "rgba(218, 165, 32, 0.42)");
      strokeRange(targetDist * 0.55, targetDist * 0.92, "rgba(255, 216, 77, 0.82)");
      strokeRange(targetDist * 0.92, targetDist, "rgba(255, 255, 220, 0.98)");
    }

    // Bright spark at the leading tip
    let cur = targetDist;
    let tipX = ox[0];
    let tipY = oy[0];
    for (let i = 0; i < 9; i++) {
      const len = ol[i];
      if (cur <= len || i === 8) {
        const frac = len > 0 ? Math.max(0, Math.min(1, cur / len)) : 0;
        tipX = ox[i] + (ox[i + 1] - ox[i]) * frac;
        tipY = oy[i] + (oy[i + 1] - oy[i]) * frac;
        break;
      }
      cur -= len;
    }
    ctx.fillStyle = pct >= 1 ? "#fffef0" : "#ffffff";
    ctx.fillRect(Math.round(tipX - 0.5), Math.round(tipY - 0.5), 1.5, 1.5);

    ctx.restore();
  }

  /** Bright outward-facing muzzle core flare along the firing vector. */
  private drawMuzzleFlares(): void {
    const { ctx, game } = this;
    const mult = game.muzzleFlashMultiplier;
    if (mult <= 0) return;
    const cam = game.camera;
    const reach = 26 * cam.zoom;
    const vw = cam.viewW;
    const vh = cam.viewH;
    for (const f of game.flashes) {
      const sx = cam.worldToScreenX(f.x);
      const sy = cam.worldToScreenY(f.y);
      if (sx + reach < 0 || sy + reach < 0 || sx - reach > vw || sy - reach > vh) continue;
      const a = Math.max(0, f.life / f.maxLife) * mult;
      ctx.save();
      // The flare is drawn after the lighting pass, so stop it at walls here.
      if (f.hasPolygon) {
        this.lightRenderer.tracePolygonPath(ctx, game, f.poly, f.polyCount);
        ctx.clip();
      }
      ctx.translate(sx, sy);
      ctx.rotate(Math.atan2(f.dy, f.dx));
      const fl = 22 * cam.zoom * (0.45 + 0.55 * a);
      const fw = 7.5 * cam.zoom * (0.5 + 0.5 * a);
      ctx.globalAlpha = a;
      ctx.drawImage(this.sprites.hotGlow, -fw * 0.45, -fw, fl, fw * 2);
      // White-hot core pinpoint.
      const cr = 3.8 * cam.zoom * a;
      ctx.drawImage(this.sprites.dot, -cr, -cr, cr * 2, cr * 2);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  /**
   * Pixel-art bullets: a single bright head pixel with a one-pixel-wide trail that
   * fades toward the tail. Pixels sit on a world-aligned grid of `ART_PIXEL` cells,
   * stepped along the trail like a pixel-art line.
   */
  private drawBullets(): void {
    const { ctx, game } = this;
    if (game.combat.bullets.activeCount === 0) return;
    const cam = game.camera;
    const items = game.combat.bullets.items;
    const px = ART_PIXEL;
    for (let i = 0; i < items.length; i++) {
      const b = items[i];
      if (!b.active) continue;
      const sx = cam.worldToScreenX(b.x);
      const sy = cam.worldToScreenY(b.y);
      const isRocket = b.style === 1;
      const isSniper = b.style === 2;
      // Flame jets and Circuit Runner have separate renderers.
      if (b.style === 4 || b.circuit) continue;
      if (b.style === 3) {
        // The crescent has its own width-dependent bounds.
        this.drawSlash(b);
        continue;
      }
      const maxTracer = isSniper ? BULLET.tracerLength * 2.4 : isRocket ? BULLET.tracerLength * 2 : BULLET.tracerLength;
      const tLen = Math.min(maxTracer, b.traveled);
      const tailX = cam.worldToScreenX(b.x - b.dx * tLen);
      const tailY = cam.worldToScreenY(b.y - b.dy * tLen);
      const pad = 3 * ART_PIXEL * cam.zoom + 2;
      if (Math.max(sx, tailX) < -pad || Math.min(sx, tailX) > cam.viewW + pad ||
          Math.max(sy, tailY) < -pad || Math.min(sy, tailY) > cam.viewH + pad) continue;

      // Head and tail in art-pixel grid coordinates.
      const hx = Math.floor(b.x / px);
      const hy = Math.floor(b.y / px);
      const tx = Math.floor((b.x - b.dx * tLen) / px);
      const ty = Math.floor((b.y - b.dy * tLen) / px);
      const steps = Math.max(Math.abs(hx - tx), Math.abs(hy - ty));

      if (isRocket) {
        this.drawRocket(hx, hy, tx, ty, steps);
        continue;
      }

      ctx.fillStyle = isSniper ? "#d7fcff" : "#fff2c3";
      // Skip redundant sub-pixel overdraw when zoomed out below 1x.
      const stride = cam.zoom < 1 ? Math.ceil(1 / cam.zoom) : 1;
      // Trail: tail (k = 0) is faint, the pixel just behind the head is brightest.
      for (let k = 0; k < steps; k += stride) {
        const t = k / steps;
        ctx.globalAlpha = 0.12 + 0.6 * t;
        this.fillArtPixel(Math.round(tx + (hx - tx) * t), Math.round(ty + (hy - ty) * t), 1);
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#ffffff";
      this.fillArtPixel(hx, hy, 1);
    }
    ctx.globalAlpha = 1;
  }

  /**
   * Katana slash: a pixel-art crescent cutting wave rasterized on the art-pixel
   * grid. Layers, back to front: a sparse dithered aura, the crescent body
   * (dimmer toward its inner curve), a white one-pixel cutting edge, then
   * trailing air-cut streaks (and Gale Edge echoes). The sword itself is never drawn.
   */
  private drawSlash(b: Bullet): void {
    const { ctx, game } = this;
    const cam = game.camera;
    const sx = cam.worldToScreenX(b.x);
    const sy = cam.worldToScreenY(b.y);
    const pad = (b.slashWidth || 16) * cam.zoom + 30;
    if (sx < -pad || sy < -pad || sx > cam.viewW + pad || sy > cam.viewH + pad) return;

    const lifePct = b.maxLife > 0 ? Math.max(0, b.life / b.maxLife) : 1;
    const progress = 1 - lifePct;
    const alpha = Math.min(1, lifePct * 1.5);
    if (alpha <= 0.01) return;

    if (b.slashCircular) {
      this.drawCircularSlash(b, progress, alpha);
      return;
    }

    // Local crescent frame in world units: +u is the cutting direction.
    const w = b.slashWidth || 16;
    const rangeScale = !b.gale && b.slashRange > 0 ? b.slashRange / 24 : 1;
    const bulge = w * (b.gale ? 0.65 : 0.42 * rangeScale);
    const ang = Math.atan2(b.dy, b.dx) + b.slashAngle;
    const cos = Math.cos(ang);
    const sin = Math.sin(ang);
    const tipY = w * 0.5;
    const tipX = -bulge * 0.35;
    const outerC = bulge * 1.15;
    const innerC = bulge * 0.28;
    const trail = Math.min(8, b.traveled * 0.5);
    // Stationary melee slice animates by sweeping across the arc from one tip to the other.
    const sweepT = b.gale || this.motion.matches ? 1 : Math.min(1, progress / 0.45);
    const sweepEased = 1 - (1 - sweepT) * (1 - sweepT);
    const swingDir = b.slashAngle >= 0 ? 1 : -1;
    // Streak curves as [x0, control, halfHeight]: the air-cut trail, then Gale echoes.
    const streaks: [number, number, number][] = [];
    if (trail > 1) streaks.push([tipX - trail, (bulge - trail) * 0.8, tipY * 0.7]);
    if (b.gale && !this.motion.matches) for (const off of [6, 12]) streaks.push([tipX - off, bulge - off, tipY * 0.8]);
    if (!b.gale && !this.motion.matches && sweepEased > 0.15) {
      const animOff = 2 + sweepEased * 4;
      streaks.push([tipX - animOff, bulge - animOff, tipY * 0.78]);
    }
    const blade = b.gale ? "#aaffd7" : "#a8f5ff";
    const bladeDim = b.gale ? "#4fc79a" : "#3fb6d8";

    // A quadratic from (x0, -h) through control (c, 0) to (x0, h) is
    // x(v) = x0 + 2t(1-t)(c - x0) with t = (v + h) / 2h. Returns NaN outside |v| <= h.
    const curveX = (v: number, x0: number, c: number, h: number): number => {
      const t = (v + h) / (2 * h);
      return t < 0 || t > 1 ? NaN : x0 + 2 * t * (1 - t) * (c - x0);
    };
    // Half-thickness that keeps a steep curve one connected pixel line.
    const lineHalf = (v: number, x0: number, c: number, h: number): number => {
      const slope = ((1 - 2 * ((v + h) / (2 * h))) / h) * (c - x0);
      return 0.5 * Math.sqrt(1 + slope * slope);
    };

    const reach = Math.max(tipY, bulge * 1.3) + trail + 14;
    const gx0 = Math.floor((b.x - reach) / ART_PIXEL);
    const gx1 = Math.floor((b.x + reach) / ART_PIXEL);
    const gy0 = Math.floor((b.y - reach) / ART_PIXEL);
    const gy1 = Math.floor((b.y + reach) / ART_PIXEL);
    for (let gy = gy0; gy <= gy1; gy++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const dx = (gx + 0.5) * ART_PIXEL - b.x;
        const dy = (gy + 0.5) * ART_PIXEL - b.y;
        const u = dx * cos + dy * sin;
        const v = -dx * sin + dy * cos;
        if (Math.abs(v) > tipY + 1) continue;
        if (sweepEased < 1) {
          const arcPos = ((v * swingDir) / tipY + 1) * 0.5;
          if (arcPos > sweepEased) continue;
        }
        const xo = curveX(v, tipX, outerC, tipY);
        const xi = curveX(v, tipX, innerC, tipY);
        if (u <= xo && u >= xi) {
          if (u > xo - 0.9 * lineHalf(v, tipX, outerC, tipY) * 2) {
            ctx.fillStyle = "#ffffff";
            ctx.globalAlpha = alpha;
          } else {
            const depth = (u - xi) / Math.max(1e-4, xo - xi);
            ctx.fillStyle = depth > 0.45 ? blade : bladeDim;
            ctx.globalAlpha = alpha * 0.9;
          }
          fillArtPixel(ctx, cam, gx, gy);
          continue;
        }
        // Trailing air-cut streaks behind the blade.
        let streak = false;
        for (const [x0, c, h] of streaks) {
          const xs = curveX(v, x0, c, h);
          if (xs === xs && Math.abs(u - xs) <= lineHalf(v, x0, c, h)) { streak = true; break; }
        }
        if (streak) {
          ctx.fillStyle = b.gale ? "#96ffdc" : "#5adcff";
          ctx.globalAlpha = alpha * 0.45;
          fillArtPixel(ctx, cam, gx, gy);
          continue;
        }
        // Sparse dithered aura just around the crescent.
        const xa = curveX(v, tipX - 2, bulge * 1.25, tipY);
        const xai = curveX(v, tipX - 2, bulge * 0.1, tipY);
        if (u <= xa && u >= xai && bayer(gx, gy) < 0.5) {
          ctx.fillStyle = "#38d6ff";
          ctx.globalAlpha = alpha * 0.35;
          fillArtPixel(ctx, cam, gx, gy);
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  /** Animated 360-degree circular katana swipe centered on the player. */
  private drawCircularSlash(b: Bullet, progress: number, alpha: number): void {
    const { ctx, game } = this;
    const cam = game.camera;
    const radius = 5.2 + (b.slashRange || 24);
    const sweepT = this.motion.matches ? 1 : Math.min(1, progress / 0.5);
    const sweepEased = 1 - (1 - sweepT) * (1 - sweepT);
    const maxAngle = sweepEased * Math.PI * 2;
    const startAngle = Math.atan2(b.dy, b.dx);
    const bandHalf = Math.max(2.5, (b.slashWidth || 16) * 0.22);
    const outerR = radius * (0.7 + 0.3 * sweepEased);
    const innerR = Math.max(2, outerR - bandHalf * 2);

    const reach = outerR + 4;
    const gx0 = Math.floor((b.x - reach) / ART_PIXEL);
    const gx1 = Math.floor((b.x + reach) / ART_PIXEL);
    const gy0 = Math.floor((b.y - reach) / ART_PIXEL);
    const gy1 = Math.floor((b.y + reach) / ART_PIXEL);
    for (let gy = gy0; gy <= gy1; gy++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const dx = (gx + 0.5) * ART_PIXEL - b.x;
        const dy = (gy + 0.5) * ART_PIXEL - b.y;
        const dist = Math.hypot(dx, dy);
        if (dist < innerR - 2 || dist > outerR + 2) continue;

        let rel = Math.atan2(dy, dx) - startAngle;
        while (rel < 0) rel += Math.PI * 2;
        while (rel >= Math.PI * 2) rel -= Math.PI * 2;
        if (sweepEased < 1 && rel > maxAngle) continue;

        if (dist <= outerR && dist >= innerR) {
          if (dist > outerR - 1.2) {
            ctx.fillStyle = "#ffffff";
            ctx.globalAlpha = alpha;
          } else {
            const depth = (dist - innerR) / Math.max(1e-4, outerR - innerR);
            ctx.fillStyle = depth > 0.45 ? "#a8f5ff" : "#3fb6d8";
            ctx.globalAlpha = alpha * 0.9;
          }
          fillArtPixel(ctx, cam, gx, gy);
        } else if (bayer(gx, gy) < 0.45) {
          ctx.fillStyle = "#38d6ff";
          ctx.globalAlpha = alpha * 0.35;
          fillArtPixel(ctx, cam, gx, gy);
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  /**
   * Rocket: a 3x3 pixel head with a fiery trail that tapers from 3 pixels wide
   * behind the head to 1 pixel at the tail, cooling from white-yellow through
   * orange to deep red, with a little per-frame flicker.
   */
  private drawRocket(hx: number, hy: number, tx: number, ty: number, steps: number): void {
    const ctx = this.ctx;
    // Normal blending: the 3-wide trail squares overlap, and additive blending
    // would wash them out to white.
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    for (let k = 0; k < steps; k++) {
      const t = k / steps; // 0 = tail, 1 = just behind the head
      // Ragged, flickering tail end.
      if (t < 0.35 && Math.random() < 0.35) continue;
      const w = t > 0.7 ? 3 : t > 0.35 ? 2 : 1;
      const jitter = t < 0.5 && Math.random() < 0.3 ? (Math.random() < 0.5 ? -1 : 1) : 0;
      const cx = Math.round(tx + (hx - tx) * t) + (Math.abs(hx - tx) >= Math.abs(hy - ty) ? 0 : jitter);
      const cy = Math.round(ty + (hy - ty) * t) + (Math.abs(hx - tx) >= Math.abs(hy - ty) ? jitter : 0);
      ctx.fillStyle = t > 0.82 ? "#ffd84a" : t > 0.6 ? "#ff9a1c" : t > 0.35 ? "#f2530e" : "#a8200a";
      ctx.globalAlpha = (0.4 + 0.6 * t) * (0.75 + 0.25 * Math.random());
      const o = Math.floor((w - 1) / 2);
      this.fillArtPixel(cx - o, cy - o, w);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#ffc23a";
    this.fillArtPixel(hx - 1, hy - 1, 3);
    ctx.fillStyle = "#fffbe0";
    this.fillArtPixel(hx, hy, 1);
    ctx.restore();
  }

  /** Fill `n` x `n` art pixels starting at grid cell (gx, gy), snapped to screen pixels. */
  private fillArtPixel(gx: number, gy: number, n: number): void {
    fillArtPixel(this.ctx, this.game.camera, gx, gy, n);
  }

  private drawOpaqueParticles(): void {
    const { ctx, game } = this;
    const p = game.particles;
    if (p.count === 0) return;
    const cam = game.camera;
    let lastFill = "";
    for (let i = 0; i < p.count; i++) {
      const k = p.kind[i];
      if (k !== PKind.Debris && k !== PKind.Smoke) continue;
      const a = Math.max(0, p.life[i] / p.maxLife[i]);
      const sx = cam.worldToScreenX(p.x[i]);
      const sy = cam.worldToScreenY(p.y[i]);
      const sz = Math.max(1.5, p.size[i] * cam.zoom);
      if (sx + sz + 1 < 0 || sy + sz + 1 < 0 || sx - sz - 1 > cam.viewW || sy - sz - 1 > cam.viewH) continue;
      if (k === PKind.Smoke) {
        ctx.globalAlpha = a * 0.22;
        ctx.drawImage(this.sprites.dot, sx - sz, sy - sz, sz * 2, sz * 2);
      } else {
        ctx.globalAlpha = a;
        const fill = hexColor(p.color[i]);
        if (fill !== lastFill) { ctx.fillStyle = fill; lastFill = fill; }
        ctx.fillRect(sx - sz / 2, sy - sz / 2, sz, sz);
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawAdditiveParticles(): void {
    const { ctx, game } = this;
    const p = game.particles;
    if (p.count === 0) return;
    const cam = game.camera;
    const stride = cam.zoom < 1 ? Math.ceil(1 / cam.zoom) : 1;
    let lastFill = "";
    for (let i = 0; i < p.count; i++) {
      const k = p.kind[i];
      if (k === PKind.Debris || k === PKind.Smoke) continue;
      const a = Math.max(0, p.life[i] / p.maxLife[i]);
      const sx = cam.worldToScreenX(p.x[i]);
      const sy = cam.worldToScreenY(p.y[i]);
      if (k === PKind.Spark) {
        // Pixel-art streak: a one-pixel line from the tail to a brighter head.
        const tailX = p.x[i] - p.vx[i] * 0.026;
        const tailY = p.y[i] - p.vy[i] * 0.026;
        const tx = cam.worldToScreenX(tailX);
        const ty = cam.worldToScreenY(tailY);
        const pad = ART_PIXEL * cam.zoom + 1;
        if (Math.max(sx, tx) < -pad || Math.min(sx, tx) > cam.viewW + pad ||
            Math.max(sy, ty) < -pad || Math.min(sy, ty) > cam.viewH + pad) continue;
        const fill = hexColor(p.color[i]);
        if (fill !== lastFill) { ctx.fillStyle = fill; lastFill = fill; }
        const ax = Math.floor(tailX / ART_PIXEL), ay = Math.floor(tailY / ART_PIXEL);
        const bx = Math.floor(p.x[i] / ART_PIXEL), by = Math.floor(p.y[i] / ART_PIXEL);
        const steps = Math.max(Math.abs(bx - ax), Math.abs(by - ay), 1);
        for (let s = 0; s <= steps; s += stride) {
          const t = s / steps;
          ctx.globalAlpha = a * (0.35 + 0.65 * t);
          fillArtPixel(ctx, cam, Math.round(ax + (bx - ax) * t), Math.round(ay + (by - ay) * t));
        }
        // Larger sparks get a hot head pixel.
        if (p.size[i] >= 1.5) {
          ctx.globalAlpha = a;
          if (lastFill !== "#fff6d8") { ctx.fillStyle = "#fff6d8"; lastFill = "#fff6d8"; }
          fillArtPixel(ctx, cam, Math.floor(p.x[i] / ART_PIXEL), Math.floor(p.y[i] / ART_PIXEL));
        }
      } else {
        // Burst: a dithered pixel disc that swells a little as it fades.
        const rWorld = Math.max(1, p.size[i] * (0.75 + 0.35 * (1 - a)));
        const r = rWorld * cam.zoom;
        if (sx + r + 1 < 0 || sy + r + 1 < 0 || sx - r - 1 > cam.viewW || sy - r - 1 > cam.viewH) continue;
        ctx.globalAlpha = Math.min(1, a * 1.15);
        drawPixelSprite(ctx, cam, pixelDiscSprite(rWorld / ART_PIXEL, p.color[i], a > 0.45 ? 1 : 0.5), p.x[i], p.y[i]);
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawAimIndicator(): void {
    const { ctx, game } = this;
    const cam = game.camera;

    const now = performance.now() / 1000;
    const denied = game.spawnDenied;
    if (denied) drawSpawnDenied(ctx, cam, denied.x, denied.y, now - denied.t0, denied.unsurveyed);

    if (game.aimState.active) {
      // Pressing: the portal will open here when the press lets go.
      const wx = game.aimState.startWx;
      const wy = game.aimState.startWy;
      const unsurveyed = game.spawnUnsurveyedAt(wx, wy);
      const clear = circleIsClear(game.world, wx, wy, SOLDIER.collisionRadius + SOLDIER.deployClearance);
      drawPortalPreview(ctx, cam, wx, wy, now, unsurveyed || !clear, 0.95);
      this.deploymentOverlay.drawTargetLabel(ctx, game, wx, wy, unsurveyed, clear);
    } else if (game.input.mouseInside && game.canPlaceSoldier()) {
      // Hovering with the squad still in reserve: where the portal would open.
      const wx = cam.screenToWorldX(game.input.mouseX);
      const wy = cam.screenToWorldY(game.input.mouseY);
      const unsurveyed = game.spawnUnsurveyedAt(wx, wy);
      const clear = circleIsClear(game.world, wx, wy, SOLDIER.collisionRadius + SOLDIER.deployClearance);
      drawPortalPreview(ctx, cam, wx, wy, now, unsurveyed || !clear, 0.6);
      this.deploymentOverlay.drawTargetLabel(ctx, game, wx, wy, unsurveyed, clear);
    } else if (game.input.mouseInside && !game.canPlaceSoldier() && !game.paused && !game.runOver) {
      const sx = game.input.mouseX;
      const sy = game.input.mouseY;
      const cmdr = game.getCommander();

      if (!game.autoMove && cmdr) {
        // Manual commander aiming reticle and dashed line from commander to cursor
        const csx = cam.worldToScreenX(cmdr.x);
        const csy = cam.worldToScreenY(cmdr.y);
        ctx.save();
        ctx.strokeStyle = "rgba(255, 216, 77, 0.4)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(csx, csy);
        ctx.lineTo(sx, sy);
        ctx.stroke();

        ctx.strokeStyle = "#ffd84d";
        ctx.setLineDash([]);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(sx, sy, 7, 0, Math.PI * 2);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(sx - 10, sy);
        ctx.lineTo(sx - 4, sy);
        ctx.moveTo(sx + 4, sy);
        ctx.lineTo(sx + 10, sy);
        ctx.moveTo(sx, sy - 10);
        ctx.lineTo(sx, sy - 4);
        ctx.moveTo(sx, sy + 4);
        ctx.lineTo(sx, sy + 10);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  /** Draw equippable secondary sticky grenades (both flying and stuck to walls). */
  private drawGrenades(): void {
    const { ctx, game } = this;
    if (game.combat.grenades.activeCount === 0) return;
    const cam = game.camera;
    const items = game.combat.grenades.items;

    for (let i = 0; i < items.length; i++) {
      const g = items[i];
      if (!g.active) continue;

      const sx = cam.worldToScreenX(g.x);
      const sy = cam.worldToScreenY(g.y);
      if (sx < -40 || sy < -40 || sx > cam.viewW + 40 || sy > cam.viewH + 40) continue;

      ctx.save();
      ctx.translate(sx, sy);

      if (!g.stuck) {
        // Rotating grenade in flight
        ctx.rotate(g.rotation);
        const sz = Math.max(3, 5 * cam.zoom);
        ctx.fillStyle = "#2c3d4f";
        ctx.fillRect(-sz / 2, -sz / 2, sz, sz);
        ctx.fillStyle = "#ff6a38";
        ctx.fillRect(-sz / 4, -sz / 4, sz / 2, sz / 2);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(-0.5, -0.5, 1, 1);
      } else {
        // Stuck grenade anchored to wall
        const normAngle = Math.atan2(g.stuckNy, g.stuckNx);
        ctx.rotate(normAngle);

        const w = Math.max(4, 7 * cam.zoom);
        const h = Math.max(3, 5 * cam.zoom);

        // Base clamps against the wall
        ctx.fillStyle = "#1e2a38";
        ctx.fillRect(-h, -w / 2, h, w);

        // Body canister
        ctx.fillStyle = "#3e566d";
        ctx.fillRect(-h * 0.85, -w * 0.35, h * 0.85, w * 0.7);

        // Pulsing red/white LED diode
        const flash = (g.fuse % 0.22) < 0.11;
        ctx.fillStyle = flash ? "#ffffff" : "#ff2244";
        ctx.beginPath();
        ctx.arc(-h * 0.45, 0, Math.max(1.5, 1.8 * cam.zoom), 0, Math.PI * 2);
        ctx.fill();

        // Expanding warning pulse ring when about to detonate
        if (g.fuse < 0.35) {
          const p = 1 - g.fuse / 0.35;
          ctx.strokeStyle = `rgba(255, 60, 40, ${1 - p})`;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(-h * 0.45, 0, (3 + p * 18) * cam.zoom, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      ctx.restore();
    }
  }

  /** Draw temporary deployable autoturrets with crisp pixel-art geometry. */
  private drawTurrets(): void {
    const { ctx, game } = this;
    const cam = game.camera;
    const items = game.combat.turrets.items;
    const z = cam.zoom;
    const px = Math.max(1, Math.round(z));

    for (let i = 0; i < items.length; i++) {
      const t = items[i];
      if (!t.active) continue;

      const sx = Math.round(cam.worldToScreenX(t.x));
      const sy = Math.round(cam.worldToScreenY(t.y));
      if (sx < -40 || sy < -40 || sx > cam.viewW + 40 || sy > cam.viewH + 40) continue;

      ctx.save();
      ctx.translate(sx, sy);

      // --- Pixel-Art Tripod Legs (snapped along 3 diagonal angles) ---
      ctx.fillStyle = "#16202c";
      const legReach = 5;
      for (let leg = 0; leg < 3; leg++) {
        const la = (leg * Math.PI * 2) / 3 + Math.PI / 6;
        const cosA = Math.cos(la);
        const sinA = Math.sin(la);
        for (let step = 2; step <= legReach; step++) {
          const lx = Math.round(cosA * step) * px;
          const ly = Math.round(sinA * step) * px;
          ctx.fillRect(lx - px / 2, ly - px / 2, px, px);
        }
        // Foot pad
        const fx = Math.round(cosA * legReach) * px;
        const fy = Math.round(sinA * legReach) * px;
        ctx.fillStyle = "#0c1219";
        ctx.fillRect(fx - px, fy - px, px * 2, px * 2);
        ctx.fillStyle = "#16202c";
      }

      // --- Stepped Octagonal Base Mount ---
      // Outer border / rim (octagonal silhouette: 7x7 with corners cut)
      ctx.fillStyle = "#1f2a38";
      ctx.fillRect(-3 * px, -2 * px, 6 * px, 4 * px);
      ctx.fillRect(-2 * px, -3 * px, 4 * px, 6 * px);

      // Base top plate (chiseled dark gunmetal)
      ctx.fillStyle = "#2c3b4d";
      ctx.fillRect(-2 * px, -1 * px, 4 * px, 2 * px);
      ctx.fillRect(-1 * px, -2 * px, 2 * px, 4 * px);

      // Corner rivets / bolts (4 small dots on base plate)
      ctx.fillStyle = "#4a637d";
      ctx.fillRect(-2 * px, -2 * px, px, px);
      ctx.fillRect(px, -2 * px, px, px);
      ctx.fillRect(-2 * px, px, px, px);
      ctx.fillRect(px, px, px, px);

      // --- Swiveling Turret Head ---
      ctx.save();
      ctx.rotate(t.angle);

      // Heavy Twin-Gun Barrel Assembly
      // Recoil housing / mantlet mount
      ctx.fillStyle = "#1e2936";
      ctx.fillRect(0, -2 * px, 2 * px, 4 * px);

      // Twin gun barrels extending forward
      ctx.fillStyle = "#4d6275";
      ctx.fillRect(2 * px, -2 * px, 6 * px, px); // Top barrel
      ctx.fillRect(2 * px, px, 6 * px, px);      // Bottom barrel

      // Barrel vents / fluting
      ctx.fillStyle = "#334352";
      ctx.fillRect(4 * px, -2 * px, px, px);
      ctx.fillRect(4 * px, px, px, px);

      // Flashed muzzle compensators
      ctx.fillStyle = "#8ec3eb";
      ctx.fillRect(7 * px, -2 * px, px, px);
      ctx.fillRect(7 * px, px, px, px);

      // Armored Turret Housing (Stepped beveled cupola)
      ctx.fillStyle = "#253342"; // Deep shadow outline
      ctx.fillRect(-3 * px, -2 * px, 4 * px, 4 * px);
      ctx.fillRect(-2 * px, -3 * px, 3 * px, 6 * px);

      ctx.fillStyle = "#3a4d61"; // Main armor plate
      ctx.fillRect(-2 * px, -1 * px, 3 * px, 2 * px);
      ctx.fillRect(-1 * px, -2 * px, 2 * px, 4 * px);

      // Top-left light reflection facet (matches game lighting)
      ctx.fillStyle = "#5c7996";
      ctx.fillRect(-2 * px, -2 * px, px, px);
      ctx.fillRect(-1 * px, -1 * px, px, px);

      // Sensor Optic Visor / Targeter Lens (crisp square pixel lens)
      ctx.fillStyle = t.hasTarget ? "#38d6ff" : "#456782";
      ctx.fillRect(0, -px / 2, px, px);
      if (t.hasTarget) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, -px / 2, Math.max(1, Math.round(px / 2)), Math.max(1, Math.round(px / 2)));
      }

      ctx.restore();

      // --- Lifetime Indicator (Chunky Pixel Gauge) ---
      if (t.maxLife > 0) {
        const lifePct = Math.max(0, Math.min(1, t.life / t.maxLife));
        const totalBars = 6;
        const filledBars = Math.ceil(lifePct * totalBars);
        const barW = Math.max(1, Math.round(px * 0.9));
        const barH = Math.max(1, Math.round(px * 1.2));
        const startX = -((totalBars * (barW + 1) - 1) / 2);
        const gaugeY = 4 * px + 1;

        // Background backing
        ctx.fillStyle = "#0c1219";
        ctx.fillRect(startX - 1, gaugeY - 1, totalBars * (barW + 1) + 1, barH + 2);

        // Individual segmented pixel pips
        for (let b = 0; b < totalBars; b++) {
          const bx = startX + b * (barW + 1);
          if (b < filledBars) {
            ctx.fillStyle = lifePct < 0.25 ? "#ff4060" : "#38d6ff";
          } else {
            ctx.fillStyle = "#1e2936";
          }
          ctx.fillRect(bx, gaugeY, barW, barH);
        }
      }

      ctx.restore();
    }
  }
}
