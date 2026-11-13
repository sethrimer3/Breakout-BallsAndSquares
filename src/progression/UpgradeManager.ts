import { baseSoldierStats, resolvePrimaryMutation, type PrimaryMutation, type SoldierStats, type WeaponType } from "../entities/Soldier";
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
  BRANCH_UNLOCK,
  upgradeCost,
  upgradePrices,
  type Currency,
  type Price,
  type UpgradeDef,
  type UpgradeId,
  type UpgradeBranch,
} from "./UpgradeDefinitions";

/** Where each currency is banked in the save. */
const WALLET: Record<Currency, keyof Pick<SaveData, "bank" | "crystals" | "greenCrystals" | "essence" | "biomass">> = {
  gold: "bank",
  crystals: "crystals",
  greenCrystals: "greenCrystals",
  essence: "essence",
  biomass: "biomass",
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
    if (!def || def.placeholder || !this.isBranchUnlocked(def.branch)) return false;
    if (def.branch === "core") {
      let parent = def.parent;
      while (parent && UPGRADE_BY_ID[parent].placeholder) parent = UPGRADE_BY_ID[parent].parent;
      if (parent && this.levelOf(parent) === 0) return false;
    }
    if (this.save.data.lifetimePixels < def.unlockLifetimePixels) return false;
    if (def.id === "gale_range" && this.levelOf("gale_unlock") === 0) return false;
    if (def.id.startsWith("drone_") && def.id !== "drone_unlock" && this.levelOf("drone_unlock") === 0) return false;
    if (def.id.startsWith("prism_") && def.id !== "prism_unlock" && this.levelOf("prism_unlock") === 0) return false;
    if ((def.id.startsWith("katana_") && ["katana_impulse", "katana_glide", "katana_kinetic", "katana_wide", "katana_recovery", "katana_perfect"].includes(def.id)) && this.levelOf("katana_dash") === 0) return false;
    if (["goo_residue", "drone_recall", "prism_overload", "katana_perfect"].includes(def.id) && def.parent && this.levelOf(def.parent) === 0) return false;
    if (def.id === "prism_overload" && this.levelOf("prism_spectrum") < 6) return false;
    if (def.id.startsWith("goo_") && def.id !== "goo_unlock" && this.levelOf("goo_unlock") === 0) return false;
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
    if (def.branch === "flamethrower" && def.id !== "flame_unlock") {
      if (this.levelOf("flame_unlock") === 0) return false;
    }
    if (def.branch === "grenade" && def.id !== "grenade_unlock") {
      if (this.levelOf("grenade_unlock") === 0) return false;
    }
    if (def.branch === "turret" && def.id !== "turret_unlock") {
      if (this.levelOf("turret_unlock") === 0) return false;
    }
    // Research-base upgrades build on each other: buy the parent first.
    if (def.branch === "facility" && def.parent && this.levelOf(def.parent) === 0) return false;
    return true;
  }

  isBranchUnlocked(branch: UpgradeBranch): boolean {
    const unlock = BRANCH_UNLOCK[branch];
    return !unlock || this.levelOf(unlock) > 0;
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
    const prices = this.pricesOf(id);
    this.pay(prices);
    this.save.data.upgrades[id] = this.levelOf(id) + 1;
    const spent = (this.save.data.upgradeSpent ??= {});
    const rec = (spent[id] ??= {});
    for (const p of prices) rec[p.currency] = (rec[p.currency] ?? 0) + p.amount;
    this.save.save();
    return true;
  }

  /** Set a soldier slot's primary weapon & mutation, enforcing unlock and non-Pistol uniqueness. */
  setLoadoutWeapon(
    slot: number,
    weapon: WeaponType,
    mutation: PrimaryMutation | null,
    inRun = false,
  ): { ok: true } | { ok: false; reason: "lab_only" | "invalid_slot" | "locked_weapon" | "duplicate_weapon" | "locked_mutation" } {
    if (inRun) return { ok: false, reason: "lab_only" };
    const ld = this.save.data.loadouts[slot];
    if (!ld) return { ok: false, reason: "invalid_slot" };
    const st = this.getSoldierStats();
    const weaponUnlocked =
      weapon === "pistol" ||
      (weapon === "shotgun" && st.shotgunUnlocked) ||
      (weapon === "assault_rifle" && st.arUnlocked) ||
      (weapon === "rocket_launcher" && st.rocketUnlocked) ||
      (weapon === "sniper_rifle" && st.sniperUnlocked) ||
      (weapon === "katana" && st.katanaUnlocked) ||
      (weapon === "flamethrower" && st.flameUnlocked);
    if (!weaponUnlocked) return { ok: false, reason: "locked_weapon" };
    if (weapon !== "pistol") {
      for (let i = 0; i < this.save.data.loadouts.length; i++) {
        if (i !== slot && this.save.data.loadouts[i].weapon === weapon) {
          return { ok: false, reason: "duplicate_weapon" };
        }
      }
    }
    if (mutation !== null && !resolvePrimaryMutation(weapon, mutation, st)) {
      return { ok: false, reason: "locked_mutation" };
    }
    ld.weapon = weapon;
    ld.mutation = mutation;
    this.save.save();
    return { ok: true };
  }

  /**
   * Lab-only atomic refund of all Black Market mutation research nodes,
   * returning exact recorded spending (or deterministic historical cost fallback).
   */
  refundBlackMarket(inRun = false): { ok: true; refunded: Partial<Record<Currency, number>> } | { ok: false; reason: "lab_only" } {
    if (inRun) return { ok: false, reason: "lab_only" };
    const mutationNodeIds: UpgradeId[] = [
      "reverse_unlock", "orbit_unlock",
      "drone_unlock", "drone_capacity", "drone_cycle", "drone_damage", "drone_speed", "drone_aim", "drone_health", "drone_recall",
      "goo_unlock", "goo_mass", "goo_distance", "goo_dwell", "goo_damage", "goo_radius", "goo_rate", "goo_residue",
      "vacuum_unlock",
      "overcharge_unlock", "overcharge_accuracy",
      "burrower_unlock", "freeze_rockets_unlock",
      "prism_unlock", "prism_spectrum", "prism_bounces", "prism_gain", "prism_shear", "prism_distance", "prism_overload",
      "rail_lance_unlock",
      "gale_unlock", "gale_range",
      "napalm_unlock", "cryospray_unlock",
    ];
    const refunded: Partial<Record<Currency, number>> = {};
    const spentMap = this.save.data.upgradeSpent ?? {};
    for (const id of mutationNodeIds) {
      const lvl = this.levelOf(id);
      if (lvl <= 0) continue;
      const recorded = spentMap[id];
      if (recorded) {
        for (const c of ["gold", "crystals", "greenCrystals", "essence", "biomass"] as const) {
          const amt = recorded[c] ?? 0;
          if (amt > 0) {
            this.save.data[WALLET[c]] += amt;
            refunded[c] = (refunded[c] ?? 0) + amt;
          }
        }
        delete spentMap[id];
      } else {
        const def = UPGRADE_BY_ID[id];
        for (let l = 0; l < lvl; l++) {
          for (const p of upgradePrices(def, l)) {
            this.save.data[WALLET[p.currency]] += p.amount;
            refunded[p.currency] = (refunded[p.currency] ?? 0) + p.amount;
          }
        }
      }
      this.save.data.upgrades[id] = 0;
    }
    for (const ld of this.save.data.loadouts) ld.mutation = null;
    this.save.save();
    return { ok: true, refunded };
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
