import { describe, expect, it } from "vitest";
import { accessId, marketNode, WEAPON_MARKETS } from "../src/progression/BlackMarket";
import { SaveManager, sanitizeSaveData, type StorageLike } from "../src/progression/SaveManager";
import { UpgradeManager } from "../src/progression/UpgradeManager";
import { UPGRADE_DEFS } from "../src/progression/UpgradeDefinitions";
import { unlockTabs } from "./helpers/progression";

class MemoryStorage implements StorageLike {
  private data = new Map<string,string>();
  getItem(k:string) { return this.data.get(k) ?? null; }
  setItem(k:string,v:string) { this.data.set(k,v); }
}
function scene() {
  const storage = new MemoryStorage(), save = new SaveManager(storage);
  unlockTabs(save);
  save.data.essence=1000; save.data.exoticMatter=10;save.data.bank=10000;save.data.crystals=10000;save.data.lifetimePixels=10000;
  return {storage,save,u:new UpgradeManager(save)};
}

describe("separate Black Market trees",()=>{
  it("offers one Exotic Matter access upgrade per weapon and three Pistol paths",()=>{
    for(const market of WEAPON_MARKETS) {
      const standard=UPGRADE_DEFS.filter(d=>d.branch===market.weapon&&!marketNode(d.id));
      expect(standard.filter(d=>d.id.startsWith("black_market_")).map(d=>d.id)).toEqual([accessId(market.weapon)]);
    }
    expect(WEAPON_MARKETS[0].paths.map(p=>p.root)).toEqual(["reverse_unlock","orbit_unlock","drone_unlock"]);
  });

  it("requires access and charges again every time a purchased path is reactivated",()=>{
    const {save,u}=scene();
    expect(u.buy("reverse_unlock")).toBe(false);
    expect(u.pricesOf("black_market_pistol")).toEqual([{currency:"exoticMatter",amount:1}]);
    save.data.exoticMatter = 0;
    expect(u.buy("black_market_pistol")).toBe(false);
    save.data.exoticMatter = 10;
    expect(u.buy("black_market_pistol")).toBe(true);
    expect(save.data.exoticMatter).toBe(9);
    expect(u.buy("reverse_unlock")).toBe(true);
    expect(save.data.exoticMatter).toBe(8);
    expect(u.buy("reverse_unlock")).toBe(false); // active, already maxed
    expect(u.getSoldierStats()).toMatchObject({reverseUnlocked:true,orbitUnlocked:false});
    expect(u.buy("orbit_unlock")).toBe(true);
    expect(save.data.exoticMatter).toBe(7);
    expect(u.getSoldierStats()).toMatchObject({reverseUnlocked:false,orbitUnlocked:true});
    expect(u.isMaxed("reverse_unlock")).toBe(false);
    expect(u.pricesOf("reverse_unlock")).toEqual([{currency:"essence",amount:20}]);
    expect(u.buy("reverse_unlock")).toBe(true);
    expect(save.data.essence).toBe(980);
    expect(save.data.upgrades.reverse_unlock).toBe(1);
    expect(save.data.upgradeSpent?.reverse_unlock?.essence).toBe(20);
    expect(u.getSoldierStats()).toMatchObject({reverseUnlocked:true,orbitUnlocked:false});
    expect(u.setLoadoutWeapon(1,"pistol","orbit_cylinder").ok).toBe(false);
    save.data.essence=0;
    expect(u.buy("orbit_unlock")).toBe(false);
    expect(u.activeMarketPath("pistol")?.root).toBe("reverse_unlock");
  });

  it("retains inactive research, blocks its purchases, and restores its effects on switching back",()=>{
    const {storage,save,u}=scene();
    expect(u.buy("black_market_pistol")).toBe(true);
    expect(u.buy("drone_unlock")).toBe(true);
    expect(u.buy("drone_damage")).toBe(true);
    const damage=u.getSoldierStats().droneDamage;
    expect(u.buy("orbit_unlock")).toBe(true);
    expect(save.data.upgrades.drone_damage).toBe(1);
    expect(u.canBuy("drone_damage")).toBe(false);
    expect(u.getSoldierStats().droneUnlocked).toBe(false);
    expect(u.buy("drone_unlock")).toBe(true);
    expect(u.getSoldierStats().droneDamage).toBe(damage);
    const loaded = new SaveManager(storage), lu=new UpgradeManager(loaded);
    expect(lu.activeMarketPath("pistol")?.root).toBe("drone_unlock");
    expect(lu.getSoldierStats()).toMatchObject({droneUnlocked:true,orbitUnlocked:false,reverseUnlocked:false});
    expect(loaded.data.loadouts[0].mutation).toBe("drone_shepherd");
    const before=loaded.data.essence, spent=1000-before;
    const refund=lu.refundBlackMarket();
    expect(refund.ok).toBe(true);
    if(refund.ok) {
      expect(refund.refunded.essence).toBe(spent);
      expect(refund.refunded.exoticMatter).toBe(3);
    }
    expect(loaded.data.exoticMatter).toBe(10);
    expect(loaded.data.essence).toBe(1000);
    expect(lu.marketOpen("pistol")).toBe(false);
    expect(loaded.data.blackMarketPaths).toEqual({});
  });

  it("migrates existing research with free access and preserves the equipped choice and spending",()=>{
    const {save}=scene();
    save.data.upgrades.reverse_unlock=1;save.data.upgrades.orbit_unlock=1;
    save.data.upgradeSpent={reverse_unlock:{essence:20},orbit_unlock:{essence:25}};
    save.data.loadouts[0].mutation="orbit_cylinder";
    const migrated=sanitizeSaveData(save.data);
    expect(migrated.upgrades.black_market_pistol).toBe(1);
    expect(migrated.blackMarketPaths.pistol).toBe("orbit_unlock");
    expect(migrated.upgradeSpent?.black_market_pistol).toEqual({});
    const roundtrip=sanitizeSaveData(migrated);
    expect(roundtrip.upgradeSpent?.black_market_pistol).toEqual({});
    expect(roundtrip.essence).toBe(migrated.essence);
    save.data=roundtrip;
    const result=new UpgradeManager(save).refundBlackMarket();
    if(result.ok)expect(result.refunded.essence).toBe(45);
  });

  it("only bypasses discovery while both Dev mode and its discovery setting are enabled",()=>{
    const {save,u}=scene();
    expect(u.needsFinding("shotgun_unlock")).toBe(true);
    expect(u.needsFinding("shotgun_damage")).toBe(true);
    save.data.settings.devFindUpgrades=true;
    expect(u.buy("shotgun_unlock")).toBe(false);
    save.data.settings.devMode=true;
    expect(u.needsFinding("shotgun_unlock")).toBe(false);
    expect(u.buy("shotgun_unlock")).toBe(true);
    expect(save.data.lab.worlds[1].specials).toEqual([]);
    save.data.settings.devMode=false;
    expect(u.needsFinding("ar_unlock")).toBe(true);
    expect(sanitizeSaveData({}).settings.devFindUpgrades).toBe(false);
  });
});
