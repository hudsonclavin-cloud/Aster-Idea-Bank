#!/usr/bin/env python3
"""Transcribe the RP-1311 Part II rocket printouts in oracle/published-excerpts.txt into oracle/published.json,
by script, not by hand: each value list is parsed from one verbatim line of the excerpt (the row whose text starts
with `label` in the block of pdftotext lines `range`); bell.test.mjs re-parses the excerpt in JavaScript and must
get the same values. OCR repairs (the only edits): a leading i or I in a numeric token is a 1
("i0.000" -> 10.000, "I00.00" -> 100.00). Run from the bank root: python3 -I -B ideas/32-bell/oracle/transcribe_published.py
"""
import json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
TXT = open(os.path.join(HERE, 'published-excerpts.txt')).read().split('\n')


def block(a, b):
    """Lines of the excerpt that came from pdftotext lines a..b."""
    start = [i for i, l in enumerate(TXT) if l.startswith(f'--- lines {a}-{b}')][0] + 1
    end = start
    while end < len(TXT) and not TXT[end].startswith('--- lines') and not TXT[end].startswith('## '):
        end += 1
    return TXT[start:end]


def num(tok):
    t = re.sub(r'^[iI]', '1', tok)
    return float(t)


def row(lines, label, n):
    """The first line whose stripped text starts with label; its last n numeric tokens."""
    for l in lines:
        if l.strip().startswith(label):
            toks = [t for t in l.split() if re.fullmatch(r'[iI]?[0-9]*\.?[0-9]+', t)]
            vals = [num(t) for t in toks][-n:]
            if len(vals) != n:
                raise SystemExit(f'{label}: expected {n} numbers in {l!r}')
            return {'line': l.strip(), 'values': vals}
    raise SystemExit(f'no line starting {label!r}')


def case(name, mode, of, pc_psia, rng, stations):
    L = block(*rng)
    n = len(stations)
    out = {'name': name, 'mode': mode, 'of': of, 'pc_psia': pc_psia, 'range': list(rng), 'stations': stations, 'rows': {}}
    for key, label, cols in (('P_bar', 'P,', n + 2), ('T_K', 'T,', n + 2), ('mach', 'MACH', n + 2),
                             ('eps', 'Ae/At', n + 1), ('cstar', 'CST', n + 1), ('CF', 'CF', n + 1),
                             ('Ivac', 'Ivac', n + 1), ('Isp', 'Isp', n + 1)):
        r = row(L, label, cols)
        out['rows'][key] = {'label': label, 'cols': cols, 'values': r['values'][-n:]}  # drop chamber/throat columns
    return out


def main():
    cases = [
        case('RP-1311 Example 8', 'shifting', 5.55157, 773.3, (8549, 8603), ['pi10', 'pi100', 'pi1000', 'sub1.58', 'eps25', 'eps50']),
        case('RP-1311 Example 8', 'shifting', 5.55157, 773.3, (8657, 8690), ['eps75']),
        case('RP-1311 Example 12', 'shifting', 2.5, 1000.0, (9620, 9700), ['pi68.046', 'eps5', 'eps10', 'eps25', 'eps50', 'eps75']),
        case('RP-1311 Example 12', 'shifting', 2.5, 1000.0, (9765, 9820), ['eps100', 'eps150', 'eps200']),
        case('RP-1311 Example 12', 'frozen-throat', 2.5, 1000.0, (9882, 9960), ['pi68.046', 'eps5', 'eps10', 'eps25', 'eps50', 'eps75']),
        case('RP-1311 Example 12', 'frozen-throat', 2.5, 1000.0, (9976, 10030), ['eps100', 'eps150', 'eps200']),
    ]
    meta = {'source': 'NASA RP-1311 Part II (1996), Examples 8 (H2(L)/O2(L) at 90.17/20.27 K, O/F 5.55157, 773.3 psia = 53.3172 bar) and 12 (CH6N2(L)/N2O4(L) at 298.15 K, O/F 2.5, 1000 psia = 68.947 bar); legacy CEA with its 1996 thermodynamic data',
            'note': 'values exclude the chamber (and for Ae/At, CSTAR, CF, Ivac, Isp the throat) columns; units as printed: P bar, T K, cstar/Ivac/Isp m/s',
            'cases': cases}
    json.dump(meta, open(os.path.join(HERE, 'published.json'), 'w'), indent=1)
    for c in cases:
        print(c['name'], c['mode'], c['stations'], c['rows']['eps']['values'], c['rows']['Ivac']['values'])


if __name__ == '__main__':
    main()
