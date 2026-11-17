/**
 * World 3: Canopy Forest (13 x 13 sectors, 91 x 91 chars).
 * Sectors A..M (cols 0..12) x 1..13 (rows 0..12).
 * Arrival: A7 (west gate). Exit: L13 (south gate).
 * Landmarks: D5 Sunken Lake Bed, G8 Fallen Giant Tree, K10 Ruined Ranger Station.
 * Legend: . solid, R clearing, -|+ trails, # cover, s soldier, b brute, g grove, $ special.
 */
export const FOREST_BLUEPRINT: readonly string[] = [
  "...........................................................................................", // 1
  ".sRRs....sRR...sRRRs..sRR....sRRs....sRR...sRRRs..sRR....sRRs....sRR...sRRRR...sRR....sRR..",
  ".RRRsR..s#RR#..RRR#b..RsRRR..RRRsR..s#RR#..RRR#b..RsRRR..RRRsR..RsRRR..sRR#R..R#sR#..RsRRR.",
  ".RbRRR..bRRRg--RRRRg--bRRRg--RbRRR--bRRRg--RRRRg--bRRRg..RbRRR--bRRRb--RbRRR--RbRRR--bRRRb.",
  "..gRRg..#RR#g..R#RRg..RRgRR...gRRg..#RR#g..R#RRg..RRgRR...gRRg..RRgRR..R#gRR..#gR#R..RRgRR.",
  "..RgRR...RgR...RRgRR....gRR...RgRR...RgR...RRgRR....gRR...RgRR...gRR...RgRRR...gRR....gRR..",
  "..........|......|......|......|.............|......|......|......|.............|......|...",
  "..........|......|......|......|.............|......|......|......|.............|......|...", // 2
  "..sRR....sRR....sRR....sRR....sRR....sRR....sRR....sRR....sRR....sRR...sRRRR...sRR....sRR..",
  ".s#RR#..s#RR#..s#RR#..s#RR#..s#RR#..s#RR#..s#RR#..s#RR#..s#RR#..R#sR#..sRR#R..RsRRR..R#sR#.",
  ".bRRRg--bRRRg--bRRRg..sRRbR--bRRRg--bRRRg--bRRRg--sRRbR--bRRRg--RbRRR..RbRRR--bRRRb--RbRRR.",
  ".#RR#g..#RR#g..#RR#g..#gR#g..#RR#g..#RR#g..#RR#g..#gR#g..#RR#g..#gR#R..R#gRR..RRgRR..#gR#R.",
  "..RgR....RgR....RgR....RgR....RgR....RgR....RgR....RgR....RgR....gRR...RgRRR...gRR....gRR..",
  "...|......|......|.............|......|......|......|.............|......|......|......|...",
  "...|......|......|.............|......|......|......|.............|......|......|......|...", // 3
  ".gRR.....gRR...gRRRg..gRRR...gRR.....sRR...sRRs...sRR....sRRRs..sRRRR..sRRRs..sRRRR..sRRRR.",
  ".RgRRR..RgRRR..RRRRg..gRRRg..RgRRR..s#RR#..RRRsR..RsRRR..RRR#b..sRR#R..RRR#b..sRR#R..sRR#R.",
  ".gRRRg--gRRRg--RRRRg--RRRRg--gRRRg--bRRRg--RbRRR--bRRRg--RRRRg--RbRRR--RRRRb--RbRRR..RbRRR.",
  ".RRgRR..RRgRR..RRRgR...RRgR..RRgRR..#RR#g...gRRg..RRgRR..R#RRg..R#gRR..R#RRg..R#gRR..R#gRR.",
  "...gRR...gRR...RgRRR...RgRR....gRR...RgR....RgRR....gRR..RRgRR..RgRRR..RRgRR..RgRRR..RgRRR.",
  "...|......|......|......|......|......|.............|......|......|......|.............|...",
  "...|......|......|......|......|......|.............|......|......|......|.............|...", // 4
  ".gRRR....gRR...gRRR....gRR...gRRR....s$R...sRR.....sRR...sRR.....sRR...sRRRR...sRR....sRR..",
  ".gRRRg..RgRRR..gRRRg..RgRRR..gRRRg..s#RR#..RsRRR..s#RR#..RsRRR..RsRRR..sRR#R..R#sR#..RsRRR.",
  ".RRRRg--gRRRg--RRRRg--gRRRg--RRRRg--sRRbR--bRRRg..bRRRg--bRRRg--bRRRb--RbRRR--RbRRR--bRRRb.",
  "..RRgR..RRgRR...RRgR..RRgRR...RRgR..#gR#g..RRgRR..#RR#g..RRgRR..RRgRR..R#gRR..#gR#R..RRgRR.",
  "..RgRR...gRR....RgRR...gRR....RgRR...RgR.....gRR...RgR.....gRR...gRR...RgRRR...gRR....gRR..",
  "...|......|......|......|......|......|......|......|......|.............|......|......|...",
  "...|......|......|......|......|......|......|......|......|.............|......|......|...", // 5
  ".gRRRg...gRR...g$R...RgRRRgR.gRRRg...sRR...sRRRs..sRR....sRRs....sRR...sRRRR...sRR....sRR..",
  ".RRRRg..RgRRR..RgRRR.R#RRR#R.RRRRg..s#RR#..RRR#b..RsRRR..RRRsR..R#sR#..sRR#R..RsRRR..R#sR#.",
  ".RRRRg--gRRRg--gRRRg--gRRRg--RRRRg--bRRRg--RRRRg--bRRRg--RbRRR..RbRRR--RbRRR--bRRRb--RbRRR.",
  ".RRRgR..RRgRR..RRgRR.R#RRg#R.RRRgR..#RR#g..R#RRg..RRgRR...gRRg..#gR#R..R#gRR..RRgRR..#gR#R.",
  ".RgRRR...gRR.....gRR.RRRgRRR.RgRRR...RgR...RRgRR....gRR...RgRR...gRR...RgRRR...gRR....gRR..",
  "...|......|......|......|......|......|......|.............|......|......|......|..........",
  "...|......|......|......|......|......|......|.............|......|......|......|..........", // 6
  "..gRR....gRR....gRR....gRR....gRR....sRR....sRR....sRR....sRR...sRRRR..sRRRs..sRRRR..sRRRR.",
  ".RgRRR..RgRRR..RgRRR..RgRRR..RgRRR..s#RR#..s#RR#..s#RR#..s#RR#..sRR#R..RRR#b..sRR#R..sRR#R.",
  ".gRRRg--gRRRg--gRRRg--gRRRg--gRRRg--bRRRg--bRRRg--sRRbR--bRRRg--RbRRR--RRRRb..RbRRR--RbRRR.",
  ".RRgRR..RRgRR..RRgRR..RRgRR..RRgRR..#RR#g..#RR#g..#gR#g..#RR#g..R#gRR..R#RRg..R#gRR..R#gRR.",
  "..gRR....gRR....gRR....gRR....gRR....RgR....RgR....RgR....RgR...RgRRR..RRgRR..RgRRR..RgRRR.",
  "...|......|......|......|......|.............|......|......|......|.............|......|...",
  "...|......|......|......|......|.............|......|......|......|.............|......|...", // 7
  ".RRRRR...gRR...gRRRg..gRRR...gRR.....sRR...sRRs...sRR....sRRRs...sRR...sRRRR...sRR....sRR..",
  ".RRRRR..RgRRR..RRRRg..gRRRg..RgRRR..s#RR#..RRRsR..RsRRR..RRR#b..RsRRR..sRR#R..R#sR#..RsRRR.",
  "-RRRRR--gRRRg--RRRRg--RRRRg--gRRRg--bRRRg..RbRRR--bRRRg--RRRRg--bRRRb--RbRRR--RbRRR--bRRRb.",
  ".RRRRR..RRgRR..RRRgR...RRgR..RRgRR..#RR#g...gRRg..RRgRR..R#RRg..RRgRR..R#gRR..#gR#R..RRgRR.",
  ".RRRRR...gRR...RgRRR...RgRR....gRR...RgR....RgRR....gRR..RRgRR...gRR...RgRRR...gRR....gRR..",
  "...|......|......|......|......|......|......|......|.............|......|......|......|...",
  "...|......|......|......|......|......|......|......|.............|......|......|......|...", // 8
  ".gRRR....gRR...gRRR....gRR...gRRR....sRR...#sRR#...sRR...sRR.....sRR...sRRRR...sRR....sRR..",
  ".gRRRg..RgRRR..gRRRg..RgRRR..gRRRg..s#RR#.RRsRRRR.s#RR#..RsRRR..R#sR#..sRR#R..RsRRR..R#sR#.",
  ".RRRRg--gRRRg--RRRRg--gRRRg--RRRRg--sRRbR--bRRRg--bRRRg..bRRRg--RbRRR--RbRRR--bRRRb--RbRRR.",
  "..RRgR..RRgRR...RRgR..RRgRR...RRgR..#gR#g.RRRgRRR.#RR#g..RRgRR..#gR#R..R#gRR..RRgRR..#gR#R.",
  "..RgRR...gRR....RgRR...gRR....RgRR...RgR...#gRR#...RgR.....gRR...gRR...RgRRR...gRR....gRR..",
  "...|......|......|......|......|......|.............|......|......|......|.............|...",
  "...|......|......|......|......|......|.............|......|......|......|.............|...", // 9
  ".gRRRg...gRR...gRR....gRRR...gRRRg...sRR...sRRRs..sRR....sRRs...sRRRR..sRRRs..sRRRR..sRRRR.",
  ".RRRRg..RgRRR..RgRRR..gRRRg..RRRRg..s#RR#..RRR#b..RsRRR..RRRsR..sRR#R..RRR#b..sRR#R..sRR#R.",
  ".RRRRg--gRRRg--gRRRg--RRRRg--RRRRg--bRRRg--RRRRg--bRRRg--RbRRR--RbRRR..RRRRb--RbRRR--RbRRR.",
  ".RRRgR..RRgRR..RRgRR...RRgR..RRRgR..#RR#g..R#RRg..RRgRR...gRRg..R#gRR..R#RRg..R#gRR..R#gRR.",
  ".RgRRR...gRR.....gRR...RgRR..RgRRR...RgR...RRgRR....gRR...RgRR..RgRRR..RRgRR..RgRRR..RgRRR.",
  "...|......|......|......|......|......|......|......|......|.............|......|......|...",
  "...|......|......|......|......|......|......|......|......|.............|......|......|...", // 10
  "..gRR....gRR....gRR....gRR....gRR....sRR....s$R....sRR....sRR....sRR...#sRR#...sRR....sRR..",
  ".RgRRR..RgRRR..RgRRR..RgRRR..RgRRR..s#RR#..s#RR#..s#RR#..s#RR#..RsRRR..RsRRR..R#sR#..RsRRR.",
  ".gRRRg--gRRRg--gRRRg--gRRRg--gRRRg--bRRRg--bRRRg--sRRbR--bRRRg--bRRRb--RbRRR--RbRRR..bRRRb.",
  ".RRgRR..RRgRR..RRgRR..RRgRR..RRgRR..#RR#g..#RR#g..#gR#g..#RR#g..RRgRR..RgRRg..#gR#R..RRgRR.",
  "..gRR....gRR....gRR....gRR....gRR....RgR....RgR....RgR....RgR....gRR...#RRR#...gRR....gRR..",
  "...|......|......|......|......|......|......|.............|......|......|......|..........",
  "...|......|......|......|......|......|......|.............|......|......|......|..........", // 11
  ".gRR.....gRR...gRRRg..gRRR...gRR.....sRR...sRRs...sRR....sRRRs...sRR...sRRRR...sRR....sRR..",
  ".RgRRR..RgRRR..RRRRg..gRRRg..RgRRR..s#RR#..RRRsR..RsRRR..RRR#b..R#sR#..sRR#R..RsRRR..R#sR#.",
  ".gRRRg--gRRRg--RRRRg--RRRRg--gRRRg--bRRRg--RbRRR..bRRRg--RRRRg--RbRRR--RbRRR--bRRRb--RbRRR.",
  ".RRgRR..RRgRR..RRRgR...RRgR..RRgRR..#RR#g...gRRg..RRgRR..R#RRg..#gR#R..R#gRR..RRgRR..#gR#R.",
  "...gRR...gRR...RgRRR...RgRR....gRR...RgR....RgRR....gRR..RRgRR...gRR...RgRRR...gRR....gRR..",
  "...|......|......|......|......|.............|......|......|......|.............|......|...",
  "...|......|......|......|......|.............|......|......|......|.............|......|...", // 12
  ".sRR.....sRR...sRR.....sRR...sRR.....sRR...sRR.....sRR...sRR....sRRRR..sRRRs..sRRRR..s$RRR.",
  ".RsRRR..s#RR#..RsRRR..s#RR#..RsRRR..s#RR#..RsRRR..s#RR#..RsRRR..sRR#R..RRR#b..sRR#R..sRR#R.",
  ".bRRRg--sRRbR..bRRRg--bRRRg--bRRRg--sRRbR--bRRRg--bRRRg--bRRRg..RbRRR--RRRRb--RbRRR--RbRRR.",
  ".RRgRR..#gR#g..RRgRR..#RR#g..RRgRR..#gR#g..RRgRR..#RR#g..RRgRR..R#gRR..R#RRg..R#gRR..R#gRR.",
  "...gRR...RgR.....gRR...RgR.....gRR...RgR.....gRR...RgR.....gRR..RgRRR..RRgRR..RgRRR..RgRRR.",
  "...|......|......|.............|......|......|......|.............|......|......|......|...",
  "...|......|......|.............|......|......|......|.............|......|......|......|...", // 13
  ".sRRs....sRR...sRRRs..sRR....sRRs....sRR...sRRRs..sRR....sRRs....sRR...sRRRR...sRR....sRR..",
  ".RRRsR..s#RR#..RRR#b..RsRRR..RRRsR..s#RR#..RRR#b..RsRRR..RRRsR..RsRRR..sRR#R..R#sR#..RsRRR.",
  ".RbRRR--bRRRg--RRRRg--bRRRg..RbRRR--bRRRg--RRRRg--bRRRg--RbRRR--bRRRb--RbRRR--RbRRR--bRRRb.",
  "..gRRg..#RR#g..R#RRg..RRgRR...gRRg..#RR#g..R#RRg..RRgRR...gRRg..RRgRR..R#gRR..#gR#R..RRgRR.",
  "..RgRR...RgR...RRgRR....gRR...RgRR...RgR...RRgRR....gRR...RgRR...gRR...RgRRR...gRR....gRR..",
  "................................................................................|..........",
];
