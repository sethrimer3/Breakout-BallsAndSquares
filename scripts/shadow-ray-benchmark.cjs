/* Vite required. Paired shadow preparation + complete render-frame timings.
 * Optional BREACH_BASELINE_REF, BREACH_REPORT, BREACH_SAMPLES (>=20), BREACH_PREP_ONLY=1, BREACH_SOFT_SHADOWS=0. */
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
let pw;try{pw=require('playwright')}catch{pw=require('/opt/codex/cua_node/lib/node_modules/playwright')}
const root=path.resolve(__dirname,'..');
const ref=cp.execFileSync('git',['rev-parse',process.env.BREACH_BASELINE_REF||'HEAD'],{cwd:root,encoding:'utf8'}).trim();
const dir=fs.mkdtempSync(path.join(root,'node_modules/.cache/shadow-rays-'));
cp.execFileSync('tar',['-x','-C',dir],{input:cp.execFileSync('git',['archive',ref,'src'],{cwd:root,maxBuffer:32e6})});
const report={baseline:ref,rows:[],samples:Math.max(20,Number(process.env.BREACH_SAMPLES||30))};
(async()=>{
 const browser=await pw.chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});report.browser=browser.version();
 try{
  for(const device of [{name:'desktop',width:1200,height:800,scale:1,cpu:1},{name:'mobile',width:390,height:844,scale:2,cpu:4}]){
   device.preparationOnly=process.env.BREACH_PREP_ONLY==='1';
   device.softShadows=process.env.BREACH_SOFT_SHADOWS!=='0';
   const context=await browser.newContext({viewport:{width:device.width,height:device.height},deviceScaleFactor:device.scale});
   const page=await context.newPage();
   await page.addInitScript(()=>{let seed=427;Math.random=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296)});
   await(await context.newCDPSession(page)).send('Emulation.setCPUThrottlingRate',{rate:device.cpu});
   await page.goto('http://localhost:5173');await page.locator('[data-act="play"]').click();
   await page.evaluate(async({url,softShadows})=>{
    const g=window.__game,raf=requestAnimationFrame.bind(window);window.requestAnimationFrame=()=>0;g.paused=true;await new Promise(r=>raf(()=>raf(r)));
    const [{LightingSystem:Old},{LightingSystem:Next},{Renderer},{Soldier}]=await Promise.all([import(url+'/src/systems/LightingSystem.ts'),import('/src/systems/LightingSystem.ts'),import('/src/rendering/Renderer.ts'),import('/src/entities/Soldier.ts')]);
    const w=g.world,c=g.camera,x=w.roomX0+64,y=w.roomY0+64;
    // Air around the sources is essential: lights embedded deep in solid Blight
    // return before scanning corners and would not exercise this optimization.
    for(let cy=y-22;cy<=y+22;cy++)for(let cx=x-22;cx<=x+22;cx++){
     w.setCell(cx,cy,0,'set');
     if(Math.abs(cx-x)<8&&Math.abs(cy-y)<8)continue;
     for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++)if((cx+cy+dx+dy)%4!==0)w.setSubCell(cx*2+dx,cy*2+dy,10);
    }
    g.terrain.rebuildAll();
    // Reveal the combat patch so image checks include visible lighting/shadows.
    g.fog.light.fill(1);
    const lighting=[new Old(w),new Next(w)];
    g.save.data.settings.renderQuality='high';g.save.data.settings.softShadows=softShadows;g.renderer.resize();
    const canvas=document.createElement('canvas'),old=new Renderer(canvas,g);old.resize();
    c.following=false;c.x=x*w.cellSize;c.y=y*w.cellSize;
    window.__shadowRays={g,w,c,x,y,raf,Soldier,lighting,renderers:[old,g.renderer],clock:performance.now.bind(performance)};
   },{url:'/'+path.relative(root,dir),softShadows:device.softShadows});
   for(const dense of [false,true])for(const moving of [false,true])for(const zoom of [.5,1.13]){
    const row=await page.evaluate(async({dense,moving,zoom,samples,preparationOnly})=>{
     const {g,w,c,x,y,raf,Soldier,lighting,renderers,clock}=window.__shadowRays;
     g.soldiers.length=0;g.flashes.length=0;g.fire.clear();g.particles.clear();g.combat.bullets.clear();
     for(let i=0;i<(dense?20:1);i++){
      const s=new Soldier((x+(i%5-2)*2)*w.cellSize,(y+(Math.floor(i/5)-2)*2)*w.cellSize,1,0,100,'pistol');s.slotIndex=i%8;g.soldiers.push(s);g.onShot(s,1,0,s.x,s.y);
     }
     if(dense)for(let i=0;i<200;i++){g.fire.spawn(1,(x+(i%20-10)*2)*w.cellSize,(y+(Math.floor(i/20)-5)*2)*w.cellSize,0,0,1,0);g.fire.life[g.fire.count-1]=.6}
     c.zoom=zoom;
     for(const system of lighting){system.quality='high';for(let i=0;i<40;i++)system.updateFixtures(c);}
     const times=[[],[]],preparation=[[],[]];let changedChannels=0,maxDelta=0,polygonComparisons=0;
     const snapshot=()=>({
      flashes:g.flashes.map(f=>({count:f.polyCount,has:f.hasPolygon,poly:Array.from(f.poly.subarray(0,f.polyCount*2)),lit:Array.from(f.lit.cells.subarray(0,f.lit.count))})),
      soft:g.lighting.softLights.slice(0,g.lighting.softCount).map(l=>({count:l.polyCount,poly:Array.from(l.poly.subarray(0,l.polyCount*2)),lit:Array.from(l.lit.cells.subarray(0,l.lit.count))})),
     });
     let tracedFlashes=0;
     for(let frame=0;frame<samples+8;frame++){
      await new Promise(r=>raf(r));
      c.x=x*w.cellSize+(moving?Math.sin(frame*.11)*45:0)+.37;c.y=y*w.cellSize+(moving?Math.cos(frame*.09)*35:0)+.71;
      for(let j=0;j<(dense?32:1);j++){
       const sx=(x-16)*2+(frame*7+j*3)%64,sy=(y-16)*2+(frame+j*7)%64;
       if(Math.abs((sx>>1)-x)<8&&Math.abs((sy>>1)-y)<8)continue;
       w.setSubCell(sx,sy,(frame+j)%3?10:0,(frame+j)%3?'grown':'destroyed');
      }
      // Soldier occluders turn and move throughout the paired comparison.
      for(let i=0;i<g.soldiers.length;i++){const s=g.soldiers[i];s.facingAngle=frame*.07+i*.2;s.x=(x+(i%5-2)*2)*w.cellSize+Math.sin(frame*.09+i)*.4;}
      while(g.terrain.chunks.pending)g.terrain.update();
      const snapshots=[];
      for(const j of frame%2?[1,0]:[0,1]){
       g.lighting=lighting[j];g.lightOverBudgetFrames=0;g.lighting.quality='high';
       performance.now=()=>123456+frame*1000/60;
       const start=clock();g.updateFlashPolygons();const prepared=clock();if(!preparationOnly)renderers[j].draw();const finished=clock();
       performance.now=clock;
       if(frame>=8){times[j].push(finished-start);preparation[j].push(prepared-start);}
       if(frame===17||frame===samples+7)snapshots[j]=snapshot();
      }
      if(frame===17||frame===samples+7){
       if(JSON.stringify(snapshots[0])!==JSON.stringify(snapshots[1]))throw Error('Polygon/lit-cell mismatch');
       polygonComparisons++;
       tracedFlashes=snapshots[1].flashes.filter(f=>f.has).length;
       if(!tracedFlashes)throw Error('Fixture has no shadow-traced flashes');
       if(!preparationOnly){
        const aa=renderers[0].canvas.getContext('2d').getImageData(0,0,g.canvas.width,g.canvas.height).data;
        const bb=renderers[1].canvas.getContext('2d').getImageData(0,0,g.canvas.width,g.canvas.height).data;
        for(let i=0;i<aa.length;i++)if(aa[i]!==bb[i]){changedChannels++;maxDelta=Math.max(maxDelta,Math.abs(aa[i]-bb[i]));}
       }
      }
     }
     const pct=a=>{a.sort((a,b)=>a-b);return{p50:a[Math.floor(a.length*.5)],p95:a[Math.floor(a.length*.95)],p99:a.at(-1)}};
     return{dense,moving,zoom,tracedFlashes,baseline:{frame:pct(times[0]),preparation:pct(preparation[0])},updated:{frame:pct(times[1]),preparation:pct(preparation[1])},changedChannels,maxDelta,polygonComparisons,imageComparisons:preparationOnly?0:polygonComparisons};
    },{dense,moving,zoom,samples:report.samples,preparationOnly:device.preparationOnly});
    if(row.changedChannels)throw Error('Pixel mismatch '+JSON.stringify(row));
    report.rows.push({device,...row});console.log(JSON.stringify({device:device.name,...row}));
    fs.writeFileSync(process.env.BREACH_REPORT||'/tmp/shadow-ray-benchmark.json',JSON.stringify(report,null,2));
   }
   await context.close();
  }
 }finally{await browser.close();fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
