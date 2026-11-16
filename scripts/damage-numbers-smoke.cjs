/* Vite required. Check live block damage, styling, reduced motion and reset. */
const fs=require('node:fs'),assert=require('node:assert/strict');
let pw;try{pw=require('playwright')}catch{pw=require('/opt/codex/cua_node/lib/node_modules/playwright')}
(async()=>{const browser=await pw.chromium.launch({executablePath:process.env.BREACH_CHROMIUM||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});try{
const page=await browser.newPage({viewport:{width:1000,height:700}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto(process.env.BREACH_BASE_URL||'http://127.0.0.1:5173',{waitUntil:'domcontentloaded'});await page.locator('[data-act="play"]').click();
const result=await page.evaluate(async()=>{
 const g=window.__game,raf=requestAnimationFrame.bind(window);window.requestAnimationFrame=()=>0;g.paused=true;await new Promise(r=>raf(()=>raf(r)));
 const {DamageNumberRenderer}=await import('/src/rendering/DamageNumberRenderer.ts');const r=new DamageNumberRenderer(),w=g.world,n=g.damageNumbers,c=g.camera;
 const x=Math.floor(w.roomCenterX/w.cellSize)+2,y=Math.floor(w.roomCenterY/w.cellSize)+1;
 n.clear();w.setCell(x,y,50);w.damage(x,y,7,true);if(n.items.length!==1||n.items[0].amount!==7)throw Error('Nonlethal player hit missing');
 const canvas=document.createElement('canvas');canvas.width=c.viewW;canvas.height=c.viewH;const ctx=canvas.getContext('2d');
 c.x=(x+.5)*w.cellSize;c.y=(y+.5)*w.cellSize;c.zoom=4;
 r.draw(ctx,c,n,false);const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
 let black=0,outline=0,glow=0;for(let i=0;i<pixels.length;i+=4){if(pixels[i+3]>230&&pixels[i]<20&&pixels[i+1]<20&&pixels[i+2]<25)black++;if(pixels[i+3]>150&&pixels[i]>100)outline++;if(pixels[i+3]>0&&pixels[i+3]<100)glow++}
 if(!black||!outline||!glow)throw Error('Black fill, colored rim or soft glow missing');
 const hidden={tileSize:16,tw:Math.ceil(w.worldWidth/16),th:Math.ceil(w.worldHeight/16),light:new Float32Array(Math.ceil(w.worldWidth/16)*Math.ceil(w.worldHeight/16))};
 ctx.clearRect(0,0,canvas.width,canvas.height);r.draw(ctx,c,n,false,hidden);
 if(ctx.getImageData(0,0,canvas.width,canvas.height).data.some(Boolean))throw Error('Numbers leaked through unseen fog');
 n.items[0].age=.1;ctx.clearRect(0,0,canvas.width,canvas.height);r.draw(ctx,c,n,true);const still=ctx.getImageData(0,0,canvas.width,canvas.height).data;
 n.items[0].age=.2;ctx.clearRect(0,0,canvas.width,canvas.height);r.draw(ctx,c,n,true);const later=ctx.getImageData(0,0,canvas.width,canvas.height).data;
 if(still.some((value,i)=>value!==later[i]))throw Error('Reduced motion moved the text');
 w.damage(x,y,100,true);if(n.items.length!==1)throw Error('Destroying hit spawned a number');
 n.update(1);if(n.items.length)throw Error('Damage numbers did not expire');
 w.setCell(x,y,50);w.damage(x,y,24,true);while(g.terrain.chunks.pending)g.terrain.update();
 g.save.data.settings.devMode=true;g.save.data.settings.devMapAccess=true;g.updateFlashPolygons();g.renderer.draw();
 // Finish the opening iris before capturing the actual game canvas.
 g.transition.update(10);
 return{status:'passed',blackPixels:black,outlinePixels:outline,glowPixels:glow,active:n.items.length};
});
await page.screenshot({path:'/tmp/breach-damage-numbers.png'});
await page.evaluate(()=>{const g=window.__game;g.startRun();if(g.damageNumbers.items.length)throw Error('Run reset retained damage numbers')});
assert.deepEqual(errors,[]);console.log(JSON.stringify({...result,pageErrors:errors,screenshot:'/tmp/breach-damage-numbers.png'}));
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
