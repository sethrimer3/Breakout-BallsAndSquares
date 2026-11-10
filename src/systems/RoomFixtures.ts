import { gridRaycast, makeRayHit } from "../core/gridRaycast";
import { DECOR } from "../world/LabDetails";
import { LIGHT_KIND, type PixelWorld, type RoomLight } from "../world/PixelWorld";
import type { BulletTargets } from "./CombatSystem";

/** Ceiling fixtures are bullet targets, not obstacles for soldiers or air. */
export class RoomFixtures implements BulletTargets {
  private ids: Int32Array;
  private hit = makeRayHit();
  private selected: RoomLight | null = null;
  constructor(private world: PixelWorld, private onBreak: (light: RoomLight) => void = () => {}) {
    this.ids = new Int32Array(world.width * world.height);
  }
  reset(): void {
    this.ids.fill(0); this.selected = null;
    this.world.roomLights.forEach((l, index) => {
      if (l.kind === LIGHT_KIND.wash || l.kind === LIGHT_KIND.blight || l.destroyed) return;
      for (let y = l.y0; y <= l.y1; y++) for (let x = l.x0; x <= l.x1; x++) {
        if (this.world.inBounds(x, y)) this.ids[y * this.world.width + x] = index + 1;
      }
    });
  }
  solidAt(x: number, y: number): boolean {
    if (!this.world.inBounds(x, y)) return false;
    const i = y * this.world.width + x;
    const id = this.ids[i];
    return id > 0 && !this.world.roomLights[id - 1].destroyed && this.world.decor[i] === DECOR.lightPanel && !this.world.solidAt(x, y);
  }
  raycast(x: number, y: number, dx: number, dy: number, max: number): number {
    this.selected = null;
    if (!gridRaycast(this, this.world.cellSize, x, y, dx, dy, max, this.hit)) return -1;
    this.selected = this.world.roomLights[this.ids[this.hit.cy * this.world.width + this.hit.cx] - 1];
    return this.hit.t;
  }
  applyHit(damage: number, _x: number, _y: number): boolean {
    return damage > 0 && this.selected ? this.break(this.selected) : false;
  }
  private break(l: RoomLight): boolean {
    if (l.destroyed) return false;
    l.destroyed = true;
    for (let y = l.y0; y <= l.y1; y++) for (let x = l.x0; x <= l.x1; x++) {
      if (this.world.inBounds(x, y) && this.world.decor[y * this.world.width + x] === DECOR.lightPanel) {
        this.world.decor[y * this.world.width + x] = DECOR.deadPanel;
      }
    }
    this.onBreak(l);
    return true;
  }
  explode(x: number, y: number, radius: number): void {
    const cs = this.world.cellSize;
    for (const l of this.world.roomLights) {
      if (l.kind === LIGHT_KIND.wash || l.kind === LIGHT_KIND.blight || l.destroyed) continue;
      const nearX = Math.max(l.x0 * cs, Math.min((l.x1 + 1) * cs, x));
      const nearY = Math.max(l.y0 * cs, Math.min((l.y1 + 1) * cs, y));
      if (Math.hypot(x - nearX, y - nearY) <= radius) this.break(l);
    }
  }
}

/** Preserve nearest-hit ordering between creatures and fixtures. */
export class CombinedTargets implements BulletTargets {
  private selected: BulletTargets | null = null;
  constructor(private targets: readonly BulletTargets[]) {}
  raycast(x: number, y: number, dx: number, dy: number, max: number): number {
    this.selected = null;
    let closest = -1;
    for (const target of this.targets) {
      const t = target.raycast(x, y, dx, dy, closest < 0 ? max : closest);
      if (t >= 0 && (closest < 0 || t < closest)) { closest = t; this.selected = target; }
    }
    return closest;
  }
  applyHit(damage: number, x: number, y: number): boolean { return this.selected?.applyHit(damage, x, y) ?? false; }
}
