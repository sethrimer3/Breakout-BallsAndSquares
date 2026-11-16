import { describe, expect, it } from "vitest";
import { WEAPON_MARKETS } from "../src/progression/BlackMarket";
import { MARKET_HUB, marketLayout } from "../src/ui/marketLayout";

describe("Black Market tree layout", () => {
  it("shows only path roots around the hub until a path is active", () => {
    for (const market of WEAPON_MARKETS) {
      const cells = marketLayout(market, null);
      expect([...cells.keys()]).toEqual(market.paths.map((p) => p.root));
      for (const cell of cells.values()) {
        expect(cell.parent).toBe(MARKET_HUB);
        expect(Math.abs(cell.col) + Math.abs(cell.row)).toBe(1);
      }
    }
  });

  it("grows only the active path's research, on distinct cells hanging off that path", () => {
    for (const market of WEAPON_MARKETS) {
      for (const path of market.paths) {
        const cells = marketLayout(market, path.root);
        const shown = [...cells.keys()];
        expect(shown.sort()).toEqual([...new Set([...market.paths.map((p) => p.root), ...path.nodes])].sort());
        const spots = [...cells.values()].map((c) => `${c.col},${c.row}`);
        expect(new Set(spots).size).toBe(spots.length);
        expect(spots).not.toContain("0,0");
        for (const id of path.nodes) {
          if (id === path.root) continue;
          expect(path.nodes).toContain(cells.get(id)!.parent);
        }
      }
    }
  });
});
