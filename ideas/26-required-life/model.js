/* model.js: Required Life, the arithmetic, with no DOM.
 *
 * Question. Skyhook's DECISION_LOG item 10 names HMPE creep at 28-40% of break as a hard part and
 * lists, as admissible outcome (a), "creep-governed tether replacement cadence, costed into ops".
 * Nothing in finance/ costs it. Nobody in the repository knows how long HMPE lasts at 28-40% of
 * break; the only anchored datum is secondary guidance (MP-001 section 1: SK78 about 8 yr at 20%
 * load, 20 C). So this module never predicts a life. It adds a replacement line to the finance
 * model's cash flow and runs it backwards: how long must the HMPE last for the case to hold?
 *
 * The base model is a line-by-line port of finance/skyhook_finance.py at Skyhook 34935cb
 * (fiber_mass_t, system_capex_M, total_capex_M, marginal_cost_per_kg, annual_*, ramp_multiplier,
 * net_cash_flows_M, payback_year, npv_M). Every input comes from data.js, which packs snapshots
 * of params/rev_a.json, the workbook ladder and the finance module's own constants.
 *
 * The replacement line (this study's addition, a convention, labelled as one on the page):
 *   replaced mass  = f x fiber mass                      f = HMPE share of tether mass (not in canon)
 *   cost per kg    = construction launch $/kg of the column (the ladder's own price, Rule 4)
 *                    + fiber purchase $/kg (rev_a economics.fiber_cost_per_kg is null: unpriced
 *                    unless the user sets a bracket; the term is then absent, not zero-priced)
 *   per event $M   = replaced kg x cost per kg / 1e6
 *   rolling        : per event / L every operating year from OPS_START_YEAR (a sinking-fund view:
 *                    1/L of the HMPE replaced each year), the default
 *   lumpy          : the whole per-event cost at t = (OPS_START_YEAR - 1) + kL, k = 1, 2, ...,
 *                    booked in the year that contains t (year y covers (y-1, y])
 * Omitted, and all non-negative: hardware for the swap, installation operations, downtime and lost
 * revenue, the hardware mass factor (hub, arrays and tips are not replaced). Fiber purchase is
 * omitted while unpriced. So every required life below is a floor for the column's launch price.
 *
 * Loads as a classic browser script (window.RequiredLife) and with require().
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RequiredLife = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SQRT_PI = Math.sqrt(Math.PI);

  /* erf by the series erf(x) = (2/sqrt(pi)) e^(-x^2) sum_n (2x^2)^n x / (1*3*...*(2n+1)) (all terms
   * positive, so no cancellation; Abramowitz and Stegun 7.1.6). Beyond |x| = 6, erfc < 3e-17. */
  function erf(x) {
    if (x !== x) return NaN;
    if (x < 0) return -erf(-x);
    if (x > 6) return 1;
    var x2 = x * x;
    var term = x;
    var sum = x;
    for (var n = 1; n < 500; n++) {
      term *= (2 * x2) / (2 * n + 1);
      sum += term;
      if (term < 1e-17 * sum) break;
    }
    return (2 / SQRT_PI) * Math.exp(-x2) * sum;
  }

  /* ---------------------------------------------------------------- canon and ladder ---- */

  // Tier discovery mirrors load_tiers_from_params(): the reference is kinematics.v_tip_kms, the
  // option tiers are kinematics sub-blocks carrying their own v_tip_kms.
  function tiers(revA) {
    var kin = revA.kinematics;
    var out = [{ key: 'reference', vTip: Number(kin.v_tip_kms) }];
    Object.keys(kin).forEach(function (k) {
      var b = kin[k];
      if (b && typeof b === 'object' && 'v_tip_kms' in b) out.push({ key: k, vTip: Number(b.v_tip_kms) });
    });
    return out.sort(function (a, b) { return a.vTip - b.vTip; });
  }

  var COLUMNS = ['Conservative', 'Baseline', 'Optimistic'];

  function characteristicVelocity_kms(sigmaGPa, rho) {
    return Math.sqrt((2 * sigmaGPa * 1e9) / rho) / 1e3; // EQ-4
  }

  function xParam(vTip, Vc, SF, derate) {
    return (vTip / Vc) * Math.sqrt(SF / (1 - derate)); // EQ-6 argument
  }

  function massRatio(vTip, Vc, SF, derate) {
    var x = xParam(vTip, Vc, SF, derate);
    return 2 * SQRT_PI * x * Math.exp(x * x) * erf(x); // EQ-6, two arms
  }

  /* Everything the cash flow needs for one tier and one ladder column. */
  function economics(data, column, tierKey) {
    var revA = data.revA;
    var lad = data.ladder.columns[column];
    if (!lad) throw new Error('unknown column ' + column);
    var tier = tiers(revA).filter(function (t) { return t.key === tierKey; })[0];
    if (!tier) throw new Error('unknown tier ' + tierKey);
    var conv = data.conventions;
    var mat = revA.materials;
    var derate = 1 - lad.strength_retention;
    var Vc = characteristicVelocity_kms(mat.tensile_strength_GPa, mat.density_kgm3);
    var SF = mat.safety_factor;
    var ratio = massRatio(tier.vTip, Vc, SF, derate);
    var fiberMass_t = (ratio * lad.payload_kg) / 1000;
    var systemCapex_M = (fiberMass_t * 1000 * lad.construction_launch_per_kg * lad.hardware_mass_factor) / 1e6;
    var totalCapex_M = systemCapex_M + lad.program_fleet_capex_M;
    // marginal_cost_per_kg(): v_orb from the CoM altitude with the physics module's R_EARTH_KM
    var rOrbit_m = (revA.orbital.com_altitude_km + data.physics.R_EARTH_KM.value) * 1e3;
    var vOrb = Math.sqrt(revA.orbital.mu_earth_m3s2 / rOrbit_m) / 1e3;
    var reboostMJ = 2 * vOrb * tier.vTip;
    var elecPerKg = (reboostMJ / lad.power_chain_efficiency / 3.6) * lad.electricity_per_kwh;
    var marginalPerKg = elecPerKg + lad.ops_wear_per_kg;
    var upmass_t = lad.catches_per_day * 365 * lad.payload_kg / 1000;
    var revenue_M = (upmass_t * 1000 * lad.customer_price_per_kg) / 1e6;
    var varCost_M = (upmass_t * 1000 * marginalPerKg) / 1e6;
    return {
      column: column,
      tier: tierKey,
      vTip: tier.vTip,
      derate: derate,
      SF: SF,
      Vc: Vc,
      x: xParam(tier.vTip, Vc, SF, derate),
      massRatio: ratio,
      fiberMass_t: fiberMass_t,
      launchPerKg: lad.construction_launch_per_kg,
      systemCapex_M: systemCapex_M,
      totalCapex_M: totalCapex_M,
      marginalPerKg: marginalPerKg,
      upmass_t: upmass_t,
      revenue_M: revenue_M,
      varCost_M: varCost_M,
      fixedOps_M: lad.fixed_ops_M,
      matureMargin_M: revenue_M - varCost_M - lad.fixed_ops_M,
      ramp1: lad.revenue_ramp_y1,
      rampStep: conv.ramp_step.value,
      capexSpread: conv.capex_spread.value,
      opsStart: conv.ops_start_year.value,
      window: conv.window_years.value,
      maxYears: conv.payback_max_years.value,
      npvRate: conv.npv_rate.value,
      // sustained load as a fraction of rated (virgin) break: working stress = sigma (1 - derate) / SF
      loadFraction: lad.strength_retention / SF,
      halfLength_km: revA.geometry.tether_half_length_km,
    };
  }

  /* ---------------------------------------------------------------- cash flow ---- */

  function rampMultiplier(E, opsYear) {
    if (opsYear <= 0) return 0;
    if (opsYear === 1) return E.ramp1;
    if (opsYear === 2) return Math.min(1, E.ramp1 + E.rampStep);
    return 1;
  }

  function costPerKg(E, repl) {
    return E.launchPerKg + (repl.fiberPerKg == null ? 0 : repl.fiberPerKg);
  }

  // $M of one full replacement of the HMPE inventory
  function perEvent_M(E, repl) {
    return (repl.f * E.fiberMass_t * 1000 * costPerKg(E, repl)) / 1e6;
  }

  // number of lumpy events at or before time T (years since program start)
  function lumpyCount(E, L, T) {
    var t0 = E.opsStart - 1;
    if (T <= t0) return 0;
    return Math.floor((T - t0) / L + 1e-9); // the 1e-9 absorbs round-off in (T - t0)/L at exact hits
  }

  function replacementInYear_M(E, repl, year) {
    if (!repl) return 0;
    var opsYear = year - E.opsStart + 1;
    if (opsYear < 1) return 0;
    var per = perEvent_M(E, repl);
    if (per === 0) return 0;
    if (repl.convention === 'lumpy') {
      var n = lumpyCount(E, repl.life, year) - lumpyCount(E, repl.life, year - 1);
      return n * per;
    }
    return per / repl.life;
  }

  function netCashFlows_M(E, years, repl) {
    var flows = [];
    for (var year = 1; year <= years; year++) {
      var spend = year <= E.capexSpread.length ? E.totalCapex_M * E.capexSpread[year - 1] : 0;
      var opsYear = year - E.opsStart + 1;
      var m = rampMultiplier(E, opsYear);
      var revenue = E.revenue_M * m;
      var opex = opsYear >= 1 ? E.varCost_M * m + E.fixedOps_M : 0;
      flows.push(revenue - spend - opex - replacementInYear_M(E, repl, year));
    }
    return flows;
  }

  function cumulative_M(E, year, repl) {
    return netCashFlows_M(E, year, repl).reduce(function (a, b) { return a + b; }, 0);
  }

  // first year cumulative net cash flow > 0, searching to E.maxYears (40, as payback_year() does)
  function paybackYear(E, repl, maxYears) {
    var n = maxYears || E.maxYears;
    var flows = netCashFlows_M(E, n, repl);
    var cum = 0;
    for (var i = 0; i < flows.length; i++) {
      cum += flows[i];
      if (cum > 0) return i + 1;
    }
    return null;
  }

  function npv_M(E, rate, years, repl) {
    var flows = netCashFlows_M(E, years, repl);
    var s = 0;
    for (var t = 1; t <= flows.length; t++) s += flows[t - 1] / Math.pow(1 + rate, t);
    return s;
  }

  /* ---------------------------------------------------------------- refusals ---- */

  function refusal(code, reason, help) {
    return { refused: true, code: code, reason: reason, whatWouldHelp: help };
  }

  function checkRepl(repl, needLife) {
    if (!repl || repl.f == null) {
      return refusal('hmpe_share_unset',
        'The HMPE share of tether mass is not in canon: neither params/rev_a.json (materials.construction_baseline) nor the founding document (Part IV, section 4.1) states one.',
        'Choose a reading of the founding document (length share or taper-weighted mass share), all-HMPE, or your own share. A canonical hybrid boundary in params/rev_a.json would close this.');
    }
    if (!(repl.f >= 0 && repl.f <= 1)) {
      return refusal('hmpe_share_out_of_range', 'The HMPE share must lie between 0 and 1.', 'Set a share between 0 and 1.');
    }
    if (repl.fiberPerKg != null && !(repl.fiberPerKg >= 0 && isFinite(repl.fiberPerKg))) {
      return refusal('fiber_price_invalid', 'A fiber price must be a non-negative number of $/kg.', 'Clear it (unpriced) or enter a bracket.');
    }
    if (needLife && !(repl.life > 0 && isFinite(repl.life))) {
      return refusal('life_invalid', 'A replacement life must be a positive number of years.', 'Enter a life in years.');
    }
    return null;
  }

  /* ---------------------------------------------------------------- the inverse ---- */

  /* Smallest life L with paybackYear(L) <= target. For the rolling convention there is a closed
   * form: with replacement R = per/L in each of the (target - OPS_START_YEAR + 1) operating years up
   * to the target, and the cumulative net cash flow before replacement C (>0), payback holds iff
   * C - R n > 0, i.e. L > per n / C (the bound itself is excluded: at L = L*, cumulative is exactly
   * 0 and payback slips). paybackYear() is non-increasing in L in both conventions, because the
   * replacement spend booked up to any year can only fall as L grows. */
  function requiredLifeClosedForm(E, repl, target) {
    var C = cumulative_M(E, target, null);
    var n = target - E.opsStart + 1;
    if (!(C > 0) || n < 1) return null;
    return (perEvent_M(E, repl) * n) / C;
  }

  function requiredLifeBisect(E, repl, target, opts) {
    opts = opts || {};
    var lo = opts.lo || 1e-3;
    var hi = opts.hi || 1e5;
    function ok(L) {
      var pb = paybackYear(E, { f: repl.f, fiberPerKg: repl.fiberPerKg, convention: repl.convention, life: L });
      return pb !== null && pb <= target;
    }
    if (!ok(hi)) return null;
    if (ok(lo)) return lo;
    for (var i = 0; i < 400 && hi / lo - 1 > 1e-13; i++) {
      var mid = Math.sqrt(lo * hi);
      if (ok(mid)) hi = mid;
      else lo = mid;
    }
    return hi;
  }

  /* All the required lives for one tier and column. Payback targets: the base payback year and the
   * next three years; the 15-year window; replacement equal to the fixed-ops line; and the floor
   * below which the machine never earns its replacement (rolling average >= mature margin). */
  function requiredLives(E, repl) {
    var bad = checkRepl(repl, false);
    if (bad) return bad;
    var base = paybackYear(E, null);
    var per = perEvent_M(E, repl);
    var out = {
      refused: false,
      basePayback: base,
      perEvent_M: per,
      costPerKg: costPerKg(E, repl),
      fiberUnpriced: repl.fiberPerKg == null,
      convention: repl.convention === 'lumpy' ? 'lumpy' : 'rolling',
      payback: [],
      window: null,
      ops: per / E.fixedOps_M,
      floor: E.matureMargin_M > 0 ? per / E.matureMargin_M : null,
    };
    if (base === null) {
      out.paybackRefusal = refusal('base_never_pays_back',
        'Without any replacement this tier and column do not pay back within ' + E.maxYears + ' years, so no life makes them pay back.',
        'This is a property of the base case (finance/skyhook_finance.py prints ">Y40" for it), not of creep. Lower capex or a different tier would have to come first.');
    } else {
      for (var k = 0; k < 4; k++) {
        var target = base + k;
        if (target > E.maxYears) break;
        var L = out.convention === 'rolling' ? requiredLifeClosedForm(E, repl, target) : requiredLifeBisect(E, repl, target);
        out.payback.push({ target: target, slip: k, life: per === 0 ? 0 : L });
      }
    }
    if (base !== null && base <= E.window) {
      var Lw = out.convention === 'rolling' ? requiredLifeClosedForm(E, repl, E.window) : requiredLifeBisect(E, repl, E.window);
      out.window = { target: E.window, life: per === 0 ? 0 : Lw };
    } else {
      out.windowRefusal = refusal('base_misses_window',
        'Without any replacement this case already pays back after the ' + E.window + '-year window (' + (base === null ? 'not within ' + E.maxYears + ' years' : 'year ' + base) + '), so no replacement life brings it inside.',
        'DECISION_LOG item 8 records this for the conservative case and lists the single relaxations that would close it.');
    }
    return out;
  }

  /* Forward view at one life. */
  function forward(E, repl) {
    var bad = checkRepl(repl, true);
    if (bad) return bad;
    var per = perEvent_M(E, repl);
    var annual = per / repl.life; // average $M/yr in either convention
    var pb = paybackYear(E, repl);
    return {
      refused: false,
      annual_M: annual,
      perEvent_M: per,
      shareOfFixedOps: annual / E.fixedOps_M,
      shareOfRevenue: annual / E.revenue_M,
      shareOfMargin: E.matureMargin_M > 0 ? annual / E.matureMargin_M : null,
      payback: pb,
      basePayback: paybackYear(E, null),
      npv_M: npv_M(E, E.npvRate, E.window, repl),
      baseNpv_M: npv_M(E, E.npvRate, E.window, null),
      cumWindow_M: cumulative_M(E, E.window, repl),
      eventsInWindow: repl.convention === 'lumpy' ? lumpyCount(E, repl.life, E.window) : null,
    };
  }

  /* ---------------------------------------------------------------- HMPE share readings ---- */

  // Founding document: outer d km of the LOWER arm in Zylon, the rest UHMWPE. Length share of the
  // two arms (2 x half-length).
  function hmpeShareByLength(E, zylon_km) {
    return (2 * E.halfLength_km - zylon_km) / (2 * E.halfLength_km);
  }

  /* Same boundary, weighted by mass along the EQ-6 profile. A uniform-stress arm has area
   * A(r) = A_tip exp(x^2 (1 - r^2/L^2)), so the mass outboard of radius a in one arm is
   * proportional to erf(x) - erf(x a/L); two equal arms; the Zylon is in one of them. This uses
   * the single-material (Zylon) profile that EQ-6 and the finance model use for the whole tether. */
  function hmpeShareByMass(E, zylon_km) {
    var a = (E.halfLength_km - zylon_km) / E.halfLength_km;
    var outer = (erf(E.x) - erf(E.x * a)) / erf(E.x);
    return 1 - outer / 2;
  }

  /* ---------------------------------------------------------------- anchored ticks ---- */

  function ticks(sourced, dm20) {
    var t = [{ key: 'sk78', life: sourced.sk78_life_yr, load: sourced.sk78_life_load_pct, temp: sourced.sk78_life_temp_c, lowerBound: false }];
    // LR-001: DM20 creeps >50x slower. Drawn as life x factor ONLY under the stated assumption that
    // life scales as 1/creep rate at the same load; never applied to the slider.
    if (dm20) t.push({ key: 'dm20', life: sourced.sk78_life_yr * sourced.dm20_creep_factor, load: sourced.sk78_life_load_pct, temp: sourced.sk78_life_temp_c, lowerBound: true, factor: sourced.dm20_creep_factor });
    return t;
  }

  /* [Speculative] What ST-002 would have to show: if life scales as 1/creep rate, a grade whose
   * life at the anchored load is A years meets a required life L* at a higher load only if creep at
   * that load is at most A / L* times faster than at the anchored load. Below 1 it cannot be met
   * by that grade at any load at or above the anchored one (creep does not slow with load). */
  function creepRatioThreshold(anchorLife, requiredLife) {
    if (!(requiredLife > 0)) return null;
    return anchorLife / requiredLife;
  }

  /* ---------------------------------------------------------------- formatting ---- */

  function sig(v, n) {
    if (v === 0) return '0';
    var d = Math.max(0, n - 1 - Math.floor(Math.log10(Math.abs(v))));
    return Number(v.toFixed(Math.min(d, 6))).toLocaleString('en-US', { maximumFractionDigits: Math.min(d, 6), minimumFractionDigits: Math.min(d, 6) });
  }
  function years(v) {
    if (v == null) return 'n/a';
    if (v >= 1000) return Math.round(v).toLocaleString('en-US') + ' years';
    return sig(v, 3) + (sig(v, 3) === '1.00' ? ' year' : ' years');
  }
  function money(vM) {
    var neg = vM < 0;
    var a = Math.abs(vM);
    var s = a >= 1000 ? Math.round(a).toLocaleString('en-US') : Number.isInteger(a) ? String(a) : a.toFixed(a >= 10 ? 1 : 2);
    return (neg ? '−' : '') + '$' + s + 'M';
  }
  // up to 3 significant figures without trailing zeros: 8 -> "8", 28.464 -> "28.5"
  function short(v) {
    return String(parseFloat(Number(v).toPrecision(3)));
  }
  function pct(v, digits) {
    return (v * 100).toFixed(digits == null ? 1 : digits) + '%';
  }
  function yearLabel(pb, maxYears) {
    return pb == null ? 'not within ' + maxYears + ' years' : 'Y' + pb;
  }

  return {
    erf: erf,
    tiers: tiers,
    COLUMNS: COLUMNS,
    characteristicVelocity_kms: characteristicVelocity_kms,
    xParam: xParam,
    massRatio: massRatio,
    economics: economics,
    rampMultiplier: rampMultiplier,
    costPerKg: costPerKg,
    perEvent_M: perEvent_M,
    lumpyCount: lumpyCount,
    replacementInYear_M: replacementInYear_M,
    netCashFlows_M: netCashFlows_M,
    cumulative_M: cumulative_M,
    paybackYear: paybackYear,
    npv_M: npv_M,
    checkRepl: checkRepl,
    requiredLifeClosedForm: requiredLifeClosedForm,
    requiredLifeBisect: requiredLifeBisect,
    requiredLives: requiredLives,
    forward: forward,
    hmpeShareByLength: hmpeShareByLength,
    hmpeShareByMass: hmpeShareByMass,
    ticks: ticks,
    creepRatioThreshold: creepRatioThreshold,
    fmt: { sig: sig, short: short, years: years, money: money, pct: pct, yearLabel: yearLabel },
  };
});
