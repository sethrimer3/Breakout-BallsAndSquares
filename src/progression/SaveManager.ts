import { parseProfileSeed, randomProfileSeed } from "../core/ProfileSeed";
import type { SpeedrunData } from "../core/SpeedrunTimer";
import { sectorCount, sectorTier } from "../world/labMap";
import { clamp } from "../core/math";
import { LAB_WORLD_COUNT, LAB_WORLDS } from "../world/labMap";
import { CAMPAIGN, campaignTier } from "../world/campaignBalance";
import { normalizeLegacyWeapon, type PrimaryMutation, type SecondaryWeaponType, type WeaponType } from "../entities/Soldier";
import { SOLDIER_UPGRADE_DEFS, type SoldierUpgradeLevels } from "./SoldierUpgrades";
import { UPGRADE_DEFS, upgradePrices, type UpgradeId } from "./UpgradeDefinitions";

export const SAVE_KEY = "breach.save.v1";
export const SAVE_VERSION = 1;
export const SAVE_SLOTS_COUNT = 3;
export const NEW_PROFILE_SEED_KEY = "breach.new_profile_seed.v1";
export const ACTIVE_SLOT_KEY = "breach.active_slot.v1";

export function getSlotKey(slot: number): string {
  if (slot <= 1) return SAVE_KEY;
  return `breach.save.v1.slot.${slot}`;
}

export type SoldierBehavior =
  | "free"
  | "orthogonal"
  | "vertical"
  | "horizontal"
  | "turn_left"
  | "turn_right"
  | "sentry_slow"
  | "sentry_fast";

export const VALID_BEHAVIORS: readonly SoldierBehavior[] = [
  "free",
  "orthogonal",
  "vertical",
  "horizontal",
  "turn_left",
  "turn_right",
  "sentry_slow",
  "sentry_fast",
];

export interface SoldierLoadout {
  weapon: WeaponType;
  mutation?: PrimaryMutation | null;
  secondary?: SecondaryWeaponType | null;
  behavior: SoldierBehavior;
  equipment: (string | null)[];
  /** Levels bought on this soldier's own upgrade tree. */
  upgrades?: SoldierUpgradeLevels;
}

export const VALID_SECONDARY_WEAPONS: readonly SecondaryWeaponType[] = ["grenade", "turret"];

const VALID_WEAPONS: readonly WeaponType[] = [
  "pistol",
  "shotgun",
  "assault_rifle",
  "rocket_launcher",
  "sniper_rifle",
  "katana",
  "flamethrower",
];

const VALID_MUTATIONS: readonly PrimaryMutation[] = [
  "reverse_revolver",
  "orbit_cylinder",
  "drone_shepherd",
  "squelch",
  "vacuum_pulse",
  "overcharge_conductor",
  "circuit_runner",
  "burrower",
  "freeze_rockets",
  "chromatic_prism",
  "rail_lance",
  "gale_edge",
  "napalm_garden",
  "cryospray",
];
const MAX_SOLDIER_SLOTS = 8;

export type MuzzleFlashLevel = "brightest" | "brighter" | "bright" | "dim" | "dimmer" | "off";

export const MUZZLE_FLASH_LEVELS: readonly MuzzleFlashLevel[] = [
  "brightest",
  "brighter",
  "bright",
  "dim",
  "dimmer",
  "off",
];

export const MUZZLE_FLASH_MULTIPLIER: Record<MuzzleFlashLevel, number> = {
  brightest: 1.0,
  brighter: 0.75,
  bright: 0.52,
  dim: 0.3,
  dimmer: 0.14,
  off: 0,
};

export interface SaveData {
  /** Fixed generation code for this profile. */
  seed: string;
  speedrun: SpeedrunData;
  version: number;
  bank: number;
  crystals: number;
  /** Tier 3 green crystals, dropped in Zone 3. */
  greenCrystals: number;
  /** Blight Essence, dropped by Blight Cores. */
  essence: number;
  biomass: number;
  lifetimePixels: number;
  upgrades: Record<UpgradeId, number>;
  upgradeSpent?: Partial<Record<UpgradeId, Partial<Record<"gold" | "crystals" | "greenCrystals" | "essence" | "biomass", number>>>>;
  loadouts: SoldierLoadout[];
  bests: {
    time: number;
    depth: number;
    pixels: number;
  };
  settings: {
    devMode: boolean;
    devMapAccess: boolean;
    muted: boolean;
    volume: number;
    muzzleFlash: MuzzleFlashLevel;
    /** Soft, orange flame-style muzzle flashes. */
    fieryMuzzleFlash: boolean;
    /** Blur shadow edges in open-air light instead of crisp lines. */
    softShadows: boolean;
    prismPatterns: boolean;
    autoFollowCamera: boolean;
    autoMove: boolean;
    alwaysShootWhenAutoMoveOff: boolean;
  };
  /** Progress through the hand-made lab worlds (see world/labMap.ts). */
  lab: {
    /** World (zone) the squad deploys into. */
    world: number;
    /** Highest world the squad has reached through a gate. */
    unlocked: number;
    /** Per world (keyed "1", "2", ...), by sector index. */
    worlds: Record<string, LabWorldProgress>;
  };
  lastSaved?: number;
}

export interface LabWorldProgress {
  /** Sectors a soldier or turret has seen. */
  discovered: number[];
  /** Discovered sectors with every Blight generator destroyed: safe to deploy into. */
  conquered: number[];
  /** Sector the squad last deployed into. */
  spawn: number;
  cleared: string[];
  gathered: string[];
}

/** Fresh progress for lab world `id`: only its starting sector is known and safe. */
export function freshLabWorld(id: number): LabWorldProgress {
  const start = LAB_WORLDS[id].start;
  return { discovered: [start], conquered: [start], spawn: start, cleared: [], gathered: [] };
}

function defaultLab(): SaveData["lab"] {
  const worlds: Record<string, LabWorldProgress> = {};
  for (let id = 1; id <= LAB_WORLD_COUNT; id++) worlds[id] = freshLabWorld(id);
  return { world: 1, unlocked: 1, worlds };
}

export function defaultSaveData(seed = randomProfileSeed()): SaveData {
  const upgrades = {} as Record<UpgradeId, number>;
  for (const d of UPGRADE_DEFS) upgrades[d.id] = 0;
  const loadouts: SoldierLoadout[] = [];
  for (let i = 0; i < MAX_SOLDIER_SLOTS; i++) {
    loadouts.push({ weapon: "pistol", mutation: null, secondary: null, behavior: "free", equipment: [null, null], upgrades: {} });
  }
  return {
    seed,
    speedrun: { enabled: false, elapsedMs: 0 },
    version: SAVE_VERSION,
    bank: 0,
    crystals: 0,
    greenCrystals: 0,
    essence: 0,
    biomass: 0,
    lifetimePixels: 0,
    upgrades,
    upgradeSpent: {},
    loadouts,
    bests: { time: 0, depth: 0, pixels: 0 },
    settings: {
      devMode: false,
      devMapAccess: false,
      muted: false,
      volume: 0.6,
      muzzleFlash: "brightest",
      fieryMuzzleFlash: false,
      softShadows: false,
      prismPatterns: true,
      autoFollowCamera: false,
      autoMove: true,
      alwaysShootWhenAutoMoveOff: false,
    },
    lab: defaultLab(),
  };
}

function sectorList(v: unknown, id: number): number[] {
  const def = LAB_WORLDS[id];
  const out = new Set<number>([def.start]);
  if (Array.isArray(v)) {
    for (const s of v) if (typeof s === "number" && Number.isInteger(s) && s >= 0 && s < sectorCount(def)) out.add(s);
  }
  return [...out].sort((a, b) => a - b);
}

function sanitizeLabWorld(v: unknown, id: number): LabWorldProgress {
  if (!v || typeof v !== "object") return freshLabWorld(id);
  const w = v as Record<string, unknown>;
  const discovered = sectorList(w.discovered, id);
  const conquered = sectorList(w.conquered, id).filter((s) => discovered.includes(s));
  const spawn = typeof w.spawn === "number" && conquered.includes(w.spawn) ? w.spawn : LAB_WORLDS[id].start;
  const ids = (v: unknown): string[] => Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && x.length < 80))].slice(0,5000) : [];
  return { discovered, conquered, spawn, cleared: ids(w.cleared), gathered: ids(w.gathered) };
}

function finiteNonNeg(v: unknown, fallback = 0, max = 1e12): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  return clamp(v, 0, max);
}

/**
 * Validate and sanitize an arbitrary parsed JSON value into a clean `SaveData`.
 * Missing, out-of-range, or wrong-typed fields fall back to safe defaults.
 */
export function sanitizeSaveData(raw: unknown): SaveData {
  const def = defaultSaveData();
  if (!raw || typeof raw !== "object") return def;
  const obj = raw as Record<string, unknown>;

  def.seed = parseProfileSeed(obj.seed) ?? def.seed;
  if (obj.speedrun && typeof obj.speedrun === "object") {
    const timer = obj.speedrun as Record<string, unknown>;
    def.speedrun.enabled = timer.enabled === true;
    def.speedrun.elapsedMs = finiteNonNeg(timer.elapsedMs);
  }

  def.bank = Math.floor(finiteNonNeg(obj.bank, 0));
  def.crystals = Math.floor(finiteNonNeg(obj.crystals, 0));
  def.greenCrystals = Math.floor(finiteNonNeg(obj.greenCrystals, 0));
  def.essence = Math.floor(finiteNonNeg(obj.essence, 0));
  def.biomass = Math.floor(finiteNonNeg(obj.biomass, 0));
  def.lifetimePixels = Math.floor(finiteNonNeg(obj.lifetimePixels, 0));

  if (obj.upgrades && typeof obj.upgrades === "object") {
    const u = obj.upgrades as Record<string, unknown>;
    // Retired squad stat nodes no longer exist. Refund their gold once:
    // sanitized saves omit these IDs, so a later load cannot refund them again.
    for (const [id, cost, growth, cap] of [
      ["ball_speed", 15, 1.55, 10], ["soldier_health", 30, 1.6, 10],
      ["core_fire_rate", 25, 1.6, 10], ["core_damage", 45, 1.75, 8], ["core_velocity", 20, 1.55, 8],
    ] as const) {
      const level = Math.floor(finiteNonNeg(u[id], 0, cap));
      for (let l = 0; l < level; l++) def.bank += Math.ceil(cost * growth ** l);
    }
    for (const d of UPGRADE_DEFS) {
      const lvl = Math.floor(finiteNonNeg(u[d.id], 0, d.maxLevel));
      def.upgrades[d.id] = clamp(lvl, 0, d.maxLevel);
    }
  }

  if (obj.upgradeSpent && typeof obj.upgradeSpent === "object") {
    const rawSpent = obj.upgradeSpent as Record<string, unknown>;
    const cleanSpent: NonNullable<SaveData["upgradeSpent"]> = {};
    for (const d of UPGRADE_DEFS) {
      const entry = rawSpent[d.id];
      if (!entry || typeof entry !== "object") continue;
      const curMap: Partial<Record<"gold" | "crystals" | "greenCrystals" | "essence" | "biomass", number>> = {};
      for (const c of ["gold", "crystals", "greenCrystals", "essence", "biomass"] as const) {
        const val = Math.floor(finiteNonNeg((entry as Record<string, unknown>)[c], 0));
        if (val > 0) curMap[c] = val;
      }
      if (Object.keys(curMap).length > 0) cleanSpent[d.id] = curMap;
    }
    def.upgradeSpent = cleanSpent;
  }

  if (Array.isArray(obj.loadouts)) {
    for (let i = 0; i < Math.min(MAX_SOLDIER_SLOTS, obj.loadouts.length); i++) {
      const item = obj.loadouts[i] as Record<string, unknown> | null;
      if (item && typeof item === "object") {
        const w = item.weapon;
        if (typeof w === "string") {
          const norm = normalizeLegacyWeapon(w, item.mutation);
          if ((VALID_WEAPONS as readonly string[]).includes(norm.weapon)) {
            def.loadouts[i].weapon = norm.weapon;
          }
          // Legacy standalone variants imply their canonical base weapon is accessible if the variant was unlocked.
          if (w === "goo_mortar" && (def.upgrades.goo_unlock ?? 0) > 0) {
            def.upgrades.shotgun_unlock = Math.max(1, def.upgrades.shotgun_unlock ?? 0);
          } else if (w === "prism_laser" && (def.upgrades.prism_unlock ?? 0) > 0) {
            def.upgrades.sniper_unlock = Math.max(1, def.upgrades.sniper_unlock ?? 0);
          }
          def.loadouts[i].mutation = norm.mutation && (VALID_MUTATIONS as readonly string[]).includes(norm.mutation)
            ? norm.mutation
            : null;
        } else {
          def.loadouts[i].mutation = typeof item.mutation === "string" && (VALID_MUTATIONS as readonly string[]).includes(item.mutation)
            ? (item.mutation as PrimaryMutation)
            : null;
        }
        const b = item.behavior;
        if (typeof b === "string" && (VALID_BEHAVIORS as readonly string[]).includes(b)) {
          def.loadouts[i].behavior = b as SoldierBehavior;
        }
        const s = item.secondary;
        if (typeof s === "string" && (VALID_SECONDARY_WEAPONS as readonly string[]).includes(s as SecondaryWeaponType)) {
          def.loadouts[i].secondary = s as SecondaryWeaponType;
        } else {
          def.loadouts[i].secondary = null;
        }
        const levels = item.upgrades;
        if (levels && typeof levels === "object") {
          const raw = levels as Record<string, unknown>;
          const clean: SoldierUpgradeLevels = {};
          for (const d of SOLDIER_UPGRADE_DEFS) {
            const lvl = Math.floor(finiteNonNeg(raw[d.id], 0, d.maxLevel));
            if (lvl > 0) clean[d.id] = lvl;
          }
          def.loadouts[i].upgrades = clean;
        }
      }
    }
  }
  // If any weapon or behavior is not unlocked in this save, fall back to safe defaults.
  const ownedNonPistol = new Set<WeaponType>();
  for (const ld of def.loadouts) {
    if (ld.weapon === "shotgun" && (def.upgrades.shotgun_unlock ?? 0) === 0) {
      ld.weapon = "pistol";
    } else if (ld.weapon === "assault_rifle" && (def.upgrades.ar_unlock ?? 0) === 0) {
      ld.weapon = "pistol";
    } else if (ld.weapon === "rocket_launcher" && (def.upgrades.rocket_unlock ?? 0) === 0) {
      ld.weapon = "pistol";
    } else if (ld.weapon === "sniper_rifle" && (def.upgrades.sniper_unlock ?? 0) === 0) {
      ld.weapon = "pistol";
    } else if (ld.weapon === "katana" && (def.upgrades.katana_unlock ?? 0) === 0) {
      ld.weapon = "pistol";
    } else if (ld.weapon === "flamethrower" && (def.upgrades.flame_unlock ?? 0) === 0) {
      ld.weapon = "pistol";
    }

    // Enforce unique non-Pistol primary ownership across squad slots.
    if (ld.weapon !== "pistol") {
      if (ownedNonPistol.has(ld.weapon)) {
        ld.weapon = "pistol";
        ld.mutation = null;
      } else {
        ownedNonPistol.add(ld.weapon);
      }
    }

    if (ld.mutation === "reverse_revolver" && (ld.weapon !== "pistol" || def.upgrades.reverse_unlock === 0)) ld.mutation = null;
    else if (ld.mutation === "orbit_cylinder" && (ld.weapon !== "pistol" || def.upgrades.orbit_unlock === 0)) ld.mutation = null;
    else if (ld.mutation === "drone_shepherd" && (ld.weapon !== "pistol" || def.upgrades.drone_unlock === 0)) ld.mutation = null;
    else if (ld.mutation === "squelch" && (ld.weapon !== "shotgun" || def.upgrades.goo_unlock === 0)) ld.mutation = null;
    else if (ld.mutation === "vacuum_pulse" && (ld.weapon !== "shotgun" || def.upgrades.vacuum_unlock === 0)) ld.mutation = null;
    else if (ld.mutation === "overcharge_conductor" && (ld.weapon !== "assault_rifle" || def.upgrades.overcharge_unlock === 0)) ld.mutation = null;
    else if (ld.mutation === "circuit_runner" && (ld.weapon !== "assault_rifle" || def.upgrades.circuit_unlock === 0)) ld.mutation = null;
    else if (ld.mutation === "burrower" && (ld.weapon !== "rocket_launcher" || def.upgrades.burrower_unlock === 0)) ld.mutation = null;
    else if (ld.mutation === "freeze_rockets" && (ld.weapon !== "rocket_launcher" || def.upgrades.freeze_rockets_unlock === 0)) ld.mutation = null;
    else if (ld.mutation === "chromatic_prism" && (ld.weapon !== "sniper_rifle" || def.upgrades.prism_unlock === 0)) ld.mutation = null;
    else if (ld.mutation === "rail_lance" && (ld.weapon !== "sniper_rifle" || def.upgrades.rail_lance_unlock === 0)) ld.mutation = null;
    else if (ld.mutation === "gale_edge" && (ld.weapon !== "katana" || def.upgrades.gale_unlock === 0)) ld.mutation = null;
    else if (ld.mutation === "napalm_garden" && (ld.weapon !== "flamethrower" || def.upgrades.napalm_unlock === 0)) ld.mutation = null;
    else if (ld.mutation === "cryospray" && (ld.weapon !== "flamethrower" || def.upgrades.cryospray_unlock === 0)) ld.mutation = null;

    if (ld.secondary === "grenade" && (def.upgrades.grenade_unlock ?? 0) === 0) {
      ld.secondary = null;
    } else if (ld.secondary === "turret" && (def.upgrades.turret_unlock ?? 0) === 0) {
      ld.secondary = null;
    }

    if (ld.behavior === "orthogonal" && (def.upgrades.behavior_orthogonal ?? 0) === 0) {
      ld.behavior = "free";
    } else if ((ld.behavior === "vertical" || ld.behavior === "horizontal") && (def.upgrades.behavior_patrol ?? 0) === 0) {
      ld.behavior = "free";
    } else if ((ld.behavior === "turn_left" || ld.behavior === "turn_right") && (def.upgrades.behavior_turns ?? 0) === 0) {
      ld.behavior = "free";
    } else if ((ld.behavior === "sentry_slow" || ld.behavior === "sentry_fast") && (def.upgrades.behavior_sentry ?? 0) === 0) {
      ld.behavior = "free";
    }
  }

  if (obj.bests && typeof obj.bests === "object") {
    const b = obj.bests as Record<string, unknown>;
    def.bests.time = finiteNonNeg(b.time, 0);
    def.bests.depth = Math.floor(finiteNonNeg(b.depth, 0));
    def.bests.pixels = Math.floor(finiteNonNeg(b.pixels, 0));
  }

  if (obj.settings && typeof obj.settings === "object") {
    const s = obj.settings as Record<string, unknown>;
    def.settings.devMode = s.devMode === true;
    def.settings.devMapAccess = s.devMapAccess === true;
    def.settings.muted = typeof s.muted === "boolean" ? s.muted : false;
    def.settings.volume = finiteNonNeg(s.volume, 0.6, 1);
    if (
      typeof s.muzzleFlash === "string" &&
      (MUZZLE_FLASH_LEVELS as readonly string[]).includes(s.muzzleFlash)
    ) {
      def.settings.muzzleFlash = s.muzzleFlash as MuzzleFlashLevel;
    }
    def.settings.fieryMuzzleFlash =
      typeof s.fieryMuzzleFlash === "boolean" ? s.fieryMuzzleFlash : false;
    def.settings.prismPatterns = typeof s.prismPatterns === "boolean" ? s.prismPatterns : true;
    def.settings.softShadows = typeof s.softShadows === "boolean" ? s.softShadows : false;
    def.settings.autoFollowCamera =
      typeof s.autoFollowCamera === "boolean" ? s.autoFollowCamera : false;
    def.settings.autoMove = typeof s.autoMove === "boolean" ? s.autoMove : true;
    def.settings.alwaysShootWhenAutoMoveOff =
      typeof s.alwaysShootWhenAutoMoveOff === "boolean" ? s.alwaysShootWhenAutoMoveOff : false;
  }

  if (obj.lab && typeof obj.lab === "object") {
    const lab = obj.lab as Record<string, unknown>;
    const worlds = lab.worlds && typeof lab.worlds === "object" ? (lab.worlds as Record<string, unknown>) : {};
    for (let id = 1; id <= LAB_WORLD_COUNT; id++) def.lab.worlds[id] = sanitizeLabWorld(worlds[id], id);
    // Saves from before zone 2 kept zone 1's progress at the top level.
    if (!lab.worlds && "discovered" in lab) def.lab.worlds[1] = sanitizeLabWorld(lab, 1);
    const int = (x: unknown, fallback: number): number => (typeof x === "number" && Number.isInteger(x) ? x : fallback);
    def.lab.unlocked = clamp(int(lab.unlocked, 1), 1, LAB_WORLD_COUNT);
    def.lab.world = clamp(int(lab.world, 1), 1, def.lab.unlocked);

    // Migration recovery for finite rewards lost due to previous drop expiration/refresh bugs:
    // If a save already cleared encounters or gathered groves, ensure wallet biomass and essence
    // are at least the sum of their fixed entitlements (less any spent on soldier upgrades).
    let minBiomass = 0;
    let minEssence = 0;
    for (let id = 3; id <= LAB_WORLD_COUNT; id++) {
      const wProg = def.lab.worlds[id];
      const worldDef = LAB_WORLDS[id];
      if (!wProg || !worldDef) continue;
      for (const idStr of wProg.gathered) {
        const parts = idStr.split(":");
        const s = parseInt(parts[0], 10);
        if (Number.isFinite(s)) {
          const t = sectorTier(worldDef, s);
          const p = CAMPAIGN[campaignTier(t)];
          minBiomass += p.biomass;
        }
      }
      for (const idStr of wProg.cleared) {
        const parts = idStr.split(":");
        const s = parseInt(parts[0], 10);
        const kind = parts[1];
        if (Number.isFinite(s)) {
          const t = sectorTier(worldDef, s);
          const p = CAMPAIGN[campaignTier(t)];
          minEssence += p.essence * (kind === "brute" ? 2 : 1);
        }
      }
    }
    // Account for essence/biomass legitimately spent on existing soldier upgrades:
    // Note: If player already spent resources on upgrades, minBiomass/minEssence represents
    // total earned. Ensure current wallet >= (earned - spent).
    let spentBiomass = 0;
    let spentEssence = 0;
    for (const ld of def.loadouts) {
      if (!ld.upgrades) continue;
      for (const d of SOLDIER_UPGRADE_DEFS) {
        const lvl = ld.upgrades[d.id] ?? 0;
        for (let l = 0; l < lvl; l++) {
          if (d.tier === 4) {
            spentBiomass += Math.ceil(d.baseCost * (d.costMultiplier ?? 1.25) ** l);
          }
          const ess = d.essenceCost ?? 0;
          if (ess > 0) {
            spentEssence += Math.round(ess * (1 + 0.5 * l));
          }
        }
      }
    }
    // Also account for Essence spent on tree / Black Market upgrades so reload never restores spent Essence.
    for (const d of UPGRADE_DEFS) {
      const recorded = def.upgradeSpent?.[d.id];
      if (recorded) {
        if (typeof recorded.essence === "number" && recorded.essence > 0) spentEssence += recorded.essence;
        continue;
      }
      // Legacy pre-ledger saves: reconstruct Essence cost for purchased nodes without an upgradeSpent entry.
      const lvl = def.upgrades[d.id] ?? 0;
      for (let l = 0; l < lvl; l++) {
        for (const p of upgradePrices(d, l)) {
          if (p.currency === "essence") spentEssence += p.amount;
        }
      }
    }
    const targetBiomass = Math.max(0, minBiomass - spentBiomass);
    const targetEssence = Math.max(0, minEssence - spentEssence);
    if (def.biomass < targetBiomass) def.biomass = targetBiomass;
    if (def.essence < targetEssence) def.essence = targetEssence;
  }

  if (typeof obj.lastSaved === "number" && Number.isFinite(obj.lastSaved)) {
    def.lastSaved = obj.lastSaved;
  }

  return def;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface SlotSummary {
  slot: number;
  exists: boolean;
  seed: string | null;
  speedrun: SpeedrunData;
  bank: number;
  crystals: number;
  greenCrystals: number;
  essence: number;
  biomass: number;
  lifetimePixels: number;
  upgradesCount: number;
  bestDepth: number;
  bestTime: number;
  lastSaved?: number;
}

export class SaveManager {
  data: SaveData;
  activeSlot: number;

  /** Remove every BREACH save slot and setting, leaving other apps' storage alone. */
  deleteAllData(): void {
    if (this.storage) {
      for (const key of [SAVE_KEY, getSlotKey(2), getSlotKey(3), ACTIVE_SLOT_KEY, NEW_PROFILE_SEED_KEY]) {
        if (this.storage.removeItem) this.storage.removeItem(key);
        else this.storage.setItem(key, "");
      }
    }
    this.activeSlot = 1;
    this.data = this.freshSave();
  }

  constructor(private storage: StorageLike | null = typeof localStorage !== "undefined" ? localStorage : null) {
    this.activeSlot = this.readActiveSlot();
    this.data = this.loadSlot(this.activeSlot);
  }

  /** Installation-wide default, applied only when a new profile is created. */
  get newProfileSeed(): string {
    try { return parseProfileSeed(this.storage?.getItem(NEW_PROFILE_SEED_KEY)) ?? ""; }
    catch { return ""; }
  }

  setNewProfileSeed(value: string): boolean {
    const seed = value.trim() === "" ? "" : parseProfileSeed(value);
    if (seed === null) return false;
    try { this.storage?.setItem(NEW_PROFILE_SEED_KEY, seed); }
    catch { return false; }
    // An empty slot is only a preview until initialized or first saved.
    if (!this.slotExists(this.activeSlot)) this.data.seed = seed || randomProfileSeed();
    return true;
  }

  private freshSave(): SaveData {
    return defaultSaveData(this.newProfileSeed || randomProfileSeed());
  }

  private readActiveSlot(): number {
    if (!this.storage) return 1;
    try {
      const raw = this.storage.getItem(ACTIVE_SLOT_KEY);
      if (!raw) return 1;
      const parsed = parseInt(raw, 10);
      return parsed >= 1 && parsed <= SAVE_SLOTS_COUNT ? parsed : 1;
    } catch {
      return 1;
    }
  }

  getSlotKey(slot: number): string {
    return getSlotKey(slot);
  }

  slotExists(slot: number): boolean {
    if (!this.storage) return false;
    try {
      const raw = this.storage.getItem(this.getSlotKey(slot));
      return raw !== null && raw.trim() !== "";
    } catch {
      return false;
    }
  }

  loadSlot(slot: number): SaveData {
    if (!this.storage) return this.freshSave();
    try {
      const raw = this.storage.getItem(this.getSlotKey(slot));
      if (!raw || raw.trim() === "") return this.freshSave();
      const parsed = JSON.parse(raw);
      const data = sanitizeSaveData(parsed);
      // Assign legacy profiles a code once, including when inspected from the menu.
      if (parsed && typeof parsed === "object" && parsed.seed !== data.seed) {
        try { this.storage.setItem(this.getSlotKey(slot), JSON.stringify(data)); }
        catch { /* Keep loaded progress usable even when storage is read-only. */ }
      }
      return data;
    } catch (err) {
      console.warn(`BREACH: corrupted save data in slot ${slot}, resetting to defaults.`, err);
      return this.freshSave();
    }
  }

  load(): SaveData {
    return this.loadSlot(this.activeSlot);
  }

  peekSlot(slot: number): SaveData | null {
    if (!this.slotExists(slot)) return null;
    return this.loadSlot(slot);
  }

  selectSlot(slot: number): void {
    if (slot < 1 || slot > SAVE_SLOTS_COUNT) slot = 1;
    this.activeSlot = slot;
    if (this.storage) {
      try {
        this.storage.setItem(ACTIVE_SLOT_KEY, String(slot));
      } catch {
        // ignore
      }
    }
    this.data = this.loadSlot(slot);
  }

  save(slot?: number): void {
    if (!this.storage) return;
    try {
      this.data.lastSaved = Date.now();
      const targetSlot = slot ?? this.activeSlot;
      this.storage.setItem(this.getSlotKey(targetSlot), JSON.stringify(this.data));
    } catch (err) {
      console.warn("BREACH: failed to write save data.", err);
    }
  }

  reset(slot?: number): void {
    const targetSlot = slot ?? this.activeSlot;
    const def = this.freshSave();
    def.lastSaved = Date.now();
    if (targetSlot === this.activeSlot) {
      this.data = def;
    }
    if (this.storage) {
      try {
        this.storage.setItem(this.getSlotKey(targetSlot), JSON.stringify(def));
      } catch (err) {
        console.warn("BREACH: failed to reset save slot.", err);
      }
    }
  }

  deleteSlot(slot: number): void {
    if (slot < 1 || slot > SAVE_SLOTS_COUNT) return;
    if (this.storage) {
      try {
        if (typeof this.storage.removeItem === "function") {
          this.storage.removeItem(this.getSlotKey(slot));
        } else {
          this.storage.setItem(this.getSlotKey(slot), "");
        }
      } catch {
        // ignore
      }
    }
    if (slot === this.activeSlot) {
      this.data = this.freshSave();
    }
  }

  getSlotSummary(slot: number): SlotSummary {
    const exists = this.slotExists(slot);
    if (!exists) {
      return {
        slot,
        exists: false,
        seed: null,
        speedrun: { enabled: false, elapsedMs: 0 },
        bank: 0,
        crystals: 0,
        greenCrystals: 0,
        essence: 0,
        biomass: 0,
        lifetimePixels: 0,
        upgradesCount: 0,
        bestDepth: 0,
        bestTime: 0,
        lastSaved: undefined,
      };
    }
    const data = slot === this.activeSlot ? this.data : this.loadSlot(slot);
    let upgradesCount = 0;
    if (data.upgrades) {
      for (const id of Object.keys(data.upgrades) as UpgradeId[]) {
        if ((data.upgrades[id] ?? 0) > 0) {
          upgradesCount += data.upgrades[id]!;
        }
      }
    }
    return {
      slot,
      exists: true,
      seed: data.seed,
      speedrun: { ...data.speedrun },
      bank: data.bank,
      crystals: data.crystals,
      greenCrystals: data.greenCrystals,
      essence: data.essence,
      biomass: data.biomass,
      lifetimePixels: data.lifetimePixels,
      upgradesCount,
      bestDepth: data.bests?.depth ?? 0,
      bestTime: data.bests?.time ?? 0,
      lastSaved: data.lastSaved,
    };
  }
}
