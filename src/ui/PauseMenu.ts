import type { Game } from "../Game";
import { MUZZLE_FLASH_LEVELS, type MuzzleFlashLevel } from "../progression/SaveManager";
import type { LightQuality } from "../systems/LightingSystem";
import { sprite, UI_COLORS } from "./pixelArt";

type SettingsTab = "gameplay" | "sound" | "visuals";

const FLASH_LABELS: Record<MuzzleFlashLevel, string> = {
  brightest: "BRIGHTEST",
  brighter: "BRIGHTER",
  bright: "BRIGHT",
  dim: "DIM",
  dimmer: "DIMMER",
  off: "OFF",
};

export class PauseMenu {
  readonly root: HTMLDivElement;
  private pausePanel: HTMLDivElement;
  private settingsModal: HTMLDivElement;
  private cogBtn: HTMLButtonElement;
  private activeTab: SettingsTab = "visuals";

  constructor(parent: HTMLElement, private game: Game) {
    this.root = document.createElement("div");
    this.root.className = "overlay pause-overlay hidden";
    this.root.innerHTML = `
      <div class="panel pause-panel">
        <div class="panel-title">PAUSED</div>
        <div class="panel-sub">SIMULATION SUSPENDED</div>
        <div class="panel-actions vertical">
          <button class="btn btn-primary" data-act="resume">RESUME <span class="kbd">ESC</span></button>
          <button class="btn" data-act="restart">RESTART RUN <span class="kbd">R</span></button>
          <button class="btn btn-accent" data-act="upgrades">UPGRADE TREE <span class="kbd">U</span></button>
          <button class="btn" data-act="main">MAIN MENU</button>
        </div>
      </div>

      <button class="pause-cog-btn" title="Settings">${sprite("gear", { color: UI_COLORS.soldier })}</button>

      <div class="panel settings-panel hidden">
        <div class="panel-title">SETTINGS</div>
        <div class="settings-tabs">
          <button class="settings-tab" data-tab="gameplay">GAMEPLAY</button>
          <button class="settings-tab" data-tab="sound">SOUND</button>
          <button class="settings-tab" data-tab="visuals">VISUALS</button>
        </div>
        <div class="settings-body"></div>
        <div class="panel-actions">
          <button class="btn btn-primary" data-act="close-settings">BACK TO PAUSE</button>
        </div>
      </div>
    `;

    this.pausePanel = this.root.querySelector(".pause-panel") as HTMLDivElement;
    this.settingsModal = this.root.querySelector(".settings-panel") as HTMLDivElement;
    this.cogBtn = this.root.querySelector(".pause-cog-btn") as HTMLButtonElement;

    this.root.querySelector('[data-act="resume"]')!.addEventListener("click", () => game.togglePauseMenu(false));
    this.root.querySelector('[data-act="restart"]')!.addEventListener("click", () => {
      game.togglePauseMenu(false);
      game.restartAndBank();
    });
    this.root.querySelector('[data-act="upgrades"]')!.addEventListener("click", () => {
      game.togglePauseMenu(false);
      game.bankCurrentRun();
      game.openUpgrades();
    });
    this.root.querySelector('[data-act="main"]')!.addEventListener("click", () => {
      game.openMainMenu();
    });

    this.cogBtn.addEventListener("click", () => {
      const opening = this.settingsModal.classList.contains("hidden");
      this.toggleSettings(opening);
    });

    this.root.querySelector('[data-act="close-settings"]')!.addEventListener("click", () => {
      this.toggleSettings(false);
    });

    this.root.querySelectorAll(".settings-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tab = (btn as HTMLElement).dataset.tab as SettingsTab;
        this.activeTab = tab;
        this.renderSettingsTab();
      });
    });

    parent.append(this.root);
  }

  private toggleSettings(open: boolean): void {
    this.pausePanel.classList.toggle("hidden", open);
    this.settingsModal.classList.toggle("hidden", !open);
    this.cogBtn.classList.toggle("active", open);
    if (open) this.renderSettingsTab();
  }

  private renderSettingsTab(): void {
    this.root.querySelectorAll(".settings-tab").forEach((btn) => {
      const t = (btn as HTMLElement).dataset.tab;
      btn.classList.toggle("active", t === this.activeTab);
    });

    const body = this.settingsModal.querySelector(".settings-body") as HTMLDivElement;
    const set = this.game.save.data.settings;

    if (this.activeTab === "gameplay") {
      body.innerHTML = `
        <div class="set-row">
          <div class="set-info">
            <div class="set-label">CAMERA AUTO-FOLLOW</div>
            <div class="set-desc">Off by default so you pan manually; press F anytime to follow farthest soldier</div>
          </div>
          <button class="btn set-toggle ${set.autoFollowCamera ? "btn-primary" : ""}" data-set="autofollow">
            ${set.autoFollowCamera ? "ON" : "OFF"}
          </button>
        </div>
        <div class="set-row">
          <div class="set-info">
            <div class="set-label">RECENTER CAMERA</div>
            <div class="set-desc">Snap camera back to the starting excavation room</div>
          </div>
          <button class="btn" data-set="recenter">CENTER</button>
        </div>
      `;
      body.querySelector('[data-set="autofollow"]')!.addEventListener("click", () => {
        set.autoFollowCamera = !set.autoFollowCamera;
        this.game.camera.defaultFollow = set.autoFollowCamera;
        this.game.camera.following = set.autoFollowCamera;
        this.game.save.save();
        this.renderSettingsTab();
      });
      body.querySelector('[data-set="recenter"]')!.addEventListener("click", () => {
        this.game.camera.x = this.game.world.roomCenterX;
        this.game.camera.y = this.game.world.roomCenterY;
        this.game.camera.following = false;
      });
    } else if (this.activeTab === "sound") {
      const volPct = Math.round(set.volume * 100);
      body.innerHTML = `
        <div class="set-row">
          <div class="set-info">
            <div class="set-label">MUTE AUDIO</div>
            <div class="set-desc">Silence all synthesized sound effects</div>
          </div>
          <button class="btn set-toggle ${set.muted ? "btn-accent" : "btn-primary"}" data-set="mute">
            ${set.muted ? "MUTED" : "ACTIVE"}
          </button>
        </div>
        <div class="set-row">
          <div class="set-info">
            <div class="set-label">MASTER VOLUME: <span class="vol-val">${volPct}%</span></div>
            <div class="set-desc">Adjust sound effect loudness</div>
          </div>
          <input type="range" class="set-slider" min="0" max="100" step="5" value="${volPct}" />
        </div>
      `;
      body.querySelector('[data-set="mute"]')!.addEventListener("click", () => {
        this.game.audio.toggleMute();
        this.renderSettingsTab();
      });
      const slider = body.querySelector(".set-slider") as HTMLInputElement;
      const volLabel = body.querySelector(".vol-val") as HTMLSpanElement;
      slider.addEventListener("input", () => {
        const v = Number(slider.value) / 100;
        set.volume = v;
        volLabel.textContent = `${Math.round(v * 100)}%`;
        this.game.save.save();
      });
      slider.addEventListener("change", () => {
        this.game.audio.playPickup();
      });
    } else {
      // Visuals tab
      const curFlash = set.muzzleFlash;
      const curQual = this.game.lighting.quality;
      const flashBtns = MUZZLE_FLASH_LEVELS.map(
        (lvl) =>
          `<button class="btn set-chip ${curFlash === lvl ? "btn-primary" : ""}" data-flash="${lvl}">${FLASH_LABELS[lvl]}</button>`,
      ).join("");
      const qualBtns = (["high", "medium", "low"] as LightQuality[])
        .map(
          (q) =>
            `<button class="btn set-chip ${curQual === q ? "btn-primary" : ""}" data-qual="${q}">${q.toUpperCase()}</button>`,
        )
        .join("");

      body.innerHTML = `
        <div class="set-group">
          <div class="set-label">MUZZLE FLASH BRIGHTNESS</div>
          <div class="set-desc">Tune dynamic muzzle flash illumination and flare intensity</div>
          <div class="set-chips">${flashBtns}</div>
        </div>
        <div class="set-group">
          <div class="set-label">SHADOW RAY QUALITY</div>
          <div class="set-desc">Ray-traced visibility polygon resolution</div>
          <div class="set-chips">${qualBtns}</div>
        </div>
      `;

      body.querySelectorAll("[data-flash]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const lvl = (btn as HTMLElement).dataset.flash as MuzzleFlashLevel;
          set.muzzleFlash = lvl;
          this.game.save.save();
          this.renderSettingsTab();
        });
      });

      body.querySelectorAll("[data-qual]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const q = (btn as HTMLElement).dataset.qual as LightQuality;
          this.game.lighting.quality = q;
          this.renderSettingsTab();
        });
      });
    }
  }

  show(): void {
    this.toggleSettings(false);
    this.root.classList.remove("hidden");
  }

  hide(): void {
    this.toggleSettings(false);
    this.root.classList.add("hidden");
  }

  get visible(): boolean {
    return !this.root.classList.contains("hidden");
  }
}
