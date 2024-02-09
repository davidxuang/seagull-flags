import sys
from fontTools import ttLib

if __name__ == '__main__':
  font = ttLib.TTFont(sys.argv[1])
  if font['head'].unitsPerEm != 2048:
    raise font['head'].unitsPerEm

  for entry in font['name'].names:
    if entry.nameID == 6: # PostScript name
      entry.string = 'SeagullFlags'

  hhea = font['hhea']
  hhea.ascent = 1491
  hhea.descent = -431
  hhea.lineGap = 269
  hhea.xMaxExtent = 2812
  hhea.advanceWidthMax = 2812
  OS_2 = font['OS/2']
  OS_2.fsSelection = 0b000000_01000000
  OS_2.sTypoAscender = 1491
  OS_2.sTypoDescender = -431
  OS_2.sTypoLineGap = 269
  OS_2.sxHeight = 1024
  OS_2.sCapHeight = 1434
  OS_2.usWinAscent = 2210
  OS_2.usWinDescent = 514
  OS_2.xAvgCharWidth = 2812
  
  font.save(sys.argv[1])
