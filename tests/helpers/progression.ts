import { accessId, WEAPON_MARKETS } from "../../src/progression/BlackMarket";
import { SPECIAL_UNLOCKS, specialWorld } from "../../src/progression/specialUnlocks";
import type { SaveManager } from "../../src/progression/SaveManager";

/** Fixtures testing an unlocked subsystem, independently of the Core path tests. */
export function unlockTabs(save: SaveManager): void {
  for (const id of ["unlock_resources", "unlock_primary", "unlock_blight", "unlock_formations", "unlock_secondary", "unlock_facility"] as const) {
    save.data.upgrades[id] = 1;
  }
}

/** Mark every gold special-upgrade block as found, so the upgrades they gate can be bought. */
export function findAllSpecials(data: import("../../src/progression/SaveManager").SaveData): void {
  for (const spot of Object.keys(SPECIAL_UNLOCKS)) {
    const w = data.lab.worlds[specialWorld(spot)];
    if (w && !w.specials.includes(spot)) w.specials.push(spot);
  }
}

/** Existing mutation tests start inside the market; access purchases have dedicated coverage. */
export function openBlackMarkets(save: SaveManager): void {
  for (const market of WEAPON_MARKETS) {
    const id = accessId(market.weapon);
    save.data.upgrades[id] = 1;
    (save.data.upgradeSpent ??= {})[id] = {};
  }
}
