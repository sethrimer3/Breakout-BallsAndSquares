import { clamp } from "../core/math";
import type { WeaponType } from "../entities/Soldier";
import { UPGRADE_DEFS, type UpgradeId } from "./UpgradeDefinitions";

export const SAVE_KEY = "breach.save.v1";
export const SAVE_VERSION = 1;

export interface SoldierLoadout {
  weapon: WeaponType;
  equipment: (string | null)[];
}

const VALID_WEAPONS: readonly WeaponType[] = ["pistol", "shotgun"];
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
    autoFollowCamera: boolean;
  };
}

export function defaultSaveData(): SaveData {
  const upgrades = {} as Record<UpgradeId, number>;
  for (const d of UPGRADE_DEFS) upgrades[d.id] = 0;
  const loadouts: SoldierLoadout[] = [];
  for (let i = 0; i < MAX_SOLDIER_SLOTS; i++) {
    loadouts.push({ weapon: "pistol", equipment: [null, null] });
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
      autoFollowCamera: false,
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
      }
    }
  }
  // If shotgun is not unlocked in this save, fall back any shotgun loadouts to pistol.
  if ((def.upgrades.shotgun_unlock ?? 0) === 0) {
    for (const ld of def.loadouts) {
      if (ld.weapon === "shotgun") ld.weapon = "pistol";
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
    def.settings.autoFollowCamera =
      typeof s.autoFollowCamera === "boolean" ? s.autoFollowCamera : false;
  }

  return def;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export class SaveManager {
  data: SaveData;

  constructor(private storage: StorageLike | null = typeof localStorage !== "undefined" ? localStorage : null) {
    this.data = this.load();
  }

  load(): SaveData {
    if (!this.storage) return defaultSaveData();
    try {
      const raw = this.storage.getItem(SAVE_KEY);
      if (!raw) return defaultSaveData();
      const parsed = JSON.parse(raw);
      return sanitizeSaveData(parsed);
    } catch (err) {
      console.warn("BREACH: corrupted save data, resetting to defaults.", err);
      return defaultSaveData();
    }
  }

  save(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(SAVE_KEY, JSON.stringify(this.data));
    } catch (err) {
      console.warn("BREACH: failed to write save data.", err);
    }
  }

  reset(): void {
    this.data = defaultSaveData();
    this.save();
  }
}
