/* Exact old/new trace oracle. Vite required; BREACH_BASELINE_REF/BREACH_REPORT optional. */
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
let pw;try{pw=require('playwright')}catch{pw=require('/opt/codex/cua_node/lib/node_modules/playwright')}
const root=path.resolve(__dirname,'..');
const ref=cp.execFileSync('git',['rev-parse',process.env.BREACH_BASELINE_REF||'HEAD'],{cwd:root,encoding:'utf8'}).trim();
const dir=fs.mkdtempSync(path.join(root,'node_modules/.cache/shadow-ray-check-'));
cp.execFileSync('tar',['-x','-C',dir],{input:cp.execFileSync('git',['archive',ref,'src'],{cwd:root,maxBuffer:32e6})});
(async()=>{
 const browser=await pw.chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
 try{
  const page=await browser.newPage();await page.goto('http://localhost:5173');
  const result=await page.evaluate(async url=>{
   const [{LightingSystem:Old},{LightingSystem:Next,makeLitCells},{PixelWorld},{Soldier},{generateWorld},{LIGHT}]=await Promise.all([
    import(url+'/src/systems/LightingSystem.ts'),import('/src/systems/LightingSystem.ts'),import('/src/world/PixelWorld.ts'),
    import('/src/entities/Soldier.ts'),import('/src/world/WorldGenerator.ts'),import('/src/config.ts'),
   ]);
   const w=new PixelWorld({width:40,height:40,cellSize:8,roomSize:4});
   const old=new Old(w),next=new Next(w),a=new Float32Array(LIGHT.maxRays*2),b=new Float32Array(a.length),al=makeLitCells(),bl=makeLitCells();
   let comparisons=0,nonempty=0,fallbackOccluders=0;
   const check=(x,y,dx,dy,radius,owner,soldiers)=>{
    const an=old.computeVisibilityPolygon(x,y,dx,dy,radius,owner,soldiers,a,al);
    const bn=next.computeVisibilityPolygon(x,y,dx,dy,radius,owner,soldiers,b,bl);
    comparisons++;if(an)nonempty++;
    if(an!==bn||al.count!==bl.count)throw Error('Trace counts differ at '+comparisons);
    for(let i=0;i<an*2;i++)if(a[i]!==b[i])throw Error('Polygon differs at '+comparisons+' vertex channel '+i);
    for(let i=0;i<al.count;i++)if(al.cells[i]!==bl.cells[i])throw Error('Lit cells differ at '+comparisons);
   };
   for(let phase=0;phase<32;phase++){
    if(phase===16)generateWorld(w,73);
    // Half-size obstacles and openings change throughout the sequence.
    for(let i=0;i<12;i++)w.setSubCell(12+(phase*7+i*3)%48,12+(phase+i*7)%48,(phase+i)%3?10:0,(phase+i)%3?'grown':'destroyed');
    for(let cy=18;cy<=21;cy++)for(let cx=18;cx<=21;cx++)w.setCell(cx,cy,0);
    const soldiers=[];
    for(let i=0;i<16;i++){
     const angle=(phase%4===0?Math.PI:phase*.137)+i*Math.PI/8;
     const distance=i<8?4.01:12+i*3;
     const s=new Soldier(160.37+Math.cos(angle)*distance,160.71+Math.sin(angle)*distance,1,0,100,'pistol');
     s.slotIndex=(i+phase)%8;s.facingAngle=phase*.23+i*.17;
     if(i===15&&phase%2)s.alive=false;
     soldiers.push(s);
    }
    const angle=phase*Math.PI/16;
    for(const quality of ['low','medium','high']){
     old.quality=next.quality=quality;
     check(160.37,160.71,Math.cos(angle),Math.sin(angle),85,-1,soldiers);
     check(160.37,160.71,-1,0,phase%2?1:85,soldiers[phase%16].id,soldiers);
    }
   }
   // More occluders than silhouette rays fit: later occluders must still run
   // exact tests with the full-span fallback, including reused pooled entries.
   w.health.fill(0);w.subHealth.fill(0);
   const crowd=Array.from({length:600},(_,i)=>{
    const angle=i*Math.PI*2/600;
    const s=new Soldier(160+Math.cos(angle)*35,160+Math.sin(angle)*35,1,0,100,'pistol');
    s.slotIndex=i%8;s.facingAngle=angle;return s;
   });
   old.quality=next.quality='high';
   check(160,160,1,0,90,-1,crowd);
   fallbackOccluders=next.occluders.slice(0,600).filter(o=>o.minAngle===-Math.PI&&o.maxAngle===Math.PI).length;
   if(!fallbackOccluders)throw Error('Ray-budget fallback was not exercised');
   check(160,160,-1,0,90,-1,crowd.slice(0,8));
   // Wall-backed origins are moved before any angular bounds are calculated.
   w.setCell(20,20,50);check(160.37,160.71,1,0,90,-1,crowd.slice(0,8));
   return {baseline:url,comparisons,nonempty,fallbackOccluders,changedPolygonChannels:0,changedLitCells:0};
  },'/'+path.relative(root,dir));
  result.baseline=ref;
  fs.writeFileSync(process.env.BREACH_REPORT||'/tmp/shadow-ray-regressions.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{await browser.close();fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
