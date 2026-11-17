import { sectorCount } from "../world/labMap";
import { COLORS } from "../config";
import { SECTOR_CELLS, sectorBounds, sectorTier, type LabFrame, type LabWorldDef } from "../world/labMap";
import { LIGHT_KIND, type PixelWorld, type RoomLight } from "../world/PixelWorld";
import { hash2, valueNoise } from "../core/math";
import { lateMaterial, materialColor, TEX } from "./materials";
import { atmosphereAt } from "../world/worldAtmosphere";
import type { TerrainRenderer } from "./TerrainRenderer";

/** Edge of a sector picture in pixels: the terrain's own texels, one per quarter cell. */
export const THUMB_SIZE = SECTOR_CELLS * TEX;

/** Dim warm ambient the lab map shows rooms under; lights add on top. */
const AMBIENT = "rgb(52, 48, 44)";
/** How much the lit picture is brightened afterward, so matte walls read at map size. */
const EXPOSURE = 2.1;

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
  const sectors = sectorCount(frame.def);
  for (let s = 0; s < sectors; s++) {
    const canvas = makeCanvas();
    const g = canvas.getContext("2d")!;
    const b = sectorBounds(frame, s);
    const col = s % frame.def.sectors;
    const row = (s - col) / frame.def.sectors;
    const atmo = frame.def.framework ? atmosphereAt(frame.def, col, row) : null;
    if (frame.def.id === 3) {
      // Smoothly blend forest open-floor background across tier bands (no hard sector seams)
      const bgImg = g.createImageData(THUMB_SIZE, THUMB_SIZE);
      const step = 4;
      for (let ty = 0; ty < THUMB_SIZE; ty += step) {
        for (let tx = 0; tx < THUMB_SIZE; tx += step) {
          const a = atmosphereAt(frame.def, col + (tx + step * 0.5) / THUMB_SIZE - 0.5, row + (ty + step * 0.5) / THUMB_SIZE - 0.5)!;
          const r = Math.round(a.background[0] * 0.65);
          const gr = Math.round(a.background[1] * 0.65);
          const bl = Math.round(a.background[2] * 0.65);
          for (let dy = 0; dy < step; dy++) {
            for (let dx = 0; dx < step; dx++) {
              const idx = ((ty + dy) * THUMB_SIZE + (tx + dx)) * 4;
              bgImg.data[idx] = r;
              bgImg.data[idx + 1] = gr;
              bgImg.data[idx + 2] = bl;
              bgImg.data[idx + 3] = 255;
            }
          }
        }
      }
      g.putImageData(bgImg, 0, 0);
    } else {
      g.fillStyle = atmo
        ? `rgb(${Math.round(atmo.background[0] * 0.65)}, ${Math.round(atmo.background[1] * 0.65)}, ${Math.round(atmo.background[2] * 0.65)})`
        : COLORS.background;
      g.fillRect(0, 0, THUMB_SIZE, THUMB_SIZE);
    }
    terrain.drawRegion(g, b.x0, b.y0, SECTOR_CELLS, SECTOR_CELLS);

    // Lightmap for this sector.
    lg.globalCompositeOperation = "source-over";
    const ambScale = frame.def.id === 5 ? 0.85 : 0.55;
    if (frame.def.id === 3) {
      const ambImg = lg.createImageData(THUMB_SIZE, THUMB_SIZE);
      const step = 4;
      for (let ty = 0; ty < THUMB_SIZE; ty += step) {
        for (let tx = 0; tx < THUMB_SIZE; tx += step) {
          const a = atmosphereAt(frame.def, col + (tx + step * 0.5) / THUMB_SIZE - 0.5, row + (ty + step * 0.5) / THUMB_SIZE - 0.5)!;
          const r = Math.round(a.ambient[0] * ambScale);
          const gr = Math.round(a.ambient[1] * ambScale);
          const bl = Math.round(a.ambient[2] * ambScale);
          for (let dy = 0; dy < step; dy++) {
            for (let dx = 0; dx < step; dx++) {
              const idx = ((ty + dy) * THUMB_SIZE + (tx + dx)) * 4;
              ambImg.data[idx] = r;
              ambImg.data[idx + 1] = gr;
              ambImg.data[idx + 2] = bl;
              ambImg.data[idx + 3] = 255;
            }
          }
        }
      }
      lg.putImageData(ambImg, 0, 0);
    } else {
      lg.fillStyle = atmo
        ? `rgb(${Math.round(atmo.ambient[0] * ambScale)}, ${Math.round(atmo.ambient[1] * ambScale)}, ${Math.round(atmo.ambient[2] * ambScale)})`
        : AMBIENT;
      lg.fillRect(0, 0, THUMB_SIZE, THUMB_SIZE);
    }
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

const uncharted = new Map<string, HTMLCanvasElement>();

/**
 * An unexplored sector: dark rock tinted by its tier's material. Tells the
 * player what tier waits there, nothing more.
 */
export function renderUncharted(def: LabWorldDef, sector: number): HTMLCanvasElement {
  const key = `${def.id}:${sector}`;
  const hit = uncharted.get(key);
  if (hit) return hit;
  const canvas = makeCanvas();
  const g = canvas.getContext("2d")!;
  const img = g.createImageData(THUMB_SIZE, THUMB_SIZE);
  const tier = sectorTier(def, sector);
  const env = def.environment;
  const base = materialColor(tier, def.framework);
  const col = sector % def.sectors;
  const row = (sector - col) / def.sectors;
  const sc = def.start % def.sectors;
  const sr = (def.start - sc) / def.sectors;
  const [b0, b1] = def.bands;
  const rgb: [number, number, number] = [0, 0, 0];
  for (let y = 0; y < THUMB_SIZE; y++) {
    for (let x = 0; x < THUMB_SIZE; x++) {
      const gx = col * THUMB_SIZE + x;
      const gy = row * THUMB_SIZE + y;
      let t = tier;
      if (def.id === 3) {
        const fx = col + (x + 0.5) / THUMB_SIZE - 0.5;
        const fy = row + (y + 0.5) / THUMB_SIZE - 0.5;
        const d = Math.max(Math.abs(fx - sc), Math.abs(fy - sr));
        if (d < b0 - 0.75) t = 7;
        else if (d < b0 + 0.75) { const u = (d - b0 + 0.75) / 1.5; t = 7 + u * u * (3 - 2 * u); }
        else if (d < b1 - 0.75) t = 8;
        else if (d < b1 + 0.75) { const u = (d - b1 + 0.75) / 1.5; t = 8 + u * u * (3 - 2 * u); }
        else t = 9;
      }
      // Plain, very dark rock in the tier's hue: no block joints, so the
      // unexplored lab reads as one mass rather than a grid.
      const m = 0.3 + valueNoise(gx, gy, 24, 7) * 0.12 + hash2(gx, gy, 9) * 0.04;
      const sample = env ? lateMaterial(env, t, gx, gy, "solid", rgb) : base;
      const i = (y * THUMB_SIZE + x) * 4;
      img.data[i] = sample[0] * m;
      img.data[i + 1] = sample[1] * m;
      img.data[i + 2] = sample[2] * m;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  uncharted.set(key, canvas);
  return canvas;
}

function makeCanvas(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = THUMB_SIZE;
  c.height = THUMB_SIZE;
  return c;
}
