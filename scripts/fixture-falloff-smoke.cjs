/* Requires Vite. Compare cached fixture falloff with direct calculations and pixels. */
let pw;try{pw=require('playwright')}catch{pw=require('/opt/codex/cua_node/lib/node_modules/playwright')}
(async()=>{const browser=await pw.chromium.launch({executablePath:process.env.BREACH_CHROMIUM||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});try{const page=await browser.newPage({viewport:{width:1000,height:700}});await page.goto(process.env.BREACH_BASE_URL||'http://127.0.0.1:5173');await page.locator('[data-act="play"]').click();console.log(await page.evaluate(()=>{
const g=window.__game;g.paused=true;for(let i=0;i<150;i++)g.lighting.updateFixtures(g.camera);
const lr=g.renderer.lightRenderer;lr.updateWallLight(g);
const lamp=g.lighting.fixtures.filter(f=>f&&f.lit.count>0).sort((a,b)=>b.lit.count-a.lit.count)[0];if(!lamp)throw Error('No traced fixture');
const lut=Float32Array.from({length:65*3},(_,i)=>((i*13)%251)*.73);
const add=(fixed,strength)=>lr.addWallLight(g,lamp.lit,lamp.x,lamp.y,lamp.radius,strength,lut,fixed);
for(const strength of [.02,.35,1]){
 lr.wallImage.data.fill(0);lr.wallChunks.fill(0);add(false,strength);const expected=lr.wallImage.data.slice(),chunks=lr.wallChunks.slice();
 lr.wallImage.data.fill(0);lr.wallChunks.fill(0);add(true,strength);
 if(expected.some((v,i)=>v!==lr.wallImage.data[i])||chunks.some((v,i)=>v!==lr.wallChunks[i]))throw Error('Wall-light pixels or chunk mask differ');
}
const measure=fixed=>{const samples=[];for(let repeat=0;repeat<7;repeat++){const t=performance.now();for(let i=0;i<3000;i++)add(fixed,.35);samples.push(performance.now()-t)}samples.sort((a,b)=>a-b);return samples[3]};
const directMs=measure(false),cachedMs=measure(true);
// A new LitCells object from a shadow retrace must calculate fresh offsets.
lamp.lit={cells:lamp.lit.cells.slice(),count:lamp.lit.count};lr.wallImage.data.fill(0);add(false,.6);const expected=lr.wallImage.data.slice();lr.wallImage.data.fill(0);add(true,.6);if(expected.some((v,i)=>v!==lr.wallImage.data[i]))throw Error('Retrace reused stale falloff');
return{cellsPerFixture:lamp.lit.count,fixtureAccumulations:3000,directMs,cachedMs,pixelComparison:'identical'};
}));}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
