import { describe, expect, it } from 'vitest';
import { LightRegion } from '../src/rendering/LightRegion';

describe('temporary light work bounds',()=>{
  it('unions sources with conservative fractional device and blur padding',()=>{
    const b=new LightRegion();b.include(100.2,90.3,10);b.include(120,110,5);
    expect(b.resolve(1000,800,1.25,50)).toEqual({x:62,y:50,width:145,height:144});
  });
  it('resets removed lights and ignores a wholly offscreen region',()=>{
    const b=new LightRegion();expect(b.resolve(1000,800,1,2)).toBeNull();
    b.include(-100,-100,2);expect(b.resolve(1000,800,1,2)).toBeNull();
    b.include(100,100,5);expect(b.resolve(1000,800,1,2)).not.toBeNull();
    b.reset();expect(b.resolve(1000,800,1,2)).toBeNull();
  });
  it('keeps the complete screen path for dense coverage and clamps edges',()=>{
    const b=new LightRegion();b.include(500,400,500);
    expect(b.resolve(1000,800,1,50)).toEqual({x:0,y:0,width:1000,height:800});
    b.reset();b.include(0,0,3);expect(b.resolve(1000,800,2,2)).toEqual({x:0,y:0,width:8,height:8});
  });
});
