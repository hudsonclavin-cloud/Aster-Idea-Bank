// Near Field Guide tests. Run from the bank root:
//   node --test ideas/28-near-field-guide/guide.test.mjs
// Every constant a test needs is parsed here from the snapshot of the Aster source file it lives in
// (snapshots/*.ts, *.mjs), not taken from bins.data.js, so a wrong derivation cannot agree with
// itself. External pins: the catalog fixture's own header, the Slice 18 artifact and founding
// document, STATUS.md, the Slice 9 pre-research report, JPL Horizons' osculating elements of
// Jupiter, JPL SBDB's published t_jup (308 rows) and SBDB's own records of 2008 TC3 and 2014 AA.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const G = require('./guide.js');
const D = require('./snapshots/bins.data.js');
const snap = (f) => fs.readFileSync(path.join(here, 'snapshots', f), 'utf8');
const json = (f) => JSON.parse(fs.readFileSync(path.join(here, f), 'utf8'));
const ASTER = '/home/user/asteroid-mining-planner';

// ---- constants parsed from the snapshotted Aster sources ----
function grab(text, re, what) {
  const m = re.exec(text);
  assert.ok(m, `could not find ${what}`);
  return Number(m[1].replace(/_/g, ''));
}
const AU_KM = grab(snap('tier-sizing.mjs'), /^const AU_KM = ([\d.]+);/m, 'AU_KM');
const OBL = grab(snap('units.ts'), /J2000_ECLIPTIC_OBLIQUITY_RAD = ([\d.]+) \* ARCSECONDS_TO_RADIANS/, 'obliquity') * (Math.PI / (180 * 3600));
const GM_SUN = grab(snap('keplerian.ts'), /export const GM_SUN_M3_S2 = ([\d.e+]+);/, 'GM_SUN_M3_S2') / 1e9;
const GM_JUP = grab(snap('dv-scope.mjs'), /Jupiter: ([\d.]+)/, 'GM Jupiter');
const ALBEDO = grab(snap('asteroids.ts'), /ASTEROID_DEFAULT_ALBEDO = ([\d.]+);/, 'albedo');
const RADIUS_K = { diamKm: grab(snap('asteroids.ts'), /return \((\d+) \/ Math\.sqrt\(albedo\)\)/, 'diameter literal'), kmToRadiusM: grab(snap('asteroids.ts'), /deriveAsteroidDiameterKmFromAbsoluteMagnitude\(absoluteMagnitude, albedo\) \* (\d+);/, 'radius literal') };
const BANDS = [...snap('asteroids.ts').matchAll(/if \(eccentricity < ([\d.]+)\)/g)].map((m) => Number(m[1]));
const NORM = snap('normalizers.ts');
const RULE = { ieoQ: grab(NORM, /if \(Q < ([\d.]+)\) astClass = 'IEO'/, 'IEO'), ateA: grab(NORM, /else if \(a < ([\d.]+)\) astClass = 'ATE'/, 'ATE'), apoQ: grab(NORM, /else if \(q < ([\d.]+)\) astClass = 'APO'/, 'APO') };
const EARTH_R_KM = grab(snap('bodies.ts'), /earth:\s*\{ naifId: 399, radiusM:\s*([\d_.]+),/, 'Earth radius') / 1000;
const HEADER = json('snapshots/catalog-header.json').catalog;
const TIERS = json('snapshots/tier-populations.json').populations;
const LANDMARKS = json('snapshots/landmarks.json').asteroids;
const JREC = json('snapshots/jupiter-first-record.json').targets.jupiter.records[0];
const ORACLE = json('oracle/sbdb-tjup.json');
// Aster's Slice 18 per-body rows for the 11 landmarks (docs/tier-sizing-per-body.json, written by
// tools/slice18-research/tier-sizing.mjs:116-117 and rounded at :166): Aster's own a, e and Q.
const TIER_LM = json('snapshots/tier-landmarks.json').records;

// a_J and Jupiter's orbit pole, recomputed here from the snapshotted state and GMs.
const JR = JREC.slice(1, 4);
const JV = JREC.slice(4, 7);
const MU = GM_SUN + GM_JUP;
const EL_J = G.elementsFromState(JR, JV, MU, OBL);
const A_J = EL_J.a / AU_KM;
const CTX = { auKm: AU_KM, aJAu: A_J, jupiterPole: EL_J.pole, rule: RULE, bands: BANDS, fidelity: null };
const ALL = G.summarize(D.atoms, {});
const spec = (k) => G.SPECS.find((s) => s.key === k);
const count = (sel) => G.summarize(D.atoms, sel).n;
const firstNumber = (text) => Number(/\*\*[^*]*?=\s*([\d,]+)\*\*/.exec(text)[1].replace(/,/g, ''));

// ---------------------------------------------------------------- the kernel on its own

test('bins: an edge value lands in the bar it opens, nulls and tokens in their own bars, off-axis values throw', () => {
  const e = spec('e');
  assert.equal(G.binIndex(e, 0.1), 5, 'e = 0.1 opens [0.10, 0.12)');
  assert.equal(G.binIndex(e, 0.0999999), 4);
  const a = spec('a');
  assert.equal(G.binIndex(a, 1), 20, 'a = 1 AU opens [1.00, 1.05)');
  assert.equal(G.bars(a)[G.binIndex(a, 7)].label, '6.00–10.00', 'a = 7 AU is in the first overflow bar');
  assert.equal(G.bars(a)[G.binIndex(a, 'neg')].kind, 'neg');
  const q = spec('Q');
  assert.equal(G.bars(q)[G.binIndex(q, 'undef')].kind, 'undef');
  assert.equal(G.binIndex(spec('Q'), 4.95), 99, 'Q = 4.95 AU (Jupiter-crossing threshold) opens bar 99');
  const arc = spec('arc');
  assert.equal(G.bars(arc)[G.binIndex(arc, 0)].kind, 'zero');
  assert.equal(G.bars(arc)[G.binIndex(arc, null)].kind, 'null');
  assert.equal(G.binIndex(arc, 10), 4, '10 days opens the fifth log bar (10^1)');
  assert.equal(G.binIndex(arc, 9.999), 3);
  const u = spec('U');
  assert.equal(G.binIndex(u, 7), 7);
  assert.equal(G.bars(u)[7].label, '7');
  assert.throws(() => G.binIndex(spec('i'), 180), /above the axis/);
  assert.throws(() => G.binIndex(spec('TJ'), -2), /below the axis/);
  assert.throws(() => G.binIndex(spec('e'), null), /no "null" bar/);
  assert.throws(() => G.catIndex(G.CATS[0], 'MBA'), /unknown category/);
});

test('eccentricity band and class rule use Aster\'s own strict "<" thresholds (parsed from the snapshots)', () => {
  assert.deepEqual(BANDS, [0.1, 0.2, 0.3]);
  assert.equal(G.eccentricityBand(0.0999, BANDS), 'A');
  assert.equal(G.eccentricityBand(0.1, BANDS), 'B');
  assert.equal(G.eccentricityBand(0.3, BANDS), 'D');
  assert.deepEqual(RULE, { ieoQ: 0.983, ateA: 1, apoQ: 1.017 });
  assert.equal(G.classFromElements(0.7, 0.5, 0.9829, RULE), 'IEO');
  assert.equal(G.classFromElements(0.99, 0.5, 0.983, RULE), 'ATE');
  assert.equal(G.classFromElements(1.0, 1.0169, 1.2, RULE), 'APO');
  assert.equal(G.classFromElements(1.2, 1.017, 1.4, RULE), 'AMO');
});

test('radius from H: a hand-worked case and every landmark record\'s stored estimatedRadiusM', () => {
  // D = 1329 / sqrt(0.14) * 10^(-15/5) km = 3.551901... km, radius = 1775.95 m (worked by hand).
  const r15 = G.radiusFromH(15, ALBEDO, RADIUS_K);
  assert.ok(Math.abs(r15 - (1329 / Math.sqrt(0.14)) * 1e-3 * 500) < 1e-9);
  assert.ok(Math.abs(r15 - 1775.95) < 0.01, `${r15}`);
  let n = 0;
  for (const b of Object.values(LANDMARKS)) {
    if (b.H === null) continue;
    n++;
    const r = G.radiusFromH(b.H, ALBEDO, RADIUS_K);
    assert.ok(Math.abs(r - b.estimatedRadiusM) / b.estimatedRadiusM < 1e-12, `${b.designation}: ${r} vs ${b.estimatedRadiusM}`);
  }
  assert.equal(n, 8, 'the three comet landmarks (1P, 3D, C/2015 D1) carry H = null');
});

test('Tisserand: Jupiter itself (a = a_J, e = 0, i = 0) gives exactly 3, and the formula is symmetric in its terms', () => {
  assert.equal(G.tisserand(A_J, 0, 1, A_J), 3);
  // a = a_J / 4, e = 0, i = 0: T = 4 + 2*sqrt(1/4) = 5.
  assert.ok(Math.abs(G.tisserand(A_J / 4, 0, 1, A_J) - 5) < 1e-12);
  // polar circular orbit at a_J: T = 1.
  assert.ok(Math.abs(G.tisserand(A_J, 0, 0, A_J) - 1) < 1e-12);
});

// Added in review: derive()'s per-body a, e, Q and i, nullPaths() and medianBar() were reached only
// by the live --check test, so a Q = a(1 - e) or a degrees slip passed every checkout-free test.
test('derive(): every landmark\'s a, e and Q equal Aster\'s own Slice 18 rows; 1P and 3D reproduce SBDB\'s a, e, i at SBDB\'s epoch', () => {
  let elliptic = 0;
  for (const b of Object.values(LANDMARKS)) {
    const t = TIER_LM[b.designation];
    assert.ok(t, `${b.designation} has a Slice 18 row`);
    const d = G.derive(b, CTX);
    assert.equal(Number(d.aAu.toFixed(3)), t.aAU, `${b.designation} a`);
    assert.equal(Number(d.e.toFixed(4)), t.e, `${b.designation} e`);
    if (typeof d.Q === 'number') {
      assert.equal(Number(d.Q.toFixed(3)), t.Q, `${b.designation} Q`);
      assert.ok(Math.abs(d.q - d.aAu * (1 - d.e)) < 1e-12 && d.q < d.Q);
      elliptic++;
    } else {
      assert.ok(t.aAU < 0 && d.a === 'neg' && d.Q === 'undef', `${b.designation}: hyperbolic in both`);
    }
  }
  assert.equal(elliptic, 10, 'all but C/2015 D1');
  const ix = Object.fromEntries(ORACLE.sampleFields.map((f, k) => [f, k]));
  const sb = Object.fromEntries(ORACLE.sample.map((r) => [r[ix.pdes], r]));
  for (const des of ['1P', '3D']) {
    const b = LANDMARKS[`asteroid-${des}`];
    const r = sb[des];
    assert.equal(Number(r[ix.epoch]), b.elements.epochTdbJd, `${des}: same epoch as SBDB`);
    const d = G.derive(b, CTX);
    assert.ok(Math.abs(d.aAu - Number(r[ix.a])) < 1e-9, `${des} a ${d.aAu} vs ${r[ix.a]}`);
    assert.ok(Math.abs(d.e - Number(r[ix.e])) < 1e-12, `${des} e`);
    assert.ok(Math.abs(d.i - Number(r[ix.i])) < 1e-9, `${des} i ${d.i}° vs ${r[ix.i]}°`);
  }
});

test('nullPaths() on the landmark records: every shipped key path, G null in all, H and radius null together, maRad null only when hyperbolic', () => {
  const shipped = D.census.keyPaths.map((k) => k.path).sort();
  const nullBy = {};
  for (const b of Object.values(LANDMARKS)) {
    const paths = G.nullPaths(b, '', []);
    assert.deepEqual(paths.map(([p]) => p).sort(), shipped, `${b.designation}: the census's ${shipped.length} paths`);
    for (const [p, isNull] of paths) if (isNull) (nullBy[p] = nullBy[p] || []).push(b.designation);
  }
  const n = Object.keys(LANDMARKS).length;
  assert.equal((nullBy.G || []).length, n, 'G is null in Slice 9 (spec)');
  assert.deepEqual([...(nullBy.H || [])].sort(), ['1P', '2015 D1', '3D']);
  assert.deepEqual([...(nullBy.estimatedRadiusM || [])].sort(), [...nullBy.H].sort(), 'estimatedRadiusM is null when H is null (spec)');
  assert.deepEqual(nullBy['elements.maRad'], ['2015 D1']);
  assert.equal(nullBy['elements.aKm'], undefined, 'nested objects are walked');
});

test('medianBar(): nearest-rank middle of the numeric bars, null bars left out; numericCount() and the comet tail\'s H', () => {
  const h = spec('H');
  const bars = G.bars(h);
  const nullK = bars.findIndex((b) => b.kind === 'null');
  const dense = new Array(bars.length).fill(0);
  dense[0] = 3;
  dense[10] = 1;
  dense[nullK] = 100;
  assert.equal(G.medianBar(h, dense), 0, 'bodies 1-3 of 4 sit in bar 0; the 100 nulls do not count');
  assert.equal(G.numericCount(h, dense), 4);
  dense[10] = 4;
  assert.equal(G.medianBar(h, dense), 10, 'the 4th of 7 sits in bar 10');
  const nulls = new Array(bars.length).fill(0);
  nulls[nullK] = 5;
  assert.equal(G.medianBar(h, nulls), null);
  assert.equal(G.numericCount(h, nulls), 0);
  // Every body of the comet tail has H null, so the page refuses its H and radius panels.
  const tail = G.summarize(D.atoms, { cls: ['ETC', 'HTC', 'JFC'] });
  assert.equal(tail.n, HEADER.anomalyTailCount);
  assert.equal(G.numericCount(h, tail.h.H), 0);
  assert.equal(G.numericCount(spec('r'), tail.h.r), 0);
  assert.equal(G.numericCount(spec('a'), tail.h.a), tail.n - 1, 'all but the hyperbolic C/2015 D1');
  assert.equal(G.numericCount(h, ALL.h.H), HEADER.totalBodies - HEADER.missingAbsoluteMagnitudeCount);
});

test('designation kinds of the landmark names', () => {
  const kinds = Object.fromEntries(Object.values(LANDMARKS).map((b) => [b.designation, G.designationKind(b.name)]));
  assert.equal(kinds['433'], 'named');
  assert.equal(kinds['152637'], 'numbered');
  assert.equal(kinds['2008 TC3'], 'provisional');
  assert.equal(kinds['1P'], 'comet');
  assert.equal(kinds['2015 D1'], 'comet');
  assert.throws(() => G.designationKind('Eros'), /unrecognised/);
});

// ---------------------------------------------------------------- oracles from outside Aster

test('ORACLE Horizons: elementsFromState on Aster\'s Jupiter state reproduces Horizons\' own osculating elements at 2026-05-01', () => {
  const text = fs.readFileSync(path.join(here, 'oracle', 'horizons-jupiter-elements.txt'), 'utf8');
  const gm = Number(/Keplerian GM\s*:\s*([\d.E+]+)/.exec(text)[1]);
  const rec = text.slice(text.indexOf('$$SOE'));
  const f = (k) => Number(new RegExp(`\\b${k}\\s*=\\s*([-\\d.E+]+)`).exec(rec)[1]);
  assert.ok(rec.includes('2461161.500000000'), 'first record is 2026-05-01 00:00 TDB');
  assert.equal(JREC[0], 2461161.5);
  const el = G.elementsFromState(JR, JV, gm, OBL);
  assert.ok(Math.abs(el.a - f('A')) / f('A') < 1e-12, `a ${el.a} vs ${f('A')} km`);
  assert.ok(Math.abs(el.e - f('EC')) < 1e-12, `e ${el.e} vs ${f('EC')}`);
  assert.ok(Math.abs((el.i * 180) / Math.PI - f('IN')) < 1e-9, 'inclination to the ecliptic');
  assert.ok(Math.abs((el.node * 180) / Math.PI - f('OM')) < 1e-9, 'node');
  // With this deposit's mu (Aster's GM_sun + dv-scope's GM_Jupiter) a_J moves by under 2e-7 relative.
  assert.ok(Math.abs(EL_J.a - f('A')) / f('A') < 2e-7);
  assert.ok(A_J > 5.19 && A_J < 5.21, `a_J ${A_J}`);
  assert.equal(A_J, D.jupiter.aAu, 'the shipped a_J is the one recomputed here');
});

test('ORACLE SBDB: the ecliptic form reproduces JPL\'s published t_jup for all 308 sample rows; the Jupiter-plane form does not', () => {
  const ix = Object.fromEntries(ORACLE.sampleFields.map((f, k) => [f, k]));
  const rad = Math.PI / 180;
  let eclOk = 0;
  let jupOk = 0;
  let worst = 0;
  for (const r of ORACLE.sample) {
    const a = Number(r[ix.a]);
    const e = Number(r[ix.e]);
    const iRad = Number(r[ix.i]) * rad;
    const t = Number(r[ix.t_jup]);
    const ecl = G.tisserand(a, e, Math.cos(iRad), A_J);
    worst = Math.max(worst, Math.abs(ecl - t));
    if (Math.abs(ecl - t) <= 0.0005 + 1e-9) eclOk++;
    const p = G.poleFromAngles(iRad, Number(r[ix.om]) * rad);
    const jup = G.tisserand(a, e, p[0] * EL_J.pole[0] + p[1] * EL_J.pole[1] + p[2] * EL_J.pole[2], A_J);
    if (Math.abs(jup - t) <= 0.0005 + 1e-9) jupOk++;
  }
  // At this deposit's a_J (vis-viva, 3e-5 AU above SBDB's) every row is within 0.0006 of SBDB.
  assert.ok(worst < 0.0006, `worst ${worst}`);
  assert.ok(eclOk >= 300, `ecliptic form within rounding for ${eclOk} of ${ORACLE.sample.length}`);
  assert.ok(jupOk < ORACLE.sample.length / 2, `Jupiter-plane form within rounding for ${jupOk}`);
  // At an a_J inside the interval the oracle found, every sample row is within SBDB's rounding.
  const aj = ORACLE.eclipticAJInterval.lo;
  assert.ok(aj !== null && Math.abs(aj - A_J) < 1e-4);
  for (const r of ORACLE.sample) {
    const v = G.tisserand(Number(r[ix.a]), Number(r[ix.e]), Math.cos(Number(r[ix.i]) * rad), aj);
    assert.ok(Math.abs(v - Number(r[ix.t_jup])) <= 0.0005 + 1e-9, `${r[ix.pdes]}: ${v} vs ${r[ix.t_jup]}`);
  }
});

test('ORACLE SBDB: T_J of 433 Eros and 1P/Halley from their catalog records against SBDB\'s t_jup', () => {
  const ix = Object.fromEntries(ORACLE.sampleFields.map((f, k) => [f, k]));
  const sb = Object.fromEntries(ORACLE.sample.map((r) => [r[ix.pdes], r]));
  // Eros: hand-worked from its stored a, e, i (ecliptic), then through derive().
  const eros = LANDMARKS['asteroid-433'];
  const a = eros.elements.aKm / AU_KM;
  const byHand = A_J / a + 2 * Math.cos(eros.elements.iRad) * Math.sqrt((a / A_J) * (1 - eros.elements.e ** 2));
  const d = G.derive(eros, CTX);
  assert.ok(Math.abs(d.TJe - byHand) < 1e-12);
  // SBDB's elements are at 2026-06-09, the catalog's at 2026-05-01; Eros barely moves.
  assert.ok(Math.abs(d.TJe - Number(sb['433'][ix.t_jup])) < 0.001, `Eros ${d.TJe} vs SBDB ${sb['433'][ix.t_jup]}`);
  assert.ok(Math.abs(d.TJ - d.TJe) > 0.003, 'the two conventions differ visibly for Eros');
  // Halley: the catalog and SBDB carry the same 1968 epoch, so the ecliptic form matches to rounding.
  const halley = G.derive(LANDMARKS['asteroid-1P'], CTX);
  assert.equal(Number(sb['1P'][ix.epoch]), LANDMARKS['asteroid-1P'].elements.epochTdbJd);
  assert.ok(Math.abs(halley.TJe - Number(sb['1P'][ix.t_jup])) <= 0.0006, `Halley ${halley.TJe}`);
  assert.ok(Math.abs(halley.TJ - Number(sb['1P'][ix.t_jup])) > 0.004, 'the Jupiter-plane form misses SBDB for Halley');
});

test('ORACLE SBDB records: 2008 TC3 and 2014 AA have orbits SBDB marks invalid after an Earth encounter inside Earth\'s radius', () => {
  for (const des of ['2008 TC3', '2014 AA']) {
    const sb = json(`snapshots/sbdb-${des.replace(' ', '-')}.json`);
    const o = sb.orbit;
    assert.equal(sb.object.des, des);
    assert.ok(o.not_valid_after, `${des}: SBDB gives not_valid_after`);
    const moidKm = Number(o.moid) * AU_KM;
    assert.ok(moidKm < EARTH_R_KM, `${des}: Earth MOID ${moidKm} km vs Earth radius ${EARTH_R_KM} km`);
    const q = Number(o.elements.find((x) => x.name === 'q').value);
    const rec = LANDMARKS[`asteroid-${des}`];
    const d = G.derive(rec, CTX);
    assert.ok(Number(o.epoch) < rec.elements.epochTdbJd, 'the catalog epoch is after the SBDB orbit stops being valid');
    assert.ok(d.q - q > 1.5, `${des}: catalog q ${d.q} vs SBDB q ${q}`);
    assert.equal(rec.orbitClass, 'APO', 'stored class is the pre-encounter one');
    assert.equal(G.classFromElements(d.aAu, d.q, d.aAu * (1 + d.e), RULE), 'AMO', 'the stored elements say Amor');
    assert.equal(rec.anchorSource, 'horizons-reanchor');
  }
  const shipped = D.sbdbRecords.map((r) => [r.des, r.moidBelowEarthRadius]);
  assert.deepEqual(shipped, [['2008 TC3', true], ['2014 AA', true]]);
});

// ---------------------------------------------------------------- the shipped bins against the fixture and Aster's documents

test('every panel of every atom sums to its n, and the atoms sum to the header\'s 41,906', () => {
  assert.equal(D.specSignature, G.specSignature(), 'bins were made under the current bin specs');
  for (const a of D.atoms) {
    const dense = G.summarize([a], {});
    for (const s of G.SPECS) assert.equal(G.sum(dense.h[s.key]), a.n, `${a.cls}|${a.tier}|${a.fid} ${s.key}`);
    for (const c of G.CATS) assert.equal(G.sum(dense.h[c.key]), a.n, `${a.cls}|${a.tier}|${a.fid} ${c.key}`);
    assert.ok(G.sum(dense.grid) <= a.n);
  }
  assert.equal(ALL.n, HEADER.totalBodies);
  assert.equal(HEADER.totalBodies, 41906);
});

test('class, inv014Tier and Slice 18 tier counts equal the fixture header, the tier artifact and the founding document', () => {
  for (const [cls, n] of Object.entries(HEADER.classDistribution)) assert.equal(count({ cls }), n, cls);
  for (const [tier, n] of Object.entries(HEADER.inv014TierDistribution)) assert.equal(count({ tier }), n, tier);
  for (const t of ['L0', 'L1', 'L2']) assert.equal(count({ fid: t }), TIERS[t], t);
  assert.equal(count({ fid: 'L0' }), firstNumber(D.quotes.s18L0.text));
  assert.equal(count({ fid: 'L1' }), firstNumber(D.quotes.s18L1.text));
  assert.equal(count({ fid: 'L2' }), firstNumber(D.quotes.s18L2.text));
  assert.equal(count({ cls: ['ETC', 'HTC', 'JFC'] }), HEADER.anomalyTailCount);
  assert.equal(count({ tier: 'planning-tier' }), 0, 'the spec says planning-tier stays 0 in Slice 9');
});

test('Slice 18\'s structurally blind 688 = 482 NEA-class Q >= 4.95 AU + 206 comets, and STATUS.md\'s "26 of the 206"', () => {
  const qs = spec('Q');
  const nea = ['APO', 'AMO', 'ATE', 'IEO'];
  const jx = grab(snap('tier-sizing.mjs'), /^const JUPITER_PERIHELION_AU = ([\d.]+);/m, 'Jupiter-crossing Q');
  const neaL2 = G.summarize(D.atoms, { cls: nea, fid: 'L2' });
  const tailL2 = G.summarize(D.atoms, { cls: ['ETC', 'HTC', 'JFC'], fid: 'L2' });
  const crossing = G.countAtOrAbove(qs, neaL2.h.Q, jx);
  const blind = /Structurally blind = (\d+)\*\* — unchanged \((\d+) comets \+ (\d+) Jupiter-crossing\)/.exec(D.quotes.s18Blind.text);
  assert.equal(crossing + tailL2.n, Number(blind[1]));
  assert.equal(tailL2.n, Number(blind[2]));
  assert.equal(crossing, Number(blind[3]));
  const st = /(\d+) of the (\d+) structurally-blind comets have Q < ([\d.]+) AU/.exec(D.quotes.statusComets.text);
  assert.equal(G.countBelow(qs, tailL2.h.Q, Number(st[3])), Number(st[1]));
  assert.equal(tailL2.n, Number(st[2]));
  assert.throws(() => G.countAtOrAbove(qs, ALL.h.Q, 1.01), /not a bar edge/);
  assert.throws(() => G.countBelow(qs, ALL.h.Q, 1.01), /not a bar edge/);
});

test('null census: the header\'s missing-H count, the spec\'s null rules and the pre-research report\'s "missing" rows', () => {
  const nulls = Object.fromEntries(D.census.keyPaths.map((k) => [k.path, k.nulls]));
  assert.equal(nulls.H, HEADER.missingAbsoluteMagnitudeCount);
  assert.equal(nulls.G, HEADER.totalBodies, 'G is null for every body (spec: the bulk SBDB query does not include it)');
  assert.equal(nulls.estimatedRadiusM, nulls.H, 'estimatedRadiusM must be null when H is null');
  const pre = D.prereport;
  assert.equal(nulls.conditionCode, pre.u.rows.find((r) => r.key === 'missing').count);
  assert.equal(nulls.dataArcDays, pre.arc.rows.find((r) => r.key === 'missing').count);
  assert.equal(nulls.sigmaA, nulls.sigmaE);
  assert.deepEqual([nulls.G, nulls.H, nulls.dataArcDays, nulls.sigmaA, nulls.conditionCode], [41906, 210, 417, 137, 10]);
  for (const k of D.census.keyPaths) assert.equal(k.present, 41906, `${k.path} present in every record`);
  for (const w of D.wanted) assert.deepEqual(w.found, [], `${w.field}: no key path carries it`);
  // the same nulls, recounted from the histograms' own null bars
  const nullBar = (k) => ALL.h[k][G.bars(spec(k)).findIndex((b) => b.kind === 'null')];
  assert.equal(nullBar('H'), nulls.H);
  assert.equal(nullBar('U'), nulls.conditionCode);
  assert.equal(nullBar('arc'), nulls.dataArcDays);
  assert.equal(nullBar('sigmaA'), nulls.sigmaA);
});

test('the pre-research report\'s condition-code table differs from the fixture by exactly 41,906 - 41,902 bodies', () => {
  const pre = D.prereport;
  const reportN = Number(/`([\d,]+)`/.exec(D.quotes.prereportCount.text)[1].replace(/,/g, ''));
  assert.equal(reportN, 41902);
  const reportSum = pre.u.rows.reduce((s, r) => s + r.count, 0);
  assert.equal(reportSum, reportN, 'the report\'s U table sums to its own NEA count');
  // our U histogram (with its null bar) against the report, row by row
  const uBars = G.bars(spec('U'));
  let diff = 0;
  for (const r of pre.u.rows) {
    const k = r.key === 'missing' ? uBars.findIndex((b) => b.kind === 'null') : Number(r.key);
    const d = ALL.h.U[k] - r.count;
    assert.ok(d >= 0, `U ${r.key}: the fixture has ${d} fewer than the report`);
    diff += d;
  }
  assert.equal(diff, HEADER.totalBodies - reportN);
  const arcDiff = pre.ours.arcLeftClosed.reduce((s, x, k) => s + x.count - pre.arc.rows[k].count, 0) + pre.ours.arcMissing - pre.arc.rows[5].count;
  assert.equal(arcDiff, HEADER.totalBodies - reportN);
});

test('stored-class check: 82 disagreements, all re-anchored; landmark classes agree except the two re-anchored past an encounter', () => {
  assert.equal(D.classCheck.disagreements.length, 82);
  assert.deepEqual(D.classCheck.byAnchor, { 'horizons-reanchor': 82 });
  assert.deepEqual(D.classCheck.disagreements.slice(0, 2).map((r) => r.des), ['2008 TC3', '2014 AA']);
  assert.ok(D.classCheck.disagreements.slice(2).every((r) => r.margin < 0.1));
  for (const des of ['433', '101955', '99942', '163693', '152637', '2017 UR52']) {
    const b = LANDMARKS[`asteroid-${des}`];
    const d = G.derive(b, CTX);
    assert.equal(d.classFromElements, b.orbitClass, des);
    assert.equal(d.bandFromE, b.eccentricityBand, `${des} band`);
  }
});

test('the a-e grid holds every body with 0 <= a < 6 AU and e < 1, and nothing else', () => {
  // count the off-grid bodies from the 1-D histograms: a >= 6 AU (overflow bars) or hyperbolic
  const aBars = G.bars(spec('a'));
  const offA = aBars.reduce((s, b, k) => s + (b.kind === 'over' || b.kind === 'neg' ? ALL.h.a[k] : 0), 0);
  assert.equal(G.sum(ALL.grid), ALL.n - offA);
  const off = Object.values(LANDMARKS).filter((b) => G.gridIndex(b.elements.aKm / AU_KM, b.elements.e) < 0).map((b) => b.designation);
  assert.deepEqual(off.sort(), ['1P', '2015 D1', '2017 UR52'], 'Halley (a 17.9 AU), the hyperbolic SOHO comet and 2017 UR52 (a 353 AU) are off the grid');
});

test('the live Aster checkout re-derives bins.data.js byte for byte', { skip: !fs.existsSync(path.join(ASTER, 'tests/fixtures/v2/nea-catalog-slice9.json')) && 'no Aster checkout' }, () => {
  const out = execFileSync(process.execPath, [path.join(here, 'build-data.mjs'), '--check', '--aster', ASTER], { encoding: 'utf8' });
  assert.match(out, /matches a fresh derivation byte for byte/);
});
