/* Vite required. Paired full rendering CPU and pixel/cache checks after Blight growth.
 * BREACH_BASELINE_REF, BREACH_REPORT and BREACH_SAMPLES (>=20) are optional. */
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
let pw;try{pw=require('playwright')}catch{pw=require('/opt/codex/cua_node/lib/node_modules/playwright')}
const root=path.resolve(__dirname,'..'),ref=cp.execFileSync('git',['rev-parse',process.env.BREACH_BASELINE_REF||'HEAD'],{cwd:root,encoding:'utf8'}).trim();
const dir=fs.mkdtempSync(path.join(root,'node_modules/.cache/glow-cache-benchmark-'));
cp.execFileSync('tar',['-x','-C',dir],{input:cp.execFileSync('git',['archive',ref,'src'],{cwd:root,maxBuffer:32e6})});
const report={baseline:ref,samples:Math.max(20,Number(process.env.BREACH_SAMPLES||30)),rows:[]};
(async()=>{const browser=await pw.chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});report.browser=browser.version();try{
 for(const device of [{name:'desktop',width:1200,height:800,scale:1,cpu:1},{name:'mobile',width:390,height:844,scale:2,cpu:4}]){
  if(process.env.BREACH_DEVICES&&!process.env.BREACH_DEVICES.split(',').includes(device.name))continue;
  const context=await browser.newContext({viewport:{width:device.width,height:device.height},deviceScaleFactor:device.scale}),page=await context.newPage();
  await page.addInitScript(()=>{let seed=427;Math.random=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296)});
  await(await context.newCDPSession(page)).send('Emulation.setCPUThrottlingRate',{rate:device.cpu});
  await page.goto('http://localhost:5173');await page.locator('[data-act="play"]').click();
  await page.evaluate(async({url,device})=>{
   const g=window.__game,raf=requestAnimationFrame.bind(window);window.requestAnimationFrame=()=>0;g.paused=true;await new Promise(r=>raf(()=>raf(r)));
   const [{Renderer},{LightRenderer:OldLighting},{Soldier},{hasVisibleGrowthGlows}]=await Promise.all([import('/src/rendering/Renderer.ts'),import(url+'/src/rendering/LightRenderer.ts'),import('/src/entities/Soldier.ts'),import('/src/rendering/GrowthGlowVisibility.ts')]);
   g.save.data.settings.devMode=true;g.save.data.settings.devMapAccess=true;g.selectLabWorld(3);g.paused=true;g.mainMenu.hide();
   if(g.labDef.id!==3||g.world.roomLights.length)throw Error('Expected forest without fixed fixtures');
   g.save.data.settings.devMapAccess=false;g.save.data.settings.renderQuality='high';g.renderer.resize();g.fog.light.fill(1);
   const w=g.world,c=g.camera,cs=w.cellSize;
   const ox=Math.max(device.width+32,Math.min(w.worldWidth-device.width-32,w.worldWidth*(w.roomCenterX<w.worldWidth/2?.8:.2)))+.37;
   const oy=Math.max(device.height+32,Math.min(w.worldHeight-device.height-32,w.worldHeight*(w.roomCenterY<w.worldHeight/2?.8:.2)))+.71;
   const cx=Math.floor(ox/cs),cy=Math.floor(oy/cs);
   for(let y=cy-7;y<=cy+7;y++)for(let x=cx-7;x<=cx+7;x++)w.setCell(x,y,0,'set');
   const glowCells=[];
   for(let i=0;i<16;i++){const x=cx+10+i%4,y=cy+10+Math.floor(i/4);w.setCell(x,y,20,'grown');glowCells.push(y*w.width+x);}
   const offX=Math.floor(w.width*(ox>w.worldWidth/2?.15:.85)),offY=Math.floor(w.height*(oy>w.worldHeight/2?.15:.85));
   w.setCell(offX,offY,20,'grown');g.terrain.rebuildAll();
   const old=new Renderer(document.createElement('canvas'),g),next=new Renderer(document.createElement('canvas'),g);
   old.resize();next.resize();old.sprites=next.sprites=g.renderer.sprites;
   old.lightRenderer=new OldLighting(g.renderer.sprites);next.lightRenderer.sprites=g.renderer.sprites;
   const renderers=[old,next],passes=[0,0];renderers.forEach((r,j)=>{const lr=r.lightRenderer,f=lr.updateWallLight;lr.updateWallLight=function(...args){passes[j]++;return f.apply(this,args);};});
   c.following=false;c.viewW=device.width;c.viewH=device.height;
   window.__glowBenchmark={g,w,c,ox,oy,cx,cy,glowCells,offX,offY,renderers,passes,raf,Soldier,hasVisibleGrowthGlows,clock:performance.now.bind(performance)};
  },{url:'/'+path.relative(root,dir),device});
  for(const soft of [false,true])for(const scene of (process.env.BREACH_SCENES||'expired,offscreen_growth,visible_growth,sparse_combat,dense_combat').split(','))for(const moving of [false,true])for(const zoom of [.5,1.13]){
   const row=await page.evaluate(async({soft,scene,moving,zoom,samples})=>{
    const {g,w,c,ox,oy,glowCells,offX,offY,renderers,passes,raf,Soldier,hasVisibleGrowthGlows,clock}=window.__glowBenchmark,gr=g.growth;
    g.save.data.settings.softShadows=soft;g.soldiers.length=0;g.flashes.length=0;g.fire.clear();g.particles.clear();g.combat.bullets.clear();
    const combat=scene.endsWith('combat'),dense=scene==='dense_combat';
    if(combat)for(let i=0;i<(dense?20:1);i++){const s=new Soldier(ox+(i%5-2)*12,oy+(Math.floor(i/5)-2)*12,1,0,100,'pistol');s.slotIndex=i%8;g.soldiers.push(s);g.onShot(s,1,0,s.x,s.y);}
    if(dense)for(let i=0;i<200;i++){g.fire.spawn(1,ox+(i%20-10)*12,oy+(Math.floor(i/20)-5)*12,0,0,1,0);g.fire.life[g.fire.count-1]=.6;}
    gr.glowCount=scene==='visible_growth'?64:gr.glowIndex.length;
    for(let i=0;i<gr.glowIndex.length;i++)gr.glowIndex[i]=scene==='offscreen_growth'?offY*w.width+offX:glowCells[i%glowCells.length];
    c.zoom=zoom;const times=[[],[]],fullPasses=[0,0];let imageComparisons=0,changedChannels=0,maxDelta=0;
    for(let frame=0;frame<samples+8;frame++){
     await new Promise(r=>raf(r));
     c.x=ox+(moving?Math.sin(frame*.11)*25:0);c.y=oy+(moving?Math.cos(frame*.09)*20:0);
     g.runStats.time=100+frame/60;gr.glowHead=frame%gr.glowIndex.length;
     gr.glowTime.fill(g.runStats.time-(scene==='offscreen_growth'||scene==='visible_growth'?.1:5));
     if(scene==='offscreen_growth')w.setCell(offX,offY,frame%2?20:0,frame%2?'grown':'set');
     while(g.terrain.chunks.pending)g.terrain.update();
     performance.now=()=>123456+frame*1000/60;g.lightOverBudgetFrames=0;g.lighting.quality='high';g.updateFlashPolygons();performance.now=clock;
     if(!combat){
      for(let i=0;i<g.lighting.softCount;i++){const l=g.lighting.softLights[i],x=c.worldToScreenX(l.x),y=c.worldToScreenY(l.y),r=l.radius*c.zoom;if(l.lit.count||(x+r>=-2&&y+r>=-2&&x-r<=c.viewW+2&&y-r<=c.viewH+2))throw Error('Quiet fixture has a contributing soft light');}
      if(scene!=='visible_growth'&&hasVisibleGrowthGlows(w,gr,c,g.runStats.time))throw Error('Quiet fixture has a visible growth pulse');
     }
     for(const j of frame%2?[1,0]:[0,1]){
      const before=passes[j];performance.now=()=>123456+frame*1000/60;const t=clock();renderers[j].draw();const elapsed=clock()-t;performance.now=clock;
      if(frame>=8){times[j].push(elapsed);fullPasses[j]+=passes[j]-before;}
     }
     if(frame===17||frame===samples+7){
      const aa=renderers[0].canvas.getContext('2d').getImageData(0,0,g.canvas.width,g.canvas.height).data,bb=renderers[1].canvas.getContext('2d').getImageData(0,0,g.canvas.width,g.canvas.height).data;
      for(let i=0;i<aa.length;i++)if(aa[i]!==bb[i]){changedChannels++;maxDelta=Math.max(maxDelta,Math.abs(aa[i]-bb[i]));}imageComparisons++;
     }
    }
    const shouldCache=!moving&&(scene==='expired'||scene==='offscreen_growth');
    if(fullPasses[0]!==samples||fullPasses[1]!== (shouldCache?0:samples))throw Error('Unexpected primary-pass counts '+JSON.stringify({scene,moving,zoom,fullPasses}));
    const pct=a=>{a.sort((a,b)=>a-b);return{p50:a[Math.floor(a.length*.5)],p95:a[Math.floor(a.length*.95)],p99:a.at(-1)}};
    return{soft,scene,moving,zoom,glowHistory:gr.glowCount,baseline:pct(times[0]),updated:pct(times[1]),fullPasses,imageComparisons,changedChannels,maxDelta};
   },{soft,scene,moving,zoom,samples:report.samples});
   if(row.changedChannels)throw Error('Pixel mismatch '+JSON.stringify(row));
   report.rows.push({device,...row});fs.writeFileSync(process.env.BREACH_REPORT||'/tmp/growth-glow-cache-benchmark.json',JSON.stringify(report,null,2));console.log(JSON.stringify({device:device.name,...row}));
  }
  await context.close();
 }
}finally{await browser.close();fs.rmSync(dir,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1});
