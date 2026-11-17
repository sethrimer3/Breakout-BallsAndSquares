/**
 * World 5: Blight Mothership (3 x 7 sectors, 21 x 49 chars).
 * Sectors A..C (cols 0..2) x 1..7 (rows 0..6).
 * Arrival: B7 (staging airlock). Boss: B2 (octagonal Command Sanctum). Apex: row 1.
 * Legend: . hull, R deck, -|+ corridors, # blast pillar, = bulkhead, s soldier, b brute, t turret, m mine, X boss.
 */
export const MOTHERSHIP_BLUEPRINT: readonly string[] = [
  ".....................", // 1
  ".#tRs#..#tRs#..#tRs#.",
  ".RRRRR..RRRRR..RRRRR.",
  ".mRRRb==mRRRb==mRRRb.",
  ".RRRRR..RRRRR..RRRRR.",
  ".#tRR#..#tRR#..#tRR#.",
  "...=......=......=...",
  "...=......=......=...", // 2
  ".#tRs#...RRR...#tRs#.",
  ".RRRRR..R#R#R..RRRRR.",
  ".mRRRb==tRXRt==mRRRb.",
  ".RRRRR..R#R#R..RRRRR.",
  ".#tRR#...RRR...#tRR#.",
  "...=......=......=...",
  "...=......=......=...", // 3
  ".#tRs#..#tRs#..#tRs#.",
  ".RRRRR..RRRRR..RRRRR.",
  ".mRRRb==mRRRb==mRRRb.",
  ".RRRRR..RRRRR..RRRRR.",
  ".#tRR#..#tRR#..#tRR#.",
  "...=......=......=...",
  "...=......=......=...", // 4
  ".#tRs#..#tRs#..#tRs#.",
  ".RRRRR..RRRRR..RRRRR.",
  ".mRRRb==mRRRb==mRRRb.",
  ".RRRRR..RRRRR..RRRRR.",
  ".#tRR#..#tRR#..#tRR#.",
  "...=......=......=...",
  "...=......=......=...", // 5
  ".tRRRs..tRRRs..tRRRs.",
  ".R#R#R..R#R#R..R#R#R.",
  ".mRRRb==mRRRb==mRRRb.",
  ".RRRRR..RRRRR..RRRRR.",
  ".tRRRR..tRRRR..tRRRR.",
  "...=......=......=...",
  "...=......=......=...", // 6
  ".#tRs#..#tRs#..#tRs#.",
  ".RRRRR..RRRRR..RRRRR.",
  ".mRRRb==mRRRb==mRRRb.",
  ".RRRRR..RRRRR..RRRRR.",
  ".#tRR#..#tRR#..#tRR#.",
  "...=......=......=...",
  "...=......=......=...", // 7
  ".#tRs#..RRRRR..#tRs#.",
  ".RRRRR..RRRRR..RRRRR.",
  ".mRRRb==RRRRR==mRRRb.",
  ".RRRRR..RRRRR..RRRRR.",
  ".#tRR#..RRRRR..#tRR#.",
  ".....................",
];
