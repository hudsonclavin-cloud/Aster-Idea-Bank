// Tests for Required Life. Node built-ins only; run from the bank root:
//   node --test ideas/26-required-life/model.test.mjs
// The reconciliation tests pin numbers to things outside this code: the published conservative
// triple in Skyhook's DECISION_LOG (snapshot), the mass ratios in params/rev_a.json (snapshot),
// Skyhook's own finance module run live through crosscheck.py, Abramowitz and Stegun's erf table,
// and hand-worked figures.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const M = require(path.join(here, 'model.js'));
const D = require(path.join(here, 'data.js'));
const snap = (f) => path.join(here, 'snapshots', f);
const readJSON = (f) => JSON.parse(fs.readFileSync(snap(f), 'utf8'));
const close = (a, b, rel = 1e-9, msg = '') =>
  assert.ok(Math.abs(a - b) <= rel * Math.max(1, Math.abs(b)), `${msg} ${a} vs ${b}`);

const CONS = M.economics(D, 'Conservative', 'reference');
const R = (f, life, fiberPerKg = null, convention = 'rolling') => ({ f, life, fiberPerKg, convention });

// ---------------------------------------------------------------- data and provenance

test('data.js packs the snapshot files exactly, and build_data.py agrees it is fresh', () => {
  assert.deepEqual(D.revA, readJSON('rev_a.excerpt.json'));
  assert.deepEqual(D.ladder, readJSON('ladder.json'));
  assert.deepEqual(D.conventions, readJSON('finance_conventions.json'));
  assert.deepEqual(D.physics, readJSON('physics_constants.json'));
  assert.deepEqual(D.founding, readJSON('founding_hybrid.json'));
  const r = spawnSync('python3', ['-B', path.join(here, 'build_data.py'), '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('every quote is the exact line of its snapshot, and the parsed numbers are the documents\' own', () => {
  for (const [key, q] of Object.entries(D.quotes)) {
    const lines = fs.readFileSync(snap(q.file), 'utf8').split('\n');
    assert.equal(lines[q.line - 1], q.text, `${key} at ${q.file}:${q.line}`);
  }
  // read by eye from MP-001:23, MP-001:46, LR-001:45, DECISION_LOG:47 and :57 at Skyhook 34935cb
  assert.equal(D.quotes.mp001_creep_row.line, 23);
  assert.equal(D.quotes.mp001_3c.line, 46);
  assert.equal(D.quotes.lr001_D.line, 45);
  assert.equal(D.quotes.item10_outcomes.line, 74);
  assert.deepEqual(
    [D.sourced.guidance_max_load_pct, D.sourced.sk78_life_yr, D.sourced.sk78_life_load_pct, D.sourced.sk78_life_temp_c],
    [20, 8, 20, 20],
  );
  assert.deepEqual([D.sourced.rev_a_load_low_pct, D.sourced.rev_a_load_high_pct, D.sourced.dm20_creep_factor], [28, 40, 50]);
  assert.deepEqual([D.sourced.st002_low_pct, D.sourced.st002_high_pct, D.sourced.hmpe_density_gcc], [20, 40, 0.97]);
  assert.match(D.quotes.item10_outcomes.text, /creep-governed tether replacement cadence, costed into ops/);
  assert.equal(D.founding.zylon_outer_lower_arm_km, 20);
  assert.ok(D.founding.line_text.includes(D.founding.sentence));
  assert.equal(D.founding.line, 108);
});

test('every snapshot has a sidecar naming Skyhook at 34935cb', () => {
  const files = fs.readdirSync(path.join(here, 'snapshots')).filter((f) => !f.endsWith('.provenance.json'));
  assert.equal(files.length, 8);
  for (const f of files) {
    const p = JSON.parse(fs.readFileSync(snap(`${f}.provenance.json`), 'utf8'));
    assert.match(p.repo, /skyhook/);
    assert.ok(p.commit.startsWith('34935cb'), f);
    assert.equal(p.writtenSha256.length, 64);
  }
});

// ---------------------------------------------------------------- base reconciliation

test('erf matches the 10-digit tabulated values', () => {
  // Abramowitz and Stegun Table 7.1 (quoted from memory; Python's math.erf agrees):
  // 0.5 -> 0.5204998778, 1.0 -> 0.8427007929, 2.0 -> 0.9953222650
  close(M.erf(0.5), 0.5204998778, 2e-10);
  close(M.erf(1.0), 0.8427007929, 2e-10);
  close(M.erf(2.0), 0.995322265, 2e-10);
  assert.equal(M.erf(0), 0);
  close(M.erf(-1), -M.erf(1), 0);
  assert.equal(M.erf(9), 1);
});

test('replacement off reproduces the published conservative triple: $8,741M / Y17 / -$3,883M', () => {
  const s = D.sourced;
  assert.equal(Math.round(CONS.totalCapex_M), s.published_capex_M);
  assert.equal(M.paybackYear(CONS, null), s.published_payback_year);
  assert.equal(Math.round(M.npv_M(CONS, CONS.npvRate, CONS.window, null)), s.published_npv10_M);
  assert.equal(Number(CONS.massRatio.toFixed(2)), s.published_mass_ratio);
  assert.equal(Math.round(CONS.fiberMass_t), s.published_fiber_t);
});

test('the baseline and optimistic triples of DECISION_LOG item 6 reproduce too', () => {
  const t = D.quotes.item6_triple.text;
  for (const col of ['Baseline', 'Optimistic']) {
    const m = new RegExp(`${col} ([\\d.]+)× / (\\d+) t / \\$([\\d,]+)M / Y(\\d+)`).exec(t);
    assert.ok(m, col);
    const E = M.economics(D, col, 'reference');
    assert.equal(E.massRatio.toFixed(2), m[1]);
    assert.equal(Math.round(E.fiberMass_t), Number(m[2]));
    assert.equal(Math.round(E.totalCapex_M), Number(m[3].replace(',', '')));
    assert.equal(M.paybackYear(E, null), Number(m[4]));
  }
});

test('all published EQ-6 mass ratios and fiber masses in rev_a.json reproduce to their printed precision', () => {
  const mr = D.revA.mass_ratio.integrated_tether_to_payload_both_arms;
  const pins = [
    ['Optimistic', 'reference', mr.optimistic_0pct_derate, mr.optimistic_0pct_fiber_mass_t],
    ['Baseline', 'reference', mr.baseline_15pct_derate, mr.baseline_15pct_fiber_mass_t],
    ['Conservative', 'reference', mr.conservative_30pct_derate, mr.conservative_30pct_fiber_mass_t],
    ['Conservative', 'cislunar_revenue_gated_option', mr.cislunar_2p8kms_30pct_derate, mr.cislunar_2p8kms_30pct_fiber_mass_t],
    ['Conservative', 'phase3_growth_option', mr.phase3_3p5kms_30pct_derate, mr.phase3_3p5kms_30pct_fiber_mass_t],
  ];
  for (const [col, tier, ratio, tonnes] of pins) {
    const E = M.economics(D, col, tier);
    assert.equal(Number(E.massRatio.toFixed(2)), ratio, `${col} ${tier}`);
    assert.equal(Number(E.fiberMass_t.toFixed(1)), tonnes, `${col} ${tier}`);
  }
});

let XC = null;
function crosscheck() {
  if (XC) return XC;
  const r = spawnSync('python3', ['-B', path.join(here, 'crosscheck.py'), '--repo', '/home/user/skyhook'], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  XC = r.status === 0 ? JSON.parse(r.stdout) : { skip: (r.stdout + r.stderr).trim() || `exit ${r.status}` };
  return XC;
}

test('every tier and column agrees with Skyhook\'s own finance module, with and without the line', (t) => {
  const x = crosscheck();
  if (x.skip) return t.skip(`Skyhook checkout or openpyxl unavailable: ${x.skip}`);
  assert.equal(x.cases.length, 9);
  for (const c of x.cases) {
    const E = M.economics(D, c.column, c.tier);
    const tag = `${c.column}/${c.tier}`;
    close(E.massRatio, c.mass_ratio, 1e-12, tag);
    close(E.fiberMass_t, c.fiber_t, 1e-12, tag);
    close(E.totalCapex_M, c.capex_M, 1e-12, tag);
    close(E.revenue_M, c.revenue_M, 1e-12, tag);
    close(E.varCost_M, c.var_M, 1e-12, tag);
    assert.equal(M.paybackYear(E, null), c.payback, tag);
    close(M.npv_M(E, 0.1, 15, null), c.npv10_M, 1e-12, tag);
    M.netCashFlows_M(E, 15, null).forEach((v, i) => close(v, c.flows15[i], 1e-12, `${tag} y${i + 1}`));
    for (const [Y, L] of Object.entries(c.closed_form || {})) {
      close(M.requiredLifeClosedForm(E, R(1, null), Number(Y)), L, 1e-12, `${tag} L*(Y${Y})`);
    }
    for (const run of c.runs) {
      const repl = R(run.f, run.life, run.fiber, run.convention);
      const rt = `${tag} ${JSON.stringify([run.f, run.life, run.fiber, run.convention])}`;
      assert.equal(M.paybackYear(E, repl), run.payback, rt);
      close(M.npv_M(E, 0.1, 15, repl), run.npv10_M, 1e-12, rt);
      close(M.cumulative_M(E, 15, repl), run.cum15_M, 1e-12, rt);
      M.netCashFlows_M(E, 40, repl).forEach((v, i) => close(v, run.flows40[i], 1e-12, `${rt} y${i + 1}`));
    }
  }
  for (const [xs, v] of Object.entries(x.erf)) close(M.erf(Number(xs)), v, 1e-14, `erf(${xs}) vs Python math.erf`);
});

// ---------------------------------------------------------------- the replacement line

test('hand check: f = 1, L = 8 yr, $2,500/kg, fiber unpriced costs $190.35M a year', () => {
  // 609.1304 t x 1000 x $2,500 / 8 / 1e6 = $190.353M; fixed ops $80M; revenue 1 x 365 x 5,000 kg x $500 = $912.5M
  const fw = M.forward(CONS, R(1, 8));
  assert.equal(fw.annual_M.toFixed(2), '190.35');
  close(fw.annual_M, (609.1304 * 1000 * 2500) / 8 / 1e6, 1e-6);
  assert.equal(CONS.revenue_M, 912.5);
  assert.equal(CONS.fixedOps_M, 80);
  close(fw.shareOfFixedOps, fw.annual_M / 80, 1e-15);
  assert.equal(fw.shareOfFixedOps.toFixed(3), '2.379');
  assert.equal(fw.shareOfRevenue.toFixed(4), '0.2086');
  assert.equal(fw.payback, 20);
  assert.equal(fw.basePayback, 17);
});

test('the rolling line is zero in construction years and exactly per/L in every operating year', () => {
  const repl = R(0.8, 6.5, 120);
  const base = M.netCashFlows_M(CONS, 30, null);
  const withL = M.netCashFlows_M(CONS, 30, repl);
  const per = (0.8 * CONS.fiberMass_t * 1000 * (2500 + 120)) / 1e6;
  for (let y = 1; y <= 30; y++) {
    const expect = y < 5 ? 0 : per / 6.5;
    close(base[y - 1] - withL[y - 1], expect, 1e-12, `year ${y}`);
  }
});

test('replacement cost falls with life, and is linear in the HMPE share and in cost per kg', () => {
  let prev = Infinity;
  for (const L of [0.5, 1, 2, 5, 8, 13, 28.5, 100]) {
    const a = M.forward(CONS, R(1, L)).annual_M;
    assert.ok(a < prev);
    prev = a;
  }
  const a1 = M.forward(CONS, R(1, 8)).annual_M;
  close(M.forward(CONS, R(0.37, 8)).annual_M, 0.37 * a1, 1e-14);
  close(M.forward(CONS, R(1, 8, 2500)).annual_M, 2 * a1, 1e-14);
  assert.equal(M.forward(CONS, R(0, 8)).annual_M, 0);
});

test('required life: closed form equals bisection, and payback holds just above it and slips at it', () => {
  for (const col of M.COLUMNS) {
    for (const tier of M.tiers(D.revA)) {
      const E = M.economics(D, col, tier.key);
      const base = M.paybackYear(E, null);
      if (base === null) continue;
      for (let k = 0; k < 4; k++) {
        const Y = base + k;
        const cf = M.requiredLifeClosedForm(E, R(1, null), Y);
        const bi = M.requiredLifeBisect(E, R(1, null), Y);
        close(bi, cf, 1e-9, `${col}/${tier.key} Y${Y}`);
        assert.ok(M.paybackYear(E, R(1, cf * (1 + 1e-6))) <= Y);
        assert.ok(M.paybackYear(E, R(1, cf * (1 - 1e-6))) > Y);
      }
    }
  }
  // the proposal's own test, payback(L*) = 18 and payback(L* + 0.01) = 17. The bound is exclusive:
  // at L* exactly the cumulative cash flow at Y17 is zero and round-off decides, so test just below.
  const Ls = M.requiredLifeClosedForm(CONS, R(1, null), 17);
  assert.equal(Ls.toFixed(2), '28.46');
  assert.equal(M.paybackYear(CONS, R(1, Ls * (1 - 1e-9))), 18);
  assert.ok(Math.abs(M.cumulative_M(CONS, 17, R(1, Ls))) < 1e-9);
  assert.equal(M.paybackYear(CONS, R(1, Ls + 0.01)), 17);
});

test('the required-life table for the conservative reference, all-HMPE, launch only', () => {
  const r = M.requiredLives(CONS, R(1, null));
  assert.equal(r.refused, false);
  assert.deepEqual(r.payback.map((p) => [p.target, p.life.toFixed(2)]), [
    [17, '28.46'], [18, '14.25'], [19, '9.95'], [20, '7.87'],
  ]);
  // replacement equals the $80M fixed-ops line: 1,522.83 / 80
  close(r.ops, r.perEvent_M / 80, 1e-15);
  assert.equal(r.ops.toFixed(2), '19.04');
  // never pays back below per / (912.5 - 32.12 - 80)
  assert.equal(r.floor.toFixed(3), '1.903');
  assert.equal(r.window, null);
  assert.equal(r.windowRefusal.code, 'base_misses_window');
  assert.ok(M.cumulative_M(CONS, 15, null) < 0);
});

test('required life is exactly proportional to the HMPE share and to cost per kg', () => {
  const L1 = M.requiredLives(CONS, R(1, null)).payback[0].life;
  for (const f of [0.25, 0.5, 0.96875, 0.99]) close(M.requiredLives(CONS, R(f, null)).payback[0].life, f * L1, 1e-12);
  close(M.requiredLives(CONS, R(1, null, 300)).payback[0].life, (L1 * 2800) / 2500, 1e-12);
});

test('the floor: below per / mature margin the case never pays back, above it it eventually does', () => {
  const r = M.requiredLives(CONS, R(1, null));
  assert.equal(M.paybackYear(CONS, R(1, r.floor * 0.999), 400), null);
  assert.ok(M.paybackYear(CONS, R(1, r.floor * 1.05), 400) !== null);
  // and at the fixed-ops life the average line is exactly $80M a year
  close(M.forward(CONS, R(1, r.ops)).annual_M, 80, 1e-12);
});

test('lumpy convention: events fall in the year that contains 4 + kL, and the same average cost', () => {
  const years = (repl, n) => {
    const out = [];
    for (let y = 1; y <= n; y++) if (M.replacementInYear_M(CONS, repl, y) > 0) out.push(y);
    return out;
  };
  assert.deepEqual(years(R(1, 8, null, 'lumpy'), 40), [12, 20, 28, 36]);
  // 10.25, 16.5, 22.75, 29, 35.25 -> years 11, 17, 23, 29, 36
  assert.deepEqual(years(R(1, 6.25, null, 'lumpy'), 40), [11, 17, 23, 29, 36]);
  // over 4 + 100 L years both conventions have spent 100 events' worth
  const L = 3.5;
  const n = 4 + 100 * L;
  let roll = 0;
  let lump = 0;
  for (let y = 1; y <= n; y++) {
    roll += M.replacementInYear_M(CONS, R(1, L), y);
    lump += M.replacementInYear_M(CONS, R(1, L, null, 'lumpy'), y);
  }
  close(roll, lump, 1e-12);
  // payback holds under lumpy exactly when the first event falls after Y17: L > 17 - 4 = 13
  const Ll = M.requiredLives(CONS, R(1, null, null, 'lumpy')).payback[0].life;
  close(Ll, 13, 1e-6);
  assert.equal(M.paybackYear(CONS, R(1, 13.01, null, 'lumpy')), 17);
  assert.ok(M.paybackYear(CONS, R(1, 13, null, 'lumpy')) > 17);
});

// ---------------------------------------------------------------- refusals

test('refusals: no HMPE share, bad inputs, a base case that never pays back, a missed window', () => {
  assert.equal(M.requiredLives(CONS, R(null, null)).code, 'hmpe_share_unset');
  assert.equal(M.forward(CONS, R(null, 8)).code, 'hmpe_share_unset');
  assert.equal(M.forward(CONS, R(1.2, 8)).code, 'hmpe_share_out_of_range');
  assert.equal(M.forward(CONS, R(1, 0)).code, 'life_invalid');
  assert.equal(M.forward(CONS, R(1, -3)).code, 'life_invalid');
  assert.equal(M.forward(CONS, R(1, 8, -5)).code, 'fiber_price_invalid');
  for (const k of ['hmpe_share_unset', 'life_invalid']) {
    const r = k === 'life_invalid' ? M.forward(CONS, R(1, NaN)) : M.requiredLives(CONS, R(undefined, null));
    assert.ok(r.refused && r.reason.length > 20 && r.whatWouldHelp.length > 10, k);
  }
  const P3 = M.economics(D, 'Conservative', 'phase3_growth_option');
  const r = M.requiredLives(P3, R(1, null));
  assert.equal(r.basePayback, null);
  assert.equal(r.paybackRefusal.code, 'base_never_pays_back');
  assert.equal(r.payback.length, 0);
  assert.ok(r.ops > 0 && r.floor > 0);
  const B = M.economics(D, 'Baseline', 'reference');
  const rb = M.requiredLives(B, R(1, null));
  assert.ok(rb.window && rb.window.life > 0 && !rb.windowRefusal);
});

test('an unpriced fiber term is absent, flagged, and only ever raises the required life', () => {
  const un = M.requiredLives(CONS, R(1, null));
  assert.equal(un.fiberUnpriced, true);
  assert.equal(un.costPerKg, 2500);
  const priced = M.requiredLives(CONS, R(1, null, 0));
  assert.equal(priced.fiberUnpriced, false);
  close(priced.payback[0].life, un.payback[0].life, 1e-15);
  assert.ok(M.requiredLives(CONS, R(1, null, 50)).payback[0].life > un.payback[0].life);
  assert.equal(D.revA.economics.fiber_cost_per_kg, null);
});

// ---------------------------------------------------------------- HMPE share readings

test('HMPE share readings: 620/640 by length; by mass along the EQ-6 profile, checked by integration', () => {
  assert.equal(M.hmpeShareByLength(CONS, 20), 620 / 640);
  // integrate A(r) = exp(x^2 (1 - r^2/L^2)) numerically (Simpson, 20,000 panels per arm)
  const x = CONS.x;
  const mass = (a, b) => {
    const n = 20000;
    const h = (b - a) / n;
    let s = 0;
    for (let i = 0; i <= n; i++) {
      const u = a + i * h;
      const w = i === 0 || i === n ? 1 : i % 2 ? 4 : 2;
      s += w * Math.exp(x * x * (1 - u * u));
    }
    return (s * h) / 3;
  };
  const arm = mass(0, 1);
  const outer = mass(300 / 320, 1);
  close(M.hmpeShareByMass(CONS, 20), 1 - outer / (2 * arm), 1e-10);
  // the same integral is EQ-6: one arm's mass / payload = 2 x^2 e^{x^2} * int_0^1 e^{-x^2 u^2} du
  close(2 * x * x * arm, CONS.massRatio / 2, 1e-9);
  assert.equal(M.hmpeShareByMass(CONS, 0), 1);
  close(M.hmpeShareByMass(CONS, 320), 0.5, 1e-15);
  assert.equal(M.hmpeShareByMass(CONS, 20).toFixed(4), '0.9963');
});

test('sustained load is (1 - derate)/SF of rated break: 28% / 34% / 40%, the DECISION_LOG range', () => {
  const lf = M.COLUMNS.map((c) => Math.round(M.economics(D, c, 'reference').loadFraction * 100));
  assert.deepEqual(lf, [28, 34, 40]);
  assert.equal(lf[0], D.sourced.rev_a_load_low_pct);
  assert.equal(lf[2], D.sourced.rev_a_load_high_pct);
});

// ---------------------------------------------------------------- ticks and the ST-002 reading

test('the DM20 toggle adds a second tick at 8 x 50 = 400 yr and leaves the SK78 tick alone', () => {
  const off = M.ticks(D.sourced, false);
  const on = M.ticks(D.sourced, true);
  assert.equal(off.length, 1);
  assert.equal(on.length, 2);
  assert.deepEqual(on[0], off[0]);
  assert.equal(off[0].life, 8);
  assert.equal(on[1].life, 400);
  assert.equal(on[1].lowerBound, true);
});

test('the ST-002 reading: SK78 cannot reach 28.46 yr at any load at or above 20%; DM20 needs a ratio of 14.05 or less', () => {
  const Ls = M.requiredLives(CONS, R(1, null)).payback[0].life;
  assert.ok(M.creepRatioThreshold(8, Ls) < 1);
  assert.equal(M.creepRatioThreshold(400, Ls).toFixed(2), '14.05');
  assert.equal(M.creepRatioThreshold(8, 0), null);
});

test('payback is the first year cumulative cash flow is strictly positive, as skyhook_finance.py:25 defines it', () => {
  // a hand-worked limit case with exact binary arithmetic: $100M capex over Y1-4, $50M a year
  // from Y5 with no costs, so the cumulative is exactly 0 at the end of Y6 and +50 at Y7
  const E0 = {
    totalCapex_M: 100, capexSpread: [0.25, 0.25, 0.25, 0.25], opsStart: 5, ramp1: 1, rampStep: 0,
    revenue_M: 50, varCost_M: 0, fixedOps_M: 0, maxYears: 40, fiberMass_t: 0, launchPerKg: 0,
  };
  assert.equal(M.cumulative_M(E0, 6, null), 0);
  assert.equal(M.paybackYear(E0, null), 7);
});

test('grade sensitivity: SK99 at 0.97 g/cm3 is within 1% of the canonical mass; SK78 strength would need 1.70-2.03x the life', () => {
  // MP-001:22 (secondary): HMPE 0.97 g/cm3, SK99 +15-20% strength over SK78; rev_a: SK99 3.6 GPa
  const s = D.sourced;
  const rho = s.hmpe_density_gcc * 1000;
  const sk99 = D.revA.materials.alternative_fibers.Dyneema_SK99_GPa;
  const ratioFor = (sigma) => M.massRatio(2.5, M.characteristicVelocity_kms(sigma, rho), CONS.SF, CONS.derate);
  assert.equal(ratioFor(sk99).toFixed(2), '122.60');
  assert.ok(Math.abs(ratioFor(sk99) / CONS.massRatio - 1) < 0.01);
  const lo = ratioFor(sk99 / (1 + s.sk99_over_sk78_low_pct / 100)) / CONS.massRatio;
  const hi = ratioFor(sk99 / (1 + s.sk99_over_sk78_high_pct / 100)) / CONS.massRatio;
  assert.deepEqual([lo.toFixed(2), hi.toFixed(2)], ['1.70', '2.03']);
});

// ---------------------------------------------------------------- the README says the same numbers

test('the README states the numbers this code computes', () => {
  const md = fs.readFileSync(path.join(here, 'README.md'), 'utf8');
  const r = M.requiredLives(CONS, R(1, null));
  const fw = M.forward(CONS, R(1, 8));
  const want = [
    `${r.payback[0].life.toFixed(1)} years`, // 28.5
    `${r.payback[1].life.toFixed(1)} years`, // 14.3
    `${r.ops.toFixed(1)} years`, // 19.0
    `${r.floor.toFixed(1)} years`, // 1.9
    `$${fw.annual_M.toFixed(2)}M`, // 190.35
    `Y${fw.payback}`, // Y20
    `${(M.hmpeShareByMass(CONS, 20) * 100).toFixed(2)}%`, // 99.63%
    `${M.creepRatioThreshold(400, r.payback[0].life).toFixed(1)}`, // 14.1
  ];
  for (const s of want) assert.ok(md.includes(s), `README is missing "${s}"`);
});
