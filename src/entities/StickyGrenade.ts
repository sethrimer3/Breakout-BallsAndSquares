import { GRENADE } from "../config";

export class StickyGrenade {
  active = false;
  x = 0;
  y = 0;
  dx = 0;
  dy = 0;
  speed = 0;
  stuck = false;
  stuckCx = 0;
  stuckCy = 0;
  stuckNx = 0;
  stuckNy = 0;
  fuse = 0;
  maxFuse = 0;
  radiusCells = 2.8;
  damage = 8;
  shrapnelCount = 0;
  blightMultiplier = 2.0;
  ownerId = 0;
  age = 0;
  beepTimer = 0;
  rotation = 0;
}

export class StickyGrenadePool {
  readonly items: StickyGrenade[];
  activeCount = 0;

  constructor(size = GRENADE.poolSize) {
    this.items = new Array(size);
    for (let i = 0; i < size; i++) {
      this.items[i] = new StickyGrenade();
    }
  }

  acquire(): StickyGrenade | null {
    for (let i = 0; i < this.items.length; i++) {
      if (!this.items[i].active) {
        this.items[i].active = true;
        this.activeCount++;
        return this.items[i];
      }
    }
    return null;
  }

  release(g: StickyGrenade): void {
    if (g.active) {
      g.active = false;
      this.activeCount--;
    }
  }

  clear(): void {
    for (let i = 0; i < this.items.length; i++) {
      this.items[i].active = false;
    }
    this.activeCount = 0;
  }
}
