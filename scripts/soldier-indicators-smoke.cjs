/* Live-renderer checks for soldier miniatures and HUD-safe edge packing. Vite required. */
const fs=require('node:fs');let pw;try{pw=require('playwright')}catch{pw=require('/opt/codex/cua_node/lib/node_modules/playwright')}
(async()=>{const browser=await pw.chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});try{const rows=[];
 for(const device of [{name:'desktop',width:1200,height:900,dpr:1},{name:'phone',width:412,height:915,dpr:2.625},{name:'landscape',width:915,height:412,dpr:2.625}]){
  const context=await browser.newContext({viewport:{width:device.width,height:device.height},deviceScaleFactor:device.dpr,hasTouch:device.name!=='desktop',isMobile:device.name!=='desktop',reducedMotion:'reduce'}),page=await context.newPage();await page.route('https://fonts.googleapis.com/**',r=>r.abort());await page.goto('http://localhost:5173');await page.locator('[data-act="play"]').click();
  const result=await page.evaluate(async()=>{const g=window.__game,raf=requestAnimationFrame.bind(window);g.paused=true;window.requestAnimationFrame=()=>0;await new Promise(r=>raf(()=>raf(r)));g.transition.update(10);g.mainMenu.hide();g.reserves=0;g.camera.following=false;g.camera.zoom=1.13;g.camera.x=g.world.worldWidth/2;g.camera.y=g.world.worldHeight/2;g.fog.light.fill(1);
   const[{Soldier},{soldierShapeSprite},{soldierShapeIndex}]=await Promise.all([import('/src/entities/Soldier.ts'),import('/src/rendering/sprites.ts'),import('/src/entities/soldierShapes.ts')]);g.soldiers.length=0;
   const w=g.camera.viewW,h=g.camera.viewH,d=Math.max(w,h)*1.2;
   for(let i=0;i<8;i++){const angle=i*Math.PI/4,s=new Soldier(g.camera.screenToWorldX(w/2+Math.cos(angle)*d),g.camera.screenToWorldY(h/2+Math.sin(angle)*d),1,0,0,'pistol','free',i);s.facingAngle=i*.41;g.soldiers.push(s);}
   g.hud.update(g,performance.now(),true);await new Promise(r=>raf(()=>raf(r)));g.updateFlashPolygons();g.renderer.draw();
   const check=()=>{const markers=g.renderer.offscreenSoldiers.active;
    for(let i=0;i<markers.length;i++){const m=markers[i];if(m.x-16<0||m.y-16<0||m.x+16>w||m.y+16>h)throw Error('Clipped marker');
     const expected=soldierShapeSprite(soldierShapeIndex(m.soldier.slotIndex),m.soldier.facingAngle,false),actualPixels=m.sprite.getContext('2d').getImageData(0,0,m.sprite.width,m.sprite.height).data,expectedPixels=expected.getContext('2d').getImageData(0,0,expected.width,expected.height).data;if(actualPixels.length!==expectedPixels.length||actualPixels.some((v,k)=>v!==expectedPixels[k]))throw Error('Wrong soldier miniature');
     for(const r of g.hud.soldierIndicatorLayout.obstacles)if(m.x+16>r.x&&m.x-16<r.x+r.width&&m.y+16>r.y&&m.y-16<r.y+r.height)throw Error('Marker overlaps HUD '+JSON.stringify({m:{x:m.x,y:m.y},r}));
     for(let j=0;j<i;j++)if(Math.abs(m.x-markers[j].x)<32&&Math.abs(m.y-markers[j].y)<32)throw Error('Markers overlap');
    }return markers.map(m=>({slot:m.soldier.slotIndex,x:m.x,y:m.y,edge:m.edge}));};
   const markers=check();if(markers.length!==8)throw Error('Missing offscreen soldiers');window.__indicatorTest={g,raf,check,soldierShapeSprite,soldierShapeIndex};return{markers};
  });
  await page.screenshot({path:'/tmp/soldier-indicators-'+device.name+'.png',scale:'css'});
  const checks=await page.evaluate(()=>{const{g,check,soldierShapeSprite,soldierShapeIndex}=window.__indicatorTest,w=g.camera.viewW,h=g.camera.viewH;
   g.soldiers[0].x=g.camera.x;g.soldiers[0].y=g.camera.y;g.soldiers[1].alive=false;g.renderer.draw();if(check().length!==6)throw Error('Onscreen/dead soldier kept marker');
   for(const s of g.soldiers){s.alive=true;s.x=g.camera.screenToWorldX(-200);s.y=g.camera.screenToWorldY(h/2);}
   g.renderer.draw();if(check().length!==8)throw Error('Crowded edge lost soldiers');
   const s=g.soldiers[0],sprite=soldierShapeSprite(soldierShapeIndex(s.slotIndex),s.facingAngle,false),size=Math.round(sprite.width*2*g.camera.zoom);
   // The sphere's opaque extent is inside the shared sprite canvas padding.
   s.x=g.camera.screenToWorldX(-2);s.y=g.camera.screenToWorldY(h/2);g.renderer.draw();
   if(g.renderer.offscreenSoldiers.active.some(m=>m.soldier===s))throw Error('Partly visible soldier retained marker');
   s.x=g.camera.screenToWorldX(-size);g.renderer.draw();if(!g.renderer.offscreenSoldiers.active.some(m=>m.soldier===s))throw Error('Fully offscreen sprite lost marker');
   for(const s of g.soldiers){s.x=g.camera.x;s.y=g.camera.y;}g.renderer.draw();if(g.renderer.offscreenSoldiers.active.length!==0)throw Error('Markers did not clear');
   g.soldiers[0].x=g.camera.screenToWorldX(-200);g.renderer.draw();
   g.soldiers.length=0;g.renderer.draw();if(g.renderer.offscreenSoldiers.active.length)throw Error('Empty squad retained marker state');
   return{partlyVisibleHidden:true,individualSprites:true,allEightDirections:true,crowdedEdge:true,noHudOverlap:true,deadAndOnscreenHidden:true,clearOnReturn:true};
  });rows.push({device,...result,...checks});await context.close();
 }
 const result={rows};fs.writeFileSync('/tmp/soldier-indicators-smoke.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
