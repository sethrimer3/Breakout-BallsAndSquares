import { describe, expect, it } from "vitest";
import { EXOTIC_BURST, ExoticBurstSystem } from "../src/systems/ExoticBurst";
import { defaultSaveData, sanitizeSaveData } from "../src/progression/SaveManager";
import type { Soldier } from "../src/entities/Soldier";

const soldier = (x: number, y: number): Soldier => ({ x, y, vx: 0, vy: 0, radius: 4, alive: true }) as unknown as Soldier;

describe("exotic DNA burst", () => {
  it("hangs, bursts into pixels and sucks them all into the nearest soldier", () => {
    const near = soldier(60, 0), far = soldier(-400, 0);
    let absorbed = 0, nearHits = 0, bursts = 0;
    const fx = new ExoticBurstSystem(() => [far, near], {
      onBurst: () => bursts++,
      onMoteAbsorbed: (s) => { absorbed++; if (s === near) nearHits++; },
    });
    fx.spawn(0, 0);
    fx.update(EXOTIC_BURST.hold * 0.5);
    expect(fx.shows.length).toBe(1);
    expect(fx.motes.length).toBe(0);
    fx.update(EXOTIC_BURST.hold * 0.6);
    expect(bursts).toBe(1);
    expect(fx.shows.length).toBe(0);
    expect(fx.motes.length).toBe(EXOTIC_BURST.motes);
    for (let i = 0; i < 400 && fx.motes.length; i++) fx.update(1 / 60);
    expect(fx.motes.length).toBe(0);
    expect(absorbed).toBe(EXOTIC_BURST.motes);
    expect(nearHits).toBe(EXOTIC_BURST.motes);
  });

  it("lets the pixels fade if the whole squad is dead", () => {
    const s = soldier(30, 0);
    const fx = new ExoticBurstSystem(() => [s]);
    fx.spawn(0, 0);
    fx.update(EXOTIC_BURST.hold + 0.01);
    s.alive = false;
    fx.update(1 / 60);
    expect(fx.motes.length).toBe(0);
  });

  it("pays out drops an older save left uncollected, exactly once", () => {
    const raw = defaultSaveData();
    raw.exoticMatter = 2;
    raw.lab.worlds[1].destroyedGenerators = { "10,10,2,lab": false, "20,20,1,lab": true, "5,5,1,tube": false };
    const loaded = sanitizeSaveData(JSON.parse(JSON.stringify(raw)));
    expect(loaded.exoticMatter).toBe(4);
    expect(Object.values(loaded.lab.worlds[1].destroyedGenerators!).every(Boolean)).toBe(true);
    expect(sanitizeSaveData(JSON.parse(JSON.stringify(loaded))).exoticMatter).toBe(4);
  });
});
