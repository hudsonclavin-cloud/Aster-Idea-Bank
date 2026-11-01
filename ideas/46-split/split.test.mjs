// Tests for idea 46 (Split). Run from the bank root: node --test ideas/46-split/split.test.mjs
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
const S = L.deps.sources;
const CEA = JSON.parse(fs.readFileSync(path.join(HERE, 'oracle/cea-split.json'), 'utf8'));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b} (tol ${tol})`);
const rel = (a, b) => (a - b) / b;
const F = 6.02214076e23 * 1.602176634e-19; // CODATA: N_A e, both exact

const chain = K.parseHandoff(L.sample45());
const bennu = K.parseHandoff(L.bennu45());
const C = chain.src, Bn = bennu.src;
const Rc = K.run(C, {});

test('1. snapshots: sidecars match, earlier kernels byte-identical, idea 45\'s handoff wrapped unmodified, sources complete', () => {
  const dir = path.join(HERE, 'snapshots');
  for (const f of fs.readdirSync(dir).filter((x) => !x.endsWith('.provenance.json'))) {
    const side = JSON.parse(fs.readFileSync(path.join(dir, f + '.provenance.json'), 'utf8'));
    assert.equal(sha(fs.readFileSync(path.join(dir, f))), side.writtenSha256, f + ' differs from its sidecar');
    for (const k of ['repo', 'path', 'commit']) assert.ok(side[k], f + ' sidecar lacks ' + k);
  }
  for (const [mine, theirs] of [['mixture.js', 'ideas/31-mixture/mixture.js'], ['thermo-excerpt.js', 'ideas/31-mixture/snapshots/thermo-excerpt.js'], ['propellant-densities.js', 'ideas/31-mixture/snapshots/propellant-densities.js'],
    ['mixture-presets.js', 'ideas/31-mixture/presets.js'], ['bell.js', 'ideas/32-bell/bell.js'], ['nozzle-charts.js', 'ideas/32-bell/snapshots/nozzle-charts.js'], ['nozzle-rules.js', 'ideas/32-bell/snapshots/nozzle-rules.js'],
    ['isa.js', 'ideas/32-bell/snapshots/isa.js'], ['sp8120-table1.js', 'ideas/32-bell/snapshots/sp8120-table1.js']]) {
    assert.ok(fs.readFileSync(path.join(dir, mine)).equals(fs.readFileSync(path.join(BANK, theirs))), mine + ' is not ' + theirs);
  }
  // the wrapped chain handoff is idea 45's, with idea 44's inside it replaced by a digest the kernel's own SHA-256 computes
  const h45 = JSON.parse(fs.readFileSync(path.join(BANK, 'ideas/45-dig/handoff.json'), 'utf8'));
  const d = L.sample45().inputs.touch_handoff;
  assert.equal(d.pruned, true);
  assert.equal(d.sha256, sha(JSON.stringify(h45.inputs.touch_handoff)), 'digest of idea 44\'s handoff, by node:crypto');
  assert.equal(L.Split.sha256(JSON.stringify(h45.inputs.touch_handoff)), d.sha256, 'the kernel\'s SHA-256 agrees with node:crypto');
  for (const t of ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'Δv – 7.94 ☉']) assert.equal(L.Split.sha256(t), sha(Buffer.from(t, 'utf8')), 'sha256(' + t.slice(0, 8) + ')');
  assert.equal(d.bytes, JSON.stringify(h45.inputs.touch_handoff).length);
  h45.inputs.touch_handoff = d;
  assert.deepEqual(L.sample45(), h45, 'everything else unmodified');
  assert.equal(S.quotes.length, 33, 'build-data.mjs found 33 quoted strings in their sources');
  assert.match(S.cryoKpp.note, /flight-like projection/, 'the cooler\'s 5.5 kg/W is a projection, and says so');
  assert.equal(S.codata.F, F, 'Faraday = N_A e');
  assert.equal(K.F, F);
  assert.equal(S.calorie_th_J, 4.184);
  assert.equal(S.janaf.rows.length, 6);
  assert.equal(S.cryo20.table.length, 6);
  // PartForge's metals as its source says (when the checkout is here)
  const pf = '/home/user/Partforge/index.html';
  if (fs.existsSync(pf)) {
    const t = fs.readFileSync(pf, 'utf8');
    assert.match(t, /'6061-T6': \{ name: 'Aluminum 6061-T6', den: 2\.70, sy: 276, su: 310/);
    assert.equal(L.deps.materials.metals['6061-T6'].su_MPa, 310);
  }
  assert.equal(K.FS, 1.4, 'NASA-STD-5001B metallic ultimate design factor via PartForge');
});

test('2. electrolysis energies from idea 31\'s NASA Glenn data against NIST-JANAF (the oracle), 280 to 360 K', () => {
  let worstRev = 0, worstTn = 0;
  for (const [T, , , dfH, dfG] of S.janaf.rows) {
    const e = K.electrolysis(T);
    const dRev = e.Erev - (-dfG * 1000 / (2 * F)), dTn = e.Etn - (-dfH * 1000 / (2 * F));
    worstRev = Math.max(worstRev, Math.abs(dRev)); worstTn = Math.max(worstTn, Math.abs(dTn));
  }
  assert.ok(worstRev < 5e-5, 'E_rev within 0.05 mV of JANAF everywhere: ' + worstRev);
  assert.ok(worstTn < 5e-5, 'E_tn within 0.05 mV of JANAF everywhere: ' + worstTn);
  assert.ok(worstRev > 1e-7, 'two compilations, not one: they are not bit-identical');
  const e298 = K.electrolysis(298.15);
  close(e298.Erev, 1.228882, 2e-6, 'E_rev at 298.15 K');
  close(e298.Etn, 1.481210, 2e-6, 'E_tn at 298.15 K');
  // Gibbs-Helmholtz: dE_rev/dT = -dS/(2F)
  const h = 0.01, d = (K.electrolysis(330 + h).Erev - K.electrolysis(330 - h).Erev) / (2 * h);
  close(d, -K.electrolysis(330).dS / (2 * F), 1e-8, 'dE/dT');
  // Nernst, by hand: R T/(2F) x 1.5 ln(p/1 bar) at 333.15 K and 20 MPa with CEA's R 8.31451 = 0.1140813 V
  close(K.nernst(333.15, 20e6), 8.31451 * 333.15 / (2 * F) * 1.5 * Math.log(200), 1e-12);
  close(K.nernst(333.15, 20e6), 0.11408129, 1e-8, 'Nernst at 20 MPa');
  close(K.nernst(333.15, 1e5), 0, 1e-15);
  assert.equal(K.electrolysis(270).refusal.code, 'out_of_envelope');
  assert.equal(K.electrolysis(361).refusal.code, 'out_of_envelope');
});

test('3. the cell: Faraday by hand, DOE\'s kWh/kg and the ISS OGA\'s oxygen', () => {
  // 2 F V / M_H2O at 1.9 V, 100 %: 2 x 96485.33212 x 1.9 / 0.01801528 = 20.35185 MJ per kg of water
  const c = K.cell({ V: 1.9, etaF: 1, T: 298.15, p: 1e5 });
  close(c.e_J_per_kg_water, 2 * F * 1.9 / 0.01801528, 1e-6);
  close(c.e_J_per_kg_water / 1e6, 20.351849, 1e-6);
  close(c.heat_J_per_kg_water, c.e_J_per_kg_water - K.electrolysis(298.15).dH / 0.01801528, 1e-6);
  // product split from idea 31's molar masses: 2.01588 + 15.9994 = 18.01528 exactly
  close(K.FH + K.FO, 1, 1e-15);
  close(K.FH, 2.01588 / 18.01528, 1e-15);
  assert.equal(K.R_ST, L.M.stoichiometricOF(L.db, [{ name: 'O2(L)', w: 1 }], [{ name: 'H2(L)', w: 1 }]), 'the water\'s O/F is idea 31\'s stoichiometric O/F');
  // DOE stack electrical energy at each V/cell with DOE's 2.5 % crossover: the kernel reads 1.5 to 2.3 % above DOE's figures
  const gaps = K.reality().filter((r) => /^doe-/.test(r.id)).map((r) => [r.id, r.model, r.gap]);
  assert.deepEqual(gaps.map((g) => g[0]), ['doe-status2022', 'doe-target2026', 'doe-ultimate']);
  close(gaps[0][1], 51.81710, 1e-4); close(gaps[1][1], 49.08988, 1e-4); close(gaps[2][1], 43.63545, 1e-4);
  gaps.forEach((g) => assert.ok(g[2] > 0.01 && g[2] < 0.025, g[0] + ' gap ' + g[2]));
  // ISS OGA: 28 x 46.9 A x 86400 s / 4F x 31.9988 g/mol = 9.40713 kg/day at 100 %; published 9.25 -> 98.33 %
  close(K.OGA_IDEAL, 28 * 46.9 * 86400 / (4 * F) * 0.0319988, 1e-12);
  close(K.OGA_IDEAL, 9.407127, 2e-6);
  close(K.OGA_ETA, 0.9832970, 2e-7);
  assert.equal(K.defaults(C).etaF, K.OGA_ETA, 'the default Faraday efficiency is the OGA\'s');
  // a cell at or below the reversible voltage splits nothing
  assert.equal(K.cell({ V: 1.15, etaF: 1, T: 333.15, p: 1e5 }).refusal.code, 'out_of_envelope');
  const gasCell = K.cell({ V: 1.9, etaF: 1, T: 333.15, p: 20e6 });
  close(gasCell.V - 1.9, 0.11408129, 1e-8, 'the gas route pays the Nernst voltage');
});

test('4. arrays: 1/r^2 against two flown spacecraft (NEAR, the chain\'s own, and Psyche)', () => {
  const r = Object.fromEntries(K.reality().map((x) => [x.id, x]));
  close(r.near.model, 1800 / (2.2 * 2.2), 1e-9);
  close(r.near.gap, -0.0702479, 1e-6, 'NEAR at 2.2 au: 1/r^2 reads 7.0 % low');
  close(r['psyche-Q'].gap, -0.1716473, 1e-6, 'Psyche at 3.32 au: 17.2 % low');
  close(r['psyche-q'].gap, -0.0350622, 1e-6, 'Psyche at 2.53 au: 3.5 % low');
  close(K.arrayPower(1800, 0.843837), 2527.8737, 1e-3, 'the chain\'s first day, NEAR\'s arrays');
  assert.equal(Rc.L.rows[0].P_W, K.arrayPower(1800, C.days[0].r_au));
});

test('5. cryogenics: NIST tables, the NBS 1958 heats, the 20 K cooler\'s measured turndown, MHTB insulation', () => {
  const r = Object.fromEntries(K.reality().map((x) => [x.id, x]));
  // NBS 1958's 216 cal/mol is freshly made (normal) liquid hydrogen's: NIST's normal hydrogen agrees to +0.09 %, its
  // parahydrogen (the stored liquid, used for boil-off) is 0.50 % under
  close(r.hvap.gap, 8.886e-4, 2e-5, 'NIST normal-hydrogen latent heat against NBS 1958\'s 216 cal/mol');
  close(K.hfg(K.PH2) / (216 * 4.184 / 0.00201588) - 1, -0.005012, 2e-5, 'parahydrogen\'s latent heat 0.50 % under');
  close(r.lox.gap, -7.70e-5, 2e-6); close(r.lh2.gap, -1.99e-5, 2e-6);
  close(K.Q_CONV, 254 * 4.184 / 0.00201588, 1e-6);
  close(K.Q_CONV, 527182.17, 0.01, 'normal -> para heat per kg');
  close(K.hfg(K.PH2), 446065.4, 1e-6); close(K.hfg(K.LO2), 79688.192 + 133367.75, 1e-6);
  // the loads, interpolated by hand from NIST's NORMAL-hydrogen rows (the cell's gas; no catalyst above 20 K)
  const rows = S.nist.nh2_1atm.gas, i = rows.findIndex((x) => x[0] > 333.15), a = rows[i - 1], b = rows[i];
  const h333 = a[1] + (b[1] - a[1]) * (333.15 - a[0]) / (b[0] - a[0]);
  const h90 = rows.find((x) => x[0] === 90)[1];
  const [l0, l1] = S.nist.nh2_1atm.liq, Tp = S.nist.ph2_1atm.sat.T;
  const hl = l0[1] + (l1[1] - l0[1]) * (Tp - l0[0]) / (l1[0] - l0[0]); // normal liquid at para's boiling point
  const liq = K.liquefaction(333.15);
  close(liq.h2_hi, h333 - h90, 1e-6);
  close(liq.h2_hi, 3240673.62, 0.01, '90 K stage: 3.241 MJ/kg of normal hydrogen');
  close(liq.h2_lo, h90 - hl + K.Q_CONV, 1e-6, 'condense as normal liquid, then convert to para');
  close(liq.h2_lo, 1721800.27, 0.01, '20 K stage: 1.722 MJ/kg');
  // two independent NIST fluid models must agree on the total once the ortho-para heat is counted once: the normal
  // table plus NBS 1958's conversion against the para table alone. The para table already holds the rotational heat
  // below ~300 K, so adding the conversion to it (the first build) read 10.7 % high.
  // What is left between them is the ortho-para energy still in the gas at T, which fades as the rotational levels
  // fill: 31, 18, 12 and 7 kJ/kg at 300, 333, 360 and 400 K.
  let last = Infinity;
  for (const T of [300, 333.15, 360, 400]) {
    const q = K.liquefaction(T), d = q.h2_hi + q.h2_lo - q.h2_para_table;
    assert.ok(d > 0 && d / q.h2_para_table < 0.01 && d < last, 'normal + conversion vs para table at ' + T + ' K: ' + d + ' J/kg');
    last = d;
  }
  close(r.liq.gap, 0.0035478, 2e-6, 'the live reality row');
  const orows = S.nist.o2_1atm.gas, j = orows.findIndex((x) => x[0] > 333.15);
  const hO = orows[j - 1][1] + (orows[j][1] - orows[j - 1][1]) * (333.15 - orows[j - 1][0]) / (orows[j][0] - orows[j - 1][0]);
  close(liq.o2, hO + 133367.75, 1e-6);
  assert.equal(K.liquefaction(80).refusal.code, 'out_of_envelope');
  // the 20 K cooler reproduces its table and adds units past 16.5 W
  for (const [q, p] of [[3, 830], [5, 992], [10, 1304], [15, 1607], [16.5, 1642]]) assert.equal(K.cooler20(q).P, p);
  assert.deepEqual(K.cooler20(20), { P: 2 * 1304, units: 2 });
  assert.deepEqual(K.cooler20(0), { P: 0, units: 0 });
  assert.equal(K.cooler20(33.1).units, 3);
  // the transcription is self-consistent: lift / input / Carnot COP(20 K, 300 K) is the table's own % of Carnot
  for (const [q, p, , pct] of S.cryo20.table.slice(1)) close(q / p / (20 / 280) * 100, pct, 0.15, 'row ' + q);
  close(K.sp90(K.CC_FCARNOT), (300 / 90 - 1) / 0.1395, 1e-12);
  close(K.CC_UNIT_KG, 19.2 * 5.5, 1e-12);
  // MHTB: the two measured points exactly, nothing outside them
  close(K.mliFlux(164).q, 0.085, 1e-15); close(K.mliFlux(305).q, 0.22, 1e-15);
  assert.equal(K.mliFlux(163.9).refusal.code, 'out_of_envelope'); assert.equal(K.mliFlux(305.1).refusal.code, 'out_of_envelope');
  close(K.sphereArea(4 / 3 * Math.PI), 4 * Math.PI, 1e-12);
  // boil-off on the chain's first day: with zero boil-off the tanks boil only in the dark
  const d0 = Rc.L.rows[0], leak = Rc.tanks.leak;
  close(d0.boil_h2, Math.min(d0.split_kg * K.FH, leak.h2 * (86400 - d0.lit_h * 3600) / K.hfg(K.PH2)), 1e-15);
  const Rn = K.run(C, { zbo: false });
  close(Rn.L.rows[0].boil_o2, Math.min(Rn.L.rows[0].o2_kg + Rn.L.rows[0].boil_o2, Rn.tanks.leak.o2 * 86400 / K.hfg(K.LO2)), 1e-15);
  assert.ok(Rn.tanks.capH < Rc.tanks.capH, 'passive tanks hold less at their peak, so they are smaller');
  assert.ok(Rn.L.boil.h2 > Rc.L.boil.h2, 'turning zero boil-off off loses more hydrogen');
});

test('6. tanks: NIST gas densities, the thin-walled sphere by hand, PartForge\'s metal and factor', () => {
  close(K.gasDensity('h2_293K', 20e6), S.nist.h2_293K.rows.find((x) => x[0] === 20e6)[1], 1e-12);
  close(K.gasDensity('o2_293K', 20e6), S.nist.o2_293K.rows.find((x) => x[0] === 20e6)[1], 1e-12);
  const R = K.run(C, { route: 'gas' });
  assert.ok(R.tanks.ZH > 1.1 && R.tanks.ZH < 1.15, 'hydrogen at 20 MPa is less dense than an ideal gas: Z ' + R.tanks.ZH);
  assert.ok(R.tanks.ZO < 1, 'oxygen at 20 MPa is denser than an ideal gas: Z ' + R.tanks.ZO);
  // thin sphere of 1 m radius at 10 MPa in 6061-T6: t = p r / (2 su/1.4), m = 4 pi r^2 t rho = 766.14 kg
  const al = K.material('6061-T6');
  const t = 10e6 * 1 / (2 * 310e6 / 1.4);
  close(K.tankMass(10e6, 4 / 3 * Math.PI, al), 4 * Math.PI * t * 2700, 1e-9);
  close(K.tankMass(10e6, 4 / 3 * Math.PI, al), 766.1432, 1e-3);
  // tank mass per kg of gas = 1.5 rho_m FS / su x p / rho_gas: only the gas's departure from ideal makes pressure matter
  const per = (p) => K.tankMass(p, 1, al) / K.gasDensity('h2_293K', p);
  close(per(20e6) / per(5e6), (20e6 / K.gasDensity('h2_293K', 20e6)) / (5e6 / K.gasDensity('h2_293K', 5e6)), 1e-12);
  assert.ok(per(70e6) > per(5e6) * 1.2, 'hydrogen tanks get heavier per kg as pressure rises (Z)');
  // tanks hold the gas the stay makes (here all of it), not idea 45's rounded total
  close(R.prop.tanks.h2_kg, K.tankMass(20e6, R.L.made.h2 / K.gasDensity('h2_293K', 20e6), al), 1e-12);
  close(R.prop.tanks.o2_kg, K.tankMass(20e6, R.L.O / K.gasDensity('o2_293K', 20e6), al), 1e-12);
  // Z by hand from the NIST row and idea 31's R at 293.15 K
  close(R.tanks.ZH, 20e6 * 0.00201588 / (14.706899 * 8.31451 * 293.15), 1e-12);
  close(R.tanks.ZH, 1.12472670, 1e-8);
  // thin-wall validity: t/r = 1.4 p / (2 su); refused above 10 %
  close(K.wallRatio(70e6, al), 1.4 * 70e6 / (2 * 310e6), 1e-15);
  const R70 = K.run(C, { route: 'gas', p_store_MPa: 70 });
  assert.ok(R70.own.some((x) => x.applies_to === 'tank' && /15\.8 %/.test(x.reason)), '70 MPa aluminium is past thin-wall');
  assert.ok(!R.own.some((x) => x.applies_to === 'tank'), '20 MPa is not');
  // the steam route's water tank by hand: NIST water density at 293.15 K (between the 290 and 295 K rows)
  const Rs = K.run(C, { route: 'steam' }), w0 = S.nist.water_1atm.rows.find((x) => x[0] === 290), w1 = S.nist.water_1atm.rows.find((x) => x[0] === 295);
  const rhoW = w0[1] + (w1[1] - w0[1]) * (293.15 - 290) / 5;
  close(K.WATER_RHO, rhoW, 1e-9);
  close(Rs.prop.tank.mass_kg, 1.5 * 1e6 * (C.water.total_kg / rhoW) * 2700 * 1.4 / 310e6, 1e-12);
});

test('7. engines: ideas 31 and 32 at this module\'s conditions against NASA CEA 3.3.4 (the oracle), and the RL10A-3-3 factor', () => {
  let worst = 0, n = 0;
  for (const c of CEA.cases) {
    const e = c.route === 'steam' ? K.engineIsp(K.steamProp(c.T_heat), 'steam' + c.T_heat, 1, c.pc_Pa, c.eps, 0.8, 1) : K.engineIsp(K.PROP[c.route], c.route, c.of, c.pc_Pa, c.eps, 0.8, 1);
    const src = e.refusal ? e.partial : e;
    for (const mode of ['shifting', 'frozen']) {
      const m = src[mode];
      if (m && m.ivac) { const d = Math.abs(rel(m.ivac / src.lambda, c[mode].Ivac)); worst = Math.max(worst, d); n++; }
      else assert.ok(c.route === 'steam' && mode === 'shifting' && c.T_heat === 1023.15, 'only the 1023 K steam shifting cases may refuse: ' + JSON.stringify(c));
    }
    close(src.Tc, c.shifting.Tc, 1e-3 * c.shifting.Tc / 1000, 'chamber temperature');
  }
  assert.equal(n, 36);
  assert.ok(worst < 3e-6, 'every vacuum Isp within 3 ppm of CEA: ' + worst);
  // steam at 1023 K: at area ratio 50 CEA itself condenses 5.9 % of the water (full run); idea 31 refuses that expansion
  const c50 = CEA.cases.find((c) => c.route === 'steam' && c.eps === 50);
  assert.ok(c50.full_shifting.exit_condensed['H2O(L)'] > 0.05);
  const s50 = K.engineIsp(K.steamProp(1023.15), 'steam1023.15', 1, 10e5, 50, 0.8, 1);
  assert.match((s50.partial || s50).shifting.refusal.reason, /deposit H2O\(L\)/);
  assert.ok((s50.partial || s50).frozen.ivac > 0, 'the frozen expansion still has an answer');
  // at area ratio 10 idea 32's stationAtArea stops at 9.287 and hands that station back (Findings); this kernel refuses it
  const b = L.B.flow(L.M.rocket(L.db, K.steamProp(1023.15), 1, 10e5), 'shifting');
  const raw = L.B.stationAtArea(b, 10);
  close(raw.eps, 9.2874, 1e-3, 'idea 32 returns a station at another area ratio');
  const s10 = K.engineIsp(K.steamProp(1023.15), 'steam1023.15', 1, 10e5, 10, 0.8, 1);
  assert.match((s10.partial || s10).shifting.refusal.reason, /stopped at area ratio 9\.287/);
  // idea 31 throws (instead of refusing) when an expansion falls below its 200 K data floor; this kernel refuses
  assert.throws(() => { const r = L.M.rocket(L.db, K.PROP.liquid, 2, K.RL10.pc); L.B.stationAtArea(L.B.flow(r, 'shifting'), 57); }, TypeError);
  const t2 = K.engineIsp(K.PROP.liquid, 'liquid', 2, K.RL10.pc, 57, K.RL10.Lf, K.RL10.eta);
  assert.ok(t2.partial ? t2.partial.shifting.refusal : t2.refusal, 'refused, not thrown');
  // the delivered factor: SP-8120 Table I's 444 s over the shifting ideal at the RL10A-3-3's own conditions
  close(K.RL10.published / 9.80665, 444, 1e-9, 'SP-8120 Table I: 444 s');
  close(K.RL10.shifting / 9.80665, 453.46279, 1e-4);
  close(K.RL10.eta, 0.979132, 1e-6);
  assert.equal(K.RL10.of, 5); assert.equal(K.RL10.eps, 57);
});

test('8. the mixture ratio worth burning: the Delta-v trade against brute force', () => {
  const eng = { pc: K.RL10.pc, eps: K.RL10.eps, Lf: K.RL10.Lf, eta: K.RL10.eta };
  // the chain: a few kg on 590 kg dry; every extra kg of oxygen is worth its lost Isp, so burn all the oxygen the water has
  const small = K.ofTrade('liquid', 1.0, 7.9, 590, eng);
  close(small.rMax, 7.9, 1e-12, 'oxygen limits the ratio');
  close(small.opt.r, 7.9, 1e-9);
  const one = small.dv(6);
  close(one.dv, one.isp * Math.log((590 + 1.0 + 6.0) / 590), 1e-9, 'Tsiolkovsky');
  // the oxygen pays for itself until the propellant outweighs the dry craft about 17 to 1 (the first build said 90):
  // at 16 to 1 the water's own ratio wins exactly, at 19 to 1 the optimum is already inside
  const at = (x, st = 'liquid') => { const mH = x * 100 / (1 + K.R_ST); return K.ofTrade(st, mH, mH * K.R_ST, 100, eng); };
  close(at(16).opt.r, K.R_ST, 1e-9, '16 to 1: the water\'s ratio');
  assert.ok(at(19).opt.r < K.R_ST - 0.02, '19 to 1: inside ' + at(19).opt.r);
  // where d(dv)/d(O/F) at the water's ratio changes sign, by bisection
  const slope = (x, st) => { const t = at(x, st); return t.dv(K.R_ST).dv - t.dv(K.R_ST - 1e-3).dv; };
  const edge = (st) => { let lo = 5, hi = 40; for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (slope(m, st) > 0) lo = m; else hi = m; } return lo; };
  close(edge('liquid'), 17.29, 0.05, 'liquid: about 17 to 1');
  close(edge('gas'), 17.76, 0.05, 'gas: about 18 to 1');
  const big = K.ofTrade('liquid', 2000, 2000 * K.R_ST, 100, eng);
  assert.ok(big.opt.r < K.R_ST - 0.5 && big.opt.r > 4, 'interior optimum ' + big.opt.r);
  let best = { r: 0, dv: -1 };
  for (let r = 2; r <= K.R_ST + 1e-9; r += 0.05) { const p = big.dv(r); if (p.dv > best.dv) best = p; }
  close(big.opt.r, best.r, 0.06, 'brute force on a 0.05 grid');
  assert.ok(big.opt.dv >= best.dv - 1e-6);
  // oxygen-limited: the extra hydrogen stays in the tank
  const ox = big.dv(K.R_ST);
  close(ox.fuel, 2000, 1e-9);
  const lim = K.ofTrade('liquid', 10, 50, 100, eng).dv(7);
  close(lim.fuel, 50 / 7, 1e-12); close(lim.ox, 50, 1e-12);
});

test('9. the stay day by day: conservation, the power limit, and the chain and Bennu pinned', () => {
  assert.equal(C.carried.length, 23); assert.equal(Bn.carried.length, 8);
  assert.ok(C.carried.every((r) => r.from));
  const cases = [['chain cryo', C, {}], ['chain gas', C, { route: 'gas' }], ['chain steam', C, { route: 'steam' }], ['bennu cryo near', Bn, {}],
    ['bennu cryo psyche', Bn, { array: 'psyche', P1au: 21000 }], ['bennu cryo weak', Bn, { P1au: 900 }], ['bennu gas near', Bn, { route: 'gas' }], ['bennu gas psyche', Bn, { route: 'gas', array: 'psyche', P1au: 21000 }], ['bennu steam', Bn, { route: 'steam' }]];
  const out = {};
  for (const [name, src, st] of cases) {
    const R = K.run(src, st);
    assert.ok(!R.refusal, name);
    const L0 = R.L, win = src.days.reduce((a, d) => a + d.water_kg, 0);
    close(L0.split + L0.buffer, win, 1e-9 * win, name + ': water in = split + left');
    close(L0.made.h2, L0.split * K.FH, 1e-12 + 1e-12 * L0.split, name + ' hydrogen');
    close(L0.made.o2, L0.split * K.FO, 1e-12 + 1e-12 * L0.split, name + ' oxygen');
    close(L0.H + L0.boil.h2, L0.made.h2, 1e-9, name + ' hydrogen kept + boiled = made');
    close(L0.O + L0.boil.o2 + L0.vented, L0.made.o2, 1e-9, name + ' oxygen kept + boiled + vented = made');
    L0.rows.forEach((r) => assert.ok(r.used_W <= r.P_W * (1 + 1e-9), name + ' day ' + r.day + ' uses more power than the arrays give'));
    if (st.route === 'gas') close(L0.energy, L0.split * R.cell.e_J_per_kg_water, 1e-6 * L0.energy + 1e-9, name + ' energy = split x e');
    out[name] = R;
  }
  const p = (n) => out[n].prop;
  close(p('chain cryo').mass_kg, 7.111535, 2e-6); close(p('chain cryo').isp_s, 423.29993, 1e-4); close(p('chain cryo').mixture_ratio, K.R_ST, 1e-9);
  close(out['chain cryo'].L.boil.h2, 0.4693729, 2e-6, 'over a third of the chain\'s hydrogen boils off in the dark');
  close(p('chain gas').mass_kg, 11.30617, 1e-5); close(p('chain gas').isp_s, 432.24332, 1e-4);
  close(p('chain steam').mass_kg, 11.30617, 1e-5); close(p('chain steam').isp_s, 176.17930, 1e-4);
  // NEAR's arrays run one idling cooler at Bennu but split only 33 kg of the 1,131 (every day power-limited); with tanks
  // sized for what they hold, 24 kg survives (the first build sized them for all 1,131 kg and boiled every gram away)
  close(p('bennu cryo near').mass_kg, 24.05569, 1e-4);
  assert.equal(out['bennu cryo near'].L.rows.filter((r) => r.limit === 'power').length, 90);
  assert.equal(out['bennu cryo near'].L.coolMax, 1); assert.equal(out['bennu cryo near'].L.zboShort, 0);
  close(p('bennu cryo psyche').mass_kg, 765.3202, 1e-3); close(out['bennu cryo psyche'].L.coolMax, 3, 0);
  close(out['bennu gas psyche'].dryHome, 5342.8359, 1e-3, 'gas storage: about 4 kg of aluminium per kg of propellant');
  // NEAR's arrays at Bennu split 184 kg for the gas route; the tanks are for that gas, not for 1,131 kg (the first build: 4,463 kg)
  close(out['bennu gas near'].dryHome, 880 + K.tankMass(20e6, out['bennu gas near'].L.made.h2 / K.gasDensity('h2_293K', 20e6), K.material('6061-T6')) + K.tankMass(20e6, out['bennu gas near'].L.O / K.gasDensity('o2_293K', 20e6), K.material('6061-T6')), 1e-9);
  close(out['bennu gas near'].dryHome, 1604.7818, 1e-3);
  // the cryogenic tanks just hold the stay's peak inventory (the fixed point converged) and never less than any day's;
  // a stay whose mining stops half way peaks mid-stay and boils down after, so its peak is not its last day
  const half = C.days.map((d, i) => Object.assign({}, d, { water_kg: i < 45 ? d.water_kg : 0 }));
  const front = Object.assign({}, C, { days: half, water: Object.assign({}, C.water, { total_kg: half.reduce((a, d) => a + d.water_kg, 0) }) });
  out['front-loaded'] = K.run(front, { zbo: false });
  const fr = out['front-loaded'].L.rows;
  assert.ok(fr[44].h2_top_kg > fr[89].h2_top_kg * 1.05, 'the front-loaded stay peaks on day 45');
  for (const n of ['chain cryo', 'bennu cryo near', 'bennu cryo psyche', 'front-loaded']) {
    const T = out[n].tanks, L0 = out[n].L;
    assert.ok(T.sizing_converged, n + ' sizing converged');
    close(T.capH, L0.peakH, 1e-8 * L0.peakH + 1e-15, n + ' H tank = peak'); close(T.capO, L0.peakO, 1e-8 * L0.peakO + 1e-15, n + ' O tank = peak');
    close(T.VH, T.capH / K.PH2.sat.rho_l, 1e-15); close(T.AH, K.sphereArea(T.VH), 1e-15);
    // the fullest the tanks get is after a day's making, before that night's boil-off
    close(T.capH, Math.max(...L0.rows.map((r) => r.h2_top_kg)), 1e-8 * T.capH + 1e-15, n + ' H tank = fullest day');
    close(T.capO, Math.max(...L0.rows.map((r) => r.o2_top_kg)), 1e-8 * T.capO + 1e-15, n + ' O tank = fullest day');
    L0.rows.forEach((r) => assert.ok(r.h2_top_kg <= T.capH * (1 + 1e-8) && r.o2_top_kg <= T.capO * (1 + 1e-8) && r.h2_kg <= r.h2_top_kg, n + ' day ' + r.day + ' overfills'));
  }
  close(p('bennu gas psyche').mass_kg, 1131.213, 1e-3);
  close(p('bennu steam').mass_kg, 1131.213, 1e-3);
  // more array power splits more water where power limits
  const R2 = K.run(Bn, { route: 'gas', P1au: 3600 });
  close(R2.L.split, 2 * out['bennu gas near'].L.split, 1e-6 * R2.L.split, 'the gas route is linear in power');
  assert.ok(out['bennu gas near'].own.some((r) => r.applies_to === 'power'));
  // the default dry mass is idea 45's mass on the ground
  assert.equal(K.defaults(C).dry_kg, C.site.mass_kg);
  // arrays too small to run even an idle 20 K cooler (631 W): nothing is liquefied, and it is said so
  assert.ok(out['bennu cryo weak'].own.some((r) => r.applies_to === 'cooler20' && /On 90 of 90 days/.test(r.reason)));
  assert.equal(out['bennu cryo weak'].L.idleShort, 90); assert.equal(p('bennu cryo weak').mass_kg, 0);
  assert.ok(out['bennu cryo weak'].own.some((r) => r.applies_to === 'propellant'));
  // arrays that idle a cooler but cannot also hold the tanks' leak: zero boil-off is dropped and said so, never overdrawn
  const Rz = K.run(Bn, { P1au: 1160 });
  assert.equal(Rz.L.zboShort, 14); assert.equal(Rz.L.idleShort, 0);
  assert.ok(Rz.own.some((r) => r.applies_to === 'zbo' && /14 day/.test(r.reason)));
  Rz.L.rows.forEach((r) => assert.ok(r.used_W <= r.P_W * (1 + 1e-9)));
  // the engine model refusing a ratio leaves the propellant unknown, not zero, and never prints "null"
  const R2f = K.run(C, { of_mode: 'fixed', of: 2 });
  assert.equal(R2f.prop.mass_kg, null); assert.equal(R2f.dv, null);
  assert.ok(R2f.own.some((r) => r.applies_to === 'engine' && r.code === 'out_of_envelope'));
  assert.ok(R2f.own.every((r) => !/O\/F null|\bundefined\b|NaN/.test(r.reason)), 'no "O/F null" in a refusal');
  assert.ok(!K.parseHandoff(JSON.parse(JSON.stringify(K.buildHandoff(R2f, '2026-11-01T18:00:00Z')))).refusal, 'and it reads back');
  // steam with no water at all: a refusal, not a 0 kg propellant at 176 s
  const dry = Object.assign({}, C, { days: C.days.map((d) => Object.assign({}, d, { water_kg: 0 })), water: Object.assign({}, C.water, { total_kg: 0 }) });
  assert.ok(K.run(dry, { route: 'steam' }).own.some((r) => r.applies_to === 'propellant'));
  // the steam heater's energy per kg: liquid water at 293.15 K to steam at 1023.15 K, from idea 31's thermo by hand
  const w = L.M.thermoAt(L.db.products['H2O(L)'], 293.15), g = L.M.thermoAt(L.db.products.H2O, 1023.15);
  const dh = (g.h * L.M.R * 1023.15 - w.h * L.M.R * 293.15) / 0.01801528;
  close(out['chain steam'].steam.heat, dh, 1e-6); close(dh, 3960163.6, 1);
  close(out['chain steam'].steam.thrustPerW, out['chain steam'].prop.ve_m_s / dh, 1e-15, 'N per W of heater');
  // the oxygen kept follows the chosen ratio: on a plant with weightless coolers and a 1 kg craft the optimum is inside,
  // the ledger is re-run until the oxygen it liquefies is the oxygen the burn uses (unreachable with real hardware: see README)
  const light = JSON.parse(JSON.stringify(S)); light.cryoKpp.specificMass_kg_W = 0;
  const K2 = L.Split.create(Object.assign({}, L.deps, { sources: light }));
  const Ri = K2.run(Bn, { array: 'psyche', P1au: 1e7, dry_kg: 1 });
  assert.ok(Ri.prop.mixture_ratio < K.R_ST - 0.3, 'interior optimum ' + Ri.prop.mixture_ratio);
  assert.ok(Ri.iterations > 1);
  close(Ri.L.O + Ri.L.boil.o2, (Ri.L.H + Ri.L.boil.h2) * Ri.rTarget, 1e-6 * Ri.L.O, 'oxygen kept = ratio x hydrogen made');
  assert.ok(Ri.L.vented > 0.1 * Ri.L.made.o2, 'the rest of the oxygen is vented, not liquefied');
  close(Ri.rTarget, Ri.prop.mixture_ratio, 2e-3, 'the iteration converged on the burn\'s ratio');
});

test('10. the handoff: read back, the sample is what its inputs give, edits and dropped refusals refused', () => {
  const h = K.buildHandoff(Rc, '2026-11-01T18:00:00Z');
  assert.equal(h.from, '46-split');
  assert.deepEqual(h.inputs.dig_handoff, L.sample45(), 'idea 45\'s handoff carried, its own upstream pruned to a digest');
  assert.equal(h.inputs.dig_handoff.inputs.touch_handoff.pruned, true);
  // from idea 45's full committed handoff (idea 44's nested whole), the export prunes it to the same digest
  const full = JSON.parse(fs.readFileSync(path.join(BANK, 'ideas/45-dig/handoff.json'), 'utf8'));
  const hf = K.buildHandoff(K.run(K.parseHandoff(full).src, {}), '2026-11-01T18:00:00Z');
  assert.deepEqual(hf.inputs.dig_handoff, L.sample45(), 'the export of the full handoff carries the pruned one');
  assert.ok(JSON.stringify(hf).length < 60000, 'the export stays small: ' + JSON.stringify(hf).length + ' bytes');
  const back = K.parseHandoff(JSON.parse(JSON.stringify(h)));
  assert.ok(!back.refusal, back.refusal && back.refusal.reason);
  assert.equal(back.from, '46-split');
  const sample = JSON.parse(fs.readFileSync(path.join(HERE, 'handoff.json'), 'utf8'));
  const again = K.buildHandoff(K.run(K.importDig(sample.inputs.dig_handoff), sample.inputs.settings), sample.produced);
  assert.deepEqual(JSON.parse(JSON.stringify(again)), sample, 'handoff.json is exactly what its inputs give');
  assert.equal(sample.refusals.length, 23 + Rc.own.length);
  // as a #h= link
  const viaLink = K.parseHandoff('#h=' + K.b64urlEncode(JSON.stringify(h)));
  assert.ok(!viaLink.refusal);
  const edited = JSON.parse(JSON.stringify(h)); edited.outputs.propellant.value.mass_kg *= 2;
  assert.match(K.parseHandoff(edited).refusal.reason, /not what its own inputs give/);
  const dropped = JSON.parse(JSON.stringify(h)); dropped.refusals.pop();
  assert.match(K.parseHandoff(dropped).refusal.reason, /refusals do not match/);
});

test('11. refusals the inputs raise', () => {
  const bad = (x) => K.parseHandoff(x).refusal;
  assert.equal(bad('not json at all').code, 'invalid_input');
  assert.equal(bad({ hello: 1 }).code, 'invalid_input');
  assert.equal(bad(Object.assign({}, L.sample45(), { version: 2 })).code, 'invalid_input');
  const h44 = JSON.parse(fs.readFileSync(path.join(BANK, 'ideas/44-touch-and-go/handoff.json'), 'utf8'));
  assert.match(bad(h44).reason, /Open it in idea 45/);
  const ed = JSON.parse(JSON.stringify(L.sample45())); ed.outputs.timeline.value.water_kg[3] *= 1.01;
  assert.match(bad(ed).reason, /own arithmetic does not hold/);
  const ed2 = JSON.parse(JSON.stringify(L.sample45())); ed2.outputs.water_rate.value.total_kg *= 1.01;
  assert.match(bad(ed2).reason, /do not add up/);
  const ed3 = JSON.parse(JSON.stringify(L.sample45())); ed3.outputs.water_rate.units = 'g/day';
  assert.equal(bad(ed3).code, 'invalid_input');
  const settings = [{ route: 'x' }, { T_cell: 250 }, { cell: 'custom', V_custom: 1.15 }, { route: 'gas', p_store_MPa: 80 }, { Twb: 400 }, { of_mode: 'fixed', of: 9 }, { route: 'steam', T_heat: 4000 },
    { route: 'gas', material: 'unobtainium' }, { P1au: 0 }, { etaF: 1.2 }, { cell: 'nope' }, { dry_kg: -1 }];
  for (const s of settings) {
    const R = K.run(C, s);
    assert.ok(R.refusal, JSON.stringify(s) + ' was not refused');
    assert.ok(['invalid_input', 'out_of_envelope'].indexOf(R.refusal.code) >= 0);
  }
  assert.equal(K.run(C, { T_cell: 250 }).refusal.code, 'out_of_envelope');
  assert.equal(K.run(C, { Twb: 400 }).refusal.code, 'out_of_envelope');
  // idea 45's concentrator cannot heat steam past its stagnation temperature: (C eta S / sigma)^(1/4) = 1712.30 K on the
  // chain (300 x 0.85 x 1911.587 W/m^2 / 5.670374419e-8, to the quarter); Bennu's dimmer Sun gives 1351.39 K
  const col = C.collector;
  close(K.stagnation(col), Math.pow(col.concentration * col.eta_opt * col.S_epoch_W_m2 / 5.670374419e-8, 0.25), 1e-9);
  close(K.stagnation(col), Math.pow(300 * 0.85 * 1911.58702 / 5.670374419e-8, 0.25), 1e-9);
  close(K.stagnation(col), 1712.303, 1e-3); close(K.stagnation(Bn.collector), 1351.387, 1e-3);
  const Rs = K.run(C, { route: 'steam', T_heat: 2000 });
  assert.ok(Rs.own.some((r) => /reaches at most/.test(r.reason)));
  // always-on honesty refusals for the routes
  assert.ok(Rc.own.some((r) => r.applies_to === 'water'), 'the chain\'s upper bound carried');
  assert.ok(K.run(Bn, {}).own.some((r) => r.applies_to === 'cleanup'), 'Bennu\'s CO2 and SO2 must be separated');
  assert.ok(Rc.own.some((r) => r.applies_to === 'cooler90') && Rc.own.some((r) => r.applies_to === 'mli'));
});
