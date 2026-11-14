import { afterEach, describe, expect, it, vi } from 'vitest';
import { PixelWorld } from '../src/world/PixelWorld';
import { installMapBoundary } from '../src/world/MapBoundary';
import { CameraSystem } from '../src/systems/CameraSystem';
import { drawMapBoundary } from '../src/rendering/MapBoundaryRenderer';

afterEach(() => vi.unstubAllGlobals());
function scene() {
  const context = { save: vi.fn(), restore: vi.fn(), fillRect: vi.fn(), drawImage: vi.fn(),
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w*h*4) }), putImageData: vi.fn() };
  const create = vi.fn(() => ({ width: 0, height: 0, getContext: () => context }));
  vi.stubGlobal('document', { createElement: create });
  const w = new PixelWorld({ width: 67, height: 65, cellSize: 8, roomSize: 4 });
  installMapBoundary(w);
  const cam = new CameraSystem(w); cam.viewW=1440; cam.viewH=900; cam.zoom=1;
  cam.x=w.worldWidth/2; cam.y=w.worldHeight/2;
  return { w, cam, create, context, ctx: context as unknown as CanvasRenderingContext2D };
}
describe('cached boundary rendering', () => {
  it('reuses static artwork when panning and zooming, including partial edge chunks', () => {
    const { w, cam, ctx, create, context } = scene();
    drawMapBoundary(ctx,w,cam);
    const allocations=create.mock.calls.length;
    expect(allocations).toBeGreaterThan(0);
    expect(allocations).toBeLessThanOrEqual(9);
    cam.zoom=.5; cam.x+=10;
    drawMapBoundary(ctx,w,cam);
    expect(create).toHaveBeenCalledTimes(allocations);
    // Chunk draws replace thousands of per-texel draw calls.
    expect(context.drawImage.mock.calls.length).toBeLessThanOrEqual(18);
  });
  it('invalidates artwork after regeneration of the same world object', () => {
    const { w, cam, ctx, create } = scene();
    drawMapBoundary(ctx,w,cam); const allocations=create.mock.calls.length;
    installMapBoundary(w); drawMapBoundary(ctx,w,cam);
    expect(create).toHaveBeenCalledTimes(allocations*2);
  });
});
