import { DECOR } from "./LabDetails";
import { LIGHT_KIND, MAT, type PixelWorld } from "./PixelWorld";

/** First lab landing: an eastbound tube with three independent containment shells. */
export function buildStartingTube(w: PixelWorld): void {
  if (w.blightCores.length >= 255) return;
  const gx = w.roomX0 - 6, gy = Math.floor((w.roomY0 + w.roomY1) / 2);
  const x0 = gx - 6, y0 = w.roomY0 - 2, y1 = w.roomY1 + 2;
  let x1 = w.roomX1 + 12;
  // Join the first existing eastbound opening instead of ending in solid fill.
  for (let x = w.roomX1 + 12; x <= Math.min(w.width - 3, w.roomX1 + 64); x++) {
    if (w.health[gy * w.width + x] === 0) { x1 = x; break; }
  }
  if (!w.inBounds(x0 - 1, y0 - 1) || !w.inBounds(x1, y1 + 1)) return;
  const inside = (x: number, y: number): boolean => x >= x0 - 1 && x <= x1 && y >= y0 - 1 && y <= y1 + 1;
  // Remove fixtures overwritten by the tube; core IDs remain stable.
  w.roomLights = w.roomLights.filter(l => l.x1 < x0 - 1 || l.x0 > x1 || l.y1 < y0 - 1 || l.y0 > y1 + 1);
  w.sentrySpots = w.sentrySpots.filter(s => !inside(Math.floor(s.x / w.cellSize), Math.floor(s.y / w.cellSize)));
  w.specimenSpots = w.specimenSpots.filter(s => !inside(s.cx, s.cy));
  for (let y = y0 - 1; y <= y1 + 1; y++) for (let x = x0 - 1; x <= x1; x++) {
    const i = y * w.width + x;
    w.wall[i] = y < y0 || y > y1 || x < x0 ? 1 : 0;
    w.mat[i] = MAT.none; w.coreId[i] = 0; w.blight[i] = 0; w.doorId[i] = 0;
    w.decor[i] = DECOR.none;
    w.setCell(x, y, w.wall[i] ? w.maxHealthAt(x, y) : 0, "set", true);
  }
  w.doors = w.doors.filter(door => {
    if (door.gate || !door.cells.some(i => inside(i % w.width, Math.floor(i / w.width)))) return true;
    // Remove the old doorway completely wherever the tube cuts through it.
    for (const i of door.cells) {
      const x = i % w.width, y = Math.floor(i / w.width);
      if (inside(x, y)) continue;
      w.mat[i] = MAT.none; w.doorId[i] = 0;
      w.setCell(x, y, 0, "set", true);
    }
    return false;
  });
  for (let k = 0; k < w.doors.length; k++) {
    const door = w.doors[k];
    door.id = k + 1;
    for (const i of door.cells) w.doorId[i] = door.id;
  }
  for (const core of w.blightCores) {
    core.cells = core.cells.filter(i => w.coreId[i] === core.id);
    if (!core.cells.length) core.alive = false;
  }
  // Air gaps prevent the existing glass chain from jumping between shells.
  for (const r of [1, 3, 5]) {
    for (let y = gy - r; y <= gy + r; y++) for (let x = gx - r; x <= gx + r; x++) {
      if (x !== gx - r && x !== gx + r && y !== gy - r && y !== gy + r) continue;
      const i = y * w.width + x;
      w.mat[i] = MAT.glass; w.decor[i] = DECOR.glass;
      w.health[i] = w.maxHealthAt(x, y);
    }
  }
  const id = w.blightCores.length + 1, i = gy * w.width + gx;
  w.coreId[i] = id; w.blight[i] = 1; w.decor[i] = DECOR.blightCoreHeart;
  w.health[i] = w.maxHealthAt(gx, gy);
  const cells = [i];
  w.blightCores.push({ id, cx: gx, cy: gy, cells, alive: true, size: 1, zone: 0, roomId: -1 });
  w.startingTube = { x0, y0, x1, y1, coreId: id };
  for (const x of [gx, Math.floor((w.roomX0 + w.roomX1) / 2), x1 - 6]) {
    w.decor[(y0 - 1) * w.width + x] = DECOR.lightPanel;
    w.decor[(y0 - 1) * w.width + x + 1] = DECOR.lightPanel;
    w.roomLights.push({
      kind: LIGHT_KIND.bright, wallFace: "south", phase: 0,
      x0: x, y0: y0 - 1, x1: x + 1, y1: y0 - 1,
      cx0: x0, cy0: y0, cx1: x1, cy1: y1,
    });
  }
}
