"""Digitizer for a chart with axis ticks but no grid (SP-8120 Figure 5(b)): rotate pixel coordinates by the
measured axis skew, map x by a least-squares fit of the x ticks (log axis) and y by the y ticks, then read
curve centres column by column. Prints JSON. Run: python3 digitize_ticks.py <config.json>"""
import json, math, sys
from PIL import Image


def lsq(pts):
    n = len(pts); st = sum(p[0] for p in pts); sv = sum(p[1] for p in pts)
    stt = sum(p[0] ** 2 for p in pts); stv = sum(p[0] * p[1] for p in pts)
    b = (n * stv - st * sv) / (n * stt - st * st)
    return (sv - b * st) / n, b


def run(cfg):
    im = Image.open(cfg['image']).convert('L'); px = im.load()
    x0, y0, s = cfg['origin'][0], cfg['origin'][1], cfg['skew']
    uv = lambda x, y: ((x - x0) + s * (y - y0), (y - y0) - s * (x - x0))
    # x: u = a + b log10(eps)
    ax, bx = lsq([(math.log10(e), uv(x, y)[0]) for e, x, y in cfg['xticks']])
    ay, by = lsq([(uv(x, y)[1], d) for d, x, y in cfg['yticks']])
    resid_x = [round(uv(x, y)[0] - (ax + bx * math.log10(e)), 2) for e, x, y in cfg['xticks']]
    resid_y = [round(ay + by * uv(x, y)[1] - d, 3) for d, x, y in cfg['yticks']]
    to = lambda x, y: (10 ** ((uv(x, y)[0] - ax) / bx), ay + by * uv(x, y)[1])
    out = {'calibration': {'pxPerDecade': round(bx, 2), 'degPerPx': round(by, 5), 'tickResidualPx': resid_x, 'tickResidualDeg': resid_y}, 'panels': []}
    for p in cfg['panels']:
        n = len(p['labels']); curves = [[] for _ in range(n)]; skipped = 0
        for x in range(p['x'][0], p['x'][1]):
            rs, st = [], None
            for y in range(p['y'][0], p['y'][1]):
                d = px[x, y] < 128
                if d and st is None: st = y
                if not d and st is not None: rs.append((st, y - 1)); st = None
            keep = [((a + b) / 2) for a, b in rs if p['minThick'] <= b - a + 1 <= p['maxThick']]
            if len(keep) != n: skipped += 1; continue
            for i, c in enumerate(keep): curves[i].append(to(x, c))
        res = {'name': p['name'], 'columnsSkipped': skipped, 'curves': {}}
        for lab, pts in zip(p['labels'], curves):
            pts.sort(); vals = {}
            for t in p['at']:
                near = [q for q in pts if abs(math.log10(q[0] / t)) <= p['window']]
                if len(near) >= 5:
                    a, b = lsq([(math.log10(q[0]), q[1]) for q in near]); vals[str(t)] = round(a + b * math.log10(t), 2)
            res['curves'][lab] = {'nPoints': len(pts), 'xRange': [round(pts[0][0], 2), round(pts[-1][0], 2)] if pts else None, 'at': vals}
        res['points'] = {lab: pts for lab, pts in zip(p['labels'], curves)}
        out['panels'].append(res)
    return out


if __name__ == '__main__':
    print(json.dumps(run(json.load(open(sys.argv[1]))), indent=1))
