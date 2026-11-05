import { describe, expect, it } from "vitest";
import {
  legPath,
  pathLength,
  pointAt,
  RING,
  TronCycles,
  type Circuit,
  type CircuitNode,
} from "../src/ui/treeCircuit";
import { stepElastic, type ElasticBody } from "../src/ui/treeElastic";

function body(id: string, parent: string | null, hx: number, hy: number): ElasticBody {
  return { id, parent, hx, hy, x: hx, y: hy, vx: 0, vy: 0 };
}

function circuitNode(id: string, x: number, y: number, live = true): CircuitNode {
  return { id, x, y, hx: x, hy: y, color: "#38d6ff", live };
}

function makeCircuit(): Circuit {
  const nodes = [circuitNode("root", 100, 60), circuitNode("right", 140, 60), circuitNode("up", 100, 20), circuitNode("off", 60, 60, false)];
  return {
    nodes: new Map(nodes.map((n) => [n.id, n])),
    neighbors: new Map([
      ["root", ["right", "up", "off"]],
      ["right", ["root"]],
      ["up", ["root"]],
      ["off", ["root"]],
    ]),
  };
}

describe("elastic tree", () => {
  it("pulls children along with a dragged parent, then settles home", () => {
    const parent = body("p", null, 0, 0);
    const child = body("c", "p", 116, 0);
    const bodies = [parent, child];
    parent.x = 80;
    parent.y = 40;
    for (let i = 0; i < 30; i++) stepElastic(bodies, 1 / 60, "p");
    expect(parent.x).toBe(80);
    expect(child.x).toBeGreaterThan(130);

    for (let i = 0; i < 300; i++) stepElastic(bodies, 1 / 60);
    expect(Math.abs(parent.x)).toBeLessThan(0.5);
    expect(Math.abs(child.x - 116)).toBeLessThan(0.5);
    expect(Math.abs(child.y)).toBeLessThan(0.5);
  });

  it("pushes crowded unrelated nodes apart", () => {
    const a = body("a", null, 0, 0);
    const b = body("b", null, 116, 0);
    a.x = 100;
    for (let i = 0; i < 20; i++) stepElastic([a, b], 1 / 60, "a");
    expect(b.x).toBeGreaterThan(116);
  });
});

describe("tron cycles", () => {
  it("builds legs from right-angle segments, even between stretched nodes", () => {
    const a = circuitNode("a", 10, 10);
    const b = { ...circuitNode("b", 60, 27), hx: 50, hy: 10 };
    const path = legPath(a, b, 2, 0, true);
    for (let i = 1; i < path.length; i++) {
      expect(path[i].x === path[i - 1].x || path[i].y === path[i - 1].y).toBe(true);
    }
    expect(path[0]).toEqual({ x: a.x - RING, y: a.y });
    expect(path[path.length - 1]).toEqual({ x: b.x - RING, y: b.y });
    expect(pointAt(path, pathLength(path))).toEqual(path[path.length - 1]);
  });

  it("laps a dead-end node fully before turning back", () => {
    const n = circuitNode("n", 50, 50);
    expect(pathLength(legPath(n, n, 1, 1, false))).toBe(RING * 8);
  });

  it("rides only live nodes, moving one pixel at a time", () => {
    const circuit = makeCircuit();
    const cycles = new TronCycles();
    const seen: { x: number; y: number }[] = [];
    let last: { x: number; y: number } | null = null;
    const g = {
      fillStyle: "",
      fillRect(x: number, y: number) {
        if (this.fillStyle === "#ffffff") last = { x, y };
      },
    };
    for (let i = 0; i < 1500; i++) {
      cycles.step(1 / 60, circuit);
      cycles.draw(g as unknown as CanvasRenderingContext2D);
      if (last) seen.push(last);
    }
    expect(cycles.count).toBe(2);
    // The dead node sits left of root: nothing rides beyond root's own lap.
    expect(Math.min(...seen.map((p) => p.x))).toBeGreaterThanOrEqual(100 - RING);
    expect(Math.max(...seen.map((p) => p.x))).toBe(140 + RING);
    expect(Math.min(...seen.map((p) => p.y))).toBe(20 - RING);
  });

  it("keeps a lone unlocked node lit and runs nothing on a dark tree", () => {
    const lone: Circuit = { nodes: new Map([["n", circuitNode("n", 50, 50)]]), neighbors: new Map([["n", []]]) };
    const cycles = new TronCycles();
    for (let i = 0; i < 300; i++) cycles.step(1 / 60, lone);
    expect(cycles.count).toBe(1);

    const dark: Circuit = { nodes: new Map([["n", circuitNode("n", 50, 50, false)]]), neighbors: new Map() };
    cycles.step(1 / 60, dark);
    expect(cycles.count).toBe(0);
  });
});
