# Late worlds build-out plan (Worlds 3–5)

This is a self-contained work plan for an AI coding agent (Gemini) to turn the
placeholder later worlds of BREACH into finished, hand-authored content. Read
the whole document before starting. Each phase below is one pull request.

## 1. Where things stand (November 2026)

The campaign has five worlds. Worlds contain numbered zones (tiers):

| World | Name | Grid (cols × rows) | Zones / tiers | Status |
|---|---|---|---|---|
| 1 | RESEARCH LAB | 9 × 9 | 1–3 | **Done.** Hand-drawn blueprint `LAB_BLUEPRINT`. Do not change. |
| 2 | BLIGHTED WARDS | 11 × 11 | 4–6 | **Done.** Hand-drawn freeform blueprint `ZONE2_BLUEPRINT`. Do not change. |
| 3 | CANOPY FOREST | 13 × 13 | 7–9 | **Placeholder.** Uniform lattice, formula-carved clearings. |
| 4 | FALLEN CITY | 7 × 7 | 10 | **Placeholder.** Uniform lattice, formula-carved streets. |
| 5 | BLIGHT MOTHERSHIP | 3 × 7 | 11 | **Placeholder.** Uniform lattice, formula-carved decks, boss exists. |

"Placeholder" means the gameplay plumbing works end to end (travel, gates,
keycards, tiers, pacing numbers, persistent encounters, the boss fight), but:

1. **The map is not authored.** `LAB_WORLDS[3..5].blueprint` is
   `frameworkBlueprint(cols, rows)`: one identical 3×3-char room per sector
   joined by a straight cross of hallways. The blueprint is effectively ignored
   for geometry. `designLateSpaces` (src/world/LateWorldLayouts.ts) carves every
   sector from one of three math formulas picked by `sector % 3`, plus a
   ±25-cell cross corridor through every sector centre. Every sector of a world
   looks like every third other sector.
2. **Encounters are not authored.** `LateEncounters.reset`
   (src/systems/LateEncounters.ts) puts the same fixed list at fixed offsets
   from each sector centre (`["soldier","soldier","brute"]` for tiers 8–9,
   `["turret","turret","trap","soldier","brute"]` for tiers 10–11, groves on a
   ring in the forest).
3. **There is no environment art.** Terrain is a flat colour per tier
   (`FRAMEWORK_BASE` in src/rendering/materials.ts). Enemies, groves, mines and
   the boss are drawn as simple shapes in `LateEncounters.draw`. No trees,
   canopy, sun shafts, buildings, wrecks, hull plating or teleporter art exist.
   `worldAtmosphere.ts` already stores the intended per-zone lighting values
   (sunlight, canopy, beams, haze) but nothing draws canopy, beams or haze yet.
4. **No special-upgrade gold blocks.** `upgrades: []` for worlds 3–5, and the
   framework branch of `generateWorld` returns before upgrade spots are placed.
5. **No campaign ending.** Killing the boss pays 10,000 essence; nothing else
   happens.

The design intent for these worlds is already written down. Treat these as the
spec and keep them true (update them if you change a number):

- `docs/WORLD_ROADMAP.md`: per-world layout, arrivals, exits, facility,
  teleporter, boss location.
- `docs/CAMPAIGN_PACING.md`: per-tier HP, damage, rewards, groves, bulkheads,
  benchmarks. Numbers live in `src/world/campaignBalance.ts`.

## 2. Ground rules

### Tooling

- Node 24 (`.nvmrc`). `npm ci`, then:
  - `npm test` runs Vitest (85 files, 613 tests, about 20 s; all green on main
    at 915161c). This must stay green after every phase.
  - `npm run build` runs `tsc --noEmit` and the Vite build. Must pass.
  - `npm run dev` serves the game on http://127.0.0.1:5173. Dev builds expose
    `window.__game`.
- Browser smoke scripts live in `scripts/*.cjs` and use Playwright with
  Chromium (see `scripts/labmap-render-smoke.cjs` for the pattern).

### Non-negotiables

1. **Deterministic maps.** Every player gets the same map. Geometry and
   encounter placement come only from the blueprint and `def.seed`. Never use
   `Math.random` in generation. The fixed per-world seed may vary surface grain only.
2. **Don't touch Worlds 1–2.** Their blueprints, parsing rules
   (`freeform`, `alien`) and tests stay as they are. Shared code changes must
   be gated on `def.framework` or `def.environment`.
3. **Keep the existing contracts** listed in WORLD_ROADMAP.md "Implementation
   contracts": `labMap.ts` owns footprints/starts/zones/regions/destinations;
   arrivals are combat-free; tier 7 has no enemies; killed enemies and
   gathered groves never respawn; persistent rewards are credited atomically on
   kill/gather; drill (terrain) damage never boosts enemy damage.
4. **Arrivals, exits and grid sizes are fixed:** W3 arrives at A7 (west gate,
   sector 78), exits south from L13 (tier 9 gate). W4 arrives at D1 (north,
   sector 3), facility C3–E5, teleporter at D4 (sector 24). W5 arrives at B7
   (sector 19), boss at B2 (sector 4). The world grid is 672 × 672 cells for
   every world; W3 uses 13 × 49 = 637.
5. **Mobile performance matters.** The game targets phones. No per-frame loops
   over the whole world; use the existing chunk/dirty-region caches
   (TerrainChunks, terrain partial repaint, lighting masks, fixture caches).
   Static art (trees, buildings, hull) is painted once into terrain/decor
   buffers or cached canvases, not redrawn per frame. Run
   `scripts/profile-smoke.cjs` before and after any rendering phase and report
   the numbers in the PR.
6. **Art direction.** Pixel art, procedurally drawn in code (no image assets
   unless Seth provides them), original designs. Gameplay information is not
   conveyed by neon glows on terrain; use shape, material, paint and the
   lighting system. The gold special-upgrade blocks are the one deliberate
   glowing exception. Forest tier 7 is meant to be bright and lush, a contrast
   to the dark lab; it darkens toward tier 9.
7. **Saves.** Never break an existing save. Any change to encounter ids or save
   shape needs a migration in `src/progression/SaveManager.ts`
   (`sanitizeSaveData`) and a test.
8. **One PR per phase**, titled `Late worlds phase N: …`. Each PR description
   lists what changed, test results, and attaches before/after screenshots
   (save them under `docs/screenshots/late-worlds/` or attach to the PR).

## 3. Key files

| File | What it owns |
|---|---|
| `src/world/labMap.ts` | `LAB_WORLDS` defs, blueprints, `parseBlueprint`, sector maths, `buildAuthoredLayout`, gate geometry, upgrade spot cells, `sectorSpawnCell`. |
| `src/world/WorldGenerator.ts` | `generateWorld`. The `if (frame && def.framework)` branch (around line 153) builds worlds 3–5 and returns early. |
| `src/world/LateWorldLayouts.ts` | `designLateSpaces` (carving) and `fortifyLateSpaces` (city/ship bulkheads). |
| `src/world/campaignBalance.ts` | `CAMPAIGN` tier table, block health, block rewards. |
| `src/world/worldAtmosphere.ts` | Per-zone atmosphere values and forest blending. |
| `src/world/MapBoundary.ts` | World perimeter (stone for forest/city, hull for ship). |
| `src/systems/LateEncounters.ts` | Encounter spawning, AI, shots, mines, boss, rewards, drawing. |
| `src/rendering/materials.ts` | `MATERIAL_BASE`, `FRAMEWORK_BASE`, `materialColor`, texel size `TEX`. |
| `src/rendering/TerrainRenderer.ts` | Terrain painting (uses `materialColor(tier, framework)`). |
| `src/rendering/Renderer.ts` | Frame composition; calls `game.late.draw` / `drawOverlay`; teleporter drawing. |
| `src/rendering/CreatureRenderer.ts` | Reference for procedurally animated pixel-art creatures. |
| `src/rendering/SpecialUpgradeRenderer.ts`, `src/systems/SpecialUpgrades.ts`, `src/progression/specialUnlocks.ts` | Gold special-upgrade blocks. |
| `src/ui/LabMap.ts`, `src/rendering/SectorThumbs.ts` | Sector map screen and its lit thumbnails. |
| `src/Game.ts` | `travelToWorld`, teleporter check, `selectLabWorld`, encounter wiring, `grantSpecialUpgrade`. |
| `tests/laterWorlds.test.ts`, `tests/lateCampaign.test.ts`, `tests/labMap.test.ts` | Existing coverage of worlds 3–5. |

Read each of these before changing it. Line numbers here are approximate.

## 4. Target data format: authored late-world blueprints

The core change is to make worlds 3–5 blueprint-driven like Worlds 1–2, with
encounters marked in the picture, so Seth can edit a world by editing text.

### 4.1 One file per world

Create `src/world/late/forest.ts`, `city.ts`, `mothership.ts`. Each exports its
blueprint, e.g. `export const FOREST_BLUEPRINT: readonly string[]`, and
`labMap.ts` imports them in place of `frameworkBlueprint(...)`. Keep
`frameworkBlueprint` (tests and tools may use it).

Sizes are fixed by the grid: 7 chars per sector, 7 cells per char.

| World | Columns × rows (chars) |
|---|---|
| 3 forest | 91 × 91 |
| 4 city | 49 × 49 |
| 5 mothership | 21 × 49 |

Put a header comment above each blueprint with the sector letters/numbers, the
legend and a one-line note per row band, in the style of `ZONE2_BLUEPRINT`.

### 4.2 Legend for late worlds

Keep the existing characters and add the ones below. Parse late blueprints with
`freeform = true` (rooms any shape at least 2 chars thick).

| Char | Meaning |
|---|---|
| `.` | Solid fill: forest earth/rock, city building mass, ship hull. Mineable at tier HP. |
| `R` | Open floor area (clearing, street, plaza, deck). |
| `-` `\|` `+` | Paths/streets/corridors as today (3–5 cells wide, deterministic). |
| `#` | Cover: an open-area char that is filled with a solid cover feature (tree cluster, boulder, car wreck, barricade, pillar). Counts as part of the room for flood-fill, but is carved back to solid. |
| `=` | Checkpoint bulkhead across a corridor (city facility 45,000 HP/cell × 3 deep, ship 65,000 HP/cell × 5 deep). Replaces the hard-coded ±18 offsets in `fortifyLateSpaces`. |
| `s` | Rifle soldier spawn (inside a room). |
| `b` | Brute spawn. |
| `t` | Turret spawn. |
| `m` | Mine. |
| `g` | Grove (forest only). |
| `X` | Boss (world 5, sector B2 only). |
| `P` | Teleporter pad (world 4, sector D4 only). |
| `$` | Special-upgrade gold block (replaces the `upgrades` col/row list for late worlds; see Phase 5). |

Marker chars (`s b t m g X P $`) are room chars: they are open floor with
something placed at the centre of that char's 7 × 7 cells. Extend
`isRoomChar` / `ROOM_CHARS` only for late blueprints (for example pass a
`late` flag to `parseBlueprint`) so Worlds 1–2 parse exactly as before.

Add `parseLateMarkers(lines): LateMarker[]` returning
`{ kind, col, row, sector, ordinal }` in reading order, where `ordinal` counts
markers of the same kind within the same sector.

### 4.3 Encounter ids and save migration

New encounter ids are `${sector}:${kind}:${ordinal}`, the same shape as today.
Today `j` is the index within the sector's whole kind list (soldier 0, soldier
1, brute 2) and groves count separately. Because the counts per sector will
change, add a save migration:

- Add `lab.lateLayout` (number, default 0) to the save. Set the new layout to
  version 1.
- When loading a save with `lateLayout < 1` and progress in worlds 3–5: for
  each sector where every old encounter id was cleared/gathered, mark every new
  id in that sector cleared/gathered. Drop the rest of the old ids for that
  world. Never pay rewards during migration (they were already credited).
- Test it in `tests/lateCampaign.test.ts` next to "migrates old saves…".

## 5. Phases

Do them in order. Each phase ends with `npm test` and `npm run build` green,
plus the listed checks.

### Phase 1: Blueprint-driven carving (no visual change in intent)

Goal: worlds 3–5 build their geometry and encounters from the blueprint.

1. Implement the legend and `parseLateMarkers` (section 4.2) in `labMap.ts`.
2. In `WorldGenerator.ts`'s framework branch, replace `designLateSpaces`
   with a new `carveLateBlueprint(world, frame)` in `LateWorldLayouts.ts`:
   set all cells to tier block health (`lateBlockHealth`), carve rooms
   (union of the parsed squares, using the same 2-cell inset as
   `buildAuthoredLayout`) and halls, re-fill `#` cover, paint `=` bulkheads.
   Keep `buildGates`, the start-room clear and `installMapBoundary`.
3. Change `LateEncounters.reset` to spawn from `parseLateMarkers` instead of
   the per-tier kind lists. Health, damage and rewards still come from
   `CAMPAIGN[tier]` (tier from the marker's sector).
4. Write first-pass blueprints that reproduce today's content roughly (one
   clearing per sector, same counts per tier) so the gameplay numbers in
   CAMPAIGN_PACING.md still hold. Phase 2 makes them good.
5. Delete the old formula carving once nothing uses it. Update the tests in
   `lateCampaign.test.ts` "generates distinct spatial archetypes…" and
   `laterWorlds.test.ts` that probe exact offsets (±5, ±7, ±18) so they read
   positions from the blueprint markers instead.
6. Add the save migration (section 4.3).

New tests (in a new `tests/lateBlueprints.test.ts`):

- Each late blueprint has the right dimensions and parses with `late` rules.
- Every room is reachable from the arrival by flood fill **through open cells
  plus gate cells**, except areas deliberately sealed by `=` bulkheads, which
  must be reachable once bulkheads are removed.
- Every marker lands on an open cell; no marker in the arrival sector except
  `$`; no `s b t m X` in tier-7 sectors; `g` only in world 3; exactly one `X`
  (sector 4 of world 5) and one `P` (sector 24 of world 4).
- Determinism: generating a world twice yields identical `health`/`wall`
  arrays and identical encounter lists.
- Per-tier encounter totals stay within ±20% of the CAMPAIGN_PACING budgets
  (Phase 2 may rebalance; then update the doc and this test together).

### Phase 2: Author the three maps

Goal: each world reads as a real place with varied, readable fights. Draw the
blueprints by hand (a generator script may draft them, but the committed
blueprint is the source of truth and must be hand-editable, as with World 2).

**World 3, Canopy Forest (13 × 13, tiers 7–9, start A7, exit L13 south).**

- Tier 7 (within 5 sectors of A7): peaceful, wide meadows and winding trails
  that branch and loop. 6 groves per sector (pacing table). Lots of open sky.
- Tier 8 (distance 5–8): denser woods, narrower trails, clearings with `#`
  tree/boulder cover; 2 `s` + 1 `b` + 3 `g` per sector as a baseline, varied
  per sector (some 3 `s`, some 2 `b`), keeping the tier total.
- Tier 9 (distance 9+): dark, tight, canopy-heavy forest with chokepoints;
  baseline 2 `s` + 1 `b` + 2 `g`.
- At least three distinct landmark sectors (for example a lake bed, a fallen
  giant tree, a ruined ranger station) so players can navigate by the map.
- Trails must give at least two routes to L13 so one hard sector doesn't wall
  the player in.

**World 4, Fallen City (7 × 7, tier 10, start D1 north, teleporter D4).**

- A street grid with blocks of building mass (`.`), plazas, alleys and
  `#` wrecks/barricades. Outer ring sectors: 2 `t` + 1 `m` + 1 `s` + 1 `b`
  baseline, varied per sector.
- The C3–E5 aerospace facility: walled compound with four entrances, each
  closed by a `=` 45,000 HP × 3 bulkhead (same totals as today). Inside:
  hangar, launch control, fuel yard, and the D4 launch pad marked `P` at the
  centre of its sector.
- D1 arrival is combat-free with a clear street leading south.

**World 5, Blight Mothership (3 × 7, tier 11, start B7, boss B2).**

- Bottom to top: B7 staging airlock (no combat) → lower defence decks → hangar
  bay → reactor corridors → inner sanctum checkpoints → B2 Command Sanctum →
  row 1 apex observation deck behind it.
- Corridor throats between decks closed by `=` 65,000 HP × 5 bulkheads (keep
  the current number of checkpoints between B7 and B2 or justify the change in
  CAMPAIGN_PACING.md).
- B2: octagonal arena with 4 `#` blast pillars, 2 `t` flank turrets and `X`
  at its centre.

Checks: render each world's sector map in a dev build (see section 6) and
attach the screenshots to the PR.

### Phase 3: Environment terrain art

Goal: each environment has its own matte pixel materials, painted once.

1. Add `environment`-specific materials in `materials.ts` (keep
   `materialColor(tier, framework)` working; add an `environment` argument or a
   new `lateMaterial(env, tier, texelX, texelY)`):
   - Forest: tier 7 moss and loam with grass tufts; tier 8 drier brown earth
     with leaf litter; tier 9 dark Blight-stained soil with faint vein lines.
     `#` cover painted as tree trunks (ring texture) or boulders.
   - City: tier 10 fractured concrete and brick with rebar; streets as asphalt
     with faded lane paint; `#` as car wrecks / barricades.
   - Ship: tier 11 organic-metal hull plates with seams; floors as ribbed deck;
     `#` as pillars. Bulkhead cells get a distinct hazard-banded plate.
2. Floors: forest grass/dirt paths, city asphalt/sidewalk, ship deck panels.
   Use `TerrainRenderer.paintFloor`'s contact shadows.
3. Blend forest materials across tier bands over 1.5 sectors, matching
   `atmosphereAt`'s blend so there are no hard seams.
4. Sector thumbnails (`SectorThumbs.ts`) must pick up the new materials.

Checks: screenshots of one sector per tier per world, light and dark areas;
profile numbers before/after.

### Phase 4: Atmosphere, lighting and props

1. Forest canopy and sun shafts: draw canopy as a cached, parallax-free
   overlay above the floor with soft shadow patches; sun beams as a few
   cached light shapes whose strength comes from `atmosphere.beams`. Canopy
   coverage comes from `atmosphere.canopy`. Tier 7 bright, tier 9 dark with
   distinct beams. Ambient from `atmosphere.ambient`.
2. City: orange haze (`atmosphere.haze`) as a cheap screen-space tint plus a
   few drifting ember particles; burning-window light fixtures in building
   mass; streetlights that can be shot out (reuse fixture lighting).
3. Ship: dim violet ambient, pulsing organic conduit lights along corridor
   walls (lights, not terrain glow), bulkhead warning lamps.
4. Teleporter pad: animated pad art at `P`, active only after the facility
   is breached (any facility entrance bulkhead destroyed) or immediately, if
   simpler; say which in the PR.
5. Mothership arena: distinct floor pattern and pillar art.

Keep every effect within the existing lighting pipeline (`LightingSystem`
fixtures, flashes) so muzzle flashes still matter.

### Phase 5: Enemy and boss art, special upgrades

1. Replace the placeholder shapes in `LateEncounters.draw` with procedurally
   animated pixel-art sprites in a new `src/rendering/LateEncounterRenderer.ts`
   (follow `CreatureRenderer.ts`): Blight rifle soldier (walk cycle, aim pose,
   muzzle flash), brute (heavy lumbering walk, wind-up telegraph that stays
   readable through fog via `drawOverlay`), hacked turret (rotating head,
   power-up), mine (blinking warning pulse during its 0.9 s fuse), grove
   (plant cluster that shrinks when gathered). Sprites may vary by tier (8 vs
   9 vs 10 vs 11) through palette and armour plates.
2. Boss "Leviathan Core": a large animated organism-machine at B2. Show its
   phases visually (intact, exposed core, enraged below 30% HP), keep the
   existing HP, volleys and reward. Add a death sequence (screen shake and
   particle burst already exist; add collapse animation).
3. Special-upgrade gold blocks: place `$` markers (4 in World 3, 3 in World 4,
   2 in World 5; at least one behind a tier-9/facility/bulkhead obstacle each).
   Make the framework branch of `generateWorld` add them to
   `world.upgradeSpots` (ids `z3-special-1` …). Leave their entries out of
   `SPECIAL_UNLOCKS` for now; `grantSpecialUpgrade` already labels unmapped
   spots "SPECIAL UPGRADE". Seth will assign their rewards.

### Phase 6: Campaign ending

When the boss dies:

1. Set a save flag `campaign.complete = true` and record run time.
2. After the boss death sequence, show a "MOTHERSHIP DESTROYED" ending
   screen with run stats (time, soldiers lost, essence earned), then return
   to the sector map. The run continues; the world remains playable.
3. The main menu profile shows a small completion mark.

Keep the text placeholder-quality and easy to edit in one place; Seth will
write the final wording.

### Phase 7: Balance pass and docs

1. Using the existing balance tests and `scripts/battle-simulation-benchmark.cjs`
   patterns, measure the items in CAMPAIGN_PACING.md "Next balancing session".
2. Update `docs/WORLD_ROADMAP.md` and `docs/CAMPAIGN_PACING.md` so they
   describe the authored worlds, not the formula archetypes.
3. Update the "Remaining tuning uncertainties" list with what you measured.

## 6. How to verify

### Automated

- `npm test` and `npm run build` after every phase.
- New tests from Phase 1 plus, per later phase, at least: materials return
  distinct colours per environment/tier; special spots in late worlds are
  inside open cells and grantable; the ending flag is set once and survives a
  save round-trip; the migration test.
- If more than a fifth of tests fail, stop and reconsider the change rather
  than editing tests to match.

### In the browser

With `npm run dev` running, use Playwright (Chromium) and the dev hook:

```js
await page.goto('http://127.0.0.1:5173');
await page.locator('[data-act="play"]').click();
await page.evaluate(() => {
  const g = window.__game;
  g.save.data.settings.devMode = true;
  g.save.data.settings.devMapAccess = true;
  g.selectLabWorld(3);   // 3, 4 or 5
  g.labMap.show();       // sector map; deploy to a sector to see it in play
});
```

Capture for each phase: the sector map of each changed world, one in-play view
per tier band, and (Phase 5+) each enemy kind and the boss. Use
`deviceScaleFactor: 2` and a phone viewport (e.g. 390 × 844) as well as
desktop (1280 × 800).

### Performance

Run `scripts/profile-smoke.cjs` (and `scripts/render-scene-benchmark.cjs` for
rendering phases) on main and on your branch. A regression above 10% in frame
time on the phone profile must be fixed or explained in the PR.

## 7. Open questions for Seth (use these defaults until answered)

| Question | Default in this plan |
|---|---|
| What do the World 3–5 gold blocks unlock? | Placed but unmapped; label "SPECIAL UPGRADE". |
| Does the teleporter need the facility breached first? | Agent's choice; must be stated in the PR. |
| What happens after the boss? | Ending screen, then the run continues (Phase 6). |
| Exact landmark themes | Agent proposes three per world in the Phase 2 PR. |
| Should World 3 tier 7 really be bright? | Yes, per WORLD_ROADMAP.md. |
