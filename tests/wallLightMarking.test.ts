import { describe, expect, it } from 'vitest';
import { LIGHT } from '../src/config';
import { Soldier } from '../src/entities/Soldier';
import { LightingSystem, makeLitCells } from '../src/systems/LightingSystem';
import { PixelWorld } from '../src/world/PixelWorld';

function trace(lighting: LightingSystem, soldiers: Soldier[] = [], lit = makeLitCells()) {
  lighting.computeVisibilityPolygon(44.37,44.71,1,0,28,-1,soldiers,new Float32Array(LIGHT.maxRays*2),lit);
  return Array.from(lit.cells.subarray(0,lit.count));
}

describe('wall-light cell marking', () => {
  it('rechecks empty cells for the next light after a wall grows into them', () => {
    const world=new PixelWorld({width:16,height:16,cellSize:8,roomSize:4});
    const lighting=new LightingSystem(world),soldier=new Soldier(56,44,1,0,100);
    expect(trace(lighting,[soldier])).toEqual([]);
    world.setCell(7,5,50);
    expect(trace(lighting)).toContain(5*world.width+7);
  });

  it('keeps first-visit order when output is capped and after stamp rollover', () => {
    const world=new PixelWorld({width:16,height:16,cellSize:8,roomSize:4});
    for(let i=2;i<=9;i++) {
      world.setCell(i,2,50);world.setCell(i,9,50);
      world.setCell(2,i,50);world.setCell(9,i,50);
    }
    const lighting=new LightingSystem(world);
    // The source radius reaches all four walls from inside the enclosure.
    const run=(lit=makeLitCells())=>{
      lighting.computeVisibilityPolygon(44.37,44.71,1,0,60,-1,[],new Float32Array(LIGHT.maxRays*2),lit);
      return Array.from(lit.cells.subarray(0,lit.count));
    };
    const full=run();expect(full.length).toBeGreaterThan(2);
    expect(run({cells:new Int32Array(2),count:0})).toEqual(full.slice(0,2));
    (lighting as unknown as {litStamp:number}).litStamp=0xfffffffe;
    expect(run()).toEqual(full);
  });
});
