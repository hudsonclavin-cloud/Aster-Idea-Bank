// model.test.mjs — node:test for the JavaScript port in model.js.
//
// Run from the bank root: node --test ideas/13-the-null-input/model.test.mjs
//
// The pin outside this folder's own code: reference.json, which fiber_sweep.py --json --quote 300 wrote
// (and which test_fiber_sweep.py checks is a fresh run), so every number the page can show is held to
// the Python model, which is itself gated to the published Skyhook figures. Plus: erf against tabulated
// values, EQ-6 against rev_a.json's ladder, and the same closed forms the Python tests use.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const M = createRequire(import.meta.url)(path.join(here, 'model.js'));
const read = (f) => JSON.parse(fs.readFileSync(path.join(here, f), 'utf8'));
const params = read('snapshots/rev_a.excerpt.json');
const ladderJson = read('snapshots/ladder.json');
const markers = read('snapshots/markers.json');
const ref = read('reference.json');
const dataJs = fs.readFileSync(path.join(here, 'data.js'), 'utf8');
const pageData = JSON.parse(dataJs.slice(dataJs.indexOf('window.NullInputData = ') + 'window.NullInputData = '.length).trim().replace(/;$/, ''));

const model = new M.Model(params);
const ladder = M.loadLadder(ladderJson);
const cons = ladder.Conservative;
const base = ladder.Baseline;

const close = (a, b, rel, msg) => {
  if (a === null || b === null) return assert.equal(a, b, msg);
  assert.ok(Math.abs(a - b) <= rel * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);
};

test('erf: both branches against tabulated values (Abramowitz & Stegun table 7.1; math.erf)', () => {
  // (x, erf x) as Python 3.13's math.erf prints them (computed, not retyped: python3 -c "import math; print(repr(math.erf(x)))")
  const table = [
    [0.5, 0.5204998778130465], [1.0, 0.8427007929497149], [1.5, 0.9661051464753108], [1.7326, 0.9857249451436281],
    [2.0, 0.9953222650189527], [2.4256, 0.9993971222254926], [2.9, 0.9999589021219005], [3.0, 0.9999779095030014],
    [3.5, 0.9999992569016276], [4.0, 0.9999999845827421],
  ];
  for (const [x, want] of table) {
    assert.ok(Math.abs(M.erf(x) - want) < 2e-12, `erf(${x}) = ${M.erf(x)} vs ${want}`);
    assert.equal(M.erf(-x), -M.erf(x));
  }
  assert.equal(M.erf(0), 0);
});

test('EQ-6 from the snapshot reproduces rev_a.json\'s five published ratios and fiber masses', () => {
  const audit = params.mass_ratio.integrated_tether_to_payload_both_arms;
  assert.equal(M.roundTo(model.Vc_kms, 2), params.materials.V_c_kms);
  assert.equal(M.roundTo(model.massRatio(cons), 2), audit.conservative_30pct_derate);          // 121.83
  assert.equal(M.roundTo(model.fiberMassT(cons), 1), audit.conservative_30pct_fiber_mass_t);  // 609.1
  assert.equal(M.roundTo(model.massRatio(base), 2), audit.baseline_15pct_derate);              // 64.3
  assert.equal(M.roundTo(model.massRatio(ladder.Optimistic), 2), audit.optimistic_0pct_derate); // 40.32
  const cis = model.forTier(cons, 'cislunar_revenue_gated_option');
  const p3 = model.forTier(cons, 'phase3_growth_option');
  assert.equal(M.roundTo(model.massRatio(cis), 2), audit.cislunar_2p8kms_30pct_derate);        // 295.27
  assert.equal(M.roundTo(model.fiberMassT(cis), 1), audit.cislunar_2p8kms_30pct_fiber_mass_t); // 1476.3
  assert.equal(M.roundTo(model.massRatio(p3), 2), audit.phase3_3p5kms_30pct_derate);           // 3085.95
  assert.equal(M.roundTo(model.fiberMassT(p3), 1), audit.phase3_3p5kms_30pct_fiber_mass_t);    // 15429.8
});

test('the p = 0 gate passes with the published anchors embedded in data.js', () => {
  const gate = M.runGate(model, ladder, pageData.published);
  assert.equal(gate.checks.length, 19);
  assert.deepEqual(gate.checks.filter((c) => !c.ok), []);
  assert.ok(gate.ok);
  // and fails on a tampered ladder
  const bad = Object.assign({}, ladder, { Conservative: Object.assign({}, cons, { construction_launch_per_kg: 2600 }) });
  assert.equal(M.runGate(model, bad, pageData.published).ok, false);
});

test('reconciles with the Python model: every row of the sweep in reference.json', () => {
  const study = M.computeStudy(model, ladder, ref.study.price_grid, ref.study.fiber_multiplier, markers);
  assert.equal(study.sweep.length, ref.study.sweep.length);
  let compared = 0;
  for (let i = 0; i < study.sweep.length; i++) {
    const a = study.sweep[i];
    const b = ref.study.sweep[i];
    assert.equal(a.fiber_price_per_kg, b.fiber_price_per_kg);
    assert.equal(a.rows.length, b.rows.length);
    for (let j = 0; j < a.rows.length; j++) {
      const r = a.rows[j];
      const q = b.rows[j];
      assert.equal(r.scenario, q.scenario);
      assert.equal(r.payback_year, q.payback_year, `${q.scenario} payback at $${q.fiber_price_per_kg}`);
      assert.equal(r.partial_tier_model, q.partial_tier_model);
      for (const k of ['mass_ratio_x', 'fiber_mass_t', 'system_capex_M', 'fiber_purchase_M', 'total_capex_M', 'npv_8pct_M', 'npv_10pct_M', 'npv_12pct_M', 'breakeven_customer_price_y15']) {
        close(r[k], q[k], 1e-9, `${q.scenario} ${k} at $${q.fiber_price_per_kg}`);
        compared++;
      }
    }
    for (const f of Object.keys(M.INPUTS)) {
      close(a.conservative_thresholds[f], b.conservative_thresholds[f], 1e-6, `threshold ${f} at $${b.fiber_price_per_kg}`);
      compared++;
    }
    assert.deepEqual(a.baseline_singles.map((s) => [s.field, s.payback_year, s.closes]), b.baseline_singles.map((s) => [s.field, s.payback_year, s.closes]));
  }
  for (const [f, v] of Object.entries(ref.study.single_stop_prices)) {
    if (typeof v === 'number') close(study.single_stop_prices[f], v, 1e-6, `stop price ${f}`);
    else assert.equal(study.single_stop_prices[f], v, `stop price ${f}`);
    compared++;
  }
  for (const [f, v] of Object.entries(ref.study.threshold_vanish_prices)) {
    if (typeof v === 'number') close(study.threshold_vanish_prices[f], v, 1e-6, `vanish price ${f}`);
    else assert.equal(study.threshold_vanish_prices[f], v, `vanish price ${f}`);
    compared++;
  }
  for (const f of Object.keys(M.INPUTS)) close(study.at_zero.conservative_thresholds[f], ref.study.at_zero.conservative_thresholds[f], 1e-6, `at_zero ${f}`);
  assert.deepEqual(study.at_zero.baseline_singles.map((s) => [s.field, s.payback_year, s.closes]), ref.study.at_zero.baseline_singles.map((s) => [s.field, s.payback_year, s.closes]));
  assert.equal(ref.study.markers.length, 0, 'reference.json is written with --markers - (the marker rows are summarize() at nine more prices)');
  assert.ok(compared > 350, `compared ${compared} numbers`);
  // The marker rows: one per price in markers.json, in file order, each with the line of its own price.
  const want = [];
  for (const mk of markers.markers) for (const [k, v] of Object.entries(mk.prices_per_kg)) want.push([mk.id, k, v, (mk.lines_per_key || {})[k] || mk.line]);
  assert.equal(want.length, 9);
  assert.deepEqual(study.markers.map((r) => [r.id, r.key, r.price_per_kg, r.line]), want);
  for (const r of study.markers) assert.deepEqual(r.rows, M.tierRows(model, ladder).map((s) => model.summarize(s, r.price_per_kg, ref.study.fiber_multiplier)));
});

test('reconciles with the Python quote card at $300/kg', () => {
  const card = M.quoteCard(model, ladder, ref.quote_card.fiber_price_per_kg, ref.quote_card.fiber_multiplier, 'test');
  assert.equal(card.rows.length, ref.quote_card.rows.length);
  for (let i = 0; i < card.rows.length; i++) {
    close(card.rows[i].added_capex_M, ref.quote_card.rows[i].added_capex_M, 1e-9, 'added capex');
    close(card.rows[i].added_capex_pct, ref.quote_card.rows[i].added_capex_pct, 1e-9, 'added %');
    assert.equal(card.rows[i].after.payback_year, ref.quote_card.rows[i].after.payback_year);
    close(card.rows[i].after.npv_10pct_M, ref.quote_card.rows[i].after.npv_10pct_M, 1e-9, 'npv after');
  }
  for (const f of Object.keys(M.INPUTS)) {
    close(card.conservative_thresholds_after[f], ref.quote_card.conservative_thresholds_after[f], 1e-6, `after ${f}`);
  }
  assert.equal(M.money(card.rows[0].added_capex_M), '$183M');
  assert.equal(`${M.money(card.rows[0].before.total_capex_M)} -> ${M.money(card.rows[0].after.total_capex_M)}`, '$8,741M -> $8,924M');
  assert.equal(M.money(card.rows[0].after.npv_10pct_M), '-$4,026M');
  assert.equal(M.pbStr(card.rows[0].after.payback_year), 'Y17*');
  assert.equal(M.pbStr(card.rows[4].after.payback_year), '>Y40');
  assert.equal(M.thrStr('construction_launch_per_kg', card.conservative_thresholds_after.construction_launch_per_kg), '$1,508');
  assert.equal(M.thrStr('construction_launch_per_kg', card.conservative_thresholds_before.construction_launch_per_kg), '$1,674');
});

test('hand check: 609.13 t × $300/kg = $182.74M; linear in price and multiplier; no hardware factor', () => {
  close(model.fiberPurchaseM(cons, 300, 1), 182.739, 1e-5, 'hand check');
  close(model.fiberPurchaseM(cons, 300, 1.3), 237.561, 1e-5, 'hand check ×1.3');
  for (const s of M.tierRows(model, ladder)) {
    const c0 = model.totalCapexM(s);
    for (const [p, m] of [[10, 1], [300, 1.3], [3000, 0.8]]) close(model.totalCapexM(s, p, m) - c0, p * m * model.fiberMassT(s) / 1000, 1e-9, `${s.name} ${p}×${m}`);
  }
  assert.equal(model.fiberPurchaseM(cons, 300, 1), model.fiberPurchaseM(Object.assign({}, cons, { hardware_mass_factor: 3 }), 300, 1));
});

test('closed forms: launch threshold slope −m/hmf, price threshold = breakeven, stop price = cum15·1000/(fiber_t·m)', () => {
  const L0 = model.relaxationThreshold(cons, 'construction_launch_per_kg', 0, 1);
  for (const m of [1, 1.3]) for (const p of [10, 100, 300, 1000]) {
    close(model.relaxationThreshold(cons, 'construction_launch_per_kg', p, m), L0 - p * m / cons.hardware_mass_factor, 1e-6, `launch ${p}×${m}`);
  }
  assert.equal(model.relaxationThreshold(cons, 'construction_launch_per_kg', 3000, 1), null);
  for (const p of [0, 100, 300, 3000]) close(model.relaxationThreshold(cons, 'customer_price_per_kg', p, 1), model.breakevenCustomerPriceY15(cons, p, 1), 1e-6, `price thr ${p}`);
  for (const f of ['construction_launch_per_kg', 'derate_fraction', 'program_fleet_capex_M', 'catches_per_day']) {
    for (const m of [1, 1.3]) {
      const s = M.Model.setInput(cons, f, M.Model.getInput(base, f));
      const cum15 = model.netCashFlowsM(s, 0, m, 15).reduce((a, b) => a + b, 0);
      const pStar = cum15 * 1000 / (model.fiberMassT(s) * m);
      close(model.singleStopPrice(cons, base, f, m), pStar, 1e-6, `stop ${f} ×${m}`);
      assert.ok(model.closes(s, pStar * (1 - 1e-6), m) && !model.closes(s, pStar * (1 + 1e-6), m), `${f} ×${m}`);
    }
  }
  // a finished-tether multiplier m divides every stop price by m (p* ∝ 1/m): launch $313.82 -> $241.40 at ×1.3
  close(model.singleStopPrice(cons, base, 'construction_launch_per_kg', 1.3), model.singleStopPrice(cons, base, 'construction_launch_per_kg', 1) / 1.3, 1e-9, 'stop ∝ 1/m');
  assert.equal(Math.round(model.singleStopPrice(cons, base, 'construction_launch_per_kg', 1.3)), 241);
  assert.equal(Math.round(model.singleStopPrice(cons, base, 'construction_launch_per_kg', 1)), 314);
  assert.equal(Math.round(model.singleStopPrice(cons, base, 'program_fleet_capex_M', 1)), 156);
  assert.equal(model.singleStopPrice(cons, base, 'fixed_ops_M', 1), null);
});

test('the launch threshold vanishes at (L*(0) − L0/5)·hmf/m = $2,113.82/kg, exactly, not at a grid point', () => {
  const L0 = model.relaxationThreshold(cons, 'construction_launch_per_kg', 0, 1);
  for (const m of [1, 1.3]) {
    const pv = model.thresholdVanishPrice(cons, 'construction_launch_per_kg', m);
    close(pv, (L0 - cons.construction_launch_per_kg / M.MAX_STRETCH) * cons.hardware_mass_factor / m, 1e-6, `vanish ×${m}`);
    close(model.thresholdVanishPrice(cons, 'hardware_mass_factor', m), pv, 1e-6, `hw vanish ×${m}`);
    assert.notEqual(model.relaxationThreshold(cons, 'construction_launch_per_kg', pv * (1 - 1e-6), m), null);
    assert.equal(model.relaxationThreshold(cons, 'construction_launch_per_kg', pv * (1 + 1e-6), m), null);
  }
  assert.equal(M.roundTo(model.thresholdVanishPrice(cons, 'construction_launch_per_kg', 1), 2), 2113.82);
  assert.equal(model.thresholdVanishPrice(cons, 'fixed_ops_M', 1), null);
  assert.equal(model.thresholdVanishPrice(cons, 'customer_price_per_kg', 1), Infinity);
});

test('refusals: other fibers, overflow; formatting stays exact above 1e21', () => {
  assert.equal(M.materialRefusal(params, 'pbo'), null);
  for (const k of ['uhmwpe', 'carbon', 'other']) {
    const r = M.materialRefusal(params, k);
    assert.equal(r.code, 'material_not_in_canon');
    assert.match(r.what, /materials\.primary_fiber = Zylon PBO/);
  }
  assert.match(M.materialRefusal(params, 'uhmwpe').what, /SK78/);
  assert.equal(M.firstNonFinite(M.quoteCard(model, ladder, 300, 1, 't')), null);
  assert.match(M.firstNonFinite(M.quoteCard(model, ladder, 1e308, 1, 't')), /fiber_purchase_M|effective|total_capex/);
  assert.notEqual(M.firstNonFinite(M.quoteCard(model, ladder, 300, 1e308, 't')), null);
  const big = 6.0913e299;
  assert.equal(M.thousands(big).replace(/,/g, ''), BigInt(big).toString());
  assert.ok(!/e/.test(M.thousands(big)) && !/e/.test(M.fixed(big, 1)));
  assert.equal(M.numberStr(-0), '0');
  assert.equal(M.money(-0.4), '$0M');
});

test('rev_a.json\'s cislunar breakeven keys (686, 517) fall out of the chain', () => {
  const cis = model.forTier(cons, 'cislunar_revenue_gated_option');
  const block = params.kinematics.cislunar_revenue_gated_option;
  assert.equal(Math.round(model.relaxationThreshold(cis, 'construction_launch_per_kg', 0, 1)), block.construction_launch_break_even_for_500_per_kg_customer_price);
  assert.equal(Math.round(model.breakevenCustomerPriceY15(Object.assign({}, cis, { construction_launch_per_kg: 800 }), 0, 1)), block.customer_price_break_even_at_800_per_kg_construction_launch_Y15);
});

test('monotone in price, and the refusal when rev_a has no price', () => {
  for (const s of M.tierRows(model, ladder)) {
    let prev = null;
    for (const p of [0, 1, 10, 100, 300, 1000, 3000, 10000]) {
      const r = model.summarize(s, p, 1);
      const pb = r.payback_year === null ? 999 : r.payback_year;
      if (prev) {
        assert.ok(pb >= prev.pb && r.npv_10pct_M <= prev.npv_10pct_M && r.breakeven_customer_price_y15 >= prev.breakeven_customer_price_y15, `${s.name} at ${p}`);
      }
      prev = { pb, npv_10pct_M: r.npv_10pct_M, breakeven_customer_price_y15: r.breakeven_customer_price_y15 };
    }
  }
  const ref0 = M.refusal(params);
  assert.equal(ref0.code, 'null_input');
  assert.match(ref0.what, /fiber_cost_per_kg is null/);
  assert.match(ref0.note, /WEAKEST INPUT/);
  assert.equal(M.refusal({ economics: { fiber_cost_per_kg: 300 } }), null);
  assert.equal(M.DEFAULT_PRICES[0], 0);
});

test('payback is on strictly positive cumulative cash (skyhook_finance.py:273): an all-zero flow never pays back', () => {
  const zero = Object.assign({}, cons, { customer_price_per_kg: 0, program_fleet_capex_M: 0, construction_launch_per_kg: 0, fixed_ops_M: 0, ops_wear_per_kg: 0, electricity_per_kwh: 0 });
  assert.deepEqual(model.netCashFlowsM(zero, 0, 1, 20), new Array(20).fill(0));
  assert.equal(model.paybackYear(zero, 0, 1), null);
  assert.equal(model.closes(zero, 0, 1), false);
});

test('data.js carries the snapshots unchanged (same bytes as the files beside it)', async () => {
  const crypto = await import('node:crypto');
  for (const name of ['rev_a.excerpt.json', 'ladder.json', 'markers.json']) {
    const sha = crypto.createHash('sha256').update(fs.readFileSync(path.join(here, 'snapshots', name))).digest('hex');
    assert.equal(pageData.snapshot_sha256[name], sha, name);
  }
  assert.deepEqual(pageData.ladder.columns, ladderJson.columns);
  assert.deepEqual(pageData.rev_a, params);
  assert.deepEqual(pageData.markers, markers);
  assert.equal(pageData.provenance['ladder.json'].commit.slice(0, 7), '34935cb');
  for (const v of Object.values(pageData.provenance)) assert.ok(v && v.commit, 'every snapshot has a sidecar');
  const appSrc = fs.readFileSync(path.join(here, 'app.js'), 'utf8').replace(/http:\/\/www\.w3\.org\/2000\/svg/g, '');
  assert.ok(!/fetch\(|XMLHttpRequest|import\(|https?:\/\//.test(appSrc), 'the page fetches nothing (the SVG namespace string is not a request)');
  assert.ok(!/<script[^>]+src=["']https?:/.test(fs.readFileSync(path.join(here, 'index.html'), 'utf8')), 'no external scripts');
});
