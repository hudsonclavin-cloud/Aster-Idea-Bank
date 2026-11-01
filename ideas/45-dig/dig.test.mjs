// Tests for idea 45 (Dig). Run from the bank root: node --test ideas/45-dig/dig.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BANK = path.resolve(HERE, '..', '..');
const require = createRequire(import.meta.url);
const L = require('./load.cjs');
const K = L.K;
const SRC = L.deps.sources;
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b} (tol ${tol})`);
const rel = (a, b) => Math.abs(a - b) / Math.abs(b);
const DEG = Math.PI / 180;

const chain = K.parseHandoff(L.sample44());
const bennu = K.parseHandoff(L.bennu44());
const Rc = K.run(chain.src, {});
const Rb = K.run(bennu.src, {});

test('1. snapshots: sidecars match, earlier kernels byte-identical, Robie-Hemingway equations reproduce their own tables', () => {
  const dir = path.join(HERE, 'snapshots');
  for (const f of fs.readdirSync(dir).filter((x) => !x.endsWith('.provenance.json'))) {
    const side = JSON.parse(fs.readFileSync(path.join(dir, f + '.provenance.json'), 'utf8'));
    assert.equal(sha(fs.readFileSync(path.join(dir, f))), side.writtenSha256, f + ' differs from its sidecar');
  }
  for (const [mine, theirs] of [['lumpy.js', 'ideas/43-lumpy/lumpy.js'], ['attitude.js', 'ideas/43-lumpy/snapshots/attitude.js'], ['integrator.js', 'ideas/43-lumpy/snapshots/integrator.js'],
    ['approach-sources.js', 'ideas/43-lumpy/snapshots/approach-sources.js'], ['aster-constants.js', 'ideas/43-lumpy/snapshots/aster-constants.js'], ['nav-sources.js', 'ideas/40-long-coast/snapshots/nav-sources.js']]) {
    assert.ok(fs.readFileSync(path.join(dir, mine)).equals(fs.readFileSync(path.join(BANK, theirs))), mine + ' is not ' + theirs);
  }
  assert.deepEqual(L.sample44(), JSON.parse(fs.readFileSync(path.join(BANK, 'ideas/44-touch-and-go/handoff.json'), 'utf8')), 'the wrapped chain handoff is idea 44\'s');
  // every Cp equation, integrated, gives back the detailed table's Cp and (H - H298)/T to their printed 0.01
  for (const k of Object.keys(SRC.thermo.species)) {
    const sp = SRC.thermo.species[k];
    for (const c of sp.checks) {
      close(K.cpRH(sp.cp, c.T_K), c.cp_J_mol_K, 0.006, `${k} Cp(${c.T_K})`);
      close(K.dhRH(sp.cp, c.T_K) / c.T_K, c.dH_over_T_J_mol_K, 0.006, `${k} (H-H298)/T at ${c.T_K}`);
    }
  }
  assert.equal(SRC.murchison.runs.length, 6);
  assert.equal(SRC.quotes, 50, 'build-data found every quoted figure in its source');
  // the Sun's flux at 1 au is idea 40's luminosity over 4 pi au^2
  close(K.S1AU, L.deps.nav.sun.luminosity_W / (4 * Math.PI * L.deps.constants.au_m ** 2), 1e-9);
  close(K.S1AU, 1361.17, 0.01, 'flux at 1 au');
});

test('2. oracle: the Sun\'s elevation at Nightingale against JPL Horizons\' own Bennu model, three days in six months', () => {
  const fx = JSON.parse(fs.readFileSync(path.join(HERE, 'oracle/horizons-bennu-sun.json'), 'utf8'));
  const n = [Math.cos(55.9 * DEG) * Math.cos(41.8 * DEG), Math.cos(55.9 * DEG) * Math.sin(41.8 * DEG), Math.sin(55.9 * DEG)];   // the geodetic normal IS the direction of (lat, lon)
  const MON = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
  let max = 0, rows = 0, upH = 0, upM = 0;
  for (const d of fx.days) for (const [utc, el] of d.rows) {
    const m = utc.match(/(\d{4})-(\w{3})-(\d{2}) (\d{2}:\d{2})/);
    const t = K.tdbOfUtc(`${m[1]}-${MON[m[2]]}-${m[3]}T${m[4]}:00Z`);
    const e = K.sunElevation('bennu', t, n);
    max = Math.max(max, Math.abs(e.el_deg - el)); rows++;
    if (el > 0) upH++; if (e.el_deg > 0) upM++;
  }
  assert.equal(rows, 435);
  assert.ok(max < 0.03, 'max elevation difference ' + max);
  assert.ok(max > 0.001, 'not suspiciously exact: bennu_v17.tpc and Horizons\' rotation model differ a little');
  assert.equal(upM, upH, 'the same 5-minute samples are daylight');
});

test('3. Apophis: the interpolated sunlight follows idea 43\'s spin; the Bennu daylight fraction matches the closed form', () => {
  const st = chain.src.site, nu = st.normal;
  const A = [], step = 7200;
  for (let k = 0; k <= 36; k++) A.push(K.sunInBody('apophis', st.epoch + k * step));
  let max = 0;
  for (let j = 0; j < 288; j++) {
    const ts = (j + 0.5) * 900, kk = Math.floor(ts / step), f = (ts - kk * step) / step;
    const s = K.hermite(A[kk], A[kk + 1], f, step);
    const ei = Math.asin(nu[0] * s[0] + nu[1] * s[1] + nu[2] * s[2]) / DEG, ed = K.sunElevation('apophis', st.epoch + ts, nu).el_deg;
    max = Math.max(max, Math.abs(ei - ed));
  }
  assert.ok(max < 0.02, 'Hermite between 2-h kernel calls: ' + max + ' deg');
  // the tumbling makes the days uneven; the first ten
  const lit = Rc.timeline.slice(0, 10).map((d) => d.lit_h);
  assert.deepEqual(lit.map((x) => +x.toFixed(2)), [6.42, 13.17, 12.0, 6.83, 8.17, 9.08, 14.08, 15.17, 12.58, 9.0]);
  // a horizon mask: a sample is lit when the Sun is above the mask, nothing else (Bennu: every 5-min sample is the kernel's)
  const masked = K.run(bennu.src, { horizon_deg: 10, stay_days: 1 }), sb = bennu.src.site;
  let up = 0; for (let j = 0; j < 288; j++) if (K.sunElevation('bennu', sb.epoch + (j + 0.5) * 300, sb.normal).el_deg > 10) up++;
  close(masked.timeline[0].lit_h, up * 300 / 3600, 1e-9, 'lit hours above a 10 deg mask');
  assert.ok(masked.timeline[0].lit_h < Rb.timeline[0].lit_h - 1, 'the mask shortens the day');
  const rDay = K.reality(Rb).filter((r) => /closed form/.test(r.what))[0];
  assert.ok(Math.abs(rDay.model - rDay.real) < 0.15, `daylight ${rDay.model} vs closed form ${rDay.real} (% of a turn)`);
  close(rDay.real, 50.539, 0.01);
});

test('4. heat: Hess\'s law, hand-worked numbers and the limits', () => {
  const sp = SRC.thermo.species;
  // dehydroxylation at 298.15 K from the four enthalpies of formation, per kg of water
  const rxn = 1000 * (sp.forsterite.dHf_kJ_mol + sp.enstatite.dHf_kJ_mol + 2 * sp.steam.dHf_kJ_mol - sp.chrysotile.dHf_kJ_mol);
  close(rxn, 157800, 1e-6, 'J per mol chrysotile');
  close(K.energy(0.1, 298.15, 298.15, 0).perKgWaterReaction_J, 157.8e3 / (2 * 0.018015), 1e-3);
  // dry rock to 1000 K is forsterite's tabulated enthalpy rise: 109.28 J/mol/K x 1000 K / 0.140693 kg/mol
  close(K.energy(0, 298.15, 1000, 0).perKgRegolith_J / (109.28 * 1000 / 0.140693), 1, 2e-5);
  // path independence: react at 298 then heat the products = heat the reactants then react at 800 K
  const w = 0.08, T = 800, e = K.energy(w, 298.15, T, 0), f = w / K.XW, nCh = f / 0.277112, nFo0 = (1 - f) / 0.140693;
  const H = (s, t) => 1000 * s.dHf_kJ_mol + K.dhRH(s.cp, t);
  const at800 = nCh * (H(sp.forsterite, T) + H(sp.enstatite, T) + 2 * H(sp.steam, T) - H(sp.chrysotile, T));
  const heatReactants = nCh * K.dhRH(sp.chrysotile.cp, T) + nFo0 * K.dhRH(sp.forsterite.cp, T);
  close(e.perKgRegolith_J, heatReactants + at800, 1e-6, 'Hess');
  // full recovery hands back exactly the spent solids' sensible heat
  const e0 = K.energy(w, 298.15, 1023.15, 0), e1 = K.energy(w, 298.15, 1023.15, 1);
  close(e0.perKgRegolith_J - e1.perKgRegolith_J, -e1.parts_J_per_kg.recovered, 1e-6);
  assert.ok(e1.perKgRegolith_J > 0 && e1.perKgRegolith_J < e0.perKgRegolith_J);
  // more water than serpentine holds is refused
  assert.equal(K.energy(0.14, 298.15, 1023.15, 0).refusal.code, 'out_of_envelope');
  // the run-D numbers the page shows for Bennu
  close(Rb.energy.perKgRegolith_J, 1299468.53, 1, 'J per kg regolith');
  close(Rb.energy.perKgWater_J / 1e6, 13.4145611, 1e-6, 'MJ per kg water');
  close(Rb.energy.f_serpentine, 0.0968700 / K.XW, 1e-12);
  close(Rb.energy.extrapolated_K, 23.15, 1e-9);
});

test('5. the concentrator: the cavity radiates sigma T^4 / C, and below the break-even concentration no heat goes in', () => {
  const P = { eta_opt: 0.85, conc: 300, eps: 1 }, S = 1000, T = 1023.15, sigma = SRC.sigma.W_m2_K4;
  close(K.receiverFlux(S, T, P), 0.85 * 1000 - sigma * T ** 4 / 300, 1e-9);
  const Cmin = K.minConcentration(S, T, P);
  close(Cmin, sigma * T ** 4 / 850, 1e-9);
  assert.equal(K.receiverFlux(S, T, Object.assign({}, P, { conc: Cmin * 0.999 })), 0);
  assert.ok(K.receiverFlux(S, T, Object.assign({}, P, { conc: Cmin * 1.01 })) > 0);
  // the page refuses a concentration that cannot reach the oven temperature
  const r = K.run(bennu.src, { conc: 50 });
  assert.ok(r.own.some((x) => x.applies_to === 'receiver'));
  assert.equal(r.water.mean, 0);
  close(Rb.receiver.eta_rec_epoch, 0.671422, 1e-6);
  close(Rc.receiver.minConc_epoch, 38.2434, 1e-4);
});

test('6. digging: the push, the depth that lifts the spacecraft off, and holding down', () => {
  const D = SRC.ipex.drums.small, st = chain.src.site, S = Rc.S;
  // by hand: imbalance x p w d + mdot v_tip, mdot = 2 rho w d v, v_tip = 8.5 v
  const p = st.resistance_Pa[1], w = D.width_m, d = 0.010, v = 0.010, rho = st.rho43;
  const push = 0.1 * p * w * d + (2 * rho * w * d * v) * (8.5 * v);
  close(Rc.dig.push_N, push, 1e-12);
  close(Rc.dig.push_N, 0.0396550608, 1e-10);
  close(Rc.dig.weightNormal_N / chain.src.surface.hold_normal_N, 1, 1e-8, 'idea 44\'s weight normal to the ground (printed to 9 figures)');
  close(Rc.dig.depthMax_m * Rc.dig.perDepth_N_m, Rc.dig.weightNormal_N, 1e-12);
  assert.equal(Rc.dig.liftsOff, false);
  // perfectly balanced drums push only by the momentum of what they dig
  const b = K.dig(Object.assign({}, S, { imbalance: 0 }), { resistance_Pa: st.resistance_Pa, weightNormal_N: 1, alongSlope_N: 0, holdKgPerNHour: null, propellantLeft_kg: null });
  close(b.push_N, b.mdot_kg_s * b.vTip_m_s, 1e-15);
  // deeper than the limit: cut back to it, and the chain's spacecraft has no propellant to hold itself down
  const deep = K.run(chain.src, { depth_m: 0.02, hold: 'thrust' });
  assert.ok(deep.dig.liftsOff && deep.dig.depthCapped);
  close(deep.dig.depthUsed_m, Rc.dig.depthMax_m, 1e-15);
  const pr = deep.own.filter((x) => x.applies_to === 'push')[0];
  assert.ok(pr && /no propellant left/.test(pr.reason));
  // a spacecraft with propellant: holding down costs idea 44's kg per newton-hour
  const src2 = JSON.parse(JSON.stringify(chain.src)); src2.site.propellantLeft_kg = 5; src2.site.propellantShort_kg = null;
  const held = K.run(src2, { depth_m: 0.02, hold: 'thrust' });
  assert.ok(held.dig.thrustOk && !held.dig.depthCapped);
  close(held.dig.holdKgPerHour, (held.dig.push_N - held.dig.weightNormal_N) * st.holdKgPerNHour, 1e-15);
  assert.ok(held.holdKgPerDay > 0);
});

test('7. feedstock: spectral class to analog, and what the water numbers are compared with', () => {
  assert.equal(K.analogOfClass('Sq'), 'ordinary'); assert.equal(K.analogOfClass('S(IV)'), 'ordinary');
  assert.equal(K.analogOfClass('B'), 'cm'); assert.equal(K.analogOfClass('Cb'), 'cm'); assert.equal(K.analogOfClass('X'), null);
  assert.equal(SRC.sbdb['99942'].spec_B.value, 'Sq'); assert.equal(SRC.sbdb['101955'].spec_B.value, 'B'); assert.equal(SRC.sbdb['162173'].spec_B.value, 'Cb'); assert.equal(SRC.sbdb['25143'].spec_B.value, 'S(IV)');
  assert.equal(Rc.feed.analog, 'ordinary'); assert.equal(Rc.feed.bound, 'upper'); close(Rc.feed.w, 510e-6, 1e-15);
  assert.ok(Rc.own.some((r) => r.applies_to === 'release'));
  assert.equal(Rb.feed.analog, 'cm'); close(Rb.feed.w, 0.09687, 1e-15);
  const what = K.run(chain.src, { analog: 'cm' });
  assert.ok(what.own.some((r) => r.applies_to === 'analog'), 'a CM Apophis is labelled a what-if');
  // each Murchison run gives its own step-2 water; argon and vacuum differ at the same rate
  for (const r of SRC.murchison.runs) close(K.run(bennu.src, { run: r.id }).feed.w, r.h2o_wt / 100, 1e-15);
  const rows = K.reality(Rb);
  const g = (re) => rows.filter((r) => re.test(r.what))[0];
  close(g(/Winchcombe/).gap_pct, 100 * (9.687 - 10.5) / 10.5, 1e-9);
  close(g(/Nightingale's latitude/).real, 0.71 / K.H_PER_H2O, 1e-12);
  close(K.H_PER_H2O, 2 * 1.00794 / (2 * 1.00794 + 15.9994), 1e-15);
  close(g(/Nightingale's latitude/).gap_pct, 52.7, 0.05);
  close(g(/surface average/).gap_pct, 90.2, 0.05);
  close(g(/Serpentine implied/).model, 9.687 / (100 * K.XW) * 100, 1e-9);
  close(g(/Serpentine implied/).gap_pct, 2.06, 0.01);
  close(g(/bound water/).real, 44.0 / 18.015, 1e-9);
});

test('8. the chain: idea 44\'s handoff in, the daily ledger, this page\'s handoff out and back', () => {
  assert.ok(!chain.refusal && !bennu.refusal);
  assert.equal(chain.src.kind, 'apophis'); assert.equal(bennu.src.kind, 'bennu');
  assert.ok(chain.src.attitudeDiff < 1e-4 && chain.src.attitudeDiff > 1e-6, 'idea 44 carried the attitude through its flight; idea 43 restarts from the CK knot');
  assert.equal(Rc.carried.length, 19); assert.equal(Rb.carried.length, 4);
  // the ledger: each day is the least of heat, oven and digging, times the water fraction
  for (const R of [Rc, Rb]) {
    let tot = 0;
    for (const d of R.timeline) {
      const m = Math.min(d.regolithHeat_kg, d.regolithOven_kg, d.regolithDig_kg);
      close(d.regolith_kg, m, 1e-12); close(d.water_kg, m * R.feed.w, 1e-12);
      tot += d.water_kg;
    }
    close(R.water.total, tot, 1e-9); close(R.water.mean, tot / R.timeline.length, 1e-12);
  }
  close(Rc.water.mean, 0.125624138, 1e-8, 'chain kg/day (upper bound)');
  close(Rb.water.mean, 12.5690238, 1e-6, 'Bennu kg/day');
  assert.deepEqual(Rc.water.limits, { heat: 0, oven: 90, dig: 0 });
  assert.deepEqual(Rb.water.limits, { heat: 90, oven: 0, dig: 0 });
  // heat-limited water scales with the mirror; doubling the aperture doubles Bennu's water
  const big = K.run(bennu.src, { aperture_m2: 17, oven_kg: 1000 });
  close(big.water.mean / K.run(bennu.src, { oven_kg: 1000 }).water.mean, 2, 1e-12);
  // the handoff round trip, and the sample in the folder is exactly what its inputs give
  const h = K.buildHandoff(Rc, '2026-11-01T12:00:00Z');
  const back = K.parseHandoff(JSON.parse(JSON.stringify(h)));
  assert.ok(!back.refusal, back.refusal && back.refusal.reason);
  const sample = JSON.parse(fs.readFileSync(path.join(HERE, 'handoff.json'), 'utf8'));
  assert.deepEqual(sample.outputs, JSON.parse(JSON.stringify(h.outputs)));
  assert.ok(!K.parseHandoff(sample).refusal);
  const edited = JSON.parse(JSON.stringify(h)); edited.outputs.water_rate.value.mean_kg_per_day *= 1.01;
  assert.match(K.parseHandoff(edited).refusal.reason, /water_rate/);
  const dropped = JSON.parse(JSON.stringify(h)); dropped.refusals.pop();
  assert.match(K.parseHandoff(dropped).refusal.reason, /refusals/);
  // Apophis's spin is not known past the Earth encounter: a year's stay is cut there
  const year = K.run(chain.src, { stay_days: 365 });
  assert.equal(year.timeline.length, 275);
  assert.ok(year.own.some((r) => r.applies_to === 'stay' && /2029-04-13/.test(r.reason)));
});

test('9. refusals the inputs raise', () => {
  assert.equal(K.parseHandoff('not json').refusal.code, 'invalid_input');
  assert.equal(K.parseHandoff({ handoff: 'other' }).refusal.code, 'invalid_input');
  const h43 = JSON.parse(JSON.stringify(L.sample44().inputs.lumpy_handoff));
  assert.match(K.parseHandoff(h43).refusal.what_would_help, /idea 44/);
  const heavy = JSON.parse(JSON.stringify(L.sample44())); heavy.outputs.surface_state.value.weight_N *= 2;
  assert.match(K.parseHandoff(heavy).refusal.reason, /weighs/);
  const turned = JSON.parse(JSON.stringify(L.sample44())); turned.outputs.surface_state.value.C_icrf_to_body[0] += 0.01;
  assert.match(K.parseHandoff(turned).refusal.reason, /spin/);
  const other = JSON.parse(JSON.stringify(L.bennu44())); other.outputs.surface_state.value.body = '433 Eros';
  assert.equal(K.parseHandoff(other).refusal.code, 'not_found');
  for (const bad of [{ conc: 0 }, { run: 'Z' }, { analog: 'iron' }, { stay_days: 0 }, { T0_K: 250 }, { pairs: 1.5 }, { drum: 'huge' }, { hold: 'glue' }]) {
    const r = K.run(bennu.src, bad);
    assert.equal(r.refusal && r.refusal.code, 'invalid_input', JSON.stringify(bad));
  }
  // an S-type oven set below the regolith's start temperature
  assert.equal(K.run(chain.src, { peakS_C: 20 }).refusal.code, 'invalid_input');
});
