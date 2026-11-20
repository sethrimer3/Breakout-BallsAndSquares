/* Real map/deployment UI checks; includes screenshots for desktop and phone. Vite required. */
const fs=require('node:fs');let pw;try{pw=require('playwright')}catch{pw=require('/opt/codex/cua_node/lib/node_modules/playwright')}
(async()=>{const browser=await pw.chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});try{
 const rows=[];
 for(const size of [{width:1200,height:900,dpr:1,name:'desktop'},{width:412,height:915,dpr:2.625,name:'mobile'},{width:915,height:412,dpr:2.625,name:'landscape'}]){
  const context=await browser.newContext({viewport:{width:size.width,height:size.height},deviceScaleFactor:size.dpr,reducedMotion:'reduce',isMobile:size.name!=='desktop',hasTouch:size.name!=='desktop'});const page=await context.newPage();await page.route('https://fonts.googleapis.com/**',r=>r.abort());await page.goto('http://localhost:5173');await page.locator('[data-act="play"]').click();
  const states=await page.evaluate(async()=>{
   const g=window.__game,raf=requestAnimationFrame.bind(window);g.paused=true;window.requestAnimationFrame=()=>0;await new Promise(r=>raf(()=>raf(r)));
   const {sectorAtCell,sectorBounds,upgradeSpotSector}=await import('/src/world/labMap.ts');const frame=g.world.labLayout.frame,progress=g.labProgress,map=g.labMap;
   g.transition.update(10);
   g.mainMenu.hide();g.save.data.settings.devMode=false;g.save.data.settings.devMapAccess=false;
   const guard=g.wardens.wardens.find(w=>w.alive),guardSector=sectorAtCell(frame,Math.floor(guard.homeX/8),Math.floor(guard.homeY/8));
   const available=frame.def.start,unsecured=Array.from({length:81},(_,i)=>i).find(s=>s!==available&&!g.sectorGuarded(s));
   const unknown=frame.def.upgrades.map(spot=>upgradeSpotSector(frame.def,spot)).find(s=>s!==guardSector&&s!==available);
   progress.discovered.clear();progress.conquered.clear();progress.conquered.add(available);
   for(let s=0;s<frame.def.sectors*5;s++)progress.discovered.add(s);
   for(const s of [available,guardSector,unsecured])progress.discovered.add(s);progress.discovered.delete(unknown);
   map.show();const tile=map.tiles[0];
   for(const[s,state]of [[available,'available'],[guardSector,'guarded'],[unsecured,'unsecured'],[unknown,'unknown']]){
    map.select(s);if(map.tiles[s].dataset.deployment!==state)throw Error('State mismatch '+s+' / '+state);
    if(map.deployBtn.disabled===(state==='available'))throw Error('Deploy button mismatch '+state);
    if(!map.tiles[s].getAttribute('aria-label').includes(state==='unknown'?'UNSURVEYED':state==='guarded'?'WARDEN LOCK':state==='available'?'DEPLOYMENT AVAILABLE':'SECTOR NOT SECURED'))throw Error('Missing accessible state');
    if(state==='unknown'&&map.info.textContent.includes('WARDEN'))throw Error('Unknown sector leaked restriction');
   }
   map.select(guardSector);map.show();if(map.tiles[0]!==tile)throw Error('Map rebuilt stable tiles');map.select(guardSector);
   window.__deployTest={g,map,guardSector,guard,frame,sectorAtCell,sectorBounds,upgradeSpotSector,available,unknown};
   return{available,guarded:guardSector,unsecured,unknown};
  });
  await page.screenshot({path:'/tmp/deployment-sector-'+size.name+'.png',scale:'css'});
  const live=await page.evaluate(()=>{
   const {g,map,guardSector,guard,frame,sectorAtCell,upgradeSpotSector}=window.__deployTest;map.hide();g.paused=false;g.reserves=8;g.portal=null;g.runOver=false;
   g.camera.following=false;g.camera.zoom=1.13;g.camera.x=guard.homeX+30;g.camera.y=guard.homeY+20;g.input.mouseInside=false;g.fog.light.fill(1);
   g.updateFlashPolygons();g.renderer.draw();g.hud.update(g,performance.now(),true);
   if(g.hud.root.querySelector('.deployment-guide').classList.contains('hidden'))throw Error('Missing deployment legend');
   const ctx=g.canvas.getContext('2d'),original=ctx.fillText,texts=[];ctx.fillText=function(text,...args){texts.push(text);return original.call(this,text,...args);};
   g.renderer.draw();if(!texts.some(t=>t.includes('WARDEN LOCK')))throw Error('Missing guarded live sector label');
   g.aimState.active=true;g.aimState.startWx=guard.homeX;g.aimState.startWy=guard.homeY;
   g.renderer.drawAimIndicator();if(!texts.includes('WARDEN LOCK'))throw Error('Missing target lock reason');
   g.aimState.startWx=g.world.roomCenterX;g.aimState.startWy=g.world.roomCenterY;
   g.renderer.drawAimIndicator();if(!texts.includes('PORTAL READY'))throw Error('Clear point not marked ready');
   g.aimState.startWx=(frame.x0+.5)*8;g.aimState.startWy=(frame.y0+.5)*8;
   g.renderer.drawAimIndicator();if(!texts.includes('CLEAR GROUND REQUIRED'))throw Error('Solid ground advertised as ready');
   g.aimState.active=false;
   ctx.fillText=original;g.renderer.draw();
   const bar=g.hud.root.querySelector('.hud-bar').getBoundingClientRect(),guide=g.hud.root.querySelector('.deployment-guide').getBoundingClientRect();
   if(guide.top<bar.bottom+5)throw Error('Legend overlaps stat bar');
   return{legendVisible:true,guardedLabel:true,readyPoint:true,solidGroundReason:true,legendClearsHud:true};
  });
  await page.screenshot({path:'/tmp/deployment-live-'+size.name+'.png',scale:'css'});
  const transitions=await page.evaluate(()=>{
   const {g,map,guardSector,frame,sectorAtCell}=window.__deployTest;
   for(const w of g.wardens.wardens)if(sectorAtCell(frame,Math.floor(w.homeX/8),Math.floor(w.homeY/8))===guardSector)w.alive=false;
   const ctx=g.canvas.getContext('2d'),original=ctx.fillText,texts=[];ctx.fillText=function(text,...args){texts.push(text);return original.call(this,text,...args);};
   g.renderer.draw();ctx.fillText=original;if(!texts.some(t=>t.includes('OPEN ZONE')))throw Error('Defeated Wardens did not unlock live overlay');
   g.reserves=0;g.hud.update(g,performance.now(),true);if(!g.hud.root.querySelector('.deployment-guide').classList.contains('hidden'))throw Error('Guide stayed after reserves exhausted');
   g.paused=true;map.show();map.select(guardSector);if(map.tiles[guardSector].dataset.deployment!=='guarded')throw Error('Map ignored uncollected gold-block restriction');
   for(const spot of frame.def.upgrades)if(window.__deployTest.upgradeSpotSector(frame.def,spot)===guardSector&&!g.labSave.specials.includes(spot.id))g.labSave.specials.push(spot.id);
   g.labProgress.conquered.add(guardSector);map.render();if(map.tiles[guardSector].dataset.deployment!=='available'||map.deployBtn.disabled)throw Error('Collected block did not unlock conquered map sector');
   const panel=map.root.querySelector('.labmap-panel').getBoundingClientRect();if(panel.left<0||panel.right>innerWidth+1)throw Error('Map horizontal overflow');
   return{liveUnlocks:true,selectionRetainsGoldRequirement:true,selectionUnlocks:true,reservesHideGuide:true,horizontalOverflow:false};
  });
  rows.push({size,states,...live,...transitions});await context.close();
 }
 const result={rows};fs.writeFileSync('/tmp/deployment-map-smoke.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
