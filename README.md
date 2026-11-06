# BREACH

**BREACH** is a 2D incremental physics roguelite built with TypeScript, Vite, and HTML5 Canvas 2D. Launch autonomous, weaponized soldier spheres into an enclosed 512 × 512 destructible pixel world. Soldiers ricochet off walls and automatically fire bullets along their direction of travel, illuminating dark caverns with shadow-casting muzzle flashes while the hostile terrain replicates back to crush them.

---

## Quick Start

```bash
# Install dependencies
npm install

# Start the development server (hot reload)
npm run dev

# Run the automated test suite (Vitest)
npm test

# Type-check and build the production bundle into ./dist
npm run build

# Preview the production build locally
npm run preview
```

---

## Controls

| Input | Action |
|---|---|
| **Left Click** (arena) | Aim from the starting room and launch a reserve soldier toward the cursor |
| **DEPLOY Button** (right HUD) | Launch a reserve soldier in a random direction |
| **Mouse Wheel** | Zoom toward/away from the cursor (`0.5×` – `8×`, crisp pixel scaling) |
| **Right / Middle Drag** | Pan the camera (disables auto-follow until `F` is pressed) |
| **`F`** | Resume automatic camera follow of the soldier farthest from spawn |
| **`Tab`** | Cycle manual camera follow through active soldiers |
| **`Space`** | Pause / resume the simulation |
| **`U`** | Bank current run earnings and open the permanent **Upgrade Tree** |
| **`R`** | Quick-restart the run (automatically banks currency earned so far) |
| **`M`** | Toggle synthesized Web Audio sound effects |
| **`Esc`** | Open/close the pause menu (or close overlays) |
| **`` ` `` (Backtick)** | Toggle the developer / telemetry debug overlay (`1×`/`4×` speed, light quality, log export) |

### Touch (phones & tablets)

| Input | Action |
|---|---|
| **Tap** (arena) | Aim and launch a reserve soldier (hold a finger still to preview the aim line) |
| **One-finger drag** | Pan the camera |
| **Two-finger pinch** | Zoom the camera (also zooms the Upgrade Tree) |
| **Pause button** (left HUD) | Open the pause menu: resume, restart, upgrades, main menu, settings |
| **Follow button** (left HUD) | Resume auto-follow; tap again to cycle through soldiers |
| **Upgrade Tree node** | First tap shows its details, second tap buys it |

The layout scales down to fit small screens; the Upgrade Tree is easiest to read in landscape.

---

## Core Mechanics

- **World & Starting Room:** Each run generates a fresh `512 × 512`-cell world (`4096 × 4096` logical units at `8 × 8` units/cell) with a `10 × 10`-cell empty chamber at the exact center.
- **Distance-Based Pixel Hardness:** Terrain health increases in concentric Chebyshev bands outward from the starting room:
  $$\text{maxHealth} = \min\!\left(12,\; 1 + \left\lfloor \frac{\max(0, \text{distance} - 5)}{12} \right\rfloor\right)$$
- **Autonomous Ricochet Combat:** Soldiers move at constant speed with substepped circle-vs-grid collision resolution (`collisionRadius = 3.2` units so a `6.4`-unit ball cleanly fits through `8`-unit single-cell tunnels, while `renderRadius = 4.5` + glow keeps the sphere visually bold). Soldiers fire exclusively along their normalized velocity vector; bullets use Amanatides–Woo DDA grid raycasting (including initial-cell checks when firing flush against a wall).
- **Dynamic Muzzle-Flash Lighting & Shadows:** Every shot spawns a short-lived (`85 ms`) light that casts a 2D visibility polygon combining 96 base rays, forward-cone rays, silhouette-corner grazing rays (`±ε`), and tangent rays against other soldier spheres. Both terrain walls and fellow soldiers cast hard occlusion shadows across open cavities.
- **Hostile Cellular Growth:** After a `12 s` grace period, solid frontier cells (maintained in an $O(1)$ indexed set) replicate into empty cardinal neighbors at an exponentially escalating rate:
  $$\text{rate}(t) = \min\!\left(150,\; 0.35 \times 1.055^{\max(0,\, t - 12)}\right)$$
  Normal wall contact only bounces soldiers, but **if a newly replicated pixel overlaps a soldier's collision circle, that soldier dies immediately**.

---

## Permanent Upgrade Tree

Every destroyed pixel awards **1 ◆ currency** and increments lifetime pixels destroyed. Progress is saved automatically in `localStorage` under `breach.save.v1` with schema validation and corruption recovery.

| Upgrade | Effect / Level | Max Level | Base Cost | Cost Multiplier | Unlock Condition |
|---|---|---|---|---|---|
| **Ball Speed** | `+10%` movement speed | 10 | 15 | `1.55×` | Immediate |
| **Fire Rate** | `+12%` shots/second | 12 | 20 | `1.58×` | Immediate |
| **Bullet Speed** | `+8%` projectile speed | 8 | 15 | `1.55×` | Immediate |
| **Bullet Damage** | `+1` damage per bullet | 8 | 40 | `1.75×` | Immediate |
| **Multishot** | `+5%` chance to fire twin `±8°` side rounds | 10 | 60 | `1.70×` | Destroy **40** lifetime pixels |
| **Additional Soldier** | `+1` deployable soldier per run (up to 8) | 7 | 100 | `2.00×` | Destroy **100** lifetime pixels |

### Currencies

| Currency | Dropped by | Spent on |
|---|---|---|
| **Gold** (Tier 1) | Blocks in Zone 1 | Most Matrix nodes, weapon unlocks, Tier 1 soldier nodes |
| **Orange Crystals** (Tier 2) | Blocks in Zone 2 | Secondary weapon upgrades, special weapon upgrades (pierce, blast radius, cluster, crit, multishot, pellets, range, slash arc, Blight multipliers), Tier 2 soldier nodes |
| **Green Crystals** (Tier 3) | Blocks in Zone 3 | Tier 3 soldier nodes |
| **Blight Essence** | Blight Cores (3 / 5 / 8 by zone), lingering three times longer than other pickups | Every soldier node, on top of its tier's currency |

### Soldier Trees

Every soldier has their own upgrade tree (**Soldier Trees** in the Matrix, or **Upgrade Tree** on a Loadout card), stored on their loadout slot. Four arms run gold → orange → green, each node opening the next: damage → pierce → twin fire; fire rate → Blight Hunter → Overdrive; speed → Scavenger → Deep Harvest; HP → Bulwark → Aegis. Essence costs `2 / 6 / 15` at the first level of each tier and rise by half of that per level. The definitions live in [`src/progression/SoldierUpgrades.ts`](src/progression/SoldierUpgrades.ts).

All gameplay, physics, growth, lighting, and upgrade constants live in [`src/config.ts`](src/config.ts) and [`src/progression/UpgradeDefinitions.ts`](src/progression/UpgradeDefinitions.ts) for easy tuning.

---

## Balancing Notes

- **Tunnel Clearance vs. Visual Presence:** Splitting `SOLDIER.collisionRadius` (`3.2` units) from `SOLDIER.renderRadius` (`4.5` units) allows a single-damage soldier to bore into 1-cell tunnels immediately on Run 1 without getting wedged on seam corners, while seam-aware contact normals prevent false corner bounces along straight corridors.
- **First-Run Pacing:** With `fireRate = 2.5/s`, `graceSeconds = 12`, and `baseRate = 0.35 * 1.055^elapsed`, an un-upgraded soldier typically survives `45–75 s` and excavates `45–90` pixels—enough to purchase 2–3 early upgrades on the first attempt and unlock **Multishot** within 1–2 runs.
- **Growth Telemetry:** The `GrowthSystem` tracks the rolling percentage of replication events occurring within 12 cells of active soldiers (visible in the backtick debug panel and exported via **Copy Log**). Because uniform frontier selection naturally concentrates around the freshly carved tunnels near spawn during early/mid runs, `GROWTH.localBias` defaults to `0` (pure uniform frontier pick) and can be raised in `src/config.ts` if tighter late-game pressure is desired.

---

## GitHub Pages Deployment

The project is configured with `base: "./"` in [`vite.config.ts`](vite.config.ts) so all built asset paths work from any repository subpath.

1. In your GitHub repository, open **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.
3. Push to the `main` branch (or trigger **Build and deploy to GitHub Pages** manually from the **Actions** tab). The workflow in [`.github/workflows/static.yml`](.github/workflows/static.yml) runs `npm ci`, `npm test`, `npm run build`, and deploys `./dist`.
