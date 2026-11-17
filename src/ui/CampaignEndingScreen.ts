import { essenceIcon } from "./essenceIcon";
import type { Game } from "../Game";

/** Placeholder campaign ending copy — edit here for final wording. */
export const CAMPAIGN_ENDING_TEXT = {
  title: "MOTHERSHIP DESTROYED",
  subtitle: "THE LEVIATHAN CORE HAS COLLAPSED",
  note: "The Blight threat has been broken. You may continue exploring any sector.",
  cta: "RETURN TO SECTOR MAP",
} as const;

function fmtTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = (t % 60).toFixed(1).padStart(4, "0");
  return `${m}:${s}`;
}

export class CampaignEndingScreen {
  readonly root: HTMLDivElement;
  private body: HTMLDivElement;

  constructor(parent: HTMLElement, private game: Game) {
    this.root = document.createElement("div");
    this.root.className = "overlay results-overlay hidden";
    this.root.innerHTML = `
      <div class="panel results-panel">
        <div class="panel-title">${CAMPAIGN_ENDING_TEXT.title}</div>
        <div class="panel-sub">${CAMPAIGN_ENDING_TEXT.subtitle}</div>
        <div class="results-body"></div>
        <div class="panel-actions">
          <button class="btn btn-primary" data-act="sector-map">${CAMPAIGN_ENDING_TEXT.cta}</button>
        </div>
      </div>
    `;
    this.body = this.root.querySelector(".results-body") as HTMLDivElement;
    this.root.querySelector('[data-act="sector-map"]')!.addEventListener("click", () => {
      this.hide();
      this.game.labMap.show();
    });
    parent.append(this.root);
  }

  get visible(): boolean {
    return !this.root.classList.contains("hidden");
  }

  show(stats: { time: number; soldiersLost: number; essence: number }): void {
    this.body.innerHTML = `
      <div class="stat-grid">
        <div class="stat"><span class="stat-label">RUN TIME</span><span class="stat-val">${fmtTime(stats.time)}</span></div>
        <div class="stat"><span class="stat-label">SOLDIERS LOST</span><span class="stat-val">${stats.soldiersLost}</span></div>
        <div class="stat"><span class="stat-label">ESSENCE EARNED</span><span class="stat-val val-essence">${essenceIcon()} ${stats.essence.toLocaleString()}</span></div>
      </div>
      <div class="results-best">${CAMPAIGN_ENDING_TEXT.note}</div>
    `;
    this.root.classList.remove("hidden");
  }

  hide(): void {
    this.root.classList.add("hidden");
  }
}
