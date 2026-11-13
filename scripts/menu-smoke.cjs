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

 // Simulate a long menu session using the same fixed steps; no saves/rewards/timer may change.
 const long=await page.evaluate(()=>{const g=window.__game,d=g.mainMenu.background.demo;const saved=JSON.stringify(g.save.data);
  for(let i=0;i<60*100;i++)d.step(1/60);
  return{unchanged:saved===JSON.stringify(g.save.data),cores:d.world.blightCores.filter(c=>c.alive).length,shots:d.shots,destroyed:d.destroyed,generation:d.generation};});
 assert.ok(long.unchanged&&long.cores>=1&&long.shots>100&&long.destroyed>20);
 // Profile selection is the only primary action, without duplicate stats or shortcuts.
 assert.equal(await page.locator('.main-summary, .main-actions, .main-sub-actions, .main-panel [data-act="upgrades"], .main-panel [data-act="purge"]').count(),0);
 assert.equal(await page.locator('.profile-open').count(),3);
 assert.equal(await page.evaluate(()=>window.__game.save.slotExists(1)),false,'Opening the menu must not create a profile');
 await page.keyboard.press('u');assert.equal(await page.evaluate(()=>window.__game.upgradeTree.visible),false);
 await page.evaluate(()=>{const g=window.__game;g.save.data.bank=7;g.save.data.lifetimePixels=16;g.save.data.bests.depth=4;g.save.save();g.mainMenu.show();});
 await page.screenshot({path:`${artifacts}/desktop.png`});
 // Deletion requires explicit confirmation. Neither quick-select nor Enter may accidentally deploy here.
 await page.getByRole('button',{name:'Delete Profile 1',exact:true}).click();
 await page.keyboard.press('3');assert.equal(await page.evaluate(()=>window.__game.save.activeSlot),1);
 await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>window.__game.mainMenu.visible),true);
 assert.equal(await page.evaluate(()=>window.__game.save.slotExists(1)),true);
 await page.getByRole('button',{name:'Delete Profile 1',exact:true}).click();
 await page.locator('[data-action="confirm-delete"]').click();
 assert.equal(await page.evaluate(()=>window.__game.save.slotExists(1)),false);
 await page.reload();await page.locator('[data-act="play"]').waitFor({state:'visible'});
 assert.equal(await page.evaluate(()=>window.__game.save.slotExists(1)),false,'Deleted profile must stay empty after reload');
 await page.locator('.main-panel [data-act="settings"]').click();assert.ok(await page.locator('.main-overlay .settings-panel').isVisible());
 await page.locator('.main-overlay .set-profile-select').selectOption('2');
 await page.keyboard.press('3');assert.equal(await page.evaluate(()=>window.__game.save.activeSlot),2);
 await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>window.__game.mainMenu.visible),true);
 await page.keyboard.press('Escape');
 // A native select popup consumes its first Escape before the settings panel sees it.
 if(await page.locator('.main-overlay .settings-panel').isVisible())await page.keyboard.press('Escape');
 const settingsFocus=await page.evaluate(()=>document.activeElement?.getAttribute('data-act'));
 assert.equal(settingsFocus,'settings');await page.keyboard.press('Tab');
 assert.equal(await page.evaluate(()=>document.activeElement?.classList.contains('profile-open')),true,'Tab must navigate profile cards');
 // Clicking a profile now creates/opens it directly, with no second deploy button.
 await page.getByRole('button',{name:'Create Profile 1',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.__game.save.activeSlot),1);
 assert.equal(await page.evaluate(()=>window.__game.mainMenu.visible),false);
 await page.keyboard.press('Space');assert.equal(await page.evaluate(()=>window.__game.paused),true);
 await page.keyboard.press('Space');assert.equal(await page.evaluate(()=>window.__game.paused),false);
 const stopped=await page.evaluate(()=>{const b=window.__game.mainMenu.background;return{time:b.demo.time,running:b.running,animation:b.animId};});assert.equal(stopped.running,false);assert.equal(stopped.animation,null);
 await page.waitForTimeout(250);assert.equal(await page.evaluate(()=>window.__game.mainMenu.background.demo.time),stopped.time);
 await page.evaluate(()=>window.__game.openMainMenu());assert.equal(await page.evaluate(()=>window.__game.mainMenu.background.running),true);
 // Same world remains visible after resume; resize creates a portrait-appropriate room layout.
 await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>window.__game.mainMenu.background.canvas.width===390);
 const mobile=await snapshot();assert.equal(mobile.canvas[1],844);assert.ok(mobile.world[1]>mobile.world[0]);assert.ok(mobile.cores>=1);
 await page.screenshot({path:`${artifacts}/mobile.png`});
 // Keyboard quick-select opens the requested profile once, too.
 await page.evaluate(()=>{if(document.activeElement instanceof HTMLElement)document.activeElement.blur();});
 await page.keyboard.press('2');
 assert.equal(await page.evaluate(()=>window.__game.save.activeSlot),2);
 assert.equal(await page.evaluate(()=>window.__game.mainMenu.visible),false);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({status:'passed',live:{shots:live.shots,destroyed:live.destroyed,cores:live.cores},long,mobile:{world:mobile.world,canvas:mobile.canvas},pageErrors:errors,artifacts}));
 await context.close();
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
