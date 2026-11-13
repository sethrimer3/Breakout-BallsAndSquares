# Weapon expansion validation and first-pass balance

The original first-playable weapon mechanics are implemented. Newer Black Market, squad uniqueness, mutation, and secondary-weapon requirements from `main` remain pending in the plan. Automated checks establish mechanics, bounded work, save compatibility, and a reproducible starting point for tuning. They do not establish player enjoyment, long-run currency pacing, or performance on a physical phone.

## Reproduce

- `npm test`: complete regression suite.
- `npm run build`: TypeScript check and production bundle.
- `npm run test:weapons`: focused projectile, goo, momentum, drone, prism, progression, and stress tests.
- `BREACH_BENCHMARK=1 npm test -- tests/weaponStress.test.ts --silent=false --reporter=verbose`: print the balance samples. Explicit console output is needed because Vitest's agent reporter suppresses passed-test logs.
- Start `npm run dev -- --host 0.0.0.0 --port 5173 --strictPort`, then `npm run test:weapon-browser`. The browser script needs Playwright and Chromium; the cloud environment supplies both. It supports `BREACH_BASE_URL`, `BREACH_CHROMIUM`, and `BREACH_ARTIFACTS` overrides. It creates isolated browser contexts and writes screenshots plus `report.json` under `/tmp/breach-weapon-validation` by default.

The browser harness buys/equips each weapon, observes its distinctive behavior, checks restart cleanup and persisted settings, and exercises touch upgrade/loadout interactions. Its controlled weapon-only rendering profile runs 600 fixed steps at desktop and mobile viewport sizes; the mobile profile applies a 4× CPU slowdown and reduced motion. This is an emulation, not a physical-device or full-game frame-rate certification.

## Recorded release checks

- Complete suite: **400 tests in 50 files passed**. Focused weapon suite: **99 tests in 9 files passed**.
- TypeScript and production build passed. The built bundle also opened the menu and entered a rendered run with HUD and no JavaScript errors.
- Browser purchases, all four live weapon rules, restart cleanup, persisted Prism Patterns, and mobile touch tooltips/loadouts passed with no page errors.

The controlled mixed squad contained two soldiers of each new weapon role. After the 600-frame timing sample, another 1,800 frames exercised retained memory. The harness forces collection before/after that extension and rejects retained growth above 1 MiB; this allows small runtime/JIT changes while catching material retained growth. Results vary with host load.

| Profile | Simulation p95 | Weapon rendering p95 | Retained heap delta after extra 1,800 frames |
|---|---:|---:|---:|
| 1440×900 desktop | 0.3 ms | 0.5 ms | -1,612 bytes |
| 390×844, 4× CPU slowdown, reduced motion | 1.3 ms | 1.0 ms | +262,160 bytes |

Both profiles stayed within every actor/segment cap and kept soldier positions finite and collision-clear. These measurements cover weapon simulation and weapon drawing, not the complete terrain/lighting/UI frame. Source audio nodes also have unit-tested voice limits and completion cleanup.

The build reports Vite's advisory for a roughly 512 kB main JavaScript chunk (155 kB gzip). This is not a build failure; physical-device startup and sustained full-frame profiling remain on the playtest checklist.

## Steady soldier-light follow-up

The follow-up raises the always-on soldier pool from 34 to 64 world units and strength from 0.55 to 0.9, with a dedicated broader falloff shared by wall lighting and the fallback sprite. Room/fire profiles retain their existing tuning. A no-firing regression verifies that a living soldier continuously illuminates a wall 40 units away; dead soldiers add no light. The full suite passes 401 tests in 50 files and the production build passes. In a controlled browser comparison with muzzle flashes off, the sampled surrounding region averaged 1.81× the previous luminance, with no page errors.

## Controlled balance sample

Seed 17; 12 simulated seconds; one soldier; 64×64-cell worlds; 12-HP terrain. The open world has perimeter walls. The corridor has a four-cell-high opening. Growth, enemies, loot, and fixture effects are absent. "Max" means all shared upgrade definitions at their caps; individual soldier-tree modifiers remain at baseline. These are geometry-sensitive excavation samples, not direct weapon DPS or equal-currency comparisons.

| Weapon | Open base blocks | Open max blocks | Corridor base blocks | Corridor max blocks |
|---|---:|---:|---:|---:|
| Pistol | 1 | 142 | 0 | 356 |
| Shotgun | 0 | 124 | 0 | 403 |
| Momentum Katana | 7 | 21 | 14 | 467 |
| SQUELCH | 6 | 47 | 9 | 316 |
| Drone Shepherd | 0 | 5 | 0 | 5 |
| Chromatic Prism | 2 | 7 | 0 | 71 |

The samples preserve different spatial strengths: katana and goo improve substantially in dense terrain, while gun upgrades remain useful in open rooms. Prism's deduplicated hits and travel cap prevent a single pulse from repeatedly farming the same wall. Drone shots spread damage across many cells; their low short-window block count is a watch item, not evidence that they do no damage. They should also be evaluated against moving Blight threats before damage is increased.

An eight-carrier, fully upgraded corridor sample reached 24 active drones, fired 312 rounds with 300 useful terrain contacts, and destroyed 124 blocks. No actor pool exceeded its cap. The caps remain explicit: 16 goo orbs, 96 mines, 24 drones, and 256 live laser segments; each laser pulse has at most 8 reflections, 16 distinct terrain hits, 32 segments, and 600 travel units. Mine detonation processing is capped at eight per fixed step.

## Telemetry

Enable Dev mode and use the backtick overlay / Copy Log. Exported JSON includes bullet bounce histograms, goo contact/deposit/burst counts and bounce histograms, pool drops, drone launches/shots/useful hits, prism hits/reflections/visual drops, katana dash count/boosted time/boosted terrain damage, and existing frame/simulation/lighting timing. Histogram final buckets collect larger counts; they do not impose a gameplay bounce limit on goo. Weapon counters reset when run/sector weapon systems rebuild.

## Release playtest checklist

Automated acceptance is complete; these require observation by players or additional hardware and remain explicitly unverified:

- Compare equal-currency builds over several real runs, including individual soldier upgrades, rooms with creatures, doors, Blight growth, and save progression.
- Check whether a new player can describe each weapon's rule after one or two observations; the loadout summaries and unlock tooltips state the rules.
- Listen on speakers/headphones at several volume levels, including clustered mine bursts; verify the wet cues feel tactile without masking alerts.
- Check actual low-end mobile devices, background/resume behavior, sustained memory, battery/thermal load, camera follow, and touch aiming.
- Watch Drone Shepherd's scattered excavation, late-game mine density, and katana high-speed readability before changing damage or costs.

AR Mirror Rounds remains optional. Newer main-branch design revisions promote respec, several former future concepts, and additional mutations into requested scope; these are not covered by this original implementation report.

## Revised Black Market audit and missing mechanic repairs

The accepted roster and exact new requirements are recorded in [BLACK_MARKET_IMPLEMENTATION_PLAN.md](BLACK_MARKET_IMPLEMENTATION_PLAN.md). The new Orbit/Vacuum/Burrower/Freeze/Rail/Napalm/Cryospray mechanics remain planned. Drone Shepherd's move to Pistol branch 3 and the full canonical Black Market migration remain planned as well.

The audit confirmed working Chromatic Prism, Momentum Katana and SQUELCH systems. It found Gale Edge and Reverse-Playback Revolver absent and added their combat mechanics, Essence unlocks, compatible per-slot persistence and next-deployment selectors. Gale disables Momentum dash/scaling, sweeps side terrain, has an explicit 300–660-unit range independent of speed, and stops at unopened world gates. Playback records bounded outgoing polylines, preserves bankshots, pauses for 0.18 seconds, then damages terrain and distinct targets once on the return pass. Its return does not steer when terrain changes.

Validation:

- Full Vitest regression suite: **410 tests in 51 files pass**, including nine focused mutation cases: exact reverse corners, pause, record bounds/reset, real wall reflection and second damage, target identity deduplication, Gale range/Momentum exclusion, width sweep deduplication, compatible unlock resolution, save sanitation and authoritative gates.
- Production TypeScript/Vite build passes; the existing bundle-size advisory remains.
- Chromium smoke purchases both Essence unlocks through actual tree nodes, selects both loadout modes, observes live Gale crescents and paused/returning Playback actors, and switches back to ordinary modes. Existing SQUELCH/Drone/Prism/Momentum smoke checks still pass. No page errors.
- Existing 600-frame desktop and 4× CPU-throttled mobile profiles plus 1,800 additional memory-stress frames pass. Simulation p95: 0.2 / 1.1 ms; rendering p95: 0.5 / 0.9 ms; retained heap growth: 394,124 / 230,840 bytes. These stress profiles cover the original mixed weapon workload; the two new modes have separate live smoke and focused correctness coverage, not a claim of completed mobile balance testing.

Screenshots/report are generated under `/tmp/breach-weapon-validation`.

## Full Black Market expansion implementation & validation

All accepted Black Market branches from [BLACK_MARKET_IMPLEMENTATION_PLAN.md](BLACK_MARKET_IMPLEMENTATION_PLAN.md) are implemented, with Assault Rifle mutation slots left undecided:

- **Canonical Black Market model:** `WeaponType` uses the 7 canonical base weapons; `SaveManager` migrates legacy `goo_mortar`, `drone_shepherd`, and `prism_laser` loadouts without losing purchases or currency, enforces unique non-Pistol primary ownership across the squad, and allows independent per-slot Pistol mutations. `UpgradeManager.refundBlackMarket` provides lab-only atomic refunds from recorded `upgradeSpent` totals, and `UpgradeTree` surfaces inactive conventional upgrades explicitly.
- **Initial tuning choices (documented in `src/config.ts`):**
  - `ORBIT`: max 8 rounds/owner, orbit radius 12, angular speed 4.4 rad/s, release cooldown 0.08 s.
  - `VACUUM`: intake radius 88, 0.5× ordinary shotgun fire rate, normal cell mass 1.0 / subcell 0.25, max 12 pellets with overflow converted to +0.75 damage/pellet, bounded 512-entry debris ledger.
  - `BURROWER`: drills terrain up to 48 world units (50% speed), places up to 3 mines along the drilled path (`BURROWER.mineCount`), detonates the entire group + terminal payload together on the same step, and stops at closed gates/world borders.
  - `FREEZE` / `CRYO`: 3.0 s freeze duration (`FREEZE.duration`), 50% creature speed, 2× incoming creature damage, 0.5× local frozen Blight growth, 0 direct terrain damage; external destruction of a frozen cell deals 50% of its frozen `maxHealthAt` HP to its 4 orthogonal neighbors on `FACILITY.glassChainDelay` (`0.05 s`) cadence (max 64/step).
  - `RAIL`: 1200-unit range, +10 bonus pierce, final 25% of charge locks aim direction, single straight piercing trace stopping at closed gates and world borders.
  - `NAPALM`: 10 s unlit expiry, external damaging ignition only (no self-ignition or cold ignition), 3.0 s burn dealing full weapon damage across 15 ticks (`0.2 s..3.0 s`), immediate cleanup of target-bound patches when the host block breaks or creature dies.

### Observed validation results

- **TypeScript + Vite production build (`npm run build`):** passed.
- **Playwright Chromium smoke (`npm run test:weapon-browser`):** passed with 0 page errors; purchased, equipped, deployed, and visibly exercised all 12 accepted Black Market mutations (`reverse_revolver`, `orbit_cylinder`, `drone_shepherd`, `squelch`, `vacuum_pulse`, `burrower`, `freeze_rockets`, `chromatic_prism`, `rail_lance`, `gale_edge`, `napalm_garden`, `cryospray`), verified restart cleanup, Settings persistence, desktop (1440×900: `simP95Ms: 0.2`, `renderP95Ms: 0.3`, `heapDeltaBytes: 261168`) and 4×-CPU-throttled mobile (390×844: `simP95Ms: 1.9`, `renderP95Ms: 2.3`, `heapDeltaBytes: 99852`) stress profiles.
- **Unverified playtesting:** Live multi-run Essence economy pacing, player readability of the 12 mutations in long sessions, and physical mobile device thermal/touch ergonomics remain on the manual playtest checklist.

## Post-review Black Market regression fixes & validation

Six reproduced bugs were fixed and covered by unit/integration tests in `tests/blackMarketRegressions.test.ts` and browser smoke checks in `scripts/weapon-smoke.cjs`:

1. **Pooled projectile reset (`src/entities/Bullet.ts`, `src/systems/CombatSystem.ts`):** Added shared `resetBulletFields()` and called it across all bullet acquisition paths (`spawnBullet`, `spawnSlash`, `onSoldierBounce`, `releaseOrbitManual`) so Napalm/Cryo/Freeze/Burrower/Gale/Reverse state never leaks into reused Katana slashes or other projectiles.
2. **Black Market Essence recovery (`src/progression/SaveManager.ts`):** `load()` recovery now subtracts `upgradeSpent` Essence totals (and reconstructs legacy pre-ledger Essence purchase costs via `upgradePrices`) so reloading does not restore spent Essence while preserving legitimate recovery and one-time lab refunds.
3. **Late-world enemies in Cold & Napalm (`src/systems/FreezeSystem.ts`, `src/systems/LateEncounters.ts`, `src/systems/NapalmSystem.ts`, `src/systems/CombatSystem.ts`, `src/Game.ts`):** Integrated `LateEncounters` actors (`soldier`, `brute`, `boss`, `turret`, `trap`) into shared freeze status (50% speed, 2× incoming damage, timed thaw, overlap refresh) and Napalm ground/target-bound burn ticks with death/reset cleanup, preferring raycast `targetKey` identity over proximity fallback.
4. **Rail Lance terrain traversal (`src/systems/RailLanceSystem.ts`):** Advanced ray traversal to the exit face of each impacted cell/subcell instead of a fixed `0.25` step, preventing the loop guard from terminating prematurely inside surviving terrain while respecting closed gates and world bounds.
5. **Manual Rail Lance charging (`src/systems/CombatSystem.ts`, `src/Game.ts`):** Extracted shared `advanceRailCharge()` / `cancelRailCharge()` and routed `shootCommanderManual()` through the charge cycle so manual click-spam cannot bypass charging.
6. **External Napalm ignition paths (`src/systems/CombatSystem.ts`):** Added `napalm.igniteAt(...)` to SQUELCH mine bursts (`onMineBurst`), Reverse-Playback Revolver return strikes (`replaySegment`), and Katana/Gale cleave (`cleaveSlashSides`).

### Observed validation results (post-fix)

- **Vitest suite (`npm test`):** 54 files, 436 tests passed.
- **TypeScript + Vite production build (`npm run build`):** passed (`tsc --noEmit` + `vite build`).
- **Playwright Chromium smoke (`npm run test:weapon-browser`):** passed with 0 page errors, including pooled `napalm_garden` -> `katana` reuse, manual Rail charge enforcement, Napalm external ignition, desktop (`simP95Ms: 0.2`, `renderP95Ms: 0.3`, `heapDeltaBytes: -76548`) and 4×-CPU-throttled mobile (`simP95Ms: 1.7`, `renderP95Ms: 1.9`, `heapDeltaBytes: 102268`) 600+1800 frame profiles.

## Overcharge Conductor (Assault Rifle branch 1) implementation & validation

Implemented canonical `assault_rifle` mutation `overcharge_conductor` via `src/systems/OverchargeSystem.ts`, `OVERCHARGE` tuning constants in `src/config.ts`, Essence research nodes (`overcharge_unlock`, `overcharge_accuracy`) in `src/progression/WeaponExpansionUpgrades.ts`, and steady-glow/arc/blast visuals in `src/rendering/WeaponExpansionRenderer.ts`:

- **Charging & Quiet Timer:** Charging rounds deal 0 direct terrain/enemy contact damage (no Napalm ignition or `onImpact` on contact) and stack per target (`OVERCHARGE.armThreshold = 3`, `OVERCHARGE.quietDelay = 0.45 s` simulation time). Sub-threshold (1–2 hit) charges dissipate harmlessly on expiry; every new charging hit refreshes `quietLeft`, postponing discharge while hits continue.
- **Accuracy Tradeoff:** Selecting `overcharge_conductor` enforces `OVERCHARGE.initialSpreadDeg = 10.5°` (±10.5° half-angle), unaffected by ordinary `ar_stabilizer` spread reduction (while preserving `ar_stabilizer` muzzle velocity). Six levels of Essence-funded `overcharge_accuracy` (*Conductor Stabilization*) reduce spread down to exact `±0.1°` (`0.2°` total cone).
- **Scaled Discharge & Obstruction Policy:** Armed targets (3–15 stacks) discharge a small electrical blast (`14..24` units, `2.0× + 0.8×/extra` AR power) and chain lightning (`2..5` hops, `48..96` units/hop, `1.5× + 0.6×/extra` AR power, `0.24..0.55 s` arc visual), attributing `ownerId`, respecting freeze `2×` damage, and igniting Napalm externally. Closed gates, world bounds, and intermediate walls block chain arcs; each chain target is hit at most once per discharge with no recursive charge stacking.
- **Lifecycle & Pools:** Target death, terrain destruction/regrowth at the same coordinates, and run/world reset immediately clear charge. Already-deposited charge remains on surviving targets if the firing soldier dies, retaining `ownerId` for damage/loot attribution (dead owners do not gain secondary energy). Bounded pools (`96` targets, `64` arcs, `32` blasts) evict oldest sub-threshold entries first and reset `Bullet.overcharge` across all acquisition paths.
- **Validation:** Covered by `tests/overchargeConductor.test.ts` (12 tests, including regressions for piercing deduplication/exit traversal, closed-gate & thin-subcell chain obstruction, single-application `Game.onExplosion` damage, and soldier `mods.damageBonus` snapshots) and `scripts/weapon-smoke.cjs` (purchase, ±10.5°→±0.1° progression, equip/deploy, piercing, single integrated blast, and live charge→quiet→discharge verification).

## Circuit Runner (Assault Rifle branch 2) implementation & validation

Implemented canonical `assault_rifle` mutation `circuit_runner` via `src/systems/CircuitRunnerSystem.ts`, `CIRCUIT` tuning constants in `src/config.ts`, Essence research node (`circuit_unlock`) in `src/progression/WeaponExpansionUpgrades.ts`, `CombatSystem` swept laser routing, and crisp right-angled "Tron-like" trail rendering in `src/rendering/WeaponExpansionRenderer.ts`:

- **Damaging High-Pierce Laser & Orthogonal Routing:** Replaces ordinary AR ammunition with damaging (`arDamage`), high-penetration (`CIRCUIT.pierce + arPierce`) laser shots using ordinary `arSpreadDeg` accuracy (without Overcharge's zero-damage charging or `±10.5°` spread penalty). On each terrain impact, the incoming direction is captured before damage changes the world, the projectile centers on the impacted normal cell or 50% subcell, and `chooseOutgoingCardinal()` selects a uniform random non-reversing cardinal direction (straight ahead, left, or right).
- **Single-Event Surviving Blocks, Gates & Cumulative Range:** Distinct cell/subcell and enemy target sets (`circuitHitKeys`, `circuitHitTargets`) ensure each surviving block or enemy is struck at most once per shot, stepping cleanly out of surviving cells across frames without repeated routing or damage. Closed gates (`MAT.door && !door.open`) and world boundaries stop the shot; enemy hits pierce without changing direction. Range (`CIRCUIT.baseRange = 176`) tracks cumulative path length across all turns and centering moves without resetting on impact.
- **Tron-Like Trail & Cooling Curve:** Records actual traveled right-angled vertices in a bounded segment pool (`CIRCUIT.maxSegments = 256`), cooling along normalized range consumed (`bright orange → light blue → blue → purple`) before fading out, with `resetBulletFields()` and `CombatSystem.clearAll()` clearing all state on reuse or reset.
- **Observed validation results:**
  - **Vitest suite (`npm test`):** 56 files, 458 tests passed (including 10 tests in `tests/circuitRunner.test.ts`).
  - **TypeScript + Vite production build (`npm run build`):** passed (`tsc --noEmit` + `vite build`).
  - **Playwright Chromium smoke (`npm run test:weapon-browser`):** passed with 0 page errors across all 14 Black Market mutations, desktop (`simP95Ms: 0.2`, `renderP95Ms: 0.5`, `heapDeltaBytes: 231180`) and 4×-CPU-throttled mobile (`simP95Ms: 2`, `renderP95Ms: 2.3`, `heapDeltaBytes: 68060`) 600+1800 frame profiles.
