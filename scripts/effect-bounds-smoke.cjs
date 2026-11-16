/* Oracle for previously clipped effects: remove only center-based viewport
 * rejection from the baseline and compare the complete draw with current code. */
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
let pw;try{pw=require('playwright')}catch{pw=require('/opt/codex/cua_node/lib/node_modules/playwright')}
const root=path.resolve(__dirname,'..');fs.mkdirSync(path.join(root,'node_modules/.cache'),{recursive:true});const dir=fs.mkdtempSync(path.join(root,'node_modules/.cache/effect-oracle-'));
execFileSync('tar',['-x','-C',dir],{input:execFileSync('git',['archive',process.env.BREACH_BASELINE_REF||'4bb50da','src'],{cwd:root,maxBuffer:32*1024*1024})});
for(const file of ['Renderer.ts','GooRenderer.ts']){const target=path.join(dir,'src/rendering',file);const text=fs.readFileSync(target,'utf8').split('\n').filter(line=>!(/if \(sx < -(20|30|40) \|\| sy/.test(line)||line.includes('if (x < -32 || y < -32'))).join('\n');fs.writeFileSync(target,text)}
(async()=>{const browser=await pw.chromium.launch({executablePath:process.env.BREACH_CHROMIUM||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});try{
const page=await browser.newPage();await page.goto(process.env.BREACH_BASE_URL||'http://127.0.0.1:5173');await page.locator('[data-act="play"]').click();
const result=await page.evaluate(async base=>{
 const g=window.__game,raf=requestAnimationFrame.bind(window);window.requestAnimationFrame=()=>0;g.paused=true;await new Promise(r=>raf(()=>raf(r)));
 const [{Renderer:OldRenderer},{Renderer},{drawGoo:oldGoo},{drawGoo}]=await Promise.all([import(base+'/src/rendering/Renderer.ts'),import('/src/rendering/Renderer.ts'),import(base+'/src/rendering/GooRenderer.ts'),import('/src/rendering/GooRenderer.ts')]);
 const a=document.createElement('canvas'),b=document.createElement('canvas'),old=new OldRenderer(a,g),next=new Renderer(b,g),ac=a.getContext('2d'),bc=b.getContext('2d'),c=g.camera;
 c.viewW=400;c.viewH=300;const comparisons=[];const random=Math.random;
 function compare(label,dpr,drawOld,drawNext,expectVisible=false){
  const draw=(ctx,fn)=>{ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';ctx.fillStyle='#000';ctx.fillRect(0,0,a.width,a.height);ctx.setTransform(dpr,0,0,dpr,0,0);let state=123;Math.random=()=>((state=Math.imul(state,1664525)+1013904223>>>0)/4294967296);try{fn()}finally{Math.random=random}};
  draw(ac,drawOld);draw(bc,drawNext);const aa=ac.getImageData(0,0,a.width,a.height).data,bb=bc.getImageData(0,0,b.width,b.height).data;
  let channels=0,visible=0;for(let i=0;i<aa.length;i++){if(aa[i]!==bb[i])channels++;if(i%4!==3&&aa[i])visible++}
  comparisons.push({label,dpr,channels,visible});if(channels||expectVisible&&!visible)throw Error(JSON.stringify(comparisons.at(-1)));
 }
 for(const dpr of [1,1.25,2])for(const zoom of [.5,1.13,4,8]){
  a.width=b.width=400*dpr;a.height=b.height=300*dpr;c.zoom=zoom;
  for(const style of [0,1,2,3])for(const direction of [-1,1]){
   g.combat.bullets.clear();const shot=g.combat.bullets.acquire();
   const offset=style===3?48:style===2?45:15;
   Object.assign(shot,{x:c.screenToWorldX(direction>0?c.viewW+offset:-offset),y:c.screenToWorldY(c.viewH/2),dx:direction,dy:0,style,traveled:100,life:1,maxLife:1,slashWidth:20,slashAngle:0,gale:true,circuit:false});
   compare('projectile-'+style+'-'+zoom+'-'+direction,dpr,()=>old.drawBullets(),()=>next.drawBullets(),zoom===8);
  }
  g.combat.bullets.clear();
  for(const kind of [0,1,2,3,4])for(const direction of [-1,1]){
   g.particles.clear();g.particles.spawn(kind,c.screenToWorldX(direction>0?c.viewW+42:-42),c.screenToWorldY(c.viewH/2),direction*800,0,1,20,0xffffff,0);
   const method=kind===1||kind===2?'drawOpaqueParticles':'drawAdditiveParticles';
   compare('particle-'+kind+'-'+zoom+'-'+direction,dpr,()=>old[method](),()=>next[method](),zoom===8);
  }
  g.particles.clear();
  for(const reduced of [false,true])for(const direction of [-1,1]){
   g.combat.goo.clear();const orb=g.combat.goo.orbs.acquire();Object.assign(orb,{x:c.screenToWorldX(direction>0?c.viewW+33:-33),y:c.screenToWorldY(c.viewH/2),mass:1,state:'stuck'});orb.body.impact(-direction,0);
   compare('goo-'+zoom+'-'+reduced+'-'+direction,dpr,()=>oldGoo(ac,c,g.combat.goo,reduced),()=>drawGoo(bc,c,g.combat.goo,reduced),zoom===8);
   g.combat.goo.clear();const mine=g.combat.goo.mines.acquire();Object.assign(mine,{x:c.screenToWorldX(direction>0?c.viewW+33:-33),y:c.screenToWorldY(c.viewH/2),mass:.3,fuse:.05,maxFuse:1,normalX:1,normalY:0});
   compare('mine-'+zoom+'-'+reduced+'-'+direction,dpr,()=>oldGoo(ac,c,g.combat.goo,reduced),()=>drawGoo(bc,c,g.combat.goo,reduced),zoom===8);
  }
 }
 return{status:'passed',comparisons};
},'/'+path.relative(root,dir).split(path.sep).join('/'));
fs.writeFileSync('/tmp/breach-effect-bounds.json',JSON.stringify(result,null,2));console.log(JSON.stringify({status:'passed',pixelChecks:result.comparisons.length}));
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>fs.rmSync(dir,{recursive:true,force:true}));
