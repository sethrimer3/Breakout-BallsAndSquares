import { LIGHT_KIND, type PixelWorld, type RoomLight } from "./PixelWorld";
import { DECOR } from "./LabDetails";
import { CHAR_CELLS, type LabFrame } from "./labMap";
import type { LabLayout } from "./WorldGenerator";
import { lateBlockHealth } from "./campaignBalance";
import { hash2 } from "../core/math";

/**
 * Carves a late world (Worlds 3–5) directly from its authored blueprint:
 * fills solid terrain at tier HP, carves rooms and corridors, re-fills `#`
 * cover features, and paints `=` checkpoint bulkheads.
 */
export function carveLateBlueprint(w: PixelWorld, f: LabFrame, layout: LabLayout): void {
  for (let y = 0; y < w.height; y++) {
    for (let x = 0; x < w.width; x++) {
      const i = y * w.width + x;
      w.health[i] = lateBlockHealth(w.fillTierAt(x, y), w.tierProgress(x, y));
      w.wall[i] = 0;
      w.decor[i] = 0;
    }
  }

  const clear = (x: number, y: number): void => {
    if (!w.inBounds(x, y)) return;
    const i = y * w.width + x;
    w.health[i] = 0;
    w.wall[i] = 0;
    w.decor[i] = DECOR.cleanFloor;
  };

  for (const room of layout.rooms) {
    for (let y = room.y; y < room.y + room.size; y++) {
      for (let x = room.x; x < room.x + room.size; x++) clear(x, y);
    }
  }

  for (const seg of layout.corridors) {
    for (let y = seg.y0; y <= seg.y1; y++) {
      for (let x = seg.x0; x <= seg.x1; x++) clear(x, y);
    }
  }

  const lines = f.def.blueprint;
  const rows = lines.length;
  const cols = lines[0]?.length ?? 0;
  const at = (c: number, r: number): string => (r >= 0 && r < rows && c >= 0 && c < cols ? lines[r][c] : ".");
  const mid = (CHAR_CELLS - 1) >> 1;
  const bulkheadDepth = f.def.id === 5 ? 5 : 3;
  const halfDepth = (bulkheadDepth - 1) >> 1;
  const bulkheadHp = f.def.id === 5 ? 65000 : 45000;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const ch = lines[row][col];
      if (ch === "#") {
        const x0 = f.x0 + col * CHAR_CELLS;
        const y0 = f.y0 + row * CHAR_CELLS;
        for (let y = y0; y < y0 + CHAR_CELLS; y++) {
          for (let x = x0; x < x0 + CHAR_CELLS; x++) {
            if (!w.inBounds(x, y)) continue;
            const i = y * w.width + x;
            w.health[i] = lateBlockHealth(w.fillTierAt(x, y), w.tierProgress(x, y));
            w.wall[i] = 0;
            w.decor[i] = 0;
          }
        }
      } else if (ch === "=") {
        const cx = f.x0 + col * CHAR_CELLS + mid;
        const cy = f.y0 + row * CHAR_CELLS + mid;
        const h = "-+=".includes(at(col - 1, row)) || "-+=".includes(at(col + 1, row));
        const v = "|+=".includes(at(col, row - 1)) || "|+=".includes(at(col, row + 1));
        const x0 = v && !h ? cx - mid : cx - halfDepth;
        const x1 = v && !h ? cx + mid : cx + halfDepth;
        const y0 = v && !h ? cy - halfDepth : cy - mid;
        const y1 = v && !h ? cy + halfDepth : cy + mid;
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            if (!w.inBounds(x, y)) continue;
            const i = y * w.width + x;
            w.health[i] = bulkheadHp;
            w.armored[i] = 1;
            w.wall[i] = 0;
            w.decor[i] = 0;
          }
        }
      }
    }
  }
}

/**
 * Installs destructible `LightingSystem` fixtures for City (burning windows &
 * streetlights) and Mothership (organic conduit lights & bulkhead warning lamps).
 * Forest (World 3) uses ambient/canopy/sun-beam lighting without artificial fixtures.
 */
export function installLateLights(w: PixelWorld, f: LabFrame, layout: LabLayout): void {
  if (f.def.id < 4) return;
  const seed = f.def.seed;
  const tryPlace = (
    wx: number,
    wy: number,
    face: RoomLight["wallFace"],
    kind: RoomLight["kind"],
    clip: { cx0: number; cy0: number; cx1: number; cy1: number },
    phase: number,
  ): void => {
    if (!w.inBounds(wx, wy) || !w.solidAt(wx, wy)) return;
    const dx = face === "east" ? 1 : face === "west" ? -1 : 0;
    const dy = face === "south" ? 1 : face === "north" ? -1 : 0;
    if (!w.inBounds(wx + dx, wy + dy) || w.solidAt(wx + dx, wy + dy)) return;
    w.roomLights.push({
      kind,
      x0: wx,
      y0: wy,
      x1: wx,
      y1: wy,
      cx0: Math.max(0, clip.cx0 - 1),
      cy0: Math.max(0, clip.cy0 - 1),
      cx1: Math.min(w.width - 1, clip.cx1 + 1),
      cy1: Math.min(w.height - 1, clip.cy1 + 1),
      wallFace: face,
      phase,
    });
  };

  if (f.def.id === 4) {
    // City: burning-window & streetlight fixtures along building perimeters facing open streets
    for (const room of layout.rooms) {
      const clip = { cx0: room.x, cy0: room.y, cx1: room.x + room.size - 1, cy1: room.y + room.size - 1 };
      const step = 11;
      for (let x = room.x + 3; x <= room.x + room.size - 4; x += step) {
        const roll = hash2(x, room.y, seed + 17);
        if (roll < 0.7) tryPlace(x, room.y - 1, "south", roll < 0.35 ? LIGHT_KIND.dim : LIGHT_KIND.flicker, clip, roll);
        const roll2 = hash2(x, room.y + room.size, seed + 19);
        if (roll2 < 0.7) tryPlace(x, room.y + room.size, "north", roll2 < 0.35 ? LIGHT_KIND.dim : LIGHT_KIND.flicker, clip, roll2);
      }
      for (let y = room.y + 3; y <= room.y + room.size - 4; y += step) {
        const roll = hash2(room.x, y, seed + 23);
        if (roll < 0.7) tryPlace(room.x - 1, y, "east", roll < 0.35 ? LIGHT_KIND.dim : LIGHT_KIND.flicker, clip, roll);
        const roll2 = hash2(room.x + room.size, y, seed + 29);
        if (roll2 < 0.7) tryPlace(room.x + room.size, y, "west", roll2 < 0.35 ? LIGHT_KIND.dim : LIGHT_KIND.flicker, clip, roll2);
      }
    }
    return;
  }

  // Mothership: pulsing organic conduit lights along corridors + bulkhead warning lamps
  for (const seg of layout.corridors) {
    const clip = { cx0: seg.x0 - 4, cy0: seg.y0 - 4, cx1: seg.x1 + 4, cy1: seg.y1 + 4 };
    if (seg.axis === "h") {
      for (let x = seg.x0 + 4; x <= seg.x1 - 4; x += 10) {
        const roll = hash2(x, seg.y0, seed + 31);
        tryPlace(x, seg.y0 - 1, "south", LIGHT_KIND.flicker, clip, roll);
        tryPlace(x, seg.y1 + 1, "north", LIGHT_KIND.flicker, clip, (roll + 0.5) % 1);
      }
    } else {
      for (let y = seg.y0 + 4; y <= seg.y1 - 4; y += 10) {
        const roll = hash2(seg.x0, y, seed + 37);
        tryPlace(seg.x0 - 1, y, "east", LIGHT_KIND.flicker, clip, roll);
        tryPlace(seg.x1 + 1, y, "west", LIGHT_KIND.flicker, clip, (roll + 0.5) % 1);
      }
    }
  }
  const lines = f.def.blueprint;
  const mid = (CHAR_CELLS - 1) >> 1;
  for (let row = 0; row < lines.length; row++) {
    for (let col = 0; col < lines[row].length; col++) {
      if (lines[row][col] !== "=") continue;
      const cx = f.x0 + col * CHAR_CELLS + mid;
      const cy = f.y0 + row * CHAR_CELLS + mid;
      const clip = { cx0: cx - 10, cy0: cy - 10, cx1: cx + 10, cy1: cy + 10 };
      tryPlace(cx - 4, cy, "east", LIGHT_KIND.dim, clip, 0.2);
      tryPlace(cx + 4, cy, "west", LIGHT_KIND.dim, clip, 0.7);
      tryPlace(cx, cy - 4, "south", LIGHT_KIND.dim, clip, 0.4);
      tryPlace(cx, cy + 4, "north", LIGHT_KIND.dim, clip, 0.9);
    }
  }
}
