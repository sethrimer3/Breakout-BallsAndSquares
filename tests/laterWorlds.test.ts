import { materialColor } from "../src/rendering/materials";
import { describe, expect, it } from "vitest";
import { WORLD } from "../src/config";
import { sanitizeSaveData } from "../src/progression/SaveManager";
import { PixelWorld } from "../src/world/PixelWorld";
import { generateWorld } from "../src/world/WorldGenerator";
import { LAB_WORLDS, LAB_WORLD_COUNT, sectorCount, worldRows, worldBlueprint, gateGeometry, labFrame, sectorAtCell, sectorBounds, sectorTier, sectorSpawnCell, SECTOR_CELLS } from "../src/world/labMap";
import { atmosphereAt } from "../src/world/worldAtmosphere";

describe("later-world framework", () => {
  it.each([[3,13,13,169],[4,7,7,49],[5,5,3,15]])("builds world %i as %ix%i with %i encounter rooms", (id,columns,rows,count) => {
    const def = LAB_WORLDS[id];
    expect(def.sectors).toBe(columns); expect(worldRows(def)).toBe(rows); expect(sectorCount(def)).toBe(count);
    expect(worldBlueprint(def).rooms).toHaveLength(count);
    const world = new PixelWorld(WORLD); generateWorld(world, 8, { labWorld: def });
    const frame = world.labLayout!.frame!;
    expect(frame.def).toBe(def); expect(world.labLayout!.rooms).toHaveLength(count);
    expect(world.blightCores).toHaveLength(0); expect(world.sentrySpots).toHaveLength(0);
    expect(world.specimenSpots).toHaveLength(0); expect(world.roomLights).toHaveLength(0);
    expect(world.blight.some((v) => v > 0)).toBe(false);
    expect(world.subHealth.some((v) => v > 0)).toBe(false);
    // Every sector's placeholder room is reachable from the arrival, not merely carved.
    const visited = new Uint8Array(world.width * world.height), queue = new Int32Array(visited.length);
    let head = 0, tail = 0;
    const enter = (x: number, y: number): void => {
      if (world.solidAt(x,y)) return;
      const index = y * world.width + x;
      if (!visited[index]) { visited[index] = 1; queue[tail++] = index; }
    };
    enter(Math.floor(world.roomCenterX / world.cellSize), Math.floor(world.roomCenterY / world.cellSize));
    while(head < tail) {
      const i=queue[head++], x=i%world.width, y=Math.floor(i/world.width);
      enter(x-1,y); enter(x+1,y); enter(x,y-1); enter(x,y+1);
    }
    for (let i = 0; i < count; i++) {
      const at = sectorSpawnCell(frame, i);
      expect(sectorAtCell(frame, at.cx, at.cy)).toBe(i);
      expect(world.solidAt(at.cx, at.cy)).toBe(false);
      if(id===3) expect(visited[at.cy * world.width + at.cx]).toBe(1);
      if ((id === 5 && i !== def.start) || (id === 4 && i === 24)) {
        expect(visited[at.cy * world.width + at.cx], "armored checkpoints require mining").toBe(0);
      }
    }
    const outside = frame.y0 + rows * SECTOR_CELLS;
    expect(sectorAtCell(frame, frame.x0, outside)).toBe(-1);
  });

  it("assigns zones 7–9 to the forest and zones 10/11 uniformly to city/ship", () => {
    expect(LAB_WORLD_COUNT).toBe(5);
    for (let tier=7;tier<=12;tier++) expect(materialColor(tier,true)).toHaveLength(3);
    const forest = LAB_WORLDS[3];
    expect(sectorTier(forest, forest.start)).toBe(7);
    expect(sectorTier(forest, 6*13+5)).toBe(8);
    expect(sectorTier(forest, 6*13+9)).toBe(9);
    for (const id of [4,5]) for(let i=0;i<sectorCount(LAB_WORLDS[id]);i++) expect(sectorTier(LAB_WORLDS[id],i)).toBe(id+6);
  });

  it("exits south through L13 and reserves the city C3–E5 facility with its D4 teleporter", () => {
    const forest = LAB_WORLDS[3]; const frame = labFrame(new PixelWorld(WORLD),forest)!;
    const gate = forest.gates.find((g) => g.to === 4)!;
    expect(gate.side).toBe("south"); expect(gate.col).toBe(11);
    const { door, pocket } = gateGeometry(frame,gate);
    const bounds = sectorBounds(frame,12*13+11);
    expect(door.y0).toBe(bounds.y1+1);
    expect((door.x0+door.x1)/2).toBeGreaterThan(bounds.x0);
    expect((door.x0+door.x1)/2).toBeLessThan(bounds.x1);
    expect(pocket.y0).toBe(door.y1+1); expect(pocket.y1).toBeLessThan(WORLD.height);
    const city = LAB_WORLDS[4];
    expect(city.facility).toMatchObject({col0:2,row0:2,col1:4,row1:4});
    expect(city.teleporter).toEqual({sector:24,to:5});
    expect(city.start).toBe(3); expect(LAB_WORLDS[5].start).toBe(12);
  });

  it("blends forest atmosphere continuously from lush daylight to dusk and canopy beams", () => {
    const def = LAB_WORLDS[3];
    expect(atmosphereAt(def,0,6)).toMatchObject({zone:7,sunlight:1,haze:0});
    expect(atmosphereAt(def,6,6)?.zone).toBe(8);
    expect(atmosphereAt(def,11,6)).toMatchObject({zone:9,canopy:.95,beams:.8});
    for(const boundary of def.bands) {
      const before=atmosphereAt(def,boundary-.001,6)!, after=atmosphereAt(def,boundary+.001,6)!;
      expect(Math.abs(before.ambient[0]-after.ambient[0])).toBeLessThan(1);
      expect(Math.abs(before.sunlight-after.sunlight)).toBeLessThan(.01);
    }
  });

  it("migrates earlier saves and rejects phantom rows in the rectangular final world", () => {
    const fresh=sanitizeSaveData({lab:{world:5,unlocked:5,worlds:{5:{discovered:[12,14,15,24],conquered:[12,14,24],spawn:24}}}});
    expect(fresh.lab.world).toBe(5); expect(fresh.lab.worlds[5].discovered).toEqual([12,14]);
    expect(fresh.lab.worlds[5].spawn).toBe(12);
    const legacy=sanitizeSaveData({lab:{world:3,unlocked:3}});
    expect(legacy.lab.unlocked).toBe(3); expect(legacy.lab.worlds[4]).toBeDefined(); expect(legacy.lab.worlds[5]).toBeDefined();
  });
});
