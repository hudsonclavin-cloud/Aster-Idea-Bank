#!/usr/bin/env python3
"""Write the verbatim text excerpts idea 32 (Bell) cites, from the NTRS PDFs, so every quoted rule and every
published number can be found word for word (OCR errors kept: these are scanned reports).

  snapshots/nozzle-sources.txt     NASA SP-8120 (1976) and NASA SP-125 (1971) lines: separation criterion,
                                   bell length definition, throat radii, the 20 % separation margin, the
                                   conical-nozzle length and efficiency equations, Rao's parabola construction
                                   and Sample Calculation (4-2)
  oracle/published-excerpts.txt    NASA RP-1311 Part II (1996) Examples 8 and 12 rocket printouts (shifting
                                   equilibrium to area ratio 200; frozen after the throat)

Run from the bank root (needs pdftotext from poppler):
  python3 -I -B ideas/32-bell/oracle/build_sources.py <SP-8120 pdf> <SP-125 pdf> <RP-1311 Part II pdf>
"""
import hashlib, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..')
DOCS = {
    'SP-8120': ('NTRS 19770009165', 'https://ntrs.nasa.gov/api/citations/19770009165/downloads/19770009165.pdf',
                'c6aa504371b090027fc4b597aad7ca7595e6f9489997857bbc573aab437bf79f',
                'NASA SP-8120, Liquid Rocket Engine Nozzles (NASA Space Vehicle Design Criteria, July 1976)',
                [(903, 916), (928, 933), (949, 954), (1220, 1243), (3660, 3666), (3743, 3757), (3815, 3821)]),
    'SP-125': ('NTRS 19710019929', 'https://ntrs.nasa.gov/api/citations/19710019929/downloads/19710019929.pdf',
               '471e590a0c8e99c36a98132104a3ddcc7097b0b7c561fb2638ce9d3c80e26c87',
               'NASA SP-125, Design of Liquid Propellant Rocket Engines, 2nd ed. (Huzel & Huang, 1971)',
               [(6189, 6240), (6320, 6370), (6620, 6648), (6824, 6862)]),
    'RP-1311': ('NTRS 19960044559', 'https://ntrs.nasa.gov/api/citations/19960044559/downloads/19960044559.pdf',
                '09bc8a8d215daa8d7902c194e812a67466074f8154c81fb4c94f95a42b435a1a',
                'NASA RP-1311 Part II, Computer Program for Calculation of Complex Chemical Equilibrium Compositions and Applications: Users Manual and Program Description (Gordon & McBride, 1996)',
                [(8549, 8603), (8657, 8690), (9620, 9700), (9765, 9820), (9882, 9960), (9976, 10030)]),
}


def text(pdf):
    return subprocess.run(['pdftotext', '-layout', pdf, '-'], check=True, capture_output=True, text=True).stdout.split('\n')


def block(key, pdf, keep=None):
    ntrs, url, sha, title, ranges = DOCS[key]
    got = hashlib.sha256(open(pdf, 'rb').read()).hexdigest()
    if got != sha:
        sys.exit(f'{pdf}: sha256 {got} is not the {key} this was built from ({sha})')
    lines = text(pdf)
    out = [f'## [{key}] {title}', f'## {ntrs}, {url}, sha256 {sha}',
           '## pdftotext -layout lines ' + ', '.join(f'{a}-{b}' for a, b in ranges)]
    for a, b in ranges:
        out.append(f'--- lines {a}-{b}' + (' (only the rows used: case, reactants, mixture ratio, and the P, T, Mach, Ae/At, c*, CF, Ivac, Isp rows)' if keep else ''))
        out += [l.rstrip() for l in lines[a - 1:b] if not keep or keep(l)]
    return out


ROWS = ('Pinj', 'CASE', 'FUEL', 'OXIDANT', 'O/F', 'P,', 'T,', 'MACH', 'Ae/At', 'CST', 'CF', 'Ivac', 'Isp', 'THEORETICAL', 'AFTER')


def rocket_rows(line):
    t = line.strip()
    return any(t.startswith(r) for r in ROWS)


def main():
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    sp8120, sp125, rp1311 = sys.argv[1:4]
    head = ['# Verbatim excerpts (pdftotext -layout of scanned NASA reports; OCR errors kept, e.g. "0.583 (Pamb/P)°"195" is',
            '# printed 0.583 (Pamb/Pc)^0.195 on the scan, and "= 0.8 x 128 = 1024 inches" is printed 102.4). Written by',
            '# oracle/build_sources.py; do not edit. US-government works, public domain in the US.', '']
    open(os.path.join(ROOT, 'snapshots', 'nozzle-sources.txt'), 'w').write('\n'.join(head + block('SP-8120', sp8120) + [''] + block('SP-125', sp125)) + '\n')
    open(os.path.join(ROOT, 'oracle', 'published-excerpts.txt'), 'w').write('\n'.join(head[:1] + ['# published.json transcribes the numbers used; bell.test.mjs checks every quoted line is here.', ''] + block('RP-1311', rp1311, rocket_rows)) + '\n')
    print('wrote snapshots/nozzle-sources.txt and oracle/published-excerpts.txt')


if __name__ == '__main__':
    main()
