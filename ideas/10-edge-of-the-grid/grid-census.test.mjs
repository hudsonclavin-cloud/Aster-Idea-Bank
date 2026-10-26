// Tests for Edge of the Grid. From the bank root: node --test ideas/10-edge-of-the-grid/grid-census.test.mjs
// Node built-ins only. Pins (outside this folder's own code): the cache metadata's totalSolves and
// catalogSize; the catalog's classDistribution and missingAbsoluteMagnitudeCount; the precompute
// script's asserted co-orbital count and grid constants; GRID_PARAMS in the porkchop page source;
// the three judges' independently reproduced year counts; hand-worked lattice arithmetic for 433 Eros;
// closed-form synodic periods; snapshot sidecars; and, when /home/user/asteroid-mining-planner is
// present, a full re-run of the census against the live cache compared with the snapshot.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const G = require(path.join(here, 'grid-census.js'));
const D = require(path.join(here, 'snapshots', 'edge-census.data.js'));
const C = D.census;
const L = C.lattice;
const M = D.metadata;
const snap = (name) => path.join(here, 'snapshots', name);
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const sidecar = (name) => readJson(snap(`${name}.provenance.json`));
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const ASTER = process.env.ASTER_DIR || '/home/user/asteroid-mining-planner';
const CACHE_REL = C.inputs.cache.path;
const asterPresent = fs.existsSync(path.join(ASTER, '.git')) && fs.existsSync(path.join(ASTER, CACHE_REL));
const DAY = 86400000;
const utc = (iso) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const sum = (xs) => xs.reduce((s, x) => s + x, 0);
const yearRow = (y) => C.years.find((r) => r.year === y);

// An independent (test-local) lattice placement, written without the module: whole days from the
// window start divided by the spacing, flight time offset divided by its spacing.
function placeByHand(w) {
  const days = Math.round((utc(w.launchDate) - utc(M.screeningWindow.startUtc)) / DAY);
  const col = days % M.departureGridSpacingDays === 0 ? days / M.departureGridSpacingDays : null;
  const row = (w.tofDays - M.tofMinDays) % M.tofGridSpacingDays === 0 ? (w.tofDays - M.tofMinDays) / M.tofGridSpacingDays : null;
  return { col, row };
}
const nColsByHand = Math.floor(Math.round((utc(M.screeningWindow.endUtc) - utc(M.screeningWindow.startUtc)) / DAY) / M.departureGridSpacingDays) + 1;
const nRowsByHand = Math.floor((M.tofMaxDays - M.tofMinDays) / M.tofGridSpacingDays) + 1;

// ------------------------------------------------------------------------------ 1. snapshots
test('snapshots: metadata.json is the excerpt its sidecar describes and the census read the same bytes', () => {
  const bytes = fs.readFileSync(snap('metadata.json'));
  const sc = sidecar('metadata.json');
  assert.equal(sha256(bytes), sc.writtenSha256);
  assert.deepEqual(sc.picked, ['metadata']);
  assert.equal(sc.mode, 'excerpt');
  assert.match(sc.commit, /^[0-9a-f]{40}$/);
  assert.equal(sc.readMatchesCommitted, true, 'read from a clean checkout');
  assert.equal(sc.sourceSha256, C.inputs.cache.sha256, 'the census hashed the same cache file the snapshot tool did');
  assert.equal(sc.sourceBytes, C.inputs.cache.bytes);
  assert.deepEqual(JSON.parse(bytes.toString('utf8')).metadata, M);
  assert.deepEqual(C.inputs.cache.metadata, M, 'the census carries the metadata it derived the lattice from');
  assert.equal(sc.commit, C.inputs.commit, 'census ran at the commit the snapshot records');
});

test('snapshots: edge-census.json and edge-census.data.js match their sidecars and each other', () => {
  const json = fs.readFileSync(snap('edge-census.json'));
  const scJ = sidecar('edge-census.json');
  assert.equal(sha256(json), scJ.writtenSha256);
  assert.equal(scJ.mode, 'derived');
  assert.equal(scJ.path, C.inputs.cache.path);
  assert.equal(scJ.sourceSha256, C.inputs.cache.sha256);
  assert.deepEqual(JSON.parse(json.toString('utf8')), C, 'the wrapper embeds edge-census.json exactly');
  const js = fs.readFileSync(snap('edge-census.data.js'));
  const scD = sidecar('edge-census.data.js');
  assert.equal(sha256(js), scD.writtenSha256);
  assert.equal(scD.mode, 'derived');
  assert.deepEqual(D.metadataProvenance, sidecar('metadata.json'));
  assert.deepEqual(D.censusProvenance, scJ);
  const commits = new Set([scJ.commit, scD.commit, sidecar('metadata.json').commit]);
  assert.equal(commits.size, 1, 'every snapshot is from one commit');
  for (const f of fs.readdirSync(snap(''))) {
    if (f.endsWith('.provenance.json')) continue;
    const sc = sidecar(f);
    for (const k of ['repo', 'path', 'commit']) assert.ok(sc[k], `${f} sidecar has ${k}`);
  }
  assert.equal(C.schema, G.SCHEMA);
});

// ------------------------------------------------------------------------------ 2. the lattice
test('lattice: re-derived from the snapshot metadata, and pinned to the cache\'s own totalSolves', () => {
  const lat = G.lattice(M);
  assert.deepEqual(lat, L, 'module re-derives the recorded lattice');
  assert.equal(L.nCols, nColsByHand);
  assert.equal(L.nRows, nRowsByHand);
  assert.equal(L.firstDepartureUtc, M.screeningWindow.startUtc);
  assert.equal(new Date(utc(M.screeningWindow.startUtc) + (nColsByHand - 1) * M.departureGridSpacingDays * DAY).toISOString().slice(0, 10), L.lastDepartureUtc);
  assert.equal(L.lastTofDays, M.tofMinDays + (nRowsByHand - 1) * M.tofGridSpacingDays);
  assert.ok(L.lastDepartureUtc < M.screeningWindow.endUtc, 'the last lattice point is before the window end, which is not on the 7-day lattice');
  // The number the cache itself publishes: every body with windows was solved on every cell.
  assert.equal(L.nCols * L.nRows * C.bodies.withWindows, M.totalSolves, 'nCols × nRows × bodies-with-windows equals metadata.totalSolves');
  assert.equal(C.verification.totalSolvesMatch, true);
  assert.equal(L.cellsPerBody, L.nCols * L.nRows);
  assert.equal(sum(L.years.map((y) => y.cols)), L.nCols);
  // columns per calendar year counted independently
  const byYear = new Map();
  for (let c = 0; c < nColsByHand; c++) {
    const y = new Date(utc(M.screeningWindow.startUtc) + c * M.departureGridSpacingDays * DAY).getUTCFullYear();
    byYear.set(y, (byYear.get(y) || 0) + 1);
  }
  assert.deepEqual(L.years.map((y) => [y.year, y.cols]), [...byYear.entries()]);
  assert.equal(L.years.length, 15);
});

test('lattice: the derived grid sentence carries only derived figures', () => {
  const s = C.gridSentence;
  assert.equal(s, G.describeGrid(L));
  for (const needle of [L.firstDepartureUtc, L.lastDepartureUtc, M.screeningWindow.endUtc, String(L.nCols), String(L.tofMinDays), G.fmtInt(L.lastTofDays), G.fmtInt(L.tofMaxDays), String(L.nRows), G.fmtInt(L.cellsPerBody)]) {
    assert.ok(s.includes(needle), `sentence mentions ${needle}`);
  }
  const years = new Set(s.match(/\b\d{4}-\d{2}-\d{2}\b/g).map((d) => d.slice(0, 4)));
  assert.deepEqual([...years].sort(), [String(L.years[0].year), String(L.years[L.years.length - 1].year)]);
  assert.match(G.describeGrid(G.lattice(null)), /^No grid can be described/);
});

test('verification: every stored window sits on the derived lattice; the cache\'s summary fields agree with its windows', () => {
  const V = C.verification;
  assert.equal(V.violations, 0);
  assert.deepEqual(V.violationExamples, []);
  assert.equal(V.windowsChecked, 5 * C.bodies.withWindows);
  assert.equal(V.distinctLaunchDates, L.nCols, 'every column is used by at least one stored window');
  assert.equal(V.everyColumnUsed, true);
  assert.ok(V.distinctTofDays <= L.nRows);
  assert.equal(V.firstDepartureSeen, L.firstDepartureUtc);
  assert.equal(V.lastDepartureSeen, L.lastDepartureUtc);
  assert.equal(V.minTofSeen, L.tofMinDays);
  assert.equal(V.maxTofSeen, L.lastTofDays);
  assert.equal(V.cheapestIsFirstWindowViolations, 0);
  assert.equal(V.minC3SummaryMismatches, 0);
  assert.equal(V.windowsNotAscendingViolations, 0);
  assert.equal(V.bodiesWithOtherThanFiveWindows, 0);
  assert.equal(V.catalogMisses, 0);
  assert.equal(V.catalogSizeMetadata, C.bodies.total);
  assert.equal(C.bodies.total, M.catalogSize, 'metadata.catalogSize');
  assert.equal(C.bodies.total, C.inputs.catalog.totalBodies, 'the catalog\'s own totalBodies');
  assert.equal(C.bodies.total, sum(Object.values(C.inputs.catalog.classDistribution)));
  assert.equal(C.bodies.withWindows + C.bodies.withoutWindows.length, C.bodies.total);
  assert.equal(C.bodies.withoutWindows.length, 1);
  assert.equal(C.bodies.withoutWindows[0].status, 'propagator_failed');
  assert.equal(C.bodies.byStatus.propagator_failed, 1);
  assert.equal(sum(Object.values(C.bodies.byStatus)), C.bodies.total);
});

// ------------------------------------------------------------------------------ 3. hand-worked
test('hand-worked: 433 Eros — column 336, row 3, three basins (two under the looser rule)', () => {
  const eros = C.sample.find((s) => s.bodyId === 'asteroid-433');
  assert.ok(eros && !eros.refusal);
  const w0 = eros.windows[0];
  // 2026-01-01 → 2032-01-01 is 365+365+366+365+365+365 = 2191 days; Jan 31 + Feb 29 + Mar 31 + Apr 30 +
  // May 31 = 152 days to June 1, so June 10 is day 161 of 2032: 2191 + 161 = 2352 days = 336 weeks exactly.
  assert.equal(Math.round((utc(w0.launchDate) - utc(M.screeningWindow.startUtc)) / DAY), 2352);
  assert.equal(2352 / M.departureGridSpacingDays, 336);
  assert.equal(w0.col, 336);
  assert.equal((w0.tofDays - M.tofMinDays) / M.tofGridSpacingDays, 3);
  assert.equal(w0.row, 3);
  assert.deepEqual(G.cellOf(w0, L), { col: 336, row: 3, onLattice: true, violations: [] });
  // 2026-01-01 → 2039-01-01 is 4748 days (13 years, leap days in 2028, 2032, 2036); May 26 is day 145 of 2039
  // (31+28+31+30 = 120, +25): 4893 days = 699 weeks. 2039-05-19 is one column earlier.
  assert.equal(eros.windows.find((w) => w.launchDate === '2039-05-26').col, 699);
  assert.equal(eros.windows.find((w) => w.launchDate === '2039-05-19').col, 698);
  assert.equal(eros.windows.find((w) => w.launchDate === '2032-06-03').col, 335);
  assert.equal(eros.windows.find((w) => w.launchDate === '2032-07-08').col, 340);
  // Basins under "within 2 columns and 1 row": {335,336}@row3, {340}@row2 (4 columns off), {698,699}@row4.
  assert.equal(eros.basins, 3);
  assert.equal(G.basins(eros.windows, L).count, 3);
  assert.equal(G.basins(eros.windows, L, { maxColGap: 4, maxRowGap: 2 }).count, 2, 'col 340/row 2 joins the 335–336 basin within 4 columns');
  assert.deepEqual(eros.evidence.edges, []);
  assert.equal(eros.evidence.flags.any, false);
  assert.equal(eros.minC3, w0.c3);
});

test('hand-worked: every sample body\'s cells, edge flags and neighbour evidence recomputed without the module', () => {
  let checked = 0;
  for (const s of C.sample) {
    if (s.refusal) {
      assert.equal(s.bodyId, 'asteroid-2015 D1');
      assert.equal(s.refusal.code, 'insufficient_data');
      continue;
    }
    const cells = s.windows.map(placeByHand);
    s.windows.forEach((w, i) => {
      assert.equal(w.col, cells[i].col, `${s.bodyId} col`);
      assert.equal(w.row, cells[i].row, `${s.bodyId} row`);
      const flags = [];
      if (cells[i].col === 0) flags.push('first');
      if (cells[i].col === nColsByHand - 1) flags.push('last');
      if (cells[i].row === 0) flags.push('tofMin');
      if (cells[i].row === nRowsByHand - 1) flags.push('tofMax');
      assert.deepEqual(w.edges, flags, `${s.bodyId} ${w.launchDate} edges`);
      checked++;
    });
    const min = s.windows.reduce((b, w, i) => (w.c3 < s.windows[b].c3 ? i : b), 0);
    assert.equal(min, 0, 'cache stores the cheapest first');
    assert.deepEqual(s.evidence.cell, cells[0]);
    assert.equal(s.evidence.flags.count, s.windows[0].edges.length);
    const has = (c, r) => cells.findIndex((x) => x.col === c && x.row === r);
    for (const e of s.evidence.edges) {
      const [dc, dr] = e.edge === 'first' ? [1, 0] : e.edge === 'last' ? [-1, 0] : e.edge === 'tofMin' ? [0, 1] : [0, -1];
      const j = has(cells[0].col + dc, cells[0].row + dr);
      assert.equal(e.neighbourPresent, j >= 0, `${s.bodyId} ${e.edge} neighbour`);
      if (j >= 0) {
        assert.ok(Math.abs(e.slopeC3PerCell - (s.windows[j].c3 - s.windows[0].c3)) < 1e-12);
        assert.ok(e.slopeC3PerCell > 0, 'the neighbour costs more than the minimum');
      }
      assert.equal(e.verdict, j >= 0 && e.monotone ? 'likely_clipped' : 'undetermined');
      assert.equal(e.label, e.verdict === 'likely_clipped' ? 'Likely' : 'Speculative');
    }
  }
  assert.equal(checked, 14 * 5);
  // the demonstrations the sample was chosen for
  const by = (id) => C.sample.find((s) => s.bodyId === id);
  assert.deepEqual(by('asteroid-190166').evidence.edges.map((e) => [e.edge, e.verdict, e.chainLength]), [['first', 'likely_clipped', 3]]);
  assert.deepEqual(by('asteroid-21088').evidence.edges.map((e) => [e.edge, e.verdict, e.chainLength]), [['first', 'undetermined', 1]]);
  assert.deepEqual(by('asteroid-2368').evidence.edges.map((e) => [e.edge, e.verdict]), [['last', 'likely_clipped']]);
  assert.deepEqual(by('asteroid-66063').evidence.edges.map((e) => [e.edge, e.verdict]), [['last', 'undetermined']]);
  assert.deepEqual(by('asteroid-2006 KD40').evidence.edges.map((e) => e.edge), ['first', 'tofMin']);
  assert.equal(by('asteroid-2006 KD40').evidence.flags.count, 2);
  assert.deepEqual(by('asteroid-1999 XS35').evidence.edges.map((e) => e.edge), ['tofMax']);
  assert.deepEqual(by('asteroid-2021 UO20').evidence.edges.map((e) => [e.edge, e.verdict]), [['tofMin', 'likely_clipped']]);
  assert.equal(by('asteroid-2059').basins, 1);
  assert.equal(by('asteroid-1566').basins, 5);
  assert.ok(by('asteroid-163693').windows.every((w) => w.row === 0), 'Atira: all five on the floor');
  assert.equal(by('asteroid-2004 RZ164').evidence.edges[0].slopeC3PerCell, C.edges.byEdge.last.slopeC3PerCell.max, 'the steepest recorded inward slope at the last column');
});

// ------------------------------------------------------------------------------ 4. the counts
test('counts: year totals reproduce the three judges\' independent counts and add up to the bodies', () => {
  assert.equal(yearRow(2026).minima, 4268, 'reproduced by all three judges in the proposal');
  assert.equal(yearRow(2040).minima, 3397, 'reproduced by all three judges in the proposal');
  assert.equal(sum(C.years.map((y) => y.minima)), C.bodies.withWindows);
  assert.equal(sum(C.years.map((y) => y.allWindows)), C.verification.windowsChecked);
  for (const y of C.years) assert.ok(Math.abs(y.minimaPerCol - y.minima / y.cols) < 1e-12);
  const interiorYears = C.years.slice(1, -1).map((y) => y.minima);
  assert.equal(C.interior.medianPerYear, G.median(interiorYears));
  assert.ok(yearRow(2026).minima > Math.max(...interiorYears), 'the first year exceeds every other year');
  assert.ok(yearRow(2040).minima > Math.max(...C.years.filter((y) => y.year > 2028 && y.year < 2040).map((y) => y.minima)), 'the last year exceeds every year after the opening ramp (2029 onward)');
  assert.ok(yearRow(2040).minima < yearRow(2027).minima && yearRow(2027).minima < yearRow(2026).minima && yearRow(2028).minima < yearRow(2027).minima, 'the first three years ramp down: the opening pile-up is not confined to the first column');
  assert.ok(yearRow(2026).minima > C.interior.medianPerYear * 1.5 && yearRow(2040).minima > C.interior.medianPerYear * 1.25, 'edge years against the median interior year');
});

test('counts: per-column and per-row vectors, the heatmap and the edge table are one consistent census', () => {
  const PC = C.perColumn.minima, PR = C.perRow.minima, E = C.edges.byEdge;
  assert.equal(PC.length, L.nCols);
  assert.equal(PR.length, L.nRows);
  assert.equal(sum(PC), C.bodies.withWindows);
  assert.equal(sum(PR), C.bodies.withWindows);
  assert.equal(sum(C.perColumn.allWindows), C.verification.windowsChecked);
  assert.equal(PC[0], E.first.touched);
  assert.equal(PC[L.nCols - 1], E.last.touched);
  assert.equal(PR[0], E.tofMin.touched);
  assert.equal(PR[L.nRows - 1], E.tofMax.touched);
  assert.equal(E.first.touched + E.last.touched + E.tofMin.touched + E.tofMax.touched - C.edges.any, C.edges.multiple, 'a body can touch at most two edges');
  assert.equal(C.edges.anyShare, C.edges.any / C.bodies.withWindows);
  for (const k of G.EDGE_KEYS) {
    const e = E[k];
    assert.equal(e.likelyClipped + e.undetermined, e.touched, `${k} verdicts partition`);
    assert.equal(sum(Object.values(e.chains)), e.touched, `${k} chains partition`);
    assert.equal(e.chains3plus, e.chains[3] + e.chains[4] + e.chains[5]);
    assert.equal(e.monotone3plus + e.nonMonotone3plus, e.chains3plus);
    assert.equal(e.neighbourPresent, e.touched - e.chains[1]);
    if (e.slopeC3PerCell) {
      assert.equal(e.slopeC3PerCell.n, e.neighbourPresent);
      assert.ok(e.slopeC3PerCell.min > 0, 'every recorded inward step costs more than the edge minimum');
      assert.ok(e.slopeC3PerCell.min <= e.slopeC3PerCell.median && e.slopeC3PerCell.median <= e.slopeC3PerCell.max);
    }
    assert.equal(e.shareOfBodies, e.touched / C.bodies.withWindows);
  }
  assert.equal(E.first.nonMonotone3plus + E.last.nonMonotone3plus + E.tofMax.nonMonotone3plus + E.tofMin.nonMonotone3plus, 0, 'every stored chain of three or more rises inward');
  assert.ok(E.tofMin.touched > E.first.touched + E.last.touched + E.tofMax.touched, 'the flight-time floor is the binding edge');
  assert.equal(E.tofMin.neighbourPresent, 1, 'the floor\'s slope is recorded for exactly one body');
  // heatmap marginals
  const H = C.heat;
  assert.equal(H.minima.length, L.nRows);
  assert.equal(H.minima[0].length, L.years.length);
  assert.deepEqual(H.years, L.years.map((y) => y.year));
  assert.deepEqual(H.tofDays, C.perRow.tofDays);
  for (let r = 0; r < L.nRows; r++) assert.equal(sum(H.minima[r]), PR[r], `heat row ${r}`);
  for (let y = 0; y < L.years.length; y++) assert.equal(sum(H.minima.map((row) => row[y])), C.years[y].minima, `heat year ${y}`);
  for (let r = 0; r < L.nRows; r++) assert.equal(sum(H.allWindows[r]), C.perRow.allWindows[r]);
  assert.deepEqual(C.perRow.tofDays, Array.from({ length: L.nRows }, (_, r) => L.tofMinDays + r * L.tofSpacingDays));
  // interior baseline recomputed
  const interiorCols = PC.slice(L.years[0].cols, L.nCols - L.years[L.years.length - 1].cols);
  assert.equal(interiorCols.length, C.interior.cols);
  assert.equal(C.interior.medianPerCol, G.median(interiorCols));
  assert.equal(C.interior.firstColRatio, PC[0] / G.median(interiorCols));
  assert.equal(C.interior.lastColRatio, PC[L.nCols - 1] / G.median(interiorCols));
  assert.ok(C.interior.firstColRatio > 3 && C.interior.lastColRatio > 3, 'both edge columns carry more than three times the interior median');
  // interior alternative partitions the edge bodies
  const A = C.interiorAlternative;
  assert.equal(A.withAlternative + A.without, C.edges.any);
  assert.equal(A.ofEdgeBodies, C.edges.any);
  assert.ok(A.gapC3.min > 0 && A.gapC3.median > A.gapC3.min);
});

test('counts: the porkchop view tail is a recount over the lattice columns after the view\'s last departure', () => {
  const T = C.viewTail;
  assert.ok(!G.isRefusal(T));
  assert.equal(T.depEndUtc, C.inputs.viewGrid.depEndUtc);
  assert.equal(C.inputs.viewGrid.source, 'src/v2/app/porkchop/main.ts');
  assert.ok(Number.isInteger(C.inputs.viewGrid.lines.depEndJD) && C.inputs.viewGrid.lines.depEndJD > 0);
  assert.ok(Number.isInteger(C.inputs.viewGrid.spanLabelDerivedAtLine), 'the page derives its span label (the STATUS literal is gone)');
  let after = 0, on = 0;
  for (let c = 0; c < L.nCols; c++) {
    const d = new Date(utc(L.startUtc) + c * L.departureSpacingDays * DAY).toISOString().slice(0, 10);
    if (d > T.depEndUtc) after += C.perColumn.minima[c];
    else if (d === T.depEndUtc) on += C.perColumn.minima[c];
  }
  assert.equal(T.minimaAfter, after);
  assert.equal(T.minimaOn, on);
  assert.equal(T.minimaAfter, 3397, 'the whole of the last calendar year lies after the view\'s end');
  assert.ok(T.anyWindowAfter >= T.minimaAfter);
  assert.ok(T.anyWindowAfter <= C.bodies.withWindows);
  assert.equal(T.shareOfBodies, T.minimaAfter / C.bodies.withWindows);
  assert.ok(T.depEndUtc < L.lastDepartureUtc, 'the view ends before the cache does');
});

test('counts: basin histograms partition the bodies and loosen monotonically', () => {
  assert.equal(C.basins.length, 3);
  assert.deepEqual(C.basins[0].rule, G.DEFAULT_BASIN_RULE);
  for (const b of C.basins) assert.equal(sum(Object.values(b.histogram)), C.bodies.withWindows);
  for (let i = 1; i < C.basins.length; i++) {
    assert.ok(C.basins[i].histogram[1] >= C.basins[i - 1].histogram[1], 'a looser rule never splits a basin');
    assert.ok(C.basins[i].histogram[5] <= C.basins[i - 1].histogram[5]);
  }
  assert.ok(C.basins[0].histogram[3] + C.basins[0].histogram[4] + C.basins[0].histogram[5] > C.bodies.withWindows / 2, 'most bodies spread their five windows over three or more basins under the proposal\'s rule');
});

test('tables: per-class totals reconcile with the catalog\'s own classDistribution, H with its missing count, co-orbital with the precompute\'s asserted 130', () => {
  const T = C.tables;
  for (const key of ['byClass', 'byH', 'bySynodic', 'byPha', 'byCoOrbital']) {
    assert.ok(!G.isRefusal(T[key]), `${key} is a table`);
    assert.equal(sum(T[key].map((r) => r.n)), C.bodies.withWindows, `${key} rows partition the bodies`);
    for (const r of T[key]) {
      assert.ok(r.first + r.last + r.tofMin + r.tofMax >= r.any && r.any <= r.n);
      assert.equal(r.share, r.any / r.n);
    }
    assert.equal(sum(T[key].map((r) => r.any)), C.edges.any, `${key} edge totals`);
  }
  const dist = C.inputs.catalog.classDistribution;
  const missing = C.bodies.withoutWindows;
  for (const r of T.byClass) {
    const without = missing.filter((b) => b.orbitClass === r.key).length;
    assert.equal(r.n + without, dist[r.key], `${r.key}: with-windows + without-windows = catalog classDistribution`);
  }
  assert.equal(T.byClass.length, Object.keys(dist).length);
  const hMissing = T.byH.find((r) => r.key === 'H missing');
  assert.equal(hMissing.n + missing.filter((b) => b.hBand === 'H missing').length, C.inputs.catalog.missingAbsoluteMagnitudeCount, 'catalog.missingAbsoluteMagnitudeCount');
  assert.deepEqual(T.byH.map((r) => r.key), G.H_BANDS);
  assert.deepEqual(T.bySynodic.map((r) => r.key), G.SYNODIC_BANDS);
  const co = T.byCoOrbital.find((r) => r.key === 'co-orbital (cache flag)');
  assert.equal(co.n, C.bodies.coOrbital);
  assert.equal(co.n, 130, 'precompute-lambert-screen.mjs exits unless exactly 130 bodies are tagged (OQ-7)');
  assert.equal(C.inputs.auKm.source, 'tools/build/precompute-lambert-screen.mjs');
  assert.equal(C.inputs.auKm.value, 149597870.7, 'AU_KM as the precompute script defines it (IAU 2012 value)');
  // the floor dominates every class with more than a handful of bodies, and the H trend is monotone
  const floorShare = T.byH.filter((r) => r.key !== 'H missing').map((r) => r.tofMin / r.n);
  for (let i = 1; i < floorShare.length; i++) assert.ok(floorShare[i] < floorShare[i - 1], 'floor share falls with H (fainter bodies)');
  assert.ok(T.byClass.find((r) => r.key === 'HTC').tofMax >= 20, 'Halley-type comets sit at the flight-time ceiling');
});

// ------------------------------------------------------------------------------ 5. the functions
test('basins: invariant under every ordering of the five windows; cheapest window\'s basin is 0', () => {
  const perms = (xs) => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms(xs.filter((_, j) => j !== i)).map((p) => [x, ...p])));
  for (const s of C.sample) {
    if (s.refusal) continue;
    const base = G.basins(s.windows, L);
    assert.equal(base.labels[0], 0);
    const seen = new Set();
    for (const p of perms(s.windows)) {
      const b = G.basins(p, L);
      assert.equal(b.count, base.count, `${s.bodyId} permutation`);
      const minIdx = G.argminC3(p);
      assert.equal(b.labels[minIdx], 0);
      seen.add(b.count);
    }
    assert.equal(seen.size, 1);
  }
  // a chain of windows each two columns apart is one basin; three apart is five basins
  const mk = (cols, row, c3s) => cols.map((c, i) => ({ launchDate: G.addDays(L.startUtc, c * L.departureSpacingDays), tofDays: L.tofMinDays + row * L.tofSpacingDays, c3: c3s[i] }));
  assert.equal(G.basins(mk([10, 12, 14, 16, 18], 3, [1, 2, 3, 4, 5]), L).count, 1);
  assert.equal(G.basins(mk([10, 13, 16, 19, 22], 3, [1, 2, 3, 4, 5]), L).count, 5);
  assert.equal(G.basins(mk([10, 13, 16, 19, 22], 3, [1, 2, 3, 4, 5]), L, { maxColGap: 3, maxRowGap: 1 }).count, 1);
});

test('edge evidence on synthetic windows: verdicts, chains, two edges at once, order independence', () => {
  const W = (col, row, c3) => ({ launchDate: G.addDays(L.startUtc, col * L.departureSpacingDays), tofDays: L.tofMinDays + row * L.tofSpacingDays, c3 });
  const far = [W(300, 10, 20), W(301, 10, 21)];
  // rising chain of three inward from the first column
  let ev = G.edgeEvidence([W(0, 5, 7.5), W(1, 5, 7.9), W(2, 5, 8.6), ...far], L);
  assert.deepEqual(ev.edges.map((e) => [e.edge, e.verdict, e.chainLength, e.monotone]), [['first', 'likely_clipped', 3, true]]);
  assert.ok(Math.abs(ev.edges[0].slopeC3PerCell - 0.4) < 1e-12);
  assert.equal(ev.edges[0].label, 'Likely');
  // a chain that dips is not monotone → undetermined even though the neighbour is stored
  ev = G.edgeEvidence([W(0, 5, 7.5), W(1, 5, 7.9), W(2, 5, 7.7), ...far], L);
  assert.deepEqual(ev.edges.map((e) => [e.verdict, e.chainLength, e.monotone]), [['undetermined', 3, false]]);
  // neighbour absent → undetermined, chain 1
  ev = G.edgeEvidence([W(0, 5, 7.5), W(2, 5, 7.9), ...far, W(400, 2, 30)], L);
  assert.deepEqual(ev.edges.map((e) => [e.verdict, e.chainLength, e.neighbourPresent]), [['undetermined', 1, false]]);
  // last column, floor and ceiling
  assert.deepEqual(G.edgeEvidence([W(L.nCols - 1, 4, 1), W(L.nCols - 2, 4, 2), ...far], L).edges.map((e) => [e.edge, e.verdict]), [['last', 'likely_clipped']]);
  assert.deepEqual(G.edgeEvidence([W(50, 0, 1), W(50, 1, 2), ...far], L).edges.map((e) => [e.edge, e.verdict]), [['tofMin', 'likely_clipped']]);
  assert.deepEqual(G.edgeEvidence([W(50, L.nRows - 1, 1), W(50, L.nRows - 2, 2), ...far], L).edges.map((e) => [e.edge, e.verdict]), [['tofMax', 'likely_clipped']]);
  // two edges at once
  ev = G.edgeEvidence([W(0, 0, 1), W(1, 0, 2), W(0, 1, 3), ...far], L);
  assert.deepEqual(ev.edges.map((e) => [e.edge, e.verdict]), [['first', 'likely_clipped'], ['tofMin', 'likely_clipped']]);
  assert.equal(ev.flags.count, 2);
  // interior minimum: no edges
  assert.deepEqual(G.edgeEvidence([W(100, 10, 1), W(0, 0, 2), W(L.nCols - 1, L.nRows - 1, 3)], L).edges, []);
  // the minimum is found by c3, not position
  const shuffled = [W(2, 5, 8.6), ...far, W(0, 5, 7.5), W(1, 5, 7.9)];
  ev = G.edgeEvidence(shuffled, L);
  assert.equal(ev.minIndex, 3);
  assert.deepEqual(ev.edges.map((e) => [e.edge, e.verdict, e.chainLength]), [['first', 'likely_clipped', 3]]);
  assert.deepEqual(G.edgeEvidence([], L), { hasMinimum: false, edges: [] });
});

test('cellOf names every off-lattice window instead of rounding it', () => {
  const bad = G.cellOf({ launchDate: G.addDays(L.startUtc, 3), tofDays: 182 }, L);
  assert.equal(bad.onLattice, false);
  assert.match(bad.violations[0], /not a multiple of 7/);
  assert.equal(bad.row, 0);
  assert.match(G.cellOf({ launchDate: L.startUtc, tofDays: 200 }, L).violations[0], /not 182 \+ k·30/);
  assert.match(G.cellOf({ launchDate: '2026-02-30', tofDays: 182 }, L).violations[0], /not a calendar date/);
  assert.match(G.cellOf({ launchDate: G.addDays(L.startUtc, L.nCols * L.departureSpacingDays), tofDays: 182 }, L).violations[0], /outside the 783-column lattice/);
  assert.match(G.cellOf({ launchDate: L.startUtc, tofDays: L.tofMinDays + L.nRows * L.tofSpacingDays }, L).violations[0], /outside the 55-row lattice/);
  assert.equal(G.cellOf({ launchDate: L.startUtc, tofDays: NaN }, L).violations.length, 1);
  assert.equal(G.cellOf(undefined, L).onLattice, false);
});

test('refusals: a lattice or census that cannot be derived says what is missing', () => {
  const r1 = G.lattice(null);
  assert.equal(r1.refusal.code, 'insufficient_data');
  const m = JSON.parse(JSON.stringify(M));
  delete m.departureGridSpacingDays;
  assert.match(G.lattice(m).refusal.reason, /departureGridSpacingDays/);
  assert.equal(G.lattice({ ...M, departureGridSpacingDays: 0 }).refusal.code, 'out_of_envelope');
  assert.equal(G.lattice({ ...M, tofGridSpacingDays: 2.5 }).refusal.code, 'out_of_envelope');
  assert.equal(G.lattice({ ...M, tofMinDays: 1900 }).refusal.code, 'out_of_envelope');
  assert.equal(G.lattice({ ...M, screeningWindow: { startUtc: M.screeningWindow.endUtc, endUtc: M.screeningWindow.startUtc } }).refusal.code, 'out_of_envelope');
  assert.equal(G.lattice({ ...M, screeningWindow: { startUtc: 'yesterday', endUtc: M.screeningWindow.endUtc } }).refusal.code, 'insufficient_data');
  assert.equal(G.census({ metadata: M, bodies: [] }, null, {}).refusal.code, 'insufficient_data');
  assert.equal(G.census({ metadata: M }, null, {}).refusal.code, 'insufficient_data');
  assert.equal(G.census(null, null, {}).refusal.code, 'insufficient_data');
  assert.equal(G.census({ metadata: m, bodies: [{}] }, null, {}).refusal.code, 'insufficient_data');
  assert.throws(() => G.refuse('maybe', 'x', 'y'), /unknown refusal code/);
  assert.deepEqual(G.REFUSAL_CODES, ['insufficient_data', 'out_of_envelope', 'not_found']);
  assert.equal(G.isRefusal(G.refuse('not_found', 'a', 'b')), true);
  assert.equal(G.isRefusal({ refusal: null }), false);
});

test('a synthetic three-body cache: every aggregate hand-checked, missing inputs become refusals', () => {
  const W = (col, row, c3) => ({ launchDate: G.addDays(L.startUtc, col * L.departureSpacingDays), tofDays: L.tofMinDays + row * L.tofSpacingDays, c3 });
  const body = (id, windows, extra) => Object.assign({ bodyId: id, designation: id, status: 'low_departure_c3', minC3: Math.min(...windows.map((w) => w.c3)), minC3Date: windows.find((w) => w.c3 === Math.min(...windows.map((x) => x.c3))).launchDate, minC3TofDays: windows.find((w) => w.c3 === Math.min(...windows.map((x) => x.c3))).tofDays, bestWindows: windows, isCoOrbital: false }, extra || {});
  const A = body('A', [W(0, 5, 7.5), W(1, 5, 7.9), W(2, 5, 8.6), W(157, 6, 8.95), W(158, 6, 8.97)]); // first column, likely clipped, 2 basins
  const B = body('B', [W(336, 3, 1.62), W(335, 3, 1.78), W(699, 4, 2.27), W(698, 4, 2.58), W(340, 2, 2.81)]); // interior, 3 basins
  const Cc = body('C', [W(L.nCols - 1, 8, 10.5), W(728, 9, 10.9), W(676, 9, 11.2), W(731, 8, 11.3), W(730, 8, 11.5)], { isCoOrbital: true }); // last column, undetermined, 3 basins
  const Dd = { bodyId: 'D', designation: 'D', status: 'propagator_failed', minC3: null, minC3Date: null, minC3TofDays: null, bestWindows: [], isCoOrbital: false };
  const cache = { metadata: { ...M, totalSolves: 3 * L.cellsPerBody, catalogSize: 4 }, bodies: [A, B, Cc, Dd] };
  const au = C.inputs.auKm.value;
  const catalog = { asteroids: { A: { orbitClass: 'AMO', H: 17.26, pha: false, elements: { aKm: 1.8 * au } }, B: { orbitClass: 'AMO', H: 10.39, pha: false, elements: { aKm: 1.458 * au } }, C: { orbitClass: 'ATE', H: 18.15, pha: true, elements: { aKm: 0.99 * au } }, D: { orbitClass: 'APO', H: null, pha: false, elements: { aKm: 1.2 * au } } } };
  const viewEnd = G.addDays(L.startUtc, 731 * L.departureSpacingDays); // a column date, so one window of C lands exactly on it
  const c = G.census(cache, catalog, { viewGrid: { depEndUtc: viewEnd, source: 'synthetic' }, auKm: au, sampleIds: ['B', 'D', 'nope'] });
  assert.ok(!G.isRefusal(c));
  assert.equal(c.bodies.withWindows, 3);
  assert.deepEqual(c.bodies.withoutWindows.map((b) => [b.bodyId, b.orbitClass, b.hBand]), [['D', 'APO', 'H missing']]);
  assert.equal(c.verification.totalSolvesMatch, true);
  assert.equal(c.verification.windowsChecked, 15);
  assert.equal(c.verification.distinctLaunchDates, 15);
  assert.equal(c.verification.everyColumnUsed, false);
  assert.equal(yearOf(c, 2026), 1);
  assert.equal(yearOf(c, 2032), 1);
  assert.equal(yearOf(c, 2040), 1);
  assert.equal(c.perColumn.minima[0] + c.perColumn.minima[336] + c.perColumn.minima[L.nCols - 1], 3);
  assert.equal(c.edges.any, 2);
  assert.equal(c.edges.multiple, 0);
  assert.deepEqual([c.edges.byEdge.first.touched, c.edges.byEdge.first.likelyClipped, c.edges.byEdge.first.chains[3]], [1, 1, 1]);
  assert.deepEqual([c.edges.byEdge.last.touched, c.edges.byEdge.last.undetermined, c.edges.byEdge.last.slopeC3PerCell], [1, 1, null]);
  assert.ok(Math.abs(c.edges.byEdge.first.slopeC3PerCell.median - 0.4) < 1e-12);
  assert.deepEqual(c.basins[0].histogram, { 1: 0, 2: 1, 3: 2, 4: 0, 5: 0 });
  assert.equal(c.interiorAlternative.withAlternative, 2, 'A has its 2029 basin, C its 2039 basin');
  assert.ok(Math.abs(c.interiorAlternative.gapC3.min - 0.4) < 1e-12, 'C: 10.9 − 10.5');
  assert.deepEqual([c.viewTail.minimaAfter, c.viewTail.minimaOn, c.viewTail.anyWindowAfter], [1, 0, 1]);
  assert.deepEqual(c.tables.byClass.map((r) => [r.key, r.n, r.any]), [['AMO', 2, 1], ['ATE', 1, 1]]);
  assert.deepEqual(c.tables.byH.filter((r) => r.n).map((r) => [r.key, r.n]), [['H < 18', 2], ['18 ≤ H < 22', 1]]);
  assert.deepEqual(c.tables.byPha.map((r) => [r.key, r.n, r.any]), [['PHA', 1, 1], ['not PHA', 2, 1]]);
  assert.deepEqual(c.tables.byCoOrbital.map((r) => [r.key, r.n]), [['co-orbital (cache flag)', 1], ['not co-orbital', 2]]);
  // synodic bands: a=1.8 AU → T 2.415 yr → S 1.707 (<2); a=1.458 → T 1.76 → S 2.32 (2–5); a=0.99 → T 0.985 → S 65.8 (≥50)
  assert.deepEqual(c.tables.bySynodic.filter((r) => r.n).map((r) => [r.key, r.n]), [['S < 2 yr', 1], ['2 ≤ S < 5 yr', 1], ['S ≥ 50 yr', 1]]);
  assert.equal(c.sample.length, 3);
  assert.equal(c.sample[0].basins, 3);
  assert.equal(c.sample[1].refusal.code, 'insufficient_data');
  assert.equal(c.sample[2].refusal.code, 'not_found');
  // without the view grid, the catalog or the AU, the dependent outputs are refusals, not numbers
  const bare = G.census(cache, null, {});
  assert.equal(bare.viewTail.refusal.code, 'insufficient_data');
  assert.match(bare.viewTail.refusal.what_would_help, /depEndJD/);
  assert.equal(bare.tables.byClass.refusal.code, 'insufficient_data');
  assert.equal(bare.tables.bySynodic.refusal.code, 'insufficient_data');
  assert.ok(!G.isRefusal(bare.tables.byCoOrbital));
  const noAu = G.census(cache, catalog, {});
  assert.ok(!G.isRefusal(noAu.tables.byClass));
  assert.match(noAu.tables.bySynodic.refusal.reason, /AU in km/);
  // an off-lattice window is counted as a violation and named
  const off = G.census({ metadata: M, bodies: [body('X', [W(10, 2, 1), { launchDate: G.addDays(L.startUtc, 73), tofDays: 182, c3: 2 }, W(12, 2, 3), W(13, 2, 4), W(14, 2, 5)])] }, null, {});
  assert.equal(off.verification.violations, 1);
  assert.equal(off.verification.violationExamples[0].bodyId, 'X');
  assert.match(off.verification.violationExamples[0].violations[0], /not a multiple of 7/);
  function yearOf(cc, y) {
    return cc.years.find((r) => r.year === y).minima;
  }
});

test('synodic periods: closed forms and bands', () => {
  const au = C.inputs.auKm.value;
  assert.equal(G.synodicYears(au, au), Infinity, 'a body at exactly 1 AU never catches up with Earth');
  // Mars, a = 1.524 AU: T = 1.881 yr, S = 1/(1 − 1/1.881) = 2.135 yr ≈ 780 days (the textbook Mars synodic period)
  const mars = G.synodicYears(1.524 * au, au);
  assert.ok(Math.abs(mars * 365.25 - 780) < 2, `Mars synodic ${mars * 365.25} days`);
  // Venus, a = 0.7233 AU: T = 0.6152 yr, S = 1/(1/0.6152 − 1) = 1.599 yr ≈ 584 days
  const venus = G.synodicYears(0.7233 * au, au);
  assert.ok(Math.abs(venus * 365.25 - 584) < 1.5, `Venus synodic ${venus * 365.25} days`);
  assert.equal(G.synodicYears(-1, au).refusal.code, 'insufficient_data');
  assert.equal(G.synodicYears(NaN, au).refusal.code, 'insufficient_data');
  assert.match(G.synodicYears(au, undefined).refusal.what_would_help, /AU_KM/);
  assert.equal(G.synodicBand(1.99), 'S < 2 yr');
  assert.equal(G.synodicBand(2), '2 ≤ S < 5 yr');
  assert.equal(G.synodicBand(14.999), '5 ≤ S < 15 yr');
  assert.equal(G.synodicBand(49.9), '15 ≤ S < 50 yr');
  assert.equal(G.synodicBand(Infinity), 'S ≥ 50 yr');
  assert.equal(G.synodicBand(G.refuse('insufficient_data', 'x', 'y')), 'unknown');
  assert.equal(G.hBand(17.99), 'H < 18');
  assert.equal(G.hBand(18), '18 ≤ H < 22');
  assert.equal(G.hBand(28), 'H ≥ 28');
  assert.equal(G.hBand(null), 'H missing');
  assert.equal(G.hBand(NaN), 'H missing');
  assert.equal(G.daysBetween('2026-01-01', '2026-03-01'), 59);
  assert.ok(Number.isNaN(G.daysBetween('2026-01-01', '2026-13-01')));
  assert.equal(G.fmtInt(1804638825), '1,804,638,825');
  assert.equal(G.fmtInt(-42), '-42');
  assert.equal(G.median([3, 1, 2]), 2);
  assert.equal(G.median([4, 1, 2, 3]), 2.5);
  assert.equal(G.median([]), null);
});

// ------------------------------------------------------------------------------ 6. page source
test('page source: no grid date, year or headline count is typed into index.html or app.js', () => {
  const html = fs.readFileSync(path.join(here, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(here, 'app.js'), 'utf8');
  for (const [name, text] of [['index.html', html], ['app.js', app]]) {
    const years = text.match(/\b20[2-5]\d\b/g) || [];
    assert.deepEqual(years, [], `${name} carries a year literal: ${years.join(', ')}`);
    assert.doesNotMatch(text, /\d{4}-\d{2}-\d{2}/, `${name} carries a date literal`);
    const headline = [C.bodies.withWindows, C.bodies.total, L.nCols, L.cellsPerBody, C.edges.any, C.viewTail.minimaAfter, C.viewTail.anyWindowAfter, C.years[0].minima, C.years[C.years.length - 1].minima, L.lastTofDays, ...G.EDGE_KEYS.map((k) => C.edges.byEdge[k].touched)];
    for (const n of headline) {
      for (const s of [String(n), G.fmtInt(n)]) {
        assert.ok(!new RegExp(`(^|[^\\d.])${s.replace(/,/g, ',')}([^\\d]|$)`).test(text), `${name} carries the count ${s} as a literal`);
      }
    }
  }
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.match(html, /snapshots\/edge-census\.data\.js/);
  assert.match(html, /grid-census\.js/);
  assert.doesNotMatch(html, /https?:\/\/[^"']+\.(js|css)/, 'no external scripts or styles');
});

// ------------------------------------------------------------------------------ 7. the CLI
const CLI = path.join(here, 'edge-census.mjs');
test('cli: --help exits 0, bad usage exits 2, a missing cache exits 1', () => {
  const help = spawnSync('node', [CLI, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--json FILE/);
  const bad = spawnSync('node', [CLI, '--bogus'], { encoding: 'utf8' });
  assert.equal(bad.status, 2);
  const missing = spawnSync('node', [CLI, '--cache', path.join(os.tmpdir(), 'no-such-cache.json'), '--no-catalog'], { encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /cache not found/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-census-'));
  try {
    fs.writeFileSync(path.join(dir, 'bad.json'), '{not json');
    const notJson = spawnSync('node', [CLI, '--cache', path.join(dir, 'bad.json'), '--no-catalog'], { encoding: 'utf8' });
    assert.equal(notJson.status, 1);
    assert.match(notJson.stderr, /not JSON/);
    // a tiny valid cache with no catalog, no view source, no precompute script → report with refusals
    const W = (col, row, c3) => ({ launchDate: G.addDays(L.startUtc, col * L.departureSpacingDays), tofDays: L.tofMinDays + row * L.tofSpacingDays, c3 });
    const tiny = { metadata: { ...M, totalSolves: L.cellsPerBody }, bodies: [{ bodyId: 'T', designation: 'T', status: 'low_departure_c3', minC3: 1, minC3Date: W(0, 0, 1).launchDate, minC3TofDays: L.tofMinDays, bestWindows: [W(0, 0, 1), W(1, 0, 2), W(2, 0, 3), W(3, 0, 4), W(4, 0, 5)], isCoOrbital: false }] };
    fs.writeFileSync(path.join(dir, 'tiny.json'), JSON.stringify(tiny));
    const r = spawnSync('node', [CLI, '--aster', dir, '--cache', path.join(dir, 'tiny.json'), '--no-catalog', '--json', path.join(dir, 'out.json')], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /PORKCHOP VIEW TAIL — refused/);
    assert.match(r.stdout, /BY ORBIT CLASS[\s\S]*refused \(insufficient_data\)/);
    assert.match(r.stdout, /any edge 1 of 1 bodies/);
    assert.match(r.stdout, /11 touch two edges|1 touch two edges/);
    const out = JSON.parse(fs.readFileSync(path.join(dir, 'out.json'), 'utf8'));
    assert.equal(out.edges.multiple, 1, 'T touches the first column and the floor');
    assert.equal(out.inputs.viewGrid, null);
    assert.equal(out.inputs.catalog, null);
    assert.equal(out.sample.filter((s) => s.refusal && s.refusal.code === 'not_found').length, 15, 'none of the sample ids exist in the tiny cache');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------------------ 8. the live checkout
test('live checkout: the snapshot describes the files in the Aster checkout; the cache was built from this catalog (skipped when absent)', (t) => {
  if (!asterPresent) return t.skip(`Aster checkout not present at ${ASTER}`);
  const cacheBytes = fs.readFileSync(path.join(ASTER, CACHE_REL));
  assert.equal(sha256(cacheBytes), C.inputs.cache.sha256, 'the checkout\'s cache is the one the census read');
  assert.equal(cacheBytes.length, C.inputs.cache.bytes);
  const committed = execFileSync('git', ['rev-parse', `HEAD:${CACHE_REL}`], { cwd: ASTER, encoding: 'utf8' }).trim();
  assert.equal(committed, sidecar('metadata.json').committedBlob, 'the committed cache blob has not changed since the snapshot');
  const catalogBytes = fs.readFileSync(path.join(ASTER, C.inputs.catalog.path));
  assert.equal(sha256(catalogBytes), C.inputs.catalog.sha256);
  assert.equal(sha256(catalogBytes), M.provenance.catalogFixtureSha256, 'metadata.provenance.catalogFixtureSha256 is the sha256 of the catalog in the checkout');
  const horizons = path.join(ASTER, 'src', 'v2', 'data', 'horizons-inner-solar-system-2026-2040.json');
  if (fs.existsSync(horizons)) assert.equal(sha256(fs.readFileSync(horizons)), M.provenance.horizonsFixtureSha256, 'horizonsFixtureSha256 matches the Earth fixture');
  // GRID_PARAMS in the porkchop page: the view's last departure and the derived span label
  const main = fs.readFileSync(path.join(ASTER, C.inputs.viewGrid.source), 'utf8').split('\n');
  assert.match(main[C.inputs.viewGrid.lines.depEndJD - 1], new RegExp(`depEndJD: utcMidnightToJdTdb\\('${C.inputs.viewGrid.depEndUtc}'\\)`));
  assert.match(main[C.inputs.viewGrid.lines.depStartJD - 1], new RegExp(`depStartJD: utcMidnightToJdTdb\\('${C.inputs.viewGrid.depStartUtc}'\\)`));
  assert.match(main[C.inputs.viewGrid.spanLabelDerivedAtLine - 1], /^const PORKCHOP_DEPARTURE_SPAN_LABEL = `\$\{jdTdbToUtcDateString\(GRID_PARAMS\.depStartJD\)\}/);
  assert.ok(!main.some((l) => /Grid spans 2026-2040 departures/.test(l)), 'the literal STATUS.md:418 describes is no longer in the source');
  // the precompute script: the constants the metadata records, and the co-orbital assertion
  const pre = fs.readFileSync(path.join(ASTER, C.inputs.auKm.source), 'utf8');
  assert.match(pre.split('\n')[C.inputs.auKm.line - 1], /^const AU_KM = 149_597_870\.7;/);
  const k = (re) => Number(re.exec(pre)[1]);
  assert.equal(k(/const DEPARTURE_GRID_SPACING_DAYS = (\d+);/), M.departureGridSpacingDays);
  assert.equal(k(/const TOF_MIN_DAYS = (\d+);/), M.tofMinDays);
  assert.equal(k(/const TOF_MAX_DAYS = (\d+);/), M.tofMaxDays);
  assert.equal(k(/const TOF_GRID_SPACING_DAYS = (\d+);/), M.tofGridSpacingDays);
  assert.equal(/const SCREENING_START_UTC = '(\d{4}-\d{2}-\d{2})';/.exec(pre)[1], M.screeningWindow.startUtc);
  assert.equal(/const SCREENING_END_UTC = '(\d{4}-\d{2}-\d{2})';/.exec(pre)[1], M.screeningWindow.endUtc);
  assert.equal(k(/coOrbitalCount !== (\d+)/), C.bodies.coOrbital, 'the script\'s asserted co-orbital count');
  assert.match(pre, /for \(let t = startTdb; t <= endTdb; t \+= DEPARTURE_GRID_SPACING_DAYS \* SECONDS_PER_DAY\)/, 'inclusive departure loop, as the lattice assumes');
  assert.match(pre, /for \(let d = TOF_MIN_DAYS; d <= TOF_MAX_DAYS; d \+= TOF_GRID_SPACING_DAYS\)/, 'inclusive flight-time loop');
  assert.match(pre, /if \(insertAt >= 5\)/, 'five best windows per body');
});

test('live checkout: re-running the census reproduces the snapshot and example.txt byte for byte (skipped when absent)', (t) => {
  if (!asterPresent) return t.skip(`Aster checkout not present at ${ASTER}`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-census-live-'));
  try {
    const r = spawnSync('node', [CLI, '--aster', ASTER, '--json', path.join(dir, 'census.json')], { encoding: 'utf8', maxBuffer: 1 << 26 });
    assert.equal(r.status, 0, r.stderr);
    const fresh = JSON.parse(fs.readFileSync(path.join(dir, 'census.json'), 'utf8'));
    fresh.inputs.checkout = C.inputs.checkout; // the only field that may legitimately differ (where the checkout lives)
    assert.deepEqual(fresh, C, 'the census of the live cache equals the snapshot');
    assert.equal(r.stdout, fs.readFileSync(path.join(here, 'example.txt'), 'utf8'), 'example.txt is the CLI\'s current output');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
