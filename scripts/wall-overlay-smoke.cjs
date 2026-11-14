/* Requires Vite. Verify sparse wall overlays against the full overlay while moving/zooming. */
let playwright;try{playwright=require('playwright');}catch{playwright=require('/opt/codex/cua_node/lib/node_modules/playwright');}
const assert=require('node:assert/strict');
(async()=>{const browser=await playwright.chromium.launch({executablePath:process.env.BREACH_CHROMIUM||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});try{
const page=await browser.newPage({viewport:{width:1000,height:700}});await page.goto(process.env.BREACH_BASE_URL||'http://127.0.0.1:5173');await page.locator('[data-act="play"]').click();
const result=await page.evaluate(()=>{const g=window.__game;g.paused=true;const c=g.camera;for(let i=0;i<100;i++)g.lighting.updateFixtures(c);
const lighting=g.lighting,fixtures=lighting.fixtures;
const old=(cx,cy)=>{const x=(cx+.5)*g.world.cellSize,y=(cy+.5)*g.world.cellSize;for(const f of fixtures){if(!f||f.dirty)continue;const r=f.radius+g.world.cellSize;if(Math.abs(f.x-x)<r&&Math.abs(f.y-y)<r)f.dirty=true;}};
const measure=fn=>{for(const f of fixtures)if(f)f.dirty=false;const t=performance.now();for(let i=0;i<10000;i++)fn(i%g.world.width,(i*17)%g.world.height);return performance.now()-t;};
const indexMs=measure((x,y)=>lighting.invalidateFixtures(x,y)),scanMs=measure(old);
const lamp=fixtures.find(f=>f&&f.lit.count>0&&!f.light.destroyed);if(!lamp)throw Error('No traced fixture');
lighting.fixtures=[lamp];lighting.softCount=0;g.flashes.length=0;g.terrain.lightLevel=()=>1;
const lr=g.renderer.lightRenderer;lr.updateWallLight(g);
const a=document.createElement('canvas'),b=document.createElement('canvas');a.width=b.width=1000;a.height=b.height=700;
const ac=a.getContext('2d'),bc=b.getContext('2d');let fullCalls=0,sparseCalls=0;
const ad=ac.drawImage.bind(ac),bd=bc.drawImage.bind(bc);ac.drawImage=(...args)=>{fullCalls++;ad(...args)};bc.drawImage=(...args)=>{sparseCalls++;bd(...args)};
for(const zoom of [.25,.5,1.13,2]){
 c.zoom=zoom;c.x=lamp.x+.37;c.y=lamp.y+.71;ac.clearRect(0,0,1000,700);bc.clearRect(0,0,1000,700);
 g.terrain.drawCellOverlay(ac,c,lr.wallCanvas);g.terrain.drawCellOverlay(bc,c,lr.wallCanvas,lr.wallChunks);
 const x=ac.getImageData(0,0,1000,700).data,y=bc.getImageData(0,0,1000,700).data;for(let i=0;i<x.length;i++)if(x[i]!==y[i])throw Error('Overlay pixels differ at zoom '+zoom);
}
lighting.fixtures=[];lr.updateWallLight(g);if(lr.wallChunks.some(x=>x))throw Error('Stale lit chunks remain');
return {fullCalls,sparseCalls,indexMs,scanMs,fixtureCount:fixtures.length};});
assert.ok(result.sparseCalls<result.fullCalls);console.log(JSON.stringify(result));
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
