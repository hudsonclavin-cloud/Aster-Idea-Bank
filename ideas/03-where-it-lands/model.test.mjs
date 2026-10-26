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

test('launch outside [100, 3500] is refused with the grid\'s bounds in the message; NaN too', () => {
  const s = series('reference', 'Conservative');
  for (const L of [99.99, 3500.01, 7000, 0, -5, NaN, Infinity]) {
    const r = M.interpolate(G, s, 'delivered_total_per_kg', L);
    assert.equal(r.kind, 'refused', String(L));
    assert.equal(r.code, 'outside_axis');
    assert.match(r.reason, /outside the exported construction_launch_per_kg axis \[\$100, \$3,500\]; the grid does not extrapolate/);
    assert.equal(M.nearestNode(G, s, L).kind, 'refused');
    const rd = M.reading(G, R, L, { tier: 'reference', column: 'Conservative', launch: L, leg: 1000 });
    assert.equal(rd.kind, 'refused');
    assert.equal(rd.tier, 'reference');
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
    const info = M.tierInfo(R, t);
    if (c === 'Conservative') near(info.mass_ratio_30pct, s[0].mass_ratio_x, 0.005, `${t} tierInfo ratio`);
  }
  assert.equal(M.tierInfo(R, 'reference').v_tip_kms, R.kinematics.v_tip_kms);
  assert.equal(M.tierInfo(R, CIS).v_tip_kms, R.kinematics.cislunar_revenue_gated_option.v_tip_kms);
  assert.equal(M.tierInfo(R, P3).v_tip_kms, R.kinematics.phase3_growth_option.v_tip_kms);
  assert.equal(M.tierInfo(R, 'no_such_tier').kind, 'refused');
  // the workbook ladder's retention agrees with rev_a.json's conservative derate
  near(1 - R.materials.derate_fraction, M.columnInfo(L, 'Conservative').retention, 1e-12, 'retention vs derate');
  assert.equal(M.columnInfo(L, 'Conservative').label, 'Conservative · 30% derate');
  assert.equal(M.columnInfo(L, 'Baseline').label, 'Baseline · 15% derate');
  assert.equal(M.columnInfo(L, 'Optimistic').label, 'Optimistic · 0% derate');
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
  for (const leg of [299.99, 15000.01, NaN]) {
    const c = M.compose(G, leg, 400);
    assert.equal(c.kind, 'refused');
    assert.match(c.reason, /outside the exported leg_cost_per_kg axis \[\$300, \$15,000\]/);
  }
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
  assert.match(by.rideshare.refusal.reason, /\$7,000\/kg is outside the exported construction_launch_per_kg axis/);
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
test('a full reading at the Falcon 9 anchor, reference / Conservative: delivered $410.59, breakeven $595.34, stepped to the $3,255.04 node (payback year 18)', () => {
  const rd = M.reading(G, R, L, { tier: 'reference', column: 'Conservative', launch: 3245, leg: 1000 });
  assert.equal(rd.kind, 'reading');
  near(rd.delivered.value, 410.5947, 5e-4, 'delivered');
  near(rd.breakeven.value, 595.3366, 5e-4, 'breakeven');
  near(rd.plusLeg.value, 1410.5947, 5e-4, 'delivered + leg');
  assert.equal(rd.stepped.launch, 3255.04);
  assert.equal(rd.stepped.payback.value, 18);
  assert.equal(rd.stepped.npv_10pct_M, -4531.4698);
  assert.equal(rd.caveats.partialTier, null, 'the reference tier carries no partial-tier caveat');
  assert.equal(rd.caveats.comparability, G.comparability_warning);
  assert.match(rd.caveats.comparability, /NOT comparable/);
  assert.equal(rd.caveats.insurance, G.insurance_status);
  assert.equal(rd.customerPrice.value, 500);
  assert.equal(rd.customerPrice.row, 10);
  assert.ok(Math.abs(rd.breakeven.value / rd.delivered.value - 1.44) < 0.02, 'the two panes differ by roughly 44% at the conservative rung, as the warning says');
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
