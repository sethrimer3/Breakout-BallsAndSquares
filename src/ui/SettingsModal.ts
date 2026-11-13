import { formatSpeedrunTime } from "../core/SpeedrunTimer";
import type { Game } from "../Game";
import { MUZZLE_FLASH_LEVELS, SAVE_SLOTS_COUNT, type MuzzleFlashLevel } from "../progression/SaveManager";
import type { LightQuality } from "../systems/LightingSystem";

export type SettingsTab = "gameplay" | "sound" | "visuals" | "dev";

const FLASH_LABELS: Record<MuzzleFlashLevel, string> = {
  brightest: "BRIGHTEST",
  brighter: "BRIGHTER",
  bright: "BRIGHT",
  dim: "DIM",
  dimmer: "DIMMER",
  off: "OFF",
};

export interface SettingsModalOptions {
  onClose?: () => void;
  backLabel?: string;
  showRecenter?: boolean;
  showProfileSettings?: boolean;
}

export class SettingsModal {
  readonly root: HTMLDivElement;
  private activeTab: SettingsTab = "visuals";
  private onCloseCallback: (() => void) | null = null;
  private backBtn: HTMLButtonElement;
  private bodyEl: HTMLDivElement;
  private showRecenter = true;
  private showProfileSettings = false;

  constructor(parent: HTMLElement, private game: Game) {
    this.root = document.createElement("div");
    this.root.className = "panel settings-panel hidden";
    this.root.innerHTML = `
      <div class="panel-title">SETTINGS</div>
      <div class="settings-tabs">
        <button class="settings-tab" data-tab="gameplay">GAMEPLAY</button>
        <button class="settings-tab" data-tab="sound">SOUND</button>
        <button class="settings-tab" data-tab="visuals">VISUALS</button>
        <button class="settings-tab" data-tab="dev">DEV</button>
      </div>
      <div class="settings-body"></div>
      <div class="panel-actions">
        <button class="btn btn-primary" data-act="close-settings">BACK</button>
      </div>
    `;

    this.bodyEl = this.root.querySelector(".settings-body") as HTMLDivElement;
    this.backBtn = this.root.querySelector('[data-act="close-settings"]') as HTMLButtonElement;

    this.backBtn.addEventListener("click", () => {
      this.hide();
      this.onCloseCallback?.();
    });

    this.root.querySelectorAll(".settings-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tab = (btn as HTMLElement).dataset.tab as SettingsTab;
        this.activeTab = tab;
        this.render();
      });
    });

    parent.append(this.root);
  }

  show(opts?: SettingsModalOptions): void {
    this.onCloseCallback = opts?.onClose ?? null;
    this.showRecenter = opts?.showRecenter ?? true;
    this.showProfileSettings = opts?.showProfileSettings ?? false;
    if (this.showProfileSettings) this.activeTab = "gameplay";
    this.backBtn.textContent = opts?.backLabel ?? "BACK";
    this.root.classList.remove("hidden");
    this.render();
  }

  hide(): void {
    this.root.classList.add("hidden");
  }

  get visible(): boolean {
    return !this.root.classList.contains("hidden");
  }

  private render(): void {
    this.root.querySelectorAll(".settings-tab").forEach((btn) => {
      const t = (btn as HTMLElement).dataset.tab;
      btn.classList.toggle("active", t === this.activeTab);
    });

    const body = this.bodyEl;
    const set = this.game.save.data.settings;

    if (this.activeTab === "gameplay") {
      body.innerHTML = `
        ${this.showProfileSettings ? `
        <div class="set-row"><label class="set-label" for="menu-settings-profile">PROFILE SETTINGS</label>
          <select id="menu-settings-profile" class="set-profile-select" aria-label="Profile to configure">${Array.from({length:SAVE_SLOTS_COUNT},(_,i)=>`<option value="${i+1}" ${i+1===this.game.save.activeSlot?"selected":""}>Profile ${String(i+1).padStart(2,"0")}${this.game.save.slotExists(i+1)?"":" · New"}</option>`).join("")}</select></div>
        <div class="set-group profile-settings">
          <div class="set-label">NEW SAVE SEED</div>
          <div class="set-desc">Use 1–8 letters or numbers for any new save. Leave blank for a random seed. Existing saves keep their seed.</div>
          <div class="seed-controls">
            <input class="set-seed-input" aria-label="Seed for new saves" maxlength="8" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="RANDOM" />
            <button class="btn" data-set="apply-seed">APPLY</button>
          </div>
          <div class="set-desc current-seed">SLOT ${this.game.save.activeSlot} SEED: ${this.game.save.data.seed}</div>
          <div class="set-desc seed-status" role="status" aria-live="polite"></div>
        </div>
        <div class="set-row">
          <div class="set-info"><div class="set-label">SPEEDRUN TIMER — SLOT ${this.game.save.activeSlot}</div>
          <div class="set-desc">Total active run time for this save. Pauses in menus, upgrades, map, results and hidden tabs. Turning off keeps the recorded time.</div>
          <div class="set-desc">${formatSpeedrunTime(this.game.save.data.speedrun.elapsedMs)}</div></div>
          <button class="btn set-toggle ${this.game.save.data.speedrun.enabled ? "btn-primary" : ""}" data-set="speedrun" aria-pressed="${this.game.save.data.speedrun.enabled}">${this.game.save.data.speedrun.enabled ? "ON" : "OFF"}</button>
        </div>` : ""}
        <div class="set-row">
          <div class="set-info">
            <div class="set-label">CAMERA AUTO-FOLLOW</div>
            <div class="set-desc">Off by default so you pan manually; press F anytime to follow soldier #1, Tab to cycle</div>
          </div>
          <button class="btn set-toggle ${set.autoFollowCamera ? "btn-primary" : ""}" data-set="autofollow">
            ${set.autoFollowCamera ? "ON" : "OFF"}
          </button>
        </div>
        <div class="set-row">
          <div class="set-info">
            <div class="set-label">ALWAYS SHOOT (AUTO MOVE OFF)</div>
            <div class="set-desc">Automatically shoot toward pointer/crosshair when manual control is active</div>
          </div>
          <button class="btn set-toggle ${set.alwaysShootWhenAutoMoveOff ? "btn-primary" : ""}" data-set="alwaysshoot">
            ${set.alwaysShootWhenAutoMoveOff ? "ON" : "OFF"}
          </button>
        </div>
        ${
          this.showRecenter
            ? `
        <div class="set-row">
          <div class="set-info">
            <div class="set-label">RECENTER CAMERA</div>
            <div class="set-desc">Snap camera back to the starting excavation room</div>
          </div>
          <button class="btn" data-set="recenter">CENTER</button>
        </div>`
            : ""
        }
      `;

      if (this.showProfileSettings) {
        body.querySelector<HTMLSelectElement>(".set-profile-select")!.addEventListener("change", e => {
          this.game.selectSaveSlot(Number((e.target as HTMLSelectElement).value));
          this.render();
          this.bodyEl.querySelector<HTMLSelectElement>(".set-profile-select")!.focus();
        });
        const input = body.querySelector<HTMLInputElement>(".set-seed-input")!;
        input.value = this.game.save.newProfileSeed;
        const applySeed = () => {
          const ok = this.game.save.setNewProfileSeed(input.value);
          body.querySelector(".seed-status")!.textContent = ok
            ? (this.game.save.newProfileSeed ? `New saves will use ${this.game.save.newProfileSeed}.` : "New saves will receive random seeds.")
            : "Use 1–8 letters or numbers. The seed could not be saved.";
          if (ok) input.value = this.game.save.newProfileSeed;
          body.querySelector(".current-seed")!.textContent = `SLOT ${this.game.save.activeSlot} SEED: ${this.game.save.data.seed}`;
        };
        body.querySelector('[data-set="apply-seed"]')!.addEventListener("click", applySeed);
        input.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); applySeed(); } });
        body.querySelector('[data-set="speedrun"]')!.addEventListener("click", () => {
          this.game.setSpeedrunEnabled(!this.game.save.data.speedrun.enabled);
          this.render();
        });
      }

      body.querySelector('[data-set="autofollow"]')!.addEventListener("click", () => {
        set.autoFollowCamera = !set.autoFollowCamera;
        this.game.camera.defaultFollow = set.autoFollowCamera;
        this.game.camera.following = set.autoFollowCamera;
        this.game.save.save();
        this.render();
      });

      body.querySelector('[data-set="alwaysshoot"]')!.addEventListener("click", () => {
        set.alwaysShootWhenAutoMoveOff = !set.alwaysShootWhenAutoMoveOff;
        this.game.save.save();
        this.render();
      });

      if (this.showRecenter) {
        body.querySelector('[data-set="recenter"]')?.addEventListener("click", () => {
          this.game.camera.x = this.game.world.roomCenterX;
          this.game.camera.y = this.game.world.roomCenterY;
          this.game.camera.following = false;
        });
      }
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
        this.render();
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
    } else if (this.activeTab === "dev") {
      body.innerHTML = `
        <div class="set-row"><div class="set-info"><div class="set-label">DEV MODE</div>
          <div class="set-desc">Enable telemetry and backtick debug controls.</div></div>
          <button class="btn" data-set="devmode">${set.devMode ? "ON" : "OFF"}</button></div>
        <div class="set-row"><div class="set-info"><div class="set-label">FULL MAP &amp; FREE DEPLOYMENT</div>
          <div class="set-desc">Reveal all worlds and sectors, hide fog, and allow deployment in unconquered sectors. Requires Dev mode.</div></div>
          <button class="btn" data-set="dev-map" ${set.devMode ? "" : "disabled"}>${set.devMapAccess ? "ON" : "OFF"}</button></div>
        <div class="set-row"><div class="set-info"><div class="set-label">TEST CURRENCY</div>
          <div class="set-desc">Add 1,000 gold, orange crystals, green crystals and essence to this slot.</div></div>
          <button class="btn" data-set="funds" ${set.devMode ? "" : "disabled"}>+1,000</button></div>
        <div class="set-row"><div class="set-info"><div class="set-label">DELETE ALL GAME DATA</div>
          <div class="set-desc">Permanently delete all three saves, upgrades, progress and settings, then reload at A1. Cannot be undone.</div></div>
          <button class="btn btn-danger" data-set="reset-all">DELETE &amp; RESTART</button></div>
        <div class="set-desc" role="status"></div>`;
      body.querySelector('[data-set="devmode"]')!.addEventListener("click", () => {
        set.devMode = !set.devMode;
        this.game.debug = set.devMode;
        if (!set.devMode) { this.game.timeScale = 1; this.game.showChunkBorders = false; }
        this.game.save.save(); this.render();
      });
      body.querySelector('[data-set="dev-map"]')!.addEventListener("click", () => {
        if (!set.devMode) return;
        set.devMapAccess = !set.devMapAccess;
        this.game.save.save(); this.render();
      });
      body.querySelector('[data-set="funds"]')!.addEventListener("click", () => {
        if (!set.devMode) return;
        for (const key of ["bank", "crystals", "greenCrystals", "essence", "biomass"] as const) this.game.save.data[key] += 1000;
        this.game.save.save();
        body.querySelector('[role="status"]')!.textContent = "Test currency added to this save slot.";
      });
      body.querySelector('[data-set="reset-all"]')!.addEventListener("click", () => {
        if (!window.confirm("Delete ALL BREACH data? All 3 save slots, upgrades, progress and settings will be permanently erased. This cannot be undone.")) return;
        try { this.game.save.deleteAllData(); window.location.reload(); }
        catch { body.querySelector('[role="status"]')!.textContent = "Could not delete saved data. Check browser storage access and try again."; }
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

      const fiery = set.fieryMuzzleFlash;
      const softSh = set.softShadows;
      body.innerHTML = `
        <div class="set-row"><div class="set-info"><div class="set-label">PRISM PATTERNS</div><div class="set-desc">Distinct beam dash lengths supplement color and thickness.</div></div>
          <button class="btn" data-set="prism-patterns">${set.prismPatterns ? "ON" : "OFF"}</button></div>
        <div class="set-row">
          <div class="set-info">
            <div class="set-label">FIERY MUZZLE FLASH</div>
            <div class="set-desc">Soft orange flames with blurred, glowing edges</div>
          </div>
          <button class="btn set-toggle set-check ${fiery ? "btn-primary is-checked" : ""}" data-set="fiery"
            role="checkbox" aria-checked="${fiery}">
            <span class="px-check" aria-hidden="true"></span>${fiery ? "ON" : "OFF"}
          </button>
        </div>
        <div class="set-row">
          <div class="set-info">
            <div class="set-label">SOFT SHADOWS</div>
            <div class="set-desc">Blur shadow edges in the light instead of crisp lines</div>
          </div>
          <button class="btn set-toggle set-check ${softSh ? "btn-primary is-checked" : ""}" data-set="softshadows"
            role="checkbox" aria-checked="${softSh}">
            <span class="px-check" aria-hidden="true"></span>${softSh ? "ON" : "OFF"}
          </button>
        </div>
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

      body.querySelector('[data-set="prism-patterns"]')!.addEventListener("click", () => {
        set.prismPatterns = !set.prismPatterns; this.game.save.save(); this.render();
      });
      body.querySelector('[data-set="fiery"]')!.addEventListener("click", () => {
        set.fieryMuzzleFlash = !set.fieryMuzzleFlash;
        this.game.save.save();
        this.render();
      });

      body.querySelector('[data-set="softshadows"]')!.addEventListener("click", () => {
        set.softShadows = !set.softShadows;
        this.game.save.save();
        this.render();
      });

      body.querySelectorAll("[data-flash]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const lvl = (btn as HTMLElement).dataset.flash as MuzzleFlashLevel;
          set.muzzleFlash = lvl;
          this.game.save.save();
          this.render();
        });
      });

      body.querySelectorAll("[data-qual]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const q = (btn as HTMLElement).dataset.qual as LightQuality;
          this.game.lighting.quality = q;
          this.render();
        });
      });
    }
  }
}
