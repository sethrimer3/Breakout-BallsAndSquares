import { installMapBoundary } from "../world/MapBoundary";
import { SIM } from "../config";
import { Rng } from "../core/Rng";
import { LootSystem } from "../entities/LootSystem";
import { Soldier, baseSoldierStats } from "../entities/Soldier";
import { CombatSystem } from "../systems/CombatSystem";
import { PhysicsSystem } from "../systems/PhysicsSystem";
import { GrowthSystem } from "../world/GrowthSystem";
import { DECOR } from "../world/LabDetails";
import { PixelWorld } from "../world/PixelWorld";
import { ROOM_STATE, type LabRoom, type LabCorridorSegment } from "../world/WorldGenerator";

/** Keep every menu cell inside tier 1, including very wide/tall screens. */
export function menuWorldSize(aspect: number): { width: number; height: number } {
  const ratio = Math.max(0.25, Math.min(4, Number.isFinite(aspect) ? aspect : 1));
  return {
    width: Math.max(40, Math.min(112, Math.round(64 * Math.sqrt(ratio)))),
    height: Math.max(40, Math.min(112, Math.round(64 / Math.sqrt(ratio)))),
  };
}

/** Real gameplay systems in a disposable world, with no save/audio/timer references. */
export class MenuGameplaySimulation {
  readonly world: PixelWorld;
  readonly rng: Rng;
  readonly physics: PhysicsSystem;
  readonly combat: CombatSystem;
  readonly growth: GrowthSystem;
  readonly loot = new LootSystem(160);
  readonly stats = baseSoldierStats();
  soldiers: Soldier[] = [];
  rooms: LabRoom[] = [];
  time = 0;
  generation = 0;
  shots = 0;
  destroyed = 0;
  private accumulator = 0;

  constructor(aspect: number, seed?: number) {
    this.rng = new Rng(seed);
    this.world = new PixelWorld({ ...menuWorldSize(aspect), cellSize: 8, roomSize: 10 });
    this.physics = new PhysicsSystem(this.world, this.rng);
    this.combat = new CombatSystem(this.world, this.rng, this.stats, {
      onShot: () => { this.shots++; },
      onImpact: (x, y, _nx, _ny, cx, cy, result, sub) => {
        if (result !== 2) return;
        this.destroyed++;
        this.loot.spawnDropsForBlock(x, y, sub ? 0.08 : 0.3, 12, this.rng);
        const id = this.world.coreId[cy * this.world.width + cx];
        const core = this.world.blightCores[id - 1];
        if (core && core.cells.every(i => this.world.health[i] === 0)) core.alive = false;
      },
    });
    this.growth = new GrowthSystem(this.world, this.rng);
    this.growth.graceSeconds = 3;
    this.growth.startRate = 2;
    this.growth.expBase = 1.025;
    this.reset();
  }

  reset(): void {
    const w = this.world;
    this.generation++;
    this.time = this.accumulator = 0;
    this.combat.clearAll();
    this.loot.clear();
    w.boundary.fill(0);
    w.wall.fill(0); w.health.fill(1); w.tint.fill(0); w.decor.fill(0);
    w.blight.fill(0); w.coreId.fill(0); w.mat.fill(0); w.doorId.fill(0);
    w.subHealth.fill(0); w.subTint.fill(0); w.subKind.fill(0);
    w.blightCores = []; w.roomLights = []; w.doors = []; w.sentrySpots = []; w.specimenSpots = [];
    w.tierBase = 0;
    this.rooms = [];
    const corridors: LabCorridorSegment[] = [];
    const columns = w.width >= w.height ? 3 : 2;
    const rows = 6 / columns;
    const slotW = (w.width - 4) / columns;
    const slotH = (w.height - 4) / rows;
    const carve = (x0: number, y0: number, x1: number, y1: number, floor: number = DECOR.floor) => {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        if (x < 2 || y < 2 || x >= w.width - 2 || y >= w.height - 2) continue;
        const i = y * w.width + x;
        w.health[i] = 0; w.decor[i] = floor;
      }
    };
    for (let row = 0; row < rows; row++) for (let j = 0; j < columns; j++) {
      const col = row % 2 === 0 ? j : columns - j - 1;
      const maxSize = Math.max(10, Math.min(21, Math.floor(Math.min(slotW, slotH)) - 4));
      const size = this.rooms.length === 0 ? 10 : 10 + this.rng.int(maxSize - 9);
      const x = Math.floor(2 + col * slotW + 2 + this.rng.next() * Math.max(0, slotW - size - 4));
      const y = Math.floor(2 + row * slotH + 2 + this.rng.next() * Math.max(0, slotH - size - 4));
      const room: LabRoom = { id: this.rooms.length + 1, x, y, size, zone: 0, wallThickness: 1, state: ROOM_STATE.worn };
      this.rooms.push(room);
      carve(x, y, x + size - 1, y + size - 1, this.rooms.length === 1 ? DECOR.cleanFloor : DECOR.floor);
    }
    // A connected snake plus one alternate route; all passages are three cells wide.
    const connect = (a: LabRoom, b: LabRoom) => {
      const ax = a.x + Math.floor(a.size / 2), ay = a.y + Math.floor(a.size / 2);
      const bx = b.x + Math.floor(b.size / 2), by = b.y + Math.floor(b.size / 2);
      carve(Math.min(ax, bx), ay - 1, Math.max(ax, bx), ay + 1);
      carve(bx - 1, Math.min(ay, by), bx + 1, Math.max(ay, by));
      corridors.push({ zone: 0, axis: "h", x0: Math.min(ax, bx), y0: ay - 1, x1: Math.max(ax, bx), y1: ay + 1, width: 3, wallThickness: 1 });
      corridors.push({ zone: 0, axis: "v", x0: bx - 1, y0: Math.min(ay, by), x1: bx + 1, y1: Math.max(ay, by), width: 3, wallThickness: 1 });
    };
    for (let i = 1; i < this.rooms.length; i++) connect(this.rooms[i - 1], this.rooms[i]);
    connect(this.rooms[0], this.rooms[this.rooms.length - 1]);
    const start = this.rooms[0];
    w.setStartRoom(start.x + 5, start.y + 5);
    w.labLayout = { seed: this.rng.int(0x7fffffff), rooms: this.rooms, corridors };
    // Tier-1 excavatable rock surrounds the rooms; avoid the lab's harder tier-2 bulkheads.
    for (let y = 0; y < w.height; y++) for (let x = 0; x < w.width; x++) {
      const i = y * w.width + x;
      w.tint[i] = this.rng.int(256);
      if (w.health[i] === 0) continue;
      w.health[i] = w.maxHealthAt(x, y);
    }
    // Two exposed generators, both outside the safe starting room.
    for (const room of [this.rooms[2], this.rooms[5]]) {
      const cx = room.x + Math.floor(room.size / 2) - 1;
      const cy = room.y + Math.floor(room.size / 2) - 1;
      const id = w.blightCores.length + 1;
      const cells: number[] = [];
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const i = (cy + dy) * w.width + cx + dx;
        w.coreId[i] = id; w.blight[i] = 1; w.wall[i] = 0;
        w.health[i] = w.maxHealthAt(cx + dx, cy + dy);
        w.decor[i] = dx === dy ? DECOR.blightCoreHeart : DECOR.blightCoreShell;
        cells.push(i);
      }
      room.overrun = true; room.coreId = id; room.state = ROOM_STATE.overrun;
      w.blightCores.push({ id, roomId: room.id, zone: 0, cx, cy, cells, alive: true, size: 2 });
    }
    this.soldiers = [-1, 1].map((side, slot) => {
      const a = this.rng.range(-0.65, 0.65) + (side < 0 ? Math.PI : 0);
      return new Soldier(w.roomCenterX + side * 10, w.roomCenterY + side * 8, Math.cos(a), Math.sin(a), this.stats.speed, "pistol", "free", slot);
    });
    installMapBoundary(w);
    this.growth.reset();
  }

  /** Fixed steps keep wall collisions and firing smooth on both slow and fast displays. */
  advance(realSeconds: number): void {
    this.accumulator += Math.max(0, Math.min(0.1, realSeconds));
    let steps = 0;
    while (this.accumulator >= SIM.dt && steps++ < SIM.maxStepsPerFrame) {
      this.accumulator -= SIM.dt;
      this.step(SIM.dt);
    }
    if (steps >= SIM.maxStepsPerFrame) this.accumulator = 0;
  }

  step(dt: number): void {
    this.time += dt;
    for (const s of this.soldiers) {
      if (!s.alive) continue;
      this.physics.step(s, dt, this.stats);
      this.combat.updateSoldier(s, dt);
    }
    this.combat.updateBullets(dt);
    this.growth.update(dt, this.time, this.soldiers);
    this.loot.update(dt, this.soldiers, this.stats.magnetRange);
    // A new skirmish keeps the attract scene alive without fake immortal cores/soldiers.
    if (this.time >= 90 || !this.soldiers.some(s => s.alive) || !this.world.blightCores.some(c => c.alive)) this.reset();
  }
}
