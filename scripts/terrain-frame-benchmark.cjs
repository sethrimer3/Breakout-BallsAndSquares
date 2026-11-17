/* Paired whole render-frame timings under Blight edits. Simulation/shadow preparation
 * is shared outside timings. No physical-device or GPU/FPS claim. Vite required. */
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
let pw;try{pw=require('playwright')}catch{pw=require('/opt/codex/cua_node/lib/node_modules/playwright')}
const root=path.resolve(__dirname,'..');
const ref=cp.execFileSync('git',['rev-parse',process.env.BREACH_BASELINE_REF||'HEAD'],{cwd:root,encoding:'utf8'}).trim();
const dir=fs.mkdtempSync(path.join(root,'node_modules/.cache/terrain-frames-'));
cp.execFileSync('tar',['-x','-C',dir],{input:cp.execFileSync('git',['archive',ref,'src'],{cwd:root,maxBuffer:32e6})});
const report={baseline:ref,rows:[]};
(async()=>{
 const browser=await pw.chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
 try{
  for(const device of [{name:'desktop',width:1200,height:800,scale:1,cpu:1},{name:'mobile',width:390,height:844,scale:2,cpu:4}]){
   const context=await browser.newContext({viewport:{width:device.width,height:device.height},deviceScaleFactor:device.scale});
   const page=await context.newPage();
   await page.addInitScript(()=>{let seed=427;Math.random=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296)});
   await(await context.newCDPSession(page)).send('Emulation.setCPUThrottlingRate',{rate:device.cpu});
   await page.goto('http://localhost:5173');await page.locator('[data-act="play"]').click();
   await page.evaluate(async url=>{
    const g=window.__game,raf=requestAnimationFrame.bind(window);window.requestAnimationFrame=()=>0;g.paused=true;await new Promise(r=>raf(()=>raf(r)));
    const [{TerrainRenderer:Old},{TerrainRenderer:Next},{Renderer},{Soldier}]=await Promise.all([import(url+'/src/rendering/TerrainRenderer.ts'),import('/src/rendering/TerrainRenderer.ts'),import('/src/rendering/Renderer.ts'),import('/src/entities/Soldier.ts')]);
    const w=g.world,c=g.camera,x=w.roomX0+64,y=w.roomY0+64;
    // A dense patch of genuine half-size Blight cells, then varying edit rates.
    for(let cy=y-20;cy<y+20;cy++)for(let cx=x-20;cx<x+20;cx++){
     w.setCell(cx,cy,0,'destroyed');for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++)w.setSubCell(cx*2+dx,cy*2+dy,10);
    }
    const terrains=[new Old(w,32),new Next(w,32)];for(const t of terrains){t.dormantAt=g.terrain.dormantAt;t.rebuildAll();}
    g.save.data.settings.renderQuality='high';g.save.data.settings.softShadows=true;g.renderer.resize();
    const canvas=document.createElement('canvas'),old=new Renderer(canvas,g);old.resize();
    c.following=false;c.x=x*w.cellSize;c.y=y*w.cellSize;
    window.__terrainFrame={g,w,c,x,y,raf,Soldier,terrains,renderers:[old,g.renderer],clock:performance.now.bind(performance)};
   },'/'+path.relative(root,dir));
   for(const dense of [false,true])for(const moving of [false,true])for(const zoom of [.5,1.13]){
    const row=await page.evaluate(async({dense,moving,zoom})=>{
     const {g,w,c,x,y,raf,Soldier,terrains,renderers,clock}=window.__terrainFrame;
     g.soldiers.length=0;g.flashes.length=0;g.fire.clear();g.particles.clear();g.combat.bullets.clear();
     for(let i=0;i<(dense?20:1);i++){
      const s=new Soldier((x+(i%5-2)*2)*w.cellSize,(y+(Math.floor(i/5)-2)*2)*w.cellSize,1,0,100,'pistol');g.soldiers.push(s);g.onShot(s,1,0,s.x,s.y);
     }
     if(dense)for(let i=0;i<200;i++){g.fire.spawn(1,(x+(i%20-10)*2)*w.cellSize,(y+(Math.floor(i/20)-5)*2)*w.cellSize,0,0,1,0);g.fire.life[g.fire.count-1]=.6}
     c.zoom=zoom;for(let i=0;i<40;i++)g.lighting.updateFixtures(c);
     const times=[[],[]];let changedChannels=0,maxDelta=0;
     for(let frame=0;frame<38;frame++){
      await new Promise(r=>raf(r));
      c.x=x*w.cellSize+(moving?Math.sin(frame*.11)*45:0)+.37;c.y=y*w.cellSize+(moving?Math.cos(frame*.09)*35:0)+.71;
      for(let j=0;j<(dense?32:1);j++){
       const sx=(x-8)*2+(frame*7+j*3)%32,sy=(y-8)*2+(frame+j*7)%32;
       w.setSubCell(sx,sy,(frame+j)%3?10:0,(frame+j)%3?'grown':'destroyed');
      }
      g.updateFlashPolygons();
      for(const j of frame%2?[1,0]:[0,1]){
       g.terrain=terrains[j];performance.now=()=>123456+frame*1000/60;
       const start=clock();while(g.terrain.chunks.pending)g.terrain.update();renderers[j].draw();
       if(frame>=8)times[j].push(clock()-start);performance.now=clock;
      }
      if(frame===17||frame===37){
       const aa=renderers[0].canvas.getContext('2d').getImageData(0,0,g.canvas.width,g.canvas.height).data;
       const bb=renderers[1].canvas.getContext('2d').getImageData(0,0,g.canvas.width,g.canvas.height).data;
       for(let i=0;i<aa.length;i++)if(aa[i]!==bb[i]){changedChannels++;maxDelta=Math.max(maxDelta,Math.abs(aa[i]-bb[i]));}
      }
     }
     const pct=a=>{a.sort((a,b)=>a-b);return{p50:a[Math.floor(a.length*.5)],p95:a[Math.floor(a.length*.95)],p99:a.at(-1)}};
     return{dense,moving,zoom,editsPerFrame:dense?32:1,baseline:pct(times[0]),updated:pct(times[1]),changedChannels,maxDelta};
    },{dense,moving,zoom});
    if(row.changedChannels)throw Error('Pixel mismatch '+JSON.stringify(row));
    report.rows.push({device,...row});console.log(JSON.stringify({device:device.name,...row}));
   }
   await context.close();
  }
  fs.writeFileSync(process.env.BREACH_REPORT||'/tmp/terrain-frame-benchmark.json',JSON.stringify(report,null,2));
 }finally{await browser.close();fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
