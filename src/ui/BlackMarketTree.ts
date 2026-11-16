import type { Game } from "../Game";
import { marketFor, type MarketPath } from "../progression/BlackMarket";
import { UPGRADE_BY_ID, type UpgradeId } from "../progression/UpgradeDefinitions";
import type { WeaponType } from "../entities/Soldier";
import { perlin } from "../rendering/blightEssence";
import { SPRITES, sprite } from "./pixelArt";
import { essenceIcon } from "./essenceIcon";

/** A separate tree: standard weapon research never grows mutation nodes. */
export class BlackMarketTree {
  readonly root = document.createElement("div");
  private canvas: HTMLCanvasElement | null = null;
  private mask = new Uint8Array(0);
  private distance = new Float32Array(0);
  private lastTick = -1;

  constructor(private game: Game, private changed: () => void) {
    this.root.className = "bm-tree hidden";
  }

  render(weapon: WeaponType): void {
    const market = marketFor(weapon)!;
    const u = this.game.upgrades;
    if (!u.marketOpen(weapon)) {
      this.root.innerHTML = `<div class="bm-intro"><h2>BLACK MARKET</h2><p>Purchase Black Market access on this weapon's standard tree.</p></div>`;
      this.canvas = null;
      return;
    }
    const active = u.activeMarketPath(weapon);
    const pathHtml = (path: MarketPath): string => {
      const selected = active?.root === path.root;
      return `<section class="bm-path ${selected ? "selected" : active ? "inactive" : ""}" data-path="${path.root}">
        ${(selected ? path.nodes : [path.root]).map((id,index)=>{
          const def=UPGRADE_BY_ID[id], level=u.levelOf(id), root=index===0;
          const canBuy=u.canBuy(id), maxed=u.isMaxed(id);
          const prices=u.pricesOf(id).map(p=>`${p.currency==="essence"?essenceIcon(1):p.currency.replace("greenCrystals","green crystals")} ${p.amount.toLocaleString()}`).join(" + ");
          const action=root ? selected ? "ACTIVE PATH" : level>0 ? "RE-BUY TO SWITCH" : active ? "BUY TO SWITCH" : "CHOOSE PATH"
            : maxed ? "MAX" : !selected ? "INACTIVE PATH" : !u.isUnlocked(id) ? "BUY PREREQUISITE FIRST" : "UPGRADE";
          return `<button class="bm-node ${root?"bm-choice":""}" data-market-buy="${id}" ${canBuy?"":"disabled"} aria-label="${def.name}: ${action}">
            ${sprite(def.icon,{color:selected?"#ffae62":"#e066a5",scale:2})}
            <strong>${def.name.replace(/^Unlock /,"")}</strong>
            <span class="bm-desc">${def.shortDesc}</span>
            <span class="bm-action">${action}</span>
            ${!maxed?`<span class="bm-price">${prices}</span>`:""}
            ${!root?`<span class="bm-level">${level}/${def.maxLevel}</span>`:""}
          </button>`;
        }).join("")}
      </section>`;
    };
    this.root.innerHTML = `<div class="bm-heading">BLACK MARKET · ${market.label.toUpperCase()}</div>
      <p class="bm-rule">One active path. Re-buy the other to switch. Previous research is retained.</p>
      <div class="bm-layout ${market.paths.length>2?"three-paths":""}">
        ${market.paths[2]?`<div class="bm-upward">${pathHtml(market.paths[2])}</div>`:""}
        ${pathHtml(market.paths[0])}
        <div class="bm-hub"><canvas class="bm-weapon" width="144" height="144" role="img" aria-label="${market.label} silhouette with a Blight perimeter"></canvas><span>${market.label.toUpperCase()}</span><span class="bm-hub-mark">${essenceIcon(2)}</span></div>
        ${pathHtml(market.paths[1])}
      </div>`;
    this.canvas = this.root.querySelector("canvas.bm-weapon")!;
    this.prepareSilhouette(market.icon);
    this.frame(0);
    this.root.querySelectorAll<HTMLButtonElement>("[data-market-buy]").forEach(button=>{
      button.addEventListener("click",()=>{
        if (!u.buy(button.dataset.marketBuy as UpgradeId)) return;
        this.game.applyUpgrades();
        this.game.onUpgradePurchased?.();
        this.changed();
      });
    });
  }

  private prepareSilhouette(icon: keyof typeof SPRITES): void {
    const grid: readonly string[] = SPRITES[icon];
    const size=144, gw=Math.max(...grid.map(row=>row.length)), gh=grid.length;
    const scale=Math.max(1,Math.floor(86/Math.max(gw,gh)));
    const x0=Math.floor((size-gw*scale)/2), y0=Math.floor((size-gh*scale)/2);
    this.mask=new Uint8Array(size*size);
    for(let y=0;y<gh;y++)for(let x=0;x<grid[y].length;x++){
      if(grid[y][x]===".")continue;
      for(let oy=0;oy<scale;oy++)for(let ox=0;ox<scale;ox++)this.mask[(y0+y*scale+oy)*size+x0+x*scale+ox]=1;
    }
    // Chamfer distance outside the silhouette, computed only when changing weapons.
    const d=this.distance=new Float32Array(size*size);d.fill(999);
    for(let i=0;i<d.length;i++)if(this.mask[i])d[i]=0;
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){
      const i=y*size+x;
      if(x)d[i]=Math.min(d[i],d[i-1]+1);
      if(y)d[i]=Math.min(d[i],d[i-size]+1);
      if(x&&y)d[i]=Math.min(d[i],d[i-size-1]+Math.SQRT2);
      if(x<size-1&&y)d[i]=Math.min(d[i],d[i-size+1]+Math.SQRT2);
    }
    for(let y=size-1;y>=0;y--)for(let x=size-1;x>=0;x--){
      const i=y*size+x;
      if(x<size-1)d[i]=Math.min(d[i],d[i+1]+1);
      if(y<size-1)d[i]=Math.min(d[i],d[i+size]+1);
      if(x<size-1&&y<size-1)d[i]=Math.min(d[i],d[i+size+1]+Math.SQRT2);
      if(x&&y<size-1)d[i]=Math.min(d[i],d[i+size-1]+Math.SQRT2);
    }
    this.lastTick=-1;
  }

  frame(time: number): void {
    if (!this.canvas) return;
    const still=matchMedia("(prefers-reduced-motion: reduce)").matches;
    const tick=still?0:Math.floor(time/80);
    if(tick===this.lastTick)return;
    this.lastTick=tick;
    const ctx=this.canvas.getContext("2d")!, img=ctx.createImageData(144,144);
    for(let i=0;i<this.mask.length;i++){
      const p=i*4;
      if(this.mask[i]) { img.data[p+3]=255; continue; }
      const dist=this.distance[i];if(dist>10)continue;
      const x=i%144,y=Math.floor(i/144);
      const noise=perlin(x*.075,y*.075,tick*.07)*.7+perlin(x*.16,y*.16,tick*.1)*.3;
      const reach=4.5+noise*5;
      if(dist>reach)continue;
      const hot=Math.max(0,1-dist/reach);
      img.data[p]=255;img.data[p+1]=Math.round(45+hot*110);img.data[p+2]=Math.round(125-hot*65);
      img.data[p+3]=Math.round(255*Math.min(1,(reach-dist)*.75));
    }
    ctx.putImageData(img,0,0);
  }

}
