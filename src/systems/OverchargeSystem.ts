import { OVERCHARGE } from "../config";
import type { Creature } from "../entities/Creatures";
import { gridRaycast, makeRayHit, type RayHit } from "../core/gridRaycast";
import { MAT, type PixelWorld } from "../world/PixelWorld";
import type { CreatureSystem } from "../entities/Creatures";
import type { Encounter, LateEncounters } from "./LateEncounters";

export type OverchargeTargetKind = "cell" | "subcell" | "creature" | "encounter";

export interface OverchargeEntry {
  active: boolean;
  worldGen: number;
  key: string;
  kind: OverchargeTargetKind;
  cx: number;
  cy: number;
  ci: number;
  sx: number;
  sy: number;
  si: number;
  creature: Creature | null;
  encounter: Encounter | null;
  encounterId: string;
  x: number;
  y: number;
  stacks: number;
  quietLeft: number;
  ownerId: number;
  power: number;
  blightMultiplier: number;
}

export interface OverchargeArc {
  active: boolean;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  life: number;
  maxLife: number;
  stacks: number;
}

export interface OverchargeBlastVisual {
  active: boolean;
  x: number;
  y: number;
  radius: number;
  life: number;
  maxLife: number;
  stacks: number;
}

export interface OverchargeDischargeContext {
  creatures: CreatureSystem | null;
  late: LateEncounters | null;
  onBlast: (x: number, y: number, radius: number, damage: number, ownerId: number, blightMultiplier: number) => void;
  onChainCell: (cx: number, cy: number, x: number, y: number, damage: number, ownerId: number, blightMultiplier: number) => void;
  onChainSub: (sx: number, sy: number, x: number, y: number, damage: number, ownerId: number, blightMultiplier: number) => void;
  onChainCreature: (c: Creature, x: number, y: number, damage: number, ownerId: number) => void;
  onChainEncounter: (enc: Encounter, x: number, y: number, damage: number, ownerId: number) => void;
}

interface ChainCandidate {
  key: string;
  kind: OverchargeTargetKind;
  x: number;
  y: number;
  dist: number;
  cx: number;
  cy: number;
  sx: number;
  sy: number;
  creature: Creature | null;
  encounter: Encounter | null;
}

const losHit: RayHit = makeRayHit();

/**
 * Overcharge Conductor (Assault Rifle branch 1):
 * - Zero direct damage on contact; adds per-target charge stacks.
 * - >= 3 hits arm a target; every new charging hit refreshes the quiet timer.
 * - Sub-threshold (1-2 hit) charges dissipate harmlessly on timer expiry.
 * - Armed targets discharge after the quiet period with a small electrical explosion + chain lightning.
 * - Owner-death policy: already-deposited charge remains on the target and discharges normally with
 *   ownerId retained for damage/loot attribution (dead owners do not gain secondary energy).
 */
export class OverchargeSystem {
  readonly entries: OverchargeEntry[] = [];
  readonly arcs: OverchargeArc[] = [];
  readonly blasts: OverchargeBlastVisual[] = [];

  totalCharges = 0;
  totalDischarges = 0;
  totalDissipations = 0;
  totalChainHits = 0;

  private worldGen = 0;
  private creatureIds = new WeakMap<Creature, number>();
  private nextCreatureId = 1;

  constructor(private readonly world: PixelWorld) {
    for (let i = 0; i < OVERCHARGE.maxTargets; i++) {
      this.entries.push({
        active: false,
        worldGen: 0,
        key: "",
        kind: "cell",
        cx: 0,
        cy: 0,
        ci: 0,
        sx: 0,
        sy: 0,
        si: 0,
        creature: null,
        encounter: null,
        encounterId: "",
        x: 0,
        y: 0,
        stacks: 0,
        quietLeft: 0,
        ownerId: 0,
        power: 1,
        blightMultiplier: 1,
      });
    }
    for (let i = 0; i < OVERCHARGE.maxVisualArcs; i++) {
      this.arcs.push({ active: false, x1: 0, y1: 0, x2: 0, y2: 0, life: 0, maxLife: 0.2, stacks: 0 });
    }
    for (let i = 0; i < OVERCHARGE.maxVisualBlasts; i++) {
      this.blasts.push({ active: false, x: 0, y: 0, radius: 14, life: 0, maxLife: 0.2, stacks: 0 });
    }
  }

  clear(): void {
    this.worldGen++;
    for (const e of this.entries) {
      e.active = false;
      e.creature = null;
      e.encounter = null;
    }
    for (const a of this.arcs) a.active = false;
    for (const b of this.blasts) b.active = false;
  }

  onCellDestroyed(cx: number, cy: number): void {
    const ci = cy * this.world.width + cx;
    const key = `c:${ci}`;
    for (const e of this.entries) {
      if (e.active && e.kind === "cell" && e.key === key) {
        e.active = false;
      }
    }
  }

  onSubDestroyed(sx: number, sy: number): void {
    const si = sy * this.world.subWidth + sx;
    const key = `s:${si}`;
    for (const e of this.entries) {
      if (e.active && e.kind === "subcell" && e.key === key) {
        e.active = false;
      }
    }
  }

  private getCreatureKey(c: Creature): string {
    let id = this.creatureIds.get(c);
    if (!id) {
      id = this.nextCreatureId++;
      this.creatureIds.set(c, id);
    }
    return `cr:${id}`;
  }

  private creaturePos(c: Creature): { x: number; y: number } {
    if (c.kind === "flower") return { x: c.hx, y: c.hy };
    if (c.kind === "worm") return { x: c.seg[0] ?? 0, y: c.seg[1] ?? 0 };
    return { x: c.x, y: c.y };
  }

  private isHostAlive(e: OverchargeEntry): boolean {
    if (e.kind === "cell") {
      return this.world.inBounds(e.cx, e.cy) && this.world.health[e.ci] > 0;
    }
    if (e.kind === "subcell") {
      return this.world.subInBounds(e.sx, e.sy) && this.world.subHealth[e.si] > 0;
    }
    if (e.kind === "creature") {
      return e.creature !== null && e.creature.hp > 0;
    }
    if (e.kind === "encounter") {
      return (
        e.encounter !== null &&
        e.encounter.alive &&
        e.encounter.hp > 0 &&
        e.encounter.id === e.encounterId
      );
    }
    return false;
  }

  private acquireSlot(key: string): OverchargeEntry | null {
    let free: OverchargeEntry | null = null;
    let oldestSubThreshold: OverchargeEntry | null = null;
    let oldestAny: OverchargeEntry | null = null;

    for (const e of this.entries) {
      if (e.active && e.worldGen === this.worldGen && e.key === key) {
        return e;
      }
      if (!e.active && !free) {
        free = e;
      } else if (e.active) {
        if (e.stacks < OVERCHARGE.armThreshold) {
          if (!oldestSubThreshold || e.quietLeft < oldestSubThreshold.quietLeft) {
            oldestSubThreshold = e;
          }
        }
        if (!oldestAny || e.quietLeft < oldestAny.quietLeft) {
          oldestAny = e;
        }
      }
    }

    return free ?? oldestSubThreshold ?? oldestAny;
  }

  private addCharge(
    key: string,
    kind: OverchargeTargetKind,
    x: number,
    y: number,
    ownerId: number,
    power: number,
    blightMultiplier: number,
    cx = 0,
    cy = 0,
    ci = 0,
    sx = 0,
    sy = 0,
    si = 0,
    creature: Creature | null = null,
    encounter: Encounter | null = null,
  ): OverchargeEntry | null {
    const slot = this.acquireSlot(key);
    if (!slot) return null;

    const sameTarget = slot.active && slot.worldGen === this.worldGen && slot.key === key;
    if (sameTarget) {
      slot.stacks = Math.min(OVERCHARGE.maxChargeStacks, slot.stacks + 1);
      slot.quietLeft = OVERCHARGE.quietDelay;
      slot.ownerId = ownerId;
      slot.power = Math.max(slot.power, power);
      slot.blightMultiplier = Math.max(slot.blightMultiplier, blightMultiplier);
      slot.x = x;
      slot.y = y;
    } else {
      slot.active = true;
      slot.worldGen = this.worldGen;
      slot.key = key;
      slot.kind = kind;
      slot.cx = cx;
      slot.cy = cy;
      slot.ci = ci;
      slot.sx = sx;
      slot.sy = sy;
      slot.si = si;
      slot.creature = creature;
      slot.encounter = encounter;
      slot.encounterId = encounter ? encounter.id : "";
      slot.x = x;
      slot.y = y;
      slot.stacks = 1;
      slot.quietLeft = OVERCHARGE.quietDelay;
      slot.ownerId = ownerId;
      slot.power = Math.max(1, power);
      slot.blightMultiplier = Math.max(1, blightMultiplier);
    }

    this.totalCharges++;
    return slot;
  }

  chargeCell(cx: number, cy: number, ownerId: number, power: number, blightMultiplier = 1): OverchargeEntry | null {
    if (!this.world.inBounds(cx, cy)) return null;
    const ci = cy * this.world.width + cx;
    if (this.world.health[ci] <= 0) return null;
    const cs = this.world.cellSize;
    return this.addCharge(
      `c:${ci}`, "cell",
      (cx + 0.5) * cs, (cy + 0.5) * cs,
      ownerId, power, blightMultiplier,
      cx, cy, ci,
    );
  }

  chargeSubCell(sx: number, sy: number, ownerId: number, power: number, blightMultiplier = 1): OverchargeEntry | null {
    if (!this.world.subInBounds(sx, sy)) return null;
    const si = sy * this.world.subWidth + sx;
    if (this.world.subHealth[si] <= 0) return null;
    const ss = this.world.subCellSize;
    return this.addCharge(
      `s:${si}`, "subcell",
      (sx + 0.5) * ss, (sy + 0.5) * ss,
      ownerId, power, blightMultiplier,
      sx >> 1, sy >> 1, 0, sx, sy, si,
    );
  }

  chargeCreature(c: Creature, ownerId: number, power: number): OverchargeEntry | null {
    if (c.hp <= 0) return null;
    const pos = this.creaturePos(c);
    return this.addCharge(
      this.getCreatureKey(c), "creature",
      pos.x, pos.y,
      ownerId, power, 1,
      0, 0, 0, 0, 0, 0, c, null,
    );
  }

  chargeEncounter(enc: Encounter, ownerId: number, power: number): OverchargeEntry | null {
    if (!enc.alive || enc.hp <= 0) return null;
    return this.addCharge(
      `e:${enc.id}`, "encounter",
      enc.x, enc.y,
      ownerId, power, 1,
      0, 0, 0, 0, 0, 0, null, enc,
    );
  }

  getEntryForCell(cx: number, cy: number): OverchargeEntry | null {
    const key = `c:${cy * this.world.width + cx}`;
    return this.entries.find((e) => e.active && e.worldGen === this.worldGen && e.key === key) ?? null;
  }

  getEntryForSubCell(sx: number, sy: number): OverchargeEntry | null {
    const key = `s:${sy * this.world.subWidth + sx}`;
    return this.entries.find((e) => e.active && e.worldGen === this.worldGen && e.key === key) ?? null;
  }

  getEntryForCreature(c: Creature): OverchargeEntry | null {
    const key = this.getCreatureKey(c);
    return this.entries.find((e) => e.active && e.worldGen === this.worldGen && e.key === key) ?? null;
  }

  getEntryForEncounter(enc: Encounter): OverchargeEntry | null {
    const key = `e:${enc.id}`;
    return this.entries.find((e) => e.active && e.worldGen === this.worldGen && e.key === key) ?? null;
  }

  update(dt: number, ctx: OverchargeDischargeContext): void {
    // Fade visual arcs and blasts using simulation time.
    for (const a of this.arcs) {
      if (!a.active) continue;
      a.life -= dt;
      if (a.life <= 0) a.active = false;
    }
    for (const b of this.blasts) {
      if (!b.active) continue;
      b.life -= dt;
      if (b.life <= 0) b.active = false;
    }

    for (const e of this.entries) {
      if (!e.active) continue;
      if (e.worldGen !== this.worldGen || !this.isHostAlive(e)) {
        e.active = false;
        e.creature = null;
        e.encounter = null;
        continue;
      }

      if (e.kind === "creature" && e.creature) {
        const pos = this.creaturePos(e.creature);
        e.x = pos.x;
        e.y = pos.y;
      } else if (e.kind === "encounter" && e.encounter) {
        e.x = e.encounter.x;
        e.y = e.encounter.y;
      }

      e.quietLeft -= dt;
      if (e.quietLeft > 0) continue;

      const stacks = e.stacks;
      const originKey = e.key;
      const ox = e.x;
      const oy = e.y;
      const ownerId = e.ownerId;
      const power = e.power;
      const blightMult = e.blightMultiplier;

      // Clear entry BEFORE discharge to prevent any recursive loop.
      e.active = false;
      e.creature = null;
      e.encounter = null;

      if (stacks < OVERCHARGE.armThreshold) {
        this.totalDissipations++;
        continue;
      }

      this.discharge(originKey, ox, oy, stacks, ownerId, power, blightMult, ctx);
    }
  }

  private spawnArc(x1: number, y1: number, x2: number, y2: number, duration: number, stacks: number): void {
    let slot = this.arcs.find((a) => !a.active);
    if (!slot) {
      slot = this.arcs.reduce((oldest, a) => (a.life < oldest.life ? a : oldest), this.arcs[0]);
    }
    if (!slot) return;
    slot.active = true;
    slot.x1 = x1;
    slot.y1 = y1;
    slot.x2 = x2;
    slot.y2 = y2;
    slot.life = duration;
    slot.maxLife = duration;
    slot.stacks = stacks;
  }

  private spawnBlastVisual(x: number, y: number, radius: number, duration: number, stacks: number): void {
    let slot = this.blasts.find((b) => !b.active);
    if (!slot) {
      slot = this.blasts.reduce((oldest, b) => (b.life < oldest.life ? b : oldest), this.blasts[0]);
    }
    if (!slot) return;
    slot.active = true;
    slot.x = x;
    slot.y = y;
    slot.radius = radius;
    slot.life = duration;
    slot.maxLife = duration;
    slot.stacks = stacks;
  }

  /**
   * Chain obstruction policy:
   * - World boundaries and closed gates block chain arcs.
   * - Intermediate solid walls between hop origin and candidate block arcs;
   *   hitting the candidate's own cell/subcell at the end of the segment is allowed.
   */
  private hasChainLos(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    cand: ChainCandidate,
  ): boolean {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dist = Math.hypot(dx, dy);
    if (dist < 1e-4) return true;
    const ux = dx / dist;
    const uy = dy / dist;
    const ss = this.world.subCellSize;
    // Start slightly outside origin cell if origin itself is solid.
    const startOffset = Math.min(dist * 0.25, ss * 0.6);
    const sx0 = x1 + ux * startOffset;
    const sy0 = y1 + uy * startOffset;
    const traceDist = Math.max(0, dist - startOffset);
    if (traceDist <= 1e-4) return true;

    const hitTerrain = gridRaycast(this.world.subSolidQuery, ss, sx0, sy0, ux, uy, traceDist, losHit);
    if (!hitTerrain) return true;

    const hcx = losHit.cx >> 1;
    const hcy = losHit.cy >> 1;
    if (!this.world.inBounds(hcx, hcy)) return false;

    const ci = hcy * this.world.width + hcx;
    if (this.world.mat[ci] === MAT.door) {
      const door = this.world.doors[this.world.doorId[ci] - 1];
      if (door && !door.open) {
        // Closed doors block arcs passing through; only allow if the door itself is the target and unobstructed up to it.
        return cand.kind === "cell" && cand.cx === hcx && cand.cy === hcy;
      }
    }

    if (cand.kind === "cell" && cand.cx === hcx && cand.cy === hcy) return true;
    if (cand.kind === "subcell" && losHit.cx === cand.sx && losHit.cy === cand.sy) return true;

    // Allow tiny surface tolerance near the target center.
    return losHit.t >= traceDist - ss * 0.75;
  }

  private findNextChainTarget(
    fromX: number,
    fromY: number,
    maxReach: number,
    visited: Set<string>,
    ctx: OverchargeDischargeContext,
  ): ChainCandidate | null {
    const r2 = maxReach * maxReach;
    let best: ChainCandidate | null = null;

    if (ctx.creatures) {
      const lists = [ctx.creatures.flowers, ctx.creatures.worms, ctx.creatures.specimens];
      for (const list of lists) {
        for (const c of list) {
          if (c.hp <= 0) continue;
          if ("free" in c && !c.free) continue;
          const key = this.getCreatureKey(c);
          if (visited.has(key)) continue;
          const pos = this.creaturePos(c);
          const d2 = (pos.x - fromX) ** 2 + (pos.y - fromY) ** 2;
          if (d2 > r2) continue;
          const cand: ChainCandidate = {
            key,
            kind: "creature",
            x: pos.x,
            y: pos.y,
            dist: Math.sqrt(d2),
            cx: 0,
            cy: 0,
            sx: 0,
            sy: 0,
            creature: c,
            encounter: null,
          };
          if ((!best || cand.dist < best.dist) && this.hasChainLos(fromX, fromY, cand.x, cand.y, cand)) {
            best = cand;
          }
        }
      }
    }

    if (ctx.late) {
      for (const enc of ctx.late.actors) {
        if (!enc.alive || enc.hp <= 0 || enc.kind === "grove") continue;
        const key = `e:${enc.id}`;
        if (visited.has(key)) continue;
        const d2 = (enc.x - fromX) ** 2 + (enc.y - fromY) ** 2;
        if (d2 > r2) continue;
        const cand: ChainCandidate = {
          key,
          kind: "encounter",
          x: enc.x,
          y: enc.y,
          dist: Math.sqrt(d2),
          cx: 0,
          cy: 0,
          sx: 0,
          sy: 0,
          creature: null,
          encounter: enc,
        };
        if ((!best || cand.dist < best.dist) && this.hasChainLos(fromX, fromY, cand.x, cand.y, cand)) {
          best = cand;
        }
      }
    }

    // Also allow chaining across solid terrain blocks / subcells within reach.
    const w = this.world;
    const cs = w.cellSize;
    const ss = w.subCellSize;
    const minCx = Math.max(0, Math.floor((fromX - maxReach) / cs));
    const maxCx = Math.min(w.width - 1, Math.floor((fromX + maxReach) / cs));
    const minCy = Math.max(0, Math.floor((fromY - maxReach) / cs));
    const maxCy = Math.min(w.height - 1, Math.floor((fromY + maxReach) / cs));

    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const ci = cy * w.width + cx;
        if (w.health[ci] > 0) {
          const key = `c:${ci}`;
          if (visited.has(key)) continue;
          const wx = (cx + 0.5) * cs;
          const wy = (cy + 0.5) * cs;
          const d2 = (wx - fromX) ** 2 + (wy - fromY) ** 2;
          if (d2 > r2) continue;
          const cand: ChainCandidate = {
            key, kind: "cell", x: wx, y: wy, dist: Math.sqrt(d2),
            cx, cy, sx: 0, sy: 0, creature: null, encounter: null,
          };
          if ((!best || cand.dist < best.dist) && this.hasChainLos(fromX, fromY, wx, wy, cand)) {
            best = cand;
          }
        } else {
          // Check subcells inside this cell
          for (let oy = 0; oy < 2; oy++) {
            for (let ox = 0; ox < 2; ox++) {
              const sx = cx * 2 + ox;
              const sy = cy * 2 + oy;
              const si = sy * w.subWidth + sx;
              if (w.subHealth[si] <= 0) continue;
              const key = `s:${si}`;
              if (visited.has(key)) continue;
              const wx = (sx + 0.5) * ss;
              const wy = (sy + 0.5) * ss;
              const d2 = (wx - fromX) ** 2 + (wy - fromY) ** 2;
              if (d2 > r2) continue;
              const cand: ChainCandidate = {
                key, kind: "subcell", x: wx, y: wy, dist: Math.sqrt(d2),
                cx, cy, sx, sy, creature: null, encounter: null,
              };
              if ((!best || cand.dist < best.dist) && this.hasChainLos(fromX, fromY, wx, wy, cand)) {
                best = cand;
              }
            }
          }
        }
      }
    }

    return best;
  }

  private discharge(
    originKey: string,
    ox: number,
    oy: number,
    stacks: number,
    ownerId: number,
    power: number,
    blightMultiplier: number,
    ctx: OverchargeDischargeContext,
  ): void {
    this.totalDischarges++;
    const extra = Math.max(0, Math.min(OVERCHARGE.maxChargeStacks, stacks) - OVERCHARGE.armThreshold);
    const blastRadius = Math.min(
      OVERCHARGE.maxBlastRadius,
      OVERCHARGE.baseBlastRadius + extra * OVERCHARGE.blastRadiusPerStack,
    );
    const blastDmg = Math.max(
      1,
      Math.round(power * (OVERCHARGE.baseBlastDamageMult + extra * OVERCHARGE.blastDamagePerStack)),
    );
    const chainDmg = Math.max(
      1,
      Math.round(power * (OVERCHARGE.baseChainDamageMult + extra * OVERCHARGE.chainDamagePerStack)),
    );
    const chainReach = Math.min(
      OVERCHARGE.maxChainReach,
      OVERCHARGE.baseChainReach + extra * OVERCHARGE.chainReachPerStack,
    );
    const chainHops = Math.min(
      OVERCHARGE.maxChainHops,
      OVERCHARGE.baseChainHops + Math.floor(extra * OVERCHARGE.chainHopsPerStack),
    );
    const arcDuration = Math.min(
      OVERCHARGE.maxArcDuration,
      OVERCHARGE.baseArcDuration + extra * OVERCHARGE.arcDurationPerStack,
    );

    ctx.onBlast(ox, oy, blastRadius, blastDmg, ownerId, blightMultiplier);
    this.spawnBlastVisual(ox, oy, blastRadius, Math.min(0.32, arcDuration), stacks);

    const visited = new Set<string>([originKey]);
    let curX = ox;
    let curY = oy;
    let totalTravelLeft = chainReach * chainHops;

    for (let hop = 0; hop < chainHops && totalTravelLeft > 1; hop++) {
      const hopReach = Math.min(chainReach, totalTravelLeft);
      const next = this.findNextChainTarget(curX, curY, hopReach, visited, ctx);
      if (!next) break;
      visited.add(next.key);
      totalTravelLeft -= next.dist;

      if (next.kind === "creature" && next.creature) {
        ctx.onChainCreature(next.creature, next.x, next.y, chainDmg, ownerId);
      } else if (next.kind === "encounter" && next.encounter) {
        ctx.onChainEncounter(next.encounter, next.x, next.y, chainDmg, ownerId);
      } else if (next.kind === "cell") {
        ctx.onChainCell(next.cx, next.cy, next.x, next.y, chainDmg, ownerId, blightMultiplier);
      } else if (next.kind === "subcell") {
        ctx.onChainSub(next.sx, next.sy, next.x, next.y, chainDmg, ownerId, blightMultiplier);
      }

      this.spawnArc(curX, curY, next.x, next.y, arcDuration, stacks);
      this.totalChainHits++;
      curX = next.x;
      curY = next.y;
    }
  }
}
