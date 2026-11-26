import { describe, expect, it } from "vitest";
import { accessId, marketNode, WEAPON_MARKETS } from "../src/progression/BlackMarket";
import { UPGRADE_DEFS } from "../src/progression/UpgradeDefinitions";
import { graftGate, latentLayout, marketLayout } from "../src/ui/marketLayout";

describe("grafted research layout", () => {
  it("grafts all mutation choices and only the active research onto each weapon", () => {
    for (const market of WEAPON_MARKETS) {
      const gateId = accessId(market.weapon);
      const base = UPGRADE_DEFS.filter((def) =>
        def.branch === market.weapon && def.id !== gateId && !marketNode(def.id)).map((def) => def.grid);
      for (const direction of ["right", "down"] as const) {
        const gate = graftGate(base, direction);
        for (const path of [null, ...market.paths]) {
          const cells = marketLayout(market, path?.root ?? null, gateId, gate, direction);
          expect([...cells.keys()].sort()).toEqual([...new Set([...market.paths.map((entry) => entry.root), ...(path?.nodes ?? [])])].sort());
          for (const [id, cell] of cells) {
            if (market.paths.some((entry) => entry.root === id)) expect(cell.parent).toBe(gateId);
            else expect(path?.nodes).toContain(cell.parent);
          }
          const placed = [...base, gate, ...cells.values()];
          for (let i = base.length; i < placed.length; i++) {
            for (let j = 0; j < i; j++) {
              expect(Math.hypot(placed[i].col - placed[j].col, placed[i].row - placed[j].row)).toBeGreaterThanOrEqual(0.84);
            }
          }
        }
      }
    }
  });

  it("makes room for latent nodes under their awakening gate", () => {
    const gate = graftGate([{ col: 0, row: 0 }, { col: 0, row: 1 }], "down");
    const cells = latentLayout(["rebound", "blast", "range"], "latent_unlock", gate);
    expect(cells.get("blast")!.col).toBe(gate.col);
    expect([...cells.values()].every((cell) => cell.row > gate.row && cell.parent === "latent_unlock")).toBe(true);
    expect(new Set([...cells.values()].map((cell) => cell.col)).size).toBe(3);
  });
});
