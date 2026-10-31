// Tests for idea 35 (Max Q). node --test ideas/35-max-q/ascent.test.mjs
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
const { A, S, MaxQ, T512, AS512, EARTH, AERO, pf } = L;
const BANK = path.join(here, '..', '..');
const DEG = Math.PI / 180;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} got ${a}, want ${b} +- ${tol}`);
const rel = (a, b, tol, msg) => assert.ok(Math.abs(a / b - 1) <= tol, `${msg || ''} got ${a}, want ${b} (rel ${tol})`);
const as512 = () => A.vehicleFromHandoff(L.H34AS512);
function as512Plan(cal = true) {
  const v = as512(), p = A.defaultPlan(v.vehicle);
  if (cal) p.flowScale = [A.as512FlowScale(v.engines), 1, 1];
  p.kickDeg = A.solveKick(v.vehicle, v.engines, p, T512.cutoff.sicOeco.fpa).kickDeg; p.fitKick = true;
  p.upper.startDeg = A.solveInsertion(v.vehicle, v.engines, p).pitchDeg; p.fitInsertion = true;
  return { v, p };
}

// ------------------------------------------------------------------ snapshots
test('snapshots: copies are byte-identical to their committed sources, and every sidecar hash matches', () => {
  const pairs = [['snapshots/stack.js', '../34-stack/stack.js'], ['snapshots/isa.js', '../34-stack/snapshots/isa.js'], ['snapshots/as512-flight.js', '../34-stack/snapshots/as512-flight.js']];
  for (const [a, b] of pairs) assert.equal(fs.readFileSync(path.join(here, a), 'utf8'), fs.readFileSync(path.join(here, b), 'utf8'), a);
  assert.deepEqual(L.H34, JSON.parse(fs.readFileSync(path.join(here, '../34-stack/handoff.json'), 'utf8')), 'idea 34\'s sample handoff, unchanged');
  for (const f of fs.readdirSync(path.join(here, 'snapshots'))) {
    if (f.endsWith('.provenance.json')) continue;
    const side = JSON.parse(fs.readFileSync(path.join(here, 'snapshots', f + '.provenance.json'), 'utf8'));
    assert.ok(side.repo && side.path && side.commit, f + ' sidecar keys');
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(here, 'snapshots', f))).digest('hex'), side.writtenSha256, f + ' sha256');
  }
});
test('snapshots: Earth constants are the numbers in the verbatim Aster texts', () => {
  const dv = fs.readFileSync(path.join(here, 'snapshots/aster-delta-v.ts.txt'), 'utf8');
  assert.match(dv, /EARTH_MU_KM3_PER_S2 = 398_600\.4418;/);
  assert.equal(EARTH.mu_m3_s2, 398600.4418e9);
  const pck = fs.readFileSync(path.join(here, 'snapshots/pck00010-earth.txt'), 'utf8');
  assert.match(pck, /3362:\s+BODY399_RADII\s+= \( 6378\.1366/);
  assert.match(pck, /BODY399_PM\s+= \(\s+190\.147\s+360\.9856235/);
  assert.equal(EARTH.radius_m, 6378136.6);
  rel(EARTH.omega_rad_s, 360.9856235 * Math.PI / 180 / 86400, 1e-15);
  const fe = fs.readFileSync(path.join(here, 'snapshots/aster-feasibility.ts.txt'), 'utf8');
  assert.match(fe, /latitudeDeg: 28\.5,/); assert.match(fe, /Azimuths 35-120 deg/);
  assert.deepEqual(EARTH.sites['cape-canaveral'].azimuthCorridorDeg, [35, 120]);
  // idea 34's derived engine and AS-512 files are what idea 34's committed kernel exports (re-run here)
  const L34 = require(path.join(here, '..', '34-stack', 'load.cjs'));
  const veh = L34.S.fromAS512(L34.AS512), eng = L34.S.as512Engines();
  const h = L34.S.makeHandoff(veh, eng, L34.S.evaluate(veh, eng), { produced: '2026-10-31T12:00:00Z' });
  assert.equal(JSON.stringify(h), JSON.stringify(L.H34AS512));
  for (const id of L34.S.PRESET_ENGINES) assert.equal(L.ENG34[id].thrust_vacuum_N, L34.S.engineFromPreset(id).thrustVac, id);
});

// ------------------------------------------------------------------ the two transcriptions
test('AS-512 trajectory transcription: every m/s against its ft/s, km against n mi, and the reconstructed entries', () => {
  const FT = 0.3048, NMI = 1.852;
  const C = T512.cutoff;
  for (const k of Object.keys(C)) { near(C[k].vFt * FT, C[k].v, 0.06, k + ' velocity'); if (C[k].altNmi) near(C[k].altNmi * NMI, C[k].altKm, 0.1, k + ' altitude'); if (C[k].rangeNmi) near(C[k].rangeNmi * NMI, C[k].rangeKm, 0.1, k + ' range'); }
  const I = T512.insertion;
  near(I.vFt * FT, I.v, 0.06); near(I.altNmi * NMI, I.altKm, 0.1); near(I.apogeeNmi * NMI, I.apogeeKm, 0.1); near(I.perigeeNmi * NMI, I.perigeeKm, 0.1);
  for (const k of ['sic', 'sii', 'sivb1']) near(T512.maxEarthFixedVelocity[k][2] * FT, T512.maxEarthFixedVelocity[k][1], 0.06, k);
  near(T512.mach1.altitudeNmi * NMI, T512.mach1.altitudeKm, 0.1); near(T512.maxQ.altitudeNmi * NMI, T512.maxQ.altitudeKm, 0.1);
  // 3.36 N/cm^2 against 701.75 lbf/ft^2 (1 lbf/ft^2 = 4.4482216152605 N / 0.09290304 m^2, exact definitions)
  near(T512.maxQ.qLbfFt2 * 4.4482216152605 / 0.09290304 / 1e4, T512.maxQ.qNcm2, 0.005);
  near(T512.maxQAppendix.altitudeFt * FT / 1000, T512.maxQAppendix.altitudeKm, 0.005);
  near(T512.maxQAppendix.altitudeKm, T512.maxQ.altitudeKm, 0.05, 'appendix max-Q height rounds to Table 4-1');
  // smudged entries: NOMINAL + ACT-NOM, and the legible digits ("_.429", "0.0_1")
  for (const k of ['fpa', 'heading', 'rangeKm']) near(C.sicOeco.nominal[k] + C.sicOeco.actMinusNom[k], C.sicOeco[k], 1e-9, k);
  assert.match(C.sicOeco.fpa.toFixed(3), /\.429$/); near(C.sivb1Gcs.nominal.fpa + C.sivb1Gcs.actMinusNom.fpa, C.sivb1Gcs.fpa, 1e-12);
  // Table 2-2 and Table 4-1 agree on the event times; idea 34's transcription agrees on the cutoffs
  assert.equal(T512.events.mach1, T512.mach1.t); assert.equal(T512.events.maxQ, T512.maxQ.t);
  assert.equal(T512.events.ceco, AS512.events.sicCeco); assert.equal(T512.events.oeco, AS512.events.sicOeco);
  assert.equal(T512.cutoff.sicOeco.altKm, AS512.cutoff.sicOeco[1]); assert.equal(T512.cutoff.sicOeco.v, AS512.cutoff.sicOeco[2]);
  assert.equal(T512.insertion.v, AS512.parkingOrbit.velocity);
});
test('Saturn V axial force: two independently read curves are consistent (total >= forebody) and the area is pi (33 ft)^2 / 4', () => {
  for (const c of [AERO.forebody, AERO.total]) { assert.equal(c.mach.length, c.ca.length); for (let i = 1; i < c.mach.length; i++) assert.ok(c.mach[i] > c.mach[i - 1]); }
  // C_AT - C_Af = C_Ab, the power-off base drag, cannot be negative: checked at every station of either curve
  for (const M of AERO.forebody.mach.concat(AERO.total.mach)) assert.ok(A.axialCoefficient(M, 'total').ca >= A.axialCoefficient(M, 'forebody').ca - 1e-12, 'Mach ' + M);
  near(Math.PI * Math.pow(33 * 0.3048, 2) / 4, 79.46, 0.005);
  near(A.constants.D_SATURN, 10.0584, 1e-12);
  // held flat outside the data, and flagged
  assert.equal(A.axialCoefficient(0.2).ca, AERO.forebody.ca[0]); assert.ok(A.axialCoefficient(0.2).outside);
  assert.equal(A.axialCoefficient(9).ca, AERO.forebody.ca[AERO.forebody.ca.length - 1]); assert.ok(!A.axialCoefficient(3).outside);
  near(A.axialCoefficient(1.125).ca, (0.655 + 0.665) / 2, 1e-12, 'linear between stations');
});

// ------------------------------------------------------------------ closed forms
function ctxOf(o) { return Object.assign({ omega: 0, uniformG: true, drag: false, engines: 1, Fvac: 0, Ae: 0, mdot: 0, steer: 'vertical', np: [0, 0, 1] }, o); }
test('closed form: a vertical burn in vacuum under uniform gravity, h(t) = c[t - (m/mdot) ln(m0/m)] - g t^2 / 2', () => {
  const RE = A.constants.RE, g = A.constants.MU / (RE * RE);
  const m0 = 500000, F = 7e6, mdot = 2300, c = F / mdot;
  // started 90 km up so the atmosphere (and its pressure on a zero exit area) plays no part
  const y0 = [RE + 90000, 0, 0, 0, 0, 0, m0].concat(new Array(A.constants.NY - 7).fill(0));
  for (const T of [40, 100]) {
    const r = A.integrate(0, y0, T, ctxOf({ Fvac: F, mdot }), 0.2);
    const m = m0 - mdot * T, h = c * (T - (m / mdot) * Math.log(m0 / m)) - 0.5 * g * T * T, v = c * Math.log(m0 / m) - g * T;
    near(r.y[0] - RE - 90000, h, 1e-4, 'h at ' + T); near(r.y[3], v, 1e-7, 'v at ' + T); near(r.y[6], m, 1e-6, 'm');
    near(r.y[10], g * T, 1e-7, 'gravity loss of a vertical climb is g t'); near(r.y[11], 0, 1e-9, 'no steering loss');
  }
});
test('closed form: the Culler-Fried gravity turn, v = C z^(n-1) (1+z^2)/2 and t = (C/2g)[z^(n-1)/(n-1) + z^(n+1)/(n+1)], z = tan(beta/2)', () => {
  // a flat Earth: a kernel on a sphere of 1e12 m with GM chosen for g = 9.80665 at its surface; thrust n m g, constant mass
  const g = 9.80665, R = 1e12;
  const F = MaxQ.create({ S, isa: pf.isa, g0: pf.ISA_G0, isaTop: { R0: pf.ISA_R0, HMAX: pf.ISA_H_MAX }, earth: EARTH, aero: AERO, as512: AS512, trajectory: T512, radius: R, mu: g * R * R, omega: 0 });
  const n = 1.6, m = 1000, b0 = 10 * DEG, v0 = 120;
  const y0 = [R, 0, 0, v0 * Math.cos(b0), v0 * Math.sin(b0), 0, m].concat(new Array(F.constants.NY - 7).fill(0));
  const z = (b) => Math.tan(b / 2), z0 = z(b0), C = 2 * v0 / (Math.pow(z0, n - 1) * (1 + z0 * z0));
  const tOf = (zz) => C / (2 * g) * (Math.pow(zz, n - 1) / (n - 1) + Math.pow(zz, n + 1) / (n + 1));
  for (const T of [20, 60]) {
    const r = F.integrate(0, y0, T, ctxOf({ Fvac: n * m * g, steer: 'gravity' }), 0.05);
    const vx = r.y[3], vy = r.y[4], beta = Math.atan2(vy, vx), v = Math.hypot(vx, vy), zz = z(beta);
    rel(v, C * Math.pow(zz, n - 1) * (1 + zz * zz) / 2, 2e-9, 'v(beta) at ' + T);
    near(tOf(zz) - tOf(z0), T, 1e-6, 't(beta) at ' + T);
  }
});
test('closed form: a coast is a Kepler orbit (energy and angular momentum kept, apogee at a(1+e))', () => {
  const MU = A.constants.MU, RE = A.constants.RE;
  const r0 = RE + 200000, v0 = 7900, gam = 3 * DEG;
  const y0 = [r0, 0, 0, v0 * Math.sin(gam), v0 * Math.cos(gam), 0, 1000].concat(new Array(A.constants.NY - 7).fill(0));
  const o = A.orbitOf([r0, 0, 0], [y0[3], y0[4], 0]);
  let rmax = 0;
  const res = A.integrate(0, y0, o.period, ctxOf({ engines: 0, uniformG: false }), 1, (t, y) => { rmax = Math.max(rmax, Math.hypot(y[0], y[1], y[2])); });
  const o2 = A.orbitOf(res.y.slice(0, 3), res.y.slice(3, 6));
  rel(o2.energy, o.energy, 1e-10, 'energy'); rel(o2.h, o.h, 1e-10, 'angular momentum');
  near(Math.hypot(res.y[0] - r0, res.y[1], res.y[2]), 0, 0.5, 'back where it started after one period');
  near(rmax, o.a * (1 + o.e), 5, 'apogee radius (sampled once a second)');
});
test('pad and frame: the pad moves at omega R cos(latitude); the launch plane contains the pad and the azimuth', () => {
  const p = A.padState(28.5, true);
  near(Math.hypot(...p.v), A.constants.OMEGA * A.constants.RE * Math.cos(28.5 * DEG), 1e-9);
  assert.equal(Math.hypot(...A.padState(28.5, false).v), 0);
  const np = A.launchPlane(p.r, 90 * DEG);
  near(np[0] * p.r[0] + np[1] * p.r[1] + np[2] * p.r[2], 0, 1e-6);
  // due east from 28.5 deg the plane's inclination is the latitude
  near(Math.acos(np[2]) / DEG, 28.5, 1e-9);
  // 1976 atmosphere through idea 02's isa(): sea level 101325 Pa, zero above 86 km
  near(A.atmosphere(0).P, 101325, 1e-6); near(A.constants.ATM_TOP, 85999.95, 0.01, 'isa()\'s top, 84,852 m geopotential');
  assert.equal(A.atmosphere(86000).rho, 0); assert.ok(A.atmosphere(85999).rho > 0); assert.ok(!pf.isa(85999.9).clamped && pf.isa(86000).clamped);
});

// ------------------------------------------------------------------ against idea 34's exact ledger
test('the flight burns idea 34\'s ledger exactly: per-burn ideal delta-v, burn times and cutoff masses (no throttle, no scaling)', () => {
  const v = as512(), p = Object.assign(A.defaultPlan(v.vehicle), { kickDeg: 0.74, upper: { mode: 'hold', startDeg: 25 } });
  const r = A.fly(v.vehicle, v.engines, p);
  assert.ok(r.ok, JSON.stringify(r.refusals));
  const led = v.ledger;
  let dv = 0;
  r.stageEnds.forEach((e, i) => {
    const b = led.stages[e.stage].burns[e.burn];
    near(e.burnTime, b.time, 1e-6, e.label + ' burn time');
    near(e.state.mass, b.mCutoff, 1e-6, e.label + ' cutoff mass');
    dv += b.dv;
    near(e.losses.ideal, dv, 1e-6 * dv, e.label + ' integral of F_vac/m = Tsiolkovsky');
  });
  assert.equal(r.flownBurns.length, 3); assert.deepEqual(r.remainingBurns.map((x) => x.label), ['S-IVB burn 2']);
  // the scaled flow shortens every burn by its factor and leaves delta-v alone
  const k = A.as512FlowScale(v.engines);
  near(k, 1.0199825205495636, 1e-12, 'idea 34\'s flight-average F-1 flow over idea 33\'s');
  const r2 = A.fly(v.vehicle, v.engines, Object.assign({}, p, { flowScale: [k, 1, 1] }));
  // five engines to the centre cutoff (139.06 s on the burn clock, which does not scale), four after: by construction
  // the flight's own outboard cutoff, 161.20 - 0.24 s
  const F1 = v.engines['F-1'], tC = AS512.events.sicCeco - A.as512T0(), P = v.vehicle.stages[0].burns[0].propellant;
  near(r2.stageEnds[0].burnTime, tC + (P - 5 * k * F1.mdot * tC) / (4 * k * F1.mdot), 1e-6);
  near(r2.stageEnds[0].burnTime, AS512.events.sicOeco - A.as512T0(), 1e-9, 'the flight\'s burn');
  near(r2.stageEnds[0].losses.ideal, led.stages[0].burns[0].dv, 1e-6, 'same delta-v: Isp unchanged');
});
test('loss budgets close: ideal = inertial gain + losses, and ideal + centrifugal - losses = Earth-relative speed', () => {
  const { v, p } = as512Plan();
  const r = A.fly(v.vehicle, v.engines, p);
  near(r.closure, 0, 1e-6, 'inertial'); near(r.closureRel, 0, 1e-3, 'Earth-relative');
  near(r.v0, A.constants.OMEGA * A.constants.RE * Math.cos(28.5 * DEG), 1e-9);
  // the first stage's zero-angle-of-attack turn has no Earth-relative steering loss after the kick
  assert.ok(r.stageEnds[0].lossesRel.steering < 0.05, 'stage 1 steering ' + r.stageEnds[0].lossesRel.steering);
  // q = rho v^2 / 2 is gamma p M^2 / 2 at every sample in the air (1976 standard gamma 1.4)
  r.samples.filter((s) => s.M != null && s.h < 80000).forEach((s) => rel(s.q, 0.7 * A.atmosphere(s.h).P * s.M * s.M, 1e-9));
});
test('a throttle bucket stretches the burn by (b - a)(1 - f), f = the deck\'s chamber flow at the level over 100 %', () => {
  const v = A.vehicleFromHandoff(L.H34), e = v.engines[v.vehicle.stages[0].engine], dk = e.deckVac;
  const p = Object.assign(A.defaultPlan(v.vehicle), { kickDeg: 1, diameter: 4 });
  const base = A.fly(v.vehicle, v.engines, p), th = { start: 40, end: 70, level: 0.8 };
  const r = A.fly(v.vehicle, v.engines, Object.assign({}, p, { throttle: th }));
  const f = (dk.mass_flow_chamber[dk.throttle.indexOf(0.8)]) / dk.mass_flow_chamber[dk.throttle.indexOf(1)];
  near(r.stageEnds[0].burnTime - base.stageEnds[0].burnTime, (th.end - th.start) * (1 - f), 1e-6);
  assert.ok(r.maxQ.q < base.maxQ.q, 'the bucket lowers max Q');
  // thrust inside the bucket is the deck's at 80 %, less ambient pressure on the exit area
  const s = r.samples.find((x) => x.t > 50 && x.stage === 0);
  near(s.F, v.vehicle.stages[0].count * (dk.thrust_vac[dk.throttle.indexOf(0.8)] - A.atmosphere(s.h).P * e.exitArea), 1e-3);
});

// ------------------------------------------------------------------ the independent oracle
test('oracle: scipy DOP853 in the rotating frame with ambiance\'s atmosphere (oracle/ascent-oracle.json) agrees on every case', () => {
  const cases = JSON.parse(fs.readFileSync(path.join(here, 'oracle/cases.json'), 'utf8')).cases;
  const O = JSON.parse(fs.readFileSync(path.join(here, 'oracle/ascent-oracle.json'), 'utf8')).results;
  assert.equal(O.length, 3);
  for (const c of cases) {
    const o = O.find((x) => x.name === c.name), h = c.data === 'as512' ? L.H34AS512 : L.H34;
    const v = A.vehicleFromHandoff(h), r = A.fly(v.vehicle, v.engines, c.plan);
    near(r.mach1.t, o.mach1_t, 0.002, c.name + ' Mach 1 time');
    rel(r.maxQ.q, o.maxq_q, 5e-4, c.name + ' max Q'); near(r.maxQ.t, o.maxq_t, 0.15, c.name + ' max-Q time');
    if (o.kick_end_t != null) near(r.kickEndT, o.kick_end_t, 1e-4, c.name + ' kick hand-over');
    r.stageEnds.forEach((e, i) => {
      const oc = o.cutoffs[i];
      near(e.t, oc.t, 1e-6, c.name + ' ' + e.label + ' time'); near(e.state.altitude, oc.altitude, 0.5, c.name + ' ' + e.label + ' altitude');
      near(e.state.speed, oc.speed_inertial, 0.002, c.name + ' ' + e.label + ' speed'); near(e.state.fpaDeg, oc.fpa_deg, 2e-5, c.name + ' ' + e.label + ' fpa');
      near(e.state.mass, oc.mass, 1e-5, c.name + ' ' + e.label + ' mass');
    });
    for (const k of ['ideal', 'pressure', 'drag', 'gravity', 'steering', 'centrifugal']) near(r.lossesRel[k], o.losses_rel[k], 0.002, c.name + ' ' + k);
    near(r.orbit.inclinationDeg, o.orbit.inclination_deg, 1e-6, c.name + ' inclination');
  }
});

// ------------------------------------------------------------------ AS-512 against its flight report
test('AS-512 against the flight report: the gaps, pinned (flight-average F-1 flow, kick fitted to the outboard-cutoff angle)', () => {
  const { v, p } = as512Plan(true);
  const r = A.fly(v.vehicle, v.engines, p);
  const rows = A.as512Rows(r, p), get = (g, l) => rows.find((x) => x.group.startsWith(g) && x.label === l);
  near(get('S-IC outboard', 'Flight-path angle').gap, 0, 1e-6, 'the fit');
  near(get('S-IC outboard', 'Time').gap, 0, 0.01, 'calibrated burn ends on the flight\'s cutoff');
  near(get('S-IC centre', 'Space-fixed velocity').gap, -0.9, 0.3); near(get('S-IC centre', 'Altitude').gap, 1.19, 0.05);
  near(get('S-IC centre', 'Flight-path angle').gap, 0.155, 0.01); near(get('S-IC centre', 'Surface range').gap, -0.54, 0.05);
  near(get('S-IC outboard', 'Space-fixed velocity').gap, -6.7, 0.3); near(get('S-IC outboard', 'Altitude').gap, 1.17, 0.05);
  near(get('S-IC outboard', 'Surface range').gap, -0.63, 0.05); near(get('S-IC outboard', 'Earth-fixed velocity').gap, -16.7, 0.3);
  near(get('Max Q', 'Dynamic pressure').gap, -0.0441, 0.002); near(get('Max Q', 'Time').gap, -6.68, 0.2); near(get('Max Q', 'Altitude').gap, -2.06, 0.05);
  near(get('Mach 1', 'Time').gap, -2.92, 0.2); near(get('Mach 1', 'Altitude').gap, -0.57, 0.05);
  near(get('Parking orbit', 'Inclination').gap, 0.036, 0.005);
  near(get('S-IVB first cutoff', 'Flight-path angle').model, 0, 1e-6, 'solved level');
  near(get('S-IVB first cutoff', 'Space-fixed velocity').gap, -182.8, 1); near(get('S-IVB first cutoff', 'Altitude').gap, 45.4, 0.3);
  assert.ok(r.refusals.some((x) => x.applies_to === 'orbit'), 'the open-loop programme does not reach orbit');
  // idea 33's F-1 unscaled: the burn runs 3.9 s long and the centre-cutoff speed falls 127 m/s short
  const q = as512Plan(false), r0 = A.fly(q.v.vehicle, q.v.engines, q.p), rows0 = A.as512Rows(r0, q.p), get0 = (g, l) => rows0.find((x) => x.group.startsWith(g) && x.label === l);
  near(get0('S-IC outboard', 'Time').gap, 3.91, 0.02); near(get0('S-IC centre', 'Space-fixed velocity').gap, -126.9, 0.5);
  near(get0('Max Q', 'Dynamic pressure').gap, -0.0834, 0.002); near(get0('Mach 1', 'Time').gap, 0.235, 0.2);
});

// ------------------------------------------------------------------ refusals
test('refusals: the inputs this module cannot fly, each with a code and what would help', () => {
  const v = as512(), p = Object.assign(A.defaultPlan(v.vehicle), { kickDeg: 0.74 });
  const fly = (o) => A.fly(v.vehicle, v.engines, Object.assign({}, p, o));
  const codeOf = (r) => r.refusals[0].code;
  assert.equal(codeOf(fly({ azimuthDeg: 150 })), 'out_of_envelope', 'outside Cape Canaveral\'s corridor');
  assert.equal(codeOf(fly({ throttle: { start: 30, end: 60, level: 0.3 } })), 'out_of_envelope', 'below the deck');
  assert.equal(codeOf(fly({ throttle: { start: 60, end: 30, level: 0.8 } })), 'invalid_input');
  assert.equal(codeOf(fly({ flowScale: [2, 1, 1] })), 'out_of_envelope');
  assert.equal(codeOf(fly({ diameter: 0 })), 'invalid_input');
  assert.equal(codeOf(fly({ kickDeg: 5 })), 'out_of_envelope', 'a hard kick brings it down');
  assert.match(fly({ kickDeg: 5 }).refusals[0].reason, /comes back to the ground/);
  const r = A.fly(v.vehicle, v.engines, p); assert.ok(r.refusals.every((x) => x.what_would_help));
  // a J-2 first stage separates at sea level (idea 33's criterion, idea 34's refusal)
  const j2 = JSON.parse(JSON.stringify(v.vehicle)); j2.stages[0].engine = 'J-2'; j2.id = 'custom';
  assert.equal(A.fly(j2, v.engines, p).refusals[0].applies_to, 'liftoff');
  // an upper stage lit low enough that its nozzle separates (idea 33's onset for the J-2) is refused at that point
  const smp = A.vehicleFromHandoff(L.H34), low = JSON.parse(JSON.stringify(smp.vehicle)); low.stages[0].burns[0].propellant = 20000; low.id = 'custom';
  const rl = A.fly(low, smp.engines, Object.assign(A.defaultPlan(low), { kickDeg: 1, diameter: 4 }));
  assert.ok(!rl.ok && rl.refusals[0].applies_to === 'stage 2' && /separates/.test(rl.refusals[0].reason), 'J-2 lit near the ground separates');
  assert.ok(rl.refusals[0].reason.includes(String(Math.round(smp.engines['J-2'].sepOnsetPa))) || /separation onset/.test(rl.refusals[0].reason));
  // a solver with nothing to find refuses
  assert.ok(A.solveKick(v.vehicle, v.engines, p, 89).refusal);
  assert.ok(A.solveKick(v.vehicle, v.engines, p, 0).refusal);
});
test('import: idea 34\'s handoffs come in; edited, foreign and partial ones are refused with their codes', () => {
  assert.ok(A.vehicleFromHandoff(L.H34).vehicle); assert.ok(A.vehicleFromHandoff(JSON.stringify(L.H34AS512)).vehicle);
  const ed = JSON.parse(JSON.stringify(L.H34AS512)); ed.outputs.liftoff_mass.value *= 1.001;
  assert.equal(A.vehicleFromHandoff(ed).refusal.code, 'invalid_input');
  const ee = JSON.parse(JSON.stringify(L.H34AS512)); ee.inputs.engines['F-1'].thrust_vacuum_N *= 1.01; ee.inputs.engines['F-1'].specific_impulse_vacuum_m_s *= 1.01;
  assert.match(A.vehicleFromHandoff(ee).refusal.reason, /F-1/);
  const ei = JSON.parse(JSON.stringify(L.H34)); const k = Object.keys(ei.inputs.engines).find((x) => x.startsWith('imported'));
  ei.inputs.engines[k].mass_flow_kg_s *= 1.01; ei.inputs.engines[k].specific_impulse_vacuum_m_s /= 1.01;
  assert.match(A.vehicleFromHandoff(ei).refusal.reason, /idea 33 handoff/);
  const ei2 = JSON.parse(JSON.stringify(L.H34)); ei2.inputs.engines[k].specific_impulse_vacuum_m_s *= 1.01;
  assert.match(A.vehicleFromHandoff(ei2).refusal.reason, /specific_impulse_vacuum_m_s is not thrust_vacuum_N \/ mass_flow_kg_s/, 'an imported engine\'s Isp edited alone');
  const em = JSON.parse(JSON.stringify(L.H34AS512)); em.inputs.vehicle.stages[0].dry += 1000; em.outputs.liftoff_mass.value += 1000;
  // the ledger is consistent again, so it imports, but it is no longer the flight report's AS-512
  const imp = A.vehicleFromHandoff(em);
  if (!imp.refusal) assert.equal(imp.vehicle.id, 'imported'); else assert.equal(imp.refusal.code, 'invalid_input');
  assert.equal(A.vehicleFromHandoff('{').refusal.code, 'invalid_input');
  assert.equal(A.vehicleFromHandoff({ handoff: 'long-way-round', from: '33-engine-deck' }).refusal.code, 'insufficient_data');
  assert.equal(A.vehicleFromHandoff({ handoff: 'long-way-round', from: '40-long-coast' }).refusal.code, 'invalid_input');
});
test('handoff: handoff.json is what the kernel computes; every output carries units, confidence and source; it round-trips', async () => {
  const { sample } = await import(path.join(here, 'build-sample.mjs'));
  const h = JSON.parse(fs.readFileSync(path.join(here, 'handoff.json'), 'utf8'));
  const { handoff } = sample(L.H34);
  assert.equal(JSON.stringify(handoff), JSON.stringify(h));
  assert.equal(h.from, '35-max-q'); assert.equal(h.inputs.vehicle_handoff.from, '34-stack');
  for (const [k, o] of Object.entries(h.outputs)) { assert.ok(o.units && o.confidence && o.source, k); assert.ok(!JSON.stringify(o.value).includes('null') || k === 'orbit' || k === 'remaining_burns', k); }
  assert.ok(!h.refusals.some((x) => x.applies_to === 'losses'), 'idea 34\'s losses refusal is answered here');
  assert.ok(h.refusals.some((x) => x.applies_to === 'guidance'));
  const back = A.parseHandoff(h);
  near(back.result.final.speed, h.outputs.burnout_speed_inertial.value, 1e-6);
  const ed = JSON.parse(JSON.stringify(h)); ed.outputs.burnout_speed_inertial.value += 1;
  assert.equal(A.parseHandoff(ed).refusal.code, 'invalid_input');
  // the burnout state really is the orbit it reports
  const o = A.orbitOf(h.outputs.burnout_state.value.r_m, h.outputs.burnout_state.value.v_m_s);
  near(o.perigeeAlt, h.outputs.orbit.value.perigee_altitude_m, 1e-6);
});
