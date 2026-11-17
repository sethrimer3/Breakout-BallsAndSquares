/* Vite required. Exact lighting pixels + cache transitions after growth pulses. */
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
let pw;try{pw=require('playwright')}catch{pw=require('/opt/codex/cua_node/lib/node_modules/playwright')}
const root=path.resolve(__dirname,'..'),ref=cp.execFileSync('git',['rev-parse',process.env.BREACH_BASELINE_REF||'HEAD'],{cwd:root,encoding:'utf8'}).trim();
const dir=fs.mkdtempSync(path.join(root,'node_modules/.cache/glow-cache-check-'));
cp.execFileSync('tar',['-x','-C',dir],{input:cp.execFileSync('git',['archive',ref,'src'],{cwd:root,maxBuffer:32e6})});
(async()=>{const browser=await pw.chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});try{
 const page=await browser.newPage({viewport:{width:1003,height:701}});await page.goto('http://localhost:5173');await page.locator('[data-act="play"]').click();
 const result=await page.evaluate(async url=>{
  const g=window.__game,raf=requestAnimationFrame.bind(window);window.requestAnimationFrame=()=>0;g.paused=true;await new Promise(r=>raf(()=>raf(r)));
  const [{LightRenderer:Old},{LightRenderer:Next},{GROWTH}]=await Promise.all([import(url+'/src/rendering/LightRenderer.ts'),import('/src/rendering/LightRenderer.ts'),import('/src/config.ts')]);
  const w=g.world,c=g.camera,gr=g.growth,clock=performance.now.bind(performance);g.save.data.settings.softShadows=true;
  w.roomLights=[];w.health.fill(0);w.subHealth.fill(0);g.terrain.rebuildAll();g.lighting.fixtures=[];g.lighting.softCount=0;g.flashes.length=0;
  c.viewW=1003;c.viewH=701;c.x=w.worldWidth*.6+.37;c.y=w.worldHeight*.6+.71;
  let comparisons=0;const cases=[],cacheHits=[];
  for(const scale of [1,1.25,1.5,2])for(const soft of [false,true])for(const zoom of [.5,1.13])for(const smoothing of [false,true]){
   c.zoom=zoom;g.save.data.settings.softShadows=soft;
   const renderers=[new Old(g.renderer.sprites),new Next(g.renderer.sprites)],full=[0,0];
   renderers.forEach((r,j)=>{const f=r.updateWallLight;r.updateWallLight=function(...args){full[j]++;return f.apply(this,args);};});
   const canvases=renderers.map(()=>{const a=document.createElement('canvas');a.width=Math.round(c.viewW*scale);a.height=Math.round(c.viewH*scale);return a;});
   const cx=Math.floor(c.screenToWorldX(c.viewW-12)/w.cellSize),cy=Math.floor(c.screenToWorldY(c.viewH/2)/w.cellSize),cell=cy*w.width+cx;
   const off=30*w.width+30;w.health[cell]=w.health[off]=20;g.terrain.chunks.markCell(cx,cy);while(g.terrain.chunks.pending)g.terrain.update();
   const draw=(label,time)=>{
    g.runStats.time=time;const before=full.slice();
    for(const j of [0,1]){const ctx=canvases[j].getContext('2d');ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#456';ctx.fillRect(0,0,ctx.canvas.width,ctx.canvas.height);performance.now=()=>123456+time*1000;renderers[j].renderLighting(ctx,g,scale);performance.now=clock;}
    const aa=canvases[0].getContext('2d').getImageData(0,0,canvases[0].width,canvases[0].height).data,bb=canvases[1].getContext('2d').getImageData(0,0,canvases[1].width,canvases[1].height).data;
    let channels=0,maxDelta=0;for(let i=0;i<aa.length;i++)if(aa[i]!==bb[i]){channels++;maxDelta=Math.max(maxDelta,Math.abs(aa[i]-bb[i]));}
    comparisons++;if(channels)throw Error(JSON.stringify({label,scale,soft,zoom,smoothing,channels,maxDelta,full}));
    cases.push({label,scale,soft,zoom,smoothing,changedChannels:channels});return full.map((v,j)=>v-before[j]);
   };
   gr.glowCount=0;draw('initial',10);renderers.forEach(r=>{r.lmCtx.imageSmoothingEnabled=smoothing;});draw('initial-repeat',10.1);
   gr.glowCount=1;gr.glowHead=1;gr.glowIndex[0]=cell;gr.glowTime[0]=0;
   draw('expired-history',10.2);cacheHits.push({scale,soft,zoom,smoothing,passes:draw('expired-repeat',10.3)});
   gr.glowTime[0]=11;draw('visible-new-pulse',11);draw('visible-fading',11.3);
   draw('pulse-expired',11+GROWTH.glowDuration+.01);draw('expired-after-pulse',12);
   gr.glowIndex[0]=off;gr.glowTime[0]=12;draw('active-offscreen',12.1);draw('active-offscreen-repeat',12.2);
   gr.glowHead=0;gr.glowCount=2;gr.glowIndex[gr.glowIndex.length-1]=cell;gr.glowTime[gr.glowTime.length-1]=13;gr.glowIndex[gr.glowIndex.length-2]=off;gr.glowTime[gr.glowTime.length-2]=0;
   draw('wrapped-visible',13.1);w.health[cell]=0;g.terrain.chunks.markCell(cx,cy);while(g.terrain.chunks.pending)g.terrain.update();draw('destroyed-pulse',13.2);draw('destroyed-repeat',13.3);
   c.x+=.43;draw('fractional-pan',13.4);c.x-=.43;
   gr.glowCount=0;draw('history-reset',14);draw('history-reset-repeat',14.1);
   w.health[cell]=0;g.terrain.chunks.markAll();while(g.terrain.chunks.pending)g.terrain.update();draw('terrain-regeneration',14.2);
   canvases.forEach(a=>{a.width+=3;a.height+=2;});draw('resize',14.3);
  }
  for(const hit of cacheHits){
   const expected=Number.isInteger(hit.scale)?0:1;
   if(hit.passes[0]!==1||hit.passes[1]!==expected)throw Error('Unexpected expired-history cache path '+JSON.stringify(hit));
  }
  return{comparisons,changedChannels:0,cacheHits,cases};
 },'/'+path.relative(root,dir));
 result.baseline=ref;fs.writeFileSync(process.env.BREACH_REPORT||'/tmp/growth-glow-cache-regressions.json',JSON.stringify(result,null,2));console.log(JSON.stringify({comparisons:result.comparisons,changedChannels:result.changedChannels,cacheHits:result.cacheHits}));
}finally{await browser.close();fs.rmSync(dir,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1});
