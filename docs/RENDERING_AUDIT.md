# Rendering audit and validated changes

This pass covers the complete render pipeline and its preparation work across all five worlds. It implements the validated improvements below and ranks the remaining major opportunities. It does not claim that every possible optimization has been found or that these cloud measurements establish target-device FPS.

Baseline: `4bb50da453e873a3f938aab1ae28540ad0b158fb`, the completed items 1–3 from the previous pass. The optimized source is committed with this report; its SHA-256 is `d456c04c77a7cf0052ab8202d141980c6e2e8da8899c25396bab2180cd5bde2a`. Complete measurements, pixel records, and validation results are in [RENDERING_AUDIT_DATA.json](RENDERING_AUDIT_DATA.json).

## Implemented

| Change | Evidence and behavior |
|---|---|
| Stop rendering behind the opaque main menu | Previously the game computed shadows and drew its full canvas on every sampled menu frame while the menu ran its own simulation. Gameplay shadow/chunk/render calls now stop while that opaque menu is visible and resume on the first frame after it closes. Transparent pause/upgrade overlays keep their existing background. |
| Bound temporary air-light buffers | Track source bounds and previous-frame work, clear removed lights, and clip blur, mask, and composites to conservative device-pixel regions. Dense coverage keeps the full-screen path. The original downsample phase is preserved at fractional device scales; rescaling cropped buffers was deliberately avoided. Offscreen soft-light sources are rejected conservatively. |
| Cache fixed-fixture paths | Cache screen-space `Path2D` objects by immutable fixture polygon identity and camera parameters. Shadow retracing replaces the polygon, invalidating its entry. Dynamic soldier/muzzle paths remain dynamic. Moving cameras use the original path submission to avoid per-fixture allocation churn. World-space native transforms were rejected after they changed edge pixels at fractional zoom. |
| Query visible room lights in original order | Share a spatial query across fixture preparation, panel rendering, room washes/Blight glows, and lighting passes. Bounds include halos and clipped room extents. Candidate indices are deduplicated and sorted to preserve opaque recess painter order. Wide overviews retain a full-list fallback; generation and appends rebuild the index. |
| Coalesce floor-shadow repaint bursts | Queue exact local floor rectangles in eight-cell tiles, merge overlapping changes, and flush before update, floor drawing, or thumbnail drawing. Sparse edits retain small bounds; repeated destruction/growth no longer repaints the same neighbors for every event. Full regeneration clears queued work. |
| Defer and reuse map tile canvases | The hidden map no longer constructs 81 tile canvases before it is opened. Reopening the same world reuses tiles/canvases and redraws state; world changes rebuild the grid and tabs. Original generated-world thumbnail semantics are preserved. |
| Cull offscreen Prism segments | Reject the entire segment bounds, including reflection markers, while retaining beams crossing the screen with both endpoints outside it. |
| Correct large-effect viewport bounds | Sniper/rocket/pistol trails use the entire segment; slashes reach their own width-based culling; particles use their size or spark segment; goo uses the bounded rotated spring outline and mine glow radius. These fixes intentionally restore visible edge pixels that the previous fixed center margins discarded. They match an uncropped baseline oracle. |

## Frame measurements

The archived baseline application and optimized application were served through the same Vite server and Chromium. The matrix contains five worlds × two device profiles × four scenes: spawn, stationary overview, moving synthetic combat, and stationary detail. Desktop is 1440×900 at device scale 1; mobile is an emulated 390×844 at scale 2 on the same cloud machine. Zooms are 1.13, 0.5, and 4. Combat uses 20 stationary soldiers, active muzzle lights/particles, and 400 smoke particles while the camera moves. Simulation does not advance.

Each scenario warms up and measures 30 animation frames. The render clock is fixed to keep fixture flickering identical; real clocks measure durations. CPU frame preparation includes visibility/shadow preparation, terrain updates, rendering, and throttled HUD work. Nested pass timings distinguish inclusive and exclusive time. Canvas operation counts are captured separately, outside timed frames. Main-menu frames are sampled from the real automatic loops.

CPU submission times and rAF intervals are reported separately. They are not GPU timings, end-to-end simulation costs, physical-phone performance, or a 60 FPS guarantee. With 30 samples, p99 is the maximum sample. Runs are sequential and there is no multi-run confidence interval. Browser raster work, GC, and scheduling can cause outliers. Pixel readbacks are separate tests.

| Scene family | Median paired change in scenario CPU p50 | Median paired change in scenario CPU p95 |
|---|---:|---:|
| spawn | -70.0% | -62.3% |
| overview | -83.0% | -79.0% |
| combat-moving | -32.5% | -38.4% |
| detail | -89.3% | -78.5% |

These are medians of paired per-scenario percentage changes, not pooled frame percentiles. Quiet forest/city/mothership views account for much of the gain because unnecessary air-buffer work disappears. Fixture-heavy lab overviews still dominate and some individual measurements regress. A paired, interleaved lighting ablation revisited three such cases with 45 frames per variant; it found small differences rather than a reliable broad lab-view speedup. The cached path was slightly faster than dynamic submission in those probes, while the original versus optimized full-lighting differences remained close to noise.

### Other measured work

| Workload | Before | After |
|---|---:|---:|
| 10 terrain edits: mutation + required floor work, CPU p50 | 0.2 ms | 0.1 ms |
| 100 terrain edits: mutation + required floor work, CPU p50 | 1.2 ms | 0.3 ms |
| 1000 terrain edits: mutation + required floor work, CPU p50 | 5.8 ms | 1.0 ms |
| 1,000-edit burst: floor paint calls per trial | 1000 | 25 |
| Five same-world map reopenings, CPU total | 119.9 ms | 6.7 ms |
| Full offscreen Prism pool (256 segments), CPU p95 across zoom probes | 0.8–0.9 ms | ≤0.1 ms |

Terrain trials include the deferred floor flush, so work was not merely moved outside the measurement. There are ten burst trials per size. Weapon submission probes use 60 samples at each zoom; sub-0.1 ms results are below this timer’s useful resolution and visible-pool p99 includes large browser/raster outliers. Those microbenchmarks are not game frame times. The map probe measures five rebuild/reuse operations, not a statistical distribution.

| Main-menu device | Hidden game draws before / after, over 40 sampled frames | Hidden game draw CPU before, per call |
|---|---:|---:|
| desktop | 40 / 0 | 9.51 ms |
| mobile | 40 / 0 | 13.55 ms |

## Remaining major opportunities, ranked

| Priority | Opportunity and evidence | Concrete next step and required validation |
|---|---|
| 1 | **Dense full-screen lighting and blur.** Source bounds cover the viewport in fixture-heavy overviews/combat, so the conservative fallback still processes full-resolution layers. In the optimized desktop lab combat sample, blur alone used about 17.7 ms/frame and air masking/compositing another 7.5 ms exclusive. Lab overview/dense combat frame times remain high. | Prototype a lower-resolution air-light layer behind an explicit quality option while retaining a full-resolution terrain cutout, or a GPU light-composite path if GPU profiling supports it. Compare pixel/perceptual changes and CPU/GPU frame percentiles on actual target devices. This changes fidelity and should not be disguised as a pixel-identical cache. |
| 2 | **Dynamic shadow reuse and geometry search.** Visible muzzle and soldier/room polygons are prepared every display frame, even when inputs are unchanged. Optimized dense lab preparation spent about 3.8 ms in muzzle visibility and 1.8 ms in soft-light preparation. | Cache transient/static light polygons against source pose, local geometry revisions, occluder poses/shapes, and quality. Reuse fixture-style local invalidation rather than a whole-world stamp. Validate moving occluders, destruction/growth, new flashes, camera admission/shadow budgets, and generation. |
| 3 | **Moving floor/mask cache work.** Camera movement invalidates the floor-view and terrain mask caches; distant geometry changes still advance a global mask revision. The optimized dense desktop lab sample spent about 2.3 ms/frame in floor drawing. | First restrict stationary mask invalidation to visible chunks. Then prototype integer-device-pixel scroll reuse plus newly exposed strips. Fractional pan/zoom and chunk snapping need exact pixel checks; do not reuse a shifted raster blindly. |
| 4 | **World preparation and pristine map thumbnails.** Full terrain/floor rebuilds and photographing every sector are synchronous. The measured world-preparation passes still range from roughly 0.35 to 1.12 seconds; thumbnail work alone is a material part of that. | Memoize identical generation inputs where safe, or move generation/raster work off the interactive path. Preserve the existing semantics: thumbnails represent the freshly generated world, not an arbitrarily damaged world first opened later. Cover profile seeds, conquered sectors, spawn changes, and rectangular worlds. |
| 5 | **Large backing-store footprint.** Terrain chunks and the full floor atlas each have 7,225,344 pixels (28,901,376 bytes at four bytes/pixel), before light buffers, masks, edges, sprites, and thumbnails. The hidden map’s duplicate 81 tile canvases are now deferred, but the core atlases remain. | Measure real browser/GPU memory and target-device pressure, then consider tiled/lazy floor and albedo residency and bounded thumbnail caches. Keep full-world thumbnail generation in the design; otherwise it can force all supposedly lazy tiles back into memory. |
| 6 | **Quality control observes only part of the problem.** The existing adaptive shadow budget measures polygon preparation, not the dominant blur/composite/raster costs. | Measure separate simulation, shadow-preparation, render-submission, and presentation budgets. An explicit automatic rendering-quality option could react to sustained render cost with hysteresis; retain manual quality controls and test fidelity changes. |

These remaining items are identified and supported by source inspection/profile evidence; they have not been implemented or assigned speculative percentage benefits. They are the major next targets, rather than a reason to keep rewriting already cheap passes.

### Reviewed without evidence for another major rewrite

- Fog already scans visible tiles and uploads changed alpha regions; terrain outlines and Blight edge masks already distinguish HP artwork from geometry, and edge animation is bounded/cullable. Boundary textures and portal noise sources are already cached. These were preserved and their regressions rerun.
- Doors have viewport rejection before per-cell painting. Creature rendering has bounded segment counts and existing visible-region rejection. Procedural creature batching/atlases and more active-pool indices remain conditional on a representative creature/projectile workload proving a bottleneck; the measured ordinary scenes do not justify a renderer-wide entity-index rewrite.
- Circuit segments already test their whole segment. Orbit, debris, drones, burst particles, goo, and other weapon passes were inspected; Prism and the demonstrated large-effect clipping paths were addressed. Smaller fixed margins/rare shape combinations should keep regression coverage as effects evolve; this is not a claim that every possible edge case has been proven.
- HUD work is already throttled to 80 ms. Twenty forced updates took about 1.9 ms total and produced 400 mutation records. Unchanged-value checks could reduce DOM churn, but this is not a leading frame-time cost in the samples.
- The default upgrade tree’s static circuit draw measured about 0.1 ms p50 / 0.2 ms p95 for 22 nodes. Caching its static links is plausible but not a major current target. Its overlay is translucent, so the opaque-main-menu skip must not be copied there without a visual decision.
- Screen transitions already use a coarse raster and unchanged-key suppression. A blanket WebGL/worker rewrite is not supported by the current evidence; native GPU/compositor traces and real device checks remain outside this audit.

## Validation

- **539 unit tests passed across 74 files**, plus production type check/build (the existing bundle-size warning remains). New unit coverage exercises ordered light queries, halo/room bounds, regeneration, conservative work regions, and sparse/coalesced floor updates.
- **252 lighting/floor pixel comparisons** against the original pipeline, with 52 bounded cases. Coverage includes all worlds, scales 1/1.25/2, zoom 0.5/1.13/3.71, camera changes, soft shadows, fixture destruction/retracing, overlapping/removing sources, scatter, resizing, and floor bursts. Zero differing channels.
- **312 effect pixel comparisons** against an original draw with only its incorrect center rejection removed. Scales 1/1.25/2 and zooms 0.5/1.13/4/8 cover visible tracer tails, crescents, sparks, smoke/bursts, rotated goo, and mine glows on both viewport sides. Zero differences from the uncropped oracle. Restored edge pixels intentionally differ from the old clipped application.
- **183 map tile comparisons**, first-open deferral, same-world canvas identity reuse, and rectangular world switching passed. **80 existing/Prism checks** include crossing segments and reflection markers. Zero pixel differences from their references.
- Existing render-cache, terrain-rebuild, fixture-falloff, wall-upload, menu, and broad weapon browser checks passed. The weapon test additionally runs 600 simulated/rendered weapon frames and 1,800 extra stress frames per desktop/mobile profile; these are weapon-pass checks, not whole-game FPS claims.
- The broad weapon check initially failed on both the archived baseline and optimized application because its setup did not mark the now-required gold special-upgrade blocks found. Its all-weapons fixture was corrected to represent that progression state. Original purchase/render assertions were retained; progression code was not changed.

## Reproduce

Use Node 24, installed dependencies, Chromium/Playwright as used by the existing browser scripts, and a running Vite server. Run timings without competing builds/tests. The baseline commit must be present locally; the scripts archive it into ignored temporary directories and remove them afterward. They do not create Git worktrees.

```bash
npm test
npm run build
npm run dev -- --host 0.0.0.0 --port 5173 --strictPort
# In another terminal, sequentially:
BREACH_AUDIT_REF=4bb50da BREACH_AUDIT_REPORT=/tmp/render-before.json node scripts/render-pipeline-audit.cjs
BREACH_AUDIT_REPORT=/tmp/render-after.json node scripts/render-pipeline-audit.cjs
node scripts/render-lighting-ablation.cjs
node scripts/render-workload-audit.cjs
node scripts/lighting-pipeline-smoke.cjs
node scripts/effect-bounds-smoke.cjs
node scripts/labmap-render-smoke.cjs
BREACH_BASELINE_REF=4bb50da BREACH_CHECK_ONLY=1 node scripts/render-active-benchmark.cjs
npm run test:menu-browser
npm run test:weapon-browser
```

The timing matrix supports `BREACH_AUDIT_SAMPLES`, `BREACH_AUDIT_WORLDS`, and `BREACH_AUDIT_REPORT`; the browser scripts accept `BREACH_BASE_URL` and `BREACH_CHROMIUM`. Baseline oracles use `BREACH_BASELINE_REF` when comparing another known revision.

## Complete frame matrix

CPU cells show **p50 / p95 / p99 milliseconds**; rAF cells show the same presentation-interval percentiles. Individual regressions and outliers are retained.

| World | Device | Scene | CPU before | CPU after | rAF before | rAF after |
|---:|---|---|---:|---:|---:|---:|
| 1 | desktop | spawn | 15.8 / 17.1 / 19.3 | 10.5 / 15.6 / 20.7 | 33.3 / 33.4 / 183.4 | 16.7 / 33.4 / 133.4 |
| 1 | desktop | overview | 27.6 / 39.1 / 40.5 | 29.9 / 33.1 / 33.9 | 50.0 / 83.3 / 300.0 | 50.0 / 66.7 / 283.3 |
| 1 | desktop | combat-moving | 51.2 / 63.3 / 69.2 | 48.1 / 62.4 / 65.0 | 83.3 / 99.9 / 433.3 | 66.7 / 99.9 / 483.3 |
| 1 | desktop | detail | 18.7 / 21.2 / 21.5 | 18.6 / 24.5 / 29.0 | 33.3 / 33.4 / 100.0 | 33.3 / 50.0 / 99.9 |
| 2 | desktop | spawn | 13.6 / 15.0 / 15.2 | 15.0 / 20.7 / 27.9 | 33.3 / 33.4 / 133.3 | 33.3 / 50.1 / 149.9 |
| 2 | desktop | overview | 26.6 / 29.9 / 31.5 | 24.4 / 33.2 / 36.7 | 50.0 / 66.6 / 250.0 | 50.0 / 66.6 / 266.7 |
| 2 | desktop | combat-moving | 48.0 / 53.3 / 74.8 | 42.1 / 50.3 / 80.3 | 66.7 / 100.0 / 316.6 | 66.7 / 100.0 / 350.0 |
| 2 | desktop | detail | 12.0 / 13.7 / 15.9 | 12.8 / 16.7 / 17.2 | 16.7 / 33.4 / 83.4 | 33.3 / 33.4 / 83.2 |
| 3 | desktop | spawn | 9.4 / 10.1 / 10.3 | 1.8 / 2.4 / 2.7 | 16.7 / 33.3 / 99.9 | 16.7 / 16.7 / 50.1 |
| 3 | desktop | overview | 10.3 / 10.6 / 12.7 | 1.5 / 2.2 / 2.3 | 16.7 / 33.4 / 66.6 | 16.7 / 16.8 / 66.7 |
| 3 | desktop | combat-moving | 34.7 / 38.6 / 65.9 | 20.6 / 21.8 / 22.0 | 50.0 / 66.7 / 266.7 | 33.3 / 50.1 / 183.4 |
| 3 | desktop | detail | 8.8 / 10.2 / 17.4 | 0.9 / 2.4 / 4.0 | 16.7 / 33.4 / 100.0 | 16.7 / 16.8 / 50.1 |
| 4 | desktop | spawn | 9.6 / 10.9 / 12.2 | 2.6 / 3.4 / 3.5 | 16.7 / 33.4 / 116.6 | 16.7 / 16.8 / 83.3 |
| 4 | desktop | overview | 10.3 / 10.9 / 11.2 | 1.6 / 2.1 / 2.2 | 16.7 / 33.4 / 149.9 | 16.7 / 16.8 / 83.3 |
| 4 | desktop | combat-moving | 33.6 / 40.6 / 48.3 | 20.2 / 21.2 / 23.5 | 50.0 / 66.8 / 266.7 | 33.3 / 50.1 / 216.7 |
| 4 | desktop | detail | 9.0 / 10.6 / 10.7 | 1.0 / 1.5 / 1.5 | 16.7 / 33.4 / 83.3 | 16.7 / 16.8 / 50.0 |
| 5 | desktop | spawn | 8.7 / 11.1 / 46.5 | 1.5 / 2.3 / 2.4 | 16.7 / 66.7 / 116.6 | 16.7 / 16.8 / 66.6 |
| 5 | desktop | overview | 9.2 / 11.3 / 12.0 | 1.7 / 2.4 / 2.5 | 16.7 / 33.4 / 100.0 | 16.7 / 16.8 / 66.7 |
| 5 | desktop | combat-moving | 33.3 / 40.6 / 63.7 | 17.8 / 23.4 / 31.7 | 50.0 / 83.4 / 250.1 | 33.3 / 50.0 / 183.3 |
| 5 | desktop | detail | 8.8 / 10.5 / 10.8 | 0.9 / 1.3 / 1.4 | 16.7 / 33.4 / 100.0 | 16.7 / 16.8 / 50.0 |
| 1 | mobile | spawn | 14.8 / 24.9 / 26.3 | 10.4 / 11.0 / 12.0 | 33.3 / 50.0 / 150.0 | 16.7 / 33.4 / 133.3 |
| 1 | mobile | overview | 22.1 / 31.4 / 110.9 | 18.7 / 20.3 / 27.1 | 33.4 / 133.2 / 250.0 | 33.3 / 50.0 / 200.0 |
| 1 | mobile | combat-moving | 56.5 / 83.7 / 85.0 | 43.8 / 49.0 / 69.1 | 83.3 / 116.7 / 433.3 | 66.6 / 83.4 / 433.3 |
| 1 | mobile | detail | 27.6 / 40.6 / 47.4 | 27.3 / 29.2 / 30.1 | 33.4 / 66.7 / 216.6 | 33.4 / 50.1 / 200.1 |
| 2 | mobile | spawn | 13.6 / 16.9 / 18.8 | 12.4 / 21.0 / 22.1 | 33.3 / 33.4 / 133.4 | 33.3 / 33.4 / 200.0 |
| 2 | mobile | overview | 20.2 / 23.6 / 72.7 | 18.0 / 20.5 / 20.7 | 33.4 / 83.4 / 216.7 | 33.3 / 50.0 / 166.6 |
| 2 | mobile | combat-moving | 56.4 / 69.6 / 78.1 | 35.7 / 37.1 / 59.0 | 83.3 / 116.7 / 450.0 | 50.0 / 83.4 / 300.0 |
| 2 | mobile | detail | 14.6 / 19.7 / 21.1 | 13.3 / 13.6 / 13.7 | 33.3 / 33.4 / 66.6 | 33.3 / 33.4 / 133.3 |
| 3 | mobile | spawn | 10.0 / 12.5 / 15.1 | 2.6 / 3.1 / 4.0 | 16.7 / 33.4 / 116.6 | 16.7 / 16.8 / 66.7 |
| 3 | mobile | overview | 9.6 / 12.8 / 13.4 | 1.1 / 1.7 / 2.4 | 16.7 / 33.4 / 100.0 | 16.7 / 16.7 / 16.8 |
| 3 | mobile | combat-moving | 43.6 / 47.8 / 51.5 | 32.6 / 38.5 / 47.1 | 66.6 / 83.4 / 333.2 | 50.0 / 66.6 / 316.7 |
| 3 | mobile | detail | 9.1 / 9.8 / 9.8 | 0.9 / 1.9 / 3.6 | 16.7 / 33.4 / 99.9 | 16.7 / 33.3 / 50.0 |
| 4 | mobile | spawn | 10.0 / 12.2 / 12.5 | 3.3 / 5.6 / 6.7 | 16.7 / 33.4 / 116.5 | 16.7 / 16.7 / 83.3 |
| 4 | mobile | overview | 8.8 / 9.3 / 9.5 | 1.0 / 1.5 / 2.5 | 16.7 / 33.4 / 100.0 | 16.7 / 16.7 / 16.7 |
| 4 | mobile | combat-moving | 42.3 / 52.5 / 82.8 | 30.2 / 33.9 / 34.0 | 66.6 / 100.0 / 316.7 | 50.0 / 50.1 / 299.9 |
| 4 | mobile | detail | 9.0 / 10.1 / 27.5 | 0.8 / 1.1 / 8.2 | 16.7 / 33.4 / 66.8 | 16.7 / 16.8 / 49.9 |
| 5 | mobile | spawn | 9.6 / 10.7 / 16.6 | 2.1 / 3.1 / 3.3 | 16.7 / 33.4 / 99.9 | 16.7 / 16.8 / 66.7 |
| 5 | mobile | overview | 9.5 / 12.8 / 29.5 | 0.9 / 1.8 / 2.0 | 16.7 / 83.3 / 83.4 | 16.7 / 16.8 / 16.8 |
| 5 | mobile | combat-moving | 40.1 / 43.5 / 43.5 | 25.5 / 29.6 / 58.1 | 50.1 / 83.3 / 300.0 | 33.4 / 83.3 / 216.7 |
| 5 | mobile | detail | 8.5 / 10.8 / 14.4 | 0.8 / 1.2 / 1.4 | 16.7 / 33.4 / 33.5 | 16.7 / 16.8 / 16.8 |
