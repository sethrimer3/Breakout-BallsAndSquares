import { GooBody } from "./GooBody";

/** Center-point projectile; visual deformation never participates in collision. */
export class GooOrb {
  readonly body = new GooBody();
  active = false;
  x = 0;
  y = 0;
  dx = 1;
  dy = 0;
  speed = 0;
  state: "flying" | "stuck" = "flying";
  stateTimer = 0;
  normalX = 0;
  normalY = 0;
  distanceRemaining = 0;
  startingMass = 1;
  mass = 1;
  age = 0;
  contacts = 0;
  ownerId = 0;
  damage = 0;
  dwell = 0.18;
  mineRadius = 1.8;
  residue = false;
  terrainDamageBonus = 0;
  blightMultiplier = 1;
}

// Backward-compatible name for the first user of the shared entity pool.
export { FixedPool as GooPool } from "../core/FixedPool";
