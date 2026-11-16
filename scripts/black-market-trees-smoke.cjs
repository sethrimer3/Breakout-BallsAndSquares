/* Run against Vite. Exercise real settings, split navigation, purchases and persistence. */
const assert=require('node:assert/strict');
let pw;try{pw=require('playwright')}catch{pw=require('/opt/codex/cua_node/lib/node_modules/playwright')}
(async()=>{
 const fs=require('node:fs'),exe=process.env.BREACH_CHROMIUM||['/usr/bin/chromium','/opt/pw-browsers/chromium'].find(p=>fs.existsSync(p));
 const browser=await pw.chromium.launch({executablePath:exe,headless:true,args:['--no-sandbox']});
 try{
  for(const [width,height,deviceScaleFactor] of [[1280,900,1],[390,844,3]]){
   const context=await browser.newContext({viewport:{width,height},deviceScaleFactor,hasTouch:width<700}),page=await context.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   const node=id=>page.locator(`.tree-node[data-id="${id}"]:not(.hidden)`);
   const buy=async id=>{const n=node(id);if(width<700){await n.tap();await n.tap()}else await n.click();await page.waitForTimeout(60)};
   const shown=()=>page.evaluate(()=>[...window.__game.upgradeTree.nodeEls].filter(([,el])=>!el.classList.contains('hidden')).map(([id])=>id));
   await page.goto(process.env.BREACH_BASE_URL||'http://127.0.0.1:5173');
   await page.locator('.main-settings-btn').click();
   await page.locator('.settings-panel:not(.hidden) [data-tab="dev"]').click();
   const setting=page.locator('.settings-panel:not(.hidden)');
   assert(await setting.locator('[data-set="dev-find"]').isDisabled());
   await setting.locator('[data-set="devmode"]').click();
   await setting.locator('[data-set="dev-find"]').click();
   assert(await page.evaluate(()=>window.__game.save.data.settings.devFindUpgrades));
   await setting.locator('[data-set="devmode"]').click(); // bypass inactive outside dev mode
   await setting.locator('[data-act="close-settings"]').click();
   await page.locator('[data-act="play"]').click();
   const initial=await page.evaluate(()=>{
    const g=window.__game;g.transition.update(10);g.save.data.upgrades.unlock_primary=1;g.save.data.lifetimePixels=10000;
    g.save.data.essence=10000;g.save.data.bank=10000;g.save.data.crystals=10000;
    g.openUpgrades();g.upgradeTree.switchTab('pistol');
    const ids=()=>[...g.upgradeTree.nodeEls].filter(([,el])=>!el.classList.contains('hidden')).map(([id])=>id);
    return {ids:ids(),hidden:g.upgradeTree.root.querySelector('[data-tab="shotgun"]').textContent.trim()};
   });
   assert(initial.hidden.includes('???'));assert(!initial.hidden.includes('SHOTGUN'));
   assert.equal(initial.ids.filter(id=>id.startsWith('black_market_')).length,1);
   assert(!initial.ids.some(id=>['reverse_unlock','orbit_unlock','drone_unlock'].includes(id)));
   assert(await page.locator('[data-market="pistol"]').isDisabled());
   await page.locator('.tree-node[aria-label="Black Market"]:visible').click();
   assert(!(await page.locator('[data-market="pistol"]').isDisabled()));
   const after=await page.evaluate(()=>[...window.__game.upgradeTree.nodeEls].filter(([,el])=>!el.classList.contains('hidden')).map(([id])=>id));
   assert.deepEqual(after,initial.ids); // access never sprouts mutation nodes onto the ordinary tree
   if(width<700)await page.locator('[data-market="pistol"]').tap();else await page.locator('[data-market="pistol"]').click();
   // The Black Market draws on the ordinary tree stage: hub plus the three path roots.
   assert.deepEqual((await shown()).sort(),['drone_unlock','orbit_unlock','reverse_unlock']);
   assert(await page.locator('.tree-core:not(.hidden)').isVisible());
   await buy('reverse_unlock');
   await buy('orbit_unlock');
   const before=await page.evaluate(()=>window.__game.save.data.essence);
   await buy('reverse_unlock');
   assert.equal(await page.evaluate(()=>window.__game.save.data.essence),before-20);
   await buy('drone_unlock');
   await page.waitForTimeout(500);
   assert((await shown()).includes('drone_damage')); // the active path grows its research
   await buy('drone_damage');
   const ownedDamage=await page.evaluate(()=>window.__game.stats.droneDamage);
   await page.waitForTimeout(400);
   await page.screenshot({path:`/tmp/black-market-drone-${width}.png`});
   await buy('orbit_unlock');
   // Mid-fold: the drone research is still on screen, shrinking into its root.
   await page.waitForTimeout(150);
   const folding=await page.evaluate(()=>{const el=window.__game.upgradeTree.nodeEls.get('drone_damage');return {hidden:el.classList.contains('hidden'),scale:Number(el.style.scale)}});
   assert(!folding.hidden&&folding.scale>0&&folding.scale<1,JSON.stringify(folding));
   await page.screenshot({path:`/tmp/black-market-fold-${width}.png`});
   await page.waitForTimeout(500);
   assert(!(await shown()).includes('drone_damage'));
   await buy('drone_unlock');
   assert.equal(await page.evaluate(()=>window.__game.stats.droneDamage),ownedDamage);
   const state=await page.evaluate(()=>{
    const g=window.__game;g.save.save();
    return {path:g.save.data.blackMarketPaths.pistol,reverse:g.stats.reverseUnlocked,orbit:g.stats.orbitUnlocked,drone:g.stats.droneUnlocked,damage:g.stats.droneDamage,essence:g.save.data.essence,level:g.upgrades.levelOf('reverse_unlock')};
   });
   assert.deepEqual([state.path,state.reverse,state.orbit,state.drone,state.level],['drone_unlock',false,false,true,1]);
   // Capture the clean three-way choice layout, then check reduced motion.
   await page.evaluate(()=>{const g=window.__game;g.save.data.blackMarketPaths.pistol='reverse_unlock';g.upgradeTree.refresh();g.transition.update(10)});
   await page.waitForTimeout(700);
   await page.screenshot({path:`/tmp/black-market-trees-${width}.png`});
   // Reduced motion: a switch hides the old research at once.
   await page.emulateMedia({reducedMotion:'reduce'});
   await buy('drone_unlock');await page.waitForTimeout(50);
   assert((await shown()).includes('drone_damage'));
   await buy('reverse_unlock');
   assert(!(await shown()).includes('drone_damage'));
   await page.emulateMedia({reducedMotion:'no-preference'});
   // Restore the actual choice before reload.
   await page.evaluate(essence=>{const g=window.__game;g.save.data.blackMarketPaths.pistol='drone_unlock';g.save.data.essence=essence;g.save.save()},state.essence);
   await page.reload();await page.locator('[data-act="play"]').click();
   const restored=await page.evaluate(()=>{const g=window.__game;return {path:g.save.data.blackMarketPaths.pistol,essence:g.save.data.essence,damage:g.stats.droneDamage}});
   assert.equal(restored.path,state.path);assert.equal(restored.essence,state.essence);assert.equal(restored.damage,state.damage);
   assert.deepEqual(errors,[]);console.log(JSON.stringify({width,deviceScaleFactor,state,restored,pageErrors:errors}));
   await context.close();
  }
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
