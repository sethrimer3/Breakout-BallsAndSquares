# Visible-chunk lighting mask revisions

The lighting terrain mask now keys its opacity revision to the chunks actually drawn into the viewport. Growth or destruction in other chunks no longer repaints the current mask. Published chunk revisions still invalidate the mask immediately when visible alpha changes, including damaged glass. Camera position, zoom, viewport, device scale and ambient color remain independent invalidation keys.

The global terrain opacity revision remains available. A small per-chunk revision array supports the viewport signature, which includes chunk IDs to avoid reusing a signature for different terrain.

## Benchmark

Baseline: `b3f6cb0`. With Vite running:

```sh
BREACH_BASELINE_REF=b3f6cb0 node scripts/lighting-mask-benchmark.cjs
BREACH_BASELINE_REF=b3f6cb0 BREACH_CHECK_ONLY=1 node scripts/render-active-benchmark.cjs
```

The benchmark alternates old/new lighting renderers over the same terrain and lighting state. Each scenario has five warm-up and 30 timed submissions. Both stationary/moving cameras, zoom 0.5/1.13, visible/offscreen growth and one/eight soldiers are covered, on desktop DPR 1 and mobile DPR 2 with 4× CPU throttling. Soft shadows are enabled. Timings cover lighting rendering, excluding simulation, terrain rebuilds and shadow-polygon preparation; they measure CPU submission, not complete GPU execution or full-game FPS.

### Stationary camera, offscreen growth (milliseconds)

| Device | Soldiers | Zoom | Median before → after | p95 before → after | p99 before → after |
|---|---|---|---|---|---|
| desktop | 1 | 0.5 | 13.1 → 10.7 | 28.1 → 34.0 | 34.3 → 35.7 |
| desktop | 1 | 1.13 | 15.1 → 11.9 | 32.5 → 25.6 | 36.7 → 31.0 |
| desktop | 8 | 0.5 | 13.7 → 11.0 | 41.9 → 24.9 | 103.7 → 61.3 |
| desktop | 8 | 1.13 | 12.9 → 10.5 | 25.7 → 23.6 | 25.8 → 98.0 |
| mobile | 1 | 0.5 | 86.2 → 60.8 | 192.5 → 144.1 | 386.0 → 168.0 |
| mobile | 1 | 1.13 | 86.3 → 63.5 | 200.3 → 160.6 | 219.1 → 216.0 |
| mobile | 8 | 0.5 | 83.1 → 62.8 | 221.2 → 120.6 | 247.3 → 148.5 |
| mobile | 8 | 1.13 | 96.2 → 73.5 | 169.9 → 202.2 | 178.1 → 218.4 |

The mask rebuilt once instead of 35 times in these cases. Moving cameras and visible changes still rebuild each frame; this change is not expected to accelerate those cases. Tail timings are mixed and include regressions. [All 32 scenario results](VISIBLE_LIGHTING_MASK_BENCHMARK.json) are retained rather than selecting only favorable cases.

## Pixel and invalidation checks

All 64 sampled complete-lighting comparisons matched exactly. The [additional regression run](VISIBLE_LIGHTING_MASK_REGRESSIONS.json) passed 80 image comparisons, with explicit mask invalidation checks for glass damage, destruction, growth, fractional camera pan/zoom, regeneration and resizing. Ordinary opaque HP changes still reuse the mask.

The old regression fixture selected an arbitrary solid cell from the whole map and assumed every edit must invalidate the visible mask. It now chooses a cell within the viewport so it tests the intended condition. The timing fixture also verifies that its offscreen cells are mutable by requiring fewer mask rebuilds in the updated stationary renderer; protected boundary cells must not silently turn the workload into a no-op.

Lighting and soft-shadow buffer work remains a major cost during camera motion. Bounding that work without changing blur edges or leaving old light behind remains a separate follow-up.
