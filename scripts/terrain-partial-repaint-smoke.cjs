/* Vite required. Compare incremental artwork with forced full-chunk rebuilds. */
const fs = require('node:fs');
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/codex/cua_node/lib/node_modules/playwright'); }
(async () => {
  const browser = await pw.chromium.launch({executablePath:'/usr/bin/chromium', args:['--no-sandbox']});
  try {
    const page = await browser.newPage();
    await page.goto('http://localhost:5173');
    const result = await page.evaluate(async () => {
      const [{TerrainRenderer}, {PixelWorld, MAT, SUB}, {CameraSystem}] = await Promise.all([
        import('/src/rendering/TerrainRenderer.ts'), import('/src/world/PixelWorld.ts'), import('/src/systems/CameraSystem.ts'),
      ]);
      // Non-multiple dimensions also exercise padded pixels in the final chunks.
      const w = new PixelWorld({width:65,height:67,cellSize:8,roomSize:4});
      const a = new TerrainRenderer(w,32), b = new TerrainRenderer(w,32);
      w.decor.fill(1);
      a.rebuildAll(); b.rebuildAll();
      let comparisons = 0;
      const same = (ca, cb, label) => {
        comparisons++;
        if (!ca || !cb) { if (ca !== cb) throw Error(label+' canvas presence'); return; }
        const aa = ca.getContext('2d').getImageData(0,0,ca.width,ca.height).data;
        const bb = cb.getContext('2d').getImageData(0,0,cb.width,cb.height).data;
        for (let i=0;i<aa.length;i++) if (aa[i]!==bb[i]) throw Error(label+' channel '+i+': '+aa[i]+' / '+bb[i]);
      };
      const check = label => {
        while(a.chunks.pending) a.update();
        // Unlike the incremental renderer, the oracle paints every cell each time.
        b.rebuildAll();
        a.flushFloor();
        same(a.floorCanvas,b.floorCanvas,label+' floor');
        for (let k=0;k<a.canvases.length;k++) {
          same(a.canvases[k],b.canvases[k],label+' albedo '+k);
          same(a.blightCanvases[k],b.blightCanvases[k],label+' blight '+k);
          same(a.edgeMasks[k],b.edgeMasks[k],label+' live mask '+k);
          same(a.dormantMasks[k],b.dormantMasks[k],label+' dormant mask '+k);
        }
      };
      // All fine-cell orientations at a chunk seam, then removal in reverse.
      // A stale scratch-image upload would overwrite a different edit island.
      for (let n=0;n<64;n++) {
        w.setSubCell(60+n%8,60+Math.floor(n/8),10);
        if(n%8===7)check('fine seam growth '+n);
      }
      for (let n=63;n>=0;n--) {
        w.damageSub(60+n%8,60+Math.floor(n/8),1000);
        if(n%8===0)check('fine seam removal '+n);
      }
      let regionCalls=0;
      const paint=a.paintChunkRegion;
      a.paintChunkRegion=function(...args){regionCalls++;return paint.apply(this,args);};
      w.setSubCell(4,4,10);w.setSubCell(56,56,10);
      check('separated fine edit islands');
      a.paintChunkRegion=paint;
      if(regionCalls<2)throw Error('Sparse repaint path was not exercised');
      for (let frame=0;frame<48;frame++) {
        // Seams, diagonals, world borders, and repeated edits before budgeted flushes.
        for (const [x,y] of [[0,0],[31,31],[32,32],[31,32],[64,66],[12+frame%9,10]]) {
          const i=y*w.width+x;
          if(frame%4===0) { w.mat[i]=frame%8 ? MAT.glass : MAT.crystal; w.setCell(x,y,30,'grown'); }
          if(frame%4===1) w.damage(x,y,1);
          if(frame%4===2) { w.setCell(x,y,0,'destroyed'); w.setSubCell(x*2,y*2,10); }
          if(frame%4===3) w.damageSub(x*2,y*2,1000);
        }
        if(frame===12) {
          const dormant = si => (si%3)===0;
          a.dormantAt=b.dormantAt=dormant;
          a.chunks.markAll();
        }
        if(frame===28) { a.dormantAt=b.dormantAt=null; a.chunks.markAll(); }
        check('frame '+frame);
      }
      // Independent subcell artwork edits use explicit visual invalidation.
      w.setCell(20,20,0);w.setSubCell(40,40,10);
      check('isolated Blight before HP damage');
      let hpClassificationQueries = 0;
      const classify = w.isBlightSubAt;
      w.isBlightSubAt = function(...args) { hpClassificationQueries++; return classify.apply(this,args); };
      w.damageSub(40,40,1);
      while(a.chunks.pending) a.update();
      w.isBlightSubAt = classify;
      if(hpClassificationQueries) throw Error('HP-only damage reclassified Blight');
      check('HP-only cached classification');
      const si=40*w.subWidth+40;
      for (const kind of [SUB.rubble,SUB.screen,SUB.core,SUB.metal,SUB.blight]) {
        w.subKind[si]=kind;w.subTint[si]=137;a.chunks.markCell(20,20);
        check('subkind '+kind);
      }
      // No stale Blight remains when its final subcell disappears, then reappears.
      w.subHealth.fill(0);w.health.fill(0);w.blight.fill(0);a.chunks.markAll();a.buildFloor();check('empty');
      if(a.blightCells.some(Boolean) || a.blightCellCounts.some(Boolean)) throw Error('Empty chunks retain Blight classification');
      w.setSubCell(63,63,10);check('reappear');
      const cam = new CameraSystem(w);cam.viewW=600;cam.viewH=450;cam.x=260.37;cam.y=268.71;
      const canvases=[a,b].map(()=>{const c=document.createElement('canvas');return c;});
      for(const scale of [.75,1,1.25,1.5,2,3])for(const zoom of [.5,1.13,2.5,2.75]) {
        cam.zoom=zoom;
        for(const [j,r] of [a,b].entries()) {
          const c=canvases[j];c.width=600*scale;c.height=450*scale;
          const ctx=c.getContext('2d');ctx.setTransform(scale,0,0,scale,0,0);
          r.draw(ctx,cam);r.drawSurfaceOutlines(ctx,cam);r.drawBlightThroughFog(ctx,cam);r.drawBlightEdges(ctx,cam,3.25);
        }
        same(...canvases,'composite '+scale+' / '+zoom);
      }
      const beforeViewportChecks = comparisons;
      cam.viewW = 156;
      cam.viewH = 130;
      cam.x = cam.y = 70;
      cam.zoom = 2.5;
      // Distant edits include glass opacity, Blight edges and decor contact shadows.
      const far = 37 * w.width + 37;
      w.mat[far] = MAT.glass;
      w.setCell(37, 37, 30, 'set');
      w.setGlassCracked(37, 37, true);
      w.setSubCell(76, 76, 10);
      const floorBefore = a.floorRevision;
      a.update(cam);
      if (!a.chunks.pending || a.rebuiltLastFrame !== 0 || a.floorRevision !== floorBefore) {
        throw Error('Off-screen edits published early');
      }
      b.rebuildAll();
      for (const [x, y, zoom] of [[70, 70, 2.5], [297.2, 298.7, 1.13], [515, 524, 2.75], [70, 70, .5]]) {
        cam.x = x; cam.y = y; cam.zoom = zoom;
        a.update(cam);
        if (a.visiblePendingLastFrame !== 0) throw Error('Visible artwork not ready after camera movement');
        for (const scale of [1, 1.5, 2]) {
          for (const [j, r] of [a, b].entries()) {
            const c = canvases[j];
            c.width = cam.viewW * scale; c.height = cam.viewH * scale;
            const ctx = c.getContext('2d');
            ctx.setTransform(scale, 0, 0, scale, 0, 0);
            r.drawFloor(ctx, cam);
            r.draw(ctx, cam);
            r.drawSurfaceOutlines(ctx, cam);
            r.drawBlightThroughFog(ctx, cam);
            r.drawBlightEdges(ctx, cam, 3.25);
          }
          same(...canvases, 'viewport ' + [x, y, zoom, scale].join('/'));
        }
      }

      // A thumbnail can sample a region the live viewport has never updated.
      w.setCell(62, 63, 10, 'grown');
      a.update(cam);
      if (!a.chunks.pending) throw Error('Thumbnail fixture did not leave pending chunks');
      b.rebuildAll();
      for (const [j, r] of [a, b].entries()) {
        const c = canvases[j];
        c.width = c.height = 24;
        r.drawRegion(c.getContext('2d'), 60, 61, 6, 6);
      }
      same(...canvases, 'off-screen thumbnail');
      const viewportComparisons = comparisons - beforeViewportChecks;
      return {comparisons,viewportComparisons,changedChannels:0,hpClassificationQueries,sparseRegionCalls:regionCalls,emptyClassificationReleased:true};
    });
    console.log(JSON.stringify(result));
    fs.writeFileSync(process.env.BREACH_REPORT||'/tmp/terrain-partial-repaint-regressions.json',JSON.stringify(result,null,2));
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
