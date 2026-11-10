import { CORE_PATH, UPGRADE_BY_ID } from "../src/progression/UpgradeDefinitions";
import { describe, expect, it } from "vitest";
import { FACILITY, WORLD } from "../src/config";
import { Rng } from "../src/core/Rng";
import { Soldier } from "../src/entities/Soldier";
import { SentrySystem } from "../src/entities/Sentry";
import { SaveManager } from "../src/progression/SaveManager";
import { UpgradeManager } from "../src/progression/UpgradeManager";
import { DoorSystem } from "../src/world/DoorSystem";
import { GlassSystem } from "../src/world/GlassSystem";
import { GrowthSystem } from "../src/world/GrowthSystem";
import { MAT, PixelWorld, SUB } from "../src/world/PixelWorld";
import { generateWorld } from "../src/world/WorldGenerator";

class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, v);
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
}

function small(): PixelWorld {
  return new PixelWorld({ width: 40, height: 40, cellSize: 8, roomSize: 6 });
}

describe("research base facility", () => {
  it("shatters orthogonally connected glass outward, one step per 1/20 s", () => {
    const w = small();
    const glass = new GlassSystem(w);
    // A row of 5 panes plus one diagonal pane that must survive.
    for (let x = 10; x < 15; x++) {
      w.mat[20 * w.width + x] = MAT.glass;
      w.setCell(x, 20, 1, "set", true);
    }
    w.mat[21 * w.width + 15] = MAT.glass;
    w.setCell(15, 21, 1, "set", true);

    expect(w.damage(12, 20, 5)).toBe(2);
    expect(glass.pending).toBe(4);
    glass.update(FACILITY.glassChainDelay * 0.5);
    expect(w.solidAt(11, 20)).toBe(true);
    glass.update(FACILITY.glassChainDelay * 0.6);
    expect(w.solidAt(11, 20)).toBe(false);
    expect(w.solidAt(13, 20)).toBe(false);
    expect(w.solidAt(10, 20)).toBe(true);
    glass.update(FACILITY.glassChainDelay);
    expect(w.solidAt(10, 20)).toBe(false);
    expect(w.solidAt(14, 20)).toBe(false);
    expect(w.solidAt(15, 21)).toBe(true);
  });

  it("opens doors when shot only with the matching keycard tier and triggers cell flashes", () => {
    const w = small();
    const cellOpenEvents: { cx: number; cy: number; delay: number; tier: number }[] = [];
    const doors = new DoorSystem(w, {
      onCellOpen: (cx, cy, delay, tier) => cellOpenEvents.push({ cx, cy, delay, tier }),
    });
    const cells = [20 * w.width + 10, 20 * w.width + 11, 21 * w.width + 10, 21 * w.width + 11];
    w.doors = [{ id: 1, tier: 2, cells, open: false, x0: 10, y0: 20, x1: 11, y1: 21 }];
    for (const i of cells) {
      w.mat[i] = MAT.door;
      w.doorId[i] = 1;
      w.health[i] = w.maxHealthAt(i % w.width, Math.floor(i / w.width));
    }
    const hp = w.health[cells[0]];
    w.keycardTier = 1;
    expect(w.damage(10, 20, 1)).toBe(1);
    expect(w.health[cells[0]]).toBe(hp - 1);
    expect(w.doors[0].open).toBe(false);
    expect(cellOpenEvents.length).toBe(0);

    w.keycardTier = 2;
    expect(w.damage(10, 20, 1)).toBe(1);
    expect(w.doors[0].open).toBe(true);
    expect(cellOpenEvents.length).toBe(cells.length);
    for (const evt of cellOpenEvents) {
      expect(evt.tier).toBe(2);
      expect(evt.delay).toBeGreaterThanOrEqual(0);
    }
    doors.update(1);
    for (const i of cells) expect(w.health[i]).toBe(0);
  });

  it("keeps small generators idle until their glass breaks", () => {
    const w = new PixelWorld(WORLD);
    generateWorld(w, 303);
    const core = w.blightCores.find((c) => c.size === 1)!;
    expect(core).toBeDefined();
    const g = new GrowthSystem(w, new Rng(1));
    g.reset();
    expect(g.isCoreExposed(core.id)).toBe(false);
    const glass = new GlassSystem(w);
    w.damage(core.cx + 1, core.cy, 9999);
    glass.update(10);
    expect(g.isCoreExposed(core.id)).toBe(true);
  });

  it("does not treat rubble as blight", () => {
    const w = small();
    const si = 40 * w.subWidth + 40;
    w.subKind[si] = SUB.rubble;
    w.subHealth[si] = 3;
    expect(w.isBlightSubAt(40, 40)).toBe(false);
    expect(w.subSolidAt(40, 40)).toBe(true);
    w.setSubCell(40, 40, 2, "grown", true);
    expect(w.isBlightSubAt(40, 40)).toBe(true);
  });

  it("wakes sentries only with the uplink, when a soldier enters the room", () => {
    const w = small();
    w.sentrySpots = [{ x: 12, y: 12, zone: 0, rx0: 1, ry0: 1, rx1: 6, ry1: 6 }];
    const sys = new SentrySystem(w);
    sys.reset();
    const inRoom = new Soldier(30, 30, 1, 0, 50);
    const fire = (): void => {};
    sys.update(0.1, [inRoom], fire);
    expect(sys.sentries[0].awake).toBe(false);
    sys.enabled = true;
    const away = new Soldier(200, 200, 1, 0, 50);
    sys.update(0.1, [away], fire);
    expect(sys.sentries[0].awake).toBe(false);
    sys.update(0.1, [inRoom], fire);
    expect(sys.sentries[0].awake).toBe(true);
  });

  it("gates keycards along the Core path", () => {
    const save = new SaveManager(new MemStorage());
    const upg = new UpgradeManager(save);
    save.data.lifetimePixels = 10000;
    save.data.bank = 10000;
    save.data.crystals = 10000;
    expect(upg.isUnlocked("keycard_t2")).toBe(false);
    expect(upg.buy("keycard_t1")).toBe(true);
    expect(upg.isUnlocked("keycard_t2")).toBe(false);
    for (const id of CORE_PATH.slice(1, CORE_PATH.indexOf("keycard_t2"))) {
      if (!UPGRADE_BY_ID[id].placeholder) expect(upg.buy(id)).toBe(true);
    }
    expect(upg.isUnlocked("keycard_t2")).toBe(true);
    expect(upg.getSoldierStats().keycardTier).toBe(1);
    expect(upg.buy("keycard_t2")).toBe(true);
    expect(upg.getSoldierStats().keycardTier).toBe(2);
  });
});

describe("door toughness", () => {
  it("doors have the health of an ordinary block of their tier, not wall health", async () => {
    const { tierHealth } = await import("../src/config");
    const w = new PixelWorld(WORLD);
    generateWorld(w, 303);
    for (const tier of [1, 2, 3] as const) {
      const d = w.doors.find((x) => x.tier === tier)!;
      expect(d).toBeDefined();
      const i = d.cells[0];
      const cx = i % w.width;
      const cy = (i - cx) / w.width;
      const hp = w.maxHealthAt(cx, cy);
      expect(hp).toBe(tierHealth(tier, w.tierProgress(cx, cy)));
      if (tier === 1) expect(hp).toBeLessThanOrEqual(5);
      if (tier === 2) expect(hp).toBeGreaterThanOrEqual(10);
      if (tier === 3) expect(hp).toBeGreaterThanOrEqual(100);
    }
  });
});
