import { describe, expect, it } from "vitest";
import { packSoldierIndicators, projectSoldierIndicator, soldierIndicatorDirection, soldierPixelsOnscreen, INDICATOR_SPACING, type SoldierIndicator } from "../src/rendering/SoldierIndicatorLayout";
const bounds={left:20,top:100,right:392,bottom:820};
const marker=():SoldierIndicator=>({x:0,y:0,edge:0,ideal:0,targetX:0,targetY:0});

describe("offscreen soldier markers",()=>{
  it.each([[206,-100,0],[600,450,1],[206,1100,2],[-100,450,3]])("projects (%s,%s) onto the expected edge",(x,y,edge)=>{
    const m=marker();expect(projectSoldierIndicator(m,x,y,12,412,915,bounds)).toBe(true);expect(m.edge).toBe(edge);
    expect(m.x).toBeGreaterThanOrEqual(bounds.left);expect(m.x).toBeLessThanOrEqual(bounds.right);
    expect(m.y).toBeGreaterThanOrEqual(bounds.top);expect(m.y).toBeLessThanOrEqual(bounds.bottom);
  });
  it("does not mark a visible sprite, including one partly visible at an edge",()=>{
    for(const[x,y]of [[200,450],[-10,100],[422,100],[100,-10],[100,925]])expect(projectSoldierIndicator(marker(),x,y,12,412,915,bounds)).toBe(false);
    expect(projectSoldierIndicator(marker(),-13,100,12,412,915,bounds)).toBe(true);
    expect(projectSoldierIndicator(marker(),NaN,100,12,412,915,bounds)).toBe(false);
  });
  it("keeps all eight directions distinct",()=>{
    for(let i=0;i<8;i++){const a=i*Math.PI/4,m=marker();m.targetX=Math.cos(a)*100;m.targetY=Math.sin(a)*100;expect(soldierIndicatorDirection(m)).toBe(i);}
  });
  it("separates a crowded edge, avoids HUD controls, and re-aims each arrow",()=>{
    const markers=Array.from({length:20},()=>{const m=marker();projectSoldierIndicator(m,-100,455,12,412,915,bounds);return m;});
    const obstacles=[{x:0,y:370,width:70,height:160}];
    packSoldierIndicators(markers,bounds,obstacles);
    for(let i=0;i<markers.length;i++){
      const m=markers[i];expect(m.x).toBeGreaterThanOrEqual(20);expect(m.x).toBeLessThanOrEqual(392);
      expect(m.y).toBeGreaterThanOrEqual(100);expect(m.y).toBeLessThanOrEqual(820);
      expect(m.x-16>=70||m.y+16<=370||m.y-16>=530).toBe(true);
      for(let j=0;j<i;j++)expect(Math.abs(m.x-markers[j].x)>=INDICATOR_SPACING||Math.abs(m.y-markers[j].y)>=INDICATOR_SPACING).toBe(true);
      const a=soldierIndicatorDirection(m)*Math.PI/4;
      expect((m.targetX-m.x)*Math.cos(a)+(m.targetY-m.y)*Math.sin(a)).toBeGreaterThan(0);
    }
  });
  it("prevents markers on adjacent edges from colliding at a corner",()=>{
    const markers=Array.from({length:8},(_,i)=>{const m=marker();projectSoldierIndicator(m,i%2?-104:-94,i%2?-120:-140,10,412,915,bounds);return m;});
    expect(new Set(markers.map(m=>m.edge)).size).toBe(2);
    packSoldierIndicators(markers,bounds,[]);
    for(let i=0;i<markers.length;i++)for(let j=0;j<i;j++)expect(Math.abs(markers[i].x-markers[j].x)>=36||Math.abs(markers[i].y-markers[j].y)>=36).toBe(true);
  });
});


it("ignores transparent sprite margins when deciding whether a soldier is visible",()=>{
  const pixels={left:2/9,top:2/9,right:7/9,bottom:7/9};
  expect(soldierPixelsOnscreen(-7,100,18,412,915,pixels)).toBe(false);
  expect(soldierPixelsOnscreen(-4,100,18,412,915,pixels)).toBe(true);
  expect(soldierPixelsOnscreen(419,100,18,412,915,pixels)).toBe(false);
  expect(soldierPixelsOnscreen(416,100,18,412,915,pixels)).toBe(true);
});
