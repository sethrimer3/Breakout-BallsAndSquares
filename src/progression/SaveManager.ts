import { clamp } from "../core/math";
import type { WeaponType } from "../entities/Soldier";
import { UPGRADE_DEFS, type UpgradeId } from "./UpgradeDefinitions";

export const SAVE_KEY = "breach.save.v1";
export const SAVE_VERSION = 1;
export const SAVE_SLOTS_COUNT = 3;
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
  behavior: SoldierBehavior;
  equipment: (string | null)[];
}

const VALID_WEAPONS: readonly WeaponType[] = [
  "pistol",
  "shotgun",
  "assault_rifle",
  "rocket_launcher",
  "sniper_rifle",
  "katana",
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
  version: number;
  bank: number;
  crystals: number;
  lifetimePixels: number;
  upgrades: Record<UpgradeId, number>;
  loadouts: SoldierLoadout[];
  bests: {
    time: number;
    depth: number;
    pixels: number;
  };
  settings: {
    muted: boolean;
    volume: number;
    muzzleFlash: MuzzleFlashLevel;
    /** Soft, orange flame-style muzzle flashes. */
    fieryMuzzleFlash: boolean;
    /** Blur shadow edges in open-air light instead of crisp lines. */
    softShadows: boolean;
    autoFollowCamera: boolean;
    autoMove: boolean;
    alwaysShootWhenAutoMoveOff: boolean;
  };
  lastSaved?: number;
}

export function defaultSaveData(): SaveData {
  const upgrades = {} as Record<UpgradeId, number>;
  for (const d of UPGRADE_DEFS) upgrades[d.id] = 0;
  const loadouts: SoldierLoadout[] = [];
  for (let i = 0; i < MAX_SOLDIER_SLOTS; i++) {
    loadouts.push({ weapon: "pistol", behavior: "free", equipment: [null, null] });
  }
  return {
    version: SAVE_VERSION,
    bank: 0,
    crystals: 0,
    lifetimePixels: 0,
    upgrades,
    loadouts,
    bests: { time: 0, depth: 0, pixels: 0 },
    settings: {
      muted: false,
      volume: 0.6,
      muzzleFlash: "brightest",
      fieryMuzzleFlash: false,
      softShadows: false,
      autoFollowCamera: false,
      autoMove: true,
      alwaysShootWhenAutoMoveOff: false,
    },
  };
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

  def.bank = Math.floor(finiteNonNeg(obj.bank, 0));
  def.crystals = Math.floor(finiteNonNeg(obj.crystals, 0));
  def.lifetimePixels = Math.floor(finiteNonNeg(obj.lifetimePixels, 0));

  if (obj.upgrades && typeof obj.upgrades === "object") {
    const u = obj.upgrades as Record<string, unknown>;
    for (const d of UPGRADE_DEFS) {
      const lvl = Math.floor(finiteNonNeg(u[d.id], 0, d.maxLevel));
      def.upgrades[d.id] = clamp(lvl, 0, d.maxLevel);
    }
  }

  if (Array.isArray(obj.loadouts)) {
    for (let i = 0; i < Math.min(MAX_SOLDIER_SLOTS, obj.loadouts.length); i++) {
      const item = obj.loadouts[i] as Record<string, unknown> | null;
      if (item && typeof item === "object") {
        const w = item.weapon;
        if (typeof w === "string" && (VALID_WEAPONS as readonly string[]).includes(w)) {
          def.loadouts[i].weapon = w as WeaponType;
        }
        const b = item.behavior;
        if (typeof b === "string" && (VALID_BEHAVIORS as readonly string[]).includes(b)) {
          def.loadouts[i].behavior = b as SoldierBehavior;
        }
      }
    }
  }
  // If any weapon or behavior is not unlocked in this save, fall back to safe defaults.
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
    def.settings.softShadows = typeof s.softShadows === "boolean" ? s.softShadows : false;
    def.settings.autoFollowCamera =
      typeof s.autoFollowCamera === "boolean" ? s.autoFollowCamera : false;
    def.settings.autoMove = typeof s.autoMove === "boolean" ? s.autoMove : true;
    def.settings.alwaysShootWhenAutoMoveOff =
      typeof s.alwaysShootWhenAutoMoveOff === "boolean" ? s.alwaysShootWhenAutoMoveOff : false;
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
  bank: number;
  crystals: number;
  lifetimePixels: number;
  upgradesCount: number;
  bestDepth: number;
  bestTime: number;
  lastSaved?: number;
}

export class SaveManager {
  data: SaveData;
  activeSlot: number;

  constructor(private storage: StorageLike | null = typeof localStorage !== "undefined" ? localStorage : null) {
    this.activeSlot = this.readActiveSlot();
    this.data = this.loadSlot(this.activeSlot);
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
    if (!this.storage) return defaultSaveData();
    try {
      const raw = this.storage.getItem(this.getSlotKey(slot));
      if (!raw || raw.trim() === "") return defaultSaveData();
      const parsed = JSON.parse(raw);
      return sanitizeSaveData(parsed);
    } catch (err) {
      console.warn(`BREACH: corrupted save data in slot ${slot}, resetting to defaults.`, err);
      return defaultSaveData();
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
    const def = defaultSaveData();
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
      this.data = defaultSaveData();
    }
  }

  getSlotSummary(slot: number): SlotSummary {
    const exists = this.slotExists(slot);
    if (!exists) {
      return {
        slot,
        exists: false,
        bank: 0,
        crystals: 0,
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
      bank: data.bank,
      crystals: data.crystals,
      lifetimePixels: data.lifetimePixels,
      upgradesCount,
      bestDepth: data.bests?.depth ?? 0,
      bestTime: data.bests?.time ?? 0,
      lastSaved: data.lastSaved,
    };
  }
}
