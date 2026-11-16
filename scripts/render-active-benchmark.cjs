/* Vite must be running. Compare HEAD with working-tree renderers, using the same
 * frozen simulation, clocks, seeded RNG, camera trajectory and combat fixtures.
 * CPU submission and rAF intervals are separate; neither is a GPU/FPS claim.
 * Optional: BREACH_BASELINE_REF, BREACH_SAMPLES (>=20), BREACH_REPORT, BREACH_WORKLOADS (comma-separated), BREACH_CHECK_ONLY=1. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/codex/cua_node/lib/node_modules/playwright'); }
const root = path.resolve(__dirname, '..');
const ref = execFileSync('git', ['rev-parse', process.env.BREACH_BASELINE_REF || 'HEAD'], {cwd:root, encoding:'utf8'}).trim();
fs.mkdirSync(path.join(root, 'node_modules/.cache'), {recursive:true});
const baseline = fs.mkdtempSync(path.join(root, 'node_modules/.cache/render-comparison-'));
execFileSync('tar', ['-x', '-C', baseline], {input:execFileSync('git', ['archive', ref, 'src'], {cwd:root, maxBuffer:32*1024*1024})});
const baselineUrl = '/' + path.relative(root, baseline).split(path.sep).join('/');
const report = {baseline:ref, status:'running', samples:Math.max(20, Number(process.env.BREACH_SAMPLES || 60)), browser:null, pixels:[], invalidation:null, scenarios:[]};
const destination = process.env.BREACH_REPORT || '/tmp/breach-active-render-report.json';
(async()=>{
 const browser = await pw.chromium.launch({executablePath:process.env.BREACH_CHROMIUM || '/usr/bin/chromium', headless:true, args:['--no-sandbox']});
 report.browser = browser.version();
 try {
  for (const device of [{name:'desktop',width:1440,height:900,scale:1},{name:'mobile',width:390,height:844,scale:2}]) {
   const context = await browser.newContext({viewport:{width:device.width,height:device.height},deviceScaleFactor:device.scale});
   const page = await context.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(()=>{let state=12345;Math.random=()=>((state=Math.imul(state,1664525)+1013904223>>>0)/4294967296)});
   await page.goto(process.env.BREACH_BASE_URL || 'http://127.0.0.1:5173');
   await page.locator('[data-act="play"]').click();
   const checks = await page.evaluate(async ({baselineUrl})=>{
    const g=window.__game;g.paused=true;g.save.data.seed='RENDER01';g.startRun();g.paused=true;
    // Retain native rAF for the harness, stop automatic game/UI callbacks.
    const raf=window.requestAnimationFrame.bind(window);window.requestAnimationFrame=()=>0;
    await new Promise(resolve=>raf(()=>raf(resolve)));
    const [{Renderer:OldRenderer},{drawWeaponExpansion:oldWeapons},{FireRenderer:OldFire},
      {drawWeaponExpansion:newWeapons},{FireRenderer:NewFire},{MAT}]=await Promise.all([
      import(baselineUrl+'/src/rendering/Renderer.ts'),import(baselineUrl+'/src/rendering/WeaponExpansionRenderer.ts'),
      import(baselineUrl+'/src/rendering/FireRenderer.ts'),import('/src/rendering/WeaponExpansionRenderer.ts'),
      import('/src/rendering/FireRenderer.ts'),import('/src/world/PixelWorld.ts')]);
    const old=new OldRenderer(g.canvas,g);old.resize();const next=g.renderer;
    const c=g.camera,w=g.world,t=g.terrain,freeze=g.combat.freeze;
    c.following=false;c.x=w.roomCenterX;c.y=w.roomCenterY;c.zoom=1.13;
    g.save.data.settings.devMode=true;g.save.data.settings.devMapAccess=true;
    g.save.data.settings.softShadows=true;g.fire.clear();
    g.combat.rail.clear();g.soldiers.length=0;
    const origin={x:c.x,y:c.y};
    const ctx=g.canvas.getContext('2d');const now=performance.now.bind(performance);
    const random=Math.random;const fixedDraw=fn=>{let seed=123;Math.random=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296);performance.now=()=>123456;try{return fn()}finally{performance.now=now;Math.random=random}};
    const pixels=[];
    function compare(label,a,b){
     ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';ctx.filter='none';ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,g.canvas.width,g.canvas.height);
     ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);fixedDraw(a);
     const aa=ctx.getImageData(0,0,g.canvas.width,g.canvas.height).data;
     ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';ctx.filter='none';ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,g.canvas.width,g.canvas.height);
     ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);fixedDraw(b);
     const bb=ctx.getImageData(0,0,g.canvas.width,g.canvas.height).data;
     let channels=0,maxDelta=0;for(let i=0;i<aa.length;i++){const d=Math.abs(aa[i]-bb[i]);if(d){channels++;maxDelta=Math.max(maxDelta,d)}}
     pixels.push({label,channels,maxDelta});if(channels)throw Error(JSON.stringify(pixels.at(-1)));
    }
    const solid=[];for(let i=0;i<w.health.length;i++)if(w.health[i]>0&&!w.boundary[i])solid.push(i);
    function seedFreeze(dense){freeze.clear();const stride=dense?1:Math.max(1,Math.floor(solid.length/16));for(let j=0;j<solid.length;j+=stride){const i=solid[j];freeze.freezeCell(i%w.width,Math.floor(i/w.width),1,2)}}
    const oldFire=new OldFire(),newFire=new NewFire();
    for(const z of [.5,1.13,2.75]){
     c.zoom=z;c.x=origin.x+.37;c.y=origin.y+.71;
     for(const dense of [false,true]){seedFreeze(dense);compare('freeze-'+z+'-'+dense,()=>oldWeapons(ctx,g,false),()=>newWeapons(ctx,g,false))}
     // Expiration, destruction (before and after compaction), regeneration/clear.
     freeze.update(3);compare('thaw-'+z,()=>oldWeapons(ctx,g,false),()=>newWeapons(ctx,g,false));
     seedFreeze(false);const i=freeze.activeCellIndices[0];freeze.onCellDestroyed(i%w.width,Math.floor(i/w.width));
     compare('destroy-pending-'+z,()=>oldWeapons(ctx,g,false),()=>newWeapons(ctx,g,false));
     freeze.update(0);compare('destroy-compacted-'+z,()=>oldWeapons(ctx,g,false),()=>newWeapons(ctx,g,false));freeze.clear();
     // Snapped smoke rectangles straddling every edge, at young/old sizes.
     g.fire.clear();for(const life of [.75,.25])for(const x of [-4,-.49,0,c.viewW-.1,c.viewW+.49])for(const y of [-4,-.49,0,c.viewH-.1,c.viewH+.49]){
      g.fire.spawn(1,c.screenToWorldX(x),c.screenToWorldY(y),0,0,1,0);g.fire.life[g.fire.count-1]=life;
     }
     compare('smoke-edges-'+z,()=>oldFire.drawSmoke(ctx,c,g.fire),()=>newFire.drawSmoke(ctx,c,g.fire));g.fire.clear();
     const beam=(x1,y1,x2,y2)=>Object.assign(g.combat.rail.beams.acquire(),{x1:c.screenToWorldX(x1),y1:c.screenToWorldY(y1),x2:c.screenToWorldX(x2),y2:c.screenToWorldY(y2),life:1,maxLife:1});
     beam(-100,c.viewH/2,c.viewW+100,c.viewH/2);beam(c.viewW/2,-100,c.viewW/2,c.viewH+100);
     beam(-100,-100,c.viewW+100,c.viewH+100);beam(-10,-.1,c.viewW+10,-.1);beam(-100,-100,-50,-50);
     compare('rail-crossing-'+z,()=>oldWeapons(ctx,g,false),()=>newWeapons(ctx,g,false));g.combat.rail.clear();
     const visible=solid.find(i=>Math.abs(i%w.width*w.cellSize-c.x)<c.viewW/(2*z)&&Math.abs(Math.floor(i/w.width)*w.cellSize-c.y)<c.viewH/(2*z));
     if(visible===undefined)throw Error('No visible frost target');
     freeze.freezeCell(visible%w.width,Math.floor(visible/w.width),1,2);
     beam(-100,-100,-50,-50);g.combat.rail.beams.items.find(b=>b.active).life=.23;
     for(const reduced of [false,true])compare('offscreen-rail-frost-'+z+'-'+reduced,()=>oldWeapons(ctx,g,reduced),()=>newWeapons(ctx,g,reduced));
     g.combat.rail.clear();freeze.clear();
     const prism=(x1,y1,x2,y2)=>Object.assign(g.combat.laser.segments.acquire(),{x1:c.screenToWorldX(x1),y1:c.screenToWorldY(y1),x2:c.screenToWorldX(x2),y2:c.screenToWorldY(y2),band:2,life:.1,reflected:true});
     prism(-100,c.viewH/2,c.viewW+100,c.viewH/2);prism(-100,-20,-2,c.viewH/2);prism(-2000,-2000,-1900,-1900);
     for(const reduced of [false,true])compare('prism-crossing-marker-'+z+'-'+reduced,()=>oldWeapons(ctx,g,reduced),()=>newWeapons(ctx,g,reduced));
     g.combat.laser.clear();
    }
    // Mask invalidation follows rebuilt chunks, including budgeted publication.
    c.zoom=1.13;c.x=origin.x;c.y=origin.y;
    let masks=0;const lr=next.lightRenderer,draw=t.draw;
    t.draw=function(context,...args){if(context===lr.maskCtx)masks++;return draw.call(this,context,...args)};
    const render=()=>lr.renderLighting(ctx,g,devicePixelRatio);
    const flush=()=>{while(t.chunks.pending)t.update()};flush();lr.maskState=null;render();render();if(masks!==1)throw Error('Unchanged mask rebuilt');
    const target=solid.find(i=>w.health[i]>=6&&w.mat[i]===MAT.none&&!w.doorId[i]);
    if(target===undefined)throw Error('No damage target');const tx=target%w.width,ty=Math.floor(target/w.width);
    w.health[target]=Math.max(2,w.maxHealthAt(tx,ty));w.damage(tx,ty,1);flush();render();if(masks!==1)throw Error('Ordinary damage rebuilt mask');
    const checks=[['glass',()=>{w.mat[target]=MAT.glass;w.health[target]=Math.max(3,w.maxHealthAt(tx,ty));w.damage(tx,ty,1)}],['destruction',()=>w.damage(tx,ty,1000)],['growth',()=>w.setCell(tx,ty,10,'grown')],['pan',()=>c.x+=.1],['zoom',()=>c.zoom+=.01],['regeneration',()=>t.rebuildAll()],['resize',()=>c.viewW-=1]];
    for(const [label,change]of checks){const before=masks;change();flush();render();if(masks<=before)throw Error(label+' did not rebuild mask');fixedDraw(()=>old.draw());
      const aa=old.lightRenderer.maskCtx.getImageData(0,0,g.canvas.width,g.canvas.height).data;
      const bb=lr.maskCtx.getImageData(0,0,g.canvas.width,g.canvas.height).data;
      let channels=0,maxDelta=0;for(let i=3;i<aa.length;i+=4){const d=Math.abs(aa[i]-bb[i]);if(d){channels++;maxDelta=Math.max(maxDelta,d)}}
      pixels.push({label:'mask-alpha-'+label,channels,maxDelta});if(channels)throw Error('Mask alpha differs: '+label);
    }
    const invalidation={ordinaryDamageRebuilds:0,checks:checks.map(x=>x[0]),maskRebuilds:masks};t.draw=draw;
    // Undo the synthetic material and keep a durable opaque target for HP hits.
    w.mat[target]=MAT.none;w.blight[target]=0;w.health[target]=100;t.chunks.markCell(tx,ty);flush();
    c.viewW=innerWidth;c.viewH=innerHeight;
    window.__renderBench={g,c,w,t,freeze,old,next,origin,solid,target,tx,ty,raf,now,fixedDraw,compare,pixels,seedFreeze,flush};
    return{pixels,invalidation};
   },{baselineUrl});
   report.pixels.push(...checks.pixels.map(x=>({device:device.name,...x})));report.invalidation=checks.invalidation;
   for(const workload of (process.env.BREACH_CHECK_ONLY==='1'?[]:(process.env.BREACH_WORKLOADS||'freeze,lighting,smoke-rail,combined').split(',')))for(const dense of [false,true])for(const moving of [false,true])for(const zoom of [.5,1.13]){
    const result=await page.evaluate(async({workload,dense,moving,zoom,samples})=>{
     const h=window.__renderBench,{g,c,w,t,freeze,old,next,origin,solid,target,raf,now,fixedDraw,compare,seedFreeze,flush}=h;
     c.x=origin.x+.37;c.y=origin.y+.71;c.zoom=zoom;g.fire.clear();g.combat.rail.clear();freeze.clear();
     if(workload==='freeze'||workload==='combined')seedFreeze(dense);
     if(workload==='smoke-rail'||workload==='combined'){
      const n=dense?g.fire.cap:32;
      for(let i=0;i<n;i++){const sx=((i*97)% (c.viewW*5))-c.viewW*2,sy=((i*53)%(c.viewH*5))-c.viewH*2;g.fire.spawn(1,c.screenToWorldX(sx),c.screenToWorldY(sy),0,0,1,0);g.fire.life[g.fire.count-1]=.7}
      const count=dense?g.combat.rail.beams.items.length:4;
      for(let i=0;i<count;i++){const b=g.combat.rail.beams.acquire();const y=(i%4===0)?c.viewH*.5:-100-i*10;Object.assign(b,{x1:c.screenToWorldX(-100),y1:c.screenToWorldY(y),x2:c.screenToWorldX(c.viewW+100),y2:c.screenToWorldY(y),life:1,maxLife:1})}
     }
     // Lighting representative of the same frozen combat scene for both renderers.
     for(let i=0;i<50;i++)g.lighting.updateFixtures(c);
     const lights=Array.from({length:dense?20:1},(_,i)=>({x:origin.x+(i%5-2)*30,y:origin.y+(Math.floor(i/5)-2)*30,radius:100,strength:.5,warm:true}));
     g.lighting.updateSoftLights([],origin.x,origin.y,c,lights);
     const damageTargets=[target];
     if(dense)for(const i of solid){if(damageTargets.length>=16)break;if(i!==target&&!w.boundary[i]&&!w.doorId[i]&&w.mat[i]===0&&Math.abs(i%w.width*w.cellSize-origin.x)<c.viewW/(2*zoom)&&Math.abs(Math.floor(i/w.width)*w.cellSize-origin.y)<c.viewH/(2*zoom))damageTargets.push(i)}
     const move=i=>{c.x=origin.x+.37+(moving?Math.sin(i*.09)*60:0);c.y=origin.y+.71+(moving?Math.cos(i*.07)*40:0)};
     const damage=()=>{if(workload==='lighting'||workload==='combined'){for(const i of damageTargets){const x=i%w.width,y=Math.floor(i/w.width);w.health[i]=Math.max(2,w.maxHealthAt(x,y));w.damage(x,y,1)}flush()}};
     const draw=renderer=>fixedDraw(()=>renderer.draw());
     for(let i=0;i<5;i++){move(i);damage();draw(old);draw(next)}
     compare('frame-'+workload+'-'+dense+'-'+moving+'-'+zoom,()=>old.draw(),()=>next.draw());
     const data={baseline:{cpu:[],interval:[]},changed:{cpu:[],interval:[]}};
     // Alternate paired blocks to reduce warmup/order drift. Give each variant
     // its own consecutive rAF intervals; don't attribute old GPU work to new.
     const block=Math.ceil(samples/3);
     for(let round=0;round<3;round++)for(const which of (round%2?['changed','baseline']:['baseline','changed'])){
      const renderer=which==='baseline'?old:next;
      let previous=null;
      for(let j=-3;j<block;j++){
       const stamp=await new Promise(resolve=>raf(resolve));
       if(j>=0&&previous!==null)data[which].interval.push(stamp-previous);
       previous=stamp;move(j+3);const start=now();damage();draw(renderer);const elapsed=now()-start;
       if(j>=0)data[which].cpu.push(elapsed);
      }
     }
     const summarize=a=>{a.sort((x,y)=>x-y);const p=q=>a[Math.min(a.length-1,Math.ceil(q*a.length)-1)];return{n:a.length,p50:p(.5),p95:p(.95),p99:p(.99)}};
     return{workload,dense,moving,zoom,damageTargets:(workload==='lighting'||workload==='combined')?damageTargets.length:0,softLights:g.lighting.softCount,activeFrozen:freeze.activeFrozenCells,smoke:g.fire.count,beams:g.combat.rail.beams.activeCount,baseline:{cpu:summarize(data.baseline.cpu),interval:summarize(data.baseline.interval)},changed:{cpu:summarize(data.changed.cpu),interval:summarize(data.changed.interval)}};
    },{workload,dense,moving,zoom,samples:report.samples});
    report.scenarios.push({device:device.name,scale:device.scale,...result});
    fs.writeFileSync(destination,JSON.stringify(report,null,2));
    console.log(JSON.stringify({device:device.name,...result}));
   }
   // Include full-frame pixel checks generated by each workload above.
   const allPixels=await page.evaluate(()=>window.__renderBench.pixels);
   report.pixels=report.pixels.filter(x=>x.device!==device.name).concat(allPixels.map(x=>({device:device.name,...x})));
   assert.deepEqual(errors,[]);await context.close();
  }
  report.status='passed';fs.writeFileSync(destination,JSON.stringify(report,null,2));console.log(JSON.stringify({status:'passed',pixelChecks:report.pixels.length,scenarios:report.scenarios.length,report:destination}));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>fs.rmSync(baseline,{recursive:true,force:true}));
