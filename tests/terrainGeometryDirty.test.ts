import { describe, expect, it } from 'vitest';
import { MAT, PixelWorld } from '../src/world/PixelWorld';
import { TerrainChunks } from '../src/world/TerrainChunks';

function fixture(){const w=new PixelWorld({width:16,height:16,cellSize:8,roomSize:4});return{w,chunks:new TerrainChunks(w,4)};}
describe('terrain artwork versus geometry invalidation',()=>{
  it('repaints HP-only hits without invalidating outlines or edge masks',()=>{
    const {w,chunks}=fixture();w.health[5*w.width+5]=100;
    w.damage(5,5,1);expect(chunks.pending).toBe(1);expect(chunks.dirty[5]).toBe(1);
    expect(chunks.geometryDirty.some(Boolean)).toBe(false);
    expect(chunks.opacityDirty.some(Boolean)).toBe(false);
    w.damage(5,5,1000);expect(chunks.geometryDirty[5]).toBe(1);
  });
  it('invalidates opacity for glass HP changes without rebuilding geometry',()=>{
    const {w,chunks}=fixture();const i=5*w.width+5;
    w.health[i]=100;w.mat[i]=MAT.glass;
    w.damage(5,5,1);
    expect(chunks.opacityDirty[5]).toBe(1);
    expect(chunks.geometryDirty[5]).toBe(0);
    // Ordinary damage joining the same queue must retain the glass invalidation.
    w.health[i+1]=100;w.damage(6,5,1);
    expect(chunks.opacityDirty[5]).toBe(1);
  });
  it('retains opacity changes across chunk budgets and neighboring HP hits',()=>{
    const {w,chunks}=fixture();w.health[3*w.width+3]=100;w.mat[3*w.width+3]=MAT.glass;
    w.damage(3,3,1);
    const batch:number[]=[];chunks.take(1,batch);
    expect(batch).toHaveLength(1);expect(chunks.pending).toBe(3);
    expect([...chunks.opacityDirty].filter(Boolean)).toHaveLength(4);
    chunks.opacityDirty[batch[0]]=0;
    w.health[3*w.width+4]=100;w.damage(4,3,1);
    expect(chunks.opacityDirty[1]).toBe(1);expect(chunks.opacityDirty[5]).toBe(1);
    chunks.markAll();expect(chunks.opacityDirty.every(v=>v===1)).toBe(true);
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
