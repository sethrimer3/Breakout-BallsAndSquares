/**
 * World 5: Blight Mothership (3 x 7 sectors, 21 x 49 chars).
 * Sectors A..C (cols 0..2) x 1..7 (rows 0..6).
 * Arrival: B7 (staging airlock). Boss: B2 (octagonal Command Sanctum). Apex: row 1.
 * Legend: . hull, R deck, -|+ corridors, # blast pillar, = bulkhead, s soldier, b brute, t turret, m mine, X boss, $ special.
 */
export const MOTHERSHIP_BLUEPRINT: readonly string[] = [
  ".....................", // 1
  "..tRR...t$RtR...tRR..",
  ".tRRRm..R#R#m..tRRRm.",
  ".R#RR#--RRRsR--R#RR#.",
  ".sRbRR...bRR...sRbRR.",
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
  ".t$.RR..tR.RR..tR.RR.",
  ".t#.#R..t#.#R..t#.#R.",
  ".RmRRR--RmRRR--RmRRR.",
  ".s#.#R..s#.#R..s#.#R.",
  ".Rb.RR..Rb.RR..Rb.RR.",
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
  ".tRRRt..RRRRR..tRRRt.",
  ".R#RR#..RRRRR..R#RR#.",
  ".RmRRR==RRRRR==RmRRR.",
  ".RsRRb..RRRRR..RsRRb.",
  "..RRR...RRRRR...RRR..",
  ".....................",
];
