/* Run against Vite. Exercise real settings, split navigation, purchases and persistence. */
const assert=require('node:assert/strict');
let pw;try{pw=require('playwright')}catch{pw=require('/opt/codex/cua_node/lib/node_modules/playwright')}
(async()=>{
 const browser=await pw.chromium.launch({executablePath:process.env.BREACH_CHROMIUM||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
  for(const [width,height,deviceScaleFactor] of [[1280,900,1],[390,844,3]]){
   const context=await browser.newContext({viewport:{width,height},deviceScaleFactor,hasTouch:width<700}),page=await context.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
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
   assert.equal(await page.locator('.bm-upward [data-market-buy="drone_unlock"]').count(),1);
   const artwork=await page.evaluate(()=>{
    const c=document.querySelector('canvas.bm-weapon'),px=c.getContext('2d').getImageData(0,0,144,144).data;
    let black=0,rim=0;for(let i=0;i<px.length;i+=4){if(px[i+3]===255&&px[i]===0&&px[i+1]===0&&px[i+2]===0)black++;if(px[i]===255&&px[i+3]>0)rim++;}
    return {black,rim};
   });assert(artwork.black>500&&artwork.rim>100);
   if(width<700)await page.locator('[data-market-buy="reverse_unlock"]').tap();else await page.locator('[data-market-buy="reverse_unlock"]').click();
   await page.locator('[data-market-buy="orbit_unlock"]').click();
   const before=await page.evaluate(()=>window.__game.save.data.essence);
   if(width<700)await page.locator('[data-market-buy="reverse_unlock"]').tap();else await page.locator('[data-market-buy="reverse_unlock"]').click();
   assert.equal(await page.evaluate(()=>window.__game.save.data.essence),before-20);
   await page.locator('[data-market-buy="drone_unlock"]').click();
   await page.locator('[data-market-buy="drone_damage"]').click();
   const ownedDamage=await page.evaluate(()=>window.__game.stats.droneDamage);
   await page.locator('[data-market-buy="orbit_unlock"]').click();
   assert.equal(await page.locator('[data-market-buy="drone_damage"]').count(),0);
   await page.locator('[data-market-buy="drone_unlock"]').click();
   assert.equal(await page.evaluate(()=>window.__game.stats.droneDamage),ownedDamage);
   const state=await page.evaluate(()=>{
    const g=window.__game;g.save.save();
    return {path:g.save.data.blackMarketPaths.pistol,reverse:g.stats.reverseUnlocked,orbit:g.stats.orbitUnlocked,drone:g.stats.droneUnlocked,damage:g.stats.droneDamage,essence:g.save.data.essence,level:g.upgrades.levelOf('reverse_unlock')};
   });
   assert.deepEqual([state.path,state.reverse,state.orbit,state.drone,state.level],['drone_unlock',false,false,true,1]);
   // Capture the clean three-way choice layout, then check reduced motion.
   await page.evaluate(()=>{const g=window.__game;g.save.data.blackMarketPaths.pistol='reverse_unlock';g.upgradeTree.refresh();g.transition.update(10)});
   await page.locator('.bm-tree').evaluate(el=>el.scrollTop=0);
   await page.screenshot({path:`/tmp/black-market-trees-${width}.png`});
   await page.emulateMedia({reducedMotion:'reduce'});
   await page.waitForTimeout(100);
   const pixels=()=>page.locator('canvas.bm-weapon').evaluate(c=>c.toDataURL());
   const still=await pixels();await page.waitForTimeout(200);assert.equal(await pixels(),still);
   // Restore the actual choice before reload.
   await page.evaluate(()=>{const g=window.__game;g.save.data.blackMarketPaths.pistol='drone_unlock';g.save.save()});
   await page.reload();await page.locator('[data-act="play"]').click();
   const restored=await page.evaluate(()=>{const g=window.__game;return {path:g.save.data.blackMarketPaths.pistol,essence:g.save.data.essence,damage:g.stats.droneDamage}});
   assert.equal(restored.path,state.path);assert.equal(restored.essence,state.essence);assert.equal(restored.damage,state.damage);
   assert.deepEqual(errors,[]);console.log(JSON.stringify({width,deviceScaleFactor,artwork,state,restored,pageErrors:errors}));
   await context.close();
  }
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
