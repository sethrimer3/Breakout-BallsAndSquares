import type { Game } from "../Game";
import { THUMB_SIZE, renderUncharted } from "../rendering/SectorThumbs";
import { TIER_PAINT } from "../rendering/materials";
import {
  LAB_WORLDS, LAB_WORLD_COUNT,
  worldRows, worldZoneLabel,
  SECTOR_CHARS,
  gateGeometry,
  sectorAtCell,
  sectorName,
  sectorBounds,
  sectorSpawnCell,
  sectorTier,
  sectorZone,
  upgradeSpotCell,
  upgradeSpotSector,
  type LabWorldDef,
} from "../world/labMap";

/** Pixels per blueprint character in a sector thumbnail. */
const CHAR_PX = 4;
const THUMB_PX = SECTOR_CHARS * CHAR_PX;

type RGB = readonly [number, number, number];

/** Matte rock behind each tier band's thumbnails (zone 1: concrete, rusted iron, bronze). */
const ROCK: readonly RGB[] = [
  [38, 42, 48],
  [52, 36, 32],
  [50, 42, 28],
];
/** Zone 2's bands: resin, chitin, carapace. */
const ALIEN_ROCK: readonly RGB[] = [
  [46, 30, 42],
  [30, 40, 38],
  [28, 22, 30],
];
const FLOOR: RGB = [176, 168, 152];
const FLOOR_EDGE: RGB = [96, 90, 82];
const BLIGHT: RGB = [140, 40, 88];
const BLIGHT_CORE: RGB = [232, 84, 150];
const SCAR: RGB = [118, 100, 104];
const GLASS: RGB = [98, 156, 170];

/**
 * The lab map: a grid of the hand-made lab's sectors, like a surveyor's sheet.
 * Discovered sectors show their rooms and hallways, overrun rooms show pink
 * while their generators live, and conquered sectors carry their tier's paint
 * on the frame. Pick a conquered sector to deploy into it.
 */
export class LabMap {
  readonly root: HTMLDivElement;
  private grid: HTMLDivElement;
  private info: HTMLDivElement;
  private deployBtn: HTMLButtonElement;
  private tabs: HTMLDivElement;
  private tiles: HTMLButtonElement[] = [];
  private canvases: HTMLCanvasElement[] = [];
  private selected = 0;
  /** World the grid was built for. */
  private def: LabWorldDef = LAB_WORLDS[1];
  /** Lit pictures of each sector from the latest generated world (see SectorThumbs). */
  private thumbs: HTMLCanvasElement[] | null = null;

  constructor(parent: HTMLElement, private game: Game) {
    this.root = document.createElement("div");
    this.root.className = "overlay labmap-overlay hidden";
    this.root.innerHTML = `
      <div class="panel labmap-panel">
        <div class="panel-title">SELECT SECTOR</div>
        <div class="labmap-tabs"></div>
        <div class="labmap-grid"></div>
        <div class="labmap-info"></div>
        <div class="panel-actions">
          <button class="btn" data-act="back">BACK <span class="kbd">ESC</span></button>
          <button class="btn btn-primary" data-act="deploy">DEPLOY <span class="kbd">SPACE</span></button>
        </div>
      </div>
    `;
    this.grid = this.root.querySelector(".labmap-grid") as HTMLDivElement;
    this.tabs = this.root.querySelector(".labmap-tabs") as HTMLDivElement;
    this.info = this.root.querySelector(".labmap-info") as HTMLDivElement;
    this.deployBtn = this.root.querySelector('[data-act="deploy"]') as HTMLButtonElement;
    this.buildGrid();
    this.root.querySelector('[data-act="back"]')!.addEventListener("click", () => this.back());
    this.deployBtn.addEventListener("click", () => this.deploy());
    parent.append(this.root);
  }

  /** Pictures of every sector, taken right after the lab is generated for a run. */
  setThumbs(thumbs: HTMLCanvasElement[]): void {
    this.thumbs = thumbs;
  }

  get visible(): boolean {
    return !this.root.classList.contains("hidden");
  }

  show(): void {
    this.def = this.game.labDef;
    this.root.querySelector(".panel-title")!.textContent = `WORLD ${this.def.id} — ${this.def.name} · ${worldZoneLabel(this.def)} · ${this.def.sectors}×${worldRows(this.def)}`;
    this.buildGrid();
    const spawn = this.game.labSave.spawn;
    this.selected = this.game.canDeployInto(spawn) ? spawn : this.def.start;
    this.render();
    this.root.classList.remove("hidden");
  }

  /** Tabs for every world the squad has reached (hidden until zone 2 is). */
  private buildTabs(): void {
    const lab = this.game.save.data.lab;
    this.tabs.innerHTML = "";
    const available = this.game.devMapAccess ? LAB_WORLD_COUNT : lab.unlocked;
    this.tabs.classList.toggle("hidden", available < 2);
    for (let id = 1; id <= available; id++) {
      const def = LAB_WORLDS[id];
      const b = document.createElement("button");
      b.className = `btn labmap-tab${id === this.def.id ? " active" : ""}`;
      b.textContent = `WORLD ${id}`;
      b.title = def.name;
      b.addEventListener("click", () => this.switchWorld(id));
      this.tabs.append(b);
    }
  }

  private switchWorld(id: number): void {
    if (id === this.def.id) return;
    this.game.selectLabWorld(id);
    this.show();
  }

  hide(): void {
    this.root.classList.add("hidden");
  }

  onKey(code: string): void {
    if (code === "Space" || code === "Enter") this.deploy();
    else if (code === "Escape") this.back();
    else {
      const step: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      const d = step[code];
      if (!d) return;
      const n = this.def.sectors;
      const col = Math.max(0, Math.min(n - 1, (this.selected % n) + d[0]));
      const row = Math.max(0, Math.min(worldRows(this.def) - 1, Math.floor(this.selected / n) + d[1]));
      this.select(row * n + col);
    }
  }

  private back(): void {
    this.hide();
    this.game.openMainMenu();
  }

  private deploy(): void {
    if (!this.game.canDeployInto(this.selected)) return;
    this.hide();
    this.game.deployInto(this.selected);
  }

  private select(sector: number): void {
    this.selected = sector;
    this.render();
  }

  private buildGrid(): void {
    this.buildTabs();
    const n = this.def.sectors;
    this.grid.innerHTML = "";
    this.tiles = [];
    this.canvases = [];
    this.root.style.setProperty("--sectors", String(n));
    const label = (text: string): HTMLDivElement => {
      const el = document.createElement("div");
      el.className = "labmap-label";
      el.textContent = text;
      return el;
    };
    const letters = Array.from({ length: n }, (_, c) => String.fromCharCode(65 + c));
    const edgeRow = (): void => {
      this.grid.append(label(""));
      for (const l of letters) this.grid.append(label(l));
      this.grid.append(label(""));
    };
    edgeRow();
    for (let r = 0; r < worldRows(this.def); r++) {
      this.grid.append(label(String(r + 1)));
      for (let c = 0; c < n; c++) {
        const s = r * n + c;
        const tile = document.createElement("button");
        tile.className = "labmap-tile";
        tile.setAttribute("aria-label", `Sector ${sectorName(s, n)}`);
        const canvas = document.createElement("canvas");
        canvas.width = THUMB_SIZE;
        canvas.height = THUMB_SIZE;
        tile.append(canvas);
        tile.addEventListener("click", () => {
          if (this.selected === s && this.game.canDeployInto(s)) this.deploy();
          else this.select(s);
        });
        this.tiles.push(tile);
        this.canvases.push(canvas);
        this.grid.append(tile);
      }
      this.grid.append(label(String(r + 1)));
    }
    edgeRow();
  }

  private drawTile(s: number, discovered: boolean, conquered: boolean): void {
    const canvas = this.canvases[s];
    const g = canvas.getContext("2d");
    if (!g) return;
    g.imageSmoothingEnabled = false;
    const thumb = this.thumbs?.[s];
    if (!discovered) {
      g.drawImage(renderUncharted(this.def, s), 0, 0);
    } else if (thumb) {
      g.drawImage(thumb, 0, 0);
    } else {
      drawSectorThumb(this.scratch, this.def, s, discovered, conquered);
      g.drawImage(this.scratch, 0, 0, THUMB_SIZE, THUMB_SIZE);
    }
    // Explored ground fades in hard steps into unexplored neighbors, so the
    // edge of what the squad has seen reads as darkness, not as a grid line.
    if (discovered) {
      const n = this.def.sectors;
      const col = s % n;
      const row = (s - col) / n;
      const hidden = (c: number, r: number): boolean =>
        !this.game.devMapAccess && c >= 0 && r >= 0 && c < n && r < worldRows(this.def) && !this.game.labProgress.discovered.has(r * n + c);
      const sides = [hidden(col, row - 1), hidden(col + 1, row), hidden(col, row + 1), hidden(col - 1, row)];
      const step = 6;
      const alphas = [0.6, 0.38, 0.18];
      for (let k = 0; k < alphas.length; k++) {
        g.fillStyle = `rgba(7, 8, 11, ${alphas[k]})`;
        const o = k * step;
        if (sides[0]) g.fillRect(0, o, THUMB_SIZE, step);
        if (sides[1]) g.fillRect(THUMB_SIZE - o - step, 0, step, THUMB_SIZE);
        if (sides[2]) g.fillRect(0, THUMB_SIZE - o - step, THUMB_SIZE, step);
        if (sides[3]) g.fillRect(o, 0, step, THUMB_SIZE);
      }
    }
    this.drawMarkers(g, s);
    // A deploy beacon where the squad would land.
    const frame = this.game.world.labLayout?.frame;
    if (s === this.selected && frame && this.game.canDeployInto(s)) {
      const at = sectorSpawnCell(frame, s);
      const b = sectorBounds(frame, s);
      const k = THUMB_SIZE / (b.x1 - b.x0 + 1);
      const x = Math.round((at.cx - b.x0 + 0.5) * k);
      const y = Math.round((at.cy - b.y0 + 0.5) * k);
      const u = 4;
      g.fillStyle = "#05070d";
      for (let i = -3; i <= 3; i++) g.fillRect(x - (3 - Math.abs(i) + 1) * u, y + i * u - u / 2, (3 - Math.abs(i) + 1) * 2 * u, u);
      g.fillStyle = "#38d6ff";
      for (let i = -2; i <= 2; i++) g.fillRect(x - (2 - Math.abs(i) + 0.5) * u, y + i * u - u / 2, (2 - Math.abs(i) + 0.5) * 2 * u, u);
      g.fillStyle = "#dff8ff";
      g.fillRect(x - u / 2, y - u / 2, u, u);
    }
  }

  /**
   * Map markings that show whether or not a sector is explored: world gates
   * (a heavy door in their tier's paint on the lab's edge) and the sealed
   * caches where special upgrades will be (a muted gold diamond).
   */
  private drawMarkers(g: CanvasRenderingContext2D, s: number): void {
    const frame = this.game.world.labLayout?.frame;
    if (!frame || frame.def !== this.def) return;
    const b = sectorBounds(frame, s);
    const k = THUMB_SIZE / (b.x1 - b.x0 + 1);
    const u = Math.round(THUMB_SIZE / 28);
    for (const gate of this.def.gates) {
      const { door } = gateGeometry(frame, gate);
      const vertical = gate.side === "north" || gate.side === "south";
      const ix = vertical ? (door.x0 + door.x1) / 2 : gate.side === "east" ? door.x0 - 1 : door.x1 + 1;
      const iy = vertical ? gate.side === "south" ? door.y0 - 1 : door.y1 + 1 : (door.y0 + door.y1) / 2;
      if (sectorAtCell(frame, ix, iy) !== s) continue;
      const along0 = Math.round(((vertical ? door.x0 - b.x0 : door.y0 - b.y0)) * k);
      const along1 = Math.round(((vertical ? door.x1 + 1 - b.x0 : door.y1 + 1 - b.y0)) * k);
      const edge = gate.side === "east" || gate.side === "south" ? THUMB_SIZE - u * 4 : 0;
      const c = TIER_PAINT[gate.tier] ?? TIER_PAINT[1];
      g.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
      if (vertical) g.fillRect(along0, edge, along1 - along0, u * 4);
      else g.fillRect(edge, along0, u * 4, along1 - along0);

    }
    const region = this.def.facility;
    const col = s % this.def.sectors, row = Math.floor(s / this.def.sectors);
    if (region && col >= region.col0 && col <= region.col1 && row >= region.row0 && row <= region.row1) {
      g.strokeStyle = "#ffb65c"; g.lineWidth = u; g.strokeRect(u, u, THUMB_SIZE - 2*u, THUMB_SIZE - 2*u);
    }
    if (this.def.teleporter?.sector === s) {
      g.fillStyle = "#6bfff0"; g.fillRect(THUMB_SIZE/2-u*2, THUMB_SIZE/2-u*2, u*4, u*4);
    }
    for (const spot of this.def.upgrades) {
      if (upgradeSpotSector(this.def, spot) !== s) continue;
      const at = upgradeSpotCell(frame, spot);
      const x = Math.round((at.cx - b.x0 + 0.5) * k);
      const y = Math.round((at.cy - b.y0 + 0.5) * k);
      g.fillStyle = "#05070d";
      for (let i = -4; i <= 4; i++) g.fillRect(x - (4 - Math.abs(i) + 1) * u, y + i * u - u / 2, (4 - Math.abs(i) + 1) * 2 * u, u);
      g.fillStyle = "#b8923a";
      for (let i = -3; i <= 3; i++) g.fillRect(x - (3 - Math.abs(i) + 0.5) * u, y + i * u - u / 2, (3 - Math.abs(i) + 0.5) * 2 * u, u);
      g.fillStyle = "#05070d";
      for (let i = -1; i <= 1; i++) g.fillRect(x - (1 - Math.abs(i) + 0.5) * u, y + i * u - u / 2, (1 - Math.abs(i) + 0.5) * 2 * u, u);
    }
  }

  private scratch = Object.assign(document.createElement("canvas"), { width: THUMB_PX, height: THUMB_PX });

  private render(): void {
    const progress = this.game.labProgress;
    for (let s = 0; s < this.tiles.length; s++) {
      const discovered = this.game.devMapAccess || progress.discovered.has(s);
      const conquered = progress.conquered.has(s);
      const tier = sectorTier(this.def, s);
      const tile = this.tiles[s];
      tile.classList.toggle("discovered", discovered);
      tile.classList.toggle("conquered", conquered);
      tile.classList.toggle("selected", s === this.selected);
      tile.dataset.tier = String(tier);
      this.drawTile(s, discovered, conquered);
    }
    const s = this.selected;
    const tier = sectorTier(this.def, s);
    const region = this.def.facility;
    const col = s % this.def.sectors, row = Math.floor(s / this.def.sectors);
    const facility = region && col >= region.col0 && col <= region.col1 && row >= region.row0 && row <= region.row1;
    const name = `W${this.def.id} ${sectorName(s, this.def.sectors)} · ZONE ${tier}${facility ? ` · ${region.name}` : ""}${this.def.teleporter?.sector === s ? " · TELEPORTER → WORLD 5" : ""}`;
    let status: string;
    if (this.game.devMapAccess) status = "DEV — DEPLOY ANYWHERE";
    else if (!progress.discovered.has(s)) status = "UNEXPLORED";
    else if (progress.conquered.has(s)) status = s === this.def.start ? (this.def.id === 1 ? "STAGING AREA - SECURE" : "GATEWAY - SECURE") : "CONQUERED - SAFE TO DEPLOY";
    else {
      const left = progress.generatorsLeft(s);
      const label = this.def.framework ? "THREAT" : "BLIGHT GENERATOR";
      status = `${left} ${label}${left === 1 ? "" : "S"} ACTIVE`;
    }
    this.info.innerHTML = `<b>${name}</b> <span class="labmap-tier t${tier}">TIER ${tier}</span> ${status}`;
    this.deployBtn.disabled = !this.game.canDeployInto(s);
  }
}

/** Paint one sector's thumbnail from the blueprint (blank until discovered). */
function drawSectorThumb(canvas: HTMLCanvasElement, def: LabWorldDef, sector: number, discovered: boolean, conquered: boolean): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const img = ctx.createImageData(THUMB_PX, THUMB_PX);
  const zone = sectorZone(def, sector);
  const col0 = (sector % def.sectors) * SECTOR_CHARS;
  const row0 = Math.floor(sector / def.sectors) * SECTOR_CHARS;
  const lines = def.blueprint;
  const at = (c: number, r: number): string => lines[r]?.[c] ?? ".";
  const isRoom = (ch: string): boolean => ch === "R" || ch === "G" || ch === "T";
  const joinsH = (ch: string): boolean => ch === "-" || ch === "+" || isRoom(ch);
  const joinsV = (ch: string): boolean => ch === "|" || ch === "+" || isRoom(ch);
  const put = (x: number, y: number, c: RGB, m = 1): void => {
    const i = (y * THUMB_PX + x) * 4;
    img.data[i] = c[0] * m;
    img.data[i + 1] = c[1] * m;
    img.data[i + 2] = c[2] * m;
    img.data[i + 3] = 255;
  };
  const rock = discovered ? (def.alien ? ALIEN_ROCK : ROCK)[zone] : ([14, 17, 23] as RGB);
  for (let y = 0; y < THUMB_PX; y++) {
    for (let x = 0; x < THUMB_PX; x++) {
      // A faint grain so blank rock still reads as stone.
      const grain = ((x * 7 + y * 13 + sector * 5) % 5) * 0.03;
      put(x, y, rock, 0.94 + grain);
    }
  }
  if (discovered) {
    for (let r = 0; r < SECTOR_CHARS; r++) {
      for (let c = 0; c < SECTOR_CHARS; c++) {
        const gc = col0 + c;
        const gr = row0 + r;
        const ch = at(gc, gr);
        const px = c * CHAR_PX;
        const py = r * CHAR_PX;
        if (isRoom(ch)) {
          const overrun = ch === "G";
          const floor = overrun ? (conquered ? SCAR : BLIGHT) : FLOOR;
          // Room edge: a darker rim where the next char is not part of the room.
          const top = !isRoom(at(gc, gr - 1));
          const bottom = !isRoom(at(gc, gr + 1));
          const left = !isRoom(at(gc - 1, gr));
          const right = !isRoom(at(gc + 1, gr));
          for (let y = 0; y < CHAR_PX; y++) {
            for (let x = 0; x < CHAR_PX; x++) {
              const rim = (top && y === 0) || (bottom && y === CHAR_PX - 1) || (left && x === 0) || (right && x === CHAR_PX - 1);
              put(px + x, py + y, rim ? FLOOR_EDGE : floor);
            }
          }
          if (ch === "T") put(px + 1, py + 1, GLASS), put(px + 2, py + 2, GLASS);
        } else if (ch === "-" || ch === "|" || ch === "+") {
          const fill = (x0: number, y0: number, x1: number, y1: number): void => {
            for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(px + x, py + y, FLOOR, 0.9);
          };
          fill(1, 1, 2, 2);
          if (joinsH(ch) && joinsH(at(gc - 1, gr))) fill(0, 1, 1, 2);
          if (joinsH(ch) && joinsH(at(gc + 1, gr))) fill(2, 1, 3, 2);
          if (joinsV(ch) && joinsV(at(gc, gr - 1))) fill(1, 0, 2, 1);
          if (joinsV(ch) && joinsV(at(gc, gr + 1))) fill(1, 2, 2, 3);
        }
      }
    }
    // Live Blight Cores: a bright heart in the middle of each overrun room.
    if (!conquered) {
      for (let r = 0; r < SECTOR_CHARS; r++) {
        for (let c = 0; c < SECTOR_CHARS; c++) {
          const gc = col0 + c;
          const gr = row0 + r;
          if (at(gc, gr) !== "G" || at(gc - 1, gr) === "G" || at(gc, gr - 1) === "G") continue;
          let span = 1;
          while (at(gc + span, gr) === "G") span++;
          const mid = Math.floor((span * CHAR_PX) / 2);
          for (let y = -1; y < 1; y++) for (let x = -1; x < 1; x++) put(c * CHAR_PX + mid + x, r * CHAR_PX + mid + y, BLIGHT_CORE);
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}
