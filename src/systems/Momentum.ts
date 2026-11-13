import type { Soldier, SoldierStats } from "../entities/Soldier";

export function momentumEligible(s: Soldier): boolean {
  return s.weapon === "katana" && s.mutation !== "gale_edge" && !s.isManual && !s.isInFormation && s.behavior !== "sentry_slow" && s.behavior !== "sentry_fast";
}

export function advanceMomentum(s: Soldier, dt: number): void {
  s.dashCooldown = Math.max(0, s.dashCooldown - dt);
  if (s.dashLeft <= 0) return;
  s.dashLeft = momentumEligible(s) ? Math.max(0, s.dashLeft - dt) : 0;
  if (!momentumEligible(s)) return; // Manual/formation movement already owns velocity.
  const ratio = s.dashDuration > 0 ? s.dashLeft / s.dashDuration : 0;
  const speed = s.speed * (1 + (s.dashPeak - 1) * ratio * ratio);
  const length = Math.hypot(s.vx, s.vy);
  if (length > 1e-6) { s.vx *= speed / length; s.vy *= speed / length; }
}

export function triggerMomentum(s: Soldier, stats: SoldierStats): boolean {
  if (!stats.katanaDash || !momentumEligible(s) || s.dashCooldown > 0) return false;
  const length = Math.hypot(s.vx, s.vy);
  if (length < 1e-6) return false;
  s.dashPeak = Math.min(3, stats.katanaDashPeak);
  s.dashDuration = stats.katanaDashDuration;
  s.dashLeft = s.dashDuration;
  s.dashCooldown = Math.max(0.8, stats.katanaDashCooldown);
  s.dashAfterimage = stats.katanaPerfect;
  s.vx *= s.speed * s.dashPeak / length;
  s.vy *= s.speed * s.dashPeak / length;
  return true;
}

export function slashMomentum(s: Soldier, stats: SoldierStats): { damage: number; width: number } {
  if(s.mutation === "gale_edge")return {damage:1,width:1};
  const ratio = Math.min(2.6, Math.max(1, Math.hypot(s.vx, s.vy) / Math.max(1e-6, s.speed)));
  return { damage: 1 + 0.55 * (ratio - 1) * stats.katanaKinetic,
    width: 1 + 0.35 * (ratio - 1) * stats.katanaWide };
}
