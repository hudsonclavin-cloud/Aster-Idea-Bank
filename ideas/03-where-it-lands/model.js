// Where It Lands -- a pure reader of Skyhook's finance/decision_grid.json (schema 2.0.0).
//
// This module owns NO cost model. The only arithmetic it performs on grid fields is
//   (a) log-linear interpolation in construction_launch_per_kg, for exactly the fields the
//       grid's interpolation_fidelity block says were fidelity-tested, and
//   (b) the one composition rule the grid publishes (delivered_plus_leg = leg + delivered).
// Everything else (payback year, NPV, mass ratio, fibre mass, capex, the cost breakdown) is
// STEPPED to the nearest grid node and reported with that node's launch price. Anything the
// grid does not cover is a structured refusal, never a number.
//
// Loads as a classic script (window.WhereItLands) and via require() for the Node tests.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WhereItLands = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SCHEMA_VERSION = '2.0.0';
  const REQUIRED_META = [
    'schema_version', 'generated_at', 'git_commit', 'rev_a_md5', 'workbook_md5',
    'insurance_status', 'partial_tier_caveat', 'comparability_warning', 'composition_rules',
    'interpolation_max_rel_error', 'interpolation_fidelity', 'unvalidated_assumptions',
    'axes', 'notes', 'points',
  ];
  // The point fields this reader uses. Every point must carry them.
  const NUMBER_FIELDS = [
    'construction_launch_per_kg', 'delivered_total_per_kg', 'breakeven_price_per_kg',
    'npv_10pct_M', 'mass_ratio_x', 'fiber_mass_t', 'total_capex_M', 'system_capex_M',
    'amortized_capex_per_kg', 'fixed_ops_per_kg', 'ops_wear_insurance_per_kg',
    'reboost_electricity_per_kg', 'marginal_cost_per_kg',
  ];
  const INTERPOLATED = ['delivered_total_per_kg', 'breakeven_price_per_kg'];
  const LAUNCH = 'construction_launch_per_kg';
  const LEG = 'leg_cost_per_kg';
  const RULE_OUTPUT = 'delivered_plus_leg_per_kg';
  const REFERENCE_TIER = 'reference';

  // ------------------------------------------------------------------ refusals
  function refuse(code, reason, whatWouldHelp) {
    return { kind: 'refused', code, reason, what_would_help: whatWouldHelp };
  }
  const isRefused = (x) => !!x && x.kind === 'refused';
  const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

  // ------------------------------------------------------------------ validation
  // Returns { ok: true } or { ok: false, reasons: [...] }. A grid that fails is never read.
  function validateGrid(grid) {
    const reasons = [];
    if (!grid || typeof grid !== 'object' || Array.isArray(grid)) return { ok: false, reasons: ['not a JSON object'] };
    if (grid.schema_version !== SCHEMA_VERSION) {
      reasons.push(`schema_version is ${JSON.stringify(grid.schema_version)}, not "${SCHEMA_VERSION}"; this reader refuses to render points from another schema`);
    }
    for (const k of REQUIRED_META) if (!(k in grid)) reasons.push(`missing metadata key "${k}"`);
    if (reasons.length) return { ok: false, reasons };

    const la = grid.axes && grid.axes[LAUNCH];
    const le = grid.axes && grid.axes[LEG];
    if (!la || !isNum(la.min) || !isNum(la.max) || !(la.min < la.max) || la.spacing !== 'log' || la.role !== 'model_dimension') {
      reasons.push(`axes.${LAUNCH} must be a log-spaced model_dimension with min < max`);
    }
    if (!le || !isNum(le.min) || !isNum(le.max) || !(le.min < le.max) || le.role !== 'display_axis') {
      reasons.push(`axes.${LEG} must be a display_axis with min < max`);
    }
    const rule = Array.isArray(grid.composition_rules) && grid.composition_rules.find((r) => r && r.output === RULE_OUTPUT);
    if (!rule) reasons.push(`composition_rules has no rule with output "${RULE_OUTPUT}"`);
    else if (rule.operator !== 'add' || !Array.isArray(rule.operands) || rule.operands.length !== 2 ||
      !rule.operands.includes(LEG) || !rule.operands.includes('delivered_total_per_kg')) {
      reasons.push(`the ${RULE_OUTPUT} rule is not the published addition of ${LEG} and delivered_total_per_kg`);
    }
    const fid = grid.interpolation_fidelity && grid.interpolation_fidelity.fields;
    if (!fid || typeof fid !== 'object') reasons.push('interpolation_fidelity.fields is missing');
    else {
      for (const f of INTERPOLATED) {
        if (!fid[f] || !isNum(fid[f].max_rel_error)) reasons.push(`${f} has no interpolation_fidelity entry; it may not be interpolated`);
      }
    }
    if (!Array.isArray(grid.unvalidated_assumptions)) reasons.push('unvalidated_assumptions must be an array');
    if (!Array.isArray(grid.notes)) reasons.push('notes must be an array');
    if (!Array.isArray(grid.points) || !grid.points.length) reasons.push('points must be a non-empty array');
    if (reasons.length) return { ok: false, reasons };

    const seen = new Map();
    grid.points.forEach((p, i) => {
      if (!p || typeof p !== 'object') { reasons.push(`point ${i} is not an object`); return; }
      if (typeof p.tier !== 'string' || typeof p.column !== 'string') reasons.push(`point ${i} lacks string tier/column`);
      for (const f of NUMBER_FIELDS) if (!isNum(p[f])) reasons.push(`point ${i} (${p.tier}/${p.column}) field ${f} is not a finite number`);
      if (!(p.payback_year === null || (Number.isInteger(p.payback_year) && p.payback_year > 0))) {
        reasons.push(`point ${i} payback_year must be a positive integer or null`);
      }
      if (isNum(p[LAUNCH]) && (p[LAUNCH] < la.min || p[LAUNCH] > la.max)) reasons.push(`point ${i} launch ${p[LAUNCH]} is outside the declared axis`);
      const key = `${p.tier}|${p.column}`;
      if (!seen.has(key)) seen.set(key, new Set());
      const s = seen.get(key);
      if (s.has(p[LAUNCH])) reasons.push(`duplicate launch node ${p[LAUNCH]} in ${key}`);
      s.add(p[LAUNCH]);
    });
    if (reasons.length > 12) reasons.splice(12, reasons.length - 12, '...');
    if (reasons.length) return { ok: false, reasons };
    for (const [key, s] of seen) {
      if (isNum(la.n) && s.size !== la.n) reasons.push(`series ${key} has ${s.size} launch nodes, axis declares ${la.n}`);
    }
    if (!seen.has(`${REFERENCE_TIER}|${grid.points[0].column}`)) reasons.push(`no "${REFERENCE_TIER}" tier in the points`);
    return reasons.length ? { ok: false, reasons } : { ok: true };
  }

  // ------------------------------------------------------------------ indexing
  // Series are sorted by launch. Tiers keep "reference" first and the others in order of
  // first appearance; columns in order of first appearance (the exporter writes the ladder order).
  function indexGrid(grid) {
    const series = new Map();
    const tiers = [];
    const columns = [];
    for (const p of grid.points) {
      if (!tiers.includes(p.tier)) tiers.push(p.tier);
      if (!columns.includes(p.column)) columns.push(p.column);
      const key = `${p.tier}|${p.column}`;
      if (!series.has(key)) series.set(key, []);
      series.get(key).push(p);
    }
    for (const arr of series.values()) arr.sort((a, b) => a[LAUNCH] - b[LAUNCH]);
    tiers.sort((a, b) => (a === REFERENCE_TIER ? -1 : b === REFERENCE_TIER ? 1 : 0));
    const launchAxis = [...new Set(grid.points.map((p) => p[LAUNCH]))].sort((a, b) => a - b);
    return { series, tiers, columns, launchAxis, get: (tier, column) => series.get(`${tier}|${column}`) || null };
  }

  // ------------------------------------------------------------------ log axis helpers
  function axisFrac(axis, v) {
    return (Math.log(v) - Math.log(axis.min)) / (Math.log(axis.max) - Math.log(axis.min));
  }
  function axisValue(axis, frac) {
    return Math.exp(Math.log(axis.min) + frac * (Math.log(axis.max) - Math.log(axis.min)));
  }
  function onAxis(axis, v) {
    return isNum(v) && v >= axis.min && v <= axis.max;
  }
  function offAxisRefusal(axis, name, v) {
    return refuse('outside_axis',
      `$${fmt(v)}/kg is outside the exported ${name} axis [$${fmt(axis.min)}, $${fmt(axis.max)}]; the grid does not extrapolate`,
      `a grid exported with a wider ${name} axis (finance/export_grid.py sets the range)`);
  }

  // Bracketing nodes for launch L in a sorted series. Exact node => lo === hi.
  function bracket(series, L) {
    let lo = 0;
    let hi = series.length - 1;
    if (L === series[lo][LAUNCH]) return { i: lo, j: lo };
    if (L === series[hi][LAUNCH]) return { i: hi, j: hi };
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (series[mid][LAUNCH] === L) return { i: mid, j: mid };
      if (series[mid][LAUNCH] < L) lo = mid; else hi = mid;
    }
    return { i: lo, j: hi };
  }

  function interpolatableFields(grid) {
    return Object.keys(grid.interpolation_fidelity.fields);
  }

  // ------------------------------------------------------------------ (a) interpolation
  // Log-linear in launch, the method the grid declares and measured. Only for fields listed in
  // interpolation_fidelity.fields; anything else is refused (notes[4]: step payback and NPV).
  function interpolate(grid, series, field, L) {
    const allowed = interpolatableFields(grid);
    if (!allowed.includes(field)) {
      return refuse('not_interpolatable',
        `${field} was not interpolation-fidelity-tested in this grid (only ${allowed.join(', ')} were); it is stepped to the nearest node instead`,
        'an export whose interpolation_fidelity block covers this field');
    }
    const axis = grid.axes[LAUNCH];
    if (!onAxis(axis, L)) return offAxisRefusal(axis, LAUNCH, L);
    const { i, j } = bracket(series, L);
    const lo = series[i];
    const hi = series[j];
    const fidelity = grid.interpolation_fidelity.fields[field];
    if (i === j) {
      return { kind: 'node', field, value: lo[field], lo, hi: lo, w: 0, launch: L, max_rel_error: fidelity.max_rel_error };
    }
    const w = Math.log(L / lo[LAUNCH]) / Math.log(hi[LAUNCH] / lo[LAUNCH]);
    const value = lo[field] + w * (hi[field] - lo[field]);
    return { kind: 'interpolated', field, value, lo, hi, w, launch: L, method: grid.interpolation_fidelity.method, max_rel_error: fidelity.max_rel_error };
  }

  // Inverse of the interpolation for a strictly increasing field: the launch at which the
  // interpolated field equals `target`, or null when no bracketing pair exists. Used only to
  // draw iso-lines of the composed quantity on the plane; it introduces no new economics.
  function launchAtValue(grid, series, field, target) {
    if (!interpolatableFields(grid).includes(field)) return null;
    for (let k = 0; k + 1 < series.length; k++) {
      const a = series[k][field];
      const b = series[k + 1][field];
      if ((target >= a && target <= b) || (target <= a && target >= b)) {
        if (a === b) return series[k][LAUNCH];
        const w = (target - a) / (b - a);
        return Math.exp(Math.log(series[k][LAUNCH]) + w * Math.log(series[k + 1][LAUNCH] / series[k][LAUNCH]));
      }
    }
    return null;
  }

  // ------------------------------------------------------------------ stepping
  // Nearest node in LOG launch distance (the axis is log-spaced). An exact midpoint goes to the
  // lower node. Payback and NPV are integers / discounted aggregates; the grid says step them.
  function nearestNode(grid, series, L) {
    const axis = grid.axes[LAUNCH];
    if (!onAxis(axis, L)) return offAxisRefusal(axis, LAUNCH, L);
    const { i, j } = bracket(series, L);
    if (i === j) return { kind: 'node', node: series[i], index: i, distance_log: 0, exact: true };
    const dLo = Math.log(L) - Math.log(series[i][LAUNCH]);
    const dHi = Math.log(series[j][LAUNCH]) - Math.log(L);
    const k = dLo <= dHi ? i : j;
    return { kind: 'node', node: series[k], index: k, distance_log: Math.min(dLo, dHi), exact: false };
  }

  // The note that defines a null payback, quoted rather than retyped.
  function paybackText(grid, payback) {
    if (payback !== null) return { value: payback, text: `year ${payback}` };
    const note = grid.notes.find((n) => /payback_year is null/.test(n)) || '';
    const m = /within (\d+) years/.exec(note);
    return { value: null, text: m ? `not reached within ${m[1]} years` : 'not reached within the model window', note };
  }

  // ------------------------------------------------------------------ (b) composition
  // The one published rule. Read from the grid; refused if the grid's rule is not an addition
  // of the two named operands, so a changed rule can never be silently mis-applied.
  function compose(grid, leg, delivered) {
    const rule = grid.composition_rules.find((r) => r.output === RULE_OUTPUT);
    if (!rule || rule.operator !== 'add' || !rule.operands.includes(LEG) || !rule.operands.includes('delivered_total_per_kg')) {
      return refuse('unknown_rule', `the grid's ${RULE_OUTPUT} rule is not the published addition; this reader applies no other arithmetic`, 'a grid whose composition rule is "add" over leg_cost_per_kg and delivered_total_per_kg');
    }
    const axis = grid.axes[LEG];
    if (!onAxis(axis, leg)) return offAxisRefusal(axis, LEG, leg);
    if (!isNum(delivered)) return refuse('no_operand', 'delivered_total_per_kg is not available for this reading', 'a launch price on the exported axis');
    return { kind: 'composed', output: RULE_OUTPUT, value: leg + delivered, leg, delivered, expression: rule.expression, source: rule.leg_cost_per_kg_source };
  }

  // ------------------------------------------------------------------ labels from the other two snapshots
  // Tier tip speeds come only from rev_a.json (Rule 1). A tier the excerpt does not know is refused.
  function tierInfo(revA, tierKey) {
    const kin = revA && revA.kinematics;
    if (!kin) return refuse('no_rev_a', 'rev_a.json kinematics are not available', 'the params/rev_a.json excerpt');
    if (tierKey === REFERENCE_TIER) {
      return { key: tierKey, name: 'Reference', v_tip_kms: kin.v_tip_kms, confidence: '[Certain]', mass_ratio_30pct: revA.mass_ratio && revA.mass_ratio.integrated_tether_to_payload_both_arms.conservative_30pct_derate, note: kin._upper_release_note || '' };
    }
    const block = kin[tierKey];
    if (!block || typeof block !== 'object' || !isNum(block.v_tip_kms)) {
      return refuse('unknown_tier', `tier "${tierKey}" has no kinematics block in the rev_a.json excerpt; its tip speed cannot be labelled`, 'a rev_a.json that carries this tier');
    }
    const names = { cislunar_revenue_gated_option: 'Cislunar, revenue-gated', phase3_growth_option: 'Phase 3 growth' };
    return { key: tierKey, name: names[tierKey] || tierKey, v_tip_kms: block.v_tip_kms, confidence: block.confidence || '', mass_ratio_30pct: block.integrated_mass_ratio_30pct_derate_both_arms, note: block.note || '' };
  }

  function ladderValue(ladder, key, column) {
    const row = ladder && ladder.keys && ladder.rows && ladder.rows.find((r) => r.row === ladder.keys[key]);
    if (!row || !(column in row)) return null;
    return { value: row[column], parameter: row.parameter, row: row.row, note: row.note };
  }

  // Column label: retention from the workbook ladder; derate = 1 - retention (the repo's own
  // ScenarioInputs.derate_fraction definition). Refused if the ladder lacks the row or column.
  function columnInfo(ladder, column) {
    const r = ladderValue(ladder, 'strength_retention', column);
    if (!r || !isNum(r.value)) return refuse('unknown_column', `column "${column}" has no strength-retention row in the workbook ladder excerpt`, 'a ladder excerpt with this column');
    const derate = 1 - r.value;
    return { key: column, retention: r.value, derate, label: `${column} · ${Math.round(derate * 100)}% derate`, parameter: r.parameter, row: r.row };
  }

  // Launch-axis markers: rev_a.json economics anchors and the workbook's native launch prices.
  // Each says whether it sits on the exported axis; off-axis markers carry the refusal text.
  function markers(grid, revA, ladder) {
    const axis = grid.axes[LAUNCH];
    const out = [];
    const eco = (revA && revA.economics) || {};
    const push = (id, label, value, source, note) => {
      if (!isNum(value)) return;
      const on = onAxis(axis, value);
      out.push({ id, label, value, source, note: note || '', onAxis: on, refusal: on ? null : offAxisRefusal(axis, LAUNCH, value) });
    };
    push('f9', 'Falcon 9 dedicated anchor', eco.launch_price_anchor_dedicated_kgs, 'rev_a.json economics.launch_price_anchor_dedicated_kgs', eco._launch_price_note);
    push('marginal', 'SpaceX internal marginal', eco.spacex_internal_marginal_kgs, 'rev_a.json economics.spacex_internal_marginal_kgs', eco._marginal_note);
    push('rideshare', 'Rideshare', eco.launch_price_rideshare_kgs, 'rev_a.json economics.launch_price_rideshare_kgs', '');
    for (const col of (ladder && ladder.columns) || []) {
      const v = ladderValue(ladder, 'construction_launch_per_kg', col);
      if (v) push(`wb-${col}`, `Workbook ${col}`, v.value, `workbook Assumptions row ${v.row}: ${v.parameter}`, v.note);
    }
    return out;
  }

  // The lane multipliers, as TEXT. They are unvalidated internal assumptions (MP-001 section 2)
  // and this reader never multiplies anything by them; the values are stringified so a caller
  // cannot apply them by accident.
  function laneMultipliers(grid) {
    const text = (v) => (typeof v === 'number' && Number.isInteger(v) ? v.toFixed(1) : String(v));
    return grid.unvalidated_assumptions.map((a) => ({ name: a.name, valueText: text(a.value), note: a.note, applied: false }));
  }

  // ------------------------------------------------------------------ the reading
  // One call per UI state. Refuses as a whole when the launch is off-axis or the series is
  // unknown; carries a partial refusal for the leg when only the leg is off-axis.
  function reading(grid, revA, ladder, sel) {
    const idx = indexGrid(grid);
    const series = idx.get(sel.tier, sel.column);
    if (!series) return refuse('unknown_series', `no points for tier "${sel.tier}" and column "${sel.column}" in this grid`, 'one of: ' + [...idx.series.keys()].join(', '));
    const delivered = interpolate(grid, series, 'delivered_total_per_kg', sel.launch);
    if (isRefused(delivered)) return Object.assign({}, delivered, { tier: sel.tier, column: sel.column });
    const breakeven = interpolate(grid, series, 'breakeven_price_per_kg', sel.launch);
    const plusLeg = compose(grid, sel.leg, delivered.value);
    const near = nearestNode(grid, series, sel.launch);
    const node = near.node;
    const tier = tierInfo(revA, sel.tier);
    const column = columnInfo(ladder, sel.column);
    const customerPrice = ladderValue(ladder, 'customer_price_per_kg', sel.column);
    return {
      kind: 'reading',
      tier, column, launch: sel.launch, leg: sel.leg,
      delivered, breakeven, plusLeg,
      stepped: {
        launch: node[LAUNCH], exact: near.exact, index: near.index,
        payback: paybackText(grid, node.payback_year),
        npv_10pct_M: node.npv_10pct_M,
        mass_ratio_x: node.mass_ratio_x,
        fiber_mass_t: node.fiber_mass_t,
        total_capex_M: node.total_capex_M,
        system_capex_M: node.system_capex_M,
        breakdown: {
          amortized_capex_per_kg: node.amortized_capex_per_kg,
          fixed_ops_per_kg: node.fixed_ops_per_kg,
          ops_wear_insurance_per_kg: node.ops_wear_insurance_per_kg,
          reboost_electricity_per_kg: node.reboost_electricity_per_kg,
          delivered_total_per_kg: node.delivered_total_per_kg,
          marginal_cost_per_kg: node.marginal_cost_per_kg,
        },
        node,
      },
      customerPrice,
      caveats: {
        partialTier: sel.tier === REFERENCE_TIER ? null : grid.partial_tier_caveat,
        comparability: grid.comparability_warning,
        insurance: grid.insurance_status,
        amortYears: grid.amort_years_convention,
      },
    };
  }

  // Range of the composed quantity over the whole grid: used for one fixed colour scale.
  function composedRange(grid) {
    const axis = grid.axes[LEG];
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of grid.points) {
      lo = Math.min(lo, p.delivered_total_per_kg);
      hi = Math.max(hi, p.delivered_total_per_kg);
    }
    return { min: axis.min + lo, max: axis.max + hi };
  }

  // ------------------------------------------------------------------ formatting
  function fmt(v, decimals) {
    if (!isNum(v)) return '—';
    const d = decimals !== undefined ? decimals : Number.isInteger(v) ? 0 : Math.abs(v) >= 1000 ? 0 : Math.abs(v) >= 100 ? 1 : 2;
    return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function money(v, decimals) { return isNum(v) ? `$${fmt(v, decimals)}` : '—'; }
  function moneyM(v) {
    if (!isNum(v)) return '—';
    return (v < 0 ? '−$' : '$') + fmt(Math.abs(v), 0) + 'M';
  }

  return {
    SCHEMA_VERSION, INTERPOLATED, LAUNCH, LEG, RULE_OUTPUT, REFERENCE_TIER,
    validateGrid, indexGrid, axisFrac, axisValue, onAxis, bracket, interpolatableFields,
    interpolate, launchAtValue, nearestNode, paybackText, compose, tierInfo, columnInfo,
    ladderValue, markers, laneMultipliers, reading, composedRange, isRefused, fmt, money, moneyM,
  };
});
