import { describe, expect, it } from 'vitest';
import { GROWTH } from '../src/config';
import { hasVisibleGrowthGlows } from '../src/rendering/GrowthGlowVisibility';

function fixture() {
  const world={width:16,cellSize:8,health:new Uint16Array(256)};
  world.health.fill(10);
  const growth={glowCount:1,glowHead:1,glowIndex:new Int32Array(4),glowTime:new Float32Array(4)};
  const cam={viewW:120,viewH:80,worldToScreenX:(x:number)=>x,worldToScreenY:(y:number)=>y};
  return {world,growth,cam};
}

describe('growth glow draw/cache eligibility', () => {
  it('ignores retained history after expiration and rejects future timestamps', () => {
    const {world,growth,cam}=fixture();
    expect(hasVisibleGrowthGlows(world,growth,cam,GROWTH.glowDuration)).toBe(false);
    expect(hasVisibleGrowthGlows(world,growth,cam,-.01)).toBe(false);
    expect(hasVisibleGrowthGlows(world,growth,cam,GROWTH.glowDuration-.01)).toBe(true);
    growth.glowCount=0;
    expect(hasVisibleGrowthGlows(world,growth,cam,0)).toBe(false);
  });

  it('ignores cells whose full-size terrain no longer has health', () => {
    const {world,growth,cam}=fixture();world.health[0]=0;
    expect(hasVisibleGrowthGlows(world,growth,cam,0)).toBe(false);
    world.health[0]=10;
    expect(hasVisibleGrowthGlows(world,growth,cam,0)).toBe(true);
  });

  it.each([
    [-60,4,true],[-60.001,4,false],[180,4,true],[180.001,4,false],
    [4,-60,true],[4,-60.001,false],[4,140,true],[4,140.001,false],
  ])('preserves the draw margin at screen (%s,%s)', (x,y,visible) => {
    const {world,growth,cam}=fixture();
    cam.worldToScreenX=()=>x;cam.worldToScreenY=()=>y;
    expect(hasVisibleGrowthGlows(world,growth,cam,0)).toBe(visible);
  });

  it('uses the same rounded, minimum-one-pixel viewport as the lighting pass', () => {
    const {world,growth,cam}=fixture();
    cam.viewW=120.6;cam.worldToScreenX=()=>180.9;
    expect(hasVisibleGrowthGlows(world,growth,cam,0)).toBe(true);
    cam.viewW=0;cam.worldToScreenX=()=>60.5;
    expect(hasVisibleGrowthGlows(world,growth,cam,0)).toBe(true);
  });

  it('finds active entries across ring wrapping', () => {
    const {world,growth,cam}=fixture();
    growth.glowCount=4;growth.glowHead=1;
    growth.glowIndex.set([0,1,2,2]);growth.glowTime.set([0,10,0,0]);
    expect(hasVisibleGrowthGlows(world,growth,cam,10.5)).toBe(true);
    growth.glowCount=3;
    expect(hasVisibleGrowthGlows(world,growth,cam,10.5)).toBe(false);
  });

  it('continues past irrelevant entries without assuming ordered timestamps', () => {
    const {world,growth,cam}=fixture();
    growth.glowCount=4;growth.glowHead=1;
    growth.glowTime.set([0,0,0,10]);
    expect(hasVisibleGrowthGlows(world,growth,cam,10.5)).toBe(true);
  });
});
