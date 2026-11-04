"""Build the three DevTalk logo concepts (black first) into docs/design/logo/concepts/."""
import math, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from textpath import outline

OUT = '/home/rian144hz/DevTalk/docs/design/logo/concepts'
V = sys.argv[1] if len(sys.argv) > 1 else 'v1'
INK = '#000'


def f(x):
    return f'{x:.1f}'.rstrip('0').rstrip('.')


def poly(pts):
    return 'M' + ' L'.join(f'{f(x)} {f(y)}' for x, y in pts) + ' Z'


def circle_d(cx, cy, r, ccw=False):
    s = 0 if ccw else 1
    return (f'M{f(cx - r)} {f(cy)} A{f(r)} {f(r)} 0 1 {s} {f(cx + r)} {f(cy)} '
            f'A{f(r)} {f(r)} 0 1 {s} {f(cx - r)} {f(cy)} Z')


def svg(view_w, body, title, view_h=256):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {view_w} {view_h}" width="{view_w}" '
            f'height="{view_h}" role="img" aria-labelledby="title">\n  <title id="title">{title}</title>\n'
            f'{body}\n</svg>\n')


def write(name, content):
    with open(os.path.join(OUT, name), 'w') as fh:
        fh.write(content)


# ---------- A: Pencil duck — a rubber duck whose beak is a sharpened pencil ----------
def duck_paths(dx=0.0, dy=0.0, s=1.0):
    T = lambda x, y: (dx + x * s, dy + y * s)
    def P(x, y):
        X, Y = T(x, y)
        return f'{f(X)} {f(Y)}'
    # hull: short upturned tail at the back (left), concave back line under the head, full chest, flat-ish bottom
    body = (f'M{P(30, 108)} '
            f'C{P(52, 128)} {P(82, 140)} {P(118, 142)} '         # concave back, from tail to under the head
            f'L{P(176, 142)} '
            f'C{P(212, 144)} {P(232, 164)} {P(232, 186)} '       # chest
            f'C{P(232, 210)} {P(208, 226)} {P(170, 226)} '       # front bottom
            f'L{P(90, 226)} '
            f'C{P(50, 226)} {P(28, 206)} {P(26, 176)} '          # back bottom
            f'C{P(25, 150)} {P(24, 126)} {P(30, 108)} Z')
    hx, hy = T(146, 92)
    head = circle_d(hx, hy, 54 * s) + ' ' + circle_d(*T(160, 80), 9.5 * s, ccw=True)
    # pencil beak: a broad wood cone and a separate graphite tip, set low on the head like a duck's bill
    cy_b = 104
    base_x, half, tip_x = 186, 26, 250
    lead_len, gap = 18, 6
    k = half / (tip_x - base_x)
    cut = tip_x - lead_len - gap
    cone = poly([T(base_x, cy_b - half), T(cut, cy_b - (tip_x - cut) * k), T(cut, cy_b + (tip_x - cut) * k), T(base_x, cy_b + half)])
    lead = poly([T(cut + gap, cy_b - (tip_x - cut - gap) * k), T(tip_x, cy_b), T(cut + gap, cy_b + (tip_x - cut - gap) * k)])
    return [body, head, cone, lead]


def a_symbol():
    return svg(256, a_sym_at(0, 0, 1), 'DevTalk — pencil duck')


# ---------- B: Drawn bubble — a speech bubble whose tail is the pencil that drew it ----------
def bubble_paths(dx=0.0, dy=0.0, s=1.0):
    T = lambda x, y: (dx + x * s, dy + y * s)
    def P(x, y):
        X, Y = T(x, y)
        return f'{f(X)} {f(Y)}'
    sw = 20 * s
    x0, y0, x1, y1, r = 34, 26, 230, 158, 48
    gx0, gx1 = 66, 122          # the line leaves a gap on the bottom edge; the pencil starts at its right end
    R = f'{f(r * s)} {f(r * s)}'
    ring = (f'M{P(gx0, y1)} L{P(x0 + r, y1)} A{R} 0 0 1 {P(x0, y1 - r)} L{P(x0, y0 + r)} '
            f'A{R} 0 0 1 {P(x0 + r, y0)} L{P(x1 - r, y0)} A{R} 0 0 1 {P(x1, y0 + r)} L{P(x1, y1 - r)} '
            f'A{R} 0 0 1 {P(x1 - r, y1)} L{P(gx1, y1)}')
    ang = math.radians(135)     # tail direction: down-left
    u = (math.cos(ang), math.sin(ang))
    n = (-u[1], u[0])
    half = 15
    start = (gx1 - 12, y1 + 6)       # small gap after the line's end: the pencil is its own object
    def at(t, w=0.0):
        return T(start[0] + u[0] * t + n[0] * w, start[1] + u[1] * t + n[1] * w)
    body_len, cone_len, lead_len, gap = 34, 36, 14, 6
    pbody = poly([at(0, -half), at(body_len, -half), at(body_len, half), at(0, half)])
    k = half / cone_len
    cut = cone_len - lead_len - gap
    cone = poly([at(body_len, -half), at(body_len + cut, -(cone_len - cut) * k),
                 at(body_len + cut, (cone_len - cut) * k), at(body_len, half)])
    lead = poly([at(body_len + cut + gap, -(cone_len - cut - gap) * k), at(body_len + cone_len, 0),
                 at(body_len + cut + gap, (cone_len - cut - gap) * k)])
    return ring, sw, [pbody, cone, lead]


def b_symbol():
    return svg(256, b_sym_at(0, 0, 1), 'DevTalk — drawn bubble')


# ---------- C: Dev‸Talk — the proofreader's insertion caret joins Dev and Talk ----------
def caret_path(cx, base_y, half_w, depth, sw):
    """An upward chevron (insertion caret) as a filled outline: apex at (cx, base_y), legs down to base_y+depth.
    `sw` is the stroke thickness measured across each leg."""
    t = sw / math.cos(math.atan2(depth, half_w))     # vertical thickness that gives the leg width sw
    inner = half_w - t * half_w / depth
    return poly([(cx - half_w, base_y + depth), (cx, base_y), (cx + half_w, base_y + depth),
                 (cx + inner, base_y + depth), (cx, base_y + t), (cx - inner, base_y + depth)])


def c_symbol():
    d, w, info = outline('D', 800, cap_height=146, x=0, baseline=0)
    dx = 128 - w / 2 + 6
    d, w, info = outline('D', 800, cap_height=146, x=dx, baseline=170)
    car = caret_path(128 - 2, 176, 40, 50, 22)
    body = f'  <path fill="{INK}" d="{d}"/>\n  <path fill="{INK}" d="{car}"/>'
    return svg(256, body, 'DevTalk — D with an insertion caret')


def wordmark(x, baseline, cap, weight=700, caret=False):
    extra = {('v', 'T'): 70} if caret else None
    d, w, info = outline('DevTalk', weight, cap_height=cap, x=x, baseline=baseline, extra=extra)
    extra_path = ''
    if caret:
        # caret centred in the widened v–T gap, apex just under the baseline
        vx = info['positions'][2]; tx = info['positions'][3]
        s = info['scale']
        gap_mid = tx - 70 * s / 2 + 2
        extra_path = caret_path(gap_mid, baseline - cap * 0.02, cap * 0.30, cap * 0.40, cap * 0.15)
    return d, w, extra_path


def lockup(sym_paths, name, title, caret=False):
    cap = 76
    sym_h = 176
    sx = 24
    s = sym_h / 256
    gapx = 36
    base = 128 + cap / 2
    wx = sx + 256 * s + gapx
    d, w, extra = wordmark(wx, base, cap, caret=caret)
    width = int(wx + w + 28)
    body = sym_paths(sx, (256 - sym_h) / 2, s)
    body += f'\n  <path fill="{INK}" d="{d}"/>'
    if extra:
        body += f'\n  <path fill="{INK}" d="{extra}"/>'
    write(name, svg(width, body, title))


def a_sym_at(dx, dy, s):
    b, h, c, l = duck_paths(dx, dy, s)
    return (f'  <path fill="{INK}" d="{b}"/>\n  <path fill="{INK}" fill-rule="evenodd" d="{h}"/>\n'
            f'  <path fill="{INK}" d="{c}"/>\n  <path fill="{INK}" d="{l}"/>')


def b_sym_at(dx, dy, s):
    ring, sw, parts = bubble_paths(dx, dy, s)
    return (f'  <path fill="none" stroke="{INK}" stroke-width="{f(sw)}" stroke-linecap="round" stroke-linejoin="round" d="{ring}"/>\n'
            + '\n'.join(f'  <path fill="{INK}" d="{p}"/>' for p in parts))


def c_wordmark_only(name):
    cap = 96
    base = 128 + cap / 2 - 6
    d, w, extra = wordmark(28, base, cap, caret=True)
    width = int(28 + w + 28)
    write(name, svg(width, f'  <path fill="{INK}" d="{d}"/>\n  <path fill="{INK}" d="{extra}"/>', 'DevTalk wordmark with caret'))


if __name__ == '__main__':
    write(f'a-symbol-{V}.svg', a_symbol())
    write(f'b-symbol-{V}.svg', b_symbol())
    write(f'c-symbol-{V}.svg', c_symbol())
    lockup(a_sym_at, f'a-lockup-{V}.svg', 'DevTalk — pencil duck lockup')
    lockup(b_sym_at, f'b-lockup-{V}.svg', 'DevTalk — drawn bubble lockup')
    c_wordmark_only(f'c-lockup-{V}.svg')
    print('ok', V)


# ---------- C (v4): Pencil D — a D whose stem is the coach's pencil; in the wordmark the l of Talk is the pencil ----------
def pencil_vertical(x0, x1, top, bottom, tip, gap=5, lead=16, collar=4):
    """A vertical pencil pointing down: body from top to bottom, a wood cone to `tip`, the lead split off by `gap`."""
    cx = (x0 + x1) / 2
    half = (x1 - x0) / 2
    cone_top = bottom + collar
    k = half / (tip - cone_top)
    cut = tip - lead - gap
    body = poly([(x0, top), (x1, top), (x1, bottom), (x0, bottom)])
    cone = poly([(x0, cone_top), (x1, cone_top), (cx + (tip - cut) * k, cut), (cx - (tip - cut) * k, cut)])
    ld = poly([(cx - (tip - cut - gap) * k, cut + gap), (cx + (tip - cut - gap) * k, cut + gap), (cx, tip)])
    return [body, cone, ld]


def pencil_d_paths(dx=0.0, dy=0.0, s=1.0):
    T = lambda x, y: (dx + x * s, dy + y * s)
    def P(x, y):
        X, Y = T(x, y)
        return f'{f(X)} {f(Y)}'
    sx0, sx1, top, base = 60, 96, 26, 160         # stem = pencil body
    ro, ri = 67, 35                                # bowl outer / inner radius
    jx = 127                                       # where the straight part of the bowl turns into the arc
    ov = sx1 - 3
    bowl = (f'M{P(ov, top)} L{P(jx, top)} A{f(ro * s)} {f(ro * s)} 0 0 1 {P(jx, base)} L{P(ov, base)} '
            f'L{P(ov, base - 32)} L{P(jx, base - 32)} A{f(ri * s)} {f(ri * s)} 0 0 0 {P(jx, top + 32)} '
            f'L{P(ov, top + 32)} Z')
    pb, cone, ld = pencil_vertical(sx0, sx1, top, base, base + 4 + 18 / math.tan(math.radians(30)), lead=11, gap=4)
    def tr(d):   # transform a poly path built in symbol units
        out = []
        for tok in d.replace('M', ' M ').replace('L', ' L ').replace('Z', ' Z ').split():
            out.append(tok)
        # rebuild with transform
        nums = []
        res = []
        i = 0
        while i < len(out):
            t = out[i]
            if t in ('M', 'L', 'Z'):
                res.append(t); i += 1; continue
            x, y = float(out[i]), float(out[i + 1]); X, Y = T(x, y)
            res.append(f'{f(X)} {f(Y)}'); i += 2
        return ' '.join(res)
    return [bowl, tr(pb), tr(cone), tr(ld)]


def c4_symbol():
    body = '\n'.join(f'  <path fill="{INK}" d="{p}"/>' for p in pencil_d_paths())
    return svg(256, body, 'DevTalk — pencil D')


def c4_wordmark(x, baseline, cap, weight=700):
    from textpath import bounds
    d_full, w, info = outline('DevTalk', weight, cap_height=cap, x=x, baseline=baseline)
    s = info['scale']
    pos = info['positions']
    d1, _, _ = outline('DevTa', weight, cap_height=cap, x=x, baseline=baseline)
    d3, _, _ = outline('k', weight, cap_height=cap, x=pos[6], baseline=baseline)
    lx0, ly0, lx1, ly1 = bounds('l', weight)
    px0, px1 = pos[5] + lx0 * s, pos[5] + lx1 * s
    grow = (px1 - px0) * 0.12
    px0, px1 = px0 - grow, px1 + grow
    top = baseline - ly1 * s
    parts = pencil_vertical(px0, px1, top, baseline - cap * 0.12, baseline + cap * 0.20, gap=cap * 0.045,
                            lead=cap * 0.10, collar=cap * 0.045)
    return [d1, d3] + parts, w


def c4_lockup(name):
    cap = 76; sym_h = 176; sx = 24; s = sym_h / 256; gapx = 30
    base = 128 + cap / 2
    wx = sx + 256 * s + gapx
    paths, w = c4_wordmark(wx, base, cap)
    body = '\n'.join(f'  <path fill="{INK}" d="{p}"/>' for p in pencil_d_paths(sx, (256 - sym_h) / 2, s))
    body += '\n' + '\n'.join(f'  <path fill="{INK}" d="{p}"/>' for p in paths)
    write(name, svg(int(wx + w + 28), body, 'DevTalk — pencil D lockup'))


if __name__ == '__main__' and V.startswith('c4'):
    write(f'c-symbol-{V[3:]}.svg', c4_symbol())
    c4_lockup(f'c-lockup-{V[3:]}.svg')
    print('c4 ok')
