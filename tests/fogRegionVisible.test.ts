import { describe, expect, it } from 'vitest';
import { fogRegionVisible } from '../src/rendering/fogRegionVisible';

describe('fog-aware edge rendering',()=>{
  it('skips fully hidden regions but preserves even dim explored tiles',()=>{
    const fog={tileSize:32,tw:16,th:16,light:new Float32Array(256)};
    expect(fogRegionVisible(fog,128,128,256,256)).toBe(false);
    fog.light[6*16+6]=.001;
    expect(fogRegionVisible(fog,128,128,256,256)).toBe(true);
  });
  it('keeps neighboring lit tiles for the fog interpolation margin',()=>{
    const fog={tileSize:32,tw:16,th:16,light:new Float32Array(256)};
    fog.light[3*16+3]=1;
    expect(fogRegionVisible(fog,128,128,256,256)).toBe(true);
    fog.light.fill(0);fog.light[1*16+1]=1;
    expect(fogRegionVisible(fog,128,128,256,256)).toBe(false);
  });
  it('handles regions at map edges and entirely outside the fog grid',()=>{
    const fog={tileSize:32,tw:2,th:2,light:new Float32Array([1,0,0,0])};
    expect(fogRegionVisible(fog,-20,-20,10,10)).toBe(true);
    expect(fogRegionVisible(fog,512,512,600,600)).toBe(false);
  });
});
