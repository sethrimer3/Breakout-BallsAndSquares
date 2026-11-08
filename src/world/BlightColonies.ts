import type { PixelWorld } from "./PixelWorld";

/**
 * One connected patch of generator Blight: pink sub-pixels plus the living
 * generator (Blight Core) cells they touch. A colony with no living generator
 * is dormant: it stops growing, its edge fire freezes, and decay can eat it.
 */
export interface Colony {
  id: number;
  /** Half-size subcell indices in this colony. */
  members: number[];
  /** Members with at least one open-air neighbor (where growth and decay happen). */
  edges: number[];
  /** Ids of the Blight Cores whose cells are in this colony. */
  cores: number[];
  /** True while at least one of `cores` is alive. Updated by `refreshActivity`. */
  active: boolean;
  /** May have split since it was last flooded. */
  dirty: boolean;
  /** Banked growth (sub-pixels) for generator growth. */
  acc: number;
  /** Banked decay events for the decay upgrade. */
  decayAcc: number;
}

const DX = [1, -1, 0, 0];
const DY = [0, 0, 1, -1];

/**
 * Incremental colony bookkeeping over the half-size grid. Growth only ever
 * joins or merges colonies, which is cheap; a destroyed pixel only flags its
 * colony, which is re-flooded at most a few times a second to find splits.
 * This replaces flooding every colony every physics step.
 */
export class BlightColonies {
  /** Colony id per subcell (0 = not a colony member). */
  readonly label: Int32Array;
  private readonly memberPos: Int32Array;
  private readonly edgePos: Int32Array;
  private readonly stamp: Uint32Array;
  private curStamp = 0;
  private readonly queue: Int32Array;
  private readonly byId = new Map<number, Colony>();
  private nextId = 1;
  private splitTimer = 0;
  /** Called with a half-size subcell whose dormant/active look changed. */
  onVisualChange: ((sx: number, sy: number) => void) | null = null;
  /** Suppress per-cell work during a bulk rebuild. */
  private bulk = false;

  constructor(private world: PixelWorld) {
    const n = world.subWidth * world.subHeight;
    this.label = new Int32Array(n);
    this.memberPos = new Int32Array(n).fill(-1);
    this.edgePos = new Int32Array(n).fill(-1);
    this.stamp = new Uint32Array(n);
    this.queue = new Int32Array(n);
    world.addListener((cx, cy) => {
      if (this.bulk) return;
      const sx0 = cx * 2 - 1;
      const sy0 = cy * 2 - 1;
      for (let sy = sy0; sy <= sy0 + 3; sy++) {
        for (let sx = sx0; sx <= sx0 + 3; sx++) this.refresh(sx, sy);
      }
    });
  }

  /** All colonies (iteration order is stable between mutations). */
  get list(): IterableIterator<Colony> {
    return this.byId.values();
  }

  get count(): number {
    return this.byId.size;
  }

  get(id: number): Colony | undefined {
    return this.byId.get(id);
  }

  colonyAt(si: number): Colony | undefined {
    const id = this.label[si];
    return id ? this.byId.get(id) : undefined;
  }

  /** True if subcell `si` belongs to a colony that has no living generator. */
  isDormantSub(si: number): boolean {
    const id = this.label[si];
    if (id === 0) return false;
    const c = this.byId.get(id);
    return !!c && !c.active;
  }

  /** Is subcell `si` Blight that takes part in colonies (pink pixel or living generator cell)? */
  isMember(si: number): boolean {
    const w = this.world;
    if (w.isPinkSub(si)) return true;
    const sx = si % w.subWidth;
    const sy = (si - sx) / w.subWidth;
    const ci = (sy >> 1) * w.width + (sx >> 1);
    return w.coreId[ci] > 0 && w.health[ci] > 0;
  }

  private isEdge(si: number): boolean {
    const w = this.world;
    const sw = w.subWidth;
    const sx = si % sw;
    const sy = (si - sx) / sw;
    for (let d = 0; d < 4; d++) {
      const nx = sx + DX[d];
      const ny = sy + DY[d];
      if (nx < 0 || ny < 0 || nx >= sw || ny >= w.subHeight) continue;
      if (!w.subSolidAt(nx, ny)) return true;
    }
    return false;
  }

  /** Throw everything away and relabel the whole world (new run, or after direct array edits). */
  rebuild(): void {
    this.byId.clear();
    this.label.fill(0);
    this.memberPos.fill(-1);
    this.edgePos.fill(-1);
    const w = this.world;
    const n = w.subWidth * w.subHeight;
    this.bulk = true;
    for (let si = 0; si < n; si++) {
      if (this.label[si] !== 0 || !this.isMember(si)) continue;
      const c = this.newColony();
      this.floodInto(si, c, (x) => this.label[x] === 0 && this.isMember(x));
    }
    this.bulk = false;
    for (const c of this.byId.values()) {
      for (const si of c.members) if (this.isEdge(si)) this.addEdge(c, si);
      c.active = this.computeActive(c);
    }
  }

  /** Re-evaluate one subcell after a nearby change. */
  refresh(sx: number, sy: number): void {
    const w = this.world;
    if (sx < 0 || sy < 0 || sx >= w.subWidth || sy >= w.subHeight) return;
    const si = sy * w.subWidth + sx;
    const member = this.isMember(si);
    let id = this.label[si];
    if (member && id === 0) {
      id = this.join(si);
    } else if (!member && id !== 0) {
      const c = this.byId.get(id)!;
      this.removeMember(c, si);
      id = 0;
    }
    if (id !== 0) {
      const c = this.byId.get(id)!;
      if (this.isEdge(si)) this.addEdge(c, si);
      else this.removeEdge(c, si);
    }
  }

  /** Add member `si` to the colony of its neighbors, merging any that it bridges. */
  private join(si: number): number {
    const w = this.world;
    const sw = w.subWidth;
    const sx = si % sw;
    const sy = (si - sx) / sw;
    let best: Colony | undefined;
    const others: Colony[] = [];
    for (let d = 0; d < 4; d++) {
      const nx = sx + DX[d];
      const ny = sy + DY[d];
      if (nx < 0 || ny < 0 || nx >= sw || ny >= w.subHeight) continue;
      const nid = this.label[ny * sw + nx];
      if (nid === 0) continue;
      const c = this.byId.get(nid)!;
      if (c === best || others.includes(c)) continue;
      if (!best) best = c;
      else if (c.members.length > best.members.length) {
        others.push(best);
        best = c;
      } else others.push(c);
    }
    const target = best ?? this.newColony();
    this.addMember(target, si);
    const wasActive = target.active;
    for (const o of others) this.merge(o, target);
    target.active = this.computeActive(target);
    if (!best) {
      // A lone new pixel (a worm trail far from anything): dormant unless it holds a generator.
      if (!target.active) this.visual(si);
    } else if (wasActive !== target.active) {
      for (const m of target.members) this.visual(m);
    } else if (!target.active) {
      this.visual(si);
    }
    return target.id;
  }

  private merge(from: Colony, into: Colony): void {
    const flip = from.active !== into.active || from.active !== this.computeActiveWith(into, from);
    for (const si of from.members) {
      this.label[si] = into.id;
      this.memberPos[si] = into.members.length;
      into.members.push(si);
    }
    for (const si of from.edges) {
      this.edgePos[si] = into.edges.length;
      into.edges.push(si);
    }
    for (const id of from.cores) if (!into.cores.includes(id)) into.cores.push(id);
    into.acc += from.acc;
    into.dirty = into.dirty || from.dirty;
    if (flip) for (const si of from.members) this.visual(si);
    this.byId.delete(from.id);
  }

  private computeActiveWith(a: Colony, b: Colony): boolean {
    return this.computeActive(a) || this.computeActive(b);
  }

  private computeActive(c: Colony): boolean {
    const cores = this.world.blightCores;
    for (const id of c.cores) if (cores[id - 1]?.alive) return true;
    return false;
  }

  private newColony(): Colony {
    const c: Colony = { id: this.nextId++, members: [], edges: [], cores: [], active: false, dirty: false, acc: 0, decayAcc: 0 };
    this.byId.set(c.id, c);
    return c;
  }

  private addMember(c: Colony, si: number): void {
    this.label[si] = c.id;
    this.memberPos[si] = c.members.length;
    c.members.push(si);
    const w = this.world;
    const sx = si % w.subWidth;
    const sy = (si - sx) / w.subWidth;
    const cid = w.coreId[(sy >> 1) * w.width + (sx >> 1)];
    if (cid > 0 && w.health[(sy >> 1) * w.width + (sx >> 1)] > 0 && !c.cores.includes(cid)) c.cores.push(cid);
  }

  private removeMember(c: Colony, si: number): void {
    this.removeEdge(c, si);
    const k = this.memberPos[si];
    const last = c.members.pop()!;
    if (last !== si) {
      c.members[k] = last;
      this.memberPos[last] = k;
    }
    this.memberPos[si] = -1;
    this.label[si] = 0;
    if (c.members.length === 0) this.byId.delete(c.id);
    else c.dirty = true;
  }

  private addEdge(c: Colony, si: number): void {
    if (this.edgePos[si] >= 0) return;
    this.edgePos[si] = c.edges.length;
    c.edges.push(si);
  }

  private removeEdge(c: Colony, si: number): void {
    const k = this.edgePos[si];
    if (k < 0) return;
    const last = c.edges.pop()!;
    if (last !== si) {
      c.edges[k] = last;
      this.edgePos[last] = k;
    }
    this.edgePos[si] = -1;
  }

  /** Flood from `start` through subcells passing `accept`, adding each to `c` (labels + members). */
  private floodInto(start: number, c: Colony, accept: (si: number) => boolean): void {
    const w = this.world;
    const sw = w.subWidth;
    const sh = w.subHeight;
    const q = this.queue;
    let head = 0;
    let tail = 0;
    this.addMember(c, start);
    q[tail++] = start;
    while (head < tail) {
      const cur = q[head++];
      const sx = cur % sw;
      const sy = (cur - sx) / sw;
      for (let d = 0; d < 4; d++) {
        const nx = sx + DX[d];
        const ny = sy + DY[d];
        if (nx < 0 || ny < 0 || nx >= sw || ny >= sh) continue;
        const ni = ny * sw + nx;
        if (!accept(ni)) continue;
        this.addMember(c, ni);
        q[tail++] = ni;
      }
    }
  }

  /**
   * Find colonies that a cut split in two. Each flagged colony is flooded once;
   * every part beyond the first becomes its own colony, with its own generators.
   */
  splitDirty(): void {
    const dirty: Colony[] = [];
    for (const c of this.byId.values()) if (c.dirty) dirty.push(c);
    for (const c of dirty) this.split(c);
  }

  private split(c: Colony): void {
    c.dirty = false;
    if ((this.curStamp = (this.curStamp + 1) >>> 0) === 0) {
      this.stamp.fill(0);
      this.curStamp = 1;
    }
    const stamp = this.curStamp;
    const w = this.world;
    const sw = w.subWidth;
    const sh = w.subHeight;
    const q = this.queue;
    const id = c.id;
    // Flood the part holding the first member.
    let head = 0;
    let tail = 0;
    const first = c.members[0];
    this.stamp[first] = stamp;
    q[tail++] = first;
    while (head < tail) {
      const cur = q[head++];
      const sx = cur % sw;
      const sy = (cur - sx) / sw;
      for (let d = 0; d < 4; d++) {
        const nx = sx + DX[d];
        const ny = sy + DY[d];
        if (nx < 0 || ny < 0 || nx >= sw || ny >= sh) continue;
        const ni = ny * sw + nx;
        if (this.label[ni] !== id || this.stamp[ni] === stamp) continue;
        this.stamp[ni] = stamp;
        q[tail++] = ni;
      }
    }
    const wasActive = c.active;
    if (tail === c.members.length) {
      // Still one piece; a generator may still have died.
      this.recountCores(c);
      c.active = this.computeActive(c);
      if (c.active !== wasActive) for (const m of c.members) this.visual(m);
      return;
    }
    // Peel every unreached member off into new colonies.
    const leftovers: number[] = [];
    for (const si of c.members) if (this.stamp[si] !== stamp) leftovers.push(si);
    for (const si of leftovers) {
      this.removeEdge(c, si);
      const k = this.memberPos[si];
      const last = c.members.pop()!;
      if (last !== si) {
        c.members[k] = last;
        this.memberPos[last] = k;
      }
      this.memberPos[si] = -1;
      this.label[si] = -1; // pending relabel
    }
    this.recountCores(c);
    c.active = this.computeActive(c);
    if (c.active !== wasActive) for (const m of c.members) this.visual(m);
    const total = c.acc;
    for (const si of leftovers) {
      if (this.label[si] !== -1) continue;
      this.label[si] = 0;
      const part = this.newColony();
      this.floodInto(si, part, (x) => this.label[x] === -1 && ((this.label[x] = 0), true));
      for (const m of part.members) if (this.isEdge(m)) this.addEdge(part, m);
      part.active = this.computeActive(part);
      if (part.active !== wasActive) for (const m of part.members) this.visual(m);
    }
    c.acc = total;
  }

  private recountCores(c: Colony): void {
    const w = this.world;
    c.cores.length = 0;
    for (const si of c.members) {
      const sx = si % w.subWidth;
      const sy = (si - sx) / w.subWidth;
      const ci = (sy >> 1) * w.width + (sx >> 1);
      const cid = w.coreId[ci];
      if (cid > 0 && w.health[ci] > 0 && !c.cores.includes(cid)) c.cores.push(cid);
    }
  }

  /**
   * Housekeeping each physics step: re-check splits a few times a second and
   * notice generators that died, flipping their colonies dormant.
   */
  update(dt: number, splitInterval: number): void {
    this.splitTimer -= dt;
    if (this.splitTimer <= 0) {
      this.splitTimer = splitInterval;
      this.splitDirty();
    }
    for (const c of this.byId.values()) {
      const a = this.computeActive(c);
      if (a !== c.active) {
        c.active = a;
        for (const m of c.members) this.visual(m);
      }
    }
  }

  private visual(si: number): void {
    if (!this.onVisualChange) return;
    const sw = this.world.subWidth;
    const sx = si % sw;
    this.onVisualChange(sx, (si - sx) / sw);
  }
}
