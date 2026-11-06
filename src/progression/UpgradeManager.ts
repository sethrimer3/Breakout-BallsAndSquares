import { baseSoldierStats, type SoldierStats } from "../entities/Soldier";
import type { SaveManager } from "./SaveManager";
import {
  UPGRADE_BY_ID,
  UPGRADE_DEFS,
  upgradeCost,
  type UpgradeDef,
  type UpgradeId,
} from "./UpgradeDefinitions";

export class UpgradeManager {
  constructor(private save: SaveManager) {}

  levelOf(id: UpgradeId): number {
    return this.save.data.upgrades[id] ?? 0;
  }

  isMaxed(id: UpgradeId): boolean {
    const def = UPGRADE_BY_ID[id];
    return this.levelOf(id) >= def.maxLevel;
  }

  isUnlocked(id: UpgradeId): boolean {
    const def = UPGRADE_BY_ID[id];
    if (this.save.data.lifetimePixels < def.unlockLifetimePixels) return false;
    if (def.branch === "shotgun" && def.id !== "shotgun_unlock") {
      if (this.levelOf("shotgun_unlock") === 0) return false;
    }
    if (def.branch === "assault_rifle" && def.id !== "ar_unlock") {
      if (this.levelOf("ar_unlock") === 0) return false;
    }
    if (def.branch === "rocket_launcher" && def.id !== "rocket_unlock") {
      if (this.levelOf("rocket_unlock") === 0) return false;
    }
    if (def.branch === "sniper_rifle" && def.id !== "sniper_unlock") {
      if (this.levelOf("sniper_unlock") === 0) return false;
    }
    return true;
  }

  costOf(id: UpgradeId): number {
    const def = UPGRADE_BY_ID[id];
    return upgradeCost(def, this.levelOf(id));
  }

  canBuy(id: UpgradeId): boolean {
    if (!this.isUnlocked(id) || this.isMaxed(id)) return false;
    return this.save.data.bank >= this.costOf(id);
  }

  buy(id: UpgradeId): boolean {
    if (!this.canBuy(id)) return false;
    const cost = this.costOf(id);
    this.save.data.bank -= cost;
    this.save.data.upgrades[id] = this.levelOf(id) + 1;
    this.save.save();
    return true;
  }

  getSoldierStats(): SoldierStats {
    const stats = baseSoldierStats();
    for (const def of UPGRADE_DEFS) {
      def.apply(stats, this.levelOf(def.id));
    }
    return stats;
  }

  get defs(): readonly UpgradeDef[] {
    return UPGRADE_DEFS;
  }
}
