// Tests for idea 31 (Mixture). Run from the bank root: node --test ideas/31-mixture/mixture.test.mjs
// Oracles: NASA CEA 3.3.4 (oracle/cea-oracle.json, written by oracle/cea_oracle.py), the 1996 RP-1311 Part II
// Example 8 printout and NASA/TP-2002-211729's theory table (oracle/published.json, transcribed from
// oracle/published-excerpts.txt), closed forms and limit cases, and finite differences of the kernel itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const M = require('./mixture.js');
const TEXT = require('./snapshots/thermo-excerpt.js');
const D = require('./snapshots/propellant-densities.js');
const MEAS = require('./snapshots/measured-cstar.js');
const P = require('./presets.js');
const FX = JSON.parse(fs.readFileSync(path.join(here, 'oracle', 'cea-oracle.json'), 'utf8'));
const PUB = JSON.parse(fs.readFileSync(path.join(here, 'oracle', 'published.json'), 'utf8'));
const SURVEY = JSON.parse(fs.readFileSync(path.join(here, 'oracle', 'species-survey.json'), 'utf8'));
const REV = JSON.parse(fs.readFileSync(path.join(here, 'oracle', 'cea-review.json'), 'utf8'));
const db = M.parseThermo(TEXT);
const K = FX.station_keys;
const FT = 0.3048;
const rel = (a, b) => (a - b) / b;

// oracle/pairs.py, read as data so the test does not need Python.
const PAIRS = {};
{
  const src = fs.readFileSync(path.join(here, 'oracle', 'pairs.py'), 'utf8');
  const side = (t) => [...t.matchAll(/\("([^"]+)", ([\d.]+), ([\d.]+)\)/g)].map((x) => ({ name: x[1], w: +x[2], T: +x[3] }));
  for (const m of src.matchAll(/"([^"]+)":\s*\{"ox": \[(.*?)\],\s*"fuel": \[(.*?)\], "of": \(([\d.]+), ([\d.]+)\)\}/gs)) {
    PAIRS[m[1]] = { oxidizer: side(m[2]), fuel: side(m[3]), of: [+m[4], +m[5]] };
  }
}
const prop = (k) => ({ oxidizer: PAIRS[k].oxidizer, fuel: PAIRS[k].fuel });

const lox0 = { oxidizer: [{ name: 'O2(L)', w: 1 }], fuel: [{ name: 'RP-1', w: 1 }] };
// Run the kernel once over every oracle point; several tests read the results.
const RUNS = FX.points.map((p) => ({ p, r: M.rocket(db, prop(p.pair), p.of, p.pc) }));

// ------------------------------------------------------------------ the data
test('thermo excerpt: verbatim, hashed, and the species set the oracle chose', () => {
  const side = JSON.parse(fs.readFileSync(path.join(here, 'snapshots', 'thermo-excerpt.js.provenance.json'), 'utf8'));
  assert.equal(crypto.createHash('sha256').update(TEXT).digest('hex'), side.excerptSha256);
  assert.equal(side.sourceSha256, 'fa7746572952d74e249e818a82a35c113829742fb421a308e167185528884363');
  assert.equal(db.gas.length, 43);
  assert.deepEqual([...db.gas].sort(), [...SURVEY.selected].sort());
  assert.deepEqual(db.condensed, ['C(gr)', 'H2O(L)', 'H2O(cr)']);
  assert.equal(Object.keys(db.reactants).length, 10);
  const h2o = db.products.H2O;
  assert.deepEqual(h2o.elements, { H: 2, O: 1 });
  assert.equal(h2o.M, 0.01801528);
  assert.equal(h2o.Hf, -241826);
  assert.equal(db.reactants['RP-1'].T0, 298.15);
  assert.deepEqual(db.reactants['RP-1'].elements, { C: 1, H: 1.95 });
});

test('NASA polynomials: H(298.15 K) is the heat of formation, zero for reference elements, continuous at 1000 K', () => {
  // An identity of the data, independent of the solver: the b1 constant is fitted so H(298.15) = dHf.
  let checked = 0;
  for (const nm of db.gas) {
    const rec = db.products[nm];
    const th = M.thermoAt(rec, 298.15);
    if (th) { // 27 of the 43 fits start at 300 K and are not evaluated below it
      assert.ok(Math.abs(th.h * M.R * 298.15 - rec.Hf) < 2, `${nm}: H(298.15) ${th.h * M.R * 298.15} vs Hf ${rec.Hf}`);
      checked++;
    }
    const lo = M.thermoAt({ intervals: [rec.intervals[0]] }, 1000), hi = M.thermoAt({ intervals: [rec.intervals[1]] }, 1000);
    assert.ok(Math.abs(lo.cp - hi.cp) < 1e-3 && Math.abs(lo.h - hi.h) < 1e-3 && Math.abs(lo.s - hi.s) < 1e-3, `${nm} discontinuous at 1000 K`);
  }
  assert.equal(checked, 16);
  for (const nm of ['H2', 'O2', 'N2']) assert.equal(db.products[nm].Hf, 0);
  assert.equal(M.thermoAt(db.products.H2O, 150), null, 'outside the fitted range gives null, not an extrapolation');
});

test('densities: every quote is in the verbatim excerpt and every value is the quoted number in kg/m^3', () => {
  const src = fs.readFileSync(path.join(here, 'snapshots', 'density-sources.txt'), 'utf8');
  const numsIn = (q) => (q.match(/\d+\.?\d*/g) || []).map(Number);
  let n = 0;
  for (const [name, row] of Object.entries(D.components)) {
    if (!row) continue;
    assert.ok(src.includes(row.quote), `${name}: quote not in density-sources.txt`);
    if (row.quote2) assert.ok(src.includes(row.quote2));
    const vals = numsIn(row.quote).concat(row.quote2 ? numsIn(row.quote2) : []);
    assert.ok(vals.some((v) => Math.abs(v - row.value) < 1e-9 || Math.abs(v * 1000 - row.value) < 1e-6) || row.range, `${name}: ${row.value} not in "${row.quote}"`);
    for (const c of row.cross) { assert.ok(src.includes(c.quote), `${name} cross: ${c.quote}`); n++; }
    n++;
  }
  assert.deepEqual(D.components['RP-1'].range, [800, 820]);
  assert.equal(D.components['RP-1'].value, (800 + 820) / 2);
  for (const b of D.blends) assert.ok(src.includes(b.quote));
  assert.ok(n >= 19);
});

test('presets agree with the pairs the oracle checked, and with the temperatures thermo.inp assigns', () => {
  const byLabel = { 'LOX/LH2': 'lox-lh2', 'LOX/RP-1': 'lox-rp1', 'LOX/CH4': 'lox-ch4', 'N2O4/MMH': 'nto-mmh', 'N2O4/UDMH': 'nto-udmh',
    'N2O4/A-50': 'nto-a50', 'N2O4/N2H4': 'nto-n2h4', 'LOX/Ethanol-75': 'lox-eth75', 'HTP-98/RP-1': 'htp-rp1', 'GOX/RP-1': 'gox-rp1' };
  assert.equal(Object.keys(PAIRS).length, 10);
  for (const [k, id] of Object.entries(byLabel)) {
    const pr = P.PRESETS.find((x) => x.id === id);
    assert.deepEqual(pr.oxidizer, PAIRS[k].oxidizer, k);
    assert.deepEqual(pr.fuel, PAIRS[k].fuel, k);
    assert.deepEqual(pr.ofRange, PAIRS[k].of, k);
  }
  for (const c of P.COMPONENTS) {
    const rec = db.reactants[c.name] || db.products[c.name];
    assert.ok(rec, c.name);
    if (rec.T0 != null) assert.equal(c.T, rec.T0, c.name);
  }
});

// ------------------------------------------------------------------ reactants
test('reactants: RP-1311 Example 8 enthalpy and equivalence ratio, and stoichiometric O/F from the formula', () => {
  const ex = PUB.rp1311_example8;
  const mix = M.composeReactants(db, prop('LOX/LH2').oxidizer, prop('LOX/LH2').fuel, ex.inputs.of);
  assert.ok(Math.abs(mix.h0 / 1000 - -1026.05) < 0.005, `h0 ${mix.h0}`); // printed "H, KJ/KG -1026.05"
  const ofst = M.stoichiometricOF(db, prop('LOX/LH2').oxidizer, prop('LOX/LH2').fuel);
  assert.ok(Math.abs(ofst / ex.inputs.of - ex.phi) < 1e-6, `phi ${ofst / ex.inputs.of}`); // printed PHI 1.429628
  // 2 H2 + O2: O/F = M(O2) / (2 M(H2)) with thermo.inp's molecular weights
  assert.ok(Math.abs(ofst - 31.9988 / (2 * 2.01588)) < 1e-12);
  // CH1.95 + (1 + 1.95/4) O2: valence form against the balanced equation
  const rp = M.stoichiometricOF(db, prop('LOX/RP-1').oxidizer, prop('LOX/RP-1').fuel);
  assert.ok(Math.abs(rp - (1 + 1.95 / 4) * 31.9988 / 13.976183) < 1e-9);
  // element balance of the blend: A-50 at O/F 2 holds N from both sides
  const a = M.composeReactants(db, [{ name: 'N2O4(L)', w: 1 }], [{ name: 'N2H4(L)', w: 0.5 }, { name: 'C2H8N2(L),UDMH', w: 0.5 }], 2);
  const Mr = (nm) => db.reactants[nm].M;
  const nExpected = 2 * (2 / 3) / Mr('N2O4(L)') + 2 * (1 / 3) * 0.5 / Mr('N2H4(L)') + 2 * (1 / 3) * 0.5 / Mr('C2H8N2(L),UDMH');
  assert.ok(Math.abs(rel(a.b0.N, nExpected)) < 1e-6, `N ${a.b0.N} vs ${nExpected}`);
});

// ------------------------------------------------------------------ against NASA CEA
test('NASA CEA, same species set: chamber within 1 ppm, c* within 5 ppm, throat within CEA\'s own tolerance', () => {
  const worst = {};
  let n = 0;
  for (const { p, r } of RUNS) {
    if (p.condensed_in_chamber_or_throat) continue;
    assert.ok(!r.refusal, `${p.pair} ${p.of} ${p.pc}: ${r.refusal && r.refusal.reason}`);
    const o = p.restricted;
    K.forEach((k, i) => {
      const e = k === 'h' ? Math.abs(r.chamber[k] - o.chamber[i]) : Math.abs(rel(r.chamber[k], o.chamber[i]));
      if (k !== 'P') worst['c.' + k] = Math.max(worst['c.' + k] || 0, e);
      const et = k === 'h' ? Math.abs(r.throat[k] - o.throat[i]) : Math.abs(rel(r.throat[k], o.throat[i]));
      worst['t.' + k] = Math.max(worst['t.' + k] || 0, et);
    });
    worst.cstar = Math.max(worst.cstar || 0, Math.abs(rel(r.cstar, o.cstar)));
    for (const [sp, x] of Object.entries(o.x)) {
      if (x < 1e-4) continue;
      worst.x = Math.max(worst.x || 0, Math.abs(rel(r.chamber.x[sp], x)));
    }
    n++;
  }
  assert.equal(n, 177);
  for (const k of ['T', 'M', 'gamma_s', 'cp_eq', 'cp_fr', 's', 'rho', 'a']) assert.ok(worst['c.' + k] < 1e-6, `chamber ${k}: ${worst['c.' + k]}`);
  assert.ok(worst['c.h'] < 5, `chamber h ${worst['c.h']} J/kg`); // CEA prints h to 0.1 J/kg after unit conversion
  assert.ok(worst.cstar < 5e-6, `c* ${worst.cstar}`);
  assert.ok(worst.x < 1e-5, `mole fractions ${worst.x}`);
  // CEA stops its throat iteration at |u^2-a^2|/u^2 < 0.4e-4 (RP-1311); the kernel goes to 1e-9, so the throat
  // pressure differs by up to ~2e-5 while c* (stationary at the throat) does not.
  assert.ok(worst['t.P'] < 3e-5, `throat P ${worst['t.P']}`);
  assert.ok(worst['t.T'] < 1e-5 && worst['t.a'] < 5e-6 && worst['t.gamma_s'] < 1e-6, JSON.stringify(worst));
});

test('NASA CEA, every product it would consider: the 43-species set costs under 5 ppm of c*', () => {
  let wc = 0, wt = 0, wg = 0;
  for (const { p, r } of RUNS) {
    if (p.condensed_in_chamber_or_throat) continue;
    wc = Math.max(wc, Math.abs(rel(r.cstar, p.full.cstar)));
    wt = Math.max(wt, Math.abs(rel(r.chamber.T, p.full.chamber[0])));
    wg = Math.max(wg, Math.abs(rel(r.chamber.gamma_s, p.full.chamber[3])));
  }
  assert.ok(wc < 5e-6, `c* ${wc}`);
  assert.ok(wt < 1e-6, `Tc ${wt}`);
  assert.ok(wg < 2e-6, `gamma_s ${wg}`);
});

test('condensed phases: refuses exactly where CEA deposits graphite in the chamber or throat', () => {
  const cond = RUNS.filter(({ p }) => p.condensed_in_chamber_or_throat);
  assert.equal(cond.length, 3);
  for (const { p, r } of cond) {
    assert.ok(r.refusal, `${p.pair} ${p.of}`);
    assert.equal(r.refusal.code, 'out_of_envelope');
    assert.match(r.refusal.reason, /C\(gr\)/);
    assert.ok(p.condensed['C(gr)'].some((v) => v > 0));
  }
  // the boundary the page states: LOX/RP-1 refuses below O/F 1.13-1.15 between 1 and 300 bar
  for (const [pc, lo, hi] of [[1e5, 1.145, 1.146], [1e7, 1.143, 1.144], [3e7, 1.130, 1.131]]) {
    assert.ok(M.rocket(db, lox0, lo, pc).refusal && !M.rocket(db, lox0, hi, pc).refusal, `graphite boundary at ${pc} Pa`);
  }
  // and nowhere else, including the fuel-rich edge of LOX/CH4 where CEA finds graphite only further down the nozzle
  assert.equal(RUNS.filter(({ p, r }) => !p.condensed_in_chamber_or_throat && r.refusal).length, 0);
});

// ------------------------------------------------------------------ published figures
test('RP-1311 Part II (1996) Example 8 printout: within 0.2 % (cp_eq 0.5 %), the gap being the 1996 vs 2021 thermo data', () => {
  const ex = PUB.rp1311_example8;
  const r = M.rocket(db, prop('LOX/LH2'), ex.inputs.of, ex.inputs.pc_Pa);
  const gaps = {
    Tc: rel(r.chamber.T, ex.chamber.T), M: rel(r.chamber.M * 1000, ex.chamber.M_g_per_mol), gs: rel(r.chamber.gamma_s, ex.chamber.gamma_s),
    cp: rel(r.chamber.cp_eq / 1000, ex.chamber.cp_kJ_per_kgK), a: rel(r.chamber.a, ex.chamber.a),
    Pt: rel(r.throat.P / 1e5, ex.throat.P_bar), Tt: rel(r.throat.T, ex.throat.T), cstar: rel(r.cstar, ex.cstar),
  };
  for (const [k, g] of Object.entries(gaps)) assert.ok(Math.abs(g) < (k === 'cp' ? 6e-3 : 2e-3), `${k} ${g}`);
  assert.equal((gaps.cp * 100).toFixed(2), '0.50');
  // The numbers the README quotes, pinned:
  assert.equal((gaps.Tc * 100).toFixed(2), '-0.16');
  assert.equal((gaps.cstar * 100).toFixed(3), '-0.046');
  assert.equal(r.cstar.toFixed(2), '2332.34');
  assert.equal(r.chamber.T.toFixed(2), '3383.84');
});

test('NASA/TP-2002-211729 Table 3 (GOX/RP-1, 175 psia): kernel 0.21-0.61 % below, closing as O/F rises', () => {
  const t = PUB.tp2002_table3;
  const pc = 175 * P.PSI;
  const gaps = t.mixture_ratio.map((of, i) => rel(M.rocket(db, prop('GOX/RP-1'), of, pc).cstar / FT, t.cstar_ft_s[i]));
  for (const g of gaps) assert.ok(g < -0.002 && g > -0.0065, `gap ${g}`);
  for (let i = 1; i < gaps.length; i++) assert.ok(gaps[i] > gaps[i - 1], 'the gap shrinks monotonically with O/F');
  assert.equal((gaps[0] * 100).toFixed(2), '-0.61');
  assert.equal((gaps[gaps.length - 1] * 100).toFixed(2), '-0.21');
});

test('model vs a real chamber: MSFC measured 91.2-92.5 % of the kernel\'s c* (NASA/TP-2002-211729 Tables 11, 13)', () => {
  const ratios = MEAS.runs.map((run) => {
    const pc = (run.pc_psig + 101325 / P.PSI) * P.PSI;
    const r = M.rocket(db, prop('GOX/RP-1'), run.mixture_ratio, pc);
    return run.cstar_measured_ft_s * FT / r.cstar;
  });
  assert.equal(ratios.length, 6);
  const lo = Math.min(...ratios), hi = Math.max(...ratios);
  assert.equal((lo * 100).toFixed(1), '91.2');
  assert.equal((hi * 100).toFixed(1), '92.5');
  // equilibrium is an upper bound for a real chamber; the overstatement is 8.1-9.7 %
  assert.equal(((1 / hi - 1) * 100).toFixed(1), '8.1');
  assert.equal(((1 / lo - 1) * 100).toFixed(1), '9.7');
});

// ------------------------------------------------------------------ properties of the solution itself
const lox = { oxidizer: [{ name: 'O2(L)', w: 1 }], fuel: [{ name: 'RP-1', w: 1 }] };

test('Gibbs minimum: moving moles along any element-conserving direction raises G', () => {
  const mix = M.composeReactants(db, lox.oxidizer, lox.fuel, 2.4);
  const st = M.equilibrate(db, mix.b0, 7e6, { mode: 'TP', T: 3400 });
  const names = st.names.filter((nm) => st.x[nm] > 1e-4);
  const G = (n) => { // total Gibbs energy / RT of a gas mixture, mol/kg units
    const tot = Object.values(n).reduce((a, b) => a + b, 0);
    let g = 0;
    for (const [nm, v] of Object.entries(n)) {
      const th = M.thermoAt(db.products[nm], st.T);
      g += v * (th.h - th.s + Math.log(v / tot) + Math.log(st.P / M.P0));
    }
    return g;
  };
  const n0 = {};
  for (const nm of st.names) n0[nm] = st.x[nm] / st.M;
  const g0 = G(n0);
  // reactions that conserve elements: CO + H2O -> CO2 + H2, 2 OH -> H2O + O, H2 -> 2 H, 2 O -> O2
  const moves = [{ CO: -1, H2O: -1, CO2: 1, H2: 1 }, { OH: -2, H2O: 1, O: 1 }, { H2: -1, H: 2 }, { O: -2, O2: 1 }];
  for (const mv of moves) for (const sgn of [1, -1]) {
    const n = { ...n0 };
    for (const [k, v] of Object.entries(mv)) n[k] += sgn * v * 1e-3 * Math.min(...Object.keys(mv).map((q) => n0[q]));
    assert.ok(G(n) > g0, `${JSON.stringify(mv)} x${sgn} lowered G`);
  }
  assert.ok(names.length > 5);
});

test('consistency: TP at the HP temperature reproduces the composition; SP at chamber entropy returns the chamber', () => {
  const r = M.rocket(db, lox, 2.4, 7e6);
  const tp = M.equilibrate(db, r.mixture.b0, 7e6, { mode: 'TP', T: r.chamber.T });
  for (const [k, x] of Object.entries(r.chamber.x)) if (x > 1e-6) assert.ok(Math.abs(rel(tp.x[k], x)) < 1e-5, k);
  assert.ok(Math.abs(tp.h - r.mixture.h0) < 2, `h ${tp.h} vs ${r.mixture.h0}`);
  const sp = M.equilibrate(db, r.mixture.b0, 7e6, { mode: 'SP', s: r.chamber.s, T: 3000 });
  assert.ok(Math.abs(sp.T - r.chamber.T) < 1e-3);
  // elements are conserved: sum_j a_ij n_j = b0_i
  for (const el of ['C', 'H', 'O']) {
    let b = 0;
    for (const nm of r.chamber.names) b += (db.products[nm].elements[el] || 0) * r.chamber.x[nm] / r.chamber.M;
    assert.ok(Math.abs(rel(b, r.mixture.b0[el])) < 1e-6, el);
  }
});

test('derivatives: gamma_s and cp_eq agree with finite differences of the equilibrium itself', () => {
  const r = M.rocket(db, lox, 2.4, 7e6);
  const b0 = r.mixture.b0, ch = r.chamber, eps = 1e-4;
  // gamma_s = (d ln P / d ln rho) along the isentrope (shifting equilibrium)
  const up = M.equilibrate(db, b0, 7e6 * (1 + eps), { mode: 'SP', s: ch.s, start: ch });
  const dn = M.equilibrate(db, b0, 7e6 * (1 - eps), { mode: 'SP', s: ch.s, start: ch });
  const gFD = Math.log((1 + eps) / (1 - eps)) / Math.log(up.rho / dn.rho);
  assert.ok(Math.abs(rel(ch.gamma_s, gFD)) < 1e-5, `gamma_s ${ch.gamma_s} vs FD ${gFD}`);
  // cp_eq = (dh/dT) at constant P with the composition shifting
  const hT = (T) => M.equilibrate(db, b0, 7e6, { mode: 'TP', T, start: ch }).h;
  const cpFD = (hT(ch.T + 0.5) - hT(ch.T - 0.5)) / 1;
  assert.ok(Math.abs(rel(ch.cp_eq, cpFD)) < 1e-5, `cp_eq ${ch.cp_eq} vs FD ${cpFD}`);
  // the frozen values bound the equilibrium ones for a dissociating gas
  assert.ok(ch.cp_eq > ch.cp_fr && ch.gamma_s < ch.gamma_fr);
});

test('throat: velocity equals the sound speed and the mass flux there is a maximum', () => {
  const r = M.rocket(db, lox, 2.4, 7e6);
  assert.ok(Math.abs(rel(r.throatVelocity, r.throat.a)) < 1e-9);
  const flux = (pt) => {
    const s = M.equilibrate(db, r.mixture.b0, pt, { mode: 'SP', s: r.chamber.s, start: r.throat });
    return s.rho * Math.sqrt(2 * (r.chamber.h - s.h));
  };
  const g0 = flux(r.throat.P);
  assert.ok(flux(r.throat.P * 1.01) < g0 && flux(r.throat.P * 0.99) < g0);
  assert.ok(Math.abs(rel(r.cstar, r.pc / g0)) < 1e-9);
  // the closed-form c* with the chamber gamma_s is close but not equal: equilibrium shifts on the way to the throat
  assert.ok(Math.abs(rel(r.cstarClosedForm, r.cstar)) < 0.01 && r.cstarClosedForm !== r.cstar);
});

test('limit case: a frozen, non-dissociating gas obeys the ideal-gas closed forms exactly', () => {
  // N2 + nothing else (only N2 and N are admissible; at 300 K N is absent): gamma_s = gamma_frozen = cp/(cp-R/M)
  const st = M.equilibrate(db, { N: 2 / 0.0280134 }, 1e5, { mode: 'TP', T: 300 });
  assert.ok(Math.abs(rel(st.M, 0.0280134)) < 1e-12);
  assert.ok(Math.abs(st.dlnV_dlnP + 1) < 1e-12 && Math.abs(st.dlnV_dlnT - 1) < 1e-12);
  assert.ok(Math.abs(rel(st.gamma_s, st.gamma_fr)) < 1e-12);
  assert.ok(Math.abs(rel(st.rho, 1e5 * 0.0280134 / (M.R * 300))) < 1e-12);
});

test('O/F of maximum c* is a maximum, and lies fuel-rich of stoichiometric for every preset', () => {
  for (const pr of P.PRESETS) {
    const p = { oxidizer: pr.oxidizer, fuel: pr.fuel };
    const m = M.maxCstar(db, p, 1e7, pr.ofRange[0], pr.ofRange[1]);
    const lo = M.rocket(db, p, m.of * 0.98, 1e7).cstar, hi = M.rocket(db, p, m.of * 1.02, 1e7).cstar;
    assert.ok(m.cstar > lo && m.cstar > hi, pr.id);
    assert.ok(m.of < M.stoichiometricOF(db, pr.oxidizer, pr.fuel), pr.id);
  }
});

// ------------------------------------------------------------------ densities in use
test('densities: single, measured blend, volume-additive blend, and refusals', () => {
  const r1 = M.sideDensity(D, [{ name: 'RP-1', w: 1 }]);
  assert.equal(r1.value, 810); assert.equal(r1.confidence, 'measured'); assert.deepEqual(r1.range, [800, 820]);
  const htp = M.sideDensity(D, [{ name: 'H2O2(L)', w: 0.98 }, { name: 'H2O(L)', w: 0.02 }]);
  assert.equal(htp.value, 1432); assert.equal(htp.confidence, 'measured');
  const a50 = M.sideDensity(D, [{ name: 'N2H4(L)', w: 0.5 }, { name: 'C2H8N2(L),UDMH', w: 0.5 }]);
  assert.ok(Math.abs(a50.value - 1 / (0.5 / 1010 + 0.5 / 789)) < 1e-9); assert.equal(a50.confidence, 'derived');
  const pure = M.sideDensity(D, [{ name: 'H2O2(L)', w: 1 }]);
  assert.equal(pure.refusal.code, 'insufficient_data');
  // SP-125 Table 1-4 also measured the 95 % grade (added by the review); 90 % was never measured
  const htp95 = M.sideDensity(D, [{ name: 'H2O2(L)', w: 0.95 }, { name: 'H2O(L)', w: 0.05 }]);
  assert.equal(htp95.value, 1414); assert.equal(htp95.confidence, 'measured');
  const htp90 = M.sideDensity(D, [{ name: 'H2O2(L)', w: 0.90 }, { name: 'H2O(L)', w: 0.10 }]);
  assert.equal(htp90.refusal.code, 'insufficient_data', 'no borrowed blend value');
  assert.equal(M.sideDensity(D, [{ name: 'O2', w: 1 }]).refusal.code, 'insufficient_data', 'gaseous oxygen has no liquid density');
  // bulk density: equal volumes of 1000 and 500 kg/m^3 at O/F 2 -> 750
  assert.ok(Math.abs(M.bulkDensity(1000, 500, 2) - 750) < 1e-12);
});

// ------------------------------------------------------------------ refusals
test('refusals: bad inputs, missing data and out-of-envelope conditions come back structured, never as numbers', () => {
  const codes = (r) => (r.refusal ? r.refusal.code : 'none');
  assert.equal(codes(M.rocket(db, lox, 0, 1e7)), 'invalid_input');
  assert.equal(codes(M.rocket(db, lox, NaN, 1e7)), 'invalid_input');
  assert.equal(codes(M.rocket(db, lox, 2, -5)), 'invalid_input');
  assert.equal(codes(M.rocket(db, { oxidizer: [{ name: 'O2(L)', w: 0.6 }], fuel: lox.fuel }, 2, 1e7)), 'invalid_input');
  assert.equal(codes(M.rocket(db, { oxidizer: [{ name: 'F2(L)', w: 1 }], fuel: lox.fuel }, 2, 1e7)), 'not_found');
  assert.equal(codes(M.rocket(db, { oxidizer: lox.oxidizer, fuel: [{ name: 'RP-1', w: 1, T: 250 }] }, 2, 1e7)), 'insufficient_data');
  assert.equal(codes(M.rocket(db, lox, 1.0, 1e7)), 'out_of_envelope');
  for (const r of [M.rocket(db, lox, 0, 1e7), M.rocket(db, lox, 1.0, 1e7)]) {
    assert.ok(r.refusal.reason.length > 20 && r.refusal.what_would_help.length > 10);
    assert.equal(r.cstar, undefined);
  }
});

// ------------------------------------------------------------------ handoff
test('handoff: every output has value, SI units, a confidence class and a source; round-trips through #h=', () => {
  const inputs = { preset: 'lox-rp1', oxidizer: [{ name: 'O2(L)', w: 1, T: 90.17 }], fuel: [{ name: 'RP-1', w: 1, T: 298.15 }], of: 2.6, pc: 1e7 };
  const r = M.rocket(db, inputs, inputs.of, inputs.pc);
  const dens = { oxidizer: M.sideDensity(D, inputs.oxidizer), fuel: M.sideDensity(D, inputs.fuel) };
  const h = M.makeHandoff(inputs, r, dens, { produced: '2026-10-31T00:00:00Z', stoichiometric_mixture_ratio: M.stoichiometricOF(db, inputs.oxidizer, inputs.fuel) });
  assert.equal(h.handoff, 'long-way-round'); assert.equal(h.version, 1); assert.equal(h.from, '31-mixture');
  for (const [k, o] of Object.entries(h.outputs)) {
    assert.ok('value' in o && typeof o.units === 'string' && typeof o.source === 'string', k);
    assert.ok(['measured', 'derived', 'assumed'].includes(o.confidence), k);
  }
  for (const k of ['chamber_temperature', 'chamber_molar_mass', 'chamber_gamma_s', 'cstar', 'chamber_composition', 'oxidizer_density', 'fuel_density', 'bulk_density', 'element_amounts', 'chamber_entropy', 'species_set', 'throat_pressure']) assert.ok(h.outputs[k], k);
  assert.equal(h.outputs.cstar.value, r.cstar);
  assert.equal(h.refusals.length, 0);
  const frag = '#h=' + M.b64urlEncode(JSON.stringify(h));
  const back = M.parseHandoff('https://example.org/x.html' + frag);
  assert.deepEqual(back.handoff, h);
  assert.deepEqual(back.inputs.oxidizer, [{ name: 'O2(L)', w: 1, T: 90.17 }]);
  assert.equal(back.inputs.of, 2.6); assert.equal(back.inputs.pc, 1e7);
  // a refused point carries the refusal, not numbers; GOX carries a density refusal for the oxidizer only
  const rr = M.rocket(db, lox, 1.0, 1e7);
  const hr = M.makeHandoff({ ...inputs, of: 1.0 }, rr, dens);
  assert.equal(hr.outputs.cstar, undefined); assert.equal(hr.refusals[0].code, 'out_of_envelope');
  const gox = { oxidizer: [{ name: 'O2', w: 1, T: 298.15 }], fuel: inputs.fuel };
  const hg = M.makeHandoff({ ...gox, of: 2, pc: 1e7 }, M.rocket(db, gox, 2, 1e7), { oxidizer: M.sideDensity(D, gox.oxidizer), fuel: M.sideDensity(D, gox.fuel) });
  assert.equal(hg.refusals.length, 1); assert.equal(hg.refusals[0].applies_to, 'oxidizer_density');
  assert.equal(hg.outputs.bulk_density, undefined); assert.ok(hg.outputs.cstar);
  // malformed input is refused
  assert.equal(M.parseHandoff('not json').refusal.code, 'invalid_input');
  assert.equal(M.parseHandoff({ handoff: 'other' }).refusal.code, 'invalid_input');
  assert.equal(M.parseHandoff({ handoff: 'long-way-round', version: 1, inputs: {} }).refusal.code, 'insufficient_data');
});

test('sample handoff.json is what the kernel computes for its own inputs', () => {
  const h = JSON.parse(fs.readFileSync(path.join(here, 'handoff.json'), 'utf8'));
  const back = M.parseHandoff(h);
  const r = M.rocket(db, back.inputs, back.inputs.of, back.inputs.pc);
  assert.equal(h.outputs.cstar.value, r.cstar);
  assert.equal(h.outputs.chamber_temperature.value, r.chamber.T);
  assert.equal(h.outputs.throat_pressure.value, r.throat.P);
});

test('page text: the validation numbers index.html states are the ones these tests pin', () => {
  const html = fs.readFileSync(path.join(here, 'index.html'), 'utf8');
  for (const s of ['0.16 %', '0.046 %', '0.21', '0.61 %', '91.2', '92.5 %', '8.1', '9.7 %', '43 gas species', 'below O/F 1.13 to 1.15']) assert.ok(html.includes(s), s);
});

// ------------------------------------------------------------------ added by the independent review
// oracle/cea-review.json: the reviewer's own CEA script (oracle/cea_review.py); envelope edges, off-grid points,
// graphite boundaries by bisection.
test('review oracle: CEA at 0.1 and 300 bar and 12 off-grid points, same tolerances', () => {
  const worst = {};
  const up = (k, v) => { worst[k] = Math.max(worst[k] || 0, Math.abs(v)); };
  let n = 0;
  // rows: [pair, of, pc_Pa, condensed, [T, M, gamma_s, cp_eq, s, cstar, Pt, Tt] (same species), [T, cstar] (full set)]
  for (const [pair, of, pc, condensed, o, full] of [...REV.edges, ...REV.offgrid]) {
    if (condensed) continue;
    const r = M.rocket(db, prop(pair), of, pc);
    assert.ok(!r.refusal, `${pair} ${of} ${pc}: ${r.refusal && r.refusal.reason}`);
    up('T', rel(r.chamber.T, o[0])); up('M', rel(r.chamber.M, o[1])); up('gamma_s', rel(r.chamber.gamma_s, o[2]));
    up('cp_eq', rel(r.chamber.cp_eq, o[3])); up('s', rel(r.chamber.s, o[4])); up('cstar', rel(r.cstar, o[5]));
    up('Pt', rel(r.throat.P, o[6])); up('Tt', rel(r.throat.T, o[7])); up('full_T', rel(r.chamber.T, full[0])); up('full_cstar', rel(r.cstar, full[1]));
    n++;
  }
  assert.equal(n, 72);
  for (const k of ['T', 'M', 'gamma_s', 'cp_eq', 's', 'full_T']) assert.ok(worst[k] < 1e-6, `${k} ${worst[k]}`);
  assert.ok(worst.cstar < 5e-6 && worst.full_cstar < 5e-6, `c* ${worst.cstar} / full ${worst.full_cstar}`);
  assert.ok(worst.Pt < 3e-5 && worst.Tt < 1e-5, `throat P ${worst.Pt}, T ${worst.Tt}`);
  assert.ok(REV.edges.some((p) => p[2] === 1e4) && REV.edges.some((p) => p[2] === 3e7));
  assert.deepEqual(M.PC_ENVELOPE, [1e4, 3e7]);
});

test('graphite: the kernel\'s boundary is CEA\'s or up to 0.0015 leaner, never richer', () => {
  for (const b of REV.graphite_chamber_or_throat) {
    const p = { oxidizer: [{ name: 'O2(L)', w: 1 }], fuel: [{ name: b.fuel, w: 1 }] };
    const ref = (of) => !!M.rocket(db, p, of, b.pc_Pa).refusal;
    let lo = 0.5, hi = 1.5;
    for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (ref(m)) lo = m; else hi = m; }
    const d = hi - b.of[1];
    assert.ok(d > -1e-6 && d < 1.5e-3, `${b.fuel} ${b.pc_Pa} Pa: kernel ${hi} vs CEA ${b.of[1]}`);
  }
  // the nozzle-graphite O/F the README gives module 32
  const top = Math.max(...REV.nozzle_graphite_lox_rp1_to_1000.map((b) => b.of[1]));
  const readme = fs.readFileSync(path.join(here, 'README.md'), 'utf8');
  assert.ok(readme.includes(`O/F ${top.toFixed(2)}`), `README states ${top.toFixed(2)}`);
});

test('pressure envelope: outside 0.1-300 bar refused with no numbers; opts.envelope widens it', () => {
  for (const pc of [9.99e3, 3.0001e7, 1e11]) {
    const r = M.rocket(db, lox, 2.3, pc);
    assert.equal(r.refusal && r.refusal.code, 'out_of_envelope', `${pc}`);
    assert.equal(r.cstar, undefined); assert.equal(r.chamber, undefined);
  }
  assert.ok(!M.rocket(db, lox, 2.3, 1e4).refusal && !M.rocket(db, lox, 2.3, 3e7).refusal);
  assert.ok(M.rocket(db, lox, 2.3, 4e7, { envelope: [1e4, 5e7] }).cstar > 0);
  // the slider and its one-tenth curve stay inside
  assert.ok(P.PC_MIN / 10 >= M.PC_ENVELOPE[0] && P.PC_MAX <= M.PC_ENVELOPE[1]);
  // psi from the definitions of the pound, standard gravity and the inch
  assert.equal(P.PSI, 0.45359237 * 9.80665 / 0.0254 ** 2);
});

test('module 32\'s recipe works from the exported JSON alone', () => {
  for (const src of ['file', 'fresh']) {
    let h;
    if (src === 'file') h = JSON.parse(fs.readFileSync(path.join(here, 'handoff.json'), 'utf8'));
    else {
      const pr = P.PRESETS.find((x) => x.id === 'nto-mmh');
      const inputs = { preset: pr.id, oxidizer: pr.oxidizer, fuel: pr.fuel, of: 1.9, pc: 7e6 };
      const r = M.rocket(db, inputs, inputs.of, inputs.pc);
      h = JSON.parse(JSON.stringify(M.makeHandoff(inputs, r, { oxidizer: M.sideDensity(D, pr.oxidizer), fuel: M.sideDensity(D, pr.fuel) },
        { stoichiometric_mixture_ratio: M.stoichiometricOF(db, pr.oxidizer, pr.fuel) })));
    }
    const O = h.outputs;
    const opt = (s) => ({ mode: 'SP', s: O.chamber_entropy.value, species: O.species_set.value });
    const c = M.equilibrate(db, O.element_amounts.value, O.chamber_pressure.value, opt());
    assert.ok(Math.abs(rel(c.T, O.chamber_temperature.value)) < 1e-8, `${src}: Tc ${c.T}`);
    assert.ok(Math.abs(rel(c.M, O.chamber_molar_mass.value)) < 1e-8 && Math.abs(rel(c.gamma_s, O.chamber_gamma_s.value)) < 1e-7);
    const t = M.equilibrate(db, O.element_amounts.value, O.throat_pressure.value, opt());
    assert.ok(Math.abs(rel(t.T, O.throat_temperature.value)) < 1e-8, `${src}: Tt`);
    assert.ok(Math.abs(rel(Math.sqrt(2 * (O.chamber_enthalpy.value - t.h)), O.throat_velocity.value)) < 1e-6, `${src}: u_t`);
    assert.ok(Math.abs(rel(O.chamber_pressure.value / (O.throat_density.value * O.throat_velocity.value), O.cstar.value)) < 1e-12);
    // frozen composition rebuilds the frozen cp
    const x = O.chamber_composition.value;
    const sum = Object.values(x).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 1e-5, `${src}: sum x ${sum}`);
    let cpf = 0;
    for (const [k, v] of Object.entries(x)) cpf += v * M.thermoAt(db.products[k], O.chamber_temperature.value).cp;
    assert.ok(Math.abs(rel(cpf * M.R / O.chamber_molar_mass.value, O.chamber_cp_frozen.value)) < 1e-5, `${src}: frozen cp`);
    assert.ok(O.stoichiometric_mixture_ratio.value > 0 && O.species_set.value.length >= 9);
  }
});

test('refusal texts: no NaN or Infinity; the temperature span quoted is the species\' own', () => {
  for (const r of [M.rocket(db, lox, NaN, 1e7), M.rocket(db, lox, 2, NaN), M.rocket(db, lox, Infinity, 1e7), M.rocket(db, lox, 2, -Infinity)]) {
    assert.equal(r.refusal.code, 'invalid_input');
    assert.doesNotMatch(r.refusal.reason + r.refusal.what_would_help, /NaN|Infinity/);
  }
  const hn = M.makeHandoff({ oxidizer: lox.oxidizer, fuel: lox.fuel, of: NaN, pc: 1e7 }, M.rocket(db, lox, NaN, 1e7), {
    oxidizer: M.sideDensity(D, lox.oxidizer), fuel: M.sideDensity(D, lox.fuel) });
  for (const [k, o] of Object.entries(hn.outputs)) assert.ok(typeof o.value !== 'number' || isFinite(o.value), k);
  assert.equal(hn.outputs.mixture_ratio, undefined); assert.equal(hn.outputs.bulk_density, undefined);
  const b0 = M.composeReactants(db, lox.oxidizer, lox.fuel, 2.5).b0;
  const cold = M.equilibrate(db, b0, 1e5, { mode: 'TP', T: 250 });
  assert.match(cold.refusal.what_would_help, /between 300 and 6000 K, where all 28 species/);
  const h2 = M.equilibrate(db, { H: 100 }, 1e5, { mode: 'TP', T: 150 });
  assert.match(h2.refusal.what_would_help, /between 200 and 20000 K, where all 2 species/);
});

test('closed-form c* differs by 0.008 to 0.19 % at the presets\' opening points', () => {
  const gaps = P.PRESETS.map((pr) => {
    const pc = pr.pc || P.PC_DEFAULT;
    const m = M.maxCstar(db, pr, pc, pr.ofRange[0], pr.ofRange[1]);
    const r = M.rocket(db, pr, +m.of.toFixed(3), pc);
    return rel(r.cstarClosedForm, r.cstar) * 100;
  });
  assert.equal(Math.min(...gaps).toFixed(3), '0.008');
  assert.equal(Math.max(...gaps).toFixed(2), '0.19');
  const readme = fs.readFileSync(path.join(here, 'README.md'), 'utf8');
  assert.ok(readme.includes('0.008 to 0.19 %'));
});

test('reactant temperature: a fitted reactant\'s enthalpy follows its own cp', () => {
  // an imported handoff may carry T for a fitted reactant
  const h = (T) => M.reactantEnthalpy(db, 'N2H4(L)', T).H;
  const cp = M.thermoAt(db.reactants['N2H4(L)'], 300).cp * M.R;
  assert.ok(Math.abs(rel((h(300.5) - h(299.5)) / 1, cp)) < 1e-4, 'dH/dT = cp at 300 K');
  assert.ok(h(320) - h(298.15) > 1000);
});
