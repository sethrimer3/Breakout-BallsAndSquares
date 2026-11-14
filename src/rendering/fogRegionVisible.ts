/** Conservative visibility test, padded for bilinear filtering at fog-tile edges. */
export function fogRegionVisible(
  fog: { tileSize: number; tw: number; th: number; light: Float32Array },
  x0: number, y0: number, x1: number, y1: number,
): boolean {
  const left=Math.max(0,Math.floor(x0/fog.tileSize)-1);
  const top=Math.max(0,Math.floor(y0/fog.tileSize)-1);
  const right=Math.min(fog.tw-1,Math.ceil(x1/fog.tileSize)+1);
  const bottom=Math.min(fog.th-1,Math.ceil(y1/fog.tileSize)+1);
  for(let y=top;y<=bottom;y++)for(let x=left;x<=right;x++)if(fog.light[y*fog.tw+x]>0)return true;
  return false;
}
