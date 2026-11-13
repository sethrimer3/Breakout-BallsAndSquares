/* Requires an existing Vite server. Exercises the real renderer's fog ordering. */
let playwright;try{playwright=require('playwright');}catch{playwright=require('/opt/codex/cua_node/lib/node_modules/playwright');}
const {chromium}=playwright;const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({executablePath:process.env.BREACH_CHROMIUM||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});try{
const page=await browser.newPage({viewport:{width:1100,height:760}});await page.goto(process.env.BREACH_BASE_URL||'http://127.0.0.1:5173');await page.locator('[data-act="play"]').click();
const result=await page.evaluate(()=>{const g=window.__game;g.paused=true;g.save.data.settings.devMode=false;g.save.data.settings.devMapAccess=false;
const w=g.world,f=w.labLayout.frame,c=g.camera;c.following=false;c.manualTarget=false;c.x=f.x0*w.cellSize;c.y=(f.y0+31)*w.cellSize;c.zoom=6;
const sample=()=>{g.renderer.draw();const ctx=g.canvas.getContext('2d');const dpr=g.canvas.width/c.viewW;const x=c.worldToScreenX((f.x0-.5)*w.cellSize),y=c.worldToScreenY((f.y0+31.5)*w.cellSize);return [...ctx.getImageData(Math.round(x*dpr),Math.round(y*dpr),1,1).data];};
g.fog.light.fill(0);const hidden=sample();g.fog.light.fill(1);const revealed=sample();g.fog.light.fill(0);const hiddenAgain=sample();return{hidden,revealed,hiddenAgain};});
assert.deepEqual(result.hidden.slice(0,3),[3,4,8]);assert.notDeepEqual(result.revealed,result.hidden);assert.deepEqual(result.hiddenAgain,result.hidden);console.log(JSON.stringify(result));

}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1;});
