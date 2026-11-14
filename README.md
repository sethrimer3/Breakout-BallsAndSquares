# BREACH

**BREACH** is a 2D incremental physics roguelite built with TypeScript, Vite, and HTML5 Canvas 2D. Launch autonomous, weaponized soldier spheres into an enclosed 512 × 512 destructible pixel world. Soldiers ricochet off walls and automatically fire bullets along their direction of travel, illuminating dark caverns with shadow-casting muzzle flashes while the hostile terrain replicates back to crush them.

---

## Quick Start

Use Node.js 24 LTS (`nvm use` with the checked-in `.nvmrc`), matching the GitHub Pages deployment workflow. Vitest 5 supports Node 22.12+ and 24+; Node 20 is outside its supported runtime range.

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

Every living soldier has a steady, shadow-casting visibility light, independent of firing, upgrades, or muzzle-flash brightness. Its eight-cell radius and broader bright falloff keep nearby terrain readable between shots, reducing the contrast of gunfire against darkness. Muzzle-flash brightness can still be lowered or disabled in Visual Settings.

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

Destroyed blocks roll currency pickups that must be collected, and increment lifetime pixels destroyed. Progress is saved automatically in `localStorage` under `breach.save.v1` with schema validation and corruption recovery.

Core is a three-row snake: left to right, down, right to left, then down and left to right again. Buy a milestone to open the next one. Question-mark slots are reserved for future upgrades and do not block progression.

The path starts with **Tier 1 Keycard (8 gold)**, then **Lab Map (15 gold)** and **Airspace Mapping (30 gold)**. Until the map is purchased, deploying starts a run directly at **A1**. Later milestones unlock **Resources → Primary Weapons → Blight → Formations → Secondary Weapons → Research Base**, with squad capacity, the other keycards and future slots between them. All three keycards live on Core. Formations and soldier behaviors share their own Formations tab.

Movement speed, fire rate, damage, health and projectile velocity are upgraded on each soldier's own tree. The basic nodes cost gold without an essence requirement, so they are available from the start; advanced tiers still require essence. Retired global Core stat upgrades are removed and their original gold costs refunded once when loading an existing save.

In-world audio is spatial: each sound plays at its configured volume in the screen center, fades linearly to 25% at every edge and corner, then continues to zero one-sixth of a viewport beyond the edge. Left/right stereo panning follows screen position. Fire crackle keeps its quiet base volume and separate fire-size damping. Menu confirmations and global alerts remain centered.

**Airspace Mapping** gradually reveals open air connected to living soldiers, including passages around corners beyond their usual sight range. Opening doors or breaking walls, glass, or half-size barriers gives the reveal front new paths. Sealed spaces stay hidden; regrowth can disconnect them again. The upgrade is the third milestone on Core, immediately after the Lab Map.

Most rooms with open floor have working ceiling fixtures. Bullets and explosions can break them: the panel goes dark with a small spark burst and a spatial glass-break sound. Fixtures do not obstruct soldiers or airflow, award no terrain loot, and return when a new world is generated.

### Dev settings and a fresh start

Both main-menu and pause-menu Settings have a **Dev** tab. Dev mode enables telemetry/backtick controls and test currency. **Delete & Restart** asks for confirmation, deletes all three BREACH save slots and settings, then reloads the game with fresh A1 progress. It leaves unrelated browser storage alone. Canceling keeps every save.

### Currencies

| Currency | Dropped by | Spent on |
|---|---|---|
| **Gold** (Tier 1) | Blocks in Zone 1 | Most Matrix nodes, weapon unlocks, Tier 1 soldier nodes |
| **Orange Crystals** (Tier 2) | Blocks in Zone 2 | Secondary weapon upgrades, special weapon upgrades (pierce, blast radius, cluster, crit, multishot, pellets, range, slash arc, Blight multipliers), Tier 2 soldier nodes |
| **Green Crystals** (Tier 3) | Blocks in Zone 3 | Tier 3 soldier nodes |
| **Blight Essence** | Blight Cores (3 / 5 / 8 by zone), lingering three times longer than other pickups | Every soldier node, on top of its tier's currency |

### Soldier Trees

Every soldier has their own upgrade tree (**Soldier Trees** in the Matrix, or **Upgrade Tree** on a Loadout card), stored on their loadout slot. Starter nodes use gold only; advanced tiers also cost essence. Four arms run gold → orange → green, each node opening the next: damage → pierce → twin fire; fire rate → Blight Hunter → Overdrive; speed → Scavenger → Deep Harvest; HP → Bulwark → Aegis. Essence costs `2 / 6 / 15` at the first level of each tier and rise by half of that per level. Ballistics adds individual projectile velocity. The definitions live in [`src/progression/SoldierUpgrades.ts`](src/progression/SoldierUpgrades.ts).

All gameplay, physics, growth, lighting, and upgrade constants live in [`src/config.ts`](src/config.ts) and [`src/progression/UpgradeDefinitions.ts`](src/progression/UpgradeDefinitions.ts) for easy tuning.

---

## Balancing Notes

- **Resource pacing:** Starting drops are `0.4` per block with a `48`-unit pickup attraction radius. Gold Drop Chance adds **5 percentage points** per level (8 levels; starts at 8 gold, costs scale by `1.65×`). Multi-Drop multiplies that yield by `1 + 0.08 × level` (12 levels; starts at 35 gold, costs scale by `1.7×`). At both caps this gives `1.568` drops per block, or **3.92×** starting income for equal excavation, versus the previous **20×** spread. Individual resource purchases increase expected yield by at most 12.5%; later levels take progressively more blocks to repay. Combat, squad size, and collection efficiency still affect actual run income.
- **Deeper-zone resources:** T2 Harvester/Refinery add `8%`/`10%` yield per level; T3 Siphon/Extractor add `10%`/`12%`. Bonuses within each zone add before multiplying the shared drop yield. Existing saves retain purchased levels and balances; the revised effects apply on stat refresh or the next run.
- **Tunnel Clearance vs. Visual Presence:** Splitting `SOLDIER.collisionRadius` (`3.2` units) from `SOLDIER.renderRadius` (`4.5` units) allows a single-damage soldier to bore into 1-cell tunnels immediately on Run 1 without getting wedged on seam corners, while seam-aware contact normals prevent false corner bounces along straight corridors.
- **First-Run Pacing:** With `fireRate = 2.5/s`, `graceSeconds = 12`, and `baseRate = 0.35 * 1.055^elapsed`, an un-upgraded soldier typically survives `45–75 s` and excavates `45–90` pixels—enough to purchase 2–3 early upgrades on the first attempt and unlock **Multishot** within 1–2 runs.
- **Growth Telemetry:** The `GrowthSystem` tracks the rolling percentage of replication events occurring within 12 cells of active soldiers (visible in the backtick debug panel and exported via **Copy Log**). Because uniform frontier selection naturally concentrates around the freshly carved tunnels near spawn during early/mid runs, `GROWTH.localBias` defaults to `0` (pure uniform frontier pick) and can be raised in `src/config.ts` if tighter late-game pressure is desired.

---

## GitHub Pages Deployment

The project is configured with `base: "./"` in [`vite.config.ts`](vite.config.ts) so all built asset paths work from any repository subpath.

1. In your GitHub repository, open **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.
3. Push to the `main` branch (or trigger **Build and deploy to GitHub Pages** manually from the **Actions** tab). The workflow in [`.github/workflows/static.yml`](.github/workflows/static.yml) runs `npm ci`, `npm test`, `npm run build`, and deploys `./dist`.

## Black Market weapon expansion

The Primary Arsenal now uses canonical base weapon identities (`pistol`, `shotgun`, `assault_rifle`, `rocket_launcher`, `sniper_rifle`, `katana`, `flamethrower`) with per-soldier Black Market mutations unlocked via Essence and Gold/Crystals in their base weapon tabs:

- **Pistol:** **Reverse-Playback Revolver** (pauses then rewinds its exact bankshot path), **Orbit Cylinder** (rounds orbit the soldier and sling outward on real wall reflections), and **Drone Shepherd** (independent miniature pistol drones; supports multiple carriers within per-owner and global caps).
- **Shotgun:** **SQUELCH** (elastic slime orb that sticks, lays timed mines, and rebounds) and **Vacuum Pulse** (half fire rate; pulls in authoritative debris from all destroyed blocks in range to scale pellets and damage).
- **Assault Rifle:** **Overcharge Conductor** (working name) has a combat implementation under review: zero-damage hits charge individual targets; three or more hits arm a quiet-delay chain-lightning/blast discharge. Wide initial spread can be upgraded to ±0.1°. The second branch, **Circuit Runner** (working name), is planned: very high-penetration, limited-range laser shots turn randomly along centered cardinal paths at block impacts, leaving an orange → light-blue → blue → purple Tron-like trail. See [the accepted design](docs/BLACK_MARKET_IMPLEMENTATION_PLAN.md#overcharge-conductor--assault-rifle-branch-1-working-name).
- **Rocket Launcher:** **Burrower** (drills through terrain, placing mines along the path and detonating all charges together) and **Freeze Rockets** (cold-only burst; 0 direct block damage).
- **Sniper Rifle:** **Chromatic Prism** (pulsed beam gaining color, damage, and penetration on reflection) and **Rail Lance** (charge cycle with aim-lock into one ultra-long straight piercing strike).
- **Katana:** **Momentum Katana** (rebound dash with velocity-scaled slash damage/width) and **Gale Edge** (long-range flying crescents; mutually exclusive with Momentum dash/scaling).
- **Flamethrower:** **Napalm Garden** (sprays 10 s unlit fuel patches that must be ignited by another weapon for a 3 s / 15-tick burn) and **Cryospray** (freezing mist sharing the Freeze & Orthogonal Shatter system).

Non-Pistol primary weapons remain unique across the squad (including alternate mutations of the same base weapon), while Pistol mutations are selectable independently per slot. Legacy standalone saves (`goo_mortar`, `drone_shepherd`, `prism_laser`) migrate automatically to their canonical Shotgun/Pistol/Sniper mutations, and a lab-only **Refund Black Market** action atomically refunds recorded Black Market spending.

See [the revised Black Market plan](docs/BLACK_MARKET_IMPLEMENTATION_PLAN.md) and [validation / playtest notes](docs/WEAPON_VALIDATION.md). Run `npm run test:weapons` for focused coverage and `npm run test:weapon-browser` against a running Vite server for browser validation.

The Research Lab's starting sector and the next two sectors in either map direction use tier 1 terrain, including room and corridor walls. Sectors three through five use tier 2, and the outer sectors use tier 3. These bands stay anchored to the original starting sector when deploying elsewhere. Keycard doors, glass, Blight and the invincible perimeter retain their special behavior.

Hallway side lights are recessed into solid walls, with narrow tubes flush to the corridor-facing surface. Their light originates just outside that surface so it illuminates the hallway rather than being blocked by its own wall. Breaking the supporting wall extinguishes the fixture.

## Map boundaries

Every map has a permanent, non-destructible perimeter. Indoor maps and the menu lab use three-cell dark brushed-metal walls; forest and city maps use uneven, three-cell black-stone cliffs. The mothership has a two-cell metal hull with chamfered corners. Layers fade from full visibility on the inner face to pure black on the outer face, with an opaque black exterior beyond. The perimeter is hidden by unexplored fog just like other terrain. Boundaries block deployment, growth, freezing and piercing/drilling weapons without awarding resources. Ordinary rounds can still ricochet, and world-travel doors and exit pockets remain usable. Boundaries are regenerated for existing profiles too.

Destroyed non-Blight half-size pixels deal their maximum HP as damage to all eight neighboring half-size pixels. Debris destroyed by that damage continues the cascade; Blight can receive the damage but does not propagate it. Full-size blocks are unaffected by debris splash.

## Later worlds

The empty-room framework now covers the 13×13 forest (zones 7–9), 7×7 fallen city (zone 10) and 5×3 Blight mother ship (zone 11). See [the world roadmap](docs/WORLD_ROADMAP.md) for exact exits, the central city facility/teleporter, atmosphere profiles, and the scenery/encounters reserved for later work.

## Profile seeds and speedrun timing

Open **Main Menu → Settings → Gameplay**. **New Save Seed** accepts 1–8 letters or numbers (case-insensitive); press **Apply** to use it for any newly initialized save. Blank restores random eight-character seeds. Existing profiles keep their code, shown on their save card. Each profile/world seed reproduces terrain dressing, rubble and crystal placement; authored routes and gates remain fixed. Conquered-sector progress still applies, and combat randomness is separate. Older profiles receive a seed once on loading.

**Speedrun Timer — Slot N** enables a cumulative `HH:MM:SS.mmm` HUD clock for the selected save. It adds real elapsed time across active runs, independently of simulation speed. Pause, upgrades, map selection, main menu, results, hidden tabs and offline time do not count. Disabling it hides the clock and retains the total; a fresh save starts at zero. Time is saved at transitions and every five seconds during play.

Run `npm run test:profile-browser` against the Vite dev server for settings, reproducible generation, profile isolation, reload, paused/hidden timing and narrow-screen checks.

## Main-menu gameplay backdrop

The menu runs a separate miniature lab with six randomly arranged, connected rooms, two ordinary pistol soldiers in a safe room, and two exposed Blight generators. It uses the game's physics, combat, growth, terrain textures and soldier sprites. All terrain is tier 1. A new skirmish starts automatically after the last generator or soldier is lost, or after 90 seconds.

The backdrop adapts to landscape/portrait screens, uses steady soldier lighting, pauses while hidden, and stops when leaving the menu. Its combat and gold pickups never affect save slots, profile seeds, player resources, or speedrun timing. Run `npm run test:menu-browser` against the Vite server to verify gameplay, long-session save isolation, regeneration, stop/resume, and phone layout. The release check passed 466 unit tests, the production build, and Chromium menu validation with no page errors; screenshots are generated under `/tmp/breach-menu-validation`.

## Choosing a profile

The main menu focuses on three profiles. Choose **Continue** or **Create Profile** to enter directly; number keys **1–3** provide quick selection. Each saved card shows its progress once, with no duplicate wallet bar or separate deploy/upgrade menu. A quiet Settings control in the header includes a profile selector for seed and speedrun settings. Deleting a profile requires explicit confirmation, and empty slots remain empty until created or configured. Keyboard Tab/Enter/Space use normal button navigation; gameplay shortcuts do not open the upgrade tree from the profile menu.

Perimeter artwork is cached in visible 32-cell chunks and rebuilt after map generation. Off-screen fixtures skip wall-light accumulation. With Vite running, `node scripts/render-benchmark.cjs` measures warm perimeter CPU draw-submission times at interior, edge and overview camera positions; these are not total frame or GPU timings. `npx vitest run tests/boundaryRendering.test.ts` checks cache reuse and regeneration, and `npm run test:boundary-fog-browser` checks fog ordering.

Stationary floor artwork and the terrain lighting mask are cached at device resolution, with invalidation for camera/zoom, viewport/device scale, artwork changes and regeneration. Blight-edge fire painting is clipped to occupied chunks while preserving its world coordinates and animation cadence. Run `node scripts/render-cache-smoke.cjs` against Vite for floor pixel comparisons and lighting-mask invalidation checks; `node scripts/render-scene-benchmark.cjs` profiles a fixed-camera overview scene (CPU submission time, not GPU/FPS).

Fixture shadow invalidation uses spatial buckets so debris destruction and Blight growth inspect only nearby lights. Wall-light overlays track lit chunks each frame and skip transparent chunks in both lighting passes. `node scripts/wall-overlay-smoke.cjs` compares sparse overlays pixel-for-pixel while panning/zooming and reports fixture-invalidation timings; `npx vitest run tests/fixtureIndex.test.ts` verifies nearby shadow invalidation and regeneration behavior.

Fixed ceiling/hallway fixtures reuse their wall-light falloff indices between frames; animated intensity and RGB blending still update every frame. Moving soldier and muzzle lights keep direct falloff calculations, and shadow retraces receive fresh cache entries. Destroyed fixtures no longer spend shadow-trace budget. `node scripts/fixture-falloff-smoke.cjs` checks output equivalence and reports the fixed-fixture accumulation benchmark.

HP-only hits rebuild terrain artwork for cracks but reuse surface outlines and Blight-edge masks. Geometry/classification changes (destruction, growth, dormancy, explicit invalidation and regeneration) rebuild those caches. Combined Blight masks also remain cached as the fire animation advances. `node scripts/terrain-rebuild-smoke.cjs` compares cached output against full rebuilds and reports chunk-update timings.
