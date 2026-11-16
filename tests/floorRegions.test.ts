import { describe, expect, it } from 'vitest';
import { FloorRegions } from '../src/rendering/FloorRegions';

function take(regions: FloorRegions): number[][] { const out:number[][]=[];regions.flush((...r)=>out.push(r));return out; }
describe('batched floor shadow regions',()=>{
  it('coalesces repeated changes and keeps the exact sparse extent',()=>{
    const r=new FloorRegions(100,100);for(let i=0;i<100;i++)r.mark(2,2,4,4);
    expect(take(r)).toEqual([[2,2,4,4]]);expect(take(r)).toEqual([]);
    r.mark(3,3,5,5);expect(take(r)).toEqual([[3,3,5,5]]);
  });
  it('splits tile boundaries and preserves distant sparse regions',()=>{
    const r=new FloorRegions(100,100);r.mark(7,7,8,8);r.mark(90,90,91,91);
    expect(take(r)).toEqual([[7,7,7,7],[8,7,8,7],[7,8,7,8],[8,8,8,8],[90,90,91,91]]);
  });
  it('clips world edges and discards stale queued work on regeneration',()=>{
    const r=new FloorRegions(10,10);r.mark(-2,-2,1,1);r.mark(9,9,12,12);
    expect(take(r)).toEqual([[0,0,1,1],[9,9,9,9]]);
    r.mark(0,0,9,9);r.clear();expect(take(r)).toEqual([]);
    r.mark(9,9,9,9);expect(take(r)).toEqual([[9,9,9,9]]);
  });
});
