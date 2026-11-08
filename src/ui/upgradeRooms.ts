/**
 * Small pixel-art rooms above the upgrade matrix that show humanity's side of
 * the war getting better: a Blight research lab, a weapon armory and the
 * squad's barracks. Everything in them is drawn procedurally from the levels
 * the player actually owns, so buying an upgrade makes a piece appear,
 * grow or switch on, with a burst of sparkles where it changed.
 *
 * No people are drawn, only the rooms and their equipment.
 */

export type RoomKind = "lab" | "armory" | "barracks";

/** What a room needs to know about the save. */
export interface RoomState {
  level(id: string): number;
  /** Total levels bought on the shown tab(s), for general sophistication. */
  total: number;
  /** Squad numbers for the barracks. */
  soldiers: number;
  speedLv: number;
  healthLv: number;
  damageLv: number;
  fireRateLv: number;
  /** The armory's weapon (a branch id such as "pistol" or "grenade"). */
  weapon: string;
  /** Ids of the weapon tab's upgrades, with their levels, for the armory. */
  weaponLevels: { id: string; level: number }[];
}

/** Logical size of a room in art pixels (shown at 2× on the upgrade screen). */
export const ROOM_W = 380;
export const ROOM_H = 50;
const FLOOR_Y = 36;

interface Sparkle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

/** Something drawn in a room: where it sits, and how upgraded it is (0 = absent). */
interface Piece {
  key: string;
  x: number;
  y: number;
  lv: number;
}

type Ctx = CanvasRenderingContext2D;

const C = {
  wall: "#141a26",
  wallLine: "#1b2333",
  panel: "#202a3c",
  floor: "#0e121b",
  floorLine: "#1a2130",
  metal0: "#2a3344",
  metal1: "#3e4a60",
  metal2: "#5d6c86",
  metal3: "#8a9ab4",
  glass: "#5fb8d0",
  glassDim: "#24485a",
  screen: "#38d6ff",
  screenDim: "#14465a",
  green: "#52f296",
  amber: "#ffb347",
  red: "#ff4b5c",
  pink: ["#5a0f36", "#9c1c58", "#d8267a", "#ff4b8b", "#ff9cc8"],
  wilt: ["#241a2c", "#3a2a46", "#544063", "#6e5a7c"],
  wood: "#4a3424",
  cloth: "#2c4a6a",
  gold: "#ffd84d",
};

export class UpgradeRoom {
  readonly canvas: HTMLCanvasElement;
  private ctx: Ctx;
  private sparkles: Sparkle[] = [];
  /** Last seen level of each piece, to celebrate changes. */
  private seen = new Map<string, number>();
  private kind: RoomKind | null = null;
  private pieces: Piece[] = [];

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = ROOM_W;
    this.canvas.height = ROOM_H;
    this.ctx = this.canvas.getContext("2d")!;
  }

  /** Draw one frame. `t` is seconds; `dt` seconds since the last frame. */
  draw(kind: RoomKind, s: RoomState, t: number, dt: number): void {
    const g = this.ctx;
    if (kind !== this.kind) {
      // A different room: don't celebrate everything it already had.
      this.kind = kind;
      this.seen.clear();
      this.sparkles = [];
    }
    this.pieces = [];
    g.clearRect(0, 0, ROOM_W, ROOM_H);
    this.backdrop(g, kind, s.total);
    if (kind === "lab") this.lab(g, s, t);
    else if (kind === "armory") this.armory(g, s, t);
    else this.barracks(g, s, t);
    this.celebrate();
    this.updateSparkles(g, dt);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private px(g: Ctx, x: number, y: number, w: number, h: number, c: string): void {
    g.fillStyle = c;
    g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }

  private piece(key: string, x: number, y: number, lv: number): number {
    // Positions may be in a scaled local space (the armory's weapon); store room pixels.
    const m = this.ctx.getTransform();
    this.pieces.push({ key, x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f, lv });
    return lv;
  }

  /** Sparkles wherever a piece's level went up since the last frame. */
  private celebrate(): void {
    for (const p of this.pieces) {
      const before = this.seen.get(p.key);
      if (before !== undefined && p.lv > before) {
        for (let i = 0; i < 18; i++) {
          const a = Math.random() * Math.PI * 2;
          const sp = 8 + Math.random() * 22;
          this.sparkles.push({ x: p.x, y: p.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 6, life: 0.6 + Math.random() * 0.6 });
        }
      }
      this.seen.set(p.key, p.lv);
    }
  }

  private updateSparkles(g: Ctx, dt: number): void {
    for (let i = this.sparkles.length - 1; i >= 0; i--) {
      const s = this.sparkles[i];
      s.life -= dt;
      if (s.life <= 0) {
        this.sparkles.splice(i, 1);
        continue;
      }
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vy += 30 * dt;
      this.px(g, s.x, s.y, 1, 1, s.life > 0.5 ? "#ffffff" : C.gold);
    }
  }

  private backdrop(g: Ctx, kind: RoomKind, total: number): void {
    this.px(g, 0, 0, ROOM_W, FLOOR_Y, C.wall);
    // Wall panels; more of them light up as the facility is rebuilt.
    for (let x = 4; x < ROOM_W; x += 24) {
      this.px(g, x, 3, 20, FLOOR_Y - 8, C.wallLine);
      this.px(g, x + 1, 4, 18, FLOOR_Y - 10, C.wall);
    }
    const lights = Math.min(15, 3 + Math.floor(total / 4));
    for (let i = 0; i < lights; i++) this.px(g, 14 + i * 24, 1, 6, 1, kind === "lab" ? "#9ff3ff" : kind === "armory" ? C.amber : "#cfe8ff");
    this.px(g, 0, FLOOR_Y, ROOM_W, ROOM_H - FLOOR_Y, C.floor);
    for (let x = 0; x < ROOM_W; x += 12) this.px(g, x, FLOOR_Y + 1, 1, ROOM_H - FLOOR_Y, C.floorLine);
    this.px(g, 0, FLOOR_Y, ROOM_W, 1, C.metal1);
  }

  /** A workbench with legs from x to x + w. */
  private bench(g: Ctx, x: number, w: number): void {
    this.px(g, x, FLOOR_Y - 9, w, 2, C.metal2);
    this.px(g, x, FLOOR_Y - 7, w, 1, C.metal0);
    this.px(g, x + 1, FLOOR_Y - 7, 1, 7, C.metal1);
    this.px(g, x + w - 2, FLOOR_Y - 7, 1, 7, C.metal1);
  }

  /** A wall monitor with a live trace. */
  private monitor(g: Ctx, x: number, y: number, t: number, color: string, seed: number): void {
    this.px(g, x, y, 12, 8, C.metal1);
    this.px(g, x + 1, y + 1, 10, 6, "#061018");
    for (let i = 0; i < 10; i++) {
      const v = Math.sin(t * 2 + i * 0.9 + seed) * 2 + Math.sin(t * 5.3 + i * 2.1 + seed) * 0.8;
      this.px(g, x + 1 + i, y + 4 + Math.round(v * 0.7), 1, 1, color);
    }
  }

  /**
   * A specimen jar with a little Blight colony in it. `mode` picks the
   * behavior on show: living growth, a cut-off dormant piece with a frozen
   * rim, or that piece decaying away.
   */
  private jar(g: Ctx, x: number, t: number, mode: "live" | "dormant" | "decay" | "link", rate = 1): void {
    const y = FLOOR_Y - 9 - 16;
    this.px(g, x, y, 12, 16, C.glassDim);
    this.px(g, x + 1, y + 1, 10, 14, "#0b2028");
    this.px(g, x - 1, y - 1, 14, 2, C.metal2);
    this.px(g, x - 1, y + 15, 14, 2, C.metal2);
    const cx = x + 6;
    const cy = y + 9;
    if (mode === "live") {
      const r = 2.5 + Math.sin(t * 1.4) * 0.8;
      this.blob(g, cx, cy, r, t, true, 1);
    } else if (mode === "link") {
      // A generator and a colony joined by a strand; the strand is cut and
      // regrows, and the far side freezes while it is cut.
      const cycle = (t * 0.35) % 1;
      const cut = cycle > 0.5;
      this.blob(g, cx - 2.5, cy - 3, 2, t, true, 1);
      this.px(g, cx - 3, cy - 4, 2, 2, "#ff9cff");
      this.blob(g, cx + 2, cy + 3, 2.2, t, !cut, 1);
      for (let k = 0; k < 5; k++) {
        if (cut && k === 2) continue;
        this.px(g, cx - 2 + k, cy - 1 + Math.round(k * 0.6), 1, 1, cut && k > 2 ? C.wilt[2] : C.pink[3]);
      }
    } else {
      const phase = mode === "decay" ? (t * 0.25 * rate) % 1 : 0;
      const r = 3 * (1 - phase * 0.85);
      this.blob(g, cx, cy, r, t, false, 1 - phase);
      if (mode === "decay" && phase > 0.2) {
        // Crumbs falling to the jar floor.
        for (let k = 0; k < 3; k++) this.px(g, cx - 3 + k * 3, y + 14 - ((t * 6 + k * 3) % 4), 1, 1, C.wilt[1]);
      }
    }
  }

  /** A pixel Blight blob: pink and pulsing rim when alive, still violet when dormant. */
  private blob(g: Ctx, cx: number, cy: number, r: number, t: number, alive: boolean, fade: number): void {
    const R = Math.ceil(r);
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const d = Math.hypot(dx + 0.5, dy + 0.5);
        if (d > r) continue;
        const rim = d > r - 1;
        let c: string;
        if (alive) {
          const flick = Math.sin(t * 8 + dx * 1.7 + dy * 2.3) > 0.3;
          c = rim ? (flick ? C.pink[4] : C.pink[3]) : C.pink[dx + dy < 0 ? 2 : 1];
        } else {
          c = rim ? C.wilt[3] : C.wilt[fade > 0.5 ? 1 : 0];
        }
        this.px(g, cx + dx, cy + dy, 1, 1, c);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Blight Research Laboratory
  // ---------------------------------------------------------------------------

  private lab(g: Ctx, s: RoomState, t: number): void {
    const L = (id: string): number => s.level(id);
    // Always: a basic bench with one living specimen.
    this.bench(g, 8, 70);
    this.jar(g, 14, t, "live");
    // Connectivity research: the link-and-cut demonstration jar.
    if (this.piece("link", 34, 18, L("core_time_drain") + L("core_breaker") + L("core_bounty"))) this.jar(g, 30, t, "link");
    // Dormancy research (Blight Decay): a jar holding a frozen, cut-off piece.
    if (this.piece("dormant", 50, 18, L("blight_weaken"))) this.jar(g, 46, t, "dormant");
    // Necrosis Protocol: the cut-off piece visibly rots away, faster per level.
    const nec = this.piece("necrosis", 66, 18, L("necrosis_protocol"));
    if (nec) this.jar(g, 62, t, "decay", 0.6 + nec * 0.4);

    // Blight Ward: a containment field emitter with more coils per level.
    const ward = this.piece("ward", 96, 14, L("blight_delay"));
    if (ward) {
      this.px(g, 88, 6, 16, 4, C.metal1);
      for (let i = 0; i < Math.min(5, Math.ceil(ward / 2)); i++) this.px(g, 89 + i * 3, 10, 2, 3, C.metal3);
      const a = 0.5 + 0.5 * Math.sin(t * 3);
      for (let i = 0; i < 12; i++) this.px(g, 90 + i, 14 + Math.round(Math.sin(i * 0.6 + t * 4) * 1.5), 1, 1, a > 0.5 ? "#7fb6ff" : "#3f6fd0");
    }
    // Blight Dampener: cooling towers with spinning fans.
    const damp = this.piece("damp", 120, 26, L("blight_slow"));
    for (let i = 0; i < Math.min(4, Math.ceil(damp / 3)); i++) {
      const x = 112 + i * 12;
      this.px(g, x, FLOOR_Y - 18, 10, 18, C.metal1);
      this.px(g, x + 1, FLOOR_Y - 17, 8, 8, C.metal0);
      const spin = Math.floor(t * 10 + i) % 2;
      this.px(g, x + 2 + spin * 3, FLOOR_Y - 16, 3, 6, C.metal3);
      this.px(g, x + 2, FLOOR_Y - 14 + spin, 6, 2, C.metal2);
      this.px(g, x + 2, FLOOR_Y - 6, 6, 1, C.screen);
    }
    // Initial Suppression: a monitor with the growth curve flattening.
    if (this.piece("suppress", 168, 10, L("blight_start_rate"))) this.monitor(g, 162, 6, t, C.green, 1);
    // Explosive research: a blast chamber that flashes.
    const boom = this.piece("blast", 186, 24, L("explosive_blight_chance") + L("explosive_blight_damage") + L("explosive_blight_radius"));
    if (boom) {
      this.px(g, 178, FLOOR_Y - 20, 16, 20, C.metal1);
      this.px(g, 180, FLOOR_Y - 18, 12, 12, "#160c0c");
      if ((t * 1.3) % 1 < 0.12) this.px(g, 181, FLOOR_Y - 17, 10, 10, C.amber);
      for (let i = 0; i < Math.min(3, Math.ceil(boom / 4)); i++) this.px(g, 180 + i * 4, FLOOR_Y - 4, 2, 2, C.red);
    }
    // Research base systems: keycard rack, sentry model, cartography table.
    const kx = 206;
    const tiers = [L("keycard_t1"), L("keycard_t2"), L("keycard_t3")];
    this.piece("keycards", kx + 8, 10, tiers.filter((v) => v > 0).length);
    if (tiers.some((v) => v > 0)) {
      this.px(g, kx, 6, 18, 10, C.metal0);
      const colors = ["#3078ff", "#ff2424", "#d65c12"];
      tiers.forEach((v, i) => v > 0 && this.px(g, kx + 2 + i * 5, 8, 4, 6, colors[i]));
    }
    this.bench(g, 232, 60);
    const sentry = this.piece("sentry", 246, 22, L("sentry_uplink") + L("sentry_calibration"));
    if (sentry) {
      this.px(g, 242, FLOOR_Y - 13, 8, 4, C.metal1);
      const a = Math.sin(t * 0.8) * 1.2;
      this.px(g, 246, FLOOR_Y - 15, 1, 2, C.metal2);
      for (let k = 0; k < 6; k++) this.px(g, 246 + Math.cos(a) * k, FLOOR_Y - 15 + Math.sin(a) * k * 0.4, 1, 1, C.metal3);
      this.px(g, 245, FLOOR_Y - 12, 1, 1, Math.floor(t * 2) % 2 ? C.red : C.amber);
    }
    if (this.piece("map", 276, 22, L("cartography_uplink"))) {
      this.px(g, 264, FLOOR_Y - 14, 24, 5, "#062018");
      for (let i = 0; i < 24; i += 3) this.px(g, 264 + i, FLOOR_Y - 14, 1, 5, "#0f4030");
      const sweep = Math.floor((t * 12) % 24);
      this.px(g, 264 + sweep, FLOOR_Y - 14, 1, 5, C.green);
    }
    // Recon Optics: a scope mast that grows taller and pings wider with each level.
    const optics = this.piece("optics", 294, 22, L("recon_optics"));
    if (optics) {
      const h = 6 + optics * 2;
      this.px(g, 292, FLOOR_Y - h, 1, h, C.metal2);
      this.px(g, 290, FLOOR_Y - h - 2, 5, 2, C.metal1);
      this.px(g, 294, FLOOR_Y - h - 2, 1, 1, Math.floor(t * 3) % 2 ? C.green : C.screen);
      const ping = (t * 0.7) % 1;
      const pr = Math.round(ping * (2 + optics));
      if (ping < 0.8) {
        this.px(g, 292 - pr, FLOOR_Y - h - 1, 1, 1, C.green);
        this.px(g, 292 + pr, FLOOR_Y - h - 1, 1, 1, C.green);
      }
    }
    // General sophistication: a growing bank of monitors and machines.
    const banks = Math.min(6, Math.floor(s.total / 5));
    this.piece("banks", 330, 12, banks);
    for (let i = 0; i < banks; i++) {
      const x = 300 + (i % 3) * 26;
      const y = i < 3 ? 6 : 18;
      this.monitor(g, x, y, t, i % 2 ? C.screen : C.pink[3], i * 1.7);
    }
    // Floor cabling grows with research too.
    for (let i = 0; i < Math.min(8, Math.floor(s.total / 3)); i++) this.px(g, 80 + i * 30, FLOOR_Y + 4 + (i % 3), 20, 1, C.metal0);
  }

  // ---------------------------------------------------------------------------
  // Weapon Armory
  // ---------------------------------------------------------------------------

  private armory(g: Ctx, s: RoomState, t: number): void {
    // Tool walls and crates fill in with total weapon research.
    const crates = Math.min(5, Math.floor(s.total / 4));
    this.piece("crates", 30, 30, crates);
    for (let i = 0; i < crates; i++) {
      const x = 8 + (i % 3) * 14;
      const y = FLOOR_Y - 10 - (i >= 3 ? 10 : 0);
      this.px(g, x, y, 12, 10, C.wood);
      this.px(g, x + 1, y + 1, 10, 1, "#6a4a30");
      this.px(g, x + 5, y + 3, 2, 4, C.gold);
    }
    const tools = Math.min(8, 2 + Math.floor(s.total / 3));
    this.px(g, 300, 6, 70, 20, C.metal0);
    for (let i = 0; i < tools; i++) this.px(g, 303 + i * 8, 9 + (i % 2) * 3, 2, 12 - (i % 3) * 2, i % 2 ? C.metal3 : C.metal2);
    // The weapon on its display rig, lit from below.
    this.bench(g, 110, 160);
    this.px(g, 118, FLOOR_Y - 10, 144, 1, C.screenDim);
    for (const x of [150, 230]) {
      this.px(g, x, FLOOR_Y - 14, 2, 4, C.metal2);
      this.px(g, x - 3, FLOOR_Y - 15, 8, 1, C.metal3);
    }
    const glow = 0.5 + 0.5 * Math.sin(t * 2);
    this.px(g, 130, FLOOR_Y - 11, 120, 1, glow > 0.5 ? C.screen : C.screenDim);
    // Shown at double size on its rig so the parts read.
    g.save();
    g.translate(190, 18);
    g.scale(2, 2);
    this.weapon(g, s, t, 0, -4);
    g.restore();
    // A lathe that switches on once anything is bought.
    if (this.piece("lathe", 286, 26, s.total > 0 ? 1 : 0)) {
      this.px(g, 276, FLOOR_Y - 12, 20, 12, C.metal1);
      this.px(g, 280, FLOOR_Y - 10, 12, 3, C.metal3);
      if (Math.floor(t * 8) % 2) this.px(g, 286, FLOOR_Y - 7, 1, 1, C.amber);
    }
  }

  /**
   * The weapon itself, built from parts. Each of the tab's upgrades maps to
   * the part that matches what it does: damage grows the barrel and adds an
   * energy conduit, fire rate adds cooling fins, more shots add barrels,
   * piercing/precision adds a scope.
   */
  private weapon(g: Ctx, s: RoomState, t: number, cx: number, cy: number): void {
    const by = (re: RegExp): number => s.weaponLevels.filter((w) => re.test(w.id)).reduce((a, w) => a + w.level, 0);
    const dmg = by(/damage|blight_mult|power/);
    const rof = by(/fire_rate|charge|turn_speed/);
    const multi = by(/multishot|pellet|cluster|quantity|shrapnel|spread|twin/);
    const prec = by(/pierce|crit|stabilizer|arc|radius|velocity|speed/);
    const owned = s.weaponLevels.reduce((a, w) => a + w.level, 0) > 0 || s.weapon === "pistol";
    const w = s.weapon;
    const body = owned ? C.metal2 : C.metal0;
    const dark = owned ? C.metal1 : "#1a2130";
    if (w === "katana") {
      const len = 40 + Math.min(30, dmg * 3);
      this.piece("blade", cx, cy, dmg);
      this.px(g, cx - 30, cy, 10, 3, C.wood);
      this.px(g, cx - 20, cy - 2, 2, 7, C.gold);
      this.px(g, cx - 18, cy, len, 2, "#d8e4f0");
      this.px(g, cx - 18, cy + 2, len - 2, 1, "#8a9ab4");
      if (dmg > 0) {
        const p = (t * 30) % len;
        this.px(g, cx - 18 + p, cy, 3, 2, "#ff9cff");
      }
      this.piece("arc", cx + 10, cy - 4, prec);
      for (let i = 0; i < Math.min(5, prec); i++) this.px(g, cx - 10 + i * 8, cy - 3, 4, 1, C.pink[3]);
      return;
    }
    if (w === "grenade") {
      this.piece("nade", cx, cy, dmg + multi + prec + rof);
      const r = 6 + Math.min(4, dmg);
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r) this.px(g, cx + dx, cy + 2 + dy, 1, 1, (dx + dy) < 0 ? "#5a8a4a" : "#3a5a32");
      this.px(g, cx - 2, cy - r, 5, 3, C.metal2);
      this.px(g, cx + 2, cy - r - 2, 4, 1, C.metal3);
      for (let i = 0; i < Math.min(6, multi); i++) this.px(g, cx - r + 2 + i * 2, cy + 2, 1, 1, C.amber);
      if (Math.floor(t * 3) % 2) this.px(g, cx, cy + 2, 1, 1, C.red);
      return;
    }
    if (w === "turret") {
      this.piece("turret", cx, cy, dmg + multi + prec + rof);
      this.px(g, cx - 10, cy + 6, 20, 6, dark);
      this.px(g, cx - 6, cy, 12, 7, body);
      const barrels = 1 + Math.min(3, multi);
      const a = Math.sin(t * 1.2) * 0.3;
      for (let b = 0; b < barrels; b++) {
        for (let k = 0; k < 12 + Math.min(8, dmg * 2); k++) this.px(g, cx + 5 + k * Math.cos(a), cy + 2 + b * 2 + k * Math.sin(a), 1, 1, C.metal3);
      }
      for (let i = 0; i < Math.min(4, rof); i++) this.px(g, cx - 5 + i * 3, cy - 2, 2, 2, C.screen);
      return;
    }
    // Guns: stock, receiver, barrel(s), with parts by upgrade.
    const shape: Record<string, { stock: number; rec: number; barrel: number; h: number }> = {
      pistol: { stock: 0, rec: 12, barrel: 10, h: 5 },
      shotgun: { stock: 14, rec: 16, barrel: 24, h: 5 },
      assault_rifle: { stock: 14, rec: 20, barrel: 22, h: 5 },
      rocket_launcher: { stock: 6, rec: 30, barrel: 18, h: 9 },
      sniper_rifle: { stock: 16, rec: 18, barrel: 34, h: 4 },
    };
    const sh = shape[w] ?? shape.pistol;
    const total = sh.stock + sh.rec + sh.barrel + Math.min(16, dmg * 2);
    let x = cx - Math.floor(total / 2);
    const y = cy;
    if (sh.stock) {
      this.px(g, x, y + 1, sh.stock, sh.h, C.wood);
      this.px(g, x, y + sh.h, 4, 3, C.wood);
      x += sh.stock;
    }
    this.px(g, x, y - 1, sh.rec, sh.h + 2, body);
    this.px(g, x, y + sh.h + 1, 4, 5, dark); // grip
    this.px(g, x + 6, y + sh.h + 1, 3, 3, dark); // magazine
    // Fire rate: cooling fins along the receiver, and a spinning bolt.
    const fins = this.piece("fins", x + sh.rec / 2, y - 3, rof);
    for (let i = 0; i < Math.min(6, fins); i++) this.px(g, x + 2 + i * 3, y - 3, 2, 2, C.metal3);
    if (rof > 0 && Math.floor(t * 12) % 2) this.px(g, x + sh.rec - 3, y + 1, 2, 1, C.amber);
    x += sh.rec;
    // Damage: longer, thicker barrel with a glowing conduit.
    const blen = sh.barrel + Math.min(16, dmg * 2);
    const thick = Math.min(3, 1 + Math.floor(dmg / 3));
    this.piece("barrel", x + blen / 2, y, dmg);
    const barrels = 1 + Math.min(3, Math.ceil(multi / 2));
    this.piece("barrels", x + blen / 2, y + 4, barrels);
    for (let b = 0; b < barrels; b++) this.px(g, x, y + 1 + b * (thick + 1), blen, thick, C.metal3);
    if (dmg > 0) {
      const p = Math.floor((t * 24) % blen);
      this.px(g, x, y, blen, 1, "#1f5a6a");
      this.px(g, x + p, y, 3, 1, C.screen);
    }
    // Precision: a scope on a rail.
    const scope = this.piece("scope", x - 6, y - 5, prec);
    if (scope) {
      this.px(g, x - sh.rec + 4, y - 3, sh.rec - 4, 1, C.metal1);
      this.px(g, x - sh.rec + 6, y - 6, 10 + Math.min(8, scope * 2), 3, C.metal1);
      this.px(g, x - sh.rec + 6, y - 5, 1, 1, C.screen);
    }
  }

  // ---------------------------------------------------------------------------
  // Soldier Barracks
  // ---------------------------------------------------------------------------

  private barracks(g: Ctx, s: RoomState, t: number): void {
    // A bunk and locker per soldier slot.
    const beds = Math.min(10, s.soldiers);
    this.piece("beds", 40, 26, beds);
    for (let i = 0; i < beds; i++) {
      const x = 6 + (i % 5) * 18;
      const top = i >= 5;
      const y = top ? FLOOR_Y - 20 : FLOOR_Y - 8;
      this.px(g, x, y, 16, 2, C.metal1);
      this.px(g, x + 1, y - 2, 14, 2, C.cloth);
      this.px(g, x + 1, y - 2, 4, 2, "#cfd8e0");
      this.px(g, x, y + 2, 1, top ? 18 : 6, C.metal2);
      this.px(g, x + 15, y + 2, 1, top ? 18 : 6, C.metal2);
    }
    const lockers = Math.min(6, s.soldiers);
    for (let i = 0; i < lockers; i++) {
      this.px(g, 100 + i * 9, FLOOR_Y - 26, 8, 26, C.metal1);
      this.px(g, 101 + i * 9, FLOOR_Y - 25, 6, 1, C.metal0);
      this.px(g, 105 + i * 9, FLOOR_Y - 14, 1, 2, C.metal3);
    }
    // Strength (damage): weight bench and plates.
    const str = this.piece("weights", 170, 24, s.damageLv);
    if (str) {
      this.px(g, 160, FLOOR_Y - 6, 22, 2, C.metal1);
      this.px(g, 162, FLOOR_Y - 4, 1, 4, C.metal2);
      this.px(g, 179, FLOOR_Y - 4, 1, 4, C.metal2);
      const lift = Math.abs(Math.sin(t * 1.5)) * 2;
      this.px(g, 156, FLOOR_Y - 13 - lift, 30, 1, C.metal3);
      const plates = Math.min(4, Math.ceil(str / 2));
      for (let i = 0; i < plates; i++) {
        this.px(g, 157 + i * 2, FLOOR_Y - 16 - lift, 1, 7, "#333");
        this.px(g, 184 - i * 2, FLOOR_Y - 16 - lift, 1, 7, "#333");
      }
    }
    // Fire rate: shooting lane with targets that pop up.
    const rof = this.piece("targets", 222, 18, s.fireRateLv);
    if (rof) {
      this.px(g, 196, FLOOR_Y - 1, 56, 1, C.amber);
      const targets = Math.min(4, Math.ceil(rof / 2));
      for (let i = 0; i < targets; i++) {
        const up = Math.sin(t * 2 + i * 1.7) > -0.2;
        const x = 212 + i * 11;
        this.px(g, x + 3, FLOOR_Y - 8, 1, 7, C.metal2);
        if (up) {
          this.px(g, x, FLOOR_Y - 16, 7, 8, "#e8e0d0");
          this.px(g, x + 2, FLOOR_Y - 14, 3, 4, C.red);
          this.px(g, x + 3, FLOOR_Y - 13, 1, 2, "#e8e0d0");
        }
      }
    }
    // Movement speed: treadmills with a moving belt.
    const spd = this.piece("treadmill", 276, 26, s.speedLv);
    for (let i = 0; i < Math.min(2, Math.ceil(spd / 4)); i++) {
      const x = 260 + i * 26;
      this.px(g, x, FLOOR_Y - 4, 22, 4, C.metal0);
      for (let k = 0; k < 22; k += 4) this.px(g, x + ((k + Math.floor(t * 20)) % 22), FLOOR_Y - 4, 1, 1, C.metal3);
      this.px(g, x + 18, FLOOR_Y - 16, 2, 12, C.metal2);
      this.px(g, x + 15, FLOOR_Y - 18, 6, 3, C.metal1);
      this.px(g, x + 16, FLOOR_Y - 17, 2, 1, C.green);
    }
    // Health: medical cabinet and armor stand.
    const hp = this.piece("medbay", 330, 18, s.healthLv);
    if (hp) {
      this.px(g, 318, FLOOR_Y - 26, 18, 22, "#dfe6ee");
      this.px(g, 325, FLOOR_Y - 21, 4, 10, C.red);
      this.px(g, 322, FLOOR_Y - 18, 10, 4, C.red);
      if (hp >= 3) {
        this.px(g, 344, FLOOR_Y - 24, 10, 14, C.metal2);
        this.px(g, 346, FLOOR_Y - 22, 6, 4, C.screen);
        this.px(g, 348, FLOOR_Y - 10, 2, 10, C.metal1);
      }
      if (hp >= 6) this.px(g, 360, FLOOR_Y - 20 + Math.round(Math.sin(t * 3)), 8, 3, C.green);
    }
  }
}
