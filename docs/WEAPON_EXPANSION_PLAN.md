# BREACH: Experimental Weapon Expansion

**Game design specification and code-oriented implementation plan**  
**Project:** `sethrimer3/Breakout-BallsAndSquares` (`main` branch)  
**Prepared:** November 12, 2026  
**Status:** Proposal, not implemented  
**Design intent:** Make the weapons feel mechanically surprising, tactile, and distinctly different, while protecting the core experience of autonomous soldiers ricocheting through destructible environments.

## Executive summary

The first release of this expansion should deliver five connected improvements:

1. **Weapon-specific ricochet ammunition** for guns that do not intrinsically pierce targets, beginning with Pistol and Shotgun. Ricochets add deliberate spatial gameplay instead of simply increasing damage.
2. **SQUELCH, the Adhesive Rebound Mortar:** a squishy, pseudo-soft-body orb that hits a wall, sticks and wobbles, leaves a sticky mine, then springs away along the reflected trajectory after a short delay. It has no purchased bounce-count limit. Travel distance and remaining slime mass limit its useful lifetime.
3. **Drone Shepherd:** a soldier loadout built around releasing small flying pistol drones. Drones behave as independent, lightweight actors, not as additional full soldiers.
4. **Chromatic Prism:** a reflective laser that begins red and unlocks orange, yellow, green, blue, indigo, and violet through upgrades. Each bounce makes the ray more dangerous, increasing its damage and penetration budget.
5. **Momentum Katana:** the existing katana's slash damage and width scale with actual soldier velocity, and a wall collision can initiate a fast dash that eases back to ordinary running speed.

All numeric values below are **proposed first-pass tuning**, not values verified in the existing game. Implement mechanics first, then tune against playtests and telemetry.

## 1. Creative principles and technical guardrails

### Player-facing principles

- **Every weapon changes behavior, not just statistics.** Players should see an unfamiliar pattern within the first few seconds of equipping it.
- **Cause and effect must be legible.** Each bounce, mine placement, drone launch, color shift, and dash needs visual and sound feedback.
- **Autonomous physics remain important.** A clever collision or trajectory should feel useful. Avoid unrestricted homing and constant automatic targeting.
- **Builds should interact.** A drone can fire ricochet bullets if explicitly supported; a katana dash may become a high-risk burst tool; laser reflections reward narrow spaces.
- **Convenience is not complexity.** Unusual mechanics should be understandable without memorizing long upgrade descriptions.
- **Upgrades create new milestones.** Prefer distinctive unlocks and capped effect upgrades over 15 nearly identical percentage increases.

### Codebase facts verified in the inspected repository

- `src/entities/Bullet.ts`: fixed-size bullet pool and bullet state; no bounce or distance budget fields currently.
- `src/systems/CombatSystem.ts`: soldier weapon switching, `spawnBullet`, swept subcell raycasting with hit normals, piercing, grenades, and autoturrets.
- `src/core/gridRaycast.ts`: axis-aligned surface normal (`nx`, `ny`) and precise hit point are already returned.
- `src/systems/PhysicsSystem.ts`: wall reflection for soldiers; `step(s, dt)` currently returns only a bounce count and computes substeps from `s.speed`.
- `src/entities/Soldier.ts`: `WeaponType`, derived `SoldierStats`, and `Soldier` movement and loadout state.
- `src/rendering/Renderer.ts`: dedicated bullet, slash, soldier, and grenade drawing in Canvas 2D.
- `src/audio/AudioSystem.ts`: Web Audio sound generators with per-category throttling and existing spatial audio support.
- `src/progression/UpgradeDefinitions.ts`, `UpgradeManager.ts`, `SaveManager.ts`, and `src/ui/UpgradeTree.ts`: permanent upgrade definitions, purchasing, save sanitation, and upgrade-tree presentation.
- `src/Game.ts`: fixed simulation orchestration. Soldier physics happens before soldier shooting, followed by bullet and grenade updates.

**Important implementation rule:** Existing project names and functions in this document are verified where stated; new names such as `GooOrbSystem`, `DroneSystem`, and `LaserSystem` are suggested interfaces, not files already present.

## 2. Shared engineering foundation

Build a small reusable projectile feature layer before adding new weapons. Keep standard bullets on the existing fast path.

| Concern | Proposed change | Reason |
|---|---|---|
| Weapon identity | Extend `WeaponType` with `goo_mortar`, `drone_shepherd`, `prism_laser`. | Keeps loadouts, unlocks, and stat application explicit. |
| Ordinary ricochets | Add `bounceLeft`, `bounceRetention`, and optional `maxTravelDistance` to `Bullet`; reset every field on pool acquisition. | Stops pooled projectiles inheriting stale state. |
| Impact handling | Introduce an internal impact policy: `penetrate`, `reflect`, `detonate`, `stick`, `stop`. | Makes effects mutually intelligible without a giant chain of style checks. |
| Reflection math | `reflected = incoming - 2 * dot(incoming, normal) * normal`; normalize and offset by small epsilon. | Ensures stable reflection using existing raycast normals. |
| Distance accounting | Track actual flight distance per segment. Stationary sticky delays consume time, not travel distance. | The goo weapon has no arbitrary bounce-count limit. |
| Pools | Separate pools for goo orbs, goo mines, drones, and short-lived laser segments. | Each entity has a distinct lifetime and update model. |
| Events | Add `onBulletRicochet`, `onGooStick`, `onGooRelease`, `onGooMineBurst`, `onDroneLaunch`, `onLaserBounce`, `onKatanaDash`. | Decouples game logic from sounds and particles. |
| Game loop | Use fixed-step updates only for weapon physics and damage; let render interpolate effects. | Avoids frame-rate-dependent mechanics. |
| Save migration | Extend accepted weapon IDs and upgrade definitions; default all new levels to zero. | Existing save slots must load unchanged. |

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

A single soft, glossy, living-looking orb launches ahead of a soldier. On impact it compresses against the wall, wobbles as if filled with gel, and sticks with a rich wet **squelch**. It pauses, winds up like a stretched elastic creature, then peels off and springs away in the reflected direction. A **small chunk of its own body remains stuck to the wall**. That chunk swells with a warm orange internal glow and detonates shortly afterward. The parent orb grows visibly smaller with successive collisions. A larger starting orb has more material to shed, and therefore generally leaves more mines and survives more contacts.

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
| Unlock SQUELCH | 1 | Equips the Adhesive Rebound Mortar. |
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

Implement **Drone Shepherd as a primary weapon/loadout**, not as an upgrade that automatically gives every soldier drones. The carrier should have lower direct-fire power than a normal gun, trading its own firepower for a swarm. Drones are not full `Soldier` instances and do not consume `Additional Soldier` deployment slots.

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
| Unlock Drone Shepherd | 1 | Equips carrier and drone release system. |
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

**Acceptance:** drones release sequentially, maintain recognizable movement, never cross sealed rooms, shoot with valid owner attribution, despawn on timer/death, and do not alter soldier-cap or formation code. Drone count stays capped with eight upgraded carrier soldiers.

## 6. Signature weapon C: Chromatic Prism Laser

### Fantasy

The first laser is a thin, hostile **red** beam. Upgrades advance it through the spectrum: **red, orange, yellow, green, blue, indigo, violet**. The beam ricochets off solid surfaces, with each bounce adding a brighter prism accent and increasing the remaining beam's damage and its ability to cut through blocks. An advanced shot can become a fast, vividly colored geometric path across an entire room.

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
| Unlock Chromatic Prism | 1 | Equips the pulsed reflection laser; starts red. |
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

The katana specialist behaves like a pinball swordsman. A wall impact triggers a sharp burst of speed; the soldier briefly accelerates along its **new reflected trajectory**, carving a much larger and stronger crescent slash while moving fast. The dash then loses speed smoothly until normal travel resumes. An expert player learns to read wall geometry and use rebounds to create huge cleaving sweeps.

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
| Rebound Dash | 1 | Enables the wall-triggered burst and speed decay. |
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

## 8. Three optional future weapons with novelty potential

These are **separate concept candidates**, not part of the initial implementation scope.

### 8.1 Echo Stapler

**Fantasy:** A shot pins a luminous staple into one wall; the next shot pins a second one. A taut wire forms between them. When Blight grows across the wire, the link snaps with a bright cutting pulse. Upgrades add more simultaneous links, a longer maximum span, and an optional triangular web mode.

**Implementation sketch:** Add pooled anchor pairs and beam-line collision tests against newly grown Blight cells, using the growth event callback rather than full-map scans. Anchors have lifetimes and explicit ownership. Render a faint trembling wire with a sharp pulse when snapped. Limit links per owner.

**Distinctive player decision:** Pick two surfaces whose connection forms a useful trap.

### 8.2 Reverse-Playback Revolver

**Fantasy:** The bullet takes an ordinary path, including any bankshots. After a pause, a ghostly copy rewinds along the **exact recorded trajectory in reverse**, damaging terrain on the way back.

**Implementation sketch:** Store a capped polyline of traveled segments in a per-shot ring buffer; after expiry, spawn a harmless-to-geometry replay visual with carefully defined one-time hit detection along each recorded segment. Record only meaningful corner points; cap segment count, memory, and hits to avoid degenerate zigzags.

**Distinctive player decision:** Engineer a powerful route on the first pass so the reverse pass becomes valuable.

### 8.3 Resonance Bell

**Fantasy:** A heavy sonic orb hits a wall and leaves a small vibrating note. When three notes are active within range, their ripples synchronize and release a single larger resonant shockwave. Different layouts produce different delay patterns.

**Implementation sketch:** Maintain a pooled set of sonic nodes and a local-neighbor check on placement, not each frame. Use deterministic timers, circular shader-free Canvas ripples, and distinct procedural tones. Ensure simultaneous triggers share an event ID so the same three nodes cannot recursively trigger indefinitely.

**Distinctive player decision:** Build geometric arrangements that create resonant combos rather than simply firing faster.

## 9. Upgrade economy, unlock order, and build constraints

Recommended rollout:

1. Make **Pistol Bankshot** available early so players learn the concept in familiar rooms.
2. Add **Shotgun Rebound** as a midgame spatial weapon choice.
3. Unlock **SQUELCH** once players have encountered small Blight clusters and destructible corridor geometry.
4. Unlock **Drone Shepherd** when multi-soldier loadouts and Blight threats are established; drones should not make initial soldiers redundant.
5. Unlock **Chromatic Prism** as a rare advanced weapon, with the first two color upgrades affordable quickly enough to preview its progression.
6. Add **Momentum Katana** as a specialization to the existing katana tree, rather than creating a redundant standalone katana variant.

Preserve the current gold / orange crystal / green crystal / Blight Essence / biomass economy. Avoid inserting the proposed upgrades into all early core progression prerequisites, which would turn excitement into mandatory payment. Use appropriately tiered upgrade costs after balance testing. For weapons that have mutually exclusive behavior branches, display the choice and offer a safe respec path. **Do not automatically grant penetration and ricochet on the same ordinary projectile** unless a specific capstone explicitly defines that interaction.

## 10. Engineering work plan

| Phase | Scope | Deliverable | Test gate |
|---|---|---|---|
| 0. Baseline and harness | Confirm current tests/build and add fixture worlds for corridor, corner, half-size Blight and destructible walls. | Reproducible collision scenario tests. | No regression before feature changes. |
| 1. Reflection foundation | Extend bullet state, impact policies, reflection helper and events. | Pistol bankshot and basic shotgun bankshot. | Bounce normal, budget, no stuck loops, penetration precedence. |
| 2. Goo prototype | One orb with mass, delayed reflection and one independent mine type. | Functional SQUELCH without expensive visuals. | Flight distance and mass accounting. |
| 3. Goo polish | Spring-rendered wobble, orange mine charge, squelch and peel audio, pool guards. | Signature tactile weapon slice. | Render/audio budget, pool reuse, no missed effects. |
| 4. Katana dynamics | Dash state, actual-velocity physics substeps, snapshot-on-spawn slash scaling. | Momentum katana. | Stable collision at 2-3x movement speed. |
| 5. Drone system | New drone actors, validated orbit/avoidance, pistol firing, ownership. | Drone Shepherd. | Global caps and no sealed-wall crossing. |
| 6. Prism laser | Single-shot ray trace, color progression, reflection and pierce policy. | Chromatic Prism. | No self-intersection loops or repeated damage. |
| 7. Progression and presentation | Upgrade trees, loadout options, audio toggles, tooltips, migration. | Cohesive release. | Old saves work; all unlock rules enforced. |
| 8. Balancing | Combat telemetry, weapon identity, pacing, performance on laptop/mobile. | Playtest-ready candidate. | Distinct builds without runaway power. |

### Files most likely to change

| Existing file | Expected work |
|---|---|
| `src/entities/Bullet.ts` | Ordinary bounce counters, retention and reset discipline. |
| `src/entities/Soldier.ts` | New `WeaponType` IDs, derived stats, dash runtime fields. |
| `src/systems/CombatSystem.ts` | Ricochet hit policy, new fire dispatch, drone shot helper, event plumbing. |
| `src/systems/PhysicsSystem.ts` | Real-velocity substeps, safe dash preservation, bounce events. |
| `src/core/gridRaycast.ts` | Possibly add reusable reflection and corner-case helpers; avoid changing stable DDA needlessly. |
| `src/Game.ts` | Systems' lifetime, fixed-step order, reset/disposal, effect event wiring. |
| `src/rendering/Renderer.ts` | Dispatch for goo, drones, prism segments and dash trail. |
| `src/audio/AudioSystem.ts` | Distinct wet, electric and prismatic cues with throttling. |
| `src/config.ts` | Numerical tuning and pool caps. |
| `src/progression/UpgradeDefinitions.ts` | Shared weapon trees and their apply/stat definitions. |
| `src/progression/SaveManager.ts` | Weapon allowlist, unlock validity, backward compatibility. |
| `src/ui/UpgradeTree.ts` | New tabs, upgrade descriptions and max-level presentation. |

Suggested new files: `src/entities/GooOrb.ts`, `GooMine.ts`, `Drone.ts`; `src/systems/GooOrbSystem.ts`, `DroneSystem.ts`, `LaserSystem.ts`; `src/rendering/GooRenderer.ts`, `DroneRenderer.ts`, `PrismRenderer.ts`; and focused `tests/` coverage for each system.

## 11. Required test suite

**Projectile behavior:** reflect across vertical and horizontal surfaces; corner collision; exact cell-edge launch; zero-distance impact; 50% Blight subcells; a wall destroyed during impact; pierce greater than zero; out-of-bounds normals; max iterations in a fixed frame; no projectile-state leakage after pooling.

**SQUELCH:** full squish/stick/release cycle; variable frame pacing with fixed timestep; monotonically decreasing mass; no distance consumed while stuck; mine count matches valid hits; detonate after support wall is destroyed; correct owner credit; mine pool at capacity; orb destroyed before first bounce; fading glow under reduced effects settings.

**Drones:** release frequency and global cap; owner death; old save slots; travel near doors and narrow rooms; no wall phasing; damage attribution; no soldier slot consumption; target search throttling; multiple drone users in one run.

**Chromatic Prism:** all seven initial colors; color shifts on bounce; increasing damage and penetration; pierce-versus-reflection precedence; duplicate-cell suppression; maximum hit/segment/distance caps; tracing at low frame rate; consistent damage regardless of visual lifetime.

**Momentum Katana:** dash only after a real bounce; speed peaks and decays smoothly; slash values captured at spawn; collisions at peak speed without tunneling; manual and formation behavior unmodified; simultaneous or repeat bounces do not bypass cooldown.

**Progression:** missing/new keys default to zero; old saves load; max levels cannot be exceeded; weapon loadouts sanitize to Pistol if unlocks are unavailable; respec (if added) preserves currency math and does not invalidate ongoing runs.

## 12. Performance, accessibility, and tuning measurements

**Initial budgets, to adjust after profiling:** 16 goo orbs, 96 goo mines, 24 global drones, no more than 8 laser reflections / 16 affected cells per shot, bounded sonic effects and particle bursts. Avoid scanning all terrain for every drone per frame. Preallocate frequently reused arrays and point buffers where useful. Bound per-frame mine-explosion processing so clustered detonations do not freeze the simulation.

**Telemeter:** bounce count distribution per bullet and per goo orb; mine placement and detonation rates; percent of shots reflecting in open vs narrow rooms; average drone shots and useful hits; laser segment/hit counts; katana dash uptime and damage earned while boosted; CPU time in collision, rendering and audio; entities dropped because pools were full.

**Accessibility:** optional reduced flashes, restrained camera motion, independent effects volume, colorblind-redundant prism indicators, visual alternatives for the wet audio cues, and the ability to distinguish sticky mine fuse timing without relying solely on hue. Keep bloom scalable with existing lighting settings.

**Balance risks:** mass and travel upgrades may multiply goo mine count; drone count and damage stack across many soldiers; laser damage and penetration can scale superlinearly with bounces; dash can outpace collision resolution; normal bullet ricochets can increase effective DPS in corridors. Tune weapon effectiveness both in open rooms and dense choke points. A flashy weapon should be fun without rendering every prior weapon obsolete.

## 13. Definition of done for the first playable expansion

- [ ] Pistol and Shotgun can buy weapon-specific bullet ricochet upgrades, without giving bounce to piercing sniper bullets, rockets or flames.
- [ ] SQUELCH visibly squashes, clings, jiggles, peels off and rebounds; it leaves a smaller orange-glowing sticky mine at every qualifying contact.
- [ ] SQUELCH's lifetime is constrained by traveled distance and mass, not an arbitrary number of bounces; upgraded starting mass extends potential mine deposits.
- [ ] Mine fuses and damage are deterministic, owner-attributed, pool-limited, and legible in crowded scenes.
- [ ] Drone Shepherd deploys individually moving miniature pistol drones that do not count as full soldiers or pass through sealed walls.
- [ ] Chromatic Prism starts red and progresses through seven color bands; each bounce raises damage and pierce within hard safety limits.
- [ ] Katana damage and slash width are computed from real wielder velocity; wall impact triggers a fast dash and continuous return to base speed.
- [ ] All upgrades are purchasable, capped, described, loadout-compatible, and safe in old saves.
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

All new weapon concepts, upgrade names, formulas, timings, counts, and performance limits in this document are proposals. The existing systems and file names listed as current were read from the repository, but the proposed mechanics have **not** been implemented or run as a playtest.