import type { Game } from "../Game";
import {
  CENTER_SECTOR,
  LAB_BLUEPRINT,
  SECTORS_PER_SIDE,
  SECTOR_CHARS,
  sectorName,
  sectorRing,
  zoneForSectorRing,
} from "../world/labMap";

/** Pixels per blueprint character in a sector thumbnail. */
const CHAR_PX = 4;
const THUMB_PX = SECTOR_CHARS * CHAR_PX;

type RGB = readonly [number, number, number];

/** Matte rock behind each tier's thumbnails (tier 1 concrete, 2 rusted iron, 3 bronze). */
const ROCK: readonly RGB[] = [
  [38, 42, 48],
  [52, 36, 32],
  [50, 42, 28],
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
  private tiles: HTMLButtonElement[] = [];
  private canvases: HTMLCanvasElement[] = [];
  private selected = CENTER_SECTOR;

  constructor(parent: HTMLElement, private game: Game) {
    this.root = document.createElement("div");
    this.root.className = "overlay labmap-overlay hidden";
    this.root.innerHTML = `
      <div class="panel labmap-panel">
        <div class="panel-title">SELECT SECTOR</div>
        <div class="labmap-grid"></div>
        <div class="labmap-info"></div>
        <div class="panel-actions">
          <button class="btn" data-act="back">BACK <span class="kbd">ESC</span></button>
          <button class="btn btn-primary" data-act="deploy">DEPLOY <span class="kbd">SPACE</span></button>
        </div>
      </div>
    `;
    this.grid = this.root.querySelector(".labmap-grid") as HTMLDivElement;
    this.info = this.root.querySelector(".labmap-info") as HTMLDivElement;
    this.deployBtn = this.root.querySelector('[data-act="deploy"]') as HTMLButtonElement;
    this.buildGrid();
    this.root.querySelector('[data-act="back"]')!.addEventListener("click", () => this.back());
    this.deployBtn.addEventListener("click", () => this.deploy());
    parent.append(this.root);
  }

  get visible(): boolean {
    return !this.root.classList.contains("hidden");
  }

  show(): void {
    const spawn = this.game.save.data.lab.spawn;
    this.selected = this.game.canDeployInto(spawn) ? spawn : CENTER_SECTOR;
    this.render();
    this.root.classList.remove("hidden");
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
      const col = Math.max(0, Math.min(SECTORS_PER_SIDE - 1, (this.selected % SECTORS_PER_SIDE) + d[0]));
      const row = Math.max(0, Math.min(SECTORS_PER_SIDE - 1, Math.floor(this.selected / SECTORS_PER_SIDE) + d[1]));
      this.select(row * SECTORS_PER_SIDE + col);
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
    const n = SECTORS_PER_SIDE;
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
    for (let r = 0; r < n; r++) {
      this.grid.append(label(String(r + 1)));
      for (let c = 0; c < n; c++) {
        const s = r * n + c;
        const tile = document.createElement("button");
        tile.className = "labmap-tile";
        tile.setAttribute("aria-label", `Sector ${sectorName(s)}`);
        const canvas = document.createElement("canvas");
        canvas.width = THUMB_PX;
        canvas.height = THUMB_PX;
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

  private render(): void {
    const progress = this.game.labProgress;
    for (let s = 0; s < this.tiles.length; s++) {
      const discovered = progress.discovered.has(s);
      const conquered = progress.conquered.has(s);
      const tier = zoneForSectorRing(sectorRing(s)) + 1;
      const tile = this.tiles[s];
      tile.classList.toggle("discovered", discovered);
      tile.classList.toggle("conquered", conquered);
      tile.classList.toggle("selected", s === this.selected);
      tile.dataset.tier = String(tier);
      drawSectorThumb(this.canvases[s], s, discovered, conquered);
    }
    const s = this.selected;
    const tier = zoneForSectorRing(sectorRing(s)) + 1;
    const name = sectorName(s);
    let status: string;
    if (!progress.discovered.has(s)) status = "UNEXPLORED";
    else if (progress.conquered.has(s)) status = s === CENTER_SECTOR ? "STAGING AREA - SECURE" : "CONQUERED - SAFE TO DEPLOY";
    else {
      const left = progress.generatorCount(s);
      status = `${left} BLIGHT GENERATOR${left === 1 ? "" : "S"} ACTIVE`;
    }
    this.info.innerHTML = `<b>${name}</b> <span class="labmap-tier t${tier}">TIER ${tier}</span> ${status}`;
    this.deployBtn.disabled = !this.game.canDeployInto(s);
  }
}

/** Paint one sector's thumbnail from the blueprint (blank until discovered). */
function drawSectorThumb(canvas: HTMLCanvasElement, sector: number, discovered: boolean, conquered: boolean): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const img = ctx.createImageData(THUMB_PX, THUMB_PX);
  const zone = zoneForSectorRing(sectorRing(sector));
  const col0 = (sector % SECTORS_PER_SIDE) * SECTOR_CHARS;
  const row0 = Math.floor(sector / SECTORS_PER_SIDE) * SECTOR_CHARS;
  const lines = LAB_BLUEPRINT;
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
  const rock = discovered ? ROCK[zone] : ([14, 17, 23] as RGB);
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
