import { COLORS } from "../config";
import { SECTOR_CELLS, SECTORS_PER_SIDE, sectorBounds, sectorRing, zoneForSectorRing, type LabFrame } from "../world/labMap";
import { LIGHT_KIND, type PixelWorld, type RoomLight } from "../world/PixelWorld";
import { MATERIAL_BASE, TEX, materialShade } from "./materials";
import type { TerrainRenderer } from "./TerrainRenderer";

/** Edge of a sector picture in pixels: the terrain's own texels, one per quarter cell. */
export const THUMB_SIZE = SECTOR_CELLS * TEX;

/** Dim warm ambient the lab map shows rooms under; lights add on top. */
const AMBIENT = "rgb(78, 72, 66)";
/** How much the lit picture is brightened afterward, so matte walls read at map size. */
const EXPOSURE = 1.9;

type LightLook = { rgb: string; radius: number; alpha: number };

const PANEL_LOOK: Partial<Record<RoomLight["kind"], LightLook>> = {
  [LIGHT_KIND.bright]: { rgb: "205, 222, 255", radius: 9, alpha: 0.95 },
  [LIGHT_KIND.dim]: { rgb: "255, 214, 160", radius: 7, alpha: 0.7 },
  [LIGHT_KIND.flicker]: { rgb: "190, 255, 220", radius: 5, alpha: 0.35 },
};

/**
 * Pictures of every sector of the lab as it stands, built from the real
 * terrain and floor textures and lit the way the game lights them: a dim warm
 * ambient, pools under the ceiling panels, an even wash in pristine rooms and
 * a pink glow over rooms whose Blight Core still lives. No outlines or glows
 * beyond what the lab's own lights would throw.
 */
export function renderSectorThumbs(world: PixelWorld, terrain: TerrainRenderer, frame: LabFrame): HTMLCanvasElement[] {
  const out: HTMLCanvasElement[] = [];
  const light = makeCanvas();
  const lg = light.getContext("2d")!;
  const sectors = SECTORS_PER_SIDE * SECTORS_PER_SIDE;
  for (let s = 0; s < sectors; s++) {
    const canvas = makeCanvas();
    const g = canvas.getContext("2d")!;
    const b = sectorBounds(frame, s);
    g.fillStyle = COLORS.background;
    g.fillRect(0, 0, THUMB_SIZE, THUMB_SIZE);
    terrain.drawRegion(g, b.x0, b.y0, SECTOR_CELLS, SECTOR_CELLS);

    // Lightmap for this sector.
    lg.globalCompositeOperation = "source-over";
    lg.fillStyle = AMBIENT;
    lg.fillRect(0, 0, THUMB_SIZE, THUMB_SIZE);
    lg.globalCompositeOperation = "lighter";
    const lights = world.roomLights.filter((l) => l.cx1 >= b.x0 && l.cy1 >= b.y0 && l.cx0 <= b.x1 && l.cy0 <= b.y1);
    for (const l of lights) addLight(lg, world, l, b.x0, b.y0);

    g.globalCompositeOperation = "multiply";
    g.drawImage(light, 0, 0);
    g.globalCompositeOperation = "source-over";
    expose(g);
    // The panels themselves, over the lit picture.
    g.globalCompositeOperation = "lighter";
    for (const l of lights) {
      const look = PANEL_LOOK[l.kind];
      if (!look) continue;
      g.fillStyle = `rgba(${look.rgb}, ${look.alpha * 0.8})`;
      g.fillRect((l.x0 - b.x0) * TEX + 1, (l.y0 - b.y0) * TEX + 1, (l.x1 - l.x0 + 1) * TEX - 2, (l.y1 - l.y0 + 1) * TEX - 2);
    }
    g.globalCompositeOperation = "source-over";
    out.push(canvas);
  }
  return out;
}

function addLight(g: CanvasRenderingContext2D, world: PixelWorld, l: RoomLight, ox: number, oy: number): void {
  const clipX = (l.cx0 - ox) * TEX;
  const clipY = (l.cy0 - oy) * TEX;
  const clipW = (l.cx1 - l.cx0 + 1) * TEX;
  const clipH = (l.cy1 - l.cy0 + 1) * TEX;
  g.save();
  g.beginPath();
  g.rect(clipX, clipY, clipW, clipH);
  g.clip();
  if (l.kind === LIGHT_KIND.wash) {
    g.fillStyle = "rgba(150, 150, 146, 0.6)";
    g.fillRect(clipX, clipY, clipW, clipH);
  } else {
    let look = PANEL_LOOK[l.kind];
    if (l.kind === LIGHT_KIND.blight) {
      const core = l.coreId ? world.blightCores[l.coreId - 1] : undefined;
      look = core?.alive ? { rgb: "255, 64, 146", radius: Math.max(l.cx1 - l.cx0, l.cy1 - l.cy0) * 0.6 + 2, alpha: 0.85 } : undefined;
    }
    if (look) {
      const x = ((l.x0 + l.x1 + 1) / 2 - ox) * TEX;
      const y = ((l.y0 + l.y1 + 1) / 2 - oy) * TEX;
      const r = look.radius * TEX;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, `rgba(${look.rgb}, ${look.alpha})`);
      grad.addColorStop(0.5, `rgba(${look.rgb}, ${look.alpha * 0.35})`);
      grad.addColorStop(1, `rgba(${look.rgb}, 0)`);
      g.fillStyle = grad;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }
  g.restore();
}

/** Brighten the multiplied picture so the dark, matte lab still reads at map size. */
function expose(g: CanvasRenderingContext2D): void {
  const img = g.getImageData(0, 0, THUMB_SIZE, THUMB_SIZE);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = Math.min(255, d[i] * EXPOSURE);
    d[i + 1] = Math.min(255, d[i + 1] * EXPOSURE);
    d[i + 2] = Math.min(255, d[i + 2] * EXPOSURE);
  }
  g.putImageData(img, 0, 0);
}

const uncharted = new Map<number, HTMLCanvasElement>();

/**
 * An unexplored sector: only its tier's bare material, very dark, as if seen
 * through a survey hatch. Tells the player what tier waits there, nothing more.
 */
export function renderUncharted(sector: number): HTMLCanvasElement {
  const hit = uncharted.get(sector);
  if (hit) return hit;
  const canvas = makeCanvas();
  const g = canvas.getContext("2d")!;
  const img = g.createImageData(THUMB_SIZE, THUMB_SIZE);
  const tier = zoneForSectorRing(sectorRing(sector)) + 1;
  const base = MATERIAL_BASE[tier];
  const col = sector % SECTORS_PER_SIDE;
  const row = (sector - col) / SECTORS_PER_SIDE;
  for (let y = 0; y < THUMB_SIZE; y++) {
    for (let x = 0; x < THUMB_SIZE; x++) {
      const gx = col * THUMB_SIZE + x;
      const gy = row * THUMB_SIZE + y;
      // Diagonal survey hatching every 12 texels.
      const hatch = (gx + gy) % 12 === 0 ? 1.35 : 1;
      const m = materialShade(tier, gx, gy) * 0.7 * hatch;
      const i = (y * THUMB_SIZE + x) * 4;
      img.data[i] = base[0] * m;
      img.data[i + 1] = base[1] * m;
      img.data[i + 2] = base[2] * m;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  uncharted.set(sector, canvas);
  return canvas;
}

function makeCanvas(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = THUMB_SIZE;
  c.height = THUMB_SIZE;
  return c;
}
