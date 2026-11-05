import type { Game } from "../Game";
import { sprite, UI_COLORS } from "./pixelArt";

export class MainMenu {
  readonly root: HTMLDivElement;
  private bankEl: HTMLSpanElement;
  private lifeEl: HTMLSpanElement;

  constructor(parent: HTMLElement, private game: Game) {
    this.root = document.createElement("div");
    this.root.className = "overlay main-overlay hidden";
    this.root.innerHTML = `
      <div class="panel main-panel">
        <div class="brand-title">BREACH</div>
        <div class="brand-sub">AUTONOMOUS BALLISTIC EXCAVATION // INCREMENTAL ROGUELITE</div>
        <div class="main-summary">
          <div>BANK ${sprite("gold", { color: UI_COLORS.gold })} <b class="m-bank">0</b></div>
          <div>LIFETIME ${sprite("pixelBits", { color: UI_COLORS.soldier })} <b class="m-life">0</b></div>
        </div>
        <div class="panel-actions vertical">
          <button class="btn btn-primary" data-act="play">DEPLOY INTO BREACH <span class="kbd">SPACE</span></button>
          <button class="btn btn-accent" data-act="upgrades">UPGRADE TREE <span class="kbd">U</span></button>
        </div>
      </div>
    `;
    this.bankEl = this.root.querySelector(".m-bank") as HTMLSpanElement;
    this.lifeEl = this.root.querySelector(".m-life") as HTMLSpanElement;

    this.root.querySelector('[data-act="play"]')!.addEventListener("click", () => {
      this.hide();
      this.game.startRun();
    });
    this.root.querySelector('[data-act="upgrades"]')!.addEventListener("click", () => {
      this.hide();
      this.game.openUpgrades();
    });
    parent.append(this.root);
  }

  show(): void {
    this.bankEl.textContent = this.game.bank.toLocaleString();
    this.lifeEl.textContent = this.game.lifetimePixels.toLocaleString();
    this.root.classList.remove("hidden");
  }

  hide(): void {
    this.root.classList.add("hidden");
  }

  get visible(): boolean {
    return !this.root.classList.contains("hidden");
  }
}
