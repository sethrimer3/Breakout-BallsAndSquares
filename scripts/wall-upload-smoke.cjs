/* Vite required. Compare adaptive uploads with the previous bounding-box policy. */
let pw;try{pw=require('playwright')}catch{pw=require('/opt/codex/cua_node/lib/node_modules/playwright')}
(async()=>{const browser=await pw.chromium.launch({executablePath:process.env.BREACH_CHROMIUM||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});try{const page=await browser.newPage();await page.goto(process.env.BREACH_BASE_URL||'http://127.0.0.1:5173');await page.locator('[data-act="play"]').click();console.log(await page.evaluate(async()=>{const {LightRenderer:Legacy}=await import('/src/rendering/LightRenderer.ts');const g=window.__game;g.paused=true;for(let i=0;i<100;i++)g.lighting.updateFixtures(g.camera);g.terrain.lightLevel=()=>.7;
const next=g.renderer.lightRenderer,old=new Legacy(next.sprites),w=g.world;
old.updateWallLight(g);
// Force the previous full-bounding-box policy as the reference implementation.
old.wallRegions={rects:new Int32Array(4),count:0,pixels:0,update(_a,_b,x0,y0,x1,y1){this.count=x1>=x0&&y1>=y0?1:0;this.pixels=this.count?(x1-x0+1)*(y1-y0+1):0;this.rects.set([x0,y0,x1-x0+1,y1-y0+1]);}};
let oldPixels=0,newPixels=0;for(const [renderer,add]of [[old,n=>oldPixels+=n],[next,n=>newPixels+=n]]){const ctx=renderer.wallCtx,put=ctx.putImageData.bind(ctx);ctx.putImageData=(...args)=>{add(args[5]*args[6]);put(...args)}}
let comparisons=0;const check=()=>{old.updateWallLight(g);next.updateWallLight(g);const a=old.wallImage.data,b=next.wallImage.data;for(let i=0;i<a.length;i++)if(a[i]!==b[i])throw Error('ImageData mismatch');const ca=old.wallCtx.getImageData(0,0,w.width,w.height).data,cb=next.wallCtx.getImageData(0,0,w.width,w.height).data;for(let i=0;i<ca.length;i++)if(ca[i]!==cb[i])throw Error('Uploaded canvas mismatch');comparisons++};
check();g.lighting.fixtures=[];g.flashes.length=0;
const light=(x,y)=>({x:(x+.5)*8,y:(y+.5)*8,radius:48,strength:.6,soldier:true,lit:{cells:Int32Array.from({length:16},(_,i)=>(y+Math.floor(i/4))*w.width+x+i%4),count:16}});
g.lighting.softLights[0]=light(10,10);g.lighting.softLights[1]=light(630,630);g.lighting.softCount=2;check();oldPixels=newPixels=0;check();const sparse={oldPixels,newPixels};g.lighting.softLights[0].strength=.1;check();
g.lighting.softLights[0]=light(64,96);check();g.lighting.softCount=1;check();g.lighting.softCount=0;check();
const cells=[];for(let y=0;y<w.height;y+=32)for(let x=0;x<w.width;x+=32)cells.push(y*w.width+x);
g.lighting.softLights[0]={x:w.worldWidth/2,y:w.worldHeight/2,radius:100000,strength:.5,lit:{cells:new Int32Array(cells),count:cells.length}};
g.lighting.softCount=1;check();oldPixels=newPixels=0;check();const dense={oldPixels,newPixels};
if(dense.oldPixels!==dense.newPixels)throw Error('Dense path did not retain one tight bounding box');
g.lighting.softCount=0;check();
return{comparisons,sparse,dense};}));}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
