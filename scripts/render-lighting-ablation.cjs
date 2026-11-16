/* Paired follow-up for fixture-heavy cases. Compare original lighting, cached
 * fixed paths, and the same optimized pipeline with dynamic path submission. */
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
let pw;try{pw=require('playwright')}catch{pw=require('/opt/codex/cua_node/lib/node_modules/playwright')}
const root=path.resolve(__dirname,'..');fs.mkdirSync(path.join(root,'node_modules/.cache'),{recursive:true});const dir=fs.mkdtempSync(path.join(root,'node_modules/.cache/lighting-ablation-'));
execFileSync('tar',['-x','-C',dir],{input:execFileSync('git',['archive',process.env.BREACH_BASELINE_REF||'4bb50da','src'],{cwd:root,maxBuffer:32*1024*1024})});
(async()=>{const browser=await pw.chromium.launch({executablePath:process.env.BREACH_CHROMIUM||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});try{
const page=await browser.newPage({viewport:{width:1440,height:900}});await page.goto(process.env.BREACH_BASE_URL||'http://127.0.0.1:5173');await page.locator('[data-act="play"]').click();
const result=await page.evaluate(async base=>{
 const g=window.__game,raf=requestAnimationFrame.bind(window);window.requestAnimationFrame=()=>0;g.paused=true;await new Promise(r=>raf(()=>raf(r)));
 const {LightRenderer}=await import(base+'/src/rendering/LightRenderer.ts'),next=g.renderer.lightRenderer,old=new LightRenderer(g.renderer.sprites),clock=performance.now.bind(performance),results=[];
 g.save.data.seed='AUDIT01';g.save.data.settings.devMode=true;g.save.data.settings.softShadows=true;
 for(const spec of [{world:1,zoom:.5,spawn:false},{world:2,zoom:1.13,spawn:true},{world:2,zoom:4,spawn:false}]){
  g.save.data.settings.devMapAccess=true;g.selectLabWorld(spec.world);g.generateLab();g.terrain.rebuildAll();
  const c=g.camera;c.x=spec.spawn?g.world.roomCenterX:g.world.worldWidth/2;c.y=spec.spawn?g.world.roomCenterY:g.world.worldHeight/2;c.zoom=spec.zoom;
  g.save.data.settings.devMapAccess=false;g.soldiers.length=0;g.flashes.length=0;g.fire.clear();g.updateFlashPolygons();for(let i=0;i<100;i++)g.lighting.updateFixtures(c);
  const draw=mode=>{g.renderer.lightRenderer=mode==='original'?old:next;if(mode==='dynamic')next.fixtureView=null;const prior=performance.now;performance.now=()=>123456;try{g.renderer.draw()}finally{performance.now=prior}};
  for(let i=0;i<5;i++)for(const mode of ['original','cached','dynamic'])draw(mode);
  const samples={original:[],cached:[],dynamic:[]};
  for(let round=0;round<3;round++)for(const mode of (round%2?['dynamic','cached','original']:['original','cached','dynamic']))for(let i=-2;i<15;i++){
   await new Promise(r=>raf(r));const start=clock();draw(mode);if(i>=0)samples[mode].push(clock()-start);
  }
  const stats={};for(const [mode,a]of Object.entries(samples)){a.sort((a,b)=>a-b);stats[mode]={n:a.length,p50:a[Math.ceil(a.length*.5)-1],p95:a[Math.ceil(a.length*.95)-1],p99:a.at(-1)}}
  results.push({...spec,stats});
 }
 g.renderer.lightRenderer=next;return{status:'passed',results};
},'/'+path.relative(root,dir).split(path.sep).join('/'));
fs.writeFileSync('/tmp/breach-lighting-ablation.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>fs.rmSync(dir,{recursive:true,force:true}));
