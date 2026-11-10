import type { PixelWorld } from "./PixelWorld";
import { sectorBounds, sectorCount, sectorTier, type LabFrame } from "./labMap";
import { lateBlockHealth } from "./campaignBalance";
/** Functional encounter spaces; deliberately simple silhouettes until the art pass. */
export function designLateSpaces(w: PixelWorld, f: LabFrame): void {
  for (let y = 0; y < w.height; y++)
    for (let x = 0; x < w.width; x++) {
      const i = y * w.width + x;
      w.health[i] = lateBlockHealth(w.fillTierAt(x, y), w.tierProgress(x, y));
    }
  const clear = (x: number, y: number) => {
    if (w.inBounds(x, y)) {
      const i = y * w.width + x;
      w.health[i] = 0;
      w.wall[i] = 0;
    }
  };
  for (let s = 0; s < sectorCount(f.def); s++) {
    const b = sectorBounds(f, s),
      cx = (b.x0 + b.x1) / 2,
      cy = (b.y0 + b.y1) / 2;
    const forest = f.def.id === 3;
    for (let y = b.y0 + 4; y < b.y1 - 3; y++)
      for (let x = b.x0 + 4; x < b.x1 - 3; x++) {
        const dx = x - cx,
          dy = y - cy;
        // Forest: irregular clearings and winding trails. City: street grid and
        // crossfire islands. Ship: narrow armored halls and a central guard bay.
        const radius = 15 + 3 * Math.sin(Math.atan2(dy, dx) * 3 + s);
        const open = forest
          ? dx * dx + dy * dy < radius * radius
          : f.def.id === 4
            ? Math.abs(dx) < 4 ||
              Math.abs(dy) < 4 ||
              (Math.abs(dx) < 14 &&
                Math.abs(dy) < 14 &&
                Math.abs(dx) > 7 &&
                Math.abs(dy) > 7)
            : Math.abs(dx) < 3 ||
              Math.abs(dy) < 3 ||
              (Math.abs(dx) < 10 && Math.abs(dy) < 9);
        if (open) clear(x, y);
      }
    // Join every clearing to the authored corridors; leave cover on diagonals.
    for (let d = -23; d <= 23; d++)
      for (let q = -2; q <= 2; q++) {
        clear(Math.round(cx + d), Math.round(cy + q));
        clear(Math.round(cx + q), Math.round(cy + d));
      }
    if (
      f.def.id === 4 &&
      s % 7 >= 2 &&
      s % 7 <= 4 &&
      Math.floor(s / 7) >= 2 &&
      Math.floor(s / 7) <= 4
    ) {
      // Harden the facility perimeter; four narrow entrances remain shootable.
      for (let d = -19; d <= 19; d++)
        for (const edge of [-19, 19])
          for (const [x, y] of [
            [cx + d, cy + edge],
            [cx + edge, cy + d],
          ]) {
            if (Math.abs(d) < 2) continue;
            const i = Math.round(y) * w.width + Math.round(x);
            w.health[i] = 45000;
          }
    }
    // Navigation remains open; mining optional cover gives the tier's resources.
    if (sectorTier(f.def, s) === 7)
      for (let d = -9; d <= 9; d++) clear(Math.round(cx + d), Math.round(cy));
  }
}

/** Checkpoints are painted last so authored corridors cannot erase them. */
export function fortifyLateSpaces(w: PixelWorld, f: LabFrame): void {
  if (f.def.id < 4) return;
  for (let s = 0; s < sectorCount(f.def); s++) {
    const b = sectorBounds(f, s),
      cx = Math.round((b.x0 + b.x1) / 2),
      cy = Math.round((b.y0 + b.y1) / 2);
    const facility =
      f.def.id === 4 &&
      s % 7 >= 2 &&
      s % 7 <= 4 &&
      Math.floor(s / 7) >= 2 &&
      Math.floor(s / 7) <= 4;
    if (!facility && f.def.id !== 5) continue;
    // A three-cell-deep bulkhead crosses each hall. It can be mined through or
    // bypassed through the surrounding, equally durable material.
    for (const edge of [-18, 18])
      for (let d = -3; d <= 3; d++)
        for (let depth = 0; depth < 3; depth++)
          for (const [x, y] of [
            [cx + d, cy + edge + depth],
            [cx + edge + depth, cy + d],
          ]) {
            const i = y * w.width + x;
            w.health[i] = f.def.id === 5 ? 65000 : 45000;
          }
  }
}
