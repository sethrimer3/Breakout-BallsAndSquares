import { essenceIcon } from "./essenceIcon";
import type { Game } from "../Game";
import { sprite, UI_COLORS } from "./pixelArt";

function fmtTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = (t % 60).toFixed(1).padStart(4, "0");
  return `${m}:${s}`;
}

export class ResultsScreen {
  readonly root: HTMLDivElement;
  private body: HTMLDivElement;

  constructor(parent: HTMLElement, private game: Game) {
    this.root = document.createElement("div");
    this.root.className = "overlay results-overlay hidden";
    this.root.innerHTML = `
      <div class="panel results-panel">
        <div class="panel-title">SIGNAL LOST</div>
        <div class="panel-sub">TERRAIN RECLAIMED THE EXCAVATION</div>
        <div class="results-body"></div>
        <div class="panel-actions">
          <button class="btn btn-primary" data-act="retry">TRY AGAIN <span class="kbd">R</span></button>
          <button class="btn btn-accent" data-act="upgrades">UPGRADE TREE <span class="kbd">U</span></button>
        </div>
      </div>
    `;
    this.body = this.root.querySelector(".results-body") as HTMLDivElement;
    this.root.querySelector('[data-act="retry"]')!.addEventListener("click", () => {
      this.hide();
      this.game.beginDeploy();
    });
    this.root.querySelector('[data-act="upgrades"]')!.addEventListener("click", () => {
      this.hide();
      this.game.openUpgrades();
    });
    parent.append(this.root);
  }

  show(newBests: { time: boolean; depth: boolean; pixels: boolean }): void {
    const g = this.game;
    const r = g.runStats;
    const b = g.bests;
    const row = (label: string, val: string, best?: string, isNew?: boolean) => `
      <div class="res-row">
        <span class="res-label">${label}</span>
        <span class="res-val">${val}${isNew ? ' <span class="badge-new">NEW BEST</span>' : ""}</span>
        <span class="res-best">${best ? `BEST ${best}` : ""}</span>
      </div>`;
    const goldIcon = sprite("gold", { color: UI_COLORS.gold });
    const crystalIcon = sprite("crystal", { color: UI_COLORS.crystal });
    const crystalsRow =
      r.crystals > 0 || g.crystals > 0
        ? row("ORANGE CRYSTALS", `${crystalIcon} ${r.crystals.toLocaleString()}`, `BANK ${crystalIcon} ${g.crystals.toLocaleString()}`)
        : "";
    const greenIcon = sprite("crystal", { color: UI_COLORS.greenCrystal });
    const greenRow =
      r.greenCrystals > 0 || g.greenCrystals > 0
        ? row("GREEN CRYSTALS", `${greenIcon} ${r.greenCrystals.toLocaleString()}`, `BANK ${greenIcon} ${g.greenCrystals.toLocaleString()}`)
        : "";
    const essenceRow =
      r.essence > 0 || g.essence > 0
        ? row("BLIGHT ESSENCE", `${essenceIcon()} ${r.essence.toLocaleString()}`, `BANK ${essenceIcon()} ${g.essence.toLocaleString()}`)
        : "";
    this.body.innerHTML =
      row("PIXELS DESTROYED", r.pixelsDestroyed.toLocaleString(), b.pixels.toLocaleString(), newBests.pixels) +
      row("GOLD COLLECTED", `${goldIcon} ${r.currency.toLocaleString()}`, `BANK ${goldIcon} ${g.bank.toLocaleString()}`) +
      crystalsRow +
      greenRow +
      essenceRow +
      row("TIME SURVIVED", fmtTime(r.time), fmtTime(b.time), newBests.time) +
      row("MAX DEPTH REACHED", `${r.maxDepth} cells`, `${b.depth} cells`, newBests.depth) +
      row("SOLDIERS DEPLOYED", `${r.soldiersDeployed}`, `PEAK GROWTH ${g.growth.rate.toFixed(1)}/s`) +
      row("LIFETIME PIXELS", g.lifetimePixels.toLocaleString());
    this.root.classList.remove("hidden");
  }

  hide(): void {
    this.root.classList.add("hidden");
  }

  get visible(): boolean {
    return !this.root.classList.contains("hidden");
  }
}
