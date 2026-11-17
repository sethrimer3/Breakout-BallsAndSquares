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

describe('terrain artwork edit bounds', () => {
  const bounds = (c: TerrainChunks, k: number) => [c.x0[k], c.y0[k], c.x1[k], c.y1[k]];

  it('includes diagonal relief neighbors across all four chunks at a corner', () => {
    const { chunks } = fixture();
    chunks.markCell(3, 3);
    expect(bounds(chunks, 0)).toEqual([2, 2, 3, 3]);
    expect(bounds(chunks, 1)).toEqual([0, 2, 0, 3]);
    expect(bounds(chunks, 4)).toEqual([2, 0, 3, 0]);
    expect(bounds(chunks, 5)).toEqual([0, 0, 0, 0]);
  });

  it('unions queued edits and retains their bounds across budgeted updates', () => {
    const { chunks } = fixture();
    chunks.markCell(1, 1);
    chunks.markCell(3, 3);
    const batch: number[] = [];
    chunks.take(1, batch);
    expect(batch).toEqual([0]);
    expect(bounds(chunks, 0)).toEqual([0, 0, 3, 3]);
    chunks.markCell(6, 2);
    expect(bounds(chunks, 1)).toEqual([0, 1, 3, 3]);
    // A new edit to the consumed chunk starts a fresh rectangle.
    chunks.markCell(1, 1);
    expect(bounds(chunks, 0)).toEqual([0, 0, 2, 2]);
  });

  it('keeps a full repaint when edits join initial generation or regeneration', () => {
    const { chunks } = fixture();
    chunks.markAll();
    chunks.markCell(1, 1);
    for (let k = 0; k < chunks.dirty.length; k++) expect(bounds(chunks, k)).toEqual([0, 0, 3, 3]);
  });

  it('clips at world edges and expands the bounds for HP-only damage', () => {
    const { chunks, w } = fixture();
    w.health[0] = 100;
    w.damage(0, 0, 1);
    expect(bounds(chunks, 0)).toEqual([0, 0, 1, 1]);
    expect(chunks.pending).toBe(1);
  });
});
