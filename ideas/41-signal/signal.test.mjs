// Tests for idea 41 (Signal). node --test ideas/41-signal/signal.test.mjs (from the bank root; about 15 s).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { K, K40 } = require('./load.cjs');
const HZ = require('./snapshots/horizons-geometry.js');
const CR = K.craft, D = K.dsn, db = K.db, C = K.C, AU = K.AU;
const SAMPLE = JSON.parse(fs.readFileSync(path.join(here, 'handoff.json'), 'utf8'));
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b} (tol ${tol})`);
const src = K.importLongCoast(SAMPLE.inputs.long_coast_handoff);
const RUN = K.run(src, SAMPLE.inputs.settings);
const O = K.oracles(HZ, src.R40);
const rd = (key, over) => K.radio(Object.assign(K.defaults(key), over || {}));

test('snapshots match their sidecars', () => {
  const dir = path.join(here, 'snapshots');
  for (const f of fs.readdirSync(dir).filter((x) => !x.endsWith('.provenance.json'))) {
    const side = JSON.parse(fs.readFileSync(path.join(dir, f + '.provenance.json'), 'utf8'));
    assert.ok(side.repo && side.path && side.commit, f + ' sidecar keys');
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, f))).digest('hex'), side.writtenSha256, f);
  }
  // the DSN station coordinates are 810-005 301's, the same three 70-m stations idea 40 tracks with
  for (const id of ['DSS-14', 'DSS-43', 'DSS-63']) assert.deepEqual(D.stations[id].xyz_m, K40.nav.stations.list.filter((s) => s.id === id)[0].xyz_m);
});

test('closed forms: free-space loss, noise density, scaling', () => {
  const r = rd('dawn'), lb = K.linkBudget(r, AU, 'DSS-26', 45, 0.9, 90, 0, 0), lb2 = K.linkBudget(r, 2 * AU, 'DSS-26', 45, 0.9, 90, 0, 0);
  near(lb.lines.spaceLoss_dB, -20 * Math.log10(4 * Math.PI * AU * r.f_Hz / C), 1e-9);
  near(lb2.lines.ptn0_dBHz - lb.lines.ptn0_dBHz, -20 * Math.log10(2), 1e-9, 'twice the range');
  near(lb.lines.n0_dBmHz, 10 * Math.log10(1.380649e-23 * lb.lines.snt_K) + 30, 1e-12);
  const p2 = K.linkBudget(rd('dawn', { power_W: 200 }), AU, 'DSS-26', 45, 0.9, 90, 0, 0), d2 = K.linkBudget(rd('dawn', { diameter_m: 3.048 }), AU, 'DSS-26', 45, 0.9, 90, 0, 0);
  near(p2.lines.ptn0_dBHz - lb.lines.ptn0_dBHz, 10 * Math.log10(2), 0.01, 'twice the power (100 W preset)');
  near(d2.lines.ptn0_dBHz - lb.lines.ptn0_dBHz, 20 * Math.log10(2), 1e-9, 'twice the dish');
  near(rd('dawn', { band: 'Ka' }).gain_dBi - r.gain_dBi, 20 * Math.log10(32050 / 8435.370372), 1e-9, 'Ka gain at the same efficiency');
  // carrier and data share the power: cos^2 + sin^2 = 1 at any modulation index, ranging off
  const s = K.suppression(rd('di'), 72); near(10 ** (s.carrier_dB / 10) + 10 ** (s.data_dB / 10), 1, 1e-12);
  near(s.carrier_dB, -10.20, 0.005, 'cos^2 72 deg, every DCT'); near(s.data_dB, -0.44, 0.005, 'sin^2 72 deg');
});

test('DSN model reproduces Juno\'s published DCT (DSS-26, 2012-07-05)', () => {
  const J = O.juno;
  near(J.tAmw[1], J.tAmw[0], 0.01, 'antenna-microwave noise 16.33 K');
  near(J.spaceLoss[1], J.spaceLoss[0], 0.01, 'space loss');
  near(J.gain[1], J.gain[0], 0.015, 'DSN gain');
  near(J.ptn0[1], 55.964, 0.002); near(J.ptn0[1] - J.ptn0[0], 0.06, 0.01, 'Pt/No gap');
  near(J.snt[1], 22.34, 0.01); near(J.tAtm[1], 3.31, 0.01, 'the atmosphere is where the 0.36 K comes from');
  near(J.eirp[0] - J.eirp[1], 0.10, 0.001, 'the DCT totals use the mean transmitter power (44.50, not 44.40)');
});

test('Dawn (Canberra, 2014) and Deep Impact (DSS-14 70 m, 2005) DCTs: the gaps, pinned', () => {
  near(O.dawn.spaceLoss[1], O.dawn.spaceLoss[0], 0.005, 'Dawn space loss from its light time');
  near(O.dawn.ptn0[1] - O.dawn.ptn0[0], 0.133, 0.01, 'Dawn Pt/No with DSS-34');
  near(O.dawn.tSun[1], 0.631, 0.002); near(O.dawn.sep_deg, 3.618, 1e-3, 'Horizons SEP at the DCT epoch');
  near(O.di.eirp[1], O.di.eirp[0], 1e-4, 'DI EIRP'); near(O.di.spaceLoss[1], O.di.spaceLoss[0], 0.005);
  near(O.di.gain[1] - O.di.gain[0], 0.489, 0.005, 'DSS-14 gain today against 2005');
  near(O.di.snt[1] - O.di.snt[0], -0.898, 0.01); near(O.di.ptn0[1] - O.di.ptn0[0], 0.655, 0.01, 'DI Pt/No');
});

test('published rate thresholds: the model is exact at the rates that fly at the asteroid, optimistic at low rates', () => {
  const T = O.thresholds;
  assert.ok(T.di.maxGapHigh_dB < 0.015, 'DI, 1 kbps to 400 kbps: ' + T.di.maxGapHigh_dB);
  near(T.di.worstLow.published - T.di.worstLow.model, 3.28, 0.01, 'DI at 10 bps (subcarrier and sync losses not modelled)');
  assert.ok(T.juno.maxGapHigh_dB < 0.07, 'Juno with ranging, >= 99.7 kbps: ' + T.juno.maxGapHigh_dB);
  near(T.juno.worstLow.published - T.juno.worstLow.model, 1.37, 0.01, 'Juno at 100 bps');
  near(T.junoNoRanging.maxGapHigh_dB, 0.365, 0.005, 'Juno without ranging, high rates');
  // the radio uses the published threshold wherever one exists
  const lb = K.linkBudget(rd('juno'), 4.7456e11, 'DSS-26', 59.65, 0.9, 18, 0, 0.93);
  assert.equal(lb.rows.find((x) => x.bps === 119191).reqPtN0_dBHz, 51.78);
  assert.equal(lb.rows.find((x) => x.bps === 119191).reqSource, 'published');
  // at Dawn's 10 bps (35 deg, 3 Hz loop, ranging on) the carrier sets the need: 10 dB + 10 log 3 - 20 log cos 35 deg + 0.30 dB
  const r10 = K.linkBudget(rd('dawn'), 3 * AU, 'DSS-26', 40, 0.9, 90, 0, 0), row = r10.rows.find((x) => x.bps === 10);
  near(row.carrierNeed_dBHz, 10 + 10 * Math.log10(3) - 20 * Math.log10(Math.cos(35 * Math.PI / 180)) + 0.30, 1e-9); near(row.carrierNeed_dBHz, 16.804, 0.001); assert.ok(row.carrierNeed_dBHz > row.reqPtN0_dBHz);
  near(row.margin_dB, r10.lines.ptn0_dBHz - row.carrierNeed_dBHz, 1e-9, 'the margin is against the carrier');
});

test('reality: Dawn\'s own station monitor data, five 34-m passes in June 2009', () => {
  const M = O.dawnMonitor, gap = (k) => M.map((m) => m[k][0] - m[k][1]), mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const dc = gap('carrier'), ds = gap('ssnr');
  assert.equal(M.length, 5);
  near(mean(dc), 0.873, 0.005, 'measured carrier louder than predicted (mean)'); assert.ok(Math.min(...dc) > 0.5 && Math.max(...dc) < 1.2, dc.join(' '));
  near(mean(ds), 0.257, 0.005, 'symbol SNR gap (mean)'); assert.ok(Math.min(...ds) > -0.1 && Math.max(...ds) < 0.65, ds.join(' '));
  near(M[1].snt[0] - M[1].snt[1], 7.46, 0.02, 'DSS-25 measured 29.4 K against today\'s model');
});

test('810-005 worked examples and thresholds: corona, scintillation, Sun noise', () => {
  near(O.corona.stec[1] / O.corona.stec[0], 0.988, 0.002, 'STEC at SEP 1.5, beta 150 ("approximately 3e20")');
  near(O.corona.delayS_us[1], 7.533, 0.002); near(O.corona.delayX_us[1], 0.562, 0.002);
  near(O.scintillation.X[1], 2.193, 0.001, 'm = 0.3 at X ("near 2.3 deg")'); near(O.scintillation.Ka[1], 0.978, 0.001, 'Ka ("~1 deg")');
  assert.equal(K.scintillation('X', 1.0).m, 1); assert.equal(K.scintillation('Ka', 0.5).m, 1);
  assert.equal(K.scintillation('X', 1.4).m, 1, 'eq. (7) gives 1.04 here; the index saturates at 1 (Figure 5)');
  const a = K.sunNoise('X', 0.75 - 1e-9, 34).T_K, b = K.sunNoise('X', 0.75 + 1e-9, 34).T_K; near(a / b, 1, 0.015, 'eq. (10) continuous at 0.75 deg');
  assert.equal(K.sunNoise('X', 4.1, 34).T_K, 0); assert.ok(K.sunNoise('X', 0.3, 34).refusal); assert.ok(K.sunNoise('X', 2, 70).refusal);
  // a straight ray: the integral against a closed form, (1+x^2)^-1.15 term only, foot inside, both ends far
  const far = 1e15, p = 10 * D.corona.R0_m, st = K.stec([-far, p, 0], [far, p, 0]);
  const beta = (a2, b2) => Math.exp(lgam(a2) + lgam(b2) - lgam(a2 + b2));
  function lgam(z) { const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61503916999185, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7]; z -= 1; let x = c[0]; for (let i = 1; i < 9; i++) x += c[i] / (z + i); const t = z + g + 0.5; return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x); }
  const closed = (n, q) => n * Math.pow(p / D.corona.R0_m, -q) * p * beta(0.5, (q - 1) / 2);
  near(st / (closed(D.corona.n1, D.corona.p1) + closed(D.corona.n2, D.corona.p2)), 1, 5e-5, 'Gauss-Legendre in the tan substitution (3e-5: the 2.3 term goes as cos^0.3 at 90 deg)');
});

test('geometry against JPL Horizons', () => {
  const g = O.geometry; assert.equal(g.n, 27);
  assert.ok(g.range_m < 8000 && g.owlt_s < 2.7e-5, 'Apophis range ' + g.range_m + ' m (the Sun\'s own motion over the light time)');
  assert.ok(g.ra_deg < 3e-6 && g.dec_deg < 1e-6, 'astrometric RA/Dec');
  assert.ok(g.sep_deg < 0.009, 'Sun-Earth-probe angle (Horizons applies aberration)');
  assert.ok(O.ds1Geometry.n === 14 && O.ds1Geometry.sep_deg < 1e-4 && O.ds1Geometry.range_m < 8200, 'DS1');
  near(O.junoElevation.horizons, 59.6513, 1e-4); near(O.junoElevation.model - O.junoElevation.horizons, 0.111, 0.002, 'idea 40\'s station model, Juno');
  near(O.stationElevation.max_deg, 0.280, 0.002); near(O.stationElevation.mean_deg, 0.089, 0.002); assert.equal(O.stationElevation.n, 38);
  // light time: the round trip is an up-leg then a down-leg, a little under twice the one-way
  const A = RUN.arrival; near(A.rtlt_s / (2 * A.owlt_s), 0.99991, 1e-5);
});

test('the chain\'s Apophis (idea 40, Aster\'s elements) against Horizons, before and after its 2029 encounter', () => {
  const c = O.chainApophis;
  assert.equal(c.before.n, 56); assert.ok(c.before.range_m < 10000 && c.before.sep_deg < 0.0092 && c.before.dec_deg < 3e-5, JSON.stringify(c.before));
  assert.equal(c.after.n, 15); near(c.after.range_m, 287087, 50, 'the encounter multiplies the error'); assert.ok(c.after.dec_deg < 9e-4);
});

test('DS1\'s 2000 conjunction: Horizons against the DESCANSO article', () => {
  const d = O.ds1Dates, dd = (k, i) => d[k].horizons[i] - d[k].article[i];
  near(dd('below5', 0), 1.37, 0.01); near(dd('below5', 1), 0.0, 0.01); near(dd('below3', 0), 1.11, 0.01); near(dd('below3', 1), -0.37, 0.01);
  near(d.min.sep, 0.0696, 1e-4); near(d.firstTelemetry.horizonsSep, 1.8965, 1e-4, 'the article says 1.1 deg on 20 Nov');
});

test('the chain sample: arrival link, totals, refusals', () => {
  const A = RUN.arrival, L = A.dct.lines;
  near(A.range_m / AU, 0.689064, 1e-6); near(A.owlt_s, 343.846, 1e-3); near(A.rtlt_s, 687.628, 1e-3); near(A.sep_deg, 72.986, 1e-3);
  assert.equal(A.dct.station, 'DSS-26'); near(A.dct.elevation_deg, 34.10, 0.01); near(L.ptn0_dBHz, 70.780, 0.002);
  assert.equal(A.dct.best.bps, 123751.4); near(A.dct.best.margin_dB, 18.689, 0.002);
  const T = RUN.totals; assert.equal(RUN.days.length, 1041); assert.equal(T.cruise_days, 677); assert.equal(T.stay_days, 364);
  assert.equal(T.blackout_days, 0); assert.equal(T.saturation_days, 61); near(T.total_bits, 1.58956e12, 1e8);
  assert.equal(RUN.conjunctions.length, 0, 'Apophis never comes within 5 deg of the Sun');
  const own = RUN.refusals.filter((r) => !r.from).map((r) => r.applies_to).sort();
  assert.deepEqual(own, ['saturation', 'spacecraft', 'uplink']);
  // the stay runs through Apophis's encounter of 2029-04-13 ~21:46 UTC: the nearest daily (00:00 UTC) sample is the 14th
  const close = RUN.days.reduce((m, d) => (d.range_m < m.range_m ? d : m)); assert.equal(close.utc, '2029-04-14'); assert.ok(close.range_m < 1e8, close.range_m);
});

test('Eros: a superior conjunction, X against Ka, 34 m against 70 m, table against continuous', () => {
  const s = K.fromPreset('433'), base = K.defaults('dawn', s.R40.S.nav), run = (o) => K.run(s, Object.assign({}, base, o));
  const X = run({}), Ka = run({ band: 'Ka' }), M70 = run({ antenna: '70m' }), Cn = run({ rateMode: 'continuous' });
  const c = X.conjunctions[0]; assert.equal(X.conjunctions.length, 1);
  assert.equal(c.kind, 'superior'); assert.equal(c.min_at_utc, '2029-01-08'); near(c.min_sep_deg, 0.0822, 1e-4); assert.equal(c.days, 30);
  assert.equal(X.totals.blackout_days, 13); assert.equal(Ka.totals.blackout_days, 5); assert.equal(M70.totals.refused_days, 11);
  assert.ok(Ka.refusals.some((r) => r.applies_to === 'ka_band')); assert.ok(M70.refusals.some((r) => r.applies_to === 'sun_noise'));
  near(Cn.arrival.dct.best.bps, 501358, 1); assert.equal(X.arrival.dct.best.bps, 123751.4);
  // continuous rates follow 1/range^2 where nothing else changes, and stop at the decoder's 1 Mbps
  const r1 = K.linkBudget(Cn.radio, 2 * AU, 'DSS-26', 40, 0.9, 90, 3, 0).best.bps, r2 = K.linkBudget(Cn.radio, 4 * AU, 'DSS-26', 40, 0.9, 90, 3, 0).best.bps;
  near(r1 / r2, 4, 1e-9); assert.equal(K.linkBudget(Cn.radio, 0.05 * AU, 'DSS-26', 40, 0.9, 90, 3, 0).best.bps, D.decoderMax_bps.turbo16);
});

test('idea 40\'s committed sample imports and gives the same cruise as the preset', { skip: !fs.existsSync(path.join(here, '..', '40-long-coast', 'handoff.json')) }, () => {
  const h40 = fs.readFileSync(path.join(here, '..', '40-long-coast', 'handoff.json'), 'utf8'), s2 = K.importLongCoast(h40);
  assert.ok(!s2.refusal); const R2 = K.run(s2, SAMPLE.inputs.settings);
  near(R2.arrival.range_m, RUN.arrival.range_m, 1); near(R2.totals.total_bits, RUN.totals.total_bits, 1);
  const carried = R2.refusals.filter((r) => r.from); assert.equal(carried.length, 16); assert.ok(carried.some((r) => r.from === '33-engine-deck'));
  const h = K.buildHandoff(R2, 'x'); assert.ok(!K.parseHandoff(h).refusal, 'and its 41 handoff reads back');
});

test('handoff: the sample is what its inputs give, round-trips, and refuses edits and strangers', () => {
  const again = K.buildHandoff(RUN, SAMPLE.produced);
  for (const k of Object.keys(again.outputs)) assert.equal(K.numDiff(SAMPLE.outputs[k], again.outputs[k], k), null, k);
  for (const k of Object.keys(SAMPLE.outputs)) { const o = SAMPLE.outputs[k]; assert.ok(o.units && o.confidence && o.source, k); }
  assert.equal(SAMPLE.inputs.long_coast_handoff.from, '40-long-coast');
  const P = K.parseHandoff(JSON.stringify(SAMPLE)); assert.ok(!P.refusal, P.refusal && P.refusal.reason);
  const edit = (f) => { const h = JSON.parse(JSON.stringify(SAMPLE)); f(h); return K.parseHandoff(h).refusal; };
  assert.ok(edit((h) => { h.outputs.arrival_link.value.range_m *= 1.00001; }));
  assert.ok(edit((h) => { h.outputs.data_volume.value.total_bits *= 1.001; }));
  assert.ok(edit((h) => { h.outputs.comms_timeline.value.rate_bps[10] = 1; }));
  assert.ok(edit((h) => { h.refusals.pop(); }));
  assert.ok(edit((h) => { h.inputs.settings.power_W = 50; }));
  assert.ok(K.importLongCoast('not json').refusal); assert.ok(K.importLongCoast({ handoff: 'other' }).refusal);
  const r39 = K.importLongCoast({ handoff: 'long-way-round', from: '39-lamberts-road' }).refusal; assert.match(r39.what_would_help, /idea 40/);
});

test('settings outside the envelope are refused, never computed', () => {
  const S = SAMPLE.inputs.settings;
  for (const [k, v] of [['power_W', 0], ['diameter_m', 9], ['band', 'S'], ['cd', 0.99], ['elMin_deg', 2], ['margin_dB', -1], ['passHours', 0], ['stayDays', 2.5], ['craft', 'voyager'], ['rateMode', 'x']]) {
    const R = K.run(src, Object.assign({}, S, { [k]: v })); assert.ok(R.refusal && R.refusal.code === 'invalid_input', k);
  }
  assert.ok(K.run(src, Object.assign({}, S, { antenna: '70m', band: 'Ka' })).refusal, '70 m has no Ka');
  assert.ok(K.dsnRx('DSS-26', 'X', 5, 0.9, 8.4e9).refusal, 'below 6 deg');
});
