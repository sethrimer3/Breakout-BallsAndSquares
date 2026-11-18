# Reuse lighting-mask pixels during camera movement

Baseline: `6075132`, including the latest fixed-map, balance and progression changes.

## Behavior

A compatible pan now copies the previous opacity mask by an exact device-pixel offset and repaints exposed strips, the viewport fringe, and changed interior opacity tiles. Stationary views keep the previous regional-update path. Subpixel movement that leaves both chunk selection and raster mapping unchanged can reuse the mask without copying it. Lighting polygons, gradients and animation still update normally.

Reuse requires unchanged terrain identity, zoom, viewport, density, backing size and ambient color. Both edges of every visible chunk must translate equally, and the resulting offset must be an exact integer in device pixels. Changes in fractional-zoom rounding, fractional device shifts, large jumps, dense repaint regions and resizing retain full rebuilds. A replacement terrain instance also rebuilds fully; regeneration republishes all affected opacity tiles. Viewport fringe strips handle changes in selected chunks at rounded boundaries.

A second mask canvas is allocated lazily for nonzero scrolling. Front/back canvases avoid self-copy snapshots and are resized together. This costs one extra viewport-sized RGBA backing per renderer: about **5.0 MiB at 780×1688**, before browser overhead. No gameplay, growth, collision, camera-motion or render-density rule changes.

## Diagnostic profile

A baseline profile used one real Game.step per frame, a moving zoomed-out camera, one deployed soldier and eight opened generator chambers at a 4× growth multiplier. It recorded 32,292 replication events over 120 frames. Median simulation, terrain preparation and drawing were 1.5, 6.6 and 20.0 ms, respectively; total pipeline work was 28.6 ms. Native image drawing remained the largest sampled cost. This is a diagnostic run, not a paired speedup measurement.

The profile script now supports BREACH_PROFILE_MOVING, BREACH_PROFILE_FULL_STEP, BREACH_PROFILE_RATE and BREACH_PROFILE_ZOOM, so future profiles can include full simulation and camera motion rather than only GrowthSystem.update.

## Paired growth measurements

[Complete growth data](SCROLL_MASK_GROWTH.json) record 12 moving-camera cases: growth multipliers 1/4, zoom 0.5/1.13/default 2.5, and both device profiles. Each variant has 12 simulation warmup frames and 100 measured frames, with alternating evaluation order. Timings include Game.step, terrain preparation, shadows and complete rendering. **All 36 full-frame pixel checks and 36 terrain-state checks match**, along with event totals and maximum pending-chunk counts.

Desktop is 1000×700 at device scale 1; mobile is 390×844 at scale 2 with 4× CPU throttling. Render density and lighting quality are pinned high, soft shadows disabled, and fog revealed. These are CPU submission/pipeline measurements on one cloud host, not physical-phone FPS or GPU presentation times. The fixture accelerates the growth clock to 80 seconds without replaying an entire mature run.

Median paired percentage change across the two growth multipliers:

| Device | Zoom | Pipeline p50 | Pipeline p95 | Pipeline p99 |
| --- | ---: | ---: | ---: | ---: |
| desktop | 0.5 | -3.5% | +5.8% | +133.7% |
| desktop | 1.13 | -6.2% | -16.4% | -33.6% |
| desktop | 2.5 | -5.3% | +6.5% | -23.5% |
| mobile | 0.5 | -10.1% | -4.7% | -17.2% |
| mobile | 1.13 | +0.2% | -3.6% | -6.2% |
| mobile | 2.5 | -9.2% | -3.4% | -27.2% |

The fractional-zoom control often rejects reuse. Individual regressions and outliers remain in the data; there is no claim that every percentile or view improves. Percentiles use upper-rank selection; with 100 samples, p99 is the maximum observation.

| Device | Growth | Zoom | Baseline p50 / p95 / p99, ms | Updated p50 / p95 / p99, ms |
| --- | ---: | ---: | --- | --- |
| desktop | 1 | 0.5 | 21.0 / 31.1 / 49.9 | 20.5 / 28.3 / 56.8 |
| desktop | 1 | 1.13 | 15.9 / 27.5 / 59.1 | 14.9 / 19.3 / 33.5 |
| desktop | 1 | 2.5 | 14.9 / 19.6 / 30.4 | 13.9 / 22.0 / 26.5 |
| desktop | 4 | 0.5 | 21.6 / 25.6 / 27.4 | 20.6 / 30.9 / 96.9 |
| desktop | 4 | 1.13 | 18.3 / 23.3 / 46.1 | 17.2 / 22.6 / 35.1 |
| desktop | 4 | 2.5 | 17.9 / 24.8 / 53.3 | 17.2 / 25.0 / 35.1 |
| mobile | 1 | 0.5 | 101.7 / 135.7 / 211.4 | 89.5 / 126.0 / 163.9 |
| mobile | 1 | 1.13 | 97.1 / 124.8 / 151.5 | 93.8 / 123.4 / 160.3 |
| mobile | 1 | 2.5 | 84.0 / 111.8 / 232.8 | 74.7 / 111.8 / 148.9 |
| mobile | 4 | 0.5 | 112.4 / 148.4 / 223.3 | 103.2 / 145.1 / 196.6 |
| mobile | 4 | 1.13 | 102.5 / 145.2 / 296.1 | 106.3 / 136.3 / 242.4 |
| mobile | 4 | 2.5 | 99.3 / 163.8 / 255.1 | 92.0 / 152.8 / 208.2 |

## Desktop stress repeat

The desktop 0.5-zoom stress case had a large p99 outlier, so zoom 0.5 and default 2.5 were repeated with **200 measured frames per variant**. [Complete repeat data](SCROLL_MASK_REPEAT.json) retain the results. All six full-frame and six terrain-state comparisons match. p50/p95 improve in the repeat, but p99 remains worse; the change does not eliminate desktop tail spikes. This longer fixture evolves farther into replication; compare variants within each run.

| Zoom | Baseline p50 / p95 / p99, ms | Updated p50 / p95 / p99, ms |
| ---: | --- | --- |
| 0.5 | 23.0 / 32.6 / 38.4 | 22.0 / 31.6 / 39.9 |
| 2.5 | 17.3 / 23.1 / 33.1 | 16.7 / 22.9 / 41.1 |

## Combat controls

[Sparse/dense combat controls](SCROLL_MASK_COMBAT.json) cover 16 stationary/moving cases at zoom 0.5/1.13 on desktop 1440×900, scale 1, and mobile 390×844, scale 2. They use the existing frozen-simulation fixture with smoke, rail beams, frozen terrain and soft lights, pinned high density, soft shadows enabled, and no CPU throttle. All **96 exact pixel/mask checks** pass. Raw results retain CPU and consecutive-rAF interval p50/p95/p99. Each paired block has 21 measured frames; these scheduling intervals are not physical presentation measurements.

## Validation

- **667 tests across 92 files**, production type check/build, and the moving full-step profile mode passed.
- **4,348 scrolling mask/composite comparisons** passed with zero changed channels. The oracle exercised **1,168 scroll copies**, **48 zero-offset reuses**, **510 alignment rejections** and **four chunk-selection transitions**, including static cracked-glass panes.
- **2,032 stationary mask comparisons**, **260 lighting comparisons**, **2,118 incremental/full terrain comparisons**, and the existing raster-cache checks passed.
- All **36 primary growth and six repeat full-frame checks** match, with corresponding terrain-state/event/queue checks.
- All **16 combat controls** passed, including **96 pixel/mask checks**.

[Regression records](SCROLL_MASK_REGRESSIONS.json) retain the per-case results.

The scrolling oracle compares mask RGBA and composites against the archived renderer across device scales 0.75/1/1.25/1.5/2/3, zoom 0.5/1.13/default 2.5/2.75, both shadow settings, reversals, world edges, skipped updates, subpixel pans and chunk-selection changes. It asserts that copy, zero-offset reuse, alignment rejection and overflow fallback actually occur. Unit cases verify disjoint repaint regions and coverage of all exposed/dirty pixels under randomized shifts.

Mask-cache tests now count mask-state refreshes rather than assuming each camera change must perform exactly one terrain draw. Pixel comparisons still require the same output as full rebuilds.

## Reproduce

With Vite on port 5173, run timings sequentially without competing tests/builds:

```bash
BREACH_BASELINE_REF=6075132 BREACH_RATES=1,4 BREACH_CAMERAS=moving BREACH_ZOOMS=.5,1.13,2.5 BREACH_SAMPLES=100 node scripts/fast-growth-benchmark.cjs
BREACH_BASELINE_REF=6075132 BREACH_DEVICES=desktop BREACH_RATES=4 BREACH_CAMERAS=moving BREACH_ZOOMS=.5,2.5 BREACH_SAMPLES=200 node scripts/fast-growth-benchmark.cjs
BREACH_BASELINE_REF=6075132 BREACH_WORKLOADS=combined BREACH_SAMPLES=20 node scripts/render-active-benchmark.cjs
BREACH_PROFILE_MOVING=1 BREACH_PROFILE_FULL_STEP=1 BREACH_PROFILE_RATE=4 BREACH_PROFILE_ZOOM=.5 node scripts/fast-growth-profile.cjs
node scripts/scroll-mask-smoke.cjs
node scripts/opacity-region-smoke.cjs
BREACH_BASELINE_REF=6075132 node scripts/lighting-pipeline-smoke.cjs
node scripts/render-cache-smoke.cjs
npm test
npm run build
```
