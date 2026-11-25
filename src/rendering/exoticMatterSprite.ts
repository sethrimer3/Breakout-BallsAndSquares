import { perlin, type Pixels } from "./blightEssence";

export function exoticMatterPixels(time = 0): Pixels {
  const w = 15, h = 19;
  const rails = new Uint8Array(w * h);
  const px = new Array<number>(w * h).fill(-1);
  for (let y = 2; y < h - 2; y++) {
    const wave = Math.sin((y - 2) * Math.PI / 7) * 4;
    const a = Math.round(7 + wave), b = Math.round(7 - wave);
    if (y % 3 === 0) {
      for (let x = Math.min(a, b); x <= Math.max(a, b); x++) {
        px[y * w + x] = (x + y) % 3 === 0 ? 0xffa8d8 : 0xdd388d;
      }
    }
    for (const x of [a, b]) {
      rails[y * w + x] = 1;
      rails[y * w + x + (x < 7 ? 1 : -1)] = 1;
    }
  }
  const palette = [0x672453, 0xaa2b71, 0xf353a4, 0xffb4dd];
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    if (rails[i]) px[i] = 0x08050e;
    else if (px[i] === -1 && (rails[i - 1] || rails[i + 1] || rails[i - w] || rails[i + w])) {
      const n = perlin(x * 0.38, y * 0.38, time);
      px[i] = palette[Math.max(0, Math.min(3, Math.floor(2 + n * 3)))];
    }
  }
  return { w, h, px };
}
