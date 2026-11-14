/* Vite required. Compare fog-culled Blight edges against the unculled pass. */
let pw;try{pw=require('playwright')}catch{pw=require('/opt/codex/cua_node/lib/node_modules/playwright')}
(async()=>{const browser=await pw.chromium.launch({executablePath:process.env.BREACH_CHROMIUM||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});try{const page=await browser.newPage({viewport:{width:1000,height:700}});await page.goto(process.env.BREACH_BASE_URL||'http://127.0.0.1:5173');await page.locator('[data-act="play"]').click();console.log(await page.evaluate(async()=>{
const {FogRenderer}=await import('/src/rendering/FogRenderer.ts');const g=window.__game;g.paused=true;const w=g.world,c=g.camera,t=g.terrain,fog=g.fog,renderer=new FogRenderer(fog);c.following=false;c.x=w.roomCenterX+256;c.y=w.roomCenterY+256;
const a=document.createElement('canvas'),b=document.createElement('canvas');a.width=b.width=1000;a.height=b.height=700;const ac=a.getContext('2d'),bc=b.getContext('2d');let checks=0;
const core=w.blightCores.find(core=>core.alive);if(!core)throw Error('No Blight core to test');
const coreX=(core.cx+.5)*w.cellSize,coreY=(core.cy+.5)*w.cellSize;
c.x=coreX+.37;c.y=coreY+.71;
const fx=Math.floor(coreX/fog.tileSize),fy=Math.floor(coreY/fog.tileSize);
for(const dormant of [false,true]){t.dormantAt=dormant?()=>true:null;t.rebuildAll();for(const state of ['hidden','partial','explored'])for(const zoom of [.5,1.13,2]){
 fog.light.fill(state==='explored'?.25:0);if(state==='partial')for(let y=fy-2;y<=fy+2;y++)for(let x=fx-2;x<=fx+2;x++)fog.light[y*fog.tw+x]=.45;
 c.zoom=zoom;for(const ctx of [ac,bc]){ctx.clearRect(0,0,1000,700);ctx.fillStyle='#18232b';ctx.fillRect(0,0,1000,700)}
 t.drawBlightEdges(ac,c,7.25);renderer.draw(ac,c);t.drawBlightEdges(bc,c,7.25,fog);renderer.draw(bc,c);
 const aa=ac.getImageData(0,0,1000,700).data,bb=bc.getImageData(0,0,1000,700).data;for(let i=0;i<aa.length;i++)if(aa[i]!==bb[i])throw Error(`Pixels differ: ${dormant}/${state}/${zoom}`);checks++;
}}
t.dormantAt=null;t.rebuildAll();fog.light.fill(0);
const spawnX=Math.floor(w.roomCenterX/fog.tileSize),spawnY=Math.floor(w.roomCenterY/fog.tileSize);
for(let y=spawnY-2;y<=spawnY+2;y++)for(let x=spawnX-2;x<=spawnX+2;x++)fog.light[y*fog.tw+x]=1;
c.x=w.roomCenterX+256;c.y=w.roomCenterY+256;c.zoom=.5;
const measure=culled=>{const samples=[];for(let i=0;i<20;i++){const start=performance.now();t.drawBlightEdges(ac,c,10+i*.1,culled?fog:undefined);samples.push(performance.now()-start)}samples.sort((a,b)=>a-b);return samples[10]};
return{pixelComparisons:checks,unculledMedianMs:measure(false),fogCulledMedianMs:measure(true)};
}));}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
