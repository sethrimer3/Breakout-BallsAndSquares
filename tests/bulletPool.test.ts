import { describe, expect, it } from 'vitest';
import { BulletPool } from '../src/entities/Bullet';

describe('bullet pool free-slot cursor',()=>{
  it('fills in slot order, rejects overflow, and reuses the lowest released slot',()=>{
    const p=new BulletPool(16);
    for(const bullet of p.items)expect(p.acquire()).toBe(bullet);
    expect(p.acquire()).toBeNull();expect(p.activeCount).toBe(16);
    p.release(p.items[12]);p.release(p.items[3]);p.release(p.items[8]);
    expect(p.acquire()).toBe(p.items[3]);expect(p.acquire()).toBe(p.items[8]);expect(p.acquire()).toBe(p.items[12]);
    expect(p.acquire()).toBeNull();
  });
  it('matches a linear reference allocator through mixed shooting and expiration',()=>{
    const p=new BulletPool(128),active=new Uint8Array(128);let state=12345;
    const rand=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state;};
    for(let i=0;i<20000;i++){
      const choice=rand()%10;
      if(choice<6){const slot=active.findIndex(x=>!x),bullet=p.acquire();expect(bullet).toBe(slot<0?null:p.items[slot]);if(slot>=0)active[slot]=1;}
      else if(choice<9){const slot=rand()%128;p.release(p.items[slot]);active[slot]=0;}
      else{p.clear();active.fill(0);}
      expect(p.activeCount).toBe(active.reduce((a,b)=>a+b,0));
    }
  });
  it('treats repeated release as a no-op and resets a full pool on clear',()=>{
    const p=new BulletPool(2),a=p.acquire()!,b=p.acquire()!;p.release(a);p.release(a);
    expect(p.activeCount).toBe(1);expect(p.acquire()).toBe(a);p.clear();
    expect(p.activeCount).toBe(0);expect(p.acquire()).toBe(a);expect(p.acquire()).toBe(b);
  });
});
