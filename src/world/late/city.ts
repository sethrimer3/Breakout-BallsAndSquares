/**
 * World 4: Fallen City (7 x 7 sectors, 49 x 49 chars).
 * Sectors A..G (cols 0..6) x 1..7 (rows 0..6).
 * Arrival: D1 (north gate). Facility: C3-E5 (4 bulkhead entrances). Teleporter: D4.
 * Landmarks: A3 Collapsed Overpass, F2 Central Station Plaza, B6 Outer Fuel Depot.
 * Legend: . building mass, R street/plaza, -|+ streets, # wreck/barricade, = bulkhead, s soldier, b brute, t turret, m mine, P teleporter, $ special.
 */
export const CITY_BLUEPRINT: readonly string[] = [
  "........................|........................", // 1
  ".tRRRt..tRRRt..tRRRm..RRRRR..tRRRt..tRRRm..tRRRt.",
  ".R#R#R..R#R#R..R#R#R..RRRRR..R#R#R..R#R#R..R#R#R.",
  ".RmRRR--tRRRm--RsRRR--RRRRR--tRRRm--RsRRR--RmRRR.",
  ".R#s#R..R#R#s..R#t#R..RRRRR..R#R#s..R#t#R..R#s#R.",
  ".RbRRR..RRbRR..RbRRR...RRR...RRbRR..RbRRR..RbRRR.",
  "...|......|......|......|......|......|......|...",
  "...|......|......|......|......|......|......|...", // 2
  ".t$R.....tRR...tRR.....tRR...tRR....tRRRt..tRR...",
  ".t#RRR..RmRRR..R#tRR..tRRRt..R#mRR..R#R#R..t#RRR.",
  ".tRRRm--s#R#R--RmRRR--R#R#R--RsRRR--RmRRR--tRRRm.",
  ".RRs#R..RRtRR..RsR#R..mRRsR..RtR#R..R#s#R..RRs#R.",
  "...bRR...bRR.....bRR...bRR.....bRR..RbRRR....bRR.",
  "...|......|.............|.............|......|...",
  "...|......|.............=.............|......|...", // 3
  ".tRRRm...tRR...t$RRt...tRR...tRRRR...tRR...tRR...",
  ".R#R#R..RtRRR..R#R#R..mRRRs..tRRRR..tRRRt..R#mRR.",
  ".RsRRR--m#R#R..tRRRR--RRRtR--mRRRR..R#R#R--RsRRR.",
  ".R#t#R..RRsRR..mRRRs..b#R#R..RsRRR..mRRsR..RtR#R.",
  ".RbRRR...bRR...RRbRR....|....RbRRR...bRR.....bRR.",
  "...|......|......|......|......|......|......|...",
  "...|......|......|......|......|......|......|...", // 4
  ".tRRRt..tRR.....tRR...t#R#R..tRRRt..tRR.....tRR..",
  ".R#R#R..t#RRR..RmRRR..RtRRR..RRRRt..R#mRR..RtRRR.",
  ".RmRRR--tRRRm-=RsRRR--RmPRR--RRRRm=-RsRRR--m#R#R.",
  ".R#s#R..RRs#R..RtRRb..RsRRb..RRRsR..RsR#R..RRsRR.",
  ".RbRRR....bRR...RRR...R#R#R..RbRRR....bRR...bRR..",
  "...|......|......|......|......|......|......|...",
  "...|......|......|......|......|......|......|...", // 5
  ".tRR....tRR....tRRRR..t#R#R..tRRRR...tRR....tRR..",
  ".t#RRR..R#mRR..t#R#R..tRRtR..m#R#R..RtRRR..tRRRt.",
  ".tRRRm--RsRRR..RmRRR--RmRRs--RsRRR..m#R#R--R#R#R.",
  ".RRs#R..RsR#R..R#sRR...RbR...RsR#R..RRsRR..mRRsR.",
  "...bRR....bRR..RbRRR....|....RbRRR...bRR....bRR..",
  "...|......|.............=.............|......|...",
  "...|......|.............|.............|......|...", // 6
  "..tRR...tRRRt...tRR...tRRRm..tRRRt..tRR....t$RRm.",
  ".RmRRR..R#R#R..tRRRt..R#R#R..R#R#R..t#RRR..R#R#R.",
  ".s#R#R--RmRRR--R#R#R--RsRRR--RmRRR--tRRRm--RsRRR.",
  ".RRsRR..R#s#R..mRRsR..R#s#R..R#s#R..RRs#R..R#s#R.",
  "..bRR...RbRRR...bRR...RbRRR..RbRRR....bRR..RbRRR.",
  "...|......|......|......|......|......|......|...",
  "...|......|......|......|......|......|......|...", // 7
  ".tRRRt..tRRRt...tRR....tRR...tRR....tRR....tRRRt.",
  ".R#R#R..R#R#R..RmRRR..RtRRR..t#RRR..R#mRR..R#R#R.",
  ".RmRRR--tRRRm--s#R#R--m#R#R--tRRRm--RsRRR--RmRRR.",
  ".R#s#R..R#R#s..RRsRR..RRsRR..RRs#R..RsR#R..R#s#R.",
  ".RbRRR..RRbRR...bRR....bRR.....bRR....bRR..RbRRR.",
  ".................................................",
];
