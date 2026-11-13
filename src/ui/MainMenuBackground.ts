import { drawMapBoundary } from "../rendering/MapBoundaryRenderer";
import { ART_PIXEL, SOLDIER } from "../config";
import { CameraSystem } from "../systems/CameraSystem";
import { TerrainRenderer } from "../rendering/TerrainRenderer";
import { createSprites } from "../rendering/sprites";
import { MenuGameplaySimulation, menuWorldSize } from "./MenuGameplaySimulation";

/** Silent attract-mode gameplay. Never owns or updates the player's Game/save. */
export class MainMenuBackground {
  readonly canvas: HTMLCanvasElement;
  demo!: MenuGameplaySimulation;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly sprites = createSprites();
  private terrain!: TerrainRenderer;
  private camera!: CameraSystem;
  private renderedGeneration = -1;
  private animId: number | null = null;
  private lastTime = 0;
  private running = false;
  private resizePending = true;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "main-bg-canvas";
    this.canvas.setAttribute("aria-hidden", "true");
    this.ctx = this.canvas.getContext("2d", { alpha: false })!;
    window.addEventListener("resize", () => { this.resizePending = true; });
    // Don't accumulate hidden-tab time or run an invisible second simulation.
    document.addEventListener("visibilitychange", () => { this.lastTime = 0; });
  }

  private resize(): void {
    this.resizePending = false;
    const width = Math.max(1, window.innerWidth), height = Math.max(1, window.innerHeight);
    const scale = Math.min(1, 1920 / width, 1080 / height);
    this.canvas.width = Math.max(1, Math.round(width * scale));
    this.canvas.height = Math.max(1, Math.round(height * scale));
    const dims = menuWorldSize(width / height);
    if (!this.demo || this.demo.world.width !== dims.width || this.demo.world.height !== dims.height) {
      this.demo = new MenuGameplaySimulation(width / height);
      this.camera = new CameraSystem(this.demo.world);
      this.terrain = new TerrainRenderer(this.demo.world, 16);
      this.terrain.dormantAt = si => this.demo.growth.colonies.isDormantSub(si);
      this.demo.growth.colonies.onVisualChange = (sx, sy) => this.terrain.chunks.markCell(sx >> 1, sy >> 1);
      this.renderedGeneration = -1;
    }
    const cam = this.camera, world = this.demo.world;
    cam.zoom = Math.max(this.canvas.width / world.worldWidth, this.canvas.height / world.worldHeight);
    cam.viewW = this.canvas.width; cam.viewH = this.canvas.height;
    cam.x = world.worldWidth / 2; cam.y = world.worldHeight / 2;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = 0;
    this.resize();
    this.render();
    this.animId = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    this.lastTime = 0;
    if (this.animId !== null) cancelAnimationFrame(this.animId);
    this.animId = null;
  }

  /** Existing menu action now creates another playable miniature lab. */
  purge(): void {
    if (!this.demo) this.resize();
    this.demo.reset();
    this.render();
  }

  private frame = (now: number): void => {
    if (!this.running) return;
    if (!document.hidden) {
      if (this.resizePending) this.resize();
      if (this.lastTime !== 0) this.demo.advance((now - this.lastTime) / 1000);
      this.render();
      this.lastTime = now;
    }
    this.animId = requestAnimationFrame(this.frame);
  };

  render(): void {
    const { ctx, demo, camera: cam, terrain } = this;
    if (this.renderedGeneration !== demo.generation) {
      terrain.rebuildAll();
      this.renderedGeneration = demo.generation;
    } else terrain.update();
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#0b141e";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    terrain.drawFloor(ctx, cam);
    terrain.draw(ctx, cam);
    terrain.drawSurfaceOutlines(ctx, cam);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    terrain.drawBlightEdges(ctx, cam, reduced ? 0 : demo.time);

    // Soft constant light; gunfire never flickers the entire backdrop.
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    for (const core of demo.world.blightCores) {
      if (!core.alive) continue;
      const x = cam.worldToScreenX((core.cx + 1) * demo.world.cellSize);
      const y = cam.worldToScreenY((core.cy + 1) * demo.world.cellSize);
      const size = 44 * cam.zoom;
      ctx.globalAlpha = 0.32;
      ctx.drawImage(this.sprites.crimsonGlow, x - size / 2, y - size / 2, size, size);
    }
    for (const s of demo.soldiers) {
      if (!s.alive) continue;
      const x = cam.worldToScreenX(s.x), y = cam.worldToScreenY(s.y);
      const size = 60 * cam.zoom;
      ctx.globalAlpha = 0.7;
      ctx.drawImage(this.sprites.soldierAmbientGlow, x - size / 2, y - size / 2, size, size);
    }
    ctx.restore();

    // Ordinary pistol bullets use the same gold/white palette and swept positions as gameplay.
    ctx.lineWidth = Math.max(1, cam.zoom);
    ctx.strokeStyle = "#ffe8a2";
    for (const b of demo.combat.bullets.items) {
      if (!b.active) continue;
      const length = Math.min(8, b.traveled);
      ctx.beginPath();
      ctx.moveTo(cam.worldToScreenX(b.x - b.dx * length), cam.worldToScreenY(b.y - b.dy * length));
      ctx.lineTo(cam.worldToScreenX(b.x), cam.worldToScreenY(b.y));
      ctx.stroke();
    }
    for (let i = 0; i < demo.loot.count; i++) {
      const size = Math.max(2, 2 * cam.zoom);
      ctx.drawImage(this.sprites.goldSquare, cam.worldToScreenX(demo.loot.x[i]) - size / 2, cam.worldToScreenY(demo.loot.y[i]) - size / 2, size, size);
    }
    for (const s of demo.soldiers) {
      if (!s.alive) continue;
      const size = Math.round(this.sprites.soldier.width * ART_PIXEL * cam.zoom);
      ctx.drawImage(this.sprites.soldier, Math.round(cam.worldToScreenX(s.x) - size / 2), Math.round(cam.worldToScreenY(s.y) - size / 2), size, size);
      const x = cam.worldToScreenX(s.x + Math.cos(s.facingAngle) * (SOLDIER.renderRadius + 2));
      const y = cam.worldToScreenY(s.y + Math.sin(s.facingAngle) * (SOLDIER.renderRadius + 2));
      ctx.fillStyle = "#a3edff";
      ctx.fillRect(x - 1, y - 1, Math.max(1, cam.zoom), Math.max(1, cam.zoom));
    }
    drawMapBoundary(ctx, demo.world, cam);
  }
}
