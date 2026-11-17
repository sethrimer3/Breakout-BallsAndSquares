/* Isolated wall-marking CPU benchmark on actual traced light polygons. Vite required. */
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
let pw;try{pw=require('playwright')}catch{pw=require('/opt/codex/cua_node/lib/node_modules/playwright')}
const root=path.resolve(__dirname,'..');
const ref=cp.execFileSync('git',['rev-parse',process.env.BREACH_BASELINE_REF||'HEAD'],{cwd:root,encoding:'utf8'}).trim();
const dir=fs.mkdtempSync(path.join(root,'node_modules/.cache/wall-marking-'));
cp.execFileSync('tar',['-x','-C',dir],{input:cp.execFileSync('git',['archive',ref,'src'],{cwd:root,maxBuffer:32e6})});
(async()=>{
 const browser=await pw.chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});const report={baseline:ref,rows:[]};
 try{
  for(const cpu of [1,4]){
   const context=await browser.newContext(),page=await context.newPage();await(await context.newCDPSession(page)).send('Emulation.setCPUThrottlingRate',{rate:cpu});
   await page.goto('http://localhost:5173');
   const rows=await page.evaluate(async url=>{
    const [{LightingSystem:Old},{LightingSystem:Next,makeLitCells},{PixelWorld},{Soldier},{LIGHT}]=await Promise.all([
     import(url+'/src/systems/LightingSystem.ts'),import('/src/systems/LightingSystem.ts'),import('/src/world/PixelWorld.ts'),import('/src/entities/Soldier.ts'),import('/src/config.ts'),
    ]);
    const rows=[],pct=a=>{a.sort((a,b)=>a-b);return{p50:a[Math.floor(a.length*.5)],p95:a[Math.floor(a.length*.95)],p99:a.at(-1)}};
    for(const dense of [false,true]){
     const w=new PixelWorld({width:64,height:64,cellSize:8,roomSize:4});
     for(let y=12;y<52;y++)for(let x=12;x<52;x++)if(Math.abs(x-32)>=8||Math.abs(y-32)>=8)for(let k=0;k<4;k++)if((x+y+k)%3)w.setSubCell(x*2+(k&1),y*2+(k>>1),10);
     const soldiers=Array.from({length:dense?20:1},(_,i)=>{const s=new Soldier(256+(i%5-2)*16,256+(Math.floor(i/5)-2)*16,1,0,100);s.slotIndex=i%8;return s});
     const systems=[new Old(w),new Next(w)],lit=[makeLitCells(),makeLitCells()],polygons=[];
     for(const s of soldiers)for(const radius of [64,122]){
      const poly=new Float32Array(LIGHT.maxRays*2),n=systems[0].computeVisibilityPolygon(s.x,s.y,1,0,radius,s.id,soldiers,poly);
      if(!n)throw Error('Empty source polygon');polygons.push({x:s.x,y:s.y,poly,n});
     }
     const run=j=>{for(const p of polygons){lit[j].count=0;systems[j].markLitCells(p.x,p.y,p.poly,p.n,lit[j]);}};
     for(let i=0;i<20;i++){run(0);run(1);}
     const times=[[],[]];
     for(let frame=0;frame<60;frame++)for(const j of frame%2?[1,0]:[0,1]){const t=performance.now();run(j);times[j].push(performance.now()-t);}
     for(const p of polygons){
      for(const j of [0,1]){lit[j].count=0;systems[j].markLitCells(p.x,p.y,p.poly,p.n,lit[j]);}
      if(lit[0].count!==lit[1].count)throw Error('Different lit-cell count');
      for(let i=0;i<lit[0].count;i++)if(lit[0].cells[i]!==lit[1].cells[i])throw Error('Different lit-cell order');
     }
     rows.push({dense,lightsPerBatch:polygons.length,samples:60,baseline:pct(times[0]),updated:pct(times[1]),listComparisons:polygons.length,changedCells:0});
    }
    return rows;
   },'/'+path.relative(root,dir));
   report.rows.push(...rows.map(r=>({cpu,...r})));await context.close();
  }
  fs.writeFileSync(process.env.BREACH_REPORT||'/tmp/wall-marking-component.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await browser.close();fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
