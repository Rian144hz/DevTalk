"""Outline text in Public Sans (variable woff2) as SVG path data, with the font's own GPOS kerning."""
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen

WOFF = '/home/rian144hz/DevTalk/node_modules/@fontsource-variable/public-sans/files/public-sans-latin-wght-normal.woff2'
_cache = {}


def _font(weight):
    if weight not in _cache:
        f = TTFont(WOFF)
        _cache[weight] = instancer.instantiateVariableFont(f, {'wght': weight})
    return _cache[weight]


def _pair_kern(font, left, right):
    """Horizontal advance adjustment for a glyph pair from GPOS PairPos lookups (format 1 and 2)."""
    if 'GPOS' not in font:
        return 0
    gpos = font['GPOS'].table
    total = 0
    for lookup in gpos.LookupList.Lookup:
        subs = lookup.SubTable
        for st in subs:
            if lookup.LookupType == 9:  # extension
                st = st.ExtSubTable
            if getattr(st, 'LookupType', lookup.LookupType) != 2 and lookup.LookupType not in (2, 9):
                continue
            if not hasattr(st, 'Format') or not hasattr(st, 'Coverage'):
                continue
            if left not in st.Coverage.glyphs:
                continue
            if st.Format == 1:
                idx = st.Coverage.glyphs.index(left)
                for rec in st.PairSet[idx].PairValueRecord:
                    if rec.SecondGlyph == right and rec.Value1 is not None:
                        return getattr(rec.Value1, 'XAdvance', 0) or 0
            elif st.Format == 2:
                c1 = st.ClassDef1.classDefs.get(left, 0)
                c2 = st.ClassDef2.classDefs.get(right, 0)
                rec = st.Class1Record[c1].Class2Record[c2]
                if rec.Value1 is not None:
                    v = getattr(rec.Value1, 'XAdvance', 0) or 0
                    if v:
                        return v
    return total


def outline(text, weight=700, cap_height=None, size=None, x=0.0, baseline=0.0, tracking=0, extra=None):
    """Return (path_d, width, info). Scale by `size` (font units per em → size) or by `cap_height`.
    `extra` adds per-pair spacing in font units, e.g. {('v','T'): 40}."""
    font = _font(weight)
    upm = font['head'].unitsPerEm
    cmap = font.getBestCmap()
    gs = font.getGlyphSet()
    hmtx = font['hmtx']
    capH = getattr(font['OS/2'], 'sCapHeight', 0) or 700
    if size is None:
        size = (cap_height / capH) * upm if cap_height else upm
    s = size / upm
    pen_x = 0.0
    parts = []
    positions = []
    names = [cmap[ord(ch)] for ch in text]
    for i, (ch, g) in enumerate(zip(text, names)):
        pen = SVGPathPen(gs)
        tp = TransformPen(pen, (s, 0, 0, -s, x + pen_x * s, baseline))
        gs[g].draw(tp)
        parts.append(pen.getCommands())
        positions.append(x + pen_x * s)
        adv = hmtx[g][0]
        if i + 1 < len(names):
            adv += _pair_kern(font, g, names[i + 1]) + tracking
            if extra:
                adv += extra.get((ch, text[i + 1]), 0)
        pen_x += adv
    width = pen_x * s
    return ' '.join(parts), width, {'scale': s, 'cap': capH * s, 'positions': positions, 'upm': upm,
                                     'xheight': getattr(font['OS/2'], 'sxHeight', 0) * s}


def bounds(text, weight=700, size=1000):
    font = _font(weight)
    gs = font.getGlyphSet()
    cmap = font.getBestCmap()
    bp = BoundsPen(gs)
    gs[cmap[ord(text)]].draw(bp)
    return bp.bounds


if __name__ == '__main__':
    d, w, info = outline('DevTalk', 700, cap_height=100)
    print(round(w, 1), info['cap'], info['xheight'])
    font = _font(700)
    cmap = font.getBestCmap()
    for a, b in ['De', 'ev', 'vT', 'Ta', 'al', 'lk']:
        print(a + b, _pair_kern(font, cmap[ord(a)], cmap[ord(b)]))
