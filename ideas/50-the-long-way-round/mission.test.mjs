// The Long Way Round, module 50. Run from the bank root: node --test ideas/50-the-long-way-round/mission.test.mjs
// About 40 s: test 3 flies the whole chain (ideas 31 to 49) once on their committed kernels.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const IDEAS = path.resolve(here, '..');
const BANK = path.resolve(IDEAS, '..');
const require = createRequire(import.meta.url);
const M = require('./mission.js');
const D = require('./snapshots/missions.js');
const A = require('./snapshots/aster.js');
const NH = require('./snapshots/nhats.js');
const NC = require('./snapshots/nhats-chain.js');
const LED = require('./snapshots/home-ledger.js');
const ISA = require('./snapshots/isa.js');
const K = M.create({ aster: A, ledger47: LED, isa: ISA, nhats: NH });
const R = await import('./run-chain.mjs');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const rel = (a, b) => Math.abs(a - b) / Math.max(1e-300, Math.abs(b));
const committed = () => R.committedLinks();
const mis = (key) => M.mission(M.unpack(D, key));

test('1. snapshots: sidecars, byte-identical copies, verbatim excerpts, parsed (not typed) constants', () => {
  const dir = path.join(here, 'snapshots');
  for (const f of fs.readdirSync(dir).filter((x) => !x.endsWith('.provenance.json'))) {
    const p = JSON.parse(fs.readFileSync(path.join(dir, f + '.provenance.json'), 'utf8'));
    for (const k of ['repo', 'path', 'commit']) assert.ok(p[k], f + ' sidecar lacks ' + k);
  }
  // copies equal their sources (the Aster checkout is read-only here; idea 49's isa.js is committed in the bank)
  for (const [snap, src] of [['aster-delta-v.ts.txt', 'src/v2/porkchop/delta-v.ts'], ['aster-launch-vehicles.ts.txt', 'src/v2/porkchop/launch-vehicles.ts'], ['aster-bodies.ts.txt', 'src/v2/core/constants/bodies.ts'], ['aster-launch-vehicles.golden.test.mjs.txt', 'tests/v2-golden/launch-vehicles.golden.test.mjs']]) {
    const side = JSON.parse(fs.readFileSync(path.join(dir, snap + '.provenance.json'), 'utf8'));
    assert.equal(sha(fs.readFileSync(path.join(dir, snap))), side.sourceSha256, snap);
    const aster = path.join('/home/user/asteroid-mining-planner', src);
    if (fs.existsSync(aster)) assert.equal(sha(fs.readFileSync(aster)), side.sourceSha256, src + ' changed in the Aster checkout');
  }
  assert.equal(sha(fs.readFileSync(path.join(dir, 'isa.js'))), sha(fs.readFileSync(path.join(IDEAS, '49-hot-return/snapshots/isa.js'))));
  const home = fs.readFileSync(path.join(IDEAS, '47-way-home/home.js'), 'utf8'), ex = fs.readFileSync(path.join(dir, 'home-ledger.js'), 'utf8');
  const block = ex.slice(ex.indexOf('// ---- home.js lines'), ex.indexOf('\n  return { ledger: ledger'));
  assert.ok(block.length > 2000 && home.includes(block.slice(block.indexOf('\n') + 1)), 'idea 47 ledger excerpt is not a verbatim substring of home.js');
  // the constants are the ones in the copied text (an independent regex here, not build-data's)
  const dv = fs.readFileSync(path.join(dir, 'aster-delta-v.ts.txt'), 'utf8'), bd = fs.readFileSync(path.join(dir, 'aster-bodies.ts.txt'), 'utf8');
  assert.ok(dv.includes('EARTH_MU_KM3_PER_S2 = 398_600.4418') && A.earth_mu_km3_s2 === 398600.4418);
  assert.ok(dv.includes('LEO_PARKING_RADIUS_KM = 6_578.137') && A.leo_parking_radius_km === 6578.137);
  assert.ok(bd.includes('radiusM:   6_378_136.6') && A.earth_radius_m === 6378136.6);
  assert.equal(A.elvperf.vehicles.length, 8);
  // NHATS: the defining sentence and the 400 km
  assert.match(NH.quotes.total, /Earth departure maneuver from a 400 km altitude circular parking orbit/);
  assert.equal(NH.parking_altitude_km, 400);
  assert.equal(NH.rows.length, 61);
});

test('2. Aster\'s launch-vehicle curves: its nine golden payloadAtC3 pins exactly, 38 official anchors, no extrapolation', () => {
  assert.equal(A.golden.payload.length, 9);
  for (const [name, config, c3, kg] of A.golden.payload) {
    const v = A.elvperf.vehicles.find((x) => x.name === name && x.config === config);
    assert.equal(M.payloadAtC3(v, c3), kg, name + ' ' + config + ' C3=' + c3);
  }
  const anchors = A.elvperf.vehicles.flatMap((v) => v.curve);
  assert.equal(anchors.length, A.golden.anchors);
  assert.ok(anchors.every((a) => a[2] === 'official'));
  const fh = A.elvperf.vehicles[0];
  assert.equal(M.payloadAtC3(fh, -0.1), M.BEYOND_CURVE);
  assert.equal(M.payloadAtC3(fh, fh.curve[fh.curve.length - 1][0] + 0.1), M.BEYOND_CURVE);
  // injectionDvFromC3 at Aster's own parking radius reproduces idea 39's Aster delta-v stack (its own copy of the formula)
  const l39 = mis('chain|lox-rp1|99942').record.links[39].v;
  assert.ok(rel(M.injectionDvFromC3(l39.c3_m2_s2 / 1e6, A.earth_mu_km3_s2, A.leo_parking_radius_km) * 1000, l39.aster_injection_m_s) < 1e-9);
});

test('3. the chain run whole reproduces all 19 committed handoffs, and carries every refusal the committed chain drops', async () => {
  const run = await R.runMission({ rocket: 'chain', propellant: 'lox-rp1', asteroid: '99942' });
  const C = committed();
  assert.equal(run.halt, null);
  const own = (h) => JSON.stringify(h.refusals.filter((r) => !r.from || r.from === h.from));
  // idea 31's committed handoff.json predates its review: the review changed the c* source text in mixture.js
  // (158fe6b: "RP-1311 eq 6.13 form" -> "eqs 6.11-6.12") and the file was not regenerated; it also carries a
  // "Sample: ..." assumption idea 31's page never writes. Same numbers; the text is pinned here as the finding.
  assert.match(C[31].outputs.cstar.source, /eq 6\.13 form/); assert.match(run.links[31].outputs.cstar.source, /eqs 6\.11-6\.12/);
  assert.ok(C[31].assumptions.includes('Sample: the inputs are an arbitrary illustration, not a claim about any engine.'));
  // ideas 32 and 33 pass that source text through into their own outputs, so it is in three committed outputs (31, 32, 33)
  const STALE = 'RP-1311 eq 6.13 form', NOW = 'RP-1311 eqs 6.11-6.12';
  const norm = (o) => JSON.parse(JSON.stringify(o).split(STALE).join(NOW));
  assert.deepEqual([31, 32, 33, 34].map((n) => JSON.stringify(C[n].outputs).split(STALE).length - 1), [1, 1, 1, 0]);
  assert.deepEqual(run.links[31].inputs, C[31].inputs, 'idea 31 inputs');
  for (let n = 31; n <= 49; n++) {
    assert.deepEqual(run.links[n].outputs, norm(C[n].outputs), 'idea ' + n + ' outputs (the one stale source text aside)');
    assert.equal(own(run.links[n]), own(C[n]), 'idea ' + n + ' own refusals');
  }
  for (let n = 32; n <= 40; n++) {   // each module's own settings (its upstream handoff, nested whole, carries idea 31's text)
    const a = Object.assign({}, run.links[n].inputs), b = Object.assign({}, C[n].inputs), k = M.UPSTREAM[n] || 'engines';
    delete a[k]; delete b[k]; if (n === 34) { delete a.vehicle; delete b.vehicle; }
    assert.deepEqual(a, b, 'idea ' + n + ' settings');
  }
  // the refusal flow: the unbroken run loses only what a module answers; the committed chain loses 13 at idea 41
  const recRun = M.recordOf(run, sha), recCom = M.recordOf({ choice: { rocket: 'committed', propellant: 'lox-rp1', asteroid: '99942' }, links: C }, sha);
  assert.deepEqual(recRun.flow.map((f) => [f.n, f.dropped.length]), [[35, 0], [36, 0], [40, 0]]);
  const drop = recCom.flow.find((f) => f.dropped.length);
  assert.equal(drop.n, 41); assert.equal(drop.dropped.length, 13);
  for (const id of ['38-burn-out:departure_propellant', '39-lamberts-road:chain_departure', '37-window:departure_propellant']) assert.ok(drop.dropped.includes(id), id);
  assert.equal(run.links[49].refusals.length - C[49].refusals.length, 13);
  // the bundle is not stale: this fresh run, packed and unpacked, is the bundled scenario
  const fresh = M.unpack(M.packRecords([recRun]), recRun.key), bundled = M.unpack(D, recRun.key);
  for (const n of Object.keys(fresh.links)) { assert.deepEqual(fresh.links[n].v, bundled.links[n].v, 'bundled link ' + n); assert.deepEqual(fresh.links[n].c, bundled.links[n].c, 'confidences ' + n); assert.deepEqual(fresh.links[n].own, bundled.links[n].own); }
  assert.equal(fresh.links[42].c.launch_kg, 'assumed'); assert.equal(fresh.links[49].c.landed_kg, 'derived'); assert.equal(fresh.links[34].c.liftoff_kg, 'assumed');
  // and the kernels it was built with are the ones in the folders now (git blob ids, rolled up)
  const now = {};
  for (const [dir, files] of Object.entries(D.pins.files)) for (const f of files) now[dir + '/' + f] = R.blobSha1(fs.readFileSync(path.join(BANK, dir, f)));
  assert.equal(R.pinRollup(now).sha256, D.pins.sha256, 'a kernel of ideas 31 to 49 changed since snapshots/missions.js was built: run run-chain.mjs --build');
});

test('4. the answered refusals are the ones the modules say they answer (READMEs quoted)', () => {
  const rd = (d) => fs.readFileSync(path.join(IDEAS, d, 'README.md'), 'utf8');
  assert.ok(rd('35-max-q').includes('except `losses`, answered here'));
  assert.ok(rd('36-closed-loop').includes('carries idea 35\'s (except `guidance`, answered here, and its open-loop `orbit` and `trajectory`)'));
  assert.ok(rd('40-long-coast').includes('except idea 39\'s `dynamics` and idea 38\'s `post_cutoff`, which this module lifts'));
  assert.deepEqual(M.ANSWERED, { 35: ['34-stack:losses'], 36: ['35-max-q:guidance', '35-max-q:orbit', '35-max-q:trajectory'], 40: ['39-lamberts-road:dynamics', '38-burn-out:post_cutoff'] });
});

test('5. the mission as committed: events, masses, delta-v, seams and verdict, against the handoffs by hand', () => {
  const C = committed(), m = M.mission(M.recordOf({ choice: { rocket: 'committed', propellant: 'lox-rp1', asteroid: '99942' }, links: C }, sha));
  for (let i = 1; i < m.events.length; i++) assert.ok(m.events[i].t >= m.events[i - 1].t, 'events in time order');
  assert.equal(m.events[0].label, 'Liftoff'); assert.equal(m.events[0].mass_kg, C[34].outputs.liftoff_mass.value);
  const land = m.events.find((e) => e.label === 'Landing'), pass = m.events.find((e) => /Earth pass/.test(e.label));
  assert.equal(land.mass_kg, C[49].outputs.mass.value.landed_kg);
  assert.ok(pass.t > land.t, 'Apophis passes the Earth after the capsule is down (' + ((pass.t - land.t) / 60).toFixed(1) + ' min)');
  const d36 = C[36].outputs, asc = m.deltaV.filter((d) => d.n === 36).reduce((a, d) => a + d.dv_m_s, 0);
  assert.ok(Math.abs(asc - d36.delta_v_ideal_flown.value) < 1e-9, 'the ascent bars add to idea 36\'s ideal delta-v flown');
  const dep = m.deltaV.find((d) => d.n === 38);
  assert.equal(dep.flown, false); assert.equal(dep.dv_m_s, C[38].outputs.burns.value[0].delta_v_m_s);
  assert.deepEqual(m.verdict.blockers.map((b) => b.id), ['departure', 'tag_propellant']);
  assert.equal(m.verdict.closes, false); assert.equal(m.verdict.lands, true);
  const ids = m.seams.map((s) => s.id);
  for (const id of ['payload', 'departure', 'ascent_refly', 'departure_epoch', 'tag_propellant', 'plant_mass', 'container', 'comms', 'heat_shield', 'refusals_dropped']) assert.ok(ids.includes(id), id);
  const pay = m.seams.find((s) => s.id === 'payload');
  assert.equal(pay.a, 10000); assert.equal(pay.b, C[42].outputs.mass.value.launch_kg);
  const ep = m.seams.find((s) => s.id === 'departure_epoch');
  assert.ok(Math.abs(ep.jump - (C[40].outputs.departure.value.tdb_s_past_j2000 - C[37].outputs.departure_point.value.tdb_s_past_j2000)) < 1e-6);
  // which refusals stop the mission, and which a later module answers
  const blk = m.refusals.filter((r) => r.blocking).map((r) => r.from + ':' + r.applies_to);
  for (const id of ['38-burn-out:departure_propellant', '39-lamberts-road:chain_departure', '42-closing-in:tankage']) assert.ok(blk.includes(id), id + ' blocking');
  assert.equal(m.refusals.find((r) => r.from === '34-stack' && r.applies_to === 'losses').answered_by, 35);
  assert.equal(m.refusals.find((r) => r.from === '35-max-q' && r.applies_to === 'guidance').answered_by, 36);
  assert.ok(m.refusals.filter((r) => r.answered_by).every((r) => !r.blocking));
  const cm = m.seams.find((s) => s.id === 'comms');
  assert.equal(cm.a, C[41].outputs.data_volume.value.stay_days);
  assert.ok(Math.abs(cm.b - (C[47].outputs.return_transfer.value.departure_tdb_s_past_j2000 - C[42].outputs.standoff_state.value.tdb_s_past_j2000) / 86400) < 1e-9);
  assert.ok(Math.abs(m.durations.total_s - (C[49].outputs.landing.value.tdb_s_past_j2000 - C[37].outputs.launch.value.tdb_s_past_j2000)) < 1e-6);
  // UTC <-> TDB with Aster's 69.184 s: idea 37's launch epoch both ways
  assert.ok(Math.abs(M.utcToTdb(C[37].outputs.launch.value.utc) - C[37].outputs.launch.value.tdb_s_past_j2000) < 1e-3);
});

test('6. the what-if at the chain\'s own settings is the chain: ideas 42, 44, 47 and 49 reproduced', () => {
  for (const key of ['committed|lox-rp1|99942', 'as512-sc|-|99942', 'chain-sc|lox-ch4|99942', 'as512|-|99942']) {
    const m = mis(key), L = m.record.links, cl = K.closure(m, {});
    assert.ok(rel(cl.outbound.propellant_kg, L[42].v.loaded_kg) < 1e-8, key + ' 42 propellant');
    assert.ok(rel(cl.outbound.launch_kg, L[42].v.launch_kg) < 1e-8, key + ' 42 launch');
    assert.ok(rel(cl.outbound.arrival_kg, L[42].v.arrival_kg) < 1e-8, key + ' 42 arrival');
    assert.ok(rel(cl.outbound.standoff_kg, L[42].v.standoff_kg) < 1e-8, key + ' 42 stand-off');
    assert.ok(rel(cl.outbound.tag_need_kg, L[44].v.prop_need_kg) < 1e-6, key + ' 44 TAG need');
    assert.ok(rel(cl.home.dry_kg, L[46].v.dry_total_kg) < 1e-8, key + ' 46 dry');
    assert.ok(rel(cl.home.material_kg, L[47].v.material_kg) < 1e-8, key + ' 47 material');
    assert.ok(rel(cl.home.mass_departure_kg, L[47].v.mass_dep_kg) < 1e-8, key + ' 47 departure mass');
    assert.ok(rel(cl.home.mass_arrival_kg, L[48].v.entry_kg) < 1e-8, key + ' 48 entry mass');
    assert.ok(rel(cl.entry.landed_kg, L[49].v.landed_kg) < 1e-8, key + ' 49 landed');
    assert.ok(rel(cl.entry.main_cds_m2, L[49].v.main_cds_m2) < 1e-8, key + ' 49 main parachute');
  }
});

test('7. the what-if\'s closed forms and decisions', () => {
  const m = mis('committed|lox-rp1|99942'), L = m.record.links, ve = L[42].v.isp_s * 9.80665;
  const c1 = K.closure(m, { dry_kg: 1000 });
  assert.ok(rel(c1.outbound.launch_kg, 1000 * Math.exp(L[42].v.required_dv_m_s / ve)) < 1e-12, 'Tsiolkovsky by hand');
  const v9 = K.closure(m, { touchdown_m_s: 9 });
  assert.ok(rel(v9.entry.main_cds_m2, K.closure(m, {}).entry.main_cds_m2 * (4.5 / 9) ** 2) < 1e-12, 'main area as 1/v^2');
  const rho0 = ISA.isa(0).rho_kg_m3; assert.ok(rel(v9.entry.main_cds_m2, 2 * v9.entry.landed_kg * 9.80665 / (rho0 * 81)) < 1e-12, '2 m g0 / (rho v^2)');
  const heavy = K.closure(m, { dry_kg: 2000 });
  assert.ok(heavy.home.material_kg < K.closure(m, {}).home.material_kg, 'a heavier craft brings home less');
  const tag = K.closure(m, { tag: true });
  assert.equal(tag.outbound.tag_ok, true); assert.equal(K.closure(m, {}).outbound.tag_ok, false);
  assert.ok(rel(tag.outbound.launch_kg, 487 * Math.exp((L[42].v.required_dv_m_s + L[44].v.prop_dv_m_s) / ve)) < 1e-12);
  const pl = K.closure(m, { plant: true });
  assert.ok(rel(pl.outbound.launch_kg - K.closure(m, {}).outbound.launch_kg, L[46].v.coolers_kg * Math.exp(L[42].v.required_dv_m_s / ve)) < 1e-9, 'the plant flies out at the same mass ratio');
  assert.ok(rel(pl.home.dry_kg, pl.outbound.standoff_kg) < 1e-12, 'a launched plant is not added again at the asteroid');
  assert.ok(pl.home.dry_kg > K.closure(m, {}).home.dry_kg && pl.home.dry_kg - K.closure(m, {}).home.dry_kg < 0.2, 'launching the coolers moves the return dry mass by only the outbound propellant they leave');
  // launchers: the chain's rocket refuses; AS-512's capability is idea 38's; Falcon Heavy Expendable by hand between its anchors
  assert.equal(K.closure(m, {}).launch.capability_kg, null);
  assert.ok(K.closure(m, {}).refusals.some((r) => r.applies_to === 'launcher'));
  const as = mis('as512|-|99942');
  assert.equal(K.closure(as, {}).launch.capability_kg, as.record.links[38].v.cap_finite_kg);
  const fh = A.elvperf.vehicles[0], c3 = L[39].v.c3_m2_s2 / 1e6, byHand = fh.curve[0][1] + (c3 - fh.curve[0][0]) / (fh.curve[1][0] - fh.curve[0][0]) * (fh.curve[1][1] - fh.curve[0][1]);
  const fhc = K.closure(m, { launcher: 0 });
  assert.ok(rel(fhc.launch.capability_kg, byHand) < 1e-12);
  assert.ok(Math.abs(fhc.launch.margin_kg - (byHand - fhc.outbound.launch_kg)) < 1e-9 && fhc.launch.closes, 'margin = capability - launch mass');
  const rtls = K.closure(m, { launcher: A.elvperf.vehicles.findIndex((v) => v.config === 'RTLS') });
  assert.ok(rtls.launch.margin_kg < 0 && !rtls.launch.closes, 'Falcon 9 RTLS is too small for the spacecraft at this C3');
  // refusals for bad inputs
  for (const d of [NaN, 5, 1e6, null]) if (d !== null) assert.ok(K.closure(m, { dry_kg: d }).refusals.some((r) => r.code === 'invalid_input'), 'dry ' + d);
  assert.ok(K.closure(m, { touchdown_m_s: 0.5 }).refusals.some((r) => r.applies_to === 'touchdown'));
  assert.ok(K.closure(m, { launcher: 99 }).refusals.some((r) => r.code === 'invalid_input'));
  const vc6 = A.elvperf.vehicles.findIndex((v) => v.config === 'VC6');
  const b = mis('as512|-|101955'); assert.ok(b.record.links[42], 'Bennu reaches 42');
});

test('8. JPL NHATS: the chain\'s round trips, summed as NHATS sums them, against NHATS\'s totals', () => {
  // the convention first: Aster's injectionDvFromC3 at 400 km gives NHATS's Earth-departure dv from NHATS's own C3
  const rows = K.nhatsRows();
  for (const r of rows) {
    assert.ok(Math.abs(M.injectionDvFromC3(r.c3, A.earth_mu_km3_s2, A.earth_radius_m / 1000 + 400) - r.dv_dep_park) < 6e-4, r.tid + ' dv_dep_park');
    assert.ok(Math.abs(r.dv_dep_park + r.vrel_arr_neo + r.vrel_dep_neo + r.vrel_arr_earth - r.dv_total) < 1.1e-3, r.tid + ' terms sum');
  }
  const cmp = K.nhatsCompare(NC), st = K.nhatsStats(cmp);
  assert.equal(cmp.length, 61);
  assert.equal(st.inside.total.n, 26);
  assert.ok(st.inside.total.median < 6, 'median total gap ' + st.inside.total.median);
  assert.ok(st.inside.total.max < 450, 'worst total gap ' + st.inside.total.max);
  assert.ok(st.inside.back.median < 0.5, 'idea 47 legs ' + st.inside.back.median);
  assert.ok(st.outside.total.median > 1000, 'outside idea 39\'s envelope the two-body outbound leg is km/s off');
  assert.deepEqual(st.outside.bodies.sort(), ['162173', '2000 SG344', '99942']);
  // a broken summation is caught: NHATS's total without the Earth departure is kilometres off
  const r0 = cmp.find((r) => r.tid === 4417);
  assert.ok(Math.abs(r0.chain.dv_total_m_s - r0.nhats.dv_total_m_s) < 1);
});

test('9. the NHATS legs are not stale: ideas 39 and 47 recompute three of them now', async () => {
  const F = await R.nhatsLegs();
  for (const tid of [4417, 157834, 49238]) {
    const a = F.rows.find((r) => r.tid === tid), b = NC.rows.find((r) => r.tid === tid);
    for (const k of Object.keys(b.legs)) assert.ok(rel(a.legs[k], b.legs[k]) < 1e-9, tid + ' ' + k);
    assert.equal(!!a.outside_39, !!b.outside_39);
  }
});

test('10. every mission flown: where each stops and why', () => {
  const stop = {}; D.runs.forEach((r) => { stop[r.key] = mis(r.key).verdict; });
  assert.equal(D.runs.length, R.SCENARIOS.length + 1);
  for (const [a, n] of [['101955', 45], ['162173', 43], ['65803', 43], ['433', 42], ['2000 SG344', 41]]) for (const r of ['chain-sc|lox-rp1|', 'as512|-|', 'as512-sc|-|']) assert.equal(stop[r + a].halted_at, n, r + a);
  assert.equal(stop['chain-sc|lox-lh2|99942'].halted_at, 36);
  assert.equal(stop['chain|lox-eth75|99942'].halted_at, 38); assert.equal(stop['chain|htp-rp1|99942'].halted_at, 38);
  // only AS-512 carrying the spacecraft departs; it is left one break short, the touch-and-go
  for (const r of D.runs) {
    const m = mis(r.key), dep = m.record.links[38] && Number.isFinite(m.record.links[38].v.hds_tdb);
    if (r.key === 'as512-sc|-|99942') { assert.ok(dep); assert.deepEqual(m.verdict.blockers.map((b) => b.id), ['tag_propellant']); }
    else if (r.key.startsWith('as512-sc')) continue;
    else assert.ok(!dep, r.key + ' should not depart');
  }
  // the closed loop converged and the rocket carries what idea 42 sized
  const sc = M.unpack(D, 'as512-sc|-|99942');
  assert.ok(Math.abs(sc.loop[sc.loop.length - 1].launch_kg - sc.loop[sc.loop.length - 1].payload_kg) <= 0.01);
  assert.ok(Math.abs(sc.links[38].v.payload_setting_kg - sc.links[42].v.launch_kg) <= 0.01);
  assert.equal(sc.links[40].v.dep_kind, 'flown_38');
  // with the touch-and-go in the tanks, the what-if closes it on AS-512
  assert.equal(K.closure(mis('as512-sc|-|99942'), { tag: true }).closes, true);
  assert.equal(K.closure(mis('as512-sc|-|99942'), {}).closes, false);
});

test('11. the handoff: reads back, refuses edits, walks the committed chain from idea 49', () => {
  const m = mis('as512-sc|-|99942'), h = M.makeHandoff(m, { produced: '2026-11-01T23:00:00Z', closure: K.closure(m, { tag: true }), whatIf: { tag: true } });
  for (const [k, o] of Object.entries(h.outputs)) { assert.ok('units' in o && o.confidence && o.source, k); }
  assert.ok(h.refusals.every((r) => r.from && r.reason && 'what_would_help' in r));
  const back = M.parseHandoff(JSON.parse(JSON.stringify(h)));
  assert.ok(back.own && !back.refusal);
  assert.ok(M.parseHandoff(JSON.stringify(h)).own, 'as text');
  const e1 = JSON.parse(JSON.stringify(h)); e1.outputs.verdict.value.closes = true; assert.ok(M.parseHandoff(e1).refusal);
  const e2 = JSON.parse(JSON.stringify(h)); e2.refusals.pop(); assert.ok(M.parseHandoff(e2).refusal);
  const e3 = JSON.parse(JSON.stringify(h)); e3.outputs.mass_ledger.value[0].mass_kg *= 1.01; assert.ok(M.parseHandoff(e3).refusal);
  assert.ok(M.parseHandoff('not json').refusal); assert.ok(M.parseHandoff({ handoff: 'other' }).refusal);
  assert.ok(M.parseHandoff({ handoff: 'long-way-round', version: 2, from: '49-hot-return' }).refusal);
  assert.ok(M.parseHandoff({ handoff: 'long-way-round', version: 1, from: '12-blob-basis', outputs: {}, refusals: [] }).refusal);
  assert.equal(M.b64urlDecode(M.b64urlEncode(JSON.stringify(h))), JSON.stringify(h));
  // idea 49's committed handoff carries 48 as a digest; the page resolves it against the committed chain and walks on
  const C = committed(), com = M.unpack(D, 'committed|lox-rp1|99942'), known = {}, chain = {};
  Object.keys(com.links).forEach((n) => { known[com.links[n].sha256] = com.links[n]; chain[n] = com.links[n]; });
  assert.equal(C[49].inputs.catch_handoff.sha256, sha(JSON.stringify(C[48])), 'idea 49 prunes idea 48 to the sha256 of its JSON.stringify');
  const p = M.parseHandoff(C[49], { sha256: sha, known, knownChain: chain });
  assert.ok(!p.refusal);
  assert.deepEqual(Object.keys(p.mission.record.links).map(Number), Array.from({ length: 19 }, (_, i) => 31 + i));
  assert.equal(p.mission.verdict.lands, true);
  // an unknown digest leaves the upstream missing, and says so
  const odd = JSON.parse(JSON.stringify(C[49])); odd.inputs.catch_handoff.sha256 = '0'.repeat(64);
  const q = M.parseHandoff(odd, { sha256: sha, known, knownChain: chain });
  assert.deepEqual(q.walked.missing, [48]);
  // the committed samples nested whole (32 to 40) walk without help
  const w = M.walk(C[40], sha, {}, {});
  assert.deepEqual(Object.keys(w.links).map(Number), [31, 32, 33, 34, 35, 36, 37, 38, 39, 40]);
});

test('12. the sample handoff.json is this page\'s default mission, and reads back', () => {
  const h = JSON.parse(fs.readFileSync(path.join(here, 'handoff.json'), 'utf8'));
  const m = mis('chain|lox-rp1|99942'), again = M.makeHandoff(m, { produced: h.produced, source: 'bundled', whatIf: h.inputs.what_if, closure: K.closure(m, {}) });
  assert.deepEqual(h, JSON.parse(JSON.stringify(again)));
  assert.ok(M.parseHandoff(h).own);
});

test('13. the closed loop flown again: AS-512 carrying the spacecraft is the bundled mission, link by link', async () => {
  const run = await R.runMission({ rocket: 'as512-sc', asteroid: '99942' });
  const rec = M.recordOf(run, sha), fresh = M.unpack(M.packRecords([rec]), rec.key), bundled = M.unpack(D, rec.key);
  assert.deepEqual(Object.keys(fresh.links), Object.keys(bundled.links));
  for (const n of Object.keys(fresh.links)) assert.deepEqual(fresh.links[n].v, bundled.links[n].v, 'link ' + n);
  assert.deepEqual(fresh.loop, bundled.loop);
  assert.equal(run.links[38].inputs.settings.payloadKg, run.loop[run.loop.length - 1].payload_kg, 'idea 38 departs with the payload the loop settled on');
  assert.ok(run.links[38].outputs.hyperbolic_departure_state, 'and departs');
  assert.equal(run.links[40].outputs.departure.value.kind, 'flown_38', 'idea 40 flies from idea 38\'s state');
});
