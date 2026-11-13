import { formatSpeedrunTime } from "../core/SpeedrunTimer";
import { essenceIcon } from "./essenceIcon";
import type { Game } from "../Game";
import { SAVE_SLOTS_COUNT } from "../progression/SaveManager";
import { MainMenuBackground } from "./MainMenuBackground";
import { sprite, UI_COLORS } from "./pixelArt";
import { SettingsModal } from "./SettingsModal";

function formatLastSaved(timestamp?: number): string {
  if (!timestamp) return "Never";
  const now = Date.now();
  const diffSec = Math.floor((now - timestamp) / 1000);
  if (diffSec < 60) return "Just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  const d = new Date(timestamp);
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear().toString().slice(-2)}`;
}

export class MainMenu {
  readonly root: HTMLDivElement;
  private background: MainMenuBackground;
  private settingsModal: SettingsModal;
  private mainPanel: HTMLDivElement;
  private slotsContainer: HTMLDivElement;
  private bankEl: HTMLSpanElement;
  private lifeEl: HTMLSpanElement;
  private crystalsEl: HTMLSpanElement;
  private pendingDeleteSlot: number | null = null;

  constructor(parent: HTMLElement, private game: Game) {
    this.root = document.createElement("div");
    this.root.className = "overlay main-overlay hidden";

    // 1. Background simulation of blight generators filling empty hallways
    this.background = new MainMenuBackground();
    this.root.append(this.background.canvas);

    // 2. Subtle dark vignette to keep retro UI high-contrast & accessible
    const vignette = document.createElement("div");
    vignette.className = "main-vignette";
    this.root.append(vignette);

    // 3. Main interactive panel
    this.mainPanel = document.createElement("div");
    this.mainPanel.className = "panel main-panel";
    this.mainPanel.innerHTML = `
      <div class="brand-title">BREACH</div>
      <div class="brand-sub">AUTONOMOUS BALLISTIC EXCAVATION // INCREMENTAL ROGUELITE</div>

      <div class="save-section-header">
        <span class="save-header-title">ARCHIVE REPOSITORIES // SELECT SAVE FILE</span>
        <span class="save-header-hint">[KEYS 1-3 TO SELECT]</span>
      </div>

      <div class="save-slots-grid"></div>

      <div class="main-summary">
        <div>ACTIVE: <b class="m-active-slot">SLOT 1</b></div>
        <div>BANK ${sprite("gold", { color: UI_COLORS.gold })} <b class="m-bank">0</b></div>
        <div>CRYSTALS ${sprite("crystal", { color: UI_COLORS.crystal })} <b class="m-crystals">0</b></div>
        <div>GREEN ${sprite("crystal", { color: UI_COLORS.greenCrystal })} <b class="m-green">0</b></div>
        <div>BIOMASS ◆ <b class="m-biomass">0</b></div>
        <div>ESSENCE ${essenceIcon()} <b class="m-essence">0</b></div>
        <div>LIFETIME ${sprite("pixelBits", { color: UI_COLORS.soldier })} <b class="m-life">0</b></div>
      </div>

      <div class="panel-actions vertical main-actions">
        <button class="btn btn-primary btn-deploy" data-act="play">
          DEPLOY INTO BREACH <span class="kbd">SPACE</span>
        </button>
        <div class="main-sub-actions">
          <button class="btn btn-accent" data-act="upgrades">UPGRADE TREE <span class="kbd">U</span></button>
          <button class="btn" data-act="settings">SETTINGS</button>
          <button class="btn btn-purge" data-act="purge" title="Trigger corridor sterilization sweep">PURGE CORRIDORS</button>
        </div>
      </div>
    `;
    this.root.append(this.mainPanel);

    this.slotsContainer = this.mainPanel.querySelector(".save-slots-grid") as HTMLDivElement;
    this.bankEl = this.mainPanel.querySelector(".m-bank") as HTMLSpanElement;
    this.lifeEl = this.mainPanel.querySelector(".m-life") as HTMLSpanElement;
    this.crystalsEl = this.mainPanel.querySelector(".m-crystals") as HTMLSpanElement;

    // 4. Integrated Settings Modal
    this.settingsModal = new SettingsModal(this.root, this.game);

    // Event listeners
    this.mainPanel.querySelector('[data-act="play"]')!.addEventListener("click", () => {
      this.deploy();
    });

    this.mainPanel.querySelector('[data-act="upgrades"]')!.addEventListener("click", () => {
      this.hide();
      this.game.openUpgrades();
    });

    this.mainPanel.querySelector('[data-act="settings"]')!.addEventListener("click", () => {
      this.openSettings();
    });

    this.mainPanel.querySelector('[data-act="purge"]')!.addEventListener("click", () => {
      this.background.purge();
    });

    parent.append(this.root);
  }

  selectSlot(slot: number): void {
    if (slot < 1 || slot > SAVE_SLOTS_COUNT) return;
    this.pendingDeleteSlot = null;
    this.game.selectSaveSlot(slot);
    this.renderSlots();
    this.updateSummary();
  }

  private deploy(): void {
    // If the active slot is empty, initialize it with defaults
    if (!this.game.save.slotExists(this.game.save.activeSlot)) {
      this.game.save.save();
    }
    this.hide();
    this.game.beginDeploy();
  }

  private openSettings(): void {
    this.mainPanel.classList.add("hidden");
    this.settingsModal.show({
      backLabel: "BACK TO MENU",
      showRecenter: false,
      showProfileSettings: true,
      onClose: () => {
        this.mainPanel.classList.remove("hidden");
        this.updateSummary();
        this.renderSlots();
      },
    });
  }

  private renderSlots(): void {
    this.slotsContainer.innerHTML = "";
    const activeSlot = this.game.save.activeSlot;

    for (let slot = 1; slot <= SAVE_SLOTS_COUNT; slot++) {
      const summary = this.game.save.getSlotSummary(slot);
      const isActive = slot === activeSlot;
      const isPendingDelete = this.pendingDeleteSlot === slot;

      const card = document.createElement("div");
      card.className = `save-slot-card ${isActive ? "active" : ""} ${!summary.exists ? "empty" : ""}`;
      card.dataset.slot = String(slot);

      let cardContent = "";

      if (!summary.exists) {
        cardContent = `
          <div class="slot-header">
            <span class="slot-title">SLOT ${slot}</span>
            <span class="slot-badge badge-empty">EMPTY</span>
          </div>
          <div class="slot-body slot-body-empty">
            <div class="empty-icon">${sprite("plus", { color: UI_COLORS.neutral })}</div>
            <div class="empty-label">NEW EXPEDITION</div>
            <div class="empty-sub">Initialize archive</div>
          </div>
          <div class="slot-footer">
            <button class="btn btn-slot-action" data-action="init">INITIALIZE</button>
          </div>
        `;
      } else {
        cardContent = `
          <div class="slot-header">
            <span class="slot-title">SLOT ${slot}</span>
            <span class="slot-badge ${isActive ? "badge-active" : "badge-ready"}">
              ${isActive ? "ACTIVE" : "READY"}
            </span>
          </div>
          <div class="slot-body">
            <div class="slot-stat-row"><span class="stat-lbl">SEED</span><span class="stat-val slot-seed">${summary.seed}</span></div>
            ${summary.speedrun.enabled || summary.speedrun.elapsedMs > 0 ? `<div class="slot-stat-row"><span class="stat-lbl">SPEEDRUN${summary.speedrun.enabled ? "" : " (OFF)"}</span><span class="stat-val slot-speedrun">${formatSpeedrunTime(summary.speedrun.elapsedMs)}</span></div>` : ""}
            <div class="slot-stat-row">
              <span class="stat-lbl">${sprite("gold", { color: UI_COLORS.gold })} BANK</span>
              <span class="stat-val val-gold">${summary.bank.toLocaleString()}</span>
            </div>
            <div class="slot-stat-row">
              <span class="stat-lbl">${sprite("pixelBits", { color: UI_COLORS.soldier })} PIXELS</span>
              <span class="stat-val">${summary.lifetimePixels.toLocaleString()}</span>
            </div>
            <div class="slot-stat-row">
              <span class="stat-lbl">${sprite("crystal", { color: UI_COLORS.crystal })} CRYSTALS</span>
              <span class="stat-val val-crystal">${summary.crystals.toLocaleString()}</span>
            </div>
            <div class="slot-stat-row">
              <span class="stat-lbl">${sprite("crystal", { color: UI_COLORS.greenCrystal })} GREEN</span>
              <span class="stat-val val-crystal">${summary.greenCrystals.toLocaleString()}</span>
            </div>
            <div class="slot-stat-row">
              <span class="stat-lbl">${essenceIcon()} ESSENCE</span>
              <span class="stat-val val-crystal">${summary.essence.toLocaleString()}</span>
            </div>
            <div class="slot-stat-row">
              <span class="stat-lbl">${sprite("depth", { color: UI_COLORS.neutral })} BEST DEPTH</span>
              <span class="stat-val">${summary.bestDepth}m</span>
            </div>
            <div class="slot-stat-row">
              <span class="stat-lbl">${sprite("gear", { color: UI_COLORS.neutral })} UPGRADES</span>
              <span class="stat-val">${summary.upgradesCount}</span>
            </div>
            <div class="slot-saved-row">
              <span class="saved-lbl">SAVED</span>
              <span class="saved-val">${formatLastSaved(summary.lastSaved)}</span>
            </div>
          </div>
          <div class="slot-footer">
            ${
              isPendingDelete
                ? `<div class="delete-confirm-box">
                    <span class="confirm-warn">CLEAR SLOT?</span>
                    <button class="btn btn-danger btn-confirm-yes" data-action="confirm-delete">YES</button>
                    <button class="btn btn-slot-action btn-confirm-no" data-action="cancel-delete">NO</button>
                  </div>`
                : `<button class="btn btn-slot-action ${isActive ? "btn-primary" : ""}" data-action="select">
                    ${isActive ? "SELECTED" : "SELECT"}
                  </button>
                  <button class="btn btn-slot-delete" data-action="delete" title="Clear save data">
                    ${sprite("close", { color: UI_COLORS.warn })}
                  </button>`
            }
          </div>
        `;
      }

      card.innerHTML = cardContent;

      // Card click selects the slot
      card.addEventListener("click", (e) => {
        const target = e.target as HTMLElement;
        const btn = target.closest("button");
        if (btn) {
          const action = btn.dataset.action;
          if (action === "delete") {
            e.stopPropagation();
            this.pendingDeleteSlot = slot;
            this.renderSlots();
            return;
          }
          if (action === "confirm-delete") {
            e.stopPropagation();
            this.game.save.deleteSlot(slot);
            this.pendingDeleteSlot = null;
            this.selectSlot(slot);
            return;
          }
          if (action === "cancel-delete") {
            e.stopPropagation();
            this.pendingDeleteSlot = null;
            this.renderSlots();
            return;
          }
          if (action === "init") {
            e.stopPropagation();
            this.game.save.reset(slot);
            this.selectSlot(slot);
            return;
          }
        }

        // Clicking card selects it
        this.selectSlot(slot);
      });

      this.slotsContainer.append(card);
    }
  }

  private updateSummary(): void {
    const activeSlotEl = this.mainPanel.querySelector(".m-active-slot") as HTMLElement;
    if (activeSlotEl) {
      activeSlotEl.textContent = `SLOT ${this.game.save.activeSlot}`;
    }
    this.bankEl.textContent = this.game.bank.toLocaleString();
    this.lifeEl.textContent = this.game.lifetimePixels.toLocaleString();
    if (this.crystalsEl) {
      this.crystalsEl.textContent = this.game.crystals.toLocaleString();
      (this.mainPanel.querySelector(".m-green") as HTMLElement).textContent = this.game.greenCrystals.toLocaleString();
      (this.mainPanel.querySelector(".m-biomass") as HTMLElement).textContent = this.game.biomass.toLocaleString();
      (this.mainPanel.querySelector(".m-essence") as HTMLElement).textContent = this.game.essence.toLocaleString();
    }
  }

  show(): void {
    this.pendingDeleteSlot = null;
    this.settingsModal.hide();
    this.mainPanel.classList.remove("hidden");
    this.renderSlots();
    this.updateSummary();
    this.background.start();
    this.root.classList.remove("hidden");
  }

  hide(): void {
    this.background.stop();
    this.settingsModal.hide();
    this.root.classList.add("hidden");
  }

  onEscape(): void {
    if (this.settingsModal.visible) {
      this.settingsModal.hide();
      this.mainPanel.classList.remove("hidden");
      this.updateSummary();
      this.renderSlots();
    }
  }

  get visible(): boolean {
    return !this.root.classList.contains("hidden");
  }
}
