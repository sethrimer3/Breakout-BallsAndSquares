import { describe, expect, it, vi } from "vitest";
import { Rng } from "../src/core/Rng";
import { Soldier, baseSoldierStats } from "../src/entities/Soldier";
import { CombatSystem } from "../src/systems/CombatSystem";
import { advanceMomentum } from "../src/systems/Momentum";
import { PhysicsSystem, circleIsClear } from "../src/systems/PhysicsSystem";
import { PixelWorld } from "../src/world/PixelWorld";

function scene() {
  const world=new PixelWorld({width:16,height:16,cellSize:8,roomSize:4});
  for(let y=0;y<16;y++)world.health[y*16+8]=1000;
  const stats=baseSoldierStats();stats.katanaDash=true;
  const s=new Soldier(60,60,1,0,60,"katana","horizontal");
  const physics=new PhysicsSystem(world,new Rng(1));
  return {world,stats,s,physics};
}

describe("momentum katana",()=>{
  it("dashes only after reflection, retains base speed, and smoothly returns to ordinary speed",()=>{
    const {stats,s,physics}=scene();const dash=vi.fn();
    physics.step(s,1/60,stats,dash);
    expect(s.vx).toBeLessThan(0);expect(Math.hypot(s.vx,s.vy)).toBeCloseTo(135);expect(s.speed).toBe(60);
    expect(dash).toHaveBeenCalledTimes(1);
    expect(dash.mock.calls[0][1]).toBe(-1);expect(dash.mock.calls[0][2]).toBe(0);
    let previous=135;
    for(let i=0;i<45;i++){
      advanceMomentum(s,1/60);const speed=Math.hypot(s.vx,s.vy);
      expect(speed).toBeLessThanOrEqual(previous+1e-6);previous=speed;
    }
    expect(previous).toBeCloseTo(60);expect(s.dashLeft).toBe(0);
  });
  it("never tunnels through a one-cell corridor at maximum peak speed",()=>{
    const {world,stats,s,physics}=scene();
    for(let y=0;y<16;y++)world.health[y*16+6]=1000;
    s.speed=300;s.vx=300;stats.katanaDashPeak=3;
    const dash=vi.fn();
    for(let i=0;i<120;i++){
      physics.step(s,1/60,stats,dash);
      expect(circleIsClear(world,s.x,s.y,s.radius)).toBe(true);
      expect(s.x).toBeGreaterThan(56);expect(s.x).toBeLessThan(64);
    }
    expect(dash.mock.calls.length).toBeLessThanOrEqual(2);
    expect(Math.hypot(s.vx,s.vy)).toBeLessThanOrEqual(900.001);
  });
  it.each(["manual","formation","sentry_slow","sentry_fast"])("does not trigger for %s movement",mode=>{
    const {stats,s,physics}=scene();
    s.isManual=mode==="manual";s.isInFormation=mode==="formation";
    if(mode==="sentry_slow"||mode==="sentry_fast")s.behavior=mode;
    physics.step(s,1/60,stats);
    expect(s.dashLeft).toBe(0);
  });
  it("does not treat recovery relocation as a wall-triggered dash",()=>{
    const {world,stats,s,physics}=scene();world.health.fill(1000);
    physics.step(s,1/60,stats);
    expect(s.dashLeft).toBe(0);expect(physics.stats.stuckEvents).toBeGreaterThan(0);
  });
  it("snapshots actual-velocity damage/width and consumes the harmless capstone only once",()=>{
    const {world,stats,s}=scene();world.health.fill(0);
    const combat=new CombatSystem(world,new Rng(2),stats);
    s.vx=120;s.dashAfterimage=true;
    combat.fire(s);const slash=combat.bullets.items.find(b=>b.active)!;
    expect(slash.damage).toBe(Math.round(stats.katanaDamage*1.55));
    expect(slash.slashWidth).toBeCloseTo(stats.katanaSlashWidth*1.35);
    expect(slash.afterimage).toBe(true);expect(s.dashAfterimage).toBe(false);
    const damage=slash.damage;const width=slash.slashWidth;
    s.vx=60;combat.updateBullets(1/60);
    expect(slash.damage).toBe(damage);expect(slash.slashWidth).toBe(width);
    combat.fire(s);expect(combat.bullets.items.filter(b=>b.active&&b.afterimage)).toHaveLength(1);
  });
  it("does not reset the dash cooldown during repeated contacts",()=>{
    const {world,stats,s,physics}=scene();for(let y=0;y<16;y++)world.health[y*16+6]=1000;
    const dash=vi.fn();for(let i=0;i<60;i++)physics.step(s,1/60,stats,dash);
    expect(dash).toHaveBeenCalledTimes(1);expect(s.dashCooldown).toBeGreaterThan(0.7);
  });
});
