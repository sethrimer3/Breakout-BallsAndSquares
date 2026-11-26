import type { BlightCore, PixelWorld } from "./PixelWorld";

/** Generator coordinates are stable within the authored world. The tutorial
 * generator has its own identity, independent of the authored tank layout. */
export function generatorKey(core: BlightCore): string {
  return `${core.cx},${core.cy},${core.size},${core.roomId === -1 ? "tube" : "lab"}`;
}

export function suppressDestroyedGenerators(world: PixelWorld, destroyed: Readonly<Record<string, boolean>>): void {
  for (const core of world.blightCores) {
    if (!Object.prototype.hasOwnProperty.call(destroyed, generatorKey(core))) continue;
    core.alive = false;
    for (const i of core.cells) {
      if (world.coreId[i] !== core.id) continue;
      world.health[i] = 0;
      world.blight[i] = 0;
      world.coreId[i] = 0;
    }
  }
}
