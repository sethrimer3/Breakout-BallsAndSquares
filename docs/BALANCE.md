# Campaign balance: tiers, currencies and damage

This is the economy contract. Numbers live in `src/world/tierEconomy.ts`
(currencies, loot values, Calibration curve), `TIER_HEALTH` in `src/config.ts`
and `CAMPAIGN` in `src/world/campaignBalance.ts`. `tests/tierBalance.test.ts`
keeps them honest.

## One currency per world

| World | Tiers | Terrain drops | Other income |
|---|---|---|---|
| 1 Lab | 1–3 | Gold | Blight Core essence |
| 2 Blighted Wards | 4–6 | Orange crystals | Blight Core essence |
| 3 Canopy Forest | 7–9 | Green crystals | Grove biomass + grove caches, enemy essence |
| 4 Fallen City | 10 | Blight Essence | Enemy essence |
| 5 Mothership | 11 | Blight Essence | Enemy essence |

Only that world drops its currency. Crystal veins pay the world's currency too
(gold veins in the Lab, orange in the Wards). Everything reachable in the Lab is
priced in gold (the old crystal-priced weapon, grenade, turret and facility
nodes were converted at 3 gold per crystal). Each world's exit keycard is paid
in that world's currency: T2/T3 gold, T6 orange crystals, T9 biomass + essence.

Deeper tiers pay bigger stacks per pickup, so the tier that is hardest to dig
also funds the upgrades that make it easy:

| Tier | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Value per pickup | 1 | 3 | 8 | 1 | 3 | 8 | 10 | 25 | 60 | 30 | 75 |

Lab worlds roll the usual drop chance (resource upgrades apply; the W2/W3
yield nodes boost orange/green crystals). Late worlds roll a fixed 12% per
block (green yield nodes still apply in the forest). Grove caches pay 2 stacks.

## Arsenal Calibration (CALIBRATION tab)

A squad-wide multiplier on damage against terrain and the Blight, one stage per
world, each paid in that world's currency. Bulkheads are armored against it and
enemies ignore it (Blight Executioner handles enemies; the Siege Drill's bonus
now only applies to armored bulkheads).

| Stage | Currency | Levels | ×/level | Prices | Cumulative max |
|---|---|---|---|---|---|
| I | gold | 5 | 1.30 | 50 → 1,954 (3,224) | ×3.7 |
| II | orange | 10 | 1.55 | 25 → 1,291 (3,597) | ×297 |
| III | green | 4 | 1.18 | 150 → 2,074 (3,448) | ×576 |
| IV | essence | 3 | 1.08 | 2,000 → 12,500 | ×726 |
| V | essence | 3 | 1.05 | 4,000 → 25,000 | ×840 |

## Fixed block health, rolled damage

Every ordinary block of a tier has the same health (no more bands), and every
squad hit against terrain or the Blight rolls between 1x and 5x the weapon's
listed damage (`DAMAGE_ROLL` in config.ts): a fresh 1-damage pistol hits for
1-5, and the upgrade screen and HUD show weapon damage as that range. Rolls and
Calibration don't apply to armored bulkheads or to enemies. Health is now a
Uint32, so tiers no longer flatten near 65,535.

| Tier | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Block HP | 5 | 75 | 900 | 4,800 | 18,000 | 63,000 | 72,000 | 93,000 | 120,000 | 147,000 | 170,000 |

From tier 3 up these are the old band midpoints x3, since a roll averages 3x.

Average hits per block for a Lab-upgraded pistol (14 listed damage, rolls 14-70):

| Tier | HP | Arriving | Fully calibrated for the world |
|---|---:|---:|---:|
| 3 | 900 | 21 | 5.8 |
| 4 | 4,800 | 31 | 0.4 |
| 6 | 63,000 | 404 | 5.0 |
| 7 | 72,000 | 5.8 | 3.0 |
| 9 | 120,000 | 9.6 | 5.0 |
| 10 | 147,000 | 6.1 | 4.8 |
| 11 | 170,000 | 5.6 | 4.8 |

The Blighted Wards is the steep climb (HP x70 from T3 to T6), so stage II
carries most of the curve.

## Black Market path research

Every mutation path now has research once it's picked (essence-priced, only
buyable while the path is active, kept when switching away, refunded with the
Black Market refund). New nodes: Rewind Surge / Snap Rewind, Extended Cylinder /
Sling Charge, Seeker Heads / Tight Turns, Wide Intake / Compression Chamber,
Capacitor Bank, Long Trace / Hardened Traces, Deep Bore / Mine Payload, Deep
Freeze / Cold Front, Rail Capacitor / Tungsten Core, Cleaving Wind / Broad
Crescent, Stable Fuel / Wide Spill, Deep Chill / Long Mist. Defined in
`src/progression/MarketResearch.ts`.

## Still to tune from play

Income per minute is a model, not a measurement. Watch time-to-afford for
Calibration II level 1 on arriving in the Wards (31 hits per T4 block) and the
crystal sink of soldier T2 nodes (now 80 base) across a full squad.

## Blight generators and Wardens

- **Generator tiers** (`src/world/GeneratorTiers.ts`): every generator has a level, the block tier of
  the zone it sits in. Each generator cell holds a fifth of that tier's block health
  (`GENERATOR.healthFrac`). Its rim is painted in the tier's colors with 1-3 studs for the tier step
  inside its world. When a tougher generator's creep joins a weaker one's colony, the weaker
  generator is taken over over `GENERATOR.convertSeconds`: its rim recolors and its health climbs
  smoothly to the tougher level, keeping the share of health it had left.
- **Blight Wardens** (`src/systems/BlightWardens.ts`): two bosses guard every gold special-upgrade
  block. While either lives, the block is wrapped in a Blight membrane and hits glance off. Warden
  health is `WARDEN.hpBlocks` (4) ordinary blocks of the spot's tier, and squad hits on them roll
  and take Arsenal Calibration like hits on Blight. Damage per bite or blob is 1 in the Lab, 2 in the
  Wards, and the CAMPAIGN enemy damage in later worlds (lunges hit twice as hard).
