import { describe, expect, it, vi } from 'vitest';
import { WallLightFalloff } from '../src/rendering/WallLightFalloff';

describe('fixed fixture wall-light falloff',()=>{
  it('matches direct distance calculations, including cell centers and radius boundaries',()=>{
    const cache=new WallLightFalloff(),lit={cells:Int32Array.from({length:4096},(_,i)=>i),count:4096};
    const x=128.008,y=200,radius=96,width=64,cs=8,steps=128;
    const offsets=cache.get(lit,x,y,radius,width,cs,steps);
    for(let i=0;i<lit.count;i++){
      const cx=i%width,cy=Math.floor(i/width),t=Math.hypot((cx+.5)*cs-x,(cy+.5)*cs-y)/radius;
      expect(offsets[i]).toBe(t>=1?-1:Math.floor(t*steps)*3);
    }
  });
  it('reuses falloff across frames but refreshes after a retrace or geometry change',()=>{
    const cache=new WallLightFalloff(),lit={cells:new Int32Array([0,1,64,65]),count:4};
    const first=cache.get(lit,8,8,96,64,8,128),hypot=vi.spyOn(Math,'hypot');
    expect(cache.get(lit,8,8,96,64,8,128)).toBe(first);expect(hypot).not.toHaveBeenCalled();
    expect(cache.get({...lit,cells:lit.cells.slice()},8,8,96,64,8,128)).not.toBe(first);
    expect(cache.get(lit,9,8,96,64,8,128)).not.toBe(first);
    hypot.mockRestore();
  });
});
