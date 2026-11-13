/* Run against an existing Vite dev server. No writes to real browser profiles. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let playwright;
try { playwright = require('playwright'); }
catch { playwright = require('/opt/codex/cua_node/lib/node_modules/playwright'); }
const base = process.env.BREACH_BASE_URL || 'http://127.0.0.1:5173';
const artifacts = process.env.BREACH_ARTIFACTS || '/tmp/breach-weapon-validation';
fs.mkdirSync(artifacts, { recursive: true });

(async () => {
 const browser = await playwright.chromium.launch({ executablePath: process.env.BREACH_CHROMIUM || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
 try {
  const context = await browser.newContext({viewport:{width:1440,height:900}});
  const page = await context.newPage();page.setDefaultTimeout(15000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base,{waitUntil:"domcontentloaded"});await page.locator('[data-act="play"]').waitFor({state:'visible'});
  await page.evaluate(()=>{
   const g=window.__game;g.save.data.upgrades.unlock_primary=1;
   g.save.data.essence=1000000;g.save.data.bank=g.save.data.crystals=g.save.data.greenCrystals=1000000;g.save.data.lifetimePixels=10000;g.openUpgrades();
   for(const id of ['goo_unlock','goo_radius','goo_residue','katana_unlock','katana_dash','drone_unlock','drone_capacity','prism_unlock','prism_spectrum','prism_overload','reverse_unlock','gale_unlock'])g.upgradeTree.nodeEls.get(id).dataset.smoke=id;
  });
  await page.locator('.tree-cat-btn[data-cat="primary"]').click();
  async function buy(id) { const node=page.locator(`[data-smoke="${id}"]`);await node.hover();await node.click(); }
  await page.locator('[data-tab="goo_mortar"]').click();await buy('goo_unlock');await buy('goo_radius');await buy('goo_residue');
  await page.locator('[data-tab="katana"]').click();await buy('katana_unlock');await buy('katana_dash');
  await page.locator('[data-tab="drone_shepherd"]').click();await buy('drone_unlock');await buy('drone_capacity');
  await page.locator('[data-tab="prism_laser"]').click();await buy('prism_unlock');
  for(let i=0;i<6;i++)await buy('prism_spectrum');await buy('prism_overload');
  assert.deepEqual(await page.evaluate(()=>['goo_residue','katana_dash','drone_capacity','prism_spectrum','prism_overload'].map(id=>window.__game.upgrades.levelOf(id))),[1,1,1,6,1]);
  const mutations=[];
  for(const [weapon,mutation,unlock] of [['pistol','reverse_revolver','reverse_unlock'],['katana','gale_edge','gale_unlock']]) {
   await page.locator(`[data-tab="${weapon}"]`).click();await buy(unlock);
   await page.evaluate(()=>window.__game.upgradeTree.openLoadoutScreen());
   await page.locator(`[data-slot="0"][data-weapon="${weapon}"]`).click();
   await page.locator(`.lc-mbtn[data-slot="0"][data-mutation="${mutation}"]`).click();
   assert.equal(await page.evaluate(()=>window.__game.save.data.loadouts[0].mutation),mutation);
   await page.evaluate(()=>{const g=window.__game;g.startRun();g.growth.graceSeconds=1000;g.deploySoldier(g.world.roomCenterX,g.world.roomCenterY,1,0);});
   await page.waitForFunction(m=>{const g=window.__game;const ready=m==='gale_edge'?g.combat.bullets.items.some(b=>b.active&&b.gale):g.combat.revolver.pool.items.some(s=>s.active&&s.phase!=='recording');if(ready)g.paused=true;return ready;},mutation);
   assert.equal(await page.evaluate(()=>window.__game.soldiers[0].mutation),mutation);
   mutations.push(mutation);await page.screenshot({path:path.join(artifacts,`${mutation}.png`)});
   await page.evaluate(()=>{const g=window.__game;g.openUpgrades();g.upgradeTree.openLoadoutScreen();});
   await page.locator('.lc-mbtn[data-slot="0"][data-mutation=""]').click();
   assert.equal(await page.evaluate(()=>window.__game.save.data.loadouts[0].mutation),null);
   await page.evaluate(()=>window.__game.openUpgrades());
  }
  assert.equal(mutations.length,2);
  const live=[];
  for(const weapon of ['goo_mortar','drone_shepherd','prism_laser','katana']) {
   await page.evaluate(()=>window.__game.upgradeTree.openLoadoutScreen());
   await page.locator(`[data-slot="0"][data-weapon="${weapon}"]`).click();
   assert.equal(await page.evaluate(()=>window.__game.save.data.loadouts[0].weapon),weapon);
   await page.evaluate(()=>{
    const g=window.__game;g.startRun();g.growth.graceSeconds=1000;
    // Strengthen existing walls so a katana actually rebounds in this short check.
    for(let i=0;i<g.world.health.length;i++)if(g.world.health[i]>0)g.world.health[i]=1000;
    g.deploySoldier(g.world.roomCenterX,g.world.roomCenterY,1,0);
   });
   await page.waitForFunction((weapon)=>{
    const g=window.__game;
    const ready=weapon==='goo_mortar'?g.combat.goo.bursts>0:weapon==='drone_shepherd'?g.combat.drones.shots>0:weapon==='prism_laser'?g.combat.laser.hits>0:g.combat.telemetry.katanaDashes>0;
    if(ready)g.paused=true;return ready;
   },weapon);
   live.push(await page.evaluate(()=>{const g=window.__game;return{weapon:g.soldiers[0].weapon,soldiers:g.soldiers.length,deployed:g.runStats.soldiersDeployed,drones:g.combat.drones.pool.activeCount,telemetry:JSON.parse(g.exportTelemetryJson()).weapons};}));
   await page.screenshot({path:path.join(artifacts,`${weapon}.png`)});
   await page.evaluate(()=>window.__game.openUpgrades());
  }
  const drone=live.find(r=>r.weapon==='drone_shepherd');assert.equal(drone.soldiers,1);assert.equal(drone.deployed,1);assert.ok(drone.drones>0);
  await page.evaluate(()=>window.__game.startRun());
  assert.deepEqual(await page.evaluate(()=>{const c=window.__game.combat;return[c.goo.orbs.activeCount,c.goo.mines.activeCount,c.drones.pool.activeCount,c.laser.segments.activeCount];}),[0,0,0,0]);
  await page.evaluate(()=>window.__game.openMainMenu());
  await page.locator('.main-overlay [data-act="settings"]').click();
  await page.locator('.settings-panel:not(.hidden) [data-set="prism-patterns"]').click();
  assert.equal(await page.evaluate(()=>window.__game.save.data.settings.prismPatterns),false);
  await page.reload({waitUntil:"domcontentloaded"});await page.locator('[data-act="play"]').waitFor({state:'visible'});
  assert.deepEqual(await page.evaluate(()=>({patterns:window.__game.save.data.settings.prismPatterns,drone:window.__game.stats.droneUnlocked,prism:window.__game.stats.prismUnlocked})),{patterns:false,drone:true,prism:true});
  assert.deepEqual(errors,[]);
  const profiles=[];
  for(const mobile of [false,true]){
   const profile=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:900},isMobile:mobile,deviceScaleFactor:mobile?2:1,hasTouch:mobile,reducedMotion:mobile?'reduce':'no-preference'});
   const p=await profile.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(base,{waitUntil:"domcontentloaded"});await p.locator('[data-act="play"]').waitFor({state:'visible'});
   if(mobile){
    const cdp=await profile.newCDPSession(p);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
    await p.evaluate(async()=>{const{UPGRADE_DEFS}=await import('/src/progression/UpgradeDefinitions.ts');const g=window.__game;for(const d of UPGRADE_DEFS)g.save.data.upgrades[d.id]=d.maxLevel;g.save.data.lifetimePixels=10000;g.applyUpgrades();g.openUpgrades();g.upgradeTree.nodeEls.get('prism_spectrum').dataset.mobileSmoke='spectrum';});
    await p.locator('.tree-cat-btn[data-cat="primary"]').tap();await p.locator('[data-tab="prism_laser"]').tap();
    await p.locator('[data-mobile-smoke="spectrum"]').tap();
    await p.locator('.tt-title').filter({hasText:'Spectrum Ascension'}).waitFor({state:'visible'});
    await p.screenshot({path:path.join(artifacts,'mobile-prism-upgrades.png')});
    await p.evaluate(()=>window.__game.upgradeTree.openLoadoutScreen());
    await p.locator('[data-slot="0"][data-weapon="prism_laser"]').tap();
    assert.equal(await p.evaluate(()=>window.__game.save.data.loadouts[0].weapon),'prism_laser');
   }
   const report=await p.evaluate(async(mobile)=>{
    const {PixelWorld}=await import('/src/world/PixelWorld.ts');const{Soldier}=await import('/src/entities/Soldier.ts');
    const{CombatSystem}=await import('/src/systems/CombatSystem.ts');const{PhysicsSystem,circleIsClear}=await import('/src/systems/PhysicsSystem.ts');
    const{Rng}=await import('/src/core/Rng.ts');const{UPGRADE_DEFS}=await import('/src/progression/UpgradeDefinitions.ts');
    const{UpgradeManager}=await import('/src/progression/UpgradeManager.ts');const{SaveManager}=await import('/src/progression/SaveManager.ts');
    const{CameraSystem}=await import('/src/systems/CameraSystem.ts');const{drawWeaponExpansion}=await import('/src/rendering/WeaponExpansionRenderer.ts');const{drawGoo}=await import('/src/rendering/GooRenderer.ts');
    const world=new PixelWorld({width:64,height:64,cellSize:8,roomSize:4});
    for(let y=0;y<64;y++)for(let x=0;x<64;x++)world.health[y*64+x]=x<2||x>61||y<30||y>33?1000:0;
    const storage={getItem:()=>null,setItem:()=>{}};const save=new SaveManager(storage);
    for(const def of UPGRADE_DEFS)save.data.upgrades[def.id]=def.maxLevel;
    const stats=new UpgradeManager(save).getSoldierStats();const rng=new Rng(17);const combat=new CombatSystem(world,rng,stats);const physics=new PhysicsSystem(world,rng);
    const soldiers=Array.from({length:8},(_,i)=>new Soldier(240+i*2,256,1,0.2,stats.speed,['goo_mortar','drone_shepherd','prism_laser','katana'][i%4],'free',i));
    const camera=new CameraSystem(world);camera.viewW=mobile?390:1440;camera.viewH=mobile?844:900;camera.x=256;camera.y=256;camera.zoom=mobile?2:3;
    const canvas=document.createElement('canvas');canvas.width=camera.viewW;canvas.height=camera.viewH;const ctx=canvas.getContext('2d');
    const fakeGame={camera,combat,soldiers,save};const sim=[],render=[];let maxDrones=0,maxMines=0,maxSegments=0,valid=true;
    for(let frame=0;frame<600;frame++){
     let t0=performance.now();for(const s of soldiers){physics.step(s,1/60,stats);combat.updateSoldier(s,1/60);}
     combat.updateBullets(1/60);combat.goo.update(1/60);combat.drones.update(1/60);combat.laser.update(1/60);sim.push(performance.now()-t0);
     t0=performance.now();ctx.clearRect(0,0,canvas.width,canvas.height);drawWeaponExpansion(ctx,fakeGame,mobile);drawGoo(ctx,camera,combat.goo,mobile,mobile);render.push(performance.now()-t0);
     maxDrones=Math.max(maxDrones,combat.drones.pool.activeCount);maxMines=Math.max(maxMines,combat.goo.mines.activeCount);maxSegments=Math.max(maxSegments,combat.laser.segments.activeCount);
     for(const s of soldiers)valid&&=Number.isFinite(s.x)&&Number.isFinite(s.y)&&circleIsClear(world,s.x,s.y,s.radius);
    }
    window.__weaponStressAdvance=()=>{
      for(let i=0;i<1800;i++){
        for(const s of soldiers){physics.step(s,1/60,stats);combat.updateSoldier(s,1/60);}
        combat.updateBullets(1/60);combat.goo.update(1/60);combat.drones.update(1/60);combat.laser.update(1/60);
        ctx.clearRect(0,0,canvas.width,canvas.height);drawWeaponExpansion(ctx,fakeGame,mobile);drawGoo(ctx,camera,combat.goo,mobile,mobile);
      }
      return {drones:combat.drones.pool.activeCount,mines:combat.goo.mines.activeCount,segments:combat.laser.segments.activeCount};
    };
    sim.sort((a,b)=>a-b);render.sort((a,b)=>a-b);
    return{mobile,cpuThrottle:mobile?4:1,frames:600,simP95Ms:+sim[570].toFixed(3),renderP95Ms:+render[570].toFixed(3),maxDrones,maxMines,maxSegments,valid,droneShots:combat.drones.shots,prismHits:combat.laser.hits};
   },mobile);
   assert.ok(report.valid);assert.ok(report.maxDrones<=24&&report.maxMines<=96&&report.maxSegments<=256);assert.ok(report.droneShots>0&&report.prismHits>0);
   const memory=await profile.newCDPSession(p);await memory.send('HeapProfiler.collectGarbage');
   const before=(await memory.send('Runtime.getHeapUsage')).usedSize;
   const counts=await p.evaluate(()=>window.__weaponStressAdvance());
   await memory.send('HeapProfiler.collectGarbage');
   const after=(await memory.send('Runtime.getHeapUsage')).usedSize;
   report.heapDeltaBytes=after-before;report.extraMemoryStressFrames=1800;
   assert.ok(after-before<1024*1024,'Retained heap grew by more than 1 MiB after warm-up');
   assert.ok(counts.drones<=24&&counts.mines<=96&&counts.segments<=256);
   profiles.push(report);await profile.close();
  }
  assert.deepEqual(errors,[]);
  const report={mutations,live,profiles,pageErrors:errors};fs.writeFileSync(path.join(artifacts,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({status:'passed',artifacts,profiles}));await context.close();
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
