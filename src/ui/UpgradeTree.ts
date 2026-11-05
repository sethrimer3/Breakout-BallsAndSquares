import type { Game } from "../Game";
import { UPGRADE_BY_ID, UPGRADE_DEFS, type UpgradeDef, type UpgradeId } from "../progression/UpgradeDefinitions";

const CELL_STEP = 112;
const CENTER_X = 320;
const CENTER_Y = 210;

function nodePos(col: number, row: number): { x: number; y: number } {
  return { x: CENTER_X + col * CELL_STEP, y: CENTER_Y + row * CELL_STEP };
}

export class UpgradeTree {
  readonly root: HTMLDivElement;
  private svgEl: SVGSVGElement;
  private nodesWrap: HTMLDivElement;
  private tooltipEl: HTMLDivElement;
  private bankValEl: HTMLSpanElement;
  private lifeValEl: HTMLSpanElement;
  private nodeEls = new Map<UpgradeId, HTMLButtonElement>();
  private lineEls = new Map<UpgradeId, SVGLineElement>();
  private hoveredId: UpgradeId | null = null;

  constructor(parent: HTMLElement, private game: Game) {
    this.root = document.createElement("div");
    this.root.className = "overlay tree-overlay hidden";
    this.root.innerHTML = `
      <div class="tree-shell">
        <button class="tree-close" title="Close (Esc)">✕</button>
        <div class="tree-header">
          <div class="tree-title">UPGRADE MATRIX</div>
          <div class="tree-sub">PERMANENT SOLDIER ENHANCEMENTS</div>
        </div>
        <div class="tree-stage">
          <svg class="tree-svg" viewBox="0 0 640 420" preserveAspectRatio="xMidYMid meet"></svg>
          <div class="tree-nodes"></div>
          <div class="tree-tooltip hidden"></div>
        </div>
        <div class="tree-footer">
          <div class="tree-points-label">Points available</div>
          <div class="tree-points-val"><span class="diamond">◆</span> <span class="bank-num">0</span></div>
          <div class="tree-life">LIFETIME EXCAVATED: <span class="life-num">0</span> PX</div>
          <div class="tree-actions">
            <button class="btn btn-primary" data-act="deploy">DEPLOY NEW RUN <span class="kbd">SPACE</span></button>
          </div>
        </div>
      </div>
    `;

    this.svgEl = this.root.querySelector(".tree-svg") as SVGSVGElement;
    this.nodesWrap = this.root.querySelector(".tree-nodes") as HTMLDivElement;
    this.tooltipEl = this.root.querySelector(".tree-tooltip") as HTMLDivElement;
    this.bankValEl = this.root.querySelector(".bank-num") as HTMLSpanElement;
    this.lifeValEl = this.root.querySelector(".life-num") as HTMLSpanElement;

    this.root.querySelector(".tree-close")!.addEventListener("click", () => this.closeAndDeploy());
    this.root.querySelector('[data-act="deploy"]')!.addEventListener("click", () => this.closeAndDeploy());

    this.buildStage();
    parent.append(this.root);
  }

  private buildStage(): void {
    // Central core hub node (represents the soldier ball).
    const core = document.createElement("div");
    core.className = "tree-core";
    core.style.left = `${CENTER_X}px`;
    core.style.top = `${CENTER_Y}px`;
    core.innerHTML = `<div class="tree-core-ball"></div>`;
    this.nodesWrap.append(core);

    // Connector lines + upgrade nodes.
    for (const def of UPGRADE_DEFS) {
      const to = nodePos(def.grid.col, def.grid.row);
      const from = def.parent
        ? nodePos(UPGRADE_BY_ID[def.parent].grid.col, UPGRADE_BY_ID[def.parent].grid.row)
        : { x: CENTER_X, y: CENTER_Y };

      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", `${from.x}`);
      line.setAttribute("y1", `${from.y}`);
      line.setAttribute("x2", `${to.x}`);
      line.setAttribute("y2", `${to.y}`);
      line.setAttribute("class", "tree-line");
      this.svgEl.append(line);
      this.lineEls.set(def.id, line);

      const btn = document.createElement("button");
      btn.className = "tree-node";
      btn.style.left = `${to.x}px`;
      btn.style.top = `${to.y}px`;
      btn.style.setProperty("--node-color", def.color);
      btn.innerHTML = `
        <svg class="node-icon" viewBox="0 0 24 24">${def.iconSvg}</svg>
        <span class="node-lvl"></span>
      `;
      btn.addEventListener("mouseenter", () => this.showTooltip(def));
      btn.addEventListener("mouseleave", () => this.hideTooltip());
      btn.addEventListener("click", () => this.onNodeClick(def));
      this.nodesWrap.append(btn);
      this.nodeEls.set(def.id, btn);
    }
  }

  private onNodeClick(def: UpgradeDef): void {
    if (this.game.upgrades.buy(def.id)) {
      this.game.applyUpgrades();
      this.game.onUpgradePurchased?.();
      const el = this.nodeEls.get(def.id);
      if (el) {
        el.classList.remove("bought-flash");
        void el.offsetWidth;
        el.classList.add("bought-flash");
      }
      this.refresh();
      if (this.hoveredId === def.id) this.showTooltip(def);
    }
  }

  private showTooltip(def: UpgradeDef): void {
    this.hoveredId = def.id;
    const u = this.game.upgrades;
    const lvl = u.levelOf(def.id);
    const unlocked = u.isUnlocked(def.id);
    const maxed = u.isMaxed(def.id);
    const cost = u.costOf(def.id);
    const canBuy = u.canBuy(def.id);
    const curVal = def.formatValue(def.valueAt(lvl));
    const nextVal = def.formatValue(def.valueAt(Math.min(def.maxLevel, lvl + 1)));

    let bodyHtml: string;
    if (!unlocked) {
      const rem = Math.max(0, def.unlockLifetimePixels - this.game.lifetimePixels);
      bodyHtml = `
        <div class="tt-desc">${def.shortDesc}</div>
        <div class="tt-lock">LOCKED — Destroy ${def.unlockLifetimePixels} lifetime pixels (${rem} more)</div>
      `;
    } else if (maxed) {
      bodyHtml = `
        <div class="tt-compare">${curVal} <span class="tt-max-tag">MAX</span></div>
        <div class="tt-delta">${def.shortDesc}</div>
      `;
    } else {
      bodyHtml = `
        <div class="tt-compare">${curVal} <span class="tt-arrow">&gt;</span> ${nextVal}</div>
        <div class="tt-delta">${def.formatDelta()} (${def.shortDesc})</div>
        <div class="tt-cost ${canBuy ? "affordable" : "expensive"}"><span class="diamond">◆</span> ${cost.toLocaleString()}</div>
      `;
    }

    this.tooltipEl.style.setProperty("--tt-color", def.color);
    this.tooltipEl.innerHTML = `
      <div class="tt-title">${def.name} <span class="tt-lvl">LV ${lvl}/${def.maxLevel}</span></div>
      ${bodyHtml}
    `;
    const pos = nodePos(def.grid.col, def.grid.row);
    this.tooltipEl.style.left = `${pos.x}px`;
    this.tooltipEl.style.top = `${pos.y - 52}px`;
    this.tooltipEl.classList.remove("hidden");
  }

  private hideTooltip(): void {
    this.hoveredId = null;
    this.tooltipEl.classList.add("hidden");
  }

  refresh(): void {
    const u = this.game.upgrades;
    this.bankValEl.textContent = this.game.bank.toLocaleString();
    this.lifeValEl.textContent = this.game.lifetimePixels.toLocaleString();

    for (const def of UPGRADE_DEFS) {
      const btn = this.nodeEls.get(def.id)!;
      const line = this.lineEls.get(def.id)!;
      const lvl = u.levelOf(def.id);
      const unlocked = u.isUnlocked(def.id);
      const maxed = u.isMaxed(def.id);
      const canBuy = u.canBuy(def.id);

      btn.classList.toggle("locked", !unlocked);
      btn.classList.toggle("owned", lvl > 0);
      btn.classList.toggle("maxed", maxed);
      btn.classList.toggle("affordable", canBuy);

      const lvlEl = btn.querySelector(".node-lvl") as HTMLSpanElement;
      lvlEl.textContent = unlocked ? `${lvl}/${def.maxLevel}` : "🔒";

      line.classList.toggle("owned", lvl > 0);
      line.classList.toggle("unlocked", unlocked);
      line.style.stroke = unlocked ? def.color : "rgba(110, 150, 185, 0.28)";
    }
  }

  show(): void {
    this.refresh();
    this.root.classList.remove("hidden");
  }

  hide(): void {
    this.hideTooltip();
    this.root.classList.add("hidden");
  }

  closeAndDeploy(): void {
    this.hide();
    this.game.startRun();
  }

  get visible(): boolean {
    return !this.root.classList.contains("hidden");
  }
}
