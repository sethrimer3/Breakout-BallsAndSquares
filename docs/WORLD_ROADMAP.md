# World 3–5 framework and design brief

## Scope of this change

Correct footprints, named zones, connected empty rooms, gateway orientation, a usable city teleporter, save validation and map labeling are implemented. World 3–5 are deliberately framework worlds: no enemies, Blight growth, machines, loot veins or encounter balancing are populated yet. Their 500-HP filler barriers are scaffolding, not tier 7–11 balance.

World and zone are different concepts: worlds 1/2 each contain three terrain zones; worlds 3/4/5 contain zones 7–9/10/11 respectively. The HUD displays both.

## World 3: outside forest — 13 columns × 13 rows

- Arrive from World 2 at **A7**, on the west side (existing arrival preserved).
- **Zone/tier 7:** beautiful, lush green woodland; no sign of Blight. Bright sunlight and tree/canopy shadows are the intended final look.
- **Zone/tier 8:** increasingly difficult Blight enemies; lighting and environment drift toward dusk.
- **Zone/tier 9:** a dark Blight forest. Overhead tree canopy should cast shadows and let distinct beams of sunlight reach the ground.
- Atmosphere and environment must blend smoothly between the three zones, rather than changing at a hard seam. The current atmosphere module blends daylight/ambient colors and stores sunlight, canopy, beam and haze parameters for the future biome renderer.
- Current band boundaries are distance 5 and 9 sectors from A7; atmosphere blends span 1.5 sectors around those boundaries. These are tunable layout values, not final pacing.
- Exit **south from L13**, one column left of the east edge (M13). This leads to World 4. The framework exit is already open; final late-game gating remains to be designed.

## World 4: Blight-overrun city — 7 × 7, zone/tier 10

- This is the **penultimate zone**.
- Apocalyptic orange haze; city overrun with Blight.
- Reserve the center **3 × 3 sectors, C3 through E5**, for a NASA-like aerospace facility.
- Breaking into that facility should eventually be extremely difficult: Blight has hacked its turrets and security measures. No turrets or security encounters are populated in this empty framework.
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
- World 2's existing Tier 6 gate to World 3 remains unchanged. Its final access progression still needs a design; this change does not invent additional keycards.
- `worldAtmosphere.ts` owns the design profiles and continuous forest blending. Background/ambient preview lighting is active. Finished trees, canopy geometry, sunlight shadow casters/volumetric shafts, city scenery and mothership art are future work.
- Framework generation intentionally suppresses all lab/Blight population and growth, including in zones 8–11. The intended harder encounters are recorded above, not silently spawned as placeholder enemies.
- The south gate and teleporter use the existing squad-transfer machinery: health, loadouts, energy, reserves, run time and earnings survive travel. New worlds are unlocked/persisted when reached.
