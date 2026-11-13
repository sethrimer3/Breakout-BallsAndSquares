import { DRONE, GOO, PRISM, GALE } from "../config";
import type { SoldierStats } from "../entities/Soldier";
import type { UpgradeBranch, UpgradeDef, UpgradeId, Currency } from "./UpgradeDefinitions";

export type ExpansionUpgradeId =
  | "reverse_unlock" | "orbit_unlock"
  | "vacuum_unlock"
  | "burrower_unlock" | "freeze_rockets_unlock"
  | "rail_lance_unlock"
  | "gale_unlock" | "gale_range"
  | "napalm_unlock" | "cryospray_unlock"
  | "goo_dwell" | "goo_damage" | "goo_radius" | "goo_rate" | "goo_residue"
  | "katana_dash" | "katana_impulse" | "katana_glide" | "katana_kinetic" | "katana_wide" | "katana_recovery" | "katana_perfect"
  | "drone_unlock" | "drone_capacity" | "drone_cycle" | "drone_damage" | "drone_speed" | "drone_aim" | "drone_health" | "drone_recall"
  | "prism_unlock" | "prism_spectrum" | "prism_bounces" | "prism_gain" | "prism_shear" | "prism_distance" | "prism_overload";

function node(id: ExpansionUpgradeId, branch: UpgradeBranch, name: string, desc: string,
  col: number, row: number, levels: number, cost: number,
  apply: (stats: SoldierStats, level: number) => void, value: (level: number) => number,
  format: (value: number) => string, parent: UpgradeId | null, currency: Currency = "gold"): UpgradeDef {
  const isGoo = id.startsWith("goo_");
  const isPrism = id.startsWith("prism_");
  const isDrone = id.startsWith("drone_");
  return { id, branch, name, shortDesc: desc, grid: { col, row }, maxLevel: levels,
    baseCost: cost, costMultiplier: levels === 1 ? 1 : 1.65, unlockLifetimePixels: isDrone ? 120 : isPrism ? 200 : 80,
    color: isGoo ? "#9cde68" : isPrism ? "#d37cff" : "#38d6ff",
    apply, valueAt: value, formatValue: format, formatDelta: () => desc, parent, currency,
    icon: isGoo ? "grenade" : isDrone ? "turret" : branch === "katana" ? "katana" : "bulletFast" };
}
const count = (n: number) => n;
const unlocked = (n: number) => n ? "UNLOCKED" : "LOCKED";
const pct = (n: number) => `${Math.round(n * 100)}%`;
const seconds = (n: number) => `${n.toFixed(2)}s`;
const fixed = (n: number) => `${n.toFixed(2)}×`;

export const EXPANSION_DEFS: readonly UpgradeDef[] = [
  node("reverse_unlock","pistol","Reverse-Playback Revolver","Unlock a selectable Pistol mutation: shots pause, then rewind their exact route",1,1,1,20,
    (s,l)=>{s.reverseUnlocked=l>0;},count,unlocked,null,"essence"),
  node("orbit_unlock","pistol","Orbit Cylinder","Unlock Pistol mutation: rounds orbit the soldier and sling outward on real wall bounces",1,-1,1,25,
    (s,l)=>{s.orbitUnlocked=l>0;},count,unlocked,null,"essence"),
  node("vacuum_unlock","shotgun","Vacuum Pulse","Unlock Shotgun mutation: 0.5× fire rate, sucks in nearby debris to boost pellets & damage",-1,-1,1,30,
    (s,l)=>{s.vacuumUnlocked=l>0;},count,unlocked,"shotgun_unlock","essence"),
  node("burrower_unlock","rocket_launcher","Burrower","Unlock Rocket mutation: drills through terrain, laying mines that detonate together",-1,-1,1,35,
    (s,l)=>{s.burrowerUnlocked=l>0;},count,unlocked,"rocket_unlock","essence"),
  node("freeze_rockets_unlock","rocket_launcher","Freeze Rockets","Unlock Rocket mutation: cold-only burst freezes terrain, Blight & enemies (no block damage)",1,-1,1,35,
    (s,l)=>{s.freezeRocketsUnlocked=l>0;},count,unlocked,"rocket_unlock","essence"),
  node("rail_lance_unlock","sniper_rifle","Rail Lance","Unlock Sniper mutation: charge cycle into one ultra-long piercing straight-line strike",1,-1,1,40,
    (s,l)=>{s.railLanceUnlocked=l>0;},count,unlocked,"sniper_unlock","essence"),
  node("gale_unlock","katana","Windborn Blade","Unlock Gale Edge: long-range flying crescents instead of Momentum dash-and-cleave",1,-1,1,30,
    (s,l)=>{s.galeUnlocked=l>0;},count,unlocked,"katana_unlock","essence"),
  node("gale_range","katana","Extended Horizon","+60 units Gale Edge range per level (maximum 660)",-1,-1,6,10,
    (s,l)=>{s.galeDistance=Math.min(GALE.maxDistance,GALE.distance+l*60);},l=>Math.min(GALE.maxDistance,GALE.distance+l*60),n=>`${n} RANGE`,"gale_unlock","essence"),
  node("napalm_unlock","flamethrower","Napalm Garden","Unlock Flamethrower mutation: sprays persistent unlit fuel (10s) ignited by other weapons (3s burn)",-1,-1,1,35,
    (s,l)=>{s.napalmUnlocked=l>0;},count,unlocked,"flame_unlock","essence"),
  node("cryospray_unlock","flamethrower","Cryospray","Unlock Flamethrower mutation: freezing mist chills enemies, halves Blight growth & primes shatter",1,-1,1,35,
    (s,l)=>{s.cryosprayUnlocked=l>0;},count,unlocked,"flame_unlock","essence"),

  node("goo_dwell", "shotgun", "Elastic Recall", "-0.02s contact dwell per level (minimum 0.08s)", -1,2,5,70,
    (s,l)=>{s.gooDwell=Math.max(0.08,GOO.dwell-l*0.02);}, l=>Math.max(0.08,GOO.dwell-l*0.02),seconds,"goo_unlock"),
  node("goo_damage", "shotgun", "Volatile Droplets", "+1 mine center damage per level", 0,2,6,85,
    (s,l)=>{s.gooDamage=GOO.mineDamage+l;},l=>GOO.mineDamage+l,n=>`${n} DMG`,"goo_unlock"),
  node("goo_radius", "shotgun", "Glow Bloom", "+0.25 cells mine blast radius per level", 1,2,5,25,
    (s,l)=>{s.gooRadius=GOO.mineRadiusCells+l*0.25;},l=>GOO.mineRadiusCells+l*0.25,n=>`${n.toFixed(2)} CELLS`,"goo_unlock","crystals"),
  node("goo_rate", "shotgun", "Rapid Culture", "+10% orb launch frequency per level", 2,2,5,75,
    (s,l)=>{s.gooFireRate=GOO.fireRate*(1+l*0.1);},l=>1+l*0.1,pct,"goo_unlock"),
  node("goo_residue", "shotgun", "Living Residue", "Nearby bursts shorten mine fuses by 0.12s (minimum 0.04s)", 3,2,1,100,
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

  node("drone_unlock","pistol","Unlock Drone Shepherd","Pistol mutation: release independent pistol drones every 4.5s; two per carrier",-1,-1,1,260,
    (s,l)=>{s.droneUnlocked=l>0;},count,unlocked,null),
  node("drone_capacity","pistol","Brood Capacity","+1 active drone per carrier (maximum seven, global cap 24)",-3,2,5,100,
    (s,l)=>{s.droneCapacity=DRONE.capacity+l;},l=>DRONE.capacity+l,n=>`${n} DRONES`,"drone_unlock"),
  node("drone_cycle","pistol","Assembly Cycle","-8% release interval per level",-2,2,5,90,
    (s,l)=>{s.droneReleaseInterval=DRONE.releaseInterval*(1-l*0.08);},l=>DRONE.releaseInterval*(1-l*0.08),seconds,"drone_unlock"),
  node("drone_damage","pistol","Pistol Microcaliber","+1 drone bullet damage per level; independent of Pistol Bankshot",-1,2,6,90,
    (s,l)=>{s.droneDamage=DRONE.damage+l;},l=>DRONE.damage+l,n=>`${n} DMG`,"drone_unlock"),
  node("drone_speed","pistol","Flight Programming","+10% drone movement speed per level",0,2,5,65,
    (s,l)=>{s.droneSpeed=DRONE.speed*(1+l*0.1);},l=>1+l*0.1,pct,"drone_unlock"),
  node("drone_aim","pistol","Stabilized Optics","Up to +5° aim correction toward exposed Blight per level",1,2,4,25,
    (s,l)=>{s.droneAim=l*5;},l=>l*5,n=>`${n}°`,"drone_unlock","crystals"),
  node("drone_health","pistol","Redundant Frame","+1 drone HP per level; terrain still blocks movement",2,2,4,70,
    (s,l)=>{s.droneHealth=DRONE.health+l;},l=>DRONE.health+l,n=>`${n} HP`,"drone_unlock"),
  node("drone_recall","pistol","Recall Burst","A drone fires one final shot when its timer expires",3,2,1,100,
    (s,l)=>{s.droneRecall=l>0;},count,unlocked,"drone_damage","crystals"),

  node("prism_unlock","sniper_rifle","Unlock Chromatic Prism","Sniper mutation: pulsed red laser; pierce when charged, otherwise reflect",-1,-1,1,400,
    (s,l)=>{s.prismUnlocked=l>0;},count,unlocked,"sniper_unlock"),
  node("prism_spectrum","sniper_rifle","Spectrum Ascension","Start one spectrum band higher and gain +1 base damage per level",-3,2,6,40,
    (s,l)=>{s.prismSpectrum=l;s.prismDamage=PRISM.damage+l;},count,n=>["RED I","ORANGE II","YELLOW III","GREEN IV","BLUE V","INDIGO VI","VIOLET VII"][n],"prism_unlock","crystals"),
  node("prism_bounces","sniper_rifle","Mirror Lattice","+1 reflection per level (maximum seven through upgrades)",-2,2,5,110,
    (s,l)=>{s.prismBounces=PRISM.bounces+l;},l=>PRISM.bounces+l,n=>`${n} BOUNCES`,"prism_unlock"),
  node("prism_gain","sniper_rifle","Refraction Gain","+10 percentage points of additive base-damage gain per bounce",-1,2,5,120,
    (s,l)=>{s.prismGain=0.25+l*0.1;},l=>0.25+l*0.1,pct,"prism_unlock"),
  node("prism_shear","sniper_rifle","Photonic Shear","+1 extra block penetration budget gained per reflection",0,2,5,45,
    (s,l)=>{s.prismShear=1+l;},l=>1+l,n=>`${n} PIERCE / BOUNCE`,"prism_unlock","crystals"),
  node("prism_distance","sniper_rifle","Waveguide Length","+45 units total ray range, capped at 600",1,2,5,90,
    (s,l)=>{s.prismDistance=Math.min(600,PRISM.distance+l*45);},l=>Math.min(600,PRISM.distance+l*45),n=>`${n} RANGE`,"prism_unlock"),
  node("prism_overload","sniper_rifle","Chromatic Overload","Final violet reflection emits a harmless outward light pulse",2,2,1,150,
    (s,l)=>{s.prismOverload=l>0;},count,unlocked,"prism_spectrum","crystals"),
];
