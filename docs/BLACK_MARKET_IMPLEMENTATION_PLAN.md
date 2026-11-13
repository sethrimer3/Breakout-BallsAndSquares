# Black Market weapons — revised implementation plan

This document records the latest requested mechanics and supersedes conflicting proposals in `WEAPON_EXPANSION_PLAN.md`. New concepts in this document are **planned, not implemented**, unless the audit explicitly marks a mechanic implemented. Names, weapon families and fixed timings below are requirements; unspecified tuning values remain first-pass tuning work.

## Accepted branch roster

| Base weapon | Branch 1 | Branch 2 | Branch 3 |
|---|---|---|---|
| Pistol | Reverse-Playback Revolver | Orbit Cylinder | **Drone Shepherd** |
| Shotgun | SQUELCH | **Vacuum Pulse** | — |
| Assault Rifle | **Overcharge Conductor (working name)** | **Circuit Runner (working name)** | — |
| Rocket Launcher | **Burrower** | **Freeze Rockets** | — |
| Sniper Rifle | Chromatic Prism | **Rail Lance** | — |
| Katana | Momentum Katana | Gale Edge | — |
| Flamethrower | **Napalm Garden** | **Cryospray** | — |

Drone Shepherd belongs to **Pistol**, not Assault Rifle. Do not implement Arc Leech, Splinter Engine, Recoil Engine, or another Assault Rifle mutation without an accepted design. Overcharge Conductor and Circuit Runner below are the two accepted AR concepts. Their names are provisional. Collapse Charge, Compression Cannon and other superseded alternatives are not the active plan. Echo Stapler and Resonance Bell remain separate secondary-weapon designs.

Each soldier carries one base primary with at most one active mutation. Pistol mutation state is per soldier; Pistol is the only primary family allowed more than one squad owner. Other families remain unique across their mutations. Switching a mutation must never manufacture an extra copy of its base gun.

## Audit of requested existing mechanics

| Mechanic | Code status | Verification / remaining integration |
|---|---|---|
| Chromatic Prism | Implemented in `LaserSystem` | One trace per pulse; seven initial bands; reflection gains damage and penetration; explicit travel/hit/bounce/visual budgets. Existing playable ID is still separate; full migration into a Sniper Black Market branch remains scheduled. |
| Momentum Katana | Implemented in `Momentum` / soldier physics / slash spawning | Actual-velocity damage and width snapshots; autonomous reflected-wall dash; peak, decay and cooldown; suppressed for Gale, manual control, formations and sentries. |
| Gale Edge | Added after audit found it missing | Selectable Katana mutation; long-lived, wide flying crescents; 300-unit base range versus ordinary Katana's approximately 118; Extended Horizon reaches 660. Damage, velocity, arc and penetration research retain explicit mappings. No Momentum dash or velocity scaling in Gale mode. Further specialist tiers remain separate follow-up work. |
| Reverse-Playback Revolver | Added after audit found it missing | Selectable Pistol mutation; records outgoing flight and bankshots, pauses at the terminal point, then damages terrain and targets while traversing that same polyline backwards. Bounded records, damage deduplication, ownership and pool reset. |
| SQUELCH | Implemented in `GooOrbSystem` / `GooBody` | Squash, cling, mine deposition, mass loss, delayed reflection, distance/mass expiry, independent fuses and wet effects. Existing standalone ID still needs full Shotgun-branch migration. |
| Drone Shepherd | Mechanic implemented in `DroneSystem` | Independent miniature pistol drones, owner attribution, death lifetime, collision checks and global cap. **Move its legacy standalone unlock/loadout into Pistol branch 3**, not an AR branch. |

The two newly completed mechanics use permanent Essence unlock nodes and next-deployment loadout selectors. That is not a claim that the complete Black Market economy, compatibility UI, refund/respec policy, legacy variant conversion, or squad uniqueness work below is finished.

## Shared Black Market and migration work

1. Retain canonical base weapon identities in saves and equip/deployment checks. Resolve a selected mutation into its firing system; migrate legacy `goo_mortar`, `prism_laser`, and `drone_shepherd` loadouts to Shotgun/Sniper/Pistol plus the matching mutation without losing purchased upgrades or currency.
2. Expose three Pistol cards and two accepted cards for each other primary family, including Overcharge Conductor and Circuit Runner for Assault Rifle. Hide or mark unimplemented cards rather than making them selectable.
3. Persist one compatible selection per slot, validate unlocks and unknown IDs, and default old saves to ordinary behavior. Mutation changes affect the next deployment, never active projectiles/soldiers retroactively.
4. Charge Blight Essence for mutation research and show conventional-stat compatibility before purchase. Provide a lab-only atomic reconfigure/refund operation with exact recorded spending; reject insufficient funds and duplicate non-Pistol ownership. Keep existing ordinary upgrades and save-slot progression.
5. Define compatibility deliberately: fire rate maps to actual trigger/release intervals; velocity changes cannot silently extend an explicit range budget; unavailable pellet/crit/pierce effects must be mapped or clearly disabled. Never sell an inert upgrade.

## Overcharge Conductor — Assault Rifle branch 1 (working name)

**Status:** A combat implementation now exists on `main`; the follow-up code review identified correctness issues requiring regression fixes. This section remains the required design, not a claim that all acceptance checks are complete. The name is provisional. Circuit Runner below is the second accepted AR design.

### Required behavior

- Replace direct-damage ammunition with charging shots. A hit adds electrical charge to the specific terrain object or enemy it actually strikes; the charging hit itself deals **zero damage**.
- Track consecutive hits **per target**, not as one soldier-wide counter. Each hit makes that target glow slightly brighter and adds progressively stronger lightning effects, visibly communicating charge accumulation.
- **At least three hits are required to arm a discharge.** One or two hits produce charge feedback but no explosion, chain lightning, or damage.
- Every new charging hit refreshes a short quiet-period timer for that target. An armed target overcharges and discharges only after that delay passes **without another charging shot hitting it**. Reaching three hits must not detonate immediately while shots continue landing.
- The discharge produces **chain lightning and a small electrical explosion** at the charged target.
- Additional hits beyond three make the discharge progressively more violent: increase chain damage, chain reach/length and visible duration, plus explosion damage/intensity. Keep the blast recognizably small; exact scaling curves and radius tuning remain implementation/balance work.
- Selecting this mutation restores **major Assault Rifle spread**, even for a previously accurate ordinary rifle. Accuracy upgrades must be able to improve it all the way to **±0.1 degrees**. This is the half-angle on either side of the aim direction (0.2 degrees total cone), not ±1 degree or a 0.1-degree total cone.

### Proposed implementation defaults / unresolved tuning

These are recommendations for implementation, not additional user-approved mechanics:

- Expose the quiet delay, initial wide spread, charge scaling and safety caps as named tuning values; choose initial values through playtesting rather than presenting invented timings as requirements.
- When a sub-threshold target's quiet period expires, dissipate its one/two-hit charge harmlessly. A later burst begins a new consecutive-hit sequence.
- Use dedicated mutation accuracy research for the wide-spread-to-±0.1-degree progression, or explicitly document another mapping that preserves both the initial accuracy penalty and the final endpoint. Do not let previously purchased ordinary accuracy levels silently remove the new branch's intended tradeoff.
- Resolve chain arcs through distinct nearby targets with a clear range/obstruction policy. Proposed default: one chain hit per target per discharge, no return loop to its origin, no automatic charge stacks from chain/explosion damage, and no uncontrolled recursive detonations. Decide explicitly how other precharged targets interact before enabling chain-triggered cascades.
- Proposed default for a host killed/destroyed by another weapon before its quiet period ends: clear its charge harmlessly. Never transfer its charge to terrain regrown at the same coordinates or to a reused enemy object.

### Integration and acceptance

- Use canonical `assault_rifle` plus one selected mutation. Preserve one Assault Rifle owner across the squad. Unlock and configure it through the existing Essence/lab workflow; do not add a separate equippable primary ID.
- Charging shots must reach and collide with the target normally, including gates, without applying base ammunition damage, AP terrain damage, generic explosion callbacks, or Napalm ignition on contact. Define AP/pierce, multishot, ordinary accuracy, fire-rate, velocity and damage research compatibility explicitly. Damage research should map to discharge output rather than restoring direct hit damage.
- The eventual damaging discharge may interact with shared freezing, external Napalm ignition and ordinary reward/drop systems through the normal damage pipeline. Respect authoritative gates and world bounds. Carry the firing owner's attribution through delayed charge, arcs and blast.
- Support both `CreatureSystem` and `LateEncounters`, normal cells and applicable subcells. Key charge state by world generation and stable target identity; clear on target death/replacement, expiry and run/world reset. Define the owner-death policy deliberately.
- Use simulation time so pausing, upgrades and other inactive screens do not advance the quiet timer. Bound charged targets, arc hops, total arc travel, explosion work and visuals with documented overflow behavior; do not silently turn a one/two-hit target into a damaging discharge.
- Use a steady glow and readable restrained electrical accents, with reduced-motion support. More charge should be obvious without introducing rapid brightness flashes or strobing.
- Test: zero direct damage; harmless one/two-hit expiry; exact three-hit arming; refresh on every hit; continued firing delays discharge; independent targets and misses; monotonic charge scaling before caps; exact ±0.1-degree endpoint; existing ordinary accuracy on branch selection; both enemy systems; pooled target/projectile reuse; host death/regrowth; gates; attribution; freeze/Napalm interactions; pause; low frame rates; reset and overflow. Browser checks must show the charge ramp, quiet gap and resulting chain/blast, not just the unlock card.

## Circuit Runner — Assault Rifle branch 2 (working name)

**Status:** Newly accepted design; planned, not implemented. The name is provisional. This is the alternative to Overcharge Conductor, not another base weapon or an Overcharge upgrade tier.

### Required behavior

- Replace ordinary Assault Rifle ammunition with **laser shots with extremely high penetration and limited total range**. These are damaging shots; they do not use Overcharge's harmless charging-hit mechanic.
- **Every block impact creates a routing decision.** Center the projectile on the impacted block, then select a random **orthogonal/cardinal** direction for its outgoing flight.
- Exclude the direction back toward the place the projectile just came from. For a cardinal incoming leg, this leaves three choices: straight ahead, left turn or right turn. Do not mistakenly exclude straight ahead instead of excluding reversal. Define the incoming face for non-cardinal first impacts explicitly.
- The shot can continue through the struck block because of its high penetration. It must not repeatedly hit/re-route inside that same block simply because its head is still embedded there.
- Leave a continuous **Tron-like circuit path** behind the moving head, matching the crisp right-angle circuit aesthetic already used by the upgrade tree. Preserve the actual traveled corners; do not draw a diagonal shortcut between the start and end.
- Shots begin **bright orange** and cool through **light blue → blue → purple** as they approach the end of their range, then fade out. The palette progression must visibly follow range consumption, rather than using a fixed orange tracer or random colors.
- The range limit is **cumulative path length**, including all turns and centering movements, not distance from the soldier. High penetration must not create unlimited travel or extend range after each impact.

### Proposed implementation defaults / tuning to document

These recommendations resolve unspecified implementation details without presenting invented numbers as requirements:

- Use a traveling projectile head with a bounded polyline trail. Initial travel follows the firing aim; after its first block impact, its route uses centered cardinal legs. Define a short, readable centering connector and count its actual movement against range. Centering must not teleport across a gate, world boundary or unrelated target.
- Choose uniformly among the three non-reversing cardinal exits using the gameplay RNG. Capture the incoming face before damage changes the world; the routing decision remains valid if that impact destroys the block. Keep world generation independent of the routing RNG.
- Route on terrain/block contacts, not enemy contacts. Proposed default: enemies take piercing damage without changing the circuit direction. Specify normal-cell vs subcell centering and hit identity deliberately, especially where a subcell raycast represents a normal solid parent.
- Define a large but finite penetration budget, short base range, head speed, range upgrades and trail afterglow in named tuning constants. Map ordinary AR and soldier damage, fire rate, velocity, AP and accuracy research explicitly; do not silently sell ineffective stats.
- Each projectile damages a distinct target at most once. Permit a route to revisit geometry without repeatedly damaging the same block/enemy or accumulating hits while still inside one cell. Do not invent a permanent damaging wall or repeated trail damage: the lingering trail is visual unless separately approved.
- Tie head/tracer cooling to normalized distance consumed, with retained trail segments fading smoothly through the same palette. Document any time-based afterglow separately so pause and projectile speed cannot corrupt the physical range budget.

### Integration and acceptance

- Use canonical `assault_rifle` plus an exclusive selected mutation. Preserve one AR owner across the squad, Essence unlock/research and exact lab refund accounting, save sanitation, next-deployment selection and pool-reset coverage. Selecting Circuit Runner must not inherit Overcharge charge stacks, spread penalty or charge-only contacts.
- Resolve the full swept route through normal cells, subcells and both enemy systems. Maintain the actual head position, traveled polyline and remaining distance across frames and corners. Use stable hit identities, owner attribution and ordinary freeze/Napalm/reward interactions for damaging hits.
- Closed authoritative gates and world borders stop the shot; neither centering, extreme penetration nor a random turn may bypass access rules. An opened gate may pass the shot according to the documented collision policy.
- Bound projectiles, route vertices, contacts per step, hit sets and retained trail segments. If a per-step work limit is reached, retain unspent travel or use another explicit policy; never replace the remaining route with an invented straight shortcut or silently grant free range. Reset all fields across every pooled acquisition path and clear actors/trails on run/world reset.
- Use steady emissive orange/cool colors, narrow bright cores and restrained glow, with reduced-motion support. Preserve the upgrade tree's circuit feel without adding strobe-like flashes at every turn.
- Tests must cover: extremely high penetration vs ordinary AR; exact range exhaustion along many turns; each allowed/excluded direction and controlled RNG samples; block-center/subcell-center handling; starting inside a solid cell; a surviving block producing one damage/routing contact; impact destruction; diagonal first impacts; frame subdivision; repeated geometry; aligned enemies; gates and boundaries; pooled reuse; ownership; freeze/Napalm interactions; save/reload/refund; trail bounds and reset. Browser checks must visibly demonstrate orange shots, centered right-angle routes, the cooling sequence and range expiry.

## Orbit Cylinder — Pistol branch 2

**Required behavior:** Fired rounds accumulate in an orbit around the soldier. A real soldier wall-bounce releases the loaded rounds outward together.

- Replace ordinary Pistol spawning with an owner-bound magazine of orbiting projectiles, with a visible slot/fill indicator and individual orbit positions.
- Consume the existing post-reflection soldier collision event. Release once per real rebound/fixed step, using each round's orbit position and an outward direction, not a hidden homing target.
- Sliding/manual contact, rescue relocation and soldier separation do not count as a release bounce. Define a usable manual-control release before making the branch available in that mode.
- Snapshot damage and relevant modifiers at loading time; define bankshot compatibility for the released rounds explicitly. Cap stored rounds and active released projectiles; provide full-magazine feedback.
- Clear orbit actors on owner death/run/sector reset. Never turn a pool overflow into an invisible extra shot or lose currency pickups.

**Acceptance:** Loading produces no ordinary straight shot; the orbit visibly fills; one valid wall rebound releases that magazine once; full magazines, tight corners, two carriers, death, pooling and pause/resume are deterministic.

## Vacuum Pulse — Shotgun branch 2

**Required behavior:** Within a collection range, the soldier visibly sucks in debris from **all destroyed blocks**, then blasts it back out. More consumed blocks increase **both damage and projectile count**. Fire rate is **halved**.

- Hook the shared destroyed-terrain pipeline, including destruction by other weapons and frozen chains. Create dedicated gameplay debris records with source/generation identity; never infer available mass from short-lived visual particles.
- Count each destroyed block once. Give half-size cells an explicitly documented contribution, and preserve every source block's contribution if visual debris must be aggregated under a performance budget.
- Use a bounded spatial query within the collection radius. Reserve/consume debris atomically so two Vacuum soldiers cannot claim the same material. Debris is not gold, crystals, essence, or another soldier's orbit rounds.
- Animate actual reserved fragments traveling inward before the exhale. The firing cadence is `ordinary upgraded shotgun fire rate × 0.5`, before the usual applicable global/soldier modifiers; do not double-apply the penalty.
- Snapshot consumed mass for that pulse. Derive pellet count and damage from it, with visible mass feedback. Range, intake duration, debris retention, scaling coefficients and hard projectile limits are tuning decisions to set in the prototype, not additional user requirements.
- Preserve increasing material value when a projectile safety cap is reached; document the overflow policy rather than silently discarding suction rewards. An empty intake must have an explicit minimum-output rule.

**Acceptance:** All in-range destruction sources contribute; out-of-range material does not; more material raises both outputs before the safety cap; every consumed block is spent once; cadence is exactly half the ordinary upgraded shotgun cadence; particles/loot pooling cannot alter damage.

## Burrower — Rocket Launcher branch 1

**Required behavior:** Rockets drill through terrain, leave a few mines in a row as they drill, then detonate **all together**.

- Use swept subcell traversal and an explicit drilling distance/cell budget. Damage and mine placement follow the drilled path, not an approximate straight visual through unopened gates.
- Give every launched rocket a detonation-group ID. Place a bounded small number of mines at distinct drilled positions in order. The group includes the final rocket payload.
- End drilling on its configured budget, authoritative gate/boundary contact, or ordinary lifetime expiry. Resolve all group charges at the **same simulation timestamp**. They do not use SQUELCH's independent staggered fuses.
- Bound blast processing and aggregate overlapping work while preserving simultaneous activation. Guard against repeated group detonation, cluster recursion and orphan mines after reset/pool failure.
- Map Rocket damage/radius research into each charge deliberately. Decide whether Cluster Munitions maps to extra group charges or becomes visibly inactive; do not allow accidental explosive multiplication.

**Acceptance:** Charge positions follow actual drilled cells; all charges arm and trigger once together; thin walls/corners/gates work; group ownership survives parent expiry; no independent mine-fuse staggering occurs.

## Shared freezing and shatter system

This system is required by **both Freeze Rockets and Cryospray**. It must not be independently reimplemented with different rules.

### Required effects

- Frozen rocks remain solid. The freezing weapons **cannot break blocks**; freezing itself applies no terrain HP damage and cannot start a destruction chain.
- When another weapon destroys a frozen block, that block deals **half its HP** as damage to its **four orthogonal neighbors only**. A frozen neighbor destroyed by that damage can propagate the chain. Non-frozen neighbors can take damage but do not gain a frozen shatter effect automatically.
- Propagation uses the existing glass cadence, **`FACILITY.glassChainDelay` (currently 0.05 seconds per outward step)**. Reuse that constant/scheduler contract; do not approximate it with an unrelated timer or give rocks automatic glass destruction.
- Frozen enemies move at **50% speed** and take **double incoming damage**. Survivors unfreeze after a few seconds. Both weapon variants apply these same effects.
- Frozen Blight grows at **half rate** under both variants. Apply the multiplier locally to frozen growth sources; do not halve the entire world's growth clock or compound overlapping freeze to quarter speed.

### Proposed implementation defaults, distinguished from fixed requirements

- Interpret "half its HP" as **50% of maximum block HP captured when frozen**, not zero remaining HP after destruction. Store that value with the freeze state and document rounding. Re-freezing refreshes duration rather than multiplying stored HP.
- Use a configurable few-second duration (initial prototype: 3 s), refreshed rather than stacked; expiry restores original movement, damage intake and growth multipliers exactly once.
- Treat cold application as status-only until any direct creature damage is explicitly approved. Terrain shatter comes from an externally triggered destruction event, not from the freezing projectile's own damage.
- Attribute a shatter wave to the triggering damaging weapon/owner, while retaining the freezing owner for support telemetry. Do not alter underlying materials, door access rules, loot classes or max-health scaling to simulate ice.

### Engineering and acceptance

Use world/generation-aware normal-cell and subcell metadata plus creature status records; clear them on death, expiry and world reset. Schedule shatter work with wave IDs, destruction-time HP snapshots, claim/dedup guards and a bounded deferred queue. Avoid double-processing a cell when frozen glass also triggers the existing glass listener.

Test all four directions, no diagonal damage, exactly 50% damage, damaged-before-freeze and re-freeze HP cases, glass-speed timing, frozen/unfrozen mixed chains, overlapping waves, half-size Blight, gates, death/unfreeze, two cold sources, frame grouping and ownership. Verify frozen Blight's local event rate is 0.5× and ordinary sources remain at 1×.

## Freeze Rockets — Rocket Launcher branch 2

Replace the damaging rocket payload with a bounded freezing burst. It freezes rocks/Blight and creatures through the shared status system, with no ordinary explosive terrain damage or cluster shrapnel that could break a block. It cannot trigger its own frozen-block shatter merely by landing. Radius research can map to freeze coverage; damage/cluster compatibility must be explicit.

**Acceptance:** Impact changes status/appearance without reducing rock HP; another weapon can then start the orthogonal half-HP shatter; creatures and Blight receive the same status multipliers as Cryospray; gates are not destroyed by status application.

## Rail Lance — Sniper Rifle branch 2

Replace discrete bullets with a visible charge cycle followed by **one extremely long, narrow, straight-line piercing strike**. Lock the aim for a clearly signaled part of the charge and snapshot shot stats. Resolve damage once along the released ray; do not retrace while its visual is visible, reflect, split into multiple shots, or inherit Prism spectrum/reflection bonuses. Traverse destructible cells/creatures with bounded distance/hit budgets; sealed gates and world boundaries remain authoritative. Base Sniper damage, velocity/charge, critical and pierce mappings must be explicit.

**Acceptance:** No premature damage during charge; one release; multiple aligned targets can be pierced; no banking; aim/owner death/pause/cancel rules are deterministic; charged damage cannot repeat during visual fade.

## Napalm Garden — Flamethrower branch 1

### Fixed requirements

- Spray persistent fuel patches onto floors and walls.
- **Another weapon must ignite the fuel.** Napalm spray, its fuel placement, and its own burn ticks cannot self-ignite unlit patches.
- Unlit fuel disappears after **10 s**.
- Once ignited, fuel burns for **3 s**, dealing **weapon damage every 0.2 s**. Schedule 15 ticks at 0.2…3.0 s, not an extra immediate sixteenth hit and not a DPS-divided fraction of weapon damage.
- Flames dissipate when their targets die before the timer expires. Stop both damage and target-bound visual/audio effects immediately; do not keep a dead target's fire alive until the full 3 s elapses.

### Implementation

Represent unlit fuel separately from current burning rubble; do not reuse automatic `FireSystem.ignite` on placement. Store patch owner, supporting world/target generation, placement expiry, lit time, tick accumulator and captured weapon damage. Merge same-owner overlapping deposits according to a documented rule rather than multiplying ticks by frame rate.

Proposed ignition default: a damaging direct/projectile/explosion hit from another weapon ignites intersected fuel; status-only cold hits do not. The same soldier's different secondary can qualify. Fuel burn damage itself does not propagate ignition to unlit patches unless that behavior is separately approved. Record ignition-source attribution separately from fuel-owner damage credit.

Ground patches may retain their own 3 s lifetime as territory. A patch attached to a rock or creature ends when that host is destroyed/killed; no orphan damage remains in empty air. Render unlit fuel distinctly from active flame, show aging/ignition, and remove target-bound effects immediately on death. Bound patches and due ticks without changing 0.2 s cadence; enqueue overdue ticks deterministically.

**Acceptance:** Cannot light itself; external weapon ignition works; exactly 15 full-damage ticks over an uninterrupted burn; 10 s unlit expiry; early target death clears effects immediately; floors, walls, regrowth entry, owner death, overlap, pause, low frame rate and save/world resets are covered.

## Cryospray — Flamethrower branch 2

Replace hot flame jets with freezing mist. Apply the **same freezing/orthogonal shatter system as Freeze Rockets**, including non-destructive terrain application, 50% creature speed, 2× incoming creature damage, temporary expiry, and 0.5× frozen-Blight growth. The mist must not run through the old hot-flame ignition or damage path; do not accidentally ignite Napalm fuel while applying cold. Limit range/coverage and keep every status reversible on surviving targets.

## Implementation order and completion gates

1. **Current audit repairs:** implement/verify Gale Edge and Reverse-Playback; regress Prism, Momentum and SQUELCH. Keep code-vs-plan status truthful.
2. **Canonical Black Market model:** migrate legacy variants; move Drone Shepherd to Pistol branch 3; enforce one base identity/active branch, squad uniqueness, Essence accounting and lab-only reconfiguration. Integrate the accepted Overcharge Conductor and Circuit Runner AR branches without inventing additional mutations.
3. **Shared destruction/status infrastructure:** gameplay debris ledger, spatial queries, external ignition events, temporary freeze metadata, growth modifiers, and the glass-cadence shatter scheduler.
4. **Orbit Cylinder and Vacuum Pulse:** actor-owned loading/release and destruction-driven suction/output scaling; deterministic pooling and source accounting.
5. **Burrower and Freeze Rockets:** grouped simultaneous charges; cold-only projectile payloads; shared shatter tests.
6. **Rail Lance:** charge/release state, straight swept trace, aligned multi-target and single-resolution tests.
7. **Napalm Garden and Cryospray:** fuel lifecycle and exact tick timing, externally triggered ignition, early-death cleanup and shared freezing.
8. **Overcharge Conductor:** per-target zero-damage hit accumulation, three-hit arming, refreshable quiet timer, scaled chain/blast discharge and wide-spread-to-±0.1-degree accuracy progression.
9. **Circuit Runner:** high-penetration laser projectiles, centered non-reversing random cardinal routes, cumulative range accounting and the orange/light-blue/blue/purple circuit trail.
10. **Progression, presentation and balance:** accepted branch cards only, compatibility labels, old saves, bounds/costs, visible tradeoffs, desktop/touch checks, telemetry and controlled open/corridor/mixed-weapon samples.

Do not mark a planned branch implemented merely because its base weapon or a visual prototype exists. New feature acceptance requires collision/status/timing tests, owner credit, pool reset/overflow checks and a representative browser interaction before merging to `main`.
