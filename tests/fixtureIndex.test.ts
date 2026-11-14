import { describe, expect, it } from 'vitest';
import { LightingSystem, type FixtureLight } from '../src/systems/LightingSystem';
import { PixelWorld, LIGHT_KIND, type RoomLight } from '../src/world/PixelWorld';
import { CameraSystem } from '../src/systems/CameraSystem';

function panel(x: number, y: number): RoomLight {
  return { kind: LIGHT_KIND.bright, x0:x, x1:x, y0:y, y1:y, cx0:0,cy0:0,cx1:255,cy1:255,phase:0 };
}
function setup() {
  const w = new PixelWorld({width:256,height:256,cellSize:8,roomSize:4});
  for(let y=8;y<256;y+=16)for(let x=8;x<256;x+=16) w.roomLights.push(panel(x,y));
  const lights = new LightingSystem(w), cam=new CameraSystem(w);
  cam.x=cam.y=-100000;cam.viewW=cam.viewH=100;
  lights.updateFixtures(cam); // Build fixtures while keeping shadow tracing offscreen.
  return {w,lights,cam};
}
describe('fixture shadow spatial index',()=>{
  it('invalidates exactly the same fixtures as a full scan at edges and bucket boundaries',()=>{
    const {w,lights}=setup();
    const fixtures=lights.fixtures.filter((f):f is FixtureLight=>!!f);
    for(const [x,y] of [[0,0],[31,32],[32,31],[63,64],[127,128],[255,255]]){
      for(const f of fixtures)f.dirty=false;
      const expected=fixtures.filter(f=>Math.abs(f.x-(x+.5)*8)<f.radius+8&&Math.abs(f.y-(y+.5)*8)<f.radius+8);
      w.setCell(x,y,0,'set');
      expect(fixtures.filter(f=>f.dirty)).toEqual(expected);
    }
  });
  it('replaces buckets after regeneration and handles an empty fixture list',()=>{
    const {w,lights,cam}=setup();
    const old=lights.fixtures.filter((f):f is FixtureLight=>!!f);for(const f of old)f.dirty=false;
    w.roomLights=[panel(32,32)];lights.updateFixtures(cam);
    const current=lights.fixtures[0]!;current.dirty=false;
    w.setCell(32,32,0);expect(current.dirty).toBe(true);expect(old.every(f=>!f.dirty)).toBe(true);
    w.roomLights=[];lights.updateFixtures(cam);expect(()=>w.setCell(32,32,0)).not.toThrow();
  });
  it('ignores HP-only damage that cannot change a shadow silhouette',()=>{
    const {w,lights}=setup();for(const f of lights.fixtures)if(f)f.dirty=false;
    w.health[32*w.width+32]=100;w.damage(32,32,1);
    expect(lights.fixtures.every(f=>!f||!f.dirty)).toBe(true);
  });
});
