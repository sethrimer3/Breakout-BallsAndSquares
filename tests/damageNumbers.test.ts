import { describe, expect, it } from 'vitest';
import { DamageNumbers } from '../src/entities/DamageNumbers';
import { MAT, PixelWorld, SUB } from '../src/world/PixelWorld';

function fixture() {
  const world=new PixelWorld({width:32,height:32,cellSize:8,roomSize:4});
  return {world,numbers:new DamageNumbers(world)};
}

describe('nonlethal block damage numbers',()=>{
  it('reports actual HP removed and emits nothing for a destroying hit',()=>{
    const {world,numbers}=fixture();world.setCell(5,5,20);
    expect(world.damage(5,5,4,true)).toBe(1);
    expect(numbers.items).toMatchObject([{amount:4,x:44,y:44,age:0}]);
    world.damage(5,5,100,true);expect(numbers.items).toHaveLength(1);
  });
  it('handles half-size blocks and parent redirection without duplicate numbers',()=>{
    const {world,numbers}=fixture();const i=10*world.subWidth+10;
    world.subKind[i]=SUB.rubble;world.subHealth[i]=20;
    world.damageSub(10,10,3,true);expect(numbers.items).toMatchObject([{amount:3,x:42,y:42}]);
    world.damageSub(10,10,100,true);expect(numbers.items).toHaveLength(1);
    world.setCell(5,5,20);world.damageSub(10,10,2,true);
    expect(numbers.items).toHaveLength(2);expect(numbers.items[1]).toMatchObject({amount:2,x:44,y:44});
  });
  it('ignores zero damage, non-player damage, empty cells, and protected gates',()=>{
    const {world,numbers}=fixture();world.setCell(5,5,20);
    world.damage(5,5,0,true);world.damage(5,5,2);world.damage(0,0,2,true);
    const i=5*world.width+5;world.boundary[i]=1;world.damage(5,5,2,true);
    world.boundary[i]=0;world.mat[i]=MAT.door;world.doorId[i]=1;
    world.doors.push({id:1,tier:1,open:false,gate:{to:0,side:'east'},cells:[i],x0:5,y0:5,x1:5,y1:5});world.damage(5,5,2,true);
    expect(numbers.items).toEqual([]);
  });
  it('uses stored HP loss for fractional attacks and never labels a dead block',()=>{
    const {world,numbers}=fixture();world.setCell(5,5,20);world.damage(5,5,2.2,true);
    expect(numbers.items[0].amount).toBe(3);
    world.setCell(6,5,1);world.damage(6,5,.8,true);expect(numbers.items).toHaveLength(1);
  });
  it('preserves attack direction through full and half-size redirection',()=>{
    const world=new PixelWorld({width:32,height:32,cellSize:8,roomSize:4});
    const numbers=new DamageNumbers(world,()=>0.5);
    world.setCell(5,5,20);world.damageSub(10,10,1,true,3,4);
    expect(numbers.items[0].dx).toBeCloseTo(.6);expect(numbers.items[0].dy).toBeCloseTo(.8);
    world.setCell(5,5,0);
    const i=10*world.subWidth+10;world.subKind[i]=SUB.rubble;world.subHealth[i]=20;
    world.damage(5,5,1,true,-2,0);
    expect(numbers.items[1].dx).toBeCloseTo(-1);expect(numbers.items[1].dy).toBeCloseTo(0);
  });
  it('uses a center-biased triangular spread bounded to ten degrees',()=>{
    const world=new PixelWorld({width:32,height:32,cellSize:8,roomSize:4});
    let sample=0;const values=[0,0, .25,.75, 1,1];
    const numbers=new DamageNumbers(world,()=>values[sample++]);
    world.setCell(5,5,20);
    for(let i=0;i<3;i++)world.damage(5,5,1,true,1,0);
    const angles=numbers.items.map(n=>Math.atan2(n.dy,n.dx)*180/Math.PI);
    expect(angles[0]).toBeCloseTo(-10);expect(angles[1]).toBeCloseTo(0);expect(angles[2]).toBeCloseTo(10);
    for(const n of numbers.items)expect(Math.hypot(n.dx,n.dy)).toBeCloseTo(1);
  });
  it('bounds burst capacity, expires numbers, and clears on reset',()=>{
    const {world,numbers}=fixture();world.setCell(5,5,1000);
    for(let i=0;i<200;i++)world.damage(5,5,1,true);
    expect(numbers.items).toHaveLength(numbers.capacity);
    numbers.update(.3);expect(numbers.items[0].age).toBeCloseTo(.3);
    numbers.update(.4);expect(numbers.items).toEqual([]);
    world.damage(5,5,1,true);numbers.clear();expect(numbers.items).toEqual([]);
  });
});
