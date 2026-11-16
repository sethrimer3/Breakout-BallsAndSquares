/* Supplemental rendering audit: terrain event bursts, pool-heavy weapon
 * submission, HUD mutations, thumbnail costs and canvas storage estimates. */
const fs=require('node:fs');let pw;try{pw=require('playwright')}catch{pw=require('/opt/codex/cua_node/lib/node_modules/playwright')}
(async()=>{const browser=await pw.chromium.launch({executablePath:process.env.BREACH_CHROMIUM||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});try{
const page=await browser.newPage({viewport:{width:1440,height:900}});await page.goto(process.env.BREACH_BASE_URL||'http://127.0.0.1:5173');await page.locator('[data-act="play"]').click();
const result=await page.evaluate(async()=>{
 const g=window.__game,raf=requestAnimationFrame.bind(window);window.requestAnimationFrame=()=>0;g.paused=true;await new Promise(r=>raf(()=>raf(r)));
 const {drawWeaponExpansion}=await import('/src/rendering/WeaponExpansionRenderer.ts');
 const t=g.terrain,w=g.world,c=g.camera,clock=performance.now.bind(performance),ctx=g.canvas.getContext('2d');
 const percentile=a=>{a.sort((a,b)=>a-b);return{n:a.length,p50:a[Math.ceil(a.length*.5)-1],p95:a[Math.ceil(a.length*.95)-1],p99:a[Math.ceil(a.length*.99)-1]}};
 const terrain=[];const paint=t.paintFloor;let paints=0,paintMs=0;
 t.paintFloor=function(...a){const start=clock();paints++;try{return paint.apply(this,a)}finally{paintMs+=clock()-start}};
 for(const events of [10,100,1000]){
  const times=[];paints=0;paintMs=0;
  for(let trial=0;trial<10;trial++){const start=clock();for(let i=0;i<events;i++){const x=w.roomX0+(i%24),y=w.roomY0+Math.floor(i/24)%24;w.setCell(x,y,(i+trial)%2?10:0)}if(t.flushFloor)t.flushFloor();times.push(clock()-start)}
  terrain.push({events,mutationCpu:percentile(times),floorPaintCalls:paints,meanFloorMs:paintMs/10});
  while(t.chunks.pending)t.update();
 }
 t.paintFloor=paint;
 const weapons=[];g.soldiers.length=0;g.combat.freeze.clear();c.x=w.roomCenterX;c.y=w.roomCenterY;c.zoom=.5;
 for(const zoom of [.5,1.13,4])for(const location of ['visible','offscreen']){
  c.zoom=zoom;g.combat.laser.clear();g.combat.rail.clear();g.combat.circuit.clear();
  const wx=c.screenToWorldX(location==='visible'?c.viewW/2:-2000),wy=c.screenToWorldY(location==='visible'?c.viewH/2:-2000);
  for(const b of g.combat.laser.segments.items)Object.assign(b,{active:true,x1:wx,y1:wy,x2:wx+100,y2:wy+50,life:.2,band:2,reflected:true});
  for(const b of g.combat.rail.beams.items)Object.assign(b,{active:true,x1:wx,y1:wy,x2:wx+100,y2:wy+50,life:.2,maxLife:1});
  const times=[];for(let i=0;i<10;i++)drawWeaponExpansion(ctx,g,false);
  for(let i=0;i<60;i++){const start=clock();drawWeaponExpansion(ctx,g,false);times.push(clock()-start)}
  weapons.push({zoom,location,prismSegments:g.combat.laser.segments.items.length,railSegments:g.combat.rail.beams.items.length,cpu:percentile(times)});
 }
 // Changed values should update, but unchanged stats currently recreate DOM.
 const observed=[];const observer=new MutationObserver(records=>observed.push(...records));observer.observe(g.hud.root,{subtree:true,childList:true,attributes:true,characterData:true});
 let hudMs=0;for(let i=0;i<20;i++){const start=clock();g.hud.update(g,clock()+i*100,true);hudMs+=clock()-start}await Promise.resolve();observer.disconnect();
 const treeTimes=[];g.openUpgrades();for(let i=0;i<60;i++){const start=clock();g.upgradeTree.drawCircuit(0);treeTimes.push(clock()-start)}
 const storage={};const record=(label,canvases)=>{const list=canvases.filter(Boolean);storage[label]={canvases:list.length,pixels:list.reduce((sum,cv)=>sum+cv.width*cv.height,0),rgbaBytes:list.reduce((sum,cv)=>sum+cv.width*cv.height*4,0)}};
 record('terrainChunks',t.canvases);record('floor',[t.floorCanvas]);record('sectorThumbnails',g.labMap.thumbs||[]);record('hiddenMapTiles',g.labMap.canvases);
 record('lightBuffers',[g.renderer.lightRenderer.lmCanvas,g.renderer.lightRenderer.layerCanvas,g.renderer.lightRenderer.maskCanvas,g.renderer.lightRenderer.wallCanvas]);
 return{terrain,weapons,upgradeTree:{nodes:g.upgradeTree.activeBodies.length,staticCircuitCpu:percentile(treeTimes)},hud:{forcedUpdates:20,cpuMs:hudMs,mutationRecords:observed.length},storage};
});fs.writeFileSync(process.env.BREACH_WORKLOAD_REPORT||'/tmp/breach-render-workloads.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
