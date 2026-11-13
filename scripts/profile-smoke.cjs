/* Profile seeds and cumulative active-run timing, against an existing Vite server. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
let playwright;
try { playwright = require('playwright'); }
catch { playwright = require('/opt/codex/cua_node/lib/node_modules/playwright'); }
const artifacts='/tmp/breach-profile-validation';fs.mkdirSync(artifacts,{recursive:true});
(async()=>{
 const browser=await playwright.chromium.launch({executablePath:process.env.BREACH_CHROMIUM||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:900}});page.setDefaultTimeout(15000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.BREACH_BASE_URL||'http://127.0.0.1:5173');
  await page.locator('[data-act="play"]').waitFor({state:'visible'});
  const original=await page.evaluate(()=>window.__game.save.data.seed);
  const settings=page.locator('.main-overlay .settings-panel');
  async function openSettings(){await page.locator('.main-panel [data-act="settings"]').click();}
  async function closeSettings(){await settings.locator('[data-act="close-settings"]').click();}
  await openSettings();await settings.locator('.set-seed-input').fill('race42');
  await settings.locator('[data-set="apply-seed"]').click();
  assert.deepEqual(await page.evaluate(()=>{const s=window.__game.save;return[s.activeSlot,s.data.seed,s.newProfileSeed];}),[1,original,'RACE42']);
  await closeSettings();
  await page.locator('.save-slot-card[data-slot="2"] [data-action="init"]').click();
  assert.equal(await page.evaluate(()=>window.__game.save.data.seed),'RACE42');
  await openSettings();await settings.locator('[data-set="speedrun"]').click();
  await page.screenshot({path:`${artifacts}/settings.png`});await closeSettings();
  await page.locator('.main-panel [data-act="play"]').click();
  await page.waitForFunction(()=>window.__game.save.data.speedrun.elapsedMs>250);
  assert.ok(await page.locator('.hud-speedrun').isVisible());
  const digest=()=>page.evaluate(()=>{
   const w=window.__game.world;return[w.health,w.wall,w.mat,w.tint,w.subHealth].map(a=>{let h=2166136261;for(let i=0;i<a.length;i++)h=Math.imul(h^a[i],16777619);return h>>>0;});
  });
  const first=await digest();
  await page.screenshot({path:`${artifacts}/timer.png`});
  await page.keyboard.press('Escape');
  const paused=await page.evaluate(()=>window.__game.save.data.speedrun.elapsedMs);
  await page.waitForTimeout(250);assert.equal(await page.evaluate(()=>window.__game.save.data.speedrun.elapsedMs),paused);
  await page.locator('.pause-overlay [data-act="upgrades"]').click();
  const upgrades=await page.evaluate(()=>window.__game.save.data.speedrun.elapsedMs);
  await page.waitForTimeout(250);assert.equal(await page.evaluate(()=>window.__game.save.data.speedrun.elapsedMs),upgrades);
  await page.evaluate(()=>{const g=window.__game;g.save.data.upgrades.unlock_map=1;g.beginDeploy();});
  assert.equal(await page.evaluate(()=>window.__game.labMap.visible),true);
  const mapTime=await page.evaluate(()=>window.__game.save.data.speedrun.elapsedMs);
  await page.waitForTimeout(250);assert.equal(await page.evaluate(()=>window.__game.save.data.speedrun.elapsedMs),mapTime);
  await page.evaluate(()=>{const g=window.__game;g.save.data.upgrades.unlock_map=0;g.startRun();});
  assert.deepEqual(await digest(),first,'regeneration drifted for the same profile seed');
  const before=await page.evaluate(()=>{const g=window.__game;g.timeScale=5;return[g.runStats.time,g.save.data.speedrun.elapsedMs];});
  await page.waitForFunction(ms=>window.__game.save.data.speedrun.elapsedMs>ms+300,before[1]);
  const after=await page.evaluate(()=>{const g=window.__game;g.timeScale=1;return[g.runStats.time,g.save.data.speedrun.elapsedMs];});
  assert.ok((after[0]-before[0])*1000>(after[1]-before[1])*3,'timer used simulation time scale');
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
  const hidden=await page.evaluate(()=>window.__game.save.data.speedrun.elapsedMs);
  await page.waitForTimeout(250);assert.equal(await page.evaluate(()=>window.__game.save.data.speedrun.elapsedMs),hidden);
  await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
  await page.waitForFunction(ms=>window.__game.save.data.speedrun.elapsedMs>ms+100,hidden);
  await page.evaluate(()=>window.__game.endRun());
  const ended=await page.evaluate(()=>window.__game.save.data.speedrun.elapsedMs);
  await page.waitForTimeout(250);assert.equal(await page.evaluate(()=>window.__game.save.data.speedrun.elapsedMs),ended);
  await page.evaluate(()=>window.__game.openMainMenu());
  const stopped=await page.evaluate(()=>window.__game.save.data.speedrun.elapsedMs);
  await page.waitForTimeout(250);assert.equal(await page.evaluate(()=>window.__game.save.data.speedrun.elapsedMs),stopped);
  await openSettings();await settings.locator('[data-set="speedrun"]').click();await closeSettings();
  assert.equal(await page.evaluate(()=>window.__game.save.data.speedrun.elapsedMs),stopped);
  await page.reload();await page.locator('[data-act="play"]').waitFor({state:'visible'});
  assert.deepEqual(await page.evaluate(()=>{const s=window.__game.save;return[s.data.seed,s.data.speedrun.enabled,s.data.speedrun.elapsedMs,s.newProfileSeed];}),['RACE42',false,stopped,'RACE42']);
  await openSettings();await settings.locator('.set-seed-input').fill('next7');await settings.locator('[data-set="apply-seed"]').click();await closeSettings();
  await page.locator('.save-slot-card[data-slot="3"] [data-action="init"]').click();
  assert.deepEqual(await page.evaluate(()=>{const d=window.__game.save.data;return[d.seed,d.speedrun.elapsedMs,d.speedrun.enabled];}),['NEXT7',0,false]);
  await page.locator('.main-panel [data-act="play"]').click();assert.notDeepEqual(await digest(),first);
  await page.evaluate(()=>window.__game.openMainMenu());
  await page.locator('.save-slot-card[data-slot="2"] [data-action="select"]').click();
  assert.deepEqual(await page.evaluate(()=>{const d=window.__game.save.data;return[d.seed,d.speedrun.elapsedMs];}),['RACE42',stopped]);
  // Narrow-screen settings remain usable and do not overflow the viewport.
  await page.setViewportSize({width:390,height:844});await openSettings();
  const bounds=await settings.locator('.set-seed-input').boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=390);
  await page.screenshot({path:`${artifacts}/mobile-settings.png`});assert.deepEqual(errors,[]);
  console.log(JSON.stringify({status:'passed',elapsedMs:stopped,seed:'RACE42',pageErrors:errors,artifacts}));
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
