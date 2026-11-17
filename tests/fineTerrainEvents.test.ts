import { describe, expect, it, vi } from 'vitest';
import { BlightColonies } from '../src/world/BlightColonies';
import { PixelWorld } from '../src/world/PixelWorld';

function world() {return new PixelWorld({width:20,height:20,cellSize:8,roomSize:4});}

describe('fine terrain notifications', () => {
  it('reports subcell coordinates while preserving whole-cell damage delegation', () => {
    const w=world(),listener=vi.fn();w.addListener(listener);
    w.setSubCell(8,10,20);expect(listener).toHaveBeenLastCalledWith(4,5,'grown',8,10);
    w.damageSub(8,10,1);expect(listener).toHaveBeenLastCalledWith(4,5,'damaged',8,10);
    w.damageSub(8,10,100);expect(listener).toHaveBeenLastCalledWith(4,5,'destroyed',8,10);
    w.setCell(4,5,20);expect(listener).toHaveBeenLastCalledWith(4,5,'set');
    w.damageSub(8,10,1);expect(listener).toHaveBeenLastCalledWith(4,5,'damaged');
  });

  it('refreshes only the changed subcell and its cardinal neighbors, and skips HP-only hits', () => {
    const w=world(),c=new BlightColonies(w),spy=vi.spyOn(c,'refresh');
    w.setSubCell(8,10,20);
    expect(spy.mock.calls).toEqual([[8,9],[7,10],[8,10],[9,10],[8,11]]);
    spy.mockClear();w.damageSub(8,10,1);expect(spy).not.toHaveBeenCalled();
  });

  it('keeps colony membership, edge order and activity identical to broad parent refreshes', () => {
    const a=world(),b=world();
    const broad=b.addListener.bind(b);
    b.addListener=fn=>broad((cx,cy,kind)=>fn(cx,cy,kind));
    for(const w of [a,b]){
      for(const [id,x] of [[1,3],[2,12]]){const cell=3*w.width+x;w.health[cell]=20;w.coreId[cell]=id;w.blightCores.push({id,roomId:id,zone:0,cx:x,cy:3,cells:[cell],alive:true,size:1});}
      for(let x=8;x<24;x++)w.subHealth[6*w.subWidth+x]=10;
    }
    const ca=new BlightColonies(a),cb=new BlightColonies(b);ca.rebuild();cb.rebuild();
    const va:number[][]=[],vb:number[][]=[];ca.onVisualChange=(x,y)=>va.push([x,y]);cb.onVisualChange=(x,y)=>vb.push([x,y]);
    let seed=194;const next=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296);
    const graph=(c:BlightColonies)=>Array.from(c.list).map(v=>({id:v.id,members:v.members,edges:v.edges,cores:v.cores,active:v.active,dirty:v.dirty}));
    for(let step=0;step<500;step++) {
      const x=5+Math.floor(next()*22),y=4+Math.floor(next()*8),op=Math.floor(next()*4);
      for(const w of [a,b]){
        if(op===0)w.setSubCell(x,y,10);
        if(op===1)w.damageSub(x,y,100);
        if(op===2)w.setCell(x>>1,y>>1,0);
        if(op===3)w.damageSub(x,y,1);
        if(step%73===0)w.blightCores[0].alive=!w.blightCores[0].alive;
      }
      ca.update(1/60,.1);cb.update(1/60,.1);
      expect(ca.label).toEqual(cb.label);expect(graph(ca)).toEqual(graph(cb));expect(va).toEqual(vb);
      va.length=vb.length=0;
    }
  });
});
