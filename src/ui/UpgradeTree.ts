import { TERRAIN } from "../config";
import { resolvePrimaryMutation, type PrimaryMutation, type SecondaryWeaponType, type WeaponType } from "../entities/Soldier";
import type { Game } from "../Game";
import type { SoldierBehavior } from "../progression/SaveManager";
import {
  SOLDIER_UPGRADE_BY_ID,
  SOLDIER_UPGRADE_DEFS,
  type SoldierUpgradeDef,
  type SoldierUpgradeId,
} from "../progression/SoldierUpgrades";
import {
  CORE_HUB_GRID,
  UPGRADE_BY_ID,
  UPGRADE_DEFS,
  type Currency,
  type Price,
  type UpgradeBranch,
  type UpgradeDef,
  type UpgradeId,
} from "../progression/UpgradeDefinitions";
import { essenceIcon } from "./essenceIcon";
import { paletteColor, sprite, UI_COLORS, type SpriteName } from "./pixelArt";
import {
  pathLength,
  pointAt,
  sideToward,
  trace,
  TronCycles,
  type Circuit,
  type CircuitNode,
} from "./treeCircuit";
import { stepElastic, type ElasticBody } from "./treeElastic";
import {
  CENTER_X,
  CENTER_Y,
  clampView,
  fitView,
  NODE_REACH,
  nodePos,
  STAGE_H,
  STAGE_W,
  treeBounds,
  visibleArea,
  zoomAt,
  type Bounds,
  type View,
} from "./treeView";

/** Connector layer resolution: one canvas pixel per this many CSS pixels. */
const LINK_PIXEL = 3;
const LINK_DOT_GAP = 4;
const LINK_LOCKED = "#26323e";
/** How far (CSS px) past its rest shape a tree can stretch and still draw links. */
const LINK_OVERSCAN = 240;
/** The center hub on trees whose (0,0) cell has no upgrade node. */
const HUB_ID = "hub";
/** Pointer travel (CSS px) that turns a press into a drag instead of a buy. */
const DRAG_THRESHOLD = 5;
/** Outward push (CSS px/s) on a node's children when it is bought. */
const BUY_KICK = 420;

interface NodeDrag {
  id: string;
  pointerId: number;
  startX: number;
  startY: number;
  bodyX: number;
  bodyY: number;
  moved: boolean;
}

interface PanDrag {
  pointerId: number;
  startX: number;
  startY: number;
  viewX: number;
  viewY: number;
}

export type UpgradeCategory = "systems" | "primary" | "secondary" | "soldiers" | "formations";

export interface CategoryInfo {
  id: UpgradeCategory;
  name: string;
  icon: SpriteName;
  color: string;
  branches: UpgradeBranch[];
}

export const CATEGORIES: readonly CategoryInfo[] = [
  {
    id: "systems",
    name: "CORE / MONEY / BLIGHT / BASE",
    icon: "soldier",
    color: UI_COLORS.soldier,
    branches: ["core", "resources", "blight", "facility"],
  },
  {
    id: "primary",
    name: "PRIMARY WEAPONS",
    icon: "rifle",
    color: "#52f296",
    branches: ["pistol", "shotgun", "assault_rifle", "rocket_launcher", "sniper_rifle", "katana", "flamethrower", "goo_mortar", "drone_shepherd", "prism_laser"],
  },
  {
    id: "secondary",
    name: "SECONDARY WEAPONS",
    icon: "grenade",
    color: "#ff9d3b",
    branches: ["grenade", "turret"],
  },
  { id: "formations", name: "FORMATIONS", icon: "formationLine", color: UI_COLORS.soldier, branches: ["formations"] },
  {
    id: "soldiers",
    name: "SOLDIER TREES",
    icon: "soldierPlus",
    color: UI_COLORS.soldier,
    branches: ["soldier"],
  },
];

type TreeDef = UpgradeDef | SoldierUpgradeDef;

const TREE_DEFS: readonly TreeDef[] = [...UPGRADE_DEFS, ...SOLDIER_UPGRADE_DEFS];

function treeDef(id: string): TreeDef {
  return (UPGRADE_BY_ID as Record<string, TreeDef>)[id] ?? SOLDIER_UPGRADE_BY_ID[id as SoldierUpgradeId];
}

const branchOf = (def: TreeDef): UpgradeBranch => ("branch" in def ? def.branch : "soldier");

/** How the tree on screen reads and buys its nodes: the Matrix's or one soldier's. */
interface TreeSource {
  levelOf(id: string): number;
  isUnlocked(id: string): boolean;
  isMaxed(id: string): boolean;
  canBuy(id: string): boolean;
  pricesOf(id: string): Price[];
  buy(id: string): boolean;
}

export function categoryForBranch(b: UpgradeBranch): UpgradeCategory {
  if (b === "formations") return "formations";
  if (b === "core" || b === "resources" || b === "blight" || b === "facility") return "systems";
  if (b === "grenade" || b === "turret") return "secondary";
  if (b === "soldier") return "soldiers";
  return "primary";
}

const TAB_ICONS: Record<UpgradeBranch, { icon: SpriteName; color: string }> = {
  formations: { icon: "formationLine", color: UI_COLORS.soldier },
  core: { icon: "soldier", color: UI_COLORS.soldier },
  resources: { icon: "gold", color: UI_COLORS.gold },
  blight: { icon: "warn", color: UI_COLORS.blight },
  pistol: { icon: "pistol", color: "#ff9d3b" },
  shotgun: { icon: "shotgun", color: "#ff7832" },
  assault_rifle: { icon: "rifle", color: "#52f296" },
  rocket_launcher: { icon: "launcher", color: "#ff5c40" },
  sniper_rifle: { icon: "sniper", color: UI_COLORS.soldier },
  katana: { icon: "katana", color: "#38d6ff" },
  drone_shepherd: { icon: "turret", color: "#7ce4df" },
  prism_laser: { icon: "bulletFast", color: "#d37cff" },
  goo_mortar: { icon: "grenade", color: "#9cde68" },
  flamethrower: { icon: "flamethrower", color: "#ff7a18" },
  grenade: { icon: "grenade", color: "#ff9d3b" },
  turret: { icon: "turret", color: "#38d6ff" },
  facility: { icon: "keycard", color: "#7fb2ff" },
  soldier: { icon: "soldier", color: UI_COLORS.soldier },
};

/** An icon for a currency, in tooltips and on the footer. */
function currencyIcon(c: Currency, scale: 1 | 2 = 2): string {
  if (c === "biomass") return `<span style="color:#7fe39a">◆</span>`;
  if (c === "essence") return essenceIcon(scale);
  if (c === "gold") return sprite("gold", { color: UI_COLORS.gold, scale });
  return sprite("crystal", { color: c === "crystals" ? UI_COLORS.crystal : UI_COLORS.greenCrystal, scale });
}

const lockIcon = (): string => sprite("lock", { color: "#6d8197", scale: 1 });
const goldIcon = (): string => sprite("gold", { color: UI_COLORS.gold });

function toArt(v: number): number {
  return Math.round(v / LINK_PIXEL);
}

/** Below this matrix scale, phones get the compact full-screen layout instead. */
const COMPACT_BELOW_SCALE = 0.9;


function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function tabHtml(tab: UpgradeBranch, label: string, locked = false): string {
  const { icon, color } = TAB_ICONS[tab];
  return `${sprite(icon, { color: locked ? "#6d8197" : color, scale: 1 })} ${label}${locked ? ` ${lockIcon()}` : ""}`;
}

export class UpgradeTree {
  readonly root: HTMLDivElement;
  private stageEl: HTMLDivElement;
  private loadoutWrap: HTMLDivElement;
  private linksEl: HTMLCanvasElement;
  private nodesWrap: HTMLDivElement;
  private coreHubEl: HTMLDivElement;
  private tooltipEl: HTMLDivElement;
  private bankValEl: HTMLSpanElement;
  private crysValEl: HTMLSpanElement;
  private lifeValEl: HTMLSpanElement;
  private subEl: HTMLDivElement;
  private titleEl: HTMLDivElement;
  private tabsEl: HTMLDivElement;
  private legendEl: HTMLDivElement;
  private backBtnEl: HTMLButtonElement;
  private primaryBtnEl: HTMLButtonElement;
  private greenValEl: HTMLSpanElement;
  private essenceValEl: HTMLSpanElement;
  private slotTabsEl: HTMLDivElement;
  private nodeEls = new Map<string, HTMLButtonElement>();
  private hoveredId: string | null = null;
  private activeTab: UpgradeBranch = "core";
  /** Whose tree the Soldiers tab shows. */
  private soldierSlot = 0;
  private expandedCategory: UpgradeCategory = "systems";
  private inLoadoutScreen = false;
  private bodies = new Map<string, ElasticBody>();
  private activeBodies: ElasticBody[] = [];
  private circuit: Circuit = { nodes: new Map(), neighbors: new Map() };
  private cycles = new TronCycles();
  private drag: NodeDrag | null = null;
  private panDrag: PanDrag | null = null;
  /** See treeView.ts: the tree opens fitted to the stage. */
  private bounds: Bounds = { x0: 0, y0: 0, x1: STAGE_W, y1: STAGE_H };
  private view: View = { x: 0, y: 0, s: 1 };
  private linkOrigin = { x: 0, y: 0 };
  private viewEl: HTMLDivElement;
  private fitBtn: HTMLButtonElement;
  private suppressClick = false;
  /** Shell + the box that reserves its scaled size, so small screens see the whole matrix. */
  private shellEl: HTMLDivElement;
  private fitBoxEl: HTMLDivElement;
  /** The tree stage's size in its own pixels: fixed on desktop, the screen's on phones. */
  private stageW = STAGE_W;
  private stageH = STAGE_H;
  /** On-screen px per shell px (1 on desktop, < 1 when shrunk to fit a phone). */
  private uiScale = 1;
  /** Pointer type of the last press on a node: touch taps select before they buy. */
  private nodePressType = "mouse";
  /** Second finger on the stage: pinch zooms the tree a step at a time. */
  private stagePointers = new Map<number, { x: number; y: number }>();
  private pinchStartDist = 0;
  private raf = 0;
  private lastFrame = 0;
  /** The pixel-art room above the matrix (lab, armory or barracks). */

  constructor(parent: HTMLElement, private game: Game) {
    this.root = document.createElement("div");
    this.root.className = "overlay tree-overlay hidden";
    this.root.innerHTML = `
      <div class="tree-fit-box"><div class="tree-shell">
        <button class="tree-close" title="Close (Esc)">${sprite("close", { color: UI_COLORS.magenta })}</button>
        <div class="tree-header">
          <div class="tree-title">UPGRADE MATRIX</div>
          <div class="tree-sub">CORE SYSTEMS, WEAPON TREES &amp; SQUAD LOADOUT</div>
          <div class="tree-tabs-container">
            <div class="tree-categories">
              <button class="tree-cat-btn active expanded" data-cat="systems" title="CORE / MONEY / BLIGHT / BASE">
                ${sprite("soldier", { color: UI_COLORS.soldier, scale: 1 })}
                <span class="tree-cat-name">CORE / MONEY / BLIGHT / BASE</span>
                <span class="cat-caret">▼</span>
              </button>
              <button class="tree-cat-btn" data-cat="primary" title="PRIMARY WEAPONS">
                ${sprite("rifle", { color: "#52f296", scale: 1 })}
                <span class="tree-cat-name">PRIMARY WEAPONS</span>
                <span class="cat-caret">▶</span>
              </button>
              <button class="tree-cat-btn" data-cat="secondary" title="SECONDARY WEAPONS">
                ${sprite("grenade", { color: "#ff9d3b", scale: 1 })}
                <span class="tree-cat-name">SECONDARY WEAPONS</span>
                <span class="cat-caret">▶</span>
              </button>
              <button class="tree-cat-btn" data-cat="formations" title="FORMATIONS">
                ${sprite("formationLine", { color: UI_COLORS.soldier, scale: 1 })}
                <span class="tree-cat-name">FORMATIONS</span><span class="cat-caret">▶</span>
              </button>
              <button class="tree-cat-btn" data-cat="soldiers" title="SOLDIER TREES">
                ${sprite("soldierPlus", { color: UI_COLORS.soldier, scale: 1 })}
                <span class="tree-cat-name">SOLDIER TREES</span>
                <span class="cat-caret">▶</span>
              </button>
            </div>
            <div class="tree-cat-heading">${CATEGORIES[0].name}</div>
            <div class="tree-category-panels">
              <div class="tree-cat-panel" data-cat="systems">
                <button class="tree-tab active" data-tab="core">${tabHtml("core", "CORE")}</button>
                <button class="tree-tab" data-tab="resources">${tabHtml("resources", "RESOURCES")}</button>
                <button class="tree-tab" data-tab="blight">${tabHtml("blight", "BLIGHT")}</button>
                <button class="tree-tab" data-tab="facility">${tabHtml("facility", "RESEARCH BASE")}</button>
              </div>
              <div class="tree-cat-panel hidden" data-cat="primary">
                <button class="tree-tab" data-tab="pistol">${tabHtml("pistol", "PISTOL")}</button>
                <button class="tree-tab" data-tab="shotgun"></button>
                <button class="tree-tab" data-tab="assault_rifle"></button>
                <button class="tree-tab" data-tab="rocket_launcher"></button>
                <button class="tree-tab" data-tab="sniper_rifle"></button>
                <button class="tree-tab" data-tab="katana"></button>
                <button class="tree-tab" data-tab="flamethrower"></button>
                <button class="tree-tab" data-tab="goo_mortar"></button>
                <button class="tree-tab" data-tab="drone_shepherd"></button>
                <button class="tree-tab" data-tab="prism_laser"></button>
              </div>
              <div class="tree-cat-panel hidden" data-cat="secondary">
                <button class="tree-tab" data-tab="grenade"></button>
                <button class="tree-tab" data-tab="turret"></button>
              </div>
              <div class="tree-cat-panel hidden" data-cat="formations">
                <button class="tree-tab" data-tab="formations">${tabHtml("formations", "FORMATIONS & BEHAVIORS")}</button>
              </div>
              <div class="tree-cat-panel hidden" data-cat="soldiers">
                <div class="soldier-slot-tabs"></div>
              </div>
            </div>
          </div>
          <div class="tree-legend">
            <span class="leg-item" style="--leg-c: #ffd84d">${goldIcon()} MONEY</span>
            <span class="leg-item" style="--leg-c: #38d6ff">${sprite("soldier", { color: UI_COLORS.soldier, scale: 1 })} SOLDIER</span>
            <span class="leg-item" style="--leg-c: #ff4b8b">${sprite("warn", { color: UI_COLORS.blight, scale: 1 })} BLIGHT</span>
          </div>
        </div>
        <div class="tree-stage">
          <div class="tree-clip">
            <div class="tree-view">
              <canvas class="tree-links"></canvas>
              <div class="tree-nodes"></div>
            </div>
          </div>
          <button class="btn tree-fit hidden" title="Fit the whole tree on screen">FIT</button>
          <div class="tree-tooltip hidden"></div>
        </div>
        <div class="loadout-stage hidden"></div>
        <div class="tree-footer">
          <div class="tree-points-label">RESOURCES AVAILABLE</div>
          <div class="tree-points-val">
            ${goldIcon()} <span class="bank-num">0</span>
            <span class="crys-wrap wallet-item hidden">${sprite("crystal", { color: UI_COLORS.crystal })} <span class="crys-num">0</span></span>
            <span class="green-wrap wallet-item hidden">${sprite("crystal", { color: UI_COLORS.greenCrystal })} <span class="green-num">0</span></span>
            <span class="biomass-wrap wallet-item" style="color:#7fe39a">◆ <span class="biomass-num">0</span></span>
            <span class="essence-wrap wallet-item hidden">${essenceIcon()} <span class="essence-num">0</span></span>
          </div>
          <div class="tree-life">LIFETIME EXCAVATED: <span class="life-num">0</span> PX</div>
          <div class="tree-actions">
            <button class="btn hidden" data-act="back-matrix">← UPGRADES</button>
            <button class="btn btn-primary" data-act="primary">DEPLOY NEW RUN <span class="kbd">SPACE</span></button>
          </div>
        </div>
      </div></div>
    `;

    this.shellEl = this.root.querySelector(".tree-shell") as HTMLDivElement;
    this.fitBoxEl = this.root.querySelector(".tree-fit-box") as HTMLDivElement;
    window.addEventListener("resize", () => {
      if (this.visible) this.fitToScreen();
    });
    this.stageEl = this.root.querySelector(".tree-stage") as HTMLDivElement;
    // The stage takes whatever room the layout grid leaves it.
    new ResizeObserver(() => {
      const w = this.stageEl.clientWidth;
      if (w > 0) this.resizeStage(w, this.stageEl.clientHeight);
    }).observe(this.stageEl);
    this.loadoutWrap = this.root.querySelector(".loadout-stage") as HTMLDivElement;
    this.linksEl = this.root.querySelector(".tree-links") as HTMLCanvasElement;
    this.viewEl = this.root.querySelector(".tree-view") as HTMLDivElement;
    this.fitBtn = this.root.querySelector(".tree-fit") as HTMLButtonElement;
    this.nodesWrap = this.root.querySelector(".tree-nodes") as HTMLDivElement;
    this.tooltipEl = this.root.querySelector(".tree-tooltip") as HTMLDivElement;
    this.bankValEl = this.root.querySelector(".bank-num") as HTMLSpanElement;
    this.crysValEl = this.root.querySelector(".crys-num") as HTMLSpanElement;
    this.greenValEl = this.root.querySelector(".green-num") as HTMLSpanElement;
    this.essenceValEl = this.root.querySelector(".essence-num") as HTMLSpanElement;
    this.slotTabsEl = this.root.querySelector(".soldier-slot-tabs") as HTMLDivElement;
    this.slotTabsEl.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest("[data-soldier-slot]") as HTMLElement | null;
      if (btn) this.openSoldierTree(Number(btn.dataset.soldierSlot));
    });
    this.lifeValEl = this.root.querySelector(".life-num") as HTMLSpanElement;
    this.titleEl = this.root.querySelector(".tree-title") as HTMLDivElement;
    this.subEl = this.root.querySelector(".tree-sub") as HTMLDivElement;
    this.tabsEl = this.root.querySelector(".tree-tabs-container") as HTMLDivElement;
    this.legendEl = this.root.querySelector(".tree-legend") as HTMLDivElement;
    this.backBtnEl = this.root.querySelector('[data-act="back-matrix"]') as HTMLButtonElement;
    this.primaryBtnEl = this.root.querySelector('[data-act="primary"]') as HTMLButtonElement;

    this.coreHubEl = document.createElement("div");
    this.coreHubEl.className = "tree-core";
    this.coreHubEl.innerHTML =
      sprite("ring", { color: UI_COLORS.soldier, scale: 3, cls: "node-ring" }) +
      sprite("soldier", { color: UI_COLORS.soldier, scale: 3 });
    this.nodesWrap.append(this.coreHubEl);
    this.bodies.set(HUB_ID, {
      id: HUB_ID,
      parent: null,
      hx: CENTER_X,
      hy: CENTER_Y,
      x: CENTER_X,
      y: CENTER_Y,
      vx: 0,
      vy: 0,
    });
    this.attachDrag(this.coreHubEl, HUB_ID);

    this.root.querySelector(".tree-close")!.addEventListener("click", () => this.closeAndDeploy());
    this.backBtnEl.addEventListener("click", () => this.closeLoadoutScreen());
    this.primaryBtnEl.addEventListener("click", () => this.onPrimaryAction());

    this.root.querySelectorAll(".tree-cat-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const cat = (btn as HTMLElement).dataset.cat as UpgradeCategory;
        this.selectCategory(cat);
      });
    });

    this.root.querySelectorAll(".tree-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tab = (btn as HTMLElement).dataset.tab as UpgradeBranch;
        this.switchTab(tab);
      });
    });

    this.buildStage();
    this.attachPanZoom();
    this.activateBranch(false);
    parent.append(this.root);
  }

  /** The nodes on the active tab. */
  private activeDefs(): readonly TreeDef[] {
    return this.activeTab === "soldier" ? SOLDIER_UPGRADE_DEFS : UPGRADE_DEFS.filter((d) => d.branch === this.activeTab);
  }

  private get source(): TreeSource {
    const u = this.game.upgrades;
    if (this.activeTab !== "soldier") {
      return {
        levelOf: (id) => u.levelOf(id as UpgradeId),
        isUnlocked: (id) => u.isUnlocked(id as UpgradeId),
        isMaxed: (id) => u.isMaxed(id as UpgradeId),
        canBuy: (id) => u.canBuy(id as UpgradeId),
        pricesOf: (id) => u.pricesOf(id as UpgradeId),
        buy: (id) => u.buy(id as UpgradeId),
      };
    }
    const slot = this.soldierSlot;
    return {
      levelOf: (id) => u.soldierLevelOf(slot, id as SoldierUpgradeId),
      isUnlocked: (id) => u.soldierIsUnlocked(slot, id as SoldierUpgradeId),
      isMaxed: (id) => u.soldierIsMaxed(slot, id as SoldierUpgradeId),
      canBuy: (id) => u.soldierCanBuy(slot, id as SoldierUpgradeId),
      pricesOf: (id) => u.soldierPricesOf(slot, id as SoldierUpgradeId),
      buy: (id) => u.soldierBuy(slot, id as SoldierUpgradeId),
    };
  }

  /** Show one soldier's own upgrade tree. */
  openSoldierTree(slot: number): void {
    this.soldierSlot = slot;
    this.switchTab("soldier");
  }

  selectCategory(cat: UpgradeCategory): void {
    this.expandedCategory = cat;
    const catInfo = CATEGORIES.find((c) => c.id === cat)!;
    if (!catInfo.branches.some((b) => this.game.upgrades.isBranchUnlocked(b))) return;
    if (!catInfo.branches.includes(this.activeTab)) {
      this.switchTab(catInfo.branches[0]);
    } else {
      this.updateCategoryUI();
    }
  }

  private updateCategoryUI(): void {
    this.root.querySelectorAll(".tree-cat-btn").forEach((btn) => {
      const el = btn as HTMLElement;
      const cat = el.dataset.cat as UpgradeCategory;
      const isExpanded = cat === this.expandedCategory;
      const containsActive = CATEGORIES.find((c) => c.id === cat)?.branches.includes(this.activeTab);
      el.classList.toggle("active", Boolean(containsActive));
      el.classList.toggle("expanded", isExpanded);
      const caret = el.querySelector(".cat-caret");
      if (caret) caret.textContent = isExpanded ? "▼" : "▶";
    });

    const heading = this.root.querySelector(".tree-cat-heading") as HTMLElement;
    heading.textContent = CATEGORIES.find((c) => c.id === this.expandedCategory)?.name ?? "";

    this.root.querySelectorAll(".tree-cat-panel").forEach((panel) => {
      const el = panel as HTMLElement;
      const cat = el.dataset.cat as UpgradeCategory;
      el.classList.toggle("hidden", cat !== this.expandedCategory);
    });

    this.root.querySelectorAll(".tree-tab").forEach((btn) => {
      btn.classList.toggle("active", (btn as HTMLElement).dataset.tab === this.activeTab);
    });
  }

  /** True once the player has unlocked multiple soldiers, another weapon, or custom behaviors. */
  isLoadoutUnlocked(): boolean {
    const st = this.game.upgrades.getSoldierStats();
    const u = this.game.upgrades;
    const hasBehaviors =
      u.levelOf("behavior_orthogonal") > 0 ||
      u.levelOf("behavior_patrol") > 0 ||
      u.levelOf("behavior_turns") > 0 ||
      u.levelOf("behavior_sentry") > 0;
    return (
      st.maxSoldiers > 1 ||
      st.shotgunUnlocked ||
      st.arUnlocked ||
      st.rocketUnlocked ||
      st.sniperUnlocked ||
      st.katanaUnlocked ||
      st.flameUnlocked ||
      st.grenadeUnlocked ||
      st.turretUnlocked ||
      hasBehaviors
    );
  }

  /** Advance from Upgrade Matrix -> Loadout (if unlocked), or deploy the run. */
  onPrimaryAction(): void {
    if (!this.inLoadoutScreen && this.isLoadoutUnlocked()) {
      this.openLoadoutScreen();
      return;
    }
    this.closeAndDeploy();
  }

  openLoadoutScreen(): void {
    this.inLoadoutScreen = true;
    this.hideTooltip();
    this.refresh();
  }

  closeLoadoutScreen(): void {
    this.inLoadoutScreen = false;
    this.hideTooltip();
    this.refresh();
  }

  switchTab(tab: UpgradeBranch): void {
    if (!this.game.upgrades.isBranchUnlocked(tab)) return;
    this.inLoadoutScreen = false;
    this.activeTab = tab;
    this.expandedCategory = categoryForBranch(tab);
    this.hideTooltip();
    this.activateBranch(true);
    this.updateCategoryUI();
    this.refresh();
  }

  private updateHeaderAndScreen(): void {
    const tab = this.activeTab;
    if (this.inLoadoutScreen) {
      this.titleEl.textContent = "SQUAD LOADOUT";
      this.subEl.textContent = "EQUIP PRIMARY WEAPONS & GEAR FOR EACH SOLDIER BEFORE DEPLOYING";
    } else {
      this.titleEl.textContent = "UPGRADE MATRIX";
      if (tab === "soldier") {
        this.titleEl.textContent = `SOLDIER #${this.soldierSlot + 1} TREE`;
        this.subEl.textContent = "THIS SOLDIER ONLY — GOLD, THEN ORANGE, THEN GREEN CRYSTALS, ALL WITH BLIGHT ESSENCE";
      } else if (tab === "core") {
        this.subEl.textContent = "CORE PROGRESSION — FOLLOW THE PATH TO UNLOCK NEW SYSTEMS";
      } else if (tab === "formations") {
        this.subEl.textContent = "SQUAD FORMATIONS & INDIVIDUAL SOLDIER BEHAVIORS";
      } else if (tab === "resources") {
        this.subEl.textContent = "RESOURCE EXTRACTION — GOLD DROPS, TIER 2 ORANGE & TIER 3 GREEN CRYSTALS";
      } else if (tab === "blight") {
        this.subEl.textContent = "BLIGHT CONTAINMENT — REPLICATION DAMPENING & BLIGHT CORE PURGES";
      } else if (tab === "facility") {
        this.subEl.textContent = "RESEARCH BASE SYSTEMS — DORMANT SENTRIES & FACILITY MAPPING";
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
      } else if (tab === "katana") {
        this.subEl.textContent = "KATANA WEAPON TREE — RAPID HIGH-PIERCE ENERGY SLASHES & ANTI-BLIGHT CRITS";
      } else if (tab === "drone_shepherd") {
        this.subEl.textContent = "DRONE SHEPHERD — MINIATURE PISTOL DRONES; 24 GLOBAL, NO SOLDIER SLOTS";
      } else if (tab === "prism_laser") {
        this.subEl.textContent = "CHROMATIC PRISM — PIERCE WHEN CHARGED, OTHERWISE REFLECT; EDGES ABSORB";
      } else if (tab === "goo_mortar") {
        this.subEl.textContent = "SQUELCH — STICK, SHED A MINE, REBOUND; MASS & DISTANCE LIMIT FLIGHT";
      } else if (tab === "flamethrower") {
        this.subEl.textContent = "FLAMETHROWER WEAPON TREE — SHORT-RANGE FIRE STREAM THAT SETS RUBBLE BURNING";
      } else if (tab === "grenade") {
        this.subEl.textContent = "STICKY GRENADE SECONDARY WEAPON TREE — HIGH-EXPLOSIVE STICKY ORDNANCE";
      } else if (tab === "turret") {
        this.subEl.textContent = "AUTOTURRET SECONDARY WEAPON TREE — AUTOMATED TARGET-LOCKING FIRE SUPPORT";
      }
    }
    this.tabsEl.classList.toggle("hidden", this.inLoadoutScreen);
    // Keeps its height on other tabs so the panel doesn't jump when switching.
    this.legendEl.classList.toggle("hidden", this.inLoadoutScreen);
    this.legendEl.style.visibility = "hidden";
    this.stageEl.classList.toggle("hidden", this.inLoadoutScreen);
    this.loadoutWrap.classList.toggle("hidden", !this.inLoadoutScreen);

    const loadoutUnlocked = this.isLoadoutUnlocked();
    this.backBtnEl.classList.toggle("hidden", !this.inLoadoutScreen);
    if (!this.inLoadoutScreen && loadoutUnlocked) {
      this.primaryBtnEl.innerHTML = `LOADOUT <span class="kbd">SPACE</span>`;
    } else {
      this.primaryBtnEl.innerHTML = `DEPLOY NEW RUN <span class="kbd">SPACE</span>`;
    }
  }

  private buildStage(): void {
    for (const def of TREE_DEFS) {
      const to = nodePos(def.grid.col, def.grid.row);
      const btn = document.createElement("button");
      // The weapon-unlock node at the center of a tree gets a round frame.
      const round = branchOf(def) !== "core" && def.grid.col === 0 && def.grid.row === 0;
      btn.className = round ? "tree-node round" : "tree-node";
      btn.style.setProperty("--node-color", def.color);
      const ring = round
        ? sprite("ring", { color: def.color, scale: 3, cls: "node-ring ring-empty" }) +
          sprite("ringFilled", { color: def.color, scale: 3, cls: "node-ring ring-filled" })
        : "";
      const paidIn = def.currency ?? "gold";
      btn.innerHTML = `
        ${ring}
        ${sprite(def.icon, { color: def.color, scale: 3, cls: "node-icon" })}
        ${paidIn === "gold" ? "" : `<span class="node-cur">${currencyIcon(paidIn, 1)}</span>`}
        <span class="node-lvl"></span>
        <span class="node-pip">${sprite("plus", { color: def.color, scale: 1 })}</span>
      `;
      btn.addEventListener("pointerenter", (e) => {
        if (e.pointerType === "mouse") this.showTooltip(def);
      });
      btn.addEventListener("pointerleave", (e) => {
        if (e.pointerType === "mouse") this.hideTooltip();
      });
      btn.addEventListener("click", () => {
        if (this.suppressClick) {
          this.suppressClick = false;
        } else if (this.nodePressType !== "mouse" && this.hoveredId !== def.id) {
          // No hover on touch: the first tap shows the details, the second buys.
          this.showTooltip(def);
        } else {
          this.onNodeClick(def);
        }
      });
      this.attachDrag(btn, def.id);
      this.nodesWrap.append(btn);
      this.nodeEls.set(def.id, btn);
      this.bodies.set(def.id, {
        id: def.id,
        parent: def.parent ?? (round ? null : HUB_ID),
        hx: to.x,
        hy: to.y,
        x: to.x,
        y: to.y,
        vx: 0,
        vy: 0,
      });
    }
  }

  /** Drag a node to stretch its branch; it eases back when let go. */
  private attachDrag(el: HTMLElement, id: string): void {
    el.style.touchAction = "none";
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      this.nodePressType = e.pointerType || "mouse";
      const b = this.bodies.get(id)!;
      this.suppressClick = false;
      this.drag = {
        id,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        bodyX: b.x,
        bodyY: b.y,
        moved: false,
      };
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener("pointermove", (e) => {
      const d = this.drag;
      if (!d || d.id !== id || d.pointerId !== e.pointerId) return;
      const dx = (e.clientX - d.startX) / this.uiScale;
      const dy = (e.clientY - d.startY) / this.uiScale;
      if (!d.moved) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        d.moved = true;
        this.hideTooltip();
        el.classList.add("dragging");
      }
      const b = this.bodies.get(id)!;
      const seen = visibleArea(this.view);
      const reach = LINK_OVERSCAN - NODE_REACH;
      b.x = Math.max(Math.max(seen.x0, this.bounds.x0 - reach), Math.min(Math.min(seen.x1, this.bounds.x1 + reach), d.bodyX + dx / this.view.s));
      b.y = Math.max(Math.max(seen.y0, this.bounds.y0 - reach), Math.min(Math.min(seen.y1, this.bounds.y1 + reach), d.bodyY + dy / this.view.s));
    });
    const release = (e: PointerEvent): void => {
      const d = this.drag;
      if (!d || d.id !== id || d.pointerId !== e.pointerId) return;
      this.suppressClick = d.moved;
      this.drag = null;
      el.classList.remove("dragging");
    };
    el.addEventListener("pointerup", release);
    el.addEventListener("pointercancel", release);
  }

  /** Drag the background to pan, wheel to zoom, FIT to see the whole tree. */
  private attachPanZoom(): void {
    const stage = this.stageEl;
    stage.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      if (e.pointerType !== "mouse") {
        this.stagePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this.stagePointers.size === 2) {
          const [a, b] = [...this.stagePointers.values()];
          this.pinchStartDist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
          this.panDrag = null;
          this.drag = null;
          this.hideTooltip();
          return;
        }
      }
      if ((e.target as HTMLElement).closest(".tree-node, .tree-core, .tree-fit")) return;
      // Tapping empty stage on a touch screen dismisses the selected node's details.
      if (e.pointerType !== "mouse") this.hideTooltip();
      this.panDrag = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        viewX: this.view.x,
        viewY: this.view.y,
      };
      stage.setPointerCapture(e.pointerId);
      stage.classList.add("panning");
    });
    stage.addEventListener("pointermove", (e) => {
      const tracked = this.stagePointers.get(e.pointerId);
      if (tracked) {
        tracked.x = e.clientX;
        tracked.y = e.clientY;
        if (this.stagePointers.size >= 2) {
          this.pinchStep();
          return;
        }
      }
      const p = this.panDrag;
      if (!p || p.pointerId !== e.pointerId) return;
      const x = p.viewX + (e.clientX - p.startX) / this.uiScale;
      const y = p.viewY + (e.clientY - p.startY) / this.uiScale;
      this.setView(clampView({ x, y, s: this.view.s }, this.bounds, this.stageW, this.stageH), true);
    });
    const release = (e: PointerEvent): void => {
      this.stagePointers.delete(e.pointerId);
      if (this.panDrag?.pointerId !== e.pointerId) return;
      this.panDrag = null;
      stage.classList.remove("panning");
    };
    stage.addEventListener("pointerup", release);
    stage.addEventListener("pointercancel", release);
    stage.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        if (e.deltaY === 0) return;
        const rect = stage.getBoundingClientRect();
        const next = zoomAt(
          this.view,
          this.bounds,
          -Math.sign(e.deltaY),
          (e.clientX - rect.left) / this.uiScale,
          (e.clientY - rect.top) / this.uiScale,
          this.stageW,
          this.stageH,
        );
        this.hideTooltip();
        this.setView(next, true);
      },
      { passive: false },
    );
    this.fitBtn.addEventListener("click", () => this.setView(this.fittedView(), false));
  }

  /** Two-finger pinch: one zoom step each time the spread changes by a quarter. */
  private pinchStep(): void {
    const [a, b] = [...this.stagePointers.values()];
    const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    const ratio = dist / this.pinchStartDist;
    if (ratio < 1.25 && ratio > 0.8) return;
    const rect = this.stageEl.getBoundingClientRect();
    const px = ((a.x + b.x) / 2 - rect.left) / this.uiScale;
    const py = ((a.y + b.y) / 2 - rect.top) / this.uiScale;
    this.setView(zoomAt(this.view, this.bounds, ratio > 1 ? 1 : -1, px, py, this.stageW, this.stageH), true);
    this.pinchStartDist = dist;
  }

  /**
   * Shrink the whole matrix (never enlarge) so it fits mid-size screens. When
   * that would shrink it too far (phones), switch to the compact layout instead:
   * a full-screen grid at real size, with category buttons on the left, the
   * tree beside them and the wallet above it (stacked in portrait).
   */
  private fitToScreen(): void {
    const pad = 16;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Measure the desktop layout first.
    this.root.classList.remove("tree-compact", "tree-portrait");
    this.shellEl.style.transform = "";
    this.fitBoxEl.style.width = "";
    this.fitBoxEl.style.height = "";
    const w = this.shellEl.offsetWidth;
    const h = this.shellEl.offsetHeight;
    const s = Math.min(1, (vw - pad) / w, (vh - pad) / h);
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const compact = s < COMPACT_BELOW_SCALE || (coarse && s < 1);
    this.uiScale = compact ? 1 : s;
    if (compact) {
      this.root.classList.add("tree-compact");
      this.root.classList.toggle("tree-portrait", vh > vw);
    }
    // Hidden on the loadout screen: keep the last size until it shows again.
    if (this.stageEl.clientWidth > 0) this.resizeStage(this.stageEl.clientWidth, this.stageEl.clientHeight);
    if (compact || s >= 1) return;
    this.shellEl.style.transform = `scale(${s})`;
    this.fitBoxEl.style.width = `${Math.floor(w * s)}px`;
    this.fitBoxEl.style.height = `${Math.floor(h * s)}px`;
  }

  private fittedView(): View {
    return fitView(this.bounds, this.stageW, this.stageH);
  }

  /** Give the tree a new stage size and fit it again. */
  private resizeStage(w: number, h: number): void {
    if (w === this.stageW && h === this.stageH) return;
    this.stageW = w;
    this.stageH = h;
    this.hideTooltip();
    this.setView(this.fittedView(), false);
  }

  /** `steered`: the player moved the view away from the fit, so offer FIT. */
  private setView(view: View, steered: boolean): void {
    this.view = view;
    this.viewEl.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.s})`;
    this.fitBtn.classList.toggle("hidden", !steered);
  }

  /** Bodies and circuit for the active tab; `sprout` grows them out of the root. */
  private activateBranch(sprout: boolean): void {
    this.drag = null;
    this.cycles.reset();
    const defs = this.activeDefs();
    const ids = defs.map((d) => d.id as string);
    const core = this.activeTab === "core";
    const hub = this.bodies.get(HUB_ID)!;
    const home = core ? nodePos(CORE_HUB_GRID.col, CORE_HUB_GRID.row) : nodePos(0, 0);
    hub.hx = hub.x = home.x;
    hub.hy = hub.y = home.y;
    hub.vx = hub.vy = 0;
    this.coreHubEl.style.pointerEvents = core ? "none" : "";
    this.coreHubEl.setAttribute("aria-hidden", String(core));
    if (core || (defs.length > 0 && !defs.some((d) => d.grid.col === 0 && d.grid.row === 0))) ids.push(HUB_ID);
    this.activeBodies = ids.map((id) => this.bodies.get(id)!);

    const neighbors = new Map<string, string[]>(ids.map((id) => [id, []]));
    for (const b of this.activeBodies) {
      if (!b.parent) continue;
      neighbors.get(b.id)!.push(b.parent);
      neighbors.get(b.parent)!.push(b.id);
    }
    this.circuit = { nodes: new Map(), neighbors };

    // Every tree opens fitted to the stage (see the rules in treeView.ts).
    if (this.activeBodies.length > 0) {
      this.bounds = treeBounds(this.activeBodies.map((b) => ({ x: b.hx, y: b.hy })));
      this.sizeLinkCanvas();
      this.setView(this.fittedView(), false);
    }

    const grow = sprout && this.activeTab !== "core" && !reducedMotion();
    const rootBody = this.activeBodies.find((b) => b.parent === null);
    for (const b of this.activeBodies) {
      b.x = grow && rootBody ? rootBody.hx : b.hx;
      b.y = grow && rootBody ? rootBody.hy : b.hy;
      b.vx = 0;
      b.vy = 0;
    }
    this.placeNodes();
  }

  /** The link canvas covers the tree plus room to stretch, on the art grid. */
  private sizeLinkCanvas(): void {
    const b = this.bounds;
    const x = toArt(b.x0 - LINK_OVERSCAN);
    const y = toArt(b.y0 - LINK_OVERSCAN);
    const w = toArt(b.x1 + LINK_OVERSCAN) - x + 1;
    const h = toArt(b.y1 + LINK_OVERSCAN) - y + 1;
    this.linkOrigin = { x, y };
    this.linksEl.width = w;
    this.linksEl.height = h;
    this.linksEl.style.left = `${x * LINK_PIXEL}px`;
    this.linksEl.style.top = `${y * LINK_PIXEL}px`;
    this.linksEl.style.width = `${w * LINK_PIXEL}px`;
    this.linksEl.style.height = `${h * LINK_PIXEL}px`;
  }

  /** Move node elements to their bodies, on the same art grid as the links. */
  private placeNodes(): void {
    for (const b of this.activeBodies) {
      const el = b.id === HUB_ID ? this.coreHubEl : this.nodeEls.get(b.id)!;
      el.style.left = `${toArt(b.x) * LINK_PIXEL}px`;
      el.style.top = `${toArt(b.y) * LINK_PIXEL}px`;
    }
  }

  private syncCircuit(): void {
    const u = this.source;
    for (const b of this.activeBodies) {
      const def = b.id === HUB_ID ? null : treeDef(b.id);
      const hubColor = TAB_ICONS[this.activeTab].color;
      const node: CircuitNode = {
        id: b.id,
        x: toArt(b.x),
        y: toArt(b.y),
        hx: b.hx,
        hy: b.hy,
        color: def?.color ?? hubColor,
        live: def ? u.isUnlocked(def.id) : true,
      };
      this.circuit.nodes.set(b.id, node);
    }
  }

  private frame = (time: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = this.lastFrame ? Math.min(1 / 30, (time - this.lastFrame) / 1000) : 0;
    this.lastFrame = time;
    if (this.inLoadoutScreen) return;
    const heldId = this.drag?.moved ? this.drag.id : null;
    if (reducedMotion() || this.activeTab === "core") {
      for (const b of this.activeBodies) {
        if (b.id === heldId) continue;
        b.x = b.hx;
        b.y = b.hy;
      }
    } else {
      stepElastic(this.activeBodies, dt, heldId);
    }
    this.placeNodes();
    this.drawCircuit(reducedMotion() ? 0 : dt);
  };

  /**
   * Right-angle traces for the active tab (dim when locked, dotted until
   * owned, then solid) with the light cycles riding on top.
   */
  private drawCircuit(dt: number): void {
    this.syncCircuit();
    const g = this.linksEl.getContext("2d")!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.linksEl.width, this.linksEl.height);
    g.translate(-this.linkOrigin.x, -this.linkOrigin.y);
    const u = this.source;
    for (const b of this.activeBodies) {
      if (!b.parent) continue;
      const def = treeDef(b.id);
      const from = this.circuit.nodes.get(b.parent)!;
      const to = this.circuit.nodes.get(b.id)!;
      const owned = u.levelOf(def.id) > 0;
      g.fillStyle = to.live ? (paletteColor(owned ? "#" : "-", def.color) as string) : LINK_LOCKED;
      const path = trace(from, to, sideToward(from, to) % 2 === 0);
      const len = pathLength(path);
      const gap = owned ? 1 : LINK_DOT_GAP;
      for (let i = 0; i <= len; i += gap) {
        const p = pointAt(path, i);
        g.fillRect(p.x, p.y, 1, 1);
      }
    }
    if (dt > 0) this.cycles.step(dt, this.circuit);
    this.cycles.draw(g, this.circuit);
  }

  private onNodeClick(def: TreeDef): void {
    if (this.source.buy(def.id)) {
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
      this.kickChildren(def.id);
    }
  }

  /** A purchase shoves the next nodes outward, so the branch rings. */
  private kickChildren(id: string): void {
    const from = this.bodies.get(id)!;
    for (const b of this.activeBodies) {
      if (b.parent !== id) continue;
      const dx = b.x - from.x;
      const dy = b.y - from.y;
      const d = Math.hypot(dx, dy) || 1;
      b.vx += (dx / d) * BUY_KICK;
      b.vy += (dy / d) * BUY_KICK;
    }
  }

  /** A price line: each currency's icon and amount, flagged when the bank is short. */
  private priceHtml(prices: readonly Price[]): string {
    const u = this.game.upgrades;
    return prices
      .map((p) => {
        const short = u.balanceOf(p.currency) < p.amount ? " short" : "";
        return `<span class="tt-price${short}">${currencyIcon(p.currency)} ${p.amount.toLocaleString()}</span>`;
      })
      .join("");
  }

  private showTooltip(def: TreeDef): void {
    if (this.drag?.moved) return;
    this.hoveredId = def.id;
    const u = this.source;
    const lvl = u.levelOf(def.id);
    const unlocked = u.isUnlocked(def.id);
    const maxed = u.isMaxed(def.id);
    const canBuy = u.canBuy(def.id);
    const tier = "tier" in def ? `<div class="tt-tier">TIER ${def.tier} — SOLDIER #${this.soldierSlot + 1} ONLY</div>` : "";
    const curVal = def.formatValue(def.valueAt(lvl));
    const nextVal = def.formatValue(def.valueAt(Math.min(def.maxLevel, lvl + 1)));

    let bodyHtml: string;
    if (def.placeholder) {
      bodyHtml = `<div class="tt-desc">${def.shortDesc}</div>`;
    } else if (!unlocked && "tier" in def) {
      const parentName = def.parent ? SOLDIER_UPGRADE_BY_ID[def.parent].name : "";
      bodyHtml = `
        <div class="tt-desc">${def.shortDesc}</div>
        <div class="tt-lock">LOCKED — Buy ${parentName} on this soldier first</div>
      `;
    } else if (!unlocked) {
      const branch = branchOf(def);
      const needCenter =
        (branch === "drone_shepherd" && def.id !== "drone_unlock" && u.levelOf("drone_unlock") === 0) ||
        (branch === "prism_laser" && def.id !== "prism_unlock" && u.levelOf("prism_unlock") === 0) ||
        (branch === "goo_mortar" && def.id !== "goo_unlock" && u.levelOf("goo_unlock") === 0) ||
        (branch === "shotgun" && def.id !== "shotgun_unlock" && u.levelOf("shotgun_unlock") === 0) ||
        (branch === "assault_rifle" && def.id !== "ar_unlock" && u.levelOf("ar_unlock") === 0) ||
        (branch === "rocket_launcher" && def.id !== "rocket_unlock" && u.levelOf("rocket_unlock") === 0) ||
        (branch === "sniper_rifle" && def.id !== "sniper_unlock" && u.levelOf("sniper_unlock") === 0) ||
        (branch === "katana" && def.id !== "katana_unlock" && u.levelOf("katana_unlock") === 0) ||
        (branch === "flamethrower" && def.id !== "flame_unlock" && u.levelOf("flame_unlock") === 0) ||
        (branch === "grenade" && def.id !== "grenade_unlock" && u.levelOf("grenade_unlock") === 0) ||
        (branch === "turret" && def.id !== "turret_unlock" && u.levelOf("turret_unlock") === 0);
      const rem = Math.max(0, def.unlockLifetimePixels - this.game.lifetimePixels);
      let prerequisite = def.parent;
      while (branch === "core" && prerequisite && treeDef(prerequisite).placeholder) prerequisite = treeDef(prerequisite).parent;
      const needParent =
        prerequisite !== null && u.levelOf(prerequisite) === 0 ? treeDef(prerequisite).name : "";
      const lockMsg =
        def.id === "prism_overload" && u.levelOf("prism_spectrum") < 6
          ? "LOCKED — Requires Spectrum Ascension VI"
          : rem > 0
          ? `LOCKED — Destroy ${def.unlockLifetimePixels} lifetime pixels (${rem} more)`
          : needCenter
            ? `LOCKED — Unlock this weapon at the center node first`
            : needParent
              ? `LOCKED — Buy ${needParent} first`
              : `LOCKED`;
      bodyHtml = `
        <div class="tt-desc">${def.shortDesc}</div>
        <div class="tt-lock">${lockMsg}</div>
      `;
    } else if (maxed) {
      bodyHtml = `
        <div class="tt-compare"><span class="tt-value">${curVal}</span> <span class="tt-max-tag">MAX</span></div>
        <div class="tt-delta">${def.shortDesc}</div>
      `;
    } else {
      bodyHtml = `
        <div class="tt-compare"><span class="tt-value">${curVal}</span> ${sprite("chevron", { color: "#7e9bb8" })} <span class="tt-value">${nextVal}</span></div>
        <div class="tt-delta">${def.formatDelta()} (${def.shortDesc})</div>
        <div class="tt-cost ${canBuy ? "affordable" : "expensive"}">${this.priceHtml(u.pricesOf(def.id))}</div>
      `;
    }

    this.tooltipEl.style.setProperty("--tt-color", def.color);
    this.tooltipEl.innerHTML = `
      <div class="tt-title">${def.name} <span class="tt-lvl">LV ${lvl}/${def.maxLevel}</span></div>
      ${tier}
      ${bodyHtml}
    `;
    this.tooltipEl.classList.remove("hidden");
    // Placed on whole pixels (no centering transform) so the text stays crisp.
    const pos = this.bodies.get(def.id)!;
    const w = this.tooltipEl.offsetWidth;
    const h = this.tooltipEl.offsetHeight;
    const screenX = this.view.x + pos.x * this.view.s;
    const screenY = this.view.y + pos.y * this.view.s;
    const left = Math.min(this.stageW - w, Math.max(0, Math.round(screenX - w / 2)));
    this.tooltipEl.style.left = `${left}px`;
    let top = Math.round(screenY - 40 * this.view.s) - h;
    // Nothing above the stage to spill onto, so flip below the node and keep it on the stage.
    if (top < 0) {
      top = Math.max(0, Math.min(this.stageH - h, Math.round(screenY + 40 * this.view.s)));
    }
    this.tooltipEl.style.top = `${top}px`;
  }

  private hideTooltip(): void {
    this.hoveredId = null;
    this.tooltipEl.classList.add("hidden");
  }

  private renderLoadout(): void {
    const st = this.game.upgrades.getSoldierStats();
    const count = st.maxSoldiers;
    const loadouts = this.game.save.data.loadouts;

    const weaponDefs: { id: WeaponType & UpgradeBranch; label: string; unlocked: boolean }[] = [
      { id: "pistol", label: "PISTOL", unlocked: true },
      { id: "shotgun", label: "SHOTGUN", unlocked: st.shotgunUnlocked },
      { id: "assault_rifle", label: "ASSAULT", unlocked: st.arUnlocked },
      { id: "rocket_launcher", label: "ROCKET", unlocked: st.rocketUnlocked },
      { id: "sniper_rifle", label: "SNIPER", unlocked: st.sniperUnlocked },
      { id: "katana", label: "KATANA", unlocked: st.katanaUnlocked },
      { id: "drone_shepherd", label: "DRONES", unlocked: st.droneUnlocked },
      { id: "prism_laser", label: "PRISM", unlocked: st.prismUnlocked },
      { id: "goo_mortar", label: "SQUELCH", unlocked: st.gooUnlocked },
      { id: "flamethrower", label: "FLAMER", unlocked: st.flameUnlocked },
    ];

    const secondaryDefs: { id: SecondaryWeaponType | null; label: string; unlocked: boolean; icon: SpriteName }[] = [
      { id: null, label: "NONE", unlocked: true, icon: "close" },
      { id: "grenade", label: "GRENADE", unlocked: st.grenadeUnlocked, icon: "grenade" },
      { id: "turret", label: "TURRET", unlocked: st.turretUnlocked, icon: "turret" },
    ];

    const behaviorDefs: { id: SoldierBehavior; label: string; desc: string; icon: SpriteName }[] = [
      { id: "free", label: "FREE", desc: "Default angled bounce", icon: "soldierDash" },
      { id: "orthogonal", label: "ORTHO", desc: "Strict cardinal grid movement", icon: "behaviorGrid" },
      { id: "vertical", label: "PATROL V", desc: "Up & down vertical patrol", icon: "behaviorPatrol" },
      { id: "horizontal", label: "PATROL H", desc: "Side to side horizontal patrol", icon: "behaviorPatrol" },
      { id: "turn_left", label: "TURN L", desc: "Turns left 90° on wall impact", icon: "behaviorTurns" },
      { id: "turn_right", label: "TURN R", desc: "Turns right 90° on wall impact", icon: "behaviorTurns" },
      { id: "sentry_slow", label: "TURRET 1", desc: "Stationary sentry, slow rotation", icon: "behaviorSentry" },
      { id: "sentry_fast", label: "TURRET 2", desc: "Stationary sentry, fast rotation", icon: "behaviorSentry" },
    ];

    let cardsHtml = "";
    for (let i = 0; i < count; i++) {
      const ld = loadouts[i] ?? { weapon: "pistol", behavior: "free", equipment: [null, null], secondary: null };
      const curW: WeaponType = this.game.isWeaponUnlocked(ld.weapon) ? ld.weapon : "pistol";
      const curS: SecondaryWeaponType | null =
        ld.secondary && this.game.isSecondaryUnlocked(ld.secondary) ? ld.secondary : null;
      const curM=resolvePrimaryMutation(curW,ld.mutation,st);
      const mutationOptions: {id: PrimaryMutation | null; label: string; unlocked: boolean}[] = curW === "pistol"
        ? [{id:null,label:"STANDARD",unlocked:true},{id:"reverse_revolver",label:"REVERSE-PLAYBACK",unlocked:st.reverseUnlocked}]
        : curW === "katana" ? [{id:null,label:st.katanaDash?"MOMENTUM":"STANDARD",unlocked:true},{id:"gale_edge",label:"GALE EDGE",unlocked:st.galeUnlocked}] : [];
      const mutationHtml=mutationOptions.length?`<div class="lc-section-lbl">BLACK MARKET — NEXT DEPLOYMENT</div><div class="lc-weapons">${mutationOptions.map(m=>`<button class="btn lc-mbtn ${curM===m.id?"btn-primary":""}" data-slot="${i}" data-mutation="${m.id??""}" ${m.unlocked?"":"disabled"}>${m.label}${m.unlocked?"":" · LOCKED"}</button>`).join("")}</div>`:"";
      const curB: SoldierBehavior = this.game.isBehaviorUnlocked(ld.behavior) ? ld.behavior : "free";

      let wSummary = `1 round · ${st.damage} DMG · ${st.fireRate.toFixed(2)}/s`;
      if (curW === "shotgun") {
        wSummary = `${st.shotgunPellets} pellets · ${st.shotgunDamage} DMG · ${st.shotgunFireRate.toFixed(2)}/s`;
      } else if (curW === "assault_rifle") {
        wSummary = `Rapid · ${st.arDamage} DMG · ${st.arPierce} Pierce · ${st.arFireRate.toFixed(1)}/s`;
      } else if (curW === "rocket_launcher") {
        wSummary = `AoE ${st.rocketBlastRadius.toFixed(1)}r · ${st.rocketDamage} DMG · ${st.rocketFireRate.toFixed(2)}/s`;
      } else if (curW === "sniper_rifle") {
        wSummary = `Sniper · ${st.sniperDamage} DMG · ${st.sniperPierce} Pierce · ${Math.round(st.sniperCritChance * 100)}% Crit`;
      } else if (curW === "katana") {
        wSummary = `${st.katanaDash ? "Rebound dash · " : ""}Slash · ${st.katanaDamage} DMG (${st.katanaBlightMultiplier}× Blight) · ${st.katanaPierce} Pierce · ${st.katanaFireRate.toFixed(1)}/s`;
      } else if (curW === "drone_shepherd") {
        wSummary = `Independent pistol drones · ${st.droneCapacity} cap · ${st.droneReleaseInterval.toFixed(2)}s release · ${st.droneDamage} DMG`;
      } else if (curW === "prism_laser") {
        wSummary = `Pierce when charged, otherwise reflect · BAND ${st.prismSpectrum+1}/7 · ${st.prismBounces} bounces · ${st.prismDamage} DMG`;
      } else if (curW === "goo_mortar") {
        wSummary = `Stick → mine → rebound · ${st.gooMass.toFixed(2)} mass · ${st.gooDistance} range · sticky mines`;
      } else if (curW === "flamethrower") {
        wSummary = `Flame · ${st.flameDamage} DMG · ${st.flameFireRate.toFixed(1)}/s · ignites rubble`;
      }
      if(curM==="reverse_revolver")wSummary=`Pause → rewind exact shot path · ${st.damage} DMG` ;
      if(curM==="gale_edge")wSummary=`Flying crescents · ${st.galeDistance} range · Momentum inactive`;
      if (curS === "grenade") {
        wSummary += ` · NADE: ${st.grenadeBlocksRequired} blk (${st.grenadeDamage} dmg)`;
      } else if (curS === "turret") {
        wSummary += ` · TURRET: ${st.turretEnergyRequired} eng (${st.turretCount}x ${st.turretDamage} dmg)`;
      }

      const wBtnsHtml = weaponDefs
        .map(
          (w) => `
            <button class="lc-wbtn ${curW === w.id ? "equipped" : ""} ${!w.unlocked ? "locked" : ""}" data-slot="${i}" data-weapon="${w.id}" title="${w.label}" ${!w.unlocked ? "disabled" : ""}>
              ${sprite(TAB_ICONS[w.id].icon, { color: w.unlocked ? TAB_ICONS[w.id].color : "#6d8197", scale: 2 })}
              ${w.unlocked ? `<span class="lc-wname">${w.label}</span>` : `<span class="lc-wname">${lockIcon()}</span>`}
            </button>
          `,
        )
        .join("");

      const sBtnsHtml = secondaryDefs
        .map(
          (sec) => `
            <button class="lc-sbtn ${curS === sec.id ? "equipped" : ""} ${!sec.unlocked ? "locked" : ""}" data-slot="${i}" data-secondary="${sec.id ?? ""}" title="${sec.label}" ${!sec.unlocked ? "disabled" : ""}>
              ${sprite(sec.icon, { color: sec.unlocked ? (curS === sec.id ? "#ffd84d" : "#ff9d3b") : "#6d8197", scale: 1 })}
              ${sec.unlocked ? `<span class="lc-sname">${sec.label}</span>` : `<span class="lc-sname">${lockIcon()}</span>`}
            </button>
          `,
        )
        .join("");

      const bBtnsHtml = behaviorDefs
        .map((b) => {
          const unlocked = this.game.isBehaviorUnlocked(b.id);
          const isEquipped = curB === b.id;
          return `
            <button class="lc-bbtn ${isEquipped ? "equipped" : ""} ${!unlocked ? "locked" : ""}" data-slot="${i}" data-behavior="${b.id}" title="${b.label}: ${b.desc}" ${!unlocked ? "disabled" : ""}>
              ${sprite(b.icon, { color: unlocked ? (isEquipped ? "#ffd84d" : UI_COLORS.soldier) : "#6d8197", scale: 1 })}
              ${unlocked ? `<span class="lc-bname">${b.label}</span>` : `<span class="lc-bname">${lockIcon()}</span>`}
            </button>
          `;
        })
        .join("");

      cardsHtml += `
        <div class="loadout-card">
          <div class="lc-header">
            <div class="lc-avatar">${sprite("soldier", { color: UI_COLORS.soldier })}</div>
            <div class="lc-meta">
              <div class="lc-name">SOLDIER #${i + 1}</div>
              <div class="lc-stats">${wSummary}</div>
            </div>
          </div>
          <div class="lc-section-lbl">PRIMARY WEAPON (1 PER SOLDIER)</div>
          <div class="lc-weapons">${wBtnsHtml}</div>
          ${mutationHtml}
          <div class="lc-section-lbl">SECONDARY ABILITY (1 PER SOLDIER)</div>
          <div class="lc-secondaries">${sBtnsHtml}</div>
          <div class="lc-section-lbl">BEHAVIOR PROTOCOL</div>
          <div class="lc-behaviors">${bBtnsHtml}</div>
          <button class="btn lc-tree-btn" data-soldier-tree="${i}">UPGRADE TREE · LV ${this.game.upgrades.soldierTreeLevel(i)}</button>
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

    this.loadoutWrap.querySelectorAll(".lc-tree-btn").forEach((btn) => {
      btn.addEventListener("click", () => this.openSoldierTree(Number((btn as HTMLElement).dataset.soldierTree)));
    });

    this.loadoutWrap.querySelectorAll(".lc-wbtn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const el = btn as HTMLButtonElement;
        if (el.disabled) return;
        const slot = Number(el.dataset.slot);
        const weapon = el.dataset.weapon as WeaponType;
        if (!this.game.isWeaponUnlocked(weapon)) return;
        if (!loadouts[slot]) loadouts[slot] = { weapon: "pistol", behavior: "free", equipment: [null, null] };
        loadouts[slot].weapon = weapon;
        loadouts[slot].mutation=resolvePrimaryMutation(weapon,loadouts[slot].mutation,st);
        this.game.save.save();
        this.game.audio.playPickup();
        this.renderLoadout();
      });
    });

    this.loadoutWrap.querySelectorAll<HTMLButtonElement>(".lc-mbtn").forEach(btn=>{
      btn.addEventListener("click",()=>{
        const slot=Number(btn.dataset.slot);const loadout=loadouts[slot];if(btn.disabled||!loadout)return;
        const requested=btn.dataset.mutation??"";
        const mutation=resolvePrimaryMutation(loadout.weapon,requested,st);
        if(requested!==""&&!mutation)return;
        loadout.mutation=mutation;this.game.save.save();this.renderLoadout();
      });
    });

    this.loadoutWrap.querySelectorAll(".lc-bbtn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const el = btn as HTMLButtonElement;
        if (el.disabled) return;
        const slot = Number(el.dataset.slot);
        const behavior = el.dataset.behavior as SoldierBehavior;
        if (!this.game.isBehaviorUnlocked(behavior)) return;
        if (!loadouts[slot]) loadouts[slot] = { weapon: "pistol", behavior: "free", equipment: [null, null], secondary: null };
        loadouts[slot].behavior = behavior;
        this.game.save.save();
        this.game.audio.playPickup();
        this.renderLoadout();
      });
    });

    this.loadoutWrap.querySelectorAll(".lc-sbtn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const el = btn as HTMLButtonElement;
        if (el.disabled) return;
        const slot = Number(el.dataset.slot);
        const secVal = el.dataset.secondary;
        const secondary = (secVal ? secVal : null) as SecondaryWeaponType | null;
        if (secondary && !this.game.isSecondaryUnlocked(secondary)) return;
        if (!loadouts[slot]) {
          loadouts[slot] = { weapon: "pistol", behavior: "free", equipment: [null, null], secondary: null };
        }
        loadouts[slot].secondary = secondary;
        this.game.save.save();
        this.game.audio.playPickup();
        this.renderLoadout();
      });
    });
  }

  refresh(): void {
    const st = this.game.upgrades.getSoldierStats();
    this.bankValEl.textContent = this.game.bank.toLocaleString();
    this.crysValEl.textContent = this.game.crystals.toLocaleString();
    this.greenValEl.textContent = this.game.greenCrystals.toLocaleString();
    (this.root.querySelector(".biomass-num") as HTMLElement).textContent = this.game.biomass.toLocaleString();
    this.essenceValEl.textContent = this.game.essence.toLocaleString();
    // A currency shows once it's owned, reachable, or priced on this tree.
    const defs = this.activeDefs();
    const priced = (c: Currency): boolean => defs.some((d) => d.currency === c || (c === "essence" && d.essenceCost));
    const showIf = (selector: string, show: boolean): void => {
      (this.root.querySelector(selector) as HTMLElement).classList.toggle("hidden", !show);
    };
    const depth = this.game.bests.depth;
    showIf(".crys-wrap", this.game.crystals > 0 || depth >= TERRAIN.zone2Depth || priced("crystals"));
    showIf(".green-wrap", this.game.greenCrystals > 0 || depth >= TERRAIN.zone3Depth || priced("greenCrystals"));
    showIf(".essence-wrap", this.game.essence > 0 || priced("essence"));

    this.soldierSlot = Math.min(this.soldierSlot, st.maxSoldiers - 1);
    let slotTabs = "";
    for (let i = 0; i < st.maxSoldiers; i++) {
      const active = this.activeTab === "soldier" && i === this.soldierSlot ? " active" : "";
      slotTabs += `<button class="tree-tab${active}" data-soldier-slot="${i}">${sprite("soldier", { color: UI_COLORS.soldier, scale: 1 })} #${i + 1}</button>`;
    }
    this.slotTabsEl.innerHTML = slotTabs;
    this.lifeValEl.textContent = this.game.lifetimePixels.toLocaleString();

    // Update weapon tab lock indicators.
    const tabLocks: [UpgradeBranch, string, boolean][] = [
      ["shotgun", "SHOTGUN", st.shotgunUnlocked],
      ["assault_rifle", "ASSAULT RIFLE", st.arUnlocked],
      ["rocket_launcher", "ROCKET", st.rocketUnlocked],
      ["sniper_rifle", "SNIPER", st.sniperUnlocked],
      ["katana", "KATANA", st.katanaUnlocked],
      ["drone_shepherd", "DRONES", st.droneUnlocked],
      ["prism_laser", "PRISM", st.prismUnlocked],
      ["goo_mortar", "SQUELCH", st.gooUnlocked],
      ["flamethrower", "FLAMER", st.flameUnlocked],
      ["grenade", "GRENADE", st.grenadeUnlocked],
      ["turret", "TURRET", st.turretUnlocked],
    ];
    for (const button of this.root.querySelectorAll<HTMLButtonElement>(".tree-tab[data-tab]")) {
      const branch = button.dataset.tab as UpgradeBranch;
      const label = button.dataset.label ?? button.textContent!.trim();
      button.dataset.label = label;
      const weapon = tabLocks.find(([id]) => id === branch);
      button.disabled = !this.game.upgrades.isBranchUnlocked(branch);
      button.innerHTML = button.disabled ? `${lockIcon()} ???` : tabHtml(branch, weapon?.[1] ?? label, weapon ? !weapon[2] : false);
      button.title = button.disabled ? "Locked — unlock on the Core path" : "";
      button.setAttribute("aria-label", button.disabled ? "Locked category" : weapon?.[1] ?? label);
    }
    for (const button of this.root.querySelectorAll<HTMLButtonElement>(".tree-cat-btn")) {
      const category = CATEGORIES.find((c) => c.id === button.dataset.cat)!;
      button.disabled = !category.branches.some((b) => this.game.upgrades.isBranchUnlocked(b));
      button.innerHTML = button.disabled
        ? `${lockIcon()}<span class="tree-cat-name">???</span>`
        : `${sprite(category.icon, { color: category.color, scale: 1 })}<span class="tree-cat-name">${category.name}</span><span class="cat-caret">${category.id === this.expandedCategory ? "▼" : "▶"}</span>`;
      button.title = button.disabled ? "Locked — unlock on the Core path" : category.name;
      button.setAttribute("aria-label", button.disabled ? "Locked category" : category.name);
    }
    this.updateHeaderAndScreen();

    if (this.inLoadoutScreen) {
      this.renderLoadout();
      return;
    }

    // Center hub ball is shown on Core, Resources, Blight & Pistol (where 0,0 has no upgrade node),
    // and hidden on weapon trees where their unlock node sits at (0,0).
    const hasCenterUnlockNode =
      this.activeTab === "shotgun" ||
      this.activeTab === "assault_rifle" ||
      this.activeTab === "rocket_launcher" ||
      this.activeTab === "sniper_rifle" ||
      this.activeTab === "katana" ||
      this.activeTab === "drone_shepherd" ||
      this.activeTab === "prism_laser" ||
      this.activeTab === "goo_mortar" ||
      this.activeTab === "flamethrower" ||
      this.activeTab === "grenade" ||
      this.activeTab === "turret";
    this.coreHubEl.classList.toggle("hidden", hasCenterUnlockNode);
    if (!hasCenterUnlockNode) {
      const hubSpec = TAB_ICONS[this.activeTab];
      this.coreHubEl.innerHTML =
        sprite("ring", { color: hubSpec.color, scale: 3, cls: "node-ring" }) +
        sprite("soldier", { color: hubSpec.color, scale: 3 });
    }
    this.drawCircuit(0);

    const u = this.source;
    for (const def of TREE_DEFS) {
      const btn = this.nodeEls.get(def.id)!;
      const inBranch = branchOf(def) === this.activeTab;
      btn.classList.toggle("hidden", !inBranch);
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
      if (!unlocked) lvlEl.innerHTML = lockIcon();
      else lvlEl.textContent = maxed ? "MAX" : `${lvl}/${def.maxLevel}`;
    }
  }

  show(): void {
    if (!this.game.upgrades.isBranchUnlocked(this.activeTab)) this.activeTab = "core";
    this.expandedCategory = categoryForBranch(this.activeTab);
    this.inLoadoutScreen = false;
    this.activateBranch(true);
    this.refresh();
    this.root.classList.remove("hidden");
    this.fitToScreen();
    if (!this.raf) {
      this.lastFrame = 0;
      this.raf = requestAnimationFrame(this.frame);
    }
  }

  hide(): void {
    this.hideTooltip();
    this.root.classList.add("hidden");
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.drag = null;
    this.panDrag = null;
  }

  closeAndDeploy(): void {
    this.hide();
    this.game.beginDeploy();
  }

  get visible(): boolean {
    return !this.root.classList.contains("hidden");
  }
}
