import type { PixelWorld } from "../world/PixelWorld";
import type { CombatSystem } from "../systems/CombatSystem";

export class AutoTurret {
  id = 0;
  x = 0;
  y = 0;
  angle = 0;
  targetAngle = 0;
  life = 0;
  maxLife = 10;
  fireCooldown = 0;
  damage = 2;
  fireRate = 3.5;
  turnSpeed = Math.PI * 1.5;
  ownerId = 0;
  active = false;
  targetCx = -1;
  targetCy = -1;
  hasTarget = false;

  init(
    id: number,
    x: number,
    y: number,
    angle: number,
    life: number,
    damage: number,
    fireRate: number,
    turnSpeed: number,
    ownerId: number,
  ): void {
    this.id = id;
    this.x = x;
    this.y = y;
    this.angle = angle;
    this.targetAngle = angle;
    this.life = life;
    this.maxLife = life;
    this.fireCooldown = 0.08;
    this.damage = damage;
    this.fireRate = fireRate;
    this.turnSpeed = turnSpeed;
    this.ownerId = ownerId;
    this.active = true;
    this.targetCx = -1;
    this.targetCy = -1;
    this.hasTarget = false;
  }

  update(dt: number, world: PixelWorld, combat: CombatSystem): void {
    if (!this.active) return;
    this.life -= dt;
    if (this.life <= 0) {
      this.active = false;
      return;
    }

    this.fireCooldown -= dt;

    const cs = world.cellSize;
    const w = world.width;
    const h = world.height;

    // Check if previously acquired target block is still solid
    if (
      this.targetCx >= 0 &&
      this.targetCy >= 0 &&
      this.targetCx < w &&
      this.targetCy < h &&
      world.health[this.targetCy * w + this.targetCx] > 0
    ) {
      this.hasTarget = true;
    } else {
      this.acquireClosestBlock(world);
    }

    if (this.hasTarget) {
      const targetWorldX = (this.targetCx + 0.5) * cs;
      const targetWorldY = (this.targetCy + 0.5) * cs;
      this.targetAngle = Math.atan2(targetWorldY - this.y, targetWorldX - this.x);

      // Smoothly rotate towards targetAngle at turnSpeed (radians/sec)
      let diff = this.targetAngle - this.angle;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff)); // normalize [-PI, PI]
      const maxStep = this.turnSpeed * dt;
      if (Math.abs(diff) <= maxStep) {
        this.angle = this.targetAngle;
      } else {
        this.angle += Math.sign(diff) * maxStep;
      }

      // If locked on (within ~16 degrees) and cooldown elapsed, fire!
      if (Math.abs(diff) < 0.28 && this.fireCooldown <= 0) {
        this.fireCooldown = 1 / this.fireRate;
        const dirX = Math.cos(this.angle);
        const dirY = Math.sin(this.angle);
        const muzzleDist = 6;
        const mx = this.x + dirX * muzzleDist;
        const my = this.y + dirY * muzzleDist;
        combat.fireTurretShot(this.ownerId, mx, my, dirX, dirY, this.damage);
      }
    }
  }

  acquireClosestBlock(world: PixelWorld): void {
    const cs = world.cellSize;
    const cx0 = Math.floor(this.x / cs);
    const cy0 = Math.floor(this.y / cs);
    const maxRadius = 18; // cells
    let bestDistSq = Infinity;
    let bestCx = -1;
    let bestCy = -1;

    for (let dy = -maxRadius; dy <= maxRadius; dy++) {
      const cy = cy0 + dy;
      if (cy < 0 || cy >= world.height) continue;
      for (let dx = -maxRadius; dx <= maxRadius; dx++) {
        const cx = cx0 + dx;
        if (cx < 0 || cx >= world.width) continue;
        const cell = cy * world.width + cx;
        if (world.health[cell] > 0) {
          const bx = (cx + 0.5) * cs;
          const by = (cy + 0.5) * cs;
          const d2 = (bx - this.x) * (bx - this.x) + (by - this.y) * (by - this.y);
          if (d2 < bestDistSq) {
            bestDistSq = d2;
            bestCx = cx;
            bestCy = cy;
          }
        }
      }
    }

    if (bestCx >= 0) {
      this.targetCx = bestCx;
      this.targetCy = bestCy;
      this.hasTarget = true;
    } else {
      this.hasTarget = false;
    }
  }
}

export class AutoTurretPool {
  readonly items: AutoTurret[];
  private nextId = 1;

  constructor(size: number) {
    this.items = Array.from({ length: size }, () => new AutoTurret());
  }

  spawn(
    x: number,
    y: number,
    angle: number,
    life: number,
    damage: number,
    fireRate: number,
    turnSpeed: number,
    ownerId: number,
  ): AutoTurret | null {
    const t = this.items.find((item) => !item.active);
    if (!t) return null;
    t.init(this.nextId++, x, y, angle, life, damage, fireRate, turnSpeed, ownerId);
    return t;
  }

  update(dt: number, world: PixelWorld, combat: CombatSystem): void {
    for (const t of this.items) {
      if (t.active) t.update(dt, world, combat);
    }
  }

  clear(): void {
    for (const t of this.items) {
      t.active = false;
    }
  }
}
