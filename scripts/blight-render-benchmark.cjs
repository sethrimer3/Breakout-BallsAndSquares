/* Vite required. Compare HEAD terrain rendering with this working tree under growth. */
const fs=require('node:fs'),cp=require('node:child_process'),path=require('node:path');
let pw;try{pw=require('playwright')}catch{pw=require('/opt/codex/cua_node/lib/node_modules/playwright')}
const root=path.resolve(__dirname,'..'),ref=process.env.BREACH_BASELINE_REF||'HEAD';
const dir=fs.mkdtempSync(path.join(root,'node_modules/.cache/blight-bench-'));
cp.execFileSync('tar',['-x','-C',dir],{input:cp.execFileSync('git',['archive',ref,'src'],{cwd:root,maxBuffer:32e6})});
(async()=>{const b=await pw.chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});const results=[];
try{for(const device of [{name:'desktop',width:1200,height:800,scale:1,cpu:1},{name:'mobile',width:390,height:844,scale:2,cpu:4}]){
device.dormant=process.env.BREACH_DORMANT==='1';
const context=await b.newContext({viewport:{width:device.width,height:device.height},deviceScaleFactor:device.scale}),p=await context.newPage();
const cdp=await context.newCDPSession(p);await cdp.send('Emulation.setCPUThrottlingRate',{rate:device.cpu});
await p.goto('http://localhost:5173');
const rows=await p.evaluate(async({url,device})=>{
const [{TerrainRenderer:Old},{TerrainRenderer:Next},{PixelWorld},{CameraSystem}]=await Promise.all([import(url+'/src/rendering/TerrainRenderer.ts'),import('/src/rendering/TerrainRenderer.ts'),import('/src/world/PixelWorld.ts'),import('/src/systems/CameraSystem.ts')]);
const rows=[];const pct=a=>{a.sort((a,b)=>a-b);return{p50:a[Math.floor(a.length*.5)],p95:a[Math.floor(a.length*.95)],p99:a[Math.floor(a.length*.99)]}};
for(const zoom of [.5,1.13])for(const moving of [false,true])for(const growth of ['visible','offscreen']){
const w=new PixelWorld({width:256,height:256,cellSize:8,roomSize:10});
for(let y=40;y<110;y++)for(let x=40;x<110;x++)if((x+y)%4!==0)w.setCell(x,y,10,'grown',true);
const a=new Old(w,16),b=new Next(w,16),cam=new CameraSystem(w);
if(device.dormant)a.dormantAt=b.dormantAt=si=>si%7===0;
cam.viewW=device.width;cam.viewH=device.height;cam.zoom=zoom;cam.x=600;cam.y=600;
const canvases=[a,b].map(()=>{const c=document.createElement('canvas');c.width=device.width*device.scale;c.height=device.height*device.scale;return c}),times=[[],[]],paints=[0,0];
[a,b].forEach((r,j)=>{const f=r.paintEdgeFire;r.paintEdgeFire=function(...args){paints[j]++;return f.apply(this,args)};while(r.chunks.pending)r.update()});
let maxDelta=0,channels=0,alphaChanges=0;
for(let frame=0;frame<65;frame++){
for(let i=0;i<12;i++){const x=(growth==='visible'?55:200)+(frame*7+i)%20,y=(growth==='visible'?55:200)+((frame+i*3)%20);w.setCell(x,y,(frame+i)%3?10:0,(frame+i)%3?'grown':'destroyed')}
cam.x=600+(moving?frame*1.3:0);const clock=frame/60;
for(const j of frame%2?[1,0]:[0,1]){
 const r=[a,b][j],ctx=canvases[j].getContext('2d'),t=performance.now();
 while(r.chunks.pending)r.update();
 ctx.setTransform(device.scale,0,0,device.scale,0,0);ctx.clearRect(0,0,cam.viewW,cam.viewH);r.draw(ctx,cam,false);r.drawBlightThroughFog(ctx,cam);r.drawBlightEdges(ctx,cam,clock);
 if(frame>=15)times[j].push(performance.now()-t);
}
if(frame===20||frame===21||frame===64){const aa=canvases[0].getContext('2d').getImageData(0,0,canvases[0].width,canvases[0].height).data,bb=canvases[1].getContext('2d').getImageData(0,0,canvases[1].width,canvases[1].height).data;
 for(let i=0;i<aa.length;i++){const delta=Math.abs(aa[i]-bb[i]);if(delta){channels++;if(i%4===3)alphaChanges++;maxDelta=Math.max(delta,maxDelta)}}}
}
const measuredPaints=paints.slice();
// Exercise half-size pixels, dormancy, removal and regeneration at a fixed clock.
for(let phase=0;phase<4;phase++){
 if(phase===0){w.setCell(75,75,0);w.setSubCell(150,150,12);w.setSubCell(151,151,8)}
 if(phase===1){a.dormantAt=b.dormantAt=()=>true}
 if(phase===2){w.health.fill(0);w.subHealth.fill(0);w.blight.fill(0)}
 if(phase===3){a.dormantAt=b.dormantAt=null;w.setCell(90,80,20,'grown');cam.x=740;cam.y=640}
 for(const j of [0,1]){
  const r=[a,b][j],ctx=canvases[j].getContext('2d');r.chunks.markAll();while(r.chunks.pending)r.update();
  ctx.setTransform(device.scale,0,0,device.scale,0,0);ctx.clearRect(0,0,cam.viewW,cam.viewH);r.draw(ctx,cam,false);r.drawBlightThroughFog(ctx,cam);r.drawBlightEdges(ctx,cam,2);
 }
 const aa=canvases[0].getContext('2d').getImageData(0,0,canvases[0].width,canvases[0].height).data,bb=canvases[1].getContext('2d').getImageData(0,0,canvases[1].width,canvases[1].height).data;
 for(let i=0;i<aa.length;i++){const delta=Math.abs(aa[i]-bb[i]);if(delta){channels++;if(i%4===3)alphaChanges++;maxDelta=Math.max(delta,maxDelta)}}
}
rows.push({zoom,moving,growth,baseline:pct(times[0]),updated:pct(times[1]),paints:measuredPaints,changedChannels:channels,alphaChanges,maxDelta});
}
return rows;
},{url:'/'+path.relative(root,dir),device});
for(const r of rows){if(r.alphaChanges || (r.changedChannels&&!process.env.BREACH_ALLOW_PHASE_DIFF))throw Error('Pixel mismatch '+JSON.stringify(r));results.push({device,...r})}
await context.close()}
fs.writeFileSync(process.env.BREACH_REPORT||'/tmp/blight-render-benchmark.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));
}finally{await b.close();fs.rmSync(dir,{recursive:true,force:true})}})().catch(e=>{console.error(e);process.exitCode=1});
