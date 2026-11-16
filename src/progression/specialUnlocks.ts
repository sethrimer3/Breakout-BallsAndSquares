import type { SaveData } from "./SaveManager";
import type { UpgradeId } from "./UpgradeDefinitions";

/**
 * What each gold special-upgrade block in the lab unlocks. Until the squad
 * shatters a block and absorbs it, its upgrade shows as a lock reading
 * "FIND UPGRADE" in the upgrade tree and can't be bought.
 */
export const SPECIAL_UNLOCKS: Readonly<Record<string, UpgradeId>> = {
  "z1-special-1": "shotgun_unlock",
  "z1-special-2": "ar_unlock",
  "z1-special-3": "grenade_unlock",
  "z1-special-4": "sniper_unlock",
  "z2-special-1": "rocket_unlock",
  "z2-special-2": "katana_unlock",
  "z2-special-3": "flame_unlock",
  "z2-special-4": "auto_ability",
};

/** Lab world each spot id lives in (from its "zN-" prefix). */
export function specialWorld(spot: string): number {
  return Number(/^z(\d+)-/.exec(spot)?.[1] ?? 0);
}

const SPOT_FOR = new Map<UpgradeId, string>(Object.entries(SPECIAL_UNLOCKS).map(([spot, id]) => [id, spot]));

/** The special-upgrade spot that gates `id`, if any. */
export function specialSpotFor(id: UpgradeId): string | undefined {
  return SPOT_FOR.get(id);
}

/** True once the block at `spot` has been shattered and absorbed in any lab world. */
export function specialFound(data: SaveData, spot: string): boolean {
  return Object.values(data.lab.worlds).some((w) => w.specials.includes(spot));
}

/** True while `id` is still hidden in an unfound gold block. */
export function needsSpecial(data: SaveData, id: UpgradeId): boolean {
  if (data.settings.devMode && data.settings.devFindUpgrades) return false;
  const spot = SPOT_FOR.get(id);
  return !!spot && (data.upgrades[id] ?? 0) === 0 && !specialFound(data, spot);
}
