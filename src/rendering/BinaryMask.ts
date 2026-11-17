/** Packed persistent bits for a raster mask whose shared scratch image is only
 * valid inside the current edit rectangle. Count tracks the entire mask. */
export class BinaryMask {
  readonly bits: Uint8Array;
  count = 0;

  constructor(readonly size: number) {
    this.bits = new Uint8Array(Math.ceil(size * size / 8));
  }

  update(source: Uint8Array, x0: number, y0: number, x1: number, y1: number): boolean {
    let changed = false;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * this.size + x, byte = i >> 3, bit = 1 << (i & 7);
      const before = (this.bits[byte] & bit) !== 0;
      const after = source[i] !== 0;
      if (before === after) continue;
      this.bits[byte] ^= bit;
      this.count += after ? 1 : -1;
      changed = true;
    }
    return changed;
  }
}
