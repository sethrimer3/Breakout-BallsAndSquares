/* Vite required. Compare change-only fog uploads against full visible-region uploads. */
let pw;try{pw=require('playwright')}catch{pw=require('/opt/codex/cua_node/lib/node_modules/playwright')}
(async()=>{const browser=await pw.chromium.launch({executablePath:process.env.BREACH_CHROMIUM||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});try{const page=await browser.newPage({viewport:{width:1000,height:700}});await page.goto(process.env.BREACH_BASE_URL||'http://127.0.0.1:5173');await page.locator('[data-act="play"]').click();console.log(await page.evaluate(async()=>{
const {FogRenderer,fogAlpha}=await import('/src/rendering/FogRenderer.ts');const g=window.__game;g.paused=true;const fog=g.fog,cam=g.camera,reference=new FogRenderer(fog),next=new FogRenderer(fog);
const refDraw=reference.draw.bind(reference);reference.draw=(ctx,c)=>{
 // Force a changed metadata byte for every tile, reproducing the previous full upload policy.
 for(let i=0;i<fog.light.length;i++)reference.img.data[i*4+3]=(fogAlpha(fog.light[i])+1)%256;
 refDraw(ctx,c);
};
const a=document.createElement('canvas'),b=document.createElement('canvas');a.width=b.width=1000;a.height=b.height=700;const ac=a.getContext('2d'),bc=b.getContext('2d');let comparisons=0;
const compare=()=>{for(const ctx of [ac,bc]){ctx.clearRect(0,0,1000,700);ctx.fillStyle='#234567';ctx.fillRect(0,0,1000,700)}reference.draw(ac,cam);next.draw(bc,cam);const x=ac.getImageData(0,0,1000,700).data,y=bc.getImageData(0,0,1000,700).data;for(let i=0;i<x.length;i++)if(x[i]!==y[i])throw Error('Fog pixels differ');comparisons++;};
for(const zoom of [.5,1.13,2])for(const level of [0,.35,1]){cam.zoom=zoom;cam.x=g.world.roomCenterX+.37;cam.y=g.world.roomCenterY+.71;fog.light.fill(level);compare();}
fog.light.fill(0);fog.light[0]=.5;compare();cam.x=cam.y=0;compare();fog.light.fill(0);compare();
cam.x=g.world.roomCenterX;cam.y=g.world.roomCenterY;compare();
let oldUploads=0,newUploads=0,newPixels=0;for(const [renderer,record]of [[reference,()=>oldUploads++],[next,args=>{newUploads++;newPixels+=args[5]*args[6]}]]){const put=renderer.ctx.putImageData.bind(renderer.ctx);renderer.ctx.putImageData=(...args)=>{record(args);put(...args)}}
for(let i=0;i<100;i++){reference.draw(ac,cam);next.draw(bc,cam)}const unchanged={oldUploads,newUploads};
fog.light[Math.floor(cam.y/fog.tileSize)*fog.tw+Math.floor(cam.x/fog.tileSize)]=.5;compare();
if(unchanged.newUploads!==0||newPixels!==1)throw Error('Unchanged/one-tile upload bounds incorrect');
return{comparisons,unchanged,changedTileUploadedPixels:newPixels};
}));}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
