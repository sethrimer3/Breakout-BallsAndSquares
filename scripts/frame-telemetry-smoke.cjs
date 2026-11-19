/* Synthetic cadence regression for the real Game.frame/export path. Vite required.
 * These timestamps verify diagnostics, not physical presentation performance. */
const fs=require('node:fs');let pw;try{pw=require('playwright')}catch{pw=require('/opt/codex/cua_node/lib/node_modules/playwright')}
(async()=>{const browser=await pw.chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});try{
 const context=await browser.newContext({viewport:{width:412,height:915},deviceScaleFactor:2.625});const page=await context.newPage();await page.route('https://fonts.googleapis.com/**',r=>r.abort());await page.goto('http://localhost:5173');await page.locator('[data-act="play"]').click();
 const result=await page.evaluate(async()=>{
  const g=window.__game,raf=requestAnimationFrame.bind(window);g.paused=true;window.requestAnimationFrame=()=>0;await new Promise(r=>raf(()=>raf(r)));
  g.reserves=1;g.paused=false;g.deploySoldier(g.world.roomCenterX,g.world.roomCenterY,1,0);g.autoMove=false;g.save.data.settings.alwaysShootWhenAutoMoveOff=false;
  if(g.soldiers.length!==1)throw Error('No live simulation fixture');
  g.last=1000;g.fpsAcc=g.fpsFrames=0;g.wasPlaying=false;g.acc=0;
  g.stats.connectedAirMapping=true;g.fog.connectedAir=true;
  for(let i=1;i<=5;i++){
   if(i===3)g.renderer.lightRenderer.maskState=null;
   g.frame(1000+i*200);
  }
  const initial=JSON.parse(g.exportTelemetryJson()).timing;
  if(Math.abs(initial.fps-5)>1e-8||initial.recentActiveFrames.fps!==5||initial.recentActiveFrames.samples!==4)throw Error('200ms cadence was not reported as 5 FPS');
  if(initial.rendering.backingSize[0]!==g.canvas.width||initial.rendering.backingSize[1]!==g.canvas.height||initial.rendering.density!==g.renderer.density)throw Error('Render size differs from actual backing store');
  const recent=initial.recentActiveFrames;
  if(initial.schemaVersion!==3)throw Error('Wrong diagnostic schema');
  if(recent.counts.simulationSteps.max!==5||recent.counts.clampedWallTimeMs.p50!==100)throw Error('Catch-up workload missing');
  if(recent.counts.soldiers.last!==1||recent.counts.bullets.last!==g.combat.bullets.activeCount||recent.counts.bullets.last===g.combat.bullets.items.length)throw Error('Active scene counts differ');
  if(recent.counts.maskFullRebuilds.max<1)throw Error('Forced mask rebuild not recorded');
  if(recent.counts.airFloods.max<1||recent.counts.airCellsVisited.max<1)throw Error('Connected air work missing');
  if(recent.counts.bloomEnabled.last!==Number(g.bloom)||recent.counts.softShadowsEnabled.last!==Number(g.softShadows))throw Error('Historical graphics flags mismatch');
  if(recent.counts.backingPixels.last!==g.canvas.width*g.canvas.height||recent.counts.renderDensity.last!==g.renderer.density)throw Error('Historical backing size mismatch');
  for(const [key,summary]of Object.entries(recent.phasesMs))if(!Number.isFinite(summary.max)||summary.max<0)throw Error('Invalid phase '+key);
  if(recent.slowestWorkFrames.length!==3||recent.longestIntervalFrames.length!==3)throw Error('Slow-frame context missing');
  if(typeof initial.browserEvents.longTasks.supported!=='boolean'||typeof initial.browserEvents.longAnimationFrames.supported!=='boolean')throw Error('Missing API support flags');
  g.paused=true;g.frame(2200);g.frame(2400);const paused=JSON.parse(g.exportTelemetryJson()).timing;
  if(JSON.stringify(paused.recentActiveFrames)!==JSON.stringify(initial.recentActiveFrames))throw Error('Pause overwrote gameplay history');
  g.paused=false;g.frame(2600);if(JSON.parse(g.exportTelemetryJson()).timing.recentActiveFrames.samples!==0)throw Error('Resume did not reset history');
  g.frame(2800);const resumed=JSON.parse(g.exportTelemetryJson()).timing;
  if(resumed.recentActiveFrames.samples!==1||resumed.recentActiveFrames.fps!==5)throw Error('Resume cadence mismatch');
  return{syntheticIntervalMs:200,reportedFps:initial.fps,recent:initial.recentActiveFrames,rendering:initial.rendering,pausePreservesHistory:true,resumeResetsHistory:true};
 });console.log(JSON.stringify({syntheticIntervalMs:result.syntheticIntervalMs,reportedFps:result.reportedFps,samples:result.recent.samples,phaseCount:Object.keys(result.recent.phasesMs).length,workloadChecksPassed:true,pausePreservesHistory:result.pausePreservesHistory,resumeResetsHistory:result.resumeResetsHistory}));fs.writeFileSync(process.env.BREACH_REPORT||'/tmp/frame-telemetry-smoke.json',JSON.stringify(result,null,2));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
