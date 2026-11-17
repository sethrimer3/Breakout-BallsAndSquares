/**
 * World 3: Canopy Forest (13 x 13 sectors, 91 x 91 chars).
 * Sectors A..M (cols 0..12) x 1..13 (rows 0..12).
 * Arrival: A7 (west gate). Exit: L13 (south gate).
 * Landmarks: B4-C4 Sunlit Moss Amphitheatre, B9-C10 Whispering Creek Crossing,
 *   D5-E5 Sunken Lake Bed, D8-E8 Twin Ancient Oaks, G8-H8 Fallen Giant Tree,
 *   I3-J4 Blight-Cracked Ravine, K10-K11 Ruined Ranger Station.
 * Legend: . solid, R clearing, -|+ trails, # cover, s soldier, b brute, g grove, $ special.
 */
export const FOREST_BLUEPRINT: readonly string[] = [
  "...........................................................................................", // 1
  ".sRs....sRRs.....sRR...sRRs..sRs....sRRs.....sRR...sRRs..sRs....sRRR.....sRR...sRRs..sRR...",
  ".R#R.+--R#Rb-----s#R...RR#b--R#R.+--R#Rb-----s#R...RR#b--R#R.+--s#RR-----s#R...RR#R--s#R...",
  ".sRRbR..RRRg...RbRRR+---RRR..sRRbR..RRRg...RbRRR+---RRR..sRRbR..bRRR...RRRbR+--+RbR..RbRRb.",
  ".gRggR...RRg...gRg......gRg..gRggR...RRg...gRg......gRg..gRggR...gRR...RgR.....|RgR..RgRgR.",
  "..|......RgR...RgR......RgR...|......RgR...RgR......RgR...|......gRR...gRR.....|gRR...|....",
  "..|........|.....+............|......|.......|.......|....+..............|.....|......|....",
  "..+........|.....|............|......|.......+.......|....|..............|.....|......+....", // 2
  ".sRR......sRR....sRR..sRs....sRR.....|sRR....sRR..sRs|...sRR......sRR....sRR..sRR....sRR...",
  ".s#R......s#R....s#R..R#R....s#R.....|s#R....s#R..R#R|...s#R......s#R....s#R..s#R....s#R...",
  ".RbRRg..RbRRR--RbRRR..sRRbR-+RbRRg..RbRRR--RbRRR..sRRbR-+RbRRg..RRRbR--RRRbR..RbRRb-+RbRRR.",
  ".RgRgR--gRg....gRg----gRggR..RgRgR--gRg....gRg----gRggR..RgRgR--RgR....RgR----RgRgR..gRRgR.",
  "..|.....RgR....RgR.....|......|.....RgR....RgR......|.....|.....gRR....gRR............|....",
  "..++......|......|.....|......|.............++......|.....|......|.......|............+....",
  "...|......|......|.....|......++............|.......|.....|......|......++............|....", // 3
  "..gRRR..gRRR...gRRRg...|gRR...gRRR..sRRR...sRR....sRRs...sRRRRRRsRRR...sRR....sRRR...sRR...",
  "..gRRR..gRRg...RRgRR..RgRRR...gRRR.+R#sR...R#s..+-R#Rb...s#RRRRRs#RR...R#s..+-R#sR...s#R...",
  ".gRRRg+-RRRR---RgRRR-+gRRRg--gRRRg-+RRRRbRRRsRRR+.RRRg---RbRRgRRbRRR---RRRRR+.RRRR---RbRRR.",
  ".RRgRR..gRRg...gRgRR..RRgR...RRgRR...RRRgRRbRRgR...RRg...RgRgRRRRgRR...bRRRbRRbRRR...gRRgR.",
  ".gRR....RgRR.....|....RgRR...gRR.....RRgRRRgR......RgR....|...RRRgRR....|RgRRRgRRR....|....",
  "...|.....|.......|.......|....++.....RgRRRgRR.............|...RRRRRR....+RgRRgRRRR....|....",
  "...|.....|RRRRRRRR.......|....|.......|.....|.............+...RRRRRR....|.......|.....|....", // 4
  ".gRRR...RRgRRRRgRRRR....gRR..gRRR.....s$R..sRR......sRR..sRR..RRRRsRR..sRR......sRR..sRR...",
  ".gRRg---RRRgRRRRgRRR--RgRRR..gRRg-----s#R..s#R------R#sRsR#R--RRRRs#R..s#R------s#R..s#R...",
  ".RRRR...RRRRgRRgRRRR..gRRRg--RRRR...sRRRb--RbRRg..RRRbRRRbRRRgRRRbRRR--RbRRR..RRRbR--RbRRR.",
  ".gRRg...RRRRgRRRgRRR..RRgR...gRRg...RgR....RgRgR..gRRgRRRgRRgR..bRg....gRRgR..RgR....gRRgR.",
  ".RgRR...RRRgRRRgRRgR..RgRR...RgRR...ggR.....|.....gRR.|...|.....RgR.....|.....gRR.....|....",
  "..|.....RgRRRRRRR+......|.....|......|......|.........|...+.............|.......|.....|....",
  "..++.......|.....|......|.....|......|......++........|...|.............|.......|.....+....", // 5
  ".gRRRg..gRRR....g$RR..gRRRRggRRRRg..sRRs.....sRR...sRRs..sRs....sRRR....+sRR...sRRs..sRR...",
  ".RRgRR..gRRg....gRRR..RRRRRgRRRRgR..R#Rb.....s#R...RR#b..R#R...+s#RR.....s#R...RR#R..s#R...",
  ".RgRRR-+RRRR...gRRRg--RRRRRgRRRRgR--RRRg...RbRRR--+-RRR..sRRbR-+bRRR...RRRbR--+-RbR..RbRRR.",
  ".gRgRR..gRRg---RRgRR..RRRgRRRRgRRR...RRg---gRg......gRg--gRggR...gRR---RgR......RgR--gRRgR.",
  "...|....RgRR...gRR....RRgRRRgRRR.....RgR...RgR......RgR...|......gRR...gRR......gRR...|....",
  "...+......|......|.....|.......|.............+......|.....|......|.......|............+....",
  "...|......|......|.....|.......+.............|......|.....|......|.......+............|....", // 6
  "...gRR....gRR....gRR...|gRR....gRR....sRR....sRR..sRs....sRR.....|sRR....sRR..sRR....sRR...",
  ".RgRRR..RgRRR..RgRRR..RgRRR..RgRRR....s#R....s#R..R#R....s#R.....|s#R....s#R..s#R....s#R...",
  ".gRRRg--gRRRg-+gRRRg--gRRRg-+gRRRg--RbRRR-+RbRRR--sRRbR+-RbRRg--RRRbR-+RRRbR--RbRRR+-RbRRR.",
  ".RRgR...RRgR...RRgR...RRgR...RRgR...gRg....gRg....gRggR..RgRgR..RgR|...RgR....gRRgR..gRRgR.",
  ".RgRR...RgRR...RgRR...RgRR...RgRR...RgR....RgR............|.....gRR|...gRR......|.....|....",
  "...|.....|.......|.......|.....+......|......|............|........|....++......|.....|....",
  "...|.....|.......+.......|.....|......|......|............+........|....|.......|.....|....", // 7
  ".RRRRR..gRRR...gRRRR....gRR...gRRR..sRRs...sRs....sRRs...sRR....sRRR...sRR....sRRR...sRR...",
  ".RRRRR..gRRg---gRRRR..RgRRR---gRRR+-R#Rb---R#R.+--R#Rb---s#R.+--R#sRR--s#R.+--s#RR---s#R...",
  "-RRRRR--RRRR...gRRRR+-gRRRg..gRRRg+.RRRg...sRRbR..RRRg...RbRRg..RRRbR..RbRRR..bRRR...RbRRb.",
  ".RRRRR..gRRg...RgRRR..RRgR...RRgRR...RRg...gRggR...RRg...RgRgR...RRRg..gRRgR...gRR...RgRgR.",
  ".RRRRR..RgRR...gRRR...RgRR...gRR.....RgR....|......RgR....|......RRRR...|......gRR....|....",
  "...|.......|...gRRR.....|......|.....|......|........|....+......gRRR...|......|......|....",
  "..++.......|...gRRR.....|......|.....|......+........|....|......sRRR...|......|......+....", // 8
  ".gRRR.....gRR..gRRR...RRgRRRRgRRRR...|sRR..sRRRsRsRRRsR..sRR.....R#sR..sRR.....|sRR..sRR...",
  ".gRRg...RgRRR..RgRR...RgRRRRRgRRgR...|s#R..R#RbRRR#RRbR..s#R.....RRbR..s#R.....|s#R..s#R...",
  ".RRRR...gRRRg-+RgRR...gRRRgRRRRRRR..sRRRb-+RgRRRRRRgRRR-+RbRRg..RRRgR-+RbRRR..RbRRR-+RbRRR.",
  ".gRRg---RRgR...RgRR---RRgRRRRgRRgR--RgR....gRRgRRRgRRg...RgRgR--RRg....gRRgR--bRg....gRRgR.",
  ".RgRR...RgRR...RgRR...RgRRRRRRgRRR..ggR.....|.....RRR|....|.....RRR.....|.....RgR.....|....",
  "..++......|.....|......|......|.............++.......|....|......|......|.............+....",
  "...|......|.....|......|......++.............|.......|....|......|......++............|....", // 9
  ".gRRRg..gRRRRRRRgRRR...|gRR..gRRRg..sRRs.....sRR...sRRs..sRs....sRRR.....sRR...sRRs..sRR...",
  ".RRgRR..gRRgRRRRgRRR..RgRRR..RRgRR.+R#Rb.....s#R...RR#b..R#R..+-s#RR.....s#R...RR#R..s#R...",
  ".RgRRR+-RRRRRRRgRRRg-+gRRRg--RgRRR-+RRRg---RbRRR-+--RRR--sRRbR+.bRRR---RbRRR-+--RbR--RbRRR.",
  ".gRgRR..gRRgRRRRRgRR..RRgR...gRgRR...RRg...gRg......gRg..gRggR...gRR...bRg......RgR..gRRgR.",
  "...|....RgRR...gRRRR..RgRR.....|.....RgR...RgR......RgR...|......gRR...RgR......gRR...|....",
  "...|.....|.....RRRRR.....|.....+......|......|............|........|.....+......|.....|....",
  "...|.....|.....RRRRR.....|.....|......|......|............+........|.....|......|.....|....", // 10
  "...gRR...|gRR..RRgRR....gRR....gRR....sRR....s$R..sRs....sRR......sRR....sRR..sRR....sRR...",
  ".RgRRR--RgRRR..RgRRR--RgRRR..RgRRR----s#R....s#R--R#R....s#R------s#R..RRR#s--s#R....s#R...",
  ".gRRRg..gRRRg+-gRRRg..gRRRg+-gRRRg..RbRRR+-RbRRR..sRRbR--RbRRg..RbRRR+-RRRRR..RbRRR--RbRRR.",
  ".RRgR...RRgR...RRgRR..RRgR...RRgR...gRg....gRg....gRggR..RgRgR..bRg....bRRRR..gRRgR..gRRgR.",
  ".RgRR...RgRR...RgRR...RgRR...RgRR...RgR....RgR.......|....|.....RgR....gRRRR...|......|....",
  "...|.......|.....+......|......|.....|.......|.......|....+............gRRRR...|......|....",
  "...+.......|.....|......|......|.....|......++.......|....|............sRRRR...|......+....", // 11
  "..gRRR..gRRR...gRRRg....gRR...gRRR..sRRs...sRs....sRRs...sRR....sRRR...s#RRR..sRRR...sRR...",
  "..gRRR..gRRg...RRgRR..RgRRR..RgRRR..R#Rb...R#R...+R#Rb...R#s...+R#sR...RbRRR.+s#RR...s#R...",
  ".gRRRg-+RRRR...RgRRR--gRRRg..RgRRR--RRRg...sRRbR-+RRRg...RRRRRbRRRRR...RgRRR-+bRRR...RbRRR.",
  ".RRgRR..gRRg---gRgRR..RRgR---RgRRR...RRg---gRggR...RRg---RRRgRRbRRRR---RgRRR...gRR---gRRgR.",
  ".gRR....RgRR.....|....RgRR...gRRR....RgR....|......RgR....|RgRRgRRRg....|......gRR....|....",
  "..++......|......|.....|.....gRRR...........+.......|.....|gRRRRRRR.....|........|....+....",
  "..|.......|......|.....|.....sRRR...........|.......|.....|......|......+........|....|....", // 12
  ".sRR......sRR..sRR.....|sRR..s#RR.....sRR..sRR......sRR..sRR.....|sRR..sRR......sRR..s$R...",
  ".s#R......s#R..s#R.....|s#R..RbRR.....s#R..s#R......s#R..s#R.....|s#R..s#R......s#R..s#R...",
  ".RbRRg--sRRRb+-RbRRg--RbRRR+-gRRRg--sRRRb+-RbRRg--RbRRR+-RbRRg--RRRbR+-RbRRR--RRRbR+-RbRRR.",
  ".RgRgR..RgR....RgRgR..gRg.|..RRgRR..RgR....RgRgR..gRg....RgRgR..RgR|...gRRgR..RgR|...gRRgR.",
  "..|.....ggR.....|.....RgR.|...|.....ggR.....|.....RgR.....|.....gRR|....|.....gRR|....|....",
  "..|.............|.........|...+.......|.....|.............|........|....++.......|....|....",
  "..|.............++........|...|.......|.....|.............+........|.....|.......|....|....", // 13
  ".sRs....sRRs.....sRR...sRRs..sRs....sRRs....+sRR...sRRs..sRs....sRRR.....sRR...sRRs..sRR...",
  ".R#R.+--R#Rb-----s#R...RR#b--R#R.+--R#Rb-----s#R...RR#b--R#R.+--s#RR-----s#R...RR#R--s#R...",
  ".sRRbR..RRRg...RbRRR+---RRR..sRRbR..RRRg...RbRRR+---RRR..sRRbR..bRRR...RRRbR+---RbR..RbRRb.",
  ".gRggR...RRg...gRg......gRg..gRggR...RRg...gRg......gRg..gRggR...gRR...RgR......RgR..RgRgR.",
  ".........RgR...RgR......RgR..........RgR...RgR......RgR..........gRR...gRR......gRR........",
  "................................................................................|..........",
];
