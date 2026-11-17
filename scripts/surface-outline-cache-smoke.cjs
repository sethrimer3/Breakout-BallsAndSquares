/* Compare incremental outlines with the archived full-chunk renderer, including
 * world edits still waiting behind the terrain budget. Requires Vite. */
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
let pw;try{pw=require('playwright')}catch{pw=require('/opt/codex/cua_node/lib/node_modules/playwright')}
const root=path.resolve(__dirname,'..'),ref=process.env.BREACH_BASELINE_REF||'fc7b670';
const dir=fs.mkdtempSync(path.join(root,'node_modules/.cache/surface-oracle-'));
cp.execFileSync('tar',['-x','-C',dir],{input:cp.execFileSync('git',['archive',ref,'src'],{cwd:root,maxBuffer:32e6})});
(async()=>{const browser=await pw.chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});try{
 const page=await browser.newPage();await page.goto('http://localhost:5173');
 const result=await page.evaluate(async url=>{
  const [{TerrainRenderer:Old},{TerrainRenderer:Next},{PixelWorld},{CameraSystem}]=await Promise.all([import(url+'/src/rendering/TerrainRenderer.ts'),import('/src/rendering/TerrainRenderer.ts'),import('/src/world/PixelWorld.ts'),import('/src/systems/CameraSystem.ts')]);
  const w=new PixelWorld({width:129,height:131,cellSize:8,roomSize:4});
  for(let y=0;y<w.height;y++)for(let x=0;x<w.width;x++)if((x+y)%5)w.setCell(x,y,20,'set',true);
  const a=new Old(w,16),b=new Next(w,16),cam=new CameraSystem(w);a.rebuildAll();b.rebuildAll();
  const canvases=[document.createElement('canvas'),document.createElement('canvas')];
  let comparisons=0,queuedChecks=0;
  const compare=(label,scale,zoom,x,y)=>{
   cam.x=x;cam.y=y;cam.zoom=zoom;cam.viewW=257;cam.viewH=231;
   for(const [j,r] of [a,b].entries()){
    const c=canvases[j];c.width=Math.round(cam.viewW*scale);c.height=Math.round(cam.viewH*scale);
    const ctx=c.getContext('2d');ctx.setTransform(scale,0,0,scale,0,0);r.draw(ctx,cam);r.drawSurfaceOutlines(ctx,cam);
   }
   const aa=canvases[0].getContext('2d').getImageData(0,0,canvases[0].width,canvases[0].height).data;
   const bb=canvases[1].getContext('2d').getImageData(0,0,canvases[1].width,canvases[1].height).data;
   for(let i=0;i<aa.length;i++)if(aa[i]!==bb[i])throw Error(label+' pixel '+i+': '+aa[i]+' / '+bb[i]);
   comparisons++;
  };
  compare('initial',1,1.13,256,256);
  for(let frame=0;frame<36;frame++){
   // Spread edits across more chunks than one frame can rebuild.
   for(let n=0;n<50;n++){
    const x=(frame*7+n*17)%w.width,y=(frame*11+n*31)%w.height;
    w.setCell(x,y,frame%3?0:20,frame%3?'destroyed':'grown');
    if(frame%3)w.setSubCell(x*2+(n%2),y*2+(frame%2),10);
   }
   a.update();b.update();
   // A later edit must not leak into a cached path for an older albedo.
   w.setCell(32+frame%8,32+frame%9,frame%2?0:20);
   if(a.chunks.pending!==b.chunks.pending)throw Error('Changed chunk scheduling');
   if(a.chunks.pending)queuedChecks++;
   for(const scale of [1,1.25,2])for(const zoom of [.5,1.13,2.75]){
    compare('pending '+frame,scale,zoom,frame%2?260.37:800.71,frame%2?270.71:1020.37);
   }
  }
  if(!queuedChecks)throw Error('No pending terrain was exercised');
  w.health.fill(0);w.subHealth.fill(0);a.rebuildAll();b.rebuildAll();
  compare('empty',1.25,1.13,800,800);
  // Partial edge chunks retain the original outside-world solid boundary.
  const interior=(k)=>k%b.chunks.cols<b.chunks.cols-1&&Math.floor(k/b.chunks.cols)<b.chunks.rows-1;
  if(b.surfaceGeometry.some((v,k)=>v&&interior(k))||b.surfaceOutlines.some((v,k)=>v&&interior(k)))throw Error('Empty interior geometry retained');
  w.setSubCell(257,261,10);a.update();b.update();compare('world edge regrowth',2,1.13,1030,1040);
  return {comparisons,changedChannels:0,queuedChecks,emptyInteriorGeometryReleased:true};
 },'/'+path.relative(root,dir));
 console.log(JSON.stringify(result));fs.writeFileSync(process.env.BREACH_REPORT||'/tmp/surface-outline-cache-regressions.json',JSON.stringify(result,null,2));
}finally{await browser.close();fs.rmSync(dir,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1});
