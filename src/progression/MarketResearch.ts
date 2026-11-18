import { BURROWER, CIRCUIT, FREEZE, GALE, NAPALM, ORBIT, RAIL, REVERSE, VACUUM } from "../config";
import type { SoldierStats } from "../entities/Soldier";
import type { UpgradeBranch, UpgradeDef, UpgradeId } from "./UpgradeDefinitions";

/**
 * Black Market path research: upgrades that deepen a mutation once its path
 * is chosen. Each node belongs to one path (see WEAPON_MARKETS) and is only
 * buyable while that path is active. Paid in Blight Essence, the Black
 * Market's currency, which every world provides.
 */
export type MarketResearchId =
  | "reverse_surge" | "reverse_snap"
  | "orbit_capacity" | "orbit_sling"
  | "homing_seeker" | "homing_turn"
  | "vacuum_intake" | "vacuum_compress"
  | "overcharge_capacitor"
  | "circuit_trace" | "circuit_harden"
  | "burrower_bore" | "burrower_payload"
  | "freeze_deep" | "freeze_wide"
  | "rail_capacitor" | "rail_pierce"
  | "gale_pierce" | "gale_width"
  | "napalm_fuel" | "napalm_spill"
  | "cryo_chill" | "cryo_reach";

interface Spec {
  id: MarketResearchId;
  branch: UpgradeBranch;
  root: UpgradeId;
  name: string;
  desc: string;
  levels: number;
  cost: number;
  value: (level: number) => number;
  format: (value: number) => string;
  delta: string;
  apply: (stats: SoldierStats, level: number) => void;
}

const pct = (v: number): string => `${Math.round(v * 100)}%`;
const secs = (v: number): string => `${v.toFixed(2)}s`;

function research(spec: Spec): UpgradeDef {
  return {
    id: spec.id, branch: spec.branch, name: spec.name, shortDesc: spec.desc,
    color: "#ff4b8b", grid: { col: 0, row: 0 }, parent: spec.root,
    maxLevel: spec.levels, currency: "essence", baseCost: spec.cost, costMultiplier: 1.65,
    valueAt: spec.value, formatValue: spec.format, formatDelta: () => spec.delta,
    apply: (s, l) => spec.apply(s, Math.max(0, Math.min(spec.levels, l))),
    icon: "bulletFast",
  };
}

export const MARKET_RESEARCH_DEFS: readonly UpgradeDef[] = [
  // Pistol: Reverse-Playback Revolver
  research({ id: "reverse_surge", branch: "pistol", root: "reverse_unlock", name: "Rewind Surge",
    desc: "+25% damage on each shot's rewind trip per level", levels: 4, cost: 12,
    value: (l) => 1 + 0.25 * l, format: pct, delta: "+25% REWIND DMG",
    apply: (s, l) => { s.reverseDamageMult = 1 + 0.25 * l; } }),
  research({ id: "reverse_snap", branch: "pistol", root: "reverse_unlock", name: "Snap Rewind",
    desc: "-0.03s hang before a shot rewinds, per level", levels: 4, cost: 10,
    value: (l) => Math.max(0.06, REVERSE.pause - 0.03 * l), format: secs, delta: "-0.03s HANG",
    apply: (s, l) => { s.reversePause = Math.max(0.06, REVERSE.pause - 0.03 * l); } }),
  // Pistol: Orbit Cylinder
  research({ id: "orbit_capacity", branch: "pistol", root: "orbit_unlock", name: "Extended Cylinder",
    desc: "+2 orbiting rounds held per soldier, per level", levels: 4, cost: 12,
    value: (l) => ORBIT.maxRounds + 2 * l, format: (v) => `${v} ROUNDS`, delta: "+2 ROUNDS",
    apply: (s, l) => { s.orbitMaxRounds = ORBIT.maxRounds + 2 * l; } }),
  research({ id: "orbit_sling", branch: "pistol", root: "orbit_unlock", name: "Sling Charge",
    desc: "+20% damage on orbiting rounds per level", levels: 5, cost: 10,
    value: (l) => 1 + 0.2 * l, format: pct, delta: "+20% ROUND DMG",
    apply: (s, l) => { s.orbitDamageMult = 1 + 0.2 * l; } }),
  // Shotgun: Homing Bullets
  research({ id: "homing_seeker", branch: "shotgun", root: "homing_shotgun_unlock", name: "Seeker Heads",
    desc: "+24 lock-on range for homing pellets per level", levels: 4, cost: 10,
    value: (l) => 128 + 24 * l, format: (v) => `${v} RANGE`, delta: "+24 LOCK RANGE",
    apply: (s, l) => { s.homingRange = 128 + 24 * l; } }),
  research({ id: "homing_turn", branch: "shotgun", root: "homing_shotgun_unlock", name: "Tight Turns",
    desc: "+25% homing pellet turn rate per level", levels: 4, cost: 12,
    value: (l) => 1 + 0.25 * l, format: pct, delta: "+25% TURN",
    apply: (s, l) => { s.homingTurnRate = Math.PI * 1.5 * (1 + 0.25 * l); } }),
  // Shotgun: Vacuum Pulse
  research({ id: "vacuum_intake", branch: "shotgun", root: "vacuum_unlock", name: "Wide Intake",
    desc: "+20 debris suction range per level", levels: 4, cost: 10,
    value: (l) => VACUUM.range + 20 * l, format: (v) => `${v} RANGE`, delta: "+20 SUCTION",
    apply: (s, l) => { s.vacuumRange = VACUUM.range + 20 * l; } }),
  research({ id: "vacuum_compress", branch: "shotgun", root: "vacuum_unlock", name: "Compression Chamber",
    desc: "+0.15 pellet damage per unit of debris swallowed, per level", levels: 5, cost: 12,
    value: (l) => VACUUM.damagePerMass + 0.15 * l, format: (v) => `+${v.toFixed(2)} / MASS`, delta: "+0.15 DMG/MASS",
    apply: (s, l) => { s.vacuumDamagePerMass = VACUUM.damagePerMass + 0.15 * l; } }),
  // Assault Rifle: Overcharge Conductor (Conductor Stabilization already exists)
  research({ id: "overcharge_capacitor", branch: "assault_rifle", root: "overcharge_unlock", name: "Capacitor Bank",
    desc: "+20% Overcharge discharge power (blast and chain) per level", levels: 5, cost: 12,
    value: (l) => 1 + 0.2 * l, format: pct, delta: "+20% DISCHARGE",
    apply: (s, l) => { s.overchargePowerMult = 1 + 0.2 * l; } }),
  // Assault Rifle: Circuit Runner
  research({ id: "circuit_trace", branch: "assault_rifle", root: "circuit_unlock", name: "Long Trace",
    desc: "+40 laser path length per level", levels: 4, cost: 10,
    value: (l) => CIRCUIT.baseRange + 40 * l, format: (v) => `${v} RANGE`, delta: "+40 PATH",
    apply: (s, l) => { s.circuitRange = CIRCUIT.baseRange + 40 * l; } }),
  research({ id: "circuit_harden", branch: "assault_rifle", root: "circuit_unlock", name: "Hardened Traces",
    desc: "+6 laser pierce per level", levels: 4, cost: 12,
    value: (l) => CIRCUIT.pierce + 6 * l, format: (v) => `${v} PIERCE`, delta: "+6 PIERCE",
    apply: (s, l) => { s.circuitPierce = CIRCUIT.pierce + 6 * l; } }),
  // Rocket: Burrower
  research({ id: "burrower_bore", branch: "rocket_launcher", root: "burrower_unlock", name: "Deep Bore",
    desc: "+3 cells and +24 units of drilling per rocket, per level", levels: 4, cost: 10,
    value: (l) => BURROWER.maxDrillCells + 3 * l, format: (v) => `${v} CELLS`, delta: "+3 DRILL CELLS",
    apply: (s, l) => { s.burrowerDrillCells = BURROWER.maxDrillCells + 3 * l; s.burrowerDrillDist = BURROWER.maxDrillDist + 24 * l; } }),
  research({ id: "burrower_payload", branch: "rocket_launcher", root: "burrower_unlock", name: "Mine Payload",
    desc: "+1 mine laid per rocket, per level", levels: 3, cost: 15,
    value: (l) => BURROWER.mineCount + l, format: (v) => `${v} MINES`, delta: "+1 MINE",
    apply: (s, l) => { s.burrowerExtraMines = l; } }),
  // Rocket: Freeze Rockets
  research({ id: "freeze_deep", branch: "rocket_launcher", root: "freeze_rockets_unlock", name: "Deep Freeze",
    desc: "+0.75s freeze duration per level", levels: 4, cost: 10,
    value: (l) => FREEZE.duration + 0.75 * l, format: secs, delta: "+0.75s FREEZE",
    apply: (s, l) => { s.freezeRocketDuration = FREEZE.duration + 0.75 * l; } }),
  research({ id: "freeze_wide", branch: "rocket_launcher", root: "freeze_rockets_unlock", name: "Cold Front",
    desc: "+15% freeze burst radius per level", levels: 4, cost: 12,
    value: (l) => 1 + 0.15 * l, format: pct, delta: "+15% RADIUS",
    apply: (s, l) => { s.freezeRocketRadiusMult = 1 + 0.15 * l; } }),
  // Sniper: Rail Lance
  research({ id: "rail_capacitor", branch: "sniper_rifle", root: "rail_lance_unlock", name: "Rail Capacitor",
    desc: "+20% Rail Lance strike damage per level", levels: 5, cost: 12,
    value: (l) => 1 + 0.2 * l, format: pct, delta: "+20% STRIKE DMG",
    apply: (s, l) => { s.railDamageMult = 1 + 0.2 * l; } }),
  research({ id: "rail_pierce", branch: "sniper_rifle", root: "rail_lance_unlock", name: "Tungsten Core",
    desc: "+5 Rail Lance pierce per level", levels: 4, cost: 10,
    value: (l) => RAIL.bonusPierce + 5 * l, format: (v) => `+${v} PIERCE`, delta: "+5 PIERCE",
    apply: (s, l) => { s.railPierce = RAIL.bonusPierce + 5 * l; } }),
  // Katana: Gale Edge (Extended Horizon already exists)
  research({ id: "gale_pierce", branch: "katana", root: "gale_unlock", name: "Cleaving Wind",
    desc: "+1 crescent pierce per level", levels: 4, cost: 12,
    value: (l) => GALE.pierce + l, format: (v) => `${v} PIERCE`, delta: "+1 PIERCE",
    apply: (s, l) => { s.galePierce = GALE.pierce + l; } }),
  research({ id: "gale_width", branch: "katana", root: "gale_unlock", name: "Broad Crescent",
    desc: "+4 crescent width per level", levels: 4, cost: 10,
    value: (l) => GALE.width + 4 * l, format: (v) => `${v} WIDTH`, delta: "+4 WIDTH",
    apply: (s, l) => { s.galeWidth = GALE.width + 4 * l; } }),
  // Flamethrower: Napalm Garden
  research({ id: "napalm_fuel", branch: "flamethrower", root: "napalm_unlock", name: "Stable Fuel",
    desc: "+3s before unlit fuel evaporates, per level", levels: 4, cost: 10,
    value: (l) => NAPALM.unlitDuration + 3 * l, format: (v) => `${v}s`, delta: "+3s FUEL",
    apply: (s, l) => { s.napalmFuelLife = NAPALM.unlitDuration + 3 * l; } }),
  research({ id: "napalm_spill", branch: "flamethrower", root: "napalm_unlock", name: "Wide Spill",
    desc: "+1.5 fuel patch reach (ignition and enemy burns) per level", levels: 4, cost: 12,
    value: (l) => NAPALM.patchRadius + 1.5 * l, format: (v) => `${v.toFixed(1)} REACH`, delta: "+1.5 REACH",
    apply: (s, l) => { s.napalmRadius = NAPALM.patchRadius + 1.5 * l; } }),
  // Flamethrower: Cryospray
  research({ id: "cryo_chill", branch: "flamethrower", root: "cryospray_unlock", name: "Deep Chill",
    desc: "+0.75s freeze duration per level", levels: 4, cost: 10,
    value: (l) => FREEZE.duration + 0.75 * l, format: secs, delta: "+0.75s FREEZE",
    apply: (s, l) => { s.cryoDuration = FREEZE.duration + 0.75 * l; } }),
  research({ id: "cryo_reach", branch: "flamethrower", root: "cryospray_unlock", name: "Long Mist",
    desc: "+15% mist reach per level", levels: 4, cost: 12,
    value: (l) => 1 + 0.15 * l, format: pct, delta: "+15% REACH",
    apply: (s, l) => { s.cryoReachMult = 1 + 0.15 * l; } }),
];

/** The path root each research node deepens. */
export const RESEARCH_ROOT: Readonly<Record<MarketResearchId, UpgradeId>> = Object.fromEntries(
  MARKET_RESEARCH_DEFS.map((d) => [d.id, d.parent as UpgradeId]),
) as Record<MarketResearchId, UpgradeId>;
