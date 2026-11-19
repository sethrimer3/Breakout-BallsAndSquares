import type { CameraSystem } from "../systems/CameraSystem";
import { conversionProgress, coreLevel, generatorColors } from "../world/GeneratorTiers";
import type { BlightCore, PixelWorld } from "../world/PixelWorld";

/**
 * A pixel-art rim round every living Blight generator in its level's colors,
 * with one stud per tier step inside its world (1-3), so a tougher generator
 * reads apart from a weaker one at a glance. During a takeover the new
 * colors crawl round the rim from the top-left corner, led by a bright head.
 */

/** Rim pixels, clockwise from the top-left corner, for an `n`-pixel square. */
function perimeter(n: number): [number, number][] {
  const out: [number, number][] = [];
  for (let x = 0; x < n - 1; x++) out.push([x, 0]);
  for (let y = 0; y < n - 1; y++) out.push([n - 1, y]);
  for (let x = n - 1; x > 0; x--) out.push([x, n - 1]);
  for (let y = n - 1; y > 0; y--) out.push([0, y]);
  return out;
}

const PERIMETERS = new Map<number, [number, number][]>();
function rimOf(n: number): [number, number][] {
  let p = PERIMETERS.get(n);
  if (!p) PERIMETERS.set(n, (p = perimeter(n)));
  return p;
}

/** Studs along the top edge: tier step inside the generator's world (1-3). */
function studs(level: number): number {
  return ((Math.max(1, Math.round(level)) - 1) % 3) + 1;
}

export function drawGeneratorRims(ctx: CanvasRenderingContext2D, cam: CameraSystem, world: PixelWorld, time: number): void {
  const cores = world.blightCores;
  if (cores.length === 0) return;
  const cs = world.cellSize;
  const z = cam.zoom;
  const px = Math.max(1, Math.ceil(z));
  const vx0 = cam.screenToWorldX(0) - cs * 3;
  const vy0 = cam.screenToWorldY(0) - cs * 3;
  const vx1 = cam.screenToWorldX(cam.viewW) + cs * 3;
  const vy1 = cam.screenToWorldY(cam.viewH) + cs * 3;
  for (const core of cores) {
    if (!core.alive) continue;
    const x0 = core.cx * cs, y0 = core.cy * cs;
    if (x0 > vx1 || y0 > vy1 || x0 + core.size * cs < vx0 || y0 + core.size * cs < vy0) continue;
    if (!anyCellStanding(world, core)) continue;
    drawRim(ctx, cam, core, coreLevel(world, core), x0, y0, core.size * cs, px, time);
  }
}

function anyCellStanding(world: PixelWorld, core: BlightCore): boolean {
  for (const i of core.cells) if (world.health[i] > 0) return true;
  return false;
}

function drawRim(
  ctx: CanvasRenderingContext2D,
  cam: CameraSystem,
  core: BlightCore,
  level: number,
  x0: number,
  y0: number,
  n: number,
  px: number,
  time: number,
): void {
  const rim = rimOf(n);
  const from = generatorColors(level);
  const to = core.convertTo !== undefined ? generatorColors(core.convertTo) : from;
  const progress = conversionProgress(core);
  const head = core.convertTo !== undefined ? Math.floor(progress * rim.length) : -1;
  const put = (x: number, y: number, c: string): void => {
    ctx.fillStyle = c;
    ctx.fillRect(Math.floor(cam.worldToScreenX(x0 + x)), Math.floor(cam.worldToScreenY(y0 + y)), px, px);
  };
  // A slow shimmer runs round the rim so it reads as living, not painted on.
  const shimmer = Math.floor((time * 6 + core.id * 5) % rim.length);
  for (let k = 0; k < rim.length; k++) {
    const [x, y] = rim[k];
    const conv = head >= 0 && k < head;
    const pal = conv ? to : from;
    let c = pal[1];
    if (k === head || k === head - 1) c = "#ffffff";
    else if (Math.abs(k - shimmer) <= 1) c = pal[2];
    put(x, y, c);
    // Dark outline just outside the rim keeps it crisp over pink creep.
    if (y === 0) put(x, -1, pal[0]);
    if (y === n - 1) put(x, n, pal[0]);
    if (x === 0) put(-1, y, pal[0]);
    if (x === n - 1) put(n, y, pal[0]);
  }
  // Tier studs, inset along the top edge.
  const settled = core.convertTo !== undefined && progress >= 0.5 ? core.convertTo : level;
  const pal = settled === level ? from : to;
  const count = studs(settled);
  const gap = n >= 12 ? 3 : 2;
  const start = Math.floor((n - (count - 1) * gap) / 2);
  for (let s = 0; s < count; s++) put(start + s * gap, 1, pal[2]);
}
