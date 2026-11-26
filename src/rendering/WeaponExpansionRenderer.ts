import { NAPALM, ORBIT, PRISM, RAIL } from "../config";
import type { Game } from "../Game";
import { circuitColorAt } from "../systems/CircuitRunnerSystem";
import { drawOvercharge } from "./OverchargeRenderer";

/** Bounded Canvas-only effects; never alter weapon simulation. */
export function drawWeaponExpansion(ctx: CanvasRenderingContext2D, game: Game, reduced: boolean): void {
  const cam = game.camera;
  ctx.save();
  if (!reduced) for (const s of game.soldiers) {
    if (!s.alive || s.dashLeft <= 0) continue;
    const speed = Math.hypot(s.vx,s.vy); if (speed < 1e-6) continue;
    const x = cam.worldToScreenX(s.x); const y = cam.worldToScreenY(s.y);
    const pad = 24 * cam.zoom + 4;
    if (x < -pad || y < -pad || x > cam.viewW + pad || y > cam.viewH + pad) continue;
    ctx.strokeStyle = "rgba(115,235,255,0.65)"; ctx.lineWidth = Math.max(1,cam.zoom*2);
    ctx.beginPath(); ctx.moveTo(x,y);
    ctx.lineTo(x-s.vx/speed*16*cam.zoom,y-s.vy/speed*16*cam.zoom); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(x,y,Math.max(2,7*cam.zoom),Math.max(1,4*cam.zoom),s.facingAngle,0,Math.PI*2);ctx.stroke();
  }
  if (game.combat.drones.pool.activeCount > 0) for (const drone of game.combat.drones.pool.items) {
    if (!drone.active) continue;
    const x=cam.worldToScreenX(drone.x);const y=cam.worldToScreenY(drone.y);
    if (x < -24 || y < -24 || x > cam.viewW+24 || y > cam.viewH+24) continue;
    const z=Math.max(0.75,cam.zoom) * drone.sizeScale;
    ctx.fillStyle="#213541";ctx.fillRect(x-3*z,y-2*z,6*z,4*z);
    ctx.fillStyle="#7ce4df";ctx.fillRect(x-z,y-z,2*z,2*z);
    const rotor=reduced?1:0.5+0.5*Math.abs(Math.sin(drone.phase*5));
    ctx.fillStyle="#c5f9ff";ctx.fillRect(x-5*z,y-z,rotor*3*z,z);ctx.fillRect(x+2*z,y-z,rotor*3*z,z);
    if (drone.fireCooldown>1/drone.fireRate-0.06) {ctx.fillStyle="#fff1ae";ctx.fillRect(x+drone.dx*4*z,y+drone.dy*4*z,z,z);}
  }
  if (game.combat.laser.segments.activeCount > 0) for (const segment of game.combat.laser.segments.items) {
    if (!segment.active) continue;
    const x1=cam.worldToScreenX(segment.x1);const y1=cam.worldToScreenY(segment.y1);
    const x2=cam.worldToScreenX(segment.x2);const y2=cam.worldToScreenY(segment.y2);
    // Preserve crossing beams and the reflection marker beyond the endpoint.
    const pad = (5 + Math.max(1.5, cam.zoom * (0.8 + segment.band * 0.13))) * segment.sizeScale;
    if (Math.max(x1, x2) < -pad || Math.min(x1, x2) > cam.viewW + pad ||
        Math.max(y1, y2) < -pad || Math.min(y1, y2) > cam.viewH + pad) continue;
    ctx.globalAlpha=reduced?0.85:Math.min(1,segment.life/PRISM.visualLife);
    ctx.strokeStyle=PRISM.colors[segment.band];
    ctx.lineWidth=Math.max(1.5,cam.zoom*(0.8+segment.band*0.13)) * segment.sizeScale;
    ctx.setLineDash([]);ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();
    ctx.strokeStyle="#ffffff";ctx.lineWidth=Math.max(0.6,cam.zoom*0.25) * segment.sizeScale;
    if (game.save.data.settings.prismPatterns) ctx.setLineDash([2+segment.band,3]);
    ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();ctx.setLineDash([]);
    if(segment.reflected){ctx.beginPath();ctx.moveTo(x2-3,y2);ctx.lineTo(x2+3,y2);ctx.moveTo(x2,y2-3);ctx.lineTo(x2,y2+3);ctx.stroke();}
  }
  if (game.combat.revolver.pool.activeCount > 0) for(const shot of game.combat.revolver.pool.items){
    if(!shot.active || shot.phase==="recording")continue;
    const x=cam.worldToScreenX(shot.x);const y=cam.worldToScreenY(shot.y);
    if(x < -24 || y < -24 || x > cam.viewW+24 || y > cam.viewH+24)continue;
    ctx.globalAlpha=0.75;ctx.strokeStyle="#d7a5ff";ctx.lineWidth=Math.max(1,cam.zoom) * shot.sizeScale;
    if(shot.phase==="waiting"){
      ctx.beginPath();ctx.arc(x,y,Math.max(2,cam.zoom*2) * shot.sizeScale,0,Math.PI*2);ctx.stroke();
    }else{
      const from=(shot.cursor+1)*2;const dx=shot.points[from]-shot.x;const dy=shot.points[from+1]-shot.y;
      const length=Math.hypot(dx,dy);const tail=Math.min(12,length)*cam.zoom;
      ctx.beginPath();ctx.moveTo(x,y);if(length>1e-8)ctx.lineTo(x+dx/length*tail,y+dy/length*tail);ctx.stroke();
    }
    ctx.fillStyle="#f5e8ff";ctx.fillRect(x-1,y-1,Math.max(1,cam.zoom),Math.max(1,cam.zoom));
  }
  // Perfect Rebound is a visual echo, not an additional damage actor.
  if (!reduced && game.combat.bullets.activeCount > 0) for (const b of game.combat.bullets.items) {
    if (!b.active || !b.afterimage || b.style!==3) continue;
    const x=cam.worldToScreenX(b.x-b.dx*5);const y=cam.worldToScreenY(b.y-b.dy*5);
    const rad=Math.max(2,b.slashWidth*cam.zoom*0.5);
    if(x+rad+2<0||y+rad+2<0||x-rad-2>cam.viewW||y-rad-2>cam.viewH)continue;
    ctx.globalAlpha=0.3;ctx.strokeStyle="#aff7ff";ctx.lineWidth=Math.max(1,cam.zoom);
    ctx.beginPath();ctx.arc(x,y,rad,Math.atan2(b.dy,b.dx)-0.9,Math.atan2(b.dy,b.dx)+0.9);ctx.stroke();
  }

  // Orbit Cylinder: orbiting rounds + full-magazine ring indicator.
  ctx.globalAlpha = 0.92;
  for (const s of game.soldiers) {
    if (!s.alive || s.weapon !== "pistol" || s.mutation !== "orbit_cylinder") continue;
    const count = game.combat.orbit.countFor(s.id);
    if (count > 0) {
      const sx = cam.worldToScreenX(s.x);
      const sy = cam.worldToScreenY(s.y);
      const r = ORBIT.radius * cam.zoom;
      if (sx + r + 4 < 0 || sy + r + 4 < 0 || sx - r - 4 > cam.viewW || sy - r - 4 > cam.viewH) continue;
      ctx.strokeStyle = count >= ORBIT.maxRounds ? "rgba(255,220,110,0.75)" : "rgba(130,220,255,0.3)";
      ctx.lineWidth = Math.max(1, cam.zoom * 0.6);
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  for (const r of game.combat.orbit.items) {
    if (!r.active) continue;
    const x = cam.worldToScreenX(r.x);
    const y = cam.worldToScreenY(r.y);
    if (x < -16 || y < -16 || x > cam.viewW + 16 || y > cam.viewH + 16) continue;
    const sz = Math.max(2, cam.zoom * 1.6) * (r.owner?.projectileScale ?? 1);
    ctx.fillStyle = "#ffe89e";
    ctx.fillRect(x - sz * 0.5, y - sz * 0.5, sz, sz);
  }

  // Vacuum Pulse: reserved debris fragments pulling inward.
  for (const d of game.combat.debris.items) {
    if (!d.active || d.reservedBy === 0) continue;
    const x = cam.worldToScreenX(d.x);
    const y = cam.worldToScreenY(d.y);
    if (x < -16 || y < -16 || x > cam.viewW + 16 || y > cam.viewH + 16) continue;
    const sz = Math.max(1.5, cam.zoom * 1.3);
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = "#c8e6ff";
    ctx.fillRect(x - sz * 0.5, y - sz * 0.5, sz, sz);
  }

  // Burrower: placed mines along the drilled path.
  if (game.combat.burrower.mines.activeCount > 0) for (const m of game.combat.burrower.mines.items) {
    if (!m.active) continue;
    const x = cam.worldToScreenX(m.x);
    const y = cam.worldToScreenY(m.y);
    if (x < -16 || y < -16 || x > cam.viewW + 16 || y > cam.viewH + 16) continue;
    const rad = Math.max(2, cam.zoom * 2);
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = "#ff8c42";
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  }

  // Napalm Garden: unlit oily fuel patches vs lit burning patches.
  for (const p of game.combat.napalm.patches) {
    if (!p.active) continue;
    const x = cam.worldToScreenX(p.x);
    const y = cam.worldToScreenY(p.y);
    if (x < -32 || y < -32 || x > cam.viewW + 32 || y > cam.viewH + 32) continue;
    const rad = Math.max(2.5, NAPALM.patchRadius * 0.55 * cam.zoom) * p.sizeScale;
    if (p.lit) {
      ctx.globalAlpha = 0.82;
      ctx.fillStyle = "#ff6a1a";
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffe074";
      ctx.beginPath();
      ctx.arc(x, y, rad * 0.5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.globalAlpha = Math.max(0.25, Math.min(0.65, p.unlitLeft / NAPALM.unlitDuration));
      ctx.fillStyle = "#5c3b18";
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#946224";
      ctx.lineWidth = Math.max(1, cam.zoom * 0.4);
      ctx.stroke();
    }
  }

  // Rail Lance: charge sightline and fading narrow beam.
  for (const s of game.soldiers) {
    if (!s.alive || !s.railCharging || s.weapon !== "sniper_rifle" || s.mutation !== "rail_lance") continue;
    const ratio = s.railChargeTotal > 0 ? Math.min(1, s.railCharge / s.railChargeTotal) : 0;
    const locked = ratio >= 1 - RAIL.aimLockFraction;
    const x1 = cam.worldToScreenX(s.x);
    const y1 = cam.worldToScreenY(s.y);
    const len = 80 * cam.zoom;
    const x2 = x1 + s.railLockDx * len;
    const y2 = y1 + s.railLockDy * len;
    if (Math.max(x1, x2) < -4 || Math.min(x1, x2) > cam.viewW + 4 ||
        Math.max(y1, y2) < -4 || Math.min(y1, y2) > cam.viewH + 4) continue;
    ctx.globalAlpha = locked ? 0.75 : 0.35;
    ctx.strokeStyle = locked ? "#ff6884" : "#8ee8ff";
    ctx.lineWidth = Math.max(1, cam.zoom * (locked ? 0.9 : 0.5));
    ctx.setLineDash(locked ? [] : [4, 4]);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (game.combat.rail.beams.activeCount > 0) for (const b of game.combat.rail.beams.items) {
    if (!b.active) continue;
    const x1 = cam.worldToScreenX(b.x1);
    const y1 = cam.worldToScreenY(b.y1);
    const x2 = cam.worldToScreenX(b.x2);
    const y2 = cam.worldToScreenY(b.y2);
    // Reject the whole segment bounds, retaining beams crossing the viewport
    // even when both endpoints are outside. Include stroke and antialias padding.
    const pad = Math.max(1.5, cam.zoom * 1.6) * b.sizeScale + 1;
    // Later frost tint inherits this alpha, even when the last beam is culled.
    ctx.globalAlpha = reduced ? 0.85 : Math.max(0, b.life / b.maxLife);
    if (Math.max(x1, x2) < -pad || Math.min(x1, x2) > cam.viewW + pad ||
        Math.max(y1, y2) < -pad || Math.min(y1, y2) > cam.viewH + pad) continue;
    ctx.strokeStyle = b.crit ? "#ffd25a" : "#7eeaff";
    ctx.lineWidth = Math.max(1.5, cam.zoom * 1.6) * b.sizeScale;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = Math.max(0.6, cam.zoom * 0.5) * b.sizeScale;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  // Cryospray & Freeze Rockets: cold mist bullets + frozen creature tint.
  if (game.combat.bullets.activeCount > 0) for (const b of game.combat.bullets.items) {
    if (!b.active || (!b.cryoSpray && !b.freezeRocket)) continue;
    const x = cam.worldToScreenX(b.x);
    const y = cam.worldToScreenY(b.y);
    if (x < -16 || y < -16 || x > cam.viewW + 16 || y > cam.viewH + 16) continue;
    ctx.globalAlpha = 0.78;
    ctx.fillStyle = b.freezeRocket ? "#7ce8ff" : "#b8f4ff";
    ctx.beginPath();
    ctx.arc(x, y, Math.max(1.5, cam.zoom * (b.freezeRocket ? 2.2 : 1.4)) * b.sizeScale, 0, Math.PI * 2);
    ctx.fill();
  }

  // Frozen terrain cells: subtle cyan frost tint within camera bounds.
  const cs = game.world.cellSize;
  const W = game.world.width;
  const x0 = Math.max(0, Math.floor(cam.screenToWorldX(0) / cs));
  const x1 = Math.min(W - 1, Math.ceil(cam.screenToWorldX(cam.viewW) / cs));
  const y0 = Math.max(0, Math.floor(cam.screenToWorldY(0) / cs));
  const y1 = Math.min(game.world.height - 1, Math.ceil(cam.screenToWorldY(cam.viewH) / cs));
  const cellPx = cs * cam.zoom;
  if (game.combat.freeze.activeFrozenCells > 0) {
    ctx.fillStyle = "rgba(130, 235, 255, 0.32)";
    const freeze = game.combat.freeze;
    // Widespread freezing can outnumber a zoomed-in viewport. Keep that case
    // bounded by the smaller candidate set instead of scanning the whole world.
    const visibleCells = Math.max(0, x1 - x0 + 1) * Math.max(0, y1 - y0 + 1);
    if (freeze.activeFrozenCells <= visibleCells) {
      for (const i of freeze.activeCellIndices) {
        if (freeze.cellTimer[i] <= 0) continue;
        const cx = i % W;
        const cy = (i - cx) / W;
        if (cx < x0 || cx > x1 || cy < y0 || cy > y1) continue;
        ctx.fillRect(cam.worldToScreenX(cx * cs), cam.worldToScreenY(cy * cs), cellPx, cellPx);
      }
    } else {
      for (let cy = y0; cy <= y1; cy++) {
        const sy = cam.worldToScreenY(cy * cs);
        for (let cx = x0; cx <= x1; cx++) {
          if (freeze.cellTimer[cy * W + cx] > 0) {
            ctx.fillRect(cam.worldToScreenX(cx * cs), sy, cellPx, cellPx);
          }
        }
      }
    }
  }

  // Overcharge Conductor has its own renderer (block charge, electric blasts, chain lightning).
  ctx.restore();
  drawOvercharge(ctx, game, reduced);
  ctx.save();

  // Circuit Runner: crisp right-angled Tron-like traces cooling orange -> light blue -> blue -> purple.
  ctx.lineCap = "square";
  ctx.lineJoin = "miter";
  for (const seg of game.combat.circuit.segments) {
    if (!seg.active) continue;
    const x1 = cam.worldToScreenX(seg.x1);
    const y1 = cam.worldToScreenY(seg.y1);
    const x2 = cam.worldToScreenX(seg.x2);
    const y2 = cam.worldToScreenY(seg.y2);
    const pad = 48;
    if (
      Math.max(x1, x2) < -pad ||
      Math.min(x1, x2) > cam.viewW + pad ||
      Math.max(y1, y2) < -pad ||
      Math.min(y1, y2) > cam.viewH + pad
    ) {
      continue;
    }
    const fade = Math.max(0, seg.life / Math.max(1e-4, seg.maxLife));
    const midProg = (seg.progress0 + seg.progress1) * 0.5;
    const rangeAlpha = seg.progress1 > 0.8 ? Math.max(0.15, 1 - (seg.progress1 - 0.8) * 4.25) : 1;
    const alpha = (reduced ? 0.85 : 0.92) * fade * rangeAlpha;
    if (alpha <= 0.01) continue;

    ctx.globalAlpha = alpha;
    ctx.strokeStyle = circuitColorAt(midProg);
    ctx.lineWidth = Math.max(1.5, cam.zoom * 1.9) * seg.sizeScale;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    ctx.globalAlpha = alpha * 0.72;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = Math.max(0.7, cam.zoom * 0.65) * seg.sizeScale;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    if (!reduced && seg.progress1 < 0.98) {
      const nodeSz = Math.max(1.5, cam.zoom * 1.2);
      ctx.globalAlpha = alpha * 0.85;
      ctx.fillStyle = circuitColorAt(seg.progress1);
      ctx.fillRect(x2 - nodeSz * 0.5, y2 - nodeSz * 0.5, nodeSz, nodeSz);
    }
  }

  for (const b of game.combat.bullets.items) {
    if (!b.active || !b.circuit) continue;
    const x = cam.worldToScreenX(b.x);
    const y = cam.worldToScreenY(b.y);
    if (x < -24 || y < -24 || x > cam.viewW + 24 || y > cam.viewH + 24) continue;
    const prog = Math.max(0, Math.min(1, b.circuitTraveled / Math.max(1e-4, b.circuitMaxRange)));
    const headSz = Math.max(2.4, cam.zoom * 2.1);
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = circuitColorAt(prog);
    ctx.fillRect(x - headSz * 0.5, y - headSz * 0.5, headSz, headSz);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x - headSz * 0.22, y - headSz * 0.22, headSz * 0.44, headSz * 0.44);
  }

  ctx.restore();
}

