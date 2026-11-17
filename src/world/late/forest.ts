/**
 * World 3: Canopy Forest (13 x 13 sectors, 91 x 91 chars).
 * Sectors A..M (cols 0..12) x 1..13 (rows 0..12).
 * Arrival: A7 (west gate). Exit: L13 (south gate).
 * Landmarks: D5 Sunken Lake Bed, G8 Fallen Giant Tree, K10 Ruined Ranger Station.
 * Legend: . solid, R clearing, -|+ trails, # cover, s soldier, b brute, g grove.
 */
export const FOREST_BLUEPRINT: readonly string[] = [
  "...........................................................................................", // 1
  ".#sRRg..gR#Rs..sRRg#..#sRRg..gR#Rs..sRRg#..#sRRg..gR#Rs..sRRg#..#sRR#...sRR#..#gRs#..#sRR#.",
  ".RRRR#..RRRRR..RR#RR..RRRR#..RRRRR..RR#RR..RRRR#..RRRRR..RR#RR..gRRRb..#RRRg..#RRR#..gRRRb.",
  ".gRRbR--bRRRg--RRsRb--gRRbR--bRRRg--RRsRb--gRRbR--bRRRg--RRsRb--RRRRR--gRRRb--bRRRg--RRRRR.",
  ".#RRRR..#RRRR..gR#RR..#RRRR..#RRRR..gR#RR..#RRRR..#RRRR..gR#RR..sRRRg..#RRRs..#RRR#..sRRRg.",
  ".gRRs#..sRRg#..#RRRg..gRRs#..sRRg#..#RRRg..gRRs#..sRRg#..#RRRg..#RRR#...#RR...#sRR#..#RRR#.",
  "...|......|......|......|......|......|......|......|......|......|......|......|......|...",
  "...|......|......|......|......|......|......|......|......|......|......|......|......|...", // 2
  ".#sRRg..gR#Rs..sRRg#..#sRRg..gR#Rs..sRRg#..#sRRg..gR#Rs..sRRg#..#sRR#...sRR#..#gRs#..#sRR#.",
  ".RRRR#..RRRRR..RR#RR..RRRR#..RRRRR..RR#RR..RRRR#..RRRRR..RR#RR..gRRRb..#RRRg..#RRR#..gRRRb.",
  ".gRRbR--bRRRg--RRsRb--gRRbR--bRRRg--RRsRb--gRRbR--bRRRg--RRsRb--RRRRR--gRRRb--bRRRg--RRRRR.",
  ".#RRRR..#RRRR..gR#RR..#RRRR..#RRRR..gR#RR..#RRRR..#RRRR..gR#RR..sRRRg..#RRRs..#RRR#..sRRRg.",
  ".gRRs#..sRRg#..#RRRg..gRRs#..sRRg#..#RRRg..gRRs#..sRRg#..#RRRg..#RRR#...#RR...#sRR#..#RRR#.",
  "...|......|......|......|......|......|......|......|......|......|......|......|......|...",
  "...|......|......|......|......|......|......|......|......|......|......|......|......|...", // 3
  ".RRRRR..gRRRg..gRRRR..RRRRR..gRRRg..sRRg#..#sRRg..gR#Rs..sRRg#..#sRR#...sRR#..#gRs#..#sRR#.",
  ".gRRRg..RRRRR..RRRRg..gRRRg..RRRRR..RR#RR..RRRR#..RRRRR..RR#RR..gRRRb..#RRRg..#RRR#..gRRRb.",
  ".gRRRg--gRRRg--gRRRg--gRRRg--gRRRg--RRsRb--gRRbR--bRRRg--RRsRb--RRRRR--gRRRb--bRRRg--RRRRR.",
  ".gRRRg..RRRRR..gRRRR..gRRRg..RRRRR..gR#RR..#RRRR..#RRRR..gR#RR..sRRRg..#RRRs..#RRR#..sRRRg.",
  ".RRRRR..gRRRg..RRRRg..RRRRR..gRRRg..#RRRg..gRRs#..sRRg#..#RRRg..#RRR#...#RR...#sRR#..#RRR#.",
  "...|......|......|......|......|......|......|......|......|......|......|......|......|...",
  "...|......|......|......|......|......|......|......|......|......|......|......|......|...", // 4
  ".RRRRR..gRRRg..gRRRR..RRRRR..gRRRg..s$Rg#..#sRRg..gR#Rs..sRRg#..#sRR#...sRR#..#gRs#..#sRR#.",
  ".gRRRg..RRRRR..RRRRg..gRRRg..RRRRR..RR#RR..RRRR#..RRRRR..RR#RR..gRRRb..#RRRg..#RRR#..gRRRb.",
  ".gRRRg--gRRRg--gRRRg--gRRRg--gRRRg--RRsRb--gRRbR--bRRRg--RRsRb--RRRRR--gRRRb--bRRRg--RRRRR.",
  ".gRRRg..RRRRR..gRRRR..gRRRg..RRRRR..gR#RR..#RRRR..#RRRR..gR#RR..sRRRg..#RRRs..#RRR#..sRRRg.",
  ".RRRRR..gRRRg..RRRRg..RRRRR..gRRRg..#RRRg..gRRs#..sRRg#..#RRRg..#RRR#...#RR...#sRR#..#RRR#.",
  "...|......|......|......|......|......|......|......|......|......|......|......|......|...",
  "...|......|......|......|......|......|......|......|......|......|......|......|......|...", // 5
  ".RRRRR..gRRRg..g$RRR.gRRRRRg.gRRRg..sRRg#..#sRRg..gR#Rs..sRRg#..#sRR#...sRR#..#gRs#..#sRR#.",
  ".gRRRg..RRRRR..RRRRg.RRRRRRR.RRRRR..RR#RR..RRRR#..RRRRR..RR#RR..gRRRb..#RRRg..#RRR#..gRRRb.",
  ".gRRRg--gRRRg--gRRRg--gRRRg--gRRRg--RRsRb--gRRbR--bRRRg--RRsRb--RRRRR--gRRRb--bRRRg--RRRRR.",
  ".gRRRg..RRRRR..gRRRR.RRRRRRR.RRRRR..gR#RR..#RRRR..#RRRR..gR#RR..sRRRg..#RRRs..#RRR#..sRRRg.",
  ".RRRRR..gRRRg..RRRRg.gRRRRRg.gRRRg..#RRRg..gRRs#..sRRg#..#RRRg..#RRR#...#RR...#sRR#..#RRR#.",
  "...|......|......|......|......|......|......|......|......|......|......|......|......|...",
  "...|......|......|......|......|......|......|......|......|......|......|......|......|...", // 6
  ".RRRRR..gRRRg..gRRRR..RRRRR..gRRRg..sRRg#..#sRRg..gR#Rs..sRRg#..#sRR#...sRR#..#gRs#..#sRR#.",
  ".gRRRg..RRRRR..RRRRg..gRRRg..RRRRR..RR#RR..RRRR#..RRRRR..RR#RR..gRRRb..#RRRg..#RRR#..gRRRb.",
  ".gRRRg--gRRRg--gRRRg--gRRRg--gRRRg--RRsRb--gRRbR--bRRRg--RRsRb--RRRRR--gRRRb--bRRRg--RRRRR.",
  ".gRRRg..RRRRR..gRRRR..gRRRg..RRRRR..gR#RR..#RRRR..#RRRR..gR#RR..sRRRg..#RRRs..#RRR#..sRRRg.",
  ".RRRRR..gRRRg..RRRRg..RRRRR..gRRRg..#RRRg..gRRs#..sRRg#..#RRRg..#RRR#...#RR...#sRR#..#RRR#.",
  "...|......|......|......|......|......|......|......|......|......|......|......|......|...",
  "...|......|......|......|......|......|......|......|......|......|......|......|......|...", // 7
  ".RRRRR..gRRRg..gRRRR..RRRRR..gRRRg..sRRg#..#sRRg..gR#Rs..sRRg#..#sRR#...sRR#..#gRs#..#sRR#.",
  ".RRRRR..RRRRR..RRRRg..gRRRg..RRRRR..RR#RR..RRRR#..RRRRR..RR#RR..gRRRb..#RRRg..#RRR#..gRRRb.",
  "-RRRRR--gRRRg--gRRRg--gRRRg--gRRRg--RRsRb--gRRbR--bRRRg--RRsRb--RRRRR--gRRRb--bRRRg--RRRRR.",
  ".RRRRR..RRRRR..gRRRR..gRRRg..RRRRR..gR#RR..#RRRR..#RRRR..gR#RR..sRRRg..#RRRs..#RRR#..sRRRg.",
  ".RRRRR..gRRRg..RRRRg..RRRRR..gRRRg..#RRRg..gRRs#..sRRg#..#RRRg..#RRR#...#RR...#sRR#..#RRR#.",
  "...|......|......|......|......|......|......|......|......|......|......|......|......|...",
  "...|......|......|......|......|......|......|......|......|......|......|......|......|...", // 8
  ".RRRRR..gRRRg..gRRRR..RRRRR..gRRRg..sRRg#..#sRRs..gR#Rs..sRRg#..#sRR#...sRR#..#gRs#..#sRR#.",
  ".gRRRg..RRRRR..RRRRg..gRRRg..RRRRR..RR#RR..RRRRR..RRRRR..RR#RR..gRRRb..#RRRg..#RRR#..gRRRb.",
  ".gRRRg--gRRRg--gRRRg--gRRRg--gRRRg--RRsRb--gRbRg--bRRRg--RRsRb--RRRRR--gRRRb--bRRRg--RRRRR.",
  ".gRRRg..RRRRR..gRRRR..gRRRg..RRRRR..gR#RR..RRRRR..#RRRR..gR#RR..sRRRg..#RRRs..#RRR#..sRRRg.",
  ".RRRRR..gRRRg..RRRRg..RRRRR..gRRRg..#RRRg..#sRR#..sRRg#..#RRRg..#RRR#...#RR...#sRR#..#RRR#.",
  "...|......|......|......|......|......|......|......|......|......|......|......|......|...",
  "...|......|......|......|......|......|......|......|......|......|......|......|......|...", // 9
  ".RRRRR..gRRRg..gRRRR..RRRRR..gRRRg..sRRg#..#sRRg..gR#Rs..sRRg#..#sRR#...sRR#..#gRs#..#sRR#.",
  ".gRRRg..RRRRR..RRRRg..gRRRg..RRRRR..RR#RR..RRRR#..RRRRR..RR#RR..gRRRb..#RRRg..#RRR#..gRRRb.",
  ".gRRRg--gRRRg--gRRRg--gRRRg--gRRRg--RRsRb--gRRbR--bRRRg--RRsRb--RRRRR--gRRRb--bRRRg--RRRRR.",
  ".gRRRg..RRRRR..gRRRR..gRRRg..RRRRR..gR#RR..#RRRR..#RRRR..gR#RR..sRRRg..#RRRs..#RRR#..sRRRg.",
  ".RRRRR..gRRRg..RRRRg..RRRRR..gRRRg..#RRRg..gRRs#..sRRg#..#RRRg..#RRR#...#RR...#sRR#..#RRR#.",
  "...|......|......|......|......|......|......|......|......|......|......|......|......|...",
  "...|......|......|......|......|......|......|......|......|......|......|......|......|...", // 10
  ".RRRRR..gRRRg..gRRRR..RRRRR..gRRRg..sRRg#..#s$Rg..gR#Rs..sRRg#..#sRR#..#sRR#..#gRs#..#sRR#.",
  ".gRRRg..RRRRR..RRRRg..gRRRg..RRRRR..RR#RR..RRRR#..RRRRR..RR#RR..gRRRb..gRRRb..#RRR#..gRRRb.",
  ".gRRRg--gRRRg--gRRRg--gRRRg--gRRRg--RRsRb--gRRbR--bRRRg--RRsRb--RRRRR--RRRRR--bRRRg--RRRRR.",
  ".gRRRg..RRRRR..gRRRR..gRRRg..RRRRR..gR#RR..#RRRR..#RRRR..gR#RR..sRRRg..sRRRg..#RRR#..sRRRg.",
  ".RRRRR..gRRRg..RRRRg..RRRRR..gRRRg..#RRRg..gRRs#..sRRg#..#RRRg..#RRR#..#bRR#..#sRR#..#RRR#.",
  "...|......|......|......|......|......|......|......|......|......|......|......|......|...",
  "...|......|......|......|......|......|......|......|......|......|......|......|......|...", // 11
  ".RRRRR..gRRRg..gRRRR..RRRRR..gRRRg..sRRg#..#sRRg..gR#Rs..sRRg#..#sRR#...sRR#..#gRs#..#sRR#.",
  ".gRRRg..RRRRR..RRRRg..gRRRg..RRRRR..RR#RR..RRRR#..RRRRR..RR#RR..gRRRb..#RRRg..#RRR#..gRRRb.",
  ".gRRRg--gRRRg--gRRRg--gRRRg--gRRRg--RRsRb--gRRbR--bRRRg--RRsRb--RRRRR--gRRRb--bRRRg--RRRRR.",
  ".gRRRg..RRRRR..gRRRR..gRRRg..RRRRR..gR#RR..#RRRR..#RRRR..gR#RR..sRRRg..#RRRs..#RRR#..sRRRg.",
  ".RRRRR..gRRRg..RRRRg..RRRRR..gRRRg..#RRRg..gRRs#..sRRg#..#RRRg..#RRR#...#RR...#sRR#..#RRR#.",
  "...|......|......|......|......|......|......|......|......|......|......|......|......|...",
  "...|......|......|......|......|......|......|......|......|......|......|......|......|...", // 12
  ".#sRRg..gR#Rs..sRRg#..#sRRg..gR#Rs..sRRg#..#sRRg..gR#Rs..sRRg#..#sRR#...sRR#..#gRs#..#s$R#.",
  ".RRRR#..RRRRR..RR#RR..RRRR#..RRRRR..RR#RR..RRRR#..RRRRR..RR#RR..gRRRb..#RRRg..#RRR#..gRRRb.",
  ".gRRbR--bRRRg--RRsRb--gRRbR--bRRRg--RRsRb--gRRbR--bRRRg--RRsRb--RRRRR--gRRRb--bRRRg--RRRRR.",
  ".#RRRR..#RRRR..gR#RR..#RRRR..#RRRR..gR#RR..#RRRR..#RRRR..gR#RR..sRRRg..#RRRs..#RRR#..sRRRg.",
  ".gRRs#..sRRg#..#RRRg..gRRs#..sRRg#..#RRRg..gRRs#..sRRg#..#RRRg..#RRR#...#RR...#sRR#..#RRR#.",
  "...|......|......|......|......|......|......|......|......|......|......|......|......|...",
  "...|......|......|......|......|......|......|......|......|......|......|......|......|...", // 13
  ".#sRRg..gR#Rs..sRRg#..#sRRg..gR#Rs..sRRg#..#sRRg..gR#Rs..sRRg#..#sRR#...sRR#..#gRs#..#sRR#.",
  ".RRRR#..RRRRR..RR#RR..RRRR#..RRRRR..RR#RR..RRRR#..RRRRR..RR#RR..gRRRb..#RRRg..#RRR#..gRRRb.",
  ".gRRbR--bRRRg--RRsRb--gRRbR--bRRRg--RRsRb--gRRbR--bRRRg--RRsRb--RRRRR--gRRRb--bRRRg--RRRRR.",
  ".#RRRR..#RRRR..gR#RR..#RRRR..#RRRR..gR#RR..#RRRR..#RRRR..gR#RR..sRRRg..#RRRs..#RRR#..sRRRg.",
  ".gRRs#..sRRg#..#RRRg..gRRs#..sRRg#..#RRRg..gRRs#..sRRg#..#RRRg..#RRR#...#RR...#sRR#..#RRR#.",
  "................................................................................|..........",
];
