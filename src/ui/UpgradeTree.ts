import { TERRAIN } from "../config";
import type { WeaponType } from "../entities/Soldier";
import type { Game } from "../Game";
import {
  UPGRADE_BY_ID,
  UPGRADE_DEFS,
  type UpgradeBranch,
  type UpgradeDef,
  type UpgradeId,
} from "../progression/UpgradeDefinitions";
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

const TAB_ICONS: Record<UpgradeBranch, { icon: SpriteName; color: string }> = {
  core: { icon: "soldier", color: UI_COLORS.soldier },
  resources: { icon: "gold", color: UI_COLORS.gold },
  blight: { icon: "warn", color: UI_COLORS.blight },
  pistol: { icon: "pistol", color: "#ff9d3b" },
  shotgun: { icon: "shotgun", color: "#ff7832" },
  assault_rifle: { icon: "rifle", color: "#52f296" },
  rocket_launcher: { icon: "launcher", color: "#ff5c40" },
  sniper_rifle: { icon: "sniper", color: UI_COLORS.soldier },
  katana: { icon: "katana", color: "#38d6ff" },
};

const lockIcon = (): string => sprite("lock", { color: "#6d8197", scale: 1 });
const goldIcon = (): string => sprite("gold", { color: UI_COLORS.gold });

function toArt(v: number): number {
  return Math.round(v / LINK_PIXEL);
}

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
  private nodeEls = new Map<UpgradeId, HTMLButtonElement>();
  private hoveredId: UpgradeId | null = null;
  private activeTab: UpgradeBranch = "core";
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
  /** On-screen px per shell px (1 on desktop, < 1 when shrunk to fit a phone). */
  private uiScale = 1;
  /** Pointer type of the last press on a node: touch taps select before they buy. */
  private nodePressType = "mouse";
  /** Second finger on the stage: pinch zooms the tree a step at a time. */
  private stagePointers = new Map<number, { x: number; y: number }>();
  private pinchStartDist = 0;
  private raf = 0;
  private lastFrame = 0;

  constructor(parent: HTMLElement, private game: Game) {
    this.root = document.createElement("div");
    this.root.className = "overlay tree-overlay hidden";
    this.root.innerHTML = `
      <div class="tree-fit-box"><div class="tree-shell">
        <button class="tree-close" title="Close (Esc)">${sprite("close", { color: UI_COLORS.magenta })}</button>
        <div class="tree-header">
          <div class="tree-title">UPGRADE MATRIX</div>
          <div class="tree-sub">CORE SYSTEMS, WEAPON TREES &amp; SQUAD LOADOUT</div>
          <div class="tree-tabs">
            <button class="tree-tab active" data-tab="core">${tabHtml("core", "CORE")}</button>
            <button class="tree-tab" data-tab="resources">${tabHtml("resources", "RESOURCES")}</button>
            <button class="tree-tab" data-tab="blight">${tabHtml("blight", "BLIGHT")}</button>
            <button class="tree-tab" data-tab="pistol">${tabHtml("pistol", "PISTOL")}</button>
            <button class="tree-tab" data-tab="shotgun"></button>
            <button class="tree-tab" data-tab="assault_rifle"></button>
            <button class="tree-tab" data-tab="rocket_launcher"></button>
            <button class="tree-tab" data-tab="sniper_rifle"></button>
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
            <span class="crys-wrap hidden"> &nbsp; ${sprite("crystal", { color: UI_COLORS.crystal })} <span class="crys-num">0</span></span>
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
    this.loadoutWrap = this.root.querySelector(".loadout-stage") as HTMLDivElement;
    this.linksEl = this.root.querySelector(".tree-links") as HTMLCanvasElement;
    this.viewEl = this.root.querySelector(".tree-view") as HTMLDivElement;
    this.fitBtn = this.root.querySelector(".tree-fit") as HTMLButtonElement;
    this.nodesWrap = this.root.querySelector(".tree-nodes") as HTMLDivElement;
    this.tooltipEl = this.root.querySelector(".tree-tooltip") as HTMLDivElement;
    this.bankValEl = this.root.querySelector(".bank-num") as HTMLSpanElement;
    this.crysValEl = this.root.querySelector(".crys-num") as HTMLSpanElement;
    this.lifeValEl = this.root.querySelector(".life-num") as HTMLSpanElement;
    this.titleEl = this.root.querySelector(".tree-title") as HTMLDivElement;
    this.subEl = this.root.querySelector(".tree-sub") as HTMLDivElement;
    this.tabsEl = this.root.querySelector(".tree-tabs") as HTMLDivElement;
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

  /** True once the player has unlocked at least one second weapon beyond the starter Pistol. */
  isLoadoutUnlocked(): boolean {
    const st = this.game.upgrades.getSoldierStats();
    return st.shotgunUnlocked || st.arUnlocked || st.rocketUnlocked || st.sniperUnlocked;
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
    this.inLoadoutScreen = false;
    this.activeTab = tab;
    this.hideTooltip();
    this.activateBranch(true);
    this.root.querySelectorAll(".tree-tab").forEach((btn) => {
      btn.classList.toggle("active", (btn as HTMLElement).dataset.tab === tab);
    });
    this.refresh();
  }

  private updateHeaderAndScreen(): void {
    const tab = this.activeTab;
    if (this.inLoadoutScreen) {
      this.titleEl.textContent = "SQUAD LOADOUT";
      this.subEl.textContent = "EQUIP PRIMARY WEAPONS & GEAR FOR EACH SOLDIER BEFORE DEPLOYING";
    } else {
      this.titleEl.textContent = "UPGRADE MATRIX";
      if (tab === "core") {
        this.subEl.textContent = "CORE SQUAD ENHANCEMENTS — UPGRADES ALL SOLDIERS & WEAPONS";
      } else if (tab === "resources") {
        this.subEl.textContent = "RESOURCE EXTRACTION — GOLD DROPS, TIER 2 CRYSTALS & TIER 3 PLACEHOLDERS";
      } else if (tab === "blight") {
        this.subEl.textContent = "BLIGHT CONTAINMENT — REPLICATION DAMPENING & BLIGHT CORE PURGES";
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
    for (const def of UPGRADE_DEFS) {
      const to = nodePos(def.grid.col, def.grid.row);
      const btn = document.createElement("button");
      // The weapon-unlock node at the center of a tree gets a round frame.
      const round = def.grid.col === 0 && def.grid.row === 0;
      btn.className = round ? "tree-node round" : "tree-node";
      btn.style.setProperty("--node-color", def.color);
      const ring = round
        ? sprite("ring", { color: def.color, scale: 3, cls: "node-ring ring-empty" }) +
          sprite("ringFilled", { color: def.color, scale: 3, cls: "node-ring ring-filled" })
        : "";
      btn.innerHTML = `
        ${ring}
        ${sprite(def.icon, { color: def.color, scale: 3, cls: "node-icon" })}
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
      this.setView(clampView({ x, y, s: this.view.s }, this.bounds), true);
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
        );
        this.hideTooltip();
        this.setView(next, true);
      },
      { passive: false },
    );
    this.fitBtn.addEventListener("click", () => this.setView(fitView(this.bounds), false));
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
    this.setView(zoomAt(this.view, this.bounds, ratio > 1 ? 1 : -1, px, py), true);
    this.pinchStartDist = dist;
  }

  /** Shrink the whole matrix (never enlarge) so it fits small screens like phones. */
  private fitToScreen(): void {
    this.shellEl.style.transform = "";
    this.fitBoxEl.style.width = "";
    this.fitBoxEl.style.height = "";
    const w = this.shellEl.offsetWidth;
    const h = this.shellEl.offsetHeight;
    const pad = 16;
    const s = Math.min(1, (window.innerWidth - pad) / w, (window.innerHeight - pad) / h);
    this.uiScale = s;
    if (s >= 1) return;
    this.shellEl.style.transform = `scale(${s})`;
    this.fitBoxEl.style.width = `${Math.floor(w * s)}px`;
    this.fitBoxEl.style.height = `${Math.floor(h * s)}px`;
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
    const defs = UPGRADE_DEFS.filter((d) => d.branch === this.activeTab);
    const ids = defs.map((d) => d.id as string);
    if (defs.length > 0 && !defs.some((d) => d.grid.col === 0 && d.grid.row === 0)) ids.push(HUB_ID);
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
      this.setView(fitView(this.bounds), false);
    }

    const grow = sprout && !reducedMotion();
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
      const el = b.id === HUB_ID ? this.coreHubEl : this.nodeEls.get(b.id as UpgradeId)!;
      el.style.left = `${toArt(b.x) * LINK_PIXEL}px`;
      el.style.top = `${toArt(b.y) * LINK_PIXEL}px`;
    }
  }

  private syncCircuit(): void {
    const u = this.game.upgrades;
    for (const b of this.activeBodies) {
      const def = b.id === HUB_ID ? null : UPGRADE_BY_ID[b.id as UpgradeId];
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
    if (reducedMotion()) {
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
    const u = this.game.upgrades;
    for (const b of this.activeBodies) {
      if (!b.parent) continue;
      const def = UPGRADE_BY_ID[b.id as UpgradeId];
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
      this.kickChildren(def.id);
    }
  }

  /** A purchase shoves the next nodes outward, so the branch rings. */
  private kickChildren(id: UpgradeId): void {
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

  private showTooltip(def: UpgradeDef): void {
    if (this.drag?.moved) return;
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
        <div class="tt-compare">${curVal} ${sprite("chevron", { color: "#7e9bb8" })} ${nextVal}</div>
        <div class="tt-delta">${def.formatDelta()} (${def.shortDesc})</div>
        <div class="tt-cost ${canBuy ? "affordable" : "expensive"}">${goldIcon()} ${cost.toLocaleString()}</div>
      `;
    }

    this.tooltipEl.style.setProperty("--tt-color", def.color);
    this.tooltipEl.innerHTML = `
      <div class="tt-title">${def.name} <span class="tt-lvl">LV ${lvl}/${def.maxLevel}</span></div>
      ${bodyHtml}
    `;
    this.tooltipEl.classList.remove("hidden");
    // Placed on whole pixels (no centering transform) so the text stays crisp.
    const pos = this.bodies.get(def.id)!;
    const w = this.tooltipEl.offsetWidth;
    const h = this.tooltipEl.offsetHeight;
    const screenX = this.view.x + pos.x * this.view.s;
    const screenY = this.view.y + pos.y * this.view.s;
    const left = Math.min(STAGE_W - w, Math.max(0, Math.round(screenX - w / 2)));
    this.tooltipEl.style.left = `${left}px`;
    this.tooltipEl.style.top = `${Math.round(screenY - 40 * this.view.s) - h}px`;
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
    ];
    const socket = sprite("socket", { color: "#3d5267" });

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
            <button class="lc-wbtn ${curW === w.id ? "equipped" : ""} ${!w.unlocked ? "locked" : ""}" data-slot="${i}" data-weapon="${w.id}" title="${w.label}" ${!w.unlocked ? "disabled" : ""}>
              ${sprite(TAB_ICONS[w.id].icon, { color: w.unlocked ? TAB_ICONS[w.id].color : "#6d8197", scale: 2 })}
              ${w.unlocked ? `<span class="lc-wname">${w.label}</span>` : `<span class="lc-wname">${lockIcon()}</span>`}
            </button>
          `,
        )
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
          <div class="lc-section-lbl">EQUIPMENT SLOTS (COMING SOON)</div>
          <div class="lc-gear-row">
            <div class="lc-gear-slot" title="Equipment slot 1 — coming soon">${socket}</div>
            <div class="lc-gear-slot" title="Equipment slot 2 — coming soon">${socket}</div>
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
    crysWrap.classList.toggle("hidden", this.game.crystals <= 0 && this.game.bests.depth < TERRAIN.zone2Depth);
    this.lifeValEl.textContent = this.game.lifetimePixels.toLocaleString();

    // Update weapon tab lock indicators.
    const tabLocks: [UpgradeBranch, string, boolean][] = [
      ["shotgun", "SHOTGUN", st.shotgunUnlocked],
      ["assault_rifle", "ASSAULT RIFLE", st.arUnlocked],
      ["rocket_launcher", "ROCKET", st.rocketUnlocked],
      ["sniper_rifle", "SNIPER", st.sniperUnlocked],
    ];
    for (const [tabId, label, unlocked] of tabLocks) {
      const btn = this.root.querySelector(`[data-tab="${tabId}"]`) as HTMLButtonElement | null;
      if (btn) btn.innerHTML = tabHtml(tabId, label, !unlocked);
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
      this.activeTab === "sniper_rifle";
    this.coreHubEl.classList.toggle("hidden", hasCenterUnlockNode);
    if (!hasCenterUnlockNode) {
      const hubSpec = TAB_ICONS[this.activeTab];
      this.coreHubEl.innerHTML =
        sprite("ring", { color: hubSpec.color, scale: 3, cls: "node-ring" }) +
        sprite("soldier", { color: hubSpec.color, scale: 3 });
    }
    this.drawCircuit(0);

    for (const def of UPGRADE_DEFS) {
      const btn = this.nodeEls.get(def.id)!;
      const inBranch = def.branch === this.activeTab;
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
    this.game.startRun();
  }

  get visible(): boolean {
    return !this.root.classList.contains("hidden");
  }
}
