/* Exercise actual renderer resize/rollback and pinned quality at native DPR plateaus. */
const fs=require('node:fs');let pw;try{pw=require('playwright')}catch{pw=require('/opt/codex/cua_node/lib/node_modules/playwright')}
(async()=>{const browser=await pw.chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});const rows=[];try{
 for(const dpr of [0.8,1,1.25,2])for(const coarse of [false,true]){
  const context=await browser.newContext({viewport:{width:1000,height:700},deviceScaleFactor:dpr,hasTouch:coarse}),page=await context.newPage();await page.goto('http://localhost:5173');await page.waitForFunction(()=>!!window.__game);
  const result=await page.evaluate(async()=>{
   const g=window.__game,raf=requestAnimationFrame.bind(window);g.paused=true;window.requestAnimationFrame=()=>0;await new Promise(r=>raf(()=>raf(r)));
   const {AUTO_STEPS,autoStartIndex,densityFor,GOVERNOR,FIXED_CAPS}=await import('/src/rendering/RenderScale.ts');
   const r=g.renderer,ratio=window.devicePixelRatio;
   const quality=q=>{g.save.data.settings.renderQuality=q;r.resize();};
   quality('high');quality('auto');
   const originalIndex=autoStartIndex(matchMedia('(pointer: coarse)').matches,innerWidth*innerHeight),original=r.density;
   const expected=AUTO_STEPS.slice(originalIndex+1).map(cap=>densityFor(cap,ratio)).find(d=>d<original);
   if(expected===undefined)throw Error('No density reduction in fixture');
   for(let i=0;i<GOVERNOR.settleFrames+GOVERNOR.windowFrames*GOVERNOR.slowWindows;i++)r.sampleFrame(40);
   if(r.density!==expected||g.canvas.width!==Math.round(innerWidth*expected))throw Error('Did not reach lower effective density');
   const reduced=r.density;
   for(let i=0;i<GOVERNOR.settleFrames+GOVERNOR.windowFrames;i++)r.sampleFrame(40);
   if(r.density!==original||r.governor.step!==originalIndex)throw Error('Rollback did not restore original cap/index');
   for(const [q,cap] of Object.entries(FIXED_CAPS)){
    quality(q);const density=r.density;
    for(let i=0;i<300;i++)r.sampleFrame(100);
    if(density!==densityFor(cap,ratio)||r.density!==density)throw Error('Fixed quality changed');
   }
   return {dpr:ratio,coarse:matchMedia('(pointer: coarse)').matches,original,reduced,rollback:true,fixedSettings:true};
  });rows.push(result);await context.close();
 }
 console.log(JSON.stringify(rows));fs.writeFileSync(process.env.BREACH_REPORT||'/tmp/render-scale-plateau-regressions.json',JSON.stringify(rows,null,2));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
