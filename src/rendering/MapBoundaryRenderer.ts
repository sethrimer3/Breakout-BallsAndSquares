import type { PixelWorld } from '../world/PixelWorld';
import type { CameraSystem } from '../systems/CameraSystem';
import { boundaryColor, BOUNDARY_VOID } from '../world/MapBoundary';

const CHUNK = 32, TEX = 4;
interface BoundaryCache {
  revision: number;
  columns: number;
  /** 0 = playable, 1 = opaque black, 2 = textured perimeter. */
  kinds: Uint8Array;
  textures: Map<number, HTMLCanvasElement>;
}
const caches = new WeakMap<PixelWorld, BoundaryCache>();

function cacheFor(w: PixelWorld): BoundaryCache {
  const old = caches.get(w);
  if (old?.revision === w.boundaryRevision) return old;
  const columns = Math.ceil(w.width / CHUNK), rows = Math.ceil(w.height / CHUNK);
  const kinds = new Uint8Array(columns * rows);
  for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < columns; cx++) {
    let black = true, empty = true;
    for (let y = cy * CHUNK; y < Math.min(w.height, (cy+1)*CHUNK); y++) {
      for (let x = cx * CHUNK; x < Math.min(w.width, (cx+1)*CHUNK); x++) {
        const layer = w.boundary[y*w.width+x];
        empty &&= layer === 0;
        black &&= layer === BOUNDARY_VOID || layer === w.boundaryThickness;
      }
    }
    kinds[cy*columns+cx] = empty ? 0 : black ? 1 : 2;
  }
  const cache = { revision: w.boundaryRevision, columns, kinds, textures: new Map<number, HTMLCanvasElement>() };
  caches.set(w, cache);
  return cache;
}

function texture(w: PixelWorld, cache: BoundaryCache, key: number, cx: number, cy: number): HTMLCanvasElement {
  const old = cache.textures.get(key);
  if (old) return old;
  const canvas = document.createElement('canvas');
  canvas.width = Math.min(CHUNK, w.width-cx*CHUNK)*TEX;
  canvas.height = Math.min(CHUNK, w.height-cy*CHUNK)*TEX;
  const ctx = canvas.getContext('2d')!, pixels = ctx.createImageData(canvas.width, canvas.height);
  for (let py = 0; py < canvas.height; py++) for (let px = 0; px < canvas.width; px++) {
    const x = cx*CHUNK+Math.floor(px/TEX), y = cy*CHUNK+Math.floor(py/TEX);
    if (!w.boundary[y*w.width+x]) continue;
    const color = boundaryColor(w,x,y,px%TEX,py%TEX), i = (py*canvas.width+px)*4;
    pixels.data[i] = color[0]; pixels.data[i+1] = color[1]; pixels.data[i+2] = color[2]; pixels.data[i+3] = 255;
  }
  ctx.putImageData(pixels,0,0);
  cache.textures.set(key,canvas);
  return canvas;
}

/** Cached opaque pass; gameplay fog must be drawn afterward. */
export function drawMapBoundary(ctx: CanvasRenderingContext2D, w: PixelWorld, cam: CameraSystem): void {
  const cache = cacheFor(w), size = w.cellSize*cam.zoom;
  const left = cam.worldToScreenX(0), top = cam.worldToScreenY(0);
  const right = cam.worldToScreenX(w.worldWidth), bottom = cam.worldToScreenY(w.worldHeight);
  ctx.save(); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#000';
  // Outside the storage grid needs no cell traversal, even at extreme zoom levels.
  if (left > 0) ctx.fillRect(0,0,left,cam.viewH);
  if (right < cam.viewW) ctx.fillRect(right,0,cam.viewW-right,cam.viewH);
  if (top > 0) ctx.fillRect(0,0,cam.viewW,top);
  if (bottom < cam.viewH) ctx.fillRect(0,bottom,cam.viewW,cam.viewH-bottom);
  const x0 = Math.max(0,Math.floor(cam.screenToWorldX(0)/w.cellSize/CHUNK));
  const y0 = Math.max(0,Math.floor(cam.screenToWorldY(0)/w.cellSize/CHUNK));
  const x1 = Math.min(cache.columns,Math.ceil(cam.screenToWorldX(cam.viewW)/w.cellSize/CHUNK));
  const y1 = Math.min(Math.ceil(w.height/CHUNK),Math.ceil(cam.screenToWorldY(cam.viewH)/w.cellSize/CHUNK));
  for (let cy=y0;cy<y1;cy++) for (let cx=x0;cx<x1;cx++) {
    const key=cy*cache.columns+cx, kind=cache.kinds[key];
    if (!kind) continue;
    const x=left+cx*CHUNK*size, y=top+cy*CHUNK*size;
    const width=Math.min(CHUNK,w.width-cx*CHUNK)*size, height=Math.min(CHUNK,w.height-cy*CHUNK)*size;
    if (kind===1) ctx.fillRect(x,y,width+.25,height+.25);
    else ctx.drawImage(texture(w,cache,key,cx,cy),x,y,width,height);
  }
  ctx.restore();
}
