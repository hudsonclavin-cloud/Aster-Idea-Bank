// Tests for Round-Trip Ledger. From the bank root: node --test ideas/05-round-trip-ledger/ledger.test.mjs
// Node built-ins only. Pins: the NHATS records' own numbers (dv_dep_park, dv_total, v_dep_earth,
// v_arr_earth), Aster's delta-v.ts behaviour as its own test states it, independent arithmetic written
// here without the kernel, the WGS84 radius Aster's parking radius implies, closed forms, the CLI's
// saved output, and the measured statistics this README quotes (regression values, recomputed).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { aggregate, excerptBytes, tsNumber, tsSite, gridParams, PICK, CACHE_FIELDS } from './build-data.mjs';
import { report, bodyText, resultsJson, svgText, ratioBins } from './ledger.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const Ledger = require(path.join(here, 'ledger.js'));
const DATA = require(path.join(here, 'nhats-data.js'));
const K = Ledger.create(DATA);
const C = K.constants;
const S = K.stats();
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`);
const r3 = (x) => Number(x.toFixed(3));
const row = (des) => S.rows.find((r) => r.des === des);
const SNAP = path.join(here, 'snapshots');

function walk(dir) {
  const out = [];
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

// --- the data is what it claims to be
test('every file under snapshots/ hashes to what its sidecar recorded, from one Aster commit', () => {
  const files = walk(SNAP).filter((f) => !f.endsWith('.provenance.json'));
  assert.equal(files.length, 7, 'two NHATS bundles, three TypeScript modules, the cache excerpt and the porkchop-grid excerpt');
  for (const f of files) {
    const side = JSON.parse(fs.readFileSync(`${f}.provenance.json`, 'utf8'));
    assert.equal(sha256(fs.readFileSync(f)), side.writtenSha256, `${path.relative(here, f)} differs from what its sidecar recorded`);
    assert.equal(side.repo, 'https://github.com/hudsonclavin-cloud/asteroid-mining-planner');
    assert.match(side.commit, /^[0-9a-f]{40}$/);
    assert.equal(side.commit, DATA.aster.commit, 'one commit for every snapshot');
    assert.equal(side.readMatchesCommitted, true, `${path.basename(f)} was read from a clean checkout`);
  }
  for (const name of ['delta-v.ts', 'launch-vehicles.ts', 'feasibility.ts']) {
    const side = JSON.parse(fs.readFileSync(path.join(SNAP, `${name}.provenance.json`), 'utf8'));
    assert.equal(sha256(fs.readFileSync(path.join(SNAP, name))), side.sourceSha256, `${name} is a byte-for-byte copy`);
    assert.equal(side.mode, 'copy');
  }
  // the porkchop grid's span is read from main.ts's GRID_PARAMS block, kept verbatim with its line numbers
  const gridSide = JSON.parse(fs.readFileSync(path.join(SNAP, 'porkchop-grid.excerpt.json.provenance.json'), 'utf8'));
  const grid = JSON.parse(fs.readFileSync(path.join(SNAP, 'porkchop-grid.excerpt.json'), 'utf8'));
  assert.equal(gridSide.mode, 'derived');
  assert.equal(gridSide.path, 'src/v2/app/porkchop/main.ts');
  assert.deepEqual(grid.lines, [194, 201]);
  assert.match(grid.text, /^export const GRID_PARAMS = \{/);
  assert.deepEqual(gridParams(grid.text), { depStartUtc: '2026-01-01', depEndUtc: '2040-01-01', tofMinDays: 182.5, tofMaxDays: 1826.25 });
  assert.throws(() => gridParams('export const GRID_PARAMS = { depStartJD: 1 }'), /not found/, 'a changed block refuses instead of guessing');
  const cacheEx = JSON.parse(fs.readFileSync(path.join(SNAP, 'lambert-screen-cache.excerpt.json'), 'utf8'));
  assert.deepEqual(cacheEx.fields, CACHE_FIELDS);
  assert.ok(cacheEx.rows.every((r) => r.length === CACHE_FIELDS.length), 'one array per cache row, in the order of fields');
});

test('the NHATS bundles hold exactly the bytes snapshot.mjs wrote for each of the 135 fixture files', () => {
  let excerpts = 0;
  let copies = 0;
  for (const key of ['validation-targets', 'oq7-coorbital']) {
    const bundle = JSON.parse(fs.readFileSync(path.join(SNAP, 'nhats', `${key}.json`), 'utf8'));
    const side = JSON.parse(fs.readFileSync(path.join(SNAP, 'nhats', `${key}.json.provenance.json`), 'utf8'));
    assert.equal(side.mode, 'bundle');
    assert.equal(side.files, bundle.files.length);
    assert.match(side.committedTree, /^[0-9a-f]{40}$/, 'the directory tree id is recorded');
    assert.equal(bundle.committedTree, side.committedTree);
    assert.deepEqual(bundle.excerpt.picked, PICK);
    assert.equal(bundle.pathLastChanged, side.pathLastChanged, 'every file in the directory last changed in the same commit, hoisted');
    for (const f of bundle.files) {
      assert.match(f.committedBlob, /^[0-9a-f]{40}$/);
      assert.equal(f.readMatchesCommitted, true, `${f.file}: read bytes matched the committed blob`);
      assert.equal(f.readBlob, undefined, `${f.file}: readBlob is omitted when it equals committedBlob`);
      assert.equal(f.pathLastChanged, undefined, 'pathLastChanged is hoisted to the bundle');
      if (f.kind === 'excerpt') {
        excerpts++;
        assert.equal(sha256(excerptBytes(f.data)), f.writtenSha256, `${f.file}: data re-serialises to the tool's bytes`);
        assert.equal(excerptBytes(f.data).length, f.writtenBytes);
        assert.ok(f.data.min_dv_traj, `${f.file} carries min_dv_traj`);
      } else {
        copies++;
        assert.equal(sha256(Buffer.from(f.text)), f.writtenSha256, `${f.file}: copied text hashes to the source`);
        assert.equal(f.writtenSha256, f.sourceSha256, 'a whole copy hashes like its source');
        assert.deepEqual(f.data, { error: 'specified NHATS object not found' });
      }
    }
  }
  assert.equal(excerpts, 130);
  assert.equal(copies, 5);
});

test('nhats-data.js is the aggregate of the snapshots, rebuilt here and deep-equal; its arrays turn back into the records', () => {
  assert.deepEqual(DATA, aggregate(here));
  assert.equal(DATA.records.length, 130);
  assert.equal(DATA.notFound.length, 5);
  assert.deepEqual(DATA.notFound.map((n) => n.des).sort(), ['2003 YN107', '2006 JY26', '2008 KT', '2012 FC71', '2013 RZ53']);
  assert.deepEqual(DATA.signature, { source: 'NASA/JPL NHATS Data API', version: '1.3' });
  assert.equal(DATA.cache.rows.length, 128);
  assert.equal(DATA.cache.bodiesInSource, 41906, 'the cache excerpt records the full catalog size it was cut from');
  assert.equal(DATA.trajFields.length, 16);
  // every trajectory, rebuilt from its array, equals the min_dv_traj the bundle holds (value for value)
  const bundled = new Map();
  for (const key of ['validation-targets', 'oq7-coorbital']) {
    for (const f of JSON.parse(fs.readFileSync(path.join(SNAP, 'nhats', `${key}.json`), 'utf8')).files) if (f.data.min_dv_traj) bundled.set(`${key}/${f.file}`, f.data.min_dv_traj);
  }
  assert.equal(bundled.size, 130);
  for (const r of DATA.records) {
    const rebuilt = Object.fromEntries(DATA.trajFields.map((k, i) => [k, r.traj[i]]));
    const canon = (o) => JSON.stringify(Object.fromEntries(Object.entries(o).sort()));
    assert.equal(canon(rebuilt), canon(bundled.get(`${r.src.dir}/${r.src.file}`)), `${r.des}: array round trip`);
  }
  assert.equal(Ledger.create({ ...DATA, trajFields: undefined }).ok, false, 'arrays without their field list refuse');
});

test('constants come out of the TypeScript snapshots by regex and match the data module', () => {
  const dv = fs.readFileSync(path.join(SNAP, 'delta-v.ts'), 'utf8');
  const lv = fs.readFileSync(path.join(SNAP, 'launch-vehicles.ts'), 'utf8');
  const fz = fs.readFileSync(path.join(SNAP, 'feasibility.ts'), 'utf8');
  assert.equal(tsNumber(dv, 'EARTH_MU_KM3_PER_S2'), C.EARTH_MU_KM3_PER_S2);
  assert.equal(tsNumber(dv, 'LEO_PARKING_RADIUS_KM'), C.LEO_PARKING_RADIUS_KM);
  assert.equal(tsNumber(dv, 'STATIONKEEPING_DV_KMPS'), C.STATIONKEEPING_DV_KMPS);
  assert.equal(tsNumber(dv, 'DV_MARGIN_FRACTION'), C.DV_MARGIN_FRACTION);
  assert.equal(tsNumber(lv, 'SCREENING_ISP_S'), C.SCREENING_ISP_S);
  assert.equal(tsNumber(lv, 'G0_MPS2'), C.G0_MPS2);
  assert.equal(tsNumber(lv, 'DETERMINISTIC_MARGIN_FRACTION'), C.DETERMINISTIC_MARGIN_FRACTION);
  assert.equal(tsNumber(lv, 'SPACECRAFT_STATIONKEEPING_MPS'), C.SPACECRAFT_STATIONKEEPING_MPS);
  assert.deepEqual(tsSite(fz, 'CAPE_CANAVERAL'), C.sites.CAPE_CANAVERAL);
  assert.deepEqual(tsSite(fz, 'VANDENBERG_SFB'), C.sites.VANDENBERG_SFB);
  // the source still says what Aster's own test asserts about it (delta-v.test.mjs:73)
  assert.ok(dv.includes('symmetric-return departure burn'), 'delta-v.ts still names the symmetric-return assumption');
  assert.ok(dv.includes("missionMode === 'sample-return' ? departureDvFromVInf(vInfArrKmps) : 0"), 'departure is arrival v∞ in sample-return and 0 one-way');
  // the two altitudes the study cites are consistent with the parking radius: R_E is WGS84's 6378.137
  near(C.EARTH_RADIUS_KM, 6378.137, 1e-9, 'Aster parking radius minus the disclosed 200 km LEO is the WGS84 equatorial radius');
  assert.throws(() => tsNumber(dv, 'NOT_A_CONSTANT'), /not found/);
  assert.equal(Ledger.create({ records: [], constants: {} }).ok, false, 'missing constants refuse');
  assert.equal(Ledger.create(null).ok, false);
  assert.equal(K.displayName('2000 SG344', '(2000 SG344)'), '2000 SG344');
  assert.equal(K.displayName('2000 SG344', undefined), '2000 SG344', 'the aggregate leaves out a fullname that is only "(des)"');
  assert.equal(K.displayName('101955', '101955 Bennu (1999 RQ36)'), '101955 Bennu (1999 RQ36)');
  assert.equal(K.bodyLedger('2000 SG344').name, '2000 SG344');
  assert.equal(K.bodyLedger('101955').name, '101955 Bennu (1999 RQ36)');
  assert.deepEqual(DATA.records.filter((r) => r.fullname).map((r) => r.des), ['101955', '99942', '459872'], 'three records carry a name beyond their designation (Bennu, Apophis, 459872)');
  assert.equal(Ledger.create({ records: [], constants: { EARTH_MU_KM3_PER_S2: 1 } }).refusal.code, 'not_found');
  // the rounding half-unit is read off the records' decimals, not typed: three decimals -> 0.0005 km/s
  assert.deepEqual(S.rounding, { decimals: 3, halfUnitKmps: 0.0005 });
  const coarse = { ...DATA, records: DATA.records.map((r, i) => (i ? r : { ...r, traj: r.traj.map((v, j) => (DATA.trajFields[j] === 'c3' ? Number(v).toFixed(2) : v)) })) };
  assert.equal(Ledger.create(coarse).stats().rounding.halfUnitKmps, 0.005, 'one record with two decimals widens the half-unit');
});

test('135 files: 130 records, 5 not found, 2 designations in both directories with identical records, 128 bodies', () => {
  assert.equal(S.counts.fixtureFiles, 135);
  assert.equal(S.counts.records, 130);
  assert.equal(S.counts.notFound, 5);
  assert.equal(S.counts.uniqueBodies, 128);
  assert.equal(S.counts.duplicates, 2);
  assert.deepEqual(K.duplicates.map((d) => d.des).sort(), ['2000 SG344', '2001 GP2']);
  assert.ok(K.duplicates.every((d) => d.identical), 'both copies carry the same record');
  assert.ok(K.duplicates.every((d) => d.sources.length === 2 && d.sources[0].dir !== d.sources[1].dir));
  assert.equal(S.computed.earliest, '2021-04-19');
  assert.equal(S.computed.latest, '2026-05-24');
});

test('launch dates against windows read from the snapshots: 74 / 39 / 15 around the cache window, 37 in the porkchop grid; Slice 10\'s 36 / 89 reproduced', () => {
  const L = S.launch;
  assert.deepEqual(L.screeningWindow, DATA.cache.metadata.screeningWindow, 'the window is the cache metadata\'s');
  assert.deepEqual(L.screeningWindow, { startUtc: '2026-01-01', endUtc: '2040-12-31' });
  assert.deepEqual([L.earliestYear, L.latestYear, L.n, L.beforeWindow, L.inWindow, L.afterWindow], [2020, 2045, 128, 74, 39, 15]);
  // main.ts:194-196: departures 2026-01-01 .. 2040-01-01, so two 2040 launches fall inside the cache window but outside the grid
  assert.deepEqual([L.porkchopGrid.startUtc, L.porkchopGrid.endUtc, L.porkchopGrid.inGrid], ['2026-01-01', '2040-01-01', 37]);
  assert.deepEqual(L.porkchopGrid.inWindowNotGrid, ['2001 GP2 2040-10-10', '2014 WU200 2040-05-11']);
  // SLICE_10_FOUNDING.md:369-371: of the co-orbital directory's records, 36 launch inside 2026-2040 and 89 outside (+5 not in NHATS)
  const oq7 = L.byDir['oq7-coorbital'];
  assert.deepEqual([oq7.n, oq7.inWindow, oq7.n - oq7.inWindow, S.counts.notFound], [125, 36, 89, 5]);
  // the other three in-window bodies are validation targets only: Bennu, Apophis, 1999 AO10
  const coorbital = new Set(DATA.records.filter((r) => r.src.dir === 'oq7-coorbital').map((r) => r.des));
  const onlyValidation = S.rows.filter((r) => !coorbital.has(r.des) && r.launch >= '2026-01-01' && r.launch <= '2040-12-31').map((r) => r.des).sort();
  assert.deepEqual(onlyValidation, ['101955', '1999 AO10', '99942']);
  assert.equal(oq7.inWindow + onlyValidation.length, L.inWindow);
});

test('NHATS\'s own constraints shape the records: total ≤ 450 d (11 at the cap), stay ≥ 8 d (101 of 128 at the minimum), launch 2020-2045', () => {
  const Ct = S.constraints;
  assert.deepEqual([Ct.maxDurationDays, Ct.minStayDays, Ct.launchWindow], [450, 8, '2020-2045'], 'research note :40, :41, :31');
  assert.deepEqual(Ct.durTotal, { min: 202, max: 450 });
  assert.equal(Ct.atDurationCap, 11);
  assert.equal(Ct.allWithinDurationCap, true);
  assert.deepEqual(Ct.stayDays, { min: 8, max: 152 });
  assert.equal(Ct.atMinStay, 101);
  assert.equal(Ct.atMinStayRecords, 103, '103 of the 130 records (both duplicates sit at 8 d)');
  assert.equal(Ct.allMeetMinStay, true);
  assert.deepEqual(Ct.launchYears, { min: 2020, max: 2045 });
  // by hand from the raw arrays, without the kernel
  const at = (k) => DATA.trajFields.indexOf(k);
  assert.equal(DATA.records.filter((r) => Number(r.traj[at('dur_at')]) === 8).length, 103);
  assert.equal(Math.max(...DATA.records.map((r) => Number(r.traj[at('dur_total')]))), 450);
  // the objective string names both sets of constraints, read from data and CITED
  assert.match(K.objective, /2026-01-01 to 2040-12-31/);
  assert.match(K.objective, /at least 8 days, at most 450 days in total and launch in 2020-2045/);
});

// --- reconciliation with NHATS's own numbers
test('Aster injectionDvFromC3 at R_E + 400 km reproduces every dv_dep_park within the records\' rounding (±0.5 m/s plus c3\'s, ≤ 0.523 m/s)', () => {
  // Bennu by hand, without the kernel: 101955 c3 17.629 -> dv_dep_park 3.961
  const mu = 398600.4418;
  const r = 6378.137 + 400;
  const bennu = Math.sqrt(17.629 + (2 * mu) / r) - Math.sqrt(mu / r);
  near(bennu, 3.9608, 0.0001, 'hand computation');
  assert.equal(r3(bennu), 3.961, 'rounds to the record');
  const b = K.bodyLedger('101955');
  near(b.injection.atNhatsRadiusKmps, bennu, 1e-12, 'kernel equals the hand computation');
  assert.equal(b.injection.dv_dep_park, 3.961);
  assert.equal(C.NHATS_PARKING_RADIUS_KM, r);
  // all 130 records
  assert.ok(S.injection.maxAbsDeltaAtNhatsRadiusKmps <= 0.0006, `max |Δ| ${S.injection.maxAbsDeltaAtNhatsRadiusKmps}`);
  assert.equal(r3(S.injection.maxAbsDeltaAtNhatsRadiusKmps * 1000), 0.514, 'measured maximum 0.514 m/s (pinned, recomputed)');
  // the rounding bound: half a unit on dv_dep_park plus half a unit on c3 through d(dv)/d(c3) = 1/(2 v_perigee);
  // the largest is at the smallest c3 (0.031): 0.5 + 0.5/(2·√(0.031 + 2μ/r)) m/s, by hand
  near(S.injection.roundingBoundKmps, 0.0005 + 0.0005 / (2 * Math.sqrt(0.031 + (2 * mu) / r)), 1e-15, 'bound by hand');
  assert.equal(r3(S.injection.roundingBoundKmps * 1000), 0.523);
  assert.equal(S.injection.allWithinRounding, true, 'every record inside its own bound');
  assert.ok(K.bodies.every((x) => K.injectionCheck(x.t).withinRounding));
  // the data pin the parking radius: the best 1 km step is 6778.137 and Aster's 200 km radius is 94× worse
  near(S.injection.bestFitRadius.radiusKm, C.NHATS_PARKING_RADIUS_KM, 2, 'best-fit parking radius');
  assert.deepEqual(S.injection.fitRangeKm, { lo: 6378.137 + 100, hi: 6378.137 + 800, step: 1 });
  assert.ok(S.injection.deltaAtAsterRadiusKmps.min > 0.030 && S.injection.deltaAtAsterRadiusKmps.max < 0.049, 'at 6578.137 km Aster is 30-48 m/s above NHATS');
  assert.equal(r3(S.injection.maxAbsDeltaAtAsterRadiusKmps * 1000), 48.294);
  const worse = K.fitParkingRadius(K.bodies.map((x) => x.t), C.LEO_PARKING_RADIUS_KM, C.LEO_PARKING_RADIUS_KM, 1);
  near(worse.maxAbsDeltaKmps, S.injection.maxAbsDeltaAtAsterRadiusKmps, 1e-15, 'the fit at 200 km is the max |Δ| there');
  assert.equal(Math.round(S.injection.asterRadiusTimesWorse), 94, '48.294 / 0.514 m/s');
});

test('NHATS\'s own ledger: dv_total is the sum of its lines, v_dep_earth is √c3, vrel_arr_earth is 0 for every record', () => {
  assert.ok(S.nhatsLedger.maxAbsResidualKmps <= 0.0011, `residual ${S.nhatsLedger.maxAbsResidualKmps}`);
  assert.equal(S.nhatsLedger.residualBoundKmps, 5 * 0.0005, 'five rounded numbers');
  assert.equal(S.nhatsLedger.allSumsWithinRounding, true);
  assert.ok(S.nhatsLedger.maxAbsVDepEarthResidualKmps <= 0.001);
  assert.equal(S.nhatsLedger.allVDepEarthWithinRounding, true);
  assert.equal(S.nhatsLedger.vrelArrEarthAllZero, true);
  // every record has vrel_arr_earth 0, so the fourth line needs its own case: a capture burn counts in the sum
  const synth = K.nhatsLedger({ dv_dep_park: 1, vrel_arr_neo: 0.5, vrel_dep_neo: 0.25, vrel_arr_earth: 0.125, dv_total: 1.875, c3: 4, v_dep_earth: 2 });
  assert.equal(synth.sumKmps, 1.875);
  assert.equal(synth.residualKmps, 0);
  assert.equal(synth.vDepEarthResidualKmps, 0);
  const b = K.bodyLedger('101955').nhats;
  near(b.sumKmps, 6.995, 1e-9, 'Bennu: 3.961 + 1.501 + 1.533 + 0');
  assert.equal(b.dv_total, 6.995);
  assert.deepEqual(S.nhatsLedger.c3, { min: 0.031, max: 30.576 });
  assert.deepEqual(S.nhatsLedger.dvTotal, { min: 3.389, max: 11.031 });
  assert.equal(S.nhatsLedger.stayDays.min, 8, 'NHATS requires ≥ 8-day stays');
});

test('the stack port behaves as Aster\'s own delta-v.test.mjs asserts, and the departure override is an identity at v∞_arr', () => {
  // Bennu's injection at Aster's own radius, by hand: √(17.629 + 2μ/6578.137) − √(μ/6578.137)
  near(K.asterStack(17.629, 1.501, 'one-way').injectionKmps, Math.sqrt(17.629 + (2 * 398600.4418) / 6578.137) - Math.sqrt(398600.4418 / 6578.137), 1e-12, 'injection at 200 km by hand');
  near(K.asterStack(17.629, 1.501, 'one-way').injectionKmps, 3.9979, 0.0001, 'Bennu injection 3.998 km/s at Aster\'s radius');
  const c3 = 12.5;
  const v = 1.9;
  const oneWay = K.asterStack(c3, v, 'one-way');
  const sr = K.asterStack(c3, v, 'sample-return');
  assert.equal(oneWay.departureKmps, 0);
  assert.equal(sr.departureKmps, v);
  assert.equal(oneWay.rendezvousKmps, v);
  assert.equal(sr.rendezvousKmps, v);
  assert.equal(oneWay.subtotalKmps, K.injectionDvFromC3(c3) + v + C.STATIONKEEPING_DV_KMPS);
  assert.equal(sr.subtotalKmps, K.injectionDvFromC3(c3) + v + v + C.STATIONKEEPING_DV_KMPS);
  assert.equal(oneWay.marginKmps, oneWay.subtotalKmps * C.DV_MARGIN_FRACTION);
  assert.ok(oneWay.totalKmps < sr.totalKmps);
  for (const b of K.bodies) {
    for (const mode of Ledger.MODES) {
      const s = K.asterStack(b.t.c3, b.t.vrel_arr_neo, mode);
      near(s.injectionKmps + s.rendezvousKmps + s.departureKmps + s.stationkeepingKmps, s.subtotalKmps, 1e-12, `${b.des} ${mode} subtotal`);
      near(s.marginKmps, s.subtotalKmps * C.DV_MARGIN_FRACTION, 1e-12, 'margin is 10% of the full stack');
      near(s.totalKmps, s.subtotalKmps + s.marginKmps, 1e-12, 'total');
    }
    const n = K.asterStack(b.t.c3, b.t.vrel_arr_neo, 'sample-return', b.t.vrel_dep_neo);
    const sym = K.asterStack(b.t.c3, b.t.vrel_arr_neo, 'sample-return');
    near(n.totalKmps - sym.totalKmps, (b.t.vrel_dep_neo - b.t.vrel_arr_neo) * (1 + C.DV_MARGIN_FRACTION), 1e-12, 'the override moves the total by 1.1 × (dep − arr)');
    assert.deepEqual(K.asterStack(b.t.c3, b.t.vrel_arr_neo, 'sample-return', b.t.vrel_arr_neo).totalKmps, sym.totalKmps, 'override at v∞_arr is the symmetric stack');
    assert.equal(K.asterStack(b.t.c3, b.t.vrel_arr_neo, 'one-way', b.t.vrel_dep_neo).departureKmps, 0, 'one-way ignores the override');
  }
  assert.equal(K.asterStack(1, 1, 'round-trip').refusal.code, 'out_of_envelope');
  assert.equal(K.asterStack(NaN, 1, 'one-way').refusal.code, 'insufficient_data');
  assert.equal(K.asterStack(1, 1, 'sample-return', 'x').refusal.code, 'insufficient_data');
});

// --- the measured spread (regression values, recomputed here)
test('departure/arrival ratio over 128 bodies: min 0.214 (2008 EL68), median 1.049, max 11.627 (2025 WR7); 1.060 over 130 records', () => {
  const R = S.ratio;
  assert.equal(r3(R.unique.min), 0.214);
  assert.equal(r3(R.unique.median), 1.049);
  assert.equal(r3(R.unique.max), 11.627);
  assert.equal(R.unique.minBody, '2008 EL68');
  assert.equal(R.unique.maxBody, '2025 WR7');
  assert.equal(r3(R.allRecords.median), 1.060, 'counting the two duplicates twice, as the judges did');
  assert.equal(r3(R.unique.q1), 0.827);
  assert.equal(r3(R.unique.q3), 1.812);
  assert.deepEqual([R.below1, R.above1, R.exactly1, R.within10pct, R.within25pct, R.offByTwoOrMore], [51, 76, 1, 26, 54, 35]);
  // 54 of 128 within ±25 % is 42 %, not half
  assert.equal(Math.round((100 * R.within25pct) / R.unique.n), 42);
  // the lean above 1: exact two-sided sign test on 76 of 127 (the ratio of exactly 1 left out), by hand with BigInt
  const choose = (n, k) => { let c = 1n; for (let i = 0n; i < k; i++) c = (c * (n - i)) / (i + 1n); return c; };
  let tail = 0n;
  for (let i = 76n; i <= 127n; i++) tail += choose(127n, i);
  const pHand = Number((2n * tail * 10n ** 15n) / 2n ** 127n) / 1e15;
  near(R.signTestP, pHand, 1e-12, 'sign test p');
  assert.equal(r3(R.signTestP), 0.033);
  assert.equal(K.signTestTwoSided(5, 10), 1, 'a balanced split is p = 1 (capped)');
  near(K.signTestTwoSided(10, 10), 2 / 1024, 1e-15, 'ten of ten: 2 × 2^-10');
  // the bands are closed intervals: a ratio of exactly 1.1 or 0.9 is within ±10 % (|1.1 − 1| > 0.1 in doubles)
  assert.equal(K.withinOf1(1.1, 0.1), true);
  assert.equal(K.withinOf1(0.9, 0.1), true);
  assert.equal(K.withinOf1(1.1000001, 0.1), false);
  assert.equal(K.withinOf1(0.75, 0.25), true);
  // by hand from the records
  near(row('2008 EL68').ratio, 0.207 / 0.968, 1e-12, '2008 EL68: vrel_dep 0.207 / vrel_arr 0.968');
  near(row('2025 WR7').ratio, 0.686 / 0.059, 1e-12, '2025 WR7: 0.686 / 0.059');
  near(row('101955').ratio, 1.533 / 1.501, 1e-12, 'Bennu');
  assert.deepEqual([r3(S.departureMinusArrivalKmps.min), r3(S.departureMinusArrivalKmps.median), r3(S.departureMinusArrivalKmps.max)], [-2.516, 0.026, 1.755]);
  // the histogram the page and the SVG draw
  const h = ratioBins(K, S.rows);
  assert.equal(h.bins.length, 13);
  assert.equal(h.outside, 0);
  assert.equal(h.bins.reduce((n, b) => n + b.count, 0), 128);
  const one = h.bins.find((b) => b.lo < 1 && b.hi >= 1);
  assert.ok(one, 'a bin edge falls at exactly 1 (2^0)');
  near(one.hi, 1, 1e-12, 'the bin below 1 ends at 1');
});

test('cost-card consequence at Isp 320 s: delivered mass with NHATS\'s departure ÷ symmetric runs 0.556 (1999 AO10) to 2.321 (459872)', () => {
  const M = S.massFactor;
  assert.equal(r3(M.min), 0.556);
  assert.equal(r3(M.max), 2.321);
  assert.equal(M.minBody, '1999 AO10');
  assert.equal(M.maxBody, '459872');
  assert.deepEqual([M.below0p9, M.above1p1], [22, 11]);
  // by hand: exp(−1.05 × (dep − arr) × 1000 / (g0 Isp)); 1999 AO10 dep 2.106, arr 0.351
  const ve = 9.80665 * 320;
  near(row('1999 AO10').massFactor, Math.exp((-1.05 * (2.106 - 0.351) * 1000) / ve), 1e-12, '1999 AO10 by hand');
  near(row('459872').massFactor, Math.exp((-1.05 * (0.725 - 3.241) * 1000) / ve), 1e-12, '459872 by hand');
  // the cost card itself, Bennu: rendezvous 1501, departure 1501, sk 150, margin 5% of 3002 = 150.1
  const b = K.bodyLedger('101955');
  assert.deepEqual([b.costCardSymmetric.rendezvousMps, b.costCardSymmetric.departureMps, b.costCardSymmetric.stationkeepingMps], [1501, 1501, 150]);
  near(b.costCardSymmetric.marginMps, 150.1, 1e-9, '5% of the deterministic maneuvers only');
  near(b.costCardSymmetric.dvSpacecraftMps, 3302.1, 1e-9, 'budget');
  near(b.costCardSymmetric.massFraction, Math.exp(-3302.1 / ve), 1e-12, 'exp(−Δv/(g0 Isp))');
  const ow = K.costCard(1.501, 1.533, 'one-way');
  assert.equal(ow.departureMps, 0);
  near(ow.marginMps, 1501 * 0.05, 1e-9, 'one-way margins rendezvous only');
  assert.equal(K.bodyLedger('101955', { mode: 'one-way' }).massFactor, 1, 'one-way: no departure line, nothing to mis-state');
  assert.equal(K.costCard(1, 1, 'x').refusal.code, 'out_of_envelope');
});

// --- Earth arrival
test('implied Earth-arrival v∞ at 125 km runs 0.262 (2011 WE) to 4.345 km/s (2014 KF39), every record above escape and under the 12 km/s cap', () => {
  const A = S.arrival;
  assert.deepEqual(A.vArrEarth, { min: 11.075, max: 11.894 });
  assert.equal(A.allBelowCap, true);
  assert.equal(A.refusedAt125, 0);
  near(A.escapeAt125Kmps, Math.sqrt((2 * 398600.4418) / (6378.137 + 125)), 1e-12, 'escape speed at 125 km');
  assert.equal(r3(A.escapeAt125Kmps), 11.072);
  assert.equal(r3(A.vinf125.min), 0.262);
  assert.equal(r3(A.vinf125.max), 4.345);
  assert.equal(A.vinf125.minBody, '2011 WE');
  assert.equal(A.vinf125.maxBody, '2014 KF39');
  near(row('2011 WE').vinf125, Math.sqrt(11.075 ** 2 - (2 * 398600.4418) / 6503.137), 1e-12, '2011 WE by hand');
  near(row('2014 KF39').vinf125, Math.sqrt(11.894 ** 2 - (2 * 398600.4418) / 6503.137), 1e-12, '2014 KF39 by hand');
  // rounding sensitivity at the low end: ±0.0005 km/s on v_arr_earth is ±0.02 km/s on v∞
  assert.equal(r3(A.vinf125.minRoundingLow), 0.240);
  assert.equal(r3(A.vinf125.minRoundingHigh), 0.282);
  // the 200 km convention moves the floor by a full km/s
  assert.equal(r3(A.vinf200.min), 1.211);
  assert.equal(r3(A.vinf200.max), 4.503);
  // refusals, not NaN
  const r = K.impliedArrivalVinf(11.0, 125);
  assert.equal(r.refusal.code, 'out_of_envelope');
  assert.equal(K.impliedArrivalVinf(NaN, 125).refusal.code, 'insufficient_data');
  assert.equal(K.impliedArrivalVinf(11.5, -1).refusal.code, 'out_of_envelope');
  near(K.impliedArrivalVinf(A.escapeAt125Kmps, 125).value, 0, 1e-6, 'exactly escape → v∞ 0');
  // closed form: v∞² + 2μ/r = v²
  for (const b of K.bodies) {
    const a = K.impliedArrivalVinf(b.t.v_arr_earth, 125);
    near(a.value ** 2 + (2 * C.EARTH_MU_KM3_PER_S2) / a.radiusKm, b.t.v_arr_earth ** 2, 1e-9, `${b.des} vis-viva`);
  }
});

// --- declinations
test('Aster\'s band model, ported: NHATS dec_dep from the Cape is GREEN 56 / AMBER 44 / RED 28; Vandenberg 115 / 13 / 0', () => {
  const cape = C.sites.CAPE_CANAVERAL;
  const van = C.sites.VANDENBERG_SFB;
  assert.equal(K.dlaBand(28.5, cape), 'GREEN', 'the edge is inclusive (feasibility.ts: |DLA| <= iMinDeg)');
  assert.equal(K.dlaBand(-28.5, cape), 'GREEN');
  assert.equal(K.dlaBand(28.51, cape), 'AMBER');
  assert.equal(K.dlaBand(57, cape), 'AMBER');
  assert.equal(K.dlaBand(57.01, cape), 'RED');
  assert.equal(K.dlaBand(70, van), 'GREEN');
  assert.equal(K.dlaBand(89.9, van), 'AMBER');
  assert.equal(K.dlaBand(90, van), 'AMBER', 'the polar corridor covers every declination');
  assert.equal(K.dlaBand(NaN, cape), null);
  // the AMBER ceiling is the site's dlaCeilingDeg, not its iMaxDeg (the Cape has both at 57, so a synthetic site tells them apart)
  const synthSite = { iMinDeg: 10, iMaxDeg: 60, dlaCeilingDeg: 40 };
  assert.equal(K.dlaBand(50, synthSite), 'RED');
  assert.equal(K.dlaBand(40, synthSite), 'AMBER');
  assert.equal(K.dlaBand(10, synthSite), 'GREEN');
  assert.deepEqual(S.declination.depCape, { GREEN: 56, AMBER: 44, RED: 28 });
  assert.deepEqual(S.declination.depVandenberg, { GREEN: 115, AMBER: 13, RED: 0 });
  assert.deepEqual(S.declination.arrCape, { GREEN: 60, AMBER: 42, RED: 26 });
  assert.deepEqual(S.declination.dep, { min: -85.268, max: 79.636 });
  assert.equal(row('101955').bandDepCape, 'AMBER', 'Bennu dec_dep −39.357°');
});

// --- the cache and the refusals
test('all 128 bodies are in Aster\'s screening cache (125 co-orbital, all low_departure_c3); the return leg is a refusal', () => {
  const { vInfArrMinusNhatsKmps: vd, ...cacheRest } = S.cache;
  assert.deepEqual(cacheRest, { rows: 128, of: 128, coOrbital: 125, statuses: { low_departure_c3: 128 }, minC3BelowNhatsC3: 117, screeningWindow: { startUtc: '2026-01-01', endUtc: '2040-12-31' }, vInfArrAboveNhats: 127 });
  // Aster's cheapest cells are different trajectories: their arrival v∞ sits above NHATS's for 127 of 128
  assert.deepEqual([r3(vd.min), r3(vd.median), r3(vd.max)], [-0.017, 2.413, 5.536]);
  const bennu = K.bodyLedger('101955');
  assert.equal(r3(bennu.cache.minC3VInfArr), 5.215, 'Bennu\'s cheapest-C3 cell arrives at 5.215 km/s');
  assert.equal(bennu.traj.vrel_arr_neo, 1.501, 'NHATS\'s trajectory at 1.501');
  near(bennu.cache.vInfArrMinusNhatsKmps, bennu.cache.minC3VInfArr - 1.501, 1e-12);
  const b = K.bodyLedger('2000 SG344');
  near(b.cache.minC3, 0.0034492363275969514, 1e-15, 'cache minC3 for 2000 SG344 is the cache\'s number');
  assert.equal(b.cache.minC3Date, '2027-07-15');
  assert.match(b.cache.objective, /different objective/);
  assert.equal(b.returnLeg.refusal.code, 'insufficient_data');
  assert.match(b.returnLeg.refusal.what_would_help, /K1/);
  assert.equal(b.sources.length, 2, '2000 SG344 is in both fixture directories');
  const nf = K.bodyLedger('2003 YN107');
  assert.equal(nf.refusal.code, 'not_found');
  assert.match(nf.refusal.reason, /specified NHATS object not found/);
  assert.ok(nf.refusal.what_would_help.length > 20);
  assert.equal(K.bodyLedger('no such body').refusal.code, 'not_found');
  assert.equal(K.bodyLedger('').refusal.code, 'out_of_envelope', 'an empty designation is a usage refusal');
  assert.match(K.bodyLedger('2003_YN107').refusal.reason, /specified NHATS object not found/, 'the fixture file form finds the API error');
  assert.equal(K.bodyLedger('  101955 ').des, '101955', 'surrounding spaces are trimmed');
  assert.equal(K.bodyLedger('101955', { mode: 'orbit' }).refusal.code, 'out_of_envelope');
  assert.equal(K.bodyLedger('101955', { departure: 'guess' }).refusal.code, 'out_of_envelope');
  assert.equal(K.bodyLedger('101955', { mode: 'one-way', departure: 'nhats' }).departureBasis, 'none', 'one-way has no departure line to swap');
  assert.equal(K.bodyLedger('101955', { departure: 'nhats' }).stack.departureKmps, 1.533);
  assert.equal(K.bodyLedger('101955').stack.departureKmps, 1.501);
});

// --- outputs
test('the CLI: saved example.txt and results.json are exactly what it produces now; the SVG; exit codes', () => {
  const rep = report(K);
  assert.equal(rep.ok, true);
  assert.equal(fs.readFileSync(path.join(here, 'example.txt'), 'utf8'), rep.text, 'example.txt is the current report');
  assert.equal(fs.readFileSync(path.join(here, 'results.json'), 'utf8'), resultsJson(K, rep.stats), 'results.json is current');
  const parsed = JSON.parse(fs.readFileSync(path.join(here, 'results.json'), 'utf8'));
  assert.equal(parsed.bodies, 128);
  assert.equal(parsed.summary.ratio.unique.n, 128);
  assert.equal(r3(parsed.extremes['2025 WR7'].ratio), 11.627);
  assert.equal(parsed.extremes['101955'].launch, '2036-03-21');
  assert.equal(parsed.constants.LEO_PARKING_RADIUS_KM, C.LEO_PARKING_RADIUS_KM);
  assert.equal(svgText(K, rep.stats), svgText(K, K.stats()), 'the SVG is deterministic');
  assert.match(rep.text, /Checks: 4\/4 hold/);
  assert.match(rep.text, /median 1\.049/);
  assert.match(rep.text, /max 11\.627 \(2025 WR7\)/);
  const cli = path.join(here, 'ledger.mjs');
  assert.equal(spawnSync('node', [cli, '--help'], { encoding: 'utf8' }).status, 0);
  assert.equal(spawnSync('node', [cli, '--bogus'], { encoding: 'utf8' }).status, 2);
  assert.equal(spawnSync('node', [cli, '--mode', 'orbit'], { encoding: 'utf8' }).status, 2);
  const nf = spawnSync('node', [cli, '--body', '2003 YN107'], { encoding: 'utf8' });
  assert.equal(nf.status, 1);
  assert.equal(JSON.parse(nf.stdout).refusal.code, 'not_found');
  assert.equal(spawnSync('node', [cli, '--body', ''], { encoding: 'utf8' }).status, 2, 'an empty --body is a usage error');
  const fileForm = spawnSync('node', [cli, '--body', '2003_YN107'], { encoding: 'utf8' });
  assert.equal(fileForm.status, 1);
  assert.match(JSON.parse(fileForm.stdout).refusal.reason, /specified NHATS object not found/, 'the fixture file form gets the API-error refusal');
  assert.equal(spawnSync('node', [cli, '--body', '  101955 '], { encoding: 'utf8' }).status, 0, 'spaces trimmed');
  const ok = spawnSync('node', [cli, '--body', '2000 SG344'], { encoding: 'utf8' });
  assert.equal(ok.status, 0);
  assert.match(ok.stdout, /0\.137 \| 0\.166 km\/s \(ratio 1\.212\)/);
  assert.equal(bodyText(K, '2000 SG344', 'sample-return').text, ok.stdout);
  const full = spawnSync('node', [cli], { encoding: 'utf8' });
  assert.equal(full.status, 0);
  assert.equal(full.stdout, rep.text);
  // the SVG: 13 bars' hit targets, a marker at 1, no NaN
  const svg = svgText(K, rep.stats);
  assert.equal((svg.match(/class="hit"/g) || []).length, 13);
  assert.match(svg, /class="marker"/);
  assert.doesNotMatch(svg, /NaN/);
});

test('the page retypes no measured number and no constant: index.html carries only words, ids and citations', () => {
  const html = fs.readFileSync(path.join(here, 'index.html'), 'utf8');
  for (const s of ['0.214', '11.627', '11.63', '1.049', '1.060', '0.556', '2.321', '4.345', '0.262', '398600', '398,600', '6578.137', '6778.137', '6503.137', '6378.137', '9.80665', '0.150', '>320<', '320 s', '28.5°', '57°']) {
    assert.ok(!html.includes(s), `index.html must not contain '${s}' as static text`);
  }
  const app = fs.readFileSync(path.join(here, 'app.js'), 'utf8');
  for (const s of ['398600', '6578.137', '6778.137', '6503.137', '6378.137', '9.80665', '0.21384', '11.6271', '2026', '2040', '75 km', '0.0005', '450', '×0.9', '±10%']) {
    assert.ok(!app.includes(s), `app.js must not contain '${s}'`);
  }
  // no window year is typed in the kernel or the CLI either: windows come from the snapshots
  for (const f of ['ledger.js', 'ledger.mjs']) {
    const src = fs.readFileSync(path.join(here, f), 'utf8');
    for (const s of ['2026', '2040', '0.0005', '0.0006', '0.0016']) assert.ok(!src.includes(s), `${f} must not contain '${s}'`);
  }
  // the cited values live in one place, with their citations
  assert.deepEqual(Object.values(Ledger.CITED).map((c) => c.value), [200, 400, 125, 200, 12, 450, 8, '2020-2045']);
  assert.ok(Object.values(Ledger.CITED).every((c) => /:\d+/.test(c.cite)), 'every cited value names a file:line');
});
