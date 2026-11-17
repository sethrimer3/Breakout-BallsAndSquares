/* Vite required. Paired lighting submission timings and exact mask comparisons. */
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
let pw;try{pw=require('playwright')}catch{pw=require('/opt/codex/cua_node/lib/node_modules/playwright')}
const root=path.resolve(__dirname,'..'),ref=cp.execFileSync('git',['rev-parse',process.env.BREACH_BASELINE_REF||'HEAD'],{cwd:root,encoding:'utf8'}).trim();
const dir=fs.mkdtempSync(path.join(root,'node_modules/.cache/mask-bench-'));
cp.execFileSync('tar',['-x','-C',dir],{input:cp.execFileSync('git',['archive',ref,'src'],{cwd:root,maxBuffer:32e6})});
(async()=>{const browser=await pw.chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});const rows=[];
try{for(const device of [{name:'desktop',width:1200,height:800,dpr:1,cpu:1},{name:'mobile',width:390,height:844,dpr:2,cpu:4}]){
 const context=await browser.newContext({viewport:{width:device.width,height:device.height},deviceScaleFactor:device.dpr}),page=await context.newPage();
 await (await context.newCDPSession(page)).send('Emulation.setCPUThrottlingRate',{rate:device.cpu});
 await page.goto('http://localhost:5173');await page.locator('[data-act="play"]').click();
 const result=await page.evaluate(async({url,device})=>{
  const g=window.__game,raf=requestAnimationFrame.bind(window);window.requestAnimationFrame=()=>0;g.paused=true;await new Promise(r=>raf(()=>raf(r)));
  const {LightRenderer:Old}=await import(url+'/src/rendering/LightRenderer.ts'),{LightRenderer:Next}=await import('/src/rendering/LightRenderer.ts');
  const w=g.world,c=g.camera,clock=performance.now.bind(performance),rows=[];
  g.save.data.settings.softShadows=true;
  const percentile=a=>{a.sort((a,b)=>a-b);return{p50:a[Math.floor(a.length*.5)],p95:a[Math.floor(a.length*.95)],p99:a.at(-1)}};
  for(const dense of [false,true])for(const moving of [false,true])for(const zoom of [.5,1.13])for(const location of ['offscreen','visible']){
   g.soldiers.length=0;g.reserves=8;g.paused=false;
   for(let i=0;i<(dense?8:1);i++)g.deploySoldier(w.roomCenterX,w.roomCenterY,1,0);
   g.paused=true;c.x=w.roomCenterX;c.y=w.roomCenterY;c.zoom=zoom;
   g.updateFlashPolygons();for(let i=0;i<30;i++)g.lighting.updateFixtures(c);
   const renderers=[new Old(g.renderer.sprites),new Next(g.renderer.sprites)];
   const canvases=renderers.map(()=>{const canvas=document.createElement('canvas');canvas.width=device.width*device.dpr;canvas.height=device.height*device.dpr;return canvas});
   const times=[[],[]],rebuilds=[0,0];let channels=0;
   for(let frame=0;frame<35;frame++){
    const cx=location==='offscreen'?w.roomX0+200:w.roomX0+3,cy=location==='offscreen'?w.roomY0+200:w.roomY0+3;
    w.setCell(cx,cy,frame%2?10:0,frame%2?'grown':'destroyed');
    while(g.terrain.chunks.pending)g.terrain.update();
    c.x=w.roomCenterX+(moving?frame*1.2:0);g.updateFlashPolygons();
    const fixed=()=>{performance.now=()=>123456};
    for(const j of frame%2?[1,0]:[0,1]){
     const r=renderers[j],ctx=canvases[j].getContext('2d'),prior=r.maskState;
     ctx.setTransform(device.dpr,0,0,device.dpr,0,0);ctx.fillStyle='#456';ctx.fillRect(0,0,c.viewW,c.viewH);
     fixed();const start=clock();r.renderLighting(ctx,g,device.dpr);if(frame>=5)times[j].push(clock()-start);performance.now=clock;
     if(r.maskState!==prior)rebuilds[j]++;
    }
    if(frame===12||frame===34){
     // Both use the same terrain and light polygons. Compare complete composites.
     const a=canvases[0].getContext('2d').getImageData(0,0,canvases[0].width,canvases[0].height).data,b=canvases[1].getContext('2d').getImageData(0,0,canvases[1].width,canvases[1].height).data;
     for(let i=0;i<a.length;i++)if(a[i]!==b[i])channels++;
    }
   }
   if(location==='offscreen'&&!moving&&rebuilds[0]<=rebuilds[1])throw Error('Offscreen growth fixture did not exercise invalidation');
   rows.push({dense,moving,zoom,location,baseline:percentile(times[0]),updated:percentile(times[1]),rebuilds,changedChannels:channels});
  }
  return rows;
 },{url:'/'+path.relative(root,dir),device});
 for(const row of result){if(row.changedChannels)throw Error('Pixel mismatch '+JSON.stringify(row));rows.push({device,...row})}
 await context.close();
}
fs.writeFileSync('/tmp/lighting-mask-benchmark.json',JSON.stringify({baseline:ref,rows},null,2));console.log(JSON.stringify(rows));
}finally{await browser.close();fs.rmSync(dir,{recursive:true,force:true})}})().catch(e=>{console.error(e);process.exitCode=1});
