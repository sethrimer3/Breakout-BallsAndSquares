/* Vite required. Test SQUELCH's own tree/loadout and Shotgun homing on desktop and touch. */
const assert=require('node:assert/strict');
let pw;try{pw=require('playwright')}catch{pw=require('/opt/codex/cua_node/lib/node_modules/playwright')}
(async()=>{
 const browser=await pw.chromium.launch({executablePath:process.env.BREACH_CHROMIUM||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
  for(const [width,height,deviceScaleFactor] of [[1280,900,1],[390,844,3]]){
   const context=await browser.newContext({viewport:{width,height},deviceScaleFactor,hasTouch:width<700});
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(process.env.BREACH_BASE_URL||'http://127.0.0.1:5173');await page.locator('[data-act="play"]').click();
   await page.evaluate(()=>{
    const g=window.__game;g.save.data.upgrades.unlock_primary=1;g.save.data.upgrades.extra_soldier=1;
    g.save.data.settings.devMode=true;g.save.data.settings.devFindUpgrades=true;
    g.save.data.bank=10000;g.save.data.essence=1000;g.save.data.lifetimePixels=10000;g.applyUpgrades();g.openUpgrades();g.upgradeTree.switchTab('squelch');
   });
   await page.locator('.tree-node[aria-label="Unlock SQUELCH"]:visible').click();
   assert.equal(await page.evaluate(()=>window.__game.save.data.essence),1000);
   assert.equal(await page.locator('[data-market="squelch"]').count(),0);
   const research=await page.evaluate(()=>[...window.__game.upgradeTree.nodeEls].filter(([,el])=>!el.classList.contains('hidden')).map(([id])=>id));
   assert(research.includes('goo_unlock')&&research.includes('goo_mass')&&research.every(id=>id.startsWith('goo_')));
   await page.evaluate(()=>window.__game.upgradeTree.switchTab('shotgun'));
   await page.locator('.tree-node[aria-label="Unlock Shotgun"]:visible').click();
   await page.locator('.tree-node[aria-label="Black Market"]:visible').click();
   if(width<700)await page.locator('[data-market="shotgun"]').tap();else await page.locator('[data-market="shotgun"]').click();
   assert.equal(await page.locator('.bm-tree [data-market-buy="goo_unlock"]').count(),0);
   if(width<700)await page.locator('[data-market-buy="homing_shotgun_unlock"]').tap();else await page.locator('[data-market-buy="homing_shotgun_unlock"]').click();
   await page.evaluate(()=>window.__game.upgradeTree.openLoadoutScreen());
   await page.locator('[data-slot="0"][data-weapon="squelch"]').click();
   await page.locator('[data-slot="1"][data-weapon="shotgun"]').click();
   await page.locator('[data-slot="1"][data-mutation="homing_shotgun"]').click();
   assert.equal(await page.locator('.lc-mbtn[data-mutation="squelch"]').count(),0);
   const live=await page.evaluate(async()=>{
    const g=window.__game,raf=requestAnimationFrame.bind(window);window.requestAnimationFrame=()=>0;await new Promise(r=>raf(()=>raf(r)));
    g.startRun();
    const a=g.deploySoldier(g.world.roomCenterX,g.world.roomCenterY,1,0),b=g.deploySoldier(g.world.roomCenterX,g.world.roomCenterY+8,1,0);
    if(!a||!b)throw Error('Both base weapons could not be deployed');
    g.paused=true;g.combat.fire(a);g.combat.fire(b);
    const pellets=g.combat.bullets.items.filter(p=>p.active&&p.homing);
    if(!pellets.length||!g.combat.goo.orbs.activeCount)throw Error('Independent mine and homing weapons did not fire');
    const p=pellets[0],before=Math.atan2(p.dy,p.dx),w=g.world;
    const cx=Math.floor((p.x+48)/w.cellSize),cy=Math.floor((p.y+24)/w.cellSize);
    w.setCell(cx,cy,500,'grown');
    g.combat.updateBullet(p,1/60);
    if(!p.homingLocked||Math.abs(Math.atan2(p.dy,p.dx)-before)<1e-5)throw Error('Pellet did not steer');
    const result={weapons:[a.weapon,b.weapon],mutations:[a.mutation,b.mutation],orbs:g.combat.goo.orbs.activeCount,pellets:pellets.length,steered:true,essence:g.save.data.essence};
    g.openUpgrades();g.upgradeTree.switchTab('squelch');g.transition.update(10);g.save.save();return result;
   });
   assert.deepEqual(live.weapons,['squelch','shotgun']);assert.deepEqual(live.mutations,[null,'homing_shotgun']);
   await page.screenshot({path:`/tmp/squelch-tree-${width}.png`});
   await page.reload();await page.locator('[data-act="play"]').click();
   const saved=await page.evaluate(()=>{const g=window.__game;return {loadouts:g.save.data.loadouts.slice(0,2).map(l=>[l.weapon,l.mutation]),goo:g.stats.gooUnlocked,homing:g.stats.homingShotgunUnlocked,essence:g.save.data.essence}});
   assert.deepEqual(saved.loadouts,[['squelch',null],['shotgun','homing_shotgun']]);assert(saved.goo&&saved.homing);assert.equal(saved.essence,live.essence);
   assert.deepEqual(errors,[]);console.log(JSON.stringify({width,deviceScaleFactor,live,saved,pageErrors:errors}));await context.close();
  }
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
