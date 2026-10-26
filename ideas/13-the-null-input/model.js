// model.js — the JavaScript port of fiber_sweep.py's finance chain, for index.html.
//
// Loads as a classic script (window.NullInputModel) and via require() for the Node tests. It mirrors
// finance/skyhook_finance.py @ 34935cb line for line (capex 15/30/35/20 over Y1-4, ops from Y5 with the
// ramp_y1 / min(1, ramp_y1 + 0.3) / 1.0 ramp, 15-year NPV and breakeven window, payback searched to Y40),
// adds the fiber PURCHASE line the Python model does not have (price × multiplier × fiber kg, no hardware
// mass factor), and reproduces finance/sensitivity.py's bisection thresholds. model.test.mjs reconciles
// every number against reference.json, which fiber_sweep.py --json wrote. Nothing here is a default
// fiber price: the page refuses to print a fiber line until a price is typed.
//
// Confidence labels follow the Skyhook convention. [Certain as mirror] marks a formula copied from the
// repository's module; the schedule itself is the workbook's planning assumption.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NullInputModel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ── Conventions mirrored from finance/skyhook_finance.py [Certain as mirror] ─────────────────
  const CAPEX_SPREAD = [0.15, 0.30, 0.35, 0.20];
  const OPS_START_YEAR = 5;
  const RAMP_STEP = 0.3;
  const WINDOW_YEARS = 15;
  const MAX_PAYBACK_SEARCH = 40;
  const R_EARTH_KM = 6371.0; // physics/skyhook_physics.py:40
  const COLUMNS = ['Conservative', 'Baseline', 'Optimistic'];
  const DEFAULT_PRICES = [0, 10, 30, 100, 300, 1000, 3000];
  const BISECT_ITERS = 80;
  const MAX_STRETCH = 5.0;
  const STOP_PRICE_CAP = 20000;
  const LADDER_KEYS = ['strength_retention', 'ascent_losses_ms', 'construction_launch_per_kg', 'power_chain_efficiency',
    'electricity_per_kwh', 'ops_wear_per_kg', 'hardware_mass_factor', 'customer_price_per_kg', 'catches_per_day',
    'payload_kg', 'revenue_ramp_y1', 'fixed_ops_M', 'tip_speed_kms', 'program_fleet_capex_M'];

  // The eight sensitivity inputs: [label, direction that improves the case] (sensitivity.py:45-54).
  const INPUTS = {
    customer_price_per_kg: ['Customer price ($/kg)', 'up'],
    construction_launch_per_kg: ['Construction launch ($/kg)', 'down'],
    catches_per_day: ['Cadence (catches/day)', 'up'],
    payload_kg: ['Payload per catch (kg)', 'up'],
    derate_fraction: ['Fiber strength derate (fraction)', 'down'],
    hardware_mass_factor: ['Hardware mass factor (x)', 'down'],
    program_fleet_capex_M: ['Program+fleet capex ($M)', 'down'],
    fixed_ops_M: ['Fixed annual ops ($M)', 'down'],
  };
  const SHORT = {
    customer_price_per_kg: 'price', construction_launch_per_kg: 'launch', catches_per_day: 'cadence',
    payload_kg: 'payload', derate_fraction: 'derate', hardware_mass_factor: 'hw factor',
    program_fleet_capex_M: 'prog capex', fixed_ops_M: 'fixed ops',
  };
  const TIER_SHORT = { cislunar_revenue_gated_option: 'Cislunar', phase3_growth_option: 'Phase 3' };
  // The fiber a quote is for (fiber_sweep.MATERIALS). Every mass here is rev_a's Zylon PBO EQ-6 mass;
  // docs/outreach_log.md:5-17 and :27-29 (snapshotted) say which fiber each outstanding ask is for.
  const MATERIALS = {
    pbo: 'Zylon PBO (the Toyobo and Avient asks)',
    uhmwpe: 'UHMWPE / Dyneema (the FibrXL SK78 ask)',
    carbon: 'carbon fiber (the Toray T1100G ask, retired on 31 Aug)',
    other: 'a fiber other than Zylon PBO',
  };

  // ── erf: JavaScript has none. Maclaurin series below 3 (terms peak near e^{x²} ≈ 8,100 at x = 3, so
  // about 1e-12 relative is kept), continued fraction for erfc above. The Rev A domain is x in
  // [1.45, 2.43]; model.test.mjs checks both branches against tabulated values. ─────────────────
  function erf(x) {
    if (x < 0) return -erf(-x);
    if (x === 0) return 0;
    if (x < 3) {
      const x2 = x * x;
      let sum = x;
      let term = x;
      for (let n = 1; n < 400; n++) {
        term *= -x2 / n;
        const add = term / (2 * n + 1);
        sum += add;
        if (Math.abs(add) < 1e-17 * Math.abs(sum)) break;
      }
      return (2 / Math.sqrt(Math.PI)) * sum;
    }
    // erfc(x) = e^{-x²}/√π · 1/(x + (1/2)/(x + 1/(x + (3/2)/(x + 2/(x + …))))), evaluated backwards.
    let f = x;
    for (let n = 60; n >= 1; n--) f = x + (n / 2) / f;
    return 1 - Math.exp(-x * x) / Math.sqrt(Math.PI) / f;
  }

  const roundTo = (x, d) => {
    const k = Math.pow(10, d || 0);
    return Math.round(x * k) / k;
  };
  const derate = (s) => 1.0 - s.strength_retention;

  function loadLadder(ladderJson) {
    const out = {};
    for (const col of COLUMNS) {
      const vals = ladderJson.columns[col];
      const s = { name: col, column: col, tier: 'reference' };
      for (const k of LADDER_KEYS) {
        if (typeof vals[k] !== 'number') throw new Error(`ladder ${col}.${k} is not a number`);
        s[k] = vals[k];
      }
      out[col] = s;
    }
    return out;
  }

  class Model {
    constructor(params) {
      this.params = params;
      const mat = params.materials;
      this.sigma_GPa = mat.tensile_strength_GPa;
      this.rho = mat.density_kgm3;
      this.SF = mat.safety_factor;
      this.mu = params.orbital.mu_earth_m3s2;
      this.com_altitude_km = params.orbital.com_altitude_km;
      const kin = params.kinematics;
      this.tiers = { reference: kin.v_tip_kms };
      for (const [key, block] of Object.entries(kin)) {
        if (block && typeof block === 'object' && 'v_tip_kms' in block) this.tiers[key] = block.v_tip_kms;
      }
    }
    get Vc_kms() { return Math.sqrt(2.0 * this.sigma_GPa * 1e9 / this.rho) / 1e3; }                    // EQ-4
    get v_orb_kms() { return Math.sqrt(this.mu / ((this.com_altitude_km + R_EARTH_KM) * 1e3)) / 1e3; } // EQ-2
    integratedMassRatio(vTip, der, arms) {                                                            // EQ-6
      if (!(der >= 0 && der < 1)) throw new RangeError('derate must be in [0, 1)');
      const x = (vTip / this.Vc_kms) * Math.sqrt(this.SF / (1.0 - der));
      return (arms === undefined ? 2.0 : arms) * Math.sqrt(Math.PI) * x * Math.exp(x * x) * erf(x);
    }
    forTier(s, tier) {
      if (!(tier in this.tiers)) throw new Error(`unknown tier ${tier}; valid tiers: ${Object.keys(this.tiers).sort().join(', ')}`);
      return Object.assign({}, s, { name: `${s.column}@${tier}`, tier, tip_speed_kms: this.tiers[tier] });
    }
    // Physics-to-economics chain (skyhook_finance.py:172-232)
    massRatio(s) { return this.integratedMassRatio(s.tip_speed_kms, derate(s)); }
    fiberMassT(s) { return this.massRatio(s) * s.payload_kg / 1000.0; }
    systemCapexM(s) { return this.fiberMassT(s) * 1000.0 * s.construction_launch_per_kg * s.hardware_mass_factor / 1e6; }
    fiberPurchaseM(s, price, mult) { return this.fiberMassT(s) * 1000.0 * price * mult / 1e6; }
    totalCapexM(s, price, mult) { return this.systemCapexM(s) + s.program_fleet_capex_M + this.fiberPurchaseM(s, price || 0, mult === undefined ? 1 : mult); }
    marginalCostPerKg(s) {
      const reboost = 2.0 * this.v_orb_kms * s.tip_speed_kms;
      return reboost / s.power_chain_efficiency / 3.6 * s.electricity_per_kwh + s.ops_wear_per_kg;
    }
    annualUpmassT(s) { return s.catches_per_day * 365.0 * s.payload_kg / 1000.0; }
    annualRevenueM(s) { return this.annualUpmassT(s) * 1000.0 * s.customer_price_per_kg / 1e6; }
    annualMarginalCostM(s) { return this.annualUpmassT(s) * 1000.0 * this.marginalCostPerKg(s) / 1e6; }
    // Cash flow, payback, NPV, breakeven (skyhook_finance.py:237-298)
    static rampMultiplier(opsYear, rampY1) {
      if (opsYear <= 0) return 0.0;
      if (opsYear === 1) return rampY1;
      if (opsYear === 2) return Math.min(1.0, rampY1 + RAMP_STEP);
      return 1.0;
    }
    netCashFlowsM(s, price, mult, years) {
      const n = years || WINDOW_YEARS;
      const capex = this.totalCapexM(s, price, mult);
      const rev = this.annualRevenueM(s);
      const vc = this.annualMarginalCostM(s);
      const flows = [];
      for (let year = 1; year <= n; year++) {
        const spend = year <= CAPEX_SPREAD.length ? capex * CAPEX_SPREAD[year - 1] : 0.0;
        const opsYear = year - OPS_START_YEAR + 1;
        const m = Model.rampMultiplier(opsYear, s.revenue_ramp_y1);
        const revenue = rev * m;
        const opex = opsYear >= 1 ? vc * m + s.fixed_ops_M : 0.0;
        flows.push(revenue - spend - opex);
      }
      return flows;
    }
    paybackYear(s, price, mult) {
      let cum = 0.0;
      const flows = this.netCashFlowsM(s, price, mult, MAX_PAYBACK_SEARCH);
      for (let i = 0; i < flows.length; i++) {
        cum += flows[i];
        if (cum > 0) return i + 1;
      }
      return null;
    }
    npvM(s, rate, price, mult) {
      const flows = this.netCashFlowsM(s, price, mult);
      let sum = 0.0;
      for (let t = 1; t <= flows.length; t++) sum += flows[t - 1] / Math.pow(1.0 + rate, t);
      return sum;
    }
    breakevenCustomerPriceY15(s, price, mult) {
      const opsYears = WINDOW_YEARS - OPS_START_YEAR + 1;
      let sumMult = 0;
      for (let k = 1; k <= opsYears; k++) sumMult += Model.rampMultiplier(k, s.revenue_ramp_y1);
      const upmassKg = this.annualUpmassT(s) * 1000.0;
      const need = this.totalCapexM(s, price, mult) + s.fixed_ops_M * opsYears + this.annualMarginalCostM(s) * sumMult;
      return need * 1e6 / (upmassKg * sumMult);
    }
    summarize(s, price, mult) {
      const p = price || 0;
      const m = mult === undefined ? 1 : mult;
      return {
        scenario: s.name, column: s.column, tier: s.tier,
        tip_speed_kms: s.tip_speed_kms, derate_fraction: roundTo(derate(s), 4),
        fiber_price_per_kg: p, fiber_multiplier: m,
        mass_ratio_x: this.massRatio(s), fiber_mass_t: this.fiberMassT(s),
        system_capex_M: this.systemCapexM(s),
        fiber_purchase_M: this.fiberPurchaseM(s, p, m),
        total_capex_M: this.totalCapexM(s, p, m),
        payback_year: this.paybackYear(s, p, m),
        npv_8pct_M: this.npvM(s, 0.08, p, m),
        npv_10pct_M: this.npvM(s, 0.10, p, m),
        npv_12pct_M: this.npvM(s, 0.12, p, m),
        breakeven_customer_price_y15: this.breakevenCustomerPriceY15(s, p, m),
        partial_tier_model: s.tier !== 'reference',
      };
    }
    // Sensitivity (finance/sensitivity.py)
    static setInput(s, field, value) {
      if (field === 'derate_fraction') return Object.assign({}, s, { strength_retention: 1.0 - value });
      const o = Object.assign({}, s);
      o[field] = value;
      return o;
    }
    static getInput(s, field) { return field === 'derate_fraction' ? derate(s) : s[field]; }
    closes(s, price, mult) {
      const pb = this.paybackYear(s, price, mult);
      return pb !== null && pb <= WINDOW_YEARS;
    }
    // The far end of sensitivity.py's bisection: ×5 up, ÷5 down, derate and fixed ops floored at 0.
    static relaxationFar(base, field) {
      const v0 = Model.getInput(base, field);
      if (INPUTS[field][1] === 'up') return v0 * MAX_STRETCH;
      if (field === 'fixed_ops_M' || field === 'derate_fraction') return 0.0;
      return v0 / MAX_STRETCH;
    }
    relaxationThreshold(base, field, price, mult) {
      const v0 = Model.getInput(base, field);
      const direction = INPUTS[field][1];
      const far = Model.relaxationFar(base, field);
      if (!this.closes(Model.setInput(base, field, far), price, mult)) return null;
      if (this.closes(base, price, mult)) return v0;
      let lo = direction === 'up' ? v0 : far;
      let hi = direction === 'up' ? far : v0;
      for (let i = 0; i < BISECT_ITERS; i++) {
        const mid = 0.5 * (lo + hi);
        const c = this.closes(Model.setInput(base, field, mid), price, mult);
        if (direction === 'up') { if (c) hi = mid; else lo = mid; }
        else { if (c) lo = mid; else hi = mid; }
      }
      return direction === 'up' ? hi : lo;
    }
    thresholds(base, price, mult) {
      const out = {};
      for (const f of Object.keys(INPUTS)) out[f] = this.relaxationThreshold(base, f, price, mult);
      return out;
    }
    baselineSingles(cons, base, price, mult) {
      const out = [];
      for (const f of Object.keys(INPUTS)) {
        if (Model.getInput(cons, f) === Model.getInput(base, f)) continue;
        const s = Model.setInput(cons, f, Model.getInput(base, f));
        out.push({ field: f, label: INPUTS[f][0], baseline_value: Model.getInput(base, f),
          payback_year: this.paybackYear(s, price, mult), closes: this.closes(s, price, mult) });
      }
      return out;
    }
    // The fiber price at which a single substitution stops closing the conservative case.
    singleStopPrice(cons, base, field, mult) {
      return this.stopPrice(Model.setInput(cons, field, Model.getInput(base, field)), mult);
    }
    // The fiber price above which relaxationThreshold returns null: the stop price of the stretch's far end.
    thresholdVanishPrice(base, field, mult) {
      return this.stopPrice(Model.setInput(base, field, Model.relaxationFar(base, field)), mult);
    }
    // The fiber price at which scenario s stops closing (bisection over [0, cap]); null if it does not close
    // at $0, Infinity if it still closes at the cap. Closed form: cum15(0) × 1000 / (fiber_t × m).
    stopPrice(s, mult) {
      if (!this.closes(s, 0.0, mult)) return null;
      if (this.closes(s, STOP_PRICE_CAP, mult)) return Infinity;
      let lo = 0.0;
      let hi = STOP_PRICE_CAP;
      for (let i = 0; i < BISECT_ITERS; i++) {
        const mid = 0.5 * (lo + hi);
        if (this.closes(s, mid, mult)) lo = mid; else hi = mid;
      }
      return lo;
    }
  }

  // ── The p = 0 gate (fiber_sweep.run_gate) ─────────────────────────────────────────────────────
  function runGate(model, ladder, published) {
    const checks = [];
    const check = (label, got, want, ok) => checks.push({ label, got, want, ok: !!ok });
    const audit = model.params.mass_ratio.integrated_tether_to_payload_both_arms;
    for (const col of COLUMNS) {
      const s = ladder[col];
      const r = model.summarize(s);
      const pub = published.columns[col];
      check(`${col} total capex $M`, Math.round(r.total_capex_M), pub.total_capex_M, Math.round(r.total_capex_M) === pub.total_capex_M);
      check(`${col} payback year`, r.payback_year, pub.payback_year, r.payback_year === pub.payback_year);
      if ('npv_10pct_M' in pub) check(`${col} NPV@10% $M`, Math.round(r.npv_10pct_M), pub.npv_10pct_M, Math.round(r.npv_10pct_M) === pub.npv_10pct_M);
      const [rk, fk] = published.mass_ratio_keys[col];
      check(`${col} mass ratio (rev_a ${rk})`, roundTo(r.mass_ratio_x, 2), audit[rk], roundTo(r.mass_ratio_x, 2) === audit[rk]);
      check(`${col} fiber mass t (rev_a ${fk})`, roundTo(r.fiber_mass_t, 1), audit[fk], roundTo(r.fiber_mass_t, 1) === audit[fk]);
    }
    const cons = ladder.Conservative;
    const v = published.variant;
    const sv = Object.assign({}, cons, { name: v.name, construction_launch_per_kg: v.launch_per_kg });
    check('variant total capex $M', Math.round(model.totalCapexM(sv)), v.total_capex_M, Math.round(model.totalCapexM(sv)) === v.total_capex_M);
    check('variant payback year', model.paybackYear(sv), v.payback_year, model.paybackYear(sv) === v.payback_year);
    for (const tier of ['cislunar_revenue_gated_option', 'phase3_growth_option']) {
      const st = model.forTier(cons, tier);
      const [rk, fk] = published.mass_ratio_keys[tier];
      check(`${tier} mass ratio (rev_a ${rk})`, roundTo(model.massRatio(st), 2), audit[rk], roundTo(model.massRatio(st), 2) === audit[rk]);
      check(`${tier} fiber mass t (rev_a ${fk})`, roundTo(model.fiberMassT(st), 1), audit[fk], roundTo(model.fiberMassT(st), 1) === audit[fk]);
    }
    return { ok: checks.every((c) => c.ok), checks };
  }

  function tierRows(model, ladder) {
    const rows = COLUMNS.map((c) => ladder[c]);
    const cons = ladder.Conservative;
    const tiers = Object.entries(model.tiers).sort((a, b) => a[1] - b[1]);
    for (const [tier] of tiers) if (tier !== 'reference') rows.push(model.forTier(cons, tier));
    return rows;
  }

  function computeStudy(model, ladder, prices, mult, markers) {
    const cons = ladder.Conservative;
    const base = ladder.Baseline;
    const rows = tierRows(model, ladder);
    const sweep = prices.map((p) => ({
      fiber_price_per_kg: p,
      rows: rows.map((s) => model.summarize(s, p, mult)),
      conservative_thresholds: model.thresholds(cons, p, mult),
      baseline_singles: model.baselineSingles(cons, base, p, mult),
    }));
    const capped = (sp) => (sp === null ? null : (sp === Infinity ? '> cap' : sp));
    const stops = {};
    for (const f of Object.keys(INPUTS)) {
      if (Model.getInput(cons, f) === Model.getInput(base, f)) continue;
      stops[f] = capped(model.singleStopPrice(cons, base, f, mult));
    }
    const vanish = {};
    for (const f of Object.keys(INPUTS)) vanish[f] = capped(model.thresholdVanishPrice(cons, f, mult));
    const markerRows = [];
    if (markers) {
      for (const mk of markers.markers) {
        const lines = mk.lines_per_key || {};
        for (const [key, price] of Object.entries(mk.prices_per_kg)) {
          markerRows.push({ id: mk.id, label: mk.label, key, price_per_kg: price, file: mk.file, line: key in lines ? lines[key] : mk.line, status: mk.status,
            rows: rows.map((s) => model.summarize(s, price, mult)) });
        }
      }
    }
    return {
      fiber_multiplier: mult, price_grid: prices.slice(),
      at_zero: { conservative_thresholds: model.thresholds(cons, 0.0, mult), baseline_singles: model.baselineSingles(cons, base, 0.0, mult) },
      sweep, single_stop_prices: stops, threshold_vanish_prices: vanish, single_stop_cap_per_kg: STOP_PRICE_CAP, markers: markerRows,
    };
  }

  function quoteCard(model, ladder, price, mult, source) {
    const cons = ladder.Conservative;
    const base = ladder.Baseline;
    const rows = tierRows(model, ladder).map((s) => {
      const r0 = model.summarize(s, 0.0, mult);
      const r1 = model.summarize(s, price, mult);
      return { before: r0, after: r1, added_capex_M: r1.total_capex_M - r0.total_capex_M, added_capex_pct: (r1.total_capex_M / r0.total_capex_M - 1.0) * 100.0 };
    });
    return {
      fiber_price_per_kg: price, fiber_multiplier: mult, effective_price_per_kg: price * mult, price_source: source,
      material: { key: 'pbo', name: model.params.materials.primary_fiber, tensile_strength_GPa: model.sigma_GPa, density_kgm3: model.rho, safety_factor: model.SF },
      rows,
      conservative_thresholds_before: model.thresholds(cons, 0.0, mult),
      conservative_thresholds_after: model.thresholds(cons, price, mult),
      baseline_singles_after: model.baselineSingles(cons, base, price, mult),
      rev_a_key_to_fill: 'economics.fiber_cost_per_kg', rev_a_note_key: '_fiber_cost_note',
    };
  }

  // The structured refusal when no price exists (mirrors fiber_sweep.resolve_quote and inspace_fork.require_non_null).
  function refusal(params) {
    const fc = params.economics.fiber_cost_per_kg;
    if (fc !== null && fc !== undefined) return null;
    return {
      code: 'null_input',
      what: 'no fiber price: rev_a.json economics.fiber_cost_per_kg is null and none has been typed',
      note: params.economics._fiber_cost_note || '',
      what_would_help: 'a vendor quote in $/kg for Zylon PBO (the Toyobo and Avient asks are pending), stating yarn vs finished rope, '
        + 'MOQ, currency and date; then fill economics.fiber_cost_per_kg in params/rev_a.json with its source in _fiber_cost_note. '
        + 'A FibrXL reply is for Dyneema SK78, a different fiber: choose its material and the card refuses it.',
    };
  }

  // A flat object as Python's json.dumps prints it (", " and ": " separators), so the refusal reads the same in both.
  const pyJson = (o) => (o && typeof o === 'object'
    ? `{${Object.entries(o).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(', ')}}` : JSON.stringify(o));

  // The refusal for a quote on a fiber other than Zylon PBO (mirrors fiber_sweep.material_refusal).
  function materialRefusal(params, key) {
    if (key === 'pbo') return null;
    const mat = params.materials;
    return {
      code: 'material_not_in_canon',
      what: `the quote is for ${MATERIALS[key] || MATERIALS.other}, but every fiber mass here is rev_a.json's EQ-6 mass for `
        + `materials.primary_fiber = ${mat.primary_fiber} (σ ${mat.tensile_strength_GPa} GPa, ρ ${thousands(mat.density_kgm3)} kg/m³). `
        + `materials.alternative_fibers = ${pyJson(mat.alternative_fibers)} gives strengths, with a density only in a free-text note, `
        + 'so there is no canonical tether mass to multiply this price by',
      what_would_help: 'a VM-verified strength and density for that fiber in params/rev_a.json materials, and the tether\'s mass in it '
        + '(materials.construction_baseline is a UHMWPE-core / Zylon-arm hybrid whose split rev_a does not give); '
        + 'until then this page prints no fiber line for it',
    };
  }

  // Dotted path of the first number that is NaN or infinite in a nested object, or null (fiber_sweep.first_non_finite).
  function firstNonFinite(obj, path) {
    const here = path || '';
    if (typeof obj === 'number') return Number.isFinite(obj) ? null : (here || 'value');
    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) { const b = firstNonFinite(obj[i], `${here}[${i}]`); if (b) return b; }
    } else if (obj && typeof obj === 'object') {
      for (const [k, v] of Object.entries(obj)) { const b = firstNonFinite(v, here ? `${here}.${k}` : k); if (b) return b; }
    }
    return null;
  }

  // ── Formatting, matching fiber_sweep.py's text output ─────────────────────────────────────────
  // Exact decimal digits of |round(n)|, also at and above 1e21, where String() and toFixed() switch to
  // exponent notation (Python's format() never does; a double that large is an integer, so BigInt is exact).
  function intDigits(n) {
    const r = Math.round(Math.abs(n));
    return r < 1e21 ? String(r) : BigInt(r).toString();
  }
  function thousands(n) {
    const s = intDigits(n);
    return (n < 0 && Math.round(n) !== 0 ? '-' : '') + s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function fixed(n, d) {
    const s = Math.abs(n) < 1e21 ? Math.abs(n).toFixed(d) : intDigits(n) + (d ? '.' + '0'.repeat(d) : '');
    const [i, f] = s.split('.');
    return (n < 0 && Number(s) !== 0 ? '-' : '') + i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (f ? '.' + f : '');
  }
  // The number as fiber_sweep.number_str prints it: 300, 123.456789, 1e+300.
  const numberStr = (x) => String(x + 0);
  const money = (x) => { const r = Math.round(x); return `${r < 0 ? '-' : ''}$${thousands(Math.abs(r))}M`; };
  const pbStr = (pb) => (pb === null || pb === undefined) ? `>Y${MAX_PAYBACK_SEARCH}` : `Y${pb}${pb > WINDOW_YEARS ? '*' : ''}`;
  const priceStr = (p) => (Number.isInteger(p) ? `$${thousands(p)}` : `$${fixed(p, 2)}`);
  function thrStr(field, v) {
    if (v === null || v === undefined) return 'cannot';
    switch (field) {
      case 'customer_price_per_kg':
      case 'construction_launch_per_kg': return `$${thousands(v)}`;
      case 'catches_per_day': return `${v.toFixed(3)}/day`;
      case 'payload_kg': return `${thousands(v)} kg`;
      case 'derate_fraction': return `${(v * 100).toFixed(1)}%`;
      case 'hardware_mass_factor': return `${v.toFixed(3)}x`;
      case 'program_fleet_capex_M':
      case 'fixed_ops_M': return `$${thousands(v)}M`;
      default: return String(v);
    }
  }
  function rowLabel(r) {
    if (r.tier === 'reference') return `${r.column} ${r.tip_speed_kms.toFixed(1)} km/s (${Math.round(r.derate_fraction * 100)}% derate)`;
    return `${TIER_SHORT[r.tier] || r.tier} ${r.tip_speed_kms.toFixed(1)} km/s @ ${r.column} column`;
  }

  return {
    CAPEX_SPREAD, OPS_START_YEAR, RAMP_STEP, WINDOW_YEARS, MAX_PAYBACK_SEARCH, R_EARTH_KM, COLUMNS, DEFAULT_PRICES,
    BISECT_ITERS, MAX_STRETCH, STOP_PRICE_CAP, LADDER_KEYS, INPUTS, SHORT, TIER_SHORT, MATERIALS,
    erf, roundTo, derate, loadLadder, Model, runGate, tierRows, computeStudy, quoteCard, refusal, materialRefusal, firstNonFinite,
    money, pbStr, priceStr, thrStr, rowLabel, thousands, fixed, numberStr,
  };
});
