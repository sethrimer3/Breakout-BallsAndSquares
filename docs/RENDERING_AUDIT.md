# Rendering audit and validated changes

For exact lighting-mask reuse during camera movement, see [scrolling mask results](SCROLL_MASK_CACHE.md).

For regional lighting-mask updates during active growth, see [opacity region results](OPACITY_REGION_CACHE.md).

For the later surface-geometry and automatic-quality fixes, see [surface outline results](SURFACE_OUTLINE_CACHE.md).

For the later real-replication profile and terrain fixes, see [active Blight growth results](FAST_GROWTH_RENDERING.md).

This pass audits the complete render pipeline and its preparation work across all five worlds, implements the validated improvements below, and ranks the remaining major targets.

Baseline: `a56afb14e409df923b807bb30665faa27f5d7d21`, the latest incoming phone-rendering implementation. The optimized source is committed with this report; its SHA-256 is `66f937e173d61cfd6a3c0570a8aa55daf71542c43b8e9d7fc4b167cfc9978bc3`. Complete measurements, pixel records, and validation results are in [RENDERING_AUDIT_DATA.json](RENDERING_AUDIT_DATA.json).

## Integration with latest main

Main advanced during this audit. The final code preserves its automatic resolution governor, fixed quality caps, CSS vignette, direct primary ambient/lightmap pass, and last-frame policy for paused full menus. Temporary-buffer cropping therefore applies to muzzle scatter; the superseded two-buffer primary experiment is not reinstated. Empty primary views instead reuse the exact upstream composite, including its screen-edge blur. This report compares the final merged code with the incoming commit, at fixed high resolution. Earlier pre-merge experiments are retained in commit 7e90bfe and are not the final numbers below.

## Implemented

| Change | Evidence and behavior |
|---|---|
| Stop rendering behind the opaque main menu | The initial working tree rendered a hidden game behind the menu. Incoming main already caches paused full-menu frames; the final merge additionally skips chunk work under the opaque main menu and preserves its independent gameplay backdrop. All game rendering resumes when it closes. Other menus retain the incoming last-frame policy, including resize redraws. |
| Bound temporary air-light buffers | Track muzzle-scatter source bounds and previous-frame work, clear removed lights, and clip blur, mask, and composites to conservative device-pixel regions. Dense scatter keeps the full-screen path. Preserve the original downsample phase at fractional scales. The incoming primary pass remains direct; an exact empty-view cache skips it when there are no possible contributing lights, growth glows, or room lights. Camera, mask/opacity, ambient, size/density, soft-shadow changes and new lights invalidate reuse. |
| Cache fixed-fixture paths | Cache screen-space `Path2D` objects by immutable fixture polygon identity and camera parameters. Shadow retracing replaces the polygon, invalidating its entry. Dynamic soldier/muzzle paths remain dynamic. Moving cameras use the original path submission to avoid per-fixture allocation churn. World-space native transforms were rejected after they changed edge pixels at fractional zoom. |
| Query visible room lights in original order | Share a spatial query across fixture preparation, panel rendering, room washes/Blight glows, and lighting passes. Bounds include halos and clipped room extents. Candidate indices are deduplicated and sorted to preserve opaque recess painter order. Wide overviews retain a full-list fallback; generation and appends rebuild the index. |
| Coalesce floor-shadow repaint bursts | Queue exact local floor rectangles in eight-cell tiles, merge overlapping changes, and flush before update, floor drawing, or thumbnail drawing. Sparse edits retain small bounds; repeated destruction/growth no longer repaints the same neighbors for every event. Full regeneration clears queued work. |
| Defer and reuse map tile canvases | The hidden map no longer constructs 81 tile canvases before it is opened. Reopening the same world reuses tiles/canvases and redraws state; world changes rebuild the grid and tabs. Original generated-world thumbnail semantics are preserved. |
| Cull offscreen Prism segments | Reject the entire segment bounds, including reflection markers, while retaining beams crossing the screen with both endpoints outside it. |
| Correct large-effect viewport bounds | Sniper/rocket/pistol trails use the entire segment; slashes reach their own width-based culling; particles use their size or spark segment; goo uses the bounded rotated spring outline and mine glow radius. These fixes intentionally restore visible edge pixels that the previous fixed center margins discarded. They match an uncropped baseline oracle. |

## Frame measurements

The archived baseline application and optimized application were served through the same Vite server and Chromium. The matrix contains five worlds × two device profiles × four scenes: spawn, stationary overview, moving synthetic combat, and stationary detail. Desktop is 1440×900 at device scale 1; mobile is an emulated 390×844 at scale 2 on the same cloud machine. Render quality is pinned to high in both applications so automatic resolution changes cannot distort the comparison. Zooms are 1.13, 0.5, and 4. Combat uses 20 stationary soldiers, active muzzle lights/particles, and 400 smoke particles while the camera moves. Simulation does not advance.

Each scenario warms up and measures 30 animation frames. The render clock is fixed to keep fixture flickering identical; real clocks measure durations. CPU frame preparation includes visibility/shadow preparation, terrain updates, rendering, and throttled HUD work. Nested pass timings distinguish inclusive and exclusive time. Canvas operation counts are captured separately, outside timed frames. Main-menu frames are sampled from the real automatic loops.

CPU submission times and rAF intervals are reported separately. They are not GPU timings, end-to-end simulation costs, physical-phone performance, or a 60 FPS guarantee. With 30 samples, p99 is the maximum sample. Runs are sequential and there is no multi-run confidence interval. Browser raster work, GC, and scheduling can cause outliers. Pixel readbacks are separate tests.

| Scene family | Median paired change in scenario CPU p50 | Median paired change in scenario CPU p95 |
|---|---:|---:|
| spawn | -1.1% | +2.8% |
| overview | -80.0% | -73.3% |
| combat-moving | -9.8% | -7.2% |
| detail | -89.9% | -59.5% |

These are medians of paired per-scenario percentage changes, not pooled frame percentiles. Quiet forest/city/mothership views account for much of the gain because the exact empty-view ambient cache removes repeated primary work. Fixture-heavy lab overviews still dominate and some individual measurements regress. A paired, interleaved lighting ablation revisited three such cases with 45 frames per variant; it found small differences rather than a reliable broad lab-view speedup. Stationary path caching had small mixed gains versus dynamic submission; the paired lighting variants and their outliers are recorded, rather than claiming a universal lab-view speedup.

### Other measured work

| Workload | Before | After |
|---|---:|---:|
| 10 terrain edits: mutation + required floor work, CPU p50 | 0.2 ms | 0.1 ms |
| 100 terrain edits: mutation + required floor work, CPU p50 | 1.2 ms | 0.3 ms |
| 1000 terrain edits: mutation + required floor work, CPU p50 | 5.8 ms | 1.0 ms |
| 1,000-edit burst: floor paint calls per trial | 1000 | 25 |
| Five same-world map reopenings, CPU total | 45.7 ms | 5.7 ms |
| Full offscreen Prism pool (256 segments), CPU p95 across zoom probes | 0.8–0.9 ms | ≤0.1 ms |

Terrain trials include the deferred floor flush, so work was not merely moved outside the measurement. There are ten burst trials per size. Weapon submission probes use 60 samples at each zoom; sub-0.1 ms results are below this timer’s useful resolution and visible-pool p99 includes large browser/raster outliers. Those microbenchmarks are not game frame times. The map probe measures five rebuild/reuse operations, not a statistical distribution.

| Main-menu device | Hidden game draws before / after, over 40 sampled frames | Terrain updates before / after |
|---|---:|---:|
| desktop | 0 / 0 | 40 / 0 |
| mobile | 0 / 0 | 40 / 0 |

## Remaining major opportunities, ranked

| Priority | Opportunity and evidence | Concrete next step and required validation |
|---|---|---|
| 1 | **Dense full-screen lighting and blur.** The primary lightmap remains full-resolution; dense scatter also takes the full-screen fallback. In the optimized desktop lab combat sample, blur alone used about 16.3 ms/frame and the rest of renderLighting about 17.1 ms exclusive (primary work, gradients and composition). Lab overview/dense combat frame times remain high. | The incoming resolution governor already reduces whole-canvas density. Next, prototype a lower-resolution primary light layer that preserves full-resolution albedo/masks, or a GPU light-composite path if GPU profiling supports it. Stable nonempty primary layers could also be cached with complete input invalidation. Compare pixel/perceptual changes and CPU/GPU frame percentiles on actual target devices. This changes fidelity and should not be disguised as a pixel-identical cache. |
| 2 | **Dynamic shadow reuse and geometry search.** Visible muzzle and soldier/room polygons are prepared every display frame, even when inputs are unchanged. Optimized dense lab preparation spent about 3.9 ms in muzzle visibility and 1.8 ms in soft-light preparation. | Cache transient/static light polygons against source pose, local geometry revisions, occluder poses/shapes, and quality. Reuse fixture-style local invalidation rather than a whole-world stamp. Validate moving occluders, destruction/growth, new flashes, camera admission/shadow budgets, and generation. |
| 3 | **Moving floor/mask cache work.** Camera movement invalidates the floor-view and terrain mask caches; distant geometry changes still advance a global mask revision. The optimized dense desktop lab sample spent about 2.1 ms/frame in floor drawing. | First restrict stationary mask invalidation to visible chunks. Then prototype integer-device-pixel scroll reuse plus newly exposed strips. Fractional pan/zoom and chunk snapping need exact pixel checks; do not reuse a shifted raster blindly. |
| 4 | **World preparation and pristine map thumbnails.** Full terrain/floor rebuilds and photographing every sector are synchronous. The measured world-preparation passes still range from several hundred milliseconds to over a second; thumbnail work alone is a material part of that. | Memoize identical generation inputs where safe, or move generation/raster work off the interactive path. Preserve the existing semantics: thumbnails represent the freshly generated world, not an arbitrarily damaged world first opened later. Cover profile seeds, conquered sectors, spawn changes, and rectangular worlds. |
| 5 | **Large backing-store footprint.** Terrain chunks and the full floor atlas each have 7,225,344 pixels (28,901,376 bytes at four bytes/pixel), before light buffers, masks, edges, sprites, and thumbnails. The hidden map’s duplicate 81 tile canvases are now deferred, but the core atlases remain. | Measure real browser/GPU memory and target-device pressure, then consider tiled/lazy floor and albedo residency and bounded thumbnail caches. Keep full-world thumbnail generation in the design; otherwise it can force all supposedly lazy tiles back into memory. |
| 6 | **Quality tuning on real devices.** Incoming main now has a frame-interval density governor and fixed quality controls, in addition to the older shadow-preparation budget. | The missing controller has been addressed upstream, not left as unimplemented work. Validate its thresholds and fidelity on real phones, CPU-bound runs, capped displays and thermal/battery conditions. Keep separate render/shadow/simulation attribution when tuning it. |

These are the major follow-up targets supported by this audit. Further performance benefits need measurement. The resolution controller is already implemented; its remaining work is real-device validation and tuning.

### Reviewed without evidence for another major rewrite

- Fog already scans visible tiles and uploads changed alpha regions; terrain outlines and Blight edge masks already distinguish HP artwork from geometry, and edge animation is bounded/cullable. Boundary textures and portal noise sources are already cached. These were preserved and their regressions rerun.
- Doors have viewport rejection before per-cell painting. Creature rendering has bounded segment counts and existing visible-region rejection. Procedural creature batching/atlases and more active-pool indices remain conditional on a representative creature/projectile workload proving a bottleneck; the measured ordinary scenes do not justify a renderer-wide entity-index rewrite.
- Circuit segments already test their whole segment. Orbit, debris, drones, burst particles, goo, and other weapon passes were inspected; Prism and the demonstrated large-effect clipping paths were addressed. Smaller fixed margins/rare shape combinations should keep regression coverage as effects evolve; this is not a claim that every possible edge case has been proven.
- HUD work is already throttled to 80 ms. Twenty forced updates took about 1.9 ms total and produced 400 mutation records. Unchanged-value checks could reduce DOM churn, but this is not a leading frame-time cost in the samples.
- The default upgrade tree’s static circuit draw measured about 0.1 ms p50 / 0.2 ms p95 for 22 nodes. Caching its static links is plausible but not a major current target. Its overlay is translucent, and its paused background follows the incoming cached-frame policy; further changes must preserve that policy.
- Screen transitions already use a coarse raster and unchanged-key suppression. A blanket WebGL/worker rewrite is not supported by the current evidence; native GPU/compositor traces and real device checks remain outside this audit.

## Validation

- **545 unit tests passed across 75 files**, plus production type check/build (the existing bundle-size warning remains). New unit coverage exercises ordered light queries, halo/room bounds, regeneration, conservative work regions, and sparse/coalesced floor updates.
- **258 lighting/floor pixel comparisons** against the incoming pipeline, with 6 bounded-scatter cases and 6 verified empty-result reuse cases. Coverage includes all worlds, scales 1/1.25/2, zoom 0.5/1.13/3.71, camera changes, soft shadows, fixture destruction/retracing, overlapping/removing sources, scatter, resizing, and floor bursts. Zero differing channels.
- **312 effect pixel comparisons** against an original draw with only its incorrect center rejection removed. Scales 1/1.25/2 and zooms 0.5/1.13/4/8 cover visible tracer tails, crescents, sparks, smoke/bursts, rotated goo, and mine glows on both viewport sides. Zero differences from the uncropped oracle. Restored edge pixels intentionally differ from the old clipped application.
- **183 map tile comparisons**, first-open deferral, same-world canvas identity reuse, and rectangular world switching passed. **80 existing/Prism checks** include crossing segments and reflection markers. Zero pixel differences from their references.
- Fixed low/medium/high density mappings (1 / 1.25 / 2), backing-size/redraw flags, and an automatic step to 1.5 after sustained slow samples passed in the browser.
- Existing render-cache, terrain-rebuild, fixture-falloff, wall-upload, menu, and broad weapon browser checks passed. The weapon test additionally runs 600 simulated/rendered weapon frames and 1,800 extra stress frames per desktop/mobile profile; these are weapon-pass checks, not whole-game FPS claims.
- The broad weapon check initially failed on both the archived baseline and optimized application because its setup did not mark the now-required gold special-upgrade blocks found. Its all-weapons fixture was corrected to represent that progression state. Original purchase/render assertions were retained; progression code was not changed.

## Reproduce

Use Node 24, installed dependencies, Chromium/Playwright as used by the existing browser scripts, and a running Vite server. Run timings without competing builds/tests. The baseline commit must be present locally; the scripts archive it into ignored temporary directories and remove them afterward. They do not create Git worktrees.

```bash
npm test
npm run build
npm run dev -- --host 0.0.0.0 --port 5173 --strictPort
# In another terminal, sequentially:
BREACH_AUDIT_REF=a56afb1 BREACH_AUDIT_REPORT=/tmp/render-before.json node scripts/render-pipeline-audit.cjs
BREACH_AUDIT_REPORT=/tmp/render-after.json node scripts/render-pipeline-audit.cjs
node scripts/render-lighting-ablation.cjs
node scripts/render-workload-audit.cjs
node scripts/lighting-pipeline-smoke.cjs
node scripts/effect-bounds-smoke.cjs
node scripts/labmap-render-smoke.cjs
BREACH_BASELINE_REF=a56afb1 BREACH_CHECK_ONLY=1 node scripts/render-active-benchmark.cjs
npm run test:menu-browser
npm run test:weapon-browser
```

The timing matrix supports `BREACH_AUDIT_SAMPLES`, `BREACH_AUDIT_WORLDS`, and `BREACH_AUDIT_REPORT`; the browser scripts accept `BREACH_BASE_URL` and `BREACH_CHROMIUM`. Baseline oracles use `BREACH_BASELINE_REF` when comparing another known revision.

## Complete frame matrix

CPU cells show **p50 / p95 / p99 milliseconds**; rAF cells show the same presentation-interval percentiles. Individual regressions and outliers are retained.

| World | Device | Scene | CPU before | CPU after | rAF before | rAF after |
|---:|---|---|---:|---:|---:|---:|
| 1 | desktop | spawn | 14.6 / 19.0 / 22.7 | 13.7 / 18.9 / 46.3 | 33.3 / 50.0 / 150.0 | 33.3 / 50.1 / 133.4 |
| 1 | desktop | overview | 28.6 / 37.4 / 39.7 | 26.2 / 30.9 / 31.9 | 50.0 / 83.3 / 283.3 | 50.0 / 66.8 / 233.3 |
| 1 | desktop | combat-moving | 60.2 / 73.9 / 74.6 | 49.7 / 52.7 / 52.9 | 83.4 / 116.7 / 533.3 | 66.8 / 83.4 / 466.7 |
| 1 | desktop | detail | 18.5 / 29.4 / 53.0 | 17.6 / 19.6 / 21.7 | 33.3 / 66.7 / 149.9 | 33.3 / 50.0 / 133.4 |
| 2 | desktop | spawn | 13.7 / 16.2 / 33.0 | 13.3 / 15.2 / 15.3 | 33.3 / 66.6 / 150.1 | 33.3 / 33.4 / 166.7 |
| 2 | desktop | overview | 28.5 / 32.5 / 37.3 | 24.9 / 35.0 / 42.1 | 50.0 / 66.7 / 283.4 | 50.0 / 66.7 / 283.3 |
| 2 | desktop | combat-moving | 58.0 / 71.5 / 98.8 | 47.8 / 53.4 / 56.7 | 83.3 / 133.4 / 516.6 | 66.7 / 83.5 / 399.9 |
| 2 | desktop | detail | 12.4 / 14.8 / 24.9 | 12.2 / 13.8 / 15.3 | 33.3 / 33.4 / 49.9 | 16.8 / 33.4 / 49.9 |
| 3 | desktop | spawn | 8.8 / 10.9 / 40.9 | 8.6 / 14.3 / 29.8 | 16.7 / 49.9 / 100.0 | 16.7 / 83.3 / 83.3 |
| 3 | desktop | overview | 9.6 / 12.3 / 13.0 | 1.8 / 2.3 / 2.4 | 16.7 / 33.4 / 133.4 | 16.7 / 16.8 / 100.0 |
| 3 | desktop | combat-moving | 39.6 / 46.8 / 76.7 | 32.6 / 43.8 / 82.5 | 50.1 / 100.1 / 283.4 | 50.0 / 100.1 / 249.9 |
| 3 | desktop | detail | 8.3 / 9.1 / 10.0 | 0.6 / 1.0 / 1.0 | 16.7 / 33.4 / 33.4 | 16.7 / 16.8 / 50.0 |
| 4 | desktop | spawn | 9.4 / 10.8 / 12.1 | 10.0 / 11.9 / 15.9 | 16.7 / 33.4 / 116.7 | 16.7 / 66.7 / 133.4 |
| 4 | desktop | overview | 9.4 / 11.1 / 11.5 | 2.0 / 3.5 / 5.3 | 16.7 / 33.4 / 133.3 | 16.7 / 33.3 / 100.0 |
| 4 | desktop | combat-moving | 38.1 / 41.1 / 41.4 | 37.2 / 47.9 / 53.5 | 50.1 / 66.7 / 316.6 | 50.1 / 133.3 / 200.0 |
| 4 | desktop | detail | 8.0 / 9.1 / 10.9 | 0.8 / 1.3 / 1.4 | 16.7 / 50.0 / 100.0 | 16.7 / 16.8 / 50.0 |
| 5 | desktop | spawn | 8.8 / 10.8 / 10.9 | 9.0 / 11.6 / 12.9 | 16.7 / 33.4 / 100.1 | 16.7 / 33.4 / 149.9 |
| 5 | desktop | overview | 9.7 / 11.0 / 79.7 | 1.7 / 2.4 / 2.5 | 16.7 / 100.0 / 100.1 | 16.7 / 16.8 / 66.7 |
| 5 | desktop | combat-moving | 36.3 / 39.3 / 77.6 | 35.9 / 50.6 / 51.9 | 50.0 / 100.0 / 266.7 | 66.6 / 183.3 / 216.7 |
| 5 | desktop | detail | 7.9 / 9.0 / 9.3 | 0.8 / 13.2 / 15.8 | 16.7 / 33.4 / 99.9 | 16.7 / 66.6 / 83.4 |
| 1 | mobile | spawn | 13.4 / 15.0 / 16.4 | 12.9 / 15.2 / 23.1 | 33.3 / 33.4 / 166.6 | 33.2 / 33.4 / 150.1 |
| 1 | mobile | overview | 20.5 / 28.7 / 30.3 | 19.3 / 23.0 / 81.7 | 33.4 / 50.1 / 249.9 | 33.4 / 116.6 / 183.4 |
| 1 | mobile | combat-moving | 54.5 / 62.0 / 93.9 | 51.5 / 57.0 / 95.8 | 66.7 / 116.8 / 416.7 | 66.7 / 116.7 / 466.6 |
| 1 | mobile | detail | 27.5 / 30.0 / 31.4 | 27.7 / 34.6 / 70.6 | 33.4 / 50.1 / 183.3 | 49.9 / 83.3 / 199.9 |
| 2 | mobile | spawn | 13.0 / 19.7 / 21.1 | 13.4 / 15.4 / 19.5 | 33.3 / 33.4 / 150.0 | 33.3 / 33.4 / 166.7 |
| 2 | mobile | overview | 17.8 / 20.9 / 33.2 | 18.1 / 29.0 / 33.6 | 33.3 / 50.1 / 183.3 | 33.3 / 50.1 / 166.6 |
| 2 | mobile | combat-moving | 45.4 / 52.7 / 58.2 | 40.6 / 44.7 / 109.7 | 66.7 / 100.0 / 366.7 | 50.1 / 133.3 / 316.6 |
| 2 | mobile | detail | 12.9 / 14.2 / 16.3 | 13.0 / 14.3 / 14.4 | 33.3 / 33.5 / 49.9 | 33.2 / 33.4 / 50.1 |
| 3 | mobile | spawn | 8.8 / 9.6 / 9.8 | 9.0 / 10.0 / 10.1 | 16.7 / 33.3 / 116.6 | 16.7 / 33.4 / 100.0 |
| 3 | mobile | overview | 8.3 / 9.5 / 10.4 | 1.0 / 1.6 / 2.6 | 16.7 / 33.4 / 33.4 | 16.7 / 16.8 / 66.8 |
| 3 | mobile | combat-moving | 48.4 / 56.3 / 70.1 | 44.4 / 55.6 / 56.0 | 66.7 / 83.4 / 333.3 | 66.7 / 83.4 / 316.6 |
| 3 | mobile | detail | 8.3 / 9.6 / 9.6 | 0.6 / 1.2 / 1.7 | 16.7 / 33.3 / 33.4 | 16.7 / 16.7 / 50.0 |
| 4 | mobile | spawn | 10.0 / 19.0 / 21.0 | 9.9 / 11.1 / 11.4 | 16.7 / 33.4 / 166.6 | 16.7 / 33.4 / 116.6 |
| 4 | mobile | overview | 8.5 / 9.8 / 10.5 | 0.9 / 1.3 / 1.6 | 16.7 / 33.4 / 116.6 | 16.7 / 16.7 / 66.7 |
| 4 | mobile | combat-moving | 47.6 / 52.3 / 55.5 | 43.3 / 56.2 / 63.2 | 66.6 / 100.0 / 333.4 | 66.6 / 116.7 / 366.7 |
| 4 | mobile | detail | 8.3 / 9.9 / 9.9 | 0.6 / 0.9 / 1.4 | 16.7 / 33.4 / 33.4 | 16.7 / 16.8 / 50.0 |
| 5 | mobile | spawn | 8.7 / 10.0 / 10.1 | 8.6 / 11.7 / 16.2 | 16.7 / 33.4 / 99.9 | 16.7 / 33.4 / 116.7 |
| 5 | mobile | overview | 8.7 / 9.6 / 9.7 | 0.9 / 1.5 / 7.3 | 16.7 / 33.4 / 83.4 | 16.7 / 33.4 / 66.7 |
| 5 | mobile | combat-moving | 43.3 / 46.9 / 49.2 | 34.5 / 40.0 / 48.6 | 66.6 / 66.7 / 383.3 | 50.0 / 83.2 / 283.4 |
| 5 | mobile | detail | 8.0 / 9.1 / 9.4 | 0.5 / 0.9 / 1.0 | 16.7 / 33.4 / 33.4 | 16.7 / 16.7 / 50.0 |
