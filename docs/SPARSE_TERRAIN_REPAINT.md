# Sparse terrain repaints during Blight replication

Baseline: `03ae05d` (the preceding rendering optimization commit on main).

Terrain chunks previously repainted every cell inside the enclosing rectangle of queued edits. Distant growth spots therefore regenerated and uploaded unchanged terrain between them. A half-size edit also invalidated all eight neighboring parent cells for albedo, even though fine-cell surface shading only reads cardinal neighbors.

The renderer now retains artwork dirtiness in two-cell tiles, reusing `ChunkRegions` to upload separated horizontal runs. Updates covering at least half the enclosing rectangle use the existing single-rectangle path. Full-size edits retain their conservative relief neighborhood. Fine-cell edits repaint their parent and the two possible face-sharing parents; nonlethal fine-cell damage repaints its parent alone. Geometry, diagonal edge masks, opacity invalidation, publication order and chunk budgets keep their previous conservative bounds.

Each region regenerates all its texels before uploading the shared scratch image. Blight albedo/classification is published for the same region. Outline and live/dormant edge caches update once per chunk after all artwork regions. Regeneration marks every tile; queued chunks retain their tiles until publication. This adds approximately 110 KiB of tile flags for the 672×672 map, plus a reusable 4 KiB rectangle buffer, without another image or canvas per chunk.

## Measurement method

Paired archived-baseline/current Chromium runs alternate execution order, pin high render density, reset game RNGs, and compare both terrain state and full-frame pixels. Primary cases cover sparse, fast and stress replication, stationary/moving cameras, zoom 0.5/1.13, desktop 1000×700 at DPR 1, and mobile 390×844 at DPR 2 with 4× CPU throttling. Timed work includes one real fixed simulation step, terrain update, shadow preparation and drawing. Twelve simulation frames precede measurement. Three full-frame/state checkpoints are compared per case.

The additional late-run cases stage a 600-second run and 600 seconds of overdrive, with soft shadows enabled, desktop DPR 1, default zoom 2.5 and zoomed-out 0.5. They compare every frame. A sealed fine-rubble fixture chamber protects the passive soldier without creating another full-wall replication source. This stages growth clocks; it does not pre-grow a mature colony for 600 seconds. At DPR 1, pinned high density is the same density as initial default Auto quality; adaptive quality changes are excluded from this paired measurement.

These are browser CPU-work measurements on this host, not physical mobile GPU or presentation/FPS measurements. The actual game may perform several fixed simulation steps per displayed frame. Tail percentiles from short runs remain sensitive to scheduling and collection; raw p50/p95/p99 are retained. This change reduces terrain preparation and upload work; it does not eliminate the remaining canvas-drawing cost or all lag.

## Primary results

[Raw growth results](SPARSE_TERRAIN_GROWTH.json) retain all 24 cases and per-phase percentiles. Each variant has 60 measured frames per case. All 72 full-frame checks and 72 corresponding terrain-state checks match, including event counts and pending chunk counts. Sparse-growth controls have largely unchanged median frame work; they remain in the raw results.

Fast/stress cases below show total CPU work as p50 / p95 / p99 in milliseconds. Tail results are mixed, including regressions; this is not a claim of uniformly faster frames.

| Device | Growth multiplier | Camera | Zoom | Baseline | Updated |
| --- | ---: | --- | ---: | --- | --- |
| desktop | 1 | stationary | 0.5 | 16.5 / 23.7 / 40.2 | 15.3 / 22.5 / 33.8 |
| desktop | 1 | stationary | 1.13 | 12.2 / 16.1 / 28.1 | 11.5 / 16.3 / 57.7 |
| desktop | 1 | moving | 0.5 | 19.4 / 30.2 / 53.3 | 18.9 / 31.2 / 82.9 |
| desktop | 1 | moving | 1.13 | 16.4 / 26.9 / 42.8 | 14.9 / 20.3 / 25.7 |
| desktop | 4 | stationary | 0.5 | 18.2 / 21.6 / 26.1 | 16.3 / 21.8 / 23.5 |
| desktop | 4 | stationary | 1.13 | 15.2 / 20.3 / 25.3 | 13.2 / 23.5 / 33.9 |
| desktop | 4 | moving | 0.5 | 22.4 / 45.9 / 102.7 | 20.0 / 26.0 / 35.3 |
| desktop | 4 | moving | 1.13 | 19.4 / 34.1 / 88.9 | 17.5 / 23.8 / 34.4 |
| mobile | 1 | stationary | 0.5 | 87.3 / 167.7 / 223.2 | 79.9 / 111.6 / 118.6 |
| mobile | 1 | stationary | 1.13 | 64.2 / 93.5 / 112.6 | 63.2 / 88.9 / 111.2 |
| mobile | 1 | moving | 0.5 | 93.7 / 133.7 / 171.0 | 91.5 / 123.7 / 154.4 |
| mobile | 1 | moving | 1.13 | 115.6 / 168.5 / 192.2 | 102.5 / 166.6 / 168.3 |
| mobile | 4 | stationary | 0.5 | 86.3 / 154.9 / 208.0 | 77.4 / 110.2 / 174.8 |
| mobile | 4 | stationary | 1.13 | 75.4 / 91.2 / 92.6 | 66.3 / 80.7 / 103.0 |
| mobile | 4 | moving | 0.5 | 97.1 / 125.8 / 155.8 | 85.6 / 113.1 / 145.6 |
| mobile | 4 | moving | 1.13 | 123.9 / 202.9 / 244.2 | 107.5 / 161.1 / 204.5 |

At stress growth, median terrain-update work drops about 20–29% across the eight cases, and median total frame work drops about 10–13%. This compares against the preceding optimization, rather than the original unoptimized build.

## Late-run desktop results

[Raw late-run results](SPARSE_TERRAIN_LATE_GROWTH.json) use 120 measured frames per variant and compare all 132 frames including warm-up. All **528 full-frame/state comparisons** match exactly. Each case executes 60,744 successful replication events per measured variant, at a final generator rate of about 2,879.

| Camera | Zoom | Baseline p50 / p95 / p99, ms | Updated p50 / p95 / p99, ms |
| --- | ---: | --- | --- |
| stationary | 0.5 | 25.9 / 35.9 / 39.5 | 22.9 / 36.8 / 41.5 |
| stationary | 2.5 | 22.0 / 30.9 / 38.8 | 19.1 / 28.3 / 39.4 |
| moving | 0.5 | 30.4 / 46.4 / 65.9 | 27.0 / 38.9 / 63.0 |
| moving | 2.5 | 24.4 / 34.4 / 41.3 | 20.2 / 30.8 / 50.6 |

At default zoom, median terrain work falls from 8.4 to 5.3 ms stationary and 8.2 to 5.3 ms moving (about 35–37%). Median total work falls from 22.0 to 19.1 ms stationary and 24.4 to 20.2 ms moving (about 13–17%). The moving default-zoom p99 worsens from 41.3 to 50.6 ms; spikes are not resolved. Actual integrated-GPU hardware and an organically grown end-of-run map remain unmeasured.

## Combat controls

[Raw combat results](SPARSE_TERRAIN_COMBAT.json) cover 16 sparse/dense, stationary/moving cases at zoom 0.5/1.13 on desktop 1200×800 at DPR 1 and throttled mobile 390×844 at DPR 2, with soft shadows enabled. They include muzzle flashes, soldiers, dense fire, and one or 32 fine-cell growth/destruction edits per frame. Each variant has 30 measured frames per case, with simulation and shadow preparation shared outside the timing. All 32 full-frame pixel comparisons match.

Combat timing results are mixed: desktop medians range from about 7% faster to 4% slower, and mobile medians from about 3% faster to 7% slower. Several p95/p99 cases regress. These controls do not establish a general combat speedup; rapid replication is the validated target.

## Validation

**672 tests across 92 files**, type checking and the production build pass. [Regression records](SPARSE_TERRAIN_REGRESSIONS.json) retain **2,762 exact terrain/oracle comparisons**, with zero changed channels.

The terrain oracle compares sparse publication with forced full-chunk repaints through fine-cell growth/removal at seams, all four subcell orientations, separated edit islands, destruction, HP damage, glass/crystal artwork, dormancy changes, regeneration, partial world chunks, and final composites at device scales 0.75/1/1.25/1.5/2/3 and zoom 0.5/1.13/2.5/2.75. It asserts that multiple sparse regions actually publish, and that HP-only hits retain the existing zero-classification path.

Global offscreen chunk/floor publication and the remaining Canvas composites still warrant profiling on an actual late-run save. This pass retains existing publication order and budgets.

## Reproduce

Run Vite on port 5173, then run timing commands sequentially without competing tests/builds:

```bash
BREACH_BASELINE_REF=03ae05d BREACH_RATES=.05,1,4 BREACH_CAMERAS=stationary,moving BREACH_ZOOMS=.5,1.13 BREACH_SAMPLES=60 node scripts/fast-growth-benchmark.cjs
BREACH_BASELINE_REF=03ae05d BREACH_DEVICES=desktop BREACH_RATES=4 BREACH_CAMERAS=stationary,moving BREACH_ZOOMS=.5,2.5 BREACH_SAMPLES=120 BREACH_RUN_SECONDS=600 BREACH_OVERDRIVE_SECONDS=600 BREACH_SOFT_SHADOWS=1 BREACH_ALL_PIXELS=1 node scripts/fast-growth-benchmark.cjs
BREACH_BASELINE_REF=03ae05d node scripts/terrain-frame-benchmark.cjs
node scripts/terrain-partial-repaint-smoke.cjs
npm test
npm run build
```

## Viewport-scoped updates

The Pixel 9a capture at 35 seconds showed 24 rebuilds per frame and a median 5.6 ms in terrain updates. Gameplay now publishes dirty chunks and floor shadows only when the upcoming camera view samples them. Off-screen changes stay queued and coalesce. Map thumbnails publish their own sampled area on demand. Wide views retain the 24-chunk budget. The exported `visibleTerrainChunksPending` counter separates redraws waiting inside the view from the total dirty queue.

Paired Chromium measurements against `9115d3c` used default zoom 2.5, 60 measured samples per variant, three fixed simulation steps per draw and a staged growth burst averaging 375 updates per frame. Both versions reached identical terrain state at all measured checkpoints.

| View | Terrain CPU p50 / p95 / p99 before → after, ms | Frame CPU p50 / p95 / p99 before → after, ms |
| --- | --- | --- |
| Desktop stationary | 9.0 / 22.6 / 33.8 → 1.3 / 6.6 / 7.5 | 27.7 / 50.8 / 83.3 → 17.8 / 43.4 / 82.5 |
| Desktop moving | 7.1 / 10.2 / 12.1 → 1.1 / 2.5 / 4.8 | 21.0 / 34.7 / 117.2 → 16.5 / 24.8 / 133.8 |
| Mobile stationary, DPR 2 and 4× CPU throttling | 38.5 / 54.9 / 161.6 → 3.2 / 4.7 / 5.7 | 122.8 / 211.2 / 258.2 → 82.7 / 142.2 / 187.0 |

Median rebuild counts went from 24 to 4 on desktop and 24 to 2 in the stationary mobile case. The visible backlog stayed at zero. Six of nine frame checkpoint hashes differed from the old queue order, which can display stale visible chunks. All 13 viewport and thumbnail pixel comparisons against a forced full repaint matched, including cracked glass, floor shadows, panning, zoom and fractional render density. The moving mobile timing is omitted because other checks were running. These measurements cover CPU work in the benchmark and don't establish a Pixel 9a frame rate.

To reproduce, run Vite on port 5173 and execute:

```bash
BREACH_BASELINE_REF=9115d3c BREACH_VIEWPORT_UPDATES=1 BREACH_FIXED_STEPS=3 BREACH_RUN_SECONDS=35 BREACH_RATES=2 BREACH_ZOOMS=2.5 BREACH_SAMPLES=60 node scripts/fast-growth-benchmark.cjs
node scripts/terrain-partial-repaint-smoke.cjs
```
