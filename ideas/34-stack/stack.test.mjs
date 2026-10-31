// Tests for idea 34 (Stack). Run from the bank root: node --test ideas/34-stack/stack.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const L = require(path.join(here, 'load.cjs'));
const { S, E, AS512: D, Stack } = L;
const g0 = 9.80665, LBM = 0.45359237, LBF = LBM * g0, FT = 0.3048;
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const close = (a, b, rel, msg) => assert.ok(Math.abs(a / b - 1) <= rel, `${msg}: ${a} vs ${b} (rel ${(a / b - 1).toExponential(3)} > ${rel})`);
const near = (a, b, abs, msg) => assert.ok(Math.abs(a - b) <= abs, `${msg}: ${a} vs ${b} (|diff| ${Math.abs(a - b)} > ${abs})`);
const ENG = S.as512Engines();
const H33 = JSON.parse(fs.readFileSync(path.join(here, 'snapshots/33-handoff.json'), 'utf8'));
const seq = (lab, k = 0) => D.sequence.filter((r) => r[0] === lab)[k];

// ------------------------------------------------------------------ snapshots
test('earlier modules\' kernels and data are byte-identical to their committed files; every sidecar hash matches', () => {
  const origin = {
    'mixture.js': '../31-mixture/mixture.js', 'thermo-excerpt.js': '../31-mixture/snapshots/thermo-excerpt.js', 'propellant-densities.js': '../31-mixture/snapshots/propellant-densities.js',
    'mixture-presets.js': '../31-mixture/presets.js', 'bell.js': '../32-bell/bell.js', 'isa.js': '../32-bell/snapshots/isa.js', 'nozzle-charts.js': '../32-bell/snapshots/nozzle-charts.js',
    'nozzle-rules.js': '../32-bell/snapshots/nozzle-rules.js', 'sp8120-table1.js': '../32-bell/snapshots/sp8120-table1.js', 'engine.js': '../33-engine-deck/engine.js',
    'turbo-data.js': '../33-engine-deck/snapshots/turbo-data.js', '33-handoff.json': '../33-engine-deck/handoff.json',
  };
  for (const [f, o] of Object.entries(origin)) {
    const p = path.join(here, 'snapshots', f), q = path.join(here, o);
    if (fs.existsSync(q)) assert.equal(sha(p), sha(q), f + ' differs from ' + o);
  }
  for (const f of fs.readdirSync(path.join(here, 'snapshots')).filter((x) => !x.endsWith('.provenance.json'))) {
    const side = JSON.parse(fs.readFileSync(path.join(here, 'snapshots', f + '.provenance.json'), 'utf8'));
    for (const k of ['repo', 'path', 'commit']) assert.ok(side[k], f + ' sidecar lacks ' + k);
    assert.equal(side.writtenSha256, sha(path.join(here, 'snapshots', f)), f + ' sidecar hash');
  }
});

// ------------------------------------------------------------------ the transcription checks itself three ways
test('AS-512 Table 16-9: every kg agrees with the report\'s own lbm, every running total with the rows above it', () => {
  let n = 0;
  for (const [lab, kg, lb] of D.sequence) {
    if (lb == null) continue;
    n++;
    assert.ok(Math.abs(kg / LBM - lb) <= Math.max(2.5, 1e-6 * Math.abs(lb)), `${lab}: ${kg} kg is ${(kg / LBM).toFixed(1)} lbm, printed ${lb}`);
  }
  assert.ok(n >= 70, 'lbm checked on ' + n + ' rows');
  // components at ignition
  near(D.sequence.slice(0, 7).reduce((a, r) => a + r[1], 0), seq('1ST FLT STG AT IGN')[1], 3, 'components sum to the ignition mass');
  let run = null, totals = 0;
  for (const [lab, kg] of D.sequence.slice(7)) {
    if (/FLT STG/.test(lab)) { if (run != null) { near(kg, run, 6, lab + ' running total'); totals++; } run = kg; } else run += kg;
  }
  assert.equal(totals, 18);
});
test('AS-512 stage tables (16-1, 16-3, 16-5, 16-7) agree with Table 16-9, and the trajectory tables with their own feet', () => {
  const T = D.stageTables;
  const pairs = [[T['S-IC'].events['holddown arm release'].vehicle, '1ST FLT STG AT HDAR'], [T['S-IC'].events['outboard engine cutoff'].vehicle, '1ST FLT STG AT OECO'],
    [T['S-II'].events['S-II ignition'].vehicle, '2ND FLT STG AT IGN'], [T['S-II'].events['S-II mainstage'].vehicle, '2ND FLT STG AT MS'], [T['S-II'].events['S-II engine cutoff'].vehicle, '2ND FLT STG AT COS'],
    [T['S-IVB burn 1'].events['S-IVB ignition'].vehicle, '3RD FLT STG 1ST IGN'], [T['S-IVB burn 1'].events['S-IVB mainstage'].vehicle, '3RD FLT STG 1ST MS'], [T['S-IVB burn 1'].events['S-IVB engine cutoff'].vehicle, '3RD FLT STG 1ST COS'],
    [T['S-IVB burn 2'].events['S-IVB ignition'].vehicle, '3RD FLT STG 2ND IGN'], [T['S-IVB burn 2'].events['S-IVB mainstage'].vehicle, '3RD FLT STG 2ND MS'], [T['S-IVB burn 2'].events['S-IVB engine cutoff'].vehicle, '3RD FLT STG 2ND COS']];
  for (const [a, lab] of pairs) near(a, seq(lab)[1], 1, lab);
  // ignition column of Table 16-1 sums (with its other seven rows, 2445 kg, in the snapshot since review) to its total
  const ig = T['S-IC'].events['ground ignition'];
  assert.equal(ig.otherRows.length, 7);
  near(ig.dry + ig.lox[0] + ig.lox[1] + ig.fuel[0] + ig.fuel[1] + ig.otherRows.reduce((a, r) => a + r[1], 0), ig.stage, 6, 'Table 16-1 ignition column');
  // Table 4-2's C3 at the S-IVB second cutoff: m^2/s^2 against ft^2/s^2, and ACTUAL = NOMINAL + ACT-NOM in both units
  const c3 = D.c3AtSivb2Gcs;
  for (const k of ['actual', 'nominal', 'difference']) near(c3[k][0] / (FT * FT), c3[k][1], 1, 'C3 ' + k + ' m^2 vs ft^2');
  for (const i of [0, 1]) assert.equal(c3.nominal[i] + c3.difference[i], c3.actual[i], 'C3 actual = nominal + difference');
  for (const [k, row] of Object.entries(D.cutoff)) near(row[2] / FT, row[3], 0.06, k + ' m/s vs ft/s');
  for (const [k, row] of Object.entries(D.acceleration)) { near(row[1] / FT, row[2], 0.006, k + ' m/s^2 vs ft/s^2'); near(row[1] / g0, row[3], 0.006, k + ' g'); }
  near(D.parkingOrbit.velocity / FT, D.parkingOrbit.velocityFt, 0.06, 'parking orbit velocity');
  // event times agree between Table 2-2 and Table 4-2
  assert.equal(D.events.sicOeco, D.cutoff.sicOeco[0]); assert.equal(D.events.siiCeco, D.cutoff.siiCeco[0]); assert.equal(D.events.siiOeco, D.cutoff.siiOeco[0]);
});
test('the prose and S-IVB table numbers are in the PDF\'s own text layer (as512-sources.txt)', () => {
  const src = fs.readFileSync(path.join(here, 'snapshots/as512-sources.txt'), 'utf8');
  for (const s of ['1.156.694 lbf', '2743.4', '421.6 lbf-s', 'S-II burn duration was 396.1 seconds', 'first burn time was 138.8 seconds', 'burn time was 351.0 seconds',
    '205,797', '427.7', '401.26', '79.96', '5.018', '205,608', '427.6', '400.95', '79.91', 'at 139.30', 'at 161.20 seconds', '787,009 lbf'])
    assert.ok(src.includes(s), 'missing from the text layer: ' + s);
  // the text layer misreads the S-IVB first burn time on PDF page 103 as 133.8; the rendered page and the arithmetic say 138.8
  assert.ok(src.includes('The first burn time was 133.8 seconds'));
  near(D.events.sivbFirstEco - D.events.sivbIgnitionStdv, D.engines.sivbFirstBurn.burnTimeS, 0.1, 'first burn time from STDV open');
  near(D.events.siiOeco - D.events.siiEsc, D.engines.siiStageEsc61.burnDurationS, 0.1, 'S-II burn from ESC');
});

// ------------------------------------------------------------------ closed forms
const eng1 = { id: 'x', thrustVac: 1e6, thrustSL: 9e5, mdot: 300, ispVac: 1e6 / 300, ispSL: 9e5 / 300, ispVacUpper: null, mixtureRatio: 2.5, rhoOx: 1141, rhoFuel: 810 };
const one = (burn, extra = {}) => Object.assign({ id: 't', payload: { mass: 1000 }, stages: [Object.assign({ label: 'A', engine: 'x', count: 4, dry: 5000, remaining: 0, burns: [Object.assign({ propellant: 60000, shed: 0, coast: 0, jettisons: [], engineOut: [] }, burn)] }, extra)] });
test('closed forms: Tsiolkovsky, burn time, an engine shut down early, a jettison mid-burn', () => {
  const c = 1e6 / 300;
  let r = S.evaluate(one({}), { x: eng1 });
  close(r.dv, c * Math.log(66000 / 6000), 1e-14, 'single burn');
  close(r.stages[0].burnTime, 60000 / (4 * 300), 1e-14, 'burn time');
  close(r.liftoff.tw, 4 * 9e5 / (66000 * g0), 1e-14, 'liftoff T/W');
  close(r.dvSL, (9e5 / 300) * Math.log(66000 / 6000), 1e-14, 'first stage at sea-level Isp');
  close(r.stages[0].volumeOx, 60000 * 2.5 / 3.5 / 1141, 1e-14, 'oxidizer volume'); close(r.stages[0].volumeFuel, 60000 / 3.5 / 810, 1e-14, 'fuel volume');
  // engine out at 20 s: same delta-v, time te + (P - n mdot te) / ((n - 1) mdot)
  r = S.evaluate(one({ engineOut: [{ t: 20, count: 1 }] }), { x: eng1 });
  close(r.dv, c * Math.log(66000 / 6000), 1e-14, 'engine-out leaves delta-v');
  close(r.stages[0].burnTime, 20 + (60000 - 4 * 300 * 20) / (3 * 300), 1e-14, 'engine-out time');
  assert.equal(r.stages[0].burns[0].nCutoff, 3);
  // an engine cutoff scheduled after the propellant is gone is ignored (and said so)
  r = S.evaluate(one({ engineOut: [{ t: 60, count: 1, label: 'Late cutoff' }] }), { x: eng1 });
  close(r.stages[0].burnTime, 50, 1e-14, 'a cutoff after burnout changes nothing'); assert.match(r.warnings[0].reason, /comes after this burn ends/);
  // jettison of 2000 kg at 10 s
  r = S.evaluate(one({ jettisons: [{ t: 10, mass: 2000 }] }, { dry: 3000 }), { x: eng1 });
  const m1 = 66000 - 12000;
  close(r.dv, c * (Math.log(66000 / m1) + Math.log((m1 - 2000) / (66000 - 60000 - 2000))), 1e-14, 'jettison segments');
  // shed at the start and coast between burns: lost without thrust
  r = S.evaluate(one({ shed: 500, coast: 700, propellant: 30000 }, { burns: [{ propellant: 30000, shed: 500, coast: 700 }, { propellant: 20000, shed: 0 }] }), { x: eng1 });
  const a0 = 1000 + 5000 + 30000 + 500 + 700 + 20000;
  close(r.liftoff.mass, a0, 1e-15, 'ledger'); close(r.dv, c * (Math.log((a0 - 500) / (a0 - 30500)) + Math.log((a0 - 31200) / (a0 - 51200))), 1e-14, 'two burns with shed and coast');
  close(r.finalMass, 1000, 1e-12, 'what is left after the last separation is the payload');
});
test('independent integration: a fixed-step RK4 of dv/dt = nF/m, dm/dt = -n mdot through AS-512\'s events reproduces the closed form', () => {
  const veh = S.fromAS512(D), r = S.evaluate(veh, ENG);
  let m = r.liftoff.mass;
  veh.stages.forEach((s, si) => {
    const e = ENG[s.engine];
    s.burns.forEach((b, bi) => {
      m -= b.shed;
      const evs = [...b.jettisons.map((j) => ({ t: j.t, j: j.mass })), ...b.engineOut.map((o) => ({ t: o.t, o: o.count }))].sort((x, y) => x.t - y.t);
      let n = s.count, t = 0, v = 0, P = b.propellant;
      const step = (dt) => { // RK4 on (v, m); the mass is linear but the scheme does not know that
        const f = (mm) => [n * e.thrustVac / mm, -n * e.mdot];
        const k1 = f(m), k2 = f(m + dt / 2 * k1[1]), k3 = f(m + dt / 2 * k2[1]), k4 = f(m + dt * k3[1]);
        v += dt / 6 * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]); m += dt / 6 * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]); P -= n * e.mdot * dt; t += dt;
      };
      const run = (tEnd) => { const N = Math.max(50, Math.ceil((tEnd - t) / 0.5)), h = (tEnd - t) / N; for (let i = 0; i < N; i++) step(h); };
      for (const ev of evs) { if (n * e.mdot * (ev.t - t) >= P) break; run(ev.t); if (ev.j) m -= ev.j; if (ev.o) n -= ev.o; }
      run(t + P / (n * e.mdot));
      const R = r.stages[si].burns[bi];
      close(v, R.dv, 1e-9, s.label + ' burn ' + (bi + 1) + ' delta-v');
      close(t, R.time, 1e-12, s.label + ' burn ' + (bi + 1) + ' time');
      close(m, R.mCutoff, 1e-12, s.label + ' cutoff mass');
      m -= b.coast;
    });
    m -= s.dry + s.remaining;
  });
  close(m, veh.payload.mass, 1e-9, 'payload at the end');
});
test('simplify() conserves mass and cannot add delta-v; payload solve round-trips; delta-v falls as payload rises', () => {
  const veh = S.fromAS512(D), a = S.evaluate(veh, ENG), b = S.evaluate(S.simplify(veh), ENG);
  close(b.liftoff.mass, a.liftoff.mass, 1e-15, 'mass conserved');
  assert.ok(b.dv < a.dv, 'carrying the jettisoned interstage and escape tower costs delta-v');
  near(a.dv - b.dv, 93.9, 0.5, 'flight events are worth 94 m/s on AS-512');
  const tgt = a.dv - 500, s = S.solvePayload(veh, ENG, tgt);
  near(S.evaluate(S.withPayload(veh, s.payload), ENG).dv, tgt, 1e-3, 'solved payload gives the target');
  const sw = S.sweepPayload(veh, ENG, 200000, 11);
  for (let i = 1; i < sw.length; i++) assert.ok(sw[i].dv < sw[i - 1].dv);
  const no = S.solvePayload(veh, ENG, a.dv * 2);
  assert.equal(no.refusal.code, 'out_of_envelope'); assert.match(no.refusal.reason, /Even with no payload/);
});

// ------------------------------------------------------------------ engines: idea 33's, unmodified, against flight
test('engine records are idea 33\'s numbers (per chamber x chambers) and the F-1 matches AS-512\'s Table 5-2', () => {
  const s = E.engineSpec('F-1'), v = E.point(s.context, s.spec.pc, 0), sl = E.point(s.context, s.spec.pc, 101325);
  close(ENG['F-1'].thrustVac, v.Fvac, 1e-15, 'vacuum thrust is idea 33\'s'); close(ENG['F-1'].thrustSL, sl.F, 1e-15, 'sea-level thrust is idea 33\'s');
  const lr = S.engineFromPreset('LR89-NA-7'), ls = E.engineSpec('LR89-NA-7');
  const lv = E.point(ls.context, ls.spec.pc, 0);
  assert.equal(lr.chambers, 2); close(lr.thrustSL, 2 * E.point(ls.context, ls.spec.pc, 101325).F, 1e-15, 'two chambers');
  close(lr.thrustVac, 2 * lv.Fvac, 1e-15, 'two chambers in vacuum'); close(lr.exitArea, 2 * lv.Ae, 1e-15, 'two exit areas');
  near(lr.thrustSL / LBF, 330000, 1, 'LR89-NA-7 pair at SP-8120\'s 330 000 lbf');
  const X = D.engines.f1StandardSeaLevel, mean = (a) => a.reduce((x, y) => x + y) / a.length;
  near(ENG['F-1'].thrustSL / (mean(X.thrustKlbf) * 1000 * LBF) - 1, 0.00141, 0.0001, 'F-1 thrust +0.14 %');
  near(ENG['F-1'].mdot / (mean(X.flowLbmS) * LBM) - 1, 0.00029, 0.0001, 'F-1 flow +0.03 %');
  near(ENG['F-1'].ispSL / (mean(X.ispS) * g0) - 1, 0.00113, 0.0001, 'F-1 Isp +0.11 % (idea 33\'s lower bound)');
  assert.ok(ENG['F-1'].ispSLUpper / (mean(X.ispS) * g0) - 1 > 0.02, 'the upper bound is 2.8 % off: the lower bound is the F-1\'s');
  assert.equal(ENG['J-2'].thrustSL, null); assert.equal(ENG['J-2'].refusals[0].applies_to, 'thrust_sea_level');
  near(ENG['J-2'].mixtureRatio, 5.3016, 0.0001, 'J-2 engine-level mixture ratio (gas generator draws fuel-rich)');
});
test('AS-512 against its flight report: the gaps, pinned', () => {
  const fc = S.flightCheck(D, ENG), g = Object.fromEntries(fc.rows.map((x) => [x.label, x]));
  const pin = (lab, want, tol) => near(g[lab].gap, want, tol, lab);
  for (const lab of ['Liftoff (holddown release)', 'S-IC outboard cutoff', 'S-II outboard cutoff', 'S-IVB first cutoff', 'S-IVB second cutoff']) near(g[lab].model, g[lab].flight, 30, lab + ' mass (kg)');
  pin('J-2 vacuum thrust, S-II high-EMR phase', -0.00579, 0.0001); pin('J-2 mass flow, S-II', -0.00848, 0.0001); pin('J-2 Isp, S-II', 0.00278, 0.0001);
  pin('J-2 vacuum thrust, S-IVB', 0.1176, 0.0005); pin('J-2 mass flow, S-IVB', 0.1305, 0.0005); pin('J-2 Isp, S-IVB', -0.01152, 0.0001);
  pin('S-IC, holddown release to outboard cutoff', 0.0243, 0.0005);
  // review: the burn-time gap as a flow, 2,076,017 kg over 5 x 139.06 + 4 x 21.90 engine-seconds = 2651.70 kg/s
  near(g['F-1 flow, flight average over the S-IC burn'].flight, 2076017 / (5 * (139.30 - 0.24) + 4 * (161.20 - 139.30)), 1e-9, 'flight-average F-1 flow by hand');
  pin('F-1 flow, flight average over the S-IC burn', -0.01959, 0.0001);
  // by hand from the report's rows: Table 16-9's 2,076,017 kg mainstage, five F-1s until 139.30 - 0.24 s, then four
  const tc = 139.30 - 0.24, md = ENG['F-1'].mdot;
  close(g['S-IC, holddown release to outboard cutoff'].model, tc + (2076017 - 5 * md * tc) / (4 * md), 1e-12, 'S-IC burn time by hand'); pin('S-II, mainstage to outboard cutoff', -0.0289, 0.0005);
  pin('S-IVB first burn, mainstage to cutoff', -0.1152, 0.0005); pin('S-IVB second burn, mainstage to cutoff', -0.1416, 0.0005);
  pin('S-IC at outboard cutoff (4 engines, 66.5 km)', -0.02435, 0.0005);
  // review: by hand, four F-1s at the 1976 atmosphere's pressure at 66.5 km over 2,917,816 - 2,076,017 - 1,807 kg
  const pa665 = L.pf.isa(66500).P_Pa;
  assert.ok(pa665 > 5 && pa665 < 15, 'about 9 Pa at 66.5 km');
  close(g['S-IC at outboard cutoff (4 engines, 66.5 km)'].model, 4 * (ENG['F-1'].thrustVac - pa665 * ENG['F-1'].exitArea) / (2917816 - 2076017 - 1807), 1e-12, 'S-IC cutoff acceleration by hand'); pin('S-II just before centre cutoff (5 engines)', -0.0101, 0.0005);
  pin('S-IVB at first cutoff', 0.1101, 0.0005); pin('S-IVB at second cutoff', 0.1233, 0.0005);
  pin('S-IC fuel volume at the engine\'s mixture ratio', 0.01365, 0.0001); pin('S-II fuel volume at the engine\'s mixture ratio', -0.00646, 0.0001); pin('S-IVB fuel volume at the engine\'s mixture ratio', -0.1316, 0.0001);
  near(g['S-II burn: ideal delta-v vs space-fixed gain'].gap, 411.6, 1, 'S-II loss'); near(g['S-IVB first burn: ideal vs gain'].gap, -11.9, 1, 'S-IVB first');
  near(g['S-IVB second burn: ideal vs gain'].gap, 81.8, 1, 'S-IVB second');
  // at the flight's own Isp (Table 7-1) the ledger reproduces the S-IVB first burn's velocity gain to 0.3 %
  near(g['S-IVB first burn at the flight\'s Isp'].gap, -2.6, 1, 'ledger at flight Isp');
  const r = fc.result;
  near(r.dv, 12299.7, 0.2, 'total ideal delta-v'); near(r.liftoff.tw, 1.1830, 0.0001, 'liftoff T/W');
  near(r.stages[0].dv, 3722.4, 0.1, 'S-IC'); near(r.stages[1].dv, 4654.8, 0.1, 'S-II'); near(r.stages[2].dv, 3922.6, 0.1, 'S-IVB');
});

// ------------------------------------------------------------------ import from idea 33
test('idea 33\'s committed handoff imports, re-computes to 1e-8, and edited or foreign ones are refused', () => {
  const r = S.engineFromHandoff(H33);
  assert.ok(r.record, r.refusal && r.refusal.reason);
  for (const [k, mine] of [['thrust_vacuum', r.record.thrustVac], ['mass_flow', r.record.mdot], ['specific_impulse_vacuum', r.record.ispVac], ['thrust_sea_level', r.record.thrustSL]]) close(mine, H33.outputs[k].value, 1e-8, k);
  assert.equal(r.record.mode, 'shifting');
  near(r.record.thrustSL, 1e6, 1e-3, 'idea 32 sized it for 1 MN at sea level');
  const ed = JSON.parse(JSON.stringify(H33)); ed.outputs.mass_flow.value *= 1.001;
  const x = S.engineFromHandoff(ed); assert.equal(x.refusal.code, 'invalid_input'); assert.match(x.refusal.reason, /mass_flow/);
  assert.equal(S.engineFromHandoff(H33.inputs.nozzle_handoff).refusal.code, 'insufficient_data');
  assert.equal(S.engineFromHandoff(H33.inputs.nozzle_handoff.inputs.chamber_handoff).refusal.code, 'insufficient_data');
  assert.equal(S.engineFromHandoff('{not json').refusal.code, 'invalid_input');
  assert.equal(S.engineFromHandoff(Object.assign({}, H33, { from: '99-other' })).refusal.code, 'invalid_input');
  const noThroat = JSON.parse(JSON.stringify(H33)); noThroat.inputs.engine.throat_area_m2 = null;
  assert.equal(S.engineFromHandoff(noThroat).refusal.code, 'insufficient_data');
});

// ------------------------------------------------------------------ refusals
test('refusals: a vacuum engine on the pad, a stack that cannot lift off, impossible masses, an unknown engine', () => {
  const E2 = { 'J-2': ENG['J-2'], 'F-1': ENG['F-1'] };
  const base = { id: 't', payload: { mass: 10000 }, stages: [{ label: 'A', engine: 'J-2', count: 5, dry: 40000, remaining: 0, burns: [{ propellant: 400000 }] }] };
  let r = S.evaluate(base, E2);
  assert.ok(r.ok); assert.equal(r.refusals[0].applies_to, 'liftoff'); assert.match(r.refusals[0].reason, /separates at sea level/);
  r = S.evaluate(Object.assign({}, base, { payload: { mass: 400000 }, stages: [Object.assign({}, base.stages[0], { engine: 'F-1', count: 1 })] }), E2);
  assert.match(r.refusals[0].reason, /does not leave the pad/); assert.ok(r.liftoff.tw < 1);
  const bad = (st, code, re) => { const x = S.evaluate(Object.assign({}, base, { stages: [Object.assign({}, base.stages[0], { engine: 'F-1' }, st)] }), E2); assert.equal(x.ok, false); assert.equal(x.refusals[0].code, code); if (re) assert.match(x.refusals[0].reason, re); };
  bad({ dry: 0 }, 'out_of_envelope', /no dry mass/); bad({ dry: -1 }, 'invalid_input'); bad({ count: 0 }, 'invalid_input'); bad({ count: 2.5 }, 'invalid_input');
  bad({ engine: 'RS-25' }, 'not_found'); bad({ burns: [{ propellant: 0 }] }, 'invalid_input'); bad({ burns: [{ propellant: 1e5, engineOut: [{ t: 10, count: 5 }] }] }, 'invalid_input', /all 5 engines/);
  assert.equal(S.evaluate(Object.assign({}, base, { payload: { mass: NaN } }), E2).refusals[0].applies_to, 'payload');
  // a jettison after burnout is carried to separation and said so; the ledger still closes
  r = S.evaluate(Object.assign({}, base, { stages: [Object.assign({}, base.stages[0], { engine: 'F-1', burns: [{ propellant: 400000, jettisons: [{ t: 1e4, mass: 1000, label: 'Fairing' }] }] })] }), E2);
  assert.match(r.warnings[0].reason, /carried to separation/); close(r.finalMass, 10000, 1e-12, 'ledger with a late jettison');
  assert.equal(S.engineFromPreset('YLR113-AJ-1').refusal.code, 'not_found');
  assert.equal(S.solvePayload(base, E2, -5).refusal.code, 'invalid_input');
});

// ------------------------------------------------------------------ handoff
test('handoff.json is what the kernel computes; every output is complete; it round-trips and carries idea 33\'s handoff', async () => {
  const { sample } = await import(path.join(here, 'build-sample.mjs'));
  const h = JSON.parse(fs.readFileSync(path.join(here, 'handoff.json'), 'utf8'));
  assert.deepEqual(JSON.parse(JSON.stringify(sample(H33).handoff)), h);
  assert.equal(h.from, '34-stack'); assert.equal(h.version, 1);
  for (const [k, o] of Object.entries(h.outputs)) for (const f of ['value', 'units', 'confidence', 'source']) assert.ok(o[f] != null && o[f] !== '', k + ' lacks ' + f);
  assert.ok(!/NaN|undefined/.test(JSON.stringify(h)), 'no NaN or undefined anywhere');
  const imp = h.inputs.engines['imported:imported'];
  assert.deepEqual(imp.engine_handoff, H33, 'idea 33\'s handoff travels whole');
  assert.deepEqual(h.inputs.engines['J-2'].recompute, { kernel: '33-engine-deck/engine.js', engineSpec: 'J-2', cycleReference: 'J-2' });
  assert.ok(h.refusals.some((r) => r.applies_to === 'losses')); assert.ok(h.refusals.some((r) => r.applies_to === 'engine_dry_mass' && r.from === '33-engine-deck'));
  const p = S.parseHandoff(h);
  const r2 = S.evaluate(p.vehicle, p.engines);
  close(r2.dv, h.outputs.delta_v_ideal.value, 1e-12, 'round trip delta-v');
  // pinned by an independent Python recompute in review (from the report's rows and idea 33's committed outputs)
  near(h.outputs.delta_v_ideal.value, 10733.07, 0.01, 'sample delta-v'); near(h.outputs.liftoff_thrust_to_weight.value, 1.28321, 0.00001, 'sample T/W'); near(h.outputs.liftoff_mass.value, 556263.4, 0.1, 'sample liftoff mass');
  const asH = S.makeHandoff(S.fromAS512(D), ENG, S.evaluate(S.fromAS512(D), ENG), { produced: 'x' });
  assert.equal(asH.outputs.liftoff_mass.confidence, 'measured'); assert.match(asH.assumptions.join(' '), /launch escape system jettison time is not in the report/);
});

// ------------------------------------------------------------------ added in independent review
test('review: the payload solve refuses a payload the stack cannot lift, and says the most it can; T/W of exactly 1 is refused', () => {
  const veh = S.fromAS512(D);
  const r = S.solvePayload(veh, ENG, 5000);
  assert.equal(r.refusal && r.refusal.code, 'out_of_envelope', 'a 5 km/s target asks for 674 t, which does not lift off');
  assert.match(r.refusal.reason, /does not leave the pad/);
  // the most it lifts is where liftoff thrust equals liftoff weight: 5 F-1s at sea level / g0 less the empty stack
  const empty = S.evaluate(S.withPayload(veh, 0), ENG, { timeline: false });
  close(r.maxLiftoffPayload, 5 * ENG['F-1'].thrustSL / g0 - empty.liftoff.mass, 1e-12, 'max liftoff payload, closed form');
  close(r.dvAtMaxLiftoffPayload, S.evaluate(S.withPayload(veh, r.maxLiftoffPayload), ENG).dv, 1e-12, 'its delta-v');
  assert.ok(r.dvAtMaxLiftoffPayload > 5000);
  const ok = S.solvePayload(veh, ENG, 9177);
  assert.ok(ok.payload > 0 && !ok.refusal && ok.liftoffRefused === false);
  // a stack exactly at thrust-to-weight 1 is refused, a hair above it is not
  const at1 = Object.assign({}, eng1, { thrustSL: (66000 * g0) / 4 });
  assert.match(S.evaluate(one({}), { x: at1 }).refusals[0].reason, /does not leave the pad/);
  assert.equal(S.evaluate(one({}), { x: Object.assign({}, at1, { thrustSL: at1.thrustSL * (1 + 1e-9) }) }).refusals.length, 0);
});
test('review: an idea 33 handoff without engine-level outputs is insufficient data (not "edited"); deck stays in its throttle range', () => {
  const noCyc = JSON.parse(JSON.stringify(H33));
  for (const k of ['thrust_vacuum', 'mass_flow', 'specific_impulse_vacuum', 'specific_impulse_vacuum_upper', 'gas_generator_flow', 'thrust_sea_level', 'specific_impulse_sea_level']) delete noCyc.outputs[k];
  noCyc.inputs.engine.cycle_reference = null;
  let x = S.engineFromHandoff(noCyc);
  assert.equal(x.refusal.code, 'insufficient_data'); assert.match(x.refusal.reason, /no cycle/);
  noCyc.inputs.engine.cycle_reference = 'SSME (EPL)';
  noCyc.refusals.push({ applies_to: 'engine_level', code: 'out_of_envelope', reason: 'Engine-level flow and Isp need the cycle, which is refused: test.' });
  x = S.engineFromHandoff(noCyc);
  assert.equal(x.refusal.code, 'insufficient_data'); assert.match(x.refusal.reason, /idea 33 refused it/);
  const narrow = JSON.parse(JSON.stringify(H33)); narrow.inputs.engine.throttle = { min: 0.6, max: 1, nominal: 1 };
  const rec = S.engineFromHandoff(narrow).record;
  assert.deepEqual(rec.deckVac.throttle, [0.6, 0.8, 1]);
  assert.deepEqual(S.engineFromHandoff(H33).record.deckVac.throttle, [0.4, 0.6, 0.8, 1, 1.1]);
});
test('review: a 34-stack handoff is refused when its engines or outputs were edited; an edited AS-512 is not "measured"', () => {
  const veh = S.fromAS512(D), h = JSON.parse(JSON.stringify(S.makeHandoff(veh, ENG, S.evaluate(veh, ENG), { produced: 'x' })));
  assert.equal(S.parseHandoff(h, D).vehicle.id, 'AS-512');
  const a = JSON.parse(JSON.stringify(h)); a.outputs.delta_v_ideal.value += 1;
  assert.equal(S.parseHandoff(a).refusal.code, 'invalid_input'); assert.match(S.parseHandoff(a).refusal.reason, /delta_v_ideal/);
  const b = JSON.parse(JSON.stringify(h)); b.inputs.engines['J-2'].mass_flow_kg_s *= 1.001;
  assert.match(S.parseHandoff(b).refusal.reason, /J-2\.mass_flow_kg_s/);
  const c = JSON.parse(JSON.stringify(h)); c.inputs.vehicle.stages[0].dry += 1000;
  const rc = S.evaluate(c.inputs.vehicle, ENG);
  c.outputs.liftoff_mass.value = rc.liftoff.mass; c.outputs.delta_v_ideal.value = rc.dv; c.outputs.burn_time_total.value = rc.burnTime;
  const pc = S.parseHandoff(c, D);
  assert.equal(pc.vehicle.id, 'imported', 'masses not the report\'s: not AS-512');
  assert.equal(S.makeHandoff(pc.vehicle, pc.engines, S.evaluate(pc.vehicle, pc.engines), {}).outputs.liftoff_mass.confidence, 'assumed');
  const sv = S.simplify(veh), hs = JSON.parse(JSON.stringify(S.makeHandoff(sv, ENG, S.evaluate(sv, ENG), {})));
  assert.equal(S.parseHandoff(hs, D).vehicle.id, 'AS-512', 'events off is still the report\'s masses');
  // two jettisons at one instant make no zero-length segment for module 35
  for (const st of h.outputs.stages.value) for (const bn of st.burns) for (const g of bn.segments) assert.ok(g.t1_s - g.t0_s > 1e-6, st.label + ' segment of zero length');
  assert.equal(h.outputs.stages.value[1].burns[0].segments.length, 3, 'S-II: to the jettisons, to the centre cutoff, to depletion');
  assert.equal(h.outputs.stages.value[1].burns[0].segments[0].t1_s, D.events.siiAftInterstageJettison - D.stageTables['S-II'].events['S-II mainstage'].t, 'segment ends on the event time');
});
test('review: an inert fraction scales back to its own stage (dryForFraction inverts inertFractions)', () => {
  const veh = S.fromAS512(D), f = S.inertFractions(D);
  veh.stages.forEach((s, i) => close(S.dryForFraction(S.stagePropellant(s), f[i].value), s.dry + s.remaining, 1e-12, s.label));
  // and by hand from Table 16-9's rows: S-II dropped 45,560 kg against 449,797 kg burned
  close(f[1].value, 45560 / (45560 + 449797), 1e-12, 'S-II inert fraction by hand');
});
