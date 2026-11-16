/* Check deferred map allocation and same-world DOM/canvas reuse against the
 * original map, preserving all generated thumbnail pixels and labels. */
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
let pw;try{pw=require('playwright')}catch{pw=require('/opt/codex/cua_node/lib/node_modules/playwright')}
const root=path.resolve(__dirname,'..');fs.mkdirSync(path.join(root,'node_modules/.cache'),{recursive:true});const dir=fs.mkdtempSync(path.join(root,'node_modules/.cache/map-oracle-'));
execFileSync('tar',['-x','-C',dir],{input:execFileSync('git',['archive',process.env.BREACH_BASELINE_REF||'4bb50da','src'],{cwd:root,maxBuffer:32*1024*1024})});
(async()=>{const browser=await pw.chromium.launch({executablePath:process.env.BREACH_CHROMIUM||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});try{
const page=await browser.newPage();await page.goto(process.env.BREACH_BASE_URL||'http://127.0.0.1:5173');await page.locator('[data-act="play"]').click();
const result=await page.evaluate(async base=>{
 const g=window.__game,raf=requestAnimationFrame.bind(window);window.requestAnimationFrame=()=>0;g.paused=true;await new Promise(r=>raf(()=>raf(r)));
 const {LabMap}=await import(base+'/src/ui/LabMap.ts'),map=g.labMap,clock=performance.now.bind(performance);
 if(map.canvases.length!==0)throw Error('Hidden map allocated tiles before first open');
 const reference=new LabMap(document.createElement('div'),g);reference.setThumbs(map.thumbs);
 map.show();reference.show();let pixelChecks=0;
 const compare=()=>{if(map.canvases.length!==reference.canvases.length)throw Error('Sector counts differ');for(let i=0;i<map.canvases.length;i++){
  const a=map.canvases[i],b=reference.canvases[i],aa=a.getContext('2d').getImageData(0,0,a.width,a.height).data,bb=b.getContext('2d').getImageData(0,0,b.width,b.height).data;
  for(let k=0;k<aa.length;k++)if(aa[k]!==bb[k])throw Error('Map pixels differ: '+i);pixelChecks++;
 }};compare();
 const tile=map.tiles[0],canvas=map.canvases[0];let reusedMs=0,rebuiltMs=0;
 for(let i=0;i<5;i++){map.hide();let start=clock();map.show();reusedMs+=clock()-start;reference.hide();start=clock();reference.show();rebuiltMs+=clock()-start}
 if(map.tiles[0]!==tile||map.canvases[0]!==canvas)throw Error('Same-world map rebuilt its tiles');compare();
 g.save.data.settings.devMode=true;g.save.data.settings.devMapAccess=true;
 g.selectLabWorld(5);map.show();reference.setThumbs(map.thumbs);reference.show();compare();
 if(map.tiles[0]===tile||map.canvases.length!==21)throw Error('World switch did not rebuild the rectangular map');
 return{status:'passed',pixelChecks,initialHiddenTileCanvases:0,reusedTileIdentity:true,reopenedMaps:5,reusedMs,referenceRebuildMs:rebuiltMs,switchedWorldTiles:map.canvases.length};
},'/'+path.relative(root,dir).split(path.sep).join('/'));
fs.writeFileSync('/tmp/breach-labmap-render.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>fs.rmSync(dir,{recursive:true,force:true}));
