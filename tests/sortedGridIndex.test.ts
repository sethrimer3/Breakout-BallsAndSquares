import { describe, expect, it } from 'vitest';
import { SortedGridIndex } from '../src/rendering/SortedGridIndex';

function visible(index: SortedGridIndex, height: number, x0: number, y0: number, x1: number, y1: number) {
  const result:number[]=[];
  for(let row=Math.max(0,y0);row<=Math.min(height-1,y1);row++) {
    const start=index.lowerBound(row*index.width+x0,index.rows[row],index.rows[row+1]);
    const end=index.lowerBound(row*index.width+x1+1,start,index.rows[row+1]);
    for(let i=start;i<end;i++)result.push(index.indices[i]);
  }
  return result;
}
describe('sorted grid light index',()=>{
  it('matches a full viewport scan in original draw order, including padded/off-map bounds',()=>{
    const width=67,height=65,indices=Int32Array.from({length:width*height},(_,i)=>i).filter(i=>(i*17)%19<3);
    const index=new SortedGridIndex(indices,width,height);
    for(const bounds of [[0,0,66,64],[2,3,7,12],[-5,-5,3,3],[64,61,100,100],[-50,10,100,13],[90,80,100,90]]){
      const [x0,y0,x1,y1]=bounds;
      const expected=[...indices].filter(i=>i%width>=x0&&i%width<=x1&&Math.floor(i/width)>=y0&&Math.floor(i/width)<=y1);
      expect(visible(index,height,x0,y0,x1,y1)).toEqual(expected);
    }
  });
  it('handles empty rows, an empty list, and replacement after regeneration',()=>{
    expect(visible(new SortedGridIndex(new Int32Array(0),4,4),4,0,0,4,4)).toEqual([]);
    const index=new SortedGridIndex(new Int32Array([0,3,12,15]),4,4);
    expect([...index.rows]).toEqual([0,2,2,2,4]);
    expect(visible(index,4,1,0,2,3)).toEqual([]);
  });
});
