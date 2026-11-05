/** Pre-rendered gradient sprites (avoid creating gradients per particle per frame). */

function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  return [c, c.getContext("2d")!];
}

/** Radial glow: stops are [offset, rgba] pairs. */
export function radialSprite(size: number, stops: [number, string][]): HTMLCanvasElement {
  const [c, g] = makeCanvas(size);
  const r = size / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  for (const [o, col] of stops) grad.addColorStop(o, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

/** Shaded metallic soldier sphere with a cyan rim highlight. */
export function soldierSprite(size: number): HTMLCanvasElement {
  const [c, g] = makeCanvas(size);
  const r = size / 2;
  const body = g.createRadialGradient(r * 0.7, r * 0.6, r * 0.05, r, r, r);
  body.addColorStop(0, "#d8fbff");
  body.addColorStop(0.18, "#6fb6d0");
  body.addColorStop(0.55, "#1f3a52");
  body.addColorStop(1, "#0b1420");
  g.fillStyle = body;
  g.beginPath();
  g.arc(r, r, r - 1, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "rgba(140, 240, 255, 0.55)";
  g.lineWidth = Math.max(1, size * 0.05);
  g.beginPath();
  g.arc(r, r, r - g.lineWidth, Math.PI * 0.15, Math.PI * 0.95);
  g.stroke();
  return c;
}

export interface Sprites {
  soldier: HTMLCanvasElement;
  soldierGlow: HTMLCanvasElement;
  warmGlow: HTMLCanvasElement;
  hotGlow: HTMLCanvasElement;
  crimsonGlow: HTMLCanvasElement;
  dot: HTMLCanvasElement;
}

export function createSprites(): Sprites {
  return {
    soldier: soldierSprite(64),
    soldierGlow: radialSprite(64, [
      [0, "rgba(120, 225, 255, 0.45)"],
      [0.4, "rgba(80, 180, 255, 0.15)"],
      [1, "rgba(40, 120, 255, 0)"],
    ]),
    warmGlow: radialSprite(64, [
      [0, "rgba(255, 245, 220, 1)"],
      [0.15, "rgba(255, 220, 140, 0.8)"],
      [0.45, "rgba(255, 140, 40, 0.25)"],
      [1, "rgba(255, 90, 0, 0)"],
    ]),
    hotGlow: radialSprite(64, [
      [0, "rgba(255, 255, 255, 1)"],
      [0.3, "rgba(255, 240, 200, 0.6)"],
      [1, "rgba(255, 200, 120, 0)"],
    ]),
    crimsonGlow: radialSprite(64, [
      [0, "rgba(255, 60, 110, 0.9)"],
      [0.4, "rgba(200, 20, 80, 0.35)"],
      [1, "rgba(120, 0, 60, 0)"],
    ]),
    dot: radialSprite(16, [
      [0, "rgba(255,255,255,1)"],
      [0.5, "rgba(255,255,255,0.6)"],
      [1, "rgba(255,255,255,0)"],
    ]),
  };
}
