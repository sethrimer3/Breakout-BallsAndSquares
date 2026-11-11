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
    const tier = sectorTier(f.def, s);
    const archetype = s % 3;

    for (let y = b.y0 + 4; y < b.y1 - 3; y++)
      for (let x = b.x0 + 4; x < b.x1 - 3; x++) {
        const dx = x - cx,
          dy = y - cy;
        let open = false;

        if (forest) {
          // Forest has 3 spatial archetypes:
          // 0: Wide open glade with natural rock/tree cover mounds on diagonals.
          // 1: Winding serpentine glade with a central cover cluster.
          // 2: Tactical flanking groves with split avenues and cover bluffs.
          if (archetype === 0) {
            const baseR = 16 + 2 * Math.cos(dy * 0.4);
            const inGlade = dx * dx + dy * dy < baseR * baseR;
            // Place diagonal cover mounds in tiers 8 and 9 to allow flanking/cover from patrols
            const inMound =
              tier > 7 &&
              ((Math.abs(dx - 7) < 3 && Math.abs(dy - 7) < 3) ||
                (Math.abs(dx + 7) < 3 && Math.abs(dy + 7) < 3));
            open = inGlade && !inMound;
          } else if (archetype === 1) {
            const r = 14 + 4 * Math.sin(Math.atan2(dy, dx) * 4 + s);
            const inClearing = dx * dx + dy * dy < r * r;
            // Center natural obstacle creating circular flanking combat lanes
            const inCenterIsle =
              tier > 7 && dx * dx + dy * dy < 16 && dx * dx + dy * dy >= 4;
            open = inClearing && !inCenterIsle;
          } else {
            // Twin flanking clearings connected through center
            const leftLobe = (dx + 6) * (dx + 6) + dy * dy < 100;
            const rightLobe = (dx - 6) * (dx - 6) + dy * dy < 100;
            const bridge = Math.abs(dy) < 5 && Math.abs(dx) < 8;
            open = leftLobe || rightLobe || bridge;
          }
        } else if (f.def.id === 4) {
          // City: Street grids with crossfire corners, barricade ruins, and perimeter approaches.
          const inBoulevard = Math.abs(dx) < 4 || Math.abs(dy) < 4;
          const inRingAlley =
            Math.abs(dx) < 15 &&
            Math.abs(dy) < 15 &&
            Math.abs(dx) > 7 &&
            Math.abs(dy) > 7;
          // Tactical barricade ruins in the intersection to duck behind turret fire
          const inCornerBarricade =
            (dx === 5 || dx === -5) && (dy === 5 || dy === -5);
          open = (inBoulevard || inRingAlley) && !inCornerBarricade;
        } else {
          // Ship (World 5): Armored chambers, guard plazas, and maintenance service conduits.
          if (archetype === 0) {
            // Central command bay with flanking side alcoves
            open =
              Math.abs(dx) < 11 &&
              Math.abs(dy) < 10 &&
              !(Math.abs(dx) > 5 && Math.abs(dy) > 4 && Math.abs(dx) < 8);
          } else if (archetype === 1) {
            // Cross corridor with dual security bunkers
            open =
              Math.abs(dx) < 4 ||
              Math.abs(dy) < 4 ||
              (Math.abs(dx) < 12 && Math.abs(dy) < 8 && Math.abs(dx) > 5);
          } else {
            // Wide hangar bay with dual pillar cover
            const inHangar = Math.abs(dx) < 13 && Math.abs(dy) < 9;
            const inPillar =
              (Math.abs(dx - 5) <= 1 || Math.abs(dx + 5) <= 1) &&
              Math.abs(dy) <= 2;
            open = inHangar && !inPillar;
          }
        }
        if (open) clear(x, y);
      }
    // Join every clearing to the authored corridors; leave cover on diagonals.
    for (let d = -25; d <= 25; d++)
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
    // Checkpoints across corridors: World 4 city facility uses 3-cell bulkheads (45,000 HP/cell).
    // World 5 mothership uses deep 5-cell reinforced bulkheads (65,000 HP/cell, 325,000 HP total)
    // requiring high-level Siege Drills or sustained squad breaches under pressure.
    const bulkheadDepth = f.def.id === 5 ? 5 : 3;
    for (const edge of [-18, 18])
      for (let d = -3; d <= 3; d++)
        for (let depth = 0; depth < bulkheadDepth; depth++)
          for (const [x, y] of [
            [cx + d, cy + edge + depth],
            [cx + edge + depth, cy + d],
          ]) {
            const i = y * w.width + x;
            w.health[i] = f.def.id === 5 ? 65000 : 45000;
          }
  }
}
