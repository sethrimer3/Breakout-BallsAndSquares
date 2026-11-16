/**
 * Where each Black Market node sits on its weapon's tree. Pure: no DOM.
 *
 * The weapon hub is at (0,0). Each path's root (the upgrade that opens it)
 * sits one cell out: the first path to the left, the second to the right and
 * a third above. Only the active path grows its research, fanning outward
 * from its root in ranks of up to three; nodes that build on another research
 * node go in the rank after.
 */
import type { MarketPath, WeaponMarket } from "../progression/BlackMarket";
import { UPGRADE_BY_ID, type UpgradeId } from "../progression/UpgradeDefinitions";

export const MARKET_HUB = "hub";

export interface MarketCell {
  col: number;
  row: number;
  /** The node this one hangs from: the hub for path roots. */
  parent: string;
}

const DIRECTIONS: readonly { x: number; y: number }[] = [
  { x: -1, y: 0 },
  { x: 1, y: 0 },
  { x: 0, y: -1 },
];
const RANK_SIZE = 3;

/** Cells for every visible node; `active` is the root of the active path, if any. */
export function marketLayout(market: WeaponMarket, active: UpgradeId | null): Map<UpgradeId, MarketCell> {
  const cells = new Map<UpgradeId, MarketCell>();
  market.paths.forEach((path, i) => {
    const dir = DIRECTIONS[i] ?? DIRECTIONS[DIRECTIONS.length - 1];
    cells.set(path.root, { col: dir.x, row: dir.y, parent: MARKET_HUB });
    if (path.root === active) layoutResearch(path, dir, cells);
  });
  return cells;
}

/** The research nodes of the active path that are shown, root excluded. */
export function researchOf(path: MarketPath): UpgradeId[] {
  return path.nodes.filter((id) => id !== path.root);
}

function layoutResearch(path: MarketPath, dir: { x: number; y: number }, cells: Map<UpgradeId, MarketCell>): void {
  const research = researchOf(path);
  const inPath = new Set<string>(path.nodes);
  // A node hangs from its own parent when that is on this path, otherwise from the root.
  const parentOf = (id: UpgradeId): UpgradeId => {
    const p = UPGRADE_BY_ID[id].parent;
    return p && inPath.has(p) ? p : path.root;
  };
  const first = research.filter((id) => parentOf(id) === path.root);
  const later = research.filter((id) => parentOf(id) !== path.root);
  const perp = { x: dir.y === 0 ? 0 : 1, y: dir.y === 0 ? 1 : 0 };
  const place = (id: UpgradeId, along: number, across: number): void => {
    cells.set(id, {
      col: dir.x * along + perp.x * across,
      row: dir.y * along + perp.y * across,
      parent: parentOf(id),
    });
  };
  const offsets = new Map<UpgradeId, number>();
  let rank = 2;
  for (let i = 0; i < first.length; i += RANK_SIZE, rank++) {
    const group = first.slice(i, i + RANK_SIZE);
    group.forEach((id, j) => {
      const across = j - (group.length - 1) / 2;
      offsets.set(id, across);
      place(id, rank, across);
    });
  }
  // Deeper nodes sit straight out from their parent, one rank past the rest.
  const depth = (id: UpgradeId): number => (parentOf(id) === path.root ? 1 : depth(parentOf(id)) + 1);
  const used = new Set<string>();
  for (const id of later.sort((a, b) => depth(a) - depth(b))) {
    const along = rank + depth(id) - 2;
    let across = offsets.get(parentOf(id)) ?? 0;
    while (used.has(`${along},${across}`)) across += 1;
    used.add(`${along},${across}`);
    offsets.set(id, across);
    place(id, along, across);
  }
}
