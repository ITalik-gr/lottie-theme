#!/usr/bin/env python3
"""Lottie colour inspector / recolourer.

  report <files...>                 unique colours + counts
  list   <file>                     every colour slot in z-order, with index
  map    <in> <out> OLD=NEW ...     recolour by hex (all occurrences)
  set    <in> <out> IDX=NEW ...     recolour single slots by index from `list`
(map and set can be combined: `set` args are applied after `map` args.)
"""
import json, sys, collections

def hx(c):
    return '#%02X%02X%02X' % tuple(round(max(0, min(1, x if x <= 1 else x/255))*255) for x in c[:3])

def rgb(h):
    h = h.lstrip('#')
    return [int(h[i:i+2], 16)/255 for i in (0, 2, 4)]

def slots(doc):
    """Ordered list of (hex, setter, desc) in layer z-order (top layer first)."""
    out = []
    assets = {a.get('id'): a for a in doc.get('assets', []) if 'layers' in a}

    def color(arr, i, desc):
        def s(c):
            arr[i], arr[i+1], arr[i+2] = c
        out.append((hx(arr[i:i+3]), s, desc))

    def shapes(sh, ctx):
        for s in sh:
            ty = s.get('ty')
            nm = ctx + '/' + str(s.get('nm'))
            if ty == 'gr':
                shapes(s.get('it', []), nm)
            elif ty in ('fl', 'st'):
                k = s.get('c', {}).get('k')
                o = s.get('o', {}).get('k')
                if isinstance(k, list) and k and isinstance(k[0], (int, float)):
                    color(k, 0, f"{ty} o={o} {nm}")
                elif isinstance(k, list):
                    for i, st in enumerate(k):
                        for f in ('s', 'e'):
                            if isinstance(st.get(f), list) and len(st[f]) >= 3:
                                color(st[f], 0, f"{ty}.anim[{i}].{f} {nm}")
            elif ty in ('gf', 'gs'):
                g = s.get('g', {})
                arr = g.get('k', {}).get('k')
                if isinstance(arr, list):
                    n = g.get('p', len(arr)//4)
                    tail = arr[n*4:]
                    alpha = ' alpha=' + ','.join(f"{tail[i]:g}:{tail[i+1]:g}"
                                                for i in range(0, len(tail)-1, 2)) if tail else ''
                    for i in range(n):
                        if len(arr) >= i*4+4:
                            color(arr, i*4+1, f"{ty}.stop{i} o={s.get('o',{}).get('k')}{alpha} {nm}")

    def layers(ls, pre):
        for l in ls:
            nm = pre + '>' + str(l.get('nm'))
            if l.get('ty') == 4:
                shapes(l.get('shapes', []), nm)
            if l.get('ty') == 0 and l.get('refId') in assets:
                layers(assets[l['refId']]['layers'], nm)

    layers(doc.get('layers', []), '')
    return out

def load(f): return json.load(open(f))

def report(f):
    s = slots(load(f))
    c = collections.Counter(x[0] for x in s)
    print(f"{f}  ({len(s)} slots, {len(c)} unique)")
    for h, n in c.most_common():
        print(f"  {h}  x{n}")

def lst(f):
    for i, (h, _, d) in enumerate(slots(load(f))):
        print(f"{i:3}  {h}  {d[-90:]}")

def write(doc, out):
    json.dump(doc, open(out, 'w'), separators=(',', ':'))

def recolour(inf, out, byhex, byidx):
    doc = load(inf)
    sl = slots(doc)
    n = 0
    for i, (h, setter, _) in enumerate(sl):
        t = byhex.get(h)
        if i in byidx: t = byidx[i]
        if t:
            setter(rgb(t)); n += 1
    write(doc, out)
    print(f"{n}/{len(sl)} slots changed -> {out}")

if __name__ == '__main__':
    cmd = sys.argv[1]
    if cmd == 'report':
        for f in sys.argv[2:]: report(f)
    elif cmd == 'list':
        lst(sys.argv[2])
    elif cmd in ('map', 'set'):
        byhex, byidx = {}, {}
        for a in sys.argv[4:]:
            k, v = a.split('='); v = '#' + v.lstrip('#').upper()
            if k.isdigit(): byidx[int(k)] = v
            else: byhex['#' + k.lstrip('#').upper()] = v
        recolour(sys.argv[2], sys.argv[3], byhex, byidx)
    else:
        print(__doc__)
