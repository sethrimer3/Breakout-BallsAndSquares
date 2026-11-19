/* Compare drawing with archived pre-instrumentation Renderer/LightRenderer.
 * Fixed clocks are for exact pixels; separate calibration uses the real clock.
 * Vite required. No physical GPU/FPS claim. */
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
let pw;try{pw=require('playwright')}catch{pw=require('/opt/codex/cua_node/lib/node_modules/playwright')}
const root=path.resolve(__dirname,'..'),ref=process.env.BREACH_BASELINE_REF||'3eb3b97';
const dir=fs.mkdtempSync(path.join(root,'node_modules/.cache/telemetry-pixels-'));
cp.execFileSync('tar',['-x','-C',dir],{input:cp.execFileSync('git',['archive',ref,'src'],{cwd:root,maxBuffer:32e6})});
(async()=>{const browser=await pw.chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});try{
 const reports=[];let calibration;
 for(const device of [{width:1000,height:700,dpr:1},{width:412,height:915,dpr:2.625}]){
  const context=await browser.newContext({viewport:{width:device.width,height:device.height},deviceScaleFactor:device.dpr,reducedMotion:'reduce'}),page=await context.newPage();
  await page.route('https://fonts.googleapis.com/**',r=>r.abort());await page.goto('http://localhost:5173');await page.locator('[data-act="play"]').click();
  const report=await page.evaluate(async({url,device})=>{
   const g=window.__game,raf=requestAnimationFrame.bind(window),clock=performance.now.bind(performance);g.paused=true;window.requestAnimationFrame=()=>0;await new Promise(r=>raf(()=>raf(r)));
   const {Renderer:Old}=await import(url+'/src/rendering/Renderer.ts'),canvas=document.createElement('canvas'),old=new Old(canvas,g);
   g.reserves=1;g.paused=false;g.deploySoldier(g.world.roomCenterX,g.world.roomCenterY,1,0);g.paused=true;g.runStats.time=25.68;
   const ox=g.world.roomCenterX,oy=g.world.roomCenterY;let comparisons=0;
   performance.now=()=>123456;
   try{for(const quality of device.dpr===1?['auto']:['auto','low'])for(const zoom of [1.13,2.5])for(const pan of [0,1])for(const [bloom,soft]of [[false,false],[true,false],[true,true]]){
    g.save.data.settings.renderQuality=quality;g.save.data.settings.bloom=bloom;g.save.data.settings.softShadows=soft;old.resize();g.renderer.resize();
    g.camera.following=false;g.camera.zoom=zoom;g.camera.x=ox+pan*17.25;g.camera.y=oy+pan*11.5;g.updateFlashPolygons();
    for(let i=0;i<3;i++){old.draw();g.renderer.draw();}
    const a=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data,b=g.canvas.getContext('2d').getImageData(0,0,g.canvas.width,g.canvas.height).data;
    if(a.length!==b.length)throw Error('Backing size mismatch');
    for(let i=0;i<a.length;i++)if(a[i]!==b[i])throw Error('Changed pixel '+JSON.stringify({device,quality,zoom,pan,bloom,soft,channel:i,a:a[i],b:b[i]}));comparisons++;
   }}finally{performance.now=clock;}
   return{device,comparisons,changedChannels:0};
  },{url:'/'+path.relative(root,dir),device});reports.push(report);
  if(device.dpr>1){
   await(await context.newCDPSession(page)).send('Emulation.setCPUThrottlingRate',{rate:4});
   calibration=await page.evaluate(async()=>{
    const {FrameTimings}=await import('/src/core/FrameTimings.ts');const t=new FrameTimings(),times=[];
    for(let batch=0;batch<10;batch++){const start=performance.now();for(let i=0;i<2000;i++){t.beginFrame();t.current.bullets=100;t.current.simulationSteps=5;for(let p=0;p<32;p++)performance.now();t.sample(16.667,4,i*16.667,4);}times.push((performance.now()-start)/2000);}
    times.sort((a,b)=>a-b);return{cpuThrottle:4,framesPerBatch:2000,batches:10,stopwatchReadsPerFrame:32,samplingMsPerFrame:{p50:times[5],p95:times[9]},scope:'fixed-buffer reset/copy and clock reads only; excludes scene probes and browser observer delivery'};
   });
  }
  await context.close();
 }
 const result={baseline:ref,browser:browser.version(),reports,calibration};fs.writeFileSync(process.env.BREACH_REPORT||'/tmp/render-telemetry-smoke.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();fs.rmSync(dir,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1});
