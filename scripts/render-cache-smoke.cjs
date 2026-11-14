/* Requires Vite. Check raster cache invalidation and floor pixel equivalence. */
const assert=require('node:assert/strict');
let playwright;try{playwright=require('playwright');}catch{playwright=require('/opt/codex/cua_node/lib/node_modules/playwright');}
(async()=>{const browser=await playwright.chromium.launch({executablePath:process.env.BREACH_CHROMIUM||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});try{
const page=await browser.newPage({viewport:{width:1000,height:700}});
await page.goto(process.env.BREACH_BASE_URL||'http://127.0.0.1:5173');await page.locator('[data-act="play"]').click();
const result=await page.evaluate(()=>{const g=window.__game,t=g.terrain,c=g.camera;g.paused=true;
const a=document.createElement('canvas'),b=document.createElement('canvas');
const comparisons=[];
for(const scale of [1,1.25,2])for(const zoom of [.5,1.13,2]){
 c.zoom=zoom;c.x=g.world.roomCenterX+.37;c.y=g.world.roomCenterY+.71;
 a.width=b.width=1000*scale;a.height=b.height=700*scale;
 const ac=a.getContext('2d'),bc=b.getContext('2d');ac.setTransform(scale,0,0,scale,0,0);bc.setTransform(scale,0,0,scale,0,0);
 ac.imageSmoothingEnabled=bc.imageSmoothingEnabled=false;
 const cs=t.chunks.chunkSize;
 t.forEachVisibleChunk(c,(kx,ky,x,y,w,h)=>ac.drawImage(t.floorCanvas,kx*cs*4,ky*cs*4,cs*4,cs*4,x,y,w,h));
 t.drawFloor(bc,c);
 const x=ac.getImageData(0,0,a.width,a.height).data,y=bc.getImageData(0,0,b.width,b.height).data;
 let diff=0;for(let i=0;i<x.length;i++)if(x[i]!==y[i])diff++;
 comparisons.push({scale,zoom,diff});if(diff)throw Error(JSON.stringify(comparisons));
}
const lr=g.renderer.lightRenderer,draw=t.draw;let masks=0;
t.draw=function(ctx,...args){if(ctx===lr.maskCtx)masks++;return draw.call(this,ctx,...args)};
lr.maskState=null;const ctx=g.canvas.getContext('2d');
const render=()=>lr.renderLighting(ctx,g,1);
render();render();if(masks!==1)throw Error('Unchanged mask was not reused');
c.x+=1;render();if(masks!==2)throw Error('Pan did not invalidate mask');
c.zoom+=.01;render();if(masks!==3)throw Error('Zoom did not invalidate mask');
t.chunks.markCell(g.world.roomX0,g.world.roomY0);t.update();render();if(masks!==4)throw Error('Terrain update did not invalidate mask');
t.rebuildAll();render();if(masks!==5)throw Error('Regeneration did not invalidate mask');
lr.renderLighting(ctx,g,1.25);if(masks!==6)throw Error('Device scale did not invalidate mask');
c.viewW-=1;render();if(masks!==7)throw Error('Viewport did not invalidate mask');
return{comparisons,maskRebuilds:masks};});
assert.ok(result.comparisons.every(x=>x.diff===0));console.log(JSON.stringify(result));
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
