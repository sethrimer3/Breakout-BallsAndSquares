# Reduce terrain work during active Blight replication

Initial baseline: `915161c`. This pass targets real generator growth, including the simulation and terrain preparation before the draw call. It does not reduce growth rates, cap replication, defer terrain visibility, or change collision rules.

## Integration with main

Main advanced to `545bda3` during validation. Its later-world materials, campaign changes and pixel-art effects were merged without conflicts. The floor optimization remains valid for the new material path: floor colors depend on environment, coordinates, decor and full-size wall health, rather than subcell occupancy. The initial 24-case measurements below precede that integration; a separate fast-growth comparison checks the final merged source against `545bda3`.

The final comparison against `545bda3` covers 16 fast-growth scenarios (multipliers 1/4, both cameras, both zooms and both device profiles), with 40 samples each. All **48 full-frame pixel checks** and **48 world-state checks** match. Replication event counts and chunk backlogs match in every case. [Final merged measurements](FAST_GROWTH_INTEGRATED.json) include the complete stage timings.

| Device | Growth multiplier | Pipeline p50 | Pipeline p95 | Pipeline p99 | Terrain p50 |
| --- | ---: | ---: | ---: | ---: | ---: |
| desktop | 1 | -19.6% | -14.1% | -15.7% | -41.1% |
| desktop | 4 | -18.8% | -4.7% | -27.3% | -35.2% |
| mobile | 1 | -21.9% | -17.6% | -6.8% | -41.6% |
| mobile | 4 | -21.0% | +10.9% | -4.5% | -35.7% |

Percentage changes are medians of the paired changes across camera/zoom cases. Every fast-growth scenario improves pipeline p50; individual tail regressions remain in the raw data.

| Device | Growth | Camera | Zoom | Baseline p50 / p95 / p99, ms | Updated p50 / p95 / p99, ms |
| --- | ---: | --- | ---: | --- | --- |
| desktop | 1 | Stationary | 0.5 | 23.2 / 32.8 / 33.7 | 17.3 / 24.8 / 28.6 |
| desktop | 1 | Stationary | 1.13 | 20.1 / 27.0 / 63.7 | 14.9 / 30.7 / 53.3 |
| desktop | 1 | Moving | 0.5 | 23.6 / 31.1 / 38.6 | 20.5 / 29.9 / 66.3 |
| desktop | 1 | Moving | 1.13 | 20.2 / 33.7 / 34.4 | 17.4 / 23.3 / 28.6 |
| desktop | 4 | Stationary | 0.5 | 25.5 / 41.1 / 53.6 | 20.5 / 35.1 / 38.0 |
| desktop | 4 | Stationary | 1.13 | 23.8 / 32.7 / 73.2 | 19.5 / 39.1 / 52.4 |
| desktop | 4 | Moving | 0.5 | 25.5 / 29.3 / 31.6 | 21.0 / 30.8 / 45.2 |
| desktop | 4 | Moving | 1.13 | 24.1 / 30.5 / 39.4 | 19.1 / 26.1 / 29.1 |
| mobile | 1 | Stationary | 0.5 | 118.0 / 147.8 / 212.6 | 87.3 / 117.7 / 120.6 |
| mobile | 1 | Stationary | 1.13 | 112.5 / 166.4 / 176.7 | 83.4 / 141.7 / 197.8 |
| mobile | 1 | Moving | 0.5 | 121.5 / 187.2 / 224.2 | 104.6 / 164.6 / 188.9 |
| mobile | 1 | Moving | 1.13 | 126.4 / 161.6 / 167.1 | 103.8 / 128.0 / 170.6 |
| mobile | 4 | Stationary | 0.5 | 144.2 / 169.0 / 287.9 | 112.4 / 192.0 / 208.7 |
| mobile | 4 | Stationary | 1.13 | 139.8 / 180.4 / 190.9 | 108.2 / 177.8 / 219.9 |
| mobile | 4 | Moving | 0.5 | 157.9 / 225.5 / 335.4 | 132.9 / 249.3 / 254.2 |
| mobile | 4 | Moving | 1.13 | 147.6 / 244.7 / 262.3 | 118.3 / 272.4 / 316.9 |

### Longer mobile stress repeat

The 40-frame mobile stress tails varied between runs, so the final merged source was checked again against `545bda3` with **100 measured frames per view**, after the same 12 warmup frames. Across the four stationary/moving and zoom combinations, median paired pipeline changes are **-18.4% p50, -17.6% p95 and -19.6% p99**. All 12 full-frame and 12 world-state comparisons match. [Complete repeat data](FAST_GROWTH_MOBILE_REPEAT.json) retain each stage and event count. This longer run evolves farther into replication than the original 40-frame fixture; compare each variant within its own run.

| Camera | Zoom | Baseline p50 / p95 / p99, ms | Updated p50 / p95 / p99, ms |
| --- | ---: | --- | --- |
| Stationary | 0.5 | 146.5 / 188.0 / 245.0 | 114.5 / 155.3 / 241.8 |
| Stationary | 1.13 | 133.9 / 191.9 / 311.6 | 102.3 / 137.1 / 180.4 |
| Moving | 0.5 | 144.6 / 217.2 / 339.0 | 125.1 / 178.4 / 229.7 |
| Moving | 1.13 | 141.1 / 204.7 / 296.4 | 120.1 / 195.7 / 275.8 |

## Changes

- Subcell notifications carry optional fine-grid coordinates. Colony bookkeeping refreshes only the changed subcell and its four cardinal neighbors, preserving the old row-major order. Whole-cell changes retain their broader refresh; HP-only hits skip topology work.
- Floor contact shadows depend on full-size block health. Half-size growth and destruction no longer repaint these unchanged shadows or invalidate the floor viewport cache. Whole-cell destruction and growth still refresh nearby floor shading.
- Live and dormant Blight edge masks update only the existing dirty cell rectangle, including its neighbor padding. Packed bits retain the unchanged mask, and canvas uploads cover only edited pixels. Unchanged masks keep their revision. Partial world-edge chunks retain full recomputation to preserve border conventions.

The persistent mask state uses 2 KiB per active layer in a 32-cell chunk, allocated lazily and released when empty. At most two layers across all 441 chunks of a 672-cell world would require about 1.72 MiB, plus small bookkeeping objects. No additional world-sized canvas is introduced.

## Measurements

The initial exploratory Chrome CPU profile recorded 11,437 actual growth events over 120 frames. Median terrain preparation was 8.6 ms, compared with 0.6 ms for GrowthSystem itself. Edge classification, polygon construction, mask uploads and repeated floor work were visible costs. That profile used a different, unseeded fixture; it identifies hotspots and is not a paired speedup measurement.

The paired benchmark below uses independent baseline and updated game instances with the same seed and RNG state. It runs actual `Game.step(1/60)`, terrain updates, shadow preparation and the complete renderer. Eight generator chambers are opened to allow sustained replication, with one passive deployed soldier. Render density and lighting quality are pinned high, soft shadows disabled, and fog revealed. The simulation clock starts at 80 seconds. Slow/normal/stress growth multipliers are 0.05/1/4; these are benchmark settings only.

Each scenario warms up with 12 simulation frames, then records 40 frames. Evaluation order alternates. Stationary/moving cameras run at zoom 0.5/1.13. Desktop is 1000×700 at device scale 1; the mobile profile is 390×844 at scale 2 with 4× CPU throttling. Three checkpoints per scenario compare hashes of health, subcell health/tint, terrain tint/material, Blight flags, glass cracks and full-frame pixels, with identical draw clocks. The harness rejects dead-soldier fixtures and insufficient successful growth in fast cases.

These timings measure synchronous simulation and canvas submission on one cloud host. They are not physical phone FPS or GPU presentation times. With 40 samples, p99 is the maximum observation. Individual regressions and outliers are retained in the raw results.

[Raw paired results](FAST_GROWTH_RENDERING.json) retain all 24 scenarios and their stage timings. All **72 full-frame pixel checks** and **72 world-state checks** matched. Successful replication counts and maximum pending chunk counts also match in every scenario.

Median paired percentage change across both camera modes and both zooms:

| Device | Growth multiplier | Pipeline p50 | Pipeline p95 | Pipeline p99 | Terrain p50 |
| --- | ---: | ---: | ---: | ---: | ---: |
| desktop | 0.05 | -5.4% | -12.4% | -54.2% | 0 ms in both |
| desktop | 1 | -18.1% | -6.6% | +10.5% | -39.1% |
| desktop | 4 | -16.7% | -18.7% | -61.9% | -36.2% |
| mobile | 0.05 | -4.3% | +5.7% | -12.6% | 0 ms in both |
| mobile | 1 | -22.2% | -23.7% | -25.2% | -40.4% |
| mobile | 4 | -19.7% | -16.4% | -23.3% | -34.8% |

Fast replication (multipliers 1 and 4) improves median pipeline work in every paired scenario. Sparse-growth moving mobile cases still contain worse tail timings; normal-growth desktop p99 is also noisy. This is a reduction in repeated terrain work, not a claim that all frame-time spikes are fixed.

| Device | Growth | Camera | Zoom | Baseline p50 / p95 / p99, ms | Updated p50 / p95 / p99, ms |
| --- | ---: | --- | ---: | --- | --- |
| desktop | 0.05 | Stationary | 0.5 | 12.3 / 33.4 / 35.1 | 11.3 / 29.3 / 30.2 |
| desktop | 0.05 | Stationary | 1.13 | 6.4 / 18.3 / 35.5 | 5.8 / 16.0 / 20.7 |
| desktop | 0.05 | Moving | 0.5 | 15.1 / 29.5 / 115.7 | 14.7 / 25.9 / 27.7 |
| desktop | 0.05 | Moving | 1.13 | 9.1 / 20.4 / 60.7 | 9.6 / 14.8 / 20.2 |
| desktop | 1 | Stationary | 0.5 | 21.7 / 31.0 / 33.0 | 16.8 / 32.9 / 63.0 |
| desktop | 1 | Stationary | 1.13 | 19.2 / 24.8 / 30.6 | 15.2 / 19.9 / 20.2 |
| desktop | 1 | Moving | 0.5 | 24.0 / 30.2 / 34.5 | 20.3 / 29.3 / 46.3 |
| desktop | 1 | Moving | 1.13 | 22.0 / 30.2 / 38.1 | 19.4 / 27.1 / 33.1 |
| desktop | 4 | Stationary | 0.5 | 25.7 / 33.8 / 94.4 | 21.4 / 31.3 / 32.9 |
| desktop | 4 | Stationary | 1.13 | 23.4 / 34.7 / 54.3 | 19.5 / 27.5 / 27.6 |
| desktop | 4 | Moving | 0.5 | 24.8 / 34.2 / 74.7 | 21.3 / 28.5 / 28.7 |
| desktop | 4 | Moving | 1.13 | 22.3 / 27.9 / 59.4 | 17.8 / 21.4 / 22.4 |
| mobile | 0.05 | Stationary | 0.5 | 40.9 / 153.5 / 221.8 | 40.7 / 103.7 / 106.9 |
| mobile | 0.05 | Stationary | 1.13 | 36.0 / 123.0 / 134.5 | 36.7 / 95.8 / 105.8 |
| mobile | 0.05 | Moving | 0.5 | 79.6 / 132.6 / 137.8 | 73.2 / 191.3 / 197.5 |
| mobile | 0.05 | Moving | 1.13 | 86.9 / 146.7 / 210.3 | 79.7 / 196.0 / 202.3 |
| mobile | 1 | Stationary | 0.5 | 137.8 / 206.2 / 207.0 | 106.3 / 202.5 / 237.4 |
| mobile | 1 | Stationary | 1.13 | 122.5 / 166.1 / 203.7 | 94.2 / 114.7 / 134.8 |
| mobile | 1 | Moving | 0.5 | 124.6 / 192.1 / 256.0 | 112.7 / 134.6 / 170.5 |
| mobile | 1 | Moving | 1.13 | 131.0 / 194.8 / 213.4 | 102.9 / 160.8 / 177.2 |
| mobile | 4 | Stationary | 0.5 | 147.9 / 191.5 / 200.3 | 120.2 / 160.6 / 169.9 |
| mobile | 4 | Stationary | 1.13 | 152.0 / 179.8 / 180.0 | 116.1 / 184.9 / 201.4 |
| mobile | 4 | Moving | 0.5 | 146.9 / 208.1 / 226.9 | 116.6 / 151.7 / 155.5 |
| mobile | 4 | Moving | 1.13 | 137.6 / 177.1 / 251.1 | 121.1 / 147.5 / 147.8 |

## Remaining cost

This does not make the high-resolution throttled mobile profile smooth. Full-frame lighting composites, moving-camera raster work, full-chunk surface-outline construction and terrain uploads remain significant. Multiple simulation catch-up steps, HUD/input work, and browser presentation can add cost outside this one-step pipeline fixture. Those costs need further targeted profiles rather than treating fewer neighbor checks as a complete lag fix.

## Validation

- Final merged build: **638 tests across 88 files** and production type check/build passed (619 tests before integration).
- 2,118 incremental/full-rebuild terrain, floor, mask and composite comparisons matched exactly.
- Before integration, all 16 live/dormant baseline comparison scenarios passed with zero changed channels.
- Final merged build: **260 lighting/floor comparisons** across all five worlds and **80 existing active-render checks** passed (258 lighting checks before integration).
- 12 targeted HP-only geometry/cache pixel checks passed.

[Raw regression records](FAST_GROWTH_REGRESSIONS.json) retain the per-case results.

Regional edge-mask unit tests compare 400 randomized edits per filter mode against complete recomputation, including cross-chunk neighbors. Colony tests compare 500 randomized edits against broad parent-cell notifications, checking membership, ordered edge lists, activity and visual callbacks. Browser checks compare incremental terrain, floor shading, live/dormant masks and final composites against full rebuilds across seams, world edges, damage, dormancy, emptying, regrowth, fractional zoom and device scales 1/1.25/2.

## Reproduce

With Vite running on port 5173, run timing workloads sequentially without competing tests/builds:

```bash
npm test
npm run build
node scripts/terrain-partial-repaint-smoke.cjs
BREACH_BASELINE_REF=915161c node scripts/fast-growth-benchmark.cjs
BREACH_BASELINE_REF=545bda3 BREACH_RATES=1,4 node scripts/fast-growth-benchmark.cjs
BREACH_BASELINE_REF=545bda3 BREACH_DEVICES=mobile BREACH_RATES=4 BREACH_SAMPLES=100 node scripts/fast-growth-benchmark.cjs
BREACH_BASELINE_REF=545bda3 BREACH_DORMANT=1 node scripts/blight-render-benchmark.cjs
BREACH_BASELINE_REF=545bda3 node scripts/lighting-pipeline-smoke.cjs
BREACH_BASELINE_REF=545bda3 BREACH_CHECK_ONLY=1 node scripts/render-active-benchmark.cjs
```

The active-growth benchmark accepts `BREACH_REPORT`, `BREACH_SAMPLES`, `BREACH_DEVICES` and `BREACH_RATES`. Temporary baseline archives are removed after each run. `scripts/fast-growth-profile.cjs` additionally captures a growth-only CPU profile for diagnosis.
