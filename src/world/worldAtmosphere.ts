import type { LabWorldDef } from "./labMap";
import { SECTOR_CELLS } from "./labMap";
import type { PixelWorld } from "./PixelWorld";

type RGB = readonly [number, number, number];
export interface Atmosphere {
  zone: number; name: string; background: RGB; ambient: RGB;
  sunlight: number; canopy: number; beams: number; haze: number;
  encounters: string;
}
/** Art/encounter contracts for future biome content; rooms are currently empty. */
export const ZONE_ATMOSPHERES: Readonly<Record<number, Atmosphere>> = {
  7: { zone: 7, name: "VERDANT FOREST", background: [36, 83, 43], ambient: [210, 230, 190], sunlight: 1, canopy: 0.25, beams: 0.15, haze: 0, encounters: "No Blight; beautiful, lush green forest." },
  8: { zone: 8, name: "DUSK FOREST", background: [87, 65, 38], ambient: [160, 127, 94], sunlight: 0.5, canopy: 0.6, beams: 0.3, haze: 0.2, encounters: "Difficult Blight enemies; transition toward dusk." },
  9: { zone: 9, name: "DARK BLIGHT FOREST", background: [15, 29, 23], ambient: [65, 84, 66], sunlight: 0.15, canopy: 0.95, beams: 0.8, haze: 0.35, encounters: "Dark Blight forest; sunlight shafts through an overhead canopy." },
  10: { zone: 10, name: "FALLEN CITY", background: [110, 49, 18], ambient: [190, 126, 70], sunlight: 0.35, canopy: 0, beams: 0.1, haze: 0.75, encounters: "Penultimate zone; apocalyptic orange haze, Blight-hacked facility defenses." },
  11: { zone: 11, name: "BLIGHT MOTHERSHIP", background: [12, 10, 27], ambient: [95, 76, 125], sunlight: 0, canopy: 0, beams: 0, haze: 0.1, encounters: "Final zone: the Blight mother ship in space." },
};

export function atmosphereAt(def: LabWorldDef, col: number, row: number): Atmosphere | null {
  if (!def.framework) return null;
  if (def.id !== 3) return ZONE_ATMOSPHERES[def.tierBase + 1];
  const distance = Math.max(Math.abs(col - def.start % def.sectors), Math.abs(row - Math.floor(def.start / def.sectors)));
  let a = ZONE_ATMOSPHERES[7], b = a, blend = 0;
  for (const [boundary, from, to] of [[def.bands[0], 7, 8], [def.bands[1], 8, 9]]) {
    if (distance >= boundary - 0.75) {
      a = ZONE_ATMOSPHERES[from]; b = ZONE_ATMOSPHERES[to];
      const t = Math.max(0, Math.min(1, (distance - boundary + 0.75) / 1.5));
      blend = t * t * (3 - 2 * t);
    }
  }
  const mix = (x: number, y: number) => x + (y - x) * blend;
  const rgb = (x: RGB, y: RGB): RGB => [mix(x[0], y[0]), mix(x[1], y[1]), mix(x[2], y[2])];
  return { ...(blend < 0.5 ? a : b), background: rgb(a.background, b.background), ambient: rgb(a.ambient, b.ambient),
    sunlight: mix(a.sunlight, b.sunlight), canopy: mix(a.canopy, b.canopy), beams: mix(a.beams, b.beams), haze: mix(a.haze, b.haze) };
}
export function worldAtmosphere(world: PixelWorld, wx: number, wy: number): Atmosphere | null {
  const frame = world.labLayout?.frame;
  return frame ? atmosphereAt(frame.def, (wx / world.cellSize - frame.x0) / SECTOR_CELLS - 0.5,
    (wy / world.cellSize - frame.y0) / SECTOR_CELLS - 0.5) : null;
}
