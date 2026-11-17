# Reject rays outside soldier shadow silhouettes

Baseline: `00fa0cb`. The change adds a conservative angular broad phase to the existing soldier-occluder loop in `LightingSystem.trace`.

Each soldier's angular silhouette was already calculated to add grazing rays to the light's ray fan. The tracer now retains those bounds and skips exact circle/polygon intersection tests for rays outside them. Bounds include the existing corner epsilon and support wrapping across −π/+π. Both interval endpoints remain included. Wide/ambiguous spans and occluders beyond the silhouette-ray budget keep the full-span fallback and run the original exact tests. Ray order, terrain tracing, soldier geometry, wall-cell lighting, quality presets and rendered output stay unchanged.

The bounds occupy two additional numbers in each existing pooled occluder object. This adds no world-sized geometry cache or new canvas.

## Benchmark

[Complete benchmark data](SHADOW_RAY_BENCHMARK.json) contains all 16 scenarios and p50/p95/p99 timings. Median paired percentage changes across the four camera/zoom scenarios per row:

| Device | Combat | Shadow prep p50 | Shadow prep p95 | Render-frame CPU p50 | Render-frame CPU p95 | Render-frame CPU p99 |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| desktop | Sparse | +0.0% | -12.2% | -1.7% | +7.9% | +5.8% |
| desktop | Dense | -37.6% | -39.6% | -15.5% | -24.1% | -21.3% |
| mobile | Sparse | +11.6% | -8.8% | +3.2% | +1.0% | +0.7% |
| mobile | Dense | -36.5% | -37.9% | -9.9% | -11.5% | -17.9% |

Dense combat shows the useful improvement: about **37% less median shadow-preparation CPU time**, translating to **15.5% desktop / 9.9% mobile-profile median render-frame CPU reductions**. Sparse results remain mixed and some individual tail measurements regress. These are medians of paired percentage changes, not pooled percentiles or a universal FPS gain.

Complete **render-frame p50 / p95 / p99 milliseconds** (includes shadow preparation and renderer draw):

| Device | Combat | Camera | Zoom | Baseline | Updated |
| --- | --- | --- | ---: | ---: | ---: |
| desktop | Sparse | Stationary | 0.5 | 20.5 / 25.9 / 32.5 | 21.7 / 31.3 / 42.0 |
| desktop | Sparse | Stationary | 1.13 | 19.6 / 24.8 / 30.7 | 18.7 / 28.7 / 37.3 |
| desktop | Sparse | Moving | 0.5 | 22.4 / 32.1 / 34.3 | 22.1 / 29.9 / 30.9 |
| desktop | Sparse | Moving | 1.13 | 18.7 / 23.7 / 36.6 | 18.3 / 23.7 / 24.3 |
| desktop | Dense | Stationary | 0.5 | 67.0 / 91.6 / 92.3 | 57.1 / 65.3 / 70.4 |
| desktop | Dense | Stationary | 1.13 | 76.3 / 94.8 / 121.9 | 67.3 / 76.3 / 77.5 |
| desktop | Dense | Moving | 0.5 | 71.3 / 78.5 / 90.0 | 57.4 / 72.4 / 76.6 |
| desktop | Dense | Moving | 1.13 | 73.2 / 113.2 / 123.7 | 61.3 / 77.0 / 100.3 |
| mobile | Sparse | Stationary | 0.5 | 124.3 / 168.2 / 195.1 | 129.5 / 172.8 / 191.6 |
| mobile | Sparse | Stationary | 1.13 | 114.9 / 180.9 / 189.0 | 117.4 / 155.1 / 184.7 |
| mobile | Sparse | Moving | 0.5 | 131.4 / 156.3 / 159.5 | 137.5 / 190.2 / 194.4 |
| mobile | Sparse | Moving | 1.13 | 113.3 / 152.1 / 195.4 | 114.1 / 150.9 / 201.8 |
| mobile | Dense | Stationary | 0.5 | 394.7 / 516.8 / 564.3 | 330.7 / 384.5 / 385.9 |
| mobile | Dense | Stationary | 1.13 | 487.1 / 536.3 / 554.6 | 442.2 / 494.6 / 496.2 |
| mobile | Dense | Moving | 0.5 | 388.9 / 430.6 / 462.4 | 358.2 / 382.1 / 445.7 |
| mobile | Dense | Moving | 1.13 | 485.0 / 556.1 / 668.6 | 433.4 / 490.3 / 499.3 |

The matrix uses desktop 1200×800 at device scale 1 and an emulated mobile 390×844 profile at scale 2 with 4× CPU throttling. Sparse combat has one soldier/flash; dense combat has 20 soldiers/flashes, mixed body shapes across all eight slot shapes, and 200 smoke particles. Moving and stationary cameras run at zoom 0.5 and 1.13. Soldiers turn and move slightly each frame. A dense patch of half-size Blight surrounds an open area containing the light sources; lights buried deep in solid terrain would exit before this work and give a misleading test. One/32 attempted growth/destruction edits per frame keep nearby geometry changing; edits inside the source area are excluded to keep it open.

The same world and inputs feed archived baseline and updated LightingSystem instances. Both use the same current rendering code and separate renderers. Lighting quality is pinned high. Timing includes shadow/visibility/fixture preparation and the entire renderer draw. Shared terrain mutation and terrain/floor updates occur before timing. Each variant has eight warmup frames and 30 measured frames with alternating order inside a shared rAF. Thus these are rendering CPU submission times, not separately attributable presentation intervals, GPU timings or physical-phone FPS.

Images and complete flash/soft-light polygon and lit-cell lists are compared on two frames per scenario. Readbacks/comparisons occur outside timings. The render clock advances identically so fixture flicker and Blight animation match.

## Validation

- All **598 tests across 83 files** and production type check/build passed. New unit tests cover inclusive interval endpoints, the full-span fallback and ±π wraparound.
- **195 strict baseline/updated trace comparisons** passed with zero changed polygon coordinates or lit-cell entries. Cases cover all eight soldier shapes, turning/moving occluders, all quality presets, source-owner exclusion, changing half-size terrain, regeneration, tiny light radii and wall-backed source relocation. A 600-soldier case explicitly exercises **116 occluders beyond the silhouette-ray budget**, followed by a smaller crowd to check reused entries.
- **32 complete render-frame image comparisons** passed with zero changed channels. Each also compares complete flash/soft-light polygons and lit-cell lists against the archived baseline. All benchmark scenes verify nonempty flash polygons (one in sparse, 20 in dense combat).
- **258 existing lighting-pipeline pixel comparisons** and **80 active-render pixel/mask checks** passed, covering soft shadows, fixture changes, buffer regions, resizing, glass opacity, growth/destruction and camera changes.

[Raw regression results](SHADOW_RAY_REGRESSIONS.json) retain the trace oracle and active-render checks.

## Limits and rejected prototype

Measurements use one cloud Chromium host and one run of 30 samples per scenario. P99 is the maximum sample; browser raster work, scheduling and GC cause outliers. Complete individual regressions are retained in the JSON and table above. Sparse scenes are a control with little soldier-occlusion work; the intended benefit is crowded combat, not empty views.

An earlier terrain-corner flag cache reduced median shadow-preparation time by 4.4–6.8% in its own matrix, but whole-frame medians regressed 1.1–1.5%. It was discarded, including its generation hooks and world-sized cache. That exploratory matrix used round soldiers; the retained benchmark explicitly exercises mixed shapes and checks that sources produce nonempty shadow polygons.

## Reproduce

With Vite on port 5173, run benchmarks sequentially without competing builds/tests:

```bash
npm test
npm run build
BREACH_BASELINE_REF=00fa0cb node scripts/shadow-ray-benchmark.cjs
BREACH_BASELINE_REF=00fa0cb node scripts/shadow-ray-smoke.cjs
BREACH_BASELINE_REF=00fa0cb node scripts/lighting-pipeline-smoke.cjs
BREACH_BASELINE_REF=00fa0cb BREACH_CHECK_ONLY=1 node scripts/render-active-benchmark.cjs
```

The benchmark accepts `BREACH_SAMPLES` (minimum 20) and `BREACH_REPORT`. Both shadow scripts archive the baseline into ignored temporary directories and remove them afterward.
