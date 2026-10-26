/* heat.js: the arithmetic behind "Hot Skin", with no DOM and no clock.
 *
 * Aerodynamic heating, Stage 1 (PartForge docs/roadmap-evaluation.md, idea 20): the stagnation and
 * recovery temperatures of air at a declared speed and altitude, measured against a material's
 * service_max_c. Everything the model needs from PartForge arrives through a snapshot object
 * (snapshots/partforge.js): the repository's own isa() and ISA constants, the materials_thermal
 * table with each row's confidence, FLIGHT_MATERIALS names and kinds, and the fin template's
 * declared condition. The only constant in the equations defined here is the Prandtl number of air;
 * the 800 K flag, the 2,000 K ceiling and the 25 °C "near" band are thresholds on what is shown.
 *
 *   T∞, a      = isa(alt_m)                      1976 Standard Atmosphere, the repo's function
 *   M          = V / a                           derived, never an input
 *   T0         = T∞ (1 + (γ−1)/2 · M²)           stagnation (total) temperature          [Certain]
 *   T_r        = T∞ (1 + r (γ−1)/2 · M²)         adiabatic-wall (recovery) temperature   [Certain]
 *   r          = Pr^½ laminar, Pr^⅓ turbulent    flat-plate recovery factors             [Likely]
 *   cp         = γR/(γ−1)                        so that T0 − T∞ = V²/(2cp) exactly       [Certain]
 *
 * The verdict is always SCREEN. The adiabatic wall is an upper bound on the skin temperature a part
 * can reach, not a prediction of what it does reach in a flight that lasts seconds, and service_max_c
 * is the table's documented judgement, not a rating. Refusals are first-class results: a bare Mach
 * number (T0 − T∞ tracks V², not M), an unknown material, a row without service_max_c, an altitude
 * the ISA table clamps, a speed at which the perfect-gas T0 would pass the 2,000 K ceiling (where
 * the calorically perfect gas these equations describe stops existing), or a non-finite input each
 * return {ok:false, refusal:{code, reason, what_would_help}} and never a temperature.
 *
 * Loads as a classic browser script (window.HotSkin) and with require()/createRequire.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HotSkin = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // [Likely] Prandtl number of air near 300 K. Standard property tables put it between 0.70 and
  // 0.72 from 250 K to 500 K (Incropera & DeWitt, Table A.4: 0.707 at 300 K, 0.684 at 500 K);
  // known from textbooks, not measured here. The one constant in this file not read from PartForge.
  var PR_AIR = 0.71;
  var KELVIN = 273.15; // °C ↔ K offset, exact by definition
  // [Likely] Above about 800 K the vibrational modes of N2 and O2 are excited and cp of air rises
  // with temperature, so the constant-γ relation overstates T0: by a few percent just above 800 K,
  // and by more the hotter it gets (cp at 2,000 K is about a quarter above its 300 K value in the
  // property tables I remember). The bound stays conservative, so the page flags it, uncorrected.
  var HOT_T0_K = 800;
  // [Likely] The ceiling of the perfect-gas picture. Around 2,000 K oxygen begins to dissociate
  // (Anderson, Hypersonic and High-Temperature Gas Dynamics, the ranges for air at 1 atm: vibration
  // excited above ~800 K, O2 dissociation from ~2,000 K, N2 from ~4,000 K; lower pressure lowers
  // every one of them). Beyond it cp, γ and the recovery factors depend on temperature and pressure,
  // T0 = T∞(1 + (γ−1)/2 M²) with γ = 1.4 is no longer a bound on anything, and the model refuses
  // instead of printing a number. Textbook value, cited from memory; the more conservative of the
  // 2,000 K and 2,500 K onsets different texts give.
  var T0_MAX_K = 2000;
  // A bound within this many °C of the limit is reported as "near" rather than "under".
  var NEAR_C = 25;
  var SOURCES = /^(source|user|default)$/; // PartForge's TOL_SRC vocabulary (index.html:4660)

  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function has(obj, k) { return obj != null && Object.prototype.hasOwnProperty.call(obj, k) && obj[k] !== undefined && obj[k] !== null && obj[k] !== ''; }

  function gasConstants(ISA_GAMMA, ISA_R) {
    var g = ISA_GAMMA, R = ISA_R;
    return { gamma: g, R: R, cp: g * R / (g - 1), Pr: PR_AIR, r_lam: Math.sqrt(PR_AIR), r_turb: Math.cbrt(PR_AIR) };
  }

  // Build a context from a PartForgeSnapshot-shaped object (or anything with the same fields).
  function create(snapshot) {
    if (!snapshot || typeof snapshot.isa !== 'function') throw new Error('HotSkin.create needs a snapshot with isa()');
    if (!isNum(snapshot.ISA_GAMMA) || !isNum(snapshot.ISA_R)) throw new Error('HotSkin.create needs ISA_GAMMA and ISA_R');
    var rows = (snapshot.materialsThermal && snapshot.materialsThermal.rows) || [];
    var byKey = {};
    rows.forEach(function (r) { byKey[r.key] = r; });
    return {
      isa: snapshot.isa,
      gas: gasConstants(snapshot.ISA_GAMMA, snapshot.ISA_R),
      rows: rows,
      byKey: byKey,
      meta: snapshot.materialsMeta || {},
      fin: snapshot.finTemplate || null,
      provenance: snapshot.provenance || null,
      tableNotes: (snapshot.materialsThermal && snapshot.materialsThermal.notes) || '',
    };
  }

  function refuse(code, reason, whatWouldHelp, extra) {
    var r = { ok: false, verdict: 'REFUSED', refusal: { code: code, reason: reason, what_would_help: whatWouldHelp } };
    if (extra) Object.keys(extra).forEach(function (k) { r.refusal[k] = extra[k]; });
    return r;
  }

  // Atmosphere and temperatures for one condition. No refusals here; callers check inputs first.
  function aerotherm(ctx, v_m_s, alt_m) {
    var atm = ctx.isa(alt_m);
    var g = ctx.gas.gamma, k = (g - 1) / 2;
    var T = atm.T_K;
    var M = v_m_s / atm.a_m_s;
    var q = k * M * M;
    var T0 = T * (1 + q);
    return {
      atm: atm,
      M: M,
      T_inf_K: T,
      T0_K: T0,
      Tr_lam_K: T * (1 + ctx.gas.r_lam * q),
      Tr_turb_K: T * (1 + ctx.gas.r_turb * q),
      dT0_K: T0 - T,
      dT0_kinetic_K: v_m_s * v_m_s / (2 * ctx.gas.cp),
    };
  }

  // Speed at which each bound reaches a limit temperature at this altitude (closed form):
  // T_r − T∞ = r · V² / (2cp)  ⇒  V = sqrt(2 cp (T_limit − T∞) / r). Null when T∞ already exceeds it.
  function speedAtLimit(ctx, service_max_c, alt_m) {
    var T = ctx.isa(alt_m).T_K;
    var dT = service_max_c + KELVIN - T;
    var f = function (r) { return dT > 0 ? Math.sqrt(2 * ctx.gas.cp * dT / r) : null; };
    return { T0_m_s: f(1), turb_m_s: f(ctx.gas.r_turb), lam_m_s: f(ctx.gas.r_lam) };
  }

  // Speed at which the perfect-gas T0 reaches the ceiling at this altitude: V = sqrt(2 cp (T0_MAX − T∞)).
  // Between 1,855 m/s (sea level) and 1,909 m/s (top of the table); above it screen() refuses.
  function ceilingSpeed(ctx, alt_m) {
    return Math.sqrt(2 * ctx.gas.cp * (T0_MAX_K - ctx.isa(alt_m).T_K));
  }

  function band(T0_C, Tr_turb_C, service_max_c) {
    if (Tr_turb_C > service_max_c) return 'over';
    if (T0_C > service_max_c) return 'stagnation';
    if (service_max_c - T0_C < NEAR_C) return 'near';
    return 'under';
  }

  var BAND_TEXT = {
    over: 'bound exceeds the limit: even the turbulent recovery temperature is above service_max_c',
    stagnation: 'recovery under, stagnation over: stagnation points (leading edge, nose tip) exceed the limit; the flat skin’s adiabatic bound does not',
    near: 'bound within ' + NEAR_C + ' °C of the limit',
    under: 'bound under the limit',
  };

  // The trap the evaluation names: the same Mach number at two altitudes.
  function machExample(ctx, mach, alts) {
    return alts.map(function (alt) {
      var a = ctx.isa(alt);
      var v = mach * a.a_m_s;
      var r = aerotherm(ctx, v, alt);
      return { alt_m: alt, v_m_s: v, T_inf_C: r.T_inf_K - KELVIN, T0_C: r.T0_K - KELVIN, clamped: a.clamped };
    });
  }

  function materialInfo(ctx, key) {
    var row = ctx.byKey[key];
    var meta = ctx.meta[key] || {};
    return {
      key: key,
      name: meta.name || key,
      kind: meta.kind || 'unknown',
      service_max_c: row ? row.service_max_c : null,
      confidence: row ? row.confidence : null,
      note: row ? row.note : null,
    };
  }

  // One condition against one material. Returns {ok:true, ...} or a refusal.
  function screen(ctx, input) {
    input = input || {};
    if (has(input, 'mach') || has(input, 'M')) {
      var m = Number(has(input, 'mach') ? input.mach : input.M);
      var example = isNum(m) && m > 0 ? machExample(ctx, m, [3000, 25000]) : null;
      return refuse('invalid_input',
        'Mach is not a speed input here. T0 − T∞ tracks V²/2cp, not M: the same Mach number at a different altitude is a different speed through colder air, so a bare Mach number can read tens of degrees low.',
        'Declare v_max_m_s (the speed in m/s) and alt_m; Mach is derived from them with the ISA speed of sound.',
        { mach: isNum(m) ? m : null, example: example });
    }
    var v = input.v_m_s;
    if (typeof v === 'string' && v.trim() !== '' && isFinite(Number(v))) v = Number(v);
    if (!isNum(v) || v < 0) return refuse('invalid_input', 'v_max_m_s must be a finite speed in m/s, zero or more (got ' + JSON.stringify(input.v_m_s) + ').', 'Give the speed in m/s; the template field is v_max_m_s.');
    var alt = input.alt_m;
    if (typeof alt === 'string' && alt.trim() !== '' && isFinite(Number(alt))) alt = Number(alt);
    if (!isNum(alt)) return refuse('invalid_input', 'alt_m must be a finite geometric altitude in metres (got ' + JSON.stringify(input.alt_m) + ').', 'Give the altitude in metres; the template field is alt_m.');
    // The envelope of the model itself, checked before the material so that table() can probe a
    // condition without naming one: the ISA table's edges, then the perfect-gas ceiling.
    var atm = ctx.isa(alt);
    if (atm.clamped) {
      return refuse('out_of_envelope', 'alt_m ' + alt + ' m is outside the 1976 Standard Atmosphere table (−5 km to 86 km geometric); isa() clamps it to the table edge (' + Math.round(atm.Z_geometric_m) + ' m), which would be a number for the wrong altitude.', 'Give an altitude inside −5,000 to 86,000 m geometric. Above 86 km the air is too thin for this flat-plate boundary-layer picture anyway.', { clamped_to_m: atm.Z_geometric_m });
    }
    var h = aerotherm(ctx, v, alt);
    if (h.T0_K > T0_MAX_K) {
      var vc = ceilingSpeed(ctx, alt);
      return refuse('out_of_envelope', 'At ' + v + ' m/s and ' + alt + ' m the perfect-gas stagnation temperature passes ' + T0_MAX_K + ' K, the ceiling of this screen: around there oxygen begins to dissociate, cp and γ of air depend on temperature and pressure, and T0 = T∞(1 + (γ−1)/2 M²) with γ = 1.4 is no longer a bound on anything, so no temperature is printed.', 'Stay below ' + Math.floor(vc) + ' m/s at this altitude, where T0 reaches ' + T0_MAX_K + ' K (Mach ' + (vc / atm.a_m_s).toFixed(1) + '), or use a high-temperature equilibrium-air model; the perfect-gas picture this page uses does not apply.', { ceiling_K: T0_MAX_K, ceiling_speed_m_s: vc });
    }
    var key = input.material;
    if (!has(input, 'material') || !ctx.byKey[key]) {
      return refuse('not_found', 'material ' + JSON.stringify(key == null ? null : String(key)) + ' is not in materials_thermal.json.', 'Use one of the ' + ctx.rows.length + ' FLIGHT_MATERIALS keys: ' + ctx.rows.map(function (r) { return r.key; }).join(', ') + '.', { keys: ctx.rows.map(function (r) { return r.key; }) });
    }
    var mat = materialInfo(ctx, key);
    if (!isNum(mat.service_max_c)) {
      return refuse('insufficient_data', mat.name + ' has no service_max_c in materials_thermal.json, so there is no limit to measure the bound against.', 'Add service_max_c for ' + key + ' with its confidence and the sheet it came from; until then this check cannot pass or fail.', { material: mat });
    }
    var src = SOURCES.test(String(input.inputs_src)) ? String(input.inputs_src) : 'default';
    var T0_C = h.T0_K - KELVIN, Trt_C = h.Tr_turb_K - KELVIN, Trl_C = h.Tr_lam_K - KELVIN;
    var flags = [{ code: 'bound', text: 'The adiabatic wall temperature is an upper bound on skin temperature, not a prediction: a flight that lasts seconds, conduction into the part and radiation all keep the skin below it. SCREEN, never PASS.' }];
    if (src === 'default') flags.push({ code: 'provisional', text: 'v_max is tool-proposed (inputs_src default): this margin is arithmetic, not evidence. A low guess passes a polymer part silently. Replace it with the flight number and say where it came from.' });
    if (mat.confidence === 'recall') flags.push({ code: 'recall', text: 'service_max_c for ' + mat.name + ' is model recall (confidence recall): the table calls the column judgement, not a rating. Get the figure from the data sheet of the grade actually bought.' });
    else if (mat.confidence === 'likely') flags.push({ code: 'likely', text: 'service_max_c for ' + mat.name + ' is confidence likely: nominal, agreeing across handbooks, not a mill certificate.' });
    if (h.T0_K > HOT_T0_K) flags.push({ code: 'hot', text: 'T0 is above ' + HOT_T0_K + ' K: with constant γ = 1.4 the stagnation temperature is overstated, by a few percent just above ' + HOT_T0_K + ' K and by more the hotter it gets, because cp of air rises with temperature once vibration is excited. The bound stays conservative up to the ' + T0_MAX_K + ' K ceiling, where this page refuses. [Likely]' });
    var b = band(T0_C, Trt_C, mat.service_max_c);
    return {
      ok: true,
      verdict: 'SCREEN',
      band: b,
      bandText: BAND_TEXT[b],
      inputs: { v_m_s: v, alt_m: alt, material: key, inputs_src: src },
      atm: h.atm,
      M: h.M,
      T_inf_K: h.T_inf_K, T_inf_C: h.T_inf_K - KELVIN,
      T0_K: h.T0_K, T0_C: T0_C,
      Tr_turb_K: h.Tr_turb_K, Tr_turb_C: Trt_C,
      Tr_lam_K: h.Tr_lam_K, Tr_lam_C: Trl_C,
      dT0_K: h.dT0_K,
      dT0_kinetic_K: h.dT0_kinetic_K,
      gas: ctx.gas,
      material: mat,
      margin_T0_C: mat.service_max_c - T0_C,
      margin_turb_C: mat.service_max_c - Trt_C,
      margin_lam_C: mat.service_max_c - Trl_C,
      limitSpeed: speedAtLimit(ctx, mat.service_max_c, alt),
      flags: flags,
    };
  }

  // Every material at one condition. The condition is probed once with no material, so every
  // envelope refusal (speed, altitude, ISA edge, ceiling) comes back before any row is computed;
  // the probe's own not_found is the signal that the condition itself is fine. Rows without a
  // limit carry their own refusal instead of a margin.
  function table(ctx, v_m_s, alt_m) {
    var probe = screen(ctx, { v_m_s: v_m_s, alt_m: alt_m, material: '__probe__', inputs_src: 'user' });
    if (!probe.ok && probe.refusal.code !== 'not_found') return { ok: false, refusal: probe.refusal, rows: [] };
    var h = aerotherm(ctx, Number(v_m_s), Number(alt_m));
    var T0_C = h.T0_K - KELVIN, Trt_C = h.Tr_turb_K - KELVIN, Trl_C = h.Tr_lam_K - KELVIN;
    var rows = ctx.rows.map(function (r) {
      var mat = materialInfo(ctx, r.key);
      if (!isNum(mat.service_max_c)) {
        return { key: r.key, name: mat.name, kind: mat.kind, service_max_c: null, confidence: mat.confidence, refusal: { code: 'insufficient_data', reason: 'no service_max_c' } };
      }
      return {
        key: r.key, name: mat.name, kind: mat.kind,
        service_max_c: mat.service_max_c, confidence: mat.confidence, note: mat.note,
        margin_T0_C: mat.service_max_c - T0_C,
        margin_turb_C: mat.service_max_c - Trt_C,
        margin_lam_C: mat.service_max_c - Trl_C,
        band: band(T0_C, Trt_C, mat.service_max_c),
      };
    });
    return { ok: true, verdict: 'SCREEN', condition: { v_m_s: Number(v_m_s), alt_m: Number(alt_m), M: h.M, T_inf_C: h.T_inf_K - KELVIN, T0_C: T0_C, Tr_turb_C: Trt_C, Tr_lam_C: Trl_C }, rows: rows };
  }

  // What a person typed in the speed field. Mach spellings are recognised so they can be refused
  // with the worked example; anything with a unit other than m/s is reported, not converted.
  // A number is digits with an optional point anywhere ("700", "700.", ".5", "657.2"), no exponent.
  var NUM = '(-?(?:\\d+\\.?\\d*|\\.\\d+))';
  var RE_MACH_A = new RegExp('^(?:mach|ma|m)\\s?' + NUM + '$');
  var RE_MACH_B = new RegExp('^' + NUM + '\\s?(?:mach|ma|m)$');
  var RE_SPEED = new RegExp('^' + NUM + '\\s?(m\\/s|m\\s?s-1|mps|meters? per second|metres? per second)?$');
  var RE_UNIT = new RegExp('^' + NUM + '\\s?([a-z/]+)$');
  function parseSpeed(text) {
    if (text == null) return null;
    var s = String(text).trim().toLowerCase().replace(/\s+/g, ' ');
    if (!s) return null;
    var m;
    if ((m = RE_MACH_A.exec(s)) || (m = RE_MACH_B.exec(s))) return { kind: 'mach', mach: Number(m[1]) };
    if ((m = RE_SPEED.exec(s))) return { kind: 'speed', v_m_s: Number(m[1]) };
    if ((m = RE_UNIT.exec(s))) return { kind: 'unit', unit: m[2], value: Number(m[1]) };
    return null;
  }

  return {
    PR_AIR: PR_AIR,
    KELVIN: KELVIN,
    HOT_T0_K: HOT_T0_K,
    T0_MAX_K: T0_MAX_K,
    NEAR_C: NEAR_C,
    BAND_TEXT: BAND_TEXT,
    gasConstants: gasConstants,
    create: create,
    aerotherm: aerotherm,
    speedAtLimit: speedAtLimit,
    ceilingSpeed: ceilingSpeed,
    band: band,
    machExample: machExample,
    materialInfo: materialInfo,
    screen: screen,
    table: table,
    parseSpeed: parseSpeed,
  };
});
