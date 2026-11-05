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

/** Pre-rendered golden square with a soft outer radial glow for ultra-fast single-drawImage loot rendering. */
export function goldSquareSprite(size: number): HTMLCanvasElement {
  const [c, g] = makeCanvas(size);
  const r = size / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, "rgba(255, 240, 130, 0.95)");
  grad.addColorStop(0.28, "rgba(255, 195, 40, 0.55)");
  grad.addColorStop(0.62, "rgba(255, 140, 10, 0.16)");
  grad.addColorStop(1, "rgba(255, 110, 0, 0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);

  // Crisp pixel-art golden square core in the center.
  const sq = Math.round(size * 0.34);
  const x0 = Math.round(r - sq / 2);
  const y0 = Math.round(r - sq / 2);
  g.fillStyle = "#e89a10";
  g.fillRect(x0 - 1, y0 - 1, sq + 2, sq + 2);
  g.fillStyle = "#ffd942";
  g.fillRect(x0, y0, sq, sq);
  const inner = Math.max(2, Math.round(sq * 0.5));
  g.fillStyle = "#fffbe0";
  g.fillRect(x0 + 1, y0 + 1, inner, inner);
  return c;
}

/** Pre-rendered glowing orange crystal (Zone 2 currency) with baked radial glow. */
export function orangeCrystalSprite(size: number): HTMLCanvasElement {
  const [c, g] = makeCanvas(size);
  const r = size / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, "rgba(255, 190, 95, 0.95)");
  grad.addColorStop(0.28, "rgba(255, 115, 25, 0.58)");
  grad.addColorStop(0.62, "rgba(215, 55, 5, 0.18)");
  grad.addColorStop(1, "rgba(160, 25, 0, 0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);

  // Crisp faceted diamond/crystal in the center.
  const hw = Math.round(size * 0.19);
  const hh = Math.round(size * 0.27);
  g.fillStyle = "#b83804";
  g.beginPath();
  g.moveTo(r, r - hh - 1);
  g.lineTo(r + hw + 1, r);
  g.lineTo(r, r + hh + 1);
  g.lineTo(r - hw - 1, r);
  g.closePath();
  g.fill();

  g.fillStyle = "#ff7b1c";
  g.beginPath();
  g.moveTo(r, r - hh);
  g.lineTo(r + hw, r);
  g.lineTo(r, r + hh);
  g.lineTo(r - hw, r);
  g.closePath();
  g.fill();

  // Upper-left bright facet highlight.
  g.fillStyle = "#ffe6b0";
  g.beginPath();
  g.moveTo(r, r - hh + 1.5);
  g.lineTo(r + hw * 0.45, r);
  g.lineTo(r, r + hh * 0.25);
  g.lineTo(r - hw * 0.65, r);
  g.closePath();
  g.fill();
  return c;
}

export interface Sprites {
  soldier: HTMLCanvasElement;
  soldierGlow: HTMLCanvasElement;
  warmGlow: HTMLCanvasElement;
  hotGlow: HTMLCanvasElement;
  crimsonGlow: HTMLCanvasElement;
  goldSquare: HTMLCanvasElement;
  orangeCrystal: HTMLCanvasElement;
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
    goldSquare: goldSquareSprite(32),
    orangeCrystal: orangeCrystalSprite(32),
    dot: radialSprite(16, [
      [0, "rgba(255,255,255,1)"],
      [0.5, "rgba(255,255,255,0.6)"],
      [1, "rgba(255,255,255,0)"],
    ]),
  };
}
