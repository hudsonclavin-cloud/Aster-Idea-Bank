// Where It Lands -- a pure reader of Skyhook's finance/decision_grid.json (schema 2.0.0).
//
// This module owns NO cost model. The only arithmetic it performs on grid fields is
//   (a) log-linear interpolation in construction_launch_per_kg, for exactly the fields the
//       grid's interpolation_fidelity block says were fidelity-tested, and
//   (b) the one composition rule the grid publishes (delivered_plus_leg = leg + delivered).
// Everything else (NPV, capex, the cost breakdown) is STEPPED to the nearest grid node and
// reported with that node's launch price; payback is that node's year, or the bracket of the two
// bracketing nodes' years where they disagree. Mass ratio and fibre mass are shown only where
// params/rev_a.json publishes the rung (Rule 1), and then as the canon value. Anything the grid or
// the canon does not cover is a structured refusal, never a number.
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

  // -- refusals
  function refuse(code, reason, whatWouldHelp) {
    return { kind: 'refused', code, reason, what_would_help: whatWouldHelp };
  }
  const isRefused = (x) => !!x && x.kind === 'refused';
  const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

  // -- validation
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

  // -- indexing
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

  // -- log axis helpers
  function axisFrac(axis, v) {
    return (Math.log(v) - Math.log(axis.min)) / (Math.log(axis.max) - Math.log(axis.min));
  }
  function axisValue(axis, frac) {
    return Math.exp(Math.log(axis.min) + frac * (Math.log(axis.max) - Math.log(axis.min)));
  }
  function onAxis(axis, v) {
    return isNum(v) && v >= axis.min && v <= axis.max;
  }
  const AXIS_WORDS = { construction_launch_per_kg: 'construction-launch price', leg_cost_per_kg: 'rocket-leg price' };
  // An input that is not a finite number is "nothing entered", not a position off the axis.
  // A finite value off the axis says which end it fell off, and prints the value as entered
  // (never rounded onto the bound it missed: 3500.001 stays 3,500.001, 299.99 stays 299.99).
  function offAxisRefusal(axis, name, v) {
    const words = AXIS_WORDS[name] || name;
    if (!isNum(v)) {
      return refuse('no_input', `no ${words} entered: the box is empty or not a finite number`,
        `a ${words} between $${fmt(axis.min)} and $${fmt(axis.max)} per kg (type it, use the slider or tap an anchor)`);
    }
    const side = v < axis.min ? 'below the minimum' : 'above the maximum';
    return refuse('outside_axis',
      `${v < 0 ? '−$' : '$'}${fmtInput(Math.abs(v))}/kg is ${side} of the exported ${name} axis [$${fmt(axis.min)}, $${fmt(axis.max)}]; the grid does not extrapolate`,
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

  // -- (a) interpolation
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

  // Inverse of the interpolation (launch where the field equals `target`, else null); used only
  // to draw iso-cost lines.
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

  // -- stepping
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

  // Payback between nodes. One node's integer is honest only when both bracketing nodes agree;
  // where they disagree (the $686 cislunar gate sits between a year-15 and a year-16 node) the
  // reading is the bracket, which is what "round or step it" allows without inventing a year.
  // `value` stays the nearest node's (the stepped chart draws that step).
  function paybackReading(grid, series, L, near) {
    const nearest = paybackText(grid, near.node.payback_year);
    const { i, j } = bracket(series, L);
    if (i === j || series[i].payback_year === series[j].payback_year) return Object.assign({ bracketed: false }, nearest);
    const lo = { launch: series[i][LAUNCH], ...paybackText(grid, series[i].payback_year) };
    const hi = { launch: series[j][LAUNCH], ...paybackText(grid, series[j].payback_year) };
    const text = lo.value !== null && hi.value !== null
      ? `year ${Math.min(lo.value, hi.value)}–${Math.max(lo.value, hi.value)}`
      : `${lo.text} or ${hi.text}`;
    return {
      value: nearest.value, text, bracketed: true, lo, hi, note: nearest.note || lo.note || hi.note,
      detail: `the bracketing nodes disagree: ${lo.text} at $${fmt(lo.launch, 2)}, ${hi.text} at $${fmt(hi.launch, 2)}; the grid cannot say which applies between them`,
    };
  }

  // -- (b) composition
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

  // -- labels from the other two snapshots
  // Tip speeds and standing (_meta.revision, or the block's confidence) only from rev_a.json
  // (Rule 1). An unknown tier is refused, and reading() refuses its series with it.
  function tierInfo(revA, tierKey) {
    const kin = revA && revA.kinematics;
    if (!kin) return refuse('no_rev_a', 'rev_a.json kinematics are not available', 'the params/rev_a.json excerpt');
    if (tierKey === REFERENCE_TIER) {
      if (!isNum(kin.v_tip_kms)) return refuse('unknown_tier', 'the rev_a.json excerpt has no kinematics.v_tip_kms for the reference tier', 'a rev_a.json with the reference tip speed');
      const revision = revA._meta && revA._meta.revision;
      return {
        key: tierKey, name: 'Reference', v_tip_kms: kin.v_tip_kms,
        standing: revision ? `${revision} reference` : 'reference', standingSource: 'rev_a.json _meta.revision and kinematics.v_tip_kms',
        note: kin._upper_release_note || '',
      };
    }
    const block = kin[tierKey];
    if (!block || typeof block !== 'object' || !isNum(block.v_tip_kms)) {
      return refuse('unknown_tier', `tier "${tierKey}" has no kinematics block in the rev_a.json excerpt, so its tip speed cannot be labelled and its numbers are not shown`, 'a rev_a.json that carries this tier (Rule 1: tier tip speeds come only from params/rev_a.json)');
    }
    const names = { cislunar_revenue_gated_option: 'Cislunar, revenue-gated', phase3_growth_option: 'Phase 3 growth' };
    return {
      key: tierKey, name: names[tierKey] || tierKey, v_tip_kms: block.v_tip_kms,
      standing: block.confidence || 'no confidence label', standingSource: `rev_a.json kinematics.${tierKey}.confidence`,
      note: block.note || '',
    };
  }

  function ladderValue(ladder, key, column) {
    const row = ladder && ladder.keys && ladder.rows && ladder.rows.find((r) => r.row === ladder.keys[key]);
    if (!row || !(column in row)) return null;
    return { value: row[column], parameter: row.parameter, row: row.row, note: row.note };
  }

  // derate = 1 - workbook retention (ScenarioInputs.derate_fraction). A column is the WHOLE
  // ladder column, so the label says so; refused if the ladder lacks it.
  function columnInfo(ladder, column) {
    const r = ladderValue(ladder, 'strength_retention', column);
    if (!r || !isNum(r.value)) return refuse('unknown_column', `column "${column}" has no strength-retention row in the workbook ladder excerpt, so its derate cannot be labelled and its numbers are not shown`, 'a ladder excerpt with this column');
    const derate = 1 - r.value;
    return { key: column, retention: r.value, derate, label: column, summary: `whole ladder · derate ${Math.round(derate * 100)}%`, parameter: r.parameter, row: r.row };
  }

  // Every Assumptions row for one column, and which rows differ across the columns at all.
  // Read row by row from the ladder excerpt; nothing here is typed in.
  function columnLevers(ladder, column) {
    if (!ladder || !Array.isArray(ladder.rows) || !Array.isArray(ladder.columns) || !ladder.columns.includes(column)) {
      return refuse('unknown_column', `column "${column}" is not in the workbook ladder excerpt`, 'a ladder excerpt with this column');
    }
    const cols = ladder.columns;
    const rows = ladder.rows.map((r) => ({ row: r.row, parameter: r.parameter, value: r[column], note: r.note, differs: cols.some((c) => r[c] !== r[cols[0]]) }));
    return { column, rows, nDiffer: rows.filter((r) => r.differs).length, nRows: rows.length, range: ladder.range, sheet: ladder.sheet };
  }

  // -- tether numbers and Rule 1
  // The integrated two-arm mass-ratio rungs params/rev_a.json publishes, read from the key names
  // of mass_ratio.integrated_tether_to_payload_both_arms: "<stem>_<N>pct_derate" with its
  // "<stem>_<N>pct_fiber_mass_t" partner. A stem ending "_<a>p<b>kms" is at tip speed a.b km/s;
  // any other stem (conservative / baseline / optimistic) is at the block's reference_v_tip_kms.
  function canonRungs(revA) {
    const block = revA && revA.mass_ratio && revA.mass_ratio.integrated_tether_to_payload_both_arms;
    if (!block || typeof block !== 'object') return [];
    const out = [];
    for (const k of Object.keys(block)) {
      const m = /^(.+)_(\d+)pct_derate$/.exec(k);
      if (!m || !isNum(block[k])) continue;
      const sp = /_(\d+)p(\d+)kms$/.exec(m[1]);
      const vTip = sp ? Number(`${sp[1]}.${sp[2]}`) : block.reference_v_tip_kms;
      if (!isNum(vTip)) continue;
      const fibreKey = `${m[1]}_${m[2]}pct_fiber_mass_t`;
      out.push({ v_tip_kms: vTip, derate: Number(m[2]) / 100, ratio_key: k, ratio: block[k], fibre_key: fibreKey, fibre: isNum(block[fibreKey]) ? block[fibreKey] : null });
    }
    return out;
  }
  // Half a unit in the last decimal the canon prints: 121.83 -> 0.005, 609.1 -> 0.05.
  function halfLastDigit(v) {
    const dec = (String(v).split('.')[1] || '').length;
    return 0.5 * Math.pow(10, -dec) + 1e-9;
  }
  // Rule 1: where rev_a.json publishes the rung (tip speed and derate match) and the grid agrees
  // to the canon's printed precision, the CANON value is shown; otherwise a structured refusal.
  function tetherCanon(revA, tier, column, node) {
    const rungs = canonRungs(revA);
    const rung = rungs.find((r) => Math.abs(r.v_tip_kms - tier.v_tip_kms) < 1e-9 && Math.abs(r.derate - column.derate) < 1e-9);
    const where = `${tier.v_tip_kms} km/s at ${Math.round(column.derate * 100)}% derate`;
    if (!rung) {
      const published = rungs.map((r) => `${r.v_tip_kms} km/s at ${Math.round(r.derate * 100)}%`).join('; ');
      const r = refuse('not_in_canon',
        `params/rev_a.json publishes no integrated mass ratio for ${where}; the grid carries a finance-model output for this series, which is not Rule 1 canon, so it is not shown here`,
        `a params/rev_a.json rung for ${where} (it publishes: ${published})`);
      return { status: 'not_in_canon', ratio: r, fibre: r, rung: null };
    }
    const one = (gridV, canonV, key, unit) => {
      if (!isNum(canonV)) return refuse('not_in_canon', `params/rev_a.json has no ${key}`, `a params/rev_a.json ${key} value`);
      if (Math.abs(gridV - canonV) > halfLastDigit(canonV)) {
        return refuse('canon_conflict', `the grid's ${fmt(gridV, 4)}${unit} disagrees with params/rev_a.json ${key} = ${canonV}${unit} beyond the canon's printed precision; neither is shown as the reading`, 'a grid rebuilt from the current params/rev_a.json');
      }
      return { kind: 'canon', value: canonV, key, grid: gridV };
    };
    const ratio = one(node.mass_ratio_x, rung.ratio, rung.ratio_key, '×');
    const fibre = one(node.fiber_mass_t, rung.fibre, rung.fibre_key, ' t');
    return { status: isRefused(ratio) || isRefused(fibre) ? 'canon_conflict' : 'canon', ratio, fibre, rung };
  }

  // The partial-tier caveat split into its sentences, verbatim (joining the parts gives it back).
  function partialTierSummary(text) {
    if (typeof text !== 'string' || !text) return null;
    const parts = text.split(/(?<=\.)\s+(?=[A-Z])/);
    return { first: parts[0], last: parts.length > 1 ? parts[parts.length - 1] : '', parts, full: text };
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

  // The lane multipliers as TEXT (unvalidated, MP-001 section 2), so nothing can apply them.
  function laneMultipliers(grid) {
    const text = (v) => (typeof v === 'number' && Number.isInteger(v) ? v.toFixed(1) : String(v));
    return grid.unvalidated_assumptions.map((a) => ({ name: a.name, valueText: text(a.value), note: a.note, applied: false }));
  }

  // -- the reading
  // One call per UI state. Refuses as a whole when the series is unknown, when its tier or column
  // cannot be labelled from the rev_a.json / ladder snapshots, or when the launch is off-axis or
  // missing; carries a partial refusal for the leg when only the leg is off-axis or missing.
  function reading(grid, revA, ladder, sel) {
    const idx = indexGrid(grid);
    const series = idx.get(sel.tier, sel.column);
    const tag = (r) => Object.assign({}, r, { tier: sel.tier, column: sel.column });
    if (!series) return tag(refuse('unknown_series', `no points for tier "${sel.tier}" and column "${sel.column}" in this grid`, 'one of: ' + [...idx.series.keys()].join(', ')));
    const tier = tierInfo(revA, sel.tier);
    if (isRefused(tier)) return tag(tier);
    const column = columnInfo(ladder, sel.column);
    if (isRefused(column)) return tag(column);
    const delivered = interpolate(grid, series, 'delivered_total_per_kg', sel.launch);
    if (isRefused(delivered)) return tag(delivered);
    const breakeven = interpolate(grid, series, 'breakeven_price_per_kg', sel.launch);
    const plusLeg = compose(grid, sel.leg, delivered.value);
    const near = nearestNode(grid, series, sel.launch);
    const node = near.node;
    const customerPrice = ladderValue(ladder, 'customer_price_per_kg', sel.column);
    return {
      kind: 'reading',
      tier, column, launch: sel.launch, leg: sel.leg,
      delivered, breakeven, plusLeg,
      stepped: {
        launch: node[LAUNCH], exact: near.exact, index: near.index,
        payback: paybackReading(grid, series, sel.launch, near),
        npv_10pct_M: node.npv_10pct_M,
        tether: tetherCanon(revA, tier, column, node),
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
        partialTier: partialTierFor(grid, sel.tier),
        comparability: grid.comparability_warning,
        insurance: grid.insurance_status,
        amortYears: grid.amort_years_convention,
      },
    };
  }

  // Every tier but the reference carries the caveat, refused reading or not.
  function partialTierFor(grid, tierKey) {
    return tierKey === REFERENCE_TIER ? null : grid.partial_tier_caveat;
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

  // -- formatting
  function fmt(v, decimals) {
    if (!isNum(v)) return '—';
    const d = decimals !== undefined ? decimals : Number.isInteger(v) ? 0 : Math.abs(v) >= 1000 ? 0 : Math.abs(v) >= 100 ? 1 : 2;
    return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  // A value as the person entered it: grouped, up to six decimals, never rounded onto an axis
  // bound; a tiny non-zero value in exponent form rather than "0.00".
  function fmtInput(v) {
    if (!isNum(v)) return String(v);
    if (v !== 0 && Math.abs(v) < 1e-6) return v.toPrecision(3);
    return v.toLocaleString('en-US', { maximumFractionDigits: 6 });
  }
  function money(v, decimals) { return isNum(v) ? `$${fmt(v, decimals)}` : '—'; }
  function moneyM(v) {
    if (!isNum(v)) return '—';
    return (v < 0 ? '−$' : '$') + fmt(Math.abs(v), 0) + 'M';
  }

  return {
    SCHEMA_VERSION, INTERPOLATED, LAUNCH, LEG, RULE_OUTPUT, REFERENCE_TIER,
    validateGrid, indexGrid, axisFrac, axisValue, onAxis, bracket, interpolatableFields,
    interpolate, launchAtValue, nearestNode, paybackText, paybackReading, compose, tierInfo, columnInfo,
    columnLevers, canonRungs, tetherCanon, partialTierSummary, partialTierFor,
    ladderValue, markers, laneMultipliers, reading, composedRange, isRefused, fmt, fmtInput, money, moneyM,
  };
});
