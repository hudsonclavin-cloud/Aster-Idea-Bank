// Tests for the pure reader. Run from the bank root: node --test ideas/03-where-it-lands/model.test.mjs
// Node built-ins only. Pins: the snapshot's bytes to its provenance sidecar; the grid's numbers
// to params/rev_a.json (via the excerpt) and to the published workbook results in Skyhook's
// docs/DECISION_LOG.md item 6 and finance/SENSITIVITY_FINDINGS.md; the reader's one addition to
// Skyhook's own tests/test_export_grid.py; and the page/README text to what the code computes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const M = require(path.join(here, 'model.js'));
const G = require(path.join(here, 'snapshots', 'decision_grid.js'));
const R = require(path.join(here, 'snapshots', 'rev_a.excerpt.js'));
const L = require(path.join(here, 'snapshots', 'ladder.js'));
const side = (f) => JSON.parse(fs.readFileSync(path.join(here, 'snapshots', `${f}.provenance.json`), 'utf8'));
const SKYHOOK = process.env.SKYHOOK_DIR || '/home/user/skyhook';
const liveGrid = path.join(SKYHOOK, 'finance', 'decision_grid.json');
const idx = M.indexGrid(G);
const series = (t, c) => idx.get(t, c);
const CIS = 'cislunar_revenue_gated_option';
const P3 = 'phase3_growth_option';
const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`);
const clone = () => JSON.parse(JSON.stringify(G));

// ------------------------------------------------------------------ 1. the snapshot is what it says
test('embedded grid text is byte-identical to the file its sidecar hashes', () => {
  const js = fs.readFileSync(path.join(here, 'snapshots', 'decision_grid.js'), 'utf8');
  const a = js.indexOf('/*<json>*/') + '/*<json>*/'.length;
  const b = js.indexOf('/*</json>*/');
  assert.ok(a > 10 && b > a, 'markers present');
  const text = js.slice(a, b);
  const sc = side('decision_grid.js');
  assert.equal(sha256(text), sc.sourceSha256, 'sha256 of embedded text == sidecar sourceSha256');
  assert.equal(Buffer.byteLength(text, 'utf8'), sc.sourceBytes);
  assert.equal(G.__source.sourceSha256, sc.sourceSha256);
  assert.equal(G.__source.commit, sc.commit);
  assert.equal(sc.path, 'finance/decision_grid.json');
  assert.ok(sc.readMatchesCommitted, 'the bytes read were the committed blob');
  assert.deepEqual(JSON.parse(text), JSON.parse(JSON.stringify(G)), 'the parsed object is the embedded text (and __source is not enumerable)');
});

test('grid metadata: schema 2.0.0, built at 27229e2, 450 points over 3 tiers x 3 columns x 50 launch nodes', () => {
  assert.equal(G.schema_version, '2.0.0');
  assert.ok(G.git_commit.startsWith('27229e2'), G.git_commit);
  assert.equal(G.points.length, 450);
  assert.deepEqual(idx.tiers, ['reference', CIS, P3]);
  assert.deepEqual(idx.columns, ['Conservative', 'Baseline', 'Optimistic']);
  assert.equal(idx.launchAxis.length, 50);
  assert.equal(G.axes.construction_launch_per_kg.n, 50);
  assert.deepEqual([G.axes.construction_launch_per_kg.min, G.axes.construction_launch_per_kg.max], [100, 3500]);
  assert.deepEqual([G.axes.leg_cost_per_kg.min, G.axes.leg_cost_per_kg.max], [300, 15000]);
  assert.equal(G.axes.leg_cost_per_kg.role, 'display_axis');
  assert.equal(idx.launchAxis[0], 100);
  assert.equal(idx.launchAxis[49], 3500);
  // every interior node is the exporter's log-spaced value rounded to cents
  for (let i = 0; i < 50; i++) near(idx.launchAxis[i], Math.round(100 * Math.pow(35, i / 49) * 100) / 100, 1e-9, `node ${i}`);
});

test('the other two snapshots have sidecars at the same commit, and the grid was built from this rev_a.json', () => {
  for (const f of ['rev_a.excerpt.js', 'ladder.js']) {
    const sc = side(f);
    assert.equal(sc.commit, side('decision_grid.js').commit, `${f} commit`);
    assert.equal(sc.mode, 'derived');
  }
  assert.equal(side('rev_a.excerpt.js').path, 'params/rev_a.json');
  assert.equal(side('ladder.js').path, 'tools/financial/skyhook_financial_model.xlsx');
  assert.equal(R.__source.sourceSha256, side('rev_a.excerpt.js').sourceSha256);
  assert.equal(L.__source.sourceSha256, side('ladder.js').sourceSha256);
  assert.equal(R._meta.revision, 'Rev A');
});

test('live checkout (skipped if absent): the embedded grid equals finance/decision_grid.json and rev_a_md5 matches params/rev_a.json', (t) => {
  if (!fs.existsSync(liveGrid)) return t.skip(`no Skyhook checkout at ${SKYHOOK}`);
  const js = fs.readFileSync(path.join(here, 'snapshots', 'decision_grid.js'), 'utf8');
  const text = js.slice(js.indexOf('/*<json>*/') + 10, js.indexOf('/*</json>*/'));
  assert.equal(text, fs.readFileSync(liveGrid, 'utf8'));
  // finance/export_grid.py provenance_md5: text files are hashed with line endings normalised to LF
  const revA = fs.readFileSync(path.join(SKYHOOK, 'params', 'rev_a.json'), 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  assert.equal(crypto.createHash('md5').update(revA, 'utf8').digest('hex'), G.rev_a_md5);
  const live = JSON.parse(revA);
  for (const k of ['economics', 'kinematics', 'mass_ratio', 'materials', 'market_thresholds']) assert.deepEqual(R[k], live[k], `rev_a excerpt key ${k}`);
});

// ------------------------------------------------------------------ 2. validation refuses what it should
test('validateGrid accepts the snapshot and refuses other schemas, missing rules, bad points', () => {
  assert.deepEqual(M.validateGrid(G), { ok: true });
  let g = clone(); g.schema_version = '1.0.0';
  let v = M.validateGrid(g); assert.equal(v.ok, false); assert.match(v.reasons[0], /schema_version is "1\.0\.0"/);
  g = clone(); delete g.composition_rules;
  assert.match(M.validateGrid(g).reasons.join(), /missing metadata key "composition_rules"/);
  g = clone(); g.composition_rules[0].operator = 'multiply';
  assert.match(M.validateGrid(g).reasons.join(), /not the published addition/);
  g = clone(); delete g.interpolation_fidelity.fields.breakeven_price_per_kg;
  assert.match(M.validateGrid(g).reasons.join(), /breakeven_price_per_kg has no interpolation_fidelity entry/);
  g = clone(); delete g.points[7].delivered_total_per_kg;
  assert.match(M.validateGrid(g).reasons.join(), /point 7 .* delivered_total_per_kg is not a finite number/);
  g = clone(); g.points[3].payback_year = 12.5;
  assert.match(M.validateGrid(g).reasons.join(), /payback_year must be a positive integer or null/);
  g = clone(); g.points[0].construction_launch_per_kg = 99;
  assert.match(M.validateGrid(g).reasons.join(), /outside the declared axis/);
  g = clone(); g.points[1].construction_launch_per_kg = g.points[0].construction_launch_per_kg;
  assert.match(M.validateGrid(g).reasons.join(), /duplicate launch node/);
  g = clone(); g.points = g.points.slice(0, 49);
  assert.match(M.validateGrid(g).reasons.join(), /has 49 launch nodes, axis declares 50/);
  g = clone(); g.points = g.points.filter((p) => p.tier !== 'reference');
  assert.match(M.validateGrid(g).reasons.join(), /no "reference" tier/);
  assert.equal(M.validateGrid(null).ok, false);
  assert.equal(M.validateGrid([1, 2]).ok, false);
});

// ------------------------------------------------------------------ 3. interpolation: the declared method, only where declared
test('at every node both interpolated fields return the node value exactly (900 checks)', () => {
  let n = 0;
  for (const [, s] of idx.series) {
    for (const p of s) {
      for (const f of M.INTERPOLATED) {
        const r = M.interpolate(G, s, f, p.construction_launch_per_kg);
        assert.equal(r.kind, 'node');
        assert.equal(r.value, p[f]);
        n++;
      }
    }
  }
  assert.equal(n, 900);
});

test('at log midpoints w is 1/2 and the value is the neighbours\' mean; at log quarter points w is 1/4; values stay between neighbours', () => {
  for (const [, s] of idx.series) {
    for (let i = 0; i + 1 < s.length; i++) {
      const L0 = s[i].construction_launch_per_kg;
      const L1 = s[i + 1].construction_launch_per_kg;
      for (const f of M.INTERPOLATED) {
        const mid = M.interpolate(G, s, f, Math.sqrt(L0 * L1));
        assert.equal(mid.kind, 'interpolated');
        near(mid.w, 0.5, 1e-12, 'w at log midpoint');
        near(mid.value, (s[i][f] + s[i + 1][f]) / 2, 1e-9, `${f} midpoint`);
        const q = M.interpolate(G, s, f, L0 * Math.pow(L1 / L0, 0.25));
        near(q.w, 0.25, 1e-12, 'w at log quarter point');
        near(q.value, s[i][f] + 0.25 * (s[i + 1][f] - s[i][f]), 1e-9, `${f} quarter`);
        const lo = Math.min(s[i][f], s[i + 1][f]);
        const hi = Math.max(s[i][f], s[i + 1][f]);
        assert.ok(mid.value >= lo - 1e-9 && mid.value <= hi + 1e-9, 'between neighbours');
      }
    }
  }
});

test('the interpolatable set is read from the grid and is exactly the two fidelity-tested fields; everything else refuses', () => {
  assert.deepEqual(M.interpolatableFields(G).sort(), [...M.INTERPOLATED].sort());
  const s = series('reference', 'Conservative');
  for (const f of ['payback_year', 'npv_10pct_M', 'mass_ratio_x', 'total_capex_M', 'amortized_capex_per_kg']) {
    const r = M.interpolate(G, s, f, 1000);
    assert.equal(r.kind, 'refused');
    assert.equal(r.code, 'not_interpolatable');
    assert.match(r.reason, /stepped to the nearest node/);
  }
  // the grid's own fidelity metadata is internally consistent and within its enforced limit
  const fid = G.interpolation_fidelity;
  assert.equal(G.interpolation_max_rel_error, Math.max(...Object.values(fid.fields).map((x) => x.max_rel_error)));
  assert.ok(G.interpolation_max_rel_error <= fid.limit_enforced);
  assert.ok(G.interpolation_max_rel_error < 0.001, 'declared worst case under 0.1%');
  const r = M.interpolate(G, s, 'delivered_total_per_kg', 1000);
  assert.equal(r.max_rel_error, fid.fields.delivered_total_per_kg.max_rel_error);
});

test('launch outside [100, 3500] is refused, saying which end and printing the value as entered; a non-number is "nothing entered"', () => {
  const s = series('reference', 'Conservative');
  const cases = [
    [99.99, '$99.99/kg is below the minimum'], [0, '$0/kg is below the minimum'], [-5, '−$5/kg is below the minimum'],
    [1e-300, '$1.00e-300/kg is below the minimum'], [3500.001, '$3,500.001/kg is above the maximum'],
    [3500.01, '$3,500.01/kg is above the maximum'], [7000, '$7,000/kg is above the maximum'],
  ];
  for (const [launch, head] of cases) {
    const r = M.interpolate(G, s, 'delivered_total_per_kg', launch);
    assert.equal(r.kind, 'refused', String(launch));
    assert.equal(r.code, 'outside_axis');
    assert.ok(r.reason.startsWith(head), `${launch}: ${r.reason}`);
    assert.match(r.reason, / of the exported construction_launch_per_kg axis \[\$100, \$3,500\]; the grid does not extrapolate$/);
    assert.equal(M.nearestNode(G, s, launch).kind, 'refused');
    const rd = M.reading(G, R, L, { tier: 'reference', column: 'Conservative', launch, leg: 1000 });
    assert.equal(rd.code, 'outside_axis');
    assert.equal(rd.tier, 'reference');
  }
  for (const launch of [NaN, Infinity, -Infinity, undefined, '800']) {
    const r = M.interpolate(G, s, 'delivered_total_per_kg', launch);
    assert.equal(r.code, 'no_input', String(launch));
    assert.match(r.reason, /^no construction-launch price entered/);
    assert.match(r.what_would_help, /between \$100 and \$3,500 per kg/);
    assert.equal(M.reading(G, R, L, { tier: 'reference', column: 'Conservative', launch, leg: 1000 }).code, 'no_input');
  }
  assert.equal(M.interpolate(G, s, 'delivered_total_per_kg', 100).kind, 'node');
  assert.equal(M.interpolate(G, s, 'delivered_total_per_kg', 3500).kind, 'node');
});

test('launchAtValue inverts the interpolation (round trip to 1e-9 relative) on every series', () => {
  let n = 0;
  for (const [, s] of idx.series) {
    for (let k = 1; k < 40; k++) {
      const Lq = M.axisValue(G.axes.construction_launch_per_kg, k / 40);
      for (const f of M.INTERPOLATED) {
        const v = M.interpolate(G, s, f, Lq).value;
        const back = M.launchAtValue(G, s, f, v);
        near(back / Lq, 1, 1e-9, `${f} inverse`);
        n++;
      }
    }
    assert.equal(M.launchAtValue(G, s, 'delivered_total_per_kg', 1e9), null, 'no bracket -> null');
    assert.equal(M.launchAtValue(G, s, 'payback_year', 10), null, 'not interpolatable -> null');
  }
  assert.equal(n, 702);
});

// ------------------------------------------------------------------ 4. reconciliation to rev_a.json and the published workbook results
test('rev_a.json cislunar gate: payback is 15 at the $659.63 node and 16 at $709.27, bracketing the $686 breakeven launch', () => {
  const s = series(CIS, 'Conservative');
  const gate = R.kinematics.cislunar_revenue_gated_option.construction_launch_break_even_for_500_per_kg_customer_price;
  assert.equal(gate, 686);
  const { i, j } = M.bracket(s, gate);
  assert.equal(s[i].construction_launch_per_kg, 659.63);
  assert.equal(s[j].construction_launch_per_kg, 709.27);
  assert.equal(s[i].payback_year, 15);
  assert.equal(s[j].payback_year, 16);
  // ln(709.27/686) = 0.0334 < ln(686/659.63) = 0.0392, so the nearest node in log distance is the upper one
  assert.equal(M.nearestNode(G, s, gate).node.construction_launch_per_kg, 709.27, 'nearest node in log distance');
});

test('rev_a.json cislunar gate: interpolated Y15 breakeven price at $800 construction launch is $516.80, within 0.05% of the canon ~$517', () => {
  const s = series(CIS, 'Conservative');
  const canon = R.kinematics.cislunar_revenue_gated_option.customer_price_break_even_at_800_per_kg_construction_launch_Y15;
  assert.equal(canon, 517);
  const r = M.interpolate(G, s, 'breakeven_price_per_kg', 800);
  assert.equal(r.kind, 'interpolated');
  assert.equal(r.lo.construction_launch_per_kg, 762.65);
  assert.equal(r.hi.construction_launch_per_kg, 820.04);
  near(r.value, 516.80, 0.005, 'breakeven at $800');
  assert.ok(Math.abs(r.value - canon) / canon < 0.0005, `within 0.05% of ${canon}`);
});

test('mass ratios and fibre masses in the grid reproduce the rev_a.json integrated two-arm ladder for all three tiers', () => {
  const mr = R.mass_ratio.integrated_tether_to_payload_both_arms;
  const pins = [
    ['reference', 'Conservative', mr.conservative_30pct_derate, mr.conservative_30pct_fiber_mass_t],
    ['reference', 'Baseline', mr.baseline_15pct_derate, mr.baseline_15pct_fiber_mass_t],
    ['reference', 'Optimistic', mr.optimistic_0pct_derate, mr.optimistic_0pct_fiber_mass_t],
    [CIS, 'Conservative', mr.cislunar_2p8kms_30pct_derate, mr.cislunar_2p8kms_30pct_fiber_mass_t],
    [P3, 'Conservative', mr.phase3_3p5kms_30pct_derate, mr.phase3_3p5kms_30pct_fiber_mass_t],
  ];
  assert.equal(mr.conservative_30pct_derate, 121.83);
  for (const [t, c, ratio, fibre] of pins) {
    const s = series(t, c);
    const ratios = new Set(s.map((p) => p.mass_ratio_x));
    assert.equal(ratios.size, 1, `${t}/${c} mass ratio is launch-invariant`);
    near(s[0].mass_ratio_x, ratio, 0.005, `${t}/${c} mass ratio`);
    near(s[0].fiber_mass_t, fibre, 0.05, `${t}/${c} fibre mass`);
  }
  // the option tiers' kinematics blocks carry the same 30% rung as the mass_ratio block
  near(R.kinematics[CIS].integrated_mass_ratio_30pct_derate_both_arms, mr.cislunar_2p8kms_30pct_derate, 0, 'cislunar rung in both places');
  near(R.kinematics[P3].integrated_mass_ratio_30pct_derate_both_arms, mr.phase3_3p5kms_30pct_derate, 0, 'phase-3 rung in both places');
  assert.equal(M.tierInfo(R, 'reference').v_tip_kms, R.kinematics.v_tip_kms);
  assert.equal(M.tierInfo(R, CIS).v_tip_kms, R.kinematics.cislunar_revenue_gated_option.v_tip_kms);
  assert.equal(M.tierInfo(R, P3).v_tip_kms, R.kinematics.phase3_growth_option.v_tip_kms);
  assert.equal(M.tierInfo(R, 'no_such_tier').kind, 'refused');
  // the workbook ladder's retention agrees with rev_a.json's conservative derate
  near(1 - R.materials.derate_fraction, M.columnInfo(L, 'Conservative').retention, 1e-12, 'retention vs derate');
  assert.equal(M.columnInfo(L, 'Conservative').summary, 'whole ladder · derate 30%');
  assert.equal(M.columnInfo(L, 'Baseline').summary, 'whole ladder · derate 15%');
  assert.equal(M.columnInfo(L, 'Optimistic').summary, 'whole ladder · derate 0%');
  assert.equal(M.columnInfo(L, 'Pessimistic').kind, 'refused');
});

test('DECISION_LOG.md item 6 / SENSITIVITY_FINDINGS.md: the workbook\'s published results at its native launch prices lie between the bracketing grid nodes', () => {
  // docs/DECISION_LOG.md:47 — Conservative 121.83x / 609 t / $8,741M / payback ~Y17; Baseline $5,772M / Y9; Optimistic $4,226M / Y7
  // finance/SENSITIVITY_FINDINGS.md:10 — NPV@10% = -$3,883M for the Conservative case at $2,500/kg
  // docs/DECISION_LOG.md:51 — the conservative column's own launch price is $2,500/kg (workbook Assumptions B5)
  const published = { Conservative: { launch: 2500, capex: 8741, payback: 17, npv: -3883 }, Baseline: { launch: 1500, capex: 5772, payback: 9 }, Optimistic: { launch: 800, capex: 4226, payback: 7 } };
  for (const [col, pub] of Object.entries(published)) {
    assert.equal(M.ladderValue(L, 'construction_launch_per_kg', col).value, pub.launch, `${col} native launch in the ladder`);
    const s = series('reference', col);
    const { i, j } = M.bracket(s, pub.launch);
    assert.ok(i !== j, 'native launch is not itself a grid node');
    assert.equal(s[i].payback_year, pub.payback, `${col} payback at lower node`);
    assert.equal(s[j].payback_year, pub.payback, `${col} payback at upper node`);
    assert.ok(s[i].total_capex_M < pub.capex && pub.capex < s[j].total_capex_M, `${col} capex ${s[i].total_capex_M} < ${pub.capex} < ${s[j].total_capex_M}`);
    if (pub.npv !== undefined) assert.ok(s[j].npv_10pct_M < pub.npv && pub.npv < s[i].npv_10pct_M, `${col} NPV brackets ${pub.npv}`);
  }
  assert.equal(M.ladderValue(L, 'construction_launch_per_kg', 'Conservative').row, 5, 'workbook Assumptions row 5 (B5)');
  assert.equal(M.ladderValue(L, 'customer_price_per_kg', 'Conservative').value, 500);
  assert.match(M.ladderValue(L, 'construction_launch_per_kg', 'Conservative').parameter, /Launch price during construction/);
});

// ------------------------------------------------------------------ 5. the one addition
test('composition: delivered_plus_leg minus leg equals delivered to 1e-9 for legs 300 / 1,900 / 15,000 (as tests/test_export_grid.py checks), and off-axis legs refuse', () => {
  const s = series('reference', 'Conservative');
  for (const p of [s[0], s[25], s[49], series(P3, 'Conservative')[49]]) {
    for (const leg of [300, 1900, 15000]) {
      const c = M.compose(G, leg, p.delivered_total_per_kg);
      assert.equal(c.kind, 'composed');
      near(c.value - leg, p.delivered_total_per_kg, 1e-9, 'rule');
      assert.equal(c.expression, 'leg_cost_per_kg + delivered_total_per_kg');
    }
  }
  for (const [leg, head] of [[299.99, '$299.99/kg is below the minimum'], [15000.01, '$15,000.01/kg is above the maximum']]) {
    const c = M.compose(G, leg, 400);
    assert.equal(c.code, 'outside_axis');
    assert.ok(c.reason.startsWith(head), c.reason);
    assert.match(c.reason, / of the exported leg_cost_per_kg axis \[\$300, \$15,000\]/);
  }
  assert.equal(M.compose(G, NaN, 400).code, 'no_input');
  assert.match(M.compose(G, NaN, 400).reason, /^no rocket-leg price entered/);
  const g = clone(); g.composition_rules[0].operator = 'multiply';
  assert.equal(M.compose(g, 1000, 400).code, 'unknown_rule');
  const rd = M.reading(G, R, L, { tier: 'reference', column: 'Conservative', launch: 1000, leg: 20000 });
  assert.equal(rd.kind, 'reading', 'an off-axis leg refuses only the composed figure');
  assert.equal(rd.plusLeg.kind, 'refused');
  assert.equal(rd.delivered.kind, 'interpolated');
});

// ------------------------------------------------------------------ 6. stepping
test('nearest node is nearest in log distance; exact midpoints go to the lower node; null payback is quoted from notes', () => {
  const s = series('reference', 'Conservative');
  const L0 = s[10].construction_launch_per_kg;
  const L1 = s[11].construction_launch_per_kg;
  const mid = Math.sqrt(L0 * L1);
  assert.equal(M.nearestNode(G, s, L0).node, s[10]);
  assert.equal(M.nearestNode(G, s, L0).exact, true);
  assert.equal(M.nearestNode(G, s, mid).node, s[10], 'midpoint -> lower');
  assert.equal(M.nearestNode(G, s, mid * (1 + 1e-9)).node, s[11], 'just above -> upper');
  assert.equal(M.nearestNode(G, s, mid * (1 - 1e-9)).node, s[10], 'just below -> lower');
  assert.deepEqual(M.paybackText(G, 17), { value: 17, text: 'year 17' });
  const nul = M.paybackText(G, null);
  assert.equal(nul.text, 'not reached within 40 years');
  assert.match(nul.note, /^payback_year is null when payback does not arrive within 40 years\.$/);
  const p3 = series(P3, 'Conservative');
  const nulls = G.points.filter((p) => p.payback_year === null);
  assert.equal(nulls.length, 21);
  assert.ok(nulls.every((p) => p.tier === P3 && p.column === 'Conservative'), 'all nulls are phase-3 Conservative');
  assert.equal(p3[49].payback_year, null);
  const rd = M.reading(G, R, L, { tier: P3, column: 'Conservative', launch: 3500, leg: 300 });
  assert.equal(rd.stepped.payback.text, 'not reached within 40 years');
  assert.equal(rd.stepped.launch, 3500);
  // stepped values are the node's, never blended
  const rd2 = M.reading(G, R, L, { tier: 'reference', column: 'Conservative', launch: mid * 1.001, leg: 1000 });
  assert.equal(rd2.stepped.launch, L1);
  assert.equal(rd2.stepped.npv_10pct_M, s[11].npv_10pct_M);
  assert.equal(rd2.stepped.total_capex_M, s[11].total_capex_M);
  assert.equal(rd2.stepped.breakdown.ops_wear_insurance_per_kg, s[11].ops_wear_insurance_per_kg);
  near(rd2.stepped.breakdown.amortized_capex_per_kg + rd2.stepped.breakdown.fixed_ops_per_kg + rd2.stepped.breakdown.ops_wear_insurance_per_kg + rd2.stepped.breakdown.reboost_electricity_per_kg, rd2.stepped.breakdown.delivered_total_per_kg, 1e-3, 'the node\'s breakdown sums to its delivered total (rounded to 4 dp per field)');
});

// ------------------------------------------------------------------ 7. markers and multipliers
test('launch markers: rev_a.json anchors and workbook natives on the axis, rideshare $7,000 refused as off-axis', () => {
  const ms = M.markers(G, R, L);
  const by = Object.fromEntries(ms.map((m) => [m.id, m]));
  assert.equal(ms.length, 6);
  assert.equal(by.f9.value, R.economics.launch_price_anchor_dedicated_kgs);
  assert.equal(by.f9.value, 3245);
  assert.equal(by.f9.onAxis, true);
  assert.match(by.f9.note, /verify quarterly/);
  assert.equal(by.marginal.value, 629);
  assert.match(by.marginal.note, /Speculative/);
  assert.equal(by.rideshare.value, 7000);
  assert.equal(by.rideshare.onAxis, false);
  assert.match(by.rideshare.refusal.reason, /^\$7,000\/kg is above the maximum of the exported construction_launch_per_kg axis/);
  assert.deepEqual([by['wb-Conservative'].value, by['wb-Baseline'].value, by['wb-Optimistic'].value], [2500, 1500, 800]);
  assert.ok(ms.filter((m) => m.onAxis).length === 5);
});

test('lane multipliers are text with applied:false, and no multiplier literal appears in the code or the page', () => {
  const lanes = M.laneMultipliers(G);
  assert.deepEqual(lanes.map((a) => [a.name, a.valueText, a.applied]), [['lane_multiplier_GTO', '2.2', false], ['lane_multiplier_GEO', '3.5', false], ['lane_multiplier_CIS', '6.0', false]]);
  for (const a of lanes) assert.equal(typeof a.valueText, 'string');
  for (const f of ['model.js', 'app.js', 'index.html']) {
    const src = fs.readFileSync(path.join(here, f), 'utf8');
    const hits = src.match(/(?<![\d.\w])(2\.2|3\.5|6\.0)(?![\d])/g) || [];
    assert.deepEqual(hits, [], `${f} contains a lane-multiplier literal: ${hits.join(', ')}`);
    assert.ok(!/unvalidated_assumptions\[\d+\]\.value\s*\*/.test(src) && !/\*\s*unvalidated_assumptions/.test(src), `${f} multiplies by an unvalidated assumption`);
  }
  // no economic point field is ever multiplied or divided, in the model or the page (the launch
  // coordinate is divided inside the log-linear weight, which is the declared interpolation itself)
  const ECON = 'delivered_total_per_kg|breakeven_price_per_kg|payback_year|npv_10pct_M|mass_ratio_x|fiber_mass_t|total_capex_M|system_capex_M|amortized_capex_per_kg|fixed_ops_per_kg|ops_wear_insurance_per_kg|reboost_electricity_per_kg|marginal_cost_per_kg';
  const mulDiv = new RegExp(`(\\.|\\[')(${ECON})('\\])?\\s*[*/]|[*/]\\s*[\\w.]+(\\.|\\[')(${ECON})\\b|\\w+\\[(field|f)\\]\\s*[*/]|[*/]\\s*\\w+\\[(field|f)\\]`, 'g');
  for (const f of ['model.js', 'app.js']) {
    const src = fs.readFileSync(path.join(here, f), 'utf8');
    const hits = src.match(mulDiv) || [];
    assert.deepEqual(hits, [], `${f} multiplies or divides a grid field: ${hits.join(' | ')}`);
  }
});

// ------------------------------------------------------------------ 8. the reading as the page uses it
test('a full reading at the Falcon 9 anchor, reference / Conservative: breakeven $595.34 (delivered $410.59 in its own pane), NPV at the $3,255.04 node, payback year 17–18 between the nodes', () => {
  const rd = M.reading(G, R, L, { tier: 'reference', column: 'Conservative', launch: 3245, leg: 1000 });
  assert.equal(rd.kind, 'reading');
  near(rd.delivered.value, 410.5947, 5e-4, 'delivered');
  near(rd.breakeven.value, 595.3366, 5e-4, 'breakeven');
  near(rd.plusLeg.value, 1410.5947, 5e-4, 'delivered + leg');
  assert.equal(rd.stepped.launch, 3255.04);
  assert.equal(rd.stepped.payback.value, 18, 'the nearest node is year 18');
  assert.equal(rd.stepped.payback.text, 'year 17–18', 'but the $3,027.23 node is year 17, so the reading is the bracket');
  assert.equal(rd.stepped.payback.lo.launch, 3027.23);
  assert.equal(rd.stepped.npv_10pct_M, -4531.4698);
  assert.equal(rd.caveats.partialTier, null, 'the reference tier carries no partial-tier caveat');
  assert.equal(rd.caveats.comparability, G.comparability_warning);
  assert.match(rd.caveats.comparability, /NOT comparable/);
  assert.equal(rd.caveats.insurance, G.insurance_status);
  assert.equal(rd.customerPrice.value, 500);
  assert.equal(rd.customerPrice.row, 10);
  // The warning forbids setting the two against each other; this reader never divides one by the
  // other (the static test below would catch it), it only carries the warning's own words.
  assert.match(rd.caveats.comparability, /Do not display them as a cost and a price for the same scenario/);
  assert.match(rd.caveats.comparability, /do not compare delivered_total_per_kg to the customer price assumption/);
  const cis = M.reading(G, R, L, { tier: CIS, column: 'Baseline', launch: 1000, leg: 500 });
  assert.equal(cis.caveats.partialTier, G.partial_tier_caveat);
  assert.match(cis.caveats.partialTier, /^PARTIAL TIER MODEL/);
  assert.equal(M.reading(G, R, L, { tier: 'reference', column: 'Nope', launch: 1000, leg: 500 }).code, 'unknown_series');
  const range = M.composedRange(G);
  near(range.min, 363.6684, 1e-9, 'composed min'); near(range.max, 18833.8101, 1e-9, 'composed max');
});

test('README and page quote the numbers the code computes', () => {
  const readme = fs.readFileSync(path.join(here, 'README.md'), 'utf8');
  for (const s of ['516.80', '659.63', '709.27', '121.83', '27229e2', '34935cb', '410.59', '595.34', '0.0611', '$8,741M', '450 points']) {
    assert.ok(readme.includes(s), `README mentions ${s}`);
  }
  const html = fs.readFileSync(path.join(here, 'index.html'), 'utf8');
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.ok(!/https?:\/\//.test(html.replace(/<!--[\s\S]*?-->/g, '')) || !/<(script|link)[^>]+https?:\/\//.test(html), 'no external scripts or styles');
});

// ------------------------------------------------------------------ 9. Rule 1: tether numbers only from params/rev_a.json
test('mass ratio and fibre mass: shown as the rev_a.json value for the five published rungs, withheld for the four series rev_a.json does not publish', () => {
  const rungs = M.canonRungs(R);
  assert.deepEqual(rungs.map((r) => [r.v_tip_kms, r.derate, r.ratio_key]).sort(), [
    [2.5, 0, 'optimistic_0pct_derate'], [2.5, 0.15, 'baseline_15pct_derate'], [2.5, 0.3, 'conservative_30pct_derate'],
    [2.8, 0.3, 'cislunar_2p8kms_30pct_derate'], [3.5, 0.3, 'phase3_3p5kms_30pct_derate'],
  ].sort());
  const expected = {
    'reference|Conservative': ['canon', 121.83, 609.1], 'reference|Baseline': ['canon', 64.3, 321.5], 'reference|Optimistic': ['canon', 40.32, 201.6],
    [`${CIS}|Conservative`]: ['canon', 295.27, 1476.3], [`${CIS}|Baseline`]: ['not_in_canon'], [`${CIS}|Optimistic`]: ['not_in_canon'],
    [`${P3}|Conservative`]: ['canon', 3085.95, 15429.8], [`${P3}|Baseline`]: ['not_in_canon'], [`${P3}|Optimistic`]: ['not_in_canon'],
  };
  for (const [key, [status, ratio, fibre]] of Object.entries(expected)) {
    const [tier, column] = key.split('|');
    for (const launch of [100, 3245]) {
      const rd = M.reading(G, R, L, { tier, column, launch, leg: 1000 });
      const t = rd.stepped.tether;
      assert.equal(t.status, status, `${key} at ${launch}`);
      if (status === 'canon') {
        assert.equal(t.ratio.value, ratio, `${key} ratio is the canon value`);
        assert.equal(t.fibre.value, fibre, `${key} fibre is the canon value`);
        assert.equal(t.ratio.grid, rd.stepped.node.mass_ratio_x);
      } else {
        assert.equal(t.ratio.code, 'not_in_canon');
        assert.equal(t.fibre.code, 'not_in_canon');
        // the refusal never carries the grid's off-canon figure (440.40x for phase 3 / Optimistic)
        const g = rd.stepped.node.mass_ratio_x;
        assert.ok(!t.ratio.reason.includes(String(Math.floor(g))), `${key}: refusal must not quote ${g}`);
        assert.match(t.ratio.reason, /params\/rev_a\.json publishes no integrated mass ratio for \d\.\d km\/s at \d+% derate/);
      }
    }
  }
  near(series(P3, 'Optimistic')[0].mass_ratio_x, 440.3996, 1e-9, 'the off-canon figure DECISION_LOG item 1 traced is in the grid');
  // a grid that disagrees with canon beyond its printed precision is refused, not shown
  const g = clone();
  for (const p of g.points) if (p.tier === 'reference' && p.column === 'Conservative') p.mass_ratio_x = 121.84;
  const t = M.reading(g, R, L, { tier: 'reference', column: 'Conservative', launch: 1000, leg: 1000 }).stepped.tether;
  assert.equal(t.status, 'canon_conflict');
  assert.equal(t.ratio.code, 'canon_conflict');
  assert.equal(t.fibre.kind, 'canon');
});

// ------------------------------------------------------------------ 10. payback between nodes
test('payback is the bracket where the two nodes disagree: $686 cislunar gate reads year 15–16, $3,245 reference reads year 17–18; equal or exact nodes read one year', () => {
  const at = (tier, column, launch) => M.reading(G, R, L, { tier, column, launch, leg: 1000 }).stepped.payback;
  const gate = at(CIS, 'Conservative', 686);
  assert.equal(gate.text, 'year 15–16');
  assert.equal(gate.bracketed, true);
  assert.deepEqual([gate.lo.launch, gate.lo.value, gate.hi.launch, gate.hi.value], [659.63, 15, 709.27, 16]);
  assert.match(gate.detail, /year 15 at \$659\.63, year 16 at \$709\.27/);
  assert.equal(at('reference', 'Conservative', 3245).text, 'year 17–18');
  assert.equal(at('reference', 'Conservative', 3255.04).text, 'year 18', 'on a node: that node');
  assert.equal(at('reference', 'Conservative', 3255.04).bracketed, false);
  assert.equal(at('reference', 'Conservative', 2500).text, 'year 17', 'both nodes around $2,500 are year 17');
  // where one bracketing node is null the bracket says so in the grid's words
  const p3 = series(P3, 'Conservative');
  const k = p3.findIndex((p, i) => i > 0 && p.payback_year === null && p3[i - 1].payback_year !== null);
  const mid = Math.sqrt(p3[k - 1].construction_launch_per_kg * p3[k].construction_launch_per_kg);
  assert.equal(at(P3, 'Conservative', mid).text, `year ${p3[k - 1].payback_year} or not reached within 40 years`);
});

// ------------------------------------------------------------------ 11. labels the snapshots cannot give are refusals
test('a tier the rev_a.json excerpt cannot label, or a column the ladder cannot, refuses the whole reading', () => {
  const g = clone();
  for (const p of g.points) if (p.tier === P3) p.tier = 'mars_class_2027';
  assert.deepEqual(M.validateGrid(g), { ok: true }, 'the renamed grid is structurally valid');
  const rd = M.reading(g, R, L, { tier: 'mars_class_2027', column: 'Conservative', launch: 1000, leg: 1000 });
  assert.equal(rd.kind, 'refused');
  assert.equal(rd.code, 'unknown_tier');
  assert.match(rd.reason, /no kinematics block in the rev_a\.json excerpt/);
  assert.equal(rd.delivered, undefined, 'no number rides along with the refusal');
  const g2 = clone();
  for (const p of g2.points) if (p.column === 'Optimistic') p.column = 'Stretch';
  const rd2 = M.reading(g2, R, L, { tier: 'reference', column: 'Stretch', launch: 1000, leg: 1000 });
  assert.equal(rd2.code, 'unknown_column');
  assert.equal(M.reading(g2, R, L, { tier: 'reference', column: 'Baseline', launch: 1000, leg: 1000 }).kind, 'reading');
});

test('tier standing is read from rev_a.json, never typed: the reference is "Rev A reference" (_meta.revision), the options carry their block\'s confidence', () => {
  assert.equal(M.tierInfo(R, 'reference').standing, `${R._meta.revision} reference`);
  assert.equal(M.tierInfo(R, 'reference').standing, 'Rev A reference');
  assert.equal(M.tierInfo(R, CIS).standing, R.kinematics[CIS].confidence);
  assert.equal(M.tierInfo(R, P3).standing, '[Likely]');
  const src = fs.readFileSync(path.join(here, 'model.js'), 'utf8');
  assert.ok(!/['"`]\[(Certain|Likely|Speculative)\]['"`]/.test(src), 'model.js types no confidence label as a string literal');
});

test('a ladder column is the whole workbook column: 11 of its 14 rows differ between columns; customer price, payload and tip speed do not', () => {
  const lv = M.columnLevers(L, 'Conservative');
  assert.equal(lv.nRows, 14);
  assert.equal(lv.nDiffer, 11);
  assert.deepEqual(lv.rows.filter((r) => !r.differs).map((r) => r.row), [10, 12, 15]);
  assert.match(lv.rows.find((r) => r.row === 11).parameter, /cadence/);
  assert.deepEqual(['Conservative', 'Baseline', 'Optimistic'].map((c) => M.columnLevers(L, c).rows.find((r) => r.row === 11).value), [1, 2, 3]);
  assert.equal(M.columnLevers(L, 'Nope').code, 'unknown_column');
});

test('the partial-tier caveat splits into its sentences verbatim (first and last carried above the numbers) and applies whether or not the reading refuses', () => {
  const sum = M.partialTierSummary(G.partial_tier_caveat);
  assert.equal(sum.parts.join(' '), G.partial_tier_caveat, 'the parts are the text');
  assert.equal(sum.parts.length, 3);
  assert.match(sum.first, /^PARTIAL TIER MODEL: only tip speed is tier-specific/);
  assert.match(sum.last, /^Do NOT read a non-reference row as that tier's business case/);
  assert.equal(M.partialTierFor(G, 'reference'), null);
  assert.equal(M.partialTierFor(G, CIS), G.partial_tier_caveat);
  assert.equal(M.reading(G, R, L, { tier: CIS, column: 'Conservative', launch: 7000, leg: 1000 }).kind, 'refused');
  assert.equal(M.partialTierSummary(''), null);
});

test('the warning is honoured in the words: no "cost side" / "price side" on the page, and the README tagline sets a price beside a price, not delivered against breakeven', () => {
  const html = fs.readFileSync(path.join(here, 'index.html'), 'utf8');
  assert.ok(!/cost side|price side/i.test(html), 'index.html frames the panes as cost vs price');
  assert.match(html, /<h2 id="h-delivered">Delivered cost /);
  assert.match(html, /<h2 id="h-breakeven">Y15 breakeven price /);
  const tagline = fs.readFileSync(path.join(here, 'README.md'), 'utf8').split('\n').find((l) => l.startsWith('> '));
  assert.ok(tagline.includes('$595.34') && tagline.includes('$500/kg customer price'), 'breakeven beside the customer price');
  assert.ok(!/410\.59|delivered/i.test(tagline), 'the tagline keeps the delivered figure out');
});

// ------------------------------------------------------------------ 12. live checkout: Skyhook's own finance model, run read-only
// skyhook_live.py imports finance.export_grid with bytecode writing off and calls compute_cell /
// build_export; nothing is written. Skipped when there is no checkout or openpyxl is missing.
function live(args) {
  const r = spawnSync('python3', ['-B', '-I', path.join(here, 'skyhook_live.py'), '--skyhook', SKYHOOK, ...args], { encoding: 'utf8', timeout: 60000 });
  if (r.error || r.status === 2) return { skip: (r.error && r.error.message) || r.stdout.trim() };
  assert.equal(r.status, 0, `skyhook_live.py failed: ${r.stdout}${r.stderr}`);
  return JSON.parse(r.stdout);
}

test('live checkout: the grid rebuilt in memory from finance/export_grid.py equals the snapshot point for point (not stale)', (t) => {
  const out = live(['rebuild']);
  if (out.skip) return t.skip(out.skip);
  assert.equal(out.rebuilt_points, 450);
  assert.equal(out.committed_points, 450);
  assert.equal(out.missing_points, 0);
  assert.equal(out.field_diffs, 0, JSON.stringify(out.first_diffs));
  assert.deepEqual(out.meta_diffs, [], 'every metadata block but generated_at and git_commit rebuilds identically');
  assert.ok(out.rev_a_md5_equal && out.workbook_md5_equal);
});

test('live checkout: at all 441 interval midpoints of the nine series the page\'s interpolation is within the grid\'s declared worst case of the model itself', (t) => {
  const reqs = [];
  const mine = [];
  for (const [key, s] of idx.series) {
    const [tier, column] = key.split('|');
    for (let i = 0; i + 1 < s.length; i++) {
      const launch = Math.sqrt(s[i].construction_launch_per_kg * s[i + 1].construction_launch_per_kg);
      reqs.push([tier, column, launch]);
      mine.push(Object.fromEntries(M.INTERPOLATED.map((f) => [f, M.interpolate(G, s, f, launch).value])));
    }
  }
  const out = live(['cells', JSON.stringify(reqs)]);
  if (out.skip) return t.skip(out.skip);
  assert.equal(out.length, 441);
  for (const f of M.INTERPOLATED) {
    const errs = out.map((m, i) => Math.abs(mine[i][f] - m[f]) / Math.abs(m[f]));
    const worst = Math.max(...errs);
    const declared = G.interpolation_fidelity.fields[f].max_rel_error;
    assert.ok(worst <= declared * (1 + 1e-9), `${f}: worst ${worst} > declared ${declared}`);
    near(worst, declared, declared * 1e-9, `${f}: the declared worst case is attained (the exporter's probes include the worst interval)`);
  }
});

test('live checkout: the README\'s headline readings against compute_cell (model payback inside the page\'s bracket; NPV and capex between the bracketing nodes)', (t) => {
  const pts = [['reference', 'Conservative', 3245], [CIS, 'Conservative', 800], [CIS, 'Conservative', 686], ['reference', 'Conservative', 2500], ['reference', 'Baseline', 1500], ['reference', 'Optimistic', 800]];
  const out = live(['cells', JSON.stringify(pts)]);
  if (out.skip) return t.skip(out.skip);
  pts.forEach(([tier, column, launch], k) => {
    const m = out[k];
    const rd = M.reading(G, R, L, { tier, column, launch, leg: 1000 });
    for (const f of M.INTERPOLATED) {
      const page = f === 'delivered_total_per_kg' ? rd.delivered.value : rd.breakeven.value;
      assert.ok(Math.abs(page - m[f]) / m[f] <= G.interpolation_fidelity.fields[f].max_rel_error, `${tier}/${column}@${launch} ${f}: page ${page} model ${m[f]}`);
    }
    const s = series(tier, column);
    const { i, j } = M.bracket(s, launch);
    const yrs = [s[i].payback_year, s[j].payback_year];
    assert.ok(yrs.includes(m.payback_year), `${tier}/${column}@${launch}: model payback ${m.payback_year} within the nodes' ${yrs}`);
    assert.ok(rd.stepped.payback.text.includes(String(m.payback_year)), `the page's "${rd.stepped.payback.text}" contains the model's year ${m.payback_year}`);
    for (const f of ['npv_10pct_M', 'total_capex_M']) {
      const lo = Math.min(s[i][f], s[j][f]);
      const hi = Math.max(s[i][f], s[j][f]);
      assert.ok(m[f] >= lo && m[f] <= hi, `${tier}/${column}@${launch} ${f} ${m[f]} in [${lo}, ${hi}]`);
    }
  });
  assert.equal(out[0].payback_year, 18, 'at the $3,245 anchor itself the model says year 18');
  assert.equal(out[2].payback_year, 15, 'at the $686 gate itself the model says year 15, as rev_a.json does');
  near(out[2].breakeven_price_per_kg, 500, 0.05, 'the $686 gate is where the Y15 breakeven price is $500');
  near(out[3].total_capex_M, 8741.087, 1e-6, 'the workbook\'s $8,741M at its native $2,500');
  near(out[3].npv_10pct_M, -3882.5493, 1e-6, 'and NPV -$3,883M');
});
