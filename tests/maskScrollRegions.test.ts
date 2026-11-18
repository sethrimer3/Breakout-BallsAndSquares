import { describe, expect, it } from 'vitest';
import { maskScrollRegions } from '../src/rendering/MaskScrollRegions';

describe('scrolling mask update regions', () => {
  it('covers exposed edges and dirty tiles with disjoint rectangles', () => {
    const rects=maskScrollRegions(1000,700,3,-2,2,{x:100,y:100,width:40,height:30})!;
    expect(rects).toHaveLength(5);
    expect(rects[0]).toEqual({x:0,y:0,width:7,height:700});
    expect(rects[1]).toEqual({x:996,y:0,width:4,height:700});
    expect(rects[rects.length - 1]).toEqual({x:100,y:100,width:40,height:30});
  });
  it('retains a full rebuild for fractional, large or dense work', () => {
    expect(maskScrollRegions(100,80,.25,0,1,null)).toBeNull();
    expect(maskScrollRegions(100,80,100,0,1,null)).toBeNull();
    expect(maskScrollRegions(100,80,0,-80,1,null)).toBeNull();
    expect(maskScrollRegions(100,80,60,0,1,null)).toBeNull();
    expect(maskScrollRegions(100,80,0,0,1,{x:0,y:0,width:100,height:80})).toBeNull();
  });
  it('covers all newly exposed and dirty pixels without overlapping redraws', () => {
    let seed=12,partial=0;
    const rand=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296);
    for(let n=0;n<200;n++){
      const width=70+Math.floor(rand()*40),height=70+Math.floor(rand()*40);
      const dx=Math.floor(rand()*25)-12,dy=Math.floor(rand()*25)-12;
      const dirty={x:Math.floor(rand()*width),y:Math.floor(rand()*height),width:Math.ceil(rand()*18),height:Math.ceil(rand()*18)};
      const rects=maskScrollRegions(width,height,dx,dy,1.25,dirty);
      if(!rects)continue;partial++;
      for(const r of rects){expect(r.x).toBeGreaterThanOrEqual(0);expect(r.y).toBeGreaterThanOrEqual(0);expect(r.x+r.width).toBeLessThanOrEqual(width);expect(r.y+r.height).toBeLessThanOrEqual(height);}
      for(let y=0;y<height;y++)for(let x=0;x<width;x++){
        const count=rects.filter(r=>x>=r.x&&y>=r.y&&x<r.x+r.width&&y<r.y+r.height).length;
        if(count>1)throw Error('Overlapping mask regions');
        const exposed=x-dx<0||x-dx>=width||y-dy<0||y-dy>=height;
        const changed=x>=dirty.x&&x<dirty.x+dirty.width&&y>=dirty.y&&y<dirty.y+dirty.height;
        if((exposed||changed)&&count!==1)throw Error('Missing affected pixel');
      }
    }
    expect(partial).toBeGreaterThan(100);
  });
});
