import type { PrimaryMutation, WeaponType } from "../entities/Soldier";
import type { SpriteName } from "../ui/pixelArt";
import type { UpgradeDef, UpgradeId } from "./UpgradeDefinitions";

export type BlackMarketAccessId = `black_market_${WeaponType}`;
export interface MarketPath {
  root: UpgradeId;
  mutation: PrimaryMutation | null;
  nodes: readonly UpgradeId[];
}
export interface WeaponMarket {
  weapon: WeaponType;
  label: string;
  icon: SpriteName;
  unlock: UpgradeId | null;
  paths: readonly MarketPath[];
}
const path = (root: UpgradeId, mutation: PrimaryMutation | null, nodes: UpgradeId[] = []): MarketPath => ({root, mutation, nodes: [root, ...nodes]});
/** The Pistol's third path rises above the weapon silhouette. */
export const DRONE_PATH: MarketPath = path("drone_unlock","drone_shepherd",["drone_capacity","drone_cycle","drone_damage","drone_speed","drone_aim","drone_health","drone_recall"]);
export const WEAPON_MARKETS: readonly WeaponMarket[] = [
  {weapon:"pistol",label:"Pistol",icon:"pistol",unlock:null,paths:[path("reverse_unlock","reverse_revolver"),path("orbit_unlock","orbit_cylinder"),DRONE_PATH]},
  {weapon:"shotgun",label:"Shotgun",icon:"shotgun",unlock:"shotgun_unlock",paths:[
    path("goo_unlock","squelch",["goo_mass","goo_distance","goo_dwell","goo_damage","goo_radius","goo_rate","goo_residue"]),path("vacuum_unlock","vacuum_pulse")]},
  {weapon:"assault_rifle",label:"Assault Rifle",icon:"rifle",unlock:"ar_unlock",paths:[
    path("overcharge_unlock","overcharge_conductor",["overcharge_accuracy"]),path("circuit_unlock","circuit_runner")]},
  {weapon:"rocket_launcher",label:"Rocket",icon:"launcher",unlock:"rocket_unlock",paths:[path("burrower_unlock","burrower"),path("freeze_rockets_unlock","freeze_rockets")]},
  {weapon:"sniper_rifle",label:"Sniper",icon:"sniper",unlock:"sniper_unlock",paths:[
    path("prism_unlock","chromatic_prism",["prism_spectrum","prism_bounces","prism_gain","prism_shear","prism_distance","prism_overload"]),path("rail_lance_unlock","rail_lance")]},
  {weapon:"katana",label:"Katana",icon:"katana",unlock:"katana_unlock",paths:[
    path("katana_dash",null,["katana_impulse","katana_glide","katana_kinetic","katana_wide","katana_recovery","katana_perfect"]),path("gale_unlock","gale_edge",["gale_range"])]},
  {weapon:"flamethrower",label:"Flamer",icon:"flamethrower",unlock:"flame_unlock",paths:[path("napalm_unlock","napalm_garden"),path("cryospray_unlock","cryospray")]},
];
export const marketFor = (weapon: string): WeaponMarket | undefined => WEAPON_MARKETS.find(m=>m.weapon===weapon);
export const accessId = (weapon: WeaponType): BlackMarketAccessId => `black_market_${weapon}`;
export function marketNode(id: string): {market: WeaponMarket; path: MarketPath} | undefined {
  for (const market of WEAPON_MARKETS) {
    for (const path of market.paths) if (path.nodes.includes(id as UpgradeId)) return {market,path};
  }
}
export const BLACK_MARKET_DEFS: readonly UpgradeDef[] = WEAPON_MARKETS.map(m=>({
  id:accessId(m.weapon),branch:m.weapon,name:"Black Market",
  shortDesc:"Open this weapon's Black Market tree. Choose one mutation path; pay again to switch sides.",
  color:"#ff4b8b",grid:{col:2,row:-1},parent:m.unlock,maxLevel:1,baseCost:20,costMultiplier:1,
  currency:"essence",unlockLifetimePixels:0,icon:m.icon,
  apply:()=>{},valueAt:l=>l,formatValue:l=>l?"OPEN":"LOCKED",formatDelta:()=>"OPEN BLACK MARKET",
}));
