/**
 * World 4: Fallen City (7 x 7 sectors, 49 x 49 chars).
 * Sectors A..G (cols 0..6) x 1..7 (rows 0..6).
 * Arrival: D1 (north gate). Facility: C3-E5 (4 bulkhead entrances). Teleporter: D4.
 * Landmarks: A3 Collapsed Overpass, F2 Central Station Plaza, B6 Outer Fuel Depot.
 * Legend: . building mass, R street/plaza, -|+ streets, # wreck/barricade, = bulkhead, s soldier, b brute, t turret, m mine, P teleporter, $ special.
 */
export const CITY_BLUEPRINT: readonly string[] = [
  "........................|........................", // 1
  ".tR|RR..tR|Rt..tR|RR..RRRRR..tR|Rt..tR|RR..tR|RR.",
  ".t#R#R..R#R#t..m#R#R..RRRRR..R#R#t..m#R#R..t#R#R.",
  ".-mRR----RRR----sRR---RRRRR---RRR----sRR----mRR-.",
  ".R#s#R..m#R#R..R#s#R..RRRRR..m#R#R..R#s#R..R#s#R.",
  ".Rb|RR..sR|bR..Rb|RR...RRR...sR|bR..Rb|RR..Rb|RR.",
  "...|......|......|......|......|......|......|...",
  "...|......|......|......|......|......|......|...", // 2
  ".t$R....tR.RR..tRR....tR.Rt..tRR....tRRRt..tRR...",
  ".t#RRR..mR.RR..R#tRR..RR.Rt..R#mRR..R#R#R..t#RRR.",
  ".-tRRR--sRRRR---RRmR--RRRmR---RRsR--RmRRR---tRRR.",
  ".mRs#R..s#.#R..RsR#R..R#.#s..RsR#R..R#s#R..mRs#R.",
  "...RbR..Rb.RR....bRR..Rb.RR....bRR..RbRRR....RbR.",
  "...|......|.............|.............|......|...",
  "...|......|.............=.............|......|...", // 3
  ".tRRRR..tR.RR..t$RRt...tRR...tRRRR..tR.Rt..tRR...",
  "RmRRRRR.tR.RR..R#R#R..mRRRs..tRRRR..RR.Rt..R#mRR.",
  ".s#R#R--mRRRR..tRRRR--RRRsR--mRRRR..RRRmR---RRsR.",
  "RRRsRRR.s#.#R..mRRsR..b#R#R..RsRRR..R#.#s..RsR#R.",
  ".RbRRR..Rb.RR..Rb|RR....|....bR|RR..Rb.RR....bRR.",
  "...|......|......|......|......|......|......|...",
  "...|......|......|......|......|......|......|...", // 4
  ".tR|RR..tRR.....tRR...t#R#R..tRRRt..tRR....tR.RR.",
  ".t#R#R..t#RRR..RmRRR..RtRRR..RRRRt..R#mRR..tR.RR.",
  ".-mRR----tRRR-=RsRRR--RmPRR--RRRRm=--RRsR--mRRRR.",
  ".R#s#R..mRs#R..RsRRb..RsRRb..RRRsR..RsR#R..s#.#R.",
  ".Rb|RR....RbR...RRR...R#R#R..RbRRR....bRR..Rb.RR.",
  "...|......|......|......|......|......|......|...",
  "...|......|......|......|......|......|......|...", // 5
  ".tRR....tRR....tR.RR..t#R#R..tR.RR..tR.RR..tR.Rt.",
  ".t#RRR..R#mRR..t#.RR..tRRtR..mR.R#..tR.RR..RR.Rt.",
  ".-tRRR---RRsR..RmRRR--RmRRs--RsRRR..mRRRR--RRRmR.",
  ".mRs#R..RsR#R..R#.sR...RbR...Rs.R#..s#.#R..R#.#s.",
  "...RbR....bRR..Rb.RR....|....Rb.RR..Rb.RR..Rb.RR.",
  "...|......|.............=.............|......|...",
  "...|......|.............|.............|......|...", // 6
  ".tR.RR..tR.RR..tR.Rt..tR|RR..tR|RR..tRR....t$|RR.",
  ".mR.RR..t#.R#..RR.Rt..m#R#R..t#R#R..t#RRR..m#R#R.",
  ".sRRRR--RRRmR--RRRmR---sRR----mRR----tRRR---sRR-.",
  ".s#.#R..R#.sR..R#.#s..R#s#R..R#s#R..mRs#R..R#s#R.",
  ".Rb.RR..Rb.RR..Rb.RR..Rb|RR..Rb|RR....RbR..Rb|RR.",
  "...|......|......|......|......|......|......|...",
  "...|......|......|......|......|......|......|...", // 7
  ".tR|RR..tR|Rt..tR.RR..tR.RR..tRR....tRR....tR|RR.",
  ".t#R#R..R#R#t..mR.RR..tR.RR..t#RRR..R#mRR..t#R#R.",
  ".-mRR----RRR---sRRRR--mRRRR---tRRR---RRsR---mRR-.",
  ".R#s#R..m#R#R..s#.#R..s#.#R..mRs#R..RsR#R..R#s#R.",
  ".Rb|RR..sR|bR..Rb.RR..Rb.RR....RbR....bRR..Rb|RR.",
  ".................................................",
];
