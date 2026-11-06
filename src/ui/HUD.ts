import { GROWTH, TERRAIN } from "../config";
import type { Game } from "../Game";
import { sprite, UI_COLORS, type SpriteName } from "./pixelArt";

function fmtTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Pixel-art DOM HUD:
 * - Top stat bar (Time, Pixels, Gold, Crystals [when unlocked], Bank, Depth, Soldiers)
 * - Bottom-left compact soldier stats
 * - Dramatic bottom-middle Growth Rate meter
 * - Bottom-right `?` button that toggles all help/controls text
 */
export class HUD {
  readonly root: HTMLDivElement;
  private fields: Record<string, HTMLSpanElement> = {};
  private boxes: Record<string, HTMLDivElement> = {};
  private statsEl: HTMLDivElement;
  private launchBtn: HTMLButtonElement;
  private launchCountEl: HTMLSpanElement;
  private growthMeterEl: HTMLDivElement;
  private growthFillEl: HTMLDivElement;
  private growthRateEl: HTMLSpanElement;
  private growthStageEl: HTMLSpanElement;
  private helpBtn: HTMLButtonElement;
  private helpPopoverEl: HTMLDivElement;
  private helpStatusEl: HTMLDivElement;
  private touchBar: HTMLDivElement;
  private followBtn: HTMLButtonElement;
  private helpOpen = false;
  private lastUpdate = 0;

  constructor(parent: HTMLElement, private game: Game) {
    this.root = document.createElement("div");
    this.root.className = "hud";
    const bar = document.createElement("div");
    bar.className = "hud-bar";
    const items: [string, string, SpriteName, string][] = [
      ["time", "TIME", "clock", UI_COLORS.neutral],
      ["pixels", "PIXELS", "pixelBits", UI_COLORS.neutral],
      ["currency", "GOLD", "gold", UI_COLORS.gold],
      ["crystals", "CRYS", "crystal", UI_COLORS.crystal],
      ["bank", "BANK", "gold", UI_COLORS.gold],
      ["depth", "DEPTH", "depth", UI_COLORS.neutral],
      ["soldiers", "SOLDIERS", "soldier", UI_COLORS.soldier],
    ];
    for (const [key, label, icon, color] of items) {
      const box = document.createElement("div");
      box.className = `hud-item hud-${key}`;
      const l = document.createElement("span");
      l.className = "hud-label";
      l.innerHTML = `${sprite(icon, { color })} ${label}`;
      const v = document.createElement("span");
      v.className = "hud-value";
      box.append(l, v);
      bar.append(box);
      this.fields[key] = v;
      this.boxes[key] = box;
    }

    this.launchBtn = document.createElement("button");
    this.launchBtn.className = "hud-launch-btn";
    this.launchBtn.title = "Deploy Reserve Soldier";
    this.launchBtn.innerHTML =
      `<span class="launch-count"></span>` +
      sprite("soldier", { color: UI_COLORS.soldier, scale: 3 }) +
      `<span class="launch-lbl">DEPLOY</span>`;
    this.launchCountEl = this.launchBtn.querySelector(".launch-count") as HTMLSpanElement;
    this.launchBtn.addEventListener("click", () => this.game.launchInRandomDirection());

    // On-screen stand-ins for keyboard shortcuts, shown on touch screens only (see CSS).
    this.touchBar = document.createElement("div");
    this.touchBar.className = "hud-touch";
    const pauseBtn = document.createElement("button");
    pauseBtn.className = "hud-touch-btn";
    pauseBtn.title = "Pause / Menu";
    pauseBtn.innerHTML = sprite("pause", { color: UI_COLORS.white, scale: 3 });
    pauseBtn.addEventListener("click", () => this.game.togglePauseMenu(true));
    this.followBtn = document.createElement("button");
    this.followBtn.className = "hud-touch-btn";
    this.followBtn.title = "Follow soldiers (tap again to cycle)";
    this.followBtn.innerHTML = sprite("follow", { color: UI_COLORS.soldier, scale: 3 });
    this.followBtn.addEventListener("click", () => {
      const cam = this.game.camera;
      if (cam.following) cam.cycleTarget(this.game.soldiers);
      else cam.resumeAuto();
      this.update(this.game, performance.now(), true);
    });
    this.touchBar.append(pauseBtn, this.followBtn);

    this.statsEl = document.createElement("div");
    this.statsEl.className = "hud-stats";

    // Dramatic bottom-middle Growth Rate Meter.
    this.growthMeterEl = document.createElement("div");
    this.growthMeterEl.className = "growth-meter stage-dormant";
    this.growthMeterEl.innerHTML = `
      <div class="gm-header">
        <span class="gm-title">${sprite("warn", { color: UI_COLORS.warn, scale: 1 })} REPLICATION SURGE</span>
        <span class="gm-stage">DORMANT</span>
        <span class="gm-rate">0.0 /s</span>
      </div>
      <div class="gm-track">
        <div class="gm-fill"></div>
      </div>
    `;
    this.growthFillEl = this.growthMeterEl.querySelector(".gm-fill") as HTMLDivElement;
    this.growthRateEl = this.growthMeterEl.querySelector(".gm-rate") as HTMLSpanElement;
    this.growthStageEl = this.growthMeterEl.querySelector(".gm-stage") as HTMLSpanElement;

    // Bottom-right '?' button + collapsible help popover containing all help text.
    this.helpBtn = document.createElement("button");
    this.helpBtn.className = "hud-help-btn";
    this.helpBtn.title = "Help & Controls";
    this.helpBtn.innerHTML = sprite("help", { color: UI_COLORS.gold });
    this.helpBtn.addEventListener("click", () => {
      this.helpOpen = !this.helpOpen;
      this.helpPopoverEl.classList.toggle("hidden", !this.helpOpen);
      this.helpBtn.classList.toggle("active", this.helpOpen);
      this.update(this.game, performance.now(), true);
    });

    this.helpPopoverEl = document.createElement("div");
    this.helpPopoverEl.className = "hud-help-popover hidden";
    this.helpPopoverEl.innerHTML = `
      <div class="help-title">HOW TO PLAY &amp; CONTROLS</div>
      <div class="help-status"></div>
      <div class="help-list">
        <div class="help-mouse"><b>CLICK &amp; LET GO</b> Place soldier anywhere in random direction</div>
        <div class="help-mouse"><b>PRESS &amp; DRAG</b> Pull back to aim arrow; release to launch</div>
        <div class="help-mouse"><b>RIGHT DRAG / WHEEL</b> Pan camera around &amp; zoom in/out</div>
        <div class="help-touch"><b>TAP</b> Place soldier anywhere in random direction</div>
        <div class="help-touch"><b>DRAG &amp; RELEASE</b> Pull back to aim arrow; release to launch</div>
        <div class="help-touch"><b>TWO-FINGER PINCH/DRAG</b> Pan camera around &amp; zoom in/out</div>
        <div class="help-touch"><b>${sprite("follow", { color: UI_COLORS.soldier, scale: 1 })} BUTTON</b> Follow farthest soldier, tap again to cycle</div>
        <div class="help-touch"><b>${sprite("pause", { color: UI_COLORS.white, scale: 1 })} BUTTON</b> Pause, restart, upgrades &amp; settings</div>
        <div><b>CURRENCIES</b> Zone 1 drops gold squares ${sprite("gold", { color: UI_COLORS.gold, scale: 1 })}; Zone 2 unlocks glowing orange crystals ${sprite("crystal", { color: UI_COLORS.crystal, scale: 1 })}. Soldiers must touch them to collect!</div>
        <div class="help-keys"><b>F / TAB</b> Follow farthest / Cycle soldiers</div>
        <div class="help-keys"><b>U</b> Open Upgrade Matrix</div>
        <div class="help-keys"><b>SPACE / ESC</b> Pause / Menu (&amp; Settings ${sprite("gear", { color: UI_COLORS.soldier, scale: 1 })})</div>
        <div class="help-keys"><b>R</b> Quick restart run</div>
      </div>
    `;
    this.helpStatusEl = this.helpPopoverEl.querySelector(".help-status") as HTMLDivElement;

    this.root.append(
      bar,
      this.launchBtn,
      this.touchBar,
      this.statsEl,
      this.growthMeterEl,
      this.helpPopoverEl,
      this.helpBtn,
    );
    parent.append(this.root);
  }

  update(game: Game, now: number, force = false): void {
    if (!force && now - this.lastUpdate < 80) return;
    this.lastUpdate = now;
    const s = game.runStats;
    const alive = game.soldiers.filter((x) => x.alive).length;
    this.fields.time.textContent = fmtTime(s.time);
    this.fields.pixels.textContent = s.pixelsDestroyed.toLocaleString();
    this.fields.currency.textContent = s.currency.toLocaleString();

    const totalCrystals = game.crystals + s.crystals;
    const showCrystals = totalCrystals > 0 || s.maxDepth >= TERRAIN.zone2Depth || game.bests.depth >= TERRAIN.zone2Depth;
    this.boxes.crystals.classList.toggle("hidden", !showCrystals);
    this.fields.crystals.textContent = `${s.crystals} (${game.crystals})`;

    this.fields.bank.textContent = game.bank.toLocaleString();
    this.fields.depth.textContent = `${s.maxDepth}`;
    this.fields.soldiers.textContent = `${alive} / +${game.reserves}`;

    // Dramatic Growth Rate meter update.
    const rate = game.growthRate;
    const graceRem = game.growth.graceRemaining(s.time);
    const norm =
      rate <= 0
        ? 0
        : Math.min(
            1,
            Math.log(1 + rate * 1.8) / Math.log(1 + GROWTH.maxRate * 1.8),
          );
    const pct = (norm * 100).toFixed(1);
    this.growthFillEl.style.width = `${pct}%`;

    let stageClass = "stage-dormant";
    let stageLabel = "DORMANT";
    if (rate <= 0) {
      stageClass = "stage-dormant";
      stageLabel = graceRem > 0 ? `GRACE ${graceRem.toFixed(0)}S` : "DORMANT";
      this.growthRateEl.textContent = `0.0 /S`;
    } else if (rate < 3) {
      stageClass = "stage-creeping";
      stageLabel = "CREEPING";
      this.growthRateEl.textContent = `${rate.toFixed(1)} /S`;
    } else if (rate < 18) {
      stageClass = "stage-surging";
      stageLabel = "SURGING!";
      this.growthRateEl.textContent = `${rate.toFixed(1)} /S`;
    } else if (rate < 70) {
      stageClass = "stage-critical";
      stageLabel = "CRITICAL!!";
      this.growthRateEl.textContent = `${rate.toFixed(1)} /S`;
    } else {
      stageClass = "stage-overdrive";
      stageLabel = "OVERDRIVE!!!";
      this.growthRateEl.textContent = `${rate.toFixed(0)} /S`;
    }
    this.growthMeterEl.className = `growth-meter ${stageClass}`;
    this.growthStageEl.textContent = stageLabel;

    // Reserve launch button on the right side.
    if (game.reserves > 0 && game.canDeploy && !game.runOver) {
      this.launchBtn.classList.remove("hidden");
      this.launchCountEl.textContent = `${game.reserves}`;
    } else {
      this.launchBtn.classList.add("hidden");
    }

    this.followBtn.classList.toggle("active", game.camera.following);

    const st = game.stats;
    this.statsEl.innerHTML =
      `<div><b>SPD</b> ${st.speed.toFixed(0)}</div>` +
      `<div><b>ROF</b> ${st.fireRate.toFixed(2)}/s</div>` +
      `<div><b>DMG</b> ${st.damage}</div>` +
      `<div><b>DROP</b> ${(st.dropChance * 100).toFixed(0)}%</div>` +
      `<div><b>MAG</b> ${st.magnetRange.toFixed(0)}</div>` +
      `<div><b>MAX</b> ${st.maxSoldiers}</div>`;

    if (this.helpOpen) {
      let status = "";
      if (game.paused && !game.runOver) status = "PAUSED — Press Space or Esc to resume";
      else if (game.reserves > 0 && game.canDeploy)
        status = `Click to place (random dir) or drag to aim (${game.reserves} in reserve)`;
      else if (game.reserves > 0) status = "Cannot deploy";
      else status = "Soldiers autonomous — pan camera to explore!";
      this.helpStatusEl.textContent = status;
    }
  }
}
