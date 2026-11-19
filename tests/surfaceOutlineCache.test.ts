import { describe, expect, it } from 'vitest';
import { SurfaceOutlineCache } from '../src/rendering/SurfaceOutlineCache';
import { traceSurfaceOutline } from '../src/rendering/surfaceOutline';

describe('cached surface outlines', () => {
  it.each([[4,4,false],[-2,-1,false],[16,17,false],[4,4,true],[-2,-1,true],[16,17,true]] as const)('matches ordered rectangles at origin %s,%s (outside solid=%s)', (ox,oy,outside) => {
    const width=24,subs=8,data=new Uint8Array(width*width);
    const grid={subSolidAt:(x:number,y:number)=>x>=0&&y>=0&&x<width&&y<width?!!data[y*width+x]:outside};
    const cache=new SurfaceOutlineCache(subs),scratch=new Uint8Array((subs+2)**2);
    let seed=19;const next=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296);
    for(let i=0;i<data.length;i++)data[i]=next()<.65?1:0;
    cache.update(grid,ox,oy,scratch,{x0:0,y0:0,x1:subs-1,y1:subs-1});
    const check=()=>{
      const actual:number[][]=[],expected:number[][]=[];
      cache.trace((...r)=>actual.push(r));
      traceSurfaceOutline(grid,ox,oy,subs,scratch,(...r)=>expected.push(r));
      expect(actual).toEqual(expected);expect(cache.empty).toBe(expected.length===0);
    };
    check();
    for(let step=0;step<300;step++) {
      const x=Math.floor(next()*(subs+2))-1,y=Math.floor(next()*(subs+2))-1;
      const gx=ox+x,gy=oy+y;
      if(gx>=0&&gy>=0&&gx<width&&gy<width)data[gy*width+gx]^=1;
      cache.update(grid,ox,oy,scratch,{x0:Math.max(0,x-1),y0:Math.max(0,y-1),x1:Math.min(subs-1,x+1),y1:Math.min(subs-1,y+1)});
      check();
    }
    data.fill(0);cache.update(grid,ox,oy,scratch,{x0:0,y0:0,x1:subs-1,y1:subs-1});
    check();
  });

  it('retains the built snapshot when later world changes are still pending', () => {
    let solid=true;const grid={subSolidAt:()=>solid};
    const cache=new SurfaceOutlineCache(2),scratch=new Uint8Array(16),region={x0:0,y0:0,x1:1,y1:1};
    expect(cache.update(grid,0,0,scratch,region)).toBe(false);
    solid=false;cache.update(grid,0,0,scratch,region);
    grid.subSolidAt=(x:number=0,y:number=0)=>x===0&&y===0;
    expect(cache.update(grid,0,0,scratch,region)).toBe(true);
    const before:number[][]=[];cache.trace((...r)=>before.push(r));
    grid.subSolidAt=()=>false;
    const after:number[][]=[];cache.trace((...r)=>after.push(r));expect(after).toEqual(before);
    cache.update(grid,0,0,scratch,region);expect(cache.empty).toBe(true);
    expect(cache.update(grid,0,0,scratch,region)).toBe(false);
  });

  it('matches traceSurfaceOutline when both full cells and 0.5 pixels are present', () => {
    const full=new Uint8Array(12*12), sub=new Uint8Array(24*24);
    const grid={
      solidAt:(cx:number,cy:number)=>cx>=0&&cy>=0&&cx<12&&cy<12?full[cy*12+cx]>0:false,
      subSolidAt:(sx:number,sy:number)=>sx>=0&&sy>=0&&sx<24&&sy<24?(full[(sy>>1)*12+(sx>>1)]>0||sub[sy*24+sx]>0):false,
    };
    full[2*12+2]=1; full[2*12+3]=1;
    sub[4*24+8]=1; sub[5*24+8]=1; sub[6*24+5]=1;
    const subs=8, cache=new SurfaceOutlineCache(subs), scratch=new Uint8Array((subs+2)**2);
    cache.update(grid,4,4,scratch,{x0:0,y0:0,x1:subs-1,y1:subs-1});
    const actual:number[][]=[],expected:number[][]=[];
    cache.trace((...r)=>actual.push(r));
    traceSurfaceOutline(grid,4,4,subs,scratch,(...r)=>expected.push(r));
    expect(actual).toEqual(expected);
  });
});
