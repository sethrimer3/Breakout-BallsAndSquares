# BREACH: Experimental Weapon Expansion

**Game design specification and code-oriented implementation plan**  
**Project:** `sethrimer3/Breakout-BallsAndSquares` (`main` branch)  
**Prepared:** November 12, 2026  
**Status:** Original mechanics plus Gale/Reverse audit repairs implemented; revised Black Market plan and integration pending<br>
**Design intent:** Make the weapons feel mechanically surprising, tactile, and distinctly different, while protecting the core experience of autonomous soldiers ricocheting through destructible environments.

> **Latest accepted roster and mechanics:** [Black Market implementation plan](BLACK_MARKET_IMPLEMENTATION_PLAN.md). Its user revisions supersede conflicting older proposals below, including Drone Shepherd as Pistol branch 3 and no accepted Assault Rifle mutation.

## Executive summary

The first release of this expansion should deliver five connected improvements **within a Blight Essence Black Market weapon-specialization system**:

1. **Weapon-specific ricochet ammunition** for guns that do not intrinsically pierce targets, beginning with Pistol and Shotgun. Ricochets add deliberate spatial gameplay instead of simply increasing damage.
2. **SQUELCH, the Adhesive Rebound Mortar (Shotgun Black Market branch):** a squishy, pseudo-soft-body orb that hits a wall, sticks and wobbles, leaves a sticky mine, then springs away along the reflected trajectory after a short delay. It has no purchased bounce-count limit. Travel distance and remaining slime mass limit its useful lifetime.
3. **Drone Shepherd (Pistol Black Market branch 3):** a soldier loadout built around releasing small flying pistol drones. Drones behave as independent, lightweight actors, not as additional full soldiers.
4. **Chromatic Prism (Sniper Rifle Black Market branch):** a reflective laser that begins red and unlocks orange, yellow, green, blue, indigo, and violet through upgrades. Each bounce makes the ray more dangerous, increasing its damage and penetration budget.
5. **Momentum Katana (Katana Black Market branch):** the existing katana's slash damage and width scale with actual soldier velocity, and a wall collision can initiate a fast dash that eases back to ordinary running speed.

**Squad equipment rule:** The Pistol is the only primary weapon that multiple soldiers may equip concurrently. Every other primary weapon, including all of its Black Market transformations, is exclusive to one soldier across the squad. Each soldier continues to carry exactly one primary weapon. Blight Essence, already present in the save economy, funds optional transformational weapon branches; a branch changes how its base weapon operates rather than unlocking a second copy of that weapon.

**Additional classification:** Reverse-Playback Revolver is specifically a **Pistol Black Market mutation**. Echo Stapler and Resonance Bell are **equipable secondary abilities** alongside Grenade and Turret, and do **not** occupy or transform the primary weapon slot. The Katana's alternative mutation is **Gale Edge**, a true long-range flying-crescent style, mutually exclusive with Momentum Katana.

Except for the implemented values recorded in the progress section, numeric values below are **proposed first-pass tuning**. Implement mechanics first, then tune against playtests and telemetry.

## Implementation progress — November 12, 2026

### Phase 1 — ordinary Pistol and Shotgun ricochet ammunition

This slice is implemented. The original validation results below describe its completion before Phase 2.

- **Bankshot Barrel** (`pistol_bankshot`): 5 levels, one terrain reflection per level, full damage retention. Starts at 30 gold with a 1.7 cost multiplier, after Primary Weapons access.
- **Pellet Rebound** (`shotgun_rebound`): 3 levels, one reflection per pellet per level, retaining 70% damage after each bounce. Starts at 60 gold with a 1.8 cost multiplier; requires Shotgun and 30 lifetime pixels. Terrain damage rounds to the nearest integer with a minimum of one.
- Effective penetration is checked at launch: soldier piercing upgrades disable ordinary ricochets for that shot, even after its penetration is exhausted. AR, Sniper, Katana, rockets, flames, turret rounds, and grenade shrapnel receive no ordinary ricochet budget.
- Terrain takes damage before reflection, including when that hit destroys the wall. World boundaries reflect eligible rounds; creature hits consume them. Remaining movement continues in the same update, with an eight-contact safety guard.
- Reflection resets straight-tracer distance, preserves total segment travel, and emits a cyan spark plus a spatial metallic ping throttled to one per 40 ms. Both projectile spawn paths reset the new pooled state.
- The existing definition-driven upgrade UI and save sanitation include the new nodes automatically. Old saves default missing levels to zero, and purchases remain capped at 5 / 3 levels.

**Validation:** `npm test` passed 323 tests in 42 files, including 22 new ricochet/progression cases; `npm run build` passed the TypeScript check and production build. Coverage includes axis-aligned surfaces, corners, exact-face/zero-distance impacts, half-size Blight, destroyed walls, world boundaries, finite budgets, per-update guards, damage retention, penetration exclusivity, creature hits, pool reuse, purchases, and legacy saves. Existing tree-fit tests also pass with both new nodes. Chromium smoke checks verified both tooltips and purchases through the upgrade UI with no JavaScript errors.

### Phase 2 — playable SQUELCH prototype

- `goo_mortar` is a primary loadout weapon with its own firing rate (0.65/s). Orbs use subcell swept collision, stick for 0.18 s, deposit a mine, and resume along the captured reflected trajectory. The center-point cast starts at the soldier center so a wall inside the muzzle offset cannot be skipped.
- Each orb starts with 1.0 mass and 300 world units of flight at 260 units/s. Each contact sheds up to 0.075 mass; the final fragment scales mine damage proportionally. Orbs expire at 0.12 living mass, exhausted distance, out-of-world position, or a 120 s runtime failsafe. Sticky delays consume time but no distance. There is no lifetime bounce counter.
- Mines have independent positions and 0.75 s fuses, survive support-wall removal and parent expiration, and deal 5 base damage in a 1.8-cell blast through the shared rocket terrain-impact/owner pipeline. Soldier damage, terrain bonus, and Blight multiplier are captured at launch. Creature, fixture, and encounter blast callbacks also run.
- Global pools cap orbs/mines at 16/96. At mine capacity a shed fragment dissipates while mass is still consumed. At most eight mine detonations and eight contacts per orb are processed per fixed update; overdue mines remain queued. Run restarts and sector transitions clear both pools.
- **Unlock SQUELCH:** 180 gold, after Primary Arsenal and 80 lifetime pixels. **Gel Reservoir:** 6 levels of +0.15 mass, starting at 65 gold (1.7× costs). **Long Hop:** 8 levels of +80 distance, starting at 55 gold (1.6× costs). Both require the weapon unlock. Saves retain unlocked loadouts and sanitize locked ones to Pistol; legacy saves default new levels to zero.
- Phase 2 introduced basic shrinking silhouettes and fuse indicators; Phase 3 below replaces its placeholder animation and sounds. The remaining goo progression upgrades are still deferred to Phase 7.

**Validation:** `npm test` passed 345 tests in 43 files, including 22 new SQUELCH cases. `npm run build` passed. Tests cover flight-only distance, timed sticking/release, multiple contacts per update, final mass fragments, more than sixteen lifetime contacts, corner/border/half-size hits, support removal, frame grouping, pool reuse and saturation, queued detonations, owner-attributed blast damage, progression caps, and old saves. Chromium verified UI purchases, equipping, live stick/release/detonation, and restart cleanup with no JavaScript errors.

### Phase 3 — SQUELCH visual/audio polish

- Each pooled orb owns a preallocated ten-point `GooBody` spring ring. Impact compresses the normal axis and expands the tangent axis; three contact-side points remain anchored while the free edge jiggles. The last 0.05 s of the existing 0.18 s dwell adds a single peel/stretch impulse, followed by a damped release overshoot. This adds no flight delay, collision geometry, or damage changes.
- Springs advance alongside fixed-step flight/dwell segments with bounded visual substeps. Their positions, velocities, orientation, and phase reset on pool reuse. The Canvas renderer only reads state, drawing a smooth closed outline and mass-scaled highlight.
- Mines develop a warm core, restrained charge breathing, and a filling fuse ring. Reduced-motion mode replaces the animated ring with a static contact silhouette and disables breathing. Low lighting quality omits the extra mine halo while retaining the core and fuse indicator.
- Dedicated procedural **launch**, **wet impact**, **suction release**, and **compact mine burst** cues combine filtered noise with short sine chirps. They use existing spatial falloff, stereo pan, mute, gesture unlock, and effects volume. Per-cue throttles (60/45/55/65 ms) share a maximum of six voices, each with two finite sources. Completion disconnects local audio nodes and spatial routing; there are no per-orb sound loops.
- Full orb pools suppress launch/shot effects and emit a small dissipating puff. At mine capacity, lost residue emits a green puff while consuming mass as before. The debug overlay reports active orb/mine counts and dropped orb/fragment totals; run resets and sector changes reset those counters.

**Validation:** 357 tests in 45 files pass, including 12 new spring/audio/pressure cases; the production build passes. Chromium rendered impact, jiggle, peel, rebound, and reduced-motion snapshots; rendering preserved simulation and spring state. Real Web Audio offline rendering produced finite, non-clipping output and completion events for all four cues. A 600-frame simulation/render stress check starting with 16 orbs and 96 mines kept counts bounded, exercised overflow, and drained all entities. UI unlock/equip, live stick/release/burst, and restart cleanup also passed without JavaScript errors. These are functional checks, not a mobile-device performance or balance certification.

### Phase 4 — momentum katana

- Slashes snapshot damage and arc width from actual `hypot(vx, vy)` using the proposed 2.6× ratio cap. Kinetic Edge and Wide Momentum scale only the velocity-derived bonus; already active slashes retain their values.
- Rebound Dash triggers after a real autonomous wall reflection, along the reflected velocity. Base peak/duration/cooldown are 2.25× / 0.70 s / 1.8 s. Impulse Engine reaches a hard movement cap of 3.0×; the slash ratio still caps at 2.6×. All seven proposed katana specialization nodes are purchasable on its existing tree.
- Physics substeps use actual speed and allow for an imminent dash peak. Collision response preserves active dash speed, cooldown prevents repeated-contact retriggers, and the callback carries the surface normal and reflected soldier state. Manual control, formations, sentries, recovery relocation, and soft separation do not trigger dashes. Sector travel clears transient dash state.
- Cyan trails/rings and a short swish show the burst. Perfect Rebound adds one harmless slash afterimage. Reduced motion suppresses moving trails/afterimages. Formation navigation now uses circle-width clearance and a consistent flank side, preserving the existing obstacle-navigation regression test under corrected substeps.

### Phase 5 — Drone Shepherd

- `DroneSystem` owns a separate 24-actor pool. The carrier releases one drone every 4.5 s, initially two per owner; Brood Capacity permits seven per owner but never bypasses the shared cap. Drones live 12 s, then optionally fire one Recall Burst. Owner death limits remaining life to 1.5 s.
- Actors orbit/sweep locally, validate swept travel plus radius clearance, cannot teleport to their owner, and can be crushed by newly grown terrain. They never become Soldiers, consume deployment slots, join formations, collect loot, or receive soldier rescue relocations.
- Pistol micro-rounds use a typed owner-attributed shot interface. Owner damage, terrain bonus, Blight multiplier and pierce are captured; ordinary Pistol Bankshot is explicitly not inherited. Optional aim correction is limited to 20° and searches a bounded local neighborhood at 0.25 s intervals.
- All eight proposed drone nodes, loadout options, miniature sprites/propellers/muzzle cues, electronic launch audio, cleanup and save sanitation are implemented.

### Phase 6 — Chromatic Prism

- `LaserSystem.traceShot()` resolves each pulse once; pooled segment visuals fade for 0.12 s without retracing damage. Purchased spectrum controls the initial red-through-violet band, and each reflection advances the next segment's band.
- A pulse damages a distinct terrain cell once, spends available penetration through destructible terrain before reflecting, and treats closed doors as non-penetrable. World boundaries absorb the ray. Corners, zero-distance contacts and surfaces destroyed by the same pulse are bounded and deterministic.
- Each reflection adds damage relative to the initial base and replenishes penetration. Hard limits are 8 reflections, 16 distinct terrain hits, 32 visual segments per pulse, and 600 units shared travel; the damage growth multiplier caps at 6×. The global visual pool has 256 segments.
- All seven proposed nodes are implemented. Spectrum levels I–VII, thickness, reflection marks, and optional dash patterns supplement color; Prism Patterns defaults on and is saved in Visual Settings. Chromatic Overload is a harmless light pulse on the final violet reflection, so it cannot add recursive damage.

### Phase 7 — progression and presentation

- All remaining goo nodes (Elastic Recall, Volatile Droplets, Glow Bloom, Rapid Culture, Living Residue) are implemented. Living Residue shortens nearby positive fuses once per burst with a 0.04 s floor; the eight-detonation update budget remains in force.
- Every new node has a level cap, price, prerequisite and tooltip. The weapon trees remain within the existing 5×3 stage; weapon/category locks, dash prerequisites, and the violet capstone requirement are enforced. Old saves default missing levels/settings and replace locked new loadouts with Pistol.
- Loadout summaries state each weapon's rule. Existing mute/volume controls cover the new sounds; reduced motion and low-quality rendering preserve non-color fuse/power information. Drone/prism electronic cues share a four-voice cap with explicit node cleanup.
- Shared fixed pools serve goo, drones and laser segments while standard bullets retain their existing pool/fast path. AR Mirror Rounds remains optional. The newer `main` design now promotes respec and several former future concepts into requested scope; their new requirements are pending below.

### Phase 8 — automated balance and release candidate

- Added `npm run test:weapons`, `npm run test:weapon-browser`, and controlled seed-17 base/max-upgrade samples for open rooms and corridors. An eight-carrier case reaches the 24-drone cap without adding Soldiers.
- Exported telemetry now includes ordinary/goo bounce histograms, mine contacts/deposits/bursts, drone shots/useful hits, laser hits/reflections, dash uptime/damage, pool drops, and timing. Weapon counters reset with their systems on run/sector rebuilds.
- Browser checks exercise real UI purchases, all four live weapon rules, restart cleanup, saved settings, and mobile touch tooltips/loadouts. Desktop and 4× CPU-throttled mobile-viewport profiles exercise 600 simulation/render steps, followed by 1,800 more frames for retained-heap checks. The full suite passes 400 tests in 50 files; TypeScript, production build, and built-bundle startup/render checks pass.
- See [validation, benchmark results, and release playtest checklist](WEAPON_VALIDATION.md). Automated results are a playtest-ready implementation, not evidence of physical-phone performance, long-run economy parity, or first-time-player comprehension.

**Scope reconciliation:** The progress above describes the original implementation. Newer design revisions from `main` introduce additional Black Market, squad uniqueness, ranged mutation, and secondary-weapon requirements below. Those requirements remain pending; they were added after the implementation checkout's original base. Human playtesting and physical-device checks are also outstanding.

## 1. Creative principles and technical guardrails

### Player-facing principles

- **Every weapon changes behavior, not just statistics.** Players should see an unfamiliar pattern within the first few seconds of equipping it.
- **Cause and effect must be legible.** Each bounce, mine placement, drone launch, color shift, and dash needs visual and sound feedback.
- **Autonomous physics remain important.** A clever collision or trajectory should feel useful. Avoid unrestricted homing and constant automatic targeting.
- **Builds should interact.** A drone can fire ricochet bullets if explicitly supported; a katana dash may become a high-risk burst tool; laser reflections reward narrow spaces.
- **Convenience is not complexity.** Unusual mechanics should be understandable without memorizing long upgrade descriptions.
- **Upgrades create new milestones.** Prefer distinctive unlocks and capped effect upgrades over 15 nearly identical percentage increases.
- **Black Market transformations define a weapon's identity.** A weapon retains its conventional upgrade tree, but its chosen Blight Essence branch replaces or substantially changes its firing mechanic. Never stack incompatible branches simultaneously.
- **One specialist per non-pistol weapon.** A squad may field multiple Pistols, but no duplicate Shotguns, Assault Rifles, Rocket Launchers, Sniper Rifles, Katanas, Flamethrowers, or future non-pistol primary weapons.
- **Primary and secondary remain separate categories.** Echo Stapler and Resonance Bell use the existing charged secondary slot; Black Market variants such as Reverse-Playback Revolver and Gale Edge change primary weapon behavior. Do not put Echo Stapler or Resonance Bell in the Black Market primary-weapon tree.

### Codebase baseline before this expansion

- `src/entities/Bullet.ts`: fixed-size bullet pool and bullet state. Phase 1 adds bounce counters, retention, and total travel alongside the existing straight-tracer distance; a maximum travel budget remains future work.
- `src/systems/CombatSystem.ts`: soldier weapon switching, `spawnBullet`, swept subcell raycasting with hit normals, piercing, grenades, and autoturrets.
- `src/core/gridRaycast.ts`: axis-aligned surface normal (`nx`, `ny`) and precise hit point are already returned.
- `src/systems/PhysicsSystem.ts`: baseline wall reflection returned a bounce count and sized substeps from `s.speed`; Phase 4 corrects substeps and adds the post-reflection dash callback.
- `src/entities/Soldier.ts`: `WeaponType`, derived `SoldierStats`, and `Soldier` movement and loadout state.
- `src/rendering/Renderer.ts`: dedicated bullet, slash, soldier, and grenade drawing in Canvas 2D.
- `src/audio/AudioSystem.ts`: Web Audio sound generators with per-category throttling and existing spatial audio support.
- `src/progression/UpgradeDefinitions.ts`, `UpgradeManager.ts`, `SaveManager.ts`, and `src/ui/UpgradeTree.ts`: permanent upgrade definitions, purchasing, save sanitation, and upgrade-tree presentation. `SaveData` already has a Blight Essence balance and slot-indexed `loadouts`; the present loadout UI assigns `loadouts[slot].weapon` directly and save sanitation checks unlocks but **does not prevent duplicate non-pistol weapons**.
- `src/Game.ts`: fixed simulation orchestration. Soldier physics happens before soldier shooting, followed by bullet and grenade updates.

**Implementation note:** `GooOrbSystem`, `GooBody`, `GooRenderer`, `DroneSystem`, `LaserSystem`, and `Momentum` now exist. The design sketches below remain useful context; implemented choices and validation above take precedence where they differ.

## 2. Shared engineering foundation

Build a small reusable projectile feature layer before adding new weapons. Keep standard bullets on the existing fast path.

| Concern | Proposed change | Reason |
|---|---|---|
| Weapon identity | Keep ordinary `WeaponType` IDs (`shotgun`, `assault_rifle`, `sniper_rifle`, `katana`, etc.) and resolve Black Market **variants** from an active branch; do not add `goo_mortar`, `drone_shepherd`, `prism_laser`, `reverse_revolver` or `gale_edge` as separately equippable primary weapons. | A transformed weapon remains subject to the one-per-squad base-weapon ownership rule, except that multiple soldiers may equip Pistol. |
| Ordinary ricochets | Add `bounceLeft`, `bounceRetention`, and optional `maxTravelDistance` to `Bullet`; reset every field on pool acquisition. | Stops pooled projectiles inheriting stale state. |
| Impact handling | Introduce an internal impact policy: `penetrate`, `reflect`, `detonate`, `stick`, `stop`. | Makes effects mutually intelligible without a giant chain of style checks. |
| Reflection math | `reflected = incoming - 2 * dot(incoming, normal) * normal`; normalize and offset by small epsilon. | Ensures stable reflection using existing raycast normals. |
| Distance accounting | Track actual flight distance per segment. Stationary sticky delays consume time, not travel distance. | The goo weapon has no arbitrary bounce-count limit. |
| Pools | Separate pools for goo orbs, goo mines, drones, and short-lived laser segments. | Each entity has a distinct lifetime and update model. |
| Events | Add `onBulletRicochet`, `onGooStick`, `onGooRelease`, `onGooMineBurst`, `onDroneLaunch`, `onLaserBounce`, `onKatanaDash`. | Decouples game logic from sounds and particles. |
| Game loop | Use fixed-step updates only for weapon physics and damage; let render interpolate effects. | Avoids frame-rate-dependent mechanics. |
| Secondary abilities | Extend `SecondaryWeaponType` with `echo_stapler` and `resonance_bell`; retain one secondary selection per soldier and the current destroyed-block energy charging system. | They are ordinary charged secondaries, not new primary weapons or Black Market mutations. |
| Save migration | Add branch-state defaults, sanitize unrecognized branch IDs and levels, new secondary IDs and unlock checks, and normalize duplicate non-pistol loadouts to Pistol while preserving their other slot data. | Existing saves remain usable without manufacturing extra unique weapons. |

**Collision pitfalls:** Hit positions can lie directly on a solid cell face. Offset the post-bounce ray origin by a small epsilon *into free space* along the normal; reject near-zero-distance repeated hits; cap collision-processing iterations **per fixed update**, not total bounces per projectile. Handle corners, world boundaries, thin 50% Blight cells, and walls destroyed by the same shot. The goo orb can bounce indefinitely in principle, but must still expire when distance or usable mass is exhausted.

## 3. Weapon-specific ricochet ammunition

### Intended player experience

"I fired into a narrow corridor and the bullets banked around a corner." The upgrade should make positioning, geometry, and gun choice meaningful. It must not accidentally turn all projectiles, including rockets and flames, into ricocheting shots.

### Eligibility and design decision

- **Pistol:** Yes. It has no built-in weapon-specific penetration and is the natural first implementation.
- **Shotgun:** Yes. Each pellet may bounce, with a strict per-pellet bounce budget and a modest retention factor.
- **Assault Rifle:** **Optional alternate specialization**, because it already has an AP Rounds penetration tree. Mirror Rounds and AP Rounds should be mutually exclusive, or the system should refuse bounces when effective penetration exceeds zero.
- **Sniper and Katana:** No ordinary bullet ricochet upgrades. Their identity centers on piercing, and Katana instead gets momentum mechanics.
- **Rocket Launcher and Flamethrower:** No. Rocket impacts detonate and flame jets ignite; redirecting them through the ordinary bullet bounce policy would break their identities.
- **Goo Mortar and Prism Laser:** Have their own built-in reflection systems, not the standard ricochet upgrade.

### Proposed upgrades

| Upgrade (tree) | Levels | Effect | Notes |
|---|---:|---|---|
| Bankshot Barrel (Pistol) | 1-5 | +1 maximum ordinary-bullet ricochet per level. | Available after Pistol unlock tree access. |
| Pellet Rebound (Shotgun) | 1-3 | +1 bounce per pellet per level. | Initial tuning: pellets retain 70% damage after each bounce. |
| Mirror Rounds (Assault Rifle, optional) | 1-4 | +1 reflection per level, but disables AP Rounds. | Make this a clear respec-capable choice rather than a silent conflict. |

### Implementation sequence

1. Add bounce state and total traveled distance to `Bullet`. Reset it from `CombatSystem.spawnBullet` and `spawnSlash`, not only in the constructor.
2. In `CombatSystem.updateBullet`, process a terrain hit after applying ordinary damage. If `pierceLeft > 0`, retain existing penetration behavior. Else, if the projectile is bounce-eligible with `bounceLeft > 0`, calculate reflected direction, decrement remaining bounces, apply retention, push the position outside the surface, and continue any remaining motion that fixed frame.
3. Maintain current immediate explosion and flame logic. Creature hits should normally consume an ordinary ricochet projectile rather than reflect off creatures.
4. Add upgrade definitions, defaults in `SoldierStats`, save validation, and two new UI nodes. Treat the AR branch as an optional stretch goal.
5. Draw a one-frame spark at each bankshot; make the ricochet trail start at the new trajectory so a tracer never draws through a wall. Add a thin metallic ping with a per-frame sound cap.

**Acceptance:** A pistol round reliably banks off vertical, horizontal, and corner walls; it cannot re-hit the same face forever at distance zero; an ordinary sniper still pierces; rockets still detonate on first contact; pellets remain within budget during high fire rates.

## 4. Signature weapon A: SQUELCH, Adhesive Rebound Mortar

### Fantasy and signature sequence

The **Shotgun's SQUELCH Black Market branch** replaces its pellet spread with an adhesive living projectile. A single soft, glossy, living-looking orb launches ahead of a soldier. On impact it compresses against the wall, wobbles as if filled with gel, and sticks with a rich wet **squelch**. It pauses, winds up like a stretched elastic creature, then peels off and springs away in the reflected direction. A **small chunk of its own body remains stuck to the wall**. That chunk swells with a warm orange internal glow and detonates shortly afterward. The parent orb grows visibly smaller with successive collisions. A larger starting orb has more material to shed, and therefore generally leaves more mines and survives more contacts.

### Mandatory mechanical rules

1. The orb is a **primary weapon projectile** with a custom flight/stick/relaunch state machine.
2. **No fixed total bounce-count limit.** It reflects on every eligible surface while it still has flight distance and sufficient mass to shed mines. Add only a short-lived per-frame collision loop safety cap.
3. **Distance, not elapsed time, is its travel budget.** Sticky delays do not drain distance.
4. The orb deposits an independent sticky mine at each eligible surface hit; the parent loses the corresponding amount of mass.
5. Each impact uses the existing hit normal to determine reflection. Re-launch must leave the surface rather than tunneling into it.
6. Mines persist at their world positions even if their original supporting terrain is later destroyed. They still detonate.
7. An orb expires on depleted travel distance, insufficient mass, out-of-world travel, or a temporary runtime safety timeout. The timeout exists only as a failsafe and must not become the ordinary gameplay limit.

### Recommended first-pass tuning

| Parameter | Suggested start | Meaning |
|---|---:|---|
| Starting mass | 1.00 | Normalized slime mass, linked to rendered area. |
| Minimum living mass | 0.12 | Orb evaporates or pops when too small. |
| Mass shed per impact | 0.075 | One chunk becomes one mine, proportional only for the final fragment. |
| Flight distance budget | 300 world units | Remaining path length decrements only while moving. |
| Flight speed | 260 units/s | Fast enough to watch; not instant. |
| Contact dwell | 0.18 s | Time stuck and visibly jiggling before relaunch. |
| Mine fuse | 0.75 s | Starts when chunk remains on wall. |
| Mine radius | 1.8 cells | Small, readable orange burst. |
| Mine central damage | 5 | Must be calibrated against terrain durability. |
| Max active orbs / mines | 16 / 96 globally | Conservative initial simulation budgets. |

The numbers above create **approximately 11 potential full mine deposits** per baseline orb if geometry and travel distance allow them. This is not a bounce cap: upgrades increase mass and distance, and the travel budget may end before the mass reserve.

### New weapon upgrade tree

| Upgrade | Levels | Proposal |
|---|---:|---|
| SQUELCH Mutation | 1 | Black Market branch commitment: transforms an unlocked Shotgun into the Adhesive Rebound Mortar; requires Blight Essence. Does not grant another weapon slot. |
| Gel Reservoir | 1-6 | +0.15 starting mass per level, allowing more mine deposits. |
| Long Hop | 1-8 | +80 world units of travel budget per level. |
| Elastic Recall | 1-5 | Reduces sticking delay by 0.02 s per level, minimum 0.08 s. |
| Volatile Droplets | 1-6 | +1 center damage per mine per level. |
| Glow Bloom | 1-5 | +0.25 cells mine blast radius per level. |
| Rapid Culture | 1-5 | +10% orb launch frequency per level, subject to pool limits. |
| Living Residue (capstone) | 1 | If multiple mines detonate near one another, the first blast slightly accelerates nearby fuses. No recursive infinite loops. |

### Soft-body appearance, without fragile gameplay physics

Use **hybrid soft-body physics**: simulate the orb's center as one raycast projectile (deterministic collision) and render its outline with an inexpensive spring-mass ring of 8 to 12 control points. Each point has a local displacement and spring velocity. On impact, compress the ring along the contact normal, stretch it tangentially, and let spring damping produce a short jiggle. While stuck, anchor the contact-side points to the surface while the free side slowly deforms; just before departure, stretch backward, then release into a slight overshoot. Scale the outline radius with `sqrt(mass / startingMass)` so the loss of matter is perceptible.

Use Canvas 2D curved silhouettes with pixel-art-conscious sampling, a faint highlight, dark outline, and limited bloom. **Do not** run collision detection on every soft-body node. This would add complexity without improving the core gameplay. The visual jiggle must be visible even at common camera zoom settings and must never obscure tiny terrain cells.

### State machine and data design

`Flying -> StuckJiggle -> Releasing -> Flying -> ... -> Expired`.

Suggested `GooOrb` fields: `x, y, dx, dy, speed, state, stateTimer, distanceRemaining, startingMass, currentMass, massPerMine, minMass, pendingNormalX/Y, ownerId, damage, radius, softBodyPoints`. Suggested `GooMine` fields: `x, y, normalX/Y, fuse, maxFuse, mass, damage, radius, ownerId, active`.

**On collision:**

1. Resolve an impact once using `gridRaycast(world.subSolidQuery, world.subCellSize, ...)`.
2. Compute the future reflected vector and save it; move the orb onto the free side of the surface.
3. Subtract a piece of mass, spawn an attached mine of matching size, emit squelch sound and compression impulse.
4. Enter `StuckJiggle` for the dwell duration. No travel budget is consumed during the pause.
5. Enter `Releasing` for a very brief stretch animation and then continue flying along the stored reflection vector.

**Mine detonation:** Detonate independently after fuse expiration. Apply area damage once through the same world-damage/event attribution pipeline used by the existing grenade/rocket systems; spawn glow, particles, and a soft orange burst. Clustered mines may explode in quick succession, but impose a per-frame damage-event budget.

### Audio and readability

- **Impact:** short filtered noise transient at low-mid frequencies, a descending rubbery pitch chirp, and a tiny slap. Layered, mixed softly, with random pitch variation. Avoid comedy-cartoon boing as the primary timbre.
- **Wobble:** silent visually or a very low, restrained gel creak; do not loop an individual sound on every active orb.
- **Peel/relaunch:** sticky suction pop and higher elastic twang.
- **Mine charging:** orange glow grows from a dot to a soft core; pulse accelerates over the last 0.25 s.
- **Detonation:** compact, moist pop with a low thud, not the same sound as a heavy rocket.
- **Mixing:** spatialize, voice-limit and throttle identical effects so 30 mines do not overwhelm the mix.

### Files and acceptance

Suggested new files: `src/entities/GooOrb.ts`, `src/entities/GooMine.ts`, `src/systems/GooOrbSystem.ts`, `src/rendering/GooRenderer.ts`.

Modify `CombatSystem.ts` (weapon firing and damage events), `Soldier.ts`, `config.ts`, `Game.ts`, `AudioSystem.ts`, progression definitions, `SaveManager.ts`, and upgrade/loadout UI. Keep the update and render responsibilities separated.

**Acceptance:** orb lands, squashes, jellies for roughly 0.18 s, leaves a smaller mine, visibly shrinks, springs out at the correct reflection angle, and ultimately expires from mass/distance. Mines glow orange and explode after their individual fuses. Tested against world border, 50% Blight cells, wall destruction, and two impacts in one update. All pooled state resets correctly on reuse.

## 5. Signature weapon B: Drone Shepherd

### Fantasy

A specialized soldier does not merely carry a stronger gun. It releases little pistol-carrying flying drones that scatter around it like a miniature escort squad. The drones move independently, change their firing angles as they fly, and create a small ballet of intermittent muzzle flashes and brass-like sparks. An upgraded soldier becomes a mobile cloud of combat assistants.

### Recommended classification

Implement **Drone Shepherd as the third Pistol Black Market specialization**, not a standalone primary weapon ID and not an upgrade that gives every soldier drones. The Pistol's primary-fire behavior changes into a carrier that releases autonomous drones; the carrier should have lower direct-fire power than an unmutated Pistol, trading its own firepower for a swarm. Drones are not full `Soldier` instances and do not consume `Additional Soldier` deployment slots.

### Initial behavior

- The carrier emits one drone every **4.5 s**, up to **2 active drones** by default.
- Each drone lives about **12 s**, carries a simple pistol, and fires approximately **1.4 shots/s**.
- Drones circle or sweep around their owner at a radius of approximately **20-36 world units** with smooth velocity and slight variation in altitude/position.
- A drone should usually fire **along its travel direction**, preserving BREACH's movement-shooting identity. A future targeting upgrade may permit small aim corrections toward nearby exposed Blight.
- Drones may fly over low debris but **must not phase through sealed structural walls or locked doors**. Use a cheap visibility and position test before repositioning.
- Drones can take damage from hazards. When the owner dies, the surviving drones finish a short emergency life rather than becoming permanent independent units.
- Kills, drops and progression credit belong to the owner and its save-slot upgrades, never to a new permanent soldier slot.

### Upgrade tree

| Upgrade | Levels | Proposal |
|---|---:|---|
| Shepherd Mutation | 1 | Black Market branch commitment: transforms an unlocked Assault Rifle into the drone-releasing carrier, using Blight Essence. |
| Brood Capacity | 1-5 | +1 active drone per level, maximum 7 per carrier. |
| Assembly Cycle | 1-5 | -8% release interval per level. |
| Pistol Microcaliber | 1-6 | +1 drone bullet damage per level. |
| Flight Programming | 1-5 | +10% drone movement speed and small obstacle-avoidance improvement per level. |
| Stabilized Optics | 1-4 | +5 degrees of limited aim correction per level, maximum 20 degrees. |
| Redundant Frame | 1-4 | +1 drone HP per level. |
| Recall Burst (capstone) | 1 | On drone expiry, it makes one final shot along its current travel vector; no guaranteed target acquisition. |

### Implementation plan

Create `Drone` and a pooled `DroneSystem` with `ownerId`, `slotIndex`, `life`, `hp`, `x/y`, `vx/vy`, `fireCooldown`, orbit phase, and a cached target/avoidance vector. Drive at fixed timestep, do not create DOM nodes, and do not treat drones as full soldiers for physics, fog, loot collection, formation, or deployment. Reuse the shared bullet pool and damage attribution via a narrowly typed `fireDroneShot()` rather than the current turret method's cast-to-`Soldier` sound event shortcut. Implement short-range environment avoidance with simple candidate positions, line-of-sight validation and a bounded fallback, not global pathfinding for every drone.

**Performance rule:** cap the **global** number of drones, initially 24. Reacquire targets periodically (for example 4-5 times/s), never search hundreds of cells for every drone every frame. Render as tiny silhouettes with 2-3 pixel propulsor cues, a distinct mini-muzzle flash, and readable owner coloration. Use pitch-light electric chirps and miniature pistol cracks.

**Acceptance:** drones release sequentially, maintain recognizable movement, never cross sealed rooms, shoot with valid owner attribution, despawn on timer/death, and do not alter soldier-cap or formation code. Drone count stays capped even with duplicate-drone edge cases or invalid legacy saves; Pistol carriers may occupy multiple soldier slots, with per-owner caps and a shared global cap.

## 6. Signature weapon C: Chromatic Prism Laser

### Fantasy

The **Sniper Rifle's Chromatic Prism Black Market branch** replaces its standard piercing projectile with a reflective pulsed beam. The first laser is a thin, hostile **red** beam. Upgrades advance it through the spectrum: **red, orange, yellow, green, blue, indigo, violet**. The beam ricochets off solid surfaces, with each bounce adding a brighter prism accent and increasing the remaining beam's damage and its ability to cut through blocks. An advanced shot can become a fast, vividly colored geometric path across an entire room.

### Precise color rule

- **Purchased Spectrum Level (0-6)** sets the beam's initial band: red at 0, violet at 6.
- **Each successful bounce** adds a visible pulse and raises effective damage and penetration. It also attempts to advance the visual segment **one spectrum band higher**, capped at violet. This means a low-level red beam can briefly show higher colors after ricocheting, while upgrades permanently move its starting color forward.
- Color is informative but **never the only cue** for power. Higher tiers also use distinct brightness, line thickness, break-point spark shapes, and a small UI tier icon. Provide a colorblind-friendly pattern option.

### Rules and first-pass tuning

| Parameter | Suggested start | Meaning |
|---|---:|---|
| Fire form | Pulsed hitscan ray | Trace immediately, display resulting beam for about 0.12 s. |
| Base damage | 3 | Direct block damage before bounce gains. |
| Initial beam distance budget | 380 world units | Shared across all segments of the shot. |
| Initial bounce limit | 2 | Separate from spectrum strength. |
| Bounce damage gain | +25% of base damage per bounce | Additive relative to the first hit, capped by balance. |
| Bounce penetration gain | +1 block budget per bounce | Remaining beam can pass through additional destructible cells. |
| Global safety | 8 bounces, 16 affected blocks, 600 max travel units | Hard technical limits, regardless of purchases. |

**Reflection versus piercing:** A ray damages a solid cell. If it has penetration budget and the material is penetrable, it may pass through that cell, consuming budget; otherwise, it reflects from the contacted surface using the raycast normal. World boundaries stop the ray. This rule must be documented visually, and structural/indestructible surfaces should be classified before implementation. Damage to each cell should be deduplicated within one pulse to prevent zero-distance loops and unintended repeated hits.

### Upgrade tree

| Upgrade | Levels | Proposal |
|---|---:|---|
| Chromatic Mutation | 1 | Black Market branch commitment: transforms the unlocked Sniper Rifle into a pulsed reflection laser; starts red and costs Blight Essence. Mutually exclusive with Rail Lance. |
| Spectrum Ascension | 1-6 | Starts one color band higher per level, with modest base damage increase. |
| Mirror Lattice | 1-5 | +1 allowed ricochet per level, capped at 7 through upgrades. |
| Refraction Gain | 1-5 | +10 percentage points of bounce damage growth per level. |
| Photonic Shear | 1-5 | +1 additional penetration budget on each bounce per level, within global caps. |
| Waveguide Length | 1-5 | +45 world units of total beam length per level, capped globally. |
| Chromatic Overload (capstone) | 1 | At violet, the final bounce releases a small outward light pulse; damage capped independently. |

### Implementation

Create a standalone `LaserSystem.traceShot()` and pool of short-lived `LaserSegment` visuals instead of representing the entire instantaneous beam as one moving `Bullet`. Use the existing subcell grid DDA to find surfaces. Track `{origin, direction, distanceRemaining, bounceCount, pierceRemaining, damageScale, visitedCells, segments}` for each pulse. After every contact, either penetrate, reflect, or terminate, always progressing at least epsilon distance. Emit one damage event per valid hit and one colored visual segment per straight portion. Build a lightweight beam renderer with an inner white line, colored edge, small reflection star, and very restrained bloom.

**Performance and determinism:** no per-frame hitscan re-trace while a pulse is visible. Damage resolves once on firing; the segment list animates for ~0.12 seconds. Impose strict hit/bounce/segment budgets. Do not allow the beam to repeatedly strike the same cell in the same pulse.

**Acceptance:** the beam begins red without purchases, advances color by spectrum level, visibly changes at bounces, increases damage and pierce after bounces, cannot escape its travel budget, cannot loop between two faces indefinitely, and has deterministic corner handling.

## 7. Signature weapon D: Momentum Katana

### Fantasy

The Katana's **Momentum Black Market branch** turns its base slash behavior into a speed-driven dash-and-cleave specialization. The katana specialist behaves like a pinball swordsman. A wall impact triggers a sharp burst of speed; the soldier briefly accelerates along its **new reflected trajectory**, carving a much larger and stronger crescent slash while moving fast. The dash then loses speed smoothly until normal travel resumes. An expert player learns to read wall geometry and use rebounds to create huge cleaving sweeps.

### Combat formulas (proposed)

Let `baseSpeed` be the soldier's ordinary upgraded movement speed and `currentSpeed = hypot(vx, vy)`. For each slash, calculate:

- `speedRatio = clamp(currentSpeed / max(baseSpeed, epsilon), 1, 2.6)`.
- `slashDamage = baseSlashDamage * (1 + 0.55 * (speedRatio - 1))`, rounded using the existing damage convention.
- `slashWidth = baseSlashWidth * (1 + 0.35 * (speedRatio - 1))`.
- Capture these values **when the slash is spawned**. Do not rescale already active slash projectiles every frame.

Proposed dash: on a valid wall rebound, set movement to **2.25x ordinary speed** immediately along the reflected velocity and ease to **1.0x** over **0.70 s** using `scale(t) = 1 + (2.25 - 1) * (1 - t / 0.70)^2`. Cooldown initially **1.8 s**. Use fixed timestep; collisions during cooldown bounce ordinarily. Apply dash only to autonomous katana soldiers unless player-controlled dash is explicitly added later.

### Upgrade tree

| Upgrade | Levels | Proposal |
|---|---:|---|
| Rebound Dash Mutation | 1 | Black Market branch commitment that enables wall-triggered burst and speed decay for the existing Katana; mutually exclusive with its other mutation branch. |
| Impulse Engine | 1-5 | +0.15 peak speed multiplier per level, within a hard speed cap. |
| Extended Glide | 1-5 | +0.10 s dash duration per level. |
| Kinetic Edge | 1-5 | +10% to the velocity-derived damage bonus per level. |
| Wide Momentum | 1-5 | +10% to the velocity-derived slash-width bonus per level. |
| Recovery Training | 1-4 | -0.20 s dash cooldown per level, bounded by minimum. |
| Perfect Rebound (capstone) | 1 | The first slash after a dash trigger gets an extra luminous afterimage but no additional collision hit. |

### Required physics correction

`PhysicsSystem.step()` currently derives its substep count from `s.speed * dt`, even though a dash would make `hypot(s.vx, s.vy)` significantly larger. Update substep sizing to use actual displacement magnitude. `PhysicsSystem.resolve()` also rewrites velocity using `s.speed` for several behavior modes. Add a consistent `effectiveMoveSpeed` or keep a dash scale that collision response respects, so reflections do not silently remove the dash. Preserve manual controls, sentry behaviors, formations, and wall recovery.

`PhysicsSystem.step()` currently returns only bounce count. For the dash trigger, either return structured collision data (preferred), or emit a bounce event containing surface normal, reflected velocity and soldier ID. Trigger the dash **after reflection**, not before. Apply at most one new dash activation per fixed step, even if the soldier makes multiple tiny contacts. Never dash on Blight rescue relocation or incidental soldier-to-soldier separation.

### Presentation and acceptance

Make dash acceleration visible with a brief high-contrast cyan trail, stretched ring, momentary motion blur mimic, and a strong but short swish. Slash curvature and width must visibly scale with actual velocity, not just display numbers. During the glide, both damage and arc shrink gradually as the soldier returns to normal speed. Validate narrow tunnels, tight corners, high speed crossing one-cell gaps, sentry modes, and camera follow.

## 8. Weapon role clarification: two new secondary abilities and one Pistol Black Market mutation

**Required weapon classifications:** Echo Stapler and Resonance Bell are **secondary weapons/abilities** that can be equipped in the same existing per-soldier secondary slot as Grenade or Turret. Reverse-Playback Revolver is **not a secondary** and **not a new base gun**: it is a Blight Essence Black Market path attached to the Pistol. Their implementation may be staged after the first signature weapons, but their classifications are definitive.

### 8.1 Echo Stapler: charged secondary weapon

**Fantasy:** The soldier fires a luminous staple into a wall. On a later charged activation, another staple lands on a second surface and connects to the first with a taut luminous wire. When Blight expands across the connecting line, it snaps in a bright cutting pulse. The player constructs traps by exploiting the soldier's trajectory and the terrain geometry.

**Equipment and activation:** Equip `secondary = "echo_stapler"` alongside any primary. The existing destroyed-block energy meter charges this ability. **Each completed activation consumes one charge and fires one staple** in the soldier's travel or manually aimed direction. The first successful anchor remains armed for a generous period (proposed 20 s); the next successful staple pairs with it and creates a wire. If an anchor expires, is invalid, or cannot legally connect, communicate this and start a new pair instead of charging the player for a silently useless link. The secondary does not replace regular primary fire.

| Echo Stapler upgrade | Levels | First-pass proposal |
|---|---:|---|
| Unlock Echo Stapler | 1 | Adds Echo Stapler to the secondary equipment picker. |
| Capacitor | 1–5 | Reduces charged energy required per staple activation. |
| Long Filament | 1–5 | Increases maximum allowed distance between two anchors. |
| Persistent Anchors | 1–4 | Increases unpaired anchor and completed-wire lifetimes. |
| Razor Frequency | 1–6 | Increases Blight cutting damage when a wire trips. |
| Wire Network | 1–3 | Allows additional simultaneous completed links per soldier. |
| Triangular Web (capstone) | 1 | Three nearby compatible anchors may make a triangle; each segment may trigger separately, with bounded total damage. |

**Implementation:** Add a pooled anchor/link state machine with owner ID, position, normal, partner ID, expiration, and consumed state. Anchor placement uses the existing subcell raycast and avoids placing in void or invalid outside surfaces. Test segment intersection against newly created Blight during growth callbacks or a bounded queue of changed cells, not by scanning the whole map every frame. Only trigger each eligible wire once per activation cycle. Effects: a twitching, glowing thin line; metallic staple click; taut string-like tension; crisp tearing shock pulse. Preserve correct owner attribution and limits when many soldiers equip this secondary.

**Acceptance:** Charges correctly, shoots one staple per charge, pairs the next valid staple, pulses when Blight grows across the wire, expires predictably, and never grants another primary weapon or extra soldier. Recharging must be practical enough that a pair of anchors can normally be placed before the first expires.

### 8.2 Reverse-Playback Revolver: Pistol Black Market mutation

**Fantasy:** An ordinary Pistol shot records the exact route of its bullet, including bankshots. After its flight ends, a spectral shot rewinds along **the recorded path in reverse**, damaging intersected terrain as it retraces the route. A clever initial shot becomes a powerful return attack.

**Equipment:** This is `weapon = "pistol"` with a selected per-soldier **`reverse_playback` mutation** in the Black Market. It consumes Blight Essence for commitment and branch upgrades. It is **not** a separately selectable `WeaponType` or a charged secondary ability. More than one Pistol soldier may independently choose this mutation, subject to pooled trail-memory and active-replay budgets.

| Playback Revolver upgrade | Levels | First-pass proposal |
|---|---:|---|
| Temporal Chamber | 1 | Black Market commitment: enables delayed reverse trajectory replay. |
| Memory Spool | 1–5 | Increases maximum recorded trajectory length/waypoints. |
| Reverse Charge | 1–6 | Improves return-pass damage. |
| Quick Rewind | 1–4 | Reduces the wait before the replay starts. |
| Ghost Penetration | 1–4 | Gives the returning trace a limited additional terrain penetration budget. |
| Second Echo (capstone) | 1 | Creates one weaker follow-up return pulse, with strict hit and memory caps. |

**Implementation:** During the forward shot, record meaningful traveled segments and reflected corners in a capped, pooled polyline. At end of the shot, replay the line in reverse at a visibly deliberate speed, using per-segment swept damage tests and a per-replay set of already-hit cells/targets. The reverse visual is ghostly and should precisely follow the outgoing route rather than choosing a newly recalculated ricochet. Damage from replay is attributed to the Pistol owner. Cap route nodes, memory, repeat hits and global replay count; don't allow newly broken walls to invalidate the replay visual or create damage through story-gated space unexpectedly.

**Acceptance:** A Pistol with the mutation records forward bounces, then displays a clearly reversed damaging trajectory. An ordinary Pistol remains unchanged; two Pistol holders can use different mutation states without sharing levels, and neither uses the secondary-energy bar for rewinding.

### 8.3 Resonance Bell: charged secondary weapon

**Fantasy:** The soldier releases a pulse of small, heavy sonic orbs that stick to nearby surfaces as vibrating notes. When three placed notes are sufficiently close, their waves synchronize, producing a deep, expanding resonant shockwave. A trio of notes makes one geometric combination rather than three unrelated explosions.

**Equipment and activation:** Equip `secondary = "resonance_bell"` alongside any primary. Consume a full ordinary secondary-energy charge on activation. **One activation launches a short three-note volley** along the user's aim or the soldier's forward motion, with modest deliberate spread, so a single charge can create a recognizable resonant combination. Each note travels, bounces or sticks using defined collision normals and then becomes stationary. When three active compatible notes land within the synchronization radius, their pulse timings converge and the trio detonates once after a brief audiovisual anticipation. If notes land too far apart, they remain active until their individual timers expire; never spawn an unexplained explosion.

| Resonance Bell upgrade | Levels | First-pass proposal |
|---|---:|---|
| Unlock Resonance Bell | 1 | Adds Resonance Bell to the secondary equipment picker. |
| Low-Frequency Capacitor | 1–5 | Reduces required energy per volley. |
| Sustained Note | 1–5 | Extends node lifetime, allowing more time for trios to form. |
| Harmonic Radius | 1–5 | Widens the radius at which three notes can synchronize. |
| Resonant Force | 1–6 | Increases the synchronized wave's terrain/Blight damage. |
| Echo Ring | 1–4 | Adds a weaker delayed outer ring after a successful three-note shockwave. |
| Perfect Chord (capstone) | 1 | One well-formed trio releases a pronounced second pulse, with an explicit once-per-trio trigger guard. |

**Implementation:** Use pooled sonic nodes tagged with owner, activation/volley ID, position, active life and trigger state. Resolve three-note neighbor combinations on placement or bounded local updates, not via full-map scans. Begin with owner-local trios to avoid cross-soldier attribution complexity; cross-owner harmonies would be an explicit later feature. Prevent a trio from triggering twice or recursively re-triggering itself. Draw concentric ripples with shader-free Canvas effects and layered metallic/procedural bell tones with limited audio voices.

**Acceptance:** One charged activation creates the three-note volley, combinations depend on geometry, a qualifying trio triggers exactly once, and the effect is perceptible independently of audio. Multiple soldiers may equip Bell because secondary uniqueness is not restricted.

### Shared secondary integration and save rules

- Extend `SecondaryWeaponType` in `src/entities/Soldier.ts` to include `"echo_stapler" | "resonance_bell"`; keep `WeaponType` unchanged. The separate `secondary` field holds only one active secondary per soldier, so equipping one replaces Grenade, Turret or the other new secondary.
- Add unlock IDs and upgrade definitions for both new secondaries to `src/progression/UpgradeDefinitions.ts`, with appropriate normal research costs. **These two secondaries do not require selection in the Black Market and do not consume Blight Essence simply to equip.** Their pricing may use existing currency tiers; tune after playtests.
- Extend the `VALID_SECONDARY_WEAPONS` allowlist, per-secondary unlock sanitation in `src/progression/SaveManager.ts`, and equipment buttons/labels in `src/ui/UpgradeTree.ts`.
- Implement explicit cases for both in `Game.isSecondaryUnlocked`, `getSecondaryEnergyRequired`, `activateSecondary`, automatic activation and the HUD's ready-state display. The current `getSecondaryEnergyRequired` falls back to Grenade's threshold for unrecognized values; **replace this implicit fallback with exhaustive matching** so Bell or Stapler doesn't accidentally inherit the wrong energy cost.
- Existing energy collection is based on damage-attributed block destruction (`checkSecondaryCharge`); retain this model. Deduct energy only on accepted deployment; if no projectile can be spawned because a pool is exhausted, do not silently consume the charge. The default auto-activation mode should work, but must not flood the screen with unsupported anchors or sonic notes.
- Secondary upgrades must not interfere with `SaveData.weaponSpecializations` or the primary-weapon one-per-squad exclusivity rule. Both secondary weapons are available to multiple soldiers independently, unless a future balance decision changes that rule.
- Regression tests: secondary slot replacement; charge consumption and refund on failed activation; load/save of both new IDs; invalid or locked secondaries sanitized to null; disabled selection when locked; auto and manual triggers; owner credit; deterministic pairing/chording; capped active entities.


## 9. Upgrade economy, unlock order, and build constraints

Recommended rollout:

1. Make **Pistol Bankshot** available early so players learn the concept in familiar rooms.
2. Add **Shotgun Rebound** as a midgame spatial weapon choice.
3. Unlock **Black Market research** after the player acquires Blight Essence. Transform a **Shotgun into SQUELCH** once players have encountered small Blight clusters and destructible corridor geometry.
4. Allow **Pistol → Drone Shepherd** when multi-soldier loadouts and Blight threats are established; drones should not make initial soldiers redundant.
5. Allow **Sniper Rifle → Chromatic Prism** as a rare advanced Black Market branch, with the first two color upgrades affordable quickly enough to preview its progression. Offer **Sniper Rifle → Rail Lance** as an equally meaningful alternative.
6. Add **Katana → Momentum Katana** as an exclusive Blight Essence specialization to its existing tree, rather than creating a redundant standalone katana variant.

Preserve the current gold / orange crystal / green crystal / Blight Essence / biomass economy. **Blight Essence is the main Black Market currency**: spend it on mutations and their dedicated tiers, not on basic weapon availability. Avoid inserting Black Market research into all early core progression prerequisites, which would turn excitement into mandatory payment. Use appropriately tiered upgrade costs after balance testing. Branches are exclusive per weapon, prominently displayed, and safely reconfigurable in the lab. **Do not automatically grant penetration and ricochet on the same ordinary projectile** unless a specific capstone explicitly defines that interaction.

## 9A. Blight Essence Black Market: transformational weapon trees

**Status: mandatory design direction for this expansion; individual branch numbers remain proposals.** The laboratory discovers that Blight Essence can be fused with ordinary weapon mechanisms to create unstable, alien-derived technologies. The player first unlocks and improves a conventional gun with the existing resource trees. In a distinct **BLACK MARKET** panel, they can then select **one** Essence-driven mutation path for that base weapon. The choice changes its behavior and presentation, not merely its damage output. The base weapon remains the equipped primary; transformed variants are **not additional weapons** selectable in loadout.

### Core player flow and branch rules

1. Unlock a base weapon normally. Keep its conventional tree, damage upgrades, and standard eligibility; opening the Black Market is a separate milestone granted after encountering/collecting Blight Essence.
2. Select the weapon in the laboratory. Show its unmodified mode plus all **currently designed** mutation cards (one is sufficient when only one branch is implemented), with short animated examples or illustrated diagrams, explicit tradeoffs, prerequisites and Essence costs. Never invent an unimplemented branch merely to fill the UI.
3. Commit to **at most one active mutation per weapon**. A mutation replaces or rewrites the normal firing behavior and can contain a short 3–6-tier specialist subtree ending in a dramatic capstone. Branches cannot be combined into a third accidental hybrid.
4. Lock or clearly mark base upgrades that become mechanically irrelevant. When possible, translate generic damage, fire-rate and velocity bonuses into meaningful variant parameters using an explicit compatibility map. Never silently charge currency for a stat that no longer functions.
5. Provide a **Reconfigure** action in the laboratory outside an active run. Recommended initial policy: a branch switch refunds exactly the Essence spent on the deselected branch, resets its purchased levels, and atomically charges for the newly selected branch. Do not refund unrelated base-weapon research; do not permit negative balances, duplication exploits or retroactive changes to a running attempt.
6. Every variant remains a specialization of its **base weapon identity** for uniqueness checks, save validation, upgrade access, stats, UI tooltips, deployment, achievements and ownership. A Prism Sniper and a Rail Lance are both still a `sniper_rifle`.
7. A weapon's identity should be immediately recognizable on screen: distinctive projectile motion, collision behavior, visual silhouette, effects and sound. Prefer alternate geometry and cause-and-effect over flat damage multipliers.

### Proposed Black Market mutation paths

All branch labels other than the user-requested signature concepts are **optional design candidates**. Do not implement speculative counterparts without a dedicated balance/design pass.

| Base weapon | Accepted mutations |
|---|---|
| Pistol | Reverse-Playback Revolver; Orbit Cylinder; **Drone Shepherd (third branch)** |
| Shotgun | SQUELCH; **Vacuum Pulse** |
| Assault Rifle | **Undecided: no accepted branches** |
| Rocket Launcher | **Burrower; Freeze Rockets** |
| Sniper Rifle | Chromatic Prism; **Rail Lance** |
| Katana | Momentum Katana; Gale Edge |
| Flamethrower | **Napalm Garden; Cryospray** |

Fixed timings, freeze/shatter rules, implementation phases, and code audit status are specified in [the revised plan](BLACK_MARKET_IMPLEMENTATION_PLAN.md). Do not implement superseded speculative counterparts.

### Katana: Gale Edge ranged flying slash mutation

**Core requirement:** Gale Edge must turn the Katana into a recognizably **ranged primary weapon**. The existing unmodified Katana already launches a short-lived slash-shaped projectile (`CombatSystem.spawnSlash`, `KATANA.lifetime = 0.28 s`, `bulletSpeed = 420` in the inspected base config). **Do not implement the requested mutation as a cosmetic traveling slash; that behavior already exists.** Compared with the base attack, Gale Edge should propel a much farther-reaching, persistent crescent that passes through the air, can cut multiple cells along a long path, and is visibly distinct at distant range.

**Exclusive choice:** It is the alternative to Momentum Katana. Momentum's collision-triggered dash and velocity-scaling slash are not active when Gale Edge is chosen. The original Katana remains equipped for the entire mutation; never create a separate equippable `gale_edge` weapon ID.

**First-pass behavior proposal:** On each Katana firing event, spawn a luminous airborne crescent aligned with the soldier's current travel/aim direction, with a large translucent trailing arc and a sharp leading edge. Proposed initial reach is **300 world units** before upgrades (versus approximately 118 units of travel for the current 420 × 0.28 s slash at base speed). Start with moderate width and 1–2 penetrations; preserve a swept collision test and proper owner attribution. The crescent may fade visually and lose a small amount of damage with distance, but its world collision width and damage must match the readable graphic. It is a moving projectile, **not a fullscreen hitscan, auto-aiming attack or wall-ignoring beam**. Sealed gates and world boundaries remain authoritative.

| Gale Edge Black Market upgrade | Levels | First-pass effect |
|---|---:|---|
| Windborn Blade | 1 | Commits Essence and switches Katana to long-range airborne crescent slashes. |
| Extended Horizon | 1–6 | +60 world units maximum flying-slash travel distance per level, capped for performance. |
| Cutting Gale | 1–5 | +15% crescent damage per level. |
| Sweeping Wind | 1–5 | +10% airborne crescent collision and render width per level. |
| Hollow Edge | 1–4 | +1 destructible-cell penetration per level. |
| Blade Velocity | 1–5 | +12% traveling slash speed per level, without extending range accidentally. |
| Storm Crescent (capstone) | 1 | On the first successful terrain destruction, release a brief secondary smaller crescent with strict per-shot limits. |

**Implementation:** Extend slash data in `src/entities/Bullet.ts` to include explicit traveled-distance budget and a branch style ID or policy, rather than only relying on lifetime. Integrate a `gale_edge` branch in Katana fire dispatch in `src/systems/CombatSystem.ts`, snapshot upgrades at fire time, and apply the projectile's swept trace and cleave width consistently. Render a longer, gradually fading crescent and motion trail in `src/rendering/Renderer.ts`; add a prominent airy slicing sound in `src/audio/AudioSystem.ts`. Keep the ordinary Katana's speed/width behavior and Momentum's physics unchanged outside this active mutation. Clamp active slashes, hits per frame and total distance so no distant corridor generates unbounded collision work.

**Acceptance:** The first Gale Edge tier visibly cuts well beyond normal Katana range, can penetrate multiple destructible cells, responds to its dedicated range/width/speed tiers, and never activates Momentum's wall dash. Switching back to unmutated Katana restores its original short-range attack. Existing Katana upgrades that affect slash damage, width or penetration either map into Gale Edge explicitly or are shown as inactive, not silently charged.

### Sniper Rifle: two required example paths

**A. Chromatic Prism (the previously requested rainbow laser).** Keep the full color, ricochet, damage and penetration specification in Section 6. Purchasing the first Prism mutation changes Sniper primary fire to the red beam. `Spectrum Ascension`, `Mirror Lattice`, `Refraction Gain`, `Photonic Shear`, and `Waveguide Length` are **Prism-only** Essence upgrades. Their levels cannot modify Rail Lance. Ordinary Sniper penetration/critical-shot upgrades must be mapped explicitly or suppressed with a clear tooltip; do not accidentally allow ordinary AP piercing to bypass reflective behavior.

**B. Rail Lance (the alternate super-piercing shot).** Replace the Sniper projectile with a visibly charged, narrow, brilliant straight-line shot. On firing, trace its entire remaining distance and apply damage **once per damageable intersected cell or creature** with no ordinary `pierceLeft` depletion. It can pass through intervening terrain rather than being consumed, including cells too durable to destroy, but does not destroy indestructible/story-critical barriers or travel beyond the world boundary. Define story-gate/sector-boundary treatment explicitly: a locked world gate must not be opened or bypassed by a beam that cuts through its pixels. Suggested first-pass upgrades: **Lance Length (1–6)** extends range; **Core Density (1–6)** increases per-cell damage; **Charge Capacitor (1–5)** reduces wind-up without removing visible anticipation; **Aftershock (1–4)** produces a weaker second pulse down the same recorded line; **Absolute Line (capstone 1)** adds a distinct high-intensity tracer and a small damage bonus against Blight Cores. Each upgrade uses Blight Essence, with cost values set during balance work.

**Technical rule:** Trace the full ray with bounded DDA/hitscan or a carefully swept projectile and deduplicate intersected entities. Standard Sniper/Prism/Rail Lance fire modes share weapon identity but use different hit policies and distinct renderers. Enforce work budgets and world-edge limits; do not give the player an infinite ray that stalls the simulation. Rail Lance is piercing through its **traveled straight path**, not a global map-wide hit. Give it a sufficiently clear charge and sound cue that the player can understand why the shot is special.

### Black Market data, costs, and implementation instructions

- **Persistence:** Keep non-pistol weapon research and active mutation in `SaveData.weaponSpecializations`, keyed by **base weapon ID** (e.g., `sniper_rifle`), so transferring a unique gun to another soldier does not erase its paid mutation. Store Pistol mutation state **per soldier loadout** because multiple Pistols may coexist and evolve differently. Use explicit typed branch IDs and branch-upgrade levels rather than storing alternate primary weapon IDs.
- **Upgrade system:** Define mutation unlocks, prerequisite checks, Essence costs, incompatibility groups, max levels and capstones in a dedicated registry such as `src/progression/WeaponSpecializations.ts` or a clean extension to `UpgradeDefinitions.ts`. Integrate with existing purchase/save transactions, including enough cost-history or deterministic cost schedules for exact refunds when reconfiguring.
- **Runtime:** Resolve an equipped soldier's effective primary-fire strategy from `weapon` plus the saved active mutation. Keep standard Pistol/Shotgun/AR/Sniper/etc. behavior intact when the branch is `null`. Route variant mechanics to dedicated systems where needed, rather than accumulating all behavior in the existing `CombatSystem.fire` switch.
- **UI:** Add a distinct laboratory Black Market/Alien Technology view. Display Essence balance, base gun, mutation previews, base-tree compatibility notices, selected branch, disabled conflicting branches, and an explicit **Reconfigure** confirmation. Show the chosen mutation name on the soldier's weapon card, while using the base gun for uniqueness.
- **Loadout independence:** A change of which soldier holds a non-pistol gun moves its associated mutation without extra Essence charges. The Pistol's per-slot mutation remains attached to that soldier's slot. Weapon changes made during a run, if ever supported, must not silently rewrite active projectile behavior or duplicate paid mutations.
- **Migration:** For existing saves, default branches to `null`, new levels to zero, and keep already-earned Essence unchanged. Sanitize unknown branch IDs, invalid branch/weapon combinations, illegal levels and incompatible simultaneous active choices. Gale Edge and Reverse-Playback Revolver must deserialize as Katana and Pistol mutation IDs respectively, not newly invented primary weapons. Echo Stapler and Resonance Bell deserialize as secondary IDs, not mutations.
- **Tests:** Branch commitment and rejection; switching/refund exactly once; conventional stats compatibility; a mutated gun moved to a different soldier; independent Pistol Playback Revolver branch levels; Gale Edge/Momentum mutual exclusion; old save migration; no mutation-enabled weapon duplication; Prism versus Rail Lance collision policy, story gates, and costs; Echo Stapler and Resonance Bell remain independent secondaries.

## 9B. Mandatory squad rule: unique non-pistol primary weapons

**This is a required implementation change, not merely an optional design suggestion.** Each soldier already has one `weapon: WeaponType` primary. Extend that constraint across the squad:

- **Pistol is unrestricted:** any number of soldiers can use the standard Pistol or their own Pistol mutation. Pistol is the safe default.
- **Every other primary weapon is unique across the entire squad:** at most **one equipped Shotgun, one Assault Rifle, one Rocket Launcher, one Sniper Rifle, one Katana, and one Flamethrower**, plus at most one of each future non-pistol base type. This means only one SQUELCH user because SQUELCH is a Shotgun, only one Chromatic Prism **or** Rail Lance user because both are a Sniper Rifle, while Drone Shepherd is Pistol branch 3 and may have multiple carriers within owner/global drone caps.
- **No mutation loopholes:** variants never create additional equip slots or appear as parallel, independently assignable base weapons. Drones are auxiliary units, not primary-weapon holders or additional soldier slots. Secondary abilities (Grenade / Turret / Echo Stapler / Resonance Bell) are unaffected by this uniqueness rule; multiple soldiers may use the same secondary.
- **Equip interaction:** in `src/ui/UpgradeTree.ts`, disable a non-pistol weapon button when another soldier owns it, with a tooltip such as `Equipped by Soldier #3`. The current owner may keep/select it; do not silently unequip an existing soldier to satisfy a new click. The player must first switch the existing holder to Pistol, then equip the released weapon elsewhere. Re-render all weapon cards after each change.
- **Authoritative validation:** add a reusable `canEquipPrimary(loadouts, slot, weapon)` check in the data/model layer and call it from the UI click handler, any other equip entrypoint, and game/deployment setup. UI disabled styling alone is not sufficient. The model must reject duplicate equip requests even if triggered programmatically.
- **Legacy save migration:** inside `sanitizeSaveData`, after unknown/unlocked weapon normalization, visit loadouts in deterministic increasing slot order (all saved slots, even if not yet unlocked). Keep the **lowest-index** owner of each non-pistol weapon and change subsequent duplicate owners to Pistol; preserve their secondary selection, behavior, equipment and personal skill-upgrade levels. Do **not** delete or refund the shared weapon unlock. A future explicit user-controlled transfer can move the gun without re-purchasing it.
- **Squad construction:** validate again before spawning soldiers in `src/Game.ts` so an unexpected malformed state cannot produce two live wielders of the same non-pistol weapon. If normalization is required, use the same deterministic strategy and persist the corrected state safely.
- **Regression tests:** duplicate non-pistol click blocked; pistol duplicates allowed; same-slot reselect allowed; transferring ownership works after unequip; duplicate legacy saved values resolve deterministically; inactive slots and newly unlocked slots cannot bypass uniqueness; mutation variants share the base gun's exclusivity; normal save/load preserves legal equipment.

## 10. Engineering work plan

| Phase | Scope | Deliverable | Test gate |
|---|---|---|---|
| 0. Baseline, squad uniqueness, and harness | Confirm current tests/build; implement non-pistol loadout exclusivity with UI, model and save normalization; add corridor/corner/half-size Blight fixtures. | Unique-weapon squad behavior and reproducible collision tests. | Duplicate legacy loadouts migrate; new duplicate equips are rejected; Pistol remains shareable. |
| 1. Reflection foundation | Extend bullet state, impact policies, reflection helper and events. | Pistol bankshot and basic shotgun bankshot. | Bounce normal, budget, no stuck loops, penetration precedence. |
| 2. Goo prototype | One orb with mass, delayed reflection and one independent mine type. | Functional SQUELCH without expensive visuals. | Flight distance and mass accounting. |
| 3. Goo polish | Spring-rendered wobble, orange mine charge, squelch and peel audio, pool guards. | Signature tactile weapon slice. | Render/audio budget, pool reuse, no missed effects. |
| 4. Katana mutation alternatives | Dash state, actual-velocity physics substeps, and snapshot-on-spawn slash scaling; implement Gale Edge's long-distance traveling crescent and branch exclusivity. | Mutually exclusive Momentum Katana and Gale Edge ranged Katana. | Stable 2–3x-speed collisions, correct long-distance slash reach and penetration, never both mutation behaviors. |
| 5. Drone system | New drone actors, validated orbit/avoidance, pistol firing, ownership. | Drone Shepherd. | Global caps and no sealed-wall crossing. |
| 6. Prism laser | Single-shot ray trace, color progression, reflection and pierce policy. | Chromatic Prism. | No self-intersection loops or repeated damage. |
| 7. Black Market and secondary progression | Blight Essence branch purchase/respec registry (including Playback Revolver and Gale Edge), add Echo Stapler and Resonance Bell to charged secondary systems and unlock trees, unique equip tooltips, mutation compatibility, audio toggles and save migration. | Cohesive laboratory Black Market, expanded secondaries and squad loadout release. | Only one active mutation per base gun; one secondary per soldier; no duplicate non-pistol primaries; old saves and currency preserved. |
| 8. Balancing | Combat telemetry, weapon identity, pacing, performance on laptop/mobile. | Playtest-ready candidate. | Distinct builds without runaway power. |

### Files most likely to change

| Existing file | Expected work |
|---|---|
| `src/entities/Bullet.ts` | Ordinary bounce counters, retention and reset discipline. |
| `src/entities/Soldier.ts` | **Preserve primary `WeaponType` IDs**; extend `SecondaryWeaponType` with Echo Stapler and Resonance Bell; derived stats, dash runtime fields. |
| `src/systems/CombatSystem.ts` | Ricochet hit policy, new fire dispatch, drone shot helper, event plumbing. |
| `src/systems/PhysicsSystem.ts` | Real-velocity substeps, safe dash preservation, bounce events. |
| `src/core/gridRaycast.ts` | Possibly add reusable reflection and corner-case helpers; avoid changing stable DDA needlessly. |
| `src/Game.ts` | Systems' lifetime, fixed-step order, reset/disposal, effects, plus explicit charged-secondary unlocking, energy thresholds and activation cases. |
| `src/rendering/Renderer.ts` | Dispatch for goo, drones, prism segments and dash trail. |
| `src/audio/AudioSystem.ts` | Distinct wet, electric and prismatic cues with throttling. |
| `src/config.ts` | Numerical tuning and pool caps. |
| `src/progression/UpgradeDefinitions.ts` | Shared weapon trees and their apply/stat definitions. |
| `src/progression/SaveManager.ts` | Typed mutation persistence (Playback Pistol and Gale Katana), new secondary allowlist and unlock sanitation, non-pistol duplicate normalization, old-save defaults and Essence integrity. |
| `src/ui/UpgradeTree.ts` | Unique-weapon equip controls/owner tooltips; Black Market view for Playback Revolver and Gale Edge; Echo Stapler and Resonance Bell selectable in **secondary** picker with energy cost and status; path previews and reconfiguration. |

Suggested new files: `src/entities/GooOrb.ts`, `GooMine.ts`, `Drone.ts`, `SonicNode.ts`, `StapleAnchor.ts`; `src/systems/GooOrbSystem.ts`, `DroneSystem.ts`, `LaserSystem.ts`, `EchoStaplerSystem.ts`, `ResonanceBellSystem.ts`, optional `RailLanceSystem.ts`; `src/rendering/GooRenderer.ts`, `DroneRenderer.ts`, `PrismRenderer.ts`; `src/progression/WeaponSpecializations.ts` and `PrimaryWeaponEquipRules.ts`; and focused `tests/` coverage for each system.

## 11. Required test suite

**Projectile behavior:** reflect across vertical and horizontal surfaces; corner collision; exact cell-edge launch; zero-distance impact; 50% Blight subcells; a wall destroyed during impact; pierce greater than zero; out-of-bounds normals; max iterations in a fixed frame; no projectile-state leakage after pooling.

**SQUELCH:** full squish/stick/release cycle; variable frame pacing with fixed timestep; monotonically decreasing mass; no distance consumed while stuck; mine count matches valid hits; detonate after support wall is destroyed; correct owner credit; mine pool at capacity; orb destroyed before first bounce; fading glow under reduced effects settings.

**Drones:** release frequency and global cap; owner death; old save slots; travel near doors and narrow rooms; no wall phasing; damage attribution; no soldier slot consumption; target search throttling; multiple Pistol/Drone Shepherd carriers within per-owner and global caps; corrupted duplicate carriers must not bypass those caps.

**Chromatic Prism:** all seven initial colors; color shifts on bounce; increasing damage and penetration; pierce-versus-reflection precedence; duplicate-cell suppression; maximum hit/segment/distance caps; tracing at low frame rate; consistent damage regardless of visual lifetime.

**Momentum Katana:** dash only after a real bounce; speed peaks and decays smoothly; slash values captured at spawn; collisions at peak speed without tunneling; manual and formation behavior unmodified; simultaneous or repeat bounces do not bypass cooldown.

**Progression:** missing/new keys default to zero; old saves load; max levels cannot be exceeded; weapon loadouts sanitize to Pistol if unlocks are unavailable; duplicate non-pistol weapons are normalized and rejected at equip time; branches are exclusive and purchased with Essence; a respec refunds precisely the abandoned branch purchases without creating currency, and does not invalidate ongoing runs. The same mutant Sniper cannot be equipped twice under alternate names. Reverse-Playback Revolver uses the Pistol's branch tree, Gale Edge uses the Katana's alternative branch, and Echo Stapler/Resonance Bell use secondary unlocks and energy rules without any primary mutation ID.

## 12. Performance, accessibility, and tuning measurements

**Initial budgets, to adjust after profiling:** 16 goo orbs, 96 goo mines, 24 global drones, no more than 8 laser reflections / 16 affected cells per shot, bounded sonic effects and particle bursts. Avoid scanning all terrain for every drone per frame. Preallocate frequently reused arrays and point buffers where useful. Bound per-frame mine-explosion processing so clustered detonations do not freeze the simulation.

**Telemeter:** bounce count distribution per bullet and per goo orb; mine placement and detonation rates; percent of shots reflecting in open vs narrow rooms; average drone shots and useful hits; laser segment/hit counts; katana dash uptime and damage earned while boosted; CPU time in collision, rendering and audio; entities dropped because pools were full.

**Accessibility:** optional reduced flashes, restrained camera motion, independent effects volume, colorblind-redundant prism indicators, visual alternatives for the wet audio cues, and the ability to distinguish sticky mine fuse timing without relying solely on hue. Keep bloom scalable with existing lighting settings.

**Balance risks:** mass and travel upgrades may multiply goo mine count; drone count and damage stack across many soldiers; laser damage and penetration can scale superlinearly with bounces; dash can outpace collision resolution; normal bullet ricochets can increase effective DPS in corridors. Tune weapon effectiveness both in open rooms and dense choke points. A flashy weapon should be fun without rendering every prior weapon obsolete.

## 13. Definition of done for the first playable expansion

- [x] Pistol and Shotgun can buy weapon-specific bullet ricochet upgrades, without giving bounce to piercing sniper bullets, rockets or flames.
- [x] SQUELCH visibly squashes, clings, jiggles, peels off and rebounds; it leaves a smaller orange-glowing sticky mine at every qualifying contact.
- [x] SQUELCH's lifetime is constrained by traveled distance and mass, not an arbitrary number of bounces; upgraded starting mass extends potential mine deposits.
- [x] Mine fuses and damage are deterministic, owner-attributed, pool-limited, and legible in crowded scenes.
- [x] Drone Shepherd deploys individually moving miniature pistol drones that do not count as full soldiers or pass through sealed walls.
- [x] Chromatic Prism starts red and progresses through seven color bands; each bounce raises damage and pierce within hard safety limits.
- [x] Katana damage and slash width are computed from real wielder velocity; wall impact triggers a fast dash and continuous return to base speed.
- [ ] Each new signature weapon is a Blight Essence **Black Market mutation** of its existing base weapon (Shotgun → SQUELCH, Pistol → Drone Shepherd, Sniper → Chromatic Prism, Katana → Momentum), with one active branch per base gun, clear compatibility rules, and a safe lab-only respec.
- [ ] The Sniper also has **Rail Lance** as a competing straight-line super-piercing mutation, and the player cannot activate Prism and Rail Lance simultaneously.
- [x] Reverse-Playback Revolver and Gale Edge combat mechanics, Essence unlocks and compatible per-slot next-deployment selection. Full Black Market refund/respec and specialist tiers remain pending; see the revised plan.
- [ ] Echo Stapler and Resonance Bell are selectable, unlockable, charged **secondary weapons** that work alongside any primary; they are not mutation branches or separate soldier slots.
- [ ] Pistol is the only primary weapon usable by multiple soldiers simultaneously; every other primary, including any special mutation, has at most one squad owner. Equip UI, programmatic validation, saved data and deployment all enforce this.
- [x] All upgrades are purchasable, capped, described, loadout-compatible, and safe in old saves.
- [ ] No fixed-timestep simulation regressions, high-speed tunneling, memory growth, infinite loops or unbounded audio voices occur in stress tests.
- [ ] A first-time player can explain each weapon's distinctive rule after observing it once or twice.


## Sources and notes

Repository source, reviewed from `main` on November 12, 2026:

- https://github.com/sethrimer3/Breakout-BallsAndSquares/blob/main/src/entities/Bullet.ts
- https://github.com/sethrimer3/Breakout-BallsAndSquares/blob/main/src/entities/Soldier.ts
- https://github.com/sethrimer3/Breakout-BallsAndSquares/blob/main/src/systems/CombatSystem.ts
- https://github.com/sethrimer3/Breakout-BallsAndSquares/blob/main/src/systems/PhysicsSystem.ts
- https://github.com/sethrimer3/Breakout-BallsAndSquares/blob/main/src/core/gridRaycast.ts
- https://github.com/sethrimer3/Breakout-BallsAndSquares/blob/main/src/rendering/Renderer.ts
- https://github.com/sethrimer3/Breakout-BallsAndSquares/blob/main/src/audio/AudioSystem.ts
- https://github.com/sethrimer3/Breakout-BallsAndSquares/blob/main/src/progression/UpgradeDefinitions.ts
- https://github.com/sethrimer3/Breakout-BallsAndSquares/blob/main/src/progression/SaveManager.ts
- https://github.com/sethrimer3/Breakout-BallsAndSquares/blob/main/src/Game.ts

The original first-playable weapon mechanics are implemented and tested as recorded in the progress sections. The two newer main-branch design revisions add Black Market mutations, lab-only respec, unique non-pistol squad ownership, Rail Lance, Reverse-Playback Revolver, Gale Edge, and two new secondary abilities. Those requirements are preserved in this document but are not implemented by the original expansion commit. Human playtesting and physical-device acceptance also remain unverified; see WEAPON_VALIDATION.md.


### Latest requested mechanic audit

The follow-up audit added playable Reverse-Playback Revolver and Gale Edge rather than treating the older design text as implementation evidence. See [the revised Black Market plan](BLACK_MARKET_IMPLEMENTATION_PLAN.md) for their verified scope and all newly accepted mechanics. This does not mark lab respec, canonical legacy conversion, or the newly planned weapons complete.
