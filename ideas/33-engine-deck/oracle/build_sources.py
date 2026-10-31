#!/usr/bin/env python3
"""Writes snapshots/turbo-sources.txt: the verbatim text-layer lines (pdftotext -layout, runs of spaces collapsed to
one, OCR errors kept) of the three NASA tables snapshots/turbo-data.js transcribes, so engine.test.mjs can find
each legible transcribed number in what the PDF itself says. Not shipped to the page; needs poppler's pdftotext.

Usage, from the bank root, with the PDFs fetched from NTRS (sha256 in snapshots/turbo-sources.txt.provenance.json):
  python3 -I -B ideas/33-engine-deck/oracle/build_sources.py <19750012398.pdf> <19740026132.pdf> <19970010379.pdf>
"""
import hashlib, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'snapshots', 'turbo-sources.txt')
# (label, line ranges of pdftotext -layout output, 1-based inclusive)
DOCS = [
    ('SP-8107 (NASA SP-8107, Turbopump Systems for Liquid Rocket Engines, 1974; NTRS 19750012398) Tables I-III, printed pages 3-5',
     [(595, 660), (667, 735), (739, 822)]),
    ('SP-8110 (NASA SP-8110, Liquid Rocket Engine Turbines, 1974; NTRS 19740026132) Table III, printed page 16',
     [(1016, 1057)]),
    ('TM-107318 (NASA TM-107318, RL10A-3-3A Rocket Engine Modeling Project, 1997; NTRS 19970010379) Tables 2.2.1 and 2.5.1, printed pages 4 and 6, and section 6.1, page 25 (Table 6.1.1 on page 37 is an image with no text layer: transcribed from the rendered page only)',
     [(366, 398), (490, 512), (1584, 1590)]),
]


def main(paths):
    if len(paths) != 3:
        sys.exit(__doc__)
    out = ['# Verbatim text-layer excerpts (pdftotext -layout; runs of spaces collapsed to one; OCR errors kept,',
           '# e.g. SP-8107 "t600" for 1600 and "106" for -106). snapshots/turbo-data.js transcribes the numbers from',
           '# the rendered pages; engine.test.mjs checks each legible one is here.', '']
    for (label, ranges), pdf in zip(DOCS, paths):
        sha = hashlib.sha256(open(pdf, 'rb').read()).hexdigest()
        text = subprocess.run(['pdftotext', '-layout', pdf, '-'], capture_output=True, text=True, check=True).stdout.split('\n')
        out.append('## ' + label)
        out.append('## sha256 ' + sha)
        for a, b in ranges:
            out.append('--- lines %d-%d' % (a, b))
            for ln in text[a - 1:b]:
                s = re.sub(r'\s+', ' ', ln).strip()
                if s:
                    out.append(s)
        out.append('')
    open(OUT, 'w').write('\n'.join(out) + '\n')
    print('wrote', OUT, sum(len(x) + 1 for x in out), 'bytes')


if __name__ == '__main__':
    main(sys.argv[1:])
