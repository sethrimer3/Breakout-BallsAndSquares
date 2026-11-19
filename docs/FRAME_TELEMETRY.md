# Investigating the Pixel 9a report

The supplied run reports 10 FPS, a last callback work time of 16.2 ms, simulation 5.5 ms, and lighting preparation 0.5 ms. It enables connected-air mapping and has deployed eight soldiers. Its run time is 25.68 seconds; the last growth sample is 38.69 at 25 seconds, below the current overdrive threshold of 70. This is not evidence of maximum-rate replication.

## Confirmed reporting defect

`Game.frame` limits simulation catch-up to a 100 ms delta. The FPS counter incorrectly accumulated that limited delta too. Consequently, steady 200 ms intervals (5 FPS) and 400 ms intervals (2.5 FPS) both displayed 10 FPS. Real callback intervals now drive the counter; simulation limits are unchanged.

The old `frameMs`, `simMs`, and `lightMs` fields describe the latest callback, not average or percentile performance. `lightMs` covers polygon/light preparation, not the whole lighting draw pass. CPU timing does not capture asynchronous GPU execution, compositing/presentation, or all browser scheduling delays. A cheap latest callback can also conceal expensive earlier callbacks. Thus the supplied values do not identify the cause of actual stalls.

## New diagnostics

Exported telemetry retains the existing fields and adds `timing.recentActiveFrames`, a ring of the latest 120 active-gameplay intervals and callback work times summarized as p50/p95/p99/max, sample count, elapsed window and average cadence. It preserves the last gameplay window while paused and starts a new window on resuming; menu frames and cross-pause gaps are excluded. Sampling uses two fixed arrays totaling 1,920 bytes and allocates no per-frame objects. Sorting occurs only when exporting.

`frameMs` now includes work before simulation preparation, such as automatic canvas resizing and speedrun saves. Exports also include requested render quality, actual backing density/dimensions, device density, CSS dimensions, soft-shadow setting, Auto governor state, page visibility, pause state, browser user agent and connected-air mapping state. Factory settings currently use Auto quality and disable soft shadows; the user's old log did not include settings or actual density.

## Connected-air control

[Controlled fog profile](PIXEL_FOG_PROFILE.json) uses desktop Chromium 156 with a 412×915 CSS viewport, DPR 2.625 and 4× CPU throttling. It tests eight fog sources for 120 fixed updates in the starting map, then in the same map with a 32×32-cell region opened. It compares mapping disabled/enabled in the same layouts. It is not a reproduction of the user's map, phone, or GPU behavior.

| Layout | Mapping | Fog p50 / p95 / p99 / max, ms |
| --- | --- | --- |
| Starting map | off | 2.3 / 3.8 / 5.7 / 9.6 |
| Starting map | on | 2.3 / 4.2 / 6.6 / 11.2 |
| Opened region | off | 3.4 / 5.2 / 7.4 / 8.4 |
| Opened region | on | 3.7 / 9.2 / 15.2 / 15.8 |

Mapping adds periodic work in this control, but does not reproduce steady 100+ ms frame intervals. A larger connected component, multiple catch-up steps, browser/GPU delays, or another effect could change the result. No optimization to mapping or automatic graphics policy is made on this evidence. The original log does not establish a GPU bottleneck either.

## Validation and next capture

676 tests across 93 files, type checking and production build pass. A [browser regression](FRAME_TELEMETRY_REGRESSIONS.json) drives the real `Game.frame` and export path at synthetic 200 ms cadence. It verifies 5 FPS, actual canvas dimensions, pause-history preservation and resume reset. Its work times are incidental; synthetic timestamps are not a presentation benchmark.

Run with Vite on port 5173:

```bash
node scripts/connected-air-profile.cjs
node scripts/frame-telemetry-smoke.cjs
npm test
npm run build
```

Capture a new exported log during or immediately after a slowdown on the Pixel. Compare recent interval percentiles with work percentiles and actual render density. This supplies evidence missing from the old log; it still cannot directly measure physical GPU/presentation time. A temporary Low-quality comparison can test whether reducing backing pixels helps the affected device.
