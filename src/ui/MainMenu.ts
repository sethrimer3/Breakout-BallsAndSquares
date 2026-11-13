import { formatSpeedrunTime } from "../core/SpeedrunTimer";
import type { Game } from "../Game";
import { SAVE_SLOTS_COUNT } from "../progression/SaveManager";
import { MainMenuBackground } from "./MainMenuBackground";
import { sprite, UI_COLORS } from "./pixelArt";
import { SettingsModal } from "./SettingsModal";

function formatLastSaved(timestamp?: number): string {
  if (!timestamp) return "Ready for your first run";
  const elapsed = Math.max(0, Date.now() - timestamp);
  if (elapsed < 60000) return "Saved just now";
  if (elapsed < 3600000) return `Saved ${Math.floor(elapsed / 60000)}m ago`;
  if (elapsed < 86400000) return `Saved ${Math.floor(elapsed / 3600000)}h ago`;
  return `Saved ${new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

export class MainMenu {
  readonly root: HTMLDivElement;
  private background: MainMenuBackground;
  private settingsModal: SettingsModal;
  private mainPanel: HTMLDivElement;
  private slotsContainer: HTMLDivElement;
  private pendingDeleteSlot: number | null = null;

  constructor(parent: HTMLElement, private game: Game) {
    this.root = document.createElement("div");
    this.root.className = "overlay main-overlay hidden";
    this.background = new MainMenuBackground();
    this.root.append(this.background.canvas);
    const vignette = document.createElement("div");
    vignette.className = "main-vignette";
    this.root.append(vignette);

    this.mainPanel = document.createElement("div");
    this.mainPanel.className = "panel main-panel";
    this.mainPanel.innerHTML = `
      <div class="main-heading">
        <div class="main-brand"><div class="brand-title">BREACH</div>
          <div class="brand-sub">AUTONOMOUS BALLISTIC EXCAVATION</div></div>
        <button class="main-settings-btn" data-act="settings" aria-label="Settings">${sprite("gear", { color: UI_COLORS.neutral })}<span>SETTINGS</span></button>
      </div>
      <div class="save-section-header">
        <div><h1 class="save-header-title">Choose your profile</h1><p class="save-header-sub">Continue an expedition or start a new one.</p></div>
        <span class="save-header-hint">1–3 QUICK SELECT</span>
      </div>
      <div class="save-slots-grid" aria-label="Save profiles"></div>
    `;
    this.root.append(this.mainPanel);
    this.slotsContainer = this.mainPanel.querySelector(".save-slots-grid")!;
    this.settingsModal = new SettingsModal(this.root, this.game);
    this.mainPanel.querySelector('[data-act="settings"]')!.addEventListener("click", () => this.openSettings());
    parent.append(this.root);
  }

  /** Choosing a card is the only step between the main menu and the expedition. */
  selectSlot(slot: number): void {
    if (this.settingsModal.visible || this.pendingDeleteSlot !== null || slot < 1 || slot > SAVE_SLOTS_COUNT) return;
    if (!this.game.save.slotExists(slot)) this.game.save.reset(slot);
    this.game.selectSaveSlot(slot);
    this.hide();
    this.game.beginDeploy();
  }

  private openSettings(): void {
    this.pendingDeleteSlot = null;
    this.mainPanel.classList.add("hidden");
    this.settingsModal.show({
      backLabel: "BACK TO PROFILES", showRecenter: false, showProfileSettings: true,
      onClose: () => {
        this.mainPanel.classList.remove("hidden");
        this.renderSlots();
        this.mainPanel.querySelector<HTMLButtonElement>('[data-act="settings"]')!.focus();
      },
    });
    this.settingsModal.root.querySelector<HTMLButtonElement>('.settings-tab[data-tab="gameplay"]')!.focus();
  }

  private renderSlots(): void {
    this.slotsContainer.innerHTML = "";
    const activeSlot = this.game.save.activeSlot;
    for (let slot = 1; slot <= SAVE_SLOTS_COUNT; slot++) {
      const s = this.game.save.getSlotSummary(slot);
      const recent = s.exists && slot === activeSlot;
      const pending = this.pendingDeleteSlot === slot;
      const number = String(slot).padStart(2, "0");
      const card = document.createElement("article");
      card.className = `save-slot-card ${recent ? "active" : ""} ${s.exists ? "" : "empty"}`;
      card.dataset.slot = String(slot);
      card.innerHTML = `
        <button class="profile-open" type="button" data-slot="${slot}" data-action="${s.exists ? "select" : "init"}" ${slot === activeSlot ? 'data-act="play"' : ""}
          aria-label="${s.exists ? "Continue" : "Create"} Profile ${slot}" ${pending ? "disabled" : ""}>
          <span class="slot-header"><span class="slot-number">${number}</span><span class="slot-badge ${recent ? "badge-active" : s.exists ? "badge-ready" : "badge-empty"}">${recent ? "RECENT" : s.exists ? "SAVED" : "AVAILABLE"}</span></span>
          ${s.exists ? `
            <span class="profile-name">Profile ${number}</span><span class="profile-last-played">${formatLastSaved(s.lastSaved)}</span>
            <span class="slot-body profile-stats">
              <span class="profile-stat"><span class="stat-lbl">BANK</span><span class="stat-val val-gold">${s.bank.toLocaleString()}</span></span>
              <span class="profile-stat"><span class="stat-lbl">EXCAVATED</span><span class="stat-val">${s.lifetimePixels.toLocaleString()}</span></span>
              <span class="profile-stat"><span class="stat-lbl">BEST DEPTH</span><span class="stat-val">${s.bestDepth}m</span></span>
              <span class="profile-stat"><span class="stat-lbl">UPGRADES</span><span class="stat-val">${s.upgradesCount}</span></span>
            </span>
            <span class="profile-meta"><span class="slot-seed">SEED ${s.seed}</span>
              ${s.speedrun.enabled || s.speedrun.elapsedMs > 0 ? `<span class="slot-speedrun">${formatSpeedrunTime(s.speedrun.elapsedMs)}${s.speedrun.enabled ? "" : " · OFF"}</span>` : ""}</span>
            <span class="profile-cta">CONTINUE <span aria-hidden="true">→</span></span>
          ` : `
            <span class="profile-empty-symbol" aria-hidden="true">${sprite("plus", { color: UI_COLORS.neutral, scale: 2 })}</span>
            <span class="profile-name">New profile</span><span class="profile-last-played">A fresh start. Your own expedition.</span>
            <span class="profile-cta">CREATE PROFILE <span aria-hidden="true">+</span></span>
          `}
        </button>
        ${s.exists ? `<button class="profile-delete" type="button" data-action="delete" aria-label="Delete Profile ${slot}" title="Delete profile" ${pending ? "disabled" : ""}>${sprite("close", { color: UI_COLORS.neutral })}</button>` : ""}
        ${pending ? `<div class="profile-confirm" role="group" aria-label="Delete Profile ${slot}">
          <strong>Delete Profile ${number}?</strong><p>This permanently erases this profile’s progress.</p>
          <div><button class="btn" data-action="cancel-delete">KEEP PROFILE</button><button class="btn btn-danger" data-action="confirm-delete">DELETE</button></div>
        </div>` : ""}
      `;
      card.querySelector<HTMLButtonElement>(".profile-open")!.addEventListener("click", () => this.selectSlot(slot));
      card.querySelector('[data-action="delete"]')?.addEventListener("click", () => {
        this.pendingDeleteSlot = slot;
        this.renderSlots();
        this.slotsContainer.querySelector<HTMLButtonElement>(`[data-slot="${slot}"] [data-action="cancel-delete"]`)!.focus();
      });
      card.querySelector('[data-action="cancel-delete"]')?.addEventListener("click", () => {
        this.pendingDeleteSlot = null;
        this.renderSlots();
        this.slotsContainer.querySelector<HTMLButtonElement>(`[data-slot="${slot}"] .profile-delete`)!.focus();
      });
      card.querySelector('[data-action="confirm-delete"]')?.addEventListener("click", () => {
        this.game.save.deleteSlot(slot);
        if (slot === activeSlot) this.game.selectSaveSlot(slot);
        this.pendingDeleteSlot = null;
        this.renderSlots();
        this.slotsContainer.querySelector<HTMLButtonElement>(`[data-slot="${slot}"] .profile-open`)!.focus();
      });
      this.slotsContainer.append(card);
    }
  }

  show(): void {
    this.pendingDeleteSlot = null;
    this.settingsModal.hide();
    this.mainPanel.classList.remove("hidden");
    this.renderSlots();
    this.background.start();
    this.root.classList.remove("hidden");
  }

  hide(): void {
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && this.root.contains(focused)) focused.blur();
    this.background.stop();
    this.settingsModal.hide();
    this.root.classList.add("hidden");
  }

  onKey(code: string): void {
    if (this.settingsModal.visible) { if (code === "Escape") this.onEscape(); return; }
    if (this.pendingDeleteSlot !== null) {
      if (code === "Escape") { this.pendingDeleteSlot = null; this.renderSlots(); }
      return;
    }
    if (/^(Digit|Numpad)[1-3]$/.test(code)) this.selectSlot(Number(code.slice(-1)));
    else if (code === "Space" || code === "Enter") this.selectSlot(this.game.save.activeSlot);
  }

  onEscape(): void {
    if (!this.settingsModal.visible) return;
    this.settingsModal.hide();
    this.mainPanel.classList.remove("hidden");
    this.renderSlots();
    this.mainPanel.querySelector<HTMLButtonElement>('[data-act="settings"]')!.focus();
  }

  get visible(): boolean { return !this.root.classList.contains("hidden"); }
}
