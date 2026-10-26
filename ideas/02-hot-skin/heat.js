/* heat.js: the arithmetic behind "Hot Skin", with no DOM and no clock.
 *
 * Aerodynamic heating, Stage 1 (PartForge docs/roadmap-evaluation.md, idea 20): the stagnation and
 * recovery temperatures of air at a declared speed and altitude, measured against a material's
 * service_max_c. Everything the model needs from PartForge arrives through a snapshot object
 * (snapshots/partforge.js): the repository's own isa() and ISA constants, the materials_thermal
 * table with each row's confidence, FLIGHT_MATERIALS names and kinds, and the fin template's
 * declared condition. The only constant in the equations defined here is the Prandtl number of air;
 * the 800 K flag, the 2,000 K ceiling, the 25 °C "near" band and the −90 to +50 K band of ISA offsets
 * are thresholds on what is flagged, refused or named, not terms in the arithmetic.
 *
 *   T∞, a      = isa(alt_m), + ΔT if declared    1976 Standard Atmosphere, the repo's function
 *   M          = V / a                           derived, never an input; V is airspeed
 *   T0         = T∞ (1 + (γ−1)/2 · M²)           stagnation (total) temperature          [Certain]
 *   T_r        = T∞ (1 + r (γ−1)/2 · M²)         adiabatic-wall (recovery) temperature   [Certain]
 *   r          = Pr^½ laminar, Pr^⅓ turbulent    flat-plate recovery factors             [Likely]
 *   cp         = γR/(γ−1)                        so that T0 − T∞ = V²/(2cp) exactly       [Certain]
 *
 * T∞ is the 1976 standard day unless an ISA offset ΔT is declared (isa_offset_K): then T∞ = T_ISA + ΔT
 * at every altitude, a = √(γR T∞), and since T0 − T∞ = V²/2cp does not depend on T∞, every bound
 * rises by exactly ΔT at a fixed speed. PartForge's isa() has no offset argument; the offset is added
 * here, after it.
 *
 * V is the airspeed, the speed relative to the air, not over the ground. A ground-relative speed taken
 * into a headwind w reads low by ((V + w)² − V²)/2cp: 7.0 K per 10 m/s at 700 m/s. [Certain, algebra]
 *
 * The verdict is always SCREEN. T0 is an upper bound on how hot heating by the air alone can make the
 * skin in steady flight through the stated atmosphere; T_r is the same for a flat skin with
 * free-stream edge conditions (behind a shock it can be higher, never above T0). Neither predicts
 * what the skin reaches in a flight that lasts seconds, and neither includes sun soak on the pad or
 * motor-case and plume heat. The screen never says PASS, though a bound under a limit would justify
 * one if the limit and the inputs were evidence: service_max_c is the table's documented judgement
 * (14 of 21 rows recall), the speed may be a tool default, and the day may be hotter than standard.
 * Refusals are first-class results: a bare Mach number (T0 − T∞ tracks V², not M), an unknown
 * material, a row without service_max_c, an altitude the ISA table clamps, an ISA offset outside the
 * page's band, a speed at which the perfect-gas T0 would pass the 2,000 K ceiling (where the
 * calorically perfect gas these equations describe stops existing), or a non-finite input each
 * return {ok:false, refusal:{code, reason, what_would_help}} and never a temperature above the
 * ceiling (the Mach refusal's worked example included). The derived figures obey the same envelope:
 * the speed at which a bound meets the limit is named only when it is under the ceiling speed, and
 * the day at which T0 meets it only when that day is inside the −90 to +50 K band (and under the
 * ceiling at this speed); otherwise each is null, with a status and a reason that say which side.
 *
 * Loads as a classic browser script (window.HotSkin) and with require()/createRequire.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HotSkin = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // [Likely] Prandtl number of air near 300 K. Standard property tables put it between about 0.68
  // and 0.72 from 250 K to 500 K (Incropera & DeWitt, Table A.4: 0.707 at 300 K, 0.684 at 500 K);
  // known from textbooks, not measured here. The one constant in this file not read from PartForge.
  var PR_AIR = 0.71;
  var KELVIN = 273.15; // °C ↔ K offset, exact by definition
  // [Likely] Above about 800 K the vibrational modes of N2 and O2 are excited and cp of air rises
  // with temperature, so the constant-γ relation overstates T0: by a few percent just above 800 K,
  // and by more the hotter it gets (cp at 2,000 K is about a third above its 300 K value in the
  // property tables I remember: 1.338 against 1.007 kJ/(kg·K)). The bound stays conservative, so the
  // page flags it, uncorrected.
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
  // [Likely] The band of ISA offsets the page accepts, in kelvin. It brackets recorded surface air
  // temperatures with room to spare: the 56.7 °C Death Valley record is about ISA+42 K at sea level,
  // and the −89.2 °C Vostok record at 3,488 m is about ISA−82 K (records from memory, ISA from isa()).
  // A presentation envelope, not physics: outside it the page refuses rather than computing a day
  // that is probably a typo (an ambient temperature typed where the offset goes).
  var ISA_DT_MIN_K = -90;
  var ISA_DT_MAX_K = 50;
  // The Mach refusal's worked example: the same Mach number at these two altitudes. 3 km is the fin
  // template's declared altitude; 25 km is a high-apogee condition (the evaluation's "~128 °C at
  // apogee" is Mach 2 near 26.3 km by the same isa()).
  var MACH_EXAMPLE_ALTS = [3000, 25000];
  var MACH_EXAMPLE_FALLBACK = 2;

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

  // Free-stream temperature and speed of sound at a geometric altitude on an ISA+ΔT day. With ΔT = 0
  // these are isa()'s own T_K and a_m_s, untouched; otherwise T = T_ISA + ΔT and a = √(γ R T), the
  // same formula isa() uses.
  function freeStream(ctx, alt_m, dT_K) {
    var atm = ctx.isa(alt_m);
    var dT = dT_K || 0;
    if (dT === 0) return { atm: atm, T_K: atm.T_K, a_m_s: atm.a_m_s, dT_K: 0 };
    var T = atm.T_K + dT;
    return { atm: atm, T_K: T, a_m_s: Math.sqrt(ctx.gas.gamma * ctx.gas.R * T), dT_K: dT };
  }

  // Atmosphere and temperatures for one condition. No refusals here; callers check inputs first.
  function aerotherm(ctx, v_m_s, alt_m, dT_K) {
    var fs = freeStream(ctx, alt_m, dT_K);
    var atm = fs.atm;
    var g = ctx.gas.gamma, k = (g - 1) / 2;
    var T = fs.T_K;
    var M = v_m_s / fs.a_m_s;
    var q = k * M * M;
    var T0 = T * (1 + q);
    return {
      atm: atm,
      a_m_s: fs.a_m_s,
      dT_K: fs.dT_K,
      T_isa_K: atm.T_K,
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
  // T_r − T∞ = r · V² / (2cp)  ⇒  V = sqrt(2 cp (T_limit − T∞) / r). Null when T∞ already exceeds the
  // limit (air_hotter), and null when the speed is past the one at which T0 reaches the 2,000 K ceiling
  // here: a speed the page would refuse is not named as a crossing. In the shipped table only
  // Graphite's 2,000 °C is that high (its T0 crossing at 3 km would be about 2,007 m/s, its turbulent
  // one about 2,125 m/s, against a ceiling speed of 1,865.18 m/s).
  function speedAtLimit(ctx, service_max_c, alt_m, dT_K) {
    var T = freeStream(ctx, alt_m, dT_K).T_K;
    var dT = service_max_c + KELVIN - T;
    var vc = ceilingSpeed(ctx, alt_m, dT_K);
    var f = function (r) {
      if (!(dT > 0)) return null;
      var v = Math.sqrt(2 * ctx.gas.cp * dT / r);
      return v <= vc ? v : null;
    };
    return { T0_m_s: f(1), turb_m_s: f(ctx.gas.r_turb), lam_m_s: f(ctx.gas.r_lam), air_hotter: !(dT > 0), ceiling_m_s: vc };
  }

  // Speed at which the perfect-gas T0 reaches the ceiling at this altitude: V = sqrt(2 cp (T0_MAX − T∞)).
  // On a standard day between 1,854.65 m/s (sea level) and 1,908.69 m/s (top of the table); a hot day
  // lowers it. Above it screen() refuses.
  function ceilingSpeed(ctx, alt_m, dT_K) {
    return Math.sqrt(2 * ctx.gas.cp * (T0_MAX_K - freeStream(ctx, alt_m, dT_K).T_K));
  }

  // "Stay below" speeds are printed rounded DOWN to 0.1 m/s, so the printed figure is itself under the
  // ceiling (1,854.65 prints as 1854.6, never as 1855).
  function floor1(x) { return (Math.floor(x * 10) / 10).toFixed(1); }

  function band(T0_C, Tr_turb_C, service_max_c) {
    if (Tr_turb_C > service_max_c) return 'over';
    if (T0_C > service_max_c) return 'stagnation';
    if (service_max_c - T0_C < NEAR_C) return 'near';
    return 'under';
  }

  var BAND_TEXT = {
    over: 'bound exceeds the limit: even the turbulent recovery temperature is above service_max_c',
    stagnation: 'recovery under, stagnation over: stagnation points (leading edge, nose tip) exceed the limit; a flat skin’s free-stream recovery temperature does not (behind a shock it can be higher, never above T0)',
    near: 'bound within ' + NEAR_C + ' °C of the limit',
    under: 'bound under the limit',
  };

  // The trap the evaluation names: the same Mach number at two altitudes. A row whose speed would put
  // the perfect-gas T0 past the 2,000 K ceiling carries no speed and no temperature (over_ceiling),
  // because the page never prints a temperature above the ceiling, worked example or not.
  function machExample(ctx, mach, alts, dT_K) {
    return alts.map(function (alt) {
      var fs = freeStream(ctx, alt, dT_K);
      var v = mach * fs.a_m_s;
      var row = { alt_m: alt, T_inf_C: fs.T_K - KELVIN, clamped: fs.atm.clamped, over_ceiling: false };
      if (!(v <= ceilingSpeed(ctx, alt, dT_K))) { row.over_ceiling = true; row.v_m_s = null; row.T0_C = null; return row; }
      var r = aerotherm(ctx, v, alt, dT_K);
      row.v_m_s = v;
      row.T0_C = r.T0_K - KELVIN;
      return row;
    });
  }

  // The largest Mach number whose example stays under the ceiling at every example altitude.
  function machCeiling(ctx, alts, dT_K) {
    return Math.min.apply(null, alts.map(function (alt) { return ceilingSpeed(ctx, alt, dT_K) / freeStream(ctx, alt, dT_K).a_m_s; }));
  }

  // The typed Mach number when its example is printable; otherwise Mach 2, with the reason.
  function machRefusalExample(ctx, m, dT_K) {
    var alts = MACH_EXAMPLE_ALTS;
    var mMax = machCeiling(ctx, alts, dT_K);
    if (isNum(m) && m > 0 && m <= mMax) return { mach: m, rows: machExample(ctx, m, alts, dT_K), note: null, mach_max: mMax };
    var why;
    if (isNum(m) && m > 0) {
      var over = machExample(ctx, m, alts, dT_K).filter(function (r) { return r.over_ceiling; }).map(function (r) { return r.alt_m + ' m'; });
      why = 'Mach ' + m + ' is not worked here: at ' + over.join(' and at ') + ' it would put the perfect-gas T0 past the ' + T0_MAX_K + ' K ceiling, where this page prints no temperature (the example can show up to Mach ' + (Math.floor(mMax * 100) / 100).toFixed(2) + '). The example uses Mach ' + MACH_EXAMPLE_FALLBACK + '.';
    } else {
      why = 'The typed Mach number is not a positive number, so the example uses Mach ' + MACH_EXAMPLE_FALLBACK + '.';
    }
    return { mach: MACH_EXAMPLE_FALLBACK, rows: machExample(ctx, MACH_EXAMPLE_FALLBACK, alts, dT_K), note: why, mach_max: mMax };
  }

  function materialInfo(ctx, key) {
    var row = Object.prototype.hasOwnProperty.call(ctx.byKey, key) ? ctx.byKey[key] : null;
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

  // The ISA offset an input declares: 0 when absent, a number when given, NaN when unreadable.
  function readOffset(input) {
    if (!has(input, 'isa_offset_K')) return 0;
    var d = input.isa_offset_K;
    if (typeof d === 'string' && d.trim() !== '' && isFinite(Number(d))) d = Number(d);
    return isNum(d) ? d : NaN;
  }

  // PartForge's provenance rule for a loads entry (index.html:4738-4740): inputs_src outside the
  // vocabulary becomes 'default', and 'source' with no inputs_ref is demoted to 'default'. The
  // reference is whitespace-collapsed, trimmed and cut to 140 characters as mdSafe() and the parser do.
  function provenanceOf(input) {
    var src = SOURCES.test(String(input.inputs_src)) ? String(input.inputs_src) : 'default';
    var ref = src === 'source' && typeof input.inputs_ref === 'string' ? input.inputs_ref.replace(/\s+/g, ' ').trim().slice(0, 140) : '';
    var demoted = false;
    if (src === 'source' && !ref) { src = 'default'; demoted = true; }
    return { inputs_src: src, inputs_ref: ref, demoted: demoted };
  }

  function fmtSigned(x) { return (x < 0 ? '−' : '+') + Math.abs(x).toFixed(1); }
  function dayName(dT) { return dT === 0 ? 'the ISA standard day' : 'an ISA' + fmtSigned(dT) + ' K day'; }

  // The day (ISA offset) at which T0 meets the limit at this speed. The bound moves one for one with
  // the day, so it is ΔT + (service_max_c − T0) [Certain, algebra]. That sum is named as a day only when
  // it is one this page accepts: inside the −90 to +50 K band and, at this speed, with T0 under the
  // 2,000 K ceiling. Outside that it is algebra, not a day: 6061-T6 at 1,500 m/s and 3 km would need
  // ISA−945.3 K, a free stream at −676.6 K, and 304 at the fin condition ISA+560.6 K. Then T0_K is null
  // and the status says which side: the bound is under the limit on every day the page computes at
  // this speed, or over it on every one. Inside the band the free stream is at least 186.9 − 90 = 96.9 K
  // (the coldest air isa() returns is the 86 km top), so a named day never implies T∞ ≤ 0 K.
  // h is aerotherm() at the current day dT, whose T0 is already under the ceiling.
  function dayAtLimit(h, dT, marginT0) {
    var x = dT + marginT0;
    var xCeil = dT + (T0_MAX_K - h.T0_K); // the day on which T0 reaches the ceiling at this speed, ≥ dT
    var lo = ISA_DT_MIN_K, hi = Math.min(ISA_DT_MAX_K, xCeil);
    var out = { T0_K: null, status: 'in_band', reason: null, min_K: lo, max_K: hi, ceiling_limited: xCeil < ISA_DT_MAX_K };
    if (x >= lo && x <= hi) { out.T0_K = x; return out; }
    var span = 'every day from ISA' + fmtSigned(lo) + ' K to ISA' + fmtSigned(hi) + ' K' +
      (out.ceiling_limited ? ' (on a warmer day T0 passes the ' + T0_MAX_K + ' K ceiling at this speed and the page refuses)' : '');
    if (x > hi) {
      out.status = 'under_every_day';
      out.reason = 'No day this page accepts brings T0 to the limit at this speed: the bound is under it on ' + span + '.';
    } else {
      out.status = 'over_every_day';
      out.reason = 'No day this page accepts brings T0 down to the limit at this speed: the bound is over it on ' + span + '.';
    }
    return out;
  }

  // One condition against one material. Returns {ok:true, ...} or a refusal.
  function screen(ctx, input) {
    input = input || {};
    var dT = readOffset(input);
    if (!isNum(dT)) return refuse('invalid_input', 'isa_offset_K must be a finite temperature offset in kelvin (got ' + JSON.stringify(input.isa_offset_K) + ').', 'Give the day as ISA + ΔT in kelvin, 0 for the standard day; for example 20 for a 35 °C day at sea level.');
    if (dT < ISA_DT_MIN_K || dT > ISA_DT_MAX_K) {
      return refuse('out_of_envelope', 'An ISA offset of ' + dT + ' K is outside the ' + ISA_DT_MIN_K + ' to +' + ISA_DT_MAX_K + ' K this page accepts, a band that already brackets recorded surface air temperatures (about ISA+42 K for the hottest, ISA−82 K for the coldest).', 'The offset is the day’s temperature minus the standard one, not the temperature itself: a 35 °C day at sea level is ISA+20 K (35 − 15). Give an offset inside the band.', { isa_offset_K: dT, min_K: ISA_DT_MIN_K, max_K: ISA_DT_MAX_K });
    }
    if (has(input, 'mach') || has(input, 'M')) {
      var m = Number(has(input, 'mach') ? input.mach : input.M);
      var ex = machRefusalExample(ctx, m, dT);
      var e2 = machExample(ctx, MACH_EXAMPLE_FALLBACK, MACH_EXAMPLE_ALTS, dT);
      var gap2 = e2[0].T0_C - e2[1].T0_C;
      return refuse('invalid_input',
        'Mach is not a speed input here. T0 − T∞ tracks V²/2cp, the speed, not M: the same Mach number higher up is a lower speed through colder air, so it reads a lower T0. Between two altitudes the gap is (T∞ below − T∞ above) × (1 + (γ−1)/2 · M²), which grows with M²: ' + gap2.toFixed(1) + ' °C at Mach ' + MACH_EXAMPLE_FALLBACK + ' between ' + MACH_EXAMPLE_ALTS[0] + ' m and ' + MACH_EXAMPLE_ALTS[1] + ' m.',
        'Declare v_max_m_s (the airspeed in m/s, relative to the air) and alt_m; Mach is derived from them with the ISA speed of sound.',
        { mach: isNum(m) ? m : null, example: ex.rows, example_mach: ex.mach, example_note: ex.note, example_mach_max: ex.mach_max });
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
    var h = aerotherm(ctx, v, alt, dT);
    if (!(h.T0_K <= T0_MAX_K)) {
      var vc = ceilingSpeed(ctx, alt, dT);
      return refuse('out_of_envelope', 'At ' + v + ' m/s and ' + alt + ' m on ' + dayName(dT) + ' the perfect-gas stagnation temperature passes ' + T0_MAX_K + ' K, the ceiling of this screen: around there oxygen begins to dissociate, cp and γ of air depend on temperature and pressure, and T0 = T∞(1 + (γ−1)/2 M²) with γ = 1.4 is no longer a bound on anything, so no temperature is printed.', 'Stay below ' + floor1(vc) + ' m/s at this altitude (T0 reaches ' + T0_MAX_K + ' K at ' + vc.toFixed(2) + ' m/s, Mach ' + (vc / h.a_m_s).toFixed(2) + '), or use a high-temperature equilibrium-air model; the perfect-gas picture this page uses does not apply.', { ceiling_K: T0_MAX_K, ceiling_speed_m_s: vc });
    }
    var key = input.material;
    if (!has(input, 'material') || !Object.prototype.hasOwnProperty.call(ctx.byKey, key)) {
      return refuse('not_found', 'material ' + JSON.stringify(key == null ? null : String(key)) + ' is not in materials_thermal.json.', 'Use one of the ' + ctx.rows.length + ' FLIGHT_MATERIALS keys: ' + ctx.rows.map(function (r) { return r.key; }).join(', ') + '.', { keys: ctx.rows.map(function (r) { return r.key; }) });
    }
    var mat = materialInfo(ctx, key);
    if (!isNum(mat.service_max_c)) {
      return refuse('insufficient_data', mat.name + ' has no service_max_c in materials_thermal.json, so there is no limit to measure the bound against.', 'Add service_max_c for ' + key + ' with its confidence and the sheet it came from; until then this check cannot pass or fail.', { material: mat });
    }
    var prov = provenanceOf(input);
    var T0_C = h.T0_K - KELVIN, Trt_C = h.Tr_turb_K - KELVIN, Trl_C = h.Tr_lam_K - KELVIN;
    var mT0 = mat.service_max_c - T0_C, mTurb = mat.service_max_c - Trt_C, mLam = mat.service_max_c - Trl_C;
    // The day on which T0 meets the limit at this speed, named only when the page accepts that day.
    var offsetAtLimit = dayAtLimit(h, dT, mT0);
    var dayK = offsetAtLimit.T0_K;
    // [Certain, algebra] What 10 m/s of headwind adds when a ground speed is typed for the airspeed.
    var headwind10_K = ((v + 10) * (v + 10) - v * v) / (2 * ctx.gas.cp);
    var flags = [{ code: 'bound', text: 'An upper bound on how hot heating by the air alone can make the skin in steady flight through ' + dayName(dT) + ', not a prediction: a flight that lasts seconds, conduction into the part and radiation keep the skin below it. T0 bounds every point on the part; Tr uses free-stream conditions and behind a shock can be up to T0 − Tr higher. Sun soak on the pad and motor-case or plume heat are not in it. The speed is airspeed, relative to the air: a ground speed taken into a headwind reads low, by ' + headwind10_K.toFixed(1) + ' K per 10 m/s of headwind at this speed ((V + w)² − V² over 2cp). SCREEN, never PASS: the limit is judgement, the speed may be a guess and the day may be hotter.' }];
    if (dT === 0) {
      var sdTail = dayK === null ? offsetAtLimit.reason
        : mT0 > 0 ? 'This margin vs T0 (' + fmtSigned(mT0) + ' °C) is gone on a day warmer than ISA' + fmtSigned(dayK) + ' K.'
        : 'The bound is already over the limit on a standard day; T0 comes under it only on a day colder than ISA' + fmtSigned(dayK) + ' K.';
      flags.push({ code: 'standard_day', text: 'T∞ is the ISA standard day. At a fixed speed T0 − T∞ = V²/2cp does not depend on T∞, so on an ISA+ΔT day every bound here rises by exactly ΔT and every margin falls by ΔT. A summer day at an inland launch site is commonly ISA+15 to +30 K near the ground (35 °C at 1,400 m is about ISA+29) [Likely]. ' + sdTail });
    } else {
      var offTail = dayK === null ? offsetAtLimit.reason
        : mT0 > 0 ? 'The margin vs T0 reaches zero at ISA' + fmtSigned(dayK) + ' K.'
        : 'The margin vs T0 is positive only below ISA' + fmtSigned(dayK) + ' K.';
      flags.push({ code: 'offset', text: 'T∞ is ISA' + fmtSigned(dT) + ' K, the same offset at every altitude (the usual way to state a hot or cold day; a real day’s profile varies with height). Every bound is ' + Math.abs(dT).toFixed(1) + ' K ' + (dT > 0 ? 'above' : 'below') + ' its standard-day value at this speed. ' + offTail });
    }
    if (prov.demoted) flags.push({ code: 'demoted', text: 'inputs_src source with no inputs_ref is demoted to default, as PartForge does (index.html:4740): a cited speed needs its citation. Say where the number came from (a sim run, a flight log) to clear it.' });
    if (prov.inputs_src === 'default') flags.push({ code: 'provisional', text: 'v_max is tool-proposed (inputs_src default): this margin is arithmetic, not evidence. A low guess passes a polymer part silently. Replace it with the flight number and say where it came from.' });
    if (mat.confidence === 'recall') flags.push({ code: 'recall', text: 'service_max_c for ' + mat.name + ' is model recall (confidence recall): the table calls the column judgement, not a rating. Get the figure from the data sheet of the grade actually bought.' });
    else if (mat.confidence === 'likely') flags.push({ code: 'likely', text: 'service_max_c for ' + mat.name + ' is confidence likely: nominal, agreeing across handbooks, not a mill certificate.' });
    if (h.T0_K > HOT_T0_K) flags.push({ code: 'hot', text: 'T0 is above ' + HOT_T0_K + ' K: with constant γ = 1.4 the stagnation temperature is overstated, by a few percent just above ' + HOT_T0_K + ' K and by more the hotter it gets, because cp of air rises with temperature once vibration is excited. The bound stays conservative up to the ' + T0_MAX_K + ' K ceiling, where this page refuses. [Likely]' });
    var b = band(T0_C, Trt_C, mat.service_max_c);
    return {
      ok: true,
      verdict: 'SCREEN',
      band: b,
      bandText: BAND_TEXT[b],
      inputs: { v_m_s: v, alt_m: alt, material: key, inputs_src: prov.inputs_src, inputs_ref: prov.inputs_ref, demoted: prov.demoted, isa_offset_K: dT },
      atm: h.atm,
      a_m_s: h.a_m_s,
      M: h.M,
      T_isa_K: h.T_isa_K,
      dT_K: dT,
      T_inf_K: h.T_inf_K, T_inf_C: h.T_inf_K - KELVIN,
      T0_K: h.T0_K, T0_C: T0_C,
      Tr_turb_K: h.Tr_turb_K, Tr_turb_C: Trt_C,
      Tr_lam_K: h.Tr_lam_K, Tr_lam_C: Trl_C,
      dT0_K: h.dT0_K,
      dT0_kinetic_K: h.dT0_kinetic_K,
      gas: ctx.gas,
      material: mat,
      margin_T0_C: mT0,
      margin_turb_C: mTurb,
      margin_lam_C: mLam,
      offsetAtLimit: offsetAtLimit,
      headwind10_K: headwind10_K,
      limitSpeed: speedAtLimit(ctx, mat.service_max_c, alt, dT),
      flags: flags,
    };
  }

  // Every material at one condition. The condition is probed once with no material, so every
  // envelope refusal (speed, altitude, ISA edge, ceiling) comes back before any row is computed;
  // the probe's own not_found is the signal that the condition itself is fine. Rows without a
  // limit carry their own refusal instead of a margin.
  function table(ctx, v_m_s, alt_m, dT_K) {
    var dIn = dT_K == null ? 0 : dT_K;
    var probe = screen(ctx, { v_m_s: v_m_s, alt_m: alt_m, material: '__probe__', inputs_src: 'user', isa_offset_K: dIn });
    if (!probe.ok && probe.refusal.code !== 'not_found') return { ok: false, refusal: probe.refusal, rows: [] };
    var dT = readOffset({ isa_offset_K: dIn });
    var h = aerotherm(ctx, Number(v_m_s), Number(alt_m), dT);
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
    return { ok: true, verdict: 'SCREEN', condition: { v_m_s: Number(v_m_s), alt_m: Number(alt_m), isa_offset_K: dT, M: h.M, T_inf_C: h.T_inf_K - KELVIN, T0_C: T0_C, Tr_turb_C: Trt_C, Tr_lam_C: Trl_C }, rows: rows };
  }

  // What a person typed in the speed field. Mach spellings are recognised so they can be refused
  // with the worked example; anything with a unit other than m/s is reported, not converted. A
  // trailing "m" is read as an unfinished "m/s", not as Mach: "700 m" is far likelier to be a speed
  // half typed than Mach 700, so Mach needs "Mach 2", "M2", "2 Mach" or "2 Ma".
  // A number is digits with an optional point anywhere ("700", "700.", ".5", "657.2"), no exponent.
  var NUM = '(-?(?:\\d+\\.?\\d*|\\.\\d+))';
  var RE_MACH_A = new RegExp('^(?:mach|ma|m)\\s?' + NUM + '$');
  var RE_MACH_B = new RegExp('^' + NUM + '\\s?(?:mach|ma)$');
  var RE_SPEED = new RegExp('^' + NUM + '\\s?(m\\/s|m\\s?s-1|mps|meters? per second|metres? per second)?$');
  var RE_UNIT = new RegExp('^' + NUM + '\\s?([a-z/]+)$');
  function parseSpeed(text) {
    if (text == null) return null;
    var s = String(text).trim().toLowerCase().replace(/\s+/g, ' ');
    if (!s) return null;
    var m;
    if ((m = RE_MACH_A.exec(s)) || (m = RE_MACH_B.exec(s))) return { kind: 'mach', mach: Number(m[1]) };
    if ((m = RE_SPEED.exec(s))) return { kind: 'speed', v_m_s: Number(m[1]) };
    if ((m = RE_UNIT.exec(s))) {
      var out = { kind: 'unit', unit: m[2], value: Number(m[1]) };
      if (m[2] === 'm' || m[2] === 'm/' || m[2] === 'ms') out.didYouMean = 'm/s';
      return out;
    }
    return null;
  }

  return {
    PR_AIR: PR_AIR,
    KELVIN: KELVIN,
    HOT_T0_K: HOT_T0_K,
    T0_MAX_K: T0_MAX_K,
    NEAR_C: NEAR_C,
    ISA_DT_MIN_K: ISA_DT_MIN_K,
    ISA_DT_MAX_K: ISA_DT_MAX_K,
    MACH_EXAMPLE_ALTS: MACH_EXAMPLE_ALTS,
    BAND_TEXT: BAND_TEXT,
    gasConstants: gasConstants,
    create: create,
    aerotherm: aerotherm,
    speedAtLimit: speedAtLimit,
    dayAtLimit: dayAtLimit,
    ceilingSpeed: ceilingSpeed,
    band: band,
    machExample: machExample,
    machCeiling: machCeiling,
    machRefusalExample: machRefusalExample,
    freeStream: freeStream,
    provenanceOf: provenanceOf,
    materialInfo: materialInfo,
    screen: screen,
    table: table,
    parseSpeed: parseSpeed,
  };
});
