import type { WeaponType } from "../entities/Soldier";
import type { Game } from "../Game";
import {
  UPGRADE_BY_ID,
  UPGRADE_DEFS,
  type UpgradeBranch,
  type UpgradeDef,
  type UpgradeId,
} from "../progression/UpgradeDefinitions";

type MatrixTab = UpgradeBranch | "loadout";

const CELL_STEP = 116;
const CENTER_X = 380;
const CENTER_Y = 195;

function nodePos(col: number, row: number): { x: number; y: number } {
  return { x: CENTER_X + col * CELL_STEP, y: CENTER_Y + row * CELL_STEP };
}

export class UpgradeTree {
  readonly root: HTMLDivElement;
  private stageEl: HTMLDivElement;
  private loadoutWrap: HTMLDivElement;
  private svgEl: SVGSVGElement;
  private nodesWrap: HTMLDivElement;
  private coreHubEl: HTMLDivElement;
  private tooltipEl: HTMLDivElement;
  private bankValEl: HTMLSpanElement;
  private crysValEl: HTMLSpanElement;
  private lifeValEl: HTMLSpanElement;
  private subEl: HTMLDivElement;
  private legendEl: HTMLDivElement;
  private nodeEls = new Map<UpgradeId, HTMLButtonElement>();
  private lineEls = new Map<UpgradeId, SVGLineElement>();
  private hoveredId: UpgradeId | null = null;
  private activeTab: MatrixTab = "core";

  constructor(parent: HTMLElement, private game: Game) {
    this.root = document.createElement("div");
    this.root.className = "overlay tree-overlay hidden";
    this.root.innerHTML = `
      <div class="tree-shell">
        <button class="tree-close" title="Close (Esc)">✕</button>
        <div class="tree-header">
          <div class="tree-title">UPGRADE MATRIX</div>
          <div class="tree-sub">CORE SYSTEMS, WEAPON TREES &amp; SQUAD LOADOUT</div>
          <div class="tree-tabs">
            <button class="tree-tab active" data-tab="core">CORE</button>
            <button class="tree-tab" data-tab="pistol">PISTOL</button>
            <button class="tree-tab" data-tab="shotgun">SHOTGUN</button>
            <button class="tree-tab" data-tab="assault_rifle">ASSAULT RIFLE</button>
            <button class="tree-tab" data-tab="rocket_launcher">ROCKET</button>
            <button class="tree-tab" data-tab="sniper_rifle">SNIPER</button>
            <button class="tree-tab tree-tab-loadout" data-tab="loadout">LOADOUT</button>
          </div>
          <div class="tree-legend">
            <span class="leg-item" style="--leg-c: #ffd84d">■ MONEY</span>
            <span class="leg-item" style="--leg-c: #38d6ff">● SOLDIER</span>
            <span class="leg-item" style="--leg-c: #ff4b8b">▲ BLIGHT</span>
          </div>
        </div>
        <div class="tree-stage">
          <svg class="tree-svg" viewBox="0 0 760 390" preserveAspectRatio="xMidYMid meet"></svg>
          <div class="tree-nodes"></div>
          <div class="tree-tooltip hidden"></div>
        </div>
        <div class="loadout-stage hidden"></div>
        <div class="tree-footer">
          <div class="tree-points-label">RESOURCES AVAILABLE</div>
          <div class="tree-points-val">
            <span class="diamond">■</span> <span class="bank-num">0</span>
            <span class="crys-wrap hidden"> &nbsp; <span class="crys-icon">◆</span> <span class="crys-num">0</span></span>
          </div>
          <div class="tree-life">LIFETIME EXCAVATED: <span class="life-num">0</span> PX</div>
          <div class="tree-actions">
            <button class="btn btn-primary" data-act="deploy">DEPLOY NEW RUN <span class="kbd">SPACE</span></button>
          </div>
        </div>
      </div>
    `;

    this.stageEl = this.root.querySelector(".tree-stage") as HTMLDivElement;
    this.loadoutWrap = this.root.querySelector(".loadout-stage") as HTMLDivElement;
    this.svgEl = this.root.querySelector(".tree-svg") as SVGSVGElement;
    this.nodesWrap = this.root.querySelector(".tree-nodes") as HTMLDivElement;
    this.tooltipEl = this.root.querySelector(".tree-tooltip") as HTMLDivElement;
    this.bankValEl = this.root.querySelector(".bank-num") as HTMLSpanElement;
    this.crysValEl = this.root.querySelector(".crys-num") as HTMLSpanElement;
    this.lifeValEl = this.root.querySelector(".life-num") as HTMLSpanElement;
    this.subEl = this.root.querySelector(".tree-sub") as HTMLDivElement;
    this.legendEl = this.root.querySelector(".tree-legend") as HTMLDivElement;

    this.coreHubEl = document.createElement("div");
    this.coreHubEl.className = "tree-core";
    this.coreHubEl.style.left = `${CENTER_X}px`;
    this.coreHubEl.style.top = `${CENTER_Y}px`;
    this.coreHubEl.innerHTML = `<div class="tree-core-ball"></div>`;
    this.nodesWrap.append(this.coreHubEl);

    this.root.querySelector(".tree-close")!.addEventListener("click", () => this.closeAndDeploy());
    this.root.querySelector('[data-act="deploy"]')!.addEventListener("click", () => this.closeAndDeploy());

    this.root.querySelectorAll(".tree-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tab = (btn as HTMLElement).dataset.tab as MatrixTab;
        this.switchTab(tab);
      });
    });

    this.buildStage();
    parent.append(this.root);
  }

  switchTab(tab: MatrixTab): void {
    this.activeTab = tab;
    this.hideTooltip();
    this.root.querySelectorAll(".tree-tab").forEach((btn) => {
      btn.classList.toggle("active", (btn as HTMLElement).dataset.tab === tab);
    });
    if (tab === "core") {
      this.subEl.textContent = "MONEY (LEFT) · SOLDIER (TOP) · BLIGHT SUPPRESSION (RIGHT)";
    } else if (tab === "pistol") {
      this.subEl.textContent = "SIDEARM WEAPON TREE — STANDARD ISSUE (UNLOCKED)";
    } else if (tab === "shotgun") {
      this.subEl.textContent = "SCATTER SHOTGUN WEAPON TREE — CLOSE-RANGE CONE EXCAVATOR";
    } else if (tab === "assault_rifle") {
      this.subEl.textContent = "ASSAULT RIFLE WEAPON TREE — RAPID FIRE WITH UP TO 5× PIERCE";
    } else if (tab === "rocket_launcher") {
      this.subEl.textContent = "ROCKET LAUNCHER WEAPON TREE — HEAVY EXPLOSIVE BLAST & CLUSTER MUNITIONS";
    } else if (tab === "sniper_rifle") {
      this.subEl.textContent = "SNIPER RIFLE WEAPON TREE — HIGH-VELOCITY PENETRATING ROUNDS & CRITS";
    } else {
      this.subEl.textContent = "SQUAD LOADOUT & INVENTORY — EQUIP WEAPONS & GEAR PER SOLDIER";
    }
    this.legendEl.classList.toggle("hidden", tab !== "core");
    this.stageEl.classList.toggle("hidden", tab === "loadout");
    this.loadoutWrap.classList.toggle("hidden", tab !== "loadout");
    this.refresh();
  }

  private buildStage(): void {
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
      if (def.grid.col === 0 && def.grid.row === 0 && def.parent === null) {
        line.style.display = "none";
      }
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
      const needCenter =
        (def.branch === "shotgun" && def.id !== "shotgun_unlock" && u.levelOf("shotgun_unlock") === 0) ||
        (def.branch === "assault_rifle" && def.id !== "ar_unlock" && u.levelOf("ar_unlock") === 0) ||
        (def.branch === "rocket_launcher" && def.id !== "rocket_unlock" && u.levelOf("rocket_unlock") === 0) ||
        (def.branch === "sniper_rifle" && def.id !== "sniper_unlock" && u.levelOf("sniper_unlock") === 0);
      const rem = Math.max(0, def.unlockLifetimePixels - this.game.lifetimePixels);
      const lockMsg =
        rem > 0
          ? `LOCKED — Destroy ${def.unlockLifetimePixels} lifetime pixels (${rem} more)`
          : needCenter
            ? `LOCKED — Unlock this weapon at the center node first`
            : `LOCKED`;
      bodyHtml = `
        <div class="tt-desc">${def.shortDesc}</div>
        <div class="tt-lock">${lockMsg}</div>
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
        <div class="tt-cost ${canBuy ? "affordable" : "expensive"}"><span class="diamond">■</span> ${cost.toLocaleString()}</div>
      `;
    }

    this.tooltipEl.style.setProperty("--tt-color", def.color);
    this.tooltipEl.innerHTML = `
      <div class="tt-title">${def.name} <span class="tt-lvl">LV ${lvl}/${def.maxLevel}</span></div>
      ${bodyHtml}
    `;
    const pos = nodePos(def.grid.col, def.grid.row);
    this.tooltipEl.style.left = `${pos.x}px`;
    this.tooltipEl.style.top = `${pos.y - 48}px`;
    this.tooltipEl.classList.remove("hidden");
  }

  private hideTooltip(): void {
    this.hoveredId = null;
    this.tooltipEl.classList.add("hidden");
  }

  private renderLoadout(): void {
    const st = this.game.upgrades.getSoldierStats();
    const count = st.maxSoldiers;
    const loadouts = this.game.save.data.loadouts;

    const weaponDefs: { id: WeaponType; label: string; unlocked: boolean }[] = [
      { id: "pistol", label: "PISTOL", unlocked: true },
      { id: "shotgun", label: "SHOTGUN", unlocked: st.shotgunUnlocked },
      { id: "assault_rifle", label: "ASSAULT", unlocked: st.arUnlocked },
      { id: "rocket_launcher", label: "ROCKET", unlocked: st.rocketUnlocked },
      { id: "sniper_rifle", label: "SNIPER", unlocked: st.sniperUnlocked },
    ];

    let cardsHtml = "";
    for (let i = 0; i < count; i++) {
      const ld = loadouts[i] ?? { weapon: "pistol", equipment: [null, null] };
      const curW: WeaponType = this.game.isWeaponUnlocked(ld.weapon) ? ld.weapon : "pistol";
      let wSummary = `1 round · ${st.damage} DMG · ${st.fireRate.toFixed(2)}/s`;
      if (curW === "shotgun") {
        wSummary = `${st.shotgunPellets} pellets · ${st.shotgunDamage} DMG · ${st.shotgunFireRate.toFixed(2)}/s`;
      } else if (curW === "assault_rifle") {
        wSummary = `Rapid · ${st.arDamage} DMG · ${st.arPierce} Pierce · ${st.arFireRate.toFixed(1)}/s`;
      } else if (curW === "rocket_launcher") {
        wSummary = `AoE ${st.rocketBlastRadius.toFixed(1)}r · ${st.rocketDamage} DMG · ${st.rocketFireRate.toFixed(2)}/s`;
      } else if (curW === "sniper_rifle") {
        wSummary = `Sniper · ${st.sniperDamage} DMG · ${st.sniperPierce} Pierce · ${Math.round(st.sniperCritChance * 100)}% Crit`;
      }

      const wBtnsHtml = weaponDefs
        .map(
          (w) => `
            <button class="btn lc-wbtn ${curW === w.id ? "btn-primary" : ""} ${!w.unlocked ? "locked" : ""}" data-slot="${i}" data-weapon="${w.id}" ${!w.unlocked ? "disabled" : ""}>
              ${w.unlocked ? w.label : `🔒 ${w.label}`}
            </button>
          `,
        )
        .join("");

      cardsHtml += `
        <div class="loadout-card">
          <div class="lc-header">
            <div class="lc-avatar"><div class="tree-core-ball"></div></div>
            <div class="lc-meta">
              <div class="lc-name">SOLDIER #${i + 1}</div>
              <div class="lc-stats">${wSummary}</div>
            </div>
          </div>
          <div class="lc-section-lbl">PRIMARY WEAPON (1 PER SOLDIER)</div>
          <div class="lc-weapons">${wBtnsHtml}</div>
          <div class="lc-section-lbl">EQUIPMENT SLOTS (COMING SOON)</div>
          <div class="lc-gear-row">
            <div class="lc-gear-slot" title="Equipment slot — coming soon">⬡ GEAR SLOT 1</div>
            <div class="lc-gear-slot" title="Equipment slot — coming soon">⬡ GEAR SLOT 2</div>
          </div>
        </div>
      `;
    }

    const moreHint =
      count < 8
        ? `<div class="loadout-hint">Unlock <b>Additional Soldier</b> in the Core Matrix to add more soldiers to your squad (${count}/8 unlocked).</div>`
        : `<div class="loadout-hint">Full 8-soldier squad unlocked!</div>`;

    this.loadoutWrap.innerHTML = `
      <div class="loadout-grid">${cardsHtml}</div>
      ${moreHint}
    `;

    this.loadoutWrap.querySelectorAll(".lc-wbtn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const el = btn as HTMLButtonElement;
        if (el.disabled) return;
        const slot = Number(el.dataset.slot);
        const weapon = el.dataset.weapon as WeaponType;
        if (!this.game.isWeaponUnlocked(weapon)) return;
        if (!loadouts[slot]) loadouts[slot] = { weapon: "pistol", equipment: [null, null] };
        loadouts[slot].weapon = weapon;
        this.game.save.save();
        this.game.audio.playPickup();
        this.renderLoadout();
      });
    });
  }

  refresh(): void {
    const u = this.game.upgrades;
    const st = u.getSoldierStats();
    this.bankValEl.textContent = this.game.bank.toLocaleString();
    this.crysValEl.textContent = this.game.crystals.toLocaleString();
    const crysWrap = this.root.querySelector(".crys-wrap") as HTMLElement;
    crysWrap.classList.toggle("hidden", this.game.crystals <= 0 && this.game.bests.depth < 16);
    this.lifeValEl.textContent = this.game.lifetimePixels.toLocaleString();

    // Update weapon tab lock indicators & Loadout tab count.
    const tabLocks: [UpgradeBranch, string, boolean][] = [
      ["shotgun", "SHOTGUN", st.shotgunUnlocked],
      ["assault_rifle", "ASSAULT RIFLE", st.arUnlocked],
      ["rocket_launcher", "ROCKET", st.rocketUnlocked],
      ["sniper_rifle", "SNIPER", st.sniperUnlocked],
    ];
    for (const [tabId, label, unlocked] of tabLocks) {
      const btn = this.root.querySelector(`[data-tab="${tabId}"]`) as HTMLButtonElement | null;
      if (btn) btn.textContent = unlocked ? label : `🔒 ${label}`;
    }
    const loadoutTab = this.root.querySelector('[data-tab="loadout"]') as HTMLButtonElement;
    if (loadoutTab) {
      loadoutTab.textContent = `LOADOUT (${st.maxSoldiers})`;
    }

    if (this.activeTab === "loadout") {
      this.renderLoadout();
      return;
    }

    // Center hub ball is shown on Core & Pistol (where 0,0 has no upgrade node),
    // and hidden on weapon trees where their unlock node sits at (0,0).
    const hasCenterUnlockNode =
      this.activeTab === "shotgun" ||
      this.activeTab === "assault_rifle" ||
      this.activeTab === "rocket_launcher" ||
      this.activeTab === "sniper_rifle";
    this.coreHubEl.classList.toggle("hidden", hasCenterUnlockNode);

    for (const def of UPGRADE_DEFS) {
      const btn = this.nodeEls.get(def.id)!;
      const line = this.lineEls.get(def.id)!;
      const inBranch = def.branch === this.activeTab;
      btn.classList.toggle("hidden", !inBranch);
      line.classList.toggle("hidden", !inBranch);
      if (!inBranch) continue;

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
