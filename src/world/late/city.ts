/**
 * World 4: Fallen City (7 x 7 sectors, 49 x 49 chars).
 * Sectors A..G (cols 0..6) x 1..7 (rows 0..6).
 * Arrival: D1 (north gate). Facility: C3-E5 (4 bulkhead entrances). Teleporter: D4.
 * Legend: . building mass, R street/plaza, -|+ streets, # wreck/barricade, = bulkhead, s soldier, b brute, t turret, m mine, P teleporter.
 */
export const CITY_BLUEPRINT: readonly string[] = [
  "........................|........................", // 1
  ".#tRs#..#tRs#..#tRs#..RRRRR..#tRs#..#tRs#..#tRs#.",
  ".RRRRR..RRRRR..RRRRR..RRRRR..RRRRR..RRRRR..RRRRR.",
  ".mRRRb--mRRRb--mRRRb--RRRRR--mRRRb--mRRRb--mRRRb.",
  ".RRRRR..RRRRR..RRRRR..RRRRR..RRRRR..RRRRR..RRRRR.",
  ".#tRR#..#tRR#..#tRR#..RRRRR..#tRR#..#tRR#..#tRR#.",
  "...|......|......|......|......|......|......|...",
  "...|......|......|......|......|......|......|...", // 2
  ".#tRRs..#tRRs..#tRRs..#tRRs..#tRRs..#tRRs..#tRRs.",
  ".RRR#R..RRR#R..RRR#R..RRR#R..RRR#R..RRR#R..RRR#R.",
  ".mRRRt--mRRRt--mRRRt--mRRRt--mRRRt--mRRRt--mRRRt.",
  ".R#RRR..R#RRR..R#RRR..R#RRR..R#RRR..R#RRR..R#RRR.",
  ".bRRR#..bRRR#..bRRR#..bRRR#..bRRR#..bRRR#..bRRR#.",
  "...|......|.............|.............|......|...",
  "...|......|.............=.............|......|...", // 3
  ".tRRm#..tRRm#..#tRs#..#tRs#..#tRs#..tRRm#..tRRm#.",
  ".R#RRt..R#RRt..RRRRR..RRRRR..RRRRR..R#RRt..R#RRt.",
  ".sRRRb--sRRRb..mRRRb--mRRRb--mRRRb..sRRRb--sRRRb.",
  ".RR#RR..RR#RR..RRRRR..RRRRR..RRRRR..RR#RR..RR#RR.",
  ".#RRRR..#RRRR..#tRR#..#tRR#..#tRR#..#RRRR..#RRRR.",
  "...|......|......|......|......|......|......|...",
  "...|......|......|......|......|......|......|...", // 4
  ".#tRs#..#tRs#..#tRs#..#tRt#..#tRs#..#tRs#..#tRs#.",
  ".RRRRR..RRRRR..RRRRR..RRRRR..RRRRR..RRRRR..RRRRR.",
  ".mRRRb--mRRRb-=mRRRb--sRPRb--mRRRb=-mRRRb--mRRRb.",
  ".RRRRR..RRRRR..RRRRR..RRRRR..RRRRR..RRRRR..RRRRR.",
  ".#tRR#..#tRR#..#tRR#..#mRR#..#tRR#..#tRR#..#tRR#.",
  "...|......|......|......|......|......|......|...",
  "...|......|......|......|......|......|......|...", // 5
  ".#tRRs..#tRRs..#tRs#..#tRs#..#tRs#..#tRRs..#tRRs.",
  ".RRR#R..RRR#R..RRRRR..RRRRR..RRRRR..RRR#R..RRR#R.",
  ".mRRRt--mRRRt..mRRRb--mRRRb--mRRRb..mRRRt--mRRRt.",
  ".R#RRR..R#RRR..RRRRR..RRRRR..RRRRR..R#RRR..R#RRR.",
  ".bRRR#..bRRR#..#tRR#..#tRR#..#tRR#..bRRR#..bRRR#.",
  "...|......|.............=.............|......|...",
  "...|......|.............|.............|......|...", // 6
  ".tRRm#..tRRm#..tRRm#..tRRm#..tRRm#..tRRm#..tRRm#.",
  ".R#RRt..R#RRt..R#RRt..R#RRt..R#RRt..R#RRt..R#RRt.",
  ".sRRRb--sRRRb--sRRRb--sRRRb--sRRRb--sRRRb--sRRRb.",
  ".RR#RR..RR#RR..RR#RR..RR#RR..RR#RR..RR#RR..RR#RR.",
  ".#RRRR..#RRRR..#RRRR..#RRRR..#RRRR..#RRRR..#RRRR.",
  "...|......|......|......|......|......|......|...",
  "...|......|......|......|......|......|......|...", // 7
  ".#tRs#..#tRs#..#tRs#..#tRs#..#tRs#..#tRs#..#tRs#.",
  ".RRRRR..RRRRR..RRRRR..RRRRR..RRRRR..RRRRR..RRRRR.",
  ".mRRRb--mRRRb--mRRRb--mRRRb--mRRRb--mRRRb--mRRRb.",
  ".RRRRR..RRRRR..RRRRR..RRRRR..RRRRR..RRRRR..RRRRR.",
  ".#tRR#..#tRR#..#tRR#..#tRR#..#tRR#..#tRR#..#tRR#.",
  ".................................................",
];
