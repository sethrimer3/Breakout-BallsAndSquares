import type { Soldier } from "./Soldier";

export class Drone {
  active = false;
  owner: Soldier | null = null;
  ownerId = 0;
  x = 0; y = 0; dx = 1; dy = 0;
  life = 0; hp = 1; phase = 0;
  fireCooldown = 0; retarget = 0;
  aimX = 1; aimY = 0;
  /** Snapshot owner modifiers at launch, including death/emergency shots. */
  damage = 1; terrainDamageBonus = 0; blightMultiplier = 1; pierce = 0;
  speed = 85; fireRate = 1.4; aimDegrees = 0; recall = false;
}
export interface DroneShot {
  x: number; y: number; dx: number; dy: number; ownerId: number;
  damage: number; terrainDamageBonus: number; blightMultiplier: number; pierce: number;
}
