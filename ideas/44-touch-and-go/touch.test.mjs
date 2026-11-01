// Tests for idea 44 (Touch and Go). node --test ideas/44-touch-and-go/touch.test.mjs   (about 40 s)
// What they pin to, outside this kernel: JPL Horizons' reconstruction of OSIRIS-REx's descent (snapshots/tag-recon.js);
// the published TAG figures (Berry et al. 2020, 2021; May et al. 2014; NASA 2020-2024; Walsh et al. 2022) in
// snapshots/tag-sources.js; idea 43's and idea 42's committed kernels and handoffs; closed forms.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const HERE = path.dirname(new URL(import.meta.url).pathname);
const BANK = path.join(HERE, '..', '..');
const { K, K43, sample43 } = require('./load.cjs');
const SRC = K.sources, REC = K.recon;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' ' + a + ' vs ' + b + ' (tol ' + tol + ')');
const rel = (a, b) => (a - b) / b;
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

// shared runs (the expensive part), made once
const bennu = K.bennuCase();
const RB = K.run(bennu, {});
const chainSrc = K.importLumpy(sample43());
const RC = K.run(chainSrc, {});

test('1 snapshots: sidecars match, idea 43 files are byte-identical, the 43 handoff is wrapped unmodified', () => {
  const dir = path.join(HERE, 'snapshots');
  for (const f of fs.readdirSync(dir).filter((x) => !x.endsWith('.provenance.json'))) {
    const side = JSON.parse(fs.readFileSync(path.join(dir, f + '.provenance.json'), 'utf8'));
    assert.ok(side.repo && side.path && side.commit, f + ' sidecar keys');
    assert.equal(side.writtenSha256, sha(path.join(dir, f)), f + ' sha256');
  }
  for (const f of ['lumpy.js', 'shapes.js', 'attitude.js', 'geophysics.js', 'integrator.js', 'approach-sources.js', 'aster-constants.js', 'orbit-b.js', 'orbit-b-sunlight.js']) {
    const src = f === 'lumpy.js' ? path.join(BANK, 'ideas/43-lumpy/lumpy.js') : path.join(BANK, 'ideas/43-lumpy/snapshots', f);
    assert.equal(sha(path.join(dir, f)), sha(src), f + ' is idea 43\'s committed file');
  }
  assert.deepEqual(sample43(), JSON.parse(fs.readFileSync(path.join(BANK, 'ideas/43-lumpy/handoff.json'), 'utf8')));
  // the execution-error arrays re-form the table rows quoted from Berry et al. 2021 (build-data.mjs checked the rows are in the PDF)
  const E = SRC.execution, f = (x) => (Number.isInteger(x) && x >= 10 ? String(x) : x.toFixed(1));
  Object.keys(E.rows).forEach((k, i) => {
    const p = E.prelaunch[k], l = E.late[k];
    assert.equal(E.rows[k] + ' RSS(' + f(p[0]) + 'mm/s, ' + f(p[1]) + '%ΔV) ' + f(p[2]) + 'mm/s+' + f(p[3]) + '%ΔV RSS(' + f(l[0]) + 'mm/s, ' + f(l[1]) + '%ΔV) ' + f(l[2]) + 'mm/s+' + f(l[3]) + '%ΔV', E.q[i]);
  });
  // the sunlight table is idea 42's accel() at those rows
  const K42 = require(path.join(BANK, 'ideas/42-closing-in/load.cjs')).K, am = 1 / require('./snapshots/approach-sources.js').aas24063.massToArea_kg_m2;
  const ctx = K42.bennuCtx(REC.bennuHelio.s, REC.bennuHelio.t, am, 0);
  [0, 30, 60, REC.t.length - 1].forEach((i) => { const a = K42.accel(REC.t[i], REC.s[i].slice(0, 3), ctx); for (let j = 0; j < 3; j++) near(REC.sun[i][j], a[j], 1e-20 + 1e-10 * Math.abs(a[j])); });   // stored to 12 digits
});

test('2 reality: OSIRIS-REx\'s reconstructed descent, leg by leg, under the shape and under a point mass', () => {
  const L = RB.reality.legs;
  // pinned: the polyhedron misses each leg's end by less than a point mass does, and by how much
  near(L[0].poly.dr_m, 1.694, 0.02, 'ODM->CP poly'); near(L[0].pm.dr_m, 7.290, 0.05, 'ODM->CP pm');
  near(L[1].poly.dr_m, 0.145, 0.005, 'CP->MP poly'); near(L[1].pm.dr_m, 0.553, 0.01, 'CP->MP pm');
  near(L[2].poly.dr_m, 0.400, 0.005, 'MP->contact poly'); near(L[2].pm.dr_m, 2.074, 0.01, 'MP->contact pm');
  near(L[2].poly.dv_m_s * 1000, 2.63, 0.03, 'MP->contact poly dv'); near(L[2].pm.dv_m_s * 1000, 9.25, 0.05, 'MP->contact pm dv');
  L.forEach((q) => assert.ok(q.poly.dr_m < q.pm.dr_m / 3.5, q.leg + ': the shape is >3.5x better'));
  // the model falls too fast at the end (radial error negative): gravity a little too strong near Nightingale
  assert.ok(L[2].poly.dr_radial_m < -0.35 && L[2].poly.dv_radial_m_s < -0.0025);
  // the reconstructed contact against NASA's published numbers
  const c = RB.reality.contact;
  near(-c.vn_m_s, SRC.contact.v_contact_m_s.v, 0.001, 'contact speed vs NASA 10 cm/s');
  assert.ok(c.vh_m_s * 1000 < SRC.delivery.vel_req_mm_s.v, 'horizontal under the 20 mm/s requirement'); near(c.vh_m_s * 1000, 6.08, 0.05);
  assert.equal(c.earthReceiveUtc.slice(0, 16), SRC.contact.confirm_utc.v.slice(0, 16), 'Earth receives the contact at 22:08 UTC (6:08 pm EDT)');
  near(c.heightAboveSite_m, 4.23, 0.01, 'bus above the aim point'); near(c.heightAboveSite_m - SRC.tagsam.arm_m.v, 0.83, 0.01, 'the 25 m shape puts the ground 0.83 m low');
  near(c.segmentJump_m, 1.919, 0.001);
  near(RB.reality.heights.cp_m, 127.56, 0.05, 'flown Checkpoint height (published 125 m)'); near(RB.reality.heights.mp_m, 58.24, 0.05, 'flown Matchpoint height (published 50-55 m)');
  // the flown burns, measured from the reconstruction
  const F = RB.reality.flownBurns.map((b) => b.dv_m_s * 1000);
  near(F[0], 80.07, 0.05, 'ODM'); near(F[1], 176.48, 0.1, 'CP'); near(F[2], 72.15, 0.05, 'MP');
});

test('3 the planner on OSIRIS-REx\'s timeline: hits its targets, and its burns against the flown ones', () => {
  const p = RB.plan, S = RB.S;
  // targets met: contact at the aim (arm above the site), -10 cm/s along the normal, no horizontal speed
  const att = K.attAt(bennu.B, p.tc), xb = [0, 1, 2].map((i) => att.C[3 * i] * p.xc[0] + att.C[3 * i + 1] * p.xc[1] + att.C[3 * i + 2] * p.xc[2]);
  const aim = bennu.site.point.map((x, i) => x + bennu.site.normal[i] * S.arm_m);
  assert.ok(Math.hypot(...xb.map((x, i) => x - aim[i])) < 2e-3, 'contact at the aim');
  near(p.rel.vn, -S.v_td, 2e-6); assert.ok(p.rel.vh < 2e-6);
  // timeline from the reconstruction, published profile otherwise
  near(S.depToCp_h, 3.990278, 2e-6); near(S.cpToMp_min, 10.583333, 2e-6); near(S.mpToTag_min, 10.283333, 1e-5);
  near(S.h_cp, SRC.profile.h_cp_m.v, 0); near(S.bab_m_s, 0.40, 0);
  const P = p.burns.map((b) => b.dv_m_s * 1000), F = RB.reality.flownBurns.map((b) => b.dv_m_s * 1000);
  near(P[0], 72.90, 0.05); near(P[1], 134.08, 0.1); near(P[2], 96.34, 0.1);
  near(rel(P[0], F[0]), -0.0896, 0.002, 'departure 9% under the flown');
  near(rel(P[1] + P[2], F[1] + F[2]), -0.073, 0.003, 'Checkpoint + Matchpoint 7% under the flown');
  // the Matchpoint height is an outcome: inside the published 50 m (2020) to 55 m (2014)
  assert.ok(p.mpHeight_m > SRC.profile.h_mp_m.v && p.mpHeight_m < SRC.profile.h_mp_m_2014.v); near(p.mpHeight_m, 53.57, 0.05);
  assert.deepEqual(p.hits, [null, null, null], 'passively safe, no leg passes through the shape');
  // the safety check fires on a path through the body and not on one that passes by
  const ctx = RB.ctx, rM = bennu.B.P.rMax;
  assert.ok(K.hitsBody(ctx, p.tc, [2 * rM, 0, 0], [-0.2, 0, 0], 3000).hit !== null, 'a path through Bennu is caught');
  assert.equal(K.hitsBody(ctx, p.tc, [2 * rM, 0, 0], [0, 0.2, 0], 600).hit, null, 'a path past it is not');
  // the departure leg is re-solved when the Checkpoint height changes (it is cached per case)
  const R150 = K.run(bennu, { h_cp: 150 });
  assert.ok(Math.abs(R150.plan.burns[0].dv_m_s - p.burns[0].dv_m_s) > 1e-3, 'a 150 m Checkpoint changes the departure burn');
  const a150 = K.aimAt(ctx, R150.plan.tcp, 150); assert.ok(Math.hypot(...R150.plan.states.cpIn.x.map((x, i) => x - a150[i])) < 2e-3, 'and reaches it');
  // the 40 cm/s back-away leaves Bennu (published: > 0.5 m/s ensures escape in the worst case)
  assert.ok(p.bab.escapes); near(p.bab.escape_m_s, 0.204, 0.002);
});

test('4 dispersions: linear covariance against OSIRIS-REx\'s published Monte Carlo, and against our own Monte Carlo', () => {
  const D = RB.dispersion, N = SRC.delivery.nightingale_2020;
  near(D.pos3_m[0], 6.20, 0.02); near(D.pos3_m[1], 5.30, 0.02);
  near(rel(D.pos3_m[0], N.pos_3s_m), -0.236, 0.005, 'position: 24% under Berry 2020 Table 6 (8.12 m)');
  near(rel(D.pos3_m[0], SRC.delivery.late_max_m.v), -0.046, 0.005, 'position: 5% under Berry 2021 late update (6.5 m)');
  near(D.horiz3_m_s * 1000, N.horiz_3s_mm_s, 0.05, 'horizontal speed 6.64 mm/s');
  near(rel(D.vert3_m_s * 1000, N.vert_3s_mm_s), 0.223, 0.01, 'vertical: 22% over (6.95 mm/s)');
  assert.ok(D.budget_pos3_m['Checkpoint burn'] > 0.8 * D.pos3_m[0], 'the Checkpoint burn dominates');
  // pre-launch inputs against the pre-launch ranges
  const Dp = K.run(bennu, { errors: 'prelaunch' }).dispersion, R = SRC.delivery.prelaunch_2020;
  near(Dp.pos3_m[0], 14.62, 0.05); assert.ok(Dp.pos3_m[0] < R.pos_3s_m[0]);
  assert.ok(Dp.horiz3_m_s * 1000 > R.horiz_3s_mm_s[0] && Dp.horiz3_m_s * 1000 < R.horiz_3s_mm_s[1], 'pre-launch horizontal inside 12-15 mm/s');
  assert.ok(Dp.vert3_m_s * 1000 > R.vert_3s_mm_s[1]); near(Dp.vert3_m_s * 1000, 18.21, 0.05);
  // linear: doubling every error doubles the ellipse
  const D2 = K.run(bennu, { errScale: 2 }).dispersion; near(D2.pos3_m[0] / D.pos3_m[0], 2, 1e-9);
  // a Monte Carlo of the nonlinear flights with the same errors (150 draws, fixed seed)
  const pl = RB.plan, ctx = RB.ctx, S = RB.S;
  let seed = 12345; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return (seed + 0.5) / 2147483648; };
  const gauss = () => Math.sqrt(-2 * Math.log(rnd())) * Math.cos(2 * Math.PI * rnd());
  const chol = (Q) => { const L = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; for (let i = 0; i < 3; i++) for (let j = 0; j <= i; j++) { let s = Q[i][j]; for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k]; L[i][j] = i === j ? Math.sqrt(Math.max(s, 0)) : s / L[j][j]; } return L; };
  const mul = (L, z) => [0, 1, 2].map((i) => L[i][0] * z[0] + L[i][1] * z[1] + L[i][2] * z[2]);
  const Lc = chol(D.Qcp), Lm = chol(D.Qmp), [sp, sv] = D.sigmaNft, n = bennu.site.normal, pts = [];
  for (let k = 0; k < 150; k++) {
    const dx = [0, 1, 2].map(() => sp * gauss()), dv = [0, 1, 2].map(() => sv * gauss()), ec = mul(Lc, [gauss(), gauss(), gauss()]), em = mul(Lm, [gauss(), gauss(), gauss()]);
    const a = K.flyLeg(ctx, pl.tcp, pl.states.cpOut.x.map((x, i) => x + dx[i]), pl.states.cpOut.v.map((x, i) => x + dv[i] + ec[i]), pl.tmp - pl.tcp);
    const b = K.flyLeg(ctx, pl.tmp, a.x, a.v.map((x, i) => x + pl.burns[2].dv[i] + em[i]), pl.tc - pl.tmp);
    const rv = K.relVel(ctx, pl.tc, b.x, b.v), r = rv.xb.map((x, i) => x - (bennu.site.point[i] + n[i] * S.arm_m)), h = r[0] * n[0] + r[1] * n[1] + r[2] * n[2], p = r.map((x, i) => x - rv.vb[i] * h / rv.vn);
    pts.push([p[0] * D.axes.e1[0] + p[1] * D.axes.e1[1] + p[2] * D.axes.e1[2], p[0] * D.axes.e2[0] + p[1] * D.axes.e2[1] + p[2] * D.axes.e2[2]]);
  }
  const m = (f) => pts.reduce((s, q) => s + f(q), 0) / pts.length, e = K.eig2(m((q) => q[0] * q[0]), m((q) => q[0] * q[1]), m((q) => q[1] * q[1]));
  near(3 * Math.sqrt(e.l1) / D.pos3_m[0], 1, 0.15, 'Monte Carlo major axis'); near(3 * Math.sqrt(e.l2) / D.pos3_m[1], 1, 0.15, 'Monte Carlo minor axis');
  // closed form: a circular Gaussian puts 1 - exp(-R^2 / 2 s^2) inside R
  near(K.pInsideCircle(2, 2, 3), 1 - Math.exp(-9 / 8), 2e-5); near(K.pInsideCircle(1, 1, 8), 1, 1e-9);
});

test('5 contact: the regolith inferred from NASA\'s 48.8 cm in ~6 s at 10 cm/s, reproduced and carried', () => {
  const g = RB.contact.regolith;
  near(g.a_m_s2, 2 * (0.1 * 6 - 0.488) / 36, 1e-15);
  near(g.p_Pa[0], 68.80, 0.01); near(g.p_Pa[1], 164.96, 0.01);
  // round trip: each pressure on the mass it was inferred for gives back 48.8 cm at 6 s, still moving (NASA: "still plunging")
  g.p_Pa.forEach((p, i) => { const q = K.penetration(0.1, g.mass_kg[i], g.area_m2, p, g.gN, 6); near(q.d_tau, 0.488, 1e-12); assert.ok(q.v_tau > 0.06); near(q.stop_m, 0.8036, 0.001); });
  near(g.area_m2, Math.PI * 0.16 * 0.16, 1e-15, 'the 32 cm base plate');
  // the chain's 487 kg craft in the same regolith, backing away 5 s after contact
  const C = RC.contact.cases;
  assert.equal(C.length, 2); near(C[0].m_kg, 487.103024, 1e-6);
  near(C[0].d_tau, 0.3592, 0.001); near(C[1].d_tau, 0.1843, 0.001); assert.ok(C[1].stoppedBeforeBab && !C[0].stoppedBeforeBab);
  near(C[0].stop_m, 0.4439, 0.001);
});

test('6 bounce: hops on rigid ground against flat-ground closed forms, and the escape threshold', () => {
  // a low hop: flight time ~ 2 e v / a_n on the site's local acceleration (spin included), range ~ 0 for a vertical rebound
  const R = K.run(bennu, { mode: 'stay', surface: 'rigid', e: 0.1 });
  const h0 = R.stay.bounce.hops[0], st = bennu.site.s43, an = st.accel_mag_m_s2 * Math.cos(st.slope_deg * Math.PI / 180);
  const T = 2 * 0.1 * 0.1 / an;
  near(h0.dt_s / T, 1, 0.02, 'first hop time vs 2 e v / a_n'); near(h0.dt_s, 307.9, 0.5);
  // escape: a rebound faster than the straight-up escape speed leaves; one under it comes back
  const vEsc = st.escape_up_m_s;
  const up = K.run(bennu, { mode: 'stay', surface: 'rigid', e: 0.9, v_td: 0.30 }); assert.ok(0.9 * 0.3 > vEsc && up.stay.bounce.escaped, 'escapes');
  const dn = K.run(bennu, { mode: 'stay', surface: 'rigid', e: 0.5, v_td: 0.30 }); assert.ok(0.5 * 0.3 < vEsc && !dn.stay.bounce.escaped, 'stays');
  near(RC.eStar, RC.ctx.site.s43.escape_up_m_s / 0.1, 1e-3);
});

test('7 holding down and sampling: closed forms and the published sampleability numbers', () => {
  const H = RC.hold, st = chainSrc.site.s43, m = 487.103024;
  near(H.weight_N, m * st.accel_mag_m_s2, 1e-12); near(H.weight_N, 0.04618, 1e-5);
  near(H.propellant_kg_h, (1 - H.normal_N) / (294.200712 * 9.80665) * 3600, 1e-12); near(H.propellant_kg_h, 1.1906, 1e-4);
  assert.ok(H.liftsOff, 'a 1 N push lifts a 487 kg craft off Apophis');
  // TAGSAM tilt function: 0.434 is 4.46 deg of rock tilt; the zero-tilt predictions are the paper's 258 g and 575 g (printed truncated)
  near(RB.sample.impliedTilt_deg, 4.4557, 1e-3); near(K.tiltEff(3.7), 0.5, 1e-15);
  const P = SRC.sample.predicted_g, Z = SRC.sample.zero_tilt_g;
  assert.equal(Math.floor(P.low_unresolved / 0.434), Z.low); assert.equal(Math.floor(P.high_unresolved / 0.434), Z.high);
  // against what came home: the pre-TAG low-mobility prediction is 7.6% under the 121.6 g returned; zero tilt is 113% over
  near(rel(P.low_unresolved, SRC.sample.returned_g.v), -0.0765, 0.001); near(rel(RB.sample.zeroTilt_g, SRC.sample.returned_g.v), 1.128, 0.002);
  assert.equal(RC.sample.mass_kg, null, 'no particle map of Apophis: no mass'); near(RC.sample.analog_kg, 0.4404, 1e-4);
});

test('8 the chain: idea 43\'s handoff in, refusals carried, the propellant shortfall, the round trip', () => {
  // the chain's sunlight is idea 42's accel() rule: flat absorber along the Sun line, off in the body's shadow cylinder
  const K42 = require(path.join(BANK, 'ideas/42-closing-in/load.cjs')).K, h42 = sample43().inputs.closing_handoff, ss = h42.outputs.standoff_state.value;
  const ctx42 = { mu: 0, radius: chainSrc.B.Req, astAt: () => ({ r: ss.asteroid_heliocentric.r_m }), am: h42.inputs.settings.am_m2_kg, cr: 1, shadow: true, parts: true };
  const srp = K.srpChain(chainSrc), u = chainSrc.sunDir, side = [u[1], -u[0], 0].map((x) => x / Math.hypot(u[0], u[1]));
  for (const x of [u.map((q) => -300 * q), u.map((q) => 300 * q), u.map((q, i) => 300 * q + 400 * side[i]), side.map((q) => 250 * q), ss.r_m]) {
    const mine = srp(0, x), theirs = K42.accel(0, x, ctx42).srp;
    for (let j = 0; j < 3; j++) near(mine[j], theirs[j], 2e-6 * Math.hypot(...theirs) + 1e-30, 'sunlight vs idea 42 at ' + x.map((q) => q.toFixed(0)));
  }
  assert.deepEqual(srp(0, u.map((q) => 300 * q)), [0, 0, 0], 'behind the body: shadow');
  assert.ok(!chainSrc.refusal); assert.equal(chainSrc.B.name, '99942 Apophis (2004 MN4)'); assert.equal(chainSrc.site.face, 346);
  assert.equal(RC.S.depToCp_h, 24);
  const codes = RC.own.map((r) => r.applies_to);
  assert.deepEqual(codes, ['propellant', 'hazards', 'regolith', 'sample', 'anchors']);
  assert.equal(RC.carried.length, 14); assert.ok(RC.carried.every((r) => r.from));
  near(RC.propellant.needed_kg, 0.1596, 1e-4); near(RC.propellant.available_kg, 0.103024, 1e-9);
  const P = RC.plan.burns.map((b) => b.dv_m_s * 1000); near(P[0], 212.0, 0.2); near(P[1], 248.0, 0.3); near(P[2], 85.6, 0.2);
  near(RC.dispersion.pos3_m[0], 12.67, 0.03); near(RC.dispersion.pSafe, 0.9096, 0.001);
  assert.ok(RC.plan.bab.escapes); near(RC.plan.bab.escape_m_s, 0.1827, 0.001);
  // the sample handoff is exactly what its inputs give, and an edit is refused
  const h = JSON.parse(fs.readFileSync(path.join(HERE, 'handoff.json'), 'utf8'));
  const again = K.buildHandoff(RC, h.produced);
  for (const k of Object.keys(again.outputs)) assert.equal(K43.numDiff(h.outputs[k].value, again.outputs[k].value, k, 1e-6), null, k);
  assert.equal(K.codes(h.refusals), K.codes(again.refusals));
  for (const o of Object.values(h.outputs)) assert.ok(o.units && o.confidence && o.source);
  const ed = JSON.parse(JSON.stringify(h)); ed.outputs.contact.value.cases[0].depth_at_backaway_m *= 1.01;
  assert.equal(K.parseHandoff(ed).refusal.code, 'invalid_input');
  const ed2 = JSON.parse(JSON.stringify(h)); ed2.refusals = ed2.refusals.filter((r) => r.applies_to !== 'propellant');
  assert.match(K.parseHandoff(ed2).refusal.reason, /refusals/);
});

test('9 refusals the inputs raise', () => {
  assert.equal(K.importLumpy('nonsense').refusal.code, 'invalid_input');
  const h42 = require(path.join(BANK, 'ideas/42-closing-in/handoff.json'));
  assert.match(K.importLumpy(h42).refusal.what_would_help, /idea 43/);
  const h43b = JSON.parse(JSON.stringify(sample43())); h43b.outputs.site.value.slope_deg += 1;
  assert.match(K.importLumpy(h43b).refusal.reason, /Idea 43 refuses/);
  assert.equal(K.run(bennu, { v_td: 5 }).refusal.code, 'invalid_input');
  assert.equal(K.run(bennu, { mode: 'land' }).refusal.code, 'invalid_input');
  assert.equal(K.run(bennu, { h_cp: 8 }).refusal.code, 'invalid_input');
  const bm = RB.own.map((r) => r.applies_to); assert.deepEqual(bm, ['hazards', 'regolith', 'spacecraft_mass', 'anchors']);
  assert.equal(RB.propellant, null, 'no Isp or mass for OSIRIS-REx here: no propellant number');
});
