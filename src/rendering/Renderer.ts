import { drawWeaponExpansion } from "./WeaponExpansionRenderer";
import { drawGoo } from "./GooRenderer";
import { worldAtmosphere } from "../world/worldAtmosphere";
import { sectorSpawnCell } from "../world/labMap";
import { LootKind } from "../entities/LootSystem";
import { ESSENCE_FPS, ESSENCE_SIZE, essenceFrame, essencePixels, paintPixels } from "./blightEssence";
import { ART_PIXEL, BULLET, COLORS, GROWTH, SOLDIER } from "../config";
import type { Bullet } from "../entities/Bullet";
import type { Soldier } from "../entities/Soldier";
import { PKind } from "../entities/ParticleSystem";
import type { Game } from "../Game";
import { FieryFlashRenderer } from "./FieryFlashRenderer";
import { FireRenderer } from "./FireRenderer";
import { CreatureRenderer } from "./CreatureRenderer";
import { FogRenderer } from "./FogRenderer";
import { LightRenderer } from "./LightRenderer";
import { createSprites, soldierShapeSprite, type Sprites } from "./sprites";
import { soldierShapeIndex } from "../entities/soldierShapes";
import { CRACK_PATTERNS } from "./materials";
import { TIER_PAINT } from "./materials";
import { FACILITY } from "../config";
import { paletteColor, SPRITES } from "../ui/pixelArt";
import type { Door } from "../world/PixelWorld";

/** Keycard colors by tier, as on the research-base upgrades. */
const KEYCARD_COLORS = ["#3078ff", "#3078ff", "#ff2a2a", "#d65c12", "#8a6ad0", "#6aa040", "#d8c8a0"];

/** Door core lightened toward the rim as it takes damage. */
function doorCoreDamaged(d: number): string {
  const l = Math.round(35 + d * 70);
  return `rgb(${l}, ${l + 6}, ${l + 16})`;
}

function hexColor(c: number): string {
  return `#${c.toString(16).padStart(6, "0")}`;
}

export class Renderer {
  private motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  /** The one living frame every Blight Essence drop shares. */
  private essenceCanvas = document.createElement("canvas");
  private essenceShown = -1;
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private sprites: Sprites;
  private creatureRenderer = new CreatureRenderer();
  private lightRenderer: LightRenderer;
  private fieryFlash: FieryFlashRenderer;
  private fireRenderer = new FireRenderer();
  private fogRenderer: FogRenderer;

  constructor(
    private canvas: HTMLCanvasElement,
    private game: Game,
  ) {
    this.ctx = canvas.getContext("2d", { alpha: false })!;
    this.sprites = createSprites();
    this.lightRenderer = new LightRenderer(this.sprites);
    this.fieryFlash = new FieryFlashRenderer(this.lightRenderer);
    this.fogRenderer = new FogRenderer(game.fog);
  }

  resize(): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
  }

  draw(): void {
    const { ctx, game } = this;
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
      const sx = cam.worldToScreenX(game.world.roomX0 * cs);
      const sy = cam.worldToScreenY(game.world.roomY0 * cs);
      const sw = game.world.roomSize * cs * cam.zoom;
      ctx.fillStyle = COLORS.spawnFloor;
      ctx.fillRect(sx, sy, sw, sw);
    }

    game.terrain.drawFloor(ctx, cam);
    game.terrain.draw(ctx, cam, game.showChunkBorders);
    this.drawDoors();
    this.drawUpgradeCaches();
    const portal = game.labDef.teleporter, frame = game.world.labLayout?.frame;
    if (portal && frame) {
      const at = sectorSpawnCell(frame, portal.sector);
      const x = cam.worldToScreenX(at.cx * game.world.cellSize), y = cam.worldToScreenY(at.cy * game.world.cellSize);
      const r = game.world.cellSize * 2 * cam.zoom;
      ctx.strokeStyle = "#65fff0"; ctx.lineWidth = Math.max(1, cam.zoom * 2);
      ctx.strokeRect(x - r, y - r, 2 * r, 2 * r);
      ctx.fillStyle = "rgba(60,255,225,0.25)"; ctx.fillRect(x - r, y - r, 2*r, 2*r);
    }

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

    // 2) Dynamic lighting pass: multiply shadow-clipped lightmap over the albedo
    //    scene + additive air-scatter cone so shadows behind walls & soldiers pop.
    this.lightRenderer.renderLighting(ctx, game, this.dpr);
    game.terrain.drawLabGlow(ctx, cam, game.runStats.time);
    game.terrain.drawPanels(ctx, cam, performance.now() / 1000);
    game.terrain.drawLabLights(ctx, cam, performance.now() / 1000, this.motion.matches);
    this.drawSentries();
    game.late.draw(ctx, cam);
    this.creatureRenderer.draw(ctx, cam, game.creatures, this.motion.matches ? 0 : performance.now() / 1000);
    const wallClockMs = performance.now();
    const still = this.motion.matches;
    game.terrain.drawBlightEdges(ctx, cam, still ? 0 : wallClockMs / 1000);
    game.terrain.drawSurfaceOutlines(ctx, cam);

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
    this.drawBlightCorePulses();
    this.drawLoot();
    this.drawGrowthPulses();
    if (fiery) this.fieryFlash.drawHotPixels(ctx, game);
    else this.drawMuzzleFlares();
    this.drawBullets();
    this.fireRenderer.drawGlow(ctx, cam, game.fire, game.world, still ? 0 : wallClockMs / 1000);
    this.drawAdditiveParticles();
    ctx.restore();

    // 4) Fog of war over the whole world; the aim indicator stays readable on top.
    if (!game.devMapAccess) this.fogRenderer.draw(ctx, cam);
    // Soldiers are drawn after lighting and fog so the pixel-art sprite keeps
    // its full palette even when it outruns the light creeping after it.
    drawWeaponExpansion(ctx, game, still);
    this.drawSoldiers();
    this.drawGrenades();
    drawGoo(ctx, cam, game.combat.goo, still, game.lighting.quality === "low");
    this.drawTurrets();
    game.late.drawOverlay(ctx, cam);
    this.drawAimIndicator();
    this.drawGateNotice();

    this.lightRenderer.renderVignette(ctx, w, h);
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
      if(loot.value[i]>1){ctx.fillStyle="#e4f4e9";ctx.font="9px monospace";ctx.fillText(`×${loot.value[i]}`,sx+size/2,sy);}
    }
    if (lastAlpha !== 1) ctx.globalAlpha = 1;
  }

  /** Blight Essence drops: the living glob, on whole screen pixels so it stays crisp. */
  private drawEssence(nowMs: number, still: boolean): void {
    const { ctx, game } = this;
    const loot = game.loot;
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

  private drawCasings(): void {
    const { ctx, game } = this;
    const cam = game.camera;
    const c = game.casings;
    if (c.count === 0) return;
    const len = Math.max(2, 2.3 * cam.zoom);
    const wid = Math.max(1, 1.0 * cam.zoom);
    for (let i = 0; i < c.count; i++) {
      const sx = cam.worldToScreenX(c.x[i]);
      const sy = cam.worldToScreenY(c.y[i]);
      if (sx < -20 || sy < -20 || sx > cam.viewW + 20 || sy > cam.viewH + 20) continue;
      const a = Math.min(1, (c.life[i] / c.maxLife[i]) * 1.4);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(sx, sy);
      ctx.rotate(c.angle[i]);
      ctx.fillStyle = "#e8b85c";
      ctx.fillRect(-len / 2, -wid / 2, len, wid);
      ctx.fillStyle = "#fff1b8";
      ctx.fillRect(-len / 2, -wid / 2, len * 0.45, wid * 0.6);
      ctx.restore();
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

  /** Sealed caches marking where special upgrades will be: a dark plinth with a muted gold diamond. */
  private drawUpgradeCaches(): void {
    const { ctx, game } = this;
    const w = game.world;
    const cam = game.camera;
    const cs = w.cellSize;
    for (const spot of w.upgradeSpots) {
      const x = cam.worldToScreenX((spot.cx + 0.5) * cs);
      const y = cam.worldToScreenY((spot.cy + 0.5) * cs);
      const r = cs * 1.5 * cam.zoom;
      if (x < -r || y < -r || x > cam.viewW + r || y > cam.viewH + r) continue;
      const u = Math.max(1, Math.round(r / 6));
      ctx.fillStyle = "#101114";
      ctx.fillRect(Math.round(x - r), Math.round(y - r), Math.round(r * 2), Math.round(r * 2));
      ctx.fillStyle = "#2a2b30";
      ctx.fillRect(Math.round(x - r + u), Math.round(y - r + u), Math.round(r * 2 - u * 2), Math.round(r * 2 - u * 2));
      for (let k = -3; k <= 3; k++) {
        const half = (3 - Math.abs(k)) * u + u / 2;
        ctx.fillStyle = Math.abs(k) === 3 ? "#5e4a1e" : "#9c7a30";
        ctx.fillRect(Math.round(x - half), Math.round(y + k * u - u / 2), Math.round(half * 2), u);
      }
      ctx.fillStyle = "#101114";
      ctx.fillRect(Math.round(x - u / 2), Math.round(y - u / 2), u, u);
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
    for (const f of game.cellFlashes) {
      const a = Math.max(0, f.life / f.maxLife);
      const sx = cam.worldToScreenX(f.cx * cs);
      const sy = cam.worldToScreenY(f.cy * cs);
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
    for (const s of game.soldiers) {
      if (!s.alive) continue;
      const sx = cam.worldToScreenX(s.x);
      const sy = cam.worldToScreenY(s.y);
      // The ring marks the soldier the camera is following (auto or Tab-selected).
      const selected = cam.following && cam.targetId === s.id;
      // Each loadout slot has its own body shape, rotated to face where it aims.
      this.drawSoldierSprite(soldierShapeSprite(soldierShapeIndex(s.slotIndex), s.facingAngle, selected), sx, sy);
      if (s.secondary) {
        this.drawSoldierEnergyOutline(s, sx, sy);
      }
      const br = SOLDIER.renderRadius * cam.zoom;

      if (s === game.getCommander()) {
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

  /**
   * 1-pixel-thick golden outline around the soldier sprite orthogonally (with cut corners).
   * Starts at 12 o'clock (top/north) and fills clockwise proportional to secondary energy.
   * Brightest at the leading tip, leaving a trail of dimmer gold behind.
   */
  private drawSoldierEnergyOutline(s: Soldier, sx: number, sy: number): void {
    const req = this.game.getSecondaryEnergyRequired(s.secondary);
    if (req <= 0) return;
    const pct = Math.max(0, Math.min(1, s.secondaryEnergy / req));
    if (pct <= 0) return;

    const { ctx } = this;
    const cam = this.game.camera;
    const br = Math.max(4, SOLDIER.renderRadius * cam.zoom);
    // Extent of the cut-corner outline around the soldier's sprite:
    const R = Math.round(br + Math.max(2.5, 3.5 * cam.zoom));
    const C = Math.max(2, Math.round(R * 0.35));

    const diag = C * Math.SQRT2;
    const flatHalf = R - C;
    const flatFull = 2 * (R - C);

    const segLens = [flatHalf, diag, flatFull, diag, flatFull, diag, flatFull, diag, flatHalf];
    const segPoints: [number, number, number, number][] = [
      [0, -R, flatHalf, -R],
      [flatHalf, -R, R, -flatHalf],
      [R, -flatHalf, R, flatHalf],
      [R, flatHalf, flatHalf, R],
      [flatHalf, R, -flatHalf, R],
      [-flatHalf, R, -R, flatHalf],
      [-R, flatHalf, -R, -flatHalf],
      [-R, -flatHalf, -flatHalf, -R],
      [-flatHalf, -R, 0, -R],
    ];

    let totalPerimeter = 0;
    for (let i = 0; i < 9; i++) totalPerimeter += segLens[i];

    const targetDist = pct * totalPerimeter;

    ctx.save();
    ctx.lineWidth = 1;

    // Faint dark-gold background guide track so the player sees the outline shape
    ctx.strokeStyle = "rgba(180, 140, 20, 0.2)";
    ctx.beginPath();
    ctx.moveTo(sx, sy - R);
    for (let i = 0; i < 9; i++) {
      ctx.lineTo(sx + segPoints[i][2], sy + segPoints[i][3]);
    }
    ctx.stroke();

    const getPointAtDist = (d: number): [number, number] => {
      let cur = d;
      for (let i = 0; i < 9; i++) {
        const len = segLens[i];
        if (cur <= len || i === 8) {
          const frac = len > 0 ? Math.max(0, Math.min(1, cur / len)) : 0;
          const [x0, y0, x1, y1] = segPoints[i];
          return [x0 + (x1 - x0) * frac, y0 + (y1 - y0) * frac];
        }
        cur -= len;
      }
      return [0, -R];
    };

    // Render trail with fading gradient from dim gold at origin to brightest gold at the tip
    const numSteps = Math.max(12, Math.min(54, Math.ceil(targetDist * 0.9)));
    const stepDist = targetDist / numSteps;

    for (let i = 0; i < numSteps; i++) {
      const d0 = i * stepDist;
      const d1 = (i + 1) * stepDist;
      const [x0, y0] = getPointAtDist(d0);
      const [x1, y1] = getPointAtDist(d1);

      // u goes from 0 (at 12 o'clock) to 1.0 (at leading tip)
      const u = (i + 1) / numSteps;

      if (pct >= 1) {
        // Complete ring pulses with brilliant ready glow
        const shimmer = 0.8 + 0.2 * Math.sin(performance.now() * 0.008 + u * Math.PI * 2);
        ctx.strokeStyle = `rgba(255, 225, 90, ${shimmer})`;
      } else {
        const alpha = 0.25 + 0.75 * Math.pow(u, 1.4);
        if (u > 0.92) {
          ctx.strokeStyle = `rgba(255, 255, 220, ${alpha})`;
        } else if (u > 0.55) {
          ctx.strokeStyle = `rgba(255, 216, 77, ${alpha})`;
        } else {
          ctx.strokeStyle = `rgba(218, 165, 32, ${alpha * 0.75})`;
        }
      }

      ctx.beginPath();
      ctx.moveTo(sx + x0, sy + y0);
      ctx.lineTo(sx + x1, sy + y1);
      ctx.stroke();
    }

    // Bright spark at the leading tip
    const [tipX, tipY] = getPointAtDist(targetDist);
    ctx.fillStyle = pct >= 1 ? "#fffef0" : "#ffffff";
    ctx.fillRect(Math.round(sx + tipX - 0.5), Math.round(sy + tipY - 0.5), 1.5, 1.5);

    ctx.restore();
  }

  /** Bright outward-facing muzzle core flare along the firing vector. */
  private drawMuzzleFlares(): void {
    const { ctx, game } = this;
    const mult = game.muzzleFlashMultiplier;
    if (mult <= 0) return;
    const cam = game.camera;
    for (const f of game.flashes) {
      const a = Math.max(0, f.life / f.maxLife) * mult;
      const sx = cam.worldToScreenX(f.x);
      const sy = cam.worldToScreenY(f.y);
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
    const cam = game.camera;
    const items = game.combat.bullets.items;
    const px = ART_PIXEL;
    for (let i = 0; i < items.length; i++) {
      const b = items[i];
      if (!b.active) continue;
      const sx = cam.worldToScreenX(b.x);
      const sy = cam.worldToScreenY(b.y);
      if (sx < -40 || sy < -40 || sx > cam.viewW + 40 || sy > cam.viewH + 40) continue;
      const isRocket = b.style === 1;
      const isSniper = b.style === 2;
      const isSlash = b.style === 3;
      // Flame jets are drawn as the fire they shed (FireRenderer).
      if (b.style === 4) continue;

      if (isSlash) {
        this.drawSlash(b);
        continue;
      }
      const maxTracer = isSniper ? BULLET.tracerLength * 2.4 : isRocket ? BULLET.tracerLength * 2 : BULLET.tracerLength;
      const tLen = Math.min(maxTracer, b.traveled);

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
      // Trail: tail (k = 0) is faint, the pixel just behind the head is brightest.
      for (let k = 0; k < steps; k++) {
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
   * Katana slash: a luminous crescent cutting wave.
   * Actual sword is not visible — only the razor-sharp energy slash.
   */
  private drawSlash(b: Bullet): void {
    const { ctx, game } = this;
    const cam = game.camera;
    const sx = cam.worldToScreenX(b.x);
    const sy = cam.worldToScreenY(b.y);
    const pad = (b.slashWidth || 16) * cam.zoom + 30;
    if (sx < -pad || sy < -pad || sx > cam.viewW + pad || sy > cam.viewH + pad) return;

    const lifePct = b.maxLife > 0 ? Math.max(0, b.life / b.maxLife) : 1;
    const alpha = Math.min(1, lifePct * 1.5);
    const w = (b.slashWidth || 16) * cam.zoom;
    const bulge = w * 0.42;
    const dir = Math.atan2(b.dy, b.dx);
    const tilt = b.slashAngle;

    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(dir + tilt);

    const tipY = w * 0.5;
    const tipX = -bulge * 0.35;

    // 1. Faint outer cyan glow aura
    ctx.beginPath();
    ctx.moveTo(tipX - 2, -tipY);
    ctx.quadraticCurveTo(bulge * 1.25, 0, tipX - 2, tipY);
    ctx.quadraticCurveTo(bulge * 0.1, 0, tipX - 2, -tipY);
    ctx.closePath();
    ctx.fillStyle = `rgba(56, 214, 255, ${0.35 * alpha})`;
    ctx.fill();

    // 2. Main crescent slash blade
    ctx.beginPath();
    ctx.moveTo(tipX, -tipY);
    ctx.quadraticCurveTo(bulge * 1.15, 0, tipX, tipY);
    ctx.quadraticCurveTo(bulge * 0.28, 0, tipX, -tipY);
    ctx.closePath();
    ctx.fillStyle = `rgba(168, 245, 255, ${0.85 * alpha})`;
    ctx.fill();

    // 3. Razor-sharp white leading cutting edge
    ctx.beginPath();
    ctx.moveTo(tipX, -tipY);
    ctx.quadraticCurveTo(bulge * 1.15, 0, tipX, tipY);
    ctx.lineWidth = Math.max(1, 1.8 * cam.zoom);
    ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
    ctx.stroke();

    // 4. Subtle trailing motion streaks (air cut effect)
    const trailOffset = Math.min(8 * cam.zoom, b.traveled * cam.zoom * 0.5);
    if (trailOffset > 1) {
      ctx.beginPath();
      ctx.moveTo(tipX - trailOffset, -tipY * 0.7);
      ctx.quadraticCurveTo((bulge - trailOffset) * 0.8, 0, tipX - trailOffset, tipY * 0.7);
      ctx.lineWidth = Math.max(0.8, 1.0 * cam.zoom);
      ctx.strokeStyle = `rgba(90, 220, 255, ${0.4 * alpha})`;
      ctx.stroke();
    }

    ctx.restore();
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
    const cam = this.game.camera;
    const x0 = Math.round(cam.worldToScreenX(gx * ART_PIXEL));
    const y0 = Math.round(cam.worldToScreenY(gy * ART_PIXEL));
    const x1 = Math.round(cam.worldToScreenX((gx + n) * ART_PIXEL));
    const y1 = Math.round(cam.worldToScreenY((gy + n) * ART_PIXEL));
    this.ctx.fillRect(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
  }

  private drawOpaqueParticles(): void {
    const { ctx, game } = this;
    const cam = game.camera;
    const p = game.particles;
    for (let i = 0; i < p.count; i++) {
      const k = p.kind[i];
      if (k !== PKind.Debris && k !== PKind.Smoke) continue;
      const a = Math.max(0, p.life[i] / p.maxLife[i]);
      const sx = cam.worldToScreenX(p.x[i]);
      const sy = cam.worldToScreenY(p.y[i]);
      if (sx < -20 || sy < -20 || sx > cam.viewW + 20 || sy > cam.viewH + 20) continue;
      const sz = Math.max(1.5, p.size[i] * cam.zoom);
      if (k === PKind.Smoke) {
        ctx.globalAlpha = a * 0.22;
        ctx.drawImage(this.sprites.dot, sx - sz, sy - sz, sz * 2, sz * 2);
      } else {
        ctx.globalAlpha = a;
        ctx.fillStyle = hexColor(p.color[i]);
        ctx.fillRect(sx - sz / 2, sy - sz / 2, sz, sz);
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawAdditiveParticles(): void {
    const { ctx, game } = this;
    const cam = game.camera;
    const p = game.particles;
    for (let i = 0; i < p.count; i++) {
      const k = p.kind[i];
      if (k === PKind.Debris || k === PKind.Smoke) continue;
      const a = Math.max(0, p.life[i] / p.maxLife[i]);
      const sx = cam.worldToScreenX(p.x[i]);
      const sy = cam.worldToScreenY(p.y[i]);
      if (sx < -30 || sy < -30 || sx > cam.viewW + 30 || sy > cam.viewH + 30) continue;
      ctx.globalAlpha = a;
      if (k === PKind.Spark) {
        const tx = cam.worldToScreenX(p.x[i] - p.vx[i] * 0.026);
        const ty = cam.worldToScreenY(p.y[i] - p.vy[i] * 0.026);
        ctx.strokeStyle = hexColor(p.color[i]);
        ctx.lineWidth = Math.max(1, p.size[i] * 0.72 * cam.zoom);
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(sx, sy);
        ctx.stroke();
      } else {
        const r = Math.max(2, p.size[i] * cam.zoom);
        ctx.drawImage(this.sprites.hotGlow, sx - r, sy - r, r * 2, r * 2);
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawAimIndicator(): void {
    const { ctx, game } = this;
    const cam = game.camera;

    if (game.aimState.active) {
      // The player is pressing and may be dragging to aim
      const sx = cam.worldToScreenX(game.aimState.startWx);
      const sy = cam.worldToScreenY(game.aimState.startWy);
      const gr = SOLDIER.ringRadius * cam.zoom;
      const br = SOLDIER.renderRadius * cam.zoom;

      // Draw ghost soldier at placement origin
      ctx.drawImage(this.sprites.soldierGlow, sx - gr, sy - gr, gr * 2, gr * 2);
      ctx.save();
      ctx.globalAlpha = 0.85;
      this.drawSoldierSprite(this.sprites.soldier, sx, sy);
      ctx.restore();

      // Outer targeting ring
      ctx.save();
      ctx.strokeStyle = "#9ff3ff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(sx, sy, br + 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      if (game.aimState.isDragging) {
        // Player is dragging: show the arrow facing the opposite direction of drag
        const curSx = game.aimState.curSx;
        const curSy = game.aimState.curSy;
        const dragDx = curSx - sx;
        const dragDy = curSy - sy;
        const dragDist = Math.hypot(dragDx, dragDy);

        if (dragDist > 1e-3) {
          // Opposite direction: away from where pointer is / away from drag
          const aimDx = -dragDx / dragDist;
          const aimDy = -dragDy / dragDist;

          // 1) Pull-back slingshot tether (elastic dotted line to cursor)
          ctx.save();
          ctx.strokeStyle = "rgba(160, 230, 255, 0.45)";
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(curSx, curSy);
          ctx.stroke();

          // Small tether handle at pointer
          ctx.fillStyle = "rgba(160, 230, 255, 0.75)";
          ctx.beginPath();
          ctx.arc(curSx, curSy, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();

          // 2) Arrow facing OPPOSITE direction (away from cursor / where player let go)
          const arrowLen = Math.min(100, Math.max(35, dragDist * 0.85));
          const startDist = br + 3;
          const startX = sx + aimDx * startDist;
          const startY = sy + aimDy * startDist;
          const tipX = sx + aimDx * (startDist + arrowLen);
          const tipY = sy + aimDy * (startDist + arrowLen);

          // Arrow shaft with glow
          ctx.save();
          // Glow layer
          ctx.strokeStyle = "rgba(0, 229, 255, 0.4)";
          ctx.lineWidth = 6;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(startX, startY);
          ctx.lineTo(tipX, tipY);
          ctx.stroke();

          // Core shaft
          ctx.strokeStyle = "#9ff3ff";
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(startX, startY);
          ctx.lineTo(tipX, tipY);
          ctx.stroke();

          // Arrowhead pointing forward
          const headLen = 14;
          const headWidth = 11;
          const nx = -aimDy; // normal vector
          const ny = aimDx;
          const baseMidX = tipX - aimDx * headLen;
          const baseMidY = tipY - aimDy * headLen;
          const c1X = baseMidX + nx * (headWidth / 2);
          const c1Y = baseMidY + ny * (headWidth / 2);
          const c2X = baseMidX - nx * (headWidth / 2);
          const c2Y = baseMidY - ny * (headWidth / 2);
          const notchX = tipX - aimDx * (headLen * 0.7);
          const notchY = tipY - aimDy * (headLen * 0.7);

          ctx.fillStyle = "#ffffff";
          ctx.shadowColor = "#00e5ff";
          ctx.shadowBlur = 10;
          ctx.beginPath();
          ctx.moveTo(tipX, tipY);
          ctx.lineTo(c1X, c1Y);
          ctx.lineTo(notchX, notchY);
          ctx.lineTo(c2X, c2Y);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      } else {
        // Active click/press before drag threshold: show 4 cardinal direction hints (straight up, right, down, left)
        ctx.save();
        ctx.strokeStyle = "rgba(160, 230, 255, 0.6)";
        ctx.lineWidth = 2;
        const tickDist = br + 4;
        const tickLen = 6;
        // Up
        ctx.beginPath();
        ctx.moveTo(sx, sy - tickDist);
        ctx.lineTo(sx, sy - tickDist - tickLen);
        // Right
        ctx.moveTo(sx + tickDist, sy);
        ctx.lineTo(sx + tickDist + tickLen, sy);
        // Down
        ctx.moveTo(sx, sy + tickDist);
        ctx.lineTo(sx, sy + tickDist + tickLen);
        // Left
        ctx.moveTo(sx - tickDist, sy);
        ctx.lineTo(sx - tickDist - tickLen, sy);
        ctx.stroke();
        ctx.restore();
      }
    } else if (game.input.mouseInside && game.canPlaceSoldier()) {
      // Hovering with mouse while soldiers are in reserve: show placement cursor reticle
      const sx = game.input.mouseX;
      const sy = game.input.mouseY;
      const br = SOLDIER.renderRadius * cam.zoom;
      ctx.save();
      ctx.strokeStyle = "rgba(160, 230, 255, 0.45)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(sx, sy, br, 0, Math.PI * 2);
      ctx.stroke();

      // Subtle center dot
      ctx.fillStyle = "rgba(160, 230, 255, 0.6)";
      ctx.beginPath();
      ctx.arc(sx, sy, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
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
