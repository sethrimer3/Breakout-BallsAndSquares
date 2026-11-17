# Avoid repeated wall-light cell checks

Baseline: `4a48853`. The retained change reduces duplicate terrain-cell work while converting shadow polygons into wall-light lists.

Each perimeter sample still examines its original position and the same outward x/y offsets. Coordinates are converted to cells once; offsets that land in the original cell need no second visit. The existing per-light stamp array now records empty cells as well as solid ones, avoiding repeated solidity checks in the same synchronous trace. The next light gets a new stamp, and rollover still clears the array. First-visit order and output-cap behavior are preserved. No new persistent cache or buffer is added.

## Isolated marking cost

The [complete data](WALL_LIGHT_MARKING_BENCHMARK.json) includes component, preparation-only and full rendering matrices. The isolated benchmark uses actual visibility polygons generated for mixed soldier shapes amid half-size Blight. Sparse batches contain two lights; dense batches contain 40 (20 muzzle-radius and 20 soldier-radius). Each variant receives 20 warmup batches and 60 measured batches with alternating order. Only marking is timed, and every resulting ordered list is checked against baseline afterward.

**Marking time per batch, p50 / p95 / p99 ms:**

| CPU profile | Lights | Baseline | Updated |
| --- | ---: | ---: | ---: |
| 1× throttle | 2 | 0.1 / 0.2 / 0.3 | 0.1 / 0.2 / 0.7 |
| 1× throttle | 40 | 2.5 / 3.0 / 4.0 | 1.6 / 2.8 / 3.6 |
| 4× throttle | 2 | 0.4 / 1.2 / 2.1 | 0.1 / 0.9 / 2.7 |
| 4× throttle | 40 | 11.3 / 15.8 / 31.8 | 7.6 / 11.6 / 14.5 |

Dense marking median cost falls **2.5 → 1.6 ms (36%)** without throttling and **11.3 → 7.6 ms (32.7%)** with 4× CPU throttling. Sparse component samples approach the timer's resolution; their percentage changes should not be treated as reliable gains. These are isolated marking costs, not game frame times.

## Preparation and full rendering

The preparation-only run measures shadow/visibility/fixture preparation without drawing. Median paired dense-preparation p50 changes across the four camera/zoom scenarios are **−4.8% desktop / −2.2% mobile profile**. It performs polygon/lit-cell comparisons but no pixel readbacks; its JSON explicitly records zero image comparisons.

Both full-render matrices use desktop 1200×800 at device scale 1 and emulated mobile 390×844 at scale 2 with 4× CPU throttling. Sparse scenes contain one soldier/flash; dense scenes contain 20 soldiers/flashes across all eight body shapes and 200 smoke particles. Cameras are stationary/moving at zoom 0.5/1.13. Soldiers turn/move and half-size Blight changes every frame. Sources occupy an open region, so lights actually generate shadow polygons. The scene is revealed through fog so image readbacks include visible lighting and shadows; this is a fixture update from the previous shadow-ray report, so absolute times across reports are not directly comparable.

The paired baseline and updated LightingSystem instances share world inputs and use identical current renderer code with separate renderers. Render density and light quality are pinned high. Timings include shadow preparation plus the complete renderer draw. Shared terrain mutation and terrain/floor updates precede timing; simulation is frozen. The render clock advances identically. Each variant has eight warmup frames; soft-shadow runs measure 30 frames, and default-shadow (blur off) runs measure 20.

**Median paired percentage changes** across the four camera/zoom scenarios per row:

| Shadows | Device | Combat | Preparation p50 | Render CPU p50 | Render CPU p95 | Render CPU p99 |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Soft blur | desktop | Sparse | -0.0% | +0.0% | +3.2% | +5.4% |
| Soft blur | desktop | Dense | -4.0% | -0.8% | -2.5% | +8.9% |
| Soft blur | mobile | Sparse | -1.2% | +4.0% | -2.2% | -13.3% |
| Soft blur | mobile | Dense | -0.9% | -0.1% | +2.6% | +0.3% |
| Default | desktop | Sparse | -11.8% | +0.1% | +0.8% | +0.8% |
| Default | desktop | Dense | -3.2% | -2.4% | +1.0% | +1.0% |
| Default | mobile | Sparse | +5.8% | -2.3% | -10.7% | -10.7% |
| Default | mobile | Dense | -4.2% | -1.7% | -0.1% | -0.1% |

Whole rendering gains are modest: dense median CPU time improves **2.4% desktop / 1.7% mobile profile** with default shadows, and **0.8% / 0.1%** with soft blur enabled. Individual scenarios and tails regress. The isolated marking improvement does not establish a broad FPS improvement; full-screen lighting/compositing and other shadow work still dominate.

These are CPU submission times from one cloud Chromium host, not physical-phone or GPU measurements. Both variants run within a shared rAF, so its presentation interval cannot be attributed separately. Percentiles use the existing script's upper-rank `floor(n × p)` selection; at 20 samples p95 and p99 both select the maximum. At 30 samples p99 is the maximum. Scheduling, raster work and GC produce outliers; no statistical confidence interval is claimed.

**Complete render CPU p50 / p95 / p99 ms:**

| Shadows | Device | Combat | Camera | Zoom | Baseline | Updated |
| --- | --- | --- | --- | ---: | ---: | ---: |
| Soft blur | desktop | Sparse | Stationary | 0.5 | 20.8 / 34.2 / 34.7 | 22.3 / 35.5 / 39.0 |
| Soft blur | desktop | Sparse | Stationary | 1.13 | 20.1 / 26.1 / 31.0 | 19.7 / 30.2 / 37.1 |
| Soft blur | desktop | Sparse | Moving | 0.5 | 21.0 / 28.3 / 30.7 | 21.0 / 27.6 / 28.8 |
| Soft blur | desktop | Sparse | Moving | 1.13 | 18.7 / 23.3 / 24.3 | 18.7 / 23.9 / 23.9 |
| Soft blur | desktop | Dense | Stationary | 0.5 | 55.2 / 61.7 / 66.4 | 54.6 / 60.2 / 68.5 |
| Soft blur | desktop | Dense | Stationary | 1.13 | 65.7 / 77.6 / 89.0 | 65.0 / 73.5 / 79.4 |
| Soft blur | desktop | Dense | Moving | 0.5 | 56.0 / 66.8 / 76.6 | 56.8 / 65.1 / 87.8 |
| Soft blur | desktop | Dense | Moving | 1.13 | 63.1 / 69.2 / 70.8 | 62.7 / 75.5 / 121.5 |
| Soft blur | mobile | Sparse | Stationary | 0.5 | 138.6 / 185.9 / 230.6 | 140.5 / 200.4 / 215.3 |
| Soft blur | mobile | Sparse | Stationary | 1.13 | 119.4 / 166.1 / 183.3 | 130.4 / 221.1 / 228.7 |
| Soft blur | mobile | Sparse | Moving | 0.5 | 139.5 / 237.0 / 260.8 | 136.6 / 165.4 / 168.4 |
| Soft blur | mobile | Sparse | Moving | 1.13 | 125.5 / 242.5 / 324.5 | 133.8 / 212.8 / 259.5 |
| Soft blur | mobile | Dense | Stationary | 0.5 | 348.9 / 428.1 / 443.8 | 352.5 / 454.7 / 524.3 |
| Soft blur | mobile | Dense | Stationary | 1.13 | 442.9 / 489.4 / 527.6 | 436.8 / 532.7 / 547.8 |
| Soft blur | mobile | Dense | Moving | 0.5 | 326.2 / 470.3 / 475.1 | 327.9 / 398.5 / 459.5 |
| Soft blur | mobile | Dense | Moving | 1.13 | 443.6 / 571.0 / 689.2 | 440.7 / 565.7 / 593.9 |
| Default | desktop | Sparse | Stationary | 0.5 | 15.2 / 24.9 / 24.9 | 15.8 / 26.6 / 26.6 |
| Default | desktop | Sparse | Stationary | 1.13 | 12.7 / 23.3 / 23.3 | 12.5 / 22.1 / 22.1 |
| Default | desktop | Sparse | Moving | 0.5 | 15.8 / 20.9 / 20.9 | 15.6 / 23.3 / 23.3 |
| Default | desktop | Sparse | Moving | 1.13 | 13.2 / 43.8 / 43.8 | 13.4 / 21.1 / 21.1 |
| Default | desktop | Dense | Stationary | 0.5 | 47.4 / 53.8 / 53.8 | 46.3 / 55.0 / 55.0 |
| Default | desktop | Dense | Stationary | 1.13 | 55.0 / 68.1 / 68.1 | 54.4 / 68.0 / 68.0 |
| Default | desktop | Dense | Moving | 0.5 | 53.6 / 64.6 / 64.6 | 50.9 / 62.2 / 62.2 |
| Default | desktop | Dense | Moving | 1.13 | 57.5 / 66.1 / 66.1 | 56.1 / 72.9 / 72.9 |
| Default | mobile | Sparse | Stationary | 0.5 | 87.7 / 146.7 / 146.7 | 85.0 / 141.8 / 141.8 |
| Default | mobile | Sparse | Stationary | 1.13 | 76.7 / 121.2 / 121.2 | 75.5 / 102.4 / 102.4 |
| Default | mobile | Sparse | Moving | 0.5 | 101.2 / 152.0 / 152.0 | 102.7 / 143.0 / 143.0 |
| Default | mobile | Sparse | Moving | 1.13 | 78.8 / 156.7 / 156.7 | 69.5 / 91.9 / 91.9 |
| Default | mobile | Dense | Stationary | 0.5 | 289.2 / 381.5 / 381.5 | 282.9 / 346.2 / 346.2 |
| Default | mobile | Dense | Stationary | 1.13 | 406.4 / 500.7 / 500.7 | 396.4 / 487.4 / 487.4 |
| Default | mobile | Dense | Moving | 0.5 | 310.2 / 445.0 / 445.0 | 310.9 / 455.6 / 455.6 |
| Default | mobile | Dense | Moving | 1.13 | 390.3 / 435.4 / 435.4 | 385.9 / 498.0 / 498.0 |

## Validation

- **600 tests across 84 files**, plus production type check/build, passed. New coverage checks empty-to-solid changes between lights, output-cap ordering, and stamp rollover.
- **195 strict trace comparisons** against the archived baseline passed with zero polygon-coordinate or lit-cell changes, covering all body shapes, moving/turning occluders, all light qualities, growth/destruction, regeneration, tiny radii, source relocation and ray-budget fallback.
- **84 ordered lit-cell list comparisons** passed in the isolated marking benchmark.
- **64 full-frame pixel comparisons** across both shadow settings passed with zero differing channels. Each also compares all flash/soft-light polygons and lit-cell lists.
- **258 lighting-pipeline pixel comparisons** and **80 active-render pixel/mask checks** passed, including fixture changes, soft shadows, resizing, glass opacity, growth/destruction and camera changes.

[Raw regression results](WALL_LIGHT_MARKING_REGRESSIONS.json) retain the trace and active-render records. The existing shadow benchmark now supports preparation-only runs and explicit soft-shadow selection; skipped image readbacks are counted as zero.

## Rejected experiments

Exact duplicate-angle ray reuse preserved output but produced no reliable dense shadow-preparation benefit. A bounded corner-object pool also preserved trace output, but dense mobile preparation median regressed about 5% in the preparation-only matrix. Both implementations were discarded; ray-count telemetry and corner allocation behavior retain their prior semantics.

## Reproduce

With Vite on port 5173, run sequentially without competing builds/tests:

```bash
npm test
npm run build
BREACH_BASELINE_REF=4a48853 node scripts/wall-marking-benchmark.cjs
BREACH_BASELINE_REF=4a48853 BREACH_PREP_ONLY=1 BREACH_REPORT=/tmp/wall-preparation.json node scripts/shadow-ray-benchmark.cjs
BREACH_BASELINE_REF=4a48853 BREACH_REPORT=/tmp/wall-soft.json node scripts/shadow-ray-benchmark.cjs
BREACH_BASELINE_REF=4a48853 BREACH_SOFT_SHADOWS=0 BREACH_SAMPLES=20 BREACH_REPORT=/tmp/wall-default.json node scripts/shadow-ray-benchmark.cjs
BREACH_BASELINE_REF=4a48853 node scripts/shadow-ray-smoke.cjs
BREACH_BASELINE_REF=4a48853 node scripts/lighting-pipeline-smoke.cjs
BREACH_BASELINE_REF=4a48853 BREACH_CHECK_ONLY=1 node scripts/render-active-benchmark.cjs
```
