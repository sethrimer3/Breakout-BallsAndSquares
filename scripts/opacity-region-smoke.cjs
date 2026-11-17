/* Vite required. Compare incremental mask updates against archived full rebuilds. */
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
let pw;try{pw=require('playwright')}catch{pw=require('/opt/codex/cua_node/lib/node_modules/playwright')}
const root=path.resolve(__dirname,'..'),ref=process.env.BREACH_BASELINE_REF||'28064e4';
const dir=fs.mkdtempSync(path.join(root,'node_modules/.cache/opacity-regions-'));
cp.execFileSync('tar',['-x','-C',dir],{input:cp.execFileSync('git',['archive',ref,'src'],{cwd:root,maxBuffer:32e6})});
(async()=>{const browser=await pw.chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});try{
 const page=await browser.newPage();await page.goto('http://localhost:5173');await page.waitForFunction(()=>!!window.__game);
 const result=await page.evaluate(async url=>{
  const g=window.__game,raf=requestAnimationFrame.bind(window);g.paused=true;window.requestAnimationFrame=()=>0;await new Promise(r=>raf(()=>raf(r)));
  const [{LightRenderer:Old},{LightRenderer:Next},{TerrainRenderer},{PixelWorld,MAT},{CameraSystem}]=await Promise.all([import(url+'/src/rendering/LightRenderer.ts'),import('/src/rendering/LightRenderer.ts'),import('/src/rendering/TerrainRenderer.ts'),import('/src/world/PixelWorld.ts'),import('/src/systems/CameraSystem.ts')]);
  const w=new PixelWorld({width:129,height:131,cellSize:8,roomSize:4}),cam=new CameraSystem(w),t=new TerrainRenderer(w,16);
  g.world=w;g.camera=cam;g.terrain=t;g.flashes=[];g.growth={glowCount:0,glowHead:0,glowIndex:new Int32Array(4096),glowTime:new Float32Array(4096)};g.lighting={fixtures:[],softLights:[],softCount:0};g.runStats.time=80;
  const lights=[new Old(g.renderer.sprites),new Next(g.renderer.sprites),new Old(g.renderer.sprites),new Next(g.renderer.sprites)];
  const canvases=lights.map(()=>document.createElement('canvas'));let comparisons=0,partial=0,full=0;
  for(const j of [1,3]){
   const ctx=lights[j].maskCtx,clear=ctx.clearRect.bind(ctx);
   ctx.clearRect=(x,y,width,height)=>{if(width*height<ctx.canvas.width*ctx.canvas.height)partial++;else full++;clear(x,y,width,height)};
  }
  const clock=performance.now.bind(performance);performance.now=()=>123456;
  function draw(j,dpr){
   const c=canvases[j],ctx=c.getContext('2d');ctx.setTransform(1,0,0,1,0,0);ctx.globalCompositeOperation='source-over';ctx.fillStyle='#34495e';ctx.fillRect(0,0,c.width,c.height);ctx.setTransform(dpr,0,0,dpr,0,0);
   t.draw(ctx,cam);lights[j].renderLighting(ctx,g,dpr);
  }
  function same(a,b,label){const aa=a.getContext('2d').getImageData(0,0,a.width,a.height).data,bb=b.getContext('2d').getImageData(0,0,b.width,b.height).data;for(let i=0;i<aa.length;i++)if(aa[i]!==bb[i])throw Error(label+' channel '+i+': '+aa[i]+' / '+bb[i]);comparisons++;}
  function compare(j,dpr,label){draw(j,dpr);draw(j+1,dpr);same(lights[j].maskCanvas,lights[j+1].maskCanvas,label+' mask');same(canvases[j],canvases[j+1],label+' composite');}
  try{
   for(const dpr of [.75,1,1.25,1.5,2,3])for(const zoom of [.5,1.13,2.75])for(const soft of [false,true]){
    cam.viewW=257;cam.viewH=231;cam.zoom=zoom;cam.x=260.37;cam.y=270.71;g.save.data.settings.softShadows=soft;
    for(const c of canvases){c.width=Math.round(cam.viewW*dpr);c.height=Math.round(cam.viewH*dpr)}
    w.health.fill(0);w.subHealth.fill(0);w.mat.fill(0);t.rebuildAll();
    const light={x:cam.x,y:cam.y,radius:80,strength:.6,warm:true,polyCount:0,lit:{count:0,cells:new Uint32Array(0)}};
    g.lighting.softLights=[light];g.lighting.softCount=1;
    compare(0,dpr,'initial');compare(2,dpr,'second consumer');
    for(let frame=0;frame<16;frame++){
     const cellFrame=frame%2?frame-1:frame;
     const x=29+cellFrame%7,y=29+(cellFrame*3)%7,i=y*w.width+x;
     if(frame%4===0){w.mat[i]=MAT.glass;w.setCell(x,y,40)}
     if(frame%4===1){w.damage(x,y,7);w.setGlassCracked(x,y,true)}
     if(frame%4===2){w.setCell(x,y,0,'destroyed');w.setSubCell(x*2,y*2,10)}
     if(frame%4===3)w.damage(x,y,1000);
     while(t.chunks.pending)t.update();
     compare(0,dpr,'edit '+frame);
     // This independent cached mask skips three updates and must retain their history.
     if(frame%4===3)compare(2,dpr,'skipped frames '+frame);
    }
    // Full invalidations and a world-edge camera jump preserve mapping and alpha.
    cam.x=1025.71;cam.y=1039.37;w.setSubCell(257,261,20);while(t.chunks.pending)t.update();
    compare(0,dpr,'world edge');compare(2,dpr,'world edge second');
    w.health.fill(20);w.subHealth.fill(0);t.rebuildAll();compare(0,dpr,'dense rebuild');
    w.health.fill(0);t.rebuildAll();compare(0,dpr,'empty rebuild');
    // Empty lighting keeps the original cache invalidation/history behavior.
    g.lighting.softCount=0;compare(0,dpr,'unlit');w.setCell(128,130,20);t.update();compare(0,dpr,'unlit edit');
   }
   // An edited tile can be outside the screen while its chunk is visible.
   cam.viewW=90;cam.viewH=80;cam.x=260;cam.y=260;cam.zoom=2.75;
   for(const c of canvases){c.width=90;c.height=80}compare(0,1,'tile culling setup');
   const clearBefore=partial+full;
   w.setCell(44,32,30);while(t.chunks.pending)t.update();compare(0,1,'offscreen tile in visible chunk');
   if(partial+full!==clearBefore)throw Error('Offscreen tile repainted the mask');
   w.mat[32*w.width+32]=0;w.setCell(32,32,40);t.update();compare(0,1,'ordinary HP setup');
   const hpBefore=partial+full;w.damage(32,32,1);t.update();compare(0,1,'ordinary HP');
   if(partial+full!==hpBefore)throw Error('Opaque HP-only hit repainted mask');
   const before=partial;
   cam.viewW=1000;cam.viewH=700;cam.x=260;cam.y=260;cam.zoom=.5;
   for(const c of canvases){c.width=1000;c.height=700}compare(0,1,'reset before overflow');
   const overflowFull=full;
   t.opacityRevision=0xffffffff;w.setCell(32,32,0,'destroyed');while(t.chunks.pending)t.update();compare(0,1,'revision overflow');
   if(full!==overflowFull+1)throw Error('Revision overflow did not force full repaint');
   const replacement=new TerrainRenderer(w,16);replacement.rebuildAll();g.terrain=replacement;
   compare(0,1,'replacement terrain');g.terrain=t;compare(0,1,'restored terrain');
   if(partial<20||full<20)throw Error('Missing partial/full path coverage '+JSON.stringify({partial,full}));
   return {comparisons,changedChannels:0,partialClears:partial,fullClears:full,overflowPartialClears:partial-before};
  }finally{performance.now=clock}
 },'/'+path.relative(root,dir));
 console.log(JSON.stringify(result));fs.writeFileSync(process.env.BREACH_REPORT||'/tmp/opacity-region-regressions.json',JSON.stringify(result,null,2));
}finally{await browser.close();fs.rmSync(dir,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1});
