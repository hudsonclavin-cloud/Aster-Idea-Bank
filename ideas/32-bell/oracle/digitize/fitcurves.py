"""Robust cubic-in-ln(eps) fit of each digitized curve (points from digitize_ticks.py run with dumpPoints),
trimming label-corrupted columns, then evaluation at node values. Prints JSON."""
import json, math, sys
import importlib.util

def polyfit(xs, ys, deg):
    # normal equations, small degree
    n = deg + 1
    A = [[sum(x ** (i + j) for x in xs) for j in range(n)] for i in range(n)]
    b = [sum(y * x ** i for x, y in zip(xs, ys)) for i in range(n)]
    for c in range(n):
        p = max(range(c, n), key=lambda r: abs(A[r][c])); A[c], A[p] = A[p], A[c]; b[c], b[p] = b[p], b[c]
        for r in range(n):
            if r != c:
                f = A[r][c] / A[c][c]
                A[r] = [a - f * cc for a, cc in zip(A[r], A[c])]; b[r] -= f * b[c]
    return [b[i] / A[i][i] for i in range(n)]

def ev(c, x): return sum(ci * x ** i for i, ci in enumerate(c))

def robust(pts, deg=3, trim=3.0):
    pts = list(pts)
    for _ in range(6):
        xs = [math.log(p[0]) for p in pts]; ys = [p[1] for p in pts]
        c = polyfit(xs, ys, deg)
        r = [y - ev(c, x) for x, y in zip(xs, ys)]
        s = (sum(v * v for v in r) / len(r)) ** 0.5
        keep = [p for p, v in zip(pts, r) if abs(v) <= max(trim * s, 0.05)]
        if len(keep) == len(pts): break
        pts = keep
    return c, s, len(pts)

if __name__ == '__main__':
    raw = json.load(open(sys.argv[1]))
    nodes = json.loads(sys.argv[2])
    lo, hi = float(sys.argv[3]), float(sys.argv[4])
    out = {}
    for panel, curves in raw.items():
        out[panel] = {}
        for lab, pts in curves.items():
            pts = [p for p in pts if lo <= p[0] <= hi]
            c, s, n = robust(pts)
            out[panel][lab] = {'rmsDeg': round(s, 3), 'nUsed': n, 'nRaw': len(pts),
                               'values': [round(ev(c, math.log(e)), 2) for e in nodes]}
    print(json.dumps({'nodes': nodes, 'range': [lo, hi], 'curves': out}, indent=1))
