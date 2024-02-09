import fontforge
import sys

fontfile = sys.argv[1]

f = fontforge.open(fontfile)

for glyph in f.glyphs():
    margin = (2812 - 2048) / 2
    if glyph.width == 2048:
        glyph.left_side_bearing = int(glyph.left_side_bearing + margin)
        glyph.width = 2812
        glyph.correctDirection()

f.generate(fontfile)
