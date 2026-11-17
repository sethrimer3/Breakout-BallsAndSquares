# Restore quiet-view lighting reuse after Blight growth

Baseline: `664ef87`. GrowthSystem retains up to 4,096 pulse-history entries until the next run, even after their 0.65-second display lifetime ends. LightRenderer previously treated any nonempty history as visible lighting. One growth event could therefore disable its existing unlit-lightmap cache for the remainder of a run.

The cache now checks whether a history entry would actually draw: its age must be valid, its cell must have health, and its position must pass the original viewport test. The predicate runs only when a previously cached lightmap could otherwise be reused. A normal render records whether the existing pulse loop drew anything, allowing it to save an unlit result without scanning twice. The original drawing loop preserves pulse order and appearance. Terrain, fog, emissive effects and animated Blight edges continue through the renderer every frame.

The extension keeps the original light, camera, mask/opacity, ambient, backing-size and soft-shadow invalidations. Visible pulses, room lights, flashes and contributing soft lights prevent reuse. No new canvas or retained world-sized buffer is introduced.

## Pixel safety

Fractional device scales can leave a backing pixel only partially covered by the ambient fill. Its color can evolve over repeated draws. The extended history path keeps rendering normally when that fringe exists, preserving baseline pixels. The original zero-history behavior is retained.

The targeted browser oracle covers odd viewport sizes, device scales 1/1.25/1.5/2, zoom 0.5/1.13, both shadow settings and both image-smoothing states. It checks pulse appearance, fading, expiration, offscreen activity, destruction, ring wrapping, camera changes, resizing and regeneration. Eligible cases must hit the cache; partial-fringe cases must take the full path.

## Measurements

[Complete benchmark data](GROWTH_GLOW_CACHE_BENCHMARK.json) records all **80 scenarios** and their frame CPU p50/p95/p99, primary-pass counts and pixel differences. All **160 full-frame image comparisons** matched exactly.

The targeted stationary quiet cases show these median paired percentage changes across expired/offscreen histories and both zooms:

| Shadows | Device | CPU p50 change | CPU p95 change | CPU p99 change |
| --- | --- | ---: | ---: | ---: |
| Default | desktop | -29.9% | -3.1% | -3.1% |
| Default | mobile | -37.7% | -35.6% | -35.6% |
| Soft blur | desktop | -81.3% | -70.1% | -70.1% |
| Soft blur | mobile | -84.5% | -73.6% | -73.6% |

Default-shadow quiet-view CPU medians improve about **30% desktop / 38% mobile profile**, and soft-shadow medians improve **81% / 85%**. In every eligible stationary case the primary lighting pass falls from **20 full executions to zero** during measured frames. All moving, visibly glowing and combat controls retain **20 full executions** in both variants. Thus the benefit comes from reusing the lightmap; the remaining rendering passes continue normally.

Other scenarios are controls with no expected broad speedup. Their measured medians/tails vary, with individual regressions. Median paired changes across camera/zoom cases:

| Shadows | Device | Control | CPU p50 change | CPU p95 change | CPU p99 change |
| --- | --- | --- | ---: | ---: | ---: |
| Default | desktop | Moving quiet | +1.0% | -5.4% | -5.4% |
| Default | desktop | Visible pulses | +2.8% | +23.1% | +23.1% |
| Default | desktop | Sparse combat | +0.8% | +27.3% | +27.3% |
| Default | desktop | Dense combat | +1.3% | -2.0% | -2.0% |
| Default | mobile | Moving quiet | -0.2% | -0.7% | -0.7% |
| Default | mobile | Visible pulses | +1.2% | +31.6% | +31.6% |
| Default | mobile | Sparse combat | +6.2% | -36.5% | -36.5% |
| Default | mobile | Dense combat | +1.3% | +4.0% | +4.0% |
| Soft blur | desktop | Moving quiet | +1.6% | -18.0% | -18.0% |
| Soft blur | desktop | Visible pulses | +1.8% | +1.4% | +1.4% |
| Soft blur | desktop | Sparse combat | +1.1% | -7.5% | -7.5% |
| Soft blur | desktop | Dense combat | +0.3% | -3.3% | -3.3% |
| Soft blur | mobile | Moving quiet | +2.2% | +1.8% | +1.8% |
| Soft blur | mobile | Visible pulses | +2.4% | -23.3% | -23.3% |
| Soft blur | mobile | Sparse combat | +4.7% | +38.6% | +38.6% |
| Soft blur | mobile | Dense combat | -0.2% | -0.5% | -0.5% |

Complete **render CPU p50 / p95 / p99 milliseconds**:

| Shadows | Device | Scene | Camera | Zoom | Baseline | Updated |
| --- | --- | --- | --- | ---: | ---: | ---: |
| Default | desktop | expired | Stationary | 0.5 | 1.1 / 1.6 / 1.6 | 0.7 / 1.5 / 1.5 |
| Default | desktop | expired | Stationary | 1.13 | 0.8 / 1.3 / 1.3 | 0.4 / 1.4 / 1.4 |
| Default | desktop | expired | Moving | 0.5 | 4.9 / 6.1 / 6.1 | 5.0 / 6.0 / 6.0 |
| Default | desktop | expired | Moving | 1.13 | 4.7 / 6.5 / 6.5 | 4.7 / 5.9 / 5.9 |
| Default | desktop | offscreen_growth | Stationary | 0.5 | 2.2 / 3.3 / 3.3 | 1.9 / 3.3 / 3.3 |
| Default | desktop | offscreen_growth | Stationary | 1.13 | 1.7 / 2.8 / 2.8 | 1.3 / 2.2 / 2.2 |
| Default | desktop | offscreen_growth | Moving | 0.5 | 5.2 / 7.9 / 7.9 | 5.1 / 13.3 / 13.3 |
| Default | desktop | offscreen_growth | Moving | 1.13 | 4.7 / 14.2 / 14.2 | 5.0 / 6.9 / 6.9 |
| Default | desktop | visible_growth | Stationary | 0.5 | 1.5 / 1.8 / 1.8 | 1.7 / 2.2 / 2.2 |
| Default | desktop | visible_growth | Stationary | 1.13 | 1.7 / 2.0 / 2.0 | 1.7 / 6.2 / 6.2 |
| Default | desktop | visible_growth | Moving | 0.5 | 6.2 / 10.8 / 10.8 | 6.1 / 8.8 / 8.8 |
| Default | desktop | visible_growth | Moving | 1.13 | 5.3 / 6.7 / 6.7 | 5.6 / 8.3 / 8.3 |
| Default | desktop | sparse_combat | Stationary | 0.5 | 1.7 / 2.6 / 2.6 | 1.7 / 3.2 / 3.2 |
| Default | desktop | sparse_combat | Stationary | 1.13 | 2.2 / 3.8 / 3.8 | 2.2 / 5.4 / 5.4 |
| Default | desktop | sparse_combat | Moving | 0.5 | 5.4 / 7.0 / 7.0 | 5.8 / 8.3 / 8.3 |
| Default | desktop | sparse_combat | Moving | 1.13 | 6.0 / 7.6 / 7.6 | 6.1 / 10.0 / 10.0 |
| Default | desktop | dense_combat | Stationary | 0.5 | 12.0 / 13.5 / 13.5 | 12.3 / 15.7 / 15.7 |
| Default | desktop | dense_combat | Stationary | 1.13 | 26.0 / 31.8 / 31.8 | 26.0 / 33.2 / 33.2 |
| Default | desktop | dense_combat | Moving | 0.5 | 16.2 / 22.8 / 22.8 | 16.5 / 20.9 / 20.9 |
| Default | desktop | dense_combat | Moving | 1.13 | 28.4 / 37.5 / 37.5 | 28.6 / 31.3 / 31.3 |
| Soft blur | desktop | expired | Stationary | 0.5 | 5.6 / 8.2 / 8.2 | 0.8 / 3.9 / 3.9 |
| Soft blur | desktop | expired | Stationary | 1.13 | 6.1 / 7.3 / 7.3 | 0.6 / 1.8 / 1.8 |
| Soft blur | desktop | expired | Moving | 0.5 | 10.0 / 19.1 / 19.1 | 10.2 / 14.4 / 14.4 |
| Soft blur | desktop | expired | Moving | 1.13 | 9.0 / 12.3 / 12.3 | 9.1 / 10.9 / 10.9 |
| Soft blur | desktop | offscreen_growth | Stationary | 0.5 | 6.7 / 8.7 / 8.7 | 2.0 / 3.0 / 3.0 |
| Soft blur | desktop | offscreen_growth | Stationary | 1.13 | 6.9 / 8.7 / 8.7 | 1.6 / 2.2 / 2.2 |
| Soft blur | desktop | offscreen_growth | Moving | 0.5 | 9.4 / 14.2 / 14.2 | 9.7 / 10.6 / 10.6 |
| Soft blur | desktop | offscreen_growth | Moving | 1.13 | 9.1 / 10.3 / 10.3 | 9.0 / 10.5 / 10.5 |
| Soft blur | desktop | visible_growth | Stationary | 0.5 | 6.1 / 6.9 / 6.9 | 6.4 / 6.7 / 6.7 |
| Soft blur | desktop | visible_growth | Stationary | 1.13 | 6.7 / 7.0 / 7.0 | 6.8 / 7.4 / 7.4 |
| Soft blur | desktop | visible_growth | Moving | 0.5 | 9.8 / 11.5 / 11.5 | 9.8 / 20.7 / 20.7 |
| Soft blur | desktop | visible_growth | Moving | 1.13 | 9.7 / 16.3 / 16.3 | 9.9 / 11.6 / 11.6 |
| Soft blur | desktop | sparse_combat | Stationary | 0.5 | 7.1 / 14.7 / 14.7 | 7.2 / 23.8 / 23.8 |
| Soft blur | desktop | sparse_combat | Stationary | 1.13 | 9.6 / 15.7 / 15.7 | 9.1 / 14.0 / 14.0 |
| Soft blur | desktop | sparse_combat | Moving | 0.5 | 11.4 / 22.5 / 22.5 | 11.9 / 16.9 / 16.9 |
| Soft blur | desktop | sparse_combat | Moving | 1.13 | 11.9 / 18.8 / 18.8 | 12.0 / 18.0 / 18.0 |
| Soft blur | desktop | dense_combat | Stationary | 0.5 | 18.7 / 30.0 / 30.0 | 18.7 / 25.6 / 25.6 |
| Soft blur | desktop | dense_combat | Stationary | 1.13 | 33.0 / 55.9 / 55.9 | 33.1 / 46.0 / 46.0 |
| Soft blur | desktop | dense_combat | Moving | 0.5 | 22.3 / 26.1 / 26.1 | 22.4 / 28.2 / 28.2 |
| Soft blur | desktop | dense_combat | Moving | 1.13 | 34.7 / 39.4 / 39.4 | 34.8 / 81.4 / 81.4 |
| Default | mobile | expired | Stationary | 0.5 | 6.3 / 19.6 / 19.6 | 3.2 / 6.5 / 6.5 |
| Default | mobile | expired | Stationary | 1.13 | 4.5 / 6.6 / 6.6 | 1.7 / 5.5 / 5.5 |
| Default | mobile | expired | Moving | 0.5 | 33.5 / 44.3 / 44.3 | 32.4 / 130.1 / 130.1 |
| Default | mobile | expired | Moving | 1.13 | 31.2 / 74.8 / 74.8 | 32.0 / 43.7 / 43.7 |
| Default | mobile | offscreen_growth | Stationary | 0.5 | 15.6 / 41.8 / 41.8 | 11.5 / 20.6 / 20.6 |
| Default | mobile | offscreen_growth | Stationary | 1.13 | 9.6 / 18.1 / 18.1 | 7.8 / 14.4 / 14.4 |
| Default | mobile | offscreen_growth | Moving | 0.5 | 31.9 / 41.5 / 41.5 | 33.4 / 58.2 / 58.2 |
| Default | mobile | offscreen_growth | Moving | 1.13 | 27.7 / 85.1 / 85.1 | 26.9 / 47.4 / 47.4 |
| Default | mobile | visible_growth | Stationary | 0.5 | 9.6 / 20.3 / 20.3 | 9.9 / 32.7 / 32.7 |
| Default | mobile | visible_growth | Stationary | 1.13 | 14.8 / 17.9 / 17.9 | 15.0 / 22.6 / 22.6 |
| Default | mobile | visible_growth | Moving | 0.5 | 36.7 / 101.4 / 101.4 | 37.1 / 48.4 / 48.4 |
| Default | mobile | visible_growth | Moving | 1.13 | 40.2 / 55.0 / 55.0 | 40.2 / 75.3 / 75.3 |
| Default | mobile | sparse_combat | Stationary | 0.5 | 12.9 / 27.7 / 27.7 | 14.1 / 31.9 / 31.9 |
| Default | mobile | sparse_combat | Stationary | 1.13 | 27.2 / 52.4 / 52.4 | 30.0 / 38.8 / 38.8 |
| Default | mobile | sparse_combat | Moving | 0.5 | 42.8 / 109.4 / 109.4 | 41.8 / 53.8 / 53.8 |
| Default | mobile | sparse_combat | Moving | 1.13 | 51.9 / 126.1 / 126.1 | 53.5 / 66.9 / 66.9 |
| Default | mobile | dense_combat | Stationary | 0.5 | 129.6 / 151.7 / 151.7 | 129.5 / 166.9 / 166.9 |
| Default | mobile | dense_combat | Stationary | 1.13 | 324.1 / 379.5 / 379.5 | 335.0 / 372.1 / 372.1 |
| Default | mobile | dense_combat | Moving | 0.5 | 155.5 / 189.7 / 189.7 | 154.4 / 224.5 / 224.5 |
| Default | mobile | dense_combat | Moving | 1.13 | 352.9 / 425.1 / 425.1 | 362.1 / 407.2 / 407.2 |
| Soft blur | mobile | expired | Stationary | 0.5 | 41.1 / 57.9 / 57.9 | 4.2 / 22.4 / 22.4 |
| Soft blur | mobile | expired | Stationary | 1.13 | 38.3 / 54.0 / 54.0 | 2.2 / 6.5 / 6.5 |
| Soft blur | mobile | expired | Moving | 0.5 | 65.9 / 91.1 / 91.1 | 71.8 / 111.1 / 111.1 |
| Soft blur | mobile | expired | Moving | 1.13 | 68.5 / 147.6 / 147.6 | 66.8 / 97.1 / 97.1 |
| Soft blur | mobile | offscreen_growth | Stationary | 0.5 | 44.8 / 93.8 / 93.8 | 12.0 / 21.2 / 21.2 |
| Soft blur | mobile | offscreen_growth | Stationary | 1.13 | 41.2 / 54.4 / 54.4 | 8.6 / 16.4 / 16.4 |
| Soft blur | mobile | offscreen_growth | Moving | 0.5 | 71.0 / 98.3 / 98.3 | 69.9 / 95.7 / 95.7 |
| Soft blur | mobile | offscreen_growth | Moving | 1.13 | 67.9 / 134.0 / 134.0 | 72.0 / 142.3 / 142.3 |
| Soft blur | mobile | visible_growth | Stationary | 0.5 | 47.4 / 84.9 / 84.9 | 48.0 / 59.3 / 59.3 |
| Soft blur | mobile | visible_growth | Stationary | 1.13 | 43.0 / 91.5 / 91.5 | 44.5 / 54.8 / 54.8 |
| Soft blur | mobile | visible_growth | Moving | 0.5 | 70.7 / 99.2 / 99.2 | 76.9 / 235.9 / 235.9 |
| Soft blur | mobile | visible_growth | Moving | 1.13 | 78.3 / 150.6 / 150.6 | 79.0 / 125.7 / 125.7 |
| Soft blur | mobile | sparse_combat | Stationary | 0.5 | 53.7 / 68.9 / 68.9 | 57.3 / 89.3 / 89.3 |
| Soft blur | mobile | sparse_combat | Stationary | 1.13 | 82.2 / 101.5 / 101.5 | 81.2 / 100.2 / 100.2 |
| Soft blur | mobile | sparse_combat | Moving | 0.5 | 79.4 / 122.7 / 122.7 | 82.9 / 182.1 / 182.1 |
| Soft blur | mobile | sparse_combat | Moving | 1.13 | 97.8 / 112.2 / 112.2 | 102.6 / 165.7 / 165.7 |
| Soft blur | mobile | dense_combat | Stationary | 0.5 | 187.1 / 264.0 / 264.0 | 185.2 / 241.6 / 241.6 |
| Soft blur | mobile | dense_combat | Stationary | 1.13 | 380.2 / 485.9 / 485.9 | 382.6 / 502.1 / 502.1 |
| Soft blur | mobile | dense_combat | Moving | 0.5 | 198.1 / 310.7 / 310.7 | 202.0 / 338.9 / 338.9 |
| Soft blur | mobile | dense_combat | Moving | 1.13 | 411.7 / 488.2 / 488.2 | 402.4 / 466.7 / 466.7 |

The benchmark compares the archived baseline LightRenderer with the updated one inside otherwise identical, fresh Renderer instances. Both use matching sprite assets and newly initialized buffers. This avoids a test artifact discovered during validation: comparing a fresh baseline buffer against a previously used player buffer gave different image-smoothing states and one-channel differences in active pulse output.

The matrix uses the generated forest world, without fixed fixtures. Quiet cameras are outside the steady spawn light's reach. Pulse histories contain 4,096 expired entries or recent offscreen entries; the latter scenario also changes remote terrain. Controls include 64 visible pulses, sparse combat with one soldier/flash, and dense combat with 20 soldiers/flashes across eight body shapes plus 200 smoke particles. Moving/stationary cameras run at zoom 0.5/1.13, with default and soft shadows. Desktop is 1200×800 at device scale 1; the mobile profile is 390×844 at scale 2 with 4× CPU throttling. Render density and lighting quality are pinned high, and fog is revealed so lighting is visible in the image comparisons.

Each variant has eight warmup frames and 20 measured frames; baseline/updated order alternates within a shared rAF. Timings include the complete renderer draw. Shared simulation-state edits, shadow preparation and required terrain/floor updates precede timing. The render clock advances identically. These are CPU submission measurements from one cloud host, not separately attributable presentation intervals, GPU timings, physical-phone FPS or a confidence interval. Percentiles use the existing upper-rank selection; with 20 samples, p95 and p99 are both the maximum sample. Individual outliers and regressions are retained.

## Validation

- **613 tests across 85 files** and production type check/build passed. Unit cases cover expiration boundaries, future timestamps, health changes, viewport edges/rounding, ring wrapping and irrelevant entries.
- **576 targeted baseline/updated lighting pixel comparisons** passed with zero changed channels, across both smoothing states, both shadow settings, fractional zoom and device scales 1/1.25/1.5/2. The oracle also asserts actual cache hits and the partial-fringe fallback.
- **160 full-frame pixel comparisons** passed across all 80 benchmark scenarios. Eligible stationary cases skip all 20 measured primary passes; controls execute all 20.
- **258 existing lighting-pipeline comparisons** and **80 active-render pixel/mask checks** passed, covering other worlds, fixtures, soft shadows, scatter buffers, glass opacity, resizing, camera changes and regeneration.

[Raw regression results](GROWTH_GLOW_CACHE_REGRESSIONS.json) retain the per-case records and cache-pass evidence.

## Reproduce

With Vite running on port 5173, run sequentially without competing builds/tests:

```bash
npm test
npm run build
BREACH_BASELINE_REF=664ef87 node scripts/growth-glow-cache-smoke.cjs
BREACH_BASELINE_REF=664ef87 BREACH_SAMPLES=20 node scripts/growth-glow-cache-benchmark.cjs
BREACH_BASELINE_REF=664ef87 node scripts/lighting-pipeline-smoke.cjs
BREACH_BASELINE_REF=664ef87 BREACH_CHECK_ONLY=1 node scripts/render-active-benchmark.cjs
```

The new scripts accept `BREACH_REPORT`; the benchmark also accepts comma-separated `BREACH_SCENES` and `BREACH_DEVICES` filters for diagnosis. Temporary baseline archives are created under ignored node_modules cache directories and removed afterward.
