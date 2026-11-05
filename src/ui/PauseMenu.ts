import type { Game } from "../Game";

export class PauseMenu {
  readonly root: HTMLDivElement;

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
    `;
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
    parent.append(this.root);
  }

  show(): void {
    this.root.classList.remove("hidden");
  }

  hide(): void {
    this.root.classList.add("hidden");
  }

  get visible(): boolean {
    return !this.root.classList.contains("hidden");
  }
}
