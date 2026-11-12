/** Fixed-size reusable storage; callers reset entity-specific state on acquisition. */
export class FixedPool<T extends { active: boolean }> {
  readonly items: T[];
  activeCount = 0;

  constructor(size: number, create: () => T) {
    this.items = Array.from({ length: size }, create);
  }

  acquire(): T | null {
    const item = this.items.find((entry) => !entry.active);
    if (!item) return null;
    item.active = true;
    this.activeCount++;
    return item;
  }

  release(item: T): void {
    if (!item.active) return;
    item.active = false;
    this.activeCount--;
  }

  clear(): void {
    for (const item of this.items) item.active = false;
    this.activeCount = 0;
  }
}
