import { perlin } from "./blightEssence";

export const SYMBIOTE_FRAMES = 4;
export const SYMBIOTE_PALETTE: Readonly<Record<string, string>> = {
  "-": "#0c0913",
  "#": "#171220",
  "+": "#302439",
  w: "#9b879f",
  o: "#38d6ff",
  v: "#d7cbdc",
  s: "#451a39",
  e: "#852556",
  p: "#e85299",
};

/** A wet black coating that keeps the soldier's bevel and grows into surrounding pixels. */
export function symbioteGrid(base: readonly string[], stage: number, frame: number): string[] {
  const angle = frame * 2 * Math.PI / SYMBIOTE_FRAMES;
  const driftX = 0.5 * Math.cos(angle);
  const driftY = 0.5 * Math.sin(angle);
  const size = base.length;
  const c = Math.floor(size / 2);
  const solid = (x: number, y: number): boolean => {
    const ch = base[y]?.[x];
    return !!ch && ch !== "." && ch !== "o";
  };
  const near = (x: number, y: number, r: number) =>
    solid(x - r, y) || solid(x + r, y) || solid(x, y - r) || solid(x, y + r);
  return base.map((row, y) => {
    let ink = "";
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === ".") {
        const edge = near(x, y, 1);
        const tendril = stage >= 2 && !edge && near(x, y, 2);
        if (!edge && !tendril) {
          ink += ".";
          continue;
        }
        const n = perlin(x * 0.41 + driftX, y * 0.41 + driftY, 1.25);
        if (edge) ink += n > 0.24 - stage * 0.035 ? "p" : n > -0.02 - stage * 0.045 ? "e" : "s";
        else if (n > 0.34 - stage * 0.07) ink += stage === 3 && n > 0.29 ? "e" : "s";
        else ink += ".";
        continue;
      }
      // An off-centre specular streak catches on the bevel of each shape.
      const streak = (ch === "+" || ch === "w") && y < c && Math.abs(x - c + 1 + (y - c) * 0.65) < 0.75;
      if (streak) ink += "v";
      else if (ch === "-" && perlin(x * 0.41 + driftX, y * 0.41 + driftY, 1.25) > 0.27) ink += "s";
      else ink += ch;
    }
    return ink;
  });
}
