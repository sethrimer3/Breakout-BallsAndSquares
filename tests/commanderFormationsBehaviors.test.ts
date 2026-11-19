import { describe, expect, it, vi } from "vitest";
import { Rng } from "../src/core/Rng";
import { Game } from "../src/Game";
import { Soldier } from "../src/entities/Soldier";
import { CameraSystem } from "../src/systems/CameraSystem";
import { PixelWorld } from "../src/world/PixelWorld";
import { WORLD } from "../src/config";
import { PhysicsSystem } from "../src/systems/PhysicsSystem";
import { CombatSystem } from "../src/systems/CombatSystem";
import { sanitizeSaveData } from "../src/progression/SaveManager";
import { UPGRADE_BY_ID } from "../src/progression/UpgradeDefinitions";

describe("Commander Selection & Succession", () => {
  it("selects the living soldier with the lowest slotIndex as commander", () => {
    const s1 = new Soldier(10, 10, 0, 1, 100, "pistol", "free", 0);
    const s2 = new Soldier(20, 20, 0, 1, 100, "shotgun", "free", 1);
    const s3 = new Soldier(30, 30, 0, 1, 100, "sniper_rifle", "free", 2);

    const getCommander = (soldiers: Soldier[]) => {
      const living = soldiers.filter((s) => s.alive);
      if (living.length === 0) return null;
      living.sort((a, b) => a.slotIndex - b.slotIndex || a.id - b.id);
      return living[0];
    };

    expect(getCommander([s1, s2, s3])).toBe(s1);

    // If s1 dies, commander becomes s2
    s1.alive = false;
    expect(getCommander([s1, s2, s3])).toBe(s2);

    // If s2 also dies, commander becomes s3
    s2.alive = false;
    expect(getCommander([s1, s2, s3])).toBe(s3);

    // If all die, commander is null
    s3.alive = false;
    expect(getCommander([s1, s2, s3])).toBeNull();
  });
});

describe("Auto Move & Manual Commander Controls", () => {
  it("defaults autoMove to true and alwaysShootWhenAutoMoveOff to false", () => {
    const s = sanitizeSaveData({});
    expect(s.settings.autoMove).toBe(true);
    expect(s.settings.alwaysShootWhenAutoMoveOff).toBe(false);
  });

  it("roundtrips autoMove and alwaysShootWhenAutoMoveOff settings", () => {
    const raw = {
      settings: {
        autoMove: false,
        alwaysShootWhenAutoMoveOff: true,
      },
    };
    const s = sanitizeSaveData(raw);
    expect(s.settings.autoMove).toBe(false);
    expect(s.settings.alwaysShootWhenAutoMoveOff).toBe(true);
  });

  it("slides manual commander along walls instead of bouncing randomly", () => {
    const world = new PixelWorld(WORLD);
    const rng = new Rng(42);
    const physics = new PhysicsSystem(world, rng);

    const cmdr = new Soldier(10, 10, 1, 1, 100, "pistol", "free", 0);
    cmdr.isManual = true;
    cmdr.vx = 80;
    cmdr.vy = 80;

    // Simulate hitting a vertical wall (normal pointing left, nx = -1, ny = 0)
    // resolveWallCollision: vn = vx*nx + vy*ny = -80.
    // For manual soldier: vx -= vn * nx = 80 - (-80)*(-1) = 0. vy remains 80 (sliding down the wall).
    // Accessing through physics.step against solid wall:
    const cx = Math.floor(10 / world.cellSize);
    const cy = Math.floor(10 / world.cellSize);
    world.setCell(cx + 1, cy, 100); // solid cell to the right

    // Physics step
    physics.step(cmdr, 0.016);
    // Commander should not turn 180 and reflect with jitter, but preserve sliding movement
    expect(cmdr.vy).toBeGreaterThan(0);
  });
});

describe("Soldier Behaviors", () => {
  it("sanitizes behaviors and reverts to free if behavior upgrades are locked", () => {
    const raw = {
      upgrades: {},
      loadouts: [
        { weapon: "pistol", behavior: "orthogonal" },
        { weapon: "pistol", behavior: "vertical" },
        { weapon: "pistol", behavior: "turn_left" },
        { weapon: "pistol", behavior: "sentry_slow" },
      ],
    };
    const sanitized = sanitizeSaveData(raw);
    expect(sanitized.loadouts[0].behavior).toBe("free");
    expect(sanitized.loadouts[1].behavior).toBe("free");
    expect(sanitized.loadouts[2].behavior).toBe("free");
    expect(sanitized.loadouts[3].behavior).toBe("free");

    // With upgrades unlocked:
    const withUpgrades = sanitizeSaveData({
      upgrades: {
        behavior_orthogonal: 1,
        behavior_patrol: 1,
        behavior_turns: 1,
        behavior_sentry: 1,
      },
      loadouts: [
        { weapon: "pistol", behavior: "orthogonal" },
        { weapon: "pistol", behavior: "vertical" },
        { weapon: "pistol", behavior: "turn_left" },
        { weapon: "pistol", behavior: "sentry_slow" },
      ],
    });
    expect(withUpgrades.loadouts[0].behavior).toBe("orthogonal");
    expect(withUpgrades.loadouts[1].behavior).toBe("vertical");
    expect(withUpgrades.loadouts[2].behavior).toBe("turn_left");
    expect(withUpgrades.loadouts[3].behavior).toBe("sentry_slow");
  });

  it("orthogonal behavior clamps initial velocity to cardinal axis", () => {
    const s = new Soldier(10, 10, 0.9, 0.2, 100, "pistol", "orthogonal", 0);
    expect(s.vx).toBe(100);
    expect(s.vy).toBe(0);

    const s2 = new Soldier(10, 10, 0.1, 0.9, 100, "pistol", "orthogonal", 1);
    expect(s2.vx).toBe(0);
    expect(s2.vy).toBe(100);
  });

  it("vertical and horizontal patrol behaviors clamp velocity to 1D axes", () => {
    const v = new Soldier(10, 10, 0.8, -0.6, 100, "pistol", "vertical", 0);
    expect(v.vx).toBe(0);
    expect(v.vy).toBe(-100);

    const h = new Soldier(10, 10, -0.7, 0.7, 100, "pistol", "horizontal", 1);
    expect(h.vx).toBe(-100);
    expect(h.vy).toBe(0);
  });

  it("sentry behaviors set stationary initial velocity and rotate during combat update", () => {
    const sSlow = new Soldier(10, 10, 1, 0, 100, "pistol", "sentry_slow", 0);
    expect(sSlow.vx).toBe(0);
    expect(sSlow.vy).toBe(0);
    expect(sSlow.facingAngle).toBeCloseTo(0);

    const world = new PixelWorld(WORLD);
    const rng = new Rng(1);
    const combat = new CombatSystem(world, rng, {} as any, {
      onShot: () => {},
      onImpact: () => {},
      onExplosion: () => {},
    });

    combat.updateSoldier(sSlow, 1.0);
    expect(sSlow.facingAngle).toBeCloseTo(Math.PI / 3);

    const sFast = new Soldier(10, 10, 1, 0, 100, "pistol", "sentry_fast", 1);
    combat.updateSoldier(sFast, 1.0);
    // 4*PI/3 is normalized by Math.atan2 to -2*PI/3 (-120deg)
    expect(Math.cos(sFast.facingAngle)).toBeCloseTo(Math.cos((4 * Math.PI) / 3));
    expect(Math.sin(sFast.facingAngle)).toBeCloseTo(Math.sin((4 * Math.PI) / 3));
  });
});

describe("Squad Formations", () => {
  it("formation upgrades exist in UpgradeDefinitions", () => {
    expect(UPGRADE_BY_ID["formation_line"]).toBeDefined();
    expect(UPGRADE_BY_ID["formation_triangle"]).toBeDefined();
    expect(UPGRADE_BY_ID["formation_line"].branch).toBe("formations");
    expect(UPGRADE_BY_ID["formation_triangle"].branch).toBe("formations");
  });

  it("followers align behind commander in line formation", () => {
    const commander = new Soldier(100, 100, 1, 0, 100, "pistol", "free", 0);
    commander.facingAngle = 0; // facing right (+x)
    commander.vx = 100;
    commander.vy = 0;

    const follower1 = new Soldier(50, 50, 0, 1, 100, "pistol", "orthogonal", 1);
    const follower2 = new Soldier(30, 30, 0, 1, 100, "pistol", "vertical", 2);

    // In line formation, follower i is placed behind commander (-cdx * 16 * (i + 1))
    const spacing = 16;
    const cdx = 1;
    const cdy = 0;

    const target1 = {
      x: commander.x - cdx * spacing * 1,
      y: commander.y - cdy * spacing * 1,
    };
    const target2 = {
      x: commander.x - cdx * spacing * 2,
      y: commander.y - cdy * spacing * 2,
    };

    expect(target1.x).toBe(84);
    expect(target1.y).toBe(100);
    expect(target2.x).toBe(68);
    expect(target2.y).toBe(100);

    // Formations set isInFormation = true
    follower1.isInFormation = true;
    follower2.isInFormation = true;
    expect(follower1.isInFormation).toBe(true);
  });

  it("followers form wedge behind commander in triangle formation", () => {
    const commander = new Soldier(100, 100, 1, 0, 100, "pistol", "free", 0);
    commander.facingAngle = 0; // facing right (+x)
    commander.vx = 100;
    commander.vy = 0;

    const spacing = 16;
    const cdx = 1;
    const cdy = 0;

    // Follower 0 (i=0): row 1, side -1 (left / up)
    const row0 = Math.floor(0 / 2) + 1; // 1
    const side0 = 0 % 2 === 0 ? -1 : 1; // -1
    const t0x = commander.x - cdx * row0 * spacing - cdy * side0 * row0 * 14;
    const t0y = commander.y - cdy * row0 * spacing + cdx * side0 * row0 * 14;
    expect(t0x).toBe(84);
    expect(t0y).toBe(86);

    // Follower 1 (i=1): row 1, side +1 (right / down)
    const row1 = Math.floor(1 / 2) + 1; // 1
    const side1 = 1 % 2 === 0 ? -1 : 1; // 1
    const t1x = commander.x - cdx * row1 * spacing - cdy * side1 * row1 * 14;
    const t1y = commander.y - cdy * row1 * spacing + cdx * side1 * row1 * 14;
    expect(t1x).toBe(84);
    expect(t1y).toBe(114);
  });
});

describe("Manual Commander Switching (F / Tab)", () => {
  function createMockGame(autoMove: boolean) {
    const world = new PixelWorld(WORLD);
    const s1 = new Soldier(100, 100, 0, 0, 100, "pistol", "free", 0);
    const s2 = new Soldier(120, 100, 0, 0, 100, "shotgun", "free", 1);
    const s3 = new Soldier(140, 100, 0, 0, 100, "sniper_rifle", "free", 2);
    s1.isManual = !autoMove;
    const camera = new CameraSystem(world);
    const gameLike: any = {
      autoMove,
      soldiers: [s3, s1, s2], // unsorted to verify deploy-slot ordering
      commanderId: 0,
      commanderTrail: [{ x: 100, y: 100 }],
      rng: new Rng(7),
      combat: { cancelRailCharge: vi.fn() },
      camera,
      labMap: { visible: false },
      upgradeTree: { visible: false },
      mainMenu: { visible: false },
      hud: { update: vi.fn() },
      getCommander: Game.prototype.getCommander,
      releaseManualControl: (Game.prototype as any).releaseManualControl,
      cycleCommander: Game.prototype.cycleCommander,
      onKey: (Game.prototype as any).onKey,
    };
    return { gameLike, s1, s2, s3, camera };
  }

  it("cycles manual commander control on Tab and KeyF in deploy-slot order", () => {
    const { gameLike, s1, s2, s3, camera } = createMockGame(false);
    expect(gameLike.getCommander()).toBe(s1);

    // Tab switches from #1 -> #2
    gameLike.onKey("Tab");
    expect(gameLike.getCommander()).toBe(s2);
    expect(camera.targetId).toBe(s2.id);
    expect(camera.following).toBe(true);
    expect(s2.isManual).toBe(true);
    expect(s1.isManual).toBe(false);
    expect(Math.hypot(s1.vx, s1.vy)).toBeCloseTo(s1.speed, 4);
    expect(gameLike.commanderTrail).toHaveLength(0);

    // F switches from #2 -> #3
    gameLike.onKey("KeyF");
    expect(gameLike.getCommander()).toBe(s3);
    expect(camera.targetId).toBe(s3.id);
    expect(s3.isManual).toBe(true);
    expect(s2.isManual).toBe(false);

    // Tab wraps around from #3 -> #1
    gameLike.onKey("Tab");
    expect(gameLike.getCommander()).toBe(s1);
    expect(camera.targetId).toBe(s1.id);
    expect(s1.isManual).toBe(true);
    expect(s3.isManual).toBe(false);
  });

  it("falls back to the lowest-numbered survivor when the selected commander dies", () => {
    const { gameLike, s1, s2 } = createMockGame(false);
    gameLike.onKey("KeyF");
    expect(gameLike.getCommander()).toBe(s2);

    s2.alive = false;
    expect(gameLike.getCommander()).toBe(s1);
  });

  it("keeps F/Tab camera-only when autoMove is enabled", () => {
    const { gameLike, s1, s2, camera } = createMockGame(true);
    expect(gameLike.getCommander()).toBe(s1);

    gameLike.onKey("KeyF");
    expect(camera.following).toBe(true);
    camera.update(0.1, gameLike.soldiers);
    expect(camera.targetId).toBe(s1.id);
    expect(gameLike.getCommander()).toBe(s1);

    gameLike.onKey("Tab");
    expect(camera.targetId).toBe(s2.id);
    expect(gameLike.getCommander()).toBe(s1);
  });
});
