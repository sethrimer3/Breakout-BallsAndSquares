import { describe, expect, it } from 'vitest';
import { BinaryMask } from '../src/rendering/BinaryMask';
import { markBlightEdges } from '../src/rendering/blightEdges';

describe('partial binary masks', () => {
  it('preserves untouched bits despite unrelated scratch pixels, and removes the final bit', () => {
    const mask=new BinaryMask(8),source=new Uint8Array(64);
    source[1]=source[62]=1;
    expect(mask.update(source,0,0,7,7)).toBe(true);expect(mask.count).toBe(2);
    source.fill(1);source[1]=0;
    expect(mask.update(source,1,0,1,0)).toBe(true);expect(mask.count).toBe(1);
    expect(mask.bits[7]&(1<<6)).not.toBe(0);
    expect(mask.update(source,1,0,1,0)).toBe(false);
    source.fill(0);mask.update(source,0,0,7,7);
    expect(mask.count).toBe(0);expect(mask.bits.some(Boolean)).toBe(false);
  });

  it.each([false,true])('matches full edge recomputation under edits and cross-chunk neighbors (filter=%s)', filtered => {
    const width=24,data=new Uint8Array(width*width),subs=8,size=subs*2;
    const grid={subWidth:width,subHeight:width,isBlightSubAt:(x:number,y:number)=>!!data[y*width+x]};
    const full=new Uint8Array(size*size),partial=new Uint8Array(full.length),solid=new Uint8Array((subs+2)**2),fresh=new Uint8Array(solid.length);
    const include=filtered?(x:number,y:number)=>(x+y)%3!==0:undefined;
    let seed=819;const next=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296);
    for(let i=0;i<data.length;i++)data[i]=next()<.6?1:0;
    markBlightEdges(grid,8,8,subs,partial,solid,include);
    for(let step=0;step<400;step++) {
      const x=Math.floor(next()*10)-1,y=Math.floor(next()*10)-1;
      data[(8+y)*width+8+x]^=1;
      const region={x0:Math.max(0,x-1),y0:Math.max(0,y-1),x1:Math.min(subs-1,x+1),y1:Math.min(subs-1,y+1)};
      const count=markBlightEdges(grid,8,8,subs,partial,solid,include,false,region);
      markBlightEdges(grid,8,8,subs,full,fresh,include);
      expect(partial).toEqual(full);
      let expected=0;for(let py=region.y0*2;py<(region.y1+1)*2;py++)for(let px=region.x0*2;px<(region.x1+1)*2;px++)expected+=full[py*size+px];
      expect(count).toBe(expected);
    }
  });
});
