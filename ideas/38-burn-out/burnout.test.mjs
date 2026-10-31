// Burn Out (idea 38) tests. Run from the bank root: node --test ideas/38-burn-out/burnout.test.mjs
// Oracles: oracle/oracle.json (scipy DOP853 and SLSQP, oracle/burn_oracle.py), the AS-512 flight report (Tables 2-2,
// 4-1, 4-2, 4-5, 7-2, 16-7, sections 7.6-7.9), closed forms and limits, and idea 37's own kernel.
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
const B = L.B, W = L.W, DEG = Math.PI / 180;
const ORACLE = JSON.parse(fs.readFileSync(path.join(here, 'oracle', 'oracle.json'), 'utf8'));
const CASES = JSON.parse(fs.readFileSync(path.join(here, 'oracle', 'cases.json'), 'utf8'));
const H37_SAMPLE = JSON.parse(fs.readFileSync(path.join(here, '..', '37-window', 'handoff.json'), 'utf8'));
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''}: ${a} vs ${b} (tol ${tol})`);
const rel = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol * Math.abs(b), `${msg || ''}: ${a} vs ${b} (rel ${tol})`);
const ST = B.importWindow(L.WIN);
const solveWin = (set) => B.compute({ window: ST }, Object.assign(B.defaults(), { sweep: false }, set || {}));
const planarSpec = (c) => ({ altitudeKm: (c.r0 - B.constants.RE) / 1000, inclinationDeg: 0, c3: c.c3, inertKg: c.m0 * 0.1, propellantKg: c.m0 * 0.9, payloadKg: 0, thrustN: c.F, veMS: c.F / c.mdot, j2: false });

test('snapshots: idea 37\'s kernel and data byte-identical to the committed files; every sidecar\'s hash; the AS-512 handoff is what idea 37 computes', async () => {
  const pairs = [['window.js', 'window.js'], ...['erfa-iau2006.js', 'naif-time-gravity.js', 'aster-constants.js', 'apollo17-window.js', 'earth.js', 'as512-flight.js'].map((f) => [f, 'snapshots/' + f])];
  for (const [mine, theirs] of pairs) assert.deepEqual(fs.readFileSync(path.join(here, 'snapshots', mine)), fs.readFileSync(path.join(here, '..', '37-window', theirs)), mine);
  for (const f of fs.readdirSync(path.join(here, 'snapshots')).filter((x) => x.endsWith('.provenance.json'))) {
    const p = JSON.parse(fs.readFileSync(path.join(here, 'snapshots', f), 'utf8'));
    assert.ok(p.repo && p.path && p.commit, f);
    const body = fs.readFileSync(path.join(here, 'snapshots', f.replace('.provenance.json', '')));
    if (p.writtenSha256) assert.equal(crypto.createHash('sha256').update(body).digest('hex'), p.writtenSha256, f);
  }
  const { window37Default, asScript } = await import(path.join(here, 'build-data.mjs'));
  assert.equal(fs.readFileSync(path.join(here, 'snapshots', 'window-as512-apophis.js'), 'utf8'), asScript(window37Default()), 'window-as512-apophis.js is idea 37\'s page default');
});

test('idea 37\'s kernel as created here (constants only) gives what idea 37\'s own instance gives', () => {
  const L37 = require(path.join(here, '..', '37-window', 'load.cjs')), W37 = L37.W;
  assert.deepEqual(W.constants, W37.constants);
  for (const r of [[7e6, 1e5, 2e6], [-4e6, 5e6, -3e6], [1e6, -2e6, 6.6e6]]) assert.deepEqual(W.accel(r, true), W37.accel(r, true));
  const y = [6.6e6, 0, 0, 0, 7.6e3, 1e3];
  assert.deepEqual(W.rk4(y, 10, true), W37.rk4(y, 10, true));
  const ms = Date.parse('2026-07-02T02:50:50.479Z');
  assert.deepEqual(W.orient(ms).P, W37.orient(ms).P);
  assert.deepEqual(B.constants.MU, L.EARTH.mu_m3_s2);
});

test('import: idea 37\'s committed sample and its AS-512 default re-check without the earlier kernels; edits refused', () => {
  for (const [name, h] of [['sample', H37_SAMPLE], ['as512', L.WIN]]) {
    const st = B.importWindow(h);
    assert.ok(!st.refusal, name + ': ' + (st.refusal && st.refusal.reason));
    assert.ok(st.check.coastMiss_m < 1e-6 && st.check.coastMiss_m_s < 1e-9, name + ' coast re-flown lands on the departure point');
    assert.equal(st.eng.label, 'J-2');
    rel(st.inert + st.mp + st.payload, st.mIns, 1e-12, name + ' masses');
  }
  assert.equal(ST.payload, 50637); // idea 34's AS-512 payload (Table 16-7, vehicle less S-IVB at second cutoff)
  const edit = (f) => { const h = JSON.parse(JSON.stringify(L.WIN)); f(h); return B.importWindow(h); };
  const cases = [
    ['departure point moved 10 m', (h) => { h.outputs.departure_point.value.r_m[0] += 10; }],
    ['impulsive delta-v changed', (h) => { h.outputs.impulsive_departure.value.delta_v_m_s += 1; }],
    ['asymptote turned', (h) => { const s = h.outputs.asymptote.value.s_hat_j2000; s[0] += 1e-4; const n = Math.hypot(...s); for (let i = 0; i < 3; i++) s[i] /= n; }],
    ['engine thrust changed', (h) => { h.inputs.closed_loop_handoff.inputs.ascent_handoff.inputs.vehicle_handoff.inputs.engines['J-2'].thrust_vacuum_N *= 1.01; }],
    ['propellant above the mass', (h) => { h.outputs.propellant_for_departure.value = 1e7; }],
    ['launch TDB not its UTC', (h) => { h.outputs.launch.value.tdb_s_past_j2000 += 1; }],
    ['coast epoch', (h) => { h.outputs.departure_point.value.tdb_s_past_j2000 += 1; }],
    ['insertion moved 10 m (only the re-flown coast sees it)', (h) => { h.outputs.insertion_state_j2000.value.r_m[1] += 10; }],
  ];
  for (const [what, f] of cases) { const r = edit(f); assert.ok(r.refusal && r.refusal.code === 'invalid_input', what); }
  const noDp = edit((h) => { delete h.outputs.departure_point; });
  assert.equal(noDp.refusal.code, 'insufficient_data');
  assert.equal(noDp.refusal.applies_to, 'departure_point');
  assert.equal(B.importWindow('not json').refusal.code, 'invalid_input');
  assert.match(B.importWindow({ handoff: 'long-way-round', from: '36-closed-loop' }).refusal.reason, /idea 37/);
  assert.match(B.importWindow({ handoff: 'other' }).refusal.reason, /Long Way Round/);
});

test('powered flight: with no thrust the integrator is idea 37\'s coast; mass, rocket equation and the energy cutoff', () => {
  const y = [6.6e6, 1e5, -3e5], v = [-100, 7.7e3, 900];
  const f = B.fly({ t: 0, r: y, v: v, m: 1000 }, [{ dur: Infinity, F: 0, mdot: 0 }], B.steerer('tangential'), { E: null, mFloor: 0, tMax: 600 }, { h: 10, j2: true });
  let c = y.concat(v); for (let i = 0; i < 60; i++) c = W.rk4(c, 10, true);
  near(Math.hypot(f.r[0] - c[0], f.r[1] - c[1], f.r[2] - c[2]), 0, 1e-6, 'zero-thrust flight = idea 37 RK4');
  // constant thrust: mass linear in time; the expended delta-v is ve ln(m0/mf)
  const sc = B.customScenario({ altitudeKm: 200, inclinationDeg: 30, c3: 1e6, inertKg: 2e4, propellantKg: 8e4, payloadKg: 1e4, thrustN: 5e5, veMS: 4400, j2: true }, B.defaults());
  const b = B.burnAt(sc, 0, 'tangential', {});
  near(b.m0 - b.m, 5e5 / 4400 * b.dur, 1e-6, 'mdot x t');
  near(B.dvOf(sc, b), 4400 * Math.log(b.m0 / b.m), 1e-9, 'rocket equation');
  near(2 * B.energyJ2(b.r, b.v), 1e6, 1e-3, 'cutoff on the J2-conserved energy');
  // J2 potential: its gradient is idea 37's J2 acceleration (numerical derivative)
  const r = [5.1e6, -2.3e6, 3.9e6], g = W.accel(r, true), g0 = W.accel(r, false), e = 1;
  for (let i = 0; i < 3; i++) { const rp = r.slice(), rm = r.slice(); rp[i] += e; rm[i] -= e; near(-(B.phiJ2(rp) - B.phiJ2(rm)) / (2 * e), g[i] - g0[i], 1e-9, 'grad phiJ2 ' + i); }
});

test('closed forms and limits: vis-viva impulse; loss falls as (T/W)^-2 at high thrust; the geodetic inverse round-trips idea 37\'s placement', () => {
  const spec = { altitudeKm: 300, inclinationDeg: 0, c3: 10e6, inertKg: 5e3, propellantKg: 6e4, payloadKg: 5e3, thrustN: 1e6, veMS: 4500, j2: false };
  const sc = B.customScenario(spec, B.defaults()), r = B.constants.RE + 300e3, MU = B.constants.MU;
  near(sc.dvImp, Math.sqrt(10e6 + 2 * MU / r) - Math.sqrt(MU / r), 1e-9, 'impulsive from vis-viva');
  const loss = (k) => B.compute({ custom: spec }, Object.assign(B.defaults(), { thrustScale: k, sweep: false, capability: false }), { samples: false }).sol.loss;
  const l1 = loss(1), l2 = loss(2), l4 = loss(4), l8 = loss(8); // T/W 1.46 to 11.7
  near(l1 / l2, 4, 0.02, 'doubling T/W quarters the loss'); near(l2 / l4, 4, 0.01, 'and again'); near(l4 / l8, 4, 0.01, 'and again');
  assert.ok(l8 > 0 && l8 < 0.06, 'vanishes at very high thrust: ' + l8);
  // the geodetic inverse against idea 37's forward placement of Table 4-4 (24.68 N geodetic, 170.5 km)
  const c = W.as512Coast(), g = B.geodetic(c.r0);
  near(g.altitude, 170500, 1e-6, 'altitude'); near(g.latDeg, 24.68, 1e-9, 'latitude');
});

test('oracle, planar: tangential and the optimised law against scipy; the true optimum (16 knots) bounds the law\'s shortfall', () => {
  for (const c of CASES.planar) {
    const o = ORACLE.planar.find((x) => x.id === c.id), spec = planarSpec(c);
    const run = (steering) => B.compute({ custom: spec }, Object.assign(B.defaults(), { steering, sweep: false, capability: false }), { samples: false }).sol;
    const t = run('tangential'), opt = run('optimal');
    near(t.burns[0].dur, o.tangential.tf, 1e-6, c.id + ' tangential burn time (DOP853)');
    near(t.loss, o.tangential.loss, 1e-6, c.id + ' tangential loss');
    near(t.dvImp, o.dv_impulsive, 1e-6, c.id + ' impulsive');
    near(opt.loss, o.linear.loss, 2e-3, c.id + ' optimised linear law (SLSQP)');
    const best = o.optimal[o.optimal.length - 1].loss;
    near(o.optimal[o.optimal.length - 2].loss, best, 0.01, c.id + ' knots converged');
    assert.ok(opt.loss >= best - 1e-3, c.id + ' the law cannot beat the optimum');
    assert.ok(opt.loss - best < 0.6, c.id + ' linear law within 0.6 m/s of the optimum: ' + (opt.loss - best));
    assert.ok(t.loss > opt.loss, c.id + ' tangential costs more');
    // the law itself, not just its cost: the turn from the velocity at ignition and at cutoff against SLSQP's
    const a = opt.params.aDeg, b = opt.params.bDeg, T = B.customScenario(spec, B.defaults()).tRef, tf = opt.burns[0].dur;
    near(a - b / 2, o.linear.delta_deg[0], 0.25, c.id + ' turn at ignition (deg)');
    near(a + b * (tf / T - 0.5), o.linear.delta_deg[1], 0.25, c.id + ' turn at cutoff (deg)');
  }
  // pinned: the chain's numbers at its own T/W (0.846) and at 0.169
  near(ORACLE.planar[0].tangential.loss, 7.7334, 1e-3); near(ORACLE.planar[0].optimal[2].loss, 7.0366, 1e-3);
  near(ORACLE.planar[2].tangential.loss, 172.069, 1e-2); near(ORACLE.planar[2].optimal[2].loss, 160.127, 1e-2);
});

test('oracle, 3-D with J2: the chain\'s solved burn against DOP853 from the same ignition, and the asymptote at 20 Earth radii', () => {
  const sc = B.windowScenario(ST, B.defaults()), sol = B.solve(sc, B.defaults()), b = sol.final, o = ORACLE.j2case;
  near(CASES.j2case.yaw, sol.yaw, 1e-12, 'the oracle flew this yaw');
  near(b.dur, o.tf, 1e-6, 'burn time');
  near(Math.hypot(b.r[0] - o.r[0], b.r[1] - o.r[1], b.r[2] - o.r[2]), 0, 1e-3, 'cutoff position (m)');
  near(Math.hypot(b.v[0] - o.v[0], b.v[1] - o.v[1], b.v[2] - o.v[2]), 0, 1e-6, 'cutoff velocity (m/s)');
  near(b.m, o.m, 1e-4, 'mass');
  const ang = Math.acos(Math.min(1, sol.conic.sHat.reduce((s, x, i) => s + x * o.far.s_hat[i], 0))) / DEG;
  near(ang, 0, 2e-5, 'far asymptote direction (deg)');
  near(o.far.energy_conserved, sc.c3, 1e-3, 'energy conserved out to 20 radii (scipy)');
});

test('oracle, perigee burns: the splitting rule with analytic coasts (Kepler) against the kernel\'s numerical ones', () => {
  for (const c of CASES.multi) {
    const o = ORACLE.multi.find((x) => x.id === c.id);
    const R = B.compute({ custom: planarSpec(c) }, Object.assign(B.defaults(), { burns: c.N, sweep: false, capability: false }), { samples: false });
    near(R.sol.loss, o.loss, 1e-5, c.id + ' loss');
    R.sol.burns.forEach((b, i) => near(b.dur, o.burns[i].duration, 1e-6, c.id + ' burn ' + (i + 1)));
  }
  near(ORACLE.multi[0].loss, 31.365, 1e-2); near(ORACLE.multi[1].loss, 14.132, 1e-2);
});

test('Apollo 17: the transcription cross-checks (Table 2-2 against its time bases, Table 16-7, section 7.7)', () => {
  const T = L.TLI, A = L.AP17, F = L.AS512;
  for (const e of Object.values(T.events)) if (e.fromT6 != null) near(e.t, A.timeBase6RangeTime + e.fromT6, 0.06, e.text);
  near(T.events.guidanceCutoff.t - T.events.guidanceCutoff.fromT7, T.events.tli.t - T.events.tli.fromT7, 0.1, 'T7 from items 94 and 98 (both rounded to 0.1 s)');
  const ev = F.stageTables['S-IVB burn 2'].events;
  assert.equal(ev['S-IVB ignition'].t, T.events.secondIgnition.t); assert.equal(ev['S-IVB mainstage'].t, T.events.mainstage.t);
  near(T.events.mainstage.t - T.events.secondIgnition.t, T.buildup.durationS, 1e-9, 'STDV open + 2.5 s = mainstage');
  near(T.cutoff.ecoRangeTime - T.events.secondIgnition.t, T.mainstage.burnTimeS, 0.05, 'section 7.7 burn time');
  assert.equal(T.cutoff.ecoRangeTime, A.tliBurn.cutoffRangeTime);
  // the derived EMR 4.5 phase: exhaust velocity within 0.1 % of Table 7-2's (EMR 5.0), as a J-2 near those ratios should be
  const E = B.apollo17Engine();
  rel(E.F45 / E.md45, E.F5 / E.md5, 1e-3, 'EMR 4.5 phase exhaust velocity');
  near(E.F5 / E.md5, F.engines.sivbSecondBurn.ispS * B.G0, 0.5, 'Table 7-2: thrust / flow = Isp g0');
  near(E.Itot / E.mMain, 4192.85, 0.05, 'mean mainstage exhaust velocity from section 7.7 and Table 16-9');
  near(E.F45, 813054, 2, 'EMR 4.5 thrust (N)');
});

test('Apollo 17: the finite burn replayed against the flight', () => {
  const R = B.compute({ apollo17: true }, Object.assign(B.defaults(), { sweep: false })), a = R.apollo, row = (k) => a.rows.find((r) => r.key === k);
  near(a.flownDv, 3163.09, 0.01, 'the flight\'s own delta-v');
  near(a.dvImp, 3150.64, 0.01, 'impulsive need from the coasted orbit at ignition');
  near(a.flightLoss, 12.45, 0.01, 'the flight\'s finite-burn loss');
  near(R.sol.loss, 10.90, 0.01, 'tangential model loss');
  near(row('burn_time').model, 350.93, 0.01); near(row('burn_time').gap, -0.11, 0.01, 'burn time gap (s)');
  near(row('mass_cutoff').gap, 34.3, 0.1, 'cutoff mass gap (kg)');
  near(row('altitude_cutoff').model, 306.48, 0.01); near(row('speed_cutoff').gap, -5.40, 0.01);
  near(row('fpa_tli').model, 7.740, 0.001); near(row('incl_tli').gap, 0.0762, 1e-4); near(row('node_tli').gap, -0.1035, 1e-4);
  near(row('heading_tli').model, 118.2725, 1e-3, 'space-fixed heading east of north'); near(row('ecc_tli').model, 0.97188, 1e-4);
  near(a.nodeAtIgnitionDeg - a.nodeAtInsertionDeg, -1.0098, 1e-4, 'J2 coast moves the descending node');
  const o = B.compute({ apollo17: true }, Object.assign(B.defaults(), { steering: 'optimal', sweep: false })).apollo;
  near(o.rows.find((r) => r.key === 'altitude_cutoff').gap, -9.10, 0.05, 'optimised: cutoff 9 km low');
  near(o.rows.find((r) => r.key === 'fpa_tli').gap, -0.0055, 0.002, 'optimised: flight-path angle at TLI');
  const c = B.compute({ apollo17: true }, Object.assign(B.defaults(), { engine: 'chain', sweep: false })).apollo;
  near(c.rows[0].model, 301.98, 0.01, 'the chain\'s J-2 deck burns 14 % short');
  // idea 37's yardstick: the flight's burn at idea 33's exhaust velocity was 0.9 % under the need; at its own, 0.4 % over
  near(L.AS512.engines.sivbSecondBurn.ispS * B.G0, 4193.3, 0.1);
});

test('the chain\'s departure (AS-512 to Apophis, 2 July 2026): losses by steering law, propellant, capability', () => {
  const t = solveWin(), f = solveWin({ steering: 'fixed' }), o = solveWin({ steering: 'optimal' });
  near(t.sol.loss, 7.714, 0.002, 'tangential'); near(o.sol.loss, 7.084, 0.002, 'optimised'); near(f.sol.loss, 14.145, 0.002, 'fixed attitude');
  near(t.sol.dvImp, 3254.527, 0.001, 'impulsive with J2\'s potential at the departure point');
  near(t.sc.dvImp37, 3254.9456, 1e-4, 'idea 37\'s two-body figure');
  near(t.sol.mUsed, 67186.0, 0.5, 'propellant the burn needs'); near(t.sc.mp, 56250.39, 0.01, 'what the S-IVB has');
  near(t.sol.depleted.c3 / 1e6, -15.162, 0.001, 'C3 reached when the tank runs dry');
  near(t.cap.finite, 30609.1, 0.5, 'payload capability, finite'); near(t.cap.impulsive, 30722.3, 0.1, 'impulsive (closed form)');
  near(t.sol.burns[0].tIg, -145.136, 0.002, 'ignition before the departure point'); near(t.sol.burns[0].dur, 272.265, 0.002);
  near(t.sol.yaw / DEG, 0.1867, 0.001, 'yaw that puts the far asymptote on idea 37\'s');
  near(t.sol.phi, 0, 1e-10); near(t.sol.beta, 0, 1e-10);
  assert.deepEqual(t.refusals.map((r) => r.applies_to), ['departure_propellant']);
  assert.ok(f.sol.loss > t.sol.loss && t.sol.loss > o.sol.loss);
});

test('J2 after cutoff: the two-body C3 convention against the conserved energy; the asymptote turns, settled by 20 radii', () => {
  const R = solveWin({ payloadKg: 25000 }), h = B.makeHandoff({ window: ST }, Object.assign(B.defaults(), { sweep: false, payloadKg: 25000 }), R, { produced: 'x' }), v = h.outputs.v_infinity.value;
  near(v.c3_m2_s2, 511358.169, 1e-3, 'C3 at infinity is the target');
  near(v.c3_two_body_at_cutoff_m2_s2, 524509.2, 0.5, 'the two-body C3 at cutoff reads 2.6 % high');
  near(v.j2_turn_after_cutoff_deg, 0.1173, 1e-3, 'J2 turns the asymptote after cutoff');
  const S = L.WIN.outputs.asymptote.value.s_hat_j2000, n = Math.hypot(...v.vector_m_s);
  near(Math.acos(Math.min(1, v.vector_m_s.reduce((s, x, i) => s + x * S[i], 0) / n)) / DEG, 0, 1e-6, 'v-infinity along idea 37\'s asymptote');
  // the far radius and the step: following J2 to 200 Earth radii instead of 20 turns the asymptote 6e-5 deg; steps five
  // times finer move it 2e-6 deg (both far below what module 39 could use)
  const f = R.sol.final, c20 = B.farConic(f.r, f.v, true), ang = (a, b) => Math.acos(Math.min(1, a.reduce((s, x, i) => s + x * b[i], 0))) / DEG;
  const far = (fac, cap, lim) => { let y = f.r.concat(f.v); const r0 = Math.hypot(...f.r); for (let i = 0; i < 2e5; i++) { const rn = Math.hypot(y[0], y[1], y[2]); if (rn >= lim * W.constants.RJ2) break; y = W.rk4(y, Math.min(cap, fac * Math.pow(rn / r0, 1.5)), true); } return B.conic(y.slice(0, 3), y.slice(3)).sHat; };
  const fine20 = far(2, 200, 20), fine200 = far(2, 200, 200);
  near(ang(c20.sHat, fine20), 0, 1e-5, 'step'); near(ang(fine20, fine200), 0, 1e-4, '20 vs 200 radii');
});

test('perigee burns and thrust-to-weight: the loss falls with more burns and more thrust; the plane idea 37 aimed costs yaw', () => {
  const sw = B.sweep(B.windowScenario(ST, B.defaults()), { h: 2 });
  for (const n of [1, 2, 3]) { const c = sw.filter((p) => p.n === n); for (let i = 1; i < c.length; i++) assert.ok(c[i].loss < c[i - 1].loss, 'falls with T/W, N=' + n); }
  for (const w of [0.15, 0.3, 0.6, 1.2]) { const at = sw.filter((p) => p.tw === w); assert.ok(at[0].loss > at[1].loss && at[1].loss > at[2].loss, 'more burns, less loss at ' + w); }
  near(sw.find((p) => p.n === 1 && p.tw === 0.15).loss, 212.75, 0.02); near(sw.find((p) => p.n === 3 && p.tw === 0.15).loss, 27.88, 0.02);
  const q = (N) => solveWin({ burns: N, thrustScale: 0.25, capability: false });
  const r1 = q(1), r2 = q(2), r3 = q(3);
  near(r1.sol.loss, 114.57, 0.02, 'one burn at T/W 0.21');
  near(r2.sol.inPlane.loss, 31.33, 0.02, 'two, plane re-aimed'); near(r3.sol.inPlane.loss, 14.11, 0.02, 'three, plane re-aimed');
  near(r3.sol.loss, 30.97, 0.05, 'three, yawing idea 37\'s plane'); near(r3.sol.inPlane.betaDeg, 0.1494, 1e-3, 'J2 over 9 h of phasing');
  assert.ok(r2.refusals.some((r) => r.applies_to === 'asymptote_epoch'));
  near(r3.sol.final.t / 3600, 9.13, 0.01, 'the last cutoff 9.1 h after idea 37\'s departure point');
});

test('refusals: settings, the custom departure, burns that never end, ignition before insertion, no payload works', () => {
  const bad = (set) => B.compute({ window: ST }, Object.assign(B.defaults(), { sweep: false }, set)).refusal;
  for (const s of [{ steering: 'yolo' }, { burns: 5 }, { burns: 2, steering: 'optimal' }, { thrustScale: 0 }, { thrustScale: NaN }, { payloadKg: -1 }, { dt: 0 }]) assert.equal(bad(s).code, 'invalid_input', JSON.stringify(s));
  assert.equal(B.compute({}, B.defaults()).refusal.code, 'invalid_input');
  assert.equal(B.compute({ apollo17: true }, Object.assign(B.defaults(), { burns: 2 })).refusal.applies_to, 'burns');
  const cs = { altitudeKm: 200, inclinationDeg: 28.5, c3: 1e6, inertKg: 1e4, propellantKg: 5e4, payloadKg: 1e4, thrustN: 1e5, veMS: 4400, j2: true };
  for (const [k, v] of [['altitudeKm', 50], ['inclinationDeg', 200], ['c3', 1e9], ['inertKg', 0], ['thrustN', -1], ['veMS', 100]]) assert.equal(B.compute({ custom: Object.assign({}, cs, { [k]: v }) }, B.defaults()).refusal.code, 'invalid_input', k);
  const tiny = B.compute({ custom: Object.assign({}, cs, { thrustN: 3e3 }) }, Object.assign(B.defaults(), { sweep: false, capability: false }));
  assert.equal(tiny.refusal.applies_to, 'burn_length');
  const sc = B.windowScenario(ST, B.defaults());
  const ig = B.solveIgnition(Object.assign({}, sc, { tGuess: -1e5 }), 'tangential', {});
  assert.equal(ig.refusal.applies_to, 'ignition');
  const sample = B.compute({ window: B.importWindow(H37_SAMPLE) }, Object.assign(B.defaults(), { sweep: false }));
  assert.deepEqual(sample.refusals.map((r) => r.applies_to), ['departure_propellant', 'payload_capability']);
  assert.match(sample.refusals[0].what_would_help, /no payload, however light/);
});

test('handoff: the committed sample is what the kernel gives from idea 37\'s; units, sources; idea 37\'s refusals travel; round trip; edits refused', async () => {
  const { sample, PRODUCED } = await import(path.join(here, 'build-sample.mjs'));
  const committed = JSON.parse(fs.readFileSync(path.join(here, 'handoff.json'), 'utf8')), { handoff } = sample(H37_SAMPLE);
  assert.deepEqual(committed, JSON.parse(JSON.stringify(handoff)));
  assert.equal(committed.produced, PRODUCED);
  assert.deepEqual(committed.inputs.window_handoff, H37_SAMPLE, 'idea 37\'s handoff carried whole');
  for (const [k, v] of Object.entries(committed.outputs)) assert.ok(v.units != null && ['measured', 'derived', 'assumed'].includes(v.confidence) && v.source, k);
  for (const code of ['restart', 'navigation', 'dogleg', 'earth_orientation']) assert.ok(committed.refusals.some((r) => r.applies_to === code && r.from), code + ' travels on with its from');
  assert.ok(committed.refusals.some((r) => r.applies_to === 'departure_propellant' && !r.from), 'this module\'s own propellant refusal');
  assert.ok(!committed.outputs.hyperbolic_departure_state && committed.outputs.state_at_depletion, 'no departure state when the tank runs dry');
  const b = committed.outputs.burns.value[0];
  near(b.cutoff_tdb_s_past_j2000 - (Date.parse(b.cutoff_utc) / 1000 - 10957.5 * 86400), 69.184, 2e-3, 'TDB = UTC + 69.184 s in 2026 (Aster\'s offset; J2000 = Unix day 10,957.5)');
  const back = B.parseHandoff(committed);
  assert.ok(!back.refusal, back.refusal && back.refusal.reason);
  assert.equal(B.importWindow(committed).from, '38-burn-out', 'this page reads its own handoff');
  const ed = (f) => { const h = JSON.parse(JSON.stringify(committed)); f(h); return B.parseHandoff(h).refusal; };
  assert.ok(ed((h) => { h.outputs.finite_burn_loss.value.loss_m_s += 0.01; }));
  assert.ok(ed((h) => { h.refusals = h.refusals.filter((r) => r.applies_to !== 'departure_propellant' || r.from); }));
  assert.ok(ed((h) => { h.inputs.settings.steering = 'optimal'; }));
  assert.ok(ed((h) => { h.inputs.window_handoff.outputs.departure_point.value.r_m[2] += 5; }));
  // a departure that closes hands on the hyperbolic state in J2000 with its epoch
  const set = Object.assign(B.defaults(), { payloadKg: 25000, sweep: false }), R = B.compute({ window: ST }, set), h = B.makeHandoff({ window: ST }, set, R, { produced: 'x' });
  const hs = h.outputs.hyperbolic_departure_state.value;
  assert.equal(hs.frame, 'J2000 (ICRF axes)');
  near(hs.tdb_s_past_j2000, L.WIN.outputs.departure_point.value.tdb_s_past_j2000 + R.sol.final.t, 1e-6);
  assert.ok(!B.parseHandoff(JSON.parse(JSON.stringify(h))).refusal, 'the closing departure round-trips');
});

// ------------------------------------------------------------------ added by the independent review
test('review: the state handed to module 39 is in J2000, its v-infinity has idea 37\'s RLA and DLA, the scaled engine is what flew', () => {
  const set = Object.assign(B.defaults(), { payloadKg: 25000, sweep: false }), R = B.compute({ window: ST }, set);
  const h = JSON.parse(JSON.stringify(B.makeHandoff({ window: ST }, set, R, { produced: 'x' }))), hs = h.outputs.hyperbolic_departure_state.value, vi = h.outputs.v_infinity.value;
  // turned back into idea 37's frame of date with its own precession matrix, the handed state is the burn's cutoff
  const f = R.sol.final, rM = ST.toMod(hs.r_m), vM = ST.toMod(hs.v_m_s);
  near(Math.hypot(rM[0] - f.r[0], rM[1] - f.r[1], rM[2] - f.r[2]), 0, 1e-6, 'r in J2000 (m)');
  near(Math.hypot(vM[0] - f.v[0], vM[1] - f.v[1], vM[2] - f.v[2]), 0, 1e-9, 'v in J2000 (m/s)');
  // and the v-infinity points where idea 37's asymptote points: Aster's RLA and DLA as idea 37 hands them on
  const A = L.WIN.outputs.asymptote.value;
  near(vi.rla_deg, A.rla_deg, 1e-6, 'RLA'); near(vi.dla_deg, A.dla_deg, 1e-6, 'DLA');
  near(vi.magnitude_m_s, A.vinf_m_s, 1e-6, '|v-infinity| from the conserved energy is the target\'s');
  // a scaled engine: the handoff names the thrust and flow that flew, and its T/W
  const k = 0.5, Rk = B.compute({ window: ST }, Object.assign(B.defaults(), { thrustScale: k, sweep: false, capability: false })), hk = B.makeHandoff({ window: ST }, Object.assign(B.defaults(), { thrustScale: k }), Rk, { produced: 'x' });
  const e = hk.outputs.engine.value;
  near(e.thrust_N, ST.eng.F * k, 1e-6, 'scaled thrust'); near(e.mass_flow_kg_s, ST.eng.mdot * k, 1e-9, 'scaled flow');
  near(e.thrust_to_weight_ignition, e.thrust_N / (e.mass_ignition_kg * B.G0), 1e-12, 'T/W');
  assert.equal(hk.outputs.engine.confidence, 'assumed');
  assert.ok(hk.refusals.some((r) => r.applies_to === 'transients' && /scaled/.test(r.reason)), 'a scaled engine still has no transients');
  // the custom parking orbit has the typed inclination
  const cs = B.customScenario({ altitudeKm: 400, inclinationDeg: 51.6, c3: 1e6, inertKg: 1e4, propellantKg: 5e4, payloadKg: 1e4, thrustN: 2e5, veMS: 4400, j2: true }, B.defaults());
  const s0 = cs.stateAt(0), hh = [s0.r[1] * s0.v[2] - s0.r[2] * s0.v[1], s0.r[2] * s0.v[0] - s0.r[0] * s0.v[2], s0.r[0] * s0.v[1] - s0.r[1] * s0.v[0]];
  near(Math.acos(hh[2] / Math.hypot(...hh)) / DEG, 51.6, 1e-9, 'custom inclination');
  near(Math.hypot(...s0.r) - B.constants.RE, 400e3, 1e-6, 'custom altitude');
});

test('review: refusals instead of numbers where the review found placeholders, NaN and a false refusal', () => {
  const cs = { altitudeKm: 200, inclinationDeg: 28.5, c3: 1e6, inertKg: 1e4, propellantKg: 5e4, payloadKg: 1e4, thrustN: 1e6, veMS: 4400, j2: true };
  // (1) the impulsive rocket equation leaves 50 kg for a payload but the finite burn's loss eats it: no capability, a
  // payload_capability refusal (it used to show "0 kg" and "a payload of at most 0 kg")
  const sc0 = B.customScenario(cs, B.defaults()), inert = 5e4 / (Math.exp(sc0.dvImp / 4400) - 1) - 50;
  const tight = Object.assign({}, cs, { inertKg: inert, payloadKg: 1000, thrustN: 3e4 });
  const R1 = B.compute({ custom: tight }, Object.assign(B.defaults(), { sweep: false }));
  near(R1.cap.impulsive, 50, 1e-6, 'impulsive margin'); assert.equal(R1.cap.finite, null);
  assert.deepEqual(R1.refusals.map((r) => r.applies_to), ['departure_propellant', 'payload_capability']);
  assert.match(R1.refusals[1].reason, /finite-burn loss uses all of it/);
  assert.doesNotMatch(R1.refusals[0].what_would_help, /at most 0 kg/);
  // (2) an engine that cannot reach the C3 at all: a sentence with the C3 it does reach, not "C3 NaN"
  for (const set of [{}, { burns: 2 }, { steering: 'fixed' }]) {
    const r = B.compute({ custom: Object.assign({}, cs, { c3: 10e6, veMS: 500 }) }, Object.assign(B.defaults(), { sweep: false }, set)).refusal;
    assert.equal(r.applies_to, 'targeting', JSON.stringify(set)); assert.doesNotMatch(r.reason, /NaN/); assert.match(r.reason, /2 % of its ignition mass/);
  }
  // (3) fixed attitude on a weak engine: the burn flies (it used to be refused, "no steering found", although the
  // reference direction itself flies), and costs more than along-velocity steering at the same thrust
  const fx = solveWin({ steering: 'fixed', thrustScale: 0.18, capability: false }), tg = solveWin({ thrustScale: 0.18, capability: false });
  assert.ok(!fx.refusal, fx.refusal && fx.refusal.reason);
  assert.ok(fx.sol.loss > tg.sol.loss && fx.sol.loss < 1000, 'fixed ' + fx.sol.loss + ' vs along velocity ' + tg.sol.loss);
  near(fx.sol.phi, 0, 1e-10); near(fx.sol.beta, 0, 1e-10);
  // and it is the best fixed direction, not the reference horizontal (505.2 m/s there; 485.9 at 1 deg, 486.8 at 2 deg)
  near(fx.sol.loss, 484.01, 0.05, 'fixed attitude at T/W 0.15'); near(fx.sol.params.alphaDeg, 1.45, 0.2, 'its direction above the reference');
  // (4) handoffs that hand module 39 no departure say why
  const hOf = (src, set) => { const s = Object.assign(B.defaults(), { sweep: false }, set || {}); return B.makeHandoff(src, s, B.compute(src, s), { produced: 'x' }); };
  const codes = (h) => h.refusals.map((r) => r.applies_to);
  const ha = hOf({ apollo17: true });
  assert.ok(!ha.outputs.hyperbolic_departure_state && ha.refusals.some((r) => r.applies_to === 'hyperbolic_departure_state' && /bound orbit/.test(r.reason)), 'Apollo 17: a bound ellipse');
  const hb = hOf({ custom: Object.assign({}, cs, { c3: -5e6 }) });
  assert.ok(!hb.outputs.hyperbolic_departure_state && codes(hb).includes('hyperbolic_departure_state') && codes(hb).includes('transients'), 'custom C3 < 0');
  const hc = hOf({ custom: cs });
  assert.ok(hc.outputs.hyperbolic_departure_state && hc.outputs.hyperbolic_departure_state.value.tdb_s_past_j2000 === null && codes(hc).includes('hyperbolic_departure_state'), 'custom: no epoch');
  assert.ok(!codes(hOf({ window: ST }, { payloadKg: 25000 })).includes('hyperbolic_departure_state'), 'the chain\'s closing departure hands it on');
  // (5) a steering law that turns with time is integrated to RK4's order: 1 s and 0.1 s steps agree to a microsecond
  // (the turn is evaluated at each stage's own time; at the step's start instead, they differ by 1e-4 s)
  const spec = { altitudeKm: 171, inclinationDeg: 0, c3: 511358, inertKg: 12334, propellantKg: 111006, payloadKg: 0, thrustN: 204618, veMS: 4146, j2: false }, P = { a: -5 * DEG, b: 2 * DEG };
  const d1 = B.solveIgnition(B.customScenario(spec, Object.assign(B.defaults(), { dt: 1 })), 'optimal', P), d01 = B.solveIgnition(B.customScenario(spec, Object.assign(B.defaults(), { dt: 0.1 })), 'optimal', P);
  near(d1.dur, d01.dur, 1e-6, 'turned law: step-converged burn time');
  // (6) Apollo's thrust-to-weight is at the burn's mean thrust, the engine its sweep flies, so the point sits on its curve
  const Ra = B.compute({ apollo17: true }, B.defaults()), E = B.apollo17Engine();
  near(Ra.sc.tw0, E.meanF / (E.mIg * B.G0), 1e-12, 'T/W at the mean thrust');
  const sw = B.sweep(Ra.sc, { h: 2, ns: [1], tws: [Ra.sc.tw0] })[0];
  near(sw.loss, B.compute({ apollo17: true }, Object.assign(B.defaults(), { engine: 'mean', sweep: false })).sol.loss, 0.05, 'the sweep at this T/W is the mean-thrust burn');
});
