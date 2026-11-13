import { FREEZE } from "../config";
import type { PixelWorld } from "../world/PixelWorld";
import { sectorBounds, sectorCount, sectorTier } from "../world/labMap";
import { CAMPAIGN, campaignTier } from "../world/campaignBalance";
import { LootKind } from "../entities/LootSystem";
import type { Soldier } from "../entities/Soldier";
import type { CameraSystem } from "./CameraSystem";
import type { BulletTargets } from "./CombatSystem";
import { circleIsClear } from "./PhysicsSystem";
export interface Encounter {
  id: string;
  sector: number;
  x: number;
  y: number;
  homeX: number;
  homeY: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  kind: "soldier" | "brute" | "turret" | "trap" | "grove" | "boss";
  tier: number;
  cooldown: number;
  charge: number;
  phase: number;
  aimAngle: number;
  windup: number;
  freezeTimer?: number;
}
interface Shot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  damage: number;
}
/** Fixed, persistent encounters. Combat drops never use financial multipliers. */
export class LateEncounters implements BulletTargets {
  actors: Encounter[] = [];
  shots: Shot[] = [];
  private selected: Encounter | null = null;
  constructor(
    private world: PixelWorld,
    private reward: (a: Encounter, kind: LootKind, value: number) => void,
    private hurt: (s: Soldier, d: number, x: number, y: number) => void,
    private sound: (x: number, y: number) => void = () => {},
  ) {}
  reset(
    cleared: readonly string[] = [],
    gathered: readonly string[] = [],
  ): void {
    this.actors = [];
    this.shots = [];
    const f = this.world.labLayout?.frame;
    if (!f?.def.framework) return;
    const done = new Set([...cleared, ...gathered]);
    for (let s = 0; s < sectorCount(f.def); s++) {
      const tier = sectorTier(f.def, s),
        p = CAMPAIGN[campaignTier(tier)],
        b = sectorBounds(f, s),
        cx = ((b.x0 + b.x1 + 1) / 2) * this.world.cellSize,
        cy = ((b.y0 + b.y1 + 1) / 2) * this.world.cellSize;
      const isMothershipBossSector = f.def.id === 5 && s === 4;
      const kinds: Encounter["kind"][] =
        tier === 7
          ? []
          : isMothershipBossSector
            ? ["turret", "turret", "boss"]
            : tier < 10
              ? ["soldier", "soldier", "brute"]
              : ["turret", "turret", "trap", "soldier", "brute"];
      if (s === f.def.start) kinds.length = 0;
      const add = (
        kind: Encounter["kind"],
        j: number,
        x: number,
        y: number,
      ) => {
        const id = `${s}:${kind}:${j}`;
        const hp =
          kind === "grove"
            ? 1
            : kind === "boss"
              ? 50000
              : p.enemyHp * (kind === "brute" ? 2 : kind === "trap" ? 0.3 : 1);
        this.actors.push({
          id,
          sector: s,
          x,
          y,
          homeX: x,
          homeY: y,
          hp,
          maxHp: hp,
          alive: !done.has(id),
          kind,
          tier,
          cooldown: 1 + j * 0.3,
          charge: 0,
          phase: j + s,
          aimAngle: 0,
          windup: 0,
        });
      };
      kinds.forEach((k, j) => {
        let ex = cx + (j < 2 ? (j % 2 ? 1 : -1) * 10 : 0) * this.world.cellSize;
        let ey = cy + (j < 2 ? 0 : (j - 1) * 5 * this.world.cellSize);
        if (k === "boss") {
          ex = cx;
          ey = cy;
        }
        add(k, j, ex, ey);
      });
      if (f.def.id === 3)
        for (let j = 0; j < p.nodes; j++)
          add(
            "grove",
            j,
            cx + Math.cos(j * 2.4) * 9 * this.world.cellSize,
            cy + Math.sin(j * 2.4) * 9 * this.world.cellSize,
          );
    }
  }
  private los(x: number, y: number, tx: number, ty: number): boolean {
    const d = Math.hypot(tx - x, ty - y),
      steps = Math.ceil(d / (this.world.cellSize * 0.5));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (
        this.world.solidAt(
          Math.floor((x + (tx - x) * t) / this.world.cellSize),
          Math.floor((y + (ty - y) * t) / this.world.cellSize),
        )
      )
        return false;
    }
    return true;
  }
  update(dt: number, soldiers: readonly Soldier[]): void {
    const cs = this.world.cellSize;
    for (const a of this.actors) {
      if (!a.alive) continue;
      if ((a.freezeTimer ?? 0) > 0) a.freezeTimer = Math.max(0, a.freezeTimer! - dt);
      const freezeSpeedMult = (a.freezeTimer ?? 0) > 0 ? FREEZE.enemySpeedMult : 1;
      let target: Soldier | undefined,
        dist = Infinity;
      for (const s of soldiers) {
        if (!s.alive) continue;
        const d = Math.hypot(s.x - a.x, s.y - a.y);
        if (d < dist) {
          dist = d;
          target = s;
        }
      }
      if (!target) continue;
      if (a.kind === "grove") {
        if (dist < cs * 3) this.kill(a);
        continue;
      }
      // Never chase into the peaceful tier-seven gathering region.
      const targetTier = this.world.fillTierAt(
        Math.floor(target.x / cs),
        Math.floor(target.y / cs),
      );
      const active =
        dist < cs * 35 &&
        targetTier >= 8 &&
        this.los(a.x, a.y, target.x, target.y);
      if (active) {
        a.aimAngle = Math.atan2(target.y - a.y, target.x - a.x);
      }
      a.cooldown -= dt;
      if (a.kind === "boss") {
        a.phase += dt;
        const active = dist < cs * 45 && this.los(a.x, a.y, target.x, target.y);
        if (active) a.aimAngle = Math.atan2(target.y - a.y, target.x - a.x);
        const healthPct = a.hp / a.maxHp;
        const enraged = healthPct <= 0.3;
        const phase2 = healthPct <= 0.6;
        const hoverSpeed = cs * (enraged ? 2.5 : 1.4) * freezeSpeedMult;
        const tx = active ? a.homeX + (target.x - a.homeX) * 0.35 + Math.cos(a.phase * 0.8) * cs * 4 : a.homeX;
        const ty = active ? a.homeY + (target.y - a.homeY) * 0.35 + Math.sin(a.phase * 0.8) * cs * 4 : a.homeY;
        const d = Math.hypot(tx - a.x, ty - a.y) || 1;
        if (d > cs) {
          const nx = a.x + ((tx - a.x) / d) * hoverSpeed * dt;
          const ny = a.y + ((ty - a.y) / d) * hoverSpeed * dt;
          if (circleIsClear(this.world, nx, a.y, cs * 1.5)) a.x = nx;
          if (circleIsClear(this.world, a.x, ny, cs * 1.5)) a.y = ny;
        }
        if (active && a.cooldown <= 0) {
          a.cooldown = enraged ? 0.75 : phase2 ? 1.05 : 1.45;
          const damage = CAMPAIGN[campaignTier(a.tier)].damage;
          const fanCount = enraged ? 5 : phase2 ? 4 : 3;
          const spreadArc = 0.55;
          const baseAngle = a.aimAngle;
          for (let k = 0; k < fanCount; k++) {
            const angle = baseAngle - spreadArc / 2 + (k / Math.max(1, fanCount - 1)) * spreadArc;
            if (this.shots.length < 256) {
              this.shots.push({
                x: a.x + Math.cos(angle) * cs * 2.5,
                y: a.y + Math.sin(angle) * cs * 2.5,
                vx: Math.cos(angle) * cs * (enraged ? 32 : 26),
                vy: Math.sin(angle) * cs * (enraged ? 32 : 26),
                life: 2.5,
                damage,
              });
            }
          }
          this.sound(a.x, a.y);
        }
        continue;
      }
      if (a.kind === "trap") {
        if (active && dist < cs * 6) a.charge += dt;
        else a.charge = Math.max(0, a.charge - dt);
        if (a.charge >= 0.9) {
          for (const s of soldiers)
            if (s.alive && Math.hypot(s.x - a.x, s.y - a.y) < cs * 8)
              this.hurt(s, CAMPAIGN[campaignTier(a.tier)].damage * 2, a.x, a.y);
          this.sound(a.x, a.y);
          this.kill(a);
        }
        continue;
      }
      if (a.kind !== "turret") {
        a.phase += dt;
        const chase =
          active && Math.hypot(a.x - a.homeX, a.y - a.homeY) < cs * 16;
        const tx = chase
            ? target.x
            : a.homeX + Math.cos(a.phase * 0.5) * cs * 5,
          ty = chase ? target.y : a.homeY + Math.sin(a.phase * 0.5) * cs * 5;
        const d = Math.hypot(tx - a.x, ty - a.y) || 1,
          speed = cs * (a.kind === "brute" ? 3 : 2) * freezeSpeedMult;
        if (!chase || dist > cs * (a.kind === "brute" ? 2 : 8)) {
          const nx = a.x + ((tx - a.x) / d) * speed * dt,
            ny = a.y + ((ty - a.y) / d) * speed * dt;
          if (circleIsClear(this.world, nx, a.y, cs * 0.65)) a.x = nx;
          if (circleIsClear(this.world, a.x, ny, cs * 0.65)) a.y = ny;
        }
      }
      if (a.kind === "brute") {
        if (active && dist < cs * 3.5) {
          a.windup += dt;
          if (a.windup >= 0.45 && a.cooldown <= 0) {
            a.windup = 0;
            a.cooldown = 1.2;
            const damage = CAMPAIGN[campaignTier(a.tier)].damage;
            if (dist < cs * 3) this.hurt(target, damage * 1.5, a.x, a.y);
          }
        } else {
          a.windup = Math.max(0, a.windup - dt * 2);
        }
      } else if (active && a.cooldown <= 0) {
        a.cooldown = a.kind === "turret" ? 0.8 : 1.7;
        const damage = CAMPAIGN[campaignTier(a.tier)].damage;
        if (this.shots.length < 256) {
          this.shots.push({
            x: a.x,
            y: a.y,
            vx: ((target.x - a.x) / Math.max(1, dist)) * cs * 30,
            vy: ((target.y - a.y) / Math.max(1, dist)) * cs * 30,
            life: 2,
            damage,
          });
          this.sound(a.x, a.y);
        }
      }
    }
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const p = this.shots[i];
      p.life -= dt;
      const steps = Math.max(
        1,
        Math.ceil((Math.hypot(p.vx, p.vy) * dt) / (cs * 0.5)),
      );
      for (let j = 0; j < steps && p.life > 0; j++) {
        p.x += (p.vx * dt) / steps;
        p.y += (p.vy * dt) / steps;
        if (this.world.solidAt(Math.floor(p.x / cs), Math.floor(p.y / cs))) {
          p.life = 0;
          break;
        }
        for (const s of soldiers)
          if (
            s.alive &&
            Math.hypot(s.x - p.x, s.y - p.y) < s.radius + cs * 0.3
          ) {
            this.hurt(s, p.damage, p.x, p.y);
            p.life = 0;
            break;
          }
      }
      if (p.life <= 0) this.shots.splice(i, 1);
    }
  }
  get targetKey(): object | null { return this.selected; }
  raycast(x: number, y: number, dx: number, dy: number, max: number, ignored?: ReadonlySet<object>): number {
    this.selected = null;
    let best = max;
    for (const a of this.actors) {
      if (!a.alive || ignored?.has(a)) continue;
      const ox = a.x - x,
        oy = a.y - y,
        t = ox * dx + oy * dy,
        r = this.world.cellSize * (a.kind === "boss" ? 2.8 : a.kind === "brute" ? 1.2 : 0.8);
      if (t < 0 || t > best || ox * ox + oy * oy - t * t > r * r) continue;
      const hit = Math.max(
        0,
        t - Math.sqrt(Math.max(0, r * r - (ox * ox + oy * oy - t * t))),
      );
      if (hit <= best) {
        best = hit;
        this.selected = a;
      }
    }
    return this.selected ? best : -1;
  }
  damageEncounter(a: Encounter, damage: number): boolean {
    if (!a.alive) return true;
    const mult = (a.freezeTimer ?? 0) > 0 && a.kind !== "grove" ? FREEZE.enemyDamageMult : 1;
    a.hp -= damage * mult;
    if (a.hp <= 0) {
      this.kill(a);
      return true;
    }
    return false;
  }
  applyHit(damage: number): boolean {
    if (!this.selected || !this.selected.alive) return false;
    this.damageEncounter(this.selected, damage);
    return true;
  }
  explode(x: number, y: number, r: number, damage: number): void {
    for (const a of this.actors)
      if (a.alive && Math.hypot(a.x - x, a.y - y) < r) {
        this.damageEncounter(a, damage);
      }
  }
  private kill(a: Encounter): void {
    if (!a.alive) return;
    a.alive = false;
    const p = CAMPAIGN[campaignTier(a.tier)];
    const rewardValue =
      a.kind === "grove"
        ? p.biomass
        : a.kind === "boss"
          ? 10000
          : p.essence * (a.kind === "brute" ? 2 : 1);
    this.reward(
      a,
      a.kind === "grove" ? LootKind.Biomass : LootKind.Essence,
      rewardValue,
    );
  }
  draw(ctx: CanvasRenderingContext2D, cam: CameraSystem): void {
    for (const a of this.actors) {
      if (!a.alive) continue;
      const x = cam.worldToScreenX(a.x),
        y = cam.worldToScreenY(a.y),
        r = this.world.cellSize * cam.zoom;
      if (
        x < -r * 6 ||
        y < -r * 6 ||
        x > cam.viewW + r * 6 ||
        y > cam.viewH + r * 6
      )
        continue;
      if (a.kind === "boss") {
        const br = r * 2.8;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(a.aimAngle);
        // Outer dark carapace
        ctx.fillStyle = a.hp / a.maxHp <= 0.3 ? "#ff1a53" : "#800e3b";
        ctx.fillRect(-br, -br, br * 2, br * 2);
        // Inner core
        ctx.fillStyle = "#ff66a3";
        ctx.fillRect(-br * 0.6, -br * 0.6, br * 1.2, br * 1.2);
        // Central matrix eye
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(-br * 0.25, -br * 0.25, br * 0.5, br * 0.5);
        // Front cannons
        ctx.fillStyle = "#ffd84d";
        ctx.fillRect(br * 0.5, -br * 0.3, br * 0.7, br * 0.2);
        ctx.fillRect(br * 0.5, br * 0.1, br * 0.7, br * 0.2);
        ctx.restore();

        // Big Boss Health Bar above boss
        const barW = br * 2.5;
        const barH = Math.max(4, 5 * cam.zoom);
        const barY = y - br - 12 * cam.zoom;
        ctx.fillStyle = "#15151d";
        ctx.fillRect(x - barW / 2, barY, barW, barH);
        ctx.fillStyle = a.hp / a.maxHp <= 0.3 ? "#ff0055" : "#ff3377";
        ctx.fillRect(x - barW / 2, barY, (barW * Math.max(0, a.hp)) / a.maxHp, barH);
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = Math.max(1, cam.zoom);
        ctx.strokeRect(x - barW / 2, barY, barW, barH);
        continue;
      }
      ctx.fillStyle =
        a.kind === "grove"
          ? "#7fe39a"
          : a.kind === "trap"
            ? "#ffb347"
            : "#e85a98";
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
      if (a.kind === "soldier" || a.kind === "turret") {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(a.aimAngle);
        ctx.fillStyle = "#ffddaa";
        ctx.fillRect(0, -r * 0.3, r * 1.8, r * 0.6);
        ctx.restore();
      } else if (a.kind === "brute") {
        // Brute windup telegraph: flashes yellow-white when preparing melee strike
        if (a.windup > 0) {
          const t = a.windup / 0.45;
          ctx.strokeStyle = t > 0.7 ? "#ffffff" : "#ffd84d";
          ctx.lineWidth = Math.max(1, 2 * cam.zoom);
          ctx.strokeRect(x - r - 2, y - r - 2, (r + 2) * 2, (r + 2) * 2);
        }
      }
      if (a.kind === "trap" && a.charge > 0) {
        ctx.strokeStyle = "#ffb347";
        ctx.lineWidth = Math.max(1.5, 2 * cam.zoom);
        ctx.beginPath();
        ctx.arc(x, y, (r * 6 * a.charge) / 0.9, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (a.hp < a.maxHp) {
        ctx.fillStyle = "#15151d";
        ctx.fillRect(x - r, y - r * 1.8, r * 2, 2);
        ctx.fillStyle = "#fa6a9a";
        ctx.fillRect(x - r, y - r * 1.8, (r * 2 * a.hp) / a.maxHp, 2);
      }
    }
    ctx.fillStyle = "#ff889e";
    for (const p of this.shots)
      ctx.fillRect(
        cam.worldToScreenX(p.x) - 2,
        cam.worldToScreenY(p.y) - 2,
        4,
        4,
      );
  }

  /** Post-fog overlay rendering so critical warnings (mine warning rings, brute windup) remain readable. */
  drawOverlay(ctx: CanvasRenderingContext2D, cam: CameraSystem): void {
    for (const a of this.actors) {
      if (!a.alive) continue;
      const x = cam.worldToScreenX(a.x),
        y = cam.worldToScreenY(a.y),
        r = this.world.cellSize * cam.zoom;
      if (
        x < -r * 6 ||
        y < -r * 6 ||
        x > cam.viewW + r * 6 ||
        y > cam.viewH + r * 6
      )
        continue;
      if (a.kind === "boss") {
        const br = r * 2.8;
        ctx.save();
        ctx.strokeStyle = a.hp / a.maxHp <= 0.3 ? "#ff0055" : "#ff4081";
        ctx.lineWidth = Math.max(2, 2.5 * cam.zoom);
        ctx.strokeRect(x - br - 2, y - br - 2, (br + 2) * 2, (br + 2) * 2);
        ctx.restore();
        continue;
      }
      if (a.kind === "trap" && a.charge > 0) {
        const pulse = 0.8 + 0.2 * Math.sin(performance.now() * 0.02);
        ctx.save();
        ctx.strokeStyle = a.charge > 0.6 ? "#ff4040" : "#ffb347";
        ctx.lineWidth = Math.max(2, 2.5 * cam.zoom);
        ctx.beginPath();
        ctx.arc(x, y, (r * 6 * a.charge) / 0.9, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = a.charge > 0.6 ? `rgba(255, 64, 64, ${0.15 * pulse})` : `rgba(255, 179, 71, ${0.12 * pulse})`;
        ctx.fill();
        ctx.restore();
      } else if (a.kind === "brute" && a.windup > 0) {
        const t = a.windup / 0.45;
        ctx.save();
        ctx.strokeStyle = t > 0.7 ? "#ff3366" : "#ffcc00";
        ctx.lineWidth = Math.max(1.5, 2 * cam.zoom);
        ctx.strokeRect(x - r - 3, y - r - 3, (r + 3) * 2, (r + 3) * 2);
        ctx.restore();
      }
    }
  }
}
