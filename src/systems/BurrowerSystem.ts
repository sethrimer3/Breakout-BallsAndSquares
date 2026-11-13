import { BURROWER } from "../config";
import { FixedPool } from "../core/FixedPool";

export interface BurrowerMine {
  active: boolean;
  groupId: number;
  ownerId: number;
  x: number;
  y: number;
  damage: number;
  radiusCells: number;
  terrainDamageBonus: number;
  blightMultiplier: number;
  seq: number;
}

export interface BurrowerCharge {
  x: number;
  y: number;
  damage: number;
  radiusCells: number;
  ownerId: number;
  terrainDamageBonus: number;
  blightMultiplier: number;
}

/**
 * Burrower (Rocket Launcher branch 1):
 * Manages detonation-grouped mines placed along a rocket's actual drilled path
 * and detonates all charges in a group together at the same simulation timestamp.
 */
export class BurrowerSystem {
  readonly mines = new FixedPool<BurrowerMine>(BURROWER.minePoolSize, () => ({
    active: false,
    groupId: 0,
    ownerId: 0,
    x: 0,
    y: 0,
    damage: 0,
    radiusCells: 0,
    terrainDamageBonus: 0,
    blightMultiplier: 1,
    seq: 0,
  }));

  private nextGroupId = 1;
  private detonatedGroups = new Set<number>();
  totalGroupsDetonated = 0;
  totalChargesDetonated = 0;

  clear(): void {
    this.mines.releaseAll();
    this.nextGroupId = 1;
    this.detonatedGroups.clear();
  }

  allocateGroupId(): number {
    return this.nextGroupId++;
  }

  placeMine(
    groupId: number,
    ownerId: number,
    x: number,
    y: number,
    damage: number,
    radiusCells: number,
    terrainDamageBonus: number,
    blightMultiplier: number,
    seq: number,
  ): BurrowerMine | null {
    if (this.detonatedGroups.has(groupId)) return null;
    const m = this.mines.acquire();
    if (!m) return null;
    m.groupId = groupId;
    m.ownerId = ownerId;
    m.x = x;
    m.y = y;
    m.damage = damage;
    m.radiusCells = radiusCells;
    m.terrainDamageBonus = terrainDamageBonus;
    m.blightMultiplier = blightMultiplier;
    m.seq = seq;
    return m;
  }

  /**
   * Collect all mines in `groupId` plus the terminal payload, mark the group
   * detonated so it can never fire twice, and return all charges in order.
   */
  detonateGroup(
    groupId: number,
    terminalX: number,
    terminalY: number,
    terminalDamage: number,
    terminalRadiusCells: number,
    ownerId: number,
    terrainDamageBonus: number,
    blightMultiplier: number,
  ): BurrowerCharge[] {
    if (this.detonatedGroups.has(groupId)) return [];
    this.detonatedGroups.add(groupId);
    if (this.detonatedGroups.size > 512) {
      // Bound history set while preserving recent group guards.
      const first = this.detonatedGroups.values().next().value;
      if (first !== undefined) this.detonatedGroups.delete(first);
    }

    const charges: BurrowerCharge[] = [];
    for (const m of this.mines.items) {
      if (!m.active || m.groupId !== groupId) continue;
      charges.push({
        x: m.x,
        y: m.y,
        damage: m.damage,
        radiusCells: m.radiusCells,
        ownerId: m.ownerId,
        terrainDamageBonus: m.terrainDamageBonus,
        blightMultiplier: m.blightMultiplier,
      });
      this.mines.release(m);
    }
    charges.push({
      x: terminalX,
      y: terminalY,
      damage: terminalDamage,
      radiusCells: terminalRadiusCells,
      ownerId,
      terrainDamageBonus,
      blightMultiplier,
    });

    this.totalGroupsDetonated++;
    this.totalChargesDetonated += charges.length;
    return charges;
  }
}
