/* Run against Vite to verify surveyed deployment and persistent Exotic Matter. */
const assert = require('node:assert/strict');
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/codex/cua_node/lib/node_modules/playwright'); }

(async () => {
  const browser = await pw.chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
  try {
    for (const viewport of [{ width: 1200, height: 900 }, { width: 412, height: 915 }]) {
      const page = await browser.newPage({ viewport });
      await page.goto('http://localhost:5173');
      await page.locator('[data-act="play"]').click();
      const result = await page.evaluate(async () => {
        const g = window.__game;
        const raf = requestAnimationFrame.bind(window);
        window.requestAnimationFrame = () => 0;
        await new Promise(resolve => raf(() => raf(resolve)));
        g.transition.update(10);
        const { sectorAtCell, sectorSpawnCell } = await import('/src/world/labMap.ts');
        const { generatorKey } = await import('/src/world/ExoticMatter.ts');
        const frame = g.world.labLayout.frame;
        const core = g.world.blightCores.find(c => c.alive && c.size === 2 && sectorAtCell(frame, c.cx, c.cy) !== frame.def.start);
        const sector = sectorAtCell(frame, core.cx, core.cy);
        const unknown = Array.from({ length: g.labProgress.sectorCount }, (_, i) => i)
          .find(i => i !== sector && !g.labProgress.discovered.has(i) && g.labProgress.generatorCount(i) === 0);
        const at = sectorSpawnCell(frame, unknown);
        g.labMap.show();
        if (g.canDeployInto(sector) || g.canDeployInto(unknown)) throw Error('Unsurveyed sector deployable');
        g.labProgress.discovered.add(sector);
        g.labMap.select(sector);
        if (g.labMap.deployBtn.disabled || g.labProgress.conquered.has(sector)) throw Error('Surveyed active sector should allow deployment');
        const accessibleLabel = g.labMap.tiles[sector].getAttribute('aria-label');
        g.labMap.select(unknown);
        if (!g.labMap.deployBtn.disabled || g.labMap.tiles[unknown].classList.contains('conquered')) throw Error('Unsurveyed tile marked cleared');
        g.labMap.hide();
        g.labProgress.update([at]);
        if (!g.canDeployInto(unknown) || !g.labProgress.conquered.has(unknown)) throw Error('Empty sector did not auto-clear');

        const id = generatorKey(core);
        const balance = g.save.data.exoticMatter;
        for (const index of core.cells.slice(0, -1)) g.world.damage(index % g.world.width, Math.floor(index / g.world.width), 1e9);
        if (g.save.data.exoticMatter !== balance || g.exoticBursts.shows.length) throw Error('Partial destruction granted DNA');
        const last = core.cells.at(-1);
        g.world.damage(last % g.world.width, Math.floor(last / g.world.width), 1e9);
        if (g.save.data.exoticMatter !== balance + 1 || g.labSave.destroyedGenerators[id] !== true) throw Error('DNA not granted on the kill');
        if (g.exoticBursts.shows.length !== 1) throw Error('Expected the cosmetic DNA show');
        g.labSave.spawn = sector;
        g.startRun();
        if (g.world.blightCores.find(c => generatorKey(c) === id)?.alive !== false) throw Error('Generator respawned at a different landing');
        if (g.save.data.exoticMatter !== balance + 1 || g.exoticBursts.shows.length) throw Error('DNA paid twice or show survived regeneration');
        g.labSave.spawn = frame.def.start;
        g.startRun();
        if (g.world.blightCores.find(c => generatorKey(c) === id)?.alive !== false) throw Error('Generator respawned');
        return { accessibleLabel, id, balance: balance + 1 };
      });
      await page.reload();
      await page.waitForFunction(() => !!window.__game);
      const reloaded = await page.evaluate(id => ({ wallet: window.__game.save.data.exoticMatter, claimed: window.__game.labSave.destroyedGenerators[id] }), result.id);
      assert.match(result.accessibleLabel, /AVAILABLE.*Uncleared/);
      assert.equal(reloaded.wallet, result.balance);
      assert.equal(reloaded.claimed, true);
      await page.close();
    }
    console.log('Surveyed deployments and one-time Exotic Matter passed on desktop and mobile.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
