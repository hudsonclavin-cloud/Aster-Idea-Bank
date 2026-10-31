// Engine Deck tests. Run from the bank root: node --test ideas/33-engine-deck/engine.test.mjs
// Oracles: NASA CEA 3.3.4 (oracle/cea-turbine.json, for idea 31's kernel on turbine drive gas), NASA SP-8107, SP-8110,
// SP-8120 and TM-107318's published figures (snapshots/turbo-data.js, snapshots/sp8120-table1.js), closed forms.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const L = require(path.join(here, 'load.cjs'));
const { E, Engine: EN, TD, M, B, pf } = L;
const G0 = pf.ISA_G0, LBF = EN.LBF, LBM = EN.LBM, PSI = EN.PSI, HP = EN.HP;
const rel = (a, b) => Math.abs(a / b - 1);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`);
const read = (f) => fs.readFileSync(path.join(here, f));
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const CEA = JSON.parse(read('oracle/cea-turbine.json'));
const SOURCES = read('snapshots/turbo-sources.txt').toString();
const lh2 = E.presetProp('lox-lh2');

// ------------------------------------------------------------------ snapshots and sources
test('snapshots of ideas 31 and 32 are byte-identical to the committed files', () => {
  const pairs = [['mixture.js', '31-mixture/mixture.js'], ['thermo-excerpt.js', '31-mixture/snapshots/thermo-excerpt.js'], ['propellant-densities.js', '31-mixture/snapshots/propellant-densities.js'],
    ['mixture-presets.js', '31-mixture/presets.js'], ['bell.js', '32-bell/bell.js'], ['nozzle-charts.js', '32-bell/snapshots/nozzle-charts.js'], ['nozzle-rules.js', '32-bell/snapshots/nozzle-rules.js'],
    ['isa.js', '32-bell/snapshots/isa.js'], ['sp8120-table1.js', '32-bell/snapshots/sp8120-table1.js'], ['32-handoff.json', '32-bell/handoff.json']];
  for (const [a, b] of pairs) assert.equal(sha(read('snapshots/' + a)), sha(fs.readFileSync(path.join(here, '..', b))), a);
});

test('every provenance sidecar records the sha256 of the file beside it', () => {
  const dir = path.join(here, 'snapshots');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.provenance.json'))) {
    const p = JSON.parse(fs.readFileSync(path.join(dir, f)));
    assert.ok(p.repo && p.path && p.commit, f + ' has repo, path, commit');
    assert.equal(p.writtenSha256, sha(fs.readFileSync(path.join(dir, f.replace('.provenance.json', '')))), f);
  }
});

test('legible transcribed numbers are in the verbatim text layer; garbled ones are why the scan was read', () => {
  // [quote in the text layer, the transcribed values it carries]
  const quotes = [
    ['F-1 Saturn IC 1 522 000 1122', [TD.SP8107_T1.find((r) => r.engine === 'F-1').thrust === 1522000, TD.SP8107_T1.find((r) => r.engine === 'F-1').pc === 1122]],
    ['3237 56.5 555 50D Tank head', [TD.SP8107_T1.find((r) => r.engine === 'SSME (EPL)').pc === 3237]],
    ['65.0 3097 4070 25 200 5 488', [TD.SP8107_PUMPS[14].head === 3097, TD.SP8107_PUMPS[14].w === 4070, TD.SP8107_PUMPS[14].gpm === 25200]],
    ['1856 45.0 5 168 1715 15 250 5 488 70 55 72.6', [TD.SP8107_PUMPS[15].pd === 1856, TD.SP8107_PUMPS[15].w === 1715, TD.SP8107_PUMPS[15].eff === 72.6]],
    ['980 65.0 1 851 537 3 410 6 680 35 25 77.8 2 340', [TD.SP8107_PUMPS[8].pd === 980, TD.SP8107_PUMPS[8].hp === 2340]],
    ['1238 30.0 38 000 83.6 8 530 27 130 130 75 73.0 7 977', [TD.SP8107_PUMPS[25].head === 38000, TD.SP8107_PUMPS[25].hp === 7977]],
    ['6981 188 193 900 160.5 16 450 37 400', [TD.SP8107_PUMPS[27].pd === 6981, TD.SP8107_PUMPS[27].head === 193900]],
    ['1450 920 16.4 171.8 5 488 60.5 52 900 840', [TD.SP8107_TURBINES[7].Tin === 1450, TD.SP8107_TURBINES[7].w === 171.8, TD.SP8107_TURBINES[7].hp === 52900]],
    ['1200 657 7.3 7.0 27 130 60.1 7 977 1480', [TD.SP8107_TURBINES[13].pin === 657, TD.SP8107_TURBINES[13].pr === 7.3]],
    ['1391 5820 1.56"* 159.0 37 400 79.0** 76 400 1661', [TD.SP8107_TURBINES[15].pr === 1.56, TD.SP8107_TURBINES[15].w === 159]],
    ['1500 1000 1.374 1.998 423', [TD.SP8110_GAS['LOX/LH2'].cp[0] === 1.998, TD.SP8110_GAS['LOX/LH2'].R[0] === 423]],
    ['1000 1100 1.097 0.635 44', [TD.SP8110_GAS['LOX/RP-1'].gamma[0] === 1.097]],
    ['Throat Diameter 2.47 in', [TD.RL10A33A.table251.throat_diameter_in === 2.47]],
    ['Nozzle Area Ratio 61.0', [TD.RL10A33A.table251.area_ratio === 61]],
  ];
  for (const [q, checks] of quotes) { assert.ok(SOURCES.includes(q), 'quote: ' + q); checks.forEach((c, i) => assert.ok(c, q + ' check ' + i)); }
  // the text layer garbles these, so they were read off the rendered pages (README)
  assert.ok(SOURCES.includes('t600 65.0 3097'), 'F-1 LOX discharge reads t600 in the text layer');
  assert.ok(SOURCES.includes('106 698 1.42 5.35'), 'RL10A-3-3 turbine inlet lost its minus sign in the text layer');
  assert.ok(SOURCES.includes('1101 5880 159"*'), 'SSME oxidizer turbine pressure ratio reads 159 in the text layer');
  assert.equal(TD.SP8107_PUMPS[14].pd, 1600); assert.equal(TD.SP8107_TURBINES[11].Tin, -106); assert.equal(TD.SP8107_TURBINES[14].pr, 1.59);
});

test('the transcriptions are internally consistent (catches a mistyped digit)', () => {
  // SP-8110 Table III: an ideal gas has gamma = cp / (cp - R) (778.169 ft lbf per Btu); every row to 0.65 %, except
  // LF2/LH2 at 900 F, whose printed gamma is 1.10 % below its own cp and R (a finding about the source: the scan
  // reads 1.395, 2.765, 626; the kernel does not use that gas)
  for (const [name, t] of Object.entries(TD.SP8110_GAS)) t.T.forEach((_, i) => {
    const cp = t.cp[i] * 778.169262, g = cp / (cp - t.R[i]);
    if (name === 'LF2/LH2' && t.T[i] === 900) { near(g / t.gamma[i] - 1, 0.0110, 2e-4, 'LF2/LH2 900 F'); return; }
    assert.ok(rel(g, t.gamma[i]) < 0.0065, `${name} ${t.T[i]} F: gamma ${t.gamma[i]} vs cp/(cp-R) ${g}`);
  });
  // SP-8107 Table II: head = 144 dp / rho within 2 % except liquid hydrogen at high pressure and the A-7 alcohol
  const odd = new Set(['J-2 Hydrogen', 'SSME (EPL) Hydrogen', 'A-7 Alcohol (75 % alcohol, 25 % water)']);
  for (const r of TD.SP8107_PUMPS) { const c = E.pumpCheck(r); if (!odd.has(r.engine + ' ' + r.fluid)) assert.ok(Math.abs(c.headGap) < 0.02, r.engine + ' ' + r.fluid + ' head ' + c.headGap); }
  // SP-8107 Table II: gpm x density = lb/s within 2 %, except the MA-5 sustainer's RP-1 pump, whose printed 91.6 lb/s is
  // 9.3 % above its own 745 gpm x 50.5 lb/ft^3 = 83.8 lb/s (83.8 is 8.5 % below it); its printed 620 hp follows from 83.8 lb/s (a finding)
  for (const r of TD.SP8107_PUMPS) {
    const w = r.gpm * 231 / 1728 / 60 * r.rho;
    if (r.engine === 'MA-5 sustainer' && r.fluid === 'RP-1') {
      near(w / r.w - 1, -0.0849, 3e-4, 'MA-5 sustainer RP-1 weight vs volume flow');
      near(w * r.head / (r.eff / 100) / 550 / r.hp - 1, -0.0030, 2e-4, 'its 620 hp follows from the volume flow');
      continue;
    }
    assert.ok(rel(w, r.w) < 0.02, r.engine + ' ' + r.fluid + ' volume flow');
  }
  // TM-107318 Table 6.1.1: jacket heat = flow x enthalpy rise; pump power by head = by torque; turbine torque power = flow x dh
  const X = TD.RL10A33A;
  assert.ok(rel(X.fuel[5][4] * (X.fuel[5][6] - X.fuel[4][6]), X.jacket.heat) < 2e-4, 'jacket heat');
  const x = E.expanderCheck();
  x.pumps.forEach((p) => assert.ok(rel(p.powerFromHead, p.powerFromTorque) < 2e-3, p.stage));
  assert.ok(rel(x.turbinePowerTorque, x.turbinePowerPublishedDh) < 1e-4, 'turbine torque x speed vs flow x dh');
  assert.ok(rel(X.overall.thrust / (X.ox[2][4] + X.fuel[3][4]), X.overall.isp) < 2e-4, 'thrust / chamber flow = Isp');
});

// ------------------------------------------------------------------ NASA CEA: idea 31's kernel on turbine drive gas
test('turbine drive gas matches NASA CEA 3.3.4: inlet state and isentropic drop, refusing where CEA condenses water', () => {
  let n = 0, nref = 0, worstT = 0, worstDh = 0;
  for (const c of CEA.cases) {
    const prop = E.presetProp(c.pair);
    const g = E.gasEq(prop, c.of, c.p_Pa);
    assert.ok(!g.refusal, c.pair + ' ' + c.of + ' ' + c.p_Pa);
    worstT = Math.max(worstT, rel(g.T, c.inlet.T));
    assert.ok(rel(g.T, c.inlet.T) < 2e-6, `T ${c.pair} ${c.of} ${c.p_Pa}`);
    assert.ok(rel(g.cp, c.inlet.cp_fr) < 2e-6 && rel(g.M, c.inlet.M) < 2e-6, 'cp_fr and M');
    c.expansions.forEach((x, i) => {
      const t = E.turbine(g, c.p_Pa, x.pr, 1);
      const condenses = (c.full_condensed_out[i] || []).length > 0;
      if (condenses) { assert.ok(t.refusal, `refuses where CEA condenses: ${c.pair} ${c.of} ${c.p_Pa} PR ${x.pr}`); nref++; return; }
      assert.ok(!t.refusal, `computes where CEA does not condense: ${c.pair} ${c.of} ${c.p_Pa} PR ${x.pr}: ${t.refusal && t.refusal.reason}`);
      worstDh = Math.max(worstDh, rel(t.dhIs, x.dh_is));
      assert.ok(rel(t.dhIs, x.dh_is) < 1e-5, `dh_is ${c.pair} ${c.of} ${c.p_Pa} PR ${x.pr}: ${t.dhIs} vs ${x.dh_is}`);
      n++;
    });
  }
  assert.equal(n + nref, 120); assert.equal(nref, 10);
  for (const c of CEA.tp) {
    const g0 = E.gasEq(lh2, c.of, c.p_Pa), g = E.gasTP(g0, c.T, c.p_Pa), t = E.turbine(g, c.p_Pa, c.pr, 1);
    assert.ok(rel(t.dhIs, c.dh_is) < 1e-5, 'TP case ' + c.of);
  }
  assert.ok(worstT < 1e-6 && worstDh < 1e-5);
});

test('the gas-generator mixture ratio found for a temperature burns at that temperature (round trip)', () => {
  for (const [T, p] of [[922, 657 * PSI], [1028.15, 5820 * PSI], [867, 5880 * PSI]]) {
    const g = E.gasAtTemperature(lh2, T, p, 'fuel');
    assert.ok(Math.abs(g.T - T) < 1e-5, 'T ' + T);
    assert.ok(Math.abs(E.gasEq(lh2, g.of, p).T - T) < 1e-5);
  }
  const ox = E.gasAtTemperature(E.presetProp('lox-rp1'), 900, 200e5, 'ox');
  assert.ok(!ox.refusal && ox.of > 30 && Math.abs(ox.T - 900) < 1e-5, 'oxidizer-rich LOX/RP-1');
  // fuel-rich kerosene would deposit graphite: refused, not reported wrong
  const rp = E.gasAtTemperature(E.presetProp('lox-rp1'), 1061, 63e5, 'fuel');
  assert.equal(rp.refusal.code, 'out_of_envelope'); assert.match(rp.refusal.reason, /C\(gr\)/);
});

test('idea 31 agrees with SP-8110 Table III on fuel-rich LOX/LH2 gas at the table\'s temperatures', () => {
  const t = TD.SP8110_GAS['LOX/LH2'];
  t.T.forEach((F, i) => {
    const g = E.gasAtTemperature(lh2, EN.FtoK(F), t.pSource * PSI, 'fuel');
    assert.ok(rel(g.gamma, t.gamma[i]) < 0.001, `gamma at ${F} F: ${g.gamma} vs ${t.gamma[i]}`);
    assert.ok(rel(g.cp, t.cp[i] * EN.BTU_PER_LB_R) < 0.005, `cp at ${F} F`);
    assert.ok(rel(8.31451 / g.M, t.R[i] * EN.FTLBF_PER_LBM_R) < 0.006, `R at ${F} F`);
  });
});

// ------------------------------------------------------------------ closed forms and properties
test('exact unit definitions', () => {
  assert.equal(HP, 550 * 0.3048 * 0.45359237 * 9.80665);
  near(HP, 745.69987158227, 1e-9, 'hp');
  near(PSI, 6894.757293168361, 1e-9, 'psi');
  near(EN.FTLBF_PER_LBM_R, 5.380320456, 1e-8, 'ft lbf / (lbm R)');
  assert.equal(EN.FtoK(-459.67), 0); near(EN.FtoK(32), 273.15, 1e-12, '32 F');
});

test('pump power is mdot dp / (rho eta), and SP-8107\'s pump powers follow from flow x head / efficiency', () => {
  const p = E.pump(10, 1e5, 101e5, 1000, 0.5);
  near(p.power, 10 * 100e5 / 1000 / 0.5, 1e-9, 'hand-worked'); near(p.head, 100e5 / (1000 * G0), 1e-9, 'head');
  // F-1 oxygen pump by hand: 4070 lb/s x 3097 ft / 0.746 / 550 = 30 720.6 hp against the printed 30 200
  const f = E.pumpCheck(TD.SP8107_PUMPS[14]);
  near(f.power, 4070 * 3097 / 0.746 / 550, 1e-9, 'F-1 LOX'); near(f.powerGap, 0.0172487, 1e-6, 'F-1 LOX gap');
  const gaps = TD.SP8107_PUMPS.map((r) => E.pumpCheck(r)).filter((c) => c.powerGap != null).map((c) => c.powerGap);
  assert.equal(gaps.length, 22);
  near(Math.min(...gaps), -0.0531721, 1e-6, 'lowest (MB-3 oxygen)'); near(Math.max(...gaps), 0.0894796, 1e-6, 'highest (MA-5 sustainer RP-1)');
  near(EN.median(gaps), -0.00259, 5e-4, 'median');
  // the SSME's second oxygen stage is counted: 25 519 + 2 226 hp
  near(E.pumpCheck(TD.SP8107_PUMPS[26]).power, 1137 * 9640 / 0.781 / 550 + 120 * 7100 / 0.696 / 550, 1e-9, 'SSME LOX two stages');
  // incompressible head overstates liquid hydrogen's at high pressure
  near(E.pumpCheck(TD.SP8107_PUMPS[27]).headGap, 0.151787, 1e-5, 'SSME LH2'); near(E.pumpCheck(TD.SP8107_PUMPS[25]).headGap, 0.0403828, 1e-5, 'J-2 LH2');
});

test('turbine work: perfect-gas closed form, its inverse, and the equilibrium path agree where they should', () => {
  const g = E.gasTab('LOX/RP-1', EN.FtoK(1450));
  // F-1 by hand on SP-8110's gas interpolated at 1450 F: gamma 1.12775, cp 0.654 Btu/(lb R)
  near(g.gamma, 1.115 + 0.75 * 0.017, 1e-12, 'gamma'); near(g.cp / EN.BTU_PER_LB_R, 0.648 + 0.75 * 0.008, 1e-12, 'cp');
  const t = E.turbine(g, 920 * PSI, 16.4, 0.605);
  near(t.dhIs, g.cp * g.T * (1 - Math.pow(16.4, -(g.gamma - 1) / g.gamma)), 1e-6, 'closed form');
  near(E.pressureRatioFor(g, 920 * PSI, t.dhIs).pr, 16.4, 1e-9, 'inverse');
  const ge = E.gasAtTemperature(lh2, 1028.15, 5820 * PSI, 'fuel'), te = E.turbine(ge, 5820 * PSI, 1.56, 1);
  near(E.pressureRatioFor(ge, 5820 * PSI, te.dhIs).pr, 1.56, 1e-8, 'inverse on equilibrium gas');
  // ideal hydrogen: inlet-property closed form against idea 31's equilibrium on pure hydrogen, 300 K to PR 1.4
  const h = E.gasH2(300, 50e5), th = E.turbine(h, 50e5, 1.4, 1);
  const b0 = { H: 2 / M.parseThermo(require(path.join(here, 'snapshots/thermo-excerpt.js'))).products.H2.M / 1000 * 1000 };
  const e1 = M.equilibrate(L.db, b0, 50e5, { mode: 'TP', T: 300 }), e2 = M.equilibrate(L.db, b0, 50e5 / 1.4, { mode: 'SP', s: e1.s });
  assert.ok(rel(th.dhIs, e1.h - e2.h) < 3e-4, `hydrogen closed form within 0.03 %: ${th.dhIs} vs ${e1.h - e2.h}`);
  assert.equal(E.gasH2(196.5, 698 * PSI).refusal.code, 'out_of_envelope', 'below the H2 fit');
  assert.equal(E.gasTab('LOX/RP-1', EN.FtoK(1075)).refusal.code, 'out_of_envelope', 'outside SP-8110\'s table');
});

test('the deck: F(pa) = F_vac - pa Ae while flowing full, mass flow independent of ambient, Isp x mdot = F', () => {
  const s = E.engineSpec('F-1'), c = s.context;
  const v = E.point(c, s.spec.pc, 0);
  for (const z of [0, 3000, 12000, 40000]) {
    const p = E.point(c, s.spec.pc, pf.isa(z).P_Pa);
    assert.ok(!p.refusal);
    near(p.F, v.Fvac - pf.isa(z).P_Pa * v.Ae, 1e-6 * v.Fvac, 'ambient law at ' + z);
    assert.equal(p.mdot, v.mdot); near(p.isp * p.mdot, p.F, 1e-6 * p.F, 'Isp x mdot');
  }
  // throttle: mdot = pc At / (eta c*(pc)); the chemistry is re-run at each pressure
  const h = E.point(c, 0.6 * s.spec.pc, 0);
  near(h.mdot / v.mdot, 0.6 * v.cstar / h.cstar, 1e-12, 'mass flow with throttle');
  assert.ok(h.cstarIdeal < v.cstarIdeal, 'lower pressure, more dissociation, lower c*');
  // calibration reproduces SP-8120's published vacuum point exactly
  near(v.Fvac / LBF, 1748000, 1e-6, 'F-1 vacuum thrust'); near(v.ispVac / G0, 315, 1e-9, 'F-1 vacuum Isp');
});

test('the gas-generator balance closes, and the staged-combustion and expander balances close where they say they do', () => {
  const s = E.engineSpec('F-1'), v = E.point(s.context, s.spec.pc, 0), d = E.densities(s.spec.prop);
  const g = E.cycle(E.cycleReference('F-1'), { pc: v.pc, mdotOx: v.mdotOx, mdotFuel: v.mdotFuel, prop: s.spec.prop, rhoOx: d.ox.value, rhoFuel: d.fuel.value });
  near(g.turbinePower, g.pumpPower, 1e-9 * g.pumpPower, 'GG balance');
  near(g.mdotGG / LBM, 182.265, 0.01, 'F-1 gas-generator flow on this deck');
  const el = E.engineLevel(v, g);
  near(el.ispVacLow / G0, 304.983, 0.002, 'engine vacuum Isp, exhaust dumped'); near(el.ispVacHigh / G0, 312.128, 0.002, 'fully expanded');
  assert.ok(el.ispVacLow < v.ispVac && el.ispVacHigh < v.ispVac, 'a gas generator always costs Isp');
  // the J-2's two turbines in series: the oxidizer turbine takes 5.0 / 7.0 of the gas, after the fuel turbine
  const j = E.engineSpec('J-2'), jv = E.point(j.context, j.spec.pc, 0), jd = E.densities(j.spec.prop);
  const jg = E.cycle(E.cycleReference('J-2'), { pc: jv.pc, mdotOx: jv.mdotOx, mdotFuel: jv.mdotFuel, prop: j.spec.prop, rhoOx: jd.ox.value, rhoFuel: jd.fuel.value });
  near(jg.stages[1].flowFrac, 5 / 7, 1e-12, 'series flow fraction'); assert.ok(jg.stages[1].Tin < jg.stages[0].Tin, 'second turbine is fed the first one\'s exhaust');
  near(jg.mdotGG / LBM, 7.2885, 0.01, 'J-2 gas-generator flow on this deck (SP-8107: 7.0 lb/s)');
  // review fix: the J-2's 423 s divides by the whole engine's flow (ispBasisCheck), so its chamber is calibrated at
  // SP-8107's chamber share (544 - 7.0) / 544 and the engine level comes back to 423 s, not 1.3 % below it
  near(j.spec.calibration.chamberShare, (460.4 + 83.6 - 7.0) / (460.4 + 83.6), 1e-12, 'J-2 chamber share of the pump flow');
  const jel = E.engineLevel(jv, jg);
  near(jel.ispVacLow / G0, 422.773, 0.002, 'J-2 engine vacuum Isp, exhaust dumped (published engine value 423 s)');
  assert.ok(Math.abs(jel.ispVacLow / G0 / 423 - 1) < 0.001 && jel.ispVacHigh / G0 > 423, 'the J-2 bracket holds its published engine Isp');
  near(jv.ispVac / G0, 423 / ((460.4 + 83.6 - 7.0) / (460.4 + 83.6)), 1e-6, 'J-2 thrust-chamber vacuum Isp');
  // the other gas-generator presets' Isp is the thrust chamber's: calibrated at the published value
  for (const id of ['F-1', 'H-1', 'LR89-NA-7']) assert.equal(E.engineSpec(id).spec.calibration.chamberShare, 1, id + ' chamber basis');
  near(jg.turbinePower, jg.pumpPower, 1e-9 * jg.pumpPower, 'J-2 balance');
  const ref = E.cycleReference('SSME (EPL)'), P = TD.SP8107_PUMPS.filter((r) => r.engine === 'SSME (EPL)'), dl = E.densities(lh2);
  const sc = E.cycle(ref, { pc: ref.pc, mdotOx: P[0].w * LBM, mdotFuel: P[1].w * LBM, prop: lh2, rhoOx: dl.ox.value, rhoFuel: dl.fuel.value });
  near(sc.turbinePower, sc.pumpPower, 1e-8 * sc.pumpPower, 'SC balance');
});

// ------------------------------------------------------------------ against the published record
test('altitude to sea level: SP-8120 Table I\'s three sea-level thrusts follow from the altitude ones within 0.3 %', () => {
  const a = Object.fromEntries(E.ambientLawCheck().map((o) => [o.engine, o]));
  assert.deepEqual(Object.keys(a).sort(), ['F-1', 'H-1C and H-1D', 'LR87-AJ-5']);
  near(a['F-1'].gap, -0.00020868, 2e-7, 'F-1'); near(a['H-1C and H-1D'].gap, 0.0026706, 2e-7, 'H-1'); near(a['LR87-AJ-5'].gap, 0.00242724, 2e-7, 'LR87');
  near(a['F-1'].ispGap, 0.000789124, 2e-7, 'F-1 Isp'); near(a['LR87-AJ-5'].ispGap, -0.000984412, 2e-7, 'LR87 Isp');
});

test('throttle: the YLR113-AJ-1, calibrated at 595 psia, predicts its 235 psia end to +0.32 % in thrust and +3.65 % in Isp', () => {
  const t = E.throttleCheck();
  near(t.pcLow / PSI, 235, 1e-9, 'low end'); near(t.FPublished / LBF, 50000, 1e-9, 'published');
  near(t.Fgap, 0.00323458, 2e-6, 'thrust'); near(t.ispGap, 0.0365355, 2e-6, 'Isp'); assert.equal(t.status, 'full');
});

test('SP-8120\'s Isp is not on one basis: thrust chamber for F-1, H-1 and LR89, engine for J-2 and LR79', () => {
  const b = Object.fromEntries(E.ispBasisCheck().map((o) => [o.engine, o]));
  assert.equal(b['F-1'].basis, 'thrust chamber'); assert.equal(b['H-1C and H-1D'].basis, 'thrust chamber'); assert.equal(b['LR89-NA-7'].basis, 'thrust chamber');
  assert.equal(b['J-2'].basis, 'engine'); assert.equal(b['LR79-NA-11'].basis, 'engine'); assert.equal(b['RL10A-3-3'].basis, 'closed cycle (one value)');
  near(b['F-1'].ispEngine, 1522000 / 5785, 1e-9, 'F-1 engine Isp by hand'); near(b['F-1'].engineGap, 0.041452, 1e-6, 'F-1 274 s vs 263.1 s');
  near(b['H-1C and H-1D'].chamberGap, -0.000631424, 1e-7, 'H-1 chamber'); near(b['J-2'].engineGap, 0.000486957, 1e-7, 'J-2 engine');
  // review addition: the J-2's turbines are in series, so its gas generator's flow is the larger turbine flow (7.0), not the sum
  near(b['J-2'].turbineFlow, 7.0, 1e-12, 'J-2 turbine flow'); near(b['J-2'].chamberGap, 423 / (230000 / (460.4 + 83.6 - 7.0)) - 1, 1e-12, 'J-2 chamber');
});

test('turbine powers against SP-8107 Table III: SP-8110 gas -14.6 to +17.1 %, idea 31 gas -27.2 to -3.4 %', () => {
  const want = { 'LR87-AJ-3': [-0.12692], 'LR91-AJ-3': [0.170771], 'H-1': [0.106558], 'MA-5 booster': [0.105733], 'F-1': [-0.0571078], 'J-2 Fuel': [-0.0262179, -0.0336594],
    'J-2 Oxidizer': [null, -0.271738], 'SSME (EPL) High pressure oxidizer': [-0.146464, -0.151438], 'SSME (EPL) High pressure fuel': [-0.130322, -0.13405] };
  const refused = { 'A-7': 'not_found', 'YLR81-BA-11': 'not_found', 'YLR87-AJ-7': 'out_of_envelope', 'YLR91-AJ-7': 'out_of_envelope', 'RL10A-3-3': 'out_of_envelope', 'MA-5 sustainer': 'out_of_envelope' };
  for (const r of TD.SP8107_TURBINES) {
    const c = E.turbineCheck(r), key = r.engine + (r.turbine ? ' ' + r.turbine : '');
    if (r.engine === 'MB-3') { assert.equal(c.refusal.code, 'insufficient_data'); continue; }
    if (refused[r.engine]) { assert.equal(c.methods.table.refusal.code, refused[r.engine], key); continue; }
    const [a, b] = want[key];
    if (a == null) assert.ok(c.methods.table.refusal, key + ' table refused'); else near(c.methods.table.gap, a, 2e-6, key + ' SP-8110');
    if (b != null) near(c.methods.computed.gap, b, 2e-6, key + ' idea 31');
    else assert.match(c.methods.computed.refusal.reason, /C\(gr\)/, key + ': fuel-rich kerosene refused for graphite');
  }
  // the two gas sources agree on the same turbines within 1 %
  for (const k of ['J-2 Fuel', 'SSME (EPL) High pressure oxidizer', 'SSME (EPL) High pressure fuel']) assert.ok(Math.abs(want[k][0] - want[k][1]) < 0.01, k);
});

test('cycle predictions: gas-generator flows, the J-2\'s series turbine, the SSME\'s pressure ratios', () => {
  const g = (e, m) => E.ggFlowCheck(e, m);
  near(g('F-1', 'table').gap, 0.0609186, 2e-6, 'F-1'); near(g('H-1', 'table').gap, -0.132434, 2e-6, 'H-1'); near(g('MA-5 booster', 'table').gap, -0.130138, 2e-6, 'MA-5');
  near(g('J-2', 'table').gap, 0.0185983, 2e-6, 'J-2 table'); const j = g('J-2', 'computed');
  near(j.gap, 0.0264423, 2e-6, 'J-2 idea 31'); near(j.secondGap, 0.304041, 2e-5, 'J-2 oxidizer turbine flow');
  near(EN.KtoF(j.seriesInletT), 785.4, 0.2, 'J-2 oxidizer-turbine inlet from the fuel turbine\'s exit (published 760 F)');
  assert.equal(g('F-1', 'computed').refusal.code, 'out_of_envelope');
  const sc = E.scPressureRatioCheck('table');
  near(sc[0].pr, 1.74523, 1e-4, 'SSME oxidizer turbine (published 1.59)'); near(sc[1].pr, 1.67486, 1e-4, 'SSME fuel turbine (published 1.56)');
});

test('expander: the RL10A-3-3A turbine needs pressure ratio 1.410 for the table\'s pump power; the cycle\'s own balance gives 1.4038 (published 1.402)', () => {
  const x = E.expanderCheck();
  near(x.dh, 89.432, 0.002, 'turbine dh, Btu/lb (published 92.02)'); near(x.pr, 1.40995, 1e-4, 'PR for the published pump power');
  const X = TD.RL10A33A, ref = E.cycleReference('RL10A-3-3A');
  near(ref.bypass, 1 - 6.056 / 6.082, 1e-12, 'bypass from the table'); near(ref.T, 384.2 / 1.8, 1e-12, 'inlet');
  const c = E.cycle(ref, { pc: ref.pc, mdotOx: X.ox[2][4] * LBM, mdotFuel: X.fuel[3][4] * LBM, prop: lh2, rhoOx: X.ox[1][5] * EN.LB_FT3, rhoFuel: X.fuel[1][5] * EN.LB_FT3 });
  near(c.pr, 1.40378, 1e-4, 'pressure ratio'); assert.ok(rel(c.pr, 1.402) < 0.002);
  near(c.pumps.fuel.pout / PSI, 1068.92, 0.05, 'fuel pump discharge (published 1067.3)');
  near(c.turbinePower, c.pumpPower, 1e-9 * c.pumpPower, 'balance');
  // review addition: why the cycle lands nearer 1.402 than the direct check. Its incompressible pumps need 1.2 % less
  // than the table's torque x speed, which offsets part of the turbine's 2.8 % short drop.
  near(c.pumpPower / EN.HP, 769.02, 0.05, 'cycle pump power, hp'); near(x.pumpPowerTorque, 778.462, 0.005, 'table pump power (torque x speed), hp');
  near((x.pr - 1) / (1.402 - 1) - 1, 0.01978, 2e-4, 'direct check: +2.0 % in (PR - 1)');
  // the expander's ceiling: at the same turbine inlet temperature it no longer closes at 1.5 x the chamber pressure
  const run = (tau, o) => E.cycle(ref, { pc: ref.pc * tau, mdotOx: X.ox[2][4] * LBM * tau, mdotFuel: X.fuel[3][4] * LBM * tau, prop: lh2, rhoOx: X.ox[1][5] * EN.LB_FT3, rhoFuel: X.fuel[1][5] * EN.LB_FT3 }, o);
  near(run(1.2).pr, 1.5951, 2e-4, '1.2 x closes'); const up = run(1.5);
  assert.equal(up.refusal.code, 'out_of_envelope'); near(up.bestRatio, 0.973, 2e-3, '1.5 x: at best 97.3 % of the pump power');
  near(run(1, { TinOverride: 300 }).pr, 1.2354, 2e-4, 'hotter hydrogen needs a smaller ratio');
  assert.match(run(1, { TinOverride: 120 }).refusal.reason, /200 K/, 'below the hydrogen fit: refused, not extrapolated');
});

test('staged combustion on the SSME reference closes at 100 % only at pressure ratio 2.64, and not at 110 %', () => {
  const ref = E.cycleReference('SSME (EPL)'), P = TD.SP8107_PUMPS.filter((r) => r.engine === 'SSME (EPL)'), d = E.densities(lh2);
  const run = (tau) => E.cycle(ref, { pc: ref.pc * tau, mdotOx: P[0].w * LBM * tau, mdotFuel: P[1].w * LBM * tau, prop: lh2, rhoOx: d.ox.value, rhoFuel: d.fuel.value });
  near(run(1).pr, 2.63587, 2e-3, '100 %'); near(run(0.8).pr, 1.59519, 2e-4, '80 %');
  const r = run(1.1); assert.equal(r.refusal.code, 'out_of_envelope'); near(r.bestRatio, 0.907157, 1e-3, 'best at 110 %');
  assert.equal(E.cycle(ref, { pc: ref.pc, mdotOx: 1, mdotFuel: 1, prop: lh2, rhoOx: 1000, rhoFuel: 70 }, { richSide: 'ox' }).refusal.code, 'insufficient_data');
});

test('engine presets: calibration factors, lowest sea-level throttle, and the altitude engines refused at sea level', () => {
  const want = { 'F-1': [1.05754, 0.902458, 0.526801], 'H-1': [1.03467, 0.924771, 0.384265], 'J-2': [0.962166, 1.01292, null], 'LR89-NA-7': [0.999179, 0.925221, 0.460266], 'RL10A-3-3': [1.02082, 0.959161, null], 'YLR113-AJ-1': [0.980515, 0.935609, 0.327533] };
  for (const [id, [a, b, t]] of Object.entries(want)) {
    const s = E.engineSpec(id);
    near(s.spec.etaCstar, a, 2e-5, id + ' c*'); near(s.spec.etaCF, b, 2e-5, id + ' CF');
    const m = E.minThrottleFull(s.context, pf.isa(0).P_Pa, 0.1, 1.2);
    if (t == null) { assert.ok(m.refusal, id + ' separates at sea level'); assert.equal(E.point(s.context, s.spec.pc, pf.isa(0).P_Pa).refusal.applies_to, 'thrust'); }
    else {
      near(m.throttle, t, 2e-4, id + ' lowest throttle');
      assert.ok(!E.point(s.context, m.throttle * s.spec.pc, pf.isa(0).P_Pa).refusal, id + ' flows full at the returned throttle');
      assert.equal(E.point(s.context, (m.throttle - 2e-4) * s.spec.pc, pf.isa(0).P_Pa).status, 'separated', id + ' separates just below it');
    }
  }
  assert.equal(E.engineSpec('LR89-NA-7').spec.contour.Lf, 1, 'a 104 % bell uses the chart\'s end, as idea 32 does');
});

// ------------------------------------------------------------------ handoff
const H32 = read('snapshots/32-handoff.json').toString();
test('imports idea 32\'s committed handoff, and refuses edited, foreign, chamber-only and non-JSON ones', () => {
  const p = E.parseHandoff(H32);
  assert.ok(!p.refusal, p.refusal && p.refusal.reason);
  near(p.analysis.sizing.At, JSON.parse(H32).outputs.throat_area.value, 1e-12, 'throat area');
  const viaLink = E.parseHandoff('https://x/#h=' + M.b64urlEncode(H32));
  assert.ok(!viaLink.refusal, 'via #h=');
  const ed = JSON.parse(H32); ed.outputs.specific_impulse_vacuum_ideal_shifting.value *= 1.001;
  assert.equal(E.parseHandoff(JSON.stringify(ed)).refusal.code, 'invalid_input');
  const ed2 = JSON.parse(H32); ed2.outputs.throat_area.value *= 1.01;
  assert.equal(E.parseHandoff(JSON.stringify(ed2)).refusal.code, 'invalid_input');
  const h31 = JSON.parse(H32).inputs.chamber_handoff;
  assert.equal(E.parseHandoff(JSON.stringify(h31)).refusal.code, 'insufficient_data');
  const foreign = JSON.parse(H32); foreign.from = '40-long-coast';
  assert.equal(E.parseHandoff(JSON.stringify(foreign)).refusal.code, 'invalid_input');
  assert.equal(E.parseHandoff('not json').refusal.code, 'invalid_input');
});

test('the sample handoff is what the kernel computes, chains exactly to idea 32\'s numbers, and re-imports', async () => {
  const { sample } = await import('./build-sample.mjs');
  const h = sample(JSON.parse(H32));
  const file = JSON.parse(read('handoff.json'));
  assert.deepEqual(file, JSON.parse(JSON.stringify(h)));
  const O = h.outputs, O32 = JSON.parse(H32).outputs;
  // with efficiencies 1 the deck is idea 32's nozzle: its sized sea-level thrust and its Isp, exactly
  near(O.thrust_sea_level_chamber.value, O32.design_thrust.value, 1e-6, '1 MN at sea level');
  near(O.specific_impulse_vacuum_chamber.value, O32.specific_impulse_vacuum_shifting.value, 1e-9 * 3300, 'vacuum Isp');
  near(O.specific_impulse_sea_level_chamber.value, O32.specific_impulse_ambient_shifting.value, 1e-9 * 3300, 'sea-level Isp');
  near(O.mass_flow_chamber.value, O32.mass_flow.value, 1e-9 * 334, 'mass flow');
  near(O.mass_flow.value, O.mass_flow_chamber.value + O.gas_generator_flow.value, 1e-9, 'engine flow');
  for (const [k, o] of Object.entries(O)) {
    assert.ok(o.value !== null && o.value !== undefined && o.units && o.source, k);
    assert.ok(['measured', 'derived', 'assumed'].includes(o.confidence), k + ' confidence');
  }
  assert.ok(h.refusals.some((r) => r.applies_to === 'engine_dry_mass'));
  assert.ok(!/NaN|undefined/.test(JSON.stringify(h.refusals)));
  const back = E.parseHandoff(JSON.stringify(h));
  assert.ok(!back.refusal); assert.equal(back.engine.cycle_reference, 'F-1'); assert.equal(back.engine.throat_area_m2, O.throat_area.value);
});

test('refusals: efficiencies, chamber envelope, a cycle without flow or with the wrong fuel, a separated deck cell', () => {
  const s = E.engineSpec('F-1').spec;
  const bad = E.context(Object.assign({}, s, { etaCstar: 1.3 }));
  assert.equal(bad.refusals[0].code, 'out_of_envelope'); assert.ok(E.point(bad, s.pc, 0).refusal);
  assert.equal(E.context(Object.assign({}, s, { etaCF: NaN })).refusals[0].code, 'invalid_input');
  const c = E.context(s);
  assert.equal(E.point(c, 0.05e5, 0).refusal.code, 'out_of_envelope', 'below idea 31\'s 0.1 bar');
  const noAt = E.context(Object.assign({}, s, { At: null }));
  assert.equal(noAt.refusals[0].applies_to, 'throat_area'); assert.equal(E.point(noAt, s.pc, 0).mdot, undefined);
  assert.equal(E.cycle(E.cycleReference('F-1'), { pc: s.pc, mdotOx: undefined, mdotFuel: undefined, prop: s.prop, rhoOx: 1, rhoFuel: 1 }).refusal.code, 'insufficient_data');
  const v = E.point(c, s.pc, 0);
  assert.equal(E.cycle(E.cycleReference('RL10A-3-3A'), { pc: v.pc, mdotOx: v.mdotOx, mdotFuel: v.mdotFuel, prop: s.prop, rhoOx: 1141, rhoFuel: 810 }).refusal.code, 'out_of_envelope', 'expander needs hydrogen');
  const D = E.deck(c, [0.3, 1]);
  assert.equal(D.rows[0].cells[0].status, 'separated'); assert.equal(D.rows[0].cells[0].F, undefined);
  const H = E.makeHandoff(JSON.parse(H32), s, D, null, {});
  assert.equal(H.outputs.deck.value.status[0][0], 'separated'); assert.equal(H.outputs.deck.value.thrust[0][0], null);
  assert.equal(E.cycleReference('nope').refusal.code, 'not_found');
  // review additions: the deck's flows-full-at-sea-level flag agrees with the lowest throttle (F-1: 52.7 %)
  const D2 = E.deck(c, [0.5, 0.6]);
  assert.equal(D2.rows[0].flowsFullAtSeaLevel, false, '50 %: separates at sea level'); assert.equal(D2.rows[1].flowsFullAtSeaLevel, true, '60 %: flows full');
  // a typed turbine inlet temperature that is not a positive number is refused, not silently replaced by the reference's
  const j = E.engineSpec('J-2'), jv = E.point(j.context, j.spec.pc, 0), jd = E.densities(j.spec.prop);
  const jop = { pc: jv.pc, mdotOx: jv.mdotOx, mdotFuel: jv.mdotFuel, prop: j.spec.prop, rhoOx: jd.ox.value, rhoFuel: jd.fuel.value };
  const r = E.engineSpec('RL10A-3-3'), rv = E.point(r.context, r.spec.pc, 0), rd = E.densities(r.spec.prop);
  const rop = { pc: rv.pc, mdotOx: rv.mdotOx, mdotFuel: rv.mdotFuel, prop: r.spec.prop, rhoOx: rd.ox.value, rhoFuel: rd.fuel.value };
  for (const [ref, op] of [['SSME (EPL)', jop], ['RL10A-3-3A', rop]]) {
    for (const t of [-5, 0, NaN, 'abc']) assert.equal(E.cycle(E.cycleReference(ref), op, { TinOverride: t }).refusal.code, 'invalid_input', ref + ' Tin ' + t);
    assert.ok(!E.cycle(E.cycleReference(ref), op, { TinOverride: null }).refusal, ref + ' blank Tin: the reference temperature');
  }
  assert.ok(!E.cycle(E.cycleReference('J-2'), jop, { TinOverride: -5 }).refusal, 'a gas generator takes its temperature from the reference only');
});
