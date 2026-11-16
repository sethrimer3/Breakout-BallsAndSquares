/* Requires Vite and the browser tools used by the other smoke checks.
 * Observe major rendering families, including shadow preparation and menu work.
 * No production behavior is changed. See docs/RENDERING_AUDIT.md for limits.
 */
const fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
let pw;try{pw=require('playwright')}catch{pw=require('/opt/codex/cua_node/lib/node_modules/playwright')}
const output=process.env.BREACH_AUDIT_REPORT||'/tmp/breach-render-pipeline.json';
const root=path.resolve(__dirname,'..'),baseUrl=process.env.BREACH_BASE_URL||'http://127.0.0.1:5173';
let archive=null,appUrl=baseUrl;
const revision=execFileSync('git',['rev-parse',process.env.BREACH_AUDIT_REF||'HEAD'],{cwd:root,encoding:'utf8'}).trim();
if(process.env.BREACH_AUDIT_REF){
 fs.mkdirSync(path.join(root,'node_modules/.cache'),{recursive:true});archive=fs.mkdtempSync(path.join(root,'node_modules/.cache/pipeline-reference-'));
 execFileSync('tar',['-x','-C',archive],{input:execFileSync('git',['archive',revision,'src','index.html'],{cwd:root,maxBuffer:32*1024*1024})});
 if(fs.existsSync(path.join(root,'public')))fs.cpSync(path.join(root,'public'),archive,{recursive:true});
 appUrl=new URL('/'+path.relative(root,archive).split(path.sep).join('/')+'/index.html',baseUrl).href;
}
const report={revision,status:'running',variant:process.env.BREACH_AUDIT_VARIANT||(archive?'reference':'working-tree'),samples:Number(process.env.BREACH_AUDIT_SAMPLES||30),devices:[],scenarios:[]};
(async()=>{const browser=await pw.chromium.launch({executablePath:process.env.BREACH_CHROMIUM||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});report.browser=browser.version();try{
for(const device of [{name:'desktop',width:1440,height:900,dpr:1},{name:'mobile',width:390,height:844,dpr:2}]){
 const context=await browser.newContext({viewport:{width:device.width,height:device.height},deviceScaleFactor:device.dpr});
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{let s=843;Math.random=()=>((s=Math.imul(s,1664525)+1013904223>>>0)/4294967296)});
 await page.goto(appUrl);await page.locator('[data-act="play"]').waitFor();
 const menu=await page.evaluate(async()=>{
  const g=window.__game,raf=requestAnimationFrame.bind(window),now=performance.now.bind(performance);
  const data={gameDraw:{calls:0,ms:0},shadow:{calls:0,ms:0},menuDraw:{calls:0,ms:0}};
  for(const [o,key,name]of [[g.renderer,'draw','gameDraw'],[g,'updateFlashPolygons','shadow'],[g.mainMenu.background,'render','menuDraw']]){const f=o[key];o[key]=function(...a){const start=now();try{return f.apply(this,a)}finally{data[name].calls++;data[name].ms+=now()-start}}}
  const stamps=[];for(let i=0;i<40;i++)stamps.push(await new Promise(resolve=>raf(resolve)));
  return{...data,intervals:stamps.slice(1).map((v,i)=>v-stamps[i]),opaqueMenu:getComputedStyle(g.mainMenu.root).backgroundColor};
 });
 report.devices.push({...device,menu});
 await page.locator('[data-act="play"]').click();
 await page.evaluate(async()=>{
  const g=window.__game,raf=requestAnimationFrame.bind(window);window.__auditRaf=raf;window.requestAnimationFrame=()=>0;await new Promise(r=>raf(()=>raf(r)));
  g.paused=true;g.save.data.seed='AUDIT01';g.save.data.settings.devMode=true;g.save.data.settings.devMapAccess=true;
  const clock=performance.now.bind(performance),stack=[],stats={};
  function wrap(o,key,label){const original=o[key];if(typeof original!=='function')return;o[key]=function(...args){const parent=stack.at(-1),entry={label,child:0},start=clock();stack.push(entry);try{return original.apply(this,args)}finally{const ms=clock()-start;stack.pop();if(parent)parent.child+=ms;const row=stats[label]??=( {inclusive:0,self:0,calls:0});row.inclusive+=ms;row.self+=ms-entry.child;row.calls++}}}
  for(const [object,prefix,names]of [
   [g,'game',['updateFlashPolygons','generateLab','refreshSectorThumbs']],
   [g.renderer,'renderer',Object.getOwnPropertyNames(Object.getPrototypeOf(g.renderer)).filter(x=>x==='draw'||x.startsWith('draw'))],
   [g.terrain,'terrain',['update','buildChunk','draw','drawFloor','drawPanels','drawRoomLight','drawLabGlow','drawLabLights','drawBlightEdges','paintEdgeFire','drawSurfaceOutlines','rebuildAll','buildFloor']],
   [g.renderer.lightRenderer,'light',['renderLighting','tracePolygonPath','beginLayer','finishAirLayer','updateWallLight']],
   [g.lighting,'shadows',['computeVisibilityPolygon','updateSoftLights','updateFixtures']],
   [g.renderer.lightRenderer.softener,'softener',['soften']],
   [g.renderer.fogRenderer,'fog',['draw']], [g.renderer.creatureRenderer,'creatures',['draw']],
   [g.renderer.fireRenderer,'fire',['drawSmoke','drawGlow']],[g.renderer.fieryFlash,'fiery',['render']],
   [g.late,'encounters',['draw','drawOverlay']],[g.hud,'hud',['update']]])for(const name of names)wrap(object,name,prefix+'.'+name);
  const reset=()=>{for(const key of Object.keys(stats))delete stats[key]};
  window.__audit={g,raf,clock,stack,stats,reset};
 });
 for(const world of (process.env.BREACH_AUDIT_WORLDS||'1,2,3,4,5').split(',').map(Number)){
  const startup=await page.evaluate(id=>{const {g,clock,reset,stats}=window.__audit;reset();g.save.data.settings.devMapAccess=true;const start=clock();if(g.labDef.id===id){g.generateLab();g.terrain.rebuildAll();g.refreshSectorThumbs()}else g.selectLabWorld(id);if(g.labDef.id!==id)throw Error('World selection failed: '+id);return{ms:clock()-start,parts:structuredClone(stats),world:g.labDef.name,lights:g.world.roomLights.length,thumbnails:g.labDef.sectors*(g.labDef.rows||g.labDef.sectors)}},world);
  for(const scene of ['spawn','overview','combat-moving','detail']){
   const result=await page.evaluate(async({scene,samples})=>{
    const {g,raf,clock,stack,stats,reset}=window.__audit,c=g.camera,w=g.world;
    const {Soldier}=await import(new URL('./src/entities/Soldier.ts',document.baseURI).href);
    g.paused=true;g.mainMenu.hide();g.soldiers.length=0;g.flashes.length=0;g.fire.clear();g.particles.clear();g.combat.bullets.clear();
    g.save.data.settings.devMapAccess=false;g.save.data.settings.softShadows=true;g.save.data.settings.fieryMuzzleFlash=false;
    c.following=false;c.zoom=scene==='detail'?4:scene==='spawn'?1.13:.5;
    const ox=scene==='spawn'?w.roomCenterX:w.worldWidth/2,oy=scene==='spawn'?w.roomCenterY:w.worldHeight/2;c.x=ox;c.y=oy;
    const dense=scene==='combat-moving';
    if(dense){for(let i=0;i<20;i++){const s=new Soldier(ox+(i%5-2)*16,oy+(Math.floor(i/5)-2)*16,1,0,100,'pistol');g.soldiers.push(s);g.onShot(s,1,0,s.x,s.y)}for(let i=0;i<400;i++){g.fire.spawn(1,ox+(i%20-10)*60,oy+(Math.floor(i/20)-10)*60,0,0,1,0);g.fire.life[g.fire.count-1]=.6}}
    for(let i=0;i<100;i++)g.lighting.updateFixtures(c);
    const run=i=>{c.x=ox+(dense?Math.sin(i*.1)*80:0);c.y=oy+(dense?Math.cos(i*.1)*50:0);const priorNow=performance.now;performance.now=()=>123456;try{g.updateFlashPolygons();g.terrain.update();g.renderer.draw();g.hud.update(g,clock())}finally{performance.now=priorNow}};
    for(let i=0;i<5;i++)run(i);reset();
    const cpu=[],interval=[];let last=null;
    for(let i=0;i<samples;i++){const stamp=await new Promise(r=>raf(r));if(last!==null)interval.push(stamp-last);last=stamp;const start=clock();run(i);cpu.push(clock()-start)}
    const parts=structuredClone(stats);reset();
    // Count Canvas calls separately; wrapping them is too intrusive for timings.
    const operations={},prototype=CanvasRenderingContext2D.prototype,originals={};
    for(const name of ['clearRect','fillRect','drawImage','putImageData','lineTo','fill','stroke','createRadialGradient']){const f=prototype[name];originals[name]=f;prototype[name]=function(...args){const key=(stack.at(-1)?.label||'other')+':'+name;operations[key]=(operations[key]||0)+1;return f.apply(this,args)}}
    try{run(0)}finally{for(const [key,f]of Object.entries(originals))prototype[key]=f}
    const summarize=a=>{a.sort((a,b)=>a-b);const p=q=>a[Math.min(a.length-1,Math.ceil(a.length*q)-1)];return{n:a.length,p50:p(.5),p95:p(.95),p99:p(.99)}};
    const cameras={x:c.x,y:c.y,zoom:c.zoom};
    return{scene,cpu:summarize(cpu),interval:summarize(interval),parts:Object.fromEntries(Object.entries(parts).map(([k,v])=>[k,{selfMs:v.self/samples,inclusiveMs:v.inclusive/samples,callsPerFrame:v.calls/samples}])),operations,cameras,lights:w.roomLights.length,fixtures:g.lighting.fixtures.filter(Boolean).length,polygons:g.lighting.fixtures.reduce((s,f)=>s+(f?.polyCount||0),0),softLights:g.lighting.softCount,rays:g.lighting.lastRaysCast,canvasPixels:g.canvas.width*g.canvas.height};
   },{scene,samples:report.samples});
   report.scenarios.push({device:device.name,world,startup,...result});fs.writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify({device:device.name,world,scene,cpu:result.cpu,top:Object.entries(result.parts).sort((a,b)=>b[1].selfMs-a[1].selfMs).slice(0,5)}));
  }
 }
 if(errors.length)throw Error(JSON.stringify(errors));await context.close();
}
 report.status='passed';fs.writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify({status:'passed',scenarios:report.scenarios.length,output}));
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{if(archive)fs.rmSync(archive,{recursive:true,force:true})});
