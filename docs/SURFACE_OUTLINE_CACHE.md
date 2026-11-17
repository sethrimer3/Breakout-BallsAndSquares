# Incremental surface geometry and automatic quality fallback

Main measurement baseline: `fc7b670`; final integration baseline: `c5a95c1`. Main advanced during validation; the latest Overcharge and later-world changes were merged before the final checks.

## Changes

Terrain builds now retain one byte of exposed-face/corner flags per affected subcell. Updates sample the existing dirty rectangle plus its neighbor padding, instead of querying solidity across the entire chunk. Unchanged flags preserve the existing outline path. Changed paths are built during terrain preparation, in the same phase as the baseline, emitting the original row-major rectangle sequence with identical coordinates and winding. Drawing, chunk scheduling, albedo, opacity revisions, Blight masks, growth rates and collision rules retain their existing behavior.

Empty geometry releases its byte array and path. Partial edge chunks preserve the original outside-world solid boundary. The added flag buffer is at most 4 KiB per 32-cell chunk with exposed geometry, or about 1.72 MiB if every chunk in a 672×672 world has outlines; actual usage is sparse. No canvas or screen-sized buffer is added.

The automatic quality governor also stopped when its next cap mapped to the same native resolution. A DPR-1 display at cap 2 would stop at cap 1.5, never reaching the available 0.75 step. It now skips caps that cannot lower effective density, and remembers the exact original index for rollback if a reduction does not help. Fixed low/medium/high settings retain their existing mapping. Pinned-high image comparisons are unaffected by this fix; automatic mode can intentionally select fewer backing pixels as originally designed.

## Profile and rejected deferral

The initial exploratory profile recorded 11,515 real replication events over 120 frames. Terrain preparation still took 5.2 ms at the median. Outline tracing, rectangle construction and solidity queries together accounted for about 331 ms of sampled CPU time. Native image composites remained the largest rendering cost. That unseeded growth-only profile identifies a hotspot; the final paired benchmark is the performance comparison.

Offscreen-path deferral was also tested. It reduced medians, but desktop p99 worsened in the measured runs, including a 100-frame repeat. A version that prepared previously visible paths early also retained tail regressions. The final source keeps the original eager path-construction phase and reduces the underlying geometry work. [Experimental measurements](SURFACE_OUTLINE_EXPERIMENTS.json) retain these superseded variants, including their regressions; their timings do not describe the final implementation.

## Measurement method

The existing fast-growth benchmark runs independent archived baseline and current game instances with the same seed and RNG state. It times real Game.step(1/60), terrain updates, shadow preparation and the complete renderer. It opens chambers around eight generators, deploys one passive soldier, reveals fog and starts the simulation clock at 80 seconds. Growth multipliers 1/4 provide normal-fast and stress replication fixtures; these are benchmark-only settings.

Each final scenario has 12 simulation warmup frames and 100 measured frames, with alternating evaluation order. Stationary/moving cameras use zoom 0.5/1.13. Desktop is 1000×700 at device scale 1; mobile is 390×844 at scale 2 with 4× CPU throttling. Render density and lighting quality are pinned high and soft shadows disabled. Three checkpoints compare terrain-state hashes and complete frame pixels with identical draw clocks. Successful replication counts and pending-chunk counts must also agree.

Timings are synchronous simulation/canvas CPU work on one cloud host, not physical-phone FPS or GPU presentation times. Percentiles use the upper-rank selection; p99 is the maximum sample with 100 observations. Full-frame lighting and moving-camera raster work remain significant; this pass does not claim to eliminate mobile lag or all frame-time spikes.

## Final results

[Complete final paired results](SURFACE_OUTLINE_BENCHMARK.json) retain all 16 scenarios and per-stage p50/p95/p99. All **48 full-frame pixel comparisons** and **48 terrain-state comparisons** match. Replication event totals and pending-chunk maxima match in every case.

Median paired percentage change across camera modes and zooms:

| Device | Growth multiplier | Pipeline p50 | Pipeline p95 | Pipeline p99 |
| --- | ---: | ---: | ---: | ---: |
| desktop | 1 | -4.7% | +6.8% | +27.5% |
| desktop | 4 | -8.3% | -4.2% | -24.5% |
| mobile | 1 | -6.6% | -5.2% | -7.8% |
| mobile | 4 | -5.6% | +3.3% | +1.7% |

The final cache reduces median pipeline work. Tail results remain mixed; no general p95/p99 improvement is claimed. These measurements do not quantify the automatic-quality fallback, whose backing resolution can intentionally differ.

| Device | Growth | Camera | Zoom | Baseline p50 / p95 / p99, ms | Updated p50 / p95 / p99, ms |
| --- | ---: | --- | ---: | --- | --- |
| desktop | 1 | Stationary | 0.5 | 17.6 / 22.8 / 28.2 | 17.0 / 27.3 / 43.9 |
| desktop | 1 | Stationary | 1.13 | 15.1 / 19.1 / 27.6 | 13.1 / 18.2 / 35.7 |
| desktop | 1 | Moving | 0.5 | 19.3 / 26.2 / 60.7 | 18.8 / 29.1 / 43.0 |
| desktop | 1 | Moving | 1.13 | 16.5 / 19.8 / 26.2 | 15.5 / 20.3 / 32.9 |
| desktop | 4 | Stationary | 0.5 | 21.5 / 27.7 / 72.3 | 19.2 / 25.8 / 48.2 |
| desktop | 4 | Stationary | 1.13 | 23.6 / 39.9 / 70.8 | 22.9 / 36.6 / 59.7 |
| desktop | 4 | Moving | 0.5 | 30.8 / 55.5 / 65.0 | 28.8 / 60.7 / 182.0 |
| desktop | 4 | Moving | 1.13 | 22.8 / 34.0 / 72.9 | 20.5 / 33.5 / 44.0 |
| mobile | 1 | Stationary | 0.5 | 97.8 / 125.3 / 166.2 | 90.2 / 121.1 / 133.5 |
| mobile | 1 | Stationary | 1.13 | 99.3 / 129.4 / 187.9 | 94.0 / 121.5 / 174.4 |
| mobile | 1 | Moving | 0.5 | 123.2 / 272.5 / 321.1 | 111.9 / 220.5 / 293.9 |
| mobile | 1 | Moving | 1.13 | 110.7 / 136.3 / 148.2 | 105.6 / 130.5 / 153.6 |
| mobile | 4 | Stationary | 0.5 | 122.4 / 167.4 / 229.2 | 112.2 / 152.5 / 227.9 |
| mobile | 4 | Stationary | 1.13 | 123.0 / 196.1 / 251.6 | 116.0 / 224.9 / 306.2 |
| mobile | 4 | Moving | 0.5 | 128.6 / 155.0 / 195.7 | 124.0 / 167.1 / 203.3 |
| mobile | 4 | Moving | 1.13 | 130.4 / 215.6 / 310.1 | 123.2 / 213.0 / 262.3 |

## Final integration

An additional incoming map/spawn update, `c5a95c1`, was merged after the 16-case measurements. The optimized source files are unchanged. The merged build passes 651 tests and production type check/build; all 327 targeted outline and 260 lighting comparisons pass against this latest baseline. A separate 100-frame desktop stress check covers both zooms and camera modes: **-4.8% p50, +1.2% p95, +33.0% p99** in median paired changes. All 12 full-frame/12 terrain-state checks match, along with event and chunk counts. [Integration results](SURFACE_OUTLINE_INTEGRATION.json) retain the complete records.

| Camera | Zoom | Baseline p50 / p95 / p99, ms | Updated p50 / p95 / p99, ms |
| --- | ---: | --- | --- |
| Stationary | 0.5 | 20.5 / 28.0 / 33.8 | 19.5 / 30.0 / 34.2 |
| Stationary | 1.13 | 17.2 / 21.9 / 26.1 | 16.4 / 23.4 / 38.4 |
| Moving | 0.5 | 22.9 / 32.1 / 109.2 | 22.5 / 30.7 / 129.9 |
| Moving | 1.13 | 19.8 / 24.1 / 30.4 | 18.4 / 22.9 / 73.0 |

## Validation

- **651 tests across 89 files** and production type check/build passed on the final source.
- **327 targeted outline comparisons**, including queued chunks and camera jumps, match exactly.
- **2,118 incremental/full terrain, floor, mask and composite comparisons** match exactly.
- **260 lighting comparisons across all five worlds**, **80 active-render checks** and **12 HP-only geometry/cache comparisons** passed.
- All **eight quality browser cases** reach a lower effective density, roll back to the exact original index, and retain pinned quality settings.

[Final regression records](SURFACE_OUTLINE_REGRESSIONS.json) retain the per-case results.

Randomized unit comparisons check the exact ordered rectangles against the original full tracer after 300 edits for each of six interior/boundary configurations, with both solid and empty outside-world behavior. A separate case verifies cached geometry does not read later pending edits.

The targeted browser oracle compares 327 frames against the archived eager renderer, including 36 frames with queued terrain, intervening world edits, camera jumps, fractional zoom, scales 1/1.25/2, emptying and border regrowth. The quality browser checks actual renderer resizing and exact rollback at device scales 0.8/1/1.25/2 with coarse/fine pointers, plus all pinned quality settings.

## Reproduce

With Vite on port 5173, run timing workloads sequentially without competing builds/tests:

```bash
BREACH_BASELINE_REF=c5a95c1 BREACH_RATES=1,4 BREACH_SAMPLES=100 node scripts/fast-growth-benchmark.cjs
BREACH_BASELINE_REF=c5a95c1 node scripts/surface-outline-cache-smoke.cjs
node scripts/render-scale-plateau-smoke.cjs
node scripts/terrain-partial-repaint-smoke.cjs
node scripts/terrain-rebuild-smoke.cjs
BREACH_BASELINE_REF=c5a95c1 node scripts/lighting-pipeline-smoke.cjs
BREACH_BASELINE_REF=c5a95c1 BREACH_CHECK_ONLY=1 node scripts/render-active-benchmark.cjs
npm test
npm run build
```
