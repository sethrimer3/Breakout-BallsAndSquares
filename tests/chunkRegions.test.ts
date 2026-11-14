import { describe, expect, it } from 'vitest';
import { ChunkRegions } from '../src/rendering/ChunkRegions';

describe('adaptive wall upload regions',()=>{
  it('splits distant lights but retains one tight upload for a single pixel or dense lighting',()=>{
    const r=new ChunkRegions(67,65,32),a=new Uint8Array(9);a[0]=a[8]=1;
    r.update(a,undefined,2,3,66,64);expect(r.count).toBe(2);expect(r.pixels).toBe(30*29+3);
    a.fill(0);a[0]=1;r.update(a,undefined,2,3,2,3);expect(r.count).toBe(1);expect([...r.rects.slice(0,4)]).toEqual([2,3,1,1]);
    a.fill(1);r.update(a,undefined,2,3,66,64);expect(r.count).toBe(1);expect(r.pixels).toBe(65*62);
  });
  it('includes former light locations so moving and disappearing lights leave no stale uploads',()=>{
    const r=new ChunkRegions(128,128,32),current=new Uint8Array(16),previous=new Uint8Array(16);
    current[0]=1;previous[15]=1;r.update(current,previous,0,0,127,127);expect(r.count).toBe(2);expect(r.pixels).toBe(2048);
    current.fill(0);r.update(current,previous,96,96,127,127);expect(r.count).toBe(1);expect(r.pixels).toBe(1024);
    previous.fill(0);r.update(current,previous,128,128,-1,-1);expect(r.count).toBe(0);
  });
  it('covers every active clipped chunk, including partial map edges, without leaving bounds',()=>{
    const width=67,height=65,size=8,cols=Math.ceil(width/size),rows=Math.ceil(height/size);
    const a=Uint8Array.from({length:cols*rows},(_,i)=>Number((i*17)%7===0)),r=new ChunkRegions(width,height,size);
    r.update(a,undefined,3,5,66,64);
    const coverage=new Uint8Array(width*height);
    for(let i=0;i<r.count;i++){const [x,y,w,h]=r.rects.slice(i*4,i*4+4);expect(x).toBeGreaterThanOrEqual(3);expect(y).toBeGreaterThanOrEqual(5);expect(x+w).toBeLessThanOrEqual(width);expect(y+h).toBeLessThanOrEqual(height);for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++)coverage[yy*width+xx]=1;}
    for(let y=5;y<height;y++)for(let x=3;x<width;x++)if(a[Math.floor(y/size)*cols+Math.floor(x/size)])expect(coverage[y*width+x]).toBe(1);
  });
});
