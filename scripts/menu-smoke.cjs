/* Independent menu gameplay: run against an existing Vite server. */
const assert=require('node:assert/strict');const fs=require('node:fs');
let playwright;try{playwright=require('playwright');}catch{playwright=require('/opt/codex/cua_node/lib/node_modules/playwright');}
const artifacts='/tmp/breach-menu-validation';fs.mkdirSync(artifacts,{recursive:true});
(async()=>{const browser=await playwright.chromium.launch({executablePath:process.env.BREACH_CHROMIUM||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 const context=await browser.newContext({viewport:{width:1440,height:900}});const page=await context.newPage();page.setDefaultTimeout(15000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.BREACH_BASE_URL||'http://127.0.0.1:5173');await page.locator('[data-act="play"]').waitFor({state:'visible'});
 const snapshot=()=>page.evaluate(()=>{const g=window.__game,b=g.mainMenu.background,d=b.demo;
  return{shots:d.shots,destroyed:d.destroyed,time:d.time,generation:d.generation,cores:d.world.blightCores.filter(c=>c.alive).length,soldiers:d.soldiers.filter(s=>s.alive).length,rooms:d.rooms.length,world:[d.world.width,d.world.height],canvas:[b.canvas.width,b.canvas.height],profile:JSON.stringify(g.save.data),runTime:g.runStats.time,speedrun:g.save.data.speedrun.elapsedMs};});
 const before=await snapshot();await page.waitForFunction(()=>{const d=window.__game.mainMenu.background.demo;return d.shots>=20&&d.destroyed>0;});
 const live=await snapshot();assert.ok(live.rooms>=4&&live.cores>=1);assert.equal(live.runTime,0);assert.equal(live.speedrun,0);assert.equal(live.profile,before.profile);
 await page.screenshot({path:`${artifacts}/desktop.png`});
 // Simulate a long menu session using the same fixed steps; no saves/rewards/timer may change.
 const long=await page.evaluate(()=>{const g=window.__game,d=g.mainMenu.background.demo;const saved=JSON.stringify(g.save.data);
  for(let i=0;i<60*100;i++)d.step(1/60);
  return{unchanged:saved===JSON.stringify(g.save.data),cores:d.world.blightCores.filter(c=>c.alive).length,shots:d.shots,destroyed:d.destroyed,generation:d.generation};});
 assert.ok(long.unchanged&&long.cores>=1&&long.shots>100&&long.destroyed>20);
 await page.locator('.main-panel [data-act="purge"]').click();const renewed=await snapshot();assert.ok(renewed.generation>long.generation);assert.equal(renewed.soldiers,2);assert.equal(renewed.cores,2);
 await page.locator('.main-panel [data-act="settings"]').click();assert.ok(await page.locator('.main-overlay .settings-panel').isVisible());
 await page.locator('.main-overlay [data-act="close-settings"]').click();
 await page.locator('.main-panel [data-act="play"]').click();
 const stopped=await page.evaluate(()=>{const b=window.__game.mainMenu.background;return{time:b.demo.time,running:b.running,animation:b.animId};});assert.equal(stopped.running,false);assert.equal(stopped.animation,null);
 await page.waitForTimeout(250);assert.equal(await page.evaluate(()=>window.__game.mainMenu.background.demo.time),stopped.time);
 await page.evaluate(()=>window.__game.openMainMenu());assert.equal(await page.evaluate(()=>window.__game.mainMenu.background.running),true);
 // Same world remains visible after resume; resize creates a portrait-appropriate room layout.
 await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>window.__game.mainMenu.background.canvas.width===390);
 const mobile=await snapshot();assert.equal(mobile.canvas[1],844);assert.ok(mobile.world[1]>mobile.world[0]);assert.ok(mobile.cores>=1);
 await page.screenshot({path:`${artifacts}/mobile.png`});
 assert.deepEqual(errors,[]);console.log(JSON.stringify({status:'passed',live:{shots:live.shots,destroyed:live.destroyed,cores:live.cores},long,mobile:{world:mobile.world,canvas:mobile.canvas},pageErrors:errors,artifacts}));
 await context.close();
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
