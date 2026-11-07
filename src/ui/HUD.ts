import { essenceIcon } from "./essenceIcon";
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
 * - Top stat bar (Time, Pixels, Gold, Crystals, Green Crystals & Essence [when unlocked], Bank, Depth, Soldiers)
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
  private tacticalBar: HTMLDivElement;
  private autoMoveCheck: HTMLInputElement;
  private lineBtn: HTMLButtonElement;
  private triangleBtn: HTMLButtonElement;
  private abilityBar: HTMLDivElement;
  private abilityBtns = new Map<number, HTMLButtonElement>();
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
      ["greenCrystals", "GREEN", "crystal", UI_COLORS.greenCrystal],
      ["essence", "ESSENCE", "gold", UI_COLORS.essence],
      ["bank", "BANK", "gold", UI_COLORS.gold],
      ["depth", "DEPTH", "depth", UI_COLORS.neutral],
      ["soldiers", "SOLDIERS", "soldier", UI_COLORS.soldier],
    ];
    for (const [key, label, icon, color] of items) {
      const box = document.createElement("div");
      box.className = `hud-item hud-${key}`;
      const l = document.createElement("span");
      l.className = "hud-label";
      l.innerHTML = key === "essence" ? `${essenceIcon(1)} ${label}` : `${sprite(icon, { color })} ${label}`;
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
    this.followBtn.title = "Follow soldiers (tap again to cycle in order)";
    this.followBtn.innerHTML = sprite("follow", { color: UI_COLORS.soldier, scale: 3 });
    this.followBtn.addEventListener("click", () => {
      const cam = this.game.camera;
      if (cam.following) cam.cycleTarget(this.game.soldiers);
      else cam.resumeAuto();
      this.update(this.game, performance.now(), true);
    });
    this.touchBar.append(pauseBtn, this.followBtn);

    this.tacticalBar = document.createElement("div");
    this.tacticalBar.className = "hud-tactical-bar";
    this.tacticalBar.innerHTML = `
      <label class="hud-check-label" title="Toggle autonomous soldier movement vs manual commander control">
        <input type="checkbox" class="hud-automove" ${this.game.autoMove ? "checked" : ""} />
        <span class="hud-check-custom"></span>
        <span class="hud-check-text">AUTO MOVE</span>
      </label>
      <div class="hud-formations">
        <button class="hud-form-btn hud-form-line hidden" title="Line Formation (Hotkey: 1) — soldiers follow in a line">
          ${sprite("formationLine", { color: UI_COLORS.soldier, scale: 1 })}
          <span>LINE</span>
        </button>
        <button class="hud-form-btn hud-form-triangle hidden" title="Triangle Formation (Hotkey: 2) — soldiers form a wedge">
          ${sprite("formationTriangle", { color: UI_COLORS.soldier, scale: 1 })}
          <span>TRI</span>
        </button>
      </div>
    `;

    this.autoMoveCheck = this.tacticalBar.querySelector(".hud-automove") as HTMLInputElement;
    this.autoMoveCheck.addEventListener("change", () => {
      this.game.setAutoMove(this.autoMoveCheck.checked);
      this.update(this.game, performance.now(), true);
    });

    this.lineBtn = this.tacticalBar.querySelector(".hud-form-line") as HTMLButtonElement;
    this.lineBtn.addEventListener("click", () => {
      this.game.toggleFormation("line");
      this.update(this.game, performance.now(), true);
    });

    this.triangleBtn = this.tacticalBar.querySelector(".hud-form-triangle") as HTMLButtonElement;
    this.triangleBtn.addEventListener("click", () => {
      this.game.toggleFormation("triangle");
      this.update(this.game, performance.now(), true);
    });

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
        <div class="help-mouse"><b>WASD / ARROWS</b> Move commander (when Auto Move is OFF)</div>
        <div class="help-mouse"><b>MOUSE + CLICK</b> Aim &amp; shoot (or enable "Always shoot" in Settings)</div>
        <div class="help-mouse"><b>CLICK</b> Place soldier (in reserve)</div>
        <div class="help-mouse"><b>PRESS &amp; DRAG</b> Pull back to aim arrow; release to launch</div>
        <div class="help-mouse"><b>RIGHT DRAG / WHEEL</b> Pan camera around &amp; zoom in/out</div>
        <div class="help-mouse"><b>G / TAP ABILITY</b> Activate ready secondary ability (Sticky Grenade)</div>
        <div class="help-mouse"><b>ESC</b> Pause menu</div>
        <div class="help-touch"><b>DUAL STICKS</b> Left stick to move, right stick to aim &amp; fire (Auto Move OFF)</div>
        <div class="help-touch"><b>TAP ABILITY BUTTON</b> Activate ready secondary ability (bottom of screen)</div>
        <div class="help-touch"><b>TAP</b> Place soldier (in reserve)</div>
        <div class="help-touch"><b>DRAG &amp; RELEASE</b> Pull back to aim arrow; release to launch</div>
        <div class="help-touch"><b>TWO-FINGER PINCH/DRAG</b> Pan camera around &amp; zoom in/out</div>
        <div class="help-touch"><b>${sprite("follow", { color: UI_COLORS.soldier, scale: 1 })} BUTTON</b> Follow soldier #1, tap again to cycle in order</div>
        <div class="help-touch"><b>${sprite("pause", { color: UI_COLORS.white, scale: 1 })} BUTTON</b> Pause, restart, upgrades &amp; settings</div>
        <div><b>CURRENCIES</b> Zone 1 drops gold squares ${sprite("gold", { color: UI_COLORS.gold, scale: 1 })}, Zone 2 orange crystals ${sprite("crystal", { color: UI_COLORS.crystal, scale: 1 })}, Zone 3 green crystals ${sprite("crystal", { color: UI_COLORS.greenCrystal, scale: 1 })}, and Blight Cores leave Blight Essence ${essenceIcon(1)}. Soldiers must touch them to collect!</div>
        <div class="help-keys"><b>1 / 2</b> Toggle Line / Triangle formation</div>
        <div class="help-keys"><b>F / TAB</b> Follow / Cycle soldiers in order (#1, #2, ...)</div>
        <div class="help-keys"><b>U</b> Open Upgrade Matrix</div>
        <div class="help-keys"><b>SPACE / ESC</b> Pause / Menu (&amp; Settings ${sprite("gear", { color: UI_COLORS.soldier, scale: 1 })})</div>
        <div class="help-keys"><b>R</b> Quick restart run</div>
      </div>
    `;
    this.helpStatusEl = this.helpPopoverEl.querySelector(".help-status") as HTMLDivElement;

    this.abilityBar = document.createElement("div");
    this.abilityBar.className = "hud-abilities hidden";

    this.root.append(
      bar,
      this.tacticalBar,
      this.launchBtn,
      this.touchBar,
      this.abilityBar,
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

    const showGreen = game.greenCrystals + s.greenCrystals > 0 || s.maxDepth >= TERRAIN.zone3Depth || game.bests.depth >= TERRAIN.zone3Depth;
    this.boxes.greenCrystals.classList.toggle("hidden", !showGreen);
    this.fields.greenCrystals.textContent = `${s.greenCrystals} (${game.greenCrystals})`;
    this.boxes.essence.classList.toggle("hidden", game.essence + s.essence <= 0);
    this.fields.essence.textContent = `${s.essence} (${game.essence})`;

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

    this.autoMoveCheck.checked = game.autoMove;
    const hasLine = game.upgrades.levelOf("formation_line") > 0;
    const hasTriangle = game.upgrades.levelOf("formation_triangle") > 0;
    this.lineBtn.classList.toggle("hidden", !hasLine);
    this.triangleBtn.classList.toggle("hidden", !hasTriangle);
    this.lineBtn.classList.toggle("active", game.activeFormation === "line");
    this.triangleBtn.classList.toggle("active", game.activeFormation === "triangle");

    const st = game.stats;
    let statsHtml =
      `<div><b>SPD</b> ${st.speed.toFixed(0)}</div>` +
      `<div><b>ROF</b> ${st.fireRate.toFixed(2)}/s</div>` +
      `<div><b>DMG</b> ${st.damage}</div>` +
      `<div><b>DROP</b> ${(st.dropChance * 100).toFixed(0)}%</div>` +
      `<div><b>MAG</b> ${st.magnetRange.toFixed(0)}</div>` +
      `<div><b>MAX</b> ${st.maxSoldiers}</div>`;

    const grenadier = game.soldiers.find((x) => x.alive && x.secondary === "grenade");
    if (grenadier) {
      const rate = (grenadier.mods?.energyPerBlock ?? 0.1).toFixed(1);
      statsHtml += `<div style="color: #ff9d3b"><b>NADE</b> ${grenadier.secondaryEnergy.toFixed(1)}/${st.grenadeBlocksRequired} (+${rate}/b)</div>`;
    }
    const turretier = game.soldiers.find((x) => x.alive && x.secondary === "turret");
    if (turretier) {
      const rate = (turretier.mods?.energyPerBlock ?? 0.1).toFixed(1);
      statsHtml += `<div style="color: #38d6ff"><b>TURRET</b> ${turretier.secondaryEnergy.toFixed(1)}/${st.turretEnergyRequired} (+${rate}/b)</div>`;
    }
    this.statsEl.innerHTML = statsHtml;

    // Ability buttons at the bottom of the screen
    const equipped = game.soldiers.filter((x) => x.alive && x.secondary);
    if (equipped.length === 0 || game.runOver) {
      this.abilityBar.classList.add("hidden");
    } else {
      this.abilityBar.classList.remove("hidden");
      const currentIds = new Set(equipped.map((x) => x.id));

      for (const [id, btn] of this.abilityBtns) {
        if (!currentIds.has(id)) {
          btn.remove();
          this.abilityBtns.delete(id);
        }
      }

      for (const soldier of equipped) {
        const req = game.getSecondaryEnergyRequired(soldier.secondary);
        let btn = this.abilityBtns.get(soldier.id);
        if (!btn) {
          btn = document.createElement("button");
          btn.className = "hud-ability-btn";
          btn.dataset.soldierId = String(soldier.id);
          btn.innerHTML = `
            <svg class="ability-outline-svg" viewBox="0 0 48 48">
              <path class="ability-outline-bg" d="M 24 1 L 39 1 L 47 9 L 47 39 L 39 47 L 9 47 L 1 39 L 1 9 L 9 1 Z" />
              <path class="ability-outline-fg" d="M 24 1 L 39 1 L 47 9 L 47 39 L 39 47 L 9 47 L 1 39 L 1 9 L 9 1 Z" />
            </svg>
            <div class="ability-icon-wrap">${sprite(soldier.secondary!, { color: UI_COLORS.crystal, scale: 2 })}</div>
            <div class="ability-badge">S${soldier.slotIndex + 1}</div>
            <div class="ability-val"></div>
          `;
          btn.addEventListener("click", () => {
            game.activateSecondary(soldier);
            this.update(game, performance.now(), true);
          });
          this.abilityBar.append(btn);
          this.abilityBtns.set(soldier.id, btn);
        }

        const pct = Math.max(0, Math.min(1, soldier.secondaryEnergy / req));
        const isReady = pct >= 1;
        btn.classList.toggle("ready", isReady);
        btn.classList.toggle("not-ready", !isReady);
        btn.title = isReady
          ? `Secondary Ready: Tap to activate (Hotkey: G)`
          : `Secondary Charging: ${soldier.secondaryEnergy.toFixed(1)} / ${req} Energy`;

        const fgPath = btn.querySelector(".ability-outline-fg") as SVGPathElement | null;
        if (fgPath) {
          const perimeter = 165.25;
          fgPath.style.strokeDasharray = `${perimeter}`;
          fgPath.style.strokeDashoffset = `${perimeter * (1 - pct)}`;
        }
        const valEl = btn.querySelector(".ability-val") as HTMLElement | null;
        if (valEl) {
          valEl.textContent = isReady ? "READY" : `${Math.floor(soldier.secondaryEnergy)}/${req}`;
        }
      }
    }

    if (this.helpOpen) {
      let status = "";
      if (game.paused && !game.runOver) status = "PAUSED — Press Space or Esc to resume";
      else if (!game.autoMove) {
        const cmdr = game.getCommander();
        status = cmdr
          ? `MANUAL COMMANDER #${cmdr.slotIndex + 1} ACTIVE — WASD to move, aim & click to shoot`
          : "MANUAL CONTROL — All soldiers defeated";
      } else if (game.reserves > 0 && game.canDeploy)
        status = `Click / tap to place (random dir) or drag to aim (${game.reserves} in reserve)`;
      else if (game.reserves > 0) status = "Cannot deploy";
      else status = "Soldiers autonomous";
      this.helpStatusEl.textContent = status;
    }
  }
}
