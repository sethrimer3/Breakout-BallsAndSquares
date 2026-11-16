# Blight rendering follow-up

Two exact-output changes reduce growth-related work:

- Classify the fog-visible Blight texture once per half-cell rather than once per albedo texel.
- Key animated live/dormant edge caches by the revisions of chunks inside their current render bounds. Off-screen growth no longer repaints an unchanged visible mask and fire texture.

The procedural animation, contour resolution and animation cadence are unchanged.

## Validation

Run Vite, then `node scripts/blight-render-benchmark.cjs`. The harness archives the baseline source from Git and compares alternating old/new terrain-renderer runs against identical mutations, camera paths and animation times. Set `BREACH_BASELINE_REF=8b8b8a5` to reproduce the baseline after this change is committed.

These are CPU submission timings for **terrain rebuilding and terrain/Blight drawing**, not whole-game frame times or a physical-device FPS claim. Each scenario has 15 warm-up frames and 50 timed samples. Mobile uses a 390×844 viewport, DPR 2 and Chrome's 4× CPU slowdown; desktop uses 1200×800, DPR 1. Growth changes 12 cells per frame. Both stationary/moving cameras and zoom 0.5/1.13 are covered. Exact RGBA comparisons at two frames per scenario found zero differing channels across all 16 scenarios. A second run additionally checked half-size Blight, dormancy, total removal and regeneration with a moved camera; all those comparisons also matched exactly. Its [raw results](BLIGHT_RENDERING_BENCHMARK_REPEAT.json) include four additional correctness-phase paint calls beyond the timed workload.

### Mobile results (milliseconds)

| Growth | Zoom | Camera | Median before → after | p95 before → after | p99 before → after |
|---|---|---|---|---|---|
| visible | 0.5 | stationary | 15.5 → 17.0 | 28.9 → 29.4 | 76.2 → 39.5 |
| offscreen | 0.5 | stationary | 10.8 → 3.9 | 18.9 → 19.2 | 23.7 → 77.2 |
| visible | 0.5 | moving | 15.9 → 15.8 | 19.3 → 18.7 | 96.8 → 30.7 |
| offscreen | 0.5 | moving | 11.1 → 3.0 | 14.2 → 11.0 | 16.3 → 17.1 |
| visible | 1.13 | stationary | 14.2 → 13.5 | 17.0 → 17.2 | 17.5 → 21.3 |
| offscreen | 1.13 | stationary | 9.1 → 2.1 | 10.5 → 8.0 | 12.2 → 9.2 |
| visible | 1.13 | moving | 14.3 → 13.6 | 18.2 → 18.4 | 65.0 → 99.4 |
| offscreen | 1.13 | moving | 8.4 → 2.0 | 10.2 → 8.8 | 11.1 → 8.9 |

See [raw measurements](BLIGHT_RENDERING_BENCHMARK.json) for desktop results and paint counts. Off-screen-growth cases repainted the edge effect 17 times instead of 65. Visible-growth cases still require 65 repaints. Some p95/p99 measurements regress; this short run is insufficient to claim improved worst-case frame times. Most of the robust improvement is removal of off-screen invalidation.

## Remaining major opportunities

A partial full-pipeline trace of moving combat scenes attributed roughly 19–22 ms per frame to Blight edge rendering on the desktop test browser, with lighting and soft shadows another substantial cost. The highest-priority follow-ups are:

1. Reduce the area shaded by animated edge noise, or offer a measured lower-resolution effect in low/automatic quality while retaining sharp contour masks. This changes effect pixels and needs image comparisons and quality review.
2. Bound lighting/soft-shadow buffers to affected regions and avoid processing their empty area. Validate blur padding, removal of old light, resizing and overlapping lights.
3. Profile growth simulation and colony bookkeeping separately from rendering. These changes do not reduce simulation cost; an overloaded simulation can still stall the game.

The partial trace was interrupted by Vite hot reload during development; it is diagnostic evidence, not a complete release benchmark. Repeat full-pipeline profiling before selecting the next larger change.
