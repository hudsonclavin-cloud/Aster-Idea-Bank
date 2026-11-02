#!/usr/bin/env node
// Near Field Guide oracle: JPL SBDB's own Tisserand parameter (t_jup) against guide.js.
//
//   node ideas/28-near-field-guide/oracle/sbdb-tjup.mjs <sbdb-query.json> [--aster DIR]
//
// <sbdb-query.json> is the SBDB Query API response for
//   https://ssd-api.jpl.nasa.gov/sbdb_query.api?fields=pdes,full_name,epoch,a,e,i,om,t_jup,class&sb-group=neo&full-prec=true
// (6 MB, downloaded at build time and not shipped). The script writes oracle/sbdb-tjup.json:
//   - which convention reproduces SBDB's printed t_jup (3 decimals) from SBDB's own a, e, i, node:
//     inclination to the ecliptic or to Jupiter's orbit plane, with a_J from Aster's Jupiter state
//     by vis-viva (bins.data.js), and the interval of a_J over which every row reproduces;
//   - a deterministic sample of rows (every 150th by designation, plus the extremes) that
//     guide.test.mjs recomputes, so the test does not need the 6 MB file;
//   - Aster's catalog T_J (both conventions, its own 2026-05-01 elements) against SBDB's t_jup
//     (SBDB's elements at SBDB's epochs, retrieved 2026-11-02), by anchorSource;
//   - Aster's stored orbitClass against the class code SBDB gives the same designation today.
// It is a build-time tool; the page and the tests never fetch anything.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const req = createRequire(import.meta.url);
const G = req(path.join(here, '..', 'guide.js'));
const D = req(path.join(here, '..', 'snapshots', 'bins.data.js'));

const args = process.argv.slice(2);
if (!args.length || args.includes('--help')) {
  console.log('usage: node oracle/sbdb-tjup.mjs <sbdb-query.json> [--aster DIR]');
  process.exit(args.length ? 0 : 3);
}
const file = args[0];
const ai = args.indexOf('--aster');
const aster = ai >= 0 ? args[ai + 1] : '/home/user/asteroid-mining-planner';
const buf = fs.readFileSync(file);
const sb = JSON.parse(buf.toString('utf8'));
const ix = Object.fromEntries(sb.fields.map((f, k) => [f, k]));
for (const f of ['pdes', 'epoch', 'a', 'e', 'i', 'om', 't_jup', 'class']) if (!(f in ix)) throw new Error(`SBDB response lacks field ${f}`);

const ROUND = 0.0005; // SBDB prints t_jup to 3 decimals
const EPS = 1e-9;
const aJ = D.jupiter.aAu;
const pole = D.jupiter.pole;
const rad = Math.PI / 180;
const rows = sb.data.filter((r) => r[ix.t_jup] !== null && r[ix.a] !== null);
const num = (r, f) => Number(r[ix[f]]);
const tjEcl = (r, aj) => G.tisserand(num(r, 'a'), num(r, 'e'), Math.cos(num(r, 'i') * rad), aj);
const tjJup = (r, aj) => {
  const p = G.poleFromAngles(num(r, 'i') * rad, num(r, 'om') * rad);
  return G.tisserand(num(r, 'a'), num(r, 'e'), p[0] * pole[0] + p[1] * pole[1] + p[2] * pole[2], aj);
};
function fit(name, fn) {
  let ok = 0;
  let max = 0;
  for (const r of rows) {
    const d = Math.abs(fn(r, aJ) - num(r, 't_jup'));
    max = Math.max(max, d);
    if (d <= ROUND + EPS) ok++;
  }
  return { name, aJAu: aJ, reproduced: ok, of: rows.length, maxAbsDiff: max };
}
const conventions = [fit('ecliptic inclination', tjEcl), fit("inclination to Jupiter's orbit plane", tjJup)];

// The a_J values (on a 1e-7 AU grid within 1e-4 AU of ours) at which the ecliptic convention
// reproduces every row to SBDB's rounding.
const pre = rows.map((r) => [num(r, 'a'), num(r, 'e'), Math.cos(num(r, 'i') * rad), num(r, 't_jup')]);
let lo = null;
let hi = null;
const base = Math.round(aJ * 1e7);
for (let k = -1000; k <= 1000; k++) {
  const aj = (base + k) / 1e7;
  if (pre.every(([a, e, c, t]) => Math.abs(G.tisserand(a, e, c, aj) - t) <= ROUND + EPS)) {
    if (lo === null) lo = aj;
    hi = aj;
  }
}

// Deterministic sample: every 150th row by designation, the five lowest and highest t_jup, and
// every landmark record the page shows (bins.data.js landmarks) that SBDB still lists as a NEO.
const byDes = [...rows].sort((x, y) => (x[ix.pdes] < y[ix.pdes] ? -1 : x[ix.pdes] > y[ix.pdes] ? 1 : 0));
const pick = new Set(byDes.filter((_, k) => k % 150 === 0));
const byT = [...rows].sort((x, y) => num(x, 't_jup') - num(y, 't_jup'));
for (const r of byT.slice(0, 5).concat(byT.slice(-5))) pick.add(r);
const landmarkDes = new Set(D.landmarks.map((l) => l.record.designation));
for (const r of rows) if (landmarkDes.has(r[ix.pdes])) pick.add(r);
const sample = byDes.filter((r) => pick.has(r)).map((r) => ['pdes', 'epoch', 'a', 'e', 'i', 'om', 't_jup'].map((f) => r[ix[f]]));

// Aster's own elements against SBDB's published t_jup.
const cat = JSON.parse(fs.readFileSync(path.join(aster, 'tests/fixtures/v2/nea-catalog-slice9.json'), 'utf8')).asteroids;
const sbBy = new Map(rows.map((r) => [r[ix.pdes], r]));
const C = D.constants;
const ctx = { auKm: C.auKm.value, aJAu: aJ, jupiterPole: pole, rule: C.classRule.value, bands: C.bands.value };
const groups = {};
const classCross = {};
let matched = 0;
let unmatched = 0;
const top = [];
const q = (arr, p) => {
  const s = [...arr].sort((x, y) => x - y);
  return s.length ? s[Math.floor(p * (s.length - 1))] : null;
};
for (const b of Object.values(cat)) {
  const r = sbBy.get(b.designation);
  const key = `${b.orbitClass} -> ${r ? r[ix.class] : '(designation not in the SBDB NEO list)'}`;
  classCross[key] = (classCross[key] || 0) + 1;
  if (!r) {
    unmatched++;
    continue;
  }
  matched++;
  const d = G.derive(b, ctx);
  const t = num(r, 't_jup');
  const g = (groups[b.anchorSource] = groups[b.anchorSource] || { n: 0, ecl: [], jup: [], sameEpoch: 0 });
  g.n++;
  g.ecl.push(Math.abs(d.TJe - t));
  g.jup.push(Math.abs(d.TJ - t));
  if (Number(r[ix.epoch]) === b.elements.epochTdbJd) g.sameEpoch++;
  top.push({ des: b.designation, anchor: b.anchorSource, asterTJe: d.TJe, sbdbTJ: t, diff: d.TJe - t, asterEpochJd: b.elements.epochTdbJd, sbdbEpochJd: Number(r[ix.epoch]) });
}
const summ = (arr) => ({ median: q(arr, 0.5), p90: q(arr, 0.9), p99: q(arr, 0.99), max: Math.max(...arr), over001: arr.filter((x) => x > 0.01).length, over01: arr.filter((x) => x > 0.1).length });
const byAnchor = {};
for (const [k, g] of Object.entries(groups)) byAnchor[k] = { n: g.n, sameEpoch: g.sameEpoch, ecliptic: summ(g.ecl), jupiterPlane: summ(g.jup) };
top.sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff) || (x.des < y.des ? -1 : 1));

const out = {
  schema: 'near-field-guide/sbdb-tjup/1',
  source: {
    url: 'https://ssd-api.jpl.nasa.gov/sbdb_query.api?fields=pdes,full_name,epoch,a,e,i,om,t_jup,class&sb-group=neo&full-prec=true',
    retrieved: '2026-11-02',
    sha256: crypto.createHash('sha256').update(buf).digest('hex'),
    bytes: buf.length,
    rows: sb.data.length,
    signature: sb.signature,
  },
  rounding: ROUND,
  conventions,
  eclipticAJInterval: { lo, hi, step: 1e-7, searched: [(base - 1000) / 1e7, (base + 1000) / 1e7] },
  sampleFields: ['pdes', 'epoch', 'a', 'e', 'i', 'om', 't_jup'],
  sample,
  aster: { commit: D.source.commit, matched, unmatched, byAnchor, top: top.slice(0, 12), classCross: Object.fromEntries(Object.entries(classCross).sort()) },
};
const dest = path.join(here, 'sbdb-tjup.json');
fs.writeFileSync(dest, JSON.stringify(out, null, 1) + '\n');
console.log(`wrote ${path.relative(process.cwd(), dest)}: ${sample.length} sample rows; ${conventions.map((c) => `${c.name} ${c.reproduced}/${c.of}`).join('; ')}; a_J interval ${lo}..${hi}; Aster matched ${matched}, unmatched ${unmatched}`);
