/**
 * World 5: Blight Mothership (3 x 7 sectors, 21 x 49 chars).
 * Sectors A..C (cols 0..2) x 1..7 (rows 0..6).
 * Arrival: B7 (staging airlock). Boss: B2 (octagonal Command Sanctum). Apex: A1-C1 observation gallery.
 * Legend: . hull, R deck, -|+ corridors, # blast pillar, = bulkhead, s soldier, b brute, t turret, m mine, X boss, $ special.
 */
export const MOTHERSHIP_BLUEPRINT: readonly string[] = [
  ".....................", // 1
  "..tR#RRt$RRRRttR#RR..",
  "..tRRRm#RRRmRRtRRRm..",
  "..RRRRsRRsRRRRRRRRs..",
  "..RRbRRRbRRRRRRRbRR..",
  "..........|..........",
  "..........|..........",
  "..........|..........", // 2
  ".tRRt....RRR.........",
  ".RRRm...R#R#R...tRRt.",
  ".RRRs---tRXRt---RRRR.",
  ".RbRR...R#R#R...mRRs.",
  "...|.....RRR....RbRR.",
  "...|......|......|...",
  "...=......=......=...", // 3
  "..tRR.....|....tRRt..",
  "..tRm...tRRtR..RRRm..",
  "..RRs---RmRRR--RRRs..",
  "..RbR...sRRbR..RbRR..",
  "...|......|......|...",
  "...|......|......|...",
  "...|......|......|...", // 4
  ".t$RR.....|....tRR#t.",
  ".tRRR....tRR...RRmRR.",
  ".m#RR----tRR---sRRbR.",
  ".RRsR....mRs.....|...",
  ".RbRR....RbR.....|...",
  "...|......|......|...",
  "...=......=......=...", // 5
  "...tR#RtRRRRRtt#RR...",
  "...tRRmRRRRmRRtRRm...",
  "...RRRsRRsRRRRRRsR...",
  "...RRbRRbR#RRRRRbR...",
  "...|......|......|...",
  "...|......|......|...",
  "...|......|......|...", // 6
  ".tRRt.....|.....tRR..",
  ".RmRs---tRRRt...tRR..",
  ".RbRR...RRRRm---mRR..",
  "........RRRsR...RsR..",
  "........RRbRR...RbR..",
  "..........|..........",
  "..........=..........", // 7
  ".tRR....RRRRR........",
  ".tRm....RRRRR...tRRt.",
  ".RsR--=-RRRRR-=-RRmR.",
  ".RbR....RRRRR...sRbR.",
  "........RRRRR........",
  ".....................",
];
