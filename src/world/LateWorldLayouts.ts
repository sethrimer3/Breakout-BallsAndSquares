import type { PixelWorld } from "./PixelWorld";
import { DECOR } from "./LabDetails";
import { CHAR_CELLS, type LabFrame } from "./labMap";
import type { LabLayout } from "./WorldGenerator";
import { lateBlockHealth } from "./campaignBalance";

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
            w.wall[i] = 0;
            w.decor[i] = 0;
          }
        }
      }
    }
  }
}
