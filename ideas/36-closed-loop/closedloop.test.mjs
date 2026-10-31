// Tests for idea 36 (Closed Loop). Node built-ins only. Run from the bank root:
//   node --test ideas/36-closed-loop/closedloop.test.mjs
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
const { A, C, S, DATA, T512, G512, PARK, pf, EARTH, AERO, AS512, MaxQ, ClosedLoop } = L;
const MAXQ = path.join(here, '..', '35-max-q');
let ORACLE = null; // the fixture the Python oracle writes; the oracle tests fail without it, the rest still run
try { ORACLE = JSON.parse(fs.readFileSync(path.join(here, 'oracle', 'guidance-oracle.json'), 'utf8')); } catch (e) { ORACLE = null; }
const CASES = JSON.parse(fs.readFileSync(path.join(here, 'oracle', 'cases.json'), 'utf8'));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol}, off ${a - b})`);

// one AS-512 set-up and guided flight shared by many tests (idea 34's AS-512, idea 35's plan, Table 4-4 target)
const CTX = C.setup(DATA.as512);
const RUN = C.run(CTX, { samples: true });
const G = RUN.guided;

test('snapshots: idea 35\'s kernel and data are byte-identical to the committed files, every sidecar matches', () => {
  const pairs = [['snapshots/ascent.js', 'ascent.js'], ['snapshots/stack.js', 'snapshots/stack.js'], ['snapshots/isa.js', 'snapshots/isa.js'], ['snapshots/earth.js', 'snapshots/earth.js'],
    ['snapshots/data-json.js', 'snapshots/data-json.js'], ['snapshots/as512-flight.js', 'snapshots/as512-flight.js'], ['snapshots/as512-trajectory.js', 'snapshots/as512-trajectory.js'],
    ['snapshots/saturn-v-axial-force.js', 'snapshots/saturn-v-axial-force.js'], ['snapshots/aster-delta-v.ts.txt', 'snapshots/aster-delta-v.ts.txt']];
  for (const [mine, theirs] of pairs) assert.equal(sha(fs.readFileSync(path.join(here, mine))), sha(fs.readFileSync(path.join(MAXQ, theirs))), mine);
  for (const f of fs.readdirSync(path.join(here, 'snapshots')).filter((x) => x.endsWith('.provenance.json'))) {
    const sc = JSON.parse(fs.readFileSync(path.join(here, 'snapshots', f), 'utf8'));
    assert.ok(sc.repo && sc.path && sc.commit, f + ' has repo, path, commit');
    const file = path.join(here, 'snapshots', f.replace(/\.provenance\.json$/, ''));
    if (sc.writtenSha256) assert.equal(sha(fs.readFileSync(file)), sc.writtenSha256, f);
  }
  // the parking radius is parsed, not typed: 6_578.137 km in Aster's delta-v.ts
  const ts = fs.readFileSync(path.join(here, 'snapshots', 'aster-delta-v.ts.txt'), 'utf8');
  assert.equal(PARK.leoParkingRadius_m, Number(/LEO_PARKING_RADIUS_KM = ([\d_.]+)/.exec(ts)[1].replace(/_/g, '')) * 1000);
});

test('transcription: the AS-512 guidance and deviation figures hold together and agree with idea 35\'s transcription', () => {
  // IGM phase 1 at 204.1 s range time is 42.9 s into time base 3, which starts at S-IC outboard cutoff (Table 4-2: 161.20 s)
  near(G512.events.igmPhase1 - G512.events.igmPhase1FromBase, T512.cutoff.sicOeco.t, 1e-9, 'T3 = S-IC OECO');
  near(G512.events.siiCeco, T512.cutoff.siiCeco.t, 1e-9, 'S-II CECO in both tables');
  near(G512.events.siiOeco, T512.cutoff.siiOeco.t, 1e-9, 'S-II OECO in both tables');
  const sv = G512.deviations.sivb;
  for (const k of ['thrustLbf', 'ispLbfSLbm', 'loxFlowLbmS', 'fuelFlowLbmS', 'emr']) { const [p, r, d, pct] = sv[k]; near(r - p, d, 1e-9, k + ' deviation'); near(100 * d / p, pct, 0.006, k + ' percent'); }
  const s2 = G512.deviations.sii; near(100 * s2.thrustDevLbf / (s2.thrustLbf - s2.thrustDevLbf), s2.thrustPct, 0.005, 'S-II thrust percent');
  near(G512.sivbBurn1.fromSeparationVelocityS + G512.sivbBurn1.fromLowerPerformanceS, -G512.sivbBurn1.lessThanPredictedS, 1e-9, 'S-IVB burn shortfall split');
  near(G512.insertionVsPrediction.velocityFtS * 0.3048, G512.insertionVsPrediction.velocityMs, 0.002, '0.66 ft/s');
  near(G512.insertionVsPrediction.radiusFt * 0.3048, G512.insertionVsPrediction.radiusM, 0.05, '101.0 ft (the metres are printed to 0.1)');
  assert.ok(G512.density.maxPct <= G512.density.withinPct);
});

test('UPFG thrust integrals equal quadrature of their definitions and the document\'s two-step accumulation', () => {
  const ph = [{ tb: 40, tau: 300, ve: 4200, coastBefore: 0 }, { tb: 60, tau: 250, ve: 4100, coastBefore: 0 }, { tb: 200, tau: 700, ve: 4150, coastBefore: 6 }];
  const Lneed = 2500;
  const I = C.thrustIntegrals(ph, Lneed);
  // quadrature over the same schedule (the last phase cut where the velocity runs out)
  const segs = []; let t = 0; ph.forEach((p, i) => { t += p.coastBefore; segs.push({ t0: t, tb: I.tb[i], tau: p.tau, ve: p.ve }); t += I.tb[i] ?? 0; });
  const a = (s) => { for (const g of segs) if (s >= g.t0 && s < g.t0 + g.tb) return g.ve / (g.tau - (s - g.t0)); return 0; };
  const T = I.tgo; let L = 0, J = 0, H = 0, M3 = 0;
  for (const g of segs) { const N = 100000, h = g.tb / N; for (let i = 0; i < N; i++) { const s = g.t0 + (i + 0.5) * h, x = a(s); L += x * h; J += x * s * h; H += x * s * s * h; M3 += x * s * s * s * h; } }
  near(I.L, Lneed, 1e-6, 'L reaches |vgo| exactly'); near(L, I.L, 1e-3, 'L'); near(J, I.J, 0.05, 'J'); near(H, I.H, 5, 'H');
  near(T * L - J, I.S, 0.1, 'S = int int a'); near(T * J - H, I.Q, 5, 'Q = int int a s'); near(T * H - M3, I.P, 500, 'P = int int a s^2');
  // UPFG section 4.4, step 1 and step 2 as transcribed (snapshots/upfg-1973.txt), the coast before the last phase
  let Lt = 0, Jt = 0, St = 0, Qt = 0, Pt = 0, Ht = 0, tgoPrev = 0;
  ph.forEach((p, i) => {
    const tb = I.tb[i], tc = p.coastBefore, t0 = tgoPrev + tc;
    let Li = -p.ve * Math.log(1 - tb / p.tau), Ji = Li * p.tau - p.ve * tb, Si = -Ji + tb * Li;
    let Qi = Si * (p.tau + t0) - 0.5 * p.ve * tb * tb, Pi = Qi * (p.tau + t0) - 0.5 * p.ve * tb * tb * (tb / 3 + t0);
    Ji += Li * t0; Si += Lt * (tb + tc); Qi += Jt * (tb + tc); Pi += Ht * (tb + tc);
    Lt += Li; Jt += Ji; St += Si; Qt += Qi; Pt += Pi; tgoPrev = t0 + tb; Ht = tgoPrev * Jt - Qt;
  });
  near(St, I.S, 1e-6 * Math.abs(I.S), 'S two-step'); near(Qt, I.Q, 1e-6 * Math.abs(I.Q), 'Q two-step'); near(Pt, I.P, 1e-6 * Math.abs(I.P), 'P two-step'); near(Ht, I.H, 1e-6 * Math.abs(I.H), 'H = tgo J - Q');
  // short of propellant: tgo is every phase and the shortfall is reported
  const I2 = C.thrustIntegrals(ph.slice(0, 1), 5000);
  near(I2.tgo, 40, 1e-12, 'all of it'); near(I2.short, 5000 + 4200 * Math.log(1 - 40 / 300), 1e-9, 'short by the rest');
});

test('UPFG gravity: the special coasting trajectory\'s 1/10, 1/30, 6/5, 1/10 make its mean and time-weighted position error zero', () => {
  // derived for a cubic powered path r(0) = r, v(0) = v, r(T) = r + vT + R, v(T) = v + V (field-free); per component
  const T = 300, R = 4.2e5, V = 2600, rr = 1.2e6, vv = 3100;
  const Cc = (3 * R - V * T) / (T * T), Dd = (V * T - 2 * R) / (T * T * T);
  const rp = (t) => rr + vv * t + Cc * t * t + Dd * t * t * t;
  const rc1 = rr - R / 10 - V * T / 30, vc1 = vv + 1.2 * R / T - V / 10, rc = (t) => rc1 + vc1 * t;
  let i1 = 0, i2 = 0; const N = 100000;
  for (let i = 0; i < N; i++) { const t = (i + 0.5) * T / N, e = rc(t) - rp(t); i1 += e * T / N; i2 += e * (T - t) * T / N; }
  near(i1 / (R * T), 0, 1e-9, 'mean error'); near(i2 / (R * T * T), 0, 1e-9, 'weighted error');
});

test('the upper-stage loop is idea 35\'s: with idea 35\'s own steering it reproduces fly() to the last bit', () => {
  const plans = [CTX.plan, Object.assign({}, CTX.plan, { upper: { mode: 'gravity' } }), Object.assign({}, CTX.plan, { upper: { mode: 'hold', startDeg: 12 } })];
  for (const p of plans) {
    const a = A.fly(CTX.veh, CTX.engines, p, { samples: false }), b = C.flyClosed(CTX.veh, CTX.engines, p, { mode: 'maxq' }, null, { samples: false });
    if (!a.ok) { assert.equal(b.ok, false, p.upper.mode); continue; }
    assert.deepEqual(b.final.r, a.final.r, p.upper.mode + ' r'); assert.deepEqual(b.final.v, a.final.v, p.upper.mode + ' v'); assert.equal(b.final.mass, a.final.mass);
    assert.equal(b.losses.gravity, a.losses.gravity); assert.equal(b.lossesRel.steering, a.lossesRel.steering); assert.equal(b.t, a.t);
    assert.equal(b.stageEnds.length, a.stageEnds.length); b.stageEnds.forEach((e, i) => assert.equal(e.t, a.stageEnds[i].t));
  }
  const s35 = C.setup(JSON.parse(fs.readFileSync(path.join(MAXQ, 'handoff.json'), 'utf8')));
  const a = A.fly(s35.veh, s35.engines, s35.plan, { samples: false }), b = C.flyClosed(s35.veh, s35.engines, s35.plan, { mode: 'maxq' }, null, { samples: false });
  assert.deepEqual(b.final.r, a.final.r); assert.deepEqual(b.final.v, a.final.v);
});

// ---- flat-Earth set-up for the closed-form oracle
function flatKernel(c) {
  const R = 1e12, mu = c.g * R * R;
  const Af = MaxQ.create({ S, isa: pf.isa, g0: pf.ISA_G0, isaTop: { R0: pf.ISA_R0, HMAX: pf.ISA_H_MAX }, earth: EARTH, aero: AERO, engines34: DATA.engines34, as512: AS512, trajectory: T512, radius: R, mu, omega: 0 });
  const Cf = ClosedLoop.create({ A: Af, S, earth: EARTH, trajectory: T512, guidance512: G512, parking: PARK });
  const engines = { 'F-1': CTX.engines['F-1'], 'J-2': CTX.engines['J-2'] };
  assert.equal(engines['J-2'].thrustVac, c.thrustPerEngine_N); assert.equal(engines['J-2'].mdot, c.mdotPerEngine_kg_s);
  const P = 0.6 * c.m0_kg, Dm = 0.05 * c.m0_kg;
  const veh = { id: 'flat', stages: [{ label: 'dummy', engine: 'F-1', count: 1, dry: 1e-6, remaining: 0, burns: [{ propellant: 1e-6 }] }, { label: 'burn', engine: 'J-2', count: c.engines, dry: Dm, remaining: 0, burns: [{ propellant: P }] }], payload: { mass: c.m0_kg - Dm - P } };
  const ledger = S.evaluate(veh, engines, { timeline: false });
  const plan = { site: { id: 'flat', latitudeDeg: 0 }, azimuthDeg: 90, stagingCoast: [0], flowScale: [1, 1], drag: 'none', dragScale: 0, diameter: 1, rotation: false, gravity: 'uniform', dt: { atmosphere: 0.2, vacuum: 1 }, upper: { mode: 'linear', startDeg: 0, endDeg: 0 } };
  const zero = { ideal: 0, pressure: 0, drag: 0, gravity: 0, steering: 0, dragOutsideData: 0, centrifugal: 0 };
  const r1 = { ok: true, refusals: [], warnings: [], ledger, t: 0, final: { r: [R + c.y0_m, 0, 0], v: [c.vy0_m_s, c.vx0_m_s, 0], mass: c.m0_kg + 1e-6, altitude: c.y0_m }, losses: zero, lossesRel: zero, stageEnds: [{ burnTime: 0, label: 'dummy', state: {} }] };
  const rd = R + c.yT_m, vd = c.vxT_m_s;
  const tgt = { rd, vd, gammaD: 0, n: [0, 0, 1], iy: [0, 0, -1], energy: vd * vd / 2 - mu / rd, perigeeAlt: c.yT_m, apogeeAlt: c.yT_m, inclinationDeg: 0, a: rd };
  return (cycle) => Cf.flyClosed(veh, engines, plan, { mode: 'upfg', startAfter: 0, cycle }, tgt, { samples: true, stage1: r1, flyShort: true });
}

test('oracle, closed form: over a flat Earth UPFG converges on the minimum-time linear-tangent burn', () => {
  assert.ok(ORACLE, 'oracle/guidance-oracle.json is present');
  const c = CASES.flat.gentle, O = ORACLE.flat.gentle.linear_tangent;
  // the oracle's own two methods agree (the law from the optimality conditions, and a direct optimisation with no form assumed)
  const Dd = ORACLE.flat.gentle.direct;
  assert.ok(Dd.max_constraint < 1e-6 && Dd.T_s >= O.T_s - 1e-3, 'oracle: a direct burn with no assumed form meets the target and does not beat the linear tangent');
  const fly = flatKernel(c);
  for (const [cyc, tolT] of [[0.5, 0.004], [2, 0.012]]) {
    const r = fly(cyc);
    assert.ok(r.ok && r.endedBy === 'guidance', 'cut off by guidance at cycle ' + cyc);
    near(r.t, O.T_s, tolT, 'burn time, cycle ' + cyc);
    near(r.final.altitude, c.yT_m, 0.2, 'altitude'); near(r.final.v[0], 0, 0.1, 'vertical speed'); near(r.final.v[1], c.vxT_m_s, 0.01, 'horizontal speed');
    // UPFG's first command is 0.76 deg steeper than the optimum's (its small-angle bias terms over a 35 deg sweep); later
    // cycles correct it, as the burn time shows
    near(r.samples.find((s) => s.pitch != null).pitch, O.pitch0_deg, 1.0, 'first pitch');
  }
  // steep: the optimal burn sweeps about 125 deg; UPFG's small-angle bias terms cannot carry it, and the kernel must not
  // pretend it did
  const steep = flatKernel(CASES.flat.steep)(2);
  assert.ok(ORACLE.flat.steep.linear_tangent.T_s > 0);
  assert.notEqual(steep.endedBy, 'guidance', 'no false success on the steep case');
  assert.ok(steep.refusals.length > 0);
});

test('oracle, envelope: as the optimal thrust turns through 35 to 125 deg, UPFG never beats the optimum, and where it misses it says so', () => {
  // oracle/envelope-oracle.json: a second, standard-library oracle (linear_tangent_stdlib.py: its own RK4 and Newton
  // shooting) over the gentle case with climbs of 5 to 20 km. Added by the review: the README's envelope was from trials
  // not kept in the folder, and the kernel's refusal on a miss used to blame the propellant.
  const E = JSON.parse(fs.readFileSync(path.join(here, 'oracle', 'envelope-oracle.json'), 'utf8'));
  near(E.cases[0].T_s, ORACLE.flat.gentle.linear_tangent.T_s, 1e-6, 'the two oracles agree: gentle T*');
  near(E.cases[E.cases.length - 1].T_s, ORACLE.flat.steep.linear_tangent.T_s, 1e-6, 'the two oracles agree: steep T*');
  const seen = {};
  for (const ec of E.cases) for (const cyc of [2, 1, 0.5]) {
    const c = Object.assign({}, CASES.flat.gentle, { yT_m: ec.yT_m }), r = flatKernel(c)(cyc), hit = r.ok && r.endedBy === 'guidance';
    if (hit) {
      assert.ok(r.t >= ec.T_s - 1e-3, `never beats the optimum: ${r.t} vs ${ec.T_s}`);
      if (ec.sweep_deg < 106) { near(r.final.altitude, ec.yT_m, 0.5, 'altitude'); near(r.final.v[0], 0, 0.5, 'vertical speed'); near(r.final.v[1], c.vxT_m_s, 0.01, 'horizontal speed'); }
    } else assert.match(r.refusals[0].reason, /guidance diverged|cannot steer/, 'a miss says guidance may have diverged');
    seen[ec.climb_m + '@' + cyc] = hit ? r.t - ec.T_s : 'miss';
  }
  // the envelope, as measured here (README): a 2 s cycle reaches a 94 deg turn (1.0 s late) and misses at 104; a 1 s cycle
  // reaches 104 (1.2 s late) and misses at 113; 0.5 s reaches 119 (7.6 s late) and misses at 125
  assert.ok(seen['12000@2'] < 1.1 && seen['14000@2'] === 'miss' && seen['14000@1'] < 1.3 && seen['16000@1'] === 'miss' && seen['18000@0.5'] < 8 && seen['20000@0.5'] === 'miss', JSON.stringify(seen));
});

test('oracle, replay: the guided AS-512 upper stages re-flown by scipy with their own bookkeeping land where the kernel did', () => {
  assert.ok(ORACLE, 'oracle/guidance-oracle.json is present');
  const R = ORACLE.replay, f = G.final;
  near(G.stageEnds[1].t, R.sII_cutoff_s, 1e-6, 'S-II depletion time');
  // measured: 2.3 micrometres, 2.2e-7 m/s, 1e-9 kg (tolerances about 40 times that)
  near(Math.hypot(...f.r), R.radius_m, 1e-4, 'radius at cutoff');
  near(f.speed, R.speed_m_s, 1e-5, 'speed at cutoff');
  near(f.mass, R.mass_kg, 1e-6, 'mass at cutoff');
  for (let i = 0; i < 3; i++) { near(f.r[i], R.r_m[i], 1e-4, 'r' + i); near(f.v[i], R.v_m_s[i], 1e-4, 'v' + i); }
  near(R.mass_after_sII_cutoff_kg, G.stageEnds[1].state.mass - CTX.veh.stages[1].dry - CTX.veh.stages[1].remaining, 1e-6, 'staging drop');
  near(R.energy_m2_s2, RUN.target.energy, 1e-3, 'the oracle confirms the cutoff energy is the target\'s');
});

test('oracle, optimum: UPFG gives away about a kilogram of S-IVB propellant against the best steering a direct optimiser finds', () => {
  assert.ok(ORACLE, 'oracle/guidance-oracle.json is present');
  const best = ORACLE.optimum[ORACLE.optimum.length - 1], used = G.guided.propellantUsed;
  assert.ok(best.max_constraint < 1e-6, 'optimum meets the target');
  const ks = ORACLE.optimum.map((o) => o.sIVB_propellant_kg);
  near(ks[ks.length - 1], ks[ks.length - 2], 2, 'optimum converged in K');
  assert.ok(used >= best.sIVB_propellant_kg - 0.5, 'UPFG is not better than the optimum');
  assert.ok(used - best.sIVB_propellant_kg < 10, 'UPFG within 10 kg of the optimum: ' + (used - best.sIVB_propellant_kg));
});

test('target geometry: the plane passes over the pad at liftoff with the inclination asked; refusals where no plane exists', () => {
  const lat = 28.5, t = C.targetOrbit({ perigeeAlt: 200e3, apogeeAlt: 300e3, inclinationDeg: 32, branch: 'north' }, lat);
  const r0 = [Math.cos(lat * Math.PI / 180), 0, Math.sin(lat * Math.PI / 180)];
  near(t.n[0] * r0[0] + t.n[2] * r0[2], 0, 1e-15, 'pad in plane'); near(Math.acos(t.n[2]) * 180 / Math.PI, 32, 1e-12, 'inclination');
  near(Math.sin(t.inertialAzimuthDeg * Math.PI / 180), Math.cos(32 * Math.PI / 180) / Math.cos(lat * Math.PI / 180), 1e-14, 'sin(azimuth) = cos i / cos latitude');
  near(t.vd, Math.sqrt(C.constants.MU * (2 / t.rd - 2 / (2 * C.constants.RE + 500e3))), 1e-9, 'vis-viva at perigee');
  const s = C.targetOrbit({ perigeeAlt: 200e3, apogeeAlt: 300e3, inclinationDeg: 32, branch: 'south' }, lat);
  near(s.inertialAzimuthDeg, 180 - t.inertialAzimuthDeg, 1e-12, 'south branch mirrors');
  // the heading over the ground at insertion speed: the pad's eastward speed taken out of the inertial heading, so Earth's
  // rotation turns a north-branch track further north and a south-branch one further south (review: the sign was untested)
  const vE = C.constants.OMEGA * C.constants.RE * Math.cos(lat * Math.PI / 180), bN = t.inertialAzimuthDeg * Math.PI / 180;
  near(t.groundAzimuthDeg, Math.atan2(t.vd * Math.sin(bN) - vE, t.vd * Math.cos(bN)) * 180 / Math.PI, 1e-9, 'ground azimuth');
  assert.ok(t.groundAzimuthDeg < t.inertialAzimuthDeg - 0.5 && s.groundAzimuthDeg > s.inertialAzimuthDeg + 0.5, 'rotation turns the ground track away from east');
  const eq = C.targetOrbit({ perigeeAlt: 200e3, apogeeAlt: 200e3, inclinationDeg: lat, branch: 'north' }, lat); near(eq.inertialAzimuthDeg, 90, 1e-6, 'due east at i = latitude');
  for (const [spec, re] of [[{ perigeeAlt: 200e3, apogeeAlt: 200e3, inclinationDeg: 20 }, /cannot be inclined less/], [{ perigeeAlt: 50e3, apogeeAlt: 200e3, inclinationDeg: 30 }, /inside the atmosphere/],
    [{ perigeeAlt: 300e3, apogeeAlt: 200e3, inclinationDeg: 30 }, /at least the perigee/], [{ perigeeAlt: NaN, apogeeAlt: 200e3, inclinationDeg: 30 }, /numbers/]]) {
    const r = C.targetOrbit(spec, lat); assert.ok(r.refusal && re.test(r.refusal.reason), JSON.stringify(spec));
  }
});

test('AS-512 guided: it reaches Table 4-4\'s orbit, cut off on the target energy, from Table 2-2\'s guidance start', () => {
  assert.ok(G.ok && G.inOrbit && G.endedBy === 'guidance'); assert.equal(G.refusals.length, 0);
  near(G.guidanceStart + A.as512T0(), G512.events.igmPhase1, 1e-9, 'IGM start, range time');
  near(G.errors.radius, 0, 0.05, 'radius'); near(G.errors.speed, 0, 1e-3, 'speed'); near(G.errors.fpaDeg, 0, 1e-3, 'flight-path angle');
  near(G.errors.inclinationDeg, 0, 1e-6, 'inclination'); near(G.errors.planeDeg, 0, 1e-6, 'plane');
  near(G.orbit.perigeeAlt / 1000, T512.insertion.perigeeKm, 0.01, 'perigee'); near(G.orbit.apogeeAlt / 1000, T512.insertion.apogeeKm, 0.01, 'apogee');
  const E = G.final.speed ** 2 / 2 - C.constants.MU / Math.hypot(...G.final.r); near(E, RUN.target.energy, 1e-6 * Math.abs(E), 'energy cutoff');
  // the undispersed open-loop replay of these commands lands on the same state
  near(Math.hypot(...RUN.replay.final.r), Math.hypot(...G.final.r), 1e-3, 'replay radius'); near(RUN.replay.final.speed, G.final.speed, 1e-5, 'replay speed');
  // idea 35's open-loop programme on the same plan does not reach orbit
  assert.ok(RUN.openLoop.refusals.some((x) => x.applies_to === 'orbit'));
  // the charted yaw is the thrust's angle out of the target plane, positive toward the orbit normal: re-derived from the
  // commands (review: its sign was untested); guidance yaws by up to about 0.15 deg to leave idea 35's launch plane
  const cmdAt = (tt) => { let u = null; for (const c of G.commands) { if (c.t <= tt + 1e-9) u = c.u; else break; } return u; };
  const n = RUN.target.n; let maxYaw = 0;
  for (const s of G.samples.filter((x) => x.yaw != null && x.t > G.guidanceStart + 0.5)) {
    const u = cmdAt(s.t); near(s.yaw, Math.asin(u[0] * n[0] + u[1] * n[1] + u[2] * n[2]) * 180 / Math.PI, 0.005, 'yaw at ' + s.t); maxYaw = Math.max(maxYaw, Math.abs(s.yaw));
  }
  assert.ok(maxYaw > 0.05, 'a yaw large enough for its sign to matter: ' + maxYaw);
});

test('AS-512 guided against the flight report: the gaps, pinned', () => {
  const rows = C.as512Rows(CTX, RUN), g = (grp, lab) => rows.find((r) => r.group === grp && r.label === lab);
  near(g('S-II cutoff', 'Altitude').gap, -3.596, 0.01, 'S-II cutoff altitude, km');
  near(g('S-II cutoff', 'Space-fixed velocity').gap, -63.50, 0.05, 'S-II cutoff speed');
  near(g('S-II cutoff', 'Time').gap, -11.36, 0.01, 'S-II cutoff time');
  near(g('S-IVB first cutoff', 'Propellant burned').model, 32897.0, 0.5, 'S-IVB propellant'); assert.equal(g('S-IVB first cutoff', 'Propellant burned').flight, 30006);
  near(g('S-IVB first cutoff', 'Burn time').gap, -5.49, 0.01, 'S-IVB burn time');
  near(g('Left for the departure burn', 'S-IVB propellant').gap, -2891.0, 0.5, 'left for TLI');
  near(g('S-IVB first cutoff', 'Space-fixed velocity').gap, 1.98, 0.01, 'cutoff speed vs Table 4-2');
  // idea 35's open loop on the same plan: 182.8 m/s short of the flight's cutoff speed
  near(T512.cutoff.sivb1Gcs.v - RUN.openLoop.final.speed, 182.8, 0.05, 'open loop shortfall');
});

test('Monte Carlo: reproducible from its seed, normal draws, the closed loop on target and the open loop scattered', () => {
  const run = (seed, n) => { const m = C.monteCarlo(CTX, RUN, { n, seed, sigmaScale: 1 }); m.step(n); return m; };
  const a = run(5, 40), b = run(5, 40), c = run(6, 40);
  assert.deepEqual(a.result(), b.result()); assert.notDeepEqual(a.result().guided.propellantLeft, c.result().guided.propellantLeft);
  const z = []; const gen = ClosedLoop.normals(ClosedLoop.rng(9)); for (let i = 0; i < 20000; i++) z.push(gen());
  const st = ClosedLoop.stats(z); near(st.mean, 0, 0.03, 'mean'); near(st.sd, 1, 0.03, 'sd');
  const r = a.result();
  assert.equal(r.guided.onTarget, 40, 'guided on target every time');
  assert.ok(r.replay.inOrbit < r.guided.inOrbit, 'open loop misses sometimes');
  assert.ok(r.guided.inclination.sd < 1e-6 && r.replay.inclination.sd > 100 * r.guided.inclination.sd, 'plane scatter');
  assert.ok(r.replay.perigee.sd > 1000 * r.guided.perigee.sd, 'perigee scatter');
  assert.ok(r.reserve && r.reserve.threeSigma > 0 && r.guided.propellantLeft.mean < r.reserve.nominalLeft, 'dispersions cost propellant on average');
});

test('Monte Carlo summary: on target means in orbit and cut off by guidance; the reserve is three sample standard deviations', () => {
  // review: these definitions were pinned only through the committed handoff (a regression snapshot), or not at all
  const base = { ok: true, inOrbit: true, orbit: { perigeeAlt: 2e5, apogeeAlt: 2e5, bound: true, inclinationDeg: 28.5 }, errors: null, guided: { propellantLeft: 1 }, t: 1, stage1: { stageEnds: [{ burnTime: 1 }] } };
  assert.equal(C.metricsOf(Object.assign({}, base, { endedBy: 'guidance' })).onTarget, true);
  assert.equal(C.metricsOf(Object.assign({}, base, { endedBy: 'depletion' })).onTarget, false, 'in orbit but out of propellant is not on target');
  assert.equal(C.metricsOf(Object.assign({}, base, { endedBy: 'guidance', inOrbit: false })).onTarget, false, 'cut off by guidance but not in orbit');
  // propellant left 10, 12, 14 and 18 kg against a nominal 20: mean 13.5, sample variance 35/3, worst flight 10 kg short
  const mk = (p) => ({ guided: C.metricsOf(Object.assign({}, base, { endedBy: 'guidance', guided: { propellantLeft: p } })), replay: { ok: false } });
  const res = C.summarise([10, 12, 14, 18].map(mk), { guided: { ok: true, guided: { propellantLeft: 20 } } }, [], 1, 1);
  near(res.reserve.mean, 13.5, 1e-12, 'mean'); near(res.reserve.sd, Math.sqrt(35 / 3), 1e-12, 'sample sd (n - 1)');
  near(res.reserve.threeSigma, 3 * Math.sqrt(35 / 3), 1e-12, 'three sigma'); near(res.reserve.worstUse, 10, 1e-12, 'worst');
  assert.equal(res.guided.onTarget, 4); assert.equal(res.replay.flown, 0);
});

test('dispersions: each row moves exactly the quantity it names, by its sigma times the draw', () => {
  const tab = C.dispersionTable(CTX.veh), sig = (k) => tab.find((r) => r.key === k).sigma;
  assert.equal(tab.length, 4 * CTX.veh.stages.length + 1);
  near(sig('flow2'), Math.abs((401.26 + 79.96) / (403.40 + 80.37) - 1), 1e-12, 'S-IVB flow from Table 7-1\'s two flows');
  const d = C.disperse(CTX, tab, { flow1: 2, isp0: -1, prop2: 1, dry1: -2, density: 1.5 }, 3);
  near(d.plan.flowScale[1] / CTX.plan.flowScale[1], 1 + 2 * 3 * sig('flow1'), 1e-12, 'flow');
  const e0 = d.engines[d.veh.stages[0].engine], n0 = CTX.engines[CTX.veh.stages[0].engine];
  near(e0.thrustVac / n0.thrustVac, 1 - 3 * sig('isp0'), 1e-12, 'isp: vacuum thrust'); assert.equal(e0.mdot, n0.mdot, 'isp: flow unchanged');
  near(e0.deckVac.thrust_vac[e0.deckVac.throttle.indexOf(1)], e0.thrustVac, 1e-6, 'isp: the deck moves with it');
  near(e0.thrustSL - n0.thrustSL, e0.thrustVac - n0.thrustVac, 1e-6, 'isp: sea-level thrust moves by the same newtons');
  assert.equal(d.veh.stages[1].engine, CTX.veh.stages[1].engine, 'isp of one stage leaves the others\' engines alone');
  d.veh.stages[2].burns.forEach((b, i) => near(b.propellant / CTX.veh.stages[2].burns[i].propellant, 1 + 3 * sig('prop2'), 1e-12, 'propellant, every burn'));
  near(d.veh.stages[1].dry / CTX.veh.stages[1].dry, 1 - 2 * 3 * sig('dry1'), 1e-12, 'dry');
  near(d.plan.dragScale / CTX.plan.dragScale, 1 + 1.5 * 3 * sig('density'), 1e-12, 'density');
  assert.equal(CTX.veh.stages[1].dry, C.setup(DATA.as512).veh.stages[1].dry, 'the nominal set-up is untouched');
});

test('Monte Carlo against linear covariance in the regime where it is linear (upper-stage dispersions only)', () => {
  const table = C.dispersionTable(CTX.veh).map((row) => Object.assign({}, row, { sigma: row.stage === 0 || row.kind === 'density' ? 0 : row.sigma * 3 }));
  const sens = C.sensitivities(CTX, RUN, { table, sigmaScale: 1 });
  const m = C.monteCarlo(CTX, RUN, { n: 150, seed: 2, sigmaScale: 1, table }); m.step(150);
  const sd = m.result().guided.propellantLeft.sd;
  assert.ok(Math.abs(sd / sens.total.propellantLeft - 1) < 0.2, `MC sd ${sd} vs RSS ${sens.total.propellantLeft}`);
  // and the first stage is not linear: S-IC flow costs propellant whichever way it goes
  const full = C.sensitivities(CTX, RUN, { sigmaScale: 4 });
  const f0 = full.rows.find((x) => x.key === 'flow0');
  assert.ok(Math.abs(f0.propellantLeft) < 0.2 * Math.abs(f0.both[0]) && f0.both[0] < 0 && f0.both[1] < 0, 'both sides lose: ' + JSON.stringify(f0.both));
  // at AS-512's sizes the S-IC propellant row is two-sided: less propellant leaves less, more leaves more
  const one = C.sensitivities(CTX, RUN, {}).rows.find((x) => x.key === 'prop0');
  assert.ok(one.both[0] < -100 && one.both[1] > 100, 'S-IC propellant at -1 and +1 sigma: ' + JSON.stringify(one.both));
});

test('MSFC calibration: three of the scaled S-IC burn-time sigma is the report\'s mean half-band, and Monte Carlo agrees', () => {
  const tab = C.dispersionTable(CTX.veh), ms = C.msfcScale(CTX, tab);
  near(3 * ms.sigma1 * ms.scale, (G512.deviations.sic.oeco3SigmaS[0] - G512.deviations.sic.oeco3SigmaS[1]) / 2, 1e-9, 'definition');
  const m = C.monteCarlo(CTX, RUN, { n: 80, seed: 3, sigmaScale: ms.scale }); m.step(80);
  const sd = m.result().guided.stage1T.sd;
  assert.ok(Math.abs(sd / (ms.sigma1 * ms.scale) - 1) < 0.25, `S-IC burn time sd ${sd} vs ${ms.sigma1 * ms.scale}`);
});

test('refusals: unreachable targets, vehicles that cannot be guided, and handoffs that are not vehicles', () => {
  const s35 = C.setup(JSON.parse(fs.readFileSync(path.join(MAXQ, 'handoff.json'), 'utf8')));
  const far = Object.assign({}, s35, { target: Object.assign({}, s35.target, { inclinationDeg: 40 }) });
  const r = C.run(far, { samples: false });
  assert.equal(r.guided.ok, false); assert.match(r.guided.refusals[0].reason, /short of this target/); assert.ok(r.guided.refusals[0].short_m_s > 1);
  const low = Object.assign({}, CTX, { target: Object.assign({}, CTX.target, { inclinationDeg: 20 }) });
  assert.match(C.run(low, { samples: false }).guided.refusals[0].reason, /cannot be inclined less/);
  const one = JSON.parse(JSON.stringify(CTX)); one.veh.stages = one.veh.stages.slice(0, 1); one.engines = CTX.engines;
  const o1 = C.flyClosed(one.veh, one.engines, CTX.plan, { mode: 'upfg', startAfter: 0, cycle: 2 }, RUN.target, { samples: false });
  assert.equal(o1.ok, false);
  // an S-II at 62 % thrust: guidance keeps the vehicle up but finds the target out of reach in flight, holds attitude and
  // burns to depletion; the flight is refused as not in orbit, with the shortfall
  const weak = C.disperse(CTX, C.dispersionTable(CTX.veh), { flow1: -200 }, 1);
  const w = C.flyClosed(weak.veh, weak.engines, weak.plan, { mode: 'upfg', startAfter: 42.9, cycle: 2 }, RUN.target, { samples: false });
  assert.equal(w.inOrbit, false); assert.match(w.refusals[0].reason, /Not in orbit.*out of reach/); assert.ok(w.outOfReach && w.outOfReach.short > 0);
  // idea 35's sample at 38 deg: guidance dives for the plane and the upper stage falls back: refused as falling back
  const fb = C.run(Object.assign({}, s35, { target: Object.assign({}, s35.target, { inclinationDeg: 38 }) }), { samples: false }).guided;
  assert.equal(fb.ok, false); assert.match(fb.refusals[0].reason, /fall back/);
  // AS-512 with a 2.2 deg kick: the S-IC ends at 32 km, nearly level. With guidance at 42.9 s the stage has sunk to 28 km
  // and UPFG's first call does not settle: refused as guidance unable to steer (review: this used to hold the attitude
  // silently and report the fall-back that followed as if guidance had flown it)
  const lo = C.setup(DATA.as512); lo.plan.kickDeg = 2.2;
  const lr = C.run(lo, { samples: false }).guided;
  assert.equal(lr.ok, false); assert.equal(lr.refusals[0].applies_to, 'guidance'); assert.match(lr.refusals[0].reason, /first call does not settle in 60 passes/);
  assert.equal(lr.guidance.converged, false);
  // the same with guidance due at 80 s: the S-II sinks 10 km below the S-IC cutoff before guidance starts: refused as falling
  // back, before any nozzle separates or anything reaches the ground, and the refusal says guidance had not started
  const lo2 = C.setup(DATA.as512); lo2.plan.kickDeg = 2.2; lo2.guidance.startAfter = 80;
  const lr2 = C.run(lo2, { samples: false }).guided;
  assert.equal(lr2.ok, false); assert.match(lr2.refusals[0].reason, /fall back \(below 22\.1 km.*Guidance had not started/);
  // a guidance start after the upper stages burn out is refused, not reported as guidance running out of propellant
  const late = C.setup(DATA.as512); late.guidance.startAfter = 1000;
  assert.match(C.run(late, { samples: false }).guided.refusals[0].reason, /Guidance never starts/);
  // guidance settings arrive in imported handoffs too: a cycle outside 0.5 to 4 s, or a negative or missing start, is refused
  for (const [k, v] of [['cycle', 0.1], ['cycle', -1], ['cycle', 5], ['cycle', 'abc'], ['startAfter', -5], ['startAfter', NaN]]) {
    const c = C.setup(DATA.as512); c.guidance[k] = v; const g = C.run(c, { samples: false }).guided;
    assert.equal(g.ok, false, k + ' ' + v); assert.equal(g.refusals[0].code, 'invalid_input'); assert.equal(g.refusals[0].applies_to, 'guidance');
  }
  assert.match(C.setup('nope').refusal.reason, /not JSON/);
  assert.match(C.setup({ handoff: 'long-way-round', from: '33-engine-deck' }).refusal.reason, /engine/);
  assert.match(C.setup({ handoff: 'other' }).refusal.reason, /not a Long Way Round/);
});

test('handoff: every output carries units, confidence and source; it round-trips; an edit is refused; it carries idea 35\'s', () => {
  const h = JSON.parse(fs.readFileSync(path.join(here, 'handoff.json'), 'utf8'));
  const h35 = JSON.parse(fs.readFileSync(path.join(MAXQ, 'handoff.json'), 'utf8'));
  assert.deepEqual(h.inputs.ascent_handoff, h35, 'the committed idea 35 sample, whole');
  assert.equal(h.from, '36-closed-loop'); assert.equal(h.version, 1);
  for (const [k, o] of Object.entries(h.outputs)) assert.ok(o.units && ['measured', 'derived', 'assumed'].includes(o.confidence) && o.source, k);
  assert.ok(!h.refusals.some((x) => x.applies_to === 'guidance'), 'idea 35\'s guidance refusal is answered here');
  for (const k of ['navigation', 'dispersions']) assert.ok(h.refusals.some((x) => x.applies_to === k), k);
  const back = C.parseHandoff(h); assert.ok(!back.refusal, back.refusal && back.refusal.reason);
  const ed = JSON.parse(JSON.stringify(h)); ed.outputs.parking_orbit.value.apogee_altitude_m += 5; assert.match(C.parseHandoff(ed).refusal.reason, /edited/);
  const ed2 = JSON.parse(JSON.stringify(h)); ed2.outputs.propellant_left_in_guided_stage.value -= 100; assert.match(C.parseHandoff(ed2).refusal.reason, /edited/);
  const ed3 = JSON.parse(JSON.stringify(h)); ed3.inputs.ascent_handoff.outputs.burnout_altitude.value += 1; assert.ok(C.parseHandoff(ed3).refusal, 'an edited idea 35 inside is refused by idea 35\'s own check');
  // review: only four numbers used to be compared; every output, the refusals and the scatter are now re-made and compared
  for (const [what, f] of [
    ['insertion state', (e) => { e.outputs.insertion_state.value.r_m[0] += 1000; }],
    ['departure-burn propellant', (e) => { e.outputs.remaining_burns.value[0].propellant += 1000; }],
    ['target speed', (e) => { e.outputs.target_orbit.value.cutoff_speed_m_s += 1; }],
    ['parking orbit deleted', (e) => { delete e.outputs.parking_orbit; e.outputs.propellant_left_in_guided_stage.value += 1000; }],
    ['guidance cycle', (e) => { e.inputs.guidance.cycle_s = 1; }],
    ['a refusal removed', (e) => { e.refusals = e.refusals.filter((x) => x.applies_to !== 'navigation'); }],
    ['the reserve', (e) => { e.outputs.scatter.value.reserve_3sd_kg /= 2; }],
    ['a sigma', (e) => { e.outputs.scatter.value.sigmas[0].sigma *= 2; }],
  ]) { const e = JSON.parse(JSON.stringify(h)); f(e); const r = C.parseHandoff(e); assert.ok(r.refusal && /edited/.test(r.refusal.reason), what + ': ' + (r.refusal ? r.refusal.reason : 'accepted')); }
  const bad = JSON.parse(JSON.stringify(h)); bad.inputs.guidance.cycle_s = -1; assert.match(C.parseHandoff(bad).refusal.reason, /edited|cycle/);
  // the committed file is what the kernel computes for it
  return import('./build-sample.mjs').then((mod) => { const s = mod.sample(h35); assert.deepEqual(JSON.parse(JSON.stringify(s.handoff)), h); });
});

test('handoff for AS-512: the departure burn gets what the guided S-IVB left, and the chain is 36 -> 35 -> 34', () => {
  const h = C.makeHandoff(CTX, RUN, null, { produced: 'x' });
  assert.equal(h.inputs.ascent_handoff.from, '35-max-q'); assert.equal(h.inputs.ascent_handoff.inputs.vehicle_handoff.from, '34-stack');
  const rb = h.outputs.remaining_burns.value; assert.equal(rb.length, 1);
  near(rb[0].propellant, G.guided.propellantLeft, 1e-9, 'burn 2 gets the rest'); assert.equal(rb[0].propellant_planned, 73828);
  near(rb[0].propellant + G.guided.propellantUsed, 30006 + 73828, 1e-6, 'S-IVB propellant conserved');
  assert.ok(!A.parseHandoff(h.inputs.ascent_handoff).refusal, 'the idea 35 handoff it carries is one idea 35 accepts');
  // the ascending node handed to module 37: a point on the equator that lies in the orbit plane, where the motion is
  // northward (review: its formula was pinned only through the committed handoff)
  const Om = h.outputs.parking_orbit.value.ascending_node_from_launch_meridian_deg * Math.PI / 180, N = [Math.cos(Om), Math.sin(Om), 0];
  const f = h.outputs.insertion_state.value, nh = [f.r_m[1] * f.v_m_s[2] - f.r_m[2] * f.v_m_s[1], f.r_m[2] * f.v_m_s[0] - f.r_m[0] * f.v_m_s[2], f.r_m[0] * f.v_m_s[1] - f.r_m[1] * f.v_m_s[0]];
  near((N[0] * nh[0] + N[1] * nh[1]) / Math.hypot(...nh), 0, 1e-12, 'node in the orbit plane');
  assert.ok(nh[0] * N[1] - nh[1] * N[0] > 0, 'moving north there');
});
