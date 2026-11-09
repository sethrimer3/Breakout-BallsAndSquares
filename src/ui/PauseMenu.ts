import type { Game } from "../Game";
import { SettingsModal } from "./SettingsModal";
import { sprite, UI_COLORS } from "./pixelArt";

export class PauseMenu {
  readonly root: HTMLDivElement;
  private pausePanel: HTMLDivElement;
  private settings: SettingsModal;
  private cogBtn: HTMLButtonElement;

  constructor(parent: HTMLElement, game: Game) {
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

    `;

    this.pausePanel = this.root.querySelector(".pause-panel") as HTMLDivElement;
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
      const opening = !this.settings.visible;
      this.toggleSettings(opening);
    });

    this.settings = new SettingsModal(this.root, game);
    parent.append(this.root);
  }

  private toggleSettings(open: boolean): void {
    this.pausePanel.classList.toggle("hidden", open);
    this.cogBtn.classList.toggle("active", open);
    if (open) this.settings.show({ onClose: () => this.toggleSettings(false), backLabel: "BACK TO PAUSE" });
    else this.settings.hide();
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
