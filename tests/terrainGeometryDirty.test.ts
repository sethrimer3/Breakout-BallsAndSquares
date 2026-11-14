import { describe, expect, it } from 'vitest';
import { PixelWorld } from '../src/world/PixelWorld';
import { TerrainChunks } from '../src/world/TerrainChunks';

function fixture(){const w=new PixelWorld({width:16,height:16,cellSize:8,roomSize:4});return{w,chunks:new TerrainChunks(w,4)};}
describe('terrain artwork versus geometry invalidation',()=>{
  it('repaints HP-only hits without invalidating outlines or edge masks',()=>{
    const {w,chunks}=fixture();w.health[5*w.width+5]=100;
    w.damage(5,5,1);expect(chunks.pending).toBe(1);expect(chunks.dirty[5]).toBe(1);
    expect(chunks.geometryDirty.some(Boolean)).toBe(false);
    w.damage(5,5,1000);expect(chunks.geometryDirty[5]).toBe(1);
  });
  it('keeps geometry invalidation when an HP hit joins an already queued change',()=>{
    const {w,chunks}=fixture();w.setCell(3,3,100);w.damage(3,3,1);
    const indices:number[]=[];chunks.take(Infinity,indices);
    expect(indices.sort()).toEqual([0,1,4,5]);
    for(const i of indices)expect(chunks.geometryDirty[i]).toBe(1);
  });
  it('treats explicit visual/dormancy invalidation and regeneration conservatively',()=>{
    const {chunks}=fixture();chunks.markCell(3,3);
    expect(chunks.geometryDirty[0]).toBe(1);expect(chunks.geometryDirty[5]).toBe(1);
    chunks.geometryDirty.fill(0);chunks.markAll();
    expect(chunks.geometryDirty.every(v=>v===1)).toBe(true);
  });
});
