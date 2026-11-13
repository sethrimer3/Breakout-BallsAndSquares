import { NAPALM } from "../config";
import type { Creature, CreatureSystem } from "../entities/Creatures";
import type { Encounter, LateEncounters } from "./LateEncounters";
import type { PixelWorld } from "../world/PixelWorld";

export type NapalmHostKind = "ground" | "cell" | "subcell" | "creature" | "encounter";

export interface NapalmPatch {
  active: boolean;
  worldGen: number;
  ownerId: number;
  ignitionOwnerId: number;
  hostKind: NapalmHostKind;
  x: number;
  y: number;
  cx: number;
  cy: number;
  sx: number;
  sy: number;
  creatureId: number;
  creature: Creature | null;
  encounterId: string;
  encounter: Encounter | null;
  damage: number;
  terrainDamageBonus: number;
  blightMultiplier: number;
  lit: boolean;
  unlitLeft: number;
  burnElapsed: number;
  ticksDone: number;
}

/**
 * Napalm Garden (Flamethrower branch 1):
 * - Sprays persistent unlit fuel patches (10s expiry) onto floors, walls, and creatures.
 * - Cannot self-ignite on placement or from its own burn ticks; requires another damaging weapon.
 * - Once lit, burns for 3.0s dealing full weapon damage every 0.2s (exact 15 ticks at 0.2..3.0s).
 * - Target-bound patches dissipate immediately when their host block or creature dies.
 */
export class NapalmSystem {
  readonly patches: NapalmPatch[] = [];
  worldGen = 1;
  totalPlaced = 0;
  totalIgnited = 0;
  totalTicks = 0;

  onTerrainTick: ((cx: number, cy: number, result: 0 | 1 | 2, isSub: boolean, sx: number, sy: number, ownerId: number) => void) | null = null;

  constructor(private world: PixelWorld) {
    for (let i = 0; i < NAPALM.maxPatches; i++) {
      this.patches.push({
        active: false,
        worldGen: 0,
        ownerId: 0,
        ignitionOwnerId: 0,
        hostKind: "ground",
        x: 0,
        y: 0,
        cx: 0,
        cy: 0,
        sx: 0,
        sy: 0,
        creatureId: 0,
        creature: null,
        encounterId: "",
        encounter: null,
        damage: 1,
        terrainDamageBonus: 0,
        blightMultiplier: 1,
        lit: false,
        unlitLeft: 0,
        burnElapsed: 0,
        ticksDone: 0,
      });
    }
  }

  clear(): void {
    this.worldGen++;
    for (const p of this.patches) {
      p.active = false;
      p.creature = null;
      p.encounter = null;
      p.encounterId = "";
    }
  }

  private acquireOrMerge(
    ownerId: number,
    hostKind: NapalmHostKind,
    x: number,
    y: number,
    cx: number,
    cy: number,
    sx: number,
    sy: number,
    creatureId: number,
    creature: Creature | null,
    encounterId: string,
    encounter: Encounter | null,
    damage: number,
    terrainDamageBonus: number,
    blightMultiplier: number,
  ): NapalmPatch | null {
    // Merge same-owner overlapping deposits to avoid multiplying ticks by spray rate.
    for (const p of this.patches) {
      if (!p.active || p.worldGen !== this.worldGen || p.ownerId !== ownerId || p.hostKind !== hostKind) continue;
      if (hostKind === "cell" && p.cx === cx && p.cy === cy) {
        p.damage = Math.max(p.damage, damage);
        if (!p.lit) p.unlitLeft = NAPALM.unlitDuration;
        return p;
      }
      if (hostKind === "subcell" && p.sx === sx && p.sy === sy) {
        p.damage = Math.max(p.damage, damage);
        if (!p.lit) p.unlitLeft = NAPALM.unlitDuration;
        return p;
      }
      if (hostKind === "creature" && p.creatureId === creatureId) {
        p.damage = Math.max(p.damage, damage);
        if (!p.lit) p.unlitLeft = NAPALM.unlitDuration;
        return p;
      }
      if (hostKind === "encounter" && p.encounterId === encounterId) {
        p.damage = Math.max(p.damage, damage);
        if (!p.lit) p.unlitLeft = NAPALM.unlitDuration;
        return p;
      }
      if (hostKind === "ground" && (p.x - x) ** 2 + (p.y - y) ** 2 <= 16) {
        p.damage = Math.max(p.damage, damage);
        if (!p.lit) p.unlitLeft = NAPALM.unlitDuration;
        return p;
      }
    }

    let slot: NapalmPatch | null = null;
    for (const p of this.patches) {
      if (!p.active) {
        slot = p;
        break;
      }
    }
    if (!slot) return null;

    slot.active = true;
    slot.worldGen = this.worldGen;
    slot.ownerId = ownerId;
    slot.ignitionOwnerId = 0;
    slot.hostKind = hostKind;
    slot.x = x;
    slot.y = y;
    slot.cx = cx;
    slot.cy = cy;
    slot.sx = sx;
    slot.sy = sy;
    slot.creatureId = creatureId;
    slot.creature = creature;
    slot.encounterId = encounterId;
    slot.encounter = encounter;
    slot.damage = damage;
    slot.terrainDamageBonus = terrainDamageBonus;
    slot.blightMultiplier = blightMultiplier;
    slot.lit = false;
    slot.unlitLeft = NAPALM.unlitDuration;
    slot.burnElapsed = 0;
    slot.ticksDone = 0;
    this.totalPlaced++;
    return slot;
  }

  placeGroundPatch(ownerId: number, x: number, y: number, damage: number, terrainDamageBonus: number, blightMultiplier: number): NapalmPatch | null {
    return this.acquireOrMerge(ownerId, "ground", x, y, 0, 0, 0, 0, 0, null, "", null, damage, terrainDamageBonus, blightMultiplier);
  }

  placeCellPatch(ownerId: number, cx: number, cy: number, x: number, y: number, damage: number, terrainDamageBonus: number, blightMultiplier: number): NapalmPatch | null {
    if (!this.world.inBounds(cx, cy) || this.world.health[cy * this.world.width + cx] === 0) return null;
    return this.acquireOrMerge(ownerId, "cell", x, y, cx, cy, 0, 0, 0, null, "", null, damage, terrainDamageBonus, blightMultiplier);
  }

  placeSubPatch(ownerId: number, sx: number, sy: number, x: number, y: number, damage: number, terrainDamageBonus: number, blightMultiplier: number): NapalmPatch | null {
    if (!this.world.subInBounds(sx, sy) || this.world.subHealth[sy * this.world.subWidth + sx] === 0) return null;
    return this.acquireOrMerge(ownerId, "subcell", x, y, sx >> 1, sy >> 1, sx, sy, 0, null, "", null, damage, terrainDamageBonus, blightMultiplier);
  }

  placeCreaturePatch(ownerId: number, creature: Creature, x: number, y: number, damage: number, terrainDamageBonus: number, blightMultiplier: number): NapalmPatch | null {
    if (creature.hp <= 0) return null;
    return this.acquireOrMerge(ownerId, "creature", x, y, 0, 0, 0, 0, creature.id, creature, "", null, damage, terrainDamageBonus, blightMultiplier);
  }

  placeEncounterPatch(ownerId: number, enc: Encounter, x: number, y: number, damage: number, terrainDamageBonus: number, blightMultiplier: number): NapalmPatch | null {
    if (!enc.alive || enc.hp <= 0 || enc.kind === "grove") return null;
    return this.acquireOrMerge(ownerId, "encounter", x, y, 0, 0, 0, 0, 0, null, enc.id, enc, damage, terrainDamageBonus, blightMultiplier);
  }

  /**
   * Called by an EXTERNAL damaging weapon (bullet, explosion, slash, laser, grenade, turret).
   * Ignites any unlit fuel patches within `radius + NAPALM.patchRadius`.
   * Status-only cold hits and Napalm's own burn ticks must NEVER call this.
   */
  igniteAt(x: number, y: number, radius: number, ignitionOwnerId: number): number {
    const r = radius + NAPALM.patchRadius;
    const r2 = r * r;
    let litCount = 0;
    for (const p of this.patches) {
      if (!p.active || p.worldGen !== this.worldGen || p.lit) continue;
      if ((p.x - x) ** 2 + (p.y - y) ** 2 <= r2) {
        p.lit = true;
        p.ignitionOwnerId = ignitionOwnerId;
        p.burnElapsed = 0;
        p.ticksDone = 0;
        litCount++;
        this.totalIgnited++;
      }
    }
    return litCount;
  }

  private creaturePos(c: Creature): { x: number; y: number } {
    if (c.kind === "flower") return { x: c.hx, y: c.hy };
    if (c.kind === "worm") return { x: c.seg[0], y: c.seg[1] };
    return { x: c.x, y: c.y };
  }

  private isHostAlive(p: NapalmPatch): boolean {
    if (p.hostKind === "ground") return true;
    if (p.hostKind === "cell") {
      return this.world.inBounds(p.cx, p.cy) && this.world.health[p.cy * this.world.width + p.cx] > 0;
    }
    if (p.hostKind === "subcell") {
      return this.world.subInBounds(p.sx, p.sy) && this.world.subHealth[p.sy * this.world.subWidth + p.sx] > 0;
    }
    if (p.hostKind === "creature") {
      return p.creature !== null && p.creature.hp > 0;
    }
    if (p.hostKind === "encounter") {
      return p.encounter !== null && p.encounter.alive && p.encounter.hp > 0;
    }
    return false;
  }

  update(dt: number, creatures: CreatureSystem | null, late: LateEncounters | null = null): void {
    for (const p of this.patches) {
      if (!p.active) continue;
      if (p.worldGen !== this.worldGen || !this.isHostAlive(p)) {
        p.active = false;
        p.creature = null;
        p.encounter = null;
        continue;
      }

      if (p.hostKind === "creature" && p.creature) {
        const pos = this.creaturePos(p.creature);
        p.x = pos.x;
        p.y = pos.y;
      } else if (p.hostKind === "encounter" && p.encounter) {
        p.x = p.encounter.x;
        p.y = p.encounter.y;
      }

      if (!p.lit) {
        p.unlitLeft -= dt;
        if (p.unlitLeft <= 0) {
          p.active = false;
          p.creature = null;
          p.encounter = null;
        }
        continue;
      }

      p.burnElapsed = Math.min(NAPALM.burnDuration, p.burnElapsed + dt);
      while (
        p.ticksDone < NAPALM.maxTicks &&
        p.burnElapsed + 1e-6 >= (p.ticksDone + 1) * NAPALM.tickInterval
      ) {
        p.ticksDone++;
        this.applyBurnTick(p, creatures, late);
        if (!this.isHostAlive(p)) {
          p.active = false;
          p.creature = null;
          p.encounter = null;
          break;
        }
      }

      if (p.active && p.burnElapsed >= NAPALM.burnDuration - 1e-6 && p.ticksDone >= NAPALM.maxTicks) {
        p.active = false;
        p.creature = null;
        p.encounter = null;
      }
    }
  }

  private applyBurnTick(p: NapalmPatch, creatures: CreatureSystem | null, late: LateEncounters | null): void {
    this.totalTicks++;
    if (p.hostKind === "cell") {
      const ci = p.cy * this.world.width + p.cx;
      const isBlight = this.world.blight[ci] > 0;
      const dmg = (p.damage + p.terrainDamageBonus) * (isBlight ? p.blightMultiplier : 1);
      const res = this.world.damage(p.cx, p.cy, dmg, true);
      if (res > 0) this.onTerrainTick?.(p.cx, p.cy, res, false, p.cx * 2, p.cy * 2, p.ownerId);
    } else if (p.hostKind === "subcell") {
      const si = p.sy * this.world.subWidth + p.sx;
      const isPink = this.world.isPinkSub(si);
      const dmg = (p.damage + p.terrainDamageBonus) * (isPink ? p.blightMultiplier : 1);
      const res = this.world.damageSub(p.sx, p.sy, dmg, true);
      if (res > 0) this.onTerrainTick?.(p.sx >> 1, p.sy >> 1, res, true, p.sx, p.sy, p.ownerId);
    } else if (p.hostKind === "creature" && p.creature && creatures) {
      creatures.damageCreature(p.creature, p.damage, p.x, p.y);
    } else if (p.hostKind === "encounter" && p.encounter && late) {
      late.damageEncounter(p.encounter, p.damage);
    } else if (p.hostKind === "ground") {
      // Burning territory damages new Blight growth entering its cell/subcells and creatures entering its radius.
      const cs = this.world.cellSize;
      const cx = Math.floor(p.x / cs);
      const cy = Math.floor(p.y / cs);
      if (this.world.inBounds(cx, cy)) {
        const ci = cy * this.world.width + cx;
        if (this.world.health[ci] > 0 && this.world.blight[ci] > 0) {
          const res = this.world.damage(cx, cy, (p.damage + p.terrainDamageBonus) * p.blightMultiplier, true);
          if (res > 0) this.onTerrainTick?.(cx, cy, res, false, cx * 2, cy * 2, p.ownerId);
        } else if (this.world.anySolidInCell(cx, cy)) {
          for (let sy = cy * 2; sy <= cy * 2 + 1; sy++) {
            for (let sx = cx * 2; sx <= cx * 2 + 1; sx++) {
              const si = sy * this.world.subWidth + sx;
              if (this.world.subHealth[si] > 0 && this.world.isPinkSub(si)) {
                const res = this.world.damageSub(sx, sy, (p.damage + p.terrainDamageBonus) * p.blightMultiplier, true);
                if (res > 0) this.onTerrainTick?.(cx, cy, res, true, sx, sy, p.ownerId);
              }
            }
          }
        }
      }
      if (creatures) {
        creatures.explode(p.x, p.y, NAPALM.patchRadius, p.damage);
      }
      if (late) {
        for (const a of late.actors) {
          if (!a.alive || a.kind === "grove") continue;
          const r = NAPALM.patchRadius + this.world.cellSize * (a.kind === "boss" ? 2.8 : a.kind === "brute" ? 1.2 : 0.8);
          if (Math.hypot(a.x - p.x, a.y - p.y) < r) {
            late.damageEncounter(a, p.damage);
          }
        }
      }
    }
  }

  get activeCount(): number {
    let n = 0;
    for (const p of this.patches) if (p.active) n++;
    return n;
  }
}
