/** Reusable upload rectangles for sparse chunk masks, clipped to exact pixel bounds. */
export class ChunkRegions {
  readonly rects: Int32Array;
  count = 0;
  pixels = 0;
  private readonly cols: number;
  constructor(private width: number, private height: number, private size: number) {
    this.cols = Math.ceil(width/size);
    this.rects = new Int32Array(this.cols*Math.ceil(height/size)*4);
  }

  update(a: Uint8Array, b: Uint8Array | undefined, x0: number, y0: number, x1: number, y1: number): void {
    this.count = this.pixels = 0;
    x0=Math.max(0,x0);y0=Math.max(0,y0);x1=Math.min(this.width-1,x1);y1=Math.min(this.height-1,y1);
    if(x1<x0||y1<y0)return;
    const left=Math.floor(x0/this.size),right=Math.floor(x1/this.size);
    for(let row=Math.floor(y0/this.size);row<=Math.floor(y1/this.size);row++) {
      let col=left;
      while(col<=right) {
        const k=row*this.cols+col;
        if(!a[k]&&!b?.[k]){col++;continue;}
        const start=col++;
        while(col<=right&&(a[row*this.cols+col]||b?.[row*this.cols+col]))col++;
        const x=Math.max(x0,start*this.size),y=Math.max(y0,row*this.size);
        const w=Math.min(x1+1,col*this.size)-x,h=Math.min(y1+1,(row+1)*this.size)-y;
        const offset=this.count++*4;
        this.rects[offset]=x;this.rects[offset+1]=y;this.rects[offset+2]=w;this.rects[offset+3]=h;
        this.pixels+=w*h;
      }
    }
    // Dense updates retain one upload, with exactly the old tight bounding box.
    const box=(x1-x0+1)*(y1-y0+1);
    if(this.count>0&&this.pixels>=box*.5) {
      this.rects[0]=x0;this.rects[1]=y0;this.rects[2]=x1-x0+1;this.rects[3]=y1-y0+1;
      this.count=1;this.pixels=box;
    }
  }
}
