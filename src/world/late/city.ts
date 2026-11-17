/**
 * World 4: Fallen City (7 x 7 sectors, 49 x 49 chars).
 * Sectors A..G (cols 0..6) x 1..7 (rows 0..6).
 * Arrival: D1 (north gate). Facility: C3-E5 (Launch Control, Hangar, Fuel Yard, D4 Launch Pad).
 * Landmarks: A2-A3 Collapsed Overpass, E1-F1 Central Station Concourse, B6-C6 Outer Fuel Depot.
 * Legend: . building mass, R street/plaza, -|+ streets, # wreck/barricade, = bulkhead, s soldier, b brute, t turret, m mine, P teleporter, $ special.
 */
export const CITY_BLUEPRINT: readonly string[] = [
  "........................|........................", // 1
  ".#tRt.................RRRRR...........tRR...#tRR.",
  ".RRmR----#tRt.........RRRRR..#tRR#tRtRRtR...mRRs.",
  ".sbRR....RRtR..#tRR...RRRRR--RRRRmRRRmRRR---RRRt.",
  "...|.....mRsb--mRRs---RRRRR..RsRbRRs#RbRR...RRbR.",
  "...|......|....RtbR...RRRRR....|......|.......|..",
  "...|......|......|......|......|......|.......|..",
  "...|......|......|......|......|......|.......|..", // 2
  "...|....#tRm.....|......|......tRt....|.....tRR..",
  "..#t$R--RRsR----tRR.....|......RRt..#tRRm...tRR..",
  ".RtRRR..tbRR....tRR...#tRR.....RRm--RRRsR---mRR..",
  ".tRRRm....|.....mRs---tRRm-----sRb..tRbR#...RsR..",
  ".#RRs.....|.....RbR...RsbR............|.....RbR..",
  ".RbRR.....|.............|.............|.......|..",
  ".tRRm.....|.............=.............|.......|..", // 3
  ".RRs#.....|.............|.............tRR...#tRR.",
  ".RRsR----#tRt..t#$RR#tRRRt...tRRRR....tRm...tRRm.",
  ".RbRR....RRRm..tRRRRRRRtRR---mRRRR....RRs---RRRs.",
  "...|.....RsbR..mRRRsRRRmRR...R#sRR....RbR...RRbR.",
  "...|......|....RbR#RRsRbRR...RRsRR....|.......|..",
  "...|......|.............|....RbRRR....|.......|..",
  "...|......|.............|....tRRRR....|.......|..", // 4
  "...|....#tRt...tRRt...#tRR#..RtRRR....|.....tRR..",
  "..#tRt--RRmR...RRtR...RtRRR..RRmRR..#tRRt...tRR..",
  "..RRRm..sbRR--=RmRR---RmPRR--RRR#R=-RRRmR---tRR..",
  "..RsbR....|....sRbR...RsRRb..sRRRR..sRbR#...mRs..",
  "...|......|......|....#RRR#..bRRRR....|.....RbR..",
  "...|......|......|......|......|......|.......|..",
  "...|......|......|......|......|......|.......|..", // 5
  ".#tRt.....|.....tR#RRtRRRRt#tRRRt.....tRt...#tRR.",
  ".RRmR----#tRt...mRRRsRRRRRmRRRRmR.....RRt...mRRs.",
  ".sbRR....RRtR...RRRRsRRRRsRRRRsRR.....RRm---RRRs.",
  "...|.....mRsb...RRbRR#RbRRRRRb#RR.....sRb...RRbR.",
  "...|......|.............|.............|.......|..",
  "...|......|.............=.............|.......|..",
  "...|......|.............|.............|.......|..", // 6
  "...|....#tRR............|......tRt....|.....t$R..",
  "..#tRt--RmR#RRtRRRt.....|......RRt..#tRRm...tRR..",
  "..RRtR..sRRRRsRRmRR...#tRR.....RRm--RRRsR---mRR..",
  "..mRsb...RRbRRR#sRR---tRRm-----sRb..sRbR#...RsR..",
  "...|......|.....bRR...RsbR.....|......|.....RbR..",
  "...|......|......|......|......|......|.......|..",
  "...|......|......|......|......|......|.......|..", // 7
  ".#tRm.....|......|......|......|......tRR...#tRR.",
  ".RRsR----#tRt....|.....tRt...#tRRm....tRm...tRRm.",
  ".sbRR....RRRm..#tRR....RRR---RRRsR----RRs---RRRs.",
  ".........RsbR--tRRm----tRm...sRbR#....RbR...RRbR.",
  "...............RsbR....sRb.......................",
  ".................................................",
];
