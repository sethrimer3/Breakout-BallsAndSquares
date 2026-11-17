# Repaint only edited terrain cells

Baseline: `2dfee83`. The change tracks a bounding rectangle of edited cells in each dirty chunk, including the existing one-cell halo for relief shading and diagonal neighbors. Chunk uploads use that rectangle for both normal terrain and the Blight-through-fog texture. Growth, destruction, damage and explicit visual/dormancy notifications share the same bounds. Generation and `rebuildAll` still repaint every cell. Geometry and opacity revision behavior stays intact.

The existing shared ImageData remains the scratch buffer; pixels outside its current rectangle are deliberately ignored. No per-chunk pixel buffers or additional canvases are retained. Four integer bounds cost 16 bytes per chunk. Blight presence is still checked across the chunk before removing its through-fog canvas, and edge masks/outlines still rebuild conservatively when geometry changes.

## Terrain rendering measurements

[TERRAIN_PARTIAL_REPAINT_BENCHMARK.json](TERRAIN_PARTIAL_REPAINT_BENCHMARK.json) contains all 16 paired scenarios, including p50/p95/p99 milliseconds and pixel differences. Chromium runs desktop 1200×800 at scale 1 and mobile 390×844 at scale 2 with 4× CPU throttling. Each scenario has 15 warmup frames and 50 measured frames, alternating baseline/updated submission order. Views use zoom 0.5/1.13 and stationary/moving cameras. A dense Blight patch receives 12 edits per frame, either inside or outside the view. Timings include dirty terrain/floor work and terrain/Blight drawing, with identical geometry and advancing animation clocks.

Median paired percentage changes across the four camera/zoom cases in each row:

| Device | Growth | CPU p50 change | CPU p95 change |
| --- | --- | ---: | ---: |
| Desktop | Visible | −18.3% | −12.0% |
| Desktop | Offscreen | −18.3% | −1.8% |
| Mobile profile | Visible | −27.0% | −18.1% |
| Mobile profile | Offscreen | −14.5% | −5.4% |

Every pixel comparison matched exactly, including the benchmark's removal, dormancy, half-cell and regeneration checks. Some tail measurements regress; see the complete data instead of interpreting the median as a guarantee.

## Whole render-frame measurements

[TERRAIN_PARTIAL_REPAINT_FRAMES.json](TERRAIN_PARTIAL_REPAINT_FRAMES.json) records 16 whole render-frame scenarios: desktop/mobile × stationary/moving × zoom 0.5/1.13 × sparse/dense combat. The shared scene contains a 40×40-cell patch of half-size Blight. Sparse scenes use one soldier and one Blight edit per frame; dense scenes use 20 soldiers, 200 smoke particles and 32 edits per frame. The baseline and optimized terrain caches use the game's 32-cell chunk size, separate renderers and identical shared world inputs. Each variant receives eight warmup frames and 30 timed frames; submission order alternates. Both run inside the same rAF, so presentation intervals are deliberately not attributed to individual variants.

Timing includes required terrain/floor updates and the complete renderer draw. Shared mutation and shadow/visibility preparation occur before timing; simulation remains frozen. Advancing render clocks preserve identical fixture flicker and Blight animation. All 32 full-frame readbacks (two per scenario) had **zero differing channels**.

| Device | Median paired p50 change | Median paired p95 change | Median paired p99 change |
| --- | ---: | ---: | ---: |
| Desktop | −8.2% | −6.7% | −5.4% |
| Mobile profile, 4× CPU throttle | −7.7% | −7.2% | −1.0% |

All 16 scenario medians improve. Individual tail results remain mixed, including desktop dense zoomed-out scenes and mobile stationary dense scenes. These are single-run comparisons with 30 samples, so p99 is the maximum observed sample and scheduling/raster/GC outliers remain visible.

Complete render-frame CPU times, **p50 / p95 / p99 ms**:

| Device | Combat | Camera | Zoom | Baseline | Updated |
| --- | --- | --- | ---: | ---: | ---: |
| desktop | Sparse | Stationary | 0.5 | 28.4 / 35.1 / 40.1 | 25.8 / 32.3 / 34.4 |
| desktop | Sparse | Stationary | 1.13 | 20.9 / 29.4 / 34.3 | 19.7 / 27.1 / 33.8 |
| desktop | Sparse | Moving | 0.5 | 26.7 / 33.8 / 38.6 | 26.2 / 31.8 / 35.4 |
| desktop | Sparse | Moving | 1.13 | 21.9 / 27.0 / 45.4 | 20.6 / 27.0 / 42.6 |
| desktop | Dense | Stationary | 0.5 | 31.9 / 34.6 / 36.7 | 28.6 / 39.5 / 68.1 |
| desktop | Dense | Stationary | 1.13 | 28.7 / 35.0 / 35.1 | 25.1 / 32.4 / 33.5 |
| desktop | Dense | Moving | 0.5 | 31.7 / 39.2 / 42.8 | 29.4 / 51.3 / 64.5 |
| desktop | Dense | Moving | 1.13 | 28.5 / 32.1 / 42.1 | 25.7 / 27.7 / 27.9 |
| mobile | Sparse | Stationary | 0.5 | 146.2 / 173.0 / 207.4 | 134.5 / 181.6 / 221.0 |
| mobile | Sparse | Stationary | 1.13 | 111.4 / 129.2 / 165.1 | 103.9 / 114.3 / 130.4 |
| mobile | Sparse | Moving | 0.5 | 143.7 / 237.3 / 238.5 | 134.3 / 169.9 / 225.9 |
| mobile | Sparse | Moving | 1.13 | 127.3 / 155.0 / 170.9 | 116.1 / 150.6 / 176.6 |
| mobile | Dense | Stationary | 0.5 | 179.2 / 256.3 / 290.1 | 164.8 / 256.9 / 341.0 |
| mobile | Dense | Stationary | 1.13 | 179.0 / 212.9 / 251.5 | 166.0 / 216.3 / 305.3 |
| mobile | Dense | Moving | 0.5 | 184.6 / 250.3 / 305.0 | 171.1 / 212.9 / 215.2 |
| mobile | Dense | Moving | 1.13 | 167.5 / 212.9 / 231.5 | 147.8 / 182.7 / 210.8 |

## Validation and limits

- 591 unit tests passed, including edit-bound union, diagonal chunk seams, budgeted queues, world borders and full rebuilds.
- Production TypeScript check and Vite build passed.
- 80 existing active-render pixel/mask checks passed, including ordinary HP reuse, glass opacity, growth, destruction, pan/zoom, resizing and regeneration. The terrain-rebuild browser check also passed its 12 comparisons and geometry/animation-cache assertions.
- 999 additional incremental-versus-full-rebuild comparisons passed with zero changed channels: chunk albedo, Blight-only textures and composed images. These include glass/crystal damage, subcell kinds/tints, dormancy, removal/regrowth, non-multiple world dimensions, fractional zoom and scales 1/1.25/2.

These are browser CPU submission measurements on one cloud host, not native phone/GPU timings or a 60 FPS claim. Simulation is frozen. Full-screen lighting and blur remain substantial costs, particularly at high density. This change reduces the terrain work required by growth; it does not lower visual quality or alter growth simulation.

Lighting prototypes tested during this pass—gradient-stop string caching, fixture-relative paths, a separate low-resolution blur pass and an ambient-background cache—did not establish a reliable performance improvement. They were discarded. The relative-path prototype also needed careful treatment of gradient coordinates; the separate blur pass needed additional cropped-region padding.

## Reproduce

With Vite running on port 5173:

```bash
npm test
npm run build
BREACH_BASELINE_REF=2dfee83 node scripts/blight-render-benchmark.cjs
BREACH_BASELINE_REF=2dfee83 node scripts/terrain-frame-benchmark.cjs
node scripts/terrain-partial-repaint-smoke.cjs
node scripts/terrain-rebuild-smoke.cjs
BREACH_BASELINE_REF=2dfee83 BREACH_CHECK_ONLY=1 node scripts/render-active-benchmark.cjs
```

Run benchmarks sequentially without competing builds or tests. The scripts archive the baseline into ignored temporary directories; they do not modify the working tree.
