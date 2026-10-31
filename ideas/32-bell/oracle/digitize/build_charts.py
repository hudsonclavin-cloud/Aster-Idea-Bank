#!/usr/bin/env python3
"""Digitize the three published nozzle charts idea 32 (Bell) uses, from the NASA PDFs, and write
  ideas/32-bell/snapshots/nozzle-charts.js   (the page and kernel read it)

Charts:
  SP-8120 Figure 5(b)  canted-parabola (Rao thrust-optimised parabola) initial and exit wall angles against
                       area ratio for 60-100 % bells (log axis, ticks only). Primary angle data.
  SP-125 Figure 4-14   the same angles from Huzel & Huang (linear, gridded). Second reading, shown beside.
  SP-125 Figure 4-12   thrust efficiency (percent of ideal C_F) against fractional length for bells at
                       area ratios 10, 20, 30, 40, and for a shortened 15-degree-based cone.

Needs pdftoppm (poppler) and Pillow, both present in the build sandbox; nothing else. Run from the bank root:
  python3 -I -B ideas/32-bell/oracle/digitize/build_charts.py <NTRS-19770009165.pdf (SP-8120)> <NTRS-19710019929.pdf (SP-125)> <scratch dir>
The PDFs are NTRS downloads (sha256 recorded in the sidecar). Pages rendered: SP-8120 PDF page 29 at 400 dpi;
SP-125 PDF page 100 at 300 dpi. Crop boxes below are in those renders' pixels.
"""
import hashlib, json, math, os, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from PIL import Image
import digitize, digitize_ticks
from fitcurves import robust, ev

SP8120_SHA = 'c6aa504371b090027fc4b597aad7ca7595e6f9489997857bbc573aab437bf79f'
SP125_SHA = '471e590a0c8e99c36a98132104a3ddcc7097b0b7c561fb2638ce9d3c80e26c87'
LF = ['60', '70', '80', '90', '100']
EPS_SOLID = [5, 6, 7, 8, 10, 12, 14, 16, 20, 25, 30, 35, 40, 45, 50]
EPS_DASH = [60, 70, 80, 90]
LF_NODES = [60, 62.5, 65, 67.5, 70, 72.5, 75, 77.5, 80, 82.5, 85, 87.5, 90, 92.5, 95, 97.5, 100]



def compact(data):
    """JSON with each innermost list on one line (review: the one-number-per-line layout tripled the file)."""
    def enc(v, ind):
        if isinstance(v, dict):
            pad = '  ' * (ind + 1)
            return '{\n' + ',\n'.join(pad + json.dumps(k) + ': ' + enc(x, ind + 1) for k, x in v.items()) + '\n' + '  ' * ind + '}'
        if isinstance(v, list) and any(isinstance(x, (dict, list)) for x in v):
            return '[' + ', '.join(enc(x, ind) for x in v) + ']'
        return json.dumps(v, separators=(', ', ': '))
    return enc(data, 1)

def sha(p):
    return hashlib.sha256(open(p, 'rb').read()).hexdigest()


def render(pdf, page, dpi, out):
    base = os.path.join(out, 'p%d_%d' % (page, dpi))
    subprocess.run(['pdftoppm', '-f', str(page), '-l', str(page), '-r', str(dpi), '-png', pdf, base], check=True)
    for f in os.listdir(out):
        if f.startswith(os.path.basename(base)) and f.endswith('.png'):
            return os.path.join(out, f)


def crop(src, box, dst):
    Image.open(src).crop(box).save(dst)
    return dst


def sp8120_angles(img):
    cfg = {'image': img, 'origin': [190, 896.5], 'skew': 0.0088,
           'xticks': [[2, 190, 880], [4, 341.5, 870], [6, 430.5, 870], [8, 492.5, 870], [10, 542, 870], [20, 692, 870],
                      [40, 843, 870], [60, 933, 874], [80, 996.5, 874]],
           'yticks': [[0, 222, 896.5], [10, 222, 691.5], [20, 222, 488.5], [30, 222, 284.5], [40, 222, 78]],
           'panels': [{'name': 'thetaN', 'x': [400, 1060], 'y': [40, 505], 'labels': LF, 'minThick': 5, 'maxThick': 12, 'window': 0.03, 'at': []},
                      {'name': 'thetaE', 'x': [400, 1060], 'y': [505, 870], 'labels': LF, 'minThick': 5, 'maxThick': 12, 'window': 0.03, 'at': []}]}
    d = digitize_ticks.run(cfg)
    out = {'calibration': d['calibration'], 'fit': {}}
    for p in d['panels']:
        out[p['name']] = {}
        for lab in LF:
            pts = p['points'][lab]
            solid = [q for q in pts if 5 <= q[0] <= 52]
            dash = [q for q in pts if 45 <= q[0] <= 99]
            cs, ss, ns = robust(solid)
            cd, sd, nd = robust(dash)
            vals = [round(ev(cs, math.log(e)), 2) for e in EPS_SOLID] + [round(ev(cd, math.log(e)), 2) for e in EPS_DASH]
            out[p['name']][lab] = vals
            out['fit'][p['name'] + lab] = {'solidRmsDeg': round(ss, 3), 'solidPoints': ns, 'dashRmsDeg': round(sd, 3), 'dashPoints': nd}
    return out


def sp125_angles(img):
    vl = [[0, 112], [5, 179.5], [10, 246.5], [15, 314], [20, 378], [25, 442], [30, 507], [35, 572], [40, 639.5], [45, 707], [50, 774.5]]
    res = {}
    for name, hl, yr in (('thetaN', [[45, 29.5], [40, 95.5], [35, 159.5], [30, 225.5], [25, 290.5], [20, 358.5], [15, 424.5]], [40, 352]),
                         ('thetaE', [[25, 424.5], [20, 490.5], [15, 555.5], [10, 620.5], [5, 687.5], [0, 751]], [470, 745])):
        d = digitize.run({'image': img, 'vlines': vl, 'vspan': [20, 750], 'hlines': hl, 'hspan': [120, 760],
                          'panels': [{'name': name, 'y': yr, 'x': [181, 772], 'labels': LF, 'minThick': 3, 'at': []}]})
        pts = d['panels'][0]['points']
        res[name] = {}
        for lab in LF:
            # local reading: median of points within +-0.6 of each node (no global fit: the 100 % exit-angle curve
            # sits on the 5-degree gridline beyond 25 and a polynomial would bend there)
            row = []
            for e in [6, 8, 10, 14, 20, 30, 40, 45]:
                near = sorted(q[1] for q in pts[lab] if abs(q[0] - e) <= 0.6)
                row.append(round(near[len(near) // 2], 2) if len(near) >= 3 else None)
            res[name][lab] = row
    res['eps'] = [6, 8, 10, 14, 20, 30, 40, 45]
    return res


def sp125_lambda(img):
    cfg = {'image': img,
           'vlines': [[55, 30], [60, 101], [65, 172.5], [70, 243.5], [75, 315.5], [80, 386.5], [85, 457.5], [90, 528.5], [95, 599.5], [100, 670.5], [105, 741.5]],
           'vspan': [60, 830],
           'hlines': [[100.5, 55], [100, 127.5], [99.5, 198], [99, 267.5], [98.5, 339], [98, 410], [97.5, 480], [97, 552.5], [96.5, 623], [96, 694.5], [95.5, 765], [95, 834]],
           'hspan': [40, 740]}
    im = digitize.load(cfg); px = im.load(); w, h = im.size
    V, H = digitize.gridlines(px, w, h, cfg)
    pts = {k: [] for k in ('40', '30', '20', '10', 'm3040', 'merged', 'cone')}
    for x in range(104, 672):
        if any(abs(x - (a + b * 450)) <= 3 for v, a, b, _ in V):
            continue
        keep = []
        for a, b in digitize.runs_in_column(px, x, 120, 835, 128):
            c = (a + b) / 2; t = b - a + 1
            if any(abs(c - (ga + gb * x)) <= 2.5 for v, ga, gb, _ in H) and t <= 4:
                continue
            if 3 <= t <= 16:
                keep.append((c, t))
        d = [(digitize.to_data(x, c, V, H, False), t) for c, t in keep]
        if not d:
            continue
        lf = d[0][0][0]
        if lf <= 83 and len(d) in (4, 5):
            # bells top to bottom, cone last
            bells = [q[0] for q in d[:-1]]
            pts['cone'].append(d[-1][0])
            if len(bells) == 4:
                for k, q in zip(('40', '30', '20', '10'), bells): pts[k].append(q)
            else:
                for k, q in zip(('m3040', '20', '10'), bells): pts[k].append(q)
        elif lf >= 88:
            # merged bell curve: the topmost thick run under the 99.5 % line; the cone: the thick run in 97.5-98.4 %
            top = [q for q, t in d if 98.85 <= q[1] <= 99.3 and t >= 5]
            if top:
                pts['merged'].append(top[0])
            cone = [q for q, t in d if 97.6 <= q[1] <= 98.4 and t >= 4]
            if len(cone) == 1:
                pts['cone'].append(cone[0])
    curves = {'40': pts['40'] + pts['m3040'] + pts['merged'], '30': pts['30'] + pts['m3040'] + pts['merged'],
              '20': pts['20'] + pts['merged'], '10': pts['10'] + pts['merged']}

    def pfit(p, deg=4):
        # polynomial in (Lf - 80)/20, robust trimming
        xs = [(q[0] - 80) / 20 for q in p]; ys = [q[1] for q in p]
        import fitcurves
        for _ in range(5):
            c = fitcurves.polyfit(xs, ys, deg)
            r = [y - sum(ci * x ** i for i, ci in enumerate(c)) for x, y in zip(xs, ys)]
            s = (sum(v * v for v in r) / len(r)) ** 0.5
            keep = [i for i, v in enumerate(r) if abs(v) <= max(3 * s, 0.01)]
            if len(keep) == len(xs): break
            xs = [xs[i] for i in keep]; ys = [ys[i] for i in keep]
        return c, s, len(xs)
    out = {'Lf': LF_NODES, 'eps': [10, 20, 30, 40], 'percent': {}, 'fit': {}}
    for k in ('10', '20', '30', '40'):
        c, s, n = pfit(curves[k])
        out['percent'][k] = [round(sum(ci * ((L - 80) / 20) ** i for i, ci in enumerate(c)), 3) for L in LF_NODES]
        out['fit'][k] = {'rmsPercent': round(s, 4), 'points': n}
    c, s, n = pfit(pts['cone'], 3)
    out['conePercent'] = [round(sum(ci * ((L - 80) / 20) ** i for i, ci in enumerate(c)), 3) for L in LF_NODES]
    out['fit']['cone'] = {'rmsPercent': round(s, 4), 'points': n}
    return out


def main():
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    sp8120, sp125, scratch = sys.argv[1:4]
    assert sha(sp8120) == SP8120_SHA, 'not the SP-8120 PDF this was built from'
    assert sha(sp125) == SP125_SHA, 'not the SP-125 PDF this was built from'
    os.makedirs(scratch, exist_ok=True)
    p29 = render(sp8120, 29, 400, scratch)
    f5b = crop(p29, (923, 2111, 2221, 3123), os.path.join(scratch, 'sp8120-fig5b.png'))
    p100 = render(sp125, 100, 300, scratch)
    f414 = crop(p100, (1440, 1980, 2300, 2760), os.path.join(scratch, 'sp125-fig4-14.png'))
    f412 = crop(p100, (560, 420, 1340, 1300), os.path.join(scratch, 'sp125-fig4-12.png'))
    angles = sp8120_angles(f5b)
    lam = sp125_lambda(f412)
    cross = sp125_angles(f414)
    data = {
        'raoAngles': {'source': 'NASA SP-8120 (1976) Figure 5(b), "Wall angles for parabolic contour as a function of expansion area ratio and nozzle length", PDF page 29 (printed page 15), digitized',
                      'eps': EPS_SOLID + EPS_DASH, 'dashedFrom': 50, 'Lf': [60, 70, 80, 90, 100],
                      'thetaN': {k: angles['thetaN'][k] for k in LF}, 'thetaE': {k: angles['thetaE'][k] for k in LF},
                      'calibration': angles['calibration'], 'fit': angles['fit']},
        'bellLambda': {'source': 'NASA SP-125 (1971) Figure 4-12, "Thrust efficiency versus bell nozzle length", PDF page 100 (printed page 91), digitized; percent of ideal C_F',
                       'Lf': lam['Lf'], 'eps': lam['eps'], 'percent': lam['percent'], 'conePercent': lam['conePercent'], 'fit': lam['fit']},
        'raoAnglesSP125': {'source': 'NASA SP-125 (1971) Figure 4-14, "theta n and theta e as function of expansion area ratio", PDF page 100 (printed page 91), digitized; a second reading of the same parabola angles, shown beside SP-8120 and used to state their disagreement',
                           'eps': cross['eps'], 'Lf': [60, 70, 80, 90, 100], 'thetaN': cross['thetaN'], 'thetaE': cross['thetaE']},
        'pdfSha256': {'SP-8120 (NTRS 19770009165)': SP8120_SHA, 'SP-125 (NTRS 19710019929)': SP125_SHA},
    }
    root = os.path.join(HERE, '..', '..')
    js = ('/* GENERATED by oracle/digitize/build_charts.py from NASA SP-8120 Figure 5(b) and NASA SP-125 Figure 4-12\n'
          ' * (scans fetched from NTRS; sha256 below). Do not edit; rerun the script. Classic script and require().\n'
          ' * raoAngles: canted-parabola initial (thetaN) and exit (thetaE) wall angles, degrees, by fractional length\n'
          ' * Lf (percent of a 15-degree cone) at the listed area ratios; SP-8120 draws eps > 50 dashed (its own\n'
          ' * extrapolation). bellLambda: thrust efficiency, percent of ideal C_F, by Lf for eps 10, 20, 30, 40, and the\n'
          ' * chart\'s shortened-cone curve (used only to check the calibration against the closed form).\n'
          ' * raoAnglesSP125: SP-125 Figure 4-14\'s reading of the same angles (a second opinion; median of the points\n'
          ' * within 0.6 of each area ratio). */\n'
          '(function (root) {\n  var NOZZLE_CHARTS = ' + compact(data) + ';\n'
          '  if (typeof module === \'object\' && module.exports) module.exports = NOZZLE_CHARTS;\n'
          '  else root.NOZZLE_CHARTS = NOZZLE_CHARTS;\n'
          '})(typeof self !== \'undefined\' ? self : this);\n')
    open(os.path.join(root, 'snapshots', 'nozzle-charts.js'), 'w').write(js)
    print(json.dumps({'raoAngles fit': angles['fit'], 'lambda fit': lam['fit']}, indent=0))


if __name__ == '__main__':
    main()
