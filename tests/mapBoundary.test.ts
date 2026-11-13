import { beforeAll, describe, expect, it } from 'vitest';
import { WORLD } from '../src/config';
import { PixelWorld } from '../src/world/PixelWorld';
import { generateWorld } from '../src/world/WorldGenerator';
import { boundaryColor, installMapBoundary } from '../src/world/MapBoundary';
import { gateGeometry, LAB_WORLDS, labCells, SECTOR_CELLS, worldRows, type LabFrame } from '../src/world/labMap';
import { FreezeSystem } from '../src/systems/FreezeSystem';
import { RailLanceSystem } from '../src/systems/RailLanceSystem';
import { Soldier, baseSoldierStats } from '../src/entities/Soldier';
import { CombatSystem } from '../src/systems/CombatSystem';
import { Rng } from '../src/core/Rng';

const maps: PixelWorld[]=[];
beforeAll(()=>{for(let id=1;id<=5;id++){const w=new PixelWorld(WORLD);generateWorld(w,123,{labWorld:LAB_WORLDS[id]});maps[id]=w;}},20000);

describe('permanent map perimeters',()=>{
  it.each([1,2,3,4,5])('protects map %i, including its void, from damage and growth',id=>{
    const w=maps[id];
    expect(w.boundaryThickness).toBe(id===5?2:3);
    expect(w.boundaryStone).toBe(id===3||id===4);
    const layers=new Set<number>();
    let intact=true, clean=true;
    for(let i=0;i<w.boundary.length;i++) if(w.boundary[i]) {
      layers.add(w.boundary[i]);
      intact &&= w.health[i]===65535;
      clean &&= (w.blight[i]|w.coreId[i]|w.decor[i])===0;
    }
    expect(intact).toBe(true);expect(clean).toBe(true);
    expect(layers.has(255)).toBe(true);
    for(let layer=1;layer<=w.boundaryThickness;layer++) {
      const i=w.boundary.indexOf(layer),x=i%w.width,y=Math.floor(i/w.width);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(w.damage(x,y,1e9,true)).toBe(0);
      expect(w.damageSub(x*2,y*2,1e9,true)).toBe(0);
      w.setCell(x,y,0,'destroyed');w.setCell(x,y,1,'grown');w.setSubCell(x*2,y*2,50);
      expect(w.health[i]).toBe(65535);expect(w.blight[i]).toBe(0);
      expect(w.subHealth[y*2*w.subWidth+x*2]).toBe(0);
      expect(new FreezeSystem(w).freezeCell(x,y,0)).toBe(false);
      if(layer===w.boundaryThickness) expect(boundaryColor(w,x,y)).toEqual([0,0,0]);
      else expect(boundaryColor(w,x,y)[2]).toBeGreaterThan(0);
    }
    const f=w.labLayout!.frame!;
    expect(w.boundary[(yCenter(f))*w.width+f.x0+Math.floor(labCells(f.def)/2)]).toBe(0);
  });
  it('leaves every gate door and travel pocket inside the playable envelope',()=>{
    for(const w of maps.filter(Boolean)) {const f=w.labLayout!.frame!;
      for(const gate of f.def.gates) for(const b of Object.values(gateGeometry(f,gate))) {
        for(let y=b.y0;y<=b.y1;y++)for(let x=b.x0;x<=b.x1;x++) expect(w.boundary[y*w.width+x]).toBe(0);
      }
    }
  });
  it('uses exactly three flat metal layers indoors and two at the ship hull',()=>{
    for(const id of [1,2,5]){const w=maps[id],f=w.labLayout!.frame!,y=yCenter(f)+12;
      for(let d=1;d<=w.boundaryThickness;d++)expect(w.boundary[y*w.width+f.x0-d]).toBe(d);
      expect(w.boundary[y*w.width+f.x0-w.boundaryThickness-1]).toBe(255);
    }
  });
  it('gives outdoor cliffs an uneven edge and the ship chamfered hull corners',()=>{
    for(const id of [3,4]){const w=maps[id],f=w.labLayout!.frame!,edges=new Set<number>();
      for(let y=f.y0+10;y<f.y0+90;y++){let x=f.x0;while(w.boundary[y*w.width+x]===0)x--;edges.add(x);}
      expect(edges.size).toBeGreaterThan(2);
    }
    const ship=maps[5],f=ship.labLayout!.frame!;
    expect(ship.boundary[f.y0*ship.width+f.x0]).toBe(255);
  });
});
function yCenter(f: LabFrame) {return f.y0+Math.floor(worldRows(f.def)*SECTOR_CELLS/2);}

function small(){const w=new PixelWorld({width:32,height:32,cellSize:8,roomSize:4});installMapBoundary(w);return w;}
describe('weapons at permanent walls',()=>{
  it.each(['circuit_runner','burrower'] as const)('stops %s without changing or crossing the wall',mutation=>{
    const w=small(),stats=baseSoldierStats(),combat=new CombatSystem(w,new Rng(1),stats,{});
    const s=new Soldier(210,120,1,0,stats.speed,mutation==='burrower'?'rocket_launcher':'assault_rifle');s.mutation=mutation;
    combat.fire(s,1,0);const b=combat.bullets.items.find(b=>b.active)!;
    b.x=220;b.y=120;b.dx=1;b.dy=0;b.speed=200;b.pendingAdvance=0;
    combat.updateBullet(b,.2);
    expect(b.active).toBe(false);expect(w.health[15*w.width+29]).toBe(65535);
  });
  it('ends a rail strike at the hull instead of drawing through space',()=>{
    const w=small(),rail=new RailLanceSystem(w),s=new Soldier(200,120,1,0,100,'sniper_rifle');
    const result=rail.fireStrike(s,200,120,1,0,1e9,999,false,null,()=>{},()=>{});
    expect(result.endX).toBeCloseTo(29*8);expect(result.hits).toBe(0);
  });
  it('retains ordinary ricochets from protected metal',()=>{
    const w=small(),stats=baseSoldierStats();stats.pistolBounces=5;
    const combat=new CombatSystem(w,new Rng(1),stats,{}),s=new Soldier(210,120,1,0,100,'pistol');
    combat.fire(s,1,0);const b=combat.bullets.items.find(b=>b.active)!;
    b.x=220;b.y=120;b.dx=1;b.dy=0;b.speed=200;b.pendingAdvance=0;
    combat.updateBullet(b,.1);expect(b.dx).toBe(-1);expect(b.active).toBe(true);
    expect(w.health[15*w.width+29]).toBe(65535);
  });
});
