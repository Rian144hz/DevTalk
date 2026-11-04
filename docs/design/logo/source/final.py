"""DevTalk logo kit — refined masters for the chosen direction (A · Pencil duck)."""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from textpath import outline

KIT = '/home/rian144hz/DevTalk/docs/design/logo/kit'
os.makedirs(KIT, exist_ok=True)

# Palette (shared with the app's tokens)
DUCK = '#2F7DE1'    # duck blue — the mark on light grounds (4.1:1 on white)
SKY = '#8EC5FF'     # sky — the mark on dark grounds (app --accent)
NAVY = '#0B2A4F'    # navy ink — wordmark, pencil lead, one-colour
BEAK = '#FFA23F'    # beak / pencil wood
LIGHT = '#E6EEF9'   # light ink — wordmark and lead on dark grounds

DX, DY = -9.0, -6.0  # optical centring of the symbol on its 256 canvas


def f(x):
    s = f'{x:.2f}'.rstrip('0').rstrip('.')
    return s if s != '-0' else '0'


def T(x, y, ox=0.0, oy=0.0, s=1.0):
    return (ox + (x + DX) * s, oy + (y + DY) * s)


def poly(pts):
    return 'M' + ' L'.join(f'{f(x)} {f(y)}' for x, y in pts) + ' Z'


def circle(cx, cy, r, ccw=False):
    sw = 0 if ccw else 1
    return (f'M{f(cx - r)} {f(cy)} A{f(r)} {f(r)} 0 1 {sw} {f(cx + r)} {f(cy)} '
            f'A{f(r)} {f(r)} 0 1 {sw} {f(cx - r)} {f(cy)} Z')


def duck(ox=0.0, oy=0.0, s=1.0, small=False, reversed_=False):
    """Return dict of path data: body (hull + head with the eye cut out), wood (cone), lead."""
    P = lambda x, y: '{} {}'.format(*map(f, T(x, y, ox, oy, s)))
    # Hull: short upturned tail at the back; the back line runs into the head (no sliver at the neck);
    # the top line ends inside the head so the throat is a single clean concave corner.
    hull = (f'M{P(30, 108)} C{P(52, 128)} {P(86, 136)} {P(122, 134)} L{P(170, 134)} '
            f'C{P(214, 136)} {P(234, 162)} {P(234, 186)} C{P(234, 210)} {P(208, 226)} {P(170, 226)} '
            f'L{P(90, 226)} C{P(50, 226)} {P(28, 206)} {P(26, 176)} C{P(25, 150)} {P(24, 126)} {P(30, 108)} Z')
    hx, hy = T(146, 92, ox, oy, s)
    er = (12 if small else (10 if reversed_ else 9.5)) * s
    ex, ey = T(158 if small else 160, 80, ox, oy, s)
    head = circle(hx, hy, 54 * s) + ' ' + circle(ex, ey, er, ccw=True)
    # Bill = a sharpened pencil: wood cone + graphite lead split off by a small gap.
    cy, base, half, tip = 104, 186, 26, 250
    k = half / (tip - base)
    if small:
        wood = poly([T(base, cy - half, ox, oy, s), T(tip, cy, ox, oy, s), T(base, cy + half, ox, oy, s)])
        lead = ''
    else:
        lead_len, gap = 18, (7 if reversed_ else 6)
        cut = tip - lead_len - gap
        wood = poly([T(base, cy - half, ox, oy, s), T(cut, cy - (tip - cut) * k, ox, oy, s),
                     T(cut, cy + (tip - cut) * k, ox, oy, s), T(base, cy + half, ox, oy, s)])
        lead = poly([T(cut + gap, cy - (tip - cut - gap) * k, ox, oy, s), T(tip, cy, ox, oy, s),
                     T(cut + gap, cy + (tip - cut - gap) * k, ox, oy, s)])
    return {'hull': hull, 'head': head, 'wood': wood, 'lead': lead}


def duck_svg_body(d, body, wood, lead, indent='  '):
    """Bill first, then the hull and head on top, so the bill grows out of the head's curve."""
    out = [f'{indent}<g id="symbol">']
    out.append(f'{indent}  <path id="bill" fill="{wood}" d="{d["wood"]}"/>')
    if d['lead']:
        out.append(f'{indent}  <path id="lead" fill="{lead}" d="{d["lead"]}"/>')
    out.append(f'{indent}  <path id="hull" fill="{body}" d="{d["hull"]}"/>')
    out.append(f'{indent}  <path id="head" fill="{body}" fill-rule="evenodd" d="{d["head"]}"/>')
    out.append(f'{indent}</g>')
    return '\n'.join(out)


def svg(w, h, title, body, bg=None):
    rect = f'  <rect width="{w}" height="{h}" fill="{bg}"/>\n' if bg else ''
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" role="img" '
            f'aria-labelledby="title">\n  <title id="title">{title}</title>\n{rect}{body}\n</svg>\n')


def write(name, content):
    with open(os.path.join(KIT, name), 'w') as fh:
        fh.write(content)


def symbol_file(name, body, wood, lead, small=False, reversed_=False, title='DevTalk symbol'):
    d = duck(small=small, reversed_=reversed_)
    write(name, svg(256, 256, title, duck_svg_body(d, body, wood, lead)))


def wordmark_paths(x, baseline, cap):
    d, w, info = outline('DevTalk', 700, cap_height=cap, x=x, baseline=baseline)
    return d, w


def horizontal(name, body, wood, lead, ink, title):
    H = 256
    sym = 176
    s = sym / 256
    ox = 20
    oy = (H - sym) / 2
    cap = 74
    gap = 34
    # symbol content spans x 15..241 on its own canvas → right edge at ox + 241*s
    wx = ox + 241 * s + gap
    base = H / 2 + cap / 2 + 4
    d_w, w = wordmark_paths(wx, base, cap)
    W = int(round(wx + w + 24))
    body_xml = duck_svg_body(duck(ox, oy, s), body, wood, lead)
    body_xml += f'\n  <path id="wordmark" fill="{ink}" d="{d_w}"/>'
    write(name, svg(W, H, title, body_xml))


def stacked(name, body, wood, lead, ink, title):
    cap = 64
    sym = 200
    s = sym / 256
    _, w = wordmark_paths(0, 0, cap)
    W = int(round(max(w, sym) + 64))
    oy = 24
    ox = (W - sym) / 2
    base = oy + 226 * s + 30 + cap
    d_w, _ = wordmark_paths((W - w) / 2, base, cap)
    H = int(round(base + 32))
    body_xml = duck_svg_body(duck(ox, oy, s), body, wood, lead)
    body_xml += f'\n  <path id="wordmark" fill="{ink}" d="{d_w}"/>'
    write(name, svg(W, H, title, body_xml))


def wordmark_file(name, ink, title):
    cap = 96
    d_w, w = wordmark_paths(24, 128 + cap / 2, cap)
    write(name, svg(int(round(w + 48)), 256, title, f'  <path id="wordmark" fill="{ink}" d="{d_w}"/>'))


if __name__ == '__main__':
    # symbol
    symbol_file('devtalk-symbol.svg', DUCK, BEAK, NAVY, title='DevTalk')
    symbol_file('devtalk-symbol-on-dark.svg', SKY, BEAK, LIGHT, reversed_=True, title='DevTalk (on dark)')
    symbol_file('devtalk-symbol-small.svg', DUCK, BEAK, NAVY, small=True, title='DevTalk (small sizes)')
    symbol_file('devtalk-symbol-small-on-dark.svg', SKY, BEAK, LIGHT, small=True, reversed_=True,
                title='DevTalk (small sizes, on dark)')
    symbol_file('devtalk-symbol-navy.svg', NAVY, NAVY, NAVY, title='DevTalk (one colour)')
    symbol_file('devtalk-symbol-white.svg', '#FFFFFF', '#FFFFFF', '#FFFFFF', reversed_=True, title='DevTalk (white)')
    # lockups
    horizontal('devtalk-horizontal.svg', DUCK, BEAK, NAVY, NAVY, 'DevTalk')
    horizontal('devtalk-horizontal-on-dark.svg', SKY, BEAK, LIGHT, LIGHT, 'DevTalk (on dark)')
    horizontal('devtalk-horizontal-navy.svg', NAVY, NAVY, NAVY, NAVY, 'DevTalk (one colour)')
    stacked('devtalk-stacked.svg', DUCK, BEAK, NAVY, NAVY, 'DevTalk')
    stacked('devtalk-stacked-on-dark.svg', SKY, BEAK, LIGHT, LIGHT, 'DevTalk (on dark)')
    wordmark_file('devtalk-wordmark.svg', NAVY, 'DevTalk wordmark')
    print('kit masters written')


def app_icon(name, maskable=False):
    """Navy tile with the sky duck (full detail). Maskable: full-bleed, duck inside the 80 % safe zone."""
    scale = 0.66 if maskable else 0.76
    sym = 256 * scale
    ox = (256 - sym) / 2 + 2 * scale          # the duck's mass sits a touch right of its box (bill is thin)
    oy = (256 - sym) / 2 + 2
    bg = f'  <rect width="256" height="256" fill="{NAVY}"/>\n' if maskable else \
         f'  <rect width="256" height="256" rx="56" fill="{NAVY}"/>\n'
    body = bg + duck_svg_body(duck(ox, oy, scale, reversed_=True), SKY, BEAK, LIGHT)
    write(name, svg(256, 256, 'DevTalk app icon', body))


if __name__ == '__main__':
    app_icon('devtalk-app-icon.svg')
    app_icon('devtalk-app-icon-maskable.svg', maskable=True)
    print('app icons written')
