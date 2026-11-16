# Rendering changes 1–3: measurements and validation

Historical results for commit `4bb50da`, before subsequent lighting-pipeline and resolution changes. Reproduce these exact measurements using that commit and its script. For the current merged renderer, use [RENDERING_AUDIT.md](RENDERING_AUDIT.md).

Implemented sparse frost iteration, opacity-specific lighting-mask invalidation, and conservative smoke/rail rejection. Items 4–6 remain unchanged.

Frost uses the read-only active list when it has fewer candidates than the visible grid. Widespread freezing uses the bounded viewport scan: an initial all-active prototype scanned 155,602 cells even in a close view and regressed render CPU time. Active-list membership also prevents a destroyed/re-frozen cell from being tinted or ticked twice before compaction.

Opacity dirtiness follows the chunk queue and advances the revision when the artwork is rebuilt. Ordinary opaque HP/crack changes retain the mask. Glass HP changes, geometry changes, explicit invalidation, and regeneration invalidate it conservatively. Camera/viewport/device changes retain their existing invalidation rules. This does not yet restrict revisions to visible chunks.

Smoke bounds include artwork snapping, two-pixel smoke sizes, and the minimum screen-pixel size. Rail rejection uses the full segment bounds and conservative stroke padding, including crossing beams whose endpoints are both offscreen. Culled beams retain their inherited alpha state for later frost rendering.

## Reproduce

Run the Vite dev server in the repository (`npm run dev -- --host 0.0.0.0 --port 5173 --strictPort`), then, without other builds/tests competing for CPU:

```bash
BREACH_BASELINE_REF=f55eb32c387411cfa4d656baa904b6af639386d4 node scripts/render-active-benchmark.cjs
```

The script archives the baseline source into an ignored temporary directory under `node_modules/.cache`, imports it alongside working-tree modules, and removes the archive afterward. It does not create a worktree or change tracked source. Playwright and Chromium use the same paths as the existing browser checks; `BREACH_CHROMIUM` and `BREACH_BASE_URL` override defaults. `BREACH_SAMPLES` defaults to 60 per variant/scenario. `BREACH_REPORT` selects the JSON destination. `BREACH_CHECK_ONLY=1` runs correctness checks without timings; `BREACH_WORKLOADS=smoke-rail,combined` selects affected workloads.

## Method and limits

Baseline: `f55eb32c387411cfa4d656baa904b6af639386d4`. Chromium: `156.0.8078.79`. Both renderers use the same live world and terrain artwork/cache, with fixed simulation state, render clock, and random seed. CPU timings include the full `Renderer.draw()` plus terrain updates in the damage workloads; shared terrain bookkeeping is the current implementation for both variants. Simulation, live weapon updates, and shadow tracing are excluded. These are renderer comparisons rather than complete original/changed application frame costs.

The matrix combines desktop (1440×900, device scale 1) and emulated mobile (390×844, scale 2), stationary/moving cameras, zoom 0.5/1.13, and sparse/dense fixtures. Sparse/dense workloads use 17/155,602 frozen cells, 32/1,400 smoke particles, 4/32 beams, 2/21 soft lights, and 1/16 ordinary HP hits per frame where applicable. Smoke occupies a deterministic area five viewports wide/high; one quarter of beams cross the viewport. Fixtures remain active and simulation is frozen to make inputs identical. Mobile runs on the same cloud CPU, not a phone.

Each scenario warms both renderers, then alternates three paired blocks with 60 measured frames per variant. Moving cameras replay the same trajectory. Pixel readbacks run outside the timing window. CPU times measure submission; animation-frame (rAF) intervals include browser scheduling/rasterization effects but are quantized by display cadence. Readbacks can affect browser canvas acceleration. These results are not GPU timings or gameplay FPS claims. With only 60 samples, p99 is the maximum sample and is particularly noisy. There is no multi-run confidence interval.

The complete matrix ran once; the smoke/rail and combined workloads were rerun after preserving culled-beam alpha. Freeze/lighting measurements come from the first matrix. Separate clocks and caches can create transient differences even in baseline-versus-baseline full-frame controls; full-frame comparisons therefore use warmed caches. Mask alpha is also compared directly against the original mask after invalidation.

## Results

Changes are small relative to full-frame variance. The table below gives the median **paired percent change** across each workload’s 16 scenarios; negative values mean lower CPU time. It is not a pooled frame percentile or a statistical speedup estimate. Individual results include regressions. Larger lighting work should remain deferred until profiling a representative target device identifies the dominant cost.

| Workload | Median change in scenario CPU p50 | Median change in scenario CPU p95 |
|---|---:|---:|
| freeze | -0.2% | -2.1% |
| lighting | -2.3% | -2.7% |
| smoke-rail | -0.0% | -4.8% |
| combined | -4.3% | -4.2% |

All 132 final pixel comparisons reported **zero differing channels, maximum delta 0**. They cover sparse/widespread frost, expiry, destruction before/after compaction, fractional zoom, smoke at every viewport edge, crossing/offscreen beams, faded offscreen beams followed by frost, warmed full frames, and mask alpha after glass damage, destruction, growth, pan, zoom, regeneration, and viewport changes. The corrected beam tests include reduced-motion rendering.

Unit validation: **528 tests passed across 71 files**. Production type check/build passed (the existing large-bundle warning remains). `node scripts/render-cache-smoke.cjs` passed nine floor pixel comparisons at scales 1/1.25/2 and seven mask invalidation checks. New unit coverage checks freeze refresh/thaw/destruction/re-freeze/clear, opaque versus glass damage, queued opacity changes, neighboring chunks, and regeneration invalidation.

Raw results and pixel records are in [ACTIVE_RENDER_RESULTS.json](ACTIVE_RENDER_RESULTS.json). All times below are milliseconds, shown as **p50 / p95 / p99**. Each cell contains 60 measured frames.

| Device | Workload | Density | Camera | Zoom | CPU baseline | CPU changed | rAF baseline | rAF changed |
|---|---|---|---|---:|---:|---:|---:|---:|
| desktop | combined | sparse | fixed | 0.5 | 24.6 / 33.2 / 40.7 | 23.1 / 31.3 / 40.3 | 33.4 / 50.1 / 83.2 | 33.4 / 50.1 / 100.0 |
| desktop | combined | sparse | fixed | 1.13 | 25.2 / 32.4 / 56.2 | 20.6 / 31.4 / 36.3 | 33.4 / 50.1 / 83.4 | 33.4 / 50.0 / 66.6 |
| desktop | combined | sparse | moving | 0.5 | 30.1 / 45.3 / 62.4 | 27.3 / 42.6 / 108.6 | 50.0 / 66.7 / 83.4 | 50.0 / 66.7 / 133.2 |
| desktop | combined | sparse | moving | 1.13 | 21.5 / 25.7 / 28.0 | 22.5 / 27.7 / 33.8 | 33.3 / 50.0 / 50.1 | 33.3 / 50.0 / 50.1 |
| desktop | combined | dense | fixed | 0.5 | 37.4 / 51.2 / 82.4 | 38.1 / 74.3 / 79.3 | 33.4 / 50.1 / 99.9 | 49.9 / 66.7 / 83.4 |
| desktop | combined | dense | fixed | 1.13 | 22.3 / 24.9 / 27.8 | 22.8 / 27.1 / 29.2 | 33.3 / 50.0 / 66.7 | 33.4 / 50.0 / 50.1 |
| desktop | combined | dense | moving | 0.5 | 53.2 / 75.6 / 94.9 | 51.3 / 63.0 / 85.8 | 66.6 / 83.3 / 100.0 | 50.0 / 66.7 / 83.4 |
| desktop | combined | dense | moving | 1.13 | 22.7 / 28.3 / 35.0 | 23.0 / 30.2 / 55.2 | 33.3 / 50.0 / 50.0 | 33.4 / 50.1 / 66.6 |
| desktop | freeze | sparse | fixed | 0.5 | 16.8 / 20.0 / 22.8 | 16.9 / 21.0 / 28.0 | 33.3 / 33.4 / 33.4 | 33.3 / 33.4 / 50.0 |
| desktop | freeze | sparse | fixed | 1.13 | 13.6 / 16.4 / 19.1 | 14.2 / 21.7 / 31.1 | 16.7 / 33.4 / 33.4 | 33.2 / 33.4 / 50.1 |
| desktop | freeze | sparse | moving | 0.5 | 22.1 / 38.2 / 78.5 | 20.2 / 34.6 / 46.2 | 33.4 / 50.1 / 100.0 | 33.3 / 50.1 / 66.7 |
| desktop | freeze | sparse | moving | 1.13 | 17.1 / 22.2 / 26.4 | 17.3 / 31.2 / 38.0 | 33.3 / 33.4 / 33.4 | 33.3 / 50.0 / 66.7 |
| desktop | freeze | dense | fixed | 0.5 | 36.5 / 43.9 / 56.0 | 37.2 / 79.1 / 150.3 | 33.4 / 50.1 / 66.8 | 33.4 / 83.3 / 150.0 |
| desktop | freeze | dense | fixed | 1.13 | 18.9 / 23.6 / 24.8 | 17.4 / 20.0 / 20.3 | 33.3 / 33.4 / 50.0 | 33.3 / 33.4 / 33.4 |
| desktop | freeze | dense | moving | 0.5 | 38.5 / 46.8 / 56.2 | 37.8 / 45.2 / 57.9 | 49.9 / 50.1 / 66.8 | 33.4 / 50.1 / 66.6 |
| desktop | freeze | dense | moving | 1.13 | 19.7 / 23.3 / 28.5 | 19.3 / 21.4 / 23.3 | 33.3 / 33.4 / 50.0 | 33.3 / 33.4 / 33.4 |
| desktop | lighting | sparse | fixed | 0.5 | 17.1 / 20.0 / 21.5 | 16.1 / 18.9 / 22.0 | 33.3 / 33.4 / 33.4 | 33.3 / 33.4 / 33.4 |
| desktop | lighting | sparse | fixed | 1.13 | 14.1 / 17.4 / 36.6 | 13.7 / 16.8 / 18.5 | 16.7 / 33.4 / 49.9 | 16.7 / 33.4 / 33.5 |
| desktop | lighting | sparse | moving | 0.5 | 17.2 / 22.4 / 29.6 | 16.9 / 20.3 / 20.9 | 33.3 / 33.4 / 50.0 | 33.2 / 33.4 / 33.4 |
| desktop | lighting | sparse | moving | 1.13 | 15.5 / 26.9 / 44.1 | 15.5 / 19.8 / 34.4 | 33.3 / 50.0 / 50.0 | 16.8 / 33.4 / 50.0 |
| desktop | lighting | dense | fixed | 0.5 | 19.5 / 28.2 / 48.4 | 18.5 / 23.5 / 27.1 | 33.3 / 50.0 / 66.6 | 33.3 / 33.4 / 33.4 |
| desktop | lighting | dense | fixed | 1.13 | 19.0 / 21.7 / 23.1 | 17.6 / 21.7 / 30.3 | 33.3 / 33.4 / 33.4 | 33.3 / 33.4 / 49.9 |
| desktop | lighting | dense | moving | 0.5 | 19.0 / 26.7 / 39.2 | 19.1 / 25.8 / 47.1 | 33.3 / 50.0 / 66.6 | 33.3 / 33.4 / 50.0 |
| desktop | lighting | dense | moving | 1.13 | 18.7 / 19.6 / 20.1 | 18.4 / 22.7 / 23.3 | 33.3 / 33.4 / 33.4 | 33.3 / 33.4 / 33.4 |
| desktop | smoke-rail | sparse | fixed | 0.5 | 16.0 / 21.8 / 25.8 | 15.8 / 21.4 / 21.9 | 33.3 / 33.4 / 33.4 | 33.3 / 33.4 / 33.5 |
| desktop | smoke-rail | sparse | fixed | 1.13 | 13.8 / 29.2 / 37.8 | 14.8 / 31.3 / 42.7 | 16.8 / 50.0 / 50.1 | 33.3 / 50.0 / 50.1 |
| desktop | smoke-rail | sparse | moving | 0.5 | 18.0 / 23.3 / 25.1 | 18.2 / 32.6 / 98.3 | 33.3 / 33.4 / 50.0 | 33.3 / 50.0 / 116.7 |
| desktop | smoke-rail | sparse | moving | 1.13 | 22.5 / 29.4 / 47.4 | 24.8 / 29.7 / 63.0 | 33.3 / 50.1 / 66.6 | 33.3 / 50.1 / 83.2 |
| desktop | smoke-rail | dense | fixed | 0.5 | 24.0 / 34.1 / 64.0 | 23.3 / 35.7 / 54.0 | 33.3 / 50.0 / 83.4 | 33.3 / 66.7 / 99.9 |
| desktop | smoke-rail | dense | fixed | 1.13 | 18.9 / 25.3 / 37.3 | 18.8 / 24.9 / 35.2 | 33.3 / 33.4 / 50.1 | 33.3 / 33.4 / 49.9 |
| desktop | smoke-rail | dense | moving | 0.5 | 21.3 / 30.3 / 41.7 | 21.3 / 28.4 / 38.8 | 33.3 / 50.0 / 50.1 | 33.3 / 50.0 / 50.1 |
| desktop | smoke-rail | dense | moving | 1.13 | 21.0 / 29.0 / 38.1 | 21.2 / 27.5 / 108.2 | 33.3 / 50.0 / 66.7 | 33.3 / 33.5 / 66.7 |
| mobile | combined | sparse | fixed | 0.5 | 15.5 / 18.0 / 20.0 | 13.9 / 16.8 / 22.7 | 33.3 / 33.4 / 33.4 | 16.7 / 33.4 / 66.7 |
| mobile | combined | sparse | fixed | 1.13 | 15.2 / 17.8 / 20.6 | 13.6 / 16.5 / 27.6 | 33.2 / 33.4 / 50.0 | 16.7 / 33.4 / 33.4 |
| mobile | combined | sparse | moving | 0.5 | 21.4 / 33.3 / 37.8 | 19.7 / 31.5 / 60.8 | 33.3 / 50.0 / 50.1 | 33.3 / 50.0 / 83.3 |
| mobile | combined | sparse | moving | 1.13 | 21.6 / 27.8 / 34.1 | 23.2 / 28.2 / 43.8 | 33.3 / 50.0 / 50.1 | 33.4 / 50.0 / 50.1 |
| mobile | combined | dense | fixed | 0.5 | 24.3 / 35.9 / 55.7 | 23.3 / 28.6 / 39.4 | 33.4 / 50.1 / 66.8 | 33.4 / 50.1 / 66.7 |
| mobile | combined | dense | fixed | 1.13 | 24.1 / 27.1 / 34.6 | 24.6 / 35.0 / 105.7 | 33.3 / 50.0 / 50.1 | 33.4 / 50.1 / 116.7 |
| mobile | combined | dense | moving | 0.5 | 22.7 / 30.1 / 34.7 | 21.3 / 39.0 / 67.9 | 33.4 / 50.1 / 66.6 | 33.4 / 66.7 / 100.0 |
| mobile | combined | dense | moving | 1.13 | 24.7 / 50.7 / 60.9 | 23.6 / 32.5 / 55.9 | 33.4 / 66.7 / 83.4 | 33.3 / 50.0 / 83.4 |
| mobile | freeze | sparse | fixed | 0.5 | 14.2 / 16.4 / 23.0 | 14.3 / 17.6 / 23.9 | 16.8 / 33.4 / 33.4 | 16.7 / 33.4 / 33.4 |
| mobile | freeze | sparse | fixed | 1.13 | 14.0 / 17.5 / 21.6 | 13.8 / 15.7 / 16.3 | 16.7 / 33.4 / 33.4 | 16.7 / 33.4 / 33.4 |
| mobile | freeze | sparse | moving | 0.5 | 17.2 / 20.4 / 37.3 | 17.6 / 20.2 / 34.8 | 33.3 / 33.4 / 33.4 | 33.3 / 33.4 / 50.1 |
| mobile | freeze | sparse | moving | 1.13 | 16.6 / 20.5 / 28.6 | 16.0 / 18.2 / 19.5 | 33.3 / 33.4 / 50.0 | 33.3 / 33.4 / 33.5 |
| mobile | freeze | dense | fixed | 0.5 | 14.8 / 18.9 / 25.1 | 14.9 / 18.4 / 26.6 | 33.3 / 33.4 / 33.5 | 33.3 / 33.4 / 50.0 |
| mobile | freeze | dense | fixed | 1.13 | 20.9 / 24.3 / 32.9 | 20.8 / 25.1 / 104.9 | 33.3 / 50.0 / 50.1 | 33.3 / 33.4 / 116.6 |
| mobile | freeze | dense | moving | 0.5 | 20.1 / 24.6 / 37.9 | 20.1 / 24.2 / 34.2 | 33.3 / 50.0 / 50.0 | 33.3 / 50.0 / 50.0 |
| mobile | freeze | dense | moving | 1.13 | 24.4 / 28.6 / 32.5 | 24.3 / 27.8 / 28.3 | 33.3 / 50.0 / 50.1 | 33.3 / 50.0 / 50.1 |
| mobile | lighting | sparse | fixed | 0.5 | 16.4 / 19.6 / 27.9 | 13.9 / 18.5 / 27.2 | 33.3 / 33.4 / 50.0 | 16.8 / 33.4 / 133.3 |
| mobile | lighting | sparse | fixed | 1.13 | 14.7 / 17.1 / 19.2 | 13.7 / 16.8 / 34.3 | 16.7 / 33.4 / 33.4 | 16.7 / 33.4 / 50.0 |
| mobile | lighting | sparse | moving | 0.5 | 16.8 / 19.3 / 34.0 | 16.7 / 20.0 / 25.7 | 33.3 / 33.4 / 50.0 | 33.3 / 33.4 / 33.4 |
| mobile | lighting | sparse | moving | 1.13 | 17.4 / 20.0 / 21.0 | 17.4 / 25.7 / 69.0 | 33.3 / 33.4 / 33.4 | 33.3 / 33.4 / 83.4 |
| mobile | lighting | dense | fixed | 0.5 | 18.6 / 20.5 / 22.1 | 17.0 / 20.1 / 21.1 | 33.3 / 33.4 / 33.5 | 33.3 / 33.4 / 33.4 |
| mobile | lighting | dense | fixed | 1.13 | 23.8 / 30.1 / 52.8 | 22.0 / 23.9 / 25.7 | 33.3 / 50.0 / 66.6 | 33.3 / 33.4 / 33.5 |
| mobile | lighting | dense | moving | 0.5 | 19.9 / 22.9 / 43.8 | 19.8 / 22.9 / 26.8 | 33.3 / 33.4 / 66.6 | 33.3 / 33.4 / 50.1 |
| mobile | lighting | dense | moving | 1.13 | 24.5 / 27.0 / 28.5 | 24.5 / 28.5 / 44.2 | 33.3 / 50.0 / 50.1 | 33.3 / 50.0 / 50.1 |
| mobile | smoke-rail | sparse | fixed | 0.5 | 13.4 / 17.7 / 41.0 | 13.4 / 15.8 / 98.4 | 16.7 / 33.4 / 66.7 | 16.7 / 33.4 / 100.0 |
| mobile | smoke-rail | sparse | fixed | 1.13 | 13.4 / 16.4 / 21.6 | 13.6 / 17.3 / 46.7 | 16.7 / 33.4 / 33.4 | 16.7 / 33.4 / 66.7 |
| mobile | smoke-rail | sparse | moving | 0.5 | 17.3 / 20.4 / 23.8 | 16.8 / 19.3 / 49.4 | 33.3 / 33.4 / 50.0 | 33.3 / 33.4 / 66.7 |
| mobile | smoke-rail | sparse | moving | 1.13 | 16.7 / 20.0 / 22.7 | 16.6 / 18.9 / 59.8 | 33.3 / 33.4 / 33.4 | 33.3 / 33.4 / 83.4 |
| mobile | smoke-rail | dense | fixed | 0.5 | 15.5 / 18.8 / 23.4 | 15.2 / 17.5 / 43.5 | 33.3 / 33.4 / 33.4 | 33.2 / 33.4 / 50.0 |
| mobile | smoke-rail | dense | fixed | 1.13 | 19.5 / 27.4 / 36.7 | 19.6 / 21.5 / 34.7 | 33.3 / 33.5 / 50.0 | 33.3 / 33.4 / 50.1 |
| mobile | smoke-rail | dense | moving | 0.5 | 18.4 / 22.9 / 55.5 | 18.2 / 20.7 / 23.8 | 33.3 / 33.4 / 66.6 | 33.3 / 33.4 / 33.4 |
| mobile | smoke-rail | dense | moving | 1.13 | 23.0 / 27.3 / 42.7 | 23.0 / 26.1 / 39.6 | 33.3 / 50.0 / 50.1 | 33.3 / 33.4 / 50.1 |
