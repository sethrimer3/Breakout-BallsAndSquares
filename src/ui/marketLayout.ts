import type { WeaponMarket } from "../progression/BlackMarket";
import { UPGRADE_BY_ID, type UpgradeId } from "../progression/UpgradeDefinitions";

export interface MarketCell {
  col: number;
  row: number;
  parent: string;
}
export type GraftDirection = "right" | "down";
type Grid = Pick<MarketCell, "col" | "row">;

/** Compact branch spacing still clears a node's frame and its circuit. */
const SPACING = 0.85;

function offset(gate: Grid, along: number, across: number, direction: GraftDirection): Grid {
  return direction === "right"
    ? { col: gate.col + along, row: gate.row + across }
    : { col: gate.col + across, row: gate.row + along };
}

/** Put the attachment beyond the regular tree so none of the graft nodes overlap it. */
export function graftGate(standard: readonly Grid[], direction: GraftDirection): Grid {
  const edge = Math.max(0, ...standard.map((cell) => direction === "right" ? cell.col : cell.row));
  return direction === "right" ? { col: edge + SPACING, row: 0 } : { col: 0, row: edge + SPACING };
}

/** Show every path choice and grow only the equipped path's research. */
export function marketLayout(
  market: WeaponMarket,
  active: UpgradeId | null,
  gateId: string,
  gate: Grid,
  direction: GraftDirection,
): Map<UpgradeId, MarketCell> {
  const cells = new Map<UpgradeId, MarketCell>();
  // The third path is the upper branch in the landscape arrangement.
  const offsets = market.paths.length === 3 ? [0, 1, -1] : [-0.5, 0.5];
  market.paths.forEach((path, i) => {
    cells.set(path.root, { ...offset(gate, SPACING, offsets[i] * SPACING, direction), parent: gateId });
    if (path.root !== active) return;
    const nodes = path.nodes.filter((id) => id !== path.root);
    const parents = new Map(nodes.map((id) => {
      const p = UPGRADE_BY_ID[id].parent;
      return [id, p && path.nodes.includes(p) ? p : path.root] as const;
    }));
    const depth = (id: UpgradeId): number => id === path.root ? 0 : 1 + depth(parents.get(id)!);
    nodes.sort((a, b) => depth(a) - depth(b)).forEach((id, index) => {
      const along = (2 + Math.floor(index / 3)) * SPACING;
      const across = [0, -1, 1][index % 3] * SPACING;
      cells.set(id, { ...offset(gate, along, across, direction), parent: parents.get(id)! });
    });
  });
  return cells;
}

/** The latent nodes fan from the soldier's awakening node in a single readable row. */
export function latentLayout(ids: readonly string[], gateId: string, gate: Grid): Map<string, MarketCell> {
  return new Map(ids.map((id, i) => [id, {
    ...offset(gate, SPACING, (i - (ids.length - 1) / 2) * SPACING, "down"),
    parent: gateId,
  }]));
}
