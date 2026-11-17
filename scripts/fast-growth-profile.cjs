/* Real generator-growth + render profiling. Requires Vite on port 5173. */
const fs=require('node:fs');let pw;try{pw=require('playwright')}catch{pw=require('/opt/codex/cua_node/lib/node_modules/playwright')}
(async()=>{const browser=await pw.chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});try{
 const page=await browser.newPage({viewport:{width:1000,height:700}});await page.goto('http://localhost:5173');await page.locator('[data-act="play"]').click();
 await page.evaluate(async()=>{
  const g=window.__game,raf=requestAnimationFrame.bind(window);window.requestAnimationFrame=()=>0;g.paused=true;await new Promise(r=>raf(()=>raf(r)));
  g.save.data.settings.renderQuality='low';g.save.data.settings.softShadows=false;g.renderer.resize();g.soldiers.length=0;g.flashes.length=0;g.fire.clear();g.fog.light.fill(1);
  const w=g.world,cores=w.blightCores.filter(c=>c.alive&&c.size===2).slice(0,8);
  for(const c of cores)for(let y=c.cy-12;y<=c.cy+13;y++)for(let x=c.cx-12;x<=c.cx+13;x++)if(w.inBounds(x,y)&&!w.coreId[y*w.width+x])w.setCell(x,y,0,'set');
  g.growth.reset();g.terrain.rebuildAll();
  const target=cores[0];g.camera.following=false;g.camera.zoom=.75;g.camera.x=(target.cx+5)*w.cellSize;g.camera.y=(target.cy+5)*w.cellSize;
  for(let i=0;i<8;i++){g.runStats.time=80;g.updateFlashPolygons();g.renderer.draw();}
  window.__fastProfile={g,raf};
 });
 const cdp=await page.context().newCDPSession(page);await cdp.send('Profiler.enable');await cdp.send('Profiler.setSamplingInterval',{interval:500});await cdp.send('Profiler.start');
 const rows=await page.evaluate(async()=>{
  const {g,raf}=window.__fastProfile,rows=[];
  for(let frame=0;frame<120;frame++){
   await new Promise(r=>raf(r));const start=performance.now(),before=g.growth.totalEvents;g.runStats.time=80+frame/60;
   g.growth.update(1/60,g.runStats.time,[]);const sim=performance.now();g.terrain.update();const terrain=performance.now();
   g.lightOverBudgetFrames=0;g.lighting.quality='high';g.updateFlashPolygons();const shadows=performance.now();g.renderer.draw();const drawn=performance.now();
   rows.push({growthMs:sim-start,terrainMs:terrain-sim,shadowMs:shadows-terrain,drawMs:drawn-shadows,totalMs:drawn-start,events:g.growth.totalEvents-before,pending:g.terrain.chunks.pending,rebuilt:g.terrain.rebuiltLastFrame,exposed:g.growth.exposedCoresCount,rate:g.growth.rate});
  }
  return rows;
 });
 const {profile}=await cdp.send('Profiler.stop');fs.writeFileSync('/tmp/fast-growth-cpu-profile.json',JSON.stringify(profile));
 const nodes=new Map(profile.nodes.map(n=>[n.id,n]));const totals=new Map();for(let i=0;i<(profile.samples||[]).length;i++){const n=nodes.get(profile.samples[i]),f=n.callFrame,key=f.functionName+' '+f.url.split('/src/').at(-1)+':'+(f.lineNumber+1);totals.set(key,(totals.get(key)||0)+(profile.timeDeltas[i]||0));}
 const pct=a=>{a.sort((a,b)=>a-b);return{p50:a[Math.floor(a.length*.5)],p95:a[Math.floor(a.length*.95)],p99:a.at(-1)}};
 const summary={events:rows.reduce((s,r)=>s+r.events,0),maxPending:Math.max(...rows.map(r=>r.pending)),rate:rows.at(-1).rate,exposed:rows.at(-1).exposed,times:Object.fromEntries(['growthMs','terrainMs','shadowMs','drawMs','totalMs'].map(k=>[k,pct(rows.map(r=>r[k]))])),top:[...totals.entries()].sort((a,b)=>b[1]-a[1]).slice(0,25).map(([name,us])=>({name,ms:us/1000}))};
 fs.writeFileSync(process.env.BREACH_REPORT||'/tmp/fast-growth-profile.json',JSON.stringify({summary,rows},null,2));console.log(JSON.stringify(summary,null,2));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
