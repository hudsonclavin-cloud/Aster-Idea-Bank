#!/usr/bin/env python3
"""Writes snapshots/as512-sources.txt: verbatim text-layer lines (pdftotext -layout, one page at a time, runs of
spaces collapsed to one, OCR errors kept) of the prose and the two S-IVB tables of the AS-512 flight evaluation
report that snapshots/as512-flight.js quotes, so stack.test.mjs can find each prose number in what the PDF itself
says. The mass and trajectory tables have no legible text layer and were read off the rendered pages instead.
Not shipped to the page; needs poppler's pdftotext.

Usage, from the bank root, with the PDF fetched from NTRS
(https://ntrs.nasa.gov/api/citations/19730025089/downloads/19730025089.pdf, sha256 in the sidecar):
  python3 -I -B ideas/34-stack/oracle/build_sources.py <19730025089.pdf>
"""
import hashlib, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'snapshots', 'as512-sources.txt')
# (PDF page, regex of the first line kept, number of lines kept)
WINDOWS = [
    (66, r'All S-IC propulsion systems', 20, 'Section 5.1, S-IC propulsion summary'),
    (72, r'Cutoff s', 9, 'Section 5.4, S-IC cutoff'),
    (84, r'The prcoulsion reconstruction', 18, 'Section 6.3, S-II mainstage performance'),
    (98, r'S-IVB first burn time', 25, 'Section 7.1, S-IVB propulsion summary'),
    (103, r'Table 7-1', 26, 'Table 7-1, S-IVB steady state performance, first burn'),
    (111, r'Table 7-2', 24, 'Table 7-2, S-IVB steady state performance, second burn'),
]


def main(paths):
    if len(paths) != 1:
        sys.exit(__doc__)
    pdf = paths[0]
    sha = hashlib.sha256(open(pdf, 'rb').read()).hexdigest()
    out = ['# Verbatim text-layer excerpts of NTRS 19730025089 (MPR-SAT-FE-73-1, AS-512 flight evaluation report):',
           '# pdftotext -layout per page, runs of spaces collapsed to one, OCR errors kept (e.g. "1.156.694" for',
           '# 1,156,694). snapshots/as512-flight.js transcribes from the rendered pages; stack.test.mjs finds the', '# prose numbers here.',
           '## sha256 ' + sha, '']
    for page, start, n, label in WINDOWS:
        text = subprocess.run(['pdftotext', '-layout', '-f', str(page), '-l', str(page), pdf, '-'], capture_output=True, text=True, check=True).stdout
        lines = [re.sub(r'\s+', ' ', ln).strip() for ln in text.split('\n')]
        lines = [ln for ln in lines if ln]
        i = next((k for k, ln in enumerate(lines) if re.search(start, ln)), None)
        if i is None:
            sys.exit('page %d: no line matches %r' % (page, start))
        out.append('--- PDF page %d: %s' % (page, label))
        out.extend(lines[i:i + n])
        out.append('')
    open(OUT, 'w').write('\n'.join(out) + '\n')
    print('wrote', OUT, os.path.getsize(OUT), 'bytes')


if __name__ == '__main__':
    main(sys.argv[1:])
