import { clamp } from "../core/math";
import { UPGRADE_DEFS, type UpgradeId } from "./UpgradeDefinitions";

export const SAVE_KEY = "breach.save.v1";
export const SAVE_VERSION = 1;

export interface SaveData {
  version: number;
  bank: number;
  lifetimePixels: number;
  upgrades: Record<UpgradeId, number>;
  bests: {
    time: number;
    depth: number;
    pixels: number;
  };
  settings: {
    muted: boolean;
    volume: number;
  };
}

export function defaultSaveData(): SaveData {
  const upgrades = {} as Record<UpgradeId, number>;
  for (const d of UPGRADE_DEFS) upgrades[d.id] = 0;
  return {
    version: SAVE_VERSION,
    bank: 0,
    lifetimePixels: 0,
    upgrades,
    bests: { time: 0, depth: 0, pixels: 0 },
    settings: { muted: false, volume: 0.6 },
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
  def.lifetimePixels = Math.floor(finiteNonNeg(obj.lifetimePixels, 0));

  if (obj.upgrades && typeof obj.upgrades === "object") {
    const u = obj.upgrades as Record<string, unknown>;
    for (const d of UPGRADE_DEFS) {
      const lvl = Math.floor(finiteNonNeg(u[d.id], 0, d.maxLevel));
      def.upgrades[d.id] = clamp(lvl, 0, d.maxLevel);
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
