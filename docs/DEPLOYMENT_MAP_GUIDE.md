# Deployment availability on both maps

Both the live battlefield and sector selector use the same visual language:

| Treatment | Meaning |
| --- | --- |
| Cyan checkmark and outline | Deployment is available under that view's rules. |
| Amber lock, dashed boundary and diagonal hatching | Deployment is restricted. The selected sector or target supplies the reason. |
| Gray question mark / dotted boundary | The sector is unsurveyed; its restrictions are not revealed. |

Text, symbols and texture supplement color. The interface says deployment is **available**, rather than claiming an area is free of combat threats.

## Live battlefield

A deployment survey appears only while `canPlaceSoldier()` permits choosing a portal: reserves remain, the run is active/unpaused, and there is no portal already deploying the squad. It draws viewport-culled sector boundaries with a faint tint, sparse hatching in known Warden-held sectors, and compact sector labels. Labels use the visible sector's lower edge and avoid the top HUD area. The legend follows the wrapping stat bar and disappears when placement becomes unavailable.

Restrictions follow living Wardens' home sectors, matching `guardsZoneAt`. Losing the final Warden updates the zone on the next draw. Unknown sectors receive only the neutral survey treatment. For procedural worlds without a lab frame, the pointer feedback remains available but no sector grid is drawn.

The hover/press preview checks the target's collision circle with the existing deployment clearance, and shows **PORTAL READY**, **WARDEN LOCK**, or **CLEAR GROUND REQUIRED**. This is a cheap local collision check; it does not run the expensive nearest-clear-point search every frame. Placement still uses the original search and authoritative revalidation on release. An obstructed target may therefore be nudged onto nearby clear ground by the existing placement behavior.

## Sector selector

Tile badges and hatching are derived from `canDeployInto`, not a separate permission system. Unsecured sectors and Warden-held sectors share the restricted treatment but have different text explanations. Unknown tiles do not expose hidden restrictions. The selected sector includes a status heading and a short next action, and the Deploy button retains its original permission check.

Campaign sector selection has an additional persistent requirement: defeat Wardens **and collect the sector's gold block**, and secure the sector. Consequently, killing Wardens can open live portal placement before that sector is unlocked for starting another run. The selected map explanation makes that requirement explicit. Dev conquest bypass still respects the existing gold-block restriction.

Selected status is announced through a polite live region. Tile accessible names include their state; white selection/focus frames remain distinct from availability colors. The map retains existing thumbnail/DOM reuse. Landscape screens place the details beside the grid to keep thumbnails readable.

## Rendering and validation

The live annotation examines living Wardens and visible sectors, reusing a 32×32 hatch pattern. It adds no terrain scan, blur, full-resolution temporary buffer or pixel readback. It does not change deployment permissions or make an FPS improvement claim.

- **711 tests across 97 files passed**, including shared-status precedence, unknown-state concealment and icon distinction.
- Type checking and production build passed.
- [Browser regression records](DEPLOYMENT_MAP_REGRESSIONS.json) cover desktop 1200×900 at DPR 1, phone portrait 412×915 at DPR 2.625, and landscape 915×412 at DPR 2.625.
- Checks cover all four sector states, button gating, accessible names, unknown restrictions, stable tile identity, live unlocking, persistent gold-block gating, clear/solid target feedback, guide removal, HUD separation and horizontal bounds.
- Desktop/phone/landscape screenshots were inspected to refine the legend and responsive layout. These are browser layout checks, not a physical-device performance benchmark.

With Vite on port 5173:

```bash
node scripts/deployment-map-smoke.cjs
npm test
npm run build
```
