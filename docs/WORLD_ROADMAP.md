# World 3–5 encounter layouts and design brief

## Scope of this change

Worlds 3–5 now have functional encounter spaces and an initial economy pass. Forest clearings and trails lead through peaceful gathering, rifle patrols and heavy melee enemies. City street crossfire and proximity mines defend armored facility checkpoints. Ship halls have 65,000-HP bulkheads. Shapes and colors are functional placeholders for the later art pass. See [CAMPAIGN_PACING.md](CAMPAIGN_PACING.md) for measurable budgets and tuning targets.

World and zone are different concepts: worlds 1/2 each contain three terrain zones; worlds 3/4/5 contain zones 7–9/10/11 respectively. The HUD displays both.

## World 3: outside forest — 13 columns × 13 rows

- Arrive from World 2 at **A7**, on the west side (existing arrival preserved).
- **Zone/tier 7:** beautiful, lush green woodland; no sign of Blight. Bright sunlight and tree/canopy shadows are the intended final look.
- **Zone/tier 8:** increasingly difficult Blight enemies; lighting and environment drift toward dusk.
- **Zone/tier 9:** a dark Blight forest. Overhead tree canopy should cast shadows and let distinct beams of sunlight reach the ground.
- Atmosphere and environment must blend smoothly between the three zones, rather than changing at a hard seam. The current atmosphere module blends daylight/ambient colors and stores sunlight, canopy, beam and haze parameters for the future biome renderer.
- Current band boundaries are distance 5 and 9 sectors from A7; atmosphere blends span 1.5 sectors around those boundaries. These are tunable layout values, not final pacing.
- Exit **south from L13**, one column left of the east edge (M13). This leads to World 4. The exit requires the Tier 9 core keycard (250 biomass + 2,000 essence).

## World 4: Blight-overrun city — 7 × 7, zone/tier 10

- This is the **penultimate zone**.
- Apocalyptic orange haze; city overrun with Blight.
- Reserve the center **3 × 3 sectors, C3 through E5**, for a NASA-like aerospace facility.
- Breaking into that facility should eventually be extremely difficult: Blight has hacked its turrets and security measures. Active hacked turrets, rifle patrols, heavy melee guards and warning mines defend the streets; the central facility adds 45,000-HP mining checkpoints.
- The facility's center, **D4**, holds a teleporter. Walking a surviving soldier onto the portal carries the surviving team to World 5 without ending/banking the run.
- The city arrival is **D1**, on the north edge. This is an implementation default for the forest's southward exit, since a city arrival sector was not specified.

```
       A B C D E F G
    1  . . . A . . .     A = arrival
    2  . . . . . . .
    3  . . F F F . .     F = facility reservation
    4  . . F T F . .     T = team teleporter
    5  . . F F F . .
    6  . . . . . . .
    7  . . . . . . .
```

## World 5: Blight mother ship in space — 5 columns × 3 rows, zone/tier 11

- The final zone, aboard the Blight mother ship in space.
- Exactly 15 sectors, A1 through E3; no phantom fourth or fifth row.
- The current arrival is **C3**, the middle of the bottom row. Arrival positioning was unspecified and can be moved independently of the footprint.
- No exit or finale/boss encounter has been invented for this framework.

## Implementation contracts

- `labMap.ts` owns footprints, start sectors, zones, region reservations and destinations. `sectors` is the column count; `worldRows()` supplies row count for rectangular maps.
- World 2's Tier 6 gate uses the new Tier 6 core keycard (150 green crystals + 100 essence). The Tier 9 card follows it along the core snake.
- `worldAtmosphere.ts` owns the design profiles and continuous forest blending. Background/ambient preview lighting is active. Finished trees, canopy geometry, sunlight shadow casters/volumetric shafts, city scenery and mothership art are future work.
- Later generation suppresses old lab machinery and cellular Blight growth. Tier 7 remains completely peaceful. Tiers 8–11 use persistent authored encounter populations; killed enemies and gathered groves do not respawn when the map is reopened.
- The south gate and teleporter use the existing squad-transfer machinery: health, loadouts, energy, reserves, run time and earnings survive travel. New worlds are unlocked/persisted when reached.
