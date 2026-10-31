#!/usr/bin/env node
// Writes two data files Window needs from primary sources fetched once (2026-10-31) and verified by sha256:
//
//   snapshots/erfa-iau2006.js        IAU 2006 Earth orientation coefficients, extracted from ERFA's C source
//                                     (liberfa/erfa, BSD-3-Clause, derived from the IAU's SOFA): the Earth rotation
//                                     angle (era00.c), Greenwich mean sidereal time (gmst06.c), the Fukushima-Williams
//                                     bias-precession angles (pfw06.c) and the mean obliquity (obl06.c), with the
//                                     constants they use (erfam.h). The rotation sequence of fw2m.c is in the kernel.
//   snapshots/naif-time-gravity.js   NAIF's leap-second table (naif0012.tls: TAI - UTC from 1972, TT - TAI = 32.184 s)
//                                     and the WGS-84 zonal harmonics J2, J3, J4 and radius quoted in NAIF's
//                                     geophysical.ker (from Vallado), public-domain JPL/NAIF kernels.
//
// Nothing is retyped: every number is parsed out of the files below by the regular expressions here. The files are
// not kept in the folder (about 40 KB); fetch them again with
//   for f in gmst06 era00 pfw06 obl06 fw2m erfam; do curl -sSO https://raw.githubusercontent.com/liberfa/erfa/master/src/$f.c; done
//   (erfam.h: .../src/erfam.h); curl -sSO https://naif.jpl.nasa.gov/pub/naif/generic_kernels/lsk/naif0012.tls
//   curl -sSO https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/geophysical.ker
// and run, from the bank root:  node ideas/37-window/build-data.mjs <directory holding them>
// The sha256 of each is checked against the value recorded when this deposit was built; a changed upstream file stops
// the build rather than silently changing a coefficient.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = process.argv[2];
if (!dir || dir === '--help') {
  console.log('usage: node ideas/37-window/build-data.mjs <dir with gmst06.c era00.c pfw06.c obl06.c fw2m.c erfam.h naif0012.tls geophysical.ker>');
  process.exit(dir ? 0 : 2);
}
export const SHA = {
  'gmst06.c': '5adeede2ed23b37209870778e52083bd57a7870c5b4779c425cf254d26d2e420',
  'era00.c': '91c092c322d070305ba02873005bcb03110d7c26674fbdc7105477c50543ffb5',
  'pfw06.c': '085f49861026fab98633d8479795090b3278a0d246a938ebdf10fde326ef1987',
  'obl06.c': '550260874d5e5fa3be77296b85b92c54c726fee6fbb1bb44748d04c17ffb37c2',
  'fw2m.c': '480d1ae7780566980b8f80f4c6daa2be330a80e99861d892dc5a9f7b11da47c0',
  'erfam.h': '0da6313033aacf9c64533a7e74be49ecda97b4aaa87e134f98287e4ff279886f',
  'naif0012.tls': '678e32bdb5a744117a467cd9601cd6b373f0e9bc9bbde1371d5eee39600a039b',
  'geophysical.ker': '3c60329dc3f5418ba961a6cf36ac01e4bb28bffb91322f230bbdc8c499248987',
};
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, f))).digest('hex');
const got = {};
for (const f of Object.keys(SHA)) {
  got[f] = sha(f);
  if (got[f] !== SHA[f]) { console.error(`${f}: sha256 ${got[f]} is not the recorded ${SHA[f]}; upstream changed, re-check the coefficients by hand`); process.exit(1); }
}

// ---------------------------------------------------------------- ERFA
/** The coefficients of a Horner polynomial "( c0 + ( c1 + ( ... ) * t) * t)" that follows `start` in src. */
function horner(src, start) {
  const i = src.indexOf(start);
  if (i < 0) throw new Error('not found: ' + start);
  const body = src.slice(i + start.length, src.indexOf(';', i));
  const nums = body.match(/[-+]?\d+\.\d*(?:[eE][-+]?\d+)?/g).map(Number);
  return nums;
}
function define(src, name) {
  const m = src.match(new RegExp('#define\\s+' + name + '\\s+\\(([^)]+)\\)'));
  if (!m) throw new Error('no #define ' + name);
  return Number(m[1]);
}
const erfam = read('erfam.h'), era00 = read('era00.c'), gmst06 = read('gmst06.c'), pfw06 = read('pfw06.c'), obl06 = read('obl06.c'), fw2m = read('fw2m.c');
const eraM = era00.match(/ERFA_D2PI \* \(f \+ ([0-9.]+)\s*\+ ([0-9.]+) \* t\)/);
if (!eraM) throw new Error('era00 form changed');
// the fw2m rotation sequence, asserted (the kernel implements exactly this order)
const seq = fw2m.slice(fw2m.indexOf('/* Construct the matrix. */')).match(/eraR[xz]\([^)]*\)/g).join(' ');
if (seq !== 'eraRz(gamb, r) eraRx(phib, r) eraRz(-psi, r) eraRx(-eps, r)') throw new Error('fw2m sequence changed: ' + seq);
const erfa = {
  source: 'ERFA (liberfa/erfa, master, retrieved 2026-10-31; BSD-3-Clause, derived from IAU SOFA): era00.c, gmst06.c, pfw06.c, obl06.c, fw2m.c, erfam.h',
  DJ00: define(erfam, 'ERFA_DJ00'), DJC: define(erfam, 'ERFA_DJC'), DAYSEC: define(erfam, 'ERFA_DAYSEC'),
  era: { c0: Number(eraM[1]), c1: Number(eraM[2]), note: 'ERA = 2 pi (frac(UT1 JD) + c0 + c1 (JD_UT1 - DJ00)) (era00.c)' },
  gmst06_arcsec: horner(gmst06, 'gmst = eraAnp(eraEra00(uta, utb) +'),
  pfw06_arcsec: { gamb: horner(pfw06, '*gamb ='), phib: horner(pfw06, '*phib ='), psib: horner(pfw06, '*psib =') },
  obl06_arcsec: horner(obl06, 'eps0 ='),
  fw2m: seq,
  note: 'Polynomials in t = (JD_TT - DJ00) / DJC, coefficients in arcseconds, lowest power first. GMST = ERA(UT1) + gmst06(t). Bias-precession matrix GCRS -> mean of date = Rx(-epsA) Rz(-psib) Rx(phib) Rz(gamb), ERFA frame-rotation convention.',
};
for (const [k, v] of Object.entries({ g: erfa.gmst06_arcsec, a: erfa.pfw06_arcsec.gamb, p: erfa.pfw06_arcsec.phib, s: erfa.pfw06_arcsec.psib, o: erfa.obl06_arcsec })) if (v.length !== 6) throw new Error('polynomial ' + k + ' has ' + v.length + ' terms');

// ---------------------------------------------------------------- NAIF
const tls = read('naif0012.tls'), geo = read('geophysical.ker');
const dta = Number(tls.match(/DELTET\/DELTA_T_A\s*=\s*([0-9.]+)/)[1]);
const block = tls.slice(tls.indexOf('DELTET/DELTA_AT'), tls.indexOf(')', tls.indexOf('DELTET/DELTA_AT')));
const MON = { JAN: '01', JUL: '07' };
const leaps = [...block.matchAll(/(\d+),\s*@(\d{4})-([A-Z]{3})-(\d+)/g)].map((m) => [Number(m[1]), `${m[2]}-${MON[m[3]]}-${m[4].padStart(2, '0')}`]);
const wgs = geo.slice(geo.indexOf('WGS84 [2]'), geo.indexOf('The BODY399_Jn values'));
const gv = (k) => Number(wgs.match(new RegExp('\\b' + k + '\\s*=\\s*([-0-9.]+)'))[1]);
const naif = {
  source: 'NAIF generic kernels (naif.jpl.nasa.gov, retrieved 2026-10-31): lsk/naif0012.tls (DELTET/DELTA_T_A, DELTET/DELTA_AT) and pck/geophysical.ker (the WGS84 block of its comments, quoted there from Vallado)',
  ttMinusTai_s: dta,
  taiMinusUtc: leaps,
  wgs84: { J2: gv('J2'), J3: gv('J3'), J4: gv('J4'), radius_km: gv('ER'), mu_km3_s2: gv('MU') },
  note: 'taiMinusUtc: [TAI - UTC in s, UTC date from which it applies]; naif0012.tls lists no leap second after 2017-01-01.',
};
if (leaps.length < 28 || leaps[0][1] !== '1972-01-01') throw new Error('leap table parse');

function classic(name, obj, header) {
  return `/* ${header}\n * GENERATED by ideas/37-window/build-data.mjs; do not edit. Classic script (window.${name}) and require(). */\n(function (root) {\n  var D = ${JSON.stringify(obj, null, 1).replace(/\n/g, '\n  ')};\n  if (typeof module === 'object' && module.exports) module.exports = D;\n  else root.${name} = D;\n})(typeof self !== 'undefined' ? self : this);\n`;
}
const out1 = classic('WindowERFA', erfa, 'IAU 2006 Earth rotation angle, mean sidereal time, bias-precession and obliquity coefficients, parsed from ERFA\'s C source.');
const out2 = classic('WindowNAIF', naif, 'Leap seconds (TAI - UTC) and TT - TAI from NAIF naif0012.tls; WGS-84 zonal harmonics quoted in NAIF geophysical.ker.');
fs.writeFileSync(path.join(here, 'snapshots', 'erfa-iau2006.js'), out1);
fs.writeFileSync(path.join(here, 'snapshots', 'naif-time-gravity.js'), out2);
const h = (s) => crypto.createHash('sha256').update(s).digest('hex');
const prov1 = { repo: 'https://github.com/liberfa/erfa', path: 'src/era00.c, src/gmst06.c, src/pfw06.c, src/obl06.c, src/fw2m.c, src/erfam.h', commit: 'master, retrieved 2026-10-31', retrieved: '2026-10-31',
  sourceSha256: Object.fromEntries(['era00.c', 'gmst06.c', 'pfw06.c', 'obl06.c', 'fw2m.c', 'erfam.h'].map((f) => [f, got[f]])),
  license: 'BSD-3-Clause (ERFA, NumFOCUS), derived with permission from IAU SOFA', note: 'derived by build-data.mjs: the Horner coefficients and constants parsed from the C source by regular expression; the fw2m rotation order asserted. Checked against pyerfa (oracle/oracle.json) by window.test.mjs.',
  writtenSha256: h(out1), writtenBytes: Buffer.byteLength(out1) };
const prov2 = { repo: 'https://naif.jpl.nasa.gov/pub/naif/generic_kernels', path: 'lsk/naif0012.tls; pck/geophysical.ker', commit: 'retrieved 2026-10-31', retrieved: '2026-10-31',
  sourceSha256: { 'naif0012.tls': got['naif0012.tls'], 'geophysical.ker': got['geophysical.ker'] },
  license: 'NAIF/JPL generic kernels, US-government work, public domain in the US', note: 'derived by build-data.mjs: DELTET/DELTA_T_A, the DELTET/DELTA_AT table, and the WGS84 J2, J3, J4, ER, MU block of geophysical.ker\'s comments.',
  writtenSha256: h(out2), writtenBytes: Buffer.byteLength(out2) };
fs.writeFileSync(path.join(here, 'snapshots', 'erfa-iau2006.js.provenance.json'), JSON.stringify(prov1, null, 1) + '\n');
fs.writeFileSync(path.join(here, 'snapshots', 'naif-time-gravity.js.provenance.json'), JSON.stringify(prov2, null, 1) + '\n');
console.log('wrote erfa-iau2006.js (' + out1.length + ' bytes) and naif-time-gravity.js (' + out2.length + ' bytes)');

// ---------------------------------------------------------------- Aster (from the files snapshot.mjs copied out of the Aster checkout)
// snapshots/aster-utc-to-tdb.ts.txt (src/v2/core/units/utc-to-tdb.ts at 62ddb17) and snapshots/pck00010-earth.txt (idea 35's
// excerpt of Aster's vendor/naif/pck00010.tpc): parsed, not retyped, into a classic script the page can load.
const ttxt = fs.readFileSync(path.join(here, 'snapshots', 'aster-utc-to-tdb.ts.txt'), 'utf8');
const ptxt = fs.readFileSync(path.join(here, 'snapshots', 'pck00010-earth.txt'), 'utf8');
const nums = (line) => line.slice(line.indexOf('(') + 1, line.indexOf(')')).trim().split(/\s+/).map(Number);
const pline = (k) => ptxt.split('\n').find((l) => l.includes(k + ' ') && l.includes('('));
const radii = nums(pline('BODY399_RADII'));
const aster = {
  source: 'Aster 62ddb17: src/v2/core/units/utc-to-tdb.ts (TDB_MINUS_UTC_SECONDS, UNIX_TO_J2000_DAYS) and vendor/naif/pck00010.tpc (BODY399_RADII, _POLE_RA, _POLE_DEC, _PM) via idea 35\'s excerpt',
  tdbMinusUtc_s: Number(ttxt.match(/TDB_MINUS_UTC_SECONDS\s*=\s*([0-9.]+)/)[1]),
  unixToJ2000Days: Number(ttxt.match(/UNIX_TO_J2000_DAYS\s*=\s*([0-9.]+)/)[1]),
  radii_km: radii, poleRa: nums(pline('BODY399_POLE_RA')), poleDec: nums(pline('BODY399_POLE_DEC')), pm: nums(pline('BODY399_PM')),
  note: 'pck00010 units: radii km; pole RA/Dec deg and deg per Julian century; PM deg and deg per day (TDB).',
};
if (!(aster.tdbMinusUtc_s > 0 && aster.unixToJ2000Days > 0 && radii.length === 3 && aster.pm.length === 3)) throw new Error('Aster parse');
const out3 = classic('WindowAster', aster, 'Aster constants Window uses: its UTC->TDB offset and Unix->J2000 day count, and the IAU Earth model in its pck00010.');
fs.writeFileSync(path.join(here, 'snapshots', 'aster-constants.js'), out3);
fs.writeFileSync(path.join(here, 'snapshots', 'aster-constants.js.provenance.json'), JSON.stringify({ repo: 'https://github.com/hudsonclavin-cloud/asteroid-mining-planner', path: 'src/v2/core/units/utc-to-tdb.ts; vendor/naif/pck00010.tpc', commit: '62ddb17',
  sourceSha256: { 'aster-utc-to-tdb.ts.txt': crypto.createHash('sha256').update(ttxt).digest('hex'), 'pck00010-earth.txt': crypto.createHash('sha256').update(ptxt).digest('hex') },
  note: 'derived by build-data.mjs from snapshots/aster-utc-to-tdb.ts.txt and snapshots/pck00010-earth.txt (both copied by tools/snapshot.mjs; their own sidecars carry the Aster blob hashes)', writtenSha256: h(out3), writtenBytes: Buffer.byteLength(out3) }, null, 1) + '\n');
console.log('wrote aster-constants.js (' + out3.length + ' bytes)');

// Aster's Apophis cell (snapshots/aster-apophis-vinf.json, copied by tools/snapshot.mjs) as a classic script for the page.
const apoTxt = fs.readFileSync(path.join(here, 'snapshots', 'aster-apophis-vinf.json'), 'utf8');
const out4 = classic('AsterApophis', JSON.parse(apoTxt), 'Aster\'s Apophis M=1 v-infinity cell: snapshots/aster-apophis-vinf.json, unchanged, as a classic script.');
fs.writeFileSync(path.join(here, 'snapshots', 'aster-apophis-vinf.js'), out4);
fs.writeFileSync(path.join(here, 'snapshots', 'aster-apophis-vinf.js.provenance.json'), JSON.stringify({ repo: 'https://github.com/hudsonclavin-cloud/asteroid-mining-planner', path: 'tools/slice12-research/data/dla-oracle-m1-vectors.json', commit: '62ddb17',
  sourceSha256: crypto.createHash('sha256').update(apoTxt).digest('hex'), note: 'derived by build-data.mjs: snapshots/aster-apophis-vinf.json (the snapshot.mjs excerpt, whose sidecar carries the Aster blob) wrapped as a classic script; window.test.mjs checks the two hold the same data', writtenSha256: h(out4), writtenBytes: Buffer.byteLength(out4) }, null, 1) + '\n');
console.log('wrote aster-apophis-vinf.js (' + out4.length + ' bytes)');
