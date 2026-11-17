# Separate Blight animation from contour invalidation

The edge renderer now retains the unmasked procedural texture separately from the current contour mask. Growing terrain updates the mask immediately but reuses noise within the same 15 Hz animation tick. Camera chunk-bound changes, occupied-chunk changes, resolution changes and animation ticks regenerate the source texture. Live and dormant layers retain separate sources.

Previously every visible contour change regenerated all six noise/hot-core layers, bypassing the intended animation cadence.

## Measurements

Baseline: `4bc087d`. Run Vite, then:

```sh
BREACH_BASELINE_REF=4bc087d BREACH_ALLOW_PHASE_DIFF=1 node scripts/blight-render-benchmark.cjs
```

These are **terrain rebuild + terrain/Blight drawing CPU submission times**, not whole-game FPS or GPU completion times. Each scenario alternates baseline and updated renderers, with 15 warm-up and 50 timed frames. Growth changes 12 cells per frame. Mobile is Chromium emulation at 390×844, DPR 2, with 4× CPU throttling. Desktop uses 1200×800 and DPR 1. Readbacks happen outside timed submissions.

### Mobile repeat run, milliseconds

| Growth | Zoom | Camera | Median before → after | p95 before → after | p99 before → after |
|---|---|---|---|---|---|
| visible | 0.5 | stationary | 15.1 → 13.3 | 20.8 → 21.3 | 60.3 → 28.3 |
| offscreen | 0.5 | stationary | 2.7 → 2.8 | 10.7 → 14.4 | 13.8 → 14.6 |
| visible | 0.5 | moving | 14.1 → 11.8 | 20.8 → 19.7 | 99.7 → 51.3 |
| offscreen | 0.5 | moving | 2.8 → 2.5 | 11.7 → 17.9 | 12.7 → 24.5 |
| visible | 1.13 | stationary | 12.1 → 8.2 | 15.2 → 14.9 | 18.7 → 32.1 |
| offscreen | 1.13 | stationary | 2.2 → 2.2 | 8.5 → 8.7 | 9.1 → 8.9 |
| visible | 1.13 | moving | 12.5 → 9.2 | 15.5 → 15.5 | 34.7 → 104.1 |
| offscreen | 1.13 | moving | 2.2 → 2.2 | 9.5 → 11.2 | 11.2 → 11.8 |

[Raw results, including desktop](BLIGHT_NOISE_CACHE_BENCHMARK.json). Visible-growth medians improved in all four mobile scenarios. Tail latencies and off-screen cases are mixed; this is not evidence of uniformly better worst-case frame times. An earlier run also improved visible-growth mobile medians (13.7 → 9.5 ms at zoom 1.13 stationary), but results remain browser/machine dependent.

## Visual checks and cost

All 16 scenarios preserved contour alpha exactly, including half-size pixels, dormant colonies, total removal and regeneration. Off-screen-growth scenarios matched RGBA exactly. During visible growth, RGB pixels can differ within an animation tick because the original renderer advanced noise on every mask invalidation, whereas the updated renderer holds its texture until the next animation tick. The comparison samples both tick boundaries and an interior frame; maximum RGB-channel difference in this run was 56, with no alpha changes. Colors, noise resolution and the configured 15 Hz cadence are retained.

The tradeoff is one extra RGBA source canvas per used live/dormant layer, sized like its existing edge buffer. Existing maximum viewport allocations are retained, so memory should be checked on physical low-memory devices.

A more finely clipped paint-area prototype was rejected: it matched pixels but increased dense mobile growth medians (for example 14.4 → 16.2 ms). Complex clip construction outweighed the saved shading work.

## Remaining work

Lighting and soft-shadow buffers remain major costs. These changes do not reduce simulation work or guarantee smooth full-game frame times. Next, profile and bound temporary lighting/blur regions with explicit tests for overlapping lights, blur padding and previous-frame light removal.
