import { baseSoldierStats, type SoldierStats } from "../entities/Soldier";
import type { SaveData, SaveManager } from "./SaveManager";
import {
  SOLDIER_UPGRADE_BY_ID,
  soldierModsFor,
  type SoldierMods,
  type SoldierUpgradeId,
} from "./SoldierUpgrades";
import {
  UPGRADE_BY_ID,
  UPGRADE_DEFS,
  upgradeCost,
  upgradePrices,
  type Currency,
  type Price,
  type UpgradeDef,
  type UpgradeId,
} from "./UpgradeDefinitions";

/** Where each currency is banked in the save. */
const WALLET: Record<Currency, keyof Pick<SaveData, "bank" | "crystals" | "greenCrystals" | "essence">> = {
  gold: "bank",
  crystals: "crystals",
  greenCrystals: "greenCrystals",
  essence: "essence",
};

export class UpgradeManager {
  constructor(private save: SaveManager) {}

  balanceOf(currency: Currency): number {
    return this.save.data[WALLET[currency]];
  }

  canAfford(prices: readonly Price[]): boolean {
    return prices.every((p) => this.balanceOf(p.currency) >= p.amount);
  }

  private pay(prices: readonly Price[]): void {
    for (const p of prices) this.save.data[WALLET[p.currency]] -= p.amount;
  }

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
    if (def.branch === "katana" && def.id !== "katana_unlock") {
      if (this.levelOf("katana_unlock") === 0) return false;
    }
    if (def.branch === "grenade" && def.id !== "grenade_unlock") {
      if (this.levelOf("grenade_unlock") === 0) return false;
    }
    if (def.branch === "turret" && def.id !== "turret_unlock") {
      if (this.levelOf("turret_unlock") === 0) return false;
    }
    return true;
  }

  /** The next level's cost in the node's main currency. */
  costOf(id: UpgradeId): number {
    const def = UPGRADE_BY_ID[id];
    return upgradeCost(def, this.levelOf(id));
  }

  pricesOf(id: UpgradeId): Price[] {
    return upgradePrices(UPGRADE_BY_ID[id], this.levelOf(id));
  }

  canBuy(id: UpgradeId): boolean {
    if (!this.isUnlocked(id) || this.isMaxed(id)) return false;
    return this.canAfford(this.pricesOf(id));
  }

  buy(id: UpgradeId): boolean {
    if (!this.canBuy(id)) return false;
    this.pay(this.pricesOf(id));
    this.save.data.upgrades[id] = this.levelOf(id) + 1;
    this.save.save();
    return true;
  }

  soldierLevelOf(slot: number, id: SoldierUpgradeId): number {
    return this.save.data.loadouts[slot]?.upgrades?.[id] ?? 0;
  }

  soldierIsMaxed(slot: number, id: SoldierUpgradeId): boolean {
    return this.soldierLevelOf(slot, id) >= SOLDIER_UPGRADE_BY_ID[id].maxLevel;
  }

  /** A soldier's node opens once the node before it on that arm has a level. */
  soldierIsUnlocked(slot: number, id: SoldierUpgradeId): boolean {
    const parent = SOLDIER_UPGRADE_BY_ID[id].parent;
    return parent === null || this.soldierLevelOf(slot, parent) > 0;
  }

  soldierPricesOf(slot: number, id: SoldierUpgradeId): Price[] {
    return upgradePrices(SOLDIER_UPGRADE_BY_ID[id], this.soldierLevelOf(slot, id));
  }

  soldierCanBuy(slot: number, id: SoldierUpgradeId): boolean {
    if (!this.save.data.loadouts[slot]) return false;
    if (!this.soldierIsUnlocked(slot, id) || this.soldierIsMaxed(slot, id)) return false;
    return this.canAfford(this.soldierPricesOf(slot, id));
  }

  soldierBuy(slot: number, id: SoldierUpgradeId): boolean {
    if (!this.soldierCanBuy(slot, id)) return false;
    this.pay(this.soldierPricesOf(slot, id));
    const loadout = this.save.data.loadouts[slot];
    loadout.upgrades ??= {};
    loadout.upgrades[id] = this.soldierLevelOf(slot, id) + 1;
    this.save.save();
    return true;
  }

  /** Total levels bought on a soldier's tree. */
  soldierTreeLevel(slot: number): number {
    const levels = this.save.data.loadouts[slot]?.upgrades ?? {};
    return Object.values(levels).reduce((sum, level) => sum + (level ?? 0), 0);
  }

  soldierMods(slot: number): SoldierMods {
    return soldierModsFor(this.save.data.loadouts[slot]?.upgrades);
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
