import { describe, expect, it } from 'vitest';
import { FACILITY } from '../src/config';
import { RoomLightIndex, visibleRoomLightIndices } from '../src/rendering/RoomLightIndex';
import { CameraSystem } from '../src/systems/CameraSystem';
import { LIGHT_KIND, PixelWorld, type RoomLight } from '../src/world/PixelWorld';

function light(x: number, y: number, kind: RoomLight["kind"] = LIGHT_KIND.bright): RoomLight {
  return { kind, x0:x, y0:y, x1:x, y1:y, cx0:x, cy0:y, cx1:x, cy1:y, phase:0 };
}

describe('ordered room light queries', () => {
  it('retains a halo whose source is outside the viewport', () => {
    const r=FACILITY.panelRadiusCells;
    const index=new RoomLightIndex([light(64,64)],256,256,8);
    expect(index.query(64+r-1,64,64+r,65)).toEqual([0]);
    expect(index.query(200,200,201,201)).toEqual([]);
  });
  it('includes room washes and Blight glows by their clipped room bounds', () => {
    const wash=light(100,100,LIGHT_KIND.wash),blight=light(110,110,LIGHT_KIND.blight);
    wash.cx0=blight.cx0=20;wash.cy0=blight.cy0=20;
    const index=new RoomLightIndex([wash,blight],256,256,8);
    expect(index.query(22,22,23,23)).toEqual([0,1]);
  });
  it('deduplicates overlapping buckets and preserves original painter order', () => {
    const index=new RoomLightIndex([light(65,64),light(31,32),light(64,64)],256,256,8);
    expect(index.query(25,25,70,70)).toEqual([0,1,2]);
    expect(index.query(25,25,70,70)).toEqual([0,1,2]);
    expect(index.query(-100,-100,-90,-90)).toEqual([]);
  });
  it('uses the complete ordered list for a world overview', () => {
    const index=new RoomLightIndex([light(64,64),light(20,20)],256,256,8);
    expect(index.query(-10,-10,300,300)).toEqual([0,1]);
  });
  it('rebuilds shared queries on regeneration and in-place appends', () => {
    const w=new PixelWorld({width:256,height:256,cellSize:8,roomSize:4});
    const cam=new CameraSystem(w);cam.x=64*8;cam.y=64*8;cam.zoom=4;cam.viewW=cam.viewH=20;
    w.roomLights=[light(64,64)];expect(visibleRoomLightIndices(w,cam)).toEqual([0]);
    w.roomLights[0].destroyed=true;
    // Destruction remains a lightLevel decision, so parallel fixture indices remain stable.
    expect(visibleRoomLightIndices(w,cam)).toEqual([0]);
    w.roomLights=[light(200,200)];expect(visibleRoomLightIndices(w,cam)).toEqual([]);
    w.roomLights.push(light(64,64));expect(visibleRoomLightIndices(w,cam)).toEqual([1]);
  });
});
