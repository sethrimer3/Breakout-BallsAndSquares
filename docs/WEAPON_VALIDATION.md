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

The follow-up raises the always-on soldier pool from 34 to 64 world units and strength from 0.55 to 0.9, with a dedicated broader falloff shared by wall lighting and the fallback sprite. Room/fire profiles retain their existing tuning. A no-firing regression verifies that a living soldier continuously illuminates a wall 40 units away; dead soldiers add no light. The full suite passes 401 tests in 50 files and the production build passes. In a controlled browser comparison with muzzle flashes off, the sampled surrounding region averaged 1.81× the previous luminance, with no page errors. This improves the steady visibility baseline; it is not a medical safety guarantee or a substitute for player comfort checks.

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
