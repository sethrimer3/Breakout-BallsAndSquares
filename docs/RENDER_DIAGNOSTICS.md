# Rendering diagnostics in exported logs (schema 3)

The existing Copy Log/export action now includes pass timings, correlated workload samples and optional browser observations. No extra debug setting is required. The last 120 active gameplay callbacks are retained; pausing to copy preserves this history. Resuming starts a fresh window and excludes the cross-pause interval. The window therefore covers about two seconds at 60 FPS, or twelve seconds at 10 FPS.

## Reading the log

| Field under `timing` | What it tells us |
| --- | --- |
| `recentActiveFrames.phasesMs` | CPU p50/p95/p99/max for each stage, rather than just the latest callback. |
| `recentActiveFrames.counts` | Last/p50/p95/p99/max amounts and workload counts from those same callbacks. |
| `recentActiveFrames.slowestWorkFrames` | The three slowest CPU callbacks with their own phase timings, scene counts and settings. |
| `recentActiveFrames.longestIntervalFrames` | The three longest rAF intervals with current work and preceding-work remainder, even if the current callback was cheap. |
| `recentActiveFrames.outsideCallbackMs` | rAF interval minus **previous** callback CPU work, clamped at zero. This includes display/vsync waits, browser scheduling, other tasks and possibly GPU/compositor waits; it is not GPU time or utilization. |
| `browserEvents` | Feature-detected Long Tasks and Long Animation Frames overlapping the saved gameplay window, with up to three event examples each. Unsupported APIs explicitly report `supported: false`. |
| `heapAtExport` | Nonstandard `performance.memory` used/allocated/limit bytes, or `null` if unavailable. This is a capture-time JS heap hint, not GPU memory or proof of a leak/GC pause. |
| `rendering` | Actual backing dimensions/density, camera position/zoom, current lighting quality, reduced-motion preference, Canvas context attributes, Bloom, soft shadows and Auto governor state. |
| `simulation` | Fixed step, speed and death-sequence multipliers, and maximum catch-up steps. |

Worst-frame rows omit zero-valued phase/count fields and round new metrics to three decimals to keep logs smaller. Aggregate tables retain every field. Rendering settings in `rendering` are current at export; historical density/backing pixels, camera zoom, Bloom/soft-shadow flags and lighting quality are retained with the sampled frames. Historical boolean flags use 0/1; `lightingQualityLevel` uses low=0, medium=1, high=2.

## Timed stages

The following stages cover the callback sequentially:

- `preFrameMs`: setup, speedrun saving, and Auto render-density adjustments.
- `simulationMs`: fixed updates, camera update, death/shake/transition updates.
- `terrainUpdateMs`: terrain publication and queued floor work.
- `shadowPreparationMs`: muzzle/soft light polygons and fixture retracing.
- `albedoMs`: background, floor, terrain, moving subpixels, doors, opaque particles and floor props.
- `lightingMs`: the main lighting draw/composite pass.
- `worldEffectsMs`: atmosphere, facility glows/panels, surface outlines, creatures, special blocks and Wardens.
- `combatEffectsMs`: hit flashes, fiery muzzle effects, smoke, pickups, growth pulses, bullets, fire glows and additive particles.
- `bloomMs`: Bloom rendering and compositing (near-zero call overhead when disabled).
- `fogRenderMs`: map boundary, fog and Blight albedo through fog.
- `blightEdgesMs`: the post-fog Blight edge pass. Blight work inside Bloom belongs to `bloomMs`.
- `actorsAndUiMs`: generator rims, deployment annotations, weapon expansion, portal, soldiers, grenades, goo, turrets and canvas notices/aim indicators.
- `hudAudioMs`: fire ambience mixing, audio updates and DOM HUD/debug updates.

Nested probes overlap those parents: `fogUpdateMs`, `airMappingMs`, `growthUpdateMs` and `subPixelSimulationMs` are inside simulation; `lightingMaskMs` is inside lighting; `wardenDrawMs` is inside world effects. `subPixelDrawMs` combines moving-subpixel drawing in albedo with its light pass in world effects. **Do not add nested timings to parent timings.** Quantization and bookkeeping mean stage totals need not exactly equal callback work.

All stopwatch timings measure CPU elapsed time, including any synchronous browser work during the call. They do not directly measure asynchronous GPU completion or physical display presentation. There is no forced GPU synchronization, pixel readback, per-draw monkeypatch or per-frame JSON generation in the game logger.

## Workload and cache counters

- `simulationSteps`, `clampedWallTimeMs`, `discardedSimulationMs`: catch-up pressure. Clamped wall time is the raw interval beyond the 100 ms simulation limit; discarded simulation time is leftover scaled accumulator time cleared after hitting the step cap. They are different quantities.
- `growthEvents`: successful growth events across all simulation steps in the sampled callback.
- `airFloods`, `airCellsVisited`, `mappedAirTiles`: connected-air rebuild count, open fine-grid cells reached during those rebuilds, and cached coarse fog tiles revealed. A cached update can have zero floods/visited cells while still revealing mapped tiles.
- `terrainChunksRebuilt`, `terrainChunksPending`: published chunks and remaining backlog.
- `fixtureRetraces`, `shadowRays`, `shadowedMuzzleLights`: shadow preparation workload.
- `maskFullRebuilds`, `maskPartialRegions`, `maskScrolls`, `maskReuses`, `maskRepaintPixels`: actual opacity-mask painting/copying/reuse, including zero-paint metadata refreshes. Pixel counts use backing-store pixels.
- `candidateRoomLights`: conservative ordered spatial-query candidates, not an exact count of submitted fixture draws.
- `softLights`, `muzzleFlashes`, living `soldiers`, active `bullets`, `particles`, `fireParticles`, `loot`, `damageNumbers`, `movingSubPixels`, active `creatures` and living `wardens`: scene totals. Bullets use active pool occupancy, not allocated pool slots. These totals include offscreen entities; the logger avoids another per-entity visibility scan.
- `cameraTravelWorld`, `cameraZoom`, `backingPixels`, `renderDensity` and historical effect/lighting flags: identify camera invalidations, resolution changes and settings at the time of a slow sample.

## Browser events

Long Tasks and Long Animation Frames use separate bounded buffers of 256 events. Export filters them to events overlapping the saved gameplay window; overlapping events retain their full durations. `truncated` reports when eviction intersects that window. Events delivered just after pausing can still be included; later menu work cannot evict the saved gameplay events. Browser delivery is asynchronous, so the newest event may not have arrived at export time.

Long Animation Frames additionally expose total blocking duration, the browser render phase when reported, and script-attributed forced style/layout duration. The render phase includes rAF/script/style work; **it is not GPU duration**. Long tasks, animation frames and game callback timings can overlap: do not sum them as independent costs. No script URLs or source text are collected.

## Useful patterns

- High terrain time plus a growing chunk backlog points toward publication work.
- High lighting time plus full mask rebuilds points toward mask invalidation; high shadow preparation with many rays/retraces points toward polygon tracing instead.
- High Bloom or post-fog Blight edge time identifies the particular pass, even when overall lighting preparation is cheap.
- High simulation time with several steps, air floods or many moving subpixels separates update stalls from drawing stalls.
- Long intervals with cheap game callbacks warrant checking browser events and device behavior; the remainder alone cannot identify GPU throttling.
- Rising heap hints together with entity totals can guide retention investigation, but one heap reading cannot establish a leak.

## Cost and validation

Collection uses fixed typed buffers and small existing scene lists, without rescanning the world or creating per-frame history objects. Percentiles, sorting, example-row objects and JSON are produced only on export. The two event buffers and frame histories together occupy about 76 KiB of typed-array storage, plus object/array headers. Browser API entry delivery has its own feature-dependent cost.

**704 tests across 96 files**, type checking and the production build pass after integrating main `f9455af`. All **36 archived-renderer pixel comparisons** match exactly. The browser integration check verifies the real export path at a synthetic 200 ms cadence (5 FPS), including catch-up/clamping, forced mask rebuilds, connected-air activity, active pool counts, effect flags, saved worst-frame data and pause/resume behavior. Its incidental work times are not a performance benchmark.

[Regression evidence](RENDER_DIAGNOSTICS_REGRESSIONS.json) records synthetic-cadence integration checks, a comparison with the archived pre-instrumentation renderer, and a helper calibration. The pixel oracle covers desktop/mobile scales, fractional/default zoom, panning, Bloom off/on and soft shadows off/on. Calibration measures only fixed-buffer reset/copy plus 32 stopwatch reads under 4× CPU throttling; it excludes scene probes, observer delivery and whole-game rendering, so it is not a full instrumentation-overhead or FPS measurement. The standalone calibration median was 0.0582 ms per iteration (batch p95 0.0713 ms); calibration retained in the report was run separately from tests/builds, before unrelated UI/world-layout integration. The sampler source was unchanged.

With Vite on port 5173:

```bash
npm test
npm run build
node scripts/frame-telemetry-smoke.cjs
node scripts/render-telemetry-smoke.cjs
```
