// Idea 49 (Hot Return): node --test ideas/49-hot-return/hotreturn.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BANK = path.resolve(HERE, '../..');
const require = createRequire(import.meta.url);
const { K, deps, chain } = require('./load.cjs');
const S = deps.sources;
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b} (tol ${tol})`);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (abs tol ${tol})`);

const RUN = {};
const run = (key, s, input) => (RUN[key] = RUN[key] || K.run(s, input));

test('1. snapshots: sidecars hash to what they recorded; copies are idea 48\'s committed files; the sources carry their quotes', () => {
  const dir = path.join(HERE, 'snapshots');
  const files = fs.readdirSync(dir).filter((f) => !f.endsWith('.provenance.json'));
  assert.ok(files.length >= 9);
  for (const f of files) {
    const side = JSON.parse(fs.readFileSync(path.join(dir, f + '.provenance.json'), 'utf8'));
    for (const k of ['repo', 'path', 'commit']) assert.ok(side[k], `${f}: sidecar lacks ${k}`);
    assert.equal(sha(fs.readFileSync(path.join(dir, f))), side.writtenSha256, `${f} changed since its sidecar was written`);
  }
  for (const f of ['catch.js']) assert.equal(sha(fs.readFileSync(path.join(dir, f))), sha(fs.readFileSync(path.join(BANK, 'ideas/48-catch', f))), f + ' is not idea 48\'s');
  for (const f of ['isa.js', 'earth.js', 'de440-constants.js', 'erfa-iau2006.js', 'earth-radii.js', 'entry-sources.js'])
    assert.equal(sha(fs.readFileSync(path.join(dir, f))), sha(fs.readFileSync(path.join(BANK, 'ideas/48-catch/snapshots', f))), f + ' is not idea 48\'s copy');
  const h48 = JSON.parse(fs.readFileSync(path.join(BANK, 'ideas/48-catch/handoff.json'), 'utf8'));
  assert.deepEqual(deps.chain.handoff, h48);
  assert.equal(deps.chain.digest.sha256, sha(JSON.stringify(h48)));
  const has = (q) => S.quotes.some((x) => x.quote.includes(q));
  for (const q of ['After 15.04 seconds', '331.3 s after drogue deployment', 'A tumbling CD value of 0.63', 'vertical velocity of 4.5 m/s', 'geodetic altitude of 1288 m', '6-6.5 mm in the top of the shield apex', 'export-control restrictions', 'A2 = 1.320'])
    assert.ok(has(q), 'quote missing: ' + q);
  // the numbers are the quotes' (a few spot values)
  assert.equal(S.stardust.drogue_timer_s, 15.04); assert.equal(S.genesis.tumble_cd, 0.63); assert.equal(S.osirisrex.ground_alt_m, 1288);
  close(S.stardust.baro_Pa, 10.11 * 0.45359237 * 9.80665 / 0.0254 ** 2, 1e-12, '10.11 psi in Pa');
  close(S.osirisrex.observed.touchdown_s, 615.1, 1e-9, 'OSIRIS-REx touchdown from the timestamps');
});

test('2. radiative heating: all 91 sphere cases of its own paper, an independent code inside its range, and the extrapolation below it', () => {
  const RC = K.radiativeChecks();
  // (review) Table III(a) has 91 sphere cases over three sideways pages; the builder had transcribed 25 of them
  assert.equal(RC.table3.length, 91);
  assert.deepEqual(RC.table3.map((r) => r.case), Array.from({ length: 91 }, (_, i) => i + 1));
  for (const r of RC.table3) {
    // the fit, evaluated here, gives their q_R,C to the transcription's last digit (a wrong V, rho, R_B or q_R,C would not)
    assert.ok(Math.abs(r.gap_fit) < 5e-4, `case ${r.case}: ${r.model} vs the paper's fit ${r.fit}`);
    // their error column is 100 (q_R,D - q_R,C)/q_R,D: a wrongly transcribed q_R,D would not give it
    near(100 * (r.data - r.fit) / r.data, r.error_pct, 0.1, `case ${r.case}: the error column`);
  }
  // the fit against their coupled calculations: within 15 % everywhere (case 45, 11 km/s at 67 km with a 0.3 m nose, is
  // the worst at -14.5 %) and about 3 % on average, the paper's "average deviation of about 3 percent"
  const gaps = RC.table3.map((r) => Math.abs(r.gap_data)), worst = Math.max(...gaps), mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  assert.ok(worst > 0.14 && worst < 0.15, 'worst ' + worst); assert.equal(RC.table3[gaps.indexOf(worst)].case, 45);
  assert.ok(mean > 0.025 && mean < 0.035, 'mean ' + mean);
  // Sutton & Hartung (RIFSP, another code): inside the fit's range within 11 %; the mean within 7 %
  const inside = RC.suttonHartung.filter((r) => r.inside);
  assert.equal(inside.length, 12);
  for (const r of inside) assert.ok(Math.abs(r.gap) < 0.11, `SH ${r.v} m/s ${r.rn} m: ${r.gap}`);
  assert.ok(inside.reduce((s, r) => s + Math.abs(r.gap), 0) / inside.length < 0.07);
  // (review) below the fit's 11 km/s, where the chain's capsule slows in dense air, the extrapolation runs high against
  // Sutton & Hartung, more so the slower: +10 % at 10 km/s and three times at 9 km/s for a 2.3 m nose
  const below = RC.suttonHartung.filter((r) => r.v < 11000 && r.rn >= 0.5);
  assert.equal(below.length, 9);
  for (const r of below) { assert.equal(r.inside, false); assert.ok(r.gap > 0.05, `SH ${r.v} m/s ${r.rn} m: ${r.gap}`); }
  const gapAt = (v, rn) => below.find((r) => r.v === v && r.rn === rn).gap;
  for (const rn of [0.5, 1, 2.3]) assert.ok(gapAt(9000, rn) > gapAt(9500, rn) && gapAt(9500, rn) > gapAt(10000, rn), 'slower is further off at ' + rn + ' m');
  assert.ok(gapAt(10000, 2.3) > 0.05 && gapAt(10000, 2.3) < 0.15 && gapAt(9000, 2.3) > 2 && gapAt(9000, 2.3) < 2.5, '2.3 m: ' + gapAt(10000, 2.3) + ', ' + gapAt(9000, 2.3));
  // the envelope flag: Stardust's 0.229 m nose is outside, the chain's 2.21 m inside
  assert.equal(K.suttles(12000, 3e-4, 0.2286).inside, false);
  assert.equal(K.suttles(12000, 3e-4, 2.21).inside, true);
  assert.equal(K.suttles(10500, 3e-4, 2.21).inside, false);
  assert.equal(K.suttles(0, 3e-4, 2.21).q, 0);
});

test('3. closed forms: wall temperature, the recession constant, the shield\'s area, the profile, steady descent, the baroswitch', () => {
  // radiative equilibrium inverts: eps(T) sigma T^4 = q
  for (const q of [1e5, 1e6, 8.46e6, 3e7]) { const T = K.wallT(q); close(K.emissivity(T) * K.SIGMA * T ** 4, q, 1e-9, 'wall T for ' + q); }
  close(K.emissivity(250), 0.858, 1e-12, 'emissivity at 250 K'); close(K.emissivity(3500), 0.93, 1e-12, 'at 3500 K'); close(K.emissivity(1875), (0.858 + 0.93) / 2, 1e-12, 'midway');
  close(K.SIGMA, 5.670374419e-8, 1e-12, 'CODATA sigma');
  // B' by hand from Covington's two averages: rho r / (q / h0)
  close(K.B400, 266 * 0.0115e-2 / (400e4 / 29.5e6), 1e-12, 'B\' at 400 W/cm2');
  close(K.B580, 266 * 0.018e-2 / (580e4 / 29.5e6), 1e-12, 'B\' at 580 W/cm2');
  close(K.BPRIME, (0.2256012500 + 0.2435275862) / 2, 1e-9, 'B\' mean');
  // a 60 deg sphere-cone: cap 2 pi Rn^2 (1 - sin 60) + frustum pi (Rb + Rn cos 60) (Rb - Rn cos 60) / sin 60
  const Rn = 0.2286, Rb = 0.8128 / 2, th = Math.PI / 3;
  const byHand = 2 * Math.PI * Rn * Rn * (1 - Math.sin(th)) + Math.PI * (Rb + Rn * Math.cos(th)) * (Rb - Rn * Math.cos(th)) / Math.sin(th);
  close(K.wetArea(K.vehicleOf('stardust')).m2, byHand, 1e-12, 'Stardust wetted area');
  assert.ok(byHand > 0.51887 && byHand < 0.51887 / Math.sin(th) + 1e-9, 'between the frontal area and the cone\'s');
  close(K.wetArea(K.vehicleOf('apollo')).m2, 15.34, 1e-12, 'Apollo-derived: frontal area');
  close(K.PROFILE, 1 - (1 - 3 / 6.25) * 2 / 3, 1e-12, 'profile factor');
  // the SRC main: CdS = 2 m g / (rho v^2) at 1,288 m with OSIRIS-REx's landed mass
  const C = K.srcCanopies(), rhoG = deps.catchDeps.isa.isa(1288).rho_kg_m3;
  close(C.main_cds_m2, 2 * C.main_mass_kg * 9.80665 / (rhoG * 4.5 * 4.5), 1e-12, 'main drag area');
  // steady descent: the touchdown speed under the main is the terminal speed sqrt(2 m g / (rho CdS)) at the ground
  const R = run('ox', { source: 'osirisrex' });
  const g = 3.986004418e14 / (6378136.6 + 1288) ** 2;   // near the ground; the kernel's g is mu/r^2
  const vt = Math.sqrt(2 * (R.arrival.veh.mass_kg - R.shield.ablated_kg) * g / (rhoG * C.main_cds_m2));
  close(R.land.speed, vt, 3e-3, 'touchdown at terminal speed');
  // the baroswitch: the 1976 pressure at the altitude it returns
  const h = K.altOfPressure(S.stardust.baro_Pa); close(K.pressureAt(h), S.stardust.baro_Pa, 1e-9, 'pressure round trip');
  assert.ok(Math.abs(h - S.stardust.nominal_main_alt_m) < 100, '10.11 psi is about 3.1 km: ' + h);
  // total enthalpy: V^2/2 + a^2/(gamma - 1)
  close(K.h0Of(10000, 300), 5e7 + 300 * 300 / 0.4, 1e-12, 'h0');
});

test('4. reality: Stardust, Genesis and OSIRIS-REx against what was measured, each gap where it was measured', () => {
  const RL = K.reality(), R = Object.fromEntries(RL.rows.map((r) => [r.id, r]));
  // the trajectory NASA's aerothermal analysis used
  assert.ok(Math.abs(R.sd_v42.gap_pct) < 0.5, 'speed at 42 s ' + R.sd_v42.gap_pct);
  assert.ok(R.sd_rho42.gap_pct > 20 && R.sd_rho42.gap_pct < 60, 'denser 1976 air at 42 s ' + R.sd_rho42.gap_pct);
  assert.ok(R.sd_v53.gap_pct < 0 && R.sd_v53.gap_pct > -6, 'slower at 53 s ' + R.sd_v53.gap_pct);
  // heating: under the post-flight numbers; radiation over the CFD's 10 % (equilibrium overpredicts a small nose)
  assert.ok(R.sd_qtot.gap_pct > -20 && R.sd_qtot.gap_pct < -10, 'peak heating ' + R.sd_qtot.gap_pct);
  assert.ok(R.sd_load.gap_pct > -25 && R.sd_load.gap_pct < -15, 'heat load ' + R.sd_load.gap_pct);
  assert.ok(R.sd_radfrac.model > 10 && R.sd_radfrac.model < 20, 'radiation share ' + R.sd_radfrac.model);
  assert.ok(R.sd_Tw.gap_pct > 5 && R.sd_Tw.gap_pct < 15, 'wall temperature, an upper bound ' + R.sd_Tw.gap_pct);
  // the heat shield
  assert.ok(R.sd_recession.gap_pct > -30 && R.sd_recession.gap_pct < -18, 'recession ' + R.sd_recession.gap_pct);
  assert.ok(Math.abs(R.sd_recession_scaled.gap_pct) < 6, 'recession on the post-flight heat load ' + R.sd_recession_scaled.gap_pct);
  assert.ok(R.pica_highflux.gap_pct < -25, 'beyond PICA\'s limit the law under-predicts ' + R.pica_highflux.gap_pct);
  // parachutes
  assert.ok(Math.abs(R.sd_drogue_t.gap_abs) < 10, 'Stardust drogue time ' + R.sd_drogue_t.gap_abs);
  assert.ok(Math.abs(R.sd_main_h.gap_abs) <= 0.73, 'Stardust main altitude within the switch accuracy ' + R.sd_main_h.gap_abs);
  assert.ok(Math.abs(R.gn_fall.gap_pct) < 3, 'Genesis fall ' + R.gn_fall.gap_pct);
  assert.ok(Math.abs(R.gn_h127.gap_abs) < 1.5, 'Genesis at 126.7 s ' + R.gn_h127.gap_abs);
  assert.ok(Math.abs(R.gn_trigger.gap_abs) < 4, 'Genesis 3 g point ' + R.gn_trigger.gap_abs);
  // OSIRIS-REx: slower than what flew, like NASA's own reconstruction
  assert.ok(R.ox_main_dur.model > R.ox_main_dur.ref && R.ox_main_dur.model < R.ox_main_dur.ref2, 'time on the main between the video and NASA\'s reconstruction');
  assert.ok(R.ox_td.model > R.ox_td.ref && R.ox_td.model < R.ox_td.ref2, 'touchdown between the video and NASA\'s reconstruction');
  // (review) opening the main where the AAS 2024 reconstruction puts it (2,699 m over a 1,299 m site) brings the time on
  // the main from +31 % to within 10 % of the video: the main canopy agrees with NASA's; the fall before it does not
  assert.ok(Math.abs(R.ox_main_dur_recon.gap_pct) < 10, 'time on the main from 2,699 m ' + R.ox_main_dur_recon.gap_pct);
  assert.ok(R.ox_main_dur.gap_pct > 25, 'from the nominal 10,000 ft ' + R.ox_main_dur.gap_pct);
  // a sanity row: the drogue the fit gives lands Stardust 31.03 -> 3.428 km in 331.3 s, by construction (the fit's own check)
  const C = K.srcCanopies(); assert.ok(C.drogue_cds_m2 > 0.3 && C.drogue_cds_m2 < 1.5, 'drogue drag area ' + C.drogue_cds_m2);
});

test('5. the independent oracle (Earth-fixed frame, DOP853, ambiance, Simpson): events, loads, heating, recession', () => {
  const O = JSON.parse(fs.readFileSync(path.join(HERE, 'oracle/descent-oracle.json'), 'utf8')).cases;
  const cases = JSON.parse(fs.readFileSync(path.join(HERE, 'oracle/cases.json'), 'utf8'));
  // the fixture's inputs are this kernel's current ones (a kernel change that moves them makes the fixture stale)
  const fresh = K.oracleCases();
  for (let i = 0; i < fresh.cases.length; i++) {
    const a = fresh.cases[i], b = cases.cases[i];
    assert.equal(a.id, b.id); close(a.trigger.t, b.trigger.t, 1e-6, a.id + ' trigger time'); close(a.mass_kg, b.mass_kg, 1e-6, a.id + ' mass');
    for (const k of ['land_t', 'land_speed', 'recession_m', 'Q_conv', 'Q_rad']) close(a.kernel[k], b.kernel[k], 1e-6, a.id + ' fixture ' + k);
  }
  for (const c of fresh.cases) {
    const o = O[c.id], k = c.kernel;
    near(k.land_t, o.land_t, 0.02, c.id + ' touchdown time');
    close(k.land_speed, o.land_speed, 1e-5, c.id + ' touchdown speed');
    if (k.main_t !== null) near(k.main_t, o.main_t, 0.02, c.id + ' main deploy');
    if (k.drogue_t !== null) near(k.drogue_t, o.drogue_t, 1e-6, c.id + ' drogue deploy');
    if (k.main_open_g !== null) close(k.main_open_g, o.main_open_g, 0.04, c.id + ' main opening load');
    if (k.drogue_open_g !== null) close(k.drogue_open_g, o.drogue_open_g, 0.04, c.id + ' drogue opening load');
    close(k.Q_conv, o.Q_conv, 1e-3, c.id + ' convective heat load');
    close(k.Q_rad, o.Q_rad, 1e-3, c.id + ' radiative heat load');
    close(k.recession_m, o.recession_m, 0.015, c.id + ' recession');
    close(k.peak_Tw, o.peak_Tw, 5e-4, c.id + ' peak wall temperature');
  }
});

test('6. the chain: idea 48\'s skip entry flown to the ground, radiation, the shield, the parachutes, the ledger', () => {
  const R = run('chain', K.defaults());
  assert.ok(!R.refusal);
  assert.equal(R.descent.passes.length, 2);
  const h48 = chain(), sc = h48.outputs.screening.value;
  close(Math.max(...R.descent.passes.map((p) => p.peak_g)), sc.peak_g, 1e-6, 'idea 48\'s peak g');
  close(R.heat.Q_conv, sc.heat_load_J_m2, 2e-3, 'convective heat load = idea 48\'s screen (0.1 s samples, flown to the ground)');
  // radiation: most of the first pass, nearly as much as convection over the whole entry
  assert.ok(R.heat.Q_rad > 0.75 * R.heat.Q_conv && R.heat.Q_rad < R.heat.Q_conv, 'radiative heat load ' + R.heat.Q_rad / 1e7);
  assert.ok(R.heat.peaks.qr > 2 * R.heat.peaks.qc, 'peak radiation over twice peak convection');
  assert.ok(R.heat.Q_rad_extrapolated < 0.5 * R.heat.Q_rad, 'mostly inside the fit');
  // the heat shield: outside Stardust's design (heat load x2.1, pressure x1.5), so no thickness, a refusal, a lower bound
  assert.equal(R.shield.heritage.ok, false); assert.equal(R.shield.thickness_m, null);
  close(R.shield.heritage.heat_load_ratio, R.heat.Q_total / 36.5e7, 1e-12, 'heat load ratio');
  assert.ok(R.refusals.some((r) => r.applies_to === 'tps_thickness' && /export-control/.test(r.reason)));
  close(R.shield.thickness_min_m, R.shield.recession_stag_m, 1e-12, 'thickness lower bound');
  close(R.shield.ablated_kg, R.shield.mass_loss_stag_kg_m2 * 15.34 * K.PROFILE, 1e-12, 'ablated mass by hand');
  close(R.mass.landed_kg, R.mass.entry_kg - R.mass.ablated_kg, 1e-12, 'landed = entry - ablated');
  assert.ok(R.shield.recession_stag_m > 0.008 && R.shield.recession_stag_m < 0.013, 'recession ' + R.shield.recession_stag_m);
  // the parachutes, sized: the main for 4.5 m/s at sea level; the drogue at Stardust's ballistic coefficient
  const C = K.srcCanopies(), ch = R.descent.chutes, m = R.mass.landed_kg, rho0 = deps.catchDeps.isa.isa(0).rho_kg_m3;
  close(ch.main_cds_m2, 2 * m * 9.80665 / (rho0 * 4.5 * 4.5), 1e-12, 'main drag area');
  close(ch.drogue_cds_m2, C.drogue_cds_m2 * m / C.drogue_mass_kg, 1e-12, 'drogue drag area');
  close(ch.main_equiv_src_canopies, ch.main_cds_m2 / C.main_cds_m2, 1e-12, 'SRC mains');
  assert.ok(ch.main_equiv_src_canopies > 150, 'a cluster, not a canopy: ' + ch.main_equiv_src_canopies);
  near(R.land.speed, 4.5, 0.02, 'touchdown speed');
  // the epoch carries through: landing UTC = idea 48's entry UTC + the time down
  close(R.land.tdb, h48.outputs.entry_interface.value.tdb_s_past_j2000 + R.land.t, 1e-12, 'landing epoch');
  // every refusal idea 48 carried is carried on, with its sender
  assert.equal(R.carried.length, h48.refusals.length);
  assert.ok(R.refusals.some((r) => r.applies_to === 'landing_site'));
  assert.ok(R.refusals.some((r) => r.applies_to === 'parachutes'));
});

test('7. decisions: radiation off, no parachute, OSIRIS-REx with its drogue, a faster touchdown, Stardust\'s heritage, Genesis\'s carbon-carbon', () => {
  const off = K.run({ source: 'chain', radiative: false });
  assert.equal(off.heat.Q_rad, 0); assert.ok(off.refusals.some((r) => r.applies_to === 'radiative_heating' && r.code === 'insufficient_data'));
  assert.ok(off.shield.heritage.heat_load_ratio < run('chain', K.defaults()).shield.heritage.heat_load_ratio);
  const none = K.run({ source: 'chain', chutes: 'none' });
  assert.ok(none.land.speed > 50, 'no parachute: ' + none.land.speed); assert.equal(none.descent.chutes.mode, 'none');
  const oxNom = K.run({ source: 'osirisrex', chutes: 'nominal' }), oxFlown = run('ox', { source: 'osirisrex' });
  assert.ok(oxNom.land.t > oxFlown.land.t + 60, 'with its drogue OSIRIS-REx comes down later');
  assert.ok(oxNom.descent.chutes.main.open_peak_g < oxFlown.descent.chutes.main.open_peak_g, 'and opens its main more gently');
  const fast = K.run({ source: 'chain', touchdown_m_s: 9 });
  close(fast.descent.chutes.main_cds_m2, run('chain', K.defaults()).descent.chutes.main_cds_m2 * (4.5 / 9) ** 2, 1e-9, 'main area scales as 1/v^2');
  const sd = run('sd', { source: 'stardust' });
  assert.equal(sd.shield.heritage.ok, true); assert.equal(sd.shield.thickness_m, 0.0582);
  close(sd.shield.shield_mass_kg, 266 * 0.0582 * K.wetArea(K.vehicleOf('stardust')).m2, 1e-12, 'Stardust shield mass');
  const hi = K.run({ source: 'stardust', shield_density: 274 });
  close(hi.shield.recession_stag_m, sd.shield.recession_stag_m * 266 / 274, 1e-9, 'recession scales as 1/density');
  const gn = run('gn', { source: 'genesis' });
  assert.equal(gn.shield.thickness_m, null); assert.ok(gn.refusals.some((r) => r.applies_to === 'shield_material'));
  const up = K.run({ source: 'chain', ground_alt_m: 1288 });
  assert.ok(up.land.t < run('chain', K.defaults()).land.t, 'a higher ground is reached sooner');
});

test('8. refusals: bad settings, idea 48 choices that do not end on the ground, other handoffs', () => {
  const bad = [{ source: 'mars' }, { chutes: 'two' }, { radiative: 'yes' }, { shield_density: 50 }, { shield_density: NaN }, { touchdown_m_s: 0.5 }, { ground_alt_m: 7000 }, { ground_alt_m: -1 }, { trigger_g: 0.1 },
    { drogue_timer_s: -1 }, { main_baro_Pa: 500 }, { main_timer_s: 0 }, { main_timer_s: Infinity }];
  for (const s of bad) { const R = K.run(s); assert.ok(R.refusal, JSON.stringify(s)); assert.equal(R.refusal.code, 'invalid_input', JSON.stringify(s)); }
  const orb = chain(); orb.outputs.capture.value.choice = 'aerocapture'; orb.outputs.capture.value.destination = 'orbit';
  const r1 = K.run({ source: 'imported' }, { h48: orb }); assert.equal(r1.refusal.code, 'out_of_envelope'); assert.equal(r1.refusal.applies_to, 'capture');
  const none = chain(); none.outputs.capture.value.choice = null;
  assert.equal(K.run({ source: 'imported' }, { h48: none }).refusal.code, 'out_of_envelope');
  assert.equal(K.run({ source: 'imported' }).refusal.code, 'not_found');
  const h47 = JSON.parse(fs.readFileSync(path.join(BANK, 'ideas/47-way-home/handoff.json'), 'utf8'));
  assert.equal(K.parseHandoff(h47).refusal.code, 'invalid_input');
  assert.equal(K.parseHandoff('{nope').refusal.code, 'invalid_input');
  const veh = chain(); veh.outputs.vehicle.value.area_m2 *= 1.01; assert.equal(K.parseHandoff(veh).refusal.code, 'invalid_input');
});

test('9. the handoff: the sample is the defaults\' run, every output is labelled, it reads back, edits are refused', () => {
  const sample = JSON.parse(fs.readFileSync(path.join(HERE, 'handoff.json'), 'utf8'));
  const h = K.buildHandoff(run('chain', K.defaults()), sample.produced);
  assert.equal(K.numDiff(h.outputs, sample.outputs, 'outputs', 1e-9), null);
  assert.deepEqual(h.inputs, sample.inputs); assert.equal(h.inputs.catch_handoff.sha256, deps.chain.digest.sha256);
  for (const [k, o] of Object.entries(h.outputs)) { assert.ok(o.units && o.source && ['measured', 'derived', 'assumed'].includes(o.confidence), k); }
  assert.equal(h.refusals.length, chain().refusals.length + run('chain', K.defaults()).refusals.length);
  assert.ok(h.refusals.every((r) => r.from && r.code && r.reason && r.what_would_help));
  assert.ok(!K.parseHandoff(sample).refusal, 'the sample reads back');
  assert.ok(!K.parseHandoff(JSON.stringify(sample)).refusal, 'and as text');
  const e = JSON.parse(JSON.stringify(sample)); e.outputs.loads.value.peak_q_rad_W_m2 *= 1.01; assert.ok(K.parseHandoff(e).refusal);
  const d = JSON.parse(JSON.stringify(sample)); d.refusals.pop(); assert.ok(K.parseHandoff(d).refusal);
  const u = JSON.parse(JSON.stringify(sample)); u.inputs.catch_handoff.sha256 = '0'.repeat(64); assert.equal(K.parseHandoff(u).refusal.code, 'not_found');
  assert.equal(K.parseHandoff(chain()).from, '48-catch');
  const s = K.b64urlEncode(JSON.stringify(sample)); assert.deepEqual(JSON.parse(K.b64urlDecode(s)), sample);
  // idea 48's handoff carried whole (an import) reads back too
  const hi = K.buildHandoff(K.run({ source: 'imported' }, { h48: chain() }), 'x');
  assert.equal(hi.inputs.catch_handoff.from, '48-catch'); assert.ok(!K.parseHandoff(hi).refusal);
});

test('10. the shield\'s verdicts on set heating: the PICA envelope, Stardust\'s design, radiation counted in the heat load', () => {
  const arr = K.capsuleArrival('osirisrex'), S0 = K.defaults();
  const H = (qt, ps, Qc, Qr) => ({ peaks: { qt: qt, ps: ps, Tw: 3000, rate: 1e-4 }, Q_conv: Qc, Q_rad: Qr, Q_total: Qc + Qr, recession_stag: 0.005, mass_loss_stag: 1.3 });
  const atm = K.P_ATM;
  // inside PICA's 1,500 W/cm2 and 1 atm, but over Stardust's 1,200 W/cm2 design: recession counted, thickness refused
  let s = K.shield(arr, H(1300e4, 0.4 * atm, 20e7, 2e7), S0);
  assert.equal(s.in_envelope, true); assert.ok(!s.refusals.some((r) => r.applies_to === 'recession'));
  assert.equal(s.heritage.ok, false); assert.equal(s.thickness_m, null);
  // over PICA's limit: the recession is refused
  s = K.shield(arr, H(1600e4, 0.4 * atm, 20e7, 2e7), S0); assert.equal(s.in_envelope, false); assert.ok(s.refusals.some((r) => r.applies_to === 'recession'));
  s = K.shield(arr, H(1000e4, 1.1 * atm, 20e7, 2e7), S0); assert.equal(s.in_envelope, false);
  // the heat load counts radiation: 30 convective + 8 radiative = 38 kJ/cm2 is over Stardust's 36.5
  s = K.shield(arr, H(1000e4, 0.4 * atm, 30e7, 8e7), S0); assert.equal(s.heritage.ok, false); assert.equal(s.thickness_m, null);
  s = K.shield(arr, H(1000e4, 0.4 * atm, 30e7, 6e7), S0); assert.equal(s.heritage.ok, true); assert.equal(s.thickness_m, 0.0582);
  // the pressure counts too
  s = K.shield(arr, H(1000e4, 0.6 * atm, 20e7, 2e7), S0); assert.equal(s.heritage.ok, false);
  // idea 48's screening is checked by flying it again: an edited peak, or a velocity scaled consistently, is refused
  const e1 = chain(); e1.outputs.screening.value.peak_g *= 1.001; assert.equal(K.importCatch(e1).refusal.code, 'invalid_input');
  const e2 = chain(), ei = e2.outputs.entry_interface.value;
  ei.v_m_s = ei.v_m_s.map((x) => x * 1.001);
  const vr = K.K.vrelOf(ei.r_m, ei.v_m_s); ei.speed_inertial_m_s = Math.hypot(...ei.v_m_s); ei.speed_relative_m_s = Math.hypot(...vr);
  const imp = K.importCatch(e2); assert.ok(imp.refusal && /does not give the loads it screened/.test(imp.refusal.reason), 'a consistent velocity edit is caught by the re-flight: ' + JSON.stringify(imp.refusal));
});

test('11. review: where the flown capsules land, parachutes that never open, a switch already past, Genesis\'s canopies, the ground\'s air', () => {
  // the flown capsules' entry points are idea 48's stand-ins at their landing targets: their touchdown point is refused
  for (const id of ['stardust', 'osirisrex', 'genesis']) {
    const R = run(id === 'stardust' ? 'sd' : id === 'osirisrex' ? 'ox' : 'gn', { source: id });
    assert.equal(R.land.lat, null, id); assert.equal(R.land.lon, null, id);
    assert.ok(R.refusals.some((r) => r.applies_to === 'landing_site' && /not where the capsule landed/.test(r.reason)), id);
    assert.ok(R.land.downrange_m > 7e5 && R.land.downrange_m < 1e6, id + ' downrange ' + R.land.downrange_m);
    const h = K.buildHandoff(R, 'x'); assert.equal(h.outputs.landing.value.latitude_deg, null); assert.ok(!K.parseHandoff(h).refusal, id + ' reads back');
  }
  // the chain's landing place: the great circle from idea 48's entry point (ERFA's Earth rotation angle at both epochs)
  // equals the downrange measured in the frame turning with the Earth (a sign error in either rotation would not)
  const C0 = run('chain', K.defaults()), e = K.K.geodetic(C0.arrival.x0.r, C0.arrival.tdb), d2r = Math.PI / 180;
  const hav = Math.sin((C0.land.lat - e.lat) * d2r / 2) ** 2 + Math.cos(e.lat * d2r) * Math.cos(C0.land.lat * d2r) * Math.sin((C0.land.lon - e.lon) * d2r / 2) ** 2;
  close(2 * K.RE * Math.asin(Math.sqrt(hav)), C0.land.downrange_m, 1e-6, 'great circle = downrange');
  // a sequence that never opens a parachute is refused with the speed it hits at; no opening-load refusal then
  for (const s of [{ trigger_g: 20 }, { trigger_g: 0.5 }, { drogue_timer_s: 600 }, { source: 'genesis', chutes: 'no_drogue' }]) {
    const R = K.run(s);
    assert.ok(R.land.speed > 50, JSON.stringify(s) + ' ' + R.land.speed);
    assert.ok(R.refusals.some((r) => r.applies_to === 'parachute_sequence' && r.code === 'out_of_envelope'), JSON.stringify(s));
    assert.ok(!R.refusals.some((r) => r.applies_to === 'opening_loads'), JSON.stringify(s));
  }
  assert.ok(/at or below 1 g/.test(K.run({ trigger_g: 0.5 }).refusals.find((r) => r.applies_to === 'parachute_sequence').reason));
  const hi = K.run({ ground_alt_m: 6000 });
  assert.equal(hi.descent.chutes.main, undefined); assert.ok(hi.land.speed > 30);
  assert.ok(hi.refusals.some((r) => r.applies_to === 'parachute_sequence' && /main never opens/.test(r.reason)));
  assert.ok(!C0.refusals.some((r) => r.applies_to === 'parachute_sequence'), 'the chain\'s own sequence works');
  // a pressure switch armed below its setting fires at once (it used to wait for the 350.6 s timer)
  const CAN = K.srcCanopies(), b = K.run({ main_baro_Pa: 1000 });
  near(b.descent.chutes.main.t - b.descent.chutes.drogue.t, CAN.fill_drogue_s, 1e-6, 'main right after the drogue fills');
  assert.equal(b.descent.chutes.main_trigger, 'baroswitch');
  // Genesis with parachutes: its own canopies are not on file, so sized (not Stardust's and OSIRIS-REx's); its main on
  // its 254.0 s timer from the drogue (it had no pressure switch)
  const g = K.run({ source: 'genesis', chutes: 'nominal' }), gm = g.mass.landed_kg, rhoG = deps.catchDeps.isa.isa(S.genesis.ground_alt_m).rho_kg_m3;
  assert.equal(g.descent.chutes.sized, true);
  close(g.descent.chutes.main_cds_m2, 2 * gm * 9.80665 / (rhoG * 4.5 * 4.5), 1e-12, 'Genesis main sized');
  close(g.descent.chutes.drogue_cds_m2, CAN.drogue_cds_m2 * gm / CAN.drogue_mass_kg, 1e-12, 'Genesis drogue sized');
  near(g.descent.chutes.main.t - g.descent.chutes.drogue.t, 254.0, 1e-6, 'Genesis main timer'); assert.equal(g.descent.chutes.main_trigger, 'timer');
  assert.ok(g.refusals.some((r) => r.applies_to === 'parachutes' && /Genesis/.test(r.reason)));
  // a sized main is sized in the ground's air, not sea level's
  const up = K.run({ ground_alt_m: 1500 }), rho15 = deps.catchDeps.isa.isa(1500).rho_kg_m3;
  close(up.descent.chutes.main_cds_m2, 2 * up.mass.landed_kg * 9.80665 / (rho15 * 4.5 * 4.5), 1e-12, 'main sized at 1,500 m');
  near(up.land.speed, 4.5, 0.02, 'touchdown at 1,500 m');
  // an edited flight-path angle in idea 48's entry interface is caught (the vectors alone would fly the same)
  const f = chain(); f.outputs.entry_interface.value.fpa_inertial_deg += 0.01; assert.equal(K.importCatch(f).refusal.code, 'invalid_input');
  // an idea 48 handoff made from a flown capsule carries the same stand-in entry point: its landing place is refused too
  const L48 = require(path.join(BANK, 'ideas/48-catch/load.cjs'));
  const h48 = L48.K.buildHandoff(L48.K.run(Object.assign(L48.K.defaults(), { arrival: 'stardust' })), 'x');
  const imp = K.run({ source: 'imported' }, { h48: h48 });
  assert.equal(imp.land.lat, null); assert.ok(imp.refusals.some((r) => r.applies_to === 'landing_site' && /Stardust/.test(r.reason)));
});
