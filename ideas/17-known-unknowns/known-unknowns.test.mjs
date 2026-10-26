// Tests for Known Unknowns. Run from the bank root:
//   node --test ideas/17-known-unknowns/known-unknowns.test.mjs
// Groups: (A) the snapshots and their sidecars; (B) numbers pinned to sources outside this
// folder's code (Aster's founding documents, its fixtures, idea 10's census, hand-worked closed
// forms); (C) kernel properties and synthetic cases; (D) page source; (E) the CLI; (F) against the
// live Aster checkout, skipped when /home/user/asteroid-mining-planner is absent.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const K = require('./model.js');
const S = require('./snapshots/study.data.js');
const snap = (f) => path.join(here, 'snapshots', f);
const read = (f) => fs.readFileSync(path.join(here, f), 'utf8');
const ASTER = process.env.ASTER_DIR || '/home/user/asteroid-mining-planner';
const haveAster = fs.existsSync(path.join(ASTER, '.git')) && fs.existsSync(path.join(ASTER, 'tests/fixtures/v2/nea-catalog-slice9.json'));
const k = S.constants;
const CLI = path.join(here, 'known-unknowns.mjs');
const runCli = (args) => spawnSync('node', [CLI, ...args], { encoding: 'utf8', timeout: 120000 });

// ------------------------------------------------------------------ (A) snapshots
test('A1 every snapshot hashes to its sidecar, and all sidecars name one Aster commit', () => {
  const files = fs.readdirSync(snap('.')).filter((f) => !f.endsWith('.provenance.json'));
  assert.ok(files.length >= 9, `expected the nine snapshots, found ${files.length}`);
  const commits = new Set();
  for (const f of files) {
    const side = JSON.parse(fs.readFileSync(snap(`${f}.provenance.json`), 'utf8'));
    const sha = crypto.createHash('sha256').update(fs.readFileSync(snap(f))).digest('hex');
    assert.equal(sha, side.writtenSha256, `${f} does not hash to its sidecar`);
    assert.equal(side.readMatchesCommitted, true, `${f}: read bytes differ from the committed blob`);
    assert.match(side.repo, /asteroid-mining-planner/);
    commits.add(side.commit);
  }
  assert.deepEqual([...commits], [S.aster.commit]);
  const derived = JSON.parse(fs.readFileSync(snap('study.data.js.provenance.json'), 'utf8'));
  assert.equal(derived.mode, 'derived');
  assert.equal(derived.sourceSha256, S.inputs.catalog.sha256, 'the derived file names the catalog it came from');
});

test('A2 the metadata and catalog-header excerpts are what the study used', () => {
  assert.deepEqual(JSON.parse(fs.readFileSync(snap('cache-metadata.json'), 'utf8')).metadata, S.metadata);
  assert.deepEqual(JSON.parse(fs.readFileSync(snap('catalog-header.json'), 'utf8')), S.catalogHeader);
  assert.equal(S.metadata.provenance.catalogFixtureSha256, S.inputs.catalog.sha256, 'the cache was built from this catalog');
  assert.equal(S.inputs.cacheBuiltFromThisCatalog, true);
  assert.deepEqual(S.ours, K.OURS, 'the bands the data was binned with are the bands model.js labels');
  assert.deepEqual(S.list.columns, K.LIST_COLUMNS);
});

test('A3 each Aster constant equals the snapshotted source line it was read from', () => {
  const at = (file, line) => fs.readFileSync(snap(file), 'utf8').split('\n')[line - 1];
  const cs = S.constantSources;
  assert.equal(cs.nearZeroC3.path, 'src/v2/core/constants/near-zero-c3.ts');
  assert.equal(at('near-zero-c3.ts', cs.nearZeroC3.line), `export const NEAR_ZERO_C3_DEGENERACY_THRESHOLD_KM2_S2 = ${k.nearZeroC3};`);
  assert.equal(at('colormap.ts', cs.c3ColorMin.line), `export const C3_COLOR_MIN = ${k.c3ColorMin};`);
  assert.equal(at('utc-to-tdb.ts', cs.tdbMinusUtcSeconds.line), `export const TDB_MINUS_UTC_SECONDS = ${k.tdbMinusUtcSeconds};`);
  assert.equal(k.feasibleC3Max, S.metadata.feasibleC3MaxKm2S2);
  const spec = fs.readFileSync(snap('nea-catalog-slice9.spec.md'), 'utf8').split('\n');
  assert.deepEqual(S.formulas.spec.lines, spec.slice(S.formulas.spec.line - 1, S.formulas.spec.lineEnd).map((l) => l.replace(/\s+/g, ' ').trim()));
  assert.equal(S.formulas.fixtureString.text, S.catalogHeader.catalog.qualityRankFormula);
  const env = fs.readFileSync(snap('envelope-schema.ts'), 'utf8');
  const codes = /code: z\.enum\(\[([^\]]+)\]\)/.exec(env)[1].split(',').map((x) => x.trim().replace(/'/g, ''));
  assert.deepEqual(S.quotes.refusalCodes.codes, codes);
  const impl = fs.readFileSync(snap('derived-fields.mjs'), 'utf8');
  assert.match(impl, /clamp01\(1 - record\.conditionCode \/ 9\)/, 'the implementation clamps the condition score');
  assert.match(impl, /clamp01\(Math\.log10\(1 \+ record\.dataArcDays\) \/ Math\.log10\(1001\)\)/, 'and the arc score');
});

// ------------------------------------------------------------------ (B) external pins
test('B1 the condition-code distribution is the one three independent judges counted', () => {
  // proposal 17's judges each reproduced this from the fixture before it was built
  assert.deepEqual(S.headline.uDistribution, { 0: 8470, 1: 1705, 2: 651, 3: 477, 4: 1189, 5: 2468, 6: 5110, 7: 9587, 8: 8958, 9: 3281, null: 10 });
  const u = K.uMarginal(S.hists.byArc);
  assert.deepEqual(u, [8470, 1705, 651, 477, 1189, 2468, 5110, 9587, 8958, 3281, 10]);
  assert.equal(u.reduce((a, b) => a + b, 0), S.catalogHeader.catalog.totalBodies);
  assert.equal(S.metadata.catalogSize, 41906);
  assert.equal(S.headline.uHighlyUncertain, 9587 + 8958 + 3281);
});

test('B2 screening status counts are the ones Aster recorded at Slice 10 and Slice 16', () => {
  // src/v2/SLICE_10_FOUNDING.md:460-464 (41422 / 483 / 0 / 1; co-orbital 130);
  // src/v2/SLICE_16_APPENDIX_A_LOCKED.md:874-877 (search_bodies total 41422 for low_departure_c3)
  const c = K.c3Marginal(S.hists.byArc);
  assert.equal(c[0] + c[1] + c[2] + c[3], 41422);
  assert.equal(c[K.C3_HIGH], 483);
  assert.equal(c[K.C3_NONE], 1);
  assert.deepEqual(S.headline.status, { low_departure_c3: 41422, high_departure_c3: 483, propagator_failed: 1 });
  assert.equal(S.headline.coOrbital, 130);
});

test('B3 the tier join reproduces Slice 18 populations (C-4: L0 11, L1 10,150, L2 31,745)', () => {
  assert.deepEqual(S.headline.tierCounts, { L0: 11, L1: 10150, L2: 31745 });
  for (const t of ['L0', 'L1', 'L2']) assert.equal(S.headline.tierCounts[t], S.headline.tierPopulations[t]);
  assert.equal(S.encounter.l1WithWindow, 10150);
});

test('B4 cheapest-window lattice edges match idea 10 (Edge of the Grid) exactly', () => {
  // ideas/10-edge-of-the-grid/README.md:2 and :16 — 783 x 55 lattice; floor 2,530, first 218,
  // last 165, ceiling 34 (the 1,802-day row), 2,936 on any edge, of 41,905 bodies with windows
  assert.deepEqual(S.edgeCounts, { floor: 2530, ceiling: 34, first: 218, last: 165, any: 2936, withWindow: 41905 });
  const lat = K.lattice(S.metadata);
  assert.equal(lat.columns, 783);
  assert.equal(lat.rows, 55);
  assert.equal(lat.tofCeiling, 1802);
  assert.equal(lat.lastDeparture, '2040-12-27');
  assert.deepEqual(lat, S.lattice);
});

test('B5 Eros reads exactly the cell DEC-18-1 recomputed; Apophis is the near-zero case DEC-19-1 names', () => {
  // src/v2/SLICE_18_FOUNDING.md:53: "the cached Eros cell (minC3 1.6244339770173506, 2032-06-10, TOF 272 d)"
  const e = S.reference.eros;
  assert.equal(e.c3, 1.6244339770173506);
  assert.equal(e.launchDate, '2032-06-10');
  assert.equal(e.tofDays, 272);
  assert.equal(K.addDays(e.launchDate, e.tofDays), '2033-03-09', 'June 10 + 272 days, counted by hand');
  const a = S.reference.apophis;
  assert.ok(a.c3 < k.nearZeroC3, 'Apophis is flagged near-zero');
  assert.equal(K.flagsFor(a, k, S.lattice, S.aster.asOf).nearZero, true);
  assert.equal(a.tier, 'L1');
});

test('B6 the catalog header agrees with the cross-tabs (missing H, missing arc, planning-tier 0)', () => {
  const hView = K.crossTab(S.hists, 'H');
  assert.equal(hView.rows.find((r) => r.unknown).total, S.catalogHeader.catalog.missingAbsoluteMagnitudeCount);
  const arcView = K.crossTab(S.hists, 'arc');
  assert.equal(arcView.rows.find((r) => r.unknown).total, S.headline.bodies - S.headline.arcReported);
  assert.equal(S.catalogHeader.catalog.inv014TierDistribution['planning-tier'], 0);
  assert.equal(S.headline.arcMedianDays, 22);
});

test('B7 qualityRank: closed forms, the spec against the stored values, and the string that disagrees', () => {
  assert.equal(K.qualityRankSpec(9, 94131), 0.4);
  const raw = Math.log10(94132) / Math.log10(1001);
  assert.ok(Math.abs(K.qualityRankLiteral(9, 94131) - 0.4 * raw) < 1e-15);
  assert.ok(Math.abs(K.qualityRankLiteral(9, 94131) - 0.66307) < 1e-5, 'hand-computed 0.4 x 4.97373 / 3.00043');
  assert.equal(K.qualityRankSpec(null, null), 0);
  assert.ok(Math.abs(K.qualityRankSpec(0, null) - 0.6) < 1e-15);
  assert.equal(K.qualityRankSpec(0, 1000), 1);
  for (let u = 0; u <= 9; u++) for (const d of [0, 1, 30, 999, 1000]) assert.equal(K.qualityRankSpec(u, d), K.qualityRankLiteral(u, d), `the readings agree at arc ${d}`);
  assert.ok(K.qualityRankLiteral(1, 5000) > K.qualityRankSpec(1, 5000), 'and part above 1000 days unless U is 0');
  assert.equal(K.qualityRankLiteral(0, 5000), K.qualityRankSpec(0, 5000));
  const count = (s) => (s.match(/clamp01\(/g) || []).length;
  assert.equal(count(S.formulas.fixtureString.text), 1, 'the fixture string clamps once');
  assert.equal(count(S.formulas.spec.lines.join(' ')), 3, 'the spec clamps three times');
  const A = S.qualityAudit;
  assert.equal(A.n, 41906);
  assert.ok(A.maxAbsSpecMinusStored <= 5e-7, 'stored values are the spec rounded to 6 decimals');
  assert.equal(A.overTolerance, 0);
  assert.equal(A.literalDisagrees, 1856);
  assert.equal(A.worstLiteral.designation, '55P');
  assert.equal(A.worstLiteral.u, null);
  assert.ok(Math.abs(A.worstLiteral.literal - 0.4 * (Math.log10(1 + A.worstLiteral.arc) / Math.log10(1001))) < 1e-12);
});

test('B8 Spearman, median, dates and bands on hand-worked cases', () => {
  assert.ok(Math.abs(K.spearman([1, 2, 3, 4, 5], [2, 1, 4, 3, 5]) - 0.8) < 1e-12, '1 - 6*4/(5*24)');
  assert.ok(Math.abs(K.spearman([1, 2, 2, 3], [1, 2, 3, 4]) - 4.5 / Math.sqrt(22.5)) < 1e-12, 'tied ranks averaged');
  assert.equal(K.spearman([1, 2, 3, 4], [8, 6, 4, 2]), -1);
  assert.equal(K.spearman([1, 1, 1], [1, 2, 3]), null);
  assert.deepEqual(K.ranks([10, 20, 20, 5]), [2, 3.5, 3.5, 1]);
  assert.equal(K.median([3, 1, 2]), 2);
  assert.equal(K.median([4, 1, 3, 2]), 2.5);
  assert.equal(K.jdFromIsoDate('2000-01-01'), 2451544.5);
  assert.equal(K.addDays('2028-02-28', 1), '2028-02-29');
  const b = (x) => K.c3Band(x, k);
  assert.deepEqual([b(0), b(0.0999), b(k.nearZeroC3), b(0.5), b(k.c3ColorMin), b(k.c3FirstContour), b(k.feasibleC3Max), b(k.feasibleC3Max + 1e-9), b(null), b(NaN)], [0, 0, 1, 1, 2, 3, 3, 4, 5, 5]);
  assert.equal(K.binIndex(29, K.OURS.arcEdgesDays), K.OURS.arcEdgesDays.indexOf(21));
  assert.equal(K.binIndex(30, K.OURS.arcEdgesDays), K.OURS.arcEdgesDays.indexOf(30));
  assert.equal(K.binIndex(null, K.OURS.arcEdgesDays), K.OURS.arcEdgesDays.length);
  assert.deepEqual([K.hIndex(17.99), K.hIndex(18), K.hIndex(26), K.hIndex(null)], [0, 1, 5, 6]);
  assert.throws(() => K.uIndex(10));
});

test('B9 the support boundary counts TDB: arrival at UTC midnight + 69.184 s + TOF', () => {
  const kk = { tdbMinusUtcSeconds: k.tdbMinusUtcSeconds };
  const jd0 = K.jdFromIsoDate('2030-01-01');
  const enc = jd0 + 100 + 30 / 86400; // 30 s after the UTC-midnight arrival, 39.184 s before the TDB one
  assert.equal(K.arrivalAfterEncounter('2030-01-01', 100, enc, kk), true);
  assert.equal(K.arrivalAfterEncounter('2030-01-01', 100, enc, { tdbMinusUtcSeconds: 0 }), false);
  assert.equal(K.arrivalAfterEncounter('2030-01-01', 100, jd0 + 100 + k.tdbMinusUtcSeconds / 86400, kk), true, 'at the encounter counts as after (>=)');
  assert.equal(K.arrivalAfterEncounter('2030-01-01', 100, null, kk), null);
  assert.ok(Math.abs(S.encounter.minMarginSeconds) > k.tdbMinusUtcSeconds, 'no catalog arrival sits inside the offset');
  assert.deepEqual(S.encounter.decidedByTdbOffset, []);
});

// ------------------------------------------------------------------ (C) kernel properties
test('C1 the three histograms partition the catalog and share one C3 x U marginal', () => {
  for (const h of ['byArc', 'byObs', 'byH']) assert.equal(K.sum3(S.hists[h]), 41906, h);
  assert.deepEqual(K.c3ByU(S.hists.byObs), K.c3ByU(S.hists.byArc));
  assert.deepEqual(K.c3ByU(S.hists.byH), K.c3ByU(S.hists.byArc));
  for (const v of ['U', 'arc', 'obs', 'H']) {
    const ct = K.crossTab(S.hists, v);
    assert.equal(ct.grandTotal, 41906, v);
    assert.deepEqual(ct.colTotals, K.c3Marginal(S.hists.byArc), v);
    for (const r of ct.rows) assert.equal(r.cells.reduce((a, b) => a + b, 0), r.total);
  }
});

test('C2 the what-if filter partitions the low-C3 population and is monotone; one cell recounted by brute force', () => {
  const E = K.OURS.arcEdgesDays;
  const grid = K.survivorGrid(S.hists.byArc);
  for (let u = 0; u <= 9; u++) {
    for (let d = 0; d < E.length; d++) {
      const s = K.survivors(S.hists.byArc, u, d);
      assert.equal(s.population, 41422);
      assert.equal(s.survive + s.dropU + s.dropArc + s.dropBoth + s.unknownU + s.unknownArc, s.population);
      assert.equal(s.surviveByBand.reduce((a, b) => a + b, 0), s.survive);
      if (d > 0) assert.ok(grid[u][d] <= grid[u][d - 1], `monotone in arc at u ${u}`);
      if (u > 0) assert.ok(grid[u][d] >= grid[u - 1][d], `monotone in U at d ${d}`);
    }
  }
  // brute force, without the kernel: U <= 6 and arc >= 30 d over bands 0-3
  const i30 = E.indexOf(30);
  let n = 0;
  for (let b = 0; b <= 3; b++) for (let u = 0; u <= 6; u++) for (let a = i30; a < E.length; a++) n += S.hists.byArc[b][u][a];
  assert.equal(K.survivors(S.hists.byArc, 6, i30).survive, n);
  assert.equal(n, 16381);
  const all = K.survivors(S.hists.byArc, 9, 0);
  assert.equal(all.survive, 41422 - all.unknownU - all.unknownArc);
  assert.throws(() => K.survivors(S.hists.byArc, 10, 0));
});

test('C3 the list: count agrees with the histogram, rankings are ordered, criteria hold on every shipped row', () => {
  const L = S.list;
  assert.equal(L.total, K.listCountFromHist(S.hists.byArc, k));
  assert.equal(L.total, 20296);
  const rows = L.rows.map(K.rowFromArray);
  for (const key of ['H', 'c3']) {
    const r = L.rankings[key].map((i) => rows[i]);
    assert.equal(r.length, Math.min(L.top, L.total));
    for (const x of r) assert.ok(K.inList(x, k), `${x.des} meets the criterion`);
    for (let i = 1; i < r.length; i++) assert.ok(K.SORTS[key](r[i - 1], r[i]) < 0, `${key} ranking ordered at ${i}`);
  }
  const c3r = L.rankings.c3.map((i) => rows[i]);
  assert.ok(L.firstNotNearZeroRankByC3 - 1 >= L.top, 'the whole minimum-C3 top list is near-zero');
  assert.ok(c3r.every((r) => r.c3 < k.nearZeroC3));
  assert.equal(L.firstNotNearZeroRankByC3 - 1, L.flagTotals.nearZero, 'the near-zero rows are exactly the head of the C3 ranking');
  const hr = L.rankings.H.map((i) => rows[i]);
  assert.equal(hr[0].des, '2025 NR197');
  assert.ok(hr.some((r) => r.des === '1979 XB'));
  assert.deepEqual(K.rowFromArray(K.rowToArray(rows[0])), rows[0]);
});

test('C4 the reversal the page leads with: negative catalog-wide, positive in every H band', () => {
  const s = S.stratified;
  assert.ok(s.all.rhoU < 0 && s.all.rhoArc > 0);
  assert.ok(s.all.uncertain.medianC3 < s.all.tight.medianC3);
  assert.ok(s.all.rhoHc3 < 0 && s.all.rhoHU > 0);
  for (const b of s.bands) {
    assert.ok(b.rhoU > 0, `${b.label}: rho(U, C3) > 0`);
    assert.ok(b.uncertain.medianC3 > b.tight.medianC3, `${b.label}: U >= 7 median above U <= 2 median`);
  }
  assert.equal(s.bands.reduce((a, b) => a + b.n, 0) + s.hUnknownWithC3, s.all.n);
  assert.equal(s.all.n, 41905);
  // the same function on a constructed Simpson's paradox
  const rows = [];
  // bright band: mostly U 0 at C3 ~8, a few U 9 at ~9; faint band: a few U 0 at ~0.5, mostly U 9 at ~1
  for (let i = 0; i < 30; i++) rows.push({ H: 18.5, u: 0, arc: 10, c3: 8 + i / 100 });
  for (let i = 0; i < 5; i++) rows.push({ H: 18.5, u: 9, arc: 10, c3: 9 + i / 100 });
  for (let i = 0; i < 5; i++) rows.push({ H: 26.5, u: 0, arc: 10, c3: 0.5 + i / 100 });
  for (let i = 0; i < 30; i++) rows.push({ H: 26.5, u: 9, arc: 10, c3: 1 + i / 100 });
  const z = K.stratify(rows, k);
  assert.ok(z.all.rhoU < 0, 'pooled: higher U, lower C3');
  const used = z.bands.filter((b) => b.n);
  assert.ok(used.length === 2 && used.every((b) => b.rhoU > 0), 'within each band: higher U, higher C3');
});

test('C5 histograms and cross-tabs on a five-body hand example', () => {
  const rows = [
    { u: 0, arc: 5000, nObs: 900, H: 17, c3: 3 },
    { u: 7, arc: 2, nObs: 12, H: 25, c3: 0.05 },
    { u: 7, arc: null, nObs: 4, H: null, c3: 0.5 },
    { u: null, arc: 40, nObs: 60, H: 22.5, c3: 30 },
    { u: 9, arc: 29, nObs: 20, H: 26, c3: null },
  ];
  const h = K.buildHistograms(rows, k);
  const ct = K.crossTab(h, 'U');
  assert.deepEqual(ct.rows.find((r) => r.key === '7').cells, [1, 1, 0, 0, 0, 0]);
  assert.deepEqual(ct.rows.find((r) => r.key === 'null').cells, [0, 0, 0, 0, 1, 0]);
  assert.deepEqual(ct.rows.find((r) => r.key === '9').cells, [0, 0, 0, 0, 0, 1]);
  const arc = K.crossTab(h, 'arc');
  assert.equal(arc.rows.find((r) => r.label === '≥ 3653 d').total, 1);
  assert.equal(arc.rows.find((r) => r.unknown).total, 1);
  assert.equal(K.listCountFromHist(h.byArc, k), 2, 'the two U 7 bodies: arc 2 d, and arc not reported');
  assert.equal(rows.filter((r) => K.inList(r, k)).length, 2);
  // the list criterion at its edges: U >= 7, arc < 30 d or none, low departure C3 with near-zero kept
  const L = (u, arc, c3) => K.inList({ u, arc, c3 }, k);
  assert.deepEqual([L(7, 29, 1), L(7, 30, 1), L(6, 1, 1), L(9, null, 1), L(null, 1, 1), L(7, 1, 0.001), L(7, 1, k.feasibleC3Max), L(7, 1, 30), L(7, 1, null)], [true, false, false, true, false, true, true, false, false]);
  const s = K.survivors(h.byArc, 9, 0);
  assert.deepEqual([s.population, s.survive, s.unknownU, s.unknownArc], [3, 2, 0, 1]);
});

// ------------------------------------------------------------------ (D) page source
test('D1 the page types no Aster threshold and none of the headline counts', () => {
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const f of ['model.js', 'app.js']) {
    const src = strip(read(f));
    assert.doesNotMatch(src, /(?<![\w.])25(?![\w.])/, `${f} must read the screening threshold from metadata`);
    assert.doesNotMatch(src, /(?<![\w.])0\.1(?![\w.\d])/, `${f} must read the near-zero threshold from Aster's constant`);
    assert.doesNotMatch(src, /69\.184|(?<![\w.])7\)/, `${f} must not type TDB-UTC or the U cutoff`);
  }
  const page = read('app.js') + read('index.html');
  for (const n of ['41906', '41,906', '41422', '41,422', '20296', '20,296', '21826', '21,826', '1856', '1,856', '3163', '3,163', '16,381', '2026-10-25', '62ddb17']) {
    assert.ok(!page.includes(n), `page source types ${n}`);
  }
  assert.doesNotMatch(page, /planning[ -]tier/i, 'the slider is never called a planning tier except in the quote from data');
  const html = read('index.html');
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.doesNotMatch(html, /(src|href)="https?:/, 'no external scripts or styles');
});

// ------------------------------------------------------------------ (E) the CLI
test('E1 CLI usage: --help exits 0; bad options exit 3', () => {
  const h = runCli(['--help']);
  assert.equal(h.status, 0);
  assert.match(h.stdout, /Usage: node ideas\/17-known-unknowns\/known-unknowns\.mjs/);
  assert.equal(runCli(['--bogus']).status, 3);
  assert.equal(runCli(['--u', '10', '--arc', '30']).status, 3);
  assert.equal(runCli(['--u', '6', '--arc', '29']).status, 3, 'the arc must be one of the bin edges');
  assert.equal(runCli(['--sort', 'name']).status, 3);
});

// ------------------------------------------------------------------ (F) live checkout
test('F1 a fresh derivation from the checkout equals the snapshot, and example.txt is the CLI output', { skip: !haveAster && 'Aster checkout absent' }, () => {
  const chk = runCli(['--aster', ASTER, '--check']);
  assert.equal(chk.status, 0, chk.stdout + chk.stderr);
  assert.match(chk.stdout, /snapshot is current/);
  const run = runCli(['--aster', ASTER]);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, read('example.txt'), 'example.txt is stale');
  assert.match(run.stdout, /reconciliation: all joins/);
});

test('F2 --body emits envelopes that fit Aster’s schema; an unknown designation is a not_found refusal', { skip: !haveAster && 'Aster checkout absent' }, () => {
  const r = runCli(['--aster', ASTER, '--body', '1979 XB', '--json']);
  assert.equal(r.status, 0, r.stderr);
  const { row, plan } = JSON.parse(r.stdout);
  const env = fs.readFileSync(snap('envelope-schema.ts'), 'utf8');
  const top = [...env.slice(env.indexOf('evidenceEnvelopeOutputSchema')).matchAll(/^  (\w+): /gm)].map((m) => m[1]);
  const confidences = /z\.enum\(\[([^\]]+)\]\)/.exec(env)[1].split(',').map((x) => x.trim().replace(/'/g, ''));
  for (const e of [row, plan]) {
    for (const key of Object.keys(e)) assert.ok(top.includes(key), `envelope key ${key} is in the schema`);
    for (const req of ['envelope_version', 'tool', 'value', 'confidence', 'provenance', 'assumptions', 'validity_envelope']) assert.ok(req in e, `has ${req}`);
    assert.equal(e.envelope_version, '1');
    assert.ok(confidences.includes(e.confidence));
    for (const p of e.provenance) {
      assert.equal(p.kind, 'repo');
      assert.equal(p.commit, S.aster.commit);
      assert.ok(confidences.includes(p.confidence));
    }
  }
  assert.equal(row.value.conditionCode, 9);
  assert.equal(row.value.inKnownUnknownsList, true);
  assert.equal(plan.value, null);
  assert.equal(plan.refusal.code, 'insufficient_data');
  assert.ok(S.quotes.refusalCodes.codes.includes(plan.refusal.code));
  const nf = runCli(['--aster', ASTER, '--body', 'NOT A BODY', '--json']);
  assert.equal(nf.status, 2);
  assert.equal(JSON.parse(nf.stdout).refusal.code, 'not_found');
});

test('F3 an independent recount from the raw fixtures, without model.js', { skip: !haveAster && 'Aster checkout absent' }, () => {
  const cat = JSON.parse(fs.readFileSync(path.join(ASTER, 'tests/fixtures/v2/nea-catalog-slice9.json'), 'utf8')).asteroids;
  const cache = JSON.parse(fs.readFileSync(path.join(ASTER, 'tests/fixtures/v2/lambert-screen-cache.json'), 'utf8'));
  const scr = {};
  for (const b of Object.values(cache.bodies)) scr[b.bodyId] = b;
  const thr = cache.metadata.feasibleC3MaxKm2S2;
  let list = 0;
  let literalOff = 0;
  let maxSpec = 0;
  const xs = [];
  const ys = [];
  for (const [id, a] of Object.entries(cat)) {
    const s = scr[id];
    const U = a.conditionCode;
    const d = a.dataArcDays;
    if (U !== null && U >= 7 && (d === null || d < 30) && s.minC3 !== null && s.minC3 <= thr) list++;
    // the fixture string differs from the stored value exactly when the arc score passes 1 and the
    // condition score leaves room under the outer clamp: arc > 1000 days and U not 0
    if (d !== null && d > 1000 && U !== 0) literalOff++;
    const cs = U === null ? 0 : Math.min(1, Math.max(0, 1 - U / 9));
    const ds = d === null ? 0 : Math.min(1, Math.max(0, Math.log10(1 + d) / Math.log10(1001)));
    maxSpec = Math.max(maxSpec, Math.abs(0.6 * cs + 0.4 * ds - a.qualityRank));
    if (U !== null && s.minC3 !== null) {
      xs.push(U);
      ys.push(s.minC3);
    }
  }
  assert.equal(list, S.list.total);
  assert.equal(literalOff, S.qualityAudit.literalDisagrees);
  assert.ok(maxSpec <= 5e-7);
  // Spearman by a different route: 1 - 6 sum d^2 / (n(n^2-1)) is exact only without ties, so use
  // Pearson on ranks with ties averaged via a sort written here
  const rank = (v) => {
    const o = v.map((x, i) => [x, i]).sort((p, q) => p[0] - q[0]);
    const r = new Float64Array(v.length);
    for (let i = 0; i < o.length; ) {
      let j = i;
      while (j + 1 < o.length && o[j + 1][0] === o[i][0]) j++;
      for (let m = i; m <= j; m++) r[o[m][1]] = (i + j) / 2;
      i = j + 1;
    }
    return r;
  };
  const rx = rank(xs);
  const ry = rank(ys);
  const mean = (a) => a.reduce((p, q) => p + q, 0) / a.length;
  const mx = mean(rx);
  const my = mean(ry);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < rx.length; i++) {
    sxy += (rx[i] - mx) * (ry[i] - my);
    sxx += (rx[i] - mx) ** 2;
    syy += (ry[i] - my) ** 2;
  }
  assert.ok(Math.abs(sxy / Math.sqrt(sxx * syy) - S.stratified.all.rhoU) < 1e-9);
});

test('F4 every quote and constant still sits at its recorded line in the checkout', { skip: !haveAster && 'Aster checkout absent' }, () => {
  const lineOf = (p, n) => fs.readFileSync(path.join(ASTER, p), 'utf8').split('\n')[n - 1];
  for (const [name, q] of Object.entries(S.quotes)) {
    const lines = [];
    for (let n = q.line; n <= (q.lineEnd || q.line); n++) lines.push(lineOf(q.path, n));
    const joined = lines.join(' ').replace(/\*\*/g, '').replace(/\s*\*\s/g, ' ').replace(/\s+/g, ' ');
    const probe = (q.text || q.template || '').split(/[{}]/)[0].slice(0, 40).replace(/\s+/g, ' ');
    if (probe) assert.ok(joined.includes(probe) || joined.includes(probe.replace('∞', '')), `${name}: "${probe}" not at ${q.path}:${q.line}`);
  }
  for (const [name, c] of Object.entries(S.constantSources)) {
    if (!c.line) continue;
    assert.ok(lineOf(c.path, c.line).includes(String(k[name])), `${name} = ${k[name]} not at ${c.path}:${c.line}`);
  }
});
