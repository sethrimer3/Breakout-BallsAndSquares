import { afterEach, describe, expect, it, vi } from 'vitest';
afterEach(()=>vi.unstubAllGlobals());
describe('shared portal artwork',()=>{
  it('returns independent pixel copies while avoiding repeated noise generation',async()=>{
    vi.resetModules();const {portalNoiseTile}=await import('../src/rendering/portalNoise');
    const original=portalNoiseTile(),expected=original.slice();original.fill(0);
    expect(portalNoiseTile()).toEqual(expected);
    const cos=vi.spyOn(Math,'cos');portalNoiseTile();expect(cos).not.toHaveBeenCalled();cos.mockRestore();
  });
  it('shares two immutable source canvases but keeps each target pattern independent',async()=>{
    vi.resetModules();const source={createImageData:(w:number,h:number)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData:vi.fn()};
    const create=vi.fn(()=>({width:0,height:0,getContext:()=>source}));vi.stubGlobal('document',{createElement:create});
    class Matrix {translate(){return this;}scale(){return this;}}vi.stubGlobal('DOMMatrix',Matrix);
    const target=()=>({createPattern:vi.fn(()=>({setTransform:vi.fn()})),save(){},restore(){},fillRect(){}});
    const a=target(),b=target(),{paintPortal}=await import('../src/rendering/portalNoise');
    paintPortal(a as unknown as CanvasRenderingContext2D,{x:0,y:0,w:32,h:32},1);
    paintPortal(b as unknown as CanvasRenderingContext2D,{x:0,y:0,w:32,h:32},2);
    paintPortal(a as unknown as CanvasRenderingContext2D,{x:0,y:0,w:32,h:32},3);
    expect(create).toHaveBeenCalledTimes(2);expect(a.createPattern).toHaveBeenCalledTimes(2);expect(b.createPattern).toHaveBeenCalledTimes(2);
    expect(a.createPattern.mock.calls[0]).toEqual(b.createPattern.mock.calls[0]);
    expect(a.createPattern.mock.results[0].value).not.toBe(b.createPattern.mock.results[0].value);
  });
});
