# Cache Blight classification and share edge occupancy

Baseline: `73b4911`. This continues the partial terrain repaint change by removing its remaining full-chunk Blight-presence scan.

## Implementation

- Store the four half-cell classification flags in one byte per terrain cell, allocated only for chunks containing Blight. Maintain the count of cells with any Blight so an edit need not rescan the chunk to decide whether its through-fog canvas remains necessary. Geometry changes reclassify only the existing edit rectangle. Ordinary HP changes reuse the flags. Removing the final Blight cell releases the flags and the existing through-fog canvas; generation/full rebuilds refresh every flag.
- Live and dormant edge masks reuse one immediately sampled, padded occupancy snapshot. They retain their independent inclusion predicates and output masks; neighboring Blight stays solid regardless of which layer it belongs to. The presence check stops invoking the inclusion predicate once it finds an included cell.
- Preserve albedo, edge geometry, animation, fog behavior, opacity invalidation and draw order.

Additional typed-array storage is one byte per cell in occupied chunks (1 KiB at the game's 32-cell chunk size), plus four bytes per chunk for the count. No new canvases are introduced. At a fully occupied 1024×1024-cell world the flags use 1 MiB; sparse worlds allocate proportionally fewer chunks. The shared edge snapshot already existed and is reused only within the same synchronous chunk build.

## Terrain benchmark

[Complete terrain results](BLIGHT_CLASSIFICATION_BENCHMARK.json) contain all p50/p95/p99 timings and pixel differences. The existing paired terrain benchmark uses desktop 1200×800 at scale 1 and mobile 390×844 at scale 2 with 4× CPU throttling. It measures 50 frames after 15 warmup frames, alternating submission order. A dense Blight patch receives 12 visible/offscreen edits per frame, with stationary/moving cameras at zoom 0.5/1.13. For this run a deterministic predicate marks every seventh subcell dormant, exercising both edge layers in baseline and updated code.

Timings include the required terrain/floor updates and terrain/Blight rendering. These are medians of paired percentage changes across the four camera/zoom cases, rather than pooled percentiles:

| Device | Growth | p50 change | p95 change | p99 change |
| --- | --- | ---: | ---: | ---: |
| desktop | visible | -9.0% | -5.3% | +4.5% |
| desktop | offscreen | +0.0% | -1.9% | -5.2% |
| mobile | visible | -6.6% | -1.6% | +40.3% |
| mobile | offscreen | -1.0% | +9.9% | +27.6% |

All pixel readbacks matched exactly, including the benchmark's half-cell, removal, dormancy and regeneration checks. Offscreen-growth gains are inconsistent, and some tail measurements regress substantially. The 6.6–9.0% median visible-growth terrain improvement is the clearest result; it is not a whole-game FPS claim.

## Whole render-frame benchmark

[Complete frame results](BLIGHT_CLASSIFICATION_FRAMES.json) compare 16 scenarios across both device profiles, sparse/dense combat, stationary/moving cameras and zoom 0.5/1.13. Sparse scenes have one soldier and one edit per frame. Dense scenes have 20 soldiers, 200 smoke particles and 32 edits per frame. The Blight patch consists of genuine half-size cells. Timings include the complete renderer and required terrain/floor work; simulation, mutation and shared shadow preparation are outside the timed section.

Both terrain variants now receive the game's actual live/dormant callback. The previous partial-repaint frame harness left that callback unset, so absolute timings should not be compared across the two reports. Within this report, both variants use identical inputs and callback behavior.

Each variant has eight warmup frames and 30 measured frames. Order alternates within a shared rAF; the script does not attribute that shared presentation interval to either variant. All 32 full-frame image comparisons matched exactly.

| Device | Median paired p50 change | Median paired p95 change | Median paired p99 change |
| --- | ---: | ---: | ---: |
| desktop | -1.5% | +0.8% | +6.9% |
| mobile | -0.4% | -11.6% | -17.8% |

Whole-frame median gains are small, particularly on mobile, and do not establish a reliable broad frame-rate improvement. Desktop tail results remain mixed. Full-resolution lighting/blur and shadow preparation remain larger targets; this change reduces the terrain work performed during growth.

Complete CPU times, **p50 / p95 / p99 milliseconds**:

| Device | Combat | Camera | Zoom | Baseline | Updated |
| --- | --- | --- | ---: | ---: | ---: |
| desktop | Sparse | Stationary | 0.5 | 25.3 / 31.9 / 36.9 | 24.6 / 31.7 / 46.8 |
| desktop | Sparse | Stationary | 1.13 | 19.9 / 25.7 / 28.9 | 19.5 / 21.6 / 27.6 |
| desktop | Sparse | Moving | 0.5 | 25.9 / 33.9 / 36.8 | 26.4 / 31.2 / 48.5 |
| desktop | Sparse | Moving | 1.13 | 19.8 / 23.5 / 23.6 | 20.0 / 24.0 / 24.3 |
| desktop | Dense | Stationary | 0.5 | 29.0 / 34.1 / 39.1 | 28.7 / 37.6 / 37.9 |
| desktop | Dense | Stationary | 1.13 | 24.1 / 33.4 / 37.4 | 24.1 / 40.3 / 52.8 |
| desktop | Dense | Moving | 0.5 | 28.0 / 34.7 / 40.6 | 27.2 / 31.2 / 45.0 |
| desktop | Dense | Moving | 1.13 | 26.6 / 31.6 / 54.1 | 26.0 / 33.3 / 41.5 |
| mobile | Sparse | Stationary | 0.5 | 131.3 / 169.5 / 238.2 | 131.0 / 155.2 / 170.4 |
| mobile | Sparse | Stationary | 1.13 | 115.3 / 160.9 / 171.8 | 110.3 / 128.6 / 157.1 |
| mobile | Sparse | Moving | 0.5 | 139.0 / 229.3 / 247.8 | 138.9 / 169.8 / 212.7 |
| mobile | Sparse | Moving | 1.13 | 108.5 / 124.1 / 156.6 | 105.4 / 123.2 / 131.3 |
| mobile | Dense | Stationary | 0.5 | 154.6 / 182.5 / 205.7 | 153.6 / 194.2 / 204.2 |
| mobile | Dense | Stationary | 1.13 | 161.6 / 209.4 / 212.5 | 161.3 / 169.2 / 171.2 |
| mobile | Dense | Moving | 0.5 | 166.8 / 224.8 / 343.5 | 166.9 / 208.0 / 266.1 |
| mobile | Dense | Moving | 1.13 | 163.9 / 233.8 / 333.4 | 158.3 / 199.5 / 221.6 |

These single-run Chromium CPU submission measurements use a cloud host, not physical phones or GPU timing. With 30 frame samples, p99 is the maximum sample. Raster work, scheduling and GC produce outliers; no statistical confidence interval is claimed.

## Validation

- All 596 tests across 82 files passed, plus production type check/build.
- New unit coverage compares shared versus independent edge snapshots across world/chunk boundaries and different inclusion predicates, including an empty second layer. Reused snapshots make no world classification calls.
- [1,035 incremental-versus-full-rebuild comparisons](BLIGHT_CLASSIFICATION_REGRESSIONS.json) passed with zero differing channels. These include partial world chunks, chunk seams, glass/crystal damage, subcell kinds/tints, dormant/live changes, final removal/regrowth and fractional zoom/device scales. The additional HP test verifies zero reclassification queries; the empty-world check verifies released classification storage.
- 80 existing active-render pixel/mask checks passed, including damage/glass opacity, growth/destruction, camera changes, regeneration and resizing.
- The terrain-rebuild browser check passed its 12 image comparisons and unchanged-geometry/animation-cache assertions.

## Reproduce

With Vite on port 5173, run benchmarks sequentially without competing builds/tests:

```bash
npm test
npm run build
BREACH_BASELINE_REF=73b4911 BREACH_DORMANT=1 BREACH_REPORT=/tmp/blight-classification-terrain.json node scripts/blight-render-benchmark.cjs
BREACH_BASELINE_REF=73b4911 BREACH_REPORT=/tmp/blight-classification-frames.json node scripts/terrain-frame-benchmark.cjs
node scripts/terrain-partial-repaint-smoke.cjs
node scripts/terrain-rebuild-smoke.cjs
BREACH_BASELINE_REF=73b4911 BREACH_CHECK_ONLY=1 node scripts/render-active-benchmark.cjs
```
