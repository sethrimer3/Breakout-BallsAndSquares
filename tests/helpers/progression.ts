import type { SaveManager } from "../../src/progression/SaveManager";

/** Fixtures testing an unlocked subsystem, independently of the Core path tests. */
export function unlockTabs(save: SaveManager): void {
  for (const id of ["unlock_resources", "unlock_primary", "unlock_blight", "unlock_formations", "unlock_secondary", "unlock_facility"] as const) {
    save.data.upgrades[id] = 1;
  }
}
