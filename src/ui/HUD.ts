import type { Game } from "../Game";

function fmtTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Minimal DOM HUD: top stat bar, bottom-left soldier stats, hint line. */
export class HUD {
  readonly root: HTMLDivElement;
  private fields: Record<string, HTMLSpanElement> = {};
  private statsEl: HTMLDivElement;
  private hintEl: HTMLDivElement;
  private debugEl: HTMLDivElement;
  private lastUpdate = 0;

  constructor(parent: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "hud";
    const bar = document.createElement("div");
    bar.className = "hud-bar";
    const items: [string, string][] = [
      ["time", "TIME"],
      ["pixels", "PIXELS"],
      ["currency", "◆"],
      ["depth", "DEPTH"],
      ["soldiers", "SOLDIERS"],
      ["growth", "GROWTH"],
    ];
    for (const [key, label] of items) {
      const box = document.createElement("div");
      box.className = `hud-item hud-${key}`;
      const l = document.createElement("span");
      l.className = "hud-label";
      l.textContent = label;
      const v = document.createElement("span");
      v.className = "hud-value";
      box.append(l, v);
      bar.append(box);
      this.fields[key] = v;
    }
    this.statsEl = document.createElement("div");
    this.statsEl.className = "hud-stats";
    this.hintEl = document.createElement("div");
    this.hintEl.className = "hud-hint";
    this.debugEl = document.createElement("div");
    this.debugEl.className = "hud-debug";
    this.root.append(bar, this.statsEl, this.hintEl, this.debugEl);
    parent.append(this.root);
  }

  update(game: Game, now: number, force = false): void {
    if (!force && now - this.lastUpdate < 100) return;
    this.lastUpdate = now;
    const s = game.runStats;
    const alive = game.soldiers.filter((x) => x.alive).length;
    this.fields.time.textContent = fmtTime(s.time);
    this.fields.pixels.textContent = s.pixelsDestroyed.toLocaleString();
    this.fields.currency.textContent = s.currency.toLocaleString();
    this.fields.depth.textContent = `${s.maxDepth}`;
    this.fields.soldiers.textContent = `${alive} / +${game.reserves}`;
    this.fields.growth.textContent = `${game.growthRate.toFixed(1)}/s`;

    const st = game.stats;
    this.statsEl.innerHTML =
      `<div><b>SPD</b> ${st.speed.toFixed(0)}</div>` +
      `<div><b>ROF</b> ${st.fireRate.toFixed(2)}/s</div>` +
      `<div><b>DMG</b> ${st.damage}</div>` +
      `<div><b>BUL</b> ${st.bulletSpeed.toFixed(0)}</div>` +
      `<div><b>MULTI</b> ${(st.multishotChance * 100).toFixed(0)}%</div>`;

    let hint = "";
    if (game.paused) hint = "PAUSED — Space to resume";
    else if (game.reserves > 0 && game.canDeploy)
      hint = "Click to launch a soldier toward the cursor";
    else if (game.reserves > 0) hint = "Spawn room overrun — cannot deploy";
    hint +=
      (hint ? "  ·  " : "") +
      "Wheel zoom · Right/Middle drag pan · F follow · Tab cycle · Space pause · R restart";
    this.hintEl.textContent = hint;

    if (game.debug) {
      const d = game.debugInfo;
      const near = game.growth.nearSoldierPercent(s.time);
      this.debugEl.style.display = "block";
      this.debugEl.textContent =
        `FPS ${d.fps.toFixed(0)}  frame ${d.frameMs.toFixed(1)}ms  sim ${d.simMs.toFixed(2)}ms\n` +
        `frontier ${game.growth.frontier.size}  growthEvents ${game.growth.totalEvents}  near-soldier ${near.toFixed(0)}%\n` +
        `bullets ${game.combat.bullets.activeCount}  particles ${game.particles.count}  ` +
        `chunks rebuilt ${game.terrain.rebuiltLastFrame}  pending ${game.terrain.chunks.pending}\n` +
        `relocations ${game.physics.stats.relocations}  stuck ${game.physics.stats.stuckEvents}`;
    } else {
      this.debugEl.style.display = "none";
    }
  }
}
