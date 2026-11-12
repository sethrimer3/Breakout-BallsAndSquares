import { GOO_BODY_POINTS } from "../entities/GooBody";
import { GOO } from "../config";
import type { CameraSystem } from "../systems/CameraSystem";
import type { GooOrbSystem } from "../systems/GooOrbSystem";

/** Smooth spring outlines with one center-point collision; no render-time mutation. */
export function drawGoo(ctx: CanvasRenderingContext2D, cam: CameraSystem, goo: GooOrbSystem, reducedMotion = false, lowEffects = false): void {
  for (const orb of goo.orbs.items) {
    if (!orb.active) continue;
    const x = cam.worldToScreenX(orb.x);
    const y = cam.worldToScreenY(orb.y);
    if (x < -32 || y < -32 || x > cam.viewW + 32 || y > cam.viewH + 32) continue;
    const radius = Math.max(1.5, 3.5 * Math.sqrt(orb.mass) * cam.zoom);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(orb.body.angle);
    ctx.fillStyle = "#9cde68";
    ctx.strokeStyle = "#315c35";
    ctx.lineWidth = Math.max(0.8, cam.zoom * 0.65);
    ctx.beginPath();
    if (reducedMotion) {
      // Keep contact legible, with no spring overshoot or peel stretching.
      const stuck = orb.state === "stuck";
      ctx.ellipse(stuck ? radius * 0.64 : 0, 0, radius * (stuck ? 0.64 : 1), radius * (stuck ? 1.15 : 1), 0, 0, Math.PI * 2);
    } else {
      // Quadratic segments meet at adjacent-point midpoints for a closed gel ring.
      const body = orb.body;
      const last = GOO_BODY_POINTS - 1;
      ctx.moveTo((body.x[last] + body.x[0]) * radius / 2, (body.y[last] + body.y[0]) * radius / 2);
      for (let i = 0; i < GOO_BODY_POINTS; i++) {
        const next = (i + 1) % GOO_BODY_POINTS;
        ctx.quadraticCurveTo(body.x[i] * radius, body.y[i] * radius,
          (body.x[i] + body.x[next]) * radius / 2, (body.y[i] + body.y[next]) * radius / 2);
      }
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#e4ffd1";
    const highlightX = reducedMotion ? (orb.state === "stuck" ? 0.5 : -0.2)
      : (orb.body.x[0] + orb.body.x[GOO_BODY_POINTS / 2]) / 2 - 0.2;
    ctx.fillRect(highlightX * radius, -radius * 0.4, Math.max(1, cam.zoom), Math.max(1, cam.zoom));
    ctx.restore();
  }
  for (const mine of goo.mines.items) {
    if (!mine.active) continue;
    const x = cam.worldToScreenX(mine.x);
    const y = cam.worldToScreenY(mine.y);
    if (x < -32 || y < -32 || x > cam.viewW + 32 || y > cam.viewH + 32) continue;
    const charge = 1 - Math.max(0, Math.min(1, mine.fuse / mine.maxFuse));
    const radius = Math.max(1.5, 2 * Math.sqrt(mine.mass / GOO.massPerMine) * cam.zoom);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.atan2(mine.normalY, mine.normalX));
    if (!lowEffects) {
      // Restrained charge breathing accelerates only in the last quarter second.
      const pulse = reducedMotion ? 1 : 0.85 + 0.15 * Math.sin(charge * charge * Math.PI * 10);
      ctx.fillStyle = `rgba(255, 145, 45, ${(0.12 + charge * 0.15) * pulse})`;
      ctx.beginPath();
      ctx.arc(0, 0, radius * (1.5 + charge), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#ff963c";
    ctx.beginPath();
    ctx.ellipse(0, 0, radius * 0.65, radius, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffe0a0";
    ctx.fillRect(-0.5, -0.5, Math.max(1, charge * radius), Math.max(1, charge * radius));
    // A filling ring communicates remaining fuse without relying on color.
    ctx.strokeStyle = "#fff0c2";
    ctx.lineWidth = Math.max(1, cam.zoom * 0.5);
    ctx.beginPath();
    ctx.arc(0, 0, radius + 2, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * charge);
    ctx.stroke();
    ctx.restore();
  }
}
