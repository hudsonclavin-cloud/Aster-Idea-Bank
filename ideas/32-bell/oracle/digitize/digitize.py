"""Chart digitizer for scanned NASA figures (gridded charts, dark curves on white).

Calibration: every gridline is located in the pixels and fitted with a straight line (the scans are both
rotated and sheared), and a pixel is mapped to data coordinates by interpolating between the neighbouring
gridlines along its own row (x) and column (y). Curves: in each pixel column, dark runs that are not
gridlines are the curves, assigned top to bottom when their count equals the expected number.
Run: python3 digitize.py <config.json>   (prints JSON)
"""
import json, math, sys
from PIL import Image


def load(cfg):
    im = Image.open(cfg['image']).convert('L')
    if 'box' in cfg:
        im = im.crop(tuple(cfg['box']))
    return im


def runs_in_column(px, x, y0, y1, thr):
    out, s = [], None
    for y in range(y0, y1):
        d = px[x, y] < thr
        if d and s is None:
            s = y
        if not d and s is not None:
            out.append((s, y - 1)); s = None
    if s is not None:
        out.append((s, y1 - 1))
    return out


def runs_in_row(px, y, x0, x1, thr):
    out, s = [], None
    for x in range(x0, x1):
        d = px[x, y] < thr
        if d and s is None:
            s = x
        if not d and s is not None:
            out.append((s, x - 1)); s = None
    if s is not None:
        out.append((s, x1 - 1))
    return out


def fit(points):
    """Least squares line v = a + b t through (t, v), after dropping the worst 20 % by residual twice."""
    pts = list(points)
    for _ in range(3):
        n = len(pts)
        st = sum(p[0] for p in pts); sv = sum(p[1] for p in pts)
        stt = sum(p[0] * p[0] for p in pts); stv = sum(p[0] * p[1] for p in pts)
        b = (n * stv - st * sv) / (n * stt - st * st); a = (sv - b * st) / n
        res = sorted(pts, key=lambda p: abs(p[1] - (a + b * p[0])))
        pts = res[: max(5, int(len(res) * 0.85))]
    return a, b


def gridlines(px, w, h, cfg):
    thr = cfg.get('gridThr', 128)
    V = []
    for val, x0 in cfg['vlines']:
        pts = []
        for y in range(cfg['vspan'][0], cfg['vspan'][1], 4):
            best = None
            for a, b in runs_in_row(px, y, max(0, int(x0) - 8), min(w, int(x0) + 9), thr):
                if b - a + 1 <= 4:
                    c = (a + b) / 2
                    if best is None or abs(c - x0) < abs(best - x0):
                        best = c
            if best is not None:
                pts.append((y, best))
        a, b = fit(pts)
        V.append((val, a, b, len(pts)))
    H = []
    for val, y0 in cfg['hlines']:
        pts = []
        for x in range(cfg['hspan'][0], cfg['hspan'][1], 4):
            best = None
            for a, b in runs_in_column(px, x, max(0, int(y0) - 8), min(h, int(y0) + 9), thr):
                if b - a + 1 <= 4:
                    c = (a + b) / 2
                    if best is None or abs(c - y0) < abs(best - y0):
                        best = c
            if best is not None:
                pts.append((x, best))
        a, b = fit(pts)
        H.append((val, a, b, len(pts)))
    return V, H


def interp(pos, table):
    """table: sorted list of (pixel position, value); linear, extrapolating from the end pair."""
    table = sorted(table)
    for i in range(len(table) - 1):
        if pos <= table[i + 1][0] or i == len(table) - 2:
            p0, v0 = table[i]; p1, v1 = table[i + 1]
            return v0 + (v1 - v0) * (pos - p0) / (p1 - p0)


def to_data(x, y, V, H, xlog):
    xv = interp(x, [(a + b * y, (math.log10(v) if xlog else v)) for v, a, b, _ in V])
    yv = interp(y, [(a + b * x, v) for v, a, b, _ in H])
    return (10 ** xv if xlog else xv), yv


def run(cfg):
    im = load(cfg); px = im.load(); w, h = im.size
    V, H = gridlines(px, w, h, cfg)
    thr = cfg.get('curveThr', 128)
    result = {'gridlines': {'v': [[v, round(a, 2), round(b, 5), n] for v, a, b, n in V],
                            'h': [[v, round(a, 2), round(b, 5), n] for v, a, b, n in H]}, 'panels': []}
    for panel in cfg['panels']:
        n = len(panel['labels'])
        curves = [[] for _ in range(n)]
        skipped = 0
        for x in range(panel['x'][0], panel['x'][1]):
            ymid = (panel['y'][0] + panel['y'][1]) / 2
            if any(abs(x - (a + b * ymid)) <= 3 for v, a, b, _ in V):
                continue
            rs = runs_in_column(px, x, panel['y'][0], panel['y'][1], thr)
            keep = []
            for a, b in rs:
                c = (a + b) / 2; t = b - a + 1
                on_grid = any(abs(c - (ga + gb * x)) <= 2.5 for v, ga, gb, _ in H)
                if on_grid and t <= 4:
                    continue
                if t < panel.get('minThick', 3) or t > panel.get('maxThick', 14):
                    continue
                keep.append(c)
            if len(keep) != n:
                skipped += 1
                continue
            for i, c in enumerate(keep):
                curves[i].append(to_data(x, c, V, H, cfg.get('xlog', False)))
        out = {'name': panel['name'], 'columnsSkipped': skipped, 'curves': {}, 'points': {l: sorted(c) for l, c in zip(panel['labels'], curves)}}
        for lab, pts in zip(panel['labels'], curves):
            pts.sort()
            vals = {}
            for t in panel['at']:
                near = [p for p in pts if abs(p[0] - t) <= panel.get('window', 0.35)]
                if len(near) >= 2:
                    # local linear fit around t
                    a, b = fit([(p[0], p[1]) for p in near]) if len(near) >= 5 else (sum(p[1] for p in near) / len(near), 0)
                    vals[str(t)] = round(a + b * t, 2)
            out['curves'][lab] = {'nPoints': len(pts), 'xRange': [round(pts[0][0], 3), round(pts[-1][0], 3)] if pts else None, 'at': vals}
        result['panels'].append(out)
    return result


if __name__ == '__main__':
    print(json.dumps(run(json.load(open(sys.argv[1]))), indent=1))
