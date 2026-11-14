/** Row offsets into a sorted grid-index list. Rebuilt with the static light list. */
export class SortedGridIndex {
  readonly rows: Int32Array;
  constructor(readonly indices: Int32Array, readonly width: number, height: number) {
    this.rows = new Int32Array(height + 1);
    let cursor = 0;
    for (let row=0; row<=height; row++) {
      while (cursor < indices.length && indices[cursor] < row*width) cursor++;
      this.rows[row] = cursor;
    }
  }

  /** First offset whose grid index is at least value, within a single row. */
  lowerBound(value: number, start: number, end: number): number {
    while (start < end) {
      const mid = (start+end) >>> 1;
      if (this.indices[mid] < value) start = mid+1;
      else end = mid;
    }
    return start;
  }
}
