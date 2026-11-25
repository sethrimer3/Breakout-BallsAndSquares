import { accessId, marketFor, marketNode, WEAPON_MARKETS, type MarketPath } from "./BlackMarket";
import { baseSoldierStats, resolvePrimaryMutation, type PrimaryMutation, type SoldierStats, type WeaponType } from "../entities/Soldier";
import type { SaveData, SaveManager } from "./SaveManager";
import { needsSpecial } from "./specialUnlocks";
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
  upgradePrices,
  type Currency,
  type Price,
  type UpgradeDef,
  type UpgradeId,
  type UpgradeBranch,
} from "./UpgradeDefinitions";

/** Where each currency is banked in the save. */
const WALLET: Record<Currency, keyof Pick<SaveData, "bank" | "crystals" | "greenCrystals" | "essence" | "biomass" | "exoticMatter">> = {
  gold: "bank",
  crystals: "crystals",
  greenCrystals: "greenCrystals",
  essence: "essence",
  exoticMatter: "exoticMatter",
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
    if (this.isPathSwitch(id)) return false;
    return this.levelOf(id) >= def.maxLevel;
  }

  isUnlocked(id: UpgradeId): boolean {
    const def = UPGRADE_BY_ID[id];
    if (!def || def.placeholder || !this.isBranchUnlocked(def.branch)) return false;
    const node = marketNode(id);
    if (node) {
      if (!this.marketOpen(node.market.weapon)) return false;
      // Path roots can always be re-bought to switch; upgrades require their active root.
      if (id !== node.path.root && this.activeMarketPath(node.market.weapon)?.root !== node.path.root) return false;
    }
    // Hidden in a gold special-upgrade block until the squad finds it.
    if (needsSpecial(this.save.data, id)) return false;
    if (def.branch === "core") {
      let parent = def.parent;
      while (parent && UPGRADE_BY_ID[parent].placeholder) parent = UPGRADE_BY_ID[parent].parent;
      if (parent && this.levelOf(parent) === 0) return false;
    }
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
    // Each Calibration stage follows the one before it.
    if (def.branch === "arsenal" && def.parent && this.levelOf(def.parent) === 0) return false;
    return true;
  }

  /** True while `id` is still hidden in an unfound gold special-upgrade block. */
  needsFinding(id: UpgradeId): boolean {
    const branch = UPGRADE_BY_ID[id].branch;
    const market = marketFor(branch);
    const discovery =
      market?.unlock ?? (branch === "grenade" ? "grenade_unlock" : branch === "turret" ? "turret_unlock" : null);
    return needsSpecial(this.save.data, id) || !!(discovery && needsSpecial(this.save.data, discovery));
  }

  isBranchUnlocked(branch: UpgradeBranch): boolean {
    const unlock = BRANCH_UNLOCK[branch];
    return !unlock || this.levelOf(unlock) > 0;
  }

  /** The next level's cost in the node's main currency. */
  costOf(id: UpgradeId): number {
    return this.pricesOf(id)[0]?.amount ?? 0;
  }

  pricesOf(id: UpgradeId): Price[] {
    const node = marketNode(id);
    if (node?.path.root === id) {
      if (this.levelOf(id) === 0) return [{ currency: "exoticMatter", amount: 1 }];
      const cost = id === "katana_dash" ? 30 : id === "prism_unlock" ? 40 : id === "drone_unlock" ? 35 : UPGRADE_BY_ID[id].baseCost;
      return [{currency:"essence",amount:cost}];
    }
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
    const market = marketNode(id);
    this.save.data.upgrades[id] = Math.min(UPGRADE_BY_ID[id].maxLevel, this.levelOf(id) + 1);
    if (market?.path.root === id) {
      this.save.data.blackMarketPaths[market.market.weapon] = id;
      // The new choice applies to the next deployment, including equipped slots.
      for (const ld of this.save.data.loadouts) if (ld.weapon === market.market.weapon) ld.mutation = market.path.mutation;
    }
    const spent = (this.save.data.upgradeSpent ??= {});
    const rec = (spent[id] ??= {});
    for (const p of prices) rec[p.currency] = (rec[p.currency] ?? 0) + p.amount;
    this.save.save();
    return true;
  }

  marketOpen(weapon: WeaponType): boolean {
    // Existing research grants access without charging for it a second time.
    return this.levelOf(accessId(weapon)) > 0 || this.activeMarketPath(weapon) !== undefined;
  }

  activeMarketPath(weapon: WeaponType): MarketPath | undefined {
    const market = marketFor(weapon);
    if (!market) return undefined;
    const saved = this.save.data.blackMarketPaths[weapon];
    if (saved) {
      const node = marketNode(saved);
      if (node?.market.weapon === weapon && this.levelOf(node.path.root) > 0) return node.path;
    }
    const equipped = this.save.data.loadouts.find(ld => ld.weapon === weapon && ld.mutation)?.mutation;
    return market.paths.find(p => p.mutation === equipped && this.levelOf(p.root) > 0)
      ?? market.paths.find(p => this.levelOf(p.root) > 0);
  }

  isPathSwitch(id: UpgradeId): boolean {
    const node = marketNode(id);
    return !!node && node.path.root === id && this.activeMarketPath(node.market.weapon)?.root !== id;
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
      (weapon === "squelch" && st.gooUnlocked) ||
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
      ...WEAPON_MARKETS.map(m => accessId(m.weapon)),
      ...WEAPON_MARKETS.flatMap(m => m.paths.flatMap(p => p.nodes)),
    ];
    const refunded: Partial<Record<Currency, number>> = {};
    const spentMap = this.save.data.upgradeSpent ?? {};
    for (const id of mutationNodeIds) {
      const lvl = this.levelOf(id);
      if (lvl <= 0) continue;
      const recorded = spentMap[id];
      if (recorded) {
        for (const c of ["gold", "crystals", "greenCrystals", "essence", "biomass", "exoticMatter"] as const) {
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
          for (const p of id.startsWith("black_market_") ? [{ currency: "essence", amount: 20 } as const] : upgradePrices(def, l)) {
            this.save.data[WALLET[p.currency]] += p.amount;
            refunded[p.currency] = (refunded[p.currency] ?? 0) + p.amount;
          }
        }
      }
      this.save.data.upgrades[id] = 0;
    }
    this.save.data.blackMarketPaths = {};
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
      const node = marketNode(def.id);
      const active = !node || this.activeMarketPath(node.market.weapon)?.root === node.path.root;
      def.apply(stats, active ? this.levelOf(def.id) : 0);
    }
    return stats;
  }

  get defs(): readonly UpgradeDef[] {
    return UPGRADE_DEFS;
  }
}
