/**
 * World 5: Blight Mothership (3 x 7 sectors, 21 x 49 chars).
 * Sectors A..C (cols 0..2) x 1..7 (rows 0..6).
 * Arrival: B7 (staging airlock). Boss: B2 (octagonal Command Sanctum). Apex: row 1.
 * Legend: . hull, R deck, -|+ corridors, # blast pillar, = bulkhead, s soldier, b brute, t turret, m mine, X boss, $ special.
 */
export const MOTHERSHIP_BLUEPRINT: readonly string[] = [
  ".....................", // 1
  ".#tRR#..t$RtR..#tRR#.",
  ".RtRRR..R#R#m..RtRRR.",
  ".mRRRs--RRRsR--mRRRs.",
  ".RRbRR...bRR...RRbRR.",
  "..........|..........",
  "..........|..........",
  "..........|..........", // 2
  ".tRRRt...RRR...tRRRt.",
  ".R#R#R..R#R#R..R#R#R.",
  ".mRRRs--tRXRt--mRRRs.",
  ".RRbRR..R#R#R..RRbRR.",
  "...=.....RRR.....=...",
  "...=......=......=...",
  "...=......=......=...", // 3
  "..tRR....tRR....tRR..",
  ".t#R#R..t#R#R..t#R#R.",
  ".RmRRR--RmRRR--RmRRR.",
  ".sRbRR..sRbRR..sRbRR.",
  "...|......|......|...",
  "...|......|......|...",
  "...|......|......|...", // 4
  ".t$RRt..tRRRt..tRRRt.",
  ".R#R#R..R#R#R..R#R#R.",
  ".RmRRR--RmRRR--RmRRR.",
  ".R#s#R..R#s#R..R#s#R.",
  ".RbRRR..RbRRR..RbRRR.",
  "...=......=......=...",
  "...=......=......=...", // 5
  ".tRRRt..tRRRt..tRRRt.",
  ".R#R#R..R#R#R..R#R#R.",
  ".mRRRs--mRRRs--mRRRs.",
  ".RRbRR..RRbRR..RRbRR.",
  "...|......|......|...",
  "...|......|......|...",
  "...|......|......|...", // 6
  ".tRR....tRR....tRR...",
  ".R#tRR..R#tRR..R#tRR.",
  ".RmRRR--RmRRR--RmRRR.",
  ".RsR#R..RsR#R..RsR#R.",
  "...bRR....bRR....bRR.",
  "...|......|......|...",
  "...|......=......|...", // 7
  ".#tRR#..RRRRR..#tRR#.",
  ".RtRRR..RRRRR..RtRRR.",
  ".RmRRR==RRRRR==RmRRR.",
  ".RsRRb..RRRRR..RsRRb.",
  "..RRR...RRRRR...RRR..",
  ".....................",
];
