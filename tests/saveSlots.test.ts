import { describe, expect, it } from "vitest";
import {
  ACTIVE_SLOT_KEY,
  SAVE_KEY,
  SAVE_SLOTS_COUNT,
  SaveManager,
  getSlotKey,
  type StorageLike,
} from "../src/progression/SaveManager";

class MemStorage implements StorageLike {
  map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
}

describe("3 Save Slots System", () => {
  it("defaults to Slot 1 using legacy SAVE_KEY for backward compatibility", () => {
    const store = new MemStorage();
    const save = new SaveManager(store);
    expect(save.activeSlot).toBe(1);
    expect(save.getSlotKey(1)).toBe(SAVE_KEY);
    expect(getSlotKey(1)).toBe(SAVE_KEY);
    expect(getSlotKey(2)).toBe("breach.save.v1.slot.2");
    expect(getSlotKey(3)).toBe("breach.save.v1.slot.3");
  });

  it("allows switching between 3 save slots and isolates their data", () => {
    const store = new MemStorage();
    const save = new SaveManager(store);

    // Save data into Slot 1
    save.data.bank = 1000;
    save.data.lifetimePixels = 500;
    save.save();

    expect(save.getSlotSummary(1).bank).toBe(1000);
    expect(save.getSlotSummary(1).exists).toBe(true);
    expect(save.getSlotSummary(2).exists).toBe(false);

    // Switch to Slot 2
    save.selectSlot(2);
    expect(save.activeSlot).toBe(2);
    expect(save.data.bank).toBe(0); // fresh default for slot 2

    // Save data into Slot 2
    save.data.bank = 2500;
    save.data.crystals = 15;
    save.save();

    // Switch to Slot 3
    save.selectSlot(3);
    expect(save.activeSlot).toBe(3);
    save.data.bank = 9999;
    save.save();

    // Verify summaries
    const sum1 = save.getSlotSummary(1);
    const sum2 = save.getSlotSummary(2);
    const sum3 = save.getSlotSummary(3);

    expect(sum1.bank).toBe(1000);
    expect(sum2.bank).toBe(2500);
    expect(sum2.crystals).toBe(15);
    expect(sum3.bank).toBe(9999);

    // Verify active slot persisted in storage
    expect(store.getItem(ACTIVE_SLOT_KEY)).toBe("3");

    // Creating a new SaveManager reloads active slot 3
    const reloaded = new SaveManager(store);
    expect(reloaded.activeSlot).toBe(3);
    expect(reloaded.data.bank).toBe(9999);
  });

  it("supports deleting / clearing a save slot safely", () => {
    const store = new MemStorage();
    const save = new SaveManager(store);

    save.selectSlot(2);
    save.data.bank = 5000;
    save.save();
    expect(save.slotExists(2)).toBe(true);

    save.deleteSlot(2);
    expect(save.slotExists(2)).toBe(false);
    expect(save.data.bank).toBe(0);
    expect(save.getSlotSummary(2).exists).toBe(false);
  });

  it("clamps invalid slot selection to safe bounds", () => {
    const store = new MemStorage();
    const save = new SaveManager(store);

    save.selectSlot(99);
    expect(save.activeSlot).toBe(1);

    save.selectSlot(0);
    expect(save.activeSlot).toBe(1);

    save.selectSlot(-5);
    expect(save.activeSlot).toBe(1);

    expect(SAVE_SLOTS_COUNT).toBe(3);
  });

  it("records lastSaved timestamp and correctly resets a slot", () => {
    const store = new MemStorage();
    const save = new SaveManager(store);

    save.selectSlot(1);
    save.data.bank = 300;
    save.save();

    const sum = save.getSlotSummary(1);
    expect(typeof sum.lastSaved).toBe("number");
    expect(sum.lastSaved).toBeGreaterThan(0);

    save.reset(1);
    expect(save.data.bank).toBe(0);
    expect(save.getSlotSummary(1).bank).toBe(0);
  });
});
