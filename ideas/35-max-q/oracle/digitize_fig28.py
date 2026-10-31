#!/usr/bin/env python3
"""Digitizing aid for Walker (NASA TM X-53770, 1968) Figure 28, the Apollo/Saturn V axial force coefficient.

Not run by the tests and not shipped to the page: it documents (and lets anyone repeat) how
snapshots/saturn-v-axial-force.js was read. Needs numpy and Pillow (a throw-away venv) and poppler's pdftoppm.

  python3 -I digitize_fig28.py <19690009748.pdf> <workdir> [--overlay ../snapshots/saturn-v-axial-force.js]

1. Renders PDF page 157 at 300 dpi (the scan's native resolution, 1-bit) and rotates it upright.
2. Fits, per panel, x = a0 + a1*M + a2*y and y = b0 + b1*C + b2*x (a small-rotation affine map) to the major grid
   lines (Mach 0..8 every 1; coefficient every 0.2), each located as the centroid of the darkest 4-px band, and
   prints the largest residual.
3. Lists the dark runs crossing a single pixel column 0.02 Mach either side of each station (off the 0.05-Mach grid
   lines), as coefficient values; the reader picks the run on the solid fairing by eye on zoomed crops.
4. With --overlay, draws the snapshot's table on the figure (red: forebody, blue: total) for a visual check.
"""
import json, re, subprocess, sys, os
import numpy as np
from PIL import Image, ImageDraw

PANELS = {
    'bottom': {'vx': {0: 640, 1: 932, 2: 1223, 3: 1514, 4: 1806, 5: 2096, 6: 2387, 7: 2678, 8: 2969}, 'vy': [1560, 1700, 2090],
               'hy': {0: 2112, 0.2: 1967, 0.4: 1822, 0.6: 1676, 0.8: 1531}, 'hx': [760, 1100, 1600, 2200, 2850]},
    'top': {'vx': {0: 640, 1: 932, 2: 1223, 3: 1514, 4: 1806, 5: 2096, 6: 2387, 7: 2678, 8: 2969}, 'vy': [420, 900, 1350],
            'hy': {0: 1386, 0.2: 1241, 0.4: 1096, 0.6: 951, 0.8: 806, 1.0: 661, 1.2: 516, 1.4: 371}, 'hx': [760, 1100, 1600, 2200, 2850]},
}


def band_centroid(prof):
    best = max(range(len(prof) - 3), key=lambda i: prof[i:i + 4].sum())
    seg = prof[best:best + 4]
    return best + (seg * np.arange(4)).sum() / seg.sum()


def fit(bw, P):
    V, H = [], []
    for M, xg in P['vx'].items():
        for y in P['vy']:
            prof = bw[y - 60:y + 60, xg - 10:xg + 11].sum(axis=0).astype(float)
            V.append((M, xg - 10 + band_centroid(prof), y))
    for C, yg in P['hy'].items():
        for x in P['hx']:
            prof = bw[yg - 10:yg + 11, x - 60:x + 60].sum(axis=1).astype(float)
            H.append((C, x, yg - 10 + band_centroid(prof)))
    A = np.array([[1, M, y] for M, x, y in V]); bx = np.array([x for M, x, y in V])
    a = np.linalg.lstsq(A, bx, rcond=None)[0]
    B = np.array([[1, C, x] for C, x, y in H]); by = np.array([y for C, x, y in H])
    b = np.linalg.lstsq(B, by, rcond=None)[0]
    return a, b, float(np.abs(bx - A @ a).max()), float(np.abs(by - B @ b).max())


def to_px(a, b, M, C):
    x = (a[0] + a[1] * M + a[2] * b[0] + a[2] * b[1] * C) / (1 - a[2] * b[2])
    return x, b[0] + b[1] * C + b[2] * x


def to_data(a, b, x, y):
    return (x - a[0] - a[2] * y) / a[1], (y - b[0] - b[2] * x) / b[1]


def runs(bw, a, b, M, c0, c1):
    x, _ = to_px(a, b, M, (c0 + c1) / 2); xi = int(round(x))
    col = bw[:, xi]; _, yt = to_px(a, b, M, c1); _, yb = to_px(a, b, M, c0)
    out, y = [], int(yt)
    while y < int(yb):
        if col[y]:
            y0 = y
            while y < int(yb) and col[y]: y += 1
            out.append((round(to_data(a, b, xi, (y0 + y - 1) / 2)[1], 4), y - y0))
        y += 1
    return out


def main():
    pdf, work = sys.argv[1], sys.argv[2]
    os.makedirs(work, exist_ok=True)
    subprocess.run(['pdftoppm', '-f', '157', '-l', '157', '-r', '300', '-png', pdf, os.path.join(work, 'W')], check=True)
    src = [f for f in os.listdir(work) if f.startswith('W') and f.endswith('.png')][0]
    img = Image.open(os.path.join(work, src)).rotate(-90, expand=True)
    bw = np.array(img.convert('L')) < 128
    cal = {}
    for name, P in PANELS.items():
        a, b, ex, ey = fit(bw, P); cal[name] = (a, b)
        print(f'{name}: max residual {ex:.2f} px in x, {ey:.2f} px in y; {1 / a[1] * ex:.4f} Mach, {ey / -b[1]:.4f} coefficient')
    if '--overlay' in sys.argv:
        js = open(sys.argv[sys.argv.index('--overlay') + 1]).read()
        def arr(key, sub):
            blk = re.search(key + r':\s*\{([\s\S]*?)\}', js).group(1)
            return [float(v) for v in re.search(sub + r':\s*\[([^\]]*)\]', blk).group(1).split(',')]
        d = ImageDraw.Draw(img := img.convert('RGB'))
        for key, panel, col in (('forebody', 'bottom', (255, 0, 0)), ('total', 'top', (0, 60, 255))):
            a, b = cal[panel]
            for M, C in zip(arr(key, 'mach'), arr(key, 'ca')):
                x, y = to_px(a, b, M, C); d.ellipse([x - 4, y - 4, x + 4, y + 4], outline=col, width=2)
                print(key, M, C, 'runs at M-0.02:', runs(bw, a, b, M - 0.02, C - 0.03, C + 0.03), 'M+0.02:', runs(bw, a, b, M + 0.02, C - 0.03, C + 0.03))
        img.save(os.path.join(work, 'overlay.png')); print('wrote', os.path.join(work, 'overlay.png'))


if __name__ == '__main__':
    main()
