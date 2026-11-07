import { CAMERA } from "../config";
import { clamp } from "../core/math";
import type { Soldier } from "../entities/Soldier";
import type { PixelWorld } from "../world/PixelWorld";

/**
 * Camera with cursor-anchored zoom, drag panning and single-target follow.
 * Following sticks to one soldier and never jumps to another on its own; it
 * only moves on when that soldier dies (to the lowest-numbered survivor).
 * Tab cycles through soldiers in numerical (deploy-slot) order; F resumes follow.
 */
export class CameraSystem {
  x: number;
  y: number;
  zoom = CAMERA.defaultZoom;
  /** Viewport size in CSS pixels. */
  viewW = 1;
  viewH = 1;
  defaultFollow = false;
  following = false;
  manualTarget = false;
  targetId = 0;

  constructor(private world: PixelWorld) {
    this.x = world.roomCenterX;
    this.y = world.roomCenterY;
  }

  reset(): void {
    this.x = this.world.roomCenterX;
    this.y = this.world.roomCenterY;
    this.zoom = CAMERA.defaultZoom;
    this.following = this.defaultFollow;
    this.manualTarget = false;
    this.targetId = 0;
  }

  setViewport(w: number, h: number): void {
    this.viewW = w;
    this.viewH = h;
    this.clampToWorld();
  }

  worldToScreenX(wx: number): number {
    return (wx - this.x) * this.zoom + this.viewW / 2;
  }

  worldToScreenY(wy: number): number {
    return (wy - this.y) * this.zoom + this.viewH / 2;
  }

  screenToWorldX(sx: number): number {
    return (sx - this.viewW / 2) / this.zoom + this.x;
  }

  screenToWorldY(sy: number): number {
    return (sy - this.viewH / 2) / this.zoom + this.y;
  }

  /** Zoom by factor, keeping the world point under (sx, sy) fixed. */
  zoomAt(sx: number, sy: number, factor: number): void {
    const wx = this.screenToWorldX(sx);
    const wy = this.screenToWorldY(sy);
    this.zoom = clamp(this.zoom * factor, CAMERA.minZoom, CAMERA.maxZoom);
    this.x = wx - (sx - this.viewW / 2) / this.zoom;
    this.y = wy - (sy - this.viewH / 2) / this.zoom;
    this.clampToWorld();
  }

  panBy(dsx: number, dsy: number): void {
    this.x -= dsx / this.zoom;
    this.y -= dsy / this.zoom;
    this.following = false;
    this.clampToWorld();
  }

  /** F: resume following (the current soldier, or soldier #1 if none). */
  resumeAuto(): void {
    this.following = true;
    this.manualTarget = false;
  }

  /** Follow exactly this soldier (e.g. the manually controlled commander). */
  lockOn(id: number): void {
    this.targetId = id;
    this.manualTarget = true;
    this.following = true;
  }

  /** Tab: follow the next living soldier in numerical (deploy-slot) order, wrapping around. */
  cycleTarget(soldiers: readonly Soldier[]): void {
    const alive = byNumber(soldiers);
    if (alive.length === 0) return;
    const idx = alive.findIndex((s) => s.id === this.targetId);
    const next = alive[(idx + 1) % alive.length];
    this.targetId = next.id;
    this.manualTarget = true;
    this.following = true;
  }

  /** Keep the current soldier while it lives; otherwise the lowest-numbered survivor. */
  private chooseTarget(soldiers: readonly Soldier[]): Soldier | null {
    const alive = byNumber(soldiers);
    return alive.find((s) => s.id === this.targetId) ?? alive[0] ?? null;
  }

  update(dt: number, soldiers: readonly Soldier[]): void {
    if (this.following) {
      const target = this.chooseTarget(soldiers);
      let tx: number;
      let ty: number;
      if (target) {
        this.targetId = target.id;
        tx = target.x;
        ty = target.y;
      } else {
        this.targetId = 0;
        tx = this.world.roomCenterX;
        ty = this.world.roomCenterY;
      }
      const k = 1 - Math.exp(-CAMERA.followSharpness * dt);
      this.x += (tx - this.x) * k;
      this.y += (ty - this.y) * k;
    }
    this.clampToWorld();
  }

  private clampToWorld(): void {
    const halfW = this.viewW / 2 / this.zoom;
    const halfH = this.viewH / 2 / this.zoom;
    const ww = this.world.worldWidth;
    const wh = this.world.worldHeight;
    this.x = halfW * 2 >= ww ? ww / 2 : clamp(this.x, halfW, ww - halfW);
    this.y = halfH * 2 >= wh ? wh / 2 : clamp(this.y, halfH, wh - halfH);
  }
}

/** Living soldiers sorted by soldier number (deploy slot), then spawn order. */
function byNumber(soldiers: readonly Soldier[]): Soldier[] {
  return soldiers.filter((s) => s.alive).sort((a, b) => a.slotIndex - b.slotIndex || a.id - b.id);
}
