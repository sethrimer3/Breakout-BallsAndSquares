/* Requires Vite. Compare HP-only chunk updates with forced geometry rebuilds. */
let pw;try{pw=require('playwright')}catch{pw=require('/opt/codex/cua_node/lib/node_modules/playwright')}
(async()=>{const browser=await pw.chromium.launch({executablePath:process.env.BREACH_CHROMIUM||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});try{const page=await browser.newPage({viewport:{width:1000,height:700}});await page.goto(process.env.BREACH_BASE_URL||'http://127.0.0.1:5173');await page.locator('[data-act="play"]').click();console.log(await page.evaluate(async()=>{
const {TerrainRenderer}=await import('/src/rendering/TerrainRenderer.ts');const g=window.__game;g.paused=true;const w=g.world,c=g.camera,t=g.terrain,reference=new TerrainRenderer(w,32);reference.rebuildAll();t.rebuildAll();
const idx=w.health.findIndex((hp,i)=>hp>1&&w.blight[i]&&!w.boundary[i]);if(idx<0)throw Error('No blight target');const x=idx%w.width,y=Math.floor(idx/w.width);c.following=false;c.x=(x+.5)*w.cellSize;c.y=(y+.5)*w.cellSize;
const canvas=document.createElement('canvas'),other=document.createElement('canvas');canvas.width=other.width=1000;canvas.height=other.height=700;const a=canvas.getContext('2d'),b=other.getContext('2d');
function check(time){for(const zoom of [.5,1.13,2]){c.zoom=zoom;a.clearRect(0,0,1000,700);b.clearRect(0,0,1000,700);for(const [renderer,ctx]of [[t,a],[reference,b]]){renderer.draw(ctx,c);renderer.drawSurfaceOutlines(ctx,c);renderer.drawBlightEdges(ctx,c,time)}const aa=a.getImageData(0,0,1000,700).data,bb=b.getImageData(0,0,1000,700).data;for(let i=0;i<aa.length;i++)if(aa[i]!==bb[i])throw Error('Pixels differ at zoom '+zoom);}}
check(7.25);
const version=t.edgeVersion,outline=t.surfaceOutlines[Math.floor(y/32)*t.chunks.cols+Math.floor(x/32)];
w.damage(x,y,1);t.update();reference.rebuildAll();
if(t.edgeVersion!==version||t.surfaceOutlines[Math.floor(y/32)*t.chunks.cols+Math.floor(x/32)]!==outline)throw Error('HP-only hit rebuilt geometry');check(7.35);
let forcedMs=0,hpOnlyMs=0;for(let i=0;i<40;i++){w.damage(x,y,0);reference.chunks.geometryDirty.fill(1);let start=performance.now();reference.update();forcedMs+=performance.now()-start;start=performance.now();t.update();hpOnlyMs+=performance.now()-start;}
c.zoom=.5;let maskDraws=0;const u=t.edgeUnion.getContext('2d'),draw=u.drawImage.bind(u);u.drawImage=(...args)=>{maskDraws++;draw(...args)};
t.drawBlightEdges(a,c,8);const first=maskDraws;t.drawBlightEdges(a,c,8.2);if(maskDraws!==first)throw Error('Animation rebuilt unchanged mask');const animationDraws=maskDraws-first;
w.damage(x,y,1e6);t.update();reference.rebuildAll();check(8.4);
t.dormantAt=reference.dormantAt=()=>true;t.rebuildAll();reference.rebuildAll();check(9);
return{pixelComparisons:12,hpOnlyGeometryRebuilds:0,maskDrawsDuringUnchangedAnimation:animationDraws,updates:40,forcedMs,hpOnlyMs};
}));}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
