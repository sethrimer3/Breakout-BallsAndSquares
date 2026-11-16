import { describe, expect, it } from 'vitest';
import { FreezeSystem } from '../src/systems/FreezeSystem';
import { PixelWorld } from '../src/world/PixelWorld';

function fixture() {
  const world = new PixelWorld({ width: 16, height: 16, cellSize: 8, roomSize: 4 });
  world.setCell(5, 5, 10);
  return { world, freeze: new FreezeSystem(world), index: 5 * world.width + 5 };
}

describe('active frozen terrain indices', () => {
  it('lists refreshed cells once and removes thawed cells', () => {
    const { freeze, index } = fixture();
    freeze.freezeCell(5, 5, 1, 1);
    freeze.freezeCell(5, 5, 1, 2);
    expect(freeze.activeCellIndices).toEqual([index]);
    freeze.update(1);
    expect(freeze.cellTimer[index]).toBe(1);
    freeze.update(1);
    expect(freeze.activeCellIndices).toEqual([]);
    freeze.freezeCell(5, 5, 1);
    expect(freeze.activeCellIndices).toEqual([index]);
    freeze.clear();
    expect(freeze.activeCellIndices).toEqual([]);
    freeze.freezeCell(5, 5, 1);
    expect(freeze.activeCellIndices).toEqual([index]);
  });

  it('does not draw or tick a destroyed-and-refrozen cell twice before compaction', () => {
    const { world, freeze, index } = fixture();
    freeze.freezeCell(5, 5, 1, 2);
    world.damage(5, 5, 100);
    freeze.onCellDestroyed(5, 5);
    expect(freeze.cellTimer[index]).toBe(0);
    world.setCell(5, 5, 10);
    freeze.freezeCell(5, 5, 1, 2);
    expect(freeze.activeCellIndices).toEqual([index]);
    freeze.update(0.25);
    expect(freeze.cellTimer[index]).toBe(1.75);
    world.damage(5, 5, 100);
    freeze.update(0);
    expect(freeze.activeCellIndices).toEqual([]);
  });
});
