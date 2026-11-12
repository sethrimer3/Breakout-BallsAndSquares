/** Independent world-space residue: its support cell is deliberately not stored. */
export class GooMine {
  active = false;
  residue = false;
  x = 0;
  y = 0;
  normalX = 0;
  normalY = 0;
  fuse = 0;
  maxFuse = 0;
  mass = 0;
  radiusCells = 0;
  damage = 0;
  terrainDamageBonus = 0;
  blightMultiplier = 1;
  ownerId = 0;
}
