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

Hits per mid-band block for a Lab-upgraded pistol shot (14 damage):

| Tier | HP (mid) | Arriving | Fully calibrated for the world |
|---|---:|---:|---:|
| 3 | 300 | 21 | 5.8 |
| 4 | 1,600 | 31 | 0.4 |
| 6 | 21,000 | 404 | 5.0 |
| 7 | 24,000 | 5.8 | 3.0 |
| 9 | 40,000 | 9.6 | 5.0 |
| 10 | 49,000 | 6.1 | 4.8 |
| 11 | 56,500 | 5.6 | 4.8 |

The Blighted Wards is the steep climb (HP grows ×70 from T3 to T6), so stage II
carries most of the curve. Late terrain was raised so every tier is harder than
the last (T7 used to drop back to T4's health); block health is a Uint16, so the
late curve is flat and stages III–V are small steps.

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
