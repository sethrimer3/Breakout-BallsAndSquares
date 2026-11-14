import { afterEach, describe, expect, it, vi } from 'vitest';
import { FogRenderer } from '../src/rendering/FogRenderer';
import { FogOfWar } from '../src/world/FogOfWar';
import { PixelWorld } from '../src/world/PixelWorld';
import { CameraSystem } from '../src/systems/CameraSystem';

afterEach(()=>vi.unstubAllGlobals());
function scene(){
  const w=new PixelWorld({width:64,height:64,cellSize:8,roomSize:4}),fog=new FogOfWar(w),cam=new CameraSystem(w);cam.zoom=1;
  const put=vi.fn(),ctx={createImageData:(w:number,h:number)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData:put};
  vi.stubGlobal('document',{createElement:()=>({getContext:()=>ctx})});
  const renderer=new FogRenderer(fog),target={save(){},restore(){},drawImage(){}} as unknown as CanvasRenderingContext2D;
  return{fog,cam,renderer,target,put};
}
describe('changed fog texture uploads',()=>{
  it('initializes opaque fog once and skips uploads when rendered alpha is unchanged',()=>{
    const {fog,cam,renderer,target,put}=scene();expect(put).toHaveBeenCalledTimes(1);put.mockClear();
    cam.x=cam.y=64;cam.viewW=cam.viewH=128;
    renderer.draw(target,cam);renderer.draw(target,cam);expect(put).not.toHaveBeenCalled();
    fog.light[0]=.00001;renderer.draw(target,cam);expect(put).not.toHaveBeenCalled();
    fog.light[0]=.5;renderer.draw(target,cam);expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0].slice(3)).toEqual([0,0,1,1]);
  });
  it('uploads offscreen changes on entering view, including fog resetting to opaque',()=>{
    const {fog,cam,renderer,target,put}=scene();cam.x=cam.y=400;cam.viewW=cam.viewH=32;put.mockClear();
    fog.light[0]=1;renderer.draw(target,cam);expect(put).not.toHaveBeenCalled();
    cam.x=cam.y=0;renderer.draw(target,cam);expect(put).toHaveBeenCalledTimes(1);
    put.mockClear();fog.light.fill(0);renderer.draw(target,cam);expect(put).toHaveBeenCalledTimes(1);
  });
});
