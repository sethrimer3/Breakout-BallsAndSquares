import { GROWTH } from "../config";
import type { Game } from "../Game";

function fmtTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Pixel-art DOM HUD:
 * - Top stat bar (Time, Pixels, Gold Collected, Bank, Depth, Soldiers)
 * - Bottom-left compact soldier stats
 * - Dramatic bottom-middle Growth Rate meter
 * - Bottom-right `?` button that toggles all help/controls text
 */
export class HUD {
  readonly root: HTMLDivElement;
  private fields: Record<string, HTMLSpanElement> = {};
  private statsEl: HTMLDivElement;
  private launchBtn: HTMLButtonElement;
  private upgBtn: HTMLButtonElement;
  private muteBtn: HTMLButtonElement;
  private growthMeterEl: HTMLDivElement;
  private growthFillEl: HTMLDivElement;
  private growthRateEl: HTMLSpanElement;
  private growthStageEl: HTMLSpanElement;
  private helpBtn: HTMLButtonElement;
  private helpPopoverEl: HTMLDivElement;
  private helpStatusEl: HTMLDivElement;
  private helpOpen = false;
  private lastUpdate = 0;

  constructor(parent: HTMLElement, private game: Game) {
    this.root = document.createElement("div");
    this.root.className = "hud";
    const bar = document.createElement("div");
    bar.className = "hud-bar";
    const items: [string, string][] = [
      ["time", "TIME"],
      ["pixels", "PIXELS"],
      ["currency", "■ GOLD"],
      ["bank", "■ BANK"],
      ["depth", "DEPTH"],
      ["soldiers", "SOLDIERS"],
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

    this.upgBtn = document.createElement("button");
    this.upgBtn.className = "hud-top-btn";
    this.upgBtn.title = "Open Upgrade Tree (U)";
    this.upgBtn.innerHTML = `✦ <span class="upg-count">0</span>`;
    this.upgBtn.addEventListener("click", () => {
      this.game.bankCurrentRun();
      this.game.openUpgrades();
    });

    this.muteBtn = document.createElement("button");
    this.muteBtn.className = "hud-mute-btn";
    this.muteBtn.title = "Toggle Audio (M)";
    this.muteBtn.addEventListener("click", () => {
      this.game.audio.toggleMute();
      this.update(this.game, performance.now(), true);
    });

    this.launchBtn = document.createElement("button");
    this.launchBtn.className = "hud-launch-btn";
    this.launchBtn.title = "Deploy Reserve Soldier";
    this.launchBtn.addEventListener("click", () => this.game.launchInRandomDirection());

    this.statsEl = document.createElement("div");
    this.statsEl.className = "hud-stats";

    // Dramatic bottom-middle Growth Rate Meter.
    this.growthMeterEl = document.createElement("div");
    this.growthMeterEl.className = "growth-meter stage-dormant";
    this.growthMeterEl.innerHTML = `
      <div class="gm-header">
        <span class="gm-title">⚠ REPLICATION SURGE</span>
        <span class="gm-stage">DORMANT</span>
        <span class="gm-rate">0.0 /s</span>
      </div>
      <div class="gm-track">
        <div class="gm-fill"></div>
        <div class="gm-ticks">
          <span></span><span></span><span></span><span></span><span></span><span></span><span></span>
        </div>
      </div>
    `;
    this.growthFillEl = this.growthMeterEl.querySelector(".gm-fill") as HTMLDivElement;
    this.growthRateEl = this.growthMeterEl.querySelector(".gm-rate") as HTMLSpanElement;
    this.growthStageEl = this.growthMeterEl.querySelector(".gm-stage") as HTMLSpanElement;

    // Bottom-right '?' button + collapsible help popover containing all help text.
    this.helpBtn = document.createElement("button");
    this.helpBtn.className = "hud-help-btn";
    this.helpBtn.title = "Help & Controls";
    this.helpBtn.textContent = "?";
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
        <div><b>LEFT CLICK</b> Aim &amp; launch reserve soldier</div>
        <div><b>GOLD SQUARES</b> Broken pixels have a chance to drop glowing gold squares — soldiers must pick them up to collect money!</div>
        <div><b>WHEEL</b> Zoom camera in / out</div>
        <div><b>RIGHT / MID DRAG</b> Pan camera</div>
        <div><b>F / TAB</b> Follow farthest / Cycle soldiers</div>
        <div><b>U</b> Open Upgrade Matrix</div>
        <div><b>SPACE / ESC</b> Pause / Menu</div>
        <div><b>R / M</b> Quick restart / Mute audio</div>
      </div>
    `;
    this.helpStatusEl = this.helpPopoverEl.querySelector(".help-status") as HTMLDivElement;

    this.root.append(
      bar,
      this.upgBtn,
      this.muteBtn,
      this.launchBtn,
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
    this.fields.bank.textContent = game.bank.toLocaleString();
    this.fields.depth.textContent = `${s.maxDepth}`;
    this.fields.soldiers.textContent = `${alive} / +${game.reserves}`;

    // Dramatic Growth Rate meter update.
    const rate = game.growthRate;
    const graceRem = Math.max(0, GROWTH.graceSeconds - s.time);
    // Log-ish curve so early growth (0.35 -> 15/s) is already visibly climbing and 150/s hits 100%.
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

    // Count affordable upgrades (including current run currency if banked).
    const upgCount = this.upgBtn.querySelector(".upg-count") as HTMLSpanElement;
    let affordable = 0;
    const totalBank = game.bank + s.currency;
    for (const d of game.upgrades.defs) {
      if (game.upgrades.isUnlocked(d.id) && !game.upgrades.isMaxed(d.id)) {
        if (totalBank >= game.upgrades.costOf(d.id)) affordable++;
      }
    }
    upgCount.textContent = `${affordable}`;
    this.upgBtn.classList.toggle("has-affordable", affordable > 0);
    this.muteBtn.textContent = game.audio.muted ? "🔇" : "🔊";

    // Reserve launch button on the right side.
    if (game.reserves > 0 && game.canDeploy && !game.runOver) {
      this.launchBtn.classList.remove("hidden");
      this.launchBtn.innerHTML = `<span class="launch-count">${game.reserves}</span><span class="launch-ball"></span><span class="launch-lbl">DEPLOY</span>`;
    } else {
      this.launchBtn.classList.add("hidden");
    }

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
      if (game.paused && !game.runOver) status = "PAUSED — Press Space to resume";
      else if (game.reserves > 0 && game.canDeploy)
        status = `Click arena to aim & launch soldier (${game.reserves} in reserve)`;
      else if (game.reserves > 0) status = "Spawn room overrun — cannot deploy";
      else status = "Soldiers autonomous — collect golden squares!";
      this.helpStatusEl.textContent = status;
    }
  }
}
