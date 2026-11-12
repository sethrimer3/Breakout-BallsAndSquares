import { DRONE, GOO, PRISM } from "../config";
import type { SoldierStats } from "../entities/Soldier";
import type { UpgradeBranch, UpgradeDef, UpgradeId, Currency } from "./UpgradeDefinitions";

export type ExpansionUpgradeId =
  | "goo_dwell" | "goo_damage" | "goo_radius" | "goo_rate" | "goo_residue"
  | "katana_dash" | "katana_impulse" | "katana_glide" | "katana_kinetic" | "katana_wide" | "katana_recovery" | "katana_perfect"
  | "drone_unlock" | "drone_capacity" | "drone_cycle" | "drone_damage" | "drone_speed" | "drone_aim" | "drone_health" | "drone_recall"
  | "prism_unlock" | "prism_spectrum" | "prism_bounces" | "prism_gain" | "prism_shear" | "prism_distance" | "prism_overload";

function node(id: ExpansionUpgradeId, branch: UpgradeBranch, name: string, desc: string,
  col: number, row: number, levels: number, cost: number,
  apply: (stats: SoldierStats, level: number) => void, value: (level: number) => number,
  format: (value: number) => string, parent: UpgradeId | null, currency: Currency = "gold"): UpgradeDef {
  return { id, branch, name, shortDesc: desc, grid: { col, row }, maxLevel: levels,
    baseCost: cost, costMultiplier: levels === 1 ? 1 : 1.65, unlockLifetimePixels: branch === "drone_shepherd" ? 120 : branch === "prism_laser" ? 200 : 80,
    color: branch === "goo_mortar" ? "#9cde68" : branch === "prism_laser" ? "#d37cff" : "#38d6ff",
    apply, valueAt: value, formatValue: format, formatDelta: () => desc, parent, currency,
    icon: branch === "goo_mortar" ? "grenade" : branch === "drone_shepherd" ? "turret" : branch === "katana" ? "katana" : "bulletFast" };
}
const count = (n: number) => n;
const unlocked = (n: number) => n ? "UNLOCKED" : "LOCKED";
const pct = (n: number) => `${Math.round(n * 100)}%`;
const seconds = (n: number) => `${n.toFixed(2)}s`;
const fixed = (n: number) => `${n.toFixed(2)}×`;

export const EXPANSION_DEFS: readonly UpgradeDef[] = [
  node("goo_dwell", "goo_mortar", "Elastic Recall", "-0.02s contact dwell per level (minimum 0.08s)", 0,-1,5,70,
    (s,l)=>{s.gooDwell=Math.max(0.08,GOO.dwell-l*0.02);}, l=>Math.max(0.08,GOO.dwell-l*0.02),seconds,"goo_unlock"),
  node("goo_damage", "goo_mortar", "Volatile Droplets", "+1 mine center damage per level", 0,1,6,85,
    (s,l)=>{s.gooDamage=GOO.mineDamage+l;},l=>GOO.mineDamage+l,n=>`${n} DMG`,"goo_unlock"),
  node("goo_radius", "goo_mortar", "Glow Bloom", "+0.25 cells mine blast radius per level", 1,1,5,25,
    (s,l)=>{s.gooRadius=GOO.mineRadiusCells+l*0.25;},l=>GOO.mineRadiusCells+l*0.25,n=>`${n.toFixed(2)} CELLS`,"goo_unlock","crystals"),
  node("goo_rate", "goo_mortar", "Rapid Culture", "+10% orb launch frequency per level", -1,1,5,75,
    (s,l)=>{s.gooFireRate=GOO.fireRate*(1+l*0.1);},l=>1+l*0.1,pct,"goo_unlock"),
  node("goo_residue", "goo_mortar", "Living Residue", "Nearby bursts shorten mine fuses by 0.12s (minimum 0.04s)", 2,0,1,100,
    (s,l)=>{s.gooResidue=l>0;},count,unlocked,"goo_radius","crystals"),

  node("katana_dash","katana","Rebound Dash","Autonomous wall reflection triggers a 2.25× dash",-1,1,1,120,
    (s,l)=>{s.katanaDash=l>0;},count,unlocked,"katana_unlock"),
  node("katana_impulse","katana","Impulse Engine","+0.15 dash peak per level, capped at 3.0×",-2,-1,5,90,
    (s,l)=>{s.katanaDashPeak=Math.min(3,2.25+l*0.15);},l=>Math.min(3,2.25+l*0.15),fixed,"katana_dash"),
  node("katana_glide","katana","Extended Glide","+0.10s dash duration per level",-2,0,5,80,
    (s,l)=>{s.katanaDashDuration=0.7+l*0.1;},l=>0.7+l*0.1,seconds,"katana_dash"),
  node("katana_kinetic","katana","Kinetic Edge","+10% to the velocity-derived damage bonus",-2,1,5,30,
    (s,l)=>{s.katanaKinetic=1+l*0.1;},l=>1+l*0.1,pct,"katana_dash","crystals"),
  node("katana_wide","katana","Wide Momentum","+10% to the velocity-derived slash width bonus",2,-1,5,30,
    (s,l)=>{s.katanaWide=1+l*0.1;},l=>1+l*0.1,pct,"katana_dash","crystals"),
  node("katana_recovery","katana","Recovery Training","-0.20s dash cooldown per level (minimum 0.8s)",2,0,4,100,
    (s,l)=>{s.katanaDashCooldown=Math.max(0.8,1.8-l*0.2);},l=>Math.max(0.8,1.8-l*0.2),seconds,"katana_dash"),
  node("katana_perfect","katana","Perfect Rebound","First slash after a dash gains a harmless luminous afterimage",2,1,1,100,
    (s,l)=>{s.katanaPerfect=l>0;},count,unlocked,"katana_kinetic","crystals"),

  node("drone_unlock","drone_shepherd","Unlock Drone Shepherd","Release independent pistol drones every 4.5s; two per carrier",0,0,1,260,
    (s,l)=>{s.droneUnlocked=l>0;},count,unlocked,null),
  node("drone_capacity","drone_shepherd","Brood Capacity","+1 active drone per carrier (maximum seven, global cap 24)",-1,0,5,100,
    (s,l)=>{s.droneCapacity=DRONE.capacity+l;},l=>DRONE.capacity+l,n=>`${n} DRONES`,"drone_unlock"),
  node("drone_cycle","drone_shepherd","Assembly Cycle","-8% release interval per level",0,-1,5,90,
    (s,l)=>{s.droneReleaseInterval=DRONE.releaseInterval*(1-l*0.08);},l=>DRONE.releaseInterval*(1-l*0.08),seconds,"drone_unlock"),
  node("drone_damage","drone_shepherd","Pistol Microcaliber","+1 drone bullet damage per level; independent of Pistol Bankshot",1,0,6,90,
    (s,l)=>{s.droneDamage=DRONE.damage+l;},l=>DRONE.damage+l,n=>`${n} DMG`,"drone_unlock"),
  node("drone_speed","drone_shepherd","Flight Programming","+10% drone movement speed per level",0,1,5,65,
    (s,l)=>{s.droneSpeed=DRONE.speed*(1+l*0.1);},l=>1+l*0.1,pct,"drone_unlock"),
  node("drone_aim","drone_shepherd","Stabilized Optics","Up to +5° aim correction toward exposed Blight per level",1,1,4,25,
    (s,l)=>{s.droneAim=l*5;},l=>l*5,n=>`${n}°`,"drone_unlock","crystals"),
  node("drone_health","drone_shepherd","Redundant Frame","+1 drone HP per level; terrain still blocks movement",-1,1,4,70,
    (s,l)=>{s.droneHealth=DRONE.health+l;},l=>DRONE.health+l,n=>`${n} HP`,"drone_unlock"),
  node("drone_recall","drone_shepherd","Recall Burst","A drone fires one final shot when its timer expires",2,0,1,100,
    (s,l)=>{s.droneRecall=l>0;},count,unlocked,"drone_damage","crystals"),

  node("prism_unlock","prism_laser","Unlock Chromatic Prism","Pulsed red laser: pierce when charged, otherwise reflect; world edges absorb",0,0,1,400,
    (s,l)=>{s.prismUnlocked=l>0;},count,unlocked,null),
  node("prism_spectrum","prism_laser","Spectrum Ascension","Start one spectrum band higher and gain +1 base damage per level",-1,0,6,40,
    (s,l)=>{s.prismSpectrum=l;s.prismDamage=PRISM.damage+l;},count,n=>["RED I","ORANGE II","YELLOW III","GREEN IV","BLUE V","INDIGO VI","VIOLET VII"][n],"prism_unlock","crystals"),
  node("prism_bounces","prism_laser","Mirror Lattice","+1 reflection per level (maximum seven through upgrades)",0,-1,5,110,
    (s,l)=>{s.prismBounces=PRISM.bounces+l;},l=>PRISM.bounces+l,n=>`${n} BOUNCES`,"prism_unlock"),
  node("prism_gain","prism_laser","Refraction Gain","+10 percentage points of additive base-damage gain per bounce",1,0,5,120,
    (s,l)=>{s.prismGain=0.25+l*0.1;},l=>0.25+l*0.1,pct,"prism_unlock"),
  node("prism_shear","prism_laser","Photonic Shear","+1 extra block penetration budget gained per reflection",0,1,5,45,
    (s,l)=>{s.prismShear=1+l;},l=>1+l,n=>`${n} PIERCE / BOUNCE`,"prism_unlock","crystals"),
  node("prism_distance","prism_laser","Waveguide Length","+45 units total ray range, capped at 600",1,1,5,90,
    (s,l)=>{s.prismDistance=Math.min(600,PRISM.distance+l*45);},l=>Math.min(600,PRISM.distance+l*45),n=>`${n} RANGE`,"prism_unlock"),
  node("prism_overload","prism_laser","Chromatic Overload","Final violet reflection emits a harmless outward light pulse",-1,1,1,150,
    (s,l)=>{s.prismOverload=l>0;},count,unlocked,"prism_spectrum","crystals"),
];
