/* Vite required. Check first deployment, containment, glass artwork and fog pixels. */
const assert = require('node:assert/strict');
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/codex/cua_node/lib/node_modules/playwright'); }
(async () => {
  const browser = await pw.chromium.launch({executablePath: process.env.BREACH_CHROMIUM || '/usr/bin/chromium', headless: true, args: ['--no-sandbox']});
  try {
    for (const [width, height, deviceScaleFactor] of [[1100,760,1],[390,844,3]]) {
      const context = await browser.newContext({viewport:{width,height},deviceScaleFactor});
      const page = await context.newPage(), errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(process.env.BREACH_BASE_URL || 'http://127.0.0.1:5173');
      await page.locator('[data-act="play"]').click();
      await page.waitForTimeout(400);
      const result = await page.evaluate(async () => {
        const g = window.__game, w = g.world, c = g.camera;
        if (g.runStats.time !== 0 || g.runStats.soldiersDeployed !== 0) throw Error('Simulation ran before deployment');
        const tube = w.startingTube, core = w.blightCores[tube.coreId-1];
        if (!core.alive) throw Error('Starter generator was cleared by default save progress');
        // Run many direct steps: the same wait applies outside RAF.
        const snapshot = [g.growth.totalEvents, g.combat.bullets.items.length, g.runStats.time];
        for (let i=0;i<120;i++) g.step(1/60);
        if (JSON.stringify(snapshot)!==JSON.stringify([g.growth.totalEvents,g.combat.bullets.items.length,g.runStats.time])) throw Error('Waiting state advanced simulation');
        if (g.deploySoldier(-1000,-1000,1,0)) throw Error('Deployment into protected map boundary succeeded');
        if (g.runStats.time !== 0 || g.runStats.soldiersDeployed !== 0) throw Error('Failed deployment started simulation');
        const s = g.deploySoldier(w.roomCenterX,w.roomCenterY,1,0);
        if (!s) throw Error('First deployment failed');
        g.step(1/60);
        if (g.runStats.time <= 0) throw Error('Simulation did not start after placement');
        // Stop RAF so all pixel comparisons see a fixed frame.
        const raf=requestAnimationFrame.bind(window);window.requestAnimationFrame=()=>0;g.paused=true;
        await new Promise(r=>raf(()=>raf(r)));
        g.save.data.settings.devMode=false;g.save.data.settings.devMapAccess=false;
        c.x=w.roomCenterX;c.y=w.roomCenterY;c.zoom=4;c.following=false;
        const flush=()=>{while(g.terrain.chunks.pending)g.terrain.update();};
        const pixel=(wx,wy)=>{const d=g.canvas.width/c.viewW;return [...g.canvas.getContext('2d').getImageData(Math.round(c.worldToScreenX(wx)*d),Math.round(c.worldToScreenY(wy)*d),1,1).data];};
        // Place adjacent Blight, rubble and ordinary terrain in unseen fog.
        const cx=Math.floor(c.x/w.cellSize),cy=Math.floor(c.y/w.cellSize)+2;
        w.setCell(cx,cy,20,'grown');
        w.setCell(cx+1,cy,20);
        w.setCell(cx+2,cy,0);w.subKind[cy*2*w.subWidth+(cx+2)*2]=1;w.setSubCell((cx+2)*2,cy*2,10,'set');
        w.setCell(cx-1,cy,0);w.setSubCell((cx-1)*2,cy*2,10,'grown');
        flush();g.fog.light.fill(0);g.renderer.draw();
        const blight=pixel((cx+.5)*w.cellSize,(cy+.5)*w.cellSize);
        const ordinary=pixel((cx+1.5)*w.cellSize,(cy+.5)*w.cellSize);
        const rubble=pixel((cx+2.25)*w.cellSize,(cy+.25)*w.cellSize);
        const half=pixel((cx-.75)*w.cellSize,(cy+.25)*w.cellSize);
        const fog=[3,4,8];
        if (blight.slice(0,3).every((v,i)=>v===fog[i]) || half.slice(0,3).every((v,i)=>v===fog[i])) throw Error('Blight hidden by fog');
        if (!ordinary.slice(0,3).every((v,i)=>v===fog[i]) || !rubble.slice(0,3).every((v,i)=>v===fog[i])) throw Error('Non-Blight leaked through fog');
        w.setCell(cx,cy,0);w.setSubCell((cx-1)*2,cy*2,0,'destroyed');flush();g.renderer.draw();
        if (!pixel((cx+.5)*w.cellSize,(cy+.5)*w.cellSize).slice(0,3).every((v,i)=>v===fog[i])) throw Error('Removed Blight retained fog silhouette');
        // Actual cached glass artwork must change on crack and return on reset.
        const canvas=document.createElement('canvas');canvas.width=c.viewW;canvas.height=c.viewH;const ctx=canvas.getContext('2d');
        const paneX=core.cx+1,paneY=core.cy;
        c.x=(paneX+.5)*w.cellSize;c.y=(paneY+.5)*w.cellSize;
        const render=()=>{flush();ctx.clearRect(0,0,canvas.width,canvas.height);g.terrain.draw(ctx,c,false);return ctx.getImageData(0,0,canvas.width,canvas.height).data;};
        const intact=render();
        w.setGlassCracked(paneX,paneY,true);const cracked=render();
        if (!intact.some((v,i)=>v!==cracked[i])) throw Error('Cracked glass has no distinct sprite');
        w.setGlassCracked(paneX,paneY,false);const restored=render();
        if (intact.some((v,i)=>v!==restored[i])) throw Error('Glass crack reset retained artwork');
        g.startRun();if(g.runStats.time!==0||g.runStats.soldiersDeployed!==0)throw Error('New run did not return to waiting state');
        g.transition.update(10);g.renderer.draw();
        return {blight,half,ordinary,rubble,time:g.runStats.time,tube};
      });
      await page.screenshot({path:`/tmp/starting-tube-${width}.png`});
      assert.deepEqual(errors,[]);
      console.log(JSON.stringify({width,deviceScaleFactor,...result,pageErrors:errors}));
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1});
