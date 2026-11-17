/* Full Game.step + terrain + shadows + rendering with real generator replication.
 * Vite required. BREACH_BASELINE_REF, BREACH_REPORT, BREACH_SAMPLES (>=20),
 * BREACH_DEVICES and BREACH_RATES (comma-separated multipliers) are optional. */
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
let pw;try{pw=require('playwright')}catch{pw=require('/opt/codex/cua_node/lib/node_modules/playwright')}
const root=path.resolve(__dirname,'..'),ref=cp.execFileSync('git',['rev-parse',process.env.BREACH_BASELINE_REF||'HEAD'],{cwd:root,encoding:'utf8'}).trim();
const dir=fs.mkdtempSync(path.join(root,'node_modules/.cache/live-growth-'));
cp.execFileSync('tar',['-x','-C',dir],{input:cp.execFileSync('git',['archive',ref,'src','index.html'],{cwd:root,maxBuffer:32e6})});
if(fs.existsSync(path.join(root,'public')))fs.cpSync(path.join(root,'public'),dir,{recursive:true});
const report={baseline:ref,samples:Math.max(20,Number(process.env.BREACH_SAMPLES||40)),rows:[]};
const pct=a=>{a.sort((a,b)=>a-b);return{p50:a[Math.floor(a.length*.5)],p95:a[Math.floor(a.length*.95)],p99:a[Math.floor(a.length*.99)]}};
(async()=>{const browser=await pw.chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});report.browser=browser.version();try{
 for(const device of [{name:'desktop',width:1000,height:700,dpr:1,cpu:1},{name:'mobile',width:390,height:844,dpr:2,cpu:4}]){
  if(process.env.BREACH_DEVICES&&!process.env.BREACH_DEVICES.split(',').includes(device.name))continue;
  const contexts=[],pages=[];
  for(const url of ['http://localhost:5173/'+path.relative(root,dir)+'/index.html','http://localhost:5173']){
   const context=await browser.newContext({viewport:{width:device.width,height:device.height},deviceScaleFactor:device.dpr}),p=await context.newPage();contexts.push(context);pages.push(p);
   await p.route('https://fonts.googleapis.com/**',r=>r.abort());
   await p.addInitScript(()=>{let seed=427;Math.random=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296)});
   await(await context.newCDPSession(p)).send('Emulation.setCPUThrottlingRate',{rate:device.cpu});
   await p.goto(url,{waitUntil:'domcontentloaded'});await p.waitForFunction(()=>!!window.__game);
   await p.evaluate(async()=>{const g=window.__game,raf=requestAnimationFrame.bind(window);g.paused=true;g.mainMenu.hide();window.requestAnimationFrame=()=>0;await new Promise(r=>raf(()=>raf(r)));window.__growthBench={g,raf,clock:performance.now.bind(performance)};});
  }
  for(const multiplier of (process.env.BREACH_RATES||'.05,1,4').split(',').map(Number))for(const moving of [false,true])for(const zoom of [.5,1.13]){
   for(const p of pages)await p.evaluate(({multiplier,zoom})=>{
    const {g}=window.__growthBench;g.save.data.seed='GROWTH42';g.rng.s=305419896;g.startRun();g.paused=true;g.mainMenu.hide();
    g.save.data.settings.renderQuality='high';g.save.data.settings.softShadows=false;g.save.data.settings.fieryMuzzleFlash=false;g.save.data.settings.alwaysShootWhenAutoMoveOff=false;g.renderer.resize();
    const w=g.world,cores=w.blightCores.filter(c=>c.alive&&c.size===2).slice(0,8);
    if(!cores.length)throw Error('No generator fixtures');
    for(const c of cores)for(let y=c.cy-20;y<=c.cy+21;y++)for(let x=c.cx-20;x<=c.cx+21;x++)if(w.inBounds(x,y)&&!w.coreId[y*w.width+x])w.setCell(x,y,0,'set');
    g.growth.reset();g.growth.rateMultiplier=multiplier;g.growth.explosiveChance=0;g.terrain.rebuildAll();g.rng.s=305419896;
    g.reserves=1;g.paused=false;g.deploySoldier(w.roomCenterX,w.roomCenterY,1,0);g.paused=true;g.autoMove=false;
    if(g.soldiers.length!==1)throw Error('Could not place the passive soldier');
    const ox=(cores[0].cx+5)*w.cellSize,oy=(cores[0].cy+5)*w.cellSize;g.camera.following=false;g.camera.zoom=zoom;g.camera.x=ox;g.camera.y=oy;g.fog.light.fill(1);
    g.runStats.time=80;window.__growthBench.ox=ox;window.__growthBench.oy=oy;
    for(let i=0;i<8;i++){g.lightOverBudgetFrames=0;g.lighting.quality='high';g.updateFlashPolygons();g.renderer.draw();}
   },{multiplier,zoom});
   const times=[[],[]],states=[[],[]],frameRows=[[],[]];
   for(let frame=0;frame<report.samples+12;frame++){
    for(const j of frame%2?[1,0]:[0,1]){
     const row=await pages[j].evaluate(async({frame,moving,zoom,samples})=>{
      const {g,raf,clock,ox,oy}=window.__growthBench;await new Promise(r=>raf(r));
      const before=g.growth.totalEvents,floorBefore=g.terrain.floorRevision,start=clock();
      g.step(1/60);const sim=clock();g.terrain.update();const terrain=clock();
      if(g.runOver||!g.soldiers[0]?.alive)throw Error('Passive soldier did not survive fixture');
      g.camera.following=false;g.camera.zoom=zoom;g.camera.x=ox+(moving?Math.sin(frame*.09)*45:0);g.camera.y=oy+(moving?Math.cos(frame*.07)*30:0);g.fog.light.fill(1);
      performance.now=()=>100000+frame*1000/60;g.lightOverBudgetFrames=0;g.lighting.quality='high';g.updateFlashPolygons();const shadows=clock();g.renderer.draw();const drawn=clock();performance.now=clock;
      const row={simMs:sim-start,terrainMs:terrain-sim,shadowMs:shadows-terrain,drawMs:drawn-shadows,totalMs:drawn-start,events:g.growth.totalEvents-before,subEvents:g.growth.totalSubBlightEvents,rate:g.growth.rate,exposed:g.growth.exposedCoresCount,pending:g.terrain.chunks.pending,rebuilt:g.terrain.rebuiltLastFrame,floorPaints:g.terrain.floorRevision-floorBefore};
      if(frame===12||frame===Math.floor(samples/2)+12||frame===samples+11){
       const digest=async a=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(a.buffer,a.byteOffset,a.byteLength)))).map(v=>v.toString(16).padStart(2,'0')).join('');
       const w=g.world,ctx=g.canvas.getContext('2d');row.state=await Promise.all([w.health,w.subHealth,w.subTint,w.tint,w.mat,w.blight,w.glassCracked].map(digest));
       row.pixels=await digest(ctx.getImageData(0,0,g.canvas.width,g.canvas.height).data);
      }
      return row;
     },{frame,moving,zoom,samples:report.samples});
     if(frame>=12){times[j].push(row.totalMs);frameRows[j].push(row);}
     if(row.state)states[j].push({frame,state:row.state,pixels:row.pixels});
    }
   }
   for(let i=0;i<states[0].length;i++){
    if(JSON.stringify(states[0][i].state)!==JSON.stringify(states[1][i].state))throw Error('World state differs '+JSON.stringify({device,multiplier,moving,zoom,old:states[0][i],next:states[1][i]}));
    if(states[0][i].pixels!==states[1][i].pixels){
     throw Error('Rendered pixels differ '+JSON.stringify({device,multiplier,moving,zoom,frame:states[0][i].frame}));
    }
   }
   const summary=j=>({frame:pct(times[j]),parts:Object.fromEntries(['simMs','terrainMs','shadowMs','drawMs'].map(k=>[k,pct(frameRows[j].map(r=>r[k]))])),events:frameRows[j].reduce((n,r)=>n+r.events,0),floorPaints:frameRows[j].reduce((n,r)=>n+r.floorPaints,0),maxPending:Math.max(...frameRows[j].map(r=>r.pending)),rate:frameRows[j].at(-1).rate,exposed:frameRows[j].at(-1).exposed});
   const row={device,multiplier,moving,zoom,baseline:summary(0),updated:summary(1),stateComparisons:states[0].length,pixelComparisons:states[0].length,changedChannels:0};
   if(multiplier>=1&&row.updated.events<report.samples*10)throw Error('Fast-growth fixture had too few successful events');
   report.rows.push(row);fs.writeFileSync(process.env.BREACH_REPORT||'/tmp/fast-growth-benchmark.json',JSON.stringify(report,null,2));console.log(JSON.stringify(row));
  }
  for(const c of contexts)await c.close();
 }
}finally{await browser.close();fs.rmSync(dir,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1});
