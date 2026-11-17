# Bound lighting-mask rebuilds during Blight growth

Baseline: `28064e4`, including the preceding terrain/outline optimizations and incoming forest changes.

## Change

A stationary view previously cleared and repainted its entire terrain lighting mask whenever any visible chunk published an opacity change. The mask now retains unchanged pixels and rebuilds the device-pixel union of changed eight-cell opacity tiles. It redraws all terrain chunks intersecting that region, using the existing snapped chunk mapping and an integer device-pixel clip. The ambient source-in fill shares the clip, preserving pixels outside the update.

Tiles retain their latest publication revision across frames. Independent mask consumers can skip updates without losing earlier changes, and pending world edits do not enter a mask until their terrain chunk is built. Ordinary opaque HP damage retains its existing no-invalidation behavior; glass damage/cracking, destruction and growth update the appropriate tiles.

Camera, zoom, viewport, backing-size, device-scale, terrain-instance and ambient changes retain full mask rebuilds. Updates covering at least 65% of the screen retain the full-screen path. Revision overflow also falls back to a full rebuild. A changed tile wholly outside the screen can skip mask painting even when its chunk is visible. Mask-state invalidation still follows the original revision changes, preserving empty-lightmap cache history.

The added revision array is 64 bytes per 32-cell chunk: about 27.6 KiB across all 441 chunks in a 672×672 world. No new canvas, pixel buffer or per-event history list is introduced. Growth, collision, terrain rebuild scheduling, lighting brightness and render density are unchanged.

## Measurement method

The fresh exploratory growth-only profile recorded 11,603 successful growth events over 120 frames, with 0.5 ms median growth work, 4.2 ms terrain preparation and 13.6 ms rendering. Native image drawing dominated the samples. This unseeded profile identifies remaining rendering cost; it is not the paired speedup comparison.

The paired benchmark runs independent archived baseline/current games with the same seed and RNG state. It times actual Game.step(1/60), terrain updates, shadow preparation and complete rendering. Eight generator chambers are opened for sustained growth, one passive soldier is deployed, fog is revealed and simulation time starts at 80 seconds. Growth multipliers 1/4 are benchmark-only settings. Each case has 12 simulation warmup frames and 100 measured frames, with alternating evaluation order.

Stationary/moving cameras run at zoom 0.5/1.13. Desktop is 1000×700 at device scale 1; the mobile profile is 390×844 at scale 2 with 4× CPU throttling. Render density and lighting quality are pinned high, and soft shadows are disabled. Three checkpoints compare full-frame pixels and terrain-state hashes. Event totals and pending-chunk maxima must also agree.

Timings measure synchronous simulation/canvas CPU work on one cloud host, not physical-phone FPS or GPU presentation. Percentiles use upper-rank selection; p99 is the maximum observed sample at n=100. Moving cameras retain full mask redraws, so the targeted benefit is stationary growth. Full-resolution final lighting composites and other passes remain significant costs.

## Growth results

[Complete paired growth results](OPACITY_REGION_GROWTH.json) retain all 16 scenarios and stage p50/p95/p99. All **48 full-frame pixel checks** and **48 terrain-state checks** match; event totals and pending-chunk maxima also match in every case.

Median paired percentage change across both growth multipliers and both zooms:

| Device | Camera | Pipeline p50 | Pipeline p95 | Pipeline p99 |
| --- | --- | ---: | ---: | ---: |
| desktop | Stationary | -6.3% | +0.8% | -12.3% |
| desktop | Moving | -0.3% | +2.6% | +4.7% |
| mobile | Stationary | -17.6% | -17.1% | -20.1% |
| mobile | Moving | -4.3% | -8.3% | -14.4% |

Moving views intentionally use the original full-mask path. Their differences show run-to-run variation and the added revision bookkeeping; no moving-camera speedup is claimed. Individual regressions and outliers are retained.

| Device | Growth | Camera | Zoom | Baseline p50 / p95 / p99, ms | Updated p50 / p95 / p99, ms |
| --- | ---: | --- | ---: | --- | --- |
| desktop | 1 | Stationary | 0.5 | 15.9 / 22.3 / 29.6 | 13.4 / 21.3 / 25.2 |
| desktop | 1 | Stationary | 1.13 | 13.3 / 18.5 / 40.4 | 12.4 / 18.2 / 36.5 |
| desktop | 1 | Moving | 0.5 | 18.3 / 27.8 / 89.3 | 18.9 / 27.2 / 86.7 |
| desktop | 1 | Moving | 1.13 | 16.4 / 23.7 / 55.9 | 15.8 / 21.1 / 62.8 |
| desktop | 4 | Stationary | 0.5 | 19.4 / 27.4 / 125.6 | 18.4 / 28.3 / 89.8 |
| desktop | 4 | Stationary | 1.13 | 18.9 / 23.1 / 30.0 | 17.8 / 26.7 / 61.4 |
| desktop | 4 | Moving | 0.5 | 22.4 / 30.6 / 79.8 | 22.5 / 33.6 / 35.8 |
| desktop | 4 | Moving | 1.13 | 19.8 / 27.0 / 49.8 | 19.6 / 29.0 / 58.0 |
| mobile | 1 | Stationary | 0.5 | 96.0 / 137.7 / 182.7 | 76.2 / 109.3 / 196.9 |
| mobile | 1 | Stationary | 1.13 | 87.0 / 113.1 / 198.4 | 71.2 / 93.5 / 99.7 |
| mobile | 1 | Moving | 0.5 | 106.6 / 146.3 / 268.5 | 101.2 / 132.9 / 213.7 |
| mobile | 1 | Moving | 1.13 | 95.8 / 168.6 / 182.8 | 95.8 / 156.1 / 167.4 |
| mobile | 4 | Stationary | 0.5 | 102.3 / 146.8 / 175.7 | 84.9 / 122.1 / 167.0 |
| mobile | 4 | Stationary | 1.13 | 97.7 / 133.6 / 213.9 | 81.0 / 111.8 / 138.4 |
| mobile | 4 | Moving | 0.5 | 128.4 / 192.8 / 297.4 | 120.4 / 198.0 / 291.1 |
| mobile | 4 | Moving | 1.13 | 107.8 / 164.5 / 224.0 | 103.9 / 141.1 / 165.6 |

## Combat controls

[Full sparse/dense combat control results](OPACITY_REGION_COMBAT.json) record CPU submission and consecutive rAF-interval p50/p95/p99 for 16 cases, with 96 exact pixel/mask checks. These are paused synthetic combat scenes containing frozen terrain, smoke, crossing rail beams and soft lights. Ordinary opaque HP damage leaves opacity unchanged, so these controls exercise cache reuse and moving-view full rebuilds rather than growth-mask savings.

The existing harness pins high render density, uses soft shadows, and alternates paired blocks on one page, with 21 measured frames per variant. Desktop is 1440×900 at scale 1; mobile is 390×844 at scale 2. The combat controls use no CPU throttle. rAF intervals are scheduling observations, not independently attributable physical display/GPU presentation measurements.

| Device | Density | Camera | Zoom | CPU baseline p50 / p95 / p99, ms | CPU updated p50 / p95 / p99, ms |
| --- | --- | --- | ---: | --- | --- |
| desktop | Sparse | Stationary | 0.5 | 15.4 / 19.3 / 19.9 | 16.6 / 20.2 / 20.6 |
| desktop | Sparse | Stationary | 1.13 | 14.6 / 16.2 / 17.5 | 14.6 / 17.3 / 17.8 |
| desktop | Sparse | Moving | 0.5 | 21.8 / 24.5 / 24.9 | 22.6 / 27.2 / 28.8 |
| desktop | Sparse | Moving | 1.13 | 18.7 / 23.5 / 23.7 | 18.4 / 21.5 / 27.9 |
| desktop | Dense | Stationary | 0.5 | 35.1 / 38.7 / 50.9 | 34.5 / 38.1 / 39.4 |
| desktop | Dense | Stationary | 1.13 | 16.9 / 20.5 / 24.7 | 16.5 / 18.1 / 41.2 |
| desktop | Dense | Moving | 0.5 | 40.5 / 45.8 / 48.0 | 40.4 / 43.3 / 46.1 |
| desktop | Dense | Moving | 1.13 | 22.3 / 24.9 / 25.6 | 22.1 / 22.8 / 23.2 |
| mobile | Sparse | Stationary | 0.5 | 12.9 / 14.8 / 15.5 | 13.2 / 16.0 / 19.4 |
| mobile | Sparse | Stationary | 1.13 | 13.1 / 15.3 / 20.3 | 13.2 / 15.4 / 16.9 |
| mobile | Sparse | Moving | 0.5 | 18.7 / 21.0 / 22.2 | 19.3 / 22.1 / 39.1 |
| mobile | Sparse | Moving | 1.13 | 19.0 / 27.7 / 29.8 | 20.0 / 30.0 / 60.8 |
| mobile | Dense | Stationary | 0.5 | 15.8 / 21.1 / 38.7 | 15.5 / 19.0 / 31.2 |
| mobile | Dense | Stationary | 1.13 | 21.7 / 24.6 / 26.7 | 21.0 / 28.7 / 30.3 |
| mobile | Dense | Moving | 0.5 | 22.0 / 26.4 / 27.0 | 23.3 / 27.8 / 28.0 |
| mobile | Dense | Moving | 1.13 | 26.8 / 28.8 / 28.9 | 26.2 / 32.1 / 55.0 |

## Validation

- **651 tests across 89 files**, production type check/build, and existing raster-cache invalidation checks passed.
- **2,032 targeted mask/composite comparisons** passed with zero changed channels. The oracle exercised **696 partial updates** and **282 full updates**, and verified full repaint on revision overflow.
- **48 full-frame growth comparisons** and **48 terrain-state comparisons** matched; replication events and chunk queues matched.
- **260 existing lighting comparisons** and **2,118 incremental/full terrain comparisons** passed with zero changed channels.
- All **16 sparse/dense combat controls** passed, including **96 exact pixel/mask checks**.

[Raw regression results](OPACITY_REGION_REGRESSIONS.json) retain the per-case evidence.

The targeted browser oracle compares mask pixels and complete composites against the archived full-rebuild renderer. It covers scales 0.75/1/1.25/1.5/2/3, zoom 0.5/1.13/2.75, both shadow settings, glass damage/cracking, destruction, subcells, world edges, resizing, regeneration, independent consumers skipping three frames, unlit-cache history, offscreen tiles inside visible chunks and revision overflow. It asserts actual partial/full updates, no mask repaint for opaque HP damage or fully offscreen tile edits, and the full fallback after revision overflow.

## Reproduce

With Vite running on port 5173, run timing workloads sequentially without competing tests/builds:

```bash
BREACH_BASELINE_REF=28064e4 BREACH_RATES=1,4 BREACH_SAMPLES=100 node scripts/fast-growth-benchmark.cjs
BREACH_BASELINE_REF=28064e4 BREACH_WORKLOADS=combined BREACH_SAMPLES=20 node scripts/render-active-benchmark.cjs
BREACH_BASELINE_REF=28064e4 node scripts/opacity-region-smoke.cjs
BREACH_BASELINE_REF=28064e4 node scripts/lighting-pipeline-smoke.cjs
node scripts/render-cache-smoke.cjs
node scripts/terrain-partial-repaint-smoke.cjs
npm test
npm run build
```
