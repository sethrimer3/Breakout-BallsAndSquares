/* Pixel oracle: original full-screen lighting/fixture traversal versus the
 * optimized pipeline. Requires Vite. Baseline is the completed items 1–3. */
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
let pw;try{pw=require('playwright')}catch{pw=require('/opt/codex/cua_node/lib/node_modules/playwright')}
const root=path.resolve(__dirname,'..'),ref=process.env.BREACH_BASELINE_REF||'4bb50da';
fs.mkdirSync(path.join(root,'node_modules/.cache'),{recursive:true});
const dir=fs.mkdtempSync(path.join(root,'node_modules/.cache/lighting-oracle-'));
execFileSync('tar',['-x','-C',dir],{input:execFileSync('git',['archive',ref,'src'],{cwd:root,maxBuffer:32*1024*1024})});
(async()=>{const browser=await pw.chromium.launch({executablePath:process.env.BREACH_CHROMIUM||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});try{
 const page=await browser.newPage({viewport:{width:1000,height:700}});
 await page.goto(process.env.BREACH_BASE_URL||'http://127.0.0.1:5173');await page.locator('[data-act="play"]').click();
 const result=await page.evaluate(async({base})=>{
  const g=window.__game,raf=requestAnimationFrame.bind(window);window.requestAnimationFrame=()=>0;g.paused=true;await new Promise(r=>raf(()=>raf(r)));
  const [{LightRenderer},{TerrainRenderer}]=await Promise.all([import(base+'/src/rendering/LightRenderer.ts'),import(base+'/src/rendering/TerrainRenderer.ts')]);
  const reference=new LightRenderer(g.renderer.sprites),current=g.renderer.lightRenderer;
  const terrain=g.terrain,oldTerrain=new TerrainRenderer(g.world,32),c=g.camera,w=g.world;oldTerrain.dormantAt=terrain.dormantAt;
  const a=document.createElement('canvas'),b=document.createElement('canvas'),ac=a.getContext('2d'),bc=b.getContext('2d');
  const clock=performance.now.bind(performance);performance.now=()=>123456;
  const comparisons=[];let regionCases=0;
  function compare(label,dpr){
   function draw(t,lr,canvas,ctx){g.terrain=t;ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';ctx.fillStyle='#34495e';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.setTransform(dpr,0,0,dpr,0,0);t.drawFloor(ctx,c);t.draw(ctx,c);lr.renderLighting(ctx,g,dpr);t.drawPanels(ctx,c,123.456)}
   // The original lightmap leaves nearest-neighbor sampling enabled after its
   // first wall pass. Equalize this pre-existing first-frame context state.
   if (!comparisons.length) { draw(oldTerrain,reference,a,ac);draw(terrain,current,b,bc); }
   draw(oldTerrain,reference,a,ac);draw(terrain,current,b,bc);
   const aa=ac.getImageData(0,0,a.width,a.height).data,bb=bc.getImageData(0,0,b.width,b.height).data;
   let channels=0,maxDelta=0;for(let i=0;i<aa.length;i++){const d=Math.abs(aa[i]-bb[i]);if(d){channels++;maxDelta=Math.max(maxDelta,d)}}
   comparisons.push({label,dpr,channels,maxDelta});
   const r=current.previousLayerRegion;if(r&&r.width*r.height<a.width*a.height)regionCases++;
   if(channels){const diff=(x,y,alpha=false)=>{const xx=x.getContext('2d').getImageData(0,0,x.width,x.height).data,yy=y.getContext('2d').getImageData(0,0,y.width,y.height).data;let n=0;for(let i=alpha?3:0;i<xx.length;i+=alpha?4:1)if(xx[i]!==yy[i])n++;return n};throw Error(JSON.stringify({...comparisons.at(-1),maskAlpha:diff(reference.maskCanvas,current.maskCanvas,true),lightmap:diff(reference.lmCanvas,current.lmCanvas),air:diff(reference.layerCanvas,current.layerCanvas)}))}
  }
  const resize=(width,height,dpr)=>{c.viewW=width;c.viewH=height;a.width=b.width=Math.round(width*dpr);a.height=b.height=Math.round(height*dpr)};
  try{
   for(const world of [1,2,3,4,5]){
    g.save.data.settings.devMode=true;g.save.data.settings.devMapAccess=true;g.save.data.lab.world=world;g.loadLabProgress();g.generateLab();terrain.rebuildAll();oldTerrain.rebuildAll();
    g.soldiers.length=0;g.flashes.length=0;g.fire.clear();c.following=false;
    for(const dpr of [1,1.25,2])for(const zoom of [.5,1.13,3.71])for(const moving of [false,true])for(const soft of [false,true]){
     resize(dpr===2?390:1000,dpr===2?844:700,dpr);c.zoom=zoom;c.x=w.worldWidth/2+(moving?17.37:0);c.y=w.worldHeight/2+(moving?29.71:0);
     g.save.data.settings.softShadows=soft;g.updateFlashPolygons();for(let i=0;i<100;i++)g.lighting.updateFixtures(c);
     compare('world-'+world+'-'+zoom+'-'+moving+'-'+soft,dpr);
    }
    // Destruction and retracing replace polygon identities. Ordered queries must
    // include neighboring halos and preserve recess overlap after regeneration.
    const light=w.roomLights.find(l=>l.wallFace&&!l.destroyed);
    if(light){resize(1000,700,1.25);c.zoom=1.13;c.x=light.x0*w.cellSize;c.y=light.y0*w.cellSize;
     w.damage(light.x0,light.y0,1e9);while(terrain.chunks.pending)terrain.update();while(oldTerrain.chunks.pending)oldTerrain.update();
     for(let i=0;i<100;i++)g.lighting.updateFixtures(c);compare('destroyed-fixture-'+world,1.25);
    }
   }
   // Isolate air sources to force the bounded path, including old-light removal,
   // blur padding, overlapping lights, offscreen halos, scatter, and resizing.
   w.roomLights=[];g.lighting.fixtures=[];g.flashes.length=0;
   for(const dpr of [1,1.25,2])for(const soft of [false,true]){
    resize(1001,703,dpr);c.x=w.roomCenterX;c.y=w.roomCenterY;c.zoom=1.13;g.save.data.settings.softShadows=soft;
    const source=(x,y,r=50)=>({x:c.screenToWorldX(x),y:c.screenToWorldY(y),radius:r/c.zoom,strength:.6,warm:true});
    const states=[[source(100,150)],[source(120,160),source(140,180)],[],[source(-20,300)],[source(1000,500)],[source(400,300,1000)],[],[source(800,650)]];
    for(let i=0;i<states.length;i++){
     g.lighting.updateSoftLights([],c.screenToWorldX(-2000),c.screenToWorldY(-2000),c,states[i]);
     compare('bounded-'+soft+'-'+i,dpr);
    }
    const x=c.screenToWorldX(220),y=c.screenToWorldY(200),r=70/c.zoom;
    g.flashes.push({x,y,dx:1,dy:0,life:1,maxLife:1,radius:r,ownerId:1,
      poly:new Float32Array([x-r,y-r,x+r,y-r,x+r,y+r,x-r,y+r]),polyCount:4,hasPolygon:true,
      lit:{cells:new Uint32Array(0),count:0}});
    compare('bounded-scatter-'+soft,dpr);g.flashes.length=0;compare('removed-scatter-'+soft,dpr);
    resize(777,555,dpr);g.lighting.updateSoftLights([],c.screenToWorldX(-2000),c.screenToWorldY(-2000),c,[source(100,100)]);compare('resize-bounded-'+soft,dpr);
   }
   // The original listener paints immediately; the optimized one must produce
   // the same final floor pixels after a burst, including tile boundaries.
   resize(1000,700,1.25);c.zoom=1.13;c.x=(w.roomX0+12)*w.cellSize;c.y=(w.roomY0+12)*w.cellSize;
   for(const events of [1,10,100,1000]){
    for(let i=0;i<events;i++)w.setCell(w.roomX0+i%24,w.roomY0+Math.floor(i/24)%24,i%2?10:0);
    compare('floor-burst-'+events,1.25);
   }
   return{status:'passed',comparisons,regionCases};
  }finally{g.terrain=terrain;performance.now=clock}
 },{base:'/'+path.relative(root,dir).split(path.sep).join('/')});
 fs.writeFileSync(process.env.BREACH_LIGHT_REPORT||'/tmp/breach-lighting-pixels.json',JSON.stringify(result,null,2));console.log(JSON.stringify({status:result.status,pixelComparisons:result.comparisons.length,boundedCases:result.regionCases}));
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>fs.rmSync(dir,{recursive:true,force:true}));
