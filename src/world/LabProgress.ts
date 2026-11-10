import { sectorCount } from "./labMap";
import type { PixelWorld } from "./PixelWorld";
import { LAB_WORLDS, sectorAtCell, type LabFrame, type LabWorldDef } from "./labMap";

/**
 * Tracks which sectors of the hand-made lab the squad has discovered and
 * conquered during a run. A sector is discovered once a soldier stands in it,
 * and conquered once it is discovered and every Blight generator in it (room
 * cores and tank generators) is dead. Both persist in the save.
 */
export class LabProgress {
  readonly discovered = new Set<number>();
  readonly conquered = new Set<number>();
  /** Living-or-dead generators per sector, for this run's world. */
  private generators = new Map<number, { alive: boolean }[]>();
  private frame: LabFrame | null = null;

  constructor(
    readonly def: LabWorldDef = LAB_WORLDS[1],
    discovered: readonly number[] = [],
    conquered: readonly number[] = [],
  ) {
    for (const s of discovered) this.discovered.add(s);
    for (const s of conquered) this.conquered.add(s);
    // The starting sector is always safe.
    this.discovered.add(def.start);
    this.conquered.add(def.start);
  }

  /** Index the freshly generated world's generators by sector. */
  attach(world: PixelWorld): void {
    const frame = world.labLayout?.frame ?? null;
    this.frame = frame && frame.def === this.def ? frame : null;
    this.generators.clear();
    if (!this.frame) return;
    for (const core of world.blightCores) {
      const s = sectorAtCell(this.frame, core.cx, core.cy);
      if (s < 0) continue;
      let list = this.generators.get(s);
      if (!list) this.generators.set(s, (list = []));
      list.push(core);
    }
  }

  attachThreats(actors: readonly {sector:number;alive:boolean;kind:string}[]): void {
    for(const a of actors) { if(a.kind === "grove") continue;
      const list=this.generators.get(a.sector) ?? []; list.push(a); this.generators.set(a.sector,list);
      if(a.alive) this.conquered.delete(a.sector);
    }
  }

  /** Living generators left in sector `s` this run. */
  generatorsLeft(s: number): number {
    let n = 0;
    for (const g of this.generators.get(s) ?? []) if (g.alive) n++;
    return n;
  }

  /** Generators sector `s` holds in this run's world (alive or not). */
  generatorCount(s: number): number {
    return this.generators.get(s)?.length ?? 0;
  }

  /**
   * Mark the sectors at these world cells discovered and conquer any discovered
   * sector whose generators are all dead. Returns true when anything changed.
   */
  update(cells: Iterable<{ cx: number; cy: number }>): boolean {
    if (!this.frame) return false;
    let changed = false;
    for (const { cx, cy } of cells) {
      const s = sectorAtCell(this.frame, cx, cy);
      if (s >= 0 && !this.discovered.has(s)) {
        this.discovered.add(s);
        changed = true;
      }
    }
    for (const s of this.discovered) {
      if (this.conquered.has(s) || this.generatorsLeft(s) > 0) continue;
      this.conquered.add(s);
      changed = true;
    }
    return changed;
  }

  get sectorCount(): number {
    return sectorCount(this.def);
  }
}
