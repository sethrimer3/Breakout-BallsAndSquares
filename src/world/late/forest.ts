/**
 * World 3: Canopy Forest (13 x 13 sectors, 91 x 91 chars).
 * Sectors A..M (cols 0..12) x 1..13 (rows 0..12).
 * Arrival: A7 (west gate). Exit: L13 (south gate).
 * Landmarks: D5 Sunken Lake Bed, G8 Fallen Giant Tree, K10 Ruined Ranger Station.
 * Legend: . solid, R clearing, -|+ trails, # cover, s soldier, b brute, g grove, $ special.
 */
export const FOREST_BLUEPRINT: readonly string[] = [
  "...........................................................................................", // 1
  ".sRRs...#sRR#..sRRRs..sRR....sRRs...#sRR#..sRRRs..sRR....sRRs...#sRR#..sRRRR..#sRR#..sRRRs.",
  ".R#Rs...RsRRR..R#RRb..s#RRR..R#Rs...RsRRR..R#RRb..s#RRR..R#Rs...RsRRR..s#RRR..RsRRR..R#RRb.",
  ".RRRbR--bRRRg--RRRRg--bRRRg--RRRbR--bRRRg--RRRRg--bRRRg--RRRbR--RbRRR--RbRRR--RbRRR--RRRRb.",
  "..Rg#R..RRgRR..RRR#g..RRg#R...Rg#R..RRgRR..RRR#g..RRg#R...Rg#R..RgRRg..RgR#R..RgRRg..RRR#g.",
  "..gRgR..#gRR#..RRgRR....gRR...gRgR..#gRR#..RRgRR....gRR...gRgR..#RRR#..RgRRR..#RRR#..RRgRR.",
  "...|......|......|.............|......|......|......|......|.............|......|......|...",
  "...|......|......|.............|......|......|......|......|.............|......|......|...", // 2
  ".#sRR#..#sRR#..#sRR#..#sRR#..#sRR#..#sRR#..#sRR#..#sRR#..#sRR#..#sRR#..#sRR#..#sRR#..#sRR#.",
  ".RsRRR..RsRRR..RsRRR..sRRRs..RsRRR..RsRRR..RsRRR..sRRRs..RsRRR..RsRRR..RsRRR..RsRRR..RsRRR.",
  ".bRRRg--bRRRg--bRRRg--RRRbR--bRRRg--bRRRg--bRRRg--RRRbR--bRRRg--RbRRR--RbRRR--bRRRb--RbRRR.",
  ".RRgRR..RRgRR..RRgRR..RgRgR..RRgRR..RRgRR..RRgRR..RgRgR..RRgRR..RgRRg..RgRRg..RRgRR..RgRRg.",
  ".#gRR#..#gRR#..#gRR#..#RgR#..#gRR#..#gRR#..#gRR#..#RgR#..#gRR#..#RRR#..#RRR#..#gRR#..#RRR#.",
  "...|......|......|......|......|.............|......|......|......|......|.............|...",
  "...|......|......|......|......|.............|......|......|......|......|.............|...", // 3
  ".gRR.....gRR...gRRRg..gRRg...gRR....#sRR#..sRRs...sRR....sRRRs..#sRR#..sRRRs..#sRR#..sRRRR.",
  ".g#RRR..RgRRR..RRRRg..R#RR...g#RRR..RsRRR..R#Rs...s#RRR..R#RRb..RsRRR..R#RRb..RsRRR..s#RRR.",
  ".gRRRg--gRRRg--RRRRg--gRRRg--gRRRg--bRRRg--RRRbR--bRRRg--RRRRg--RbRRR--RRRRb--RbRRR--RbRRR.",
  ".RRg#R..RRgRR..RRRgR...RR#g..RRg#R..RRgRR...Rg#R..RRg#R..RRR#g..RgRRg..RRR#g..RgRRg..RgR#R.",
  "...gRR...gRR...RgRRR...RgRR....gRR..#gRR#...gRgR....gRR..RRgRR..#RRR#..RRgRR..#RRR#..RgRRR.",
  "...|......|......|......|......|......|......|.............|......|......|......|......|...",
  "...|......|......|......|......|......|......|.............|......|......|......|......|...", // 4
  ".gRRg....gRR...gRRg....gRR...gRRg...#s$R#..sRR....#sRR#..sRR....#sRR#..#sRR#..#sRR#..#sRR#.",
  ".R#RR...RgRRR..R#RR...RgRRR..R#RR...sRRRs..s#RRR..RsRRR..s#RRR..RsRRR..RsRRR..RsRRR..RsRRR.",
  ".gRRRg--gRRRg--gRRRg--gRRRg--gRRRg--RRRbR--bRRRg--bRRRg--bRRRg--bRRRb--RbRRR--RbRRR--RbRRR.",
  "..RR#g..RRgRR...RR#g..RRgRR...RR#g..RgRgR..RRg#R..RRgRR..RRg#R..RRgRR..RgRRg..RgRRg..RgRRg.",
  "..RgRR...gRR....RgRR...gRR....RgRR..#RgR#....gRR..#gRR#....gRR..#gRR#..#RRR#..#RRR#..#RRR#.",
  "...|......|......|......|......|......|......|......|......|.............|......|......|...",
  "...|......|......|......|......|......|......|......|......|.............|......|......|...", // 5
  ".gRRRg...gRR...g$R....gRRRg..gRRRg..#sRR#..sRRRs..sRR....sRRs...#sRR#..sRRRR..#sRR#..sRRRR.",
  ".RRRRg..RgRRR..g#RRR..R#R#R..RRRRg..RsRRR..R#RRb..s#RRR..R#Rs...RsRRR..s#RRR..RsRRR..s#RRR.",
  ".RRRRg--gRRRg--gRRRg--gRRRg--RRRRg--bRRRg--RRRRg--bRRRg--RRRbR--RbRRR--RbRRR--RbRRR--RbRRR.",
  ".RRRgR..RRgRR..RRg#R..R#R#g..RRRgR..RRgRR..RRR#g..RRg#R...Rg#R..RgRRg..RgR#R..RgRRg..RgR#R.",
  ".RgRRR...gRR.....gRR..RRgRR..RgRRR..#gRR#..RRgRR....gRR...gRgR..#RRR#..RgRRR..#RRR#..RgRRR.",
  "...|......|......|......|......|.............|......|......|......|......|.............|...",
  "...|......|......|......|......|.............|......|......|......|......|.............|...", // 6
  "..gRR....gRR....gRR....gRR....gRR...#sRR#..#sRR#..#sRR#..#sRR#..#sRR#..#sRR#..#sRR#..#sRR#.",
  ".RgRRR..RgRRR..RgRRR..RgRRR..RgRRR..RsRRR..RsRRR..sRRRs..RsRRR..RsRRR..RsRRR..RsRRR..RsRRR.",
  ".gRRRg--gRRRg--gRRRg--gRRRg--gRRRg--bRRRg--bRRRg--RRRbR--bRRRg--RbRRR--RbRRR--RbRRR--RbRRR.",
  ".RRgRR..RRgRR..RRgRR..RRgRR..RRgRR..RRgRR..RRgRR..RgRgR..RRgRR..RgRRg..RgRRg..RgRRg..RgRRg.",
  "..gRR....gRR....gRR....gRR....gRR...#gRR#..#gRR#..#RgR#..#gRR#..#RRR#..#RRR#..#RRR#..#RRR#.",
  "...|......|......|......|......|......|......|.............|......|......|......|......|...",
  "...|......|......|......|......|......|......|.............|......|......|......|......|...", // 7
  ".RRRRR...gRR...gRRRg..gRRg...gRR....#sRR#..sRRs...sRR....sRRRs..#sRR#..sRRRR..#sRR#..sRRRs.",
  ".RRRRR..RgRRR..RRRRg..R#RR...g#RRR..RsRRR..R#Rs...s#RRR..R#RRb..RsRRR..s#RRR..RsRRR..R#RRb.",
  "-RRRRR--gRRRg--RRRRg--gRRRg--gRRRg--bRRRg--RRRbR--bRRRg--RRRRg--RbRRR--RbRRR--RbRRR--RRRRb.",
  ".RRRRR..RRgRR..RRRgR...RR#g..RRg#R..RRgRR...Rg#R..RRg#R..RRR#g..RgRRg..RgR#R..RgRRg..RRR#g.",
  ".RRRRR...gRR...RgRRR...RgRR....gRR..#gRR#...gRgR....gRR..RRgRR..#RRR#..RgRRR..#RRR#..RRgRR.",
  "...|......|......|......|......|......|......|......|......|.............|......|......|...",
  "...|......|......|......|......|......|......|......|......|.............|......|......|...", // 8
  ".gRRg....gRR...gRRg....gRR...gRRg...#sRR#..#sRR#..#sRR#..sRR....#sRR#..#sRR#..#sRR#..#sRR#.",
  ".R#RR...RgRRR..R#RR...RgRRR..R#RR...sRRRs..RsRRR..RsRRR..s#RRR..RsRRR..RsRRR..RsRRR..RsRRR.",
  ".gRRRg--gRRRg--gRRRg--gRRRg--gRRRg--RRRbR--bRRRg--bRRRg--bRRRg--RbRRR--RbRRR--bRRRb--RbRRR.",
  "..RR#g..RRgRR...RR#g..RRgRR...RR#g..RgRgR..RRgRR..RRgRR..RRg#R..RgRRg..RgRRg..RRgRR..RgRRg.",
  "..RgRR...gRR....RgRR...gRR....RgRR..#RgR#..#gRR#..#gRR#....gRR..#RRR#..#RRR#..#gRR#..#RRR#.",
  "...|......|......|......|......|.............|......|......|......|......|.............|...",
  "...|......|......|......|......|.............|......|......|......|......|.............|...", // 9
  ".gRRRg...gRR...gRR....gRRg...gRRRg..#sRR#..sRRRs..sRR....sRRs...#sRR#..sRRRs..#sRR#..sRRRR.",
  ".RRRRg..RgRRR..g#RRR..R#RR...RRRRg..RsRRR..R#RRb..s#RRR..R#Rs...RsRRR..R#RRb..RsRRR..s#RRR.",
  ".RRRRg--gRRRg--gRRRg--gRRRg--RRRRg--bRRRg--RRRRg--bRRRg--RRRbR--RbRRR--RRRRb--RbRRR--RbRRR.",
  ".RRRgR..RRgRR..RRg#R...RR#g..RRRgR..RRgRR..RRR#g..RRg#R...Rg#R..RgRRg..RRR#g..RgRRg..RgR#R.",
  ".RgRRR...gRR.....gRR...RgRR..RgRRR..#gRR#..RRgRR....gRR...gRgR..#RRR#..RRgRR..#RRR#..RgRRR.",
  "...|......|......|......|......|......|......|.............|......|......|......|......|...",
  "...|......|......|......|......|......|......|.............|......|......|......|......|...", // 10
  "..gRR....gRR....gRR....gRR....gRR...#sRR#..#s$R#..#sRR#..#sRR#..#sRR#..#sRR#..#sRR#..#sRR#.",
  ".RgRRR..RgRRR..RgRRR..RgRRR..RgRRR..RsRRR..RsRRR..sRRRs..RsRRR..RsRRR..RsRRR..RsRRR..RsRRR.",
  ".gRRRg--gRRRg--gRRRg--gRRRg--gRRRg--bRRRg--bRRRg--RRRbR--bRRRg--bRRRb--RbRRR--RbRRR--RbRRR.",
  ".RRgRR..RRgRR..RRgRR..RRgRR..RRgRR..RRgRR..RRgRR..RgRgR..RRgRR..RRgRR..RgRRg..RgRRg..RgRRg.",
  "..gRR....gRR....gRR....gRR....gRR...#gRR#..#gRR#..#RgR#..#gRR#..#gRR#..#RRR#..#RRR#..#RRR#.",
  "...|......|......|......|......|......|......|......|......|.............|......|......|...",
  "...|......|......|......|......|......|......|......|......|.............|......|......|...", // 11
  ".gRR.....gRR...gRRRg..gRRg...gRR....#sRR#..sRRs...sRR....sRRRs..#sRR#..sRRRR..#sRR#..sRRRR.",
  ".g#RRR..RgRRR..RRRRg..R#RR...g#RRR..RsRRR..R#Rs...s#RRR..R#RRb..RsRRR..s#RRR..RsRRR..s#RRR.",
  ".gRRRg--gRRRg--RRRRg--gRRRg--gRRRg--bRRRg--RRRbR--bRRRg--RRRRg--RbRRR--RbRRR--RbRRR--RbRRR.",
  ".RRg#R..RRgRR..RRRgR...RR#g..RRg#R..RRgRR...Rg#R..RRg#R..RRR#g..RgRRg..RgR#R..RgRRg..RgR#R.",
  "...gRR...gRR...RgRRR...RgRR....gRR..#gRR#...gRgR....gRR..RRgRR..#RRR#..RgRRR..#RRR#..RgRRR.",
  "...|......|......|......|......|.............|......|......|......|......|......|......|...",
  "...|......|......|......|......|.............|......|......|......|......|......|......|...", // 12
  ".sRR....#sRR#..sRR....#sRR#..sRR....#sRR#..sRR....#sRR#..sRR....#sRR#..#sRR#..#sRR#..#s$R#.",
  ".s#RRR..sRRRs..s#RRR..RsRRR..s#RRR..sRRRs..s#RRR..RsRRR..s#RRR..RsRRR..RsRRR..RsRRR..RsRRR.",
  ".bRRRg--RRRbR--bRRRg--bRRRg--bRRRg--RRRbR--bRRRg--bRRRg--bRRRg--RbRRR--RbRRR--RbRRR--RbRRR.",
  ".RRg#R..RgRgR..RRg#R..RRgRR..RRg#R..RgRgR..RRg#R..RRgRR..RRg#R..RgRRg..RgRRg..RgRRg..RgRRg.",
  "...gRR..#RgR#....gRR..#gRR#....gRR..#RgR#....gRR..#gRR#....gRR..#RRR#..#RRR#..#RRR#..#RRR#.",
  "...|.............|......|......|......|......|.............|......|......|......|......|...",
  "...|.............|......|......|......|......|.............|......|......|......|......|...", // 13
  ".sRRs...#sRR#..sRRRs..sRR....sRRs...#sRR#..sRRRs..sRR....sRRs...#sRR#..sRRRR..#sRR#..sRRRs.",
  ".R#Rs...RsRRR..R#RRb..s#RRR..R#Rs...RsRRR..R#RRb..s#RRR..R#Rs...RsRRR..s#RRR..RsRRR..R#RRb.",
  ".RRRbR--bRRRg--RRRRg--bRRRg--RRRbR--bRRRg--RRRRg--bRRRg--RRRbR--RbRRR--RbRRR--RbRRR--RRRRb.",
  "..Rg#R..RRgRR..RRR#g..RRg#R...Rg#R..RRgRR..RRR#g..RRg#R...Rg#R..RgRRg..RgR#R..RgRRg..RRR#g.",
  "..gRgR..#gRR#..RRgRR....gRR...gRgR..#gRR#..RRgRR....gRR...gRgR..#RRR#..RgRRR..#RRR#..RRgRR.",
  "................................................................................|..........",
];
