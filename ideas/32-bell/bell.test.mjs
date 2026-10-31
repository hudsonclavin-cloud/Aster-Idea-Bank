// Tests for idea 32 (Bell). Node built-ins only. Run from the bank root: node --test ideas/32-bell/bell.test.mjs
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
const { M, db, B, Bell, charts, rules } = L;
const read = (f) => fs.readFileSync(path.join(here, f), 'utf8');
const json = (f) => JSON.parse(read(f));
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(here, f))).digest('hex');
const rel = (a, b) => Math.abs(a / b - 1);
const IN = Bell.INCH;
const PAIRS = {
  'LOX/LH2': [[['O2(L)', 1, 90.17]], [['H2(L)', 1, 20.27]]], 'LOX/RP-1': [[['O2(L)', 1, 90.17]], [['RP-1', 1, 298.15]]],
  'LOX/CH4': [[['O2(L)', 1, 90.17]], [['CH4(L)', 1, 111.643]]], 'N2O4/MMH': [[['N2O4(L)', 1, 298.15]], [['CH6N2(L)', 1, 298.15]]],
  'N2O4/UDMH': [[['N2O4(L)', 1, 298.15]], [['C2H8N2(L),UDMH', 1, 298.15]]],
  'N2O4/A-50': [[['N2O4(L)', 1, 298.15]], [['N2H4(L)', 0.5, 298.15], ['C2H8N2(L),UDMH', 0.5, 298.15]]],
  'N2O4/N2H4': [[['N2O4(L)', 1, 298.15]], [['N2H4(L)', 1, 298.15]]],
  'LOX/Ethanol-75': [[['O2(L)', 1, 90.17]], [['C2H5OH(L)', 0.75, 298.15], ['H2O(L)', 0.25, 298.15]]],
  'HTP-98/RP-1': [[['H2O2(L)', 0.98, 298.15], ['H2O(L)', 0.02, 298.15]], [['RP-1', 1, 298.15]]],
  'GOX/RP-1': [[['O2', 1, 298.15]], [['RP-1', 1, 298.15]]],
};
const side = (a) => a.map(([name, w, T]) => ({ name, w, T }));
const prop = (k) => ({ oxidizer: side(PAIRS[k][0]), fuel: side(PAIRS[k][1]) });
const ENV = { envelope: [1e3, 4e7] };
const FX = json('oracle/cea-nozzle.json');
const KEYS = FX.keys;
const MODE = { eq: 'shifting', frz1: 'frozen', frz2: 'frozen-throat' };

// One pass over the CEA fixture, shared by the tests below: every station the kernel computes, with CEA's row.
const RUNS = (() => {
  const out = [];
  for (const c of FX.cases) {
    const r = M.rocket(db, prop(c.pair), c.of, c.pc, ENV);
    for (const key of ['eq', 'frz1', 'frz2']) {
      const b = B.flow(r, MODE[key]);
      c[key].rows.forEach((row, i) => {
        const name = c.stations[i];
        if (name === 'throat') return;
        const st = name.startsWith('pi') ? B.stationAtPressure(b, c.pc / +name.slice(2)) : B.stationAtArea(b, Math.min(row[0], 400));
        out.push({ c, key, name, row, b, st });
      });
    }
  }
  return out;
})();
const val = (row, k) => row[KEYS.indexOf(k)];

// ------------------------------------------------------------------ data and provenance
test('snapshots of earlier ideas are byte-identical to the committed originals', () => {
  for (const [mine, theirs] of [['snapshots/mixture.js', '../31-mixture/mixture.js'], ['snapshots/thermo-excerpt.js', '../31-mixture/snapshots/thermo-excerpt.js'],
    ['snapshots/propellant-densities.js', '../31-mixture/snapshots/propellant-densities.js'], ['snapshots/mixture-presets.js', '../31-mixture/presets.js'],
    ['snapshots/31-handoff.json', '../31-mixture/handoff.json']]) {
    assert.equal(sha(mine), json(mine + '.provenance.json').writtenSha256, mine + ' sidecar');
    assert.equal(sha(mine), sha(theirs), mine + ' differs from ' + theirs);
  }
  // PartForge's atmosphere: the verbatim block of idea 02's snapshot, byte for byte, between its own markers
  const isaSrc = read('snapshots/isa.js'), two = read('../02-hot-skin/snapshots/partforge.js');
  const blk = (t) => t.slice(t.indexOf('// ---- BEGIN verbatim index.html 620-684 @ 0974a62 ----'), t.indexOf('// ---- END verbatim ----'));
  assert.ok(blk(isaSrc).length > 2000 && blk(isaSrc) === blk(two));
  assert.equal(json('snapshots/isa.js.provenance.json').writtenSha256, sha('snapshots/isa.js'));
  assert.equal(L.pf.ISA_G0, 9.80665);
  assert.equal(L.pf.isa(0).P_Pa, 101325);
  // the thermo identity this page stamps on a stand-alone chamber is the one idea 31 records
  assert.deepEqual(L.THERMO, json('snapshots/31-handoff.json').outputs.thermo_database.value);
});

test('every rule quote is verbatim in the fetched source excerpt, and the numbers are the quoted ones', () => {
  const src = read('snapshots/nozzle-sources.txt');
  const quotes = [rules.separation.quote, rules.separation.early.quote, rules.separation.margin.quote, rules.bell.upstreamQuote, rules.bell.downstreamQuote,
    rules.bell.referenceQuote, rules.bell.lengthQuote, rules.bell.parabolaQuote, rules.bell.lossQuote, rules.bell.sp8120UpstreamQuote, rules.cone.lambdaQuote,
    rules.cone.check15Quote, rules.cone.downstreamQuote];
  for (const q of quotes) assert.ok(src.includes(q), 'missing quote: ' + q);
  assert.ok(rules.separation.quote.includes(String(rules.separation.a)));
  assert.ok(rules.separation.quote.includes(String(rules.separation.b).replace('0.', '')), 'exponent digits as the OCR has them');
  assert.ok(rules.separation.early.quote.endsWith(String(rules.separation.early.ratio)));
  assert.ok(rules.separation.margin.quote.includes(String(rules.separation.margin.fraction * 100) + ' percent'));
  assert.ok(rules.bell.upstreamQuote.includes(String(rules.bell.upstreamArc)));
  assert.ok(rules.bell.downstreamQuote.includes(String(rules.bell.downstreamArc)));
  assert.ok(rules.cone.downstreamQuote.includes(String(rules.cone.downstreamArc)));
  for (const f of ['nozzle-sources.txt', 'nozzle-rules.js', 'nozzle-charts.js', 'sp8120-table1.js']) {
    const p = json('snapshots/' + f + '.provenance.json');
    assert.ok(p.repo && p.path && p.commit, f + ' sidecar keys');
    assert.equal(p.writtenSha256, sha('snapshots/' + f), f + ' changed since its sidecar was written');
  }
});

test('published RP-1311 values re-parse from the verbatim excerpt (transcribed by script, checked by a second parser)', () => {
  const txt = read('oracle/published-excerpts.txt').split('\n');
  const pub = json('oracle/published.json');
  let n = 0;
  for (const c of pub.cases) {
    const start = txt.findIndex((l) => l.startsWith('--- lines ' + c.range[0] + '-' + c.range[1])) + 1;
    let end = start; while (end < txt.length && !txt[end].startsWith('--- lines') && !txt[end].startsWith('## ')) end++;
    for (const k in c.rows) {
      const R = c.rows[k];
      const line = txt.slice(start, end).find((l) => l.trim().startsWith(R.label));
      const nums = line.split(/\s+/).filter((t) => /^[iI]?[0-9]*\.?[0-9]+$/.test(t)).map((t) => Number(t.replace(/^[iI]/, '1'))).slice(-R.cols).slice(-c.stations.length);
      assert.deepEqual(nums, R.values, c.name + ' ' + k);
      n++;
    }
  }
  assert.equal(n, 48);
});

test('SP-8120 Table I transcription is internally consistent (At vs Dt, Ae vs De, Ae/At)', () => {
  for (const r of L.table.ROWS) {
    assert.ok(rel(Math.PI * r.Dt * r.Dt / 4, r.At) < 0.011, r.engine + ' At vs Dt');
    assert.ok(rel(Math.PI * r.De * r.De / 4, r.Ae) < 0.02, r.engine + ' Ae vs De');
    assert.ok(rel(r.Ae / r.At, r.eps) < 0.012, r.engine + ' Ae/At vs eps');
  }
  assert.equal(L.table.ROWS.length, 16);
});

test('digitized charts: calibration against a closed form, the worked examples, and the two NASA charts disagreeing', () => {
  const C = charts.bellLambda, t15 = Math.tan(15 * Math.PI / 180);
  // the chart's shortened-cone curve is (1 + cos(atan(tan 15 / Lf)))/2: it checks the digitizer's calibration
  C.Lf.forEach((Lf, i) => assert.ok(Math.abs(C.conePercent[i] - 100 * (1 + Math.cos(Math.atan(t15 / (Lf / 100)))) / 2) < 0.03, 'cone at ' + Lf));
  // bells: efficiency rises with length; at full length all area ratios meet near 99.1-99.2 % (the chart's merged curve)
  for (const e of C.eps) {
    const v = C.percent[String(e)];
    for (let i = 1; i < v.length; i++) assert.ok(v[i] >= v[i - 1] - 0.005, 'monotone in Lf, eps ' + e);
    assert.ok(v[v.length - 1] > 99.1 && v[v.length - 1] < 99.2);
  }
  // SP-125 Sample Calculation (4-2) read 27.4 and 9.8 degrees off Figure 4-14 at eps 14, 80 %; Figure 4-22 shows 34 and 10.5 at eps 35, 70 %
  const a = B.raoAngles(14, 0.8), b = B.raoAngles(35, 0.7);
  assert.ok(Math.abs(a.sp125.thetaN - 27.4) < 0.15 && Math.abs(a.sp125.thetaE - 9.8) < 0.15, 'SP-125 chart at its own example');
  assert.ok(Math.abs(b.sp125.thetaN - 34) < 0.25 && Math.abs(b.sp125.thetaE - 10.5) < 0.3, 'SP-125 chart at Figure 4-22');
  assert.ok(Math.abs(a.thetaN - 27.4) < 0.15 && Math.abs(a.thetaE - 9.8) < 0.1, 'SP-8120 chart at SP-125 example');
  assert.ok(Math.abs(b.thetaN - 34) < 1.0 && Math.abs(b.thetaE - 10.5) < 0.7, 'SP-8120 chart at Figure 4-22');
  // the two charts disagree by up to about a degree (SP-125 higher in thetaN at large area ratio); pinned
  let worst = 0;
  const S = charts.raoAnglesSP125;
  for (const L2 of [60, 70, 80, 90, 100]) S.eps.forEach((e, i) => {
    for (const k of ['thetaN', 'thetaE']) {
      const v = S[k][String(L2)][i]; if (v == null) return;
      worst = Math.max(worst, Math.abs(v - B.raoAngles(e, L2 / 100)[k]));
    }
  });
  assert.ok(worst > 0.9 && worst < 1.3, 'inter-chart disagreement ' + worst);
  // the chart's area-ratio axis is logarithmic, so angles are interpolated in ln(eps): at the geometric mean of two
  // nodes the angle is the mean of the node angles, and between length curves they are linear in Lf
  for (const [a2, b2] of [[16, 20], [50, 60], [5, 6]]) for (const k of ['thetaN', 'thetaE']) {
    const mid = B.raoAngles(Math.sqrt(a2 * b2), 0.8)[k], avg = (B.raoAngles(a2, 0.8)[k] + B.raoAngles(b2, 0.8)[k]) / 2;
    assert.ok(Math.abs(mid - avg) < 1e-12, k + ' at sqrt(' + a2 + ' x ' + b2 + ')');
  }
  assert.ok(Math.abs(B.raoAngles(20, 0.75).thetaN - (B.raoAngles(20, 0.7).thetaN + B.raoAngles(20, 0.8).thetaN) / 2) < 1e-12);
  // parabola angles: initial angle grows with area ratio and shrinks with length; exit angle shrinks with both
  // (beyond eps 50, where SP-8120 draws the curves dashed, the 100 % exit angle is flat to 0.03 degrees)
  for (const Lf of [0.6, 0.7, 0.8, 0.9, 1]) for (let e = 5; e < 90; e += 1) {
    const a = B.raoAngles(e, Lf), b = B.raoAngles(e + 1, Lf);
    assert.ok(b.thetaN > a.thetaN, 'thetaN rises, ' + e);
    assert.ok(e < 50 ? b.thetaE < a.thetaE : b.thetaE < a.thetaE + 0.03, 'thetaE falls, ' + e);
    if (Lf < 1) assert.ok(B.raoAngles(e, Lf + 0.1).thetaN < a.thetaN && B.raoAngles(e, Lf + 0.1).thetaE < a.thetaE);
  }
});

// ------------------------------------------------------------------ NASA CEA 3.3.4 (oracle/cea-nozzle.json)
function worstOver(filter, keys) {
  const w = {};
  for (const R of RUNS.filter(filter)) {
    if (R.st.refusal) continue;
    const got = { eps: R.st.eps, P: R.st.P, T: R.st.T, M: R.st.M, gamma_s: R.st.gamma, mach: R.st.mach, Ivac: R.st.Ivac, Isp: R.st.u, CF: R.st.u / R.b.cstar };
    const cea = (k) => k === 'CF' ? val(R.row, 'Isp') / R.c[R.key].cstar : val(R.row, k);
    for (const k of keys) w[k] = Math.max(w[k] || 0, rel(got[k], cea(k)));
  }
  return w;
}
test('shifting equilibrium matches NASA CEA at every area ratio and pressure ratio (same 43 species)', () => {
  const w = worstOver((R) => R.key === 'eq' && R.name.startsWith('eps'), ['P', 'T', 'M', 'gamma_s', 'mach', 'Ivac', 'Isp', 'CF']);
  assert.ok(w.T < 1e-6 && w.P < 5e-6 && w.M < 1e-6 && w.gamma_s < 1e-6 && w.mach < 1e-6, JSON.stringify(w));
  assert.ok(w.Ivac < 2e-7 && w.Isp < 2e-7 && w.CF < 2e-6, JSON.stringify(w));
  const p = worstOver((R) => R.key === 'eq' && R.name.startsWith('pi'), ['eps', 'T', 'Ivac', 'CF']);
  // CEA stops its throat at |u^2 - a^2|/u^2 < 4e-5 (idea 31): its area ratios carry that, so eps is held to 2e-5 at assigned pressures
  assert.ok(p.eps < 2e-5 && p.T < 1e-6 && p.Ivac < 2e-7 && p.CF < 2e-6, JSON.stringify(p));
  assert.equal(RUNS.filter((R) => R.key === 'eq' && !R.st.refusal).length, FX.cases.length * (FX.stationsPerCase - 1) - 5, 'every shifting station but the five graphite ones');
});
test('frozen at the chamber matches CEA (n_frz = 1), including its frozen throat and c*', () => {
  const w = worstOver((R) => R.key === 'frz1', ['T', 'M', 'gamma_s', 'mach', 'Ivac', 'Isp', 'CF']);
  assert.ok(w.T < 3e-7 && w.M < 1e-7 && w.gamma_s < 1e-7 && w.mach < 1e-7 && w.Ivac < 1e-7 && w.CF < 2e-7, JSON.stringify(w));
  // every station computes but one: N2O4/MMH at 0.1 bar cools below the 300 K fits at area ratio 400 (next test)
  const R1 = RUNS.filter((R) => R.key === 'frz1');
  assert.deepEqual(R1.filter((R) => R.st.refusal).map((R) => R.c.pair + ' ' + R.c.pc + ' ' + R.name), ['N2O4/MMH 10000 eps400']);
  for (const c of FX.cases) {
    const b = B.flow(M.rocket(db, prop(c.pair), c.of, c.pc, ENV), 'frozen');
    assert.ok(rel(b.cstar, c.frz1.cstar) < 1e-7, c.pair + ' frozen c*');
    assert.ok(b.cstar < c.eq.cstar, 'frozen c* is below shifting');
  }
});
test('frozen after the throat matches CEA (n_frz = 2)', () => {
  const w = worstOver((R) => R.key === 'frz2', ['T', 'M', 'gamma_s', 'mach', 'Ivac', 'Isp', 'CF']);
  // the freeze point is the throat, which CEA locates to its own (looser) tolerance: a few ppm of composition
  assert.ok(w.T < 6e-6 && w.M < 5e-7 && w.gamma_s < 3e-7 && w.mach < 3e-6 && w.Ivac < 6e-7 && w.CF < 2e-6, JSON.stringify(w));
  assert.equal(RUNS.filter((R) => R.key === 'frz2' && R.st.refusal).length, 0, 'every frozen-after-throat station computes (the 0.1 bar one ends at 300.9 K)');
});
test('refuses exactly where CEA with every product would deposit graphite in the nozzle, and nowhere else', () => {
  const ref = new Set(), cond = new Set();
  for (const R of RUNS.filter((x) => x.key === 'eq' && x.name.startsWith('eps'))) {
    if (R.st.refusal) { assert.match(R.st.refusal.reason, /C\(gr\)/); ref.add(R.c.pair + R.c.of + R.c.pc + R.name); }
  }
  for (const c of FX.cases) {
    const g = c.full_eq.condensed && c.full_eq.condensed['C(gr)'];
    if (g) g.forEach((x, i) => { if (x > 0) cond.add(c.pair + c.of + c.pc + c.stations[i]); });
  }
  assert.deepEqual([...ref].sort(), [...cond].sort());
  assert.equal(ref.size, 5);
});
test('the 43-species cut costs under 0.3 ppm of vacuum Isp at the exit (CEA with all 158 C/H/O/N products)', () => {
  let w = 0;
  for (const c of FX.cases) c.full_eq.eps.forEach((e, i) => {
    if (c.full_eq.condensed) return;
    const R = RUNS.find((x) => x.c === c && x.key === 'eq' && x.name === c.stations[i]);
    if (R && !R.st.refusal) w = Math.max(w, rel(R.st.Ivac, c.full_eq.Ivac[i]));
  });
  assert.ok(w < 3e-7, String(w));
});
test('a frozen expansion that cools below the 300 K fits refuses (CEA extrapolates to 263 K)', () => {
  const c = FX.cases.find((x) => x.pair === 'N2O4/MMH' && x.pc === 1e4);
  const b = B.flow(M.rocket(db, prop('N2O4/MMH'), 2.0, 1e4), 'frozen');
  const row = c.frz1.rows[c.stations.indexOf('eps400')];
  assert.ok(val(row, 'T') < 270, 'CEA goes below the fits');
  const st = B.stationAtArea(b, 400);
  assert.equal(st.refusal.code, 'out_of_envelope');
  assert.match(st.refusal.reason, /below 300 K/);
  assert.ok(!B.stationAtArea(b, 200).refusal, 'eps 200 stays above 300 K');
});

// ------------------------------------------------------------------ published figures and closed forms
test('RP-1311 Part II printouts (1996 data): Examples 8 (shifting) and 12 (shifting and frozen after the throat)', () => {
  const pub = json('oracle/published.json');
  const props = { 'RP-1311 Example 8': prop('LOX/LH2'), 'RP-1311 Example 12': prop('N2O4/MMH') };
  const tol = { Ivac: 6e-4, Isp: 6e-4, CF: 4e-4, T_K: 3e-3, P_bar: 2e-3, mach: 8e-4 };
  let n = 0;
  for (const c of pub.cases) {
    const pc = c.pc_psia * Bell.PSI, b = B.flow(M.rocket(db, props[c.name], c.of, pc), c.mode);
    c.stations.forEach((s, i) => {
      if (s.startsWith('sub')) return;
      const st = s.startsWith('pi') ? B.stationAtPressure(b, pc / +s.slice(2)) : B.stationAtArea(b, +s.slice(3));
      const got = { Ivac: st.Ivac, Isp: st.u, CF: st.u / b.cstar, T_K: st.T, P_bar: st.P / 1e5, mach: st.mach };
      for (const k in tol) { assert.ok(rel(got[k], c.rows[k].values[i]) < tol[k], c.name + ' ' + c.mode + ' ' + s + ' ' + k + ' ' + rel(got[k], c.rows[k].values[i])); n++; }
    });
  }
  assert.equal(n, 24 * 6);
});
test('the expansion obeys its own conservation laws', () => {
  const r = M.rocket(db, prop('LOX/CH4'), 3.2, 80e5);
  for (const mode of ['shifting', 'frozen', 'frozen-throat']) {
    const b = B.flow(r, mode);
    for (const e of [2, 10, 60]) {
      const st = B.stationAtArea(b, e);
      // energy: u^2/2 + h = h_chamber
      assert.ok(Math.abs(st.u * st.u / 2 + st.h - r.chamber.h) < 1e-6 * Math.abs(r.chamber.h) + 1e-3, mode + ' energy');
      // entropy: the station has the chamber entropy (shifting: idea 31's SP solve; frozen: the fixed mixture's)
      if (mode === 'shifting') assert.ok(Math.abs(st.raw.s - r.chamber.s) < 1e-6 * r.chamber.s);
      // mass: eps is the inverse mass-flux ratio, and Ivac = u + p/(rho u)
      assert.ok(rel(st.eps, e) < 1e-10 && rel(st.Ivac, st.u + st.P / (st.rho * st.u)) < 1e-14);
      // CF(pa) is linear in pa with slope -eps/pc, and the divergence efficiency scales only the vacuum C_F
      // (SP-125 Figure 4-12 defines lambda as a share of the ideal C_F; the ambient term is the exit area's, unchanged)
      const p0 = B.performance(b, st, 0, 0.98), p1 = B.performance(b, st, 50e3, 0.98);
      assert.ok(Math.abs((p1.cf - p0.cf) / 50e3 + e / r.pc) < 1e-15);
      assert.ok(Math.abs(p1.cf - (0.98 * st.cfVac - st.eps * 50e3 / r.pc)) < 1e-14 && rel(p0.Ivac, 0.98 * st.Ivac) < 1e-14);
    }
    // area-Mach: supersonic area grows as pressure falls; just past the throat the area ratio is ~1. Freezing at
    // the (equilibrium-sonic) throat leaves the flow subsonic in the frozen sound speed, so there the area first
    // dips below the throat's before it grows: a property of that model (CEA's n_frz = 2), not of a real nozzle.
    const t1 = B.stationAtPressure(b, b.throat.P * 0.999), t2 = B.stationAtPressure(b, b.throat.P * 0.5);
    if (mode === 'frozen-throat') assert.ok(t1.eps < 1 && t1.eps > 0.9999 && t1.mach < 1 && t2.eps > 1);
    else assert.ok(t1.eps > 1 && t1.eps < 1.0001 && t1.mach > 1 && t2.eps > t1.eps);
  }
  // the frozen throat is sonic in the frozen sound speed and is where the mass flux peaks
  const bf = B.flow(r, 'frozen');
  assert.ok(rel(bf.throat.u, bf.throat.a) < 1e-12);
  const Gt = bf.throat.rho * bf.throat.u;
  for (const f of [0.99, 1.01]) {
    const st = B.stationAtPressure(B.flow(r, 'frozen'), bf.throat.P * Math.min(f, 0.9999));
    assert.ok(st.rho * st.u < Gt);
  }
});
test('separation: SP-8120 criterion, its inversion, and the 20 percent margin', () => {
  // hand-worked: pa 101325 Pa, pc 50 bar: pSep = 101325 * 0.583 * (101325/5e6)^0.195 = 27,620 Pa
  const s = B.separation(50e5, 101325, 30000);
  assert.ok(Math.abs(s.pSep - 27620) < 2, String(s.pSep));
  assert.equal(s.status, 'marginal');
  assert.equal(B.separation(50e5, 101325, 27000).status, 'separated');
  assert.equal(B.separation(50e5, 101325, 34000).status, 'full');
  assert.equal(B.separation(50e5, 0, 1).status, 'vacuum');
  assert.ok(B.separation(50e5, 101325, 40000).earlyRule, 'the old 0.4 rule flags 40 kPa against 101 kPa');
  for (const pe of [500, 20e3, 90e3]) {
    const pa = B.separationAmbient(50e5, pe, false), pm = B.separationAmbient(50e5, pe, true);
    assert.ok(rel(B.separation(50e5, pa, pe).pSep, pe) < 1e-12 && rel(B.separation(50e5, pm, pe).pMarginal, pe) < 1e-12 && pm < pa);
  }
});
test('divergence efficiency: the cone closed form, the bell chart, and their limits', () => {
  assert.equal(+B.lambdaCone(15).value.toFixed(3), 0.983, 'SP-125: 15 degrees gives 0.983');
  assert.ok(Math.abs(B.lambdaCone(1e-6).value - 1) < 1e-12);
  const b80 = B.lambdaBell(0.8, 20).value, b100 = B.lambdaBell(1, 20).value;
  assert.ok(b80 > B.lambdaCone(15).value && b100 > b80 && b100 < 1);
  assert.ok(B.lambdaBell(0.8, 5).extrapolated && B.lambdaBell(0.8, 60).extrapolated && !B.lambdaBell(0.8, 25).extrapolated);
  assert.equal(B.lambdaBell(0.5, 20).refusal.code, 'out_of_envelope');
});
test('contour geometry reproduces SP-125 Sample Calculation (4-2) and Figure 4-22', () => {
  // A-1 engine: Rt 12.45 in, eps 14, 80 % bell, theta_n 27.4, theta_e 9.8 -> Ln 102.4 in, N (2.19, 12.99) in, E at 102.4 in
  const g = B.bellContour(12.45 * IN, 14, 0.8, { thetaN: 27.4, thetaE: 9.8 });
  assert.ok(Math.abs(g.length / IN - 102.4) < 0.05 && Math.abs(g.N[0] / IN - 2.19) < 0.01 && Math.abs(g.N[1] / IN - 12.99) < 0.01);
  assert.ok(Math.abs(g.referenceLength / IN - 128) < 0.05, 'the 15-degree cone: 128 in');
  // finding: SP-125 prints Re = 46.7 in, but sqrt(14) x 12.45 = 46.58 in (its De = sqrt(14) x 24.9 = 93.4 is 93.17)
  assert.ok(Math.abs(g.E[1] / IN - Math.sqrt(14) * 12.45) < 1e-9 && Math.abs(g.E[1] / IN - 46.7) > 0.1);
  // A-3 engine (Figure 4-22): Rt from the 7.93 in upstream arc (1.5 Rt), eps 35, 70 %, 34 and 10.5 deg -> Et 68.1, Nt 1.13, Na 5.64, 2.02 in arc
  const g3 = B.bellContour(7.93 / 1.5 * IN, 35, 0.7, { thetaN: 34, thetaE: 10.5 });
  assert.ok(Math.abs(g3.length / IN - 68.1) < 0.05 && Math.abs(g3.N[0] / IN - 1.13) < 0.01 && Math.abs(g3.N[1] / IN - 5.64) < 0.01 && Math.abs(g3.downstreamArc / IN - 2.02) < 0.005);
  // the parabola leaves N at theta_n and meets E at theta_e (tangents of the quadratic Bezier N-Q-E)
  const ang = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
  assert.ok(Math.abs(ang(g.N, g.Q) - 27.4) < 1e-9 && Math.abs(ang(g.Q, g.E) - 9.8) < 1e-9);
  // cone: eq (4-7) length equals the straight wall from the arc tangent to the lip; wetted area matches arc + frustum
  const c = B.coneContour(1, 25, 15);
  const T = c.tangent, slope = (c.Re - T[1]) / (c.length - T[0]);
  assert.ok(Math.abs(slope - Math.tan(15 * Math.PI / 180)) < 1e-12);
  const frustum = Math.PI * (T[1] + c.Re) * Math.hypot(c.length - T[0], c.Re - T[1]);
  assert.ok(rel(c.wettedArea, frustum) < 0.01 && c.wettedArea > frustum);
});
test('sizing reproduces SP-125 Sample Calculation (4-2): 747,000 lbf, C_F 1.531, 1000 psia -> At 487 in^2, Dt 24.9 in', () => {
  const s = B.size(747000 * Bell.LBF, 1.531, 1000 * Bell.PSI, 1700, 14);
  assert.ok(Math.abs(s.At / (IN * IN) - 487.9) < 0.1 && Math.abs(s.Dt / IN - 24.9) < 0.05);
  assert.ok(rel(s.mdot * 1700, 1000 * Bell.PSI * s.At) < 1e-14);
  assert.equal(B.size(-1, 1.5, 1e6, 1700, 10).refusal.code, 'invalid_input');
  assert.equal(B.size(1e5, -0.2, 1e6, 1700, 10).refusal.code, 'out_of_envelope');
});

// ------------------------------------------------------------------ real hardware (SP-8120 Table I)
test('SP-8120 Table I: published specific impulse lies below the shifting ideal at all 16 points, and the gaps are the README\'s', () => {
  const pts = [];
  for (const row of L.table.ROWS) {
    const c = B.engineCase(row, L.presets.PRESETS);
    if (c.refusal) continue;
    for (const p of c.points) pts.push({ e: row.engine, ...p });
  }
  assert.equal(pts.length, 16);
  const gs = pts.map((p) => p.shifting.gap), gf = pts.map((p) => p.frozen.gap);
  assert.ok(gs.every((g) => g < 0), 'published Isp under the shifting ideal everywhere');
  assert.ok(Math.abs(Math.min(...gs) + 0.0900) < 0.001 && Math.abs(Math.max(...gs) + 0.0210) < 0.001, gs.join());
  assert.ok(Math.abs(Math.min(...gf) + 0.0418) < 0.001 && Math.abs(Math.max(...gf) - 0.0186) < 0.001, gf.join());
  const between = pts.filter((p) => p.ispPublished >= p.frozen.isp && p.ispPublished <= p.shifting.isp).length;
  assert.equal(between, 4, 'RL10A-3-3, LR91-AJ-5 and both J-2 points sit between the frozen and shifting ideals');
  // the J-2 at sea level separates by SP-8120's criterion; the sea-level boosters (eps 8 and 16) flow full
  const j2 = pts.find((p) => p.e === 'J-2' && p.condition === 'sl');
  assert.equal(j2.shifting.status, 'separated');
  assert.ok(j2.shifting.ispUpper > j2.shifting.isp);
  assert.ok(pts.filter((p) => p.condition === 'sl' && p.e !== 'J-2').every((p) => p.shifting.status === 'full'));
  // RL10A-3-3 (an expander, no dumped flow): 444 s published against 453.5 s shifting and 435.9 s frozen
  const rl = pts.find((p) => p.e === 'RL10A-3-3');
  assert.ok(Math.abs(rl.shifting.isp / L.pf.ISA_G0 - 453.5) < 0.1 && Math.abs(rl.frozen.isp / L.pf.ISA_G0 - 435.9) < 0.1);
  // engines idea 31 has no data for, or rows without one operating point, are refused, not guessed
  const refused = L.table.ROWS.map((r) => B.engineCase(r, L.presets.PRESETS)).filter((c) => c.refusal);
  assert.deepEqual(refused.map((c) => c.refusal.code).sort(), ['insufficient_data', 'not_found', 'not_found', 'not_found']);
});

// ------------------------------------------------------------------ handoff
test('imports idea 31\'s committed handoff exactly, and refuses edited, foreign or refused ones', () => {
  const h31 = json('snapshots/31-handoff.json');
  const p = B.parseHandoff(h31);
  const r = B.chamberFromHandoff(p.chamberHandoff, p.inputs);
  assert.ok(!r.refusal && rel(r.cstar, h31.outputs.cstar.value) < 1e-12 && rel(r.chamber.T, h31.outputs.chamber_temperature.value) < 1e-12);
  // through the URL fragment idea 31's page writes
  const p2 = B.parseHandoff('#h=' + M.b64urlEncode(JSON.stringify(h31)));
  assert.equal(p2.inputs.of, 2.6);
  const edited = JSON.parse(JSON.stringify(h31)); edited.outputs.cstar.value *= 1.001;
  const e = B.chamberFromHandoff(B.parseHandoff(edited).chamberHandoff, B.parseHandoff(edited).inputs);
  assert.equal(e.refusal.code, 'invalid_input');
  assert.match(e.refusal.reason, /cstar/);
  const foreign = JSON.parse(JSON.stringify(h31)); foreign.from = '40-long-coast';
  assert.equal(B.parseHandoff(foreign).refusal.code, 'invalid_input');
  assert.equal(B.parseHandoff('not json').refusal.code, 'invalid_input');
  // a chamber idea 31 refused (graphite at O/F 1.0) arrives as a refusal carried down, with no nozzle numbers
  const bad = B.chamberHandoff({ preset: 'lox-rp1', oxidizer: side(PAIRS['LOX/RP-1'][0]), fuel: side(PAIRS['LOX/RP-1'][1]), of: 1.0, pc: 50e5 }, L.densities, L.THERMO, 'x');
  assert.ok(bad.handoff.refusals.length && !bad.handoff.outputs.cstar);
  const rb = B.chamberFromHandoff(bad.handoff, B.parseHandoff(bad.handoff).inputs);
  assert.match(rb.refusal.reason, /Refused upstream by 31-mixture: .*C\(gr\)/);
  const A = B.analyze(rb, { eps: 16, contour: { type: 'bell', Lf: 0.8 }, ambient: { kind: 'vacuum' } });
  const h = B.makeHandoff(bad.handoff, { eps: 16, contour: { type: 'bell', Lf: 0.8 } }, A, { produced: 'x' });
  assert.ok(!h.outputs.exit_velocity_shifting && h.refusals.some((x) => x.applies_to === 'chamber'));
});
test('the sample handoff.json is what the kernel computes; every output has value, units, confidence and source', async () => {
  const { sample, SAMPLE_NOZZLE } = await import(path.join(here, 'build-sample.mjs'));
  const committed = json('handoff.json');
  const fresh = sample(json('snapshots/31-handoff.json'), SAMPLE_NOZZLE, committed.produced);
  assert.deepEqual(JSON.parse(JSON.stringify(fresh)), committed);
  for (const [k, o] of Object.entries(committed.outputs)) {
    assert.ok('value' in o && o.units && ['measured', 'derived', 'assumed'].includes(o.confidence) && o.source, k);
    assert.ok(JSON.stringify(o.value) !== 'null', k + ' is not null');
  }
  assert.equal(committed.from, '32-bell');
  assert.equal(committed.inputs.chamber_handoff.from, '31-mixture');
  // passed-through chamber numbers are idea 31's, bit for bit
  assert.equal(committed.outputs.cstar_shifting.value, committed.inputs.chamber_handoff.outputs.cstar.value);
  // a 32 handoff re-imports with its nozzle inputs
  const back = B.parseHandoff(JSON.stringify(committed));
  assert.deepEqual(back.nozzle.contour, SAMPLE_NOZZLE.contour);
  assert.equal(back.chamberHandoff.from, '31-mixture');
  // the sample's sizing closes: thrust = C_F pc At at sea level
  const O = committed.outputs;
  assert.ok(rel(O.thrust_coefficient_design.value * O.chamber_pressure.value * O.throat_area.value, 1e6) < 1e-12);
  assert.ok(rel(O.mass_flow.value * O.cstar_shifting.value, O.chamber_pressure.value * O.throat_area.value) < 1e-12);
});
test('structured refusals for out-of-envelope and bad inputs, with no numbers', () => {
  const r = M.rocket(db, prop('LOX/LH2'), 6, 50e5), b = B.flow(r, 'shifting');
  for (const e of [1.2, 500, NaN]) assert.ok(B.stationAtArea(b, e).refusal, 'eps ' + e);
  assert.equal(B.ambient({ kind: 'altitude', alt_m: 90000 }).refusal.code, 'out_of_envelope');
  assert.equal(B.ambient({ kind: 'pressure', pa: -5 }).refusal.code, 'invalid_input');
  assert.equal(B.coneContour(1, 10, 50).refusal.code, 'out_of_envelope');
  assert.equal(B.raoAngles(3, 0.8).refusal.code, 'out_of_envelope');
  assert.equal(B.stationAtPressure(b, b.throat.P * 1.1).refusal.code, 'out_of_envelope');
  // a design ambient where the nozzle separates gives no sizing
  const A = B.analyze(r, { eps: 150, contour: { type: 'bell', Lf: 0.8 }, ambient: { kind: 'altitude', alt_m: 0 }, thrust: 1e5 });
  assert.ok(!A.sizing && A.refusals.some((x) => x.applies_to === 'sizing' && /separates/.test(x.reason)));
  const h = B.makeHandoff(B.chamberHandoff({ preset: 'lox-lh2', oxidizer: side(PAIRS['LOX/LH2'][0]), fuel: side(PAIRS['LOX/LH2'][1]), of: 6, pc: 50e5 }, L.densities, L.THERMO, 'x').handoff,
    { eps: 150, contour: { type: 'bell', Lf: 0.8 }, ambient: { kind: 'altitude', alt_m: 0 }, thrust: 1e5 }, A, { produced: 'x' });
  assert.ok(!h.outputs.specific_impulse_ambient_shifting && !h.outputs.throat_area);
  assert.ok(h.refusals.some((x) => x.applies_to === 'specific_impulse_ambient_shifting'));
  for (const x of h.refusals) assert.ok(!/NaN|Infinity|undefined/.test(x.reason + x.what_would_help), x.reason);
});

// ------------------------------------------------------------------ added by the independent review
test('review: an independent CEA run (the reviewer\'s own script) at Table I conditions and the sample, outside the builder\'s fixture', () => {
  const R = json('oracle/review-cea-check.json');
  const T1 = (n) => L.table.ROWS.find((r) => r.engine === n);
  let n = 0;
  for (const c of R.cases) {
    // the conditions are Table I's as transcribed (no number retyped): O/F, psia and area ratio
    if (c.name !== 'sample') { const row = T1(c.name); assert.equal(c.of, row.mr); assert.equal(c.eps, row.eps); assert.ok(rel(c.pc_Pa, row.pc[0][0] * Bell.PSI) < 1e-9, c.name + ' pc'); }
    else assert.ok(c.of === 2.6 && c.pc_Pa === 1e7 && c.eps === 16);
    const r = M.rocket(db, L.presets.PRESETS.find((p) => p.id === c.preset), c.of, c.pc_Pa);
    for (const [tag, mode] of [['eq', 'shifting'], ['frz1', 'frozen']]) {
      const b = B.flow(r, mode), ref = c[tag + '_43'], full = c[tag + '_full'];
      assert.ok(ref.converged && full.converged);
      const st = B.stationAtArea(b, ref.eps); // at CEA's own converged area ratio
      assert.ok(rel(st.Ivac, ref.Ivac) < 2e-7 && rel(st.T, ref.T) < 5e-7 && rel(st.mach, ref.mach) < 5e-7 && rel(st.P, ref.P) < 5e-6, c.name + ' ' + mode);
      assert.ok(rel(b.cstar, ref.cstar) < 2e-6, c.name + ' ' + mode + ' c*');
      assert.ok(rel(st.Ivac, full.Ivac) < 2e-7, c.name + ' ' + mode + ' against every product');
      n++;
    }
  }
  assert.equal(n, 10);
  // the README's F-1 sea-level numbers from these CEA values and the bell's lambda: 291.5 s shifting, 278.5 s frozen
  const f1 = R.cases.find((c) => c.name === 'F-1'), row = T1('F-1');
  const lam = B.lambdaBell(B.lengthFraction(row.L * IN, row.Dt * IN / 2, row.eps), row.eps).value;
  const sl = (x) => (lam * x.Ivac - x.eps * L.pf.isa(0).P_Pa * x.cstar / f1.pc_Pa) / L.pf.ISA_G0;
  assert.ok(Math.abs(sl(f1.eq_full) - 291.5) < 0.05 && Math.abs(sl(f1.frz1_full) - 278.5) < 0.05, sl(f1.eq_full) + ' ' + sl(f1.frz1_full));
});

test('review: a refused divergence efficiency gives no after-divergence numbers, no sizing and no chart points', () => {
  const sel = { preset: 'lox-rp1', oxidizer: side(PAIRS['LOX/RP-1'][0]), fuel: side(PAIRS['LOX/RP-1'][1]), of: 2.27, pc: 77.6e5 };
  const ch = B.chamberHandoff(sel, L.densities, L.THERMO, 'x');
  const base = { eps: 16, ambient: { kind: 'altitude', alt_m: 0 }, thrust: 1e6 };
  const contours = [{ type: 'bell', Lf: 0.5 }, { type: 'bell', Lf: NaN }, { type: 'cone', alpha: 60 }, { type: 'cone', alpha: 0 }, { type: 'cone', alpha: NaN }];
  for (const contour of contours) {
    const ni = { ...base, contour }, A = B.analyze(ch.rocket, ni), h = B.makeHandoff(ch.handoff, ni, A, { produced: 'x' });
    const O = h.outputs, tag = JSON.stringify(contour);
    assert.ok(!A.lambda && h.refusals.some((x) => x.applies_to === 'divergence_efficiency'), tag);
    for (const k of ['divergence_efficiency', 'specific_impulse_vacuum_shifting', 'thrust_coefficient_vacuum_frozen', 'specific_impulse_ambient_shifting', 'thrust_coefficient_ambient_frozen', 'throat_area', 'mass_flow']) assert.ok(!O[k], tag + ' has no ' + k);
    for (const k of ['specific_impulse_shifting', 'specific_impulse_frozen', 'sizing']) assert.ok(h.refusals.some((x) => x.applies_to === k), tag + ' refuses ' + k);
    // the ideal nozzle is still given, and is the station's own Ivac
    assert.equal(O.specific_impulse_vacuum_ideal_shifting.value, A.flows.shifting.exit.Ivac);
    for (const x of h.refusals) assert.ok(!/NaN|Infinity|undefined/.test(x.reason + x.what_would_help), tag + ': ' + x.reason);
  }
  // an area ratio that is not a number, or outside the envelope, gets no lambda (it used to be 0 for NaN)
  for (const eps of [NaN, 500, 1.2, -5]) {
    const A = B.analyze(ch.rocket, { ...base, eps, contour: { type: 'bell', Lf: 0.8 } });
    assert.ok(!A.lambda && A.refusals.some((x) => x.applies_to === 'divergence_efficiency'), 'eps ' + eps);
    for (const x of A.refusals) assert.ok(!/NaN|Infinity|undefined/.test(x.reason + x.what_would_help), 'eps ' + eps + ': ' + x.reason);
  }
  // the cone's envelope is its contour's: 45 degrees still computes, exactly the closed form
  const A45 = B.analyze(ch.rocket, { ...base, contour: { type: 'cone', alpha: 45 } });
  assert.equal(A45.lambda.value, (1 + Math.cos(Math.PI / 4)) / 2);
  // the area-ratio sweep refuses a point with no lambda rather than drawing it at lambda = 1
  const rows = B.areaSweep(B.flow(ch.rocket, 'shifting'), 0, [10, 20], () => undefined);
  assert.ok(rows.every((x) => x.refusal && x.isp == null));
});

test('review: the separated bracket (J-2 at sea level by hand) and no bracket when separation would sit at the throat', () => {
  const row = L.table.ROWS.find((r) => r.engine === 'J-2');
  const r = M.rocket(db, L.presets.PRESETS.find((p) => p.id === row.prop), row.mr, row.pc[0][0] * Bell.PSI);
  const Lf = B.lengthFraction(row.L * IN, row.Dt * IN / 2, row.eps);
  const pa = L.pf.isa(0).P_Pa;
  const A = B.analyze(r, { eps: row.eps, contour: { type: 'bell', Lf }, ambient: { kind: 'altitude', alt_m: 0 } });
  const S = A.flows.shifting, lam = A.lambda.value;
  assert.equal(S.sep.status, 'separated');
  // by hand: the cut nozzle at SP-8120's separation pressure, lambda C_F,vac minus its own eps pa / pc
  const cut = B.stationAtPressure(S.base, S.sep.pSep);
  const upper = (lam * cut.Ivac / S.base.cstar - cut.eps * pa / S.base.pc) * S.base.cstar;
  assert.ok(rel(S.bracket.upper, upper) < 1e-9 && S.bracket.lower === S.amb.isp);
  assert.ok(Math.abs(S.bracket.lower / L.pf.ISA_G0 - 307.0) < 0.05 && Math.abs(S.bracket.upper / L.pf.ISA_G0 - 339.5) < 0.05, 'README: 307.0 to 339.5 s');
  // the engine table's bracket is the same code path
  const ec = B.engineCase(row, L.presets.PRESETS).points.find((p) => p.condition === 'sl');
  assert.ok(rel(ec.shifting.ispUpper, S.bracket.upper) < 1e-9);
  // the F-1 at 10 MPa ambient: separation would sit above the throat pressure, so there is no bracket at all;
  // at 1 MPa the full-flowing value is negative and is not offered as a bound
  const f1 = L.table.ROWS.find((x) => x.engine === 'F-1');
  const r1 = M.rocket(db, L.presets.PRESETS.find((p) => p.id === 'lox-rp1'), f1.mr, f1.pc[0][0] * Bell.PSI);
  for (const [paX, expect] of [[1e7, 'none'], [1e6, 'upper only']]) {
    const ni = { eps: 16, contour: { type: 'bell', Lf: 0.8 }, ambient: { kind: 'pressure', pa: paX } };
    const A2 = B.analyze(r1, ni), F = A2.flows.shifting, h = B.makeHandoff({ ...json('snapshots/31-handoff.json') }, ni, A2, { produced: 'x' });
    const txt = h.refusals.filter((x) => x.applies_to === 'specific_impulse_ambient_shifting')[0].what_would_help;
    if (expect === 'none') assert.ok(F.bracket.none && F.bracket.upper == null && F.bracket.lower == null && /No bracket/.test(txt), txt);
    else assert.ok(F.bracket.lower == null && F.bracket.upper > 0 && /up to/.test(txt), txt);
    const offered = (txt.match(/Bracket: [^;(]*/) || [''])[0]; // the bound itself, not the explanation after it
    assert.ok(!/-\d/.test(offered), 'no negative number offered as a bound: ' + txt);
  }
});
