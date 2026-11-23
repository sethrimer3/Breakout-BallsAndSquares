# Off-screen soldier indicators

Every living soldier whose sprite is outside the viewport receives a small screen-edge indicator: an 18 CSS-pixel rendering of its existing cached body sprite and a small outlined pixel-art arrow pointing toward its world position. Slot-specific shapes, facing and the existing camera-follow ring are preserved. The indicator size is independent of camera zoom, and it draws after lighting and fog for readability.

The edge position follows a ray toward the soldier. Markers sharing an edge are spaced apart and can use inner lanes when crowded. Arrow direction is recomputed after packing, then quantized to eight pixel-art directions. A dark cut-corner backplate keeps the miniature readable without a glow or full-screen effect. Dead soldiers are excluded; indicators clear when the soldier returns on-screen or the squad is emptied.

Visibility uses opaque bounds recorded when the normal sprite is baked. This ignores transparent sprite padding without reading canvas pixels back during gameplay. Sprite placement uses the same snapped destination rectangle as the main renderer. Partly visible bodies remain ordinary on-screen soldiers.

HUD obstacle rectangles and viewport safe-area bounds are cached via ResizeObserver, initial layout and viewport-resize notifications. The canvas draw path does not read DOM layout. Markers stay below the top stat bar and above the growth/ability controls, and slide around other visible HUD widgets. Normal desktop/mobile squad sizes are checked for non-overlap. If a very small or fully occluded viewport cannot fit all markers, placement is best-effort rather than dropping the directional marker.

The marker pool and eight arrow sprites are reused. Only soldiers and a short HUD rectangle list are examined; there is no terrain scan or new full-resolution buffer. This is a visual feature, not an FPS improvement claim. It adds no click actions or deployment behavior.

## Validation

- **720 tests across 98 files passed**, plus a focused rerun of all nine new layout tests after tightening the corner fixture.
- Production type check/build passed.
- [Browser regression records](OFFSCREEN_SOLDIER_REGRESSIONS.json) cover desktop 1200×900 at DPR 1, phone 412×915 at DPR 2.625 and landscape 915×412 at DPR 2.625.
- Browser checks compare each miniature's source pixels with the soldier's expected shape/facing sprite, and verify eight offscreen soldiers, bounds, HUD avoidance, crowded edges, dead/on-screen/partly visible soldiers and clearing the squad.
- Geometry tests cover all eight arrow directions, 20 soldiers on a crowded edge, HUD obstacles, adjacent-edge collisions and transparent margins.
- The existing deployment-map browser checks also pass after the HUD layout observer addition. Screenshots were inspected on the phone viewport. These are browser UI checks, not physical-device performance measurements.

With Vite on port 5173:

```bash
node scripts/soldier-indicators-smoke.cjs
node scripts/deployment-map-smoke.cjs
npm test
npm run build
```
