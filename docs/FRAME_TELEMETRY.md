# Investigating the Pixel 9a report

For the subsequent pass timings, correlated workload history and optional browser events, see [render diagnostics schema 3](RENDER_DIAGNOSTICS.md).

The supplied run reports 10 FPS, a last callback work time of 16.2 ms, simulation 5.5 ms, and lighting preparation 0.5 ms. It enables connected-air mapping and has deployed eight soldiers. Its run time is 25.68 seconds; the last growth sample is 38.69 at 25 seconds, below the current overdrive threshold of 70. This is not evidence of maximum-rate replication.

## Confirmed reporting defect

`Game.frame` limits simulation catch-up to a 100 ms delta. The FPS counter incorrectly accumulated that limited delta too. Consequently, steady 200 ms intervals (5 FPS) and 400 ms intervals (2.5 FPS) both displayed 10 FPS. Real callback intervals now drive the counter; simulation limits are unchanged.

The old `frameMs`, `simMs`, and `lightMs` fields describe the latest callback, not average or percentile performance. `lightMs` covers polygon/light preparation, not the whole lighting draw pass. CPU timing does not capture asynchronous GPU execution, compositing/presentation, or all browser scheduling delays. A cheap latest callback can also conceal expensive earlier callbacks. Thus the supplied values do not identify the cause of actual stalls.

## New diagnostics

Exported telemetry retains the existing fields and adds `timing.recentActiveFrames`, a ring of the latest 120 active-gameplay intervals and callback work times summarized as p50/p95/p99/max, sample count, elapsed window and average cadence. It preserves the last gameplay window while paused and starts a new window on resuming; menu frames and cross-pause gaps are excluded. Sampling uses two fixed arrays totaling 1,920 bytes and allocates no per-frame objects. Sorting occurs only when exporting.

`frameMs` now includes work before simulation preparation, such as automatic canvas resizing and speedrun saves. Exports also include requested render quality, actual backing density/dimensions, device density, CSS dimensions, soft-shadow and Bloom settings, Auto governor state, page visibility, pause state, browser user agent and connected-air mapping state. Factory settings currently use Auto quality and disable soft shadows; the user's old log did not include settings or actual density.

## Connected-air control

[Controlled fog profile](PIXEL_FOG_PROFILE.json) uses desktop Chromium 156 with a 412×915 CSS viewport, DPR 2.625 and 4× CPU throttling. It tests eight fog sources for 120 fixed updates in the starting map, then in the same map with a 32×32-cell region opened. It compares mapping disabled/enabled in the same layouts. This control used `98ad791` before integrating incoming main `4167a5c`; it is not a reproduction of the user's map, phone, or GPU behavior.

| Layout | Mapping | Fog p50 / p95 / p99 / max, ms |
| --- | --- | --- |
| Starting map | off | 2.3 / 3.8 / 5.7 / 9.6 |
| Starting map | on | 2.3 / 4.2 / 6.6 / 11.2 |
| Opened region | off | 3.4 / 5.2 / 7.4 / 8.4 |
| Opened region | on | 3.7 / 9.2 / 15.2 / 15.8 |

Mapping adds periodic work in this control, but does not reproduce steady 100+ ms frame intervals. A larger connected component, multiple catch-up steps, browser/GPU delays, or another effect could change the result. No optimization to mapping or automatic graphics policy is made on this evidence. The original log does not establish a GPU bottleneck either.

## Latest-main Bloom control

Incoming main `4167a5c` adds Bloom, enabled by default. Its pass renders emitters again, including Blight edges and facility glows, then blurs a CSS-quarter-resolution buffer and screen-composites over the viewport. The supplied log does not say whether Bloom was enabled or which build produced it.

A [paired static-scene draw control](MOBILE_BLOOM_PROFILE.json) on the integrated renderer uses the same emulated viewport and CPU throttle, eight base-weapon soldiers, default zoom 2.5, Auto's initial density 1.5 and soft shadows disabled. The scene clock is fixed at 25.68 seconds; 90 measured draws per variant alternate order after ten warm-up pairs. This is draw-only CPU timing with frozen simulation and no reproduction of the user's combat workload. Pixel identity is intentionally not expected between effect settings.

| Bloom | Draw CPU p50 / p95 / p99, ms |
| --- | --- |
| off | 93.1 / 173.4 / 317.2 |
| on | 99.6 / 151.4 / 271.4 |

Median draw work is higher with Bloom, while tails are mixed. This does not establish Bloom as the cause of the phone's slowdown; it supplies a concrete setting to compare on the device. Auto adaptation is not exercised by this manual draw control. The exported diagnostics now include Bloom explicitly. The default remains unchanged.

## Validation and next capture

After integrating main `4167a5c`, 696 tests across 95 files, type checking and production build pass. The initial pre-integration checks also passed (676 tests across 93 files). A [browser regression](FRAME_TELEMETRY_REGRESSIONS.json) drives the real `Game.frame` and export path at synthetic 200 ms cadence. It verifies 5 FPS, actual canvas dimensions, pause-history preservation and resume reset. Its work times are incidental; synthetic timestamps are not a presentation benchmark.

Run with Vite on port 5173:

```bash
node scripts/connected-air-profile.cjs
node scripts/frame-telemetry-smoke.cjs
node scripts/mobile-bloom-profile.cjs
npm test
npm run build
```

Capture a new exported log during or immediately after a slowdown on the Pixel. Compare recent interval percentiles with work percentiles and actual render density. This supplies evidence missing from the old log; it still cannot directly measure physical GPU/presentation time. A temporary Bloom-off comparison checks the extra effect pass; a Low-quality comparison checks whether reducing backing pixels helps the affected device.
